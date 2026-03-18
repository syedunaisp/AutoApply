# Technical Specification
# AutoApply — Full System Architecture
**Version:** 1.0  
**For:** Engineering / AI Coding Agent  
**Assumes:** PRD.md has been read first

---

## 1. Technology Stack — Definitive List

| Component | Technology | Notes |
|---|---|---|
| Frontend / Dashboard | Next.js 14 (App Router) + TailwindCSS | Deploy on Cloudflare Pages |
| Backend Orchestrator | Cloudflare Workers (TypeScript) | Cron Triggers for scheduled jobs |
| Relational Database | Cloudflare D1 + Drizzle ORM | SQLite under the hood. Add Cloudflare Queues for burst protection |
| Vector Storage | Cloudflare Vectorize | Semantic job matching |
| Object Storage | Cloudflare R2 | PDF resume storage. Public bucket. |
| AI / LLM | `@cf/openai/gpt-oss-120b` via Cloudflare Workers AI | 128k context, $0.35/M input, $0.75/M output. Use for all LLM tasks. |
| Job Sourcing — Primary | JSearch API (RapidAPI) | Aggregates LinkedIn + Indeed + Glassdoor |
| Job Sourcing — Secondary | Greenhouse + Lever public JSON boards | For known target companies |
| Job Sourcing — Fallback | Custom Python `jobspy` scraper on VPS | $5/month Hetzner/DigitalOcean droplet |
| ATS Submission | Greenhouse API + Lever API + Ashby API | All free, no auth required for applicant-facing APIs |
| People Data | Apollo.io API | Finds EM / VP Eng email addresses |
| Email Validation | ZeroBounce API | Validates Apollo emails before any send |
| Cold Email Sending | AWS SES (existing infrastructure) | Already warmed. Worker POSTs to AWS API Gateway → Lambda → SES |
| LinkedIn DM Fallback | PhantomBuster | When no valid email found. Manual queue. |
| PDF Generation | `pdf-lib` NPM package | Text injection into pre-rendered R2 template only |
| Monorepo | NPM Workspaces | Shared TypeScript types between web/ and workers/ |

---

## 2. Full Directory Structure

```
autoapply/
├── package.json                          # NPM workspaces root
├── turbo.json                            # Optional: Turborepo config
│
├── web/                                  # Next.js Dashboard
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                  # Redirect to /dashboard
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx              # Overview stats
│   │   │   ├── applications/
│   │   │   │   └── page.tsx              # Applications table
│   │   │   ├── outreach/
│   │   │   │   └── page.tsx              # Cold email log
│   │   │   ├── failures/
│   │   │   │   └── page.tsx              # Dead-letter queue viewer
│   │   │   ├── settings/
│   │   │   │   └── page.tsx              # User profile + preferences
│   │   │   └── onboarding/
│   │   │       └── page.tsx              # Multi-step onboarding
│   │   ├── components/
│   │   │   ├── ApplicationsTable.tsx
│   │   │   ├── OutreachTable.tsx
│   │   │   ├── FailuresTable.tsx
│   │   │   ├── StatsCards.tsx
│   │   │   └── ResumePDFViewer.tsx
│   │   └── lib/
│   │       └── api-client.ts             # Typed HTTP client to Workers API
│   └── next.config.js
│
├── packages/
│   ├── db/
│   │   ├── schema.ts                     # ALL Drizzle table definitions
│   │   └── migrations/                   # D1 migration files
│   └── types/
│       ├── job.ts                        # Canonical Job interface
│       ├── ats.ts                        # Greenhouse/Lever/Ashby payload types
│       ├── outreach.ts                   # Email + LinkedIn event types
│       └── profile.ts                    # User profile interface
│
└── workers/
    ├── wrangler.toml                     # All CF bindings: D1, R2, Vectorize, AI, Queues
    ├── package.json
    └── src/
        ├── index.ts                      # Main entrypoint: HTTP router + Cron handler
        │
        ├── core/
        │   ├── llm.ts                    # Workers AI wrapper for gpt-oss-120b
        │   ├── embeddings.ts             # Workers AI embedding generation
        │   └── pdf-generator.ts          # pdf-lib text injection into R2 template
        │
        ├── agents/
        │   ├── sourcer.ts                # JSearch + Greenhouse/Lever boards + jobspy VPS
        │   ├── matchmaker.ts             # Vectorize cosine sim + LLM structured triage
        │   ├── networker.ts              # Apollo → ZeroBounce → SES or PhantomBuster queue
        │   └── email-validator.ts        # ZeroBounce API client
        │
        ├── executors/
        │   ├── apply.ts                  # Router: detects ATS, dispatches to correct executor
        │   ├── greenhouse.ts             # Greenhouse applicant API: fetch schema + submit
        │   ├── lever.ts                  # Lever postings API: fetch schema + submit
        │   └── ashby.ts                  # Ashby posting API: fetch schema + submit
        │
        ├── queues/
        │   └── job-processor.ts          # Cloudflare Queue consumer for rate-safe D1 writes
        │
        └── utils/
            ├── db-client.ts              # Drizzle D1 connection helper
            ├── dead-letter.ts            # Writes failures to failed_jobs table
            ├── idempotency.ts            # Dedup guard — never double-apply or double-email
            ├── ats-detector.ts           # URL + HTML pattern matching for ATS detection
            └── suppression.ts            # Check/update suppression list
```

