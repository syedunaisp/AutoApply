# AutoApply — Critical Notes, Gotchas & Things To Remember
**Document Type:** Engineering Reference / Risk Register  
**Purpose:** This document captures every non-obvious decision, known failure mode, and critical implementation detail discussed during architecture design. Every point here represents something that will cause real production problems if ignored. This should be read in full before writing any code.

---

## 1. LLM — Model & Usage

### Finalised Model
- **Model:** `@cf/openai/gpt-oss-120b`  
- **Provider:** Cloudflare Workers AI (native binding, no external API key)  
- **Use for:** All LLM tasks — JSON extraction, resume bullet rewriting, cold email copy, custom question answering, triage classification  
- **Context window:** 128,000 tokens  
- **Pricing:** $0.35 per M input tokens, $0.75 per M output tokens — NOT free like Meta/Mistral models on Workers AI. The decision to use this model was made because the user has existing Cloudflare credits, so cost is not a current concern. Do not swap this model out without explicit instruction.

### Reasoning Effort — Use It
The model supports a `reasoning.effort` parameter (`low` / `medium` / `high`). Use this intentionally:
- `low` → fast classification tasks (ATS detection, routing decisions)
- `medium` → cold email generation
- `high` → resume bullet rewriting (quality is visible to humans, worth the extra cost)

### JSON Mode — Always Use For Structured Output
When extracting structured data (job fields, question answers, triage results), always use `response_format: { type: "json_object" }`. Never parse free-text LLM output with regex. If the model returns malformed JSON, retry once before writing to dead-letter queue.

---

## 2. Job Scraping Layer

### Architecture Decision
Scraping is handled by a **separate Python microservice**, NOT inside Cloudflare Workers. Workers cannot run Python. The scraper runs as a FastAPI app on a $5/month VPS (Hetzner or DigitalOcean) and exposes a simple REST endpoint that the Worker cron calls.

### Primary Library: jobspy
```python
from jobspy import scrape_jobs
jobs = scrape_jobs(
    site_name=["linkedin", "indeed", "glassdoor"],
    search_term=keywords,
    location=location,
    results_wanted=100,
    hours_old=24
)
```
- GitHub: `github.com/Bunsly/JobSpy`
- No API key, no per-result billing — flat VPS cost only
- Returns a Pandas DataFrame, convert to JSON before sending to Worker

### Silent Failure Guard — CRITICAL
The single most dangerous failure mode in the scraping layer is **silent zero results**. The cron runs, jobspy returns 0 jobs (because LinkedIn changed something, or the VPS IP got soft-banned), everything logs as "success", and you don't notice for days while the pipeline runs dry.

**Mandatory implementation:** After every scrape run, log the result count to D1. If count == 0, fire an alert immediately (email to admin, or a Cloudflare Worker alert). Do not let a zero-result run pass silently under any circumstances.

### IP Banning
At low volume (once per day, 100 results), a residential VPS IP rarely gets banned. If it does, restarting the DigitalOcean/Hetzner droplet usually assigns a new IP. Rate-limit the scraper to never exceed 10 requests/minute. Add randomised delays between requests (not uniform — uniform delays are a bot signal).

### Scraper Fallback Stack
1. **Primary:** jobspy (LinkedIn + Indeed + Glassdoor in one call)
2. **Targeted companies:** Greenhouse/Lever public job board JSON endpoints (free, no scraping, completely stable — use for known target companies)
3. **Fallback:** JSearch API via RapidAPI (aggregated, stable, ~$10-50/month) — activate only if jobspy is down

### Greenhouse & Lever Public Job Board Endpoints (Zero-Cost Discovery)
These are fully public, no auth, no scraping, never break:
```
GET https://boards-api.greenhouse.io/v1/boards/{company_token}/jobs
GET https://api.lever.co/v0/postings/{company_slug}
GET https://api.ashbyhq.com/posting-api/job-board/{company_identifier}
```
Build a `target_companies` table in D1 from day one. Even 50 target companies polled daily via these endpoints = highly reliable zero-cost job discovery for the best companies.

---

## 3. Job Matching — Dual Pass Is Mandatory

