// Queue consumers — two-stage pipeline to stay within CF Worker CPU limits
//
// Stage 1 (job-processing-queue): dedup → save job to D1 → enqueue to match-queue
//   Fast: only D1 writes, no LLM calls. Handles up to 5 messages per batch.
//
// Stage 2 (match-queue): load profile → vectorize → LLM triage → PDF → ATS → outreach
//   Slow: one job per batch (max_batch_size=1) to avoid CPU timeout.

import type { Env, RawScrapedJob, UserProfile } from '@autoapply/types'
import { writeDeadLetter } from '../utils/dead-letter'
import { hasJobBeenProcessed } from '../utils/idempotency'
import { detectATS, routeApplication } from '../executors/apply'
import { matchJob, storeProfileEmbedding } from '../agents/matchmaker'
import { generateTailoredResume } from '../core/pdf-generator'
import { rewriteResumeBullets } from '../core/llm'
import { runSniperOutreach } from '../agents/networker'

interface ProcessJobMessage {
  type: 'process_job'
  userId: string
  job: RawScrapedJob
}

interface MatchJobMessage {
  type: 'match_job'
  userId: string
  jobId: string
  atsType: string
  boardToken: string | null
  atsJobId: string | null
}

// ─── Stage 1: Save job to D1, enqueue for matching ───────────────────────