---

## 3. Database Schema (Drizzle / D1)

```typescript
// packages/db/schema.ts

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

// ─── USERS ───────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id:               text('id').primaryKey(),            // uuid
  email:            text('email').notNull().unique(),
  personalEmail:    text('personal_email').notNull(),   // reply-to address
  fullName:         text('full_name').notNull(),
  linkedinUrl:      text('linkedin_url'),
  isActive:         integer('is_active').default(1),    // 0 = paused
  tier:             text('tier').default('basic'),      // 'basic' | 'premium'
  createdAt:        text('created_at').notNull(),
})

// ─── USER PROFILE (job search prefs + base resume content) ───────────────
export const profiles = sqliteTable('profiles', {
  id:               text('id').primaryKey(),
  userId:           text('user_id').notNull().references(() => users.id),
  // Search preferences
  targetRoles:      text('target_roles').notNull(),     // JSON array of strings
  targetLocations:  text('target_locations').notNull(), // JSON array
  minSalary:        integer('min_salary'),
  seniorityLevels:  text('seniority_levels').notNull(), // JSON array: ['senior','staff']
  requiresVisa:     integer('requires_visa').default(0),
  remoteOnly:       integer('remote_only').default(0),
  excludedIndustries: text('excluded_industries'),      // JSON array
  excludedCompanies:  text('excluded_companies'),       // JSON array
  // Base resume content (used for LLM tailoring)
  workHistory:      text('work_history').notNull(),     // JSON array of work entries
  skills:           text('skills').notNull(),           // JSON array
  education:        text('education').notNull(),        // JSON
  achievements:     text('achievements'),               // JSON array
  // R2 path to the base PDF template
  resumeTemplateR2Key: text('resume_template_r2_key'),
  // Vectorize embedding ID for this profile
  profileEmbeddingId: text('profile_embedding_id'),
  updatedAt:        text('updated_at').notNull(),
})

// ─── JOBS (raw scraped + normalised) ─────────────────────────────────────
export const jobs = sqliteTable('jobs', {
  id:               text('id').primaryKey(),            // uuid
  externalId:       text('external_id'),                // ID from source (Greenhouse job ID etc)
  source:           text('source').notNull(),           // 'jsearch'|'greenhouse_board'|'lever_board'|'jobspy'
  title:            text('title').notNull(),
  company:          text('company').notNull(),
  companyDomain:    text('company_domain'),             // e.g. 'notion.so'
  location:         text('location'),
  isRemote:         integer('is_remote').default(0),
  salaryMin:        integer('salary_min'),
  salaryMax:        integer('salary_max'),
  description:      text('description').notNull(),      // full raw job description
  applyUrl:         text('apply_url').notNull(),
  atsType:          text('ats_type'),                   // 'greenhouse'|'lever'|'ashby'|'workday_skip'|'unknown'
  atsBoardToken:    text('ats_board_token'),            // company token for ATS API
  atsJobId:         text('ats_job_id'),                 // job ID within ATS
  // Triage results
  matchScore:       real('match_score'),                // 0-100 cosine similarity
  triageStatus:     text('triage_status'),              // 'sniper'|'shotgun'|'rejected'
  triageReason:     text('triage_reason'),              // why rejected if applicable
  // Structured fields extracted by LLM triage
  yoeRequired:      integer('yoe_required'),
  seniority:        text('seniority'),
  visaSponsorship:  integer('visa_sponsorship').default(0),
  hardSkills:       text('hard_skills'),                // JSON array
  scrapedAt:        text('scraped_at').notNull(),
  scrapedForUserId: text('scraped_for_user_id').notNull(),
})

// ─── APPLICATIONS ────────────────────────────────────────────────────────
export const applications = sqliteTable('applications', {
  id:               text('id').primaryKey(),
  userId:           text('user_id').notNull().references(() => users.id),
  jobId:            text('job_id').notNull().references(() => jobs.id),
  atsType:          text('ats_type').notNull(),
  status:           text('status').notNull(),           // 'submitted'|'failed'|'manual_required'|'skipped'
  resumeR2Key:      text('resume_r2_key'),              // path to tailored PDF in R2
  resumePublicUrl:  text('resume_public_url'),          // public R2 URL
  atsResponseCode:  integer('ats_response_code'),
  atsResponseBody:  text('ats_response_body'),
  submittedAt:      text('submitted_at'),
  // Idempotency — never apply to same job twice
  idempotencyKey:   text('idempotency_key').unique(),   // `${userId}:${jobId}`
})

// ─── OUTREACH (cold emails sent) ─────────────────────────────────────────
export const outreach = sqliteTable('outreach', {
  id:               text('id').primaryKey(),
  userId:           text('user_id').notNull().references(() => users.id),
  jobId:            text('job_id').notNull().references(() => jobs.id),
  applicationId:    text('application_id').references(() => applications.id),
  channel:          text('channel').notNull(),          // 'email'|'linkedin_dm'
  recipientEmail:   text('recipient_email'),
  recipientName:    text('recipient_name'),
  recipientTitle:   text('recipient_title'),
  fromAddress:      text('from_address').notNull(),     // the @ourdomain.com address
  replyToAddress:   text('reply_to_address').notNull(), // applicant's personal email
  subject:          text('subject'),
  bodyHtml:         text('body_html'),
  bodyText:         text('body_text'),
  sesMessageId:     text('ses_message_id'),             // AWS SES message ID for tracking
  deliveryStatus:   text('delivery_status'),            // 'sent'|'bounced'|'complained'|'failed'
  apolloEmailSource: text('apollo_email_source'),       // raw Apollo result for audit
  zeroBounceStatus: text('zero_bounce_status'),         // result of validation
  sentAt:           text('sent_at'),
  // Idempotency
  idempotencyKey:   text('idempotency_key').unique(),   // `${userId}:${jobId}:email`
})

// ─── SUPPRESSION LIST ────────────────────────────────────────────────────
export const suppressedCompanies = sqliteTable('suppressed_companies', {
  id:               text('id').primaryKey(),
  userId:           text('user_id').references(() => users.id), // null = global suppression
  companyDomain:    text('company_domain').notNull(),
  companyName:      text('company_name'),
  reason:           text('reason').notNull(),           // 'user_request'|'bounce'|'complaint'|'unsubscribe'
  suppressedAt:     text('suppressed_at').notNull(),
})

// ─── FAILED JOBS (dead-letter queue) ─────────────────────────────────────
export const failedJobs = sqliteTable('failed_jobs', {
  id:               text('id').primaryKey(),
  userId:           text('user_id').references(() => users.id),
  jobId:            text('job_id').references(() => jobs.id),
  action:           text('action').notNull(),           // 'ats_submit'|'email_send'|'apollo_lookup'|'pdf_generate'
  errorCode:        text('error_code'),
  errorMessage:     text('error_message').notNull(),
  errorPayload:     text('error_payload'),              // full JSON of the failed request/response
  humanReason:      text('human_reason'),               // readable summary: 'Workday - manual required'
  isResolved:       integer('is_resolved').default(0),
  failedAt:         text('failed_at').notNull(),
})

// ─── SCRAPE RUN LOGS ──────────────────────────────────────────────────────
export const scrapeRuns = sqliteTable('scrape_runs', {
  id:               text('id').primaryKey(),
  userId:           text('user_id').notNull(),
  source:           text('source').notNull(),
  resultCount:      integer('result_count').notNull(),  // CRITICAL: alert if 0
  durationMs:       integer('duration_ms'),
  status:           text('status').notNull(),           // 'success'|'partial'|'failed'
  errorMessage:     text('error_message'),
  ranAt:            text('ran_at').notNull(),
})
```