### Why Single-Pass Vectorize Scoring Is Not Enough
Vectorize cosine similarity scores high when **vocabulary overlaps**, not when **fit matches**. A job posting for "Senior Staff Engineer, 12 years required, no visa sponsorship" will score 87% against a junior candidate's profile if the tech keywords match. This will route the job to the Sniper Track and waste Apollo credits and email sends on jobs the applicant will never get.

### The Dual Pass
**Pass 1:** Vectorize cosine similarity — gates on score threshold (>85% Sniper, 65-84% Shotgun)  
**Pass 2 (mandatory):** LLM structured extraction — extract these fields and check against user's hard filters BEFORE routing:
- `years_experience_required` (int)
- `seniority_level` (junior / mid / senior / staff / principal)
- `visa_sponsorship` (bool)
- `remote_policy` (remote / hybrid / onsite)
- `location` (string)
- `salary_range` (optional)

Both passes must clear before a job enters either track. A job that scores 90% on Vectorize but requires 10 YOE when the user has 2 should be discarded, not applied to.

---

## 4. PDF Generation — Template Approach Is Mandatory

### Do NOT Embed Fonts in the Worker Bundle
The original architecture proposed using pdf-lib to build resumes from scratch inside a Worker. This will hit memory and bundle size limits when using custom fonts. Cloudflare Workers have a 1MB compressed bundle limit (free tier) / 10MB (paid). Font files are large.

### Correct Approach
1. Design the base resume template once as a PDF
2. Upload the template to R2
3. The Worker fetches the template from R2 and uses pdf-lib **only to inject text into predefined fields** — no font embedding, no layout construction
4. Save the final PDF back to R2 with a unique key per application
5. Return the public R2 URL (used in emails as a link, never as an attachment)

### Never Send PDFs as Email Attachments
PDF attachments are the single biggest spam signal. Every cold email must link to the R2-hosted PDF URL instead. The hiring manager clicks a link to view the resume. This also gives you open/click tracking as a side benefit.

---

## 5. ATS Application Execution

### Supported Platforms (Official APIs — Free, No Auth)
These three cover approximately 65% of startup and mid-size tech company job postings:

| ATS | Companies Using It | API Endpoint |
|-----|-------------------|--------------|
| Greenhouse | Airbnb, Notion, Figma, Dropbox, Linear, Vercel, Airtable, Loom, Retool, hundreds more | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}` |
| Lever | Netflix (some teams), GitHub, Shopify (some roles), Spotify, Atlassian | `https://api.lever.co/v0/postings/{company}/{id}/apply` |
| Ashby | Ramp, Brex, Cursor, Pika, most modern YC startups 2021+ | `https://api.ashbyhq.com/posting-api/application/create` |

### Greenhouse — Two-Step Application (CRITICAL)
Greenhouse applications are NOT a single POST. They are two steps and skipping step 1 will cause malformed or rejected submissions:

**Step 1:** Fetch the job's question schema
```
GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{job_id}?questions=true
```
This returns all custom questions with their `question_id`, `label`, `type` (short_text / long_text / yes_no / dropdown), and `required` flag.

**Step 2:** Feed questions into LLM with applicant profile → get answers → map `question_id → answer`

**Step 3:** POST the full application payload including all answered questions

If you skip step 1 and POST without the custom questions, Greenhouse will either reject the submission or silently discard it. Every job has different questions. This cannot be hardcoded.

### ATS Detection — Before Every Execution
Before routing to an executor, detect the ATS from the job's apply URL:
```typescript
function detectATS(applyUrl: string): ATS {
  if (applyUrl.includes("greenhouse.io"))           return "greenhouse"
  if (applyUrl.includes("lever.co"))                return "lever"
  if (applyUrl.includes("ashby.com") || 
      applyUrl.includes("ashbyhq.com"))             return "ashby"
  if (applyUrl.includes("workday.com") || 
      applyUrl.includes("myworkdayjobs"))           return "workday_skip"
  if (applyUrl.includes("icims.com"))               return "icims_skip"
  if (applyUrl.includes("taleo.net"))               return "taleo_skip"
  if (applyUrl.includes("successfactors"))          return "sap_skip"
  return "unknown"
}
```

