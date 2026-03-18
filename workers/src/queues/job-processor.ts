// Queue consumer — processes jobs sequentially to avoid D1 burst limits
// D1 has no connection pooling, so we process with controlled concurrency via CF Queues

import type { Env, RawScrapedJob } from '@autoapply/types'
import { writeDeadLetter } from '../utils/dead-letter'
import { hasJobBeenProcessed } from '../utils/idempotency'
import { detectATS } from '../executors/apply'

interface QueueMessage {
  type: 'process_job'
  userId: string
  job: RawScrapedJob
}

/**
 * Cloudflare Queue consumer — processes scraped jobs one at a time.
 * Flow: dedup → save → detect ATS → enrich → (matching happens in pipeline)
 */
export async function handleQueueBatch(
  batch: MessageBatch<QueueMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    const { userId, job } = message.body

    try {
      // 1. Check idempotency — have we seen this job before?
      if (job.external_id) {
        const exists = await hasJobBeenProcessed(env, userId, job.external_id)
        if (exists) {
          message.ack()
          continue
        }
      }

      // 2. Detect ATS from apply URL
      const atsType = detectATS(job.apply_url)

      // 3. Extract ATS tokens from URL
      const { boardToken, jobId: atsJobId } = extractATSTokens(job.apply_url, atsType)

      // 4. Save raw job to D1
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
        extractDomain(job.company), // best-effort domain extraction
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

      message.ack()
    } catch (err) {
      console.error('Queue processing error:', err)
      await writeDeadLetter(
        env, 'match', job.external_id, userId,
        'QUEUE_PROCESS_ERROR',
        err instanceof Error ? err.message : String(err),
        { job }
      )
      // Ack even on failure to prevent infinite retry loops
      message.ack()
    }
  }
}

/**
 * Extract ATS board token and job ID from the apply URL.
 */
function extractATSTokens(
  applyUrl: string,
  atsType: string
): { boardToken: string | null; jobId: string | null } {
  try {
    const url = new URL(applyUrl)

    if (atsType === 'greenhouse') {
      // URL pattern: https://boards.greenhouse.io/{board_token}/jobs/{job_id}
      // or: https://job-boards.greenhouse.io/...
      const pathParts = url.pathname.split('/').filter(Boolean)
      if (pathParts.length >= 3 && pathParts.includes('jobs')) {
        const jobsIndex = pathParts.indexOf('jobs')
        return {
          boardToken: pathParts[jobsIndex - 1] || null,
          jobId: pathParts[jobsIndex + 1] || null,
        }
      }
    }

    if (atsType === 'lever') {
      // URL pattern: https://jobs.lever.co/{company_slug}/{posting_id}
      const pathParts = url.pathname.split('/').filter(Boolean)
      if (pathParts.length >= 2) {
        return {
          boardToken: pathParts[0] || null,
          jobId: pathParts[1] || null,
        }
      }
    }

    if (atsType === 'ashby') {
      // URL pattern: https://jobs.ashbyhq.com/{company}/{job_id}
      const pathParts = url.pathname.split('/').filter(Boolean)
      if (pathParts.length >= 2) {
        return {
          boardToken: pathParts[0] || null,
          jobId: pathParts[1] || null,
        }
      }
    }
  } catch {
    // URL parsing failed
  }

  return { boardToken: null, jobId: null }
}

/**
 * Best-effort extraction of company domain from company name.
 * In production, this would use a domain lookup service.
 */
function extractDomain(companyName: string): string | null {
  if (!companyName) return null
  // Simple heuristic: lowercase, remove spaces, append .com
  const clean = companyName.toLowerCase().replace(/[^a-z0-9]/g, '')
  return clean ? `${clean}.com` : null
}