---

## 4. Cloudflare Workers Cron Flow

The main daily cron runs at `0 8 * * *` (08:00 UTC).

```typescript
// workers/src/index.ts

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const users = await getActiveUsers(env.DB)
    
    for (const user of users) {
      ctx.waitUntil(runPipelineForUser(user, env))
    }
  },
  
  async fetch(request: Request, env: Env) {
    // REST API for the Next.js dashboard
    return handleApiRequest(request, env)
  }
}

async function runPipelineForUser(user: User, env: Env) {
  // Step 1: Source jobs
  const rawJobs = await sourceJobs(user, env)
  await logScrapeRun(user.id, rawJobs.length, env)
  
  // Step 2: For each job — embed + triage + route
  for (const job of rawJobs) {
    await env.QUEUE.send({ type: 'process_job', userId: user.id, job })
  }
}
```

**Why the Queue?** D1 has no connection pooling. Sending 100 concurrent writes from a cron burst will hit concurrency limits. The Queue processes jobs sequentially with controlled pacing.

```typescript
// workers/src/queues/job-processor.ts

export default {
  async queue(batch: MessageBatch, env: Env) {
    for (const message of batch.messages) {
      const { userId, job } = message.body
      
      try {
        // 1. Check idempotency — have we seen this job before?
        const exists = await checkIdempotency(`${userId}:${job.externalId}`, env)
        if (exists) { message.ack(); continue }
        
        // 2. Save raw job to D1
        await saveJob(job, env)
        
        // 3. Embed + cosine similarity
        const score = await matchJob(job, userId, env)
        
        // 4. LLM structured triage
        const triage = await triageJob(job, userId, env)
        
        // 5. Route
        if (score > 85 && triage.passesFilters) {
          await sniperTrack(job, userId, env)
        } else if (score > 65 && triage.passesFilters) {
          await shotgunTrack(job, userId, env)
        } else {
          await rejectJob(job, userId, triage.reason, env)
        }
        
        message.ack()
      } catch (err) {
        await writeDeadLetter(userId, job, err, env)
        message.ack() // ack even on failure to prevent infinite retry
      }
    }
  }
}
```