### Unsupported ATS — Do Not Attempt
Workday, iCIMS, Taleo, SAP SuccessFactors all use session-based multi-step forms with CSRF tokens. There is no public API. Raw POST injection will not work — these platforms use server-side session validation and honeypot fields. Jobs on these platforms must be flagged as `manual_required` in the dashboard.

Do not attempt to automate Workday under any circumstances. It uses Cloudflare bot protection on many tenants (ironic, given our stack), and even successful-looking submissions are silently discarded.

### The Custom Questions Problem
This is what most people underestimate about ATS automation. Every single Greenhouse/Lever job has custom questions. Examples:
- "Are you authorised to work in the US without sponsorship?" (yes/no)
- "How many years of experience do you have with Kubernetes?" (short text)
- "Describe a time you led a cross-functional project" (long text — up to 1000 chars)
- "What is your expected salary range?" (short text)
- "Link to your GitHub profile" (URL)

The LLM must read the user's full profile, read each question, and generate appropriate answers. Answers to yes/no and dropdown questions must match the exact allowed values returned in the schema. Long-text answers should be 150-300 words — long enough to be substantive, short enough not to look AI-generated.

Store common question-answer pairs in D1 per user so the LLM can reference previous answers for consistency (you don't want the user's "expected salary" changing between applications).

---

## 6. Cold Email — Make Or Break Details

### The FROM Field Architecture
Two tiers, both using existing AWS SES infrastructure:

**Basic tier (build first):**
- FROM: `firstname.lastname@mail.[yourdomain].com`
- REPLY-TO: applicant's real personal email
- Hiring manager replies go directly to the applicant — the platform never sees reply content
- Your SES domain is already warmed — this is ready to use immediately

**Premium tier (build later):**
- FROM: `firstname@john-smith.com` (custom domain per user)
- Requires: domain purchase via API, DNS provisioning via Route53, SES identity verification per domain, individual domain warmup (4-6 weeks per domain)
- Do NOT build this in v1. The warmup requirement alone makes it a 6-week lead time per user.

### Domain Warmup — Cannot Skip, Cannot Rush
Any new sending domain (including subdomains) starts with zero sender reputation. Gmail and Outlook use reputation scoring — a domain with no history sending volume immediately gets junked or rejected.

Warmup schedule for any new domain/subdomain:
- Week 1: 5-10 emails/day, high-engagement recipients only
- Week 2: 20-30 emails/day
- Week 3: 50-75 emails/day
- Week 4+: 100-200 emails/day

Since the user already has a warmed SES domain, the basic tier is immediately usable. Do not add new sending domains without planning this warmup.

### ZeroBounce Validation — Mandatory Gate
Apollo.io email data is approximately 15-20% stale at any given time. Sending to invalid emails causes hard bounces. Hard bounce rate above 2% will trigger AWS SES account review. Above 5% = account suspension.

Every email address sourced from Apollo must be validated through ZeroBounce before being sent to:
- `valid` → proceed to send
- `catch-all` → proceed with caution (50% chance of bounce)
- `invalid` → discard, route to LinkedIn DM fallback
- `unknown` → discard, route to LinkedIn DM fallback

ZeroBounce cost: ~$0.01/validation. Non-negotiable line item.

### Idempotency on Apollo Lookups
Apollo charges per lookup. A bug in retry logic that causes duplicate lookups for the same company+role combination can burn credits in minutes. Every Apollo lookup must check D1 first — if a record already exists for this `(company_domain, user_id)` combination, use the cached result. Never call Apollo twice for the same target.

### The Cold Email Content — What Makes Or Breaks Deliverability
This is the most important thing about the entire email layer. Emails that look automated get deleted in 2 seconds. The LLM prompt for email generation must produce emails that feel personally written.

**What a bad automated email looks like:**
```
Subject: Application for Senior Engineer Role

Hi,

I am writing to express my strong interest in the Senior Engineer 
position at Acme Corp. My skills and experience align well with 
your requirements. Please find my resume attached.

Best regards,
John
```
This gets deleted instantly. It reads like a template because it is one.

