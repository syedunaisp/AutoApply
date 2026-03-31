// Main Worker Entry Point
// Handles: Cron Triggers, HTTP API for Dashboard, Queue Consumer
// Ties together all phases of the AutoApply pipeline

import type { Env, UserProfile, RawScrapedJob } from '@autoapply/types'
import { runScraper } from './agents/sourcer'
import { matchJob, storeJobEmbedding } from './agents/matchmaker'
import { routeApplication, detectATS } from './executors/apply'
import { rewriteResumeBullets } from './core/llm'
import { generateTailoredResume } from './core/pdf-generator'
import { runSniperOutreach } from './agents/networker'
import { writeDeadLetter } from './utils/dead-letter'
import { handleQueueBatch, handleMatchBatch } from './queues/job-processor'
import { addToSuppression } from './utils/suppression'

export default {
  // ─── Cron Trigger — runs daily at 08:00 UTC ────────────────────────
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const users = await getActiveUsers(env)

    for (const user of users) {
      ctx.waitUntil(runPipelineForUser(user, env))
    }
  },

  // ─── HTTP API — serves the Next.js dashboard ──────────────────────
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // CORS headers for Next.js dashboard
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    try {
      let response: Response

      // API Routes
      if (path === '/api/health') {
        response = json({ status: 'ok', timestamp: new Date().toISOString() })
      }
      // Dashboard data
      else if (path === '/api/applications' && request.method === 'GET') {
        response = await handleGetApplications(env, url)
      }
      else if (path === '/api/failures' && request.method === 'GET') {
        response = await handleGetFailures(env, url)
      }
      else if (path === '/api/failures/resolve' && request.method === 'POST') {
        response = await handleResolveFailure(env, request)
      }
      else if (path === '/api/scrape-runs' && request.method === 'GET') {
        response = await handleGetScrapeRuns(env, url)
      }
      else if (path === '/api/profile' && request.method === 'GET') {
        response = await handleGetProfile(env, url)
      }
      else if (path === '/api/profile' && request.method === 'PUT') {
        response = await handleUpdateProfile(env, request)
      }
      else if (path === '/api/stats' && request.method === 'GET') {
        response = await handleGetStats(env, url)
      }
      // Scraper push endpoint — called by VPS cron after scraping
      else if (path === '/ingest-jobs' && request.method === 'POST') {
        const ingestKey = request.headers.get('x-ingest-key')
        if (!ingestKey || ingestKey !== env.WORKER_INGEST_KEY) {
          response = new Response('Unauthorized', { status: 401 })
        } else {
          response = await handleIngestJobs(env, request)
        }
      }
      // Resend Bounce/Complaint Webhook
      // Configure in Resend dashboard: email.bounced, email.complained
      else if (path === '/webhooks/resend') {
        if (request.method !== 'POST') {
          response = new Response('Method not allowed', { status: 405 })
        } else {
          response = await handleResendWebhook(env, request)
        }
      }
      else {
        response = json({ error: 'Not found' }, 404)
      }

      // Add CORS headers to all responses
      const headers = new Headers(response.headers)
      Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v))
      return new Response(response.body, { status: response.status, headers })
    } catch (err) {
      console.error('API error:', err)
      return json({ error: 'Internal server error' }, 500)
    }
  },

  // ─── Queue Consumer ────────────────────────────────────────────────
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    if (batch.queue === 'match-queue') {
      await handleMatchBatch(batch as any, env)
    } else {
      await handleQueueBatch(batch as any, env)
    }
  },
}

// ─── Pipeline Orchestration ──────────────────────────────────────────────

async function runPipelineForUser(user: UserProfile, env: Env): Promise<void> {
  try {
    // Step 1: Source jobs for each target role
    const allJobs: RawScrapedJob[] = []
    for (const role of user.targetRoles || []) {
      const location = (user.targetLocations || ['United States'])[0]
      const jobs = await runScraper(env, role, location)
      allJobs.push(...jobs)
    }

    // Step 2: Enqueue each job for processing via CF Queue
    // This avoids D1 burst limits by processing sequentially
    for (const job of allJobs) {
      await (env.JOB_QUEUE as any).send({
        type: 'process_job',
        userId: user.userId,
        job,
      })
    }
  } catch (err) {
    await writeDeadLetter(env, 'scrape', null, user.userId,
      'PIPELINE_ERROR', err instanceof Error ? err.message : String(err))
  }
}