---

## 5. LLM Usage Patterns

### 5.1 Model
All LLM calls use `@cf/openai/gpt-oss-120b` via `env.AI.run()`.

```typescript
// workers/src/core/llm.ts

export async function callLLM(env: Env, messages: Message[], jsonMode = false) {
  const response = await env.AI.run('@cf/openai/gpt-oss-120b', {
    messages,
    max_tokens: 2000,
    temperature: 0.3,         // lower temp for structured outputs
    response_format: jsonMode ? { type: 'json_object' } : undefined,
  })
  return response
}
```

### 5.2 Job Triage Prompt
```typescript
export async function triageJob(job: Job, profile: Profile, env: Env) {
  const result = await callLLM(env, [
    {
      role: 'system',
      content: `You are a job triage system. Extract structured information from the job description and determine if the candidate is a good fit based on their hard filters. Return ONLY valid JSON.`
    },
    {
      role: 'user',
      content: `
JOB DESCRIPTION:
${job.description}

CANDIDATE HARD FILTERS:
- Years of experience: ${profile.yearsOfExperience}
- Seniority preference: ${profile.seniorityLevels}
- Requires visa sponsorship: ${profile.requiresVisa}
- Remote only: ${profile.remoteOnly}
- Excluded industries: ${profile.excludedIndustries}

Extract and return this JSON:
{
  "yoe_required": number or null,
  "seniority": "junior"|"mid"|"senior"|"staff"|"principal"|"unknown",
  "visa_sponsorship": boolean,
  "is_remote": boolean,
  "hard_skills": string[],
  "passes_filters": boolean,
  "rejection_reason": string or null
}
      `
    }
  ], true)
  
  return JSON.parse(result.response)
}
```