export async function handleQueueBatch(
  batch: MessageBatch<ProcessJobMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    const { userId, job } = message.body

    try {
      // 1. Idempotency check
      if (job.external_id) {
        const exists = await hasJobBeenProcessed(env, userId, job.external_id)
        if (exists) {
          message.ack()
          continue
        }
      }

      // 2. Detect ATS + extract tokens
      const atsType = detectATS(job.apply_url)
      const { boardToken, jobId: atsJobId } = extractATSTokens(job.apply_url, atsType)

      // 3. Save to D1
      const jobId = crypto.randomUUID()
      await env.DB.prepare(`
        INSERT INTO jobs
        (id, source, external_id, title, company, company_domain, location, remote,
         description, apply_url, ats, ats_company_token, ats_job_id,
         salary_min, salary_max, scraped_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        jobId,
        job.source || 'jobspy',
        job.external_id || null,
        job.title,
        job.company,
        extractDomain(job.company),
        job.location || null,
        job.remote || null,
        job.description,
        job.apply_url,
        atsType,
        boardToken,
        atsJobId,
        job.salary_min ?? null,
        job.salary_max ?? null,
        Math.floor(Date.now() / 1000)
      ).run()

      // 4. Enqueue for matching (Stage 2)
      await (env.MATCH_QUEUE as any).send({
        type: 'match_job',
        userId,
        jobId,
        atsType,
        boardToken,
        atsJobId,
      })

      message.ack()
    } catch (err) {
      await writeDeadLetter(
        env, 'match', job.external_id, userId,
        'QUEUE_PROCESS_ERROR',
        err instanceof Error ? err.message : String(err),
        { job }
      )
      message.ack()
    }
  }
}

// ─── Stage 2: Match, PDF, ATS, Outreach ──────────────────────────────────

export async function handleMatchBatch(
  batch: MessageBatch<MatchJobMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    const { userId, jobId, atsType, boardToken, atsJobId } = message.body

    try {
      // 1. Load job from D1
      const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ?')
        .bind(jobId).first() as any
      if (!job) { message.ack(); continue }

      // 2. Load user profile
      const profile = await loadUserProfile(env, userId)
      if (!profile) { message.ack(); continue }

      // 3. Ensure profile embedding exists (one-time per user)
      if (!profile.profileEmbedding) {
        const vectorId = await storeProfileEmbedding(env, profile)
        if (vectorId) {
          await env.DB.prepare('UPDATE profiles SET profile_embedding = ? WHERE user_id = ?')
            .bind(vectorId, userId).run()
          profile.profileEmbedding = vectorId
        }
      }

      // 4. Dual-pass matching
      const matchResult = await matchJob(env, job.description, jobId, profile)

      // 5. Update job with triage fields
      await env.DB.prepare(`
        UPDATE jobs SET years_required = ?, seniority = ?, visa_sponsorship = ?
        WHERE id = ?
      `).bind(
        matchResult.triageFields.years_required ?? null,
        matchResult.triageFields.seniority ?? null,
        matchResult.triageFields.visa_sponsorship === true ? 1 : matchResult.triageFields.visa_sponsorship === false ? 0 : null,
        jobId
      ).run()

      // Rejected — done
      if (matchResult.track === 'rejected') {
        message.ack()
        continue
      }

      // 6. Generate tailored resume PDF
      let resumeUrl = ''
      let resumeR2Key = ''
      try {
        const bullets = await rewriteResumeBullets(env, profile, job.description)
        const resumeResult = await generateTailoredResume(env, {
          firstName:   profile.firstName,
          lastName:    profile.lastName,
          email:       profile.email,
          phone:       profile.phone || '',
          location:    profile.location || '',
          linkedinUrl: profile.linkedinUrl || '',
          githubUrl:   profile.githubUrl || '',
          summary:     profile.summary || '',
          bullets,
          skills:      profile.skills || [],
          experience:  profile.experience || [],
          education:   profile.education || [],
        }, jobId, userId)
        resumeUrl   = resumeResult.publicUrl
        resumeR2Key = resumeResult.r2Key
      } catch (err) {
        await writeDeadLetter(env, 'application', jobId, userId,
          'PDF_GENERATION_FAILED',
          err instanceof Error ? err.message : String(err),
          { jobId })
      }

      // 7. Route to ATS executor
      if (atsType !== 'unknown' && atsType !== 'workday_skip' &&
          atsType !== 'icims_skip' && atsType !== 'taleo_skip' &&
          atsType !== 'sap_skip' && boardToken && atsJobId) {
        await routeApplication(
          env, jobId, userId, profile,
          atsType as any, boardToken, atsJobId,
          '',
          matchResult.track,
          matchResult.matchScore,
          resumeUrl || undefined,
          resumeR2Key || undefined
        )
      }

      // 8. Sniper track — cold email outreach
      if (matchResult.track === 'sniper' && resumeUrl) {
        const application = await env.DB.prepare(
          'SELECT id FROM applications WHERE user_id = ? AND job_id = ?'
        ).bind(userId, jobId).first<{ id: string }>()

        if (application) {
          await runSniperOutreach(
            env,
            { id: application.id } as any,
            {
              id: job.id, title: job.title, company: job.company,
              companyDomain: job.company_domain, description: job.description,
              applyUrl: job.apply_url,
            } as any,
            profile,
            resumeUrl
          )
        }
      }

      message.ack()
    } catch (err) {
      await writeDeadLetter(
        env, 'match', jobId, userId,
        'MATCH_PIPELINE_ERROR',
        err instanceof Error ? err.message : String(err),
        { jobId }
      )
      message.ack()
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function loadUserProfile(env: Env, userId: string): Promise<UserProfile | null> {
  const r = await env.DB.prepare(`
    SELECT u.id as userId, u.email, u.first_name, u.last_name, u.plan,
           p.phone, p.location, p.linkedin_url, p.github_url, p.portfolio_url,
           p.personal_email, p.current_title, p.years_experience, p.summary,
           p.skills, p.experience, p.education, p.achievements,
           p.target_roles, p.target_locations, p.remote_only, p.min_salary,
           p.visa_required, p.cached_answers, p.profile_embedding
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.id = ?
  `).bind(userId).first() as any

  if (!r) return null

  const safeJson = (v: any, fb: any) => { try { return v ? JSON.parse(v) : fb } catch { return fb } }

  return {
    id: r.userId, userId: r.userId,
    firstName: r.first_name, lastName: r.last_name,
    email: r.email, plan: r.plan,
    phone: r.phone, location: r.location,
    linkedinUrl: r.linkedin_url, githubUrl: r.github_url,
    portfolioUrl: r.portfolio_url, personalEmail: r.personal_email,
    currentTitle: r.current_title, yearsExperience: r.years_experience,
    summary: r.summary,
    skills:       safeJson(r.skills, []),
    experience:   safeJson(r.experience, []),
    education:    safeJson(r.education, []),
    achievements: safeJson(r.achievements, []),
    targetRoles:      safeJson(r.target_roles, []),
    targetLocations:  safeJson(r.target_locations, []),
    remoteOnly: !!r.remote_only, minSalary: r.min_salary,
    visaRequired: !!r.visa_required,
    cachedAnswers:    safeJson(r.cached_answers, {}),
    profileEmbedding: r.profile_embedding,
  }
}

function extractATSTokens(
  applyUrl: string,
  atsType: string
): { boardToken: string | null; jobId: string | null } {
  try {
    const url = new URL(applyUrl)

    if (atsType === 'greenhouse') {
      const pathParts = url.pathname.split('/').filter(Boolean)
      if (pathParts.length >= 3 && pathParts.includes('jobs')) {
        const jobsIndex = pathParts.indexOf('jobs')
        return { boardToken: pathParts[jobsIndex - 1] || null, jobId: pathParts[jobsIndex + 1] || null }
      }
    }
    if (atsType === 'lever') {
      const pathParts = url.pathname.split('/').filter(Boolean)
      if (pathParts.length >= 2) return { boardToken: pathParts[0] || null, jobId: pathParts[1] || null }
    }
    if (atsType === 'ashby') {
      const pathParts = url.pathname.split('/').filter(Boolean)
      if (pathParts.length >= 2) return { boardToken: pathParts[0] || null, jobId: pathParts[1] || null }
    }
  } catch { /* URL parsing failed */ }

  return { boardToken: null, jobId: null }
}

function extractDomain(companyName: string): string | null {
  if (!companyName) return null
  const clean = companyName.toLowerCase().replace(/[^a-z0-9]/g, '')
  return clean ? `${clean}.com` : null
}