**What a good email looks like:**
```
Subject: The distributed inference work caught my eye

Hi Marcus,

Saw the Senior Engineer role — specifically the work on distributed 
inference pipelines in the JD. I spent the last 18 months doing 
exactly that at [Company], cutting p99 latency by 40% across a 
multi-region deployment.

Happy to jump on a call if it's worth 20 minutes.

John
[R2 resume link]
```

To achieve this, the LLM prompt must include:
1. The applicant's full profile (experience, achievements with specific metrics)
2. The full job description
3. At minimum one specific detail about the company or role to reference
4. Explicit instruction: "Do not use phrases like 'I am writing to express my interest'. Do not use the word 'passionate'. Write like a human who spent 5 minutes reading the JD, not like a template."

The email body should be 4-6 sentences maximum. Hiring managers do not read long cold emails.

### Per-User Sending Limits — Mandatory
Since multiple users share your SES infrastructure, one user with bad email hygiene (lots of invalid addresses, high bounces) can tank the reputation of the entire sending domain and get your SES account reviewed.

Implement per-user limits:
- Maximum 25 cold emails per user per day
- Auto-suspend a user's email sending if their bounce rate exceeds 3% in a 7-day window
- Alert admin when any user hits >2% bounce rate
- Never send more than 3 emails to the same company domain per user per month

### The Suppression List
Build this from day one. It is much cheaper to maintain than recovering from a spam complaint:
```sql
CREATE TABLE suppressed_contacts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  email           TEXT,
  company_domain  TEXT,
  reason          TEXT, -- 'unsubscribe' | 'bounce' | 'complaint' | 'manual'
  scope           TEXT, -- 'this_user' | 'all_users'
  created_at      TIMESTAMP
);
```
Check this table before every send. A complaint that results in `scope = 'all_users'` means no user on the platform ever emails that domain again.

### AWS SES Integration from Cloudflare Workers
Cloudflare Workers cannot use the AWS SDK directly (no Node.js runtime). The integration must go through one of:
1. **AWS API Gateway + Lambda** (recommended — you likely already have this from your marketing setup)
2. **SES HTTP API with AWS Signature V4** (can be implemented manually in Workers, more complex)

The Worker POSTs to your existing AWS endpoint with this payload:
```json
{
  "from": "sarah.jones@mail.yourdomain.com",
  "replyTo": "sarah@gmail.com",
  "to": "hiring.manager@targetcompany.com",
  "subject": "...",
  "html": "...",
  "text": "...",
  "metadata": {
    "userId": "usr_123",
    "jobId": "job_456",
    "applicationId": "app_789"
  }
}
```

---

## 7. LinkedIn DM Fallback

### When It Triggers
LinkedIn DM is the fallback for Sniper-track jobs where:
- Apollo found no email for the hiring manager, OR
- ZeroBounce marked the email as invalid/unknown

### Implementation: PhantomBuster
PhantomBuster's LinkedIn Message Sender phantom is the most reliable option for automated DM sending. It requires a LinkedIn session cookie (from your own or a dedicated LinkedIn account).

**Hard limits — do not exceed these:**
- Maximum 25 DMs per day per LinkedIn account
- Randomise send times — never send at uniform intervals (uniform = obvious bot pattern)
- Rotate session cookies weekly minimum
- If the LinkedIn account gets restricted, all queued DMs for that day are lost — log them to a retry queue

**Content rules for LinkedIn DMs:**
- Maximum 3 sentences. LinkedIn DMs are even less tolerant of long messages than email.
- Same personalisation rules as cold email apply — reference something specific
- No links in the opening message — LinkedIn flags messages with links as spam
- Send the resume link only in the follow-up if they respond

### PhantomBuster is Not Fully Automatable
PhantomBuster requires a human-managed LinkedIn session. It cannot be fully wired into the Worker pipeline the way email can. The architecture for this layer is:

```
Worker identifies LI DM target
        ↓
Writes to D1 linkedin_dm_queue table
        ↓
PhantomBuster polls this queue (or runs on its own schedule)
        ↓
Sends DMs, writes back status to D1
```
This is semi-automated, not fully automated. Accept this limitation in v1.