### 5.3 Resume Bullet Rewriting Prompt
```typescript
export async function rewriteResumeBullets(
  job: Job, 
  profile: Profile, 
  env: Env
): Promise<RewrittenBullets> {
  const result = await callLLM(env, [
    {
      role: 'system',
      content: `You are an expert technical resume writer. Rewrite the candidate's resume bullet points to emphasise experience most relevant to the target job. Keep bullets truthful — only rephrase and reorder, never fabricate experience. Return ONLY valid JSON.`
    },
    {
      role: 'user',
      content: `
TARGET JOB: ${job.title} at ${job.company}
JOB DESCRIPTION: ${job.description}

CANDIDATE WORK HISTORY:
${JSON.stringify(profile.workHistory, null, 2)}

Rewrite each bullet point in the work history to better match this specific job. 
Preserve all factual information. Only change emphasis and phrasing.
Return JSON in the exact same structure as the input work history.
      `
    }
  ], true)
  
  return JSON.parse(result.response)
}
```

### 5.4 Cold Email Generation Prompt
This is the most critical prompt in the system. The output must feel personal, not automated.

```typescript
export async function generateColdEmail(
  job: Job,
  profile: Profile,
  recipient: ApolloContact,
  env: Env
): Promise<EmailContent> {
  const result = await callLLM(env, [
    {
      role: 'system',
      content: `You are a world-class recruiter writing a cold outreach email on behalf of a job candidate. 
      
Rules you must follow:
1. The email must feel like it was written by a human who actually researched the company
2. Reference something SPECIFIC about the company or role in the opening line — not generic flattery
3. Never start with "I am writing to express my interest..."
4. Keep it under 150 words
5. One specific achievement from the candidate that directly maps to this role
6. Clear, low-friction call to action (a quick call, not "please review my application")
7. No attachments mentioned — the resume link is added programmatically after
8. Return ONLY valid JSON`
    },
    {
      role: 'user',
      content: `
RECIPIENT: ${recipient.name}, ${recipient.title} at ${job.company}
JOB ROLE: ${job.title}
JOB DESCRIPTION EXCERPT: ${job.description.substring(0, 1000)}

CANDIDATE NAME: ${profile.fullName}
CANDIDATE CURRENT TITLE: ${profile.currentTitle}
CANDIDATE TOP ACHIEVEMENT: ${profile.achievements[0]}
CANDIDATE KEY SKILLS: ${profile.skills.slice(0, 8).join(', ')}

Write a cold outreach email. Return:
{
  "subject": "string — short, specific, not generic",
  "body_text": "string — plain text version",
  "body_html": "string — HTML version with minimal formatting",
  "specific_hook_used": "string — what specific thing about the company you referenced"
}
      `
    }
  ], true)
  
  return JSON.parse(result.response)
}
```

### 5.5 ATS Custom Questions Answering Prompt
```typescript
export async function answerATSQuestions(
  questions: ATSQuestion[],
  profile: Profile,
  job: Job,
  env: Env
): Promise<ATSAnswer[]> {
  const result = await callLLM(env, [
    {
      role: 'system',
      content: `Answer ATS application questions on behalf of a job candidate. Be truthful based on the candidate profile provided. For yes/no questions about eligibility (work authorisation etc), answer based on the candidate profile. Return ONLY valid JSON array.`
    },
    {
      role: 'user',
      content: `
CANDIDATE PROFILE:
${JSON.stringify(profile, null, 2)}

JOB: ${job.title} at ${job.company}

ATS QUESTIONS:
${JSON.stringify(questions, null, 2)}

Return a JSON array of answers in this format:
[{ "question_id": "...", "answer": "..." }]

For dropdown questions, answer must exactly match one of the provided options.
For text questions, write a genuine, concise answer based on the candidate profile.
      `
    }
  ], true)
  
  return JSON.parse(result.response)
}
```

---

## 6. ATS Executor Specifications

### 6.1 ATS Detection

```typescript
// workers/src/utils/ats-detector.ts

export type ATSType = 'greenhouse' | 'lever' | 'ashby' | 'workday_skip' | 
                      'icims_skip' | 'taleo_skip' | 'unknown'

export function detectATSFromUrl(url: string): ATSType {
  if (url.includes('greenhouse.io') || url.includes('grnh.se'))  return 'greenhouse'
  if (url.includes('lever.co'))                                   return 'lever'
  if (url.includes('ashbyhq.com') || url.includes('ashby.com'))  return 'ashby'
  if (url.includes('myworkdayjobs') || url.includes('workday'))  return 'workday_skip'
  if (url.includes('icims.com'))                                  return 'icims_skip'
  if (url.includes('taleo.net'))                                  return 'taleo_skip'
  return 'unknown'
}