async function getActiveUsers(env: Env): Promise<UserProfile[]> {
  const rows = await env.DB.prepare(`
    SELECT u.id as userId, u.email, u.first_name, u.last_name, u.plan,
           p.phone, p.location, p.linkedin_url, p.github_url, p.portfolio_url,
           p.personal_email, p.current_title, p.years_experience, p.summary,
           p.skills, p.experience, p.education, p.achievements,
           p.target_roles, p.target_locations, p.remote_only, p.min_salary,
           p.visa_required, p.cached_answers, p.profile_embedding
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    WHERE u.active = 1
  `).all()

  return (rows.results || []).map((r: any) => ({
    id: r.userId,
    userId: r.userId,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    plan: r.plan,
    phone: r.phone,
    location: r.location,
    linkedinUrl: r.linkedin_url,
    githubUrl: r.github_url,
    portfolioUrl: r.portfolio_url,
    personalEmail: r.personal_email,
    currentTitle: r.current_title,
    yearsExperience: r.years_experience,
    summary: r.summary,
    skills: safeJsonParse(r.skills, []),
    experience: safeJsonParse(r.experience, []),
    education: safeJsonParse(r.education, []),
    achievements: safeJsonParse(r.achievements, []),
    targetRoles: safeJsonParse(r.target_roles, []),
    targetLocations: safeJsonParse(r.target_locations, []),
    remoteOnly: !!r.remote_only,
    minSalary: r.min_salary,
    visaRequired: !!r.visa_required,
    cachedAnswers: safeJsonParse(r.cached_answers, {}),
    profileEmbedding: r.profile_embedding,
  }))
}

// ─── API Handlers ────────────────────────────────────────────────────────

async function handleGetApplications(env: Env, url: URL): Promise<Response> {
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '20')
  const status = url.searchParams.get('status')
  const offset = (page - 1) * limit

  let query = `
    SELECT a.*, j.title as job_title, j.company as job_company, j.ats
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
  `
  const params: any[] = []

  if (status) {
    query += ' WHERE a.ats_status = ?'
    params.push(status)
  }

  query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const rows = await env.DB.prepare(query).bind(...params).all()

  // Get total count
  let countQuery = 'SELECT COUNT(*) as total FROM applications'
  if (status) countQuery += ' WHERE ats_status = ?'
  const countResult = await env.DB.prepare(countQuery)
    .bind(...(status ? [status] : []))
    .first<{ total: number }>()

  return json({
    data: rows.results,
    total: countResult?.total || 0,
    page,
    limit,
  })
}

async function handleGetFailures(env: Env, url: URL): Promise<Response> {
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = parseInt(url.searchParams.get('limit') || '20')
  const resolved = url.searchParams.get('resolved')
  const offset = (page - 1) * limit

  let query = 'SELECT * FROM failed_jobs'
  const params: any[] = []

  if (resolved !== null) {
    query += ' WHERE resolved = ?'
    params.push(resolved === 'true' ? 1 : 0)
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const rows = await env.DB.prepare(query).bind(...params).all()
  return json({ data: rows.results, page, limit })
}

async function handleResolveFailure(env: Env, request: Request): Promise<Response> {
  const body = await request.json() as { id: string; note?: string }
  await env.DB.prepare(
    'UPDATE failed_jobs SET resolved = 1, resolved_note = ? WHERE id = ?'
  ).bind(body.note || null, body.id).run()
  return json({ success: true })
}

async function handleGetScrapeRuns(env: Env, url: URL): Promise<Response> {
  const limit = parseInt(url.searchParams.get('limit') || '50')
  const rows = await env.DB.prepare(
    'SELECT * FROM scrape_runs ORDER BY run_at DESC LIMIT ?'
  ).bind(limit).all()
  return json({ data: rows.results })
}

async function handleGetProfile(env: Env, url: URL): Promise<Response> {
  const userId = url.searchParams.get('userId')
  if (!userId) return json({ error: 'userId required' }, 400)

  const profile = await env.DB.prepare(
    'SELECT * FROM profiles WHERE user_id = ?'
  ).bind(userId).first()

  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(userId).first()

  return json({ user, profile })
}

async function handleUpdateProfile(env: Env, request: Request): Promise<Response> {
  const body = await request.json() as any
  const userId = body.userId
  if (!userId) return json({ error: 'userId required' }, 400)

  await env.DB.prepare(`
    UPDATE profiles SET
      phone = ?, location = ?, linkedin_url = ?, github_url = ?, portfolio_url = ?,
      personal_email = ?, current_title = ?, years_experience = ?, summary = ?,
      skills = ?, experience = ?, education = ?, achievements = ?,
      target_roles = ?, target_locations = ?, remote_only = ?, min_salary = ?,
      visa_required = ?, cached_answers = ?, updated_at = ?
    WHERE user_id = ?
  `).bind(
    body.phone, body.location, body.linkedinUrl, body.githubUrl, body.portfolioUrl,
    body.personalEmail, body.currentTitle, body.yearsExperience, body.summary,
    JSON.stringify(body.skills || []), JSON.stringify(body.experience || []),
    JSON.stringify(body.education || []), JSON.stringify(body.achievements || []),
    JSON.stringify(body.targetRoles || []), JSON.stringify(body.targetLocations || []),
    body.remoteOnly ? 1 : 0, body.minSalary,
    body.visaRequired ? 1 : 0, JSON.stringify(body.cachedAnswers || {}),
    Math.floor(Date.now() / 1000),
    userId
  ).run()

  return json({ success: true })
}

async function handleGetStats(env: Env, url: URL): Promise<Response> {
  const userId = url.searchParams.get('userId')

  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayTs = Math.floor(todayStart.getTime() / 1000)

  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60)

  // Today's stats
  const todayApps = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM applications WHERE created_at >= ?'
  ).bind(todayTs).first<{ count: number }>()

  const todayEmails = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM outreach_events WHERE channel = \'email\' AND sent_at >= ?'
  ).bind(todayTs).first<{ count: number }>()

  // 30-day stats
  const monthApps = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM applications WHERE created_at >= ?'
  ).bind(thirtyDaysAgo).first<{ count: number }>()

  const monthEmails = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM outreach_events WHERE channel = \'email\' AND created_at >= ?'
  ).bind(thirtyDaysAgo).first<{ count: number }>()

  const failedCount = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM failed_jobs WHERE resolved = 0'
  ).first<{ count: number }>()

  const jobsFound = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM jobs WHERE scraped_at >= ?'
  ).bind(todayTs).first<{ count: number }>()

  return json({
    today: {
      jobsFound: jobsFound?.count || 0,
      applications: todayApps?.count || 0,
      emailsSent: todayEmails?.count || 0,
    },
    last30Days: {
      applications: monthApps?.count || 0,
      emailsSent: monthEmails?.count || 0,
    },
    unresolvedFailures: failedCount?.count || 0,
  })
}