---

## 8. Database — Critical Schema Notes

### Dead-Letter Queue — Non-Negotiable
Build the `failed_jobs` table before building anything else. Every failure in the pipeline (scraping, ATS submission, email send, Apollo lookup) must write to this table with the full error payload. Without it, silent failures will burn days of debugging time.

```sql
CREATE TABLE failed_jobs (
  id              TEXT PRIMARY KEY,
  entity_type     TEXT,  -- 'scrape' | 'match' | 'application' | 'email' | 'apollo'
  entity_id       TEXT,
  error_code      TEXT,
  error_message   TEXT,
  raw_payload     TEXT,  -- full JSON of what was attempted
  retry_count     INTEGER DEFAULT 0,
  resolved        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP
);
```

### Idempotency Keys Everywhere
The cron runs daily. Network failures cause retries. Without idempotency keys, the same job gets processed multiple times, the same application gets submitted twice, Apollo gets called multiple times for the same contact.

Every table that represents a unique real-world action must have a natural unique key:
- `applications`: unique on `(user_id, job_id)` — never apply to the same job twice
- `apollo_lookups`: unique on `(user_id, company_domain)` — never pay for the same lookup twice  
- `email_sends`: unique on `(user_id, job_id)` — never email about the same job twice
- `scrape_runs`: unique on `(source, search_hash, date)` — never scrape the same search twice per day

### D1 Limitations to Work Around
- D1 has no connection pooling. Each Worker invocation opens a fresh connection.
- During the morning cron burst (processing 100 jobs at once), concurrent D1 writes will hit limits.
- Solution: Use **Cloudflare Queues** to decouple the cron burst. The cron enqueues jobs; a Queue consumer processes them sequentially with controlled concurrency.
- D1 read replicas can have stale reads — do not rely on immediately-consistent reads after a write in the same request.

---

## 9. Cloudflare Workers — Platform Gotchas

### Bundle Size Limits
- Free tier: 1MB compressed
- Paid tier: 10MB compressed
- pdf-lib alone is relatively small, but any embedded assets (fonts, template files) inflate this fast
- Store all assets in R2, never bundle them into the Worker