// For unknown — fetch the page and grep
export async function detectATSFromPage(url: string): Promise<ATSType> {
  try {
    const html = await fetch(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JobAgent/1.0)' }
    }).then(r => r.text())
    
    if (html.includes('greenhouse.io') || html.includes('grnh.se')) return 'greenhouse'
    if (html.includes('jobs.lever.co'))                              return 'lever'
    if (html.includes('ashbyhq.com'))                                return 'ashby'
    if (html.includes('myworkdayjobs'))                              return 'workday_skip'
  } catch {
    return 'unknown'
  }
  return 'unknown'
}
```

### 6.2 Greenhouse Executor

```typescript
// workers/src/executors/greenhouse.ts

const BASE = 'https://boards-api.greenhouse.io/v1/boards'

export async function applyGreenhouse(
  job: Job, 
  profile: Profile, 
  resumeBase64: string,
  env: Env
): Promise<ApplicationResult> {
  
  // Step 1: Fetch job schema to get question IDs
  const schemaRes = await fetch(
    `${BASE}/${job.atsBoardToken}/jobs/${job.atsJobId}?questions=true`
  )
  if (!schemaRes.ok) {
    throw new Error(`Greenhouse schema fetch failed: ${schemaRes.status}`)
  }
  const schema = await schemaRes.json()
  
  // Step 2: LLM answers all custom questions
  const answers = await answerATSQuestions(schema.questions, profile, job, env)
  
  // Step 3: Build payload
  const payload = {
    first_name: profile.firstName,
    last_name: profile.lastName,
    email: profile.personalEmail,
    phone: profile.phone,
    resume_content: resumeBase64,
    resume_content_filename: `${profile.firstName}_${profile.lastName}_Resume.pdf`,
    cover_letter_content: '',           // not used — email handles this
    answers: answers.map(a => ({
      question_id: a.question_id,
      answer: a.answer
    }))
  }
  
  // Step 4: Submit
  const submitRes = await fetch(
    `${BASE}/${job.atsBoardToken}/jobs/${job.atsJobId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  )
  
  if (!submitRes.ok) {
    const body = await submitRes.text()
    throw new Error(`Greenhouse submit failed ${submitRes.status}: ${body}`)
  }
  
  return { status: 'submitted', atsType: 'greenhouse', responseCode: submitRes.status }
}
```

### 6.3 Lever Executor

```typescript
// workers/src/executors/lever.ts

const BASE = 'https://api.lever.co/v0/postings'

export async function applyLever(
  job: Job,
  profile: Profile,
  resumeBase64: string,
  env: Env
): Promise<ApplicationResult> {
  
  // Step 1: Fetch posting to get custom fields
  const schemaRes = await fetch(`${BASE}/${job.atsBoardToken}/${job.atsJobId}`)
  if (!schemaRes.ok) throw new Error(`Lever schema fetch failed: ${schemaRes.status}`)
  const schema = await schemaRes.json()
  
  // Step 2: LLM answers custom questions
  const answers = await answerATSQuestions(schema.formFields || [], profile, job, env)
  
  // Step 3: Build multipart form (Lever uses multipart for resume)
  // Note: Lever accepts JSON for most fields but resume must be base64 encoded
  const payload = {
    name: profile.fullName,
    email: profile.personalEmail,
    phone: profile.phone,
    resume: resumeBase64,
    comments: '',
    urls: {
      LinkedIn: profile.linkedinUrl || '',
      GitHub: profile.githubUrl || '',
    },
    cards: answers.reduce((acc, a) => {
      acc[a.question_id] = a.answer
      return acc
    }, {} as Record<string, string>)
  }
  
  const submitRes = await fetch(
    `${BASE}/${job.atsBoardToken}/${job.atsJobId}/apply`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  )
  
  if (!submitRes.ok) {
    const body = await submitRes.text()
    throw new Error(`Lever submit failed ${submitRes.status}: ${body}`)
  }
  
  return { status: 'submitted', atsType: 'lever', responseCode: submitRes.status }
}
```

---

## 7. Job Sourcing Architecture

### 7.1 JSearch API (Primary)

```typescript
// workers/src/agents/sourcer.ts

export async function fetchFromJSearch(
  profile: Profile, 
  env: Env
): Promise<RawJob[]> {
  const queries = profile.targetRoles.map(role => ({
    query: `${role} ${profile.targetLocations[0]}`,
    date_posted: 'today',
    employment_types: 'FULLTIME',
    num_pages: 3
  }))
  
  const results = await Promise.all(queries.map(q => 
    fetch(`https://jsearch.p.rapidapi.com/search?${new URLSearchParams(q)}`, {
      headers: {
        'X-RapidAPI-Key': env.JSEARCH_API_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
      }
    }).then(r => r.json())
  ))
  
  return results.flatMap(r => r.data || []).map(normaliseJSearchJob)
}
```

### 7.2 Python jobspy VPS (Fallback)

```typescript
export async function fetchFromJobspy(
  profile: Profile,
  env: Env
): Promise<RawJob[]> {
  const res = await fetch(`${env.JOBSPY_VPS_URL}/jobs`, {
    method: 'GET',
    headers: { 
      'X-API-Key': env.JOBSPY_API_KEY,  // simple key on the VPS
    },
    // query params
    ...buildSearchParams(profile)
  })
  
  if (!res.ok) {
    await writeDeadLetter(null, null, 
      new Error(`jobspy VPS returned ${res.status}`), env)
    return []
  }
  
  return (await res.json()).map(normaliseJobspyJob)
}
```

### 7.3 Python VPS — FastAPI Service

```python
# main.py — runs on the $5/month VPS