// ─── Scraper Ingest Handler ───────────────────────────────────────────────

async function handleIngestJobs(env: Env, request: Request): Promise<Response> {
  const body = await request.json() as {
    keywords: string
    location: string
    jobs: any[]
  }

  if (!Array.isArray(body.jobs) || body.jobs.length === 0) {
    return json({ accepted: 0 })
  }

  // Log the scrape run to D1
  await env.DB.prepare(`
    INSERT INTO scrape_runs (id, search_keywords, search_location, source, result_count, status, run_at)
    VALUES (?, ?, ?, 'jobspy', ?, 'success', ?)
  `).bind(
    crypto.randomUUID(),
    body.keywords,
    body.location,
    body.jobs.length,
    Math.floor(Date.now() / 1000)
  ).run()

  // Enqueue every job for processing — queue consumer handles dedup + D1 write
  // Get all active users to fan out jobs to each user
  const users = await getActiveUsers(env)
  let enqueued = 0

  for (const user of users) {
    for (const job of body.jobs) {
      await (env.JOB_QUEUE as any).send({
        type: 'process_job',
        userId: user.userId,
        job,
      })
      enqueued++
    }
  }

  return json({ accepted: body.jobs.length, enqueued, users: users.length })
}

// ─── Resend Bounce/Complaint Webhook ─────────────────────────────────────
// Register at https://resend.com/webhooks with events: email.bounced, email.complained

async function handleResendWebhook(env: Env, request: Request): Promise<Response> {
  const payload = await request.json() as {
    type: string   // 'email.bounced' | 'email.complained' | 'email.delivered'
    data: {
      email_id: string
      to:       string[]
      from:     string
    }
  }

  const recipientEmail = payload.data.to?.[0]
  const messageId      = payload.data.email_id

  if (payload.type === 'email.bounced') {
    // Update outreach_events status
    await env.DB.prepare(`
      UPDATE outreach_events
      SET status = 'bounced'
      WHERE ses_message_id = ?
    `).bind(messageId).run()

    // Look up user_id from the event so we can scope the suppression to this_user
    const event = await env.DB.prepare(`
      SELECT user_id FROM outreach_events
      WHERE ses_message_id = ?
    `).bind(messageId).first<{ user_id: string }>()

    if (event && recipientEmail) {
      const domain = recipientEmail.split('@')[1] || ''
      await addToSuppression(env, event.user_id, recipientEmail, domain, 'bounce', 'this_user')
    }
  }

  if (payload.type === 'email.complained') {
    // Complaint = suppress for ALL users to protect shared sending domain reputation
    await env.DB.prepare(`
      UPDATE outreach_events
      SET status = 'complained'
      WHERE ses_message_id = ?
    `).bind(messageId).run()

    if (recipientEmail) {
      const domain = recipientEmail.split('@')[1] || ''
      await addToSuppression(env, null, recipientEmail, domain, 'complaint', 'all_users')
    }

    // Alert admin — complaint is serious for domain reputation
    await writeDeadLetter(
      env, 'email', null, null,
      'RESEND_COMPLAINT',
      `Spam complaint received from ${recipientEmail}`,
      payload
    )
  }

  return new Response('ok', { status: 200 })
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}