### CPU Time Limits
- Workers have a 30-second CPU time limit per invocation (50ms on free tier — use paid)
- LLM calls via Workers AI do NOT count against CPU time (they're async I/O)
- Heavy PDF manipulation or large JSON processing can approach limits — profile early

### Workers AI Rate Limits
Workers AI has per-model rate limits. Processing 100 jobs in parallel will hit them. Process jobs sequentially or with controlled concurrency (max 5 parallel LLM calls). Use Cloudflare Queues for rate-safe processing.

### Cron Trigger Timing
- Cron syntax in wrangler.toml: `"0 8 * * *"` = 8:00 AM UTC daily
- UTC 8:00 AM = 1:30 PM IST — adjust if you want it to run at a specific local time
- Cron triggers have a ±30 second execution window — do not rely on exact timing

---

## 10. Monorepo Structure — Shared Types Matter

The monorepo has three packages sharing TypeScript interfaces. This is not optional architectural decoration — it prevents an entire class of bugs where the Worker sends a payload shape that the dashboard doesn't understand.

The `packages/types` directory must define:
- `Job` interface — canonical shape after scraping and normalisation
- `Application` interface — state machine for application lifecycle
- `ATSPayload` interfaces per platform (GreenhousePayload, LeverPayload, AshbyPayload)
- `OutreachEvent` interface — covers both email sends and LinkedIn DMs
- `UserProfile` interface — the full profile shape the LLM receives

Any time you add a field to a D1 table, the corresponding TypeScript interface must be updated at the same time. The Drizzle schema and the TypeScript interface must always be in sync.

---

## 11. Development Phase Order — Do Not Deviate

The phases are ordered specifically to ensure each phase is testable in isolation before the next adds complexity. Skipping ahead will make debugging exponentially harder.

**Phase 1 — Scraper + Brain + Dead-Letter Queue**
- Python jobspy FastAPI service running on VPS, returning clean job JSON
- Cloudflare Worker cron calling the scraper service
- D1 schema fully defined (all tables, including failed_jobs)
- Result count alert implemented
- Target: 10 real jobs scraped, stored in D1, visible in logs
- Do not proceed until this runs cleanly for 3 consecutive days

**Phase 2 — ATS Executor**
- Implement `detectATS()` function
- Implement Greenhouse executor with the two-step question-fetch → submit flow
- Test against a real Greenhouse job posting with a test/dummy profile
- Verify the 201 response and that the application appears in the Greenhouse board
- Add Lever executor
- Add Ashby executor
- Target: One real end-to-end application submission per platform
- Do not proceed until all three executors are verified against real jobs

**Phase 3 — LLM + PDF + Vectorize**
- Wire `@cf/openai/gpt-oss-120b` via Workers AI binding
- Implement dual-pass matching (Vectorize + LLM triage)
- Build PDF template, upload to R2, implement text injection
- Test full pipeline: job in → matched → resume generated → R2 URL returned
- Verify PDF output quality manually before automating

**Phase 4 — Cold Email**
- Wire Worker → AWS API Gateway → SES
- Implement ZeroBounce validation gate
- Implement suppression list check
- Implement per-user sending limits
- Test with 5 real sends before enabling automation
- Monitor bounce rates for 1 week before increasing volume

**Phase 5 — Dashboard**
- Next.js on Cloudflare Pages
- Application status table (sourced from D1)
- Failed jobs / dead-letter queue inspector
- Per-user stats (applications sent, emails sent, response rate)
- PDF preview via R2 public URLs
- Only build this after Phases 1-4 are stable in production

---

## 12. Cost Reference (Monthly at Steady State)

| Service | Est. Cost |
|---------|-----------|
| Cloudflare Workers + D1 + R2 + Vectorize | $5-10 |
| Workers AI (gpt-oss-120b, ~100 calls/day) | Covered by CF credits |
| Python VPS (Hetzner/DigitalOcean) | $5 |
| JSearch API fallback (if jobspy fails) | $10-50 |
| Apollo.io (~20 lookups/day) | $20-40 |
| ZeroBounce (~20 validations/day) | $5 |
| AWS SES (existing, already warmed) | ~$0-5 |
| PhantomBuster (LinkedIn DMs) | $30-69 |
| **Total** | **~$75-175/month** |

The largest variables are Apollo and PhantomBuster. Apollo usage scales with how many Sniper-track jobs are identified daily. PhantomBuster is a flat subscription regardless of volume.

---

## 13. Quick Reference — Endpoints

```
# ATS APIs (all free, no auth)
Greenhouse jobs list:     GET  https://boards-api.greenhouse.io/v1/boards/{token}/jobs
Greenhouse job detail:    GET  https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}?questions=true
Greenhouse apply:         POST https://boards-api.greenhouse.io/v1/boards/{token}/jobs/{id}

Lever jobs list:          GET  https://api.lever.co/v0/postings/{company}
Lever apply:              POST https://api.lever.co/v0/postings/{company}/{id}/apply

Ashby jobs list:          GET  https://api.ashbyhq.com/posting-api/job-board/{identifier}
Ashby apply:              POST https://api.ashbyhq.com/posting-api/application/create

# Workers AI
Model string:             @cf/openai/gpt-oss-120b
Binding in wrangler.toml: [ai] binding = "AI"
Usage in Worker:          await env.AI.run('@cf/openai/gpt-oss-120b', { messages: [...] })

# Python scraper
jobspy install:           pip install jobspy fastapi uvicorn
Local test:               uvicorn main:app --host 0.0.0.0 --port 8000
```

---

## 14. The Single Most Important Rule

**Every component that calls an external service must write its result (success or failure) to D1 before returning.**

This means: scrape results, ATS submission responses, Apollo lookup results, ZeroBounce results, email send confirmations, LinkedIn DM queue entries — all of it lands in D1 first. The system is only as debuggable as its logs. If something fails silently and there is no D1 record of the attempt, it will take hours to diagnose. If there is a D1 record, it takes minutes.