from fastapi import FastAPI, HTTPException, Header
from jobspy import scrape_jobs
import os

app = FastAPI()
API_KEY = os.environ["API_KEY"]

@app.get("/jobs")
def get_jobs(
    keywords: str,
    location: str = "Remote",
    hours_old: int = 24,
    results: int = 100,
    x_api_key: str = Header(None)
):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401)
    
    jobs_df = scrape_jobs(
        site_name=["linkedin", "indeed", "glassdoor", "google"],
        search_term=keywords,
        location=location,
        results_wanted=results,
        hours_old=hours_old,
        country_indeed="USA",
    )
    
    # Return as JSON records
    return jobs_df.fillna("").to_dict(orient="records")

# Run with: uvicorn main:app --host 0.0.0.0 --port 8000
```

---

## 8. Cold Email Architecture

### 8.1 AWS SES Integration

The Cloudflare Worker cannot use the AWS SDK directly. The existing AWS Lambda/API Gateway endpoint (already used for marketing) accepts a POST and passes it to SES.

```typescript
// workers/src/agents/networker.ts

export async function sendColdEmail(
  emailContent: EmailContent,
  recipient: ValidatedContact,
  applicant: User,
  job: Job,
  env: Env
): Promise<void> {
  
  // Build FROM address
  const fromAddress = buildFromAddress(applicant)  
  // e.g. sarah.jones@mail.autoapply.io
  
  const payload = {
    from: fromAddress,
    replyTo: applicant.personalEmail,
    to: recipient.email,
    subject: emailContent.subject,
    bodyHtml: emailContent.body_html + buildEmailSignature(applicant, job),
    bodyText: emailContent.body_text,
    metadata: {
      userId: applicant.id,
      jobId: job.id,
      source: 'autoapply_cold_outreach'
    }
  }
  
  const res = await fetch(env.AWS_SES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': env.AWS_API_KEY
    },
    body: JSON.stringify(payload)
  })
  
  if (!res.ok) throw new Error(`SES endpoint failed: ${res.status}`)
  
  const { messageId } = await res.json()
  
  // Log the send
  await logOutreachEvent({
    userId: applicant.id,
    jobId: job.id,
    channel: 'email',
    fromAddress,
    replyTo: applicant.personalEmail,
    recipientEmail: recipient.email,
    sesMessageId: messageId,
    subject: emailContent.subject,
    bodyHtml: payload.bodyHtml,
    bodyText: payload.bodyText,
    deliveryStatus: 'sent'
  }, env)
}
```

### 8.2 Email Footer / Signature

Every email must include a compliant footer for CAN-SPAM:

```typescript
function buildEmailSignature(applicant: User, job: Job): string {
  return `
<br/><br/>
<small style="color:#999">
  This email was sent on behalf of ${applicant.fullName}. 
  To reply, simply reply to this email — replies go directly to ${applicant.firstName}.
  <br/>
  To stop receiving emails from ${applicant.fullName} for ${job.company} roles, 
  <a href="${UNSUBSCRIBE_URL}?token=${generateUnsubToken(applicant.id, job.companyDomain)}">click here</a>.
</small>
  `
}
```

### 8.3 Bounce/Complaint Webhook Handler

AWS SES fires SNS notifications for bounces and complaints. This endpoint must be live before any sending begins.

```typescript
// workers/src/index.ts — add this route

