// Networker agent — full cold email outreach flow
// This is the most complex agent: 9-step pipeline per the master spec
// 1. Idempotency check
// 2. Apollo lookup (cached)
// 3. ZeroBounce validation (MANDATORY — Rule 6)
// 4. Suppression list check
// 5. Per-user daily cap (max 25/day — Rule 7)
// 6. LLM email generation
// 7. FROM address determination
// 8. Send via Resend API
// 9. Log to D1

import type { Env, UserProfile, Job, Application, ApolloContact, EmailContent, EmailSendParams, EmailSendResult } from '@autoapply/types'
import { writeDeadLetter } from '../utils/dead-letter'
import { hasOutreachBeenSent } from '../utils/idempotency'
import { validateEmail } from './email-validator'
import { checkSuppression, getDailyEmailCount } from '../utils/suppression'
import { callLLM } from '../core/llm'

/**
 * Run the full Sniper outreach flow for a high-match application.
 * Follows the exact 9-step pipeline specified in the master prompt.
 */
export async function runSniperOutreach(
  env: Env,
  application: Application,
  job: Job,
  profile: UserProfile,
  resumeUrl: string
): Promise<{ channel?: string; success?: boolean; skipped?: boolean; reason?: string }> {

  // ── Step 1: Check idempotency — never process the same application twice ──
  const existing = await hasOutreachBeenSent(env, profile.userId, application.id, 'email')
  if (existing) return { skipped: true, reason: 'already_processed' }

  // ── Step 2: Apollo lookup (with caching — NEVER pay twice for same company) ──
  const contact = await getOrFetchApolloContact(env, profile.userId, job.companyDomain || '')

  if (!contact?.email) {
    // No email found — queue LinkedIn DM instead
    await queueLinkedInDM(env, application, job, profile, contact)
    return { channel: 'linkedin_dm', reason: 'no_email_found' }
  }

  // ── Step 3: ZeroBounce validation — MANDATORY, never skip (Rule 6) ──
  const bounceStatus = await validateEmail(env, contact.email)

  if (bounceStatus === 'invalid' || bounceStatus === 'unknown') {
    await queueLinkedInDM(env, application, job, profile, contact)
    return { channel: 'linkedin_dm', reason: `email_${bounceStatus}` }
  }

  // ── Step 4: Check suppression list ──
  const suppressed = await checkSuppression(env, profile.userId, contact.email, job.companyDomain || '')
  if (suppressed) {
    return { skipped: true, reason: 'suppressed' }
  }

  // ── Step 5: Per-user daily sending limit (max 25/day — Rule 7) ──
  const todayCount = await getDailyEmailCount(env, profile.userId)
  if (todayCount >= 25) {
    return { skipped: true, reason: 'daily_limit_reached' }
  }

  // ── Step 6: Generate email content with LLM ──
  const emailContent = await generateColdEmail(env, profile, job, contact, resumeUrl)

  // ── Step 7: Build FROM address using verified Resend domain ──
  // Basic tier: firstname.lastname@<SENDING_DOMAIN>
  // Reply-To is always the applicant's real personal email
  // Hiring manager replies go directly to the applicant — we never see them
  const sanitize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, '')

  const fromAddress = `${sanitize(profile.firstName)}.${sanitize(profile.lastName)}@${env.SENDING_DOMAIN}`
  const replyTo     = profile.personalEmail

  // ── Step 8: Send via Resend API ──
  const resendResult = await sendViaResend(env, {
    from:    fromAddress,
    replyTo: replyTo,             // Replies go directly to the applicant
    to:      contact.email,
    subject: emailContent.subject,
    html:    emailContent.html,
    text:    emailContent.text,
    metadata: { userId: profile.userId, jobId: job.id, applicationId: application.id },
  })

  // ── Step 9: Log to D1 — always, success or failure (Rule 3) ──
  await env.DB.prepare(`
    INSERT INTO outreach_events
    (id, user_id, application_id, channel, recipient_email, recipient_name, recipient_title,
     from_address, subject, body_text, status, ses_message_id, sent_at, created_at)
    VALUES (?, ?, ?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), profile.userId, application.id,
    contact.email, contact.name || null, contact.title || null,
    fromAddress,
    emailContent.subject, emailContent.text,
    resendResult.success ? 'sent' : 'failed',
    resendResult.messageId || null,
    resendResult.success ? Math.floor(Date.now() / 1000) : null,
    Math.floor(Date.now() / 1000)
  ).run()

  return { channel: 'email', success: resendResult.success }
}

// ─── Apollo Contact Lookup (with D1 caching) ─────────────────────────────

async function getOrFetchApolloContact(
  env: Env,
  userId: string,
  companyDomain: string
): Promise<ApolloContact | null> {
  if (!companyDomain) return null

  // Check cache first — NEVER call Apollo twice for same company per user
  const cached = await env.DB.prepare(
    'SELECT contact_name, contact_title, contact_email FROM apollo_lookups WHERE user_id = ? AND company_domain = ?'
  ).bind(userId, companyDomain).first<{
    contact_name: string | null
    contact_title: string | null
    contact_email: string | null
  }>()

  if (cached) {
    return {
      name: cached.contact_name || undefined,
      title: cached.contact_title || undefined,
      email: cached.contact_email || undefined,
      companyDomain,
    }
  }

  // Fetch from Apollo
  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({
        api_key: env.APOLLO_API_KEY,
        q_organization_domains: companyDomain,
        person_titles: ['Engineering Manager', 'VP Engineering', 'CTO', 'Director of Engineering', 'Head of Engineering'],
        page: 1,
        per_page: 1,
      }),
    })

    if (!res.ok) {
      await writeDeadLetter(env, 'apollo', null, userId,
        'APOLLO_HTTP_ERROR', `Apollo returned ${res.status}`,
        { companyDomain })
      // Cache the miss so we don't retry
      await cacheApolloResult(env, userId, companyDomain, null, null, null)
      return null
    }

    const data = await res.json() as { people?: Array<{ name: string; title: string; email: string }> }
    const person = data.people?.[0]

    // Cache the result — even if null
    await cacheApolloResult(
      env, userId, companyDomain,
      person?.name || null,
      person?.title || null,
      person?.email || null
    )

    if (!person) return null

    return {
      name: person.name,
      title: person.title,
      email: person.email,
      companyDomain,
    }
  } catch (err) {
    await writeDeadLetter(env, 'apollo', null, userId,
      'APOLLO_NETWORK_ERROR',
      err instanceof Error ? err.message : String(err),
      { companyDomain })
    return null
  }
}

async function cacheApolloResult(
  env: Env,
  userId: string,
  companyDomain: string,
  name: string | null,
  title: string | null,
  email: string | null
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO apollo_lookups (id, user_id, company_domain, contact_name, contact_title, contact_email, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(), userId, companyDomain,
    name, title, email,
    Math.floor(Date.now() / 1000)
  ).run()
}

// ─── Cold Email Generation ───────────────────────────────────────────────

async function generateColdEmail(
  env: Env,
  profile: UserProfile,
  job: Job,
  contact: ApolloContact,
  resumeUrl: string
): Promise<EmailContent> {
  const prompt = `
Write a cold email from a job applicant to a hiring manager. 

APPLICANT PROFILE:
Name: ${profile.firstName} ${profile.lastName}
Current Title: ${profile.currentTitle}
Years Experience: ${profile.yearsExperience}
Key Achievements: ${JSON.stringify(profile.achievements)}
Skills: ${JSON.stringify(profile.skills)}

RECIPIENT:
Name: ${contact.name}
Title: ${contact.title}
Company: ${job.company}

JOB DETAILS:
Title: ${job.title}
Description excerpt: ${job.description.substring(0, 800)}

RESUME LINK: ${resumeUrl}

STRICT RULES — violations will cause this email to be deleted:
1. Maximum 5 sentences in the body. No exceptions.
2. The first sentence MUST reference something specific from the job description or company — not a generic opener
3. NEVER use these phrases: "I am writing to express", "I am passionate about", "I believe I would be a great fit", "Please find attached", "I am reaching out"
4. Write in first person, casual-professional tone — like a human who spent 5 minutes reading the JD
5. Include exactly one specific metric or achievement from the applicant's profile
6. End with a low-friction CTA: "Happy to jump on a call if it's worth 20 minutes" or similar
7. The resume link should be on its own line at the end, preceded by "Resume:"
8. NEVER mention AI, automation, or that this is a system-generated email
9. Subject line: max 8 words, reference something specific about the role

Return JSON: { "subject": string, "text": string, "html": string }
The html field should be the text wrapped in minimal HTML — no fancy styling.
`

  const raw = await callLLM(env, '', prompt, 'medium', true)
  try {
    return JSON.parse(raw) as EmailContent
  } catch {
    // Retry once
    const retry = await callLLM(env, 'Return ONLY valid JSON.', prompt, 'medium', true)
    return JSON.parse(retry) as EmailContent
  }
}

// ─── Resend Integration ──────────────────────────────────────────────────

async function sendViaResend(
  env: Env,
  params: EmailSendParams
): Promise<EmailSendResult> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:      params.from,
      reply_to:  params.replyTo,
      to:        [params.to],
      subject:   params.subject,
      html:      params.html,
      text:      params.text,
    }),
  })

  if (!res.ok) {
    const errorText = await res.text()
    await writeDeadLetter(
      env,
      'email',
      params.metadata.applicationId,
      params.metadata.userId,
      'RESEND_SEND_FAILED',
      `Resend API returned ${res.status}: ${errorText}`,
      params
    )
    return { success: false }
  }

  const data = await res.json() as { id: string }
  return { success: true, messageId: data.id }
}

// ─── LinkedIn DM Queue Fallback ──────────────────────────────────────────

async function queueLinkedInDM(
  env: Env,
  application: Application,
  job: Job,
  profile: UserProfile,
  contact: ApolloContact | null
): Promise<void> {
  // Generate a short DM message (max 3 sentences per LinkedIn DM rules)
  const dmPrompt = `Write a LinkedIn DM from a job applicant to a hiring manager. Maximum 3 sentences. 
Recipient: ${contact?.name || 'Hiring Manager'} at ${job.company} for the ${job.title} role.
Applicant: ${profile.firstName} ${profile.lastName}, ${profile.currentTitle}.
Do NOT include any links. Reference something specific from the role.
Return just the message text, no JSON.`

  const messageText = await callLLM(env, '', dmPrompt, 'low', false)

  await env.DB.prepare(`
    INSERT INTO linkedin_dm_queue 
    (id, user_id, application_id, linkedin_profile_url, recipient_name, message_text, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', ?)
  `).bind(
    crypto.randomUUID(),
    profile.userId,
    application.id,
    contact?.linkedinUrl || '',
    contact?.name || 'Hiring Manager',
    messageText,
    Math.floor(Date.now() / 1000)
  ).run()

  // Also log as outreach event
  await env.DB.prepare(`
    INSERT INTO outreach_events 
    (id, user_id, application_id, channel, recipient_name, status, created_at)
    VALUES (?, ?, ?, 'linkedin_dm', ?, 'queued', ?)
  `).bind(
    crypto.randomUUID(),
    profile.userId,
    application.id,
    contact?.name || 'Hiring Manager',
    Math.floor(Date.now() / 1000)
  ).run()
}