async function handleSESWebhook(request: Request, env: Env) {
  const body = await request.json()
  const notificationType = body.notificationType  // 'Bounce' | 'Complaint'
  
  if (notificationType === 'Bounce') {
    const email = body.bounce.bouncedRecipients[0].emailAddress
    await updateOutreachStatus(email, 'bounced', env)
    await checkAndAlertBounceRate(email, env)
  }
  
  if (notificationType === 'Complaint') {
    const email = body.complaint.complainedRecipients[0].emailAddress
    await updateOutreachStatus(email, 'complained', env)
    // Auto-suppress the company domain
    const domain = email.split('@')[1]
    await addToSuppression(domain, 'complaint', env)
  }
  
  return new Response('ok')
}
```

---

## 9. PDF Generation

### 9.1 Strategy
The PDF template is pre-rendered and stored in R2. The Worker only injects text into predefined field coordinates. Never embed fonts in the Worker bundle.

```typescript
// workers/src/core/pdf-generator.ts

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export async function generateTailoredResume(
  rewrittenBullets: RewrittenWorkHistory,
  profile: Profile,
  env: Env
): Promise<{ r2Key: string; publicUrl: string }> {
  
  // 1. Fetch base template from R2
  const templateObj = await env.R2.get(profile.resumeTemplateR2Key)
  const templateBytes = await templateObj.arrayBuffer()
  
  // 2. Load into pdf-lib
  const pdfDoc = await PDFDocument.load(templateBytes)
  const pages = pdfDoc.getPages()
  const page = pages[0]
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  
  // 3. Inject rewritten bullet points at predefined coordinates
  // These coordinates come from the user's template field map stored in their profile
  for (const entry of rewrittenBullets) {
    for (const bullet of entry.bullets) {
      page.drawText(`• ${bullet.text}`, {
        x: bullet.x,
        y: bullet.y,
        size: 10,
        font,
        color: rgb(0, 0, 0),
        maxWidth: 480,
        lineHeight: 14,
      })
    }
  }
  
  // 4. Serialise
  const pdfBytes = await pdfDoc.save()
  
  // 5. Upload to R2
  const r2Key = `resumes/${profile.userId}/${crypto.randomUUID()}.pdf`
  await env.R2.put(r2Key, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' }
  })
  
  const publicUrl = `${env.R2_PUBLIC_URL}/${r2Key}`
  
  return { r2Key, publicUrl }
}
```

---

## 10. wrangler.toml

```toml
name = "autoapply-workers"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "autoapply-db"
database_id = "YOUR_D1_ID"

[[r2_buckets]]
binding = "R2"
bucket_name = "autoapply-resumes"
preview_bucket_name = "autoapply-resumes-preview"

[[vectorize]]
binding = "VECTORIZE"
index_name = "autoapply-jobs"

[ai]
binding = "AI"

[[queues.producers]]
binding = "QUEUE"
queue = "autoapply-job-queue"

[[queues.consumers]]
queue = "autoapply-job-queue"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 2

[triggers]
crons = ["0 8 * * *"]

[vars]
R2_PUBLIC_URL = "https://resumes.autoapply.io"
JOBSPY_VPS_URL = "https://YOUR_VPS_IP:8000"

# Secrets (set via wrangler secret put):
# JSEARCH_API_KEY
# APOLLO_API_KEY
# ZEROBOUNCE_API_KEY
# AWS_API_KEY
# AWS_SES_ENDPOINT
# JOBSPY_API_KEY
```

---

## 11. Environment Variables Reference

| Variable | Where Set | Description |
|---|---|---|
| `JSEARCH_API_KEY` | Wrangler secret | RapidAPI key for JSearch |
| `APOLLO_API_KEY` | Wrangler secret | Apollo.io API key |
| `ZEROBOUNCE_API_KEY` | Wrangler secret | ZeroBounce validation |
| `AWS_API_KEY` | Wrangler secret | Key for your existing SES Lambda endpoint |
| `AWS_SES_ENDPOINT` | Wrangler secret | URL of your SES API Gateway endpoint |
| `JOBSPY_API_KEY` | Wrangler secret | Simple API key protecting your VPS |
| `JOBSPY_VPS_URL` | wrangler.toml var | URL of Python scraper VPS |
| `R2_PUBLIC_URL` | wrangler.toml var | Public base URL for R2 bucket |