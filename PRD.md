# Product Requirements Document
# AutoApply — Automated Job Application & Outreach Platform
**Version:** 1.0  
**Status:** Ready for Engineering  
**Last Updated:** March 2026

---

## 1. Product Overview

### 1.1 What We Are Building
AutoApply is a B2C SaaS platform that automates the entire job application pipeline for paying customers (job seekers). The system automatically discovers relevant job listings, tailors a resume PDF for each job using AI, submits applications directly to company ATS platforms via their official APIs, and sends personalised cold emails to hiring managers — all without the user lifting a finger after initial setup.

### 1.2 The Core Problem
Job seekers spend 60–80% of their job search time on repetitive mechanical tasks: copying and pasting the same information into different ATS forms, writing slightly different cover letters for each role, and trying to reach hiring managers directly. This is time that should be spent on interview prep, networking, and skill development. AutoApply eliminates the mechanical layer entirely.

### 1.3 Who The User Is
**Primary User:** A software engineer or tech professional who is actively job hunting, paying for a subscription, and wants to maximise their application volume and quality without spending hours per day on manual applications.

The user onboards once by providing:
- Their base resume content (work history, skills, education)
- Job search preferences (roles, locations, seniority, salary range, remote preference)
- Their personal email address (for reply-to on cold emails)
- Their LinkedIn profile URL

After onboarding, the system runs fully autonomously every morning.

### 1.4 What The User Experiences
1. Signs up, completes onboarding profile in ~15 minutes
2. Goes to sleep
3. Wakes up to a dashboard showing: X jobs found, Y applications submitted, Z cold emails sent, W replies received
4. Can view every tailored resume PDF generated for each application
5. Can see the exact cold email sent to each hiring manager
6. Can mark any application as "not interested" to suppress that company going forward
7. Receives direct replies from hiring managers in their own personal inbox (Reply-To routing)

---

## 2. Business Context

### 2.1 Business Model
- B2C SaaS subscription
- Basic tier: Applications sent from `firstname.lastname@mail.[ourdomain].com`
- Premium tier: Applications sent from user's own provisioned custom domain (e.g. `firstname@firstname-lastname.com`)
- Pricing TBD but positioned as a professional job search tool

### 2.2 Sending Infrastructure
We operate existing AWS SES infrastructure already used for marketing emails with a warmed sending domain. This same infrastructure will be repurposed and extended for AutoApply cold email sending. We own and warm the sending domain. We are responsible for deliverability.

### 2.3 Scale Assumptions (Initial)
- 100 jobs scraped per user per day
- ~65 jobs match and pass triage filters
- ~20 applications submitted per day per user
- ~5 cold emails sent per day per user (Sniper track only, high-match jobs)
- Start with single-user (founder), then expand to paying customers

---

## 3. Core Features

### 3.1 Feature: Job Discovery (Sourcing)
**What it does:** Every morning at 08:00 UTC a scheduled job runs that fetches fresh job listings matching the user's search criteria.

**How it works:**
- Primary source: JSearch API — aggregates LinkedIn, Indeed, Glassdoor, Google Jobs in one call
- Secondary source: Direct polling of Greenhouse and Lever public job board JSON endpoints for target companies the user has explicitly listed
- Tertiary/fallback: Custom Python scraper using `jobspy` library, hosted as a FastAPI service on a $5/month VPS, called via HTTP from the orchestrator

**What gets stored:** Every raw job is normalised into a canonical Job schema and saved to the database before any matching occurs.

**Critical requirement:** The system must log the result count of every scrape run. If result count = 0, the system must flag this as a potential silent failure and alert. Never assume 0 results means no jobs exist — it almost always means the scraper broke.

### 3.2 Feature: Job Matching & Triage
**What it does:** Scores every scraped job against the user's profile and routes it to the right track.

**How it works — two-pass system:**

**Pass 1 — Semantic Similarity (Vectorize)**
- Generate embedding of job description via Workers AI
- Run cosine similarity against the user's base profile embedding stored in Vectorize
- Returns a score 0–100

**Pass 2 — Structured Triage (LLM)**
This pass is mandatory regardless of similarity score. The LLM extracts:
- Years of experience required
- Seniority level (junior / mid / senior / staff / principal)
- Visa sponsorship availability
- Remote / hybrid / onsite
- Hard skills required

These structured fields are checked against the user's hard filter preferences. A job can score 95% similarity but still be filtered out if it requires 10 YOE and the user has 3.

**Routing after both passes:**
- Score > 85% AND all hard filters pass → **Sniper Track** (ATS apply + cold email to hiring manager)
- Score 65–84% AND all hard filters pass → **Shotgun Track** (ATS apply only, no cold email)
- Score < 65% OR any hard filter fails → **Rejected** (logged with reason, never actioned)

### 3.3 Feature: Resume Tailoring
**What it does:** For every job that passes triage, generates a tailored version of the user's resume with bullet points rewritten to match the specific job description.

**How it works:**
1. Fetch user's base profile from database (work history, skills, achievements)
2. Feed job description + base profile into `@cf/openai/gpt-oss-120b` with instructions to rewrite bullet points to emphasise relevant experience
3. Use `pdf-lib` to inject the rewritten text into a pre-rendered PDF template stored in R2
4. Upload the finalised PDF to R2 with a unique filename: `resumes/{user_id}/{job_id}.pdf`
5. Generate a public R2 URL — this URL is used in cold emails and ATS submissions

**Important constraint:** The PDF base template lives in R2 as a pre-rendered file. The Worker only injects text into fixed field positions. The Worker must never attempt to embed fonts — all font embedding happens at template creation time, not at runtime. This avoids Cloudflare Worker memory limits.

### 3.4 Feature: ATS Application Submission
**What it does:** Submits the tailored application directly to the company's ATS via official public APIs.

**Supported ATS platforms (in priority order):**
1. **Greenhouse** — covers ~35% of startup/mid-size tech companies
2. **Lever** — covers ~20% of startup/mid-size tech companies
3. **Ashby** — covers ~10% of modern YC-backed startups

**Unsupported (do not attempt, log as manual_required):**
- Workday — no public API, multi-step wizard, enterprise companies only
- iCIMS — same
- Taleo / SAP SuccessFactors — same
- Any ATS requiring CSRF tokens or session state

**ATS Detection:** Before attempting submission, the system identifies which ATS is being used by pattern-matching the apply URL and/or fetching the apply page and grepping for ATS signatures.

**The custom questions problem:** Every Greenhouse and Lever job has custom screening questions (e.g. "Are you authorised to work in the US?", "Years of React experience?", "Why do you want to work here?"). The system must:
1. Fetch the job schema to retrieve all question IDs and their types (text, yes/no, dropdown, file)
2. Pass all questions to the LLM along with the user's full profile
3. LLM generates appropriate answers for each question
4. Map answers to question IDs in the submission payload

This two-step (fetch schema → submit with answers) is mandatory. A submission without answers will fail validation on most jobs.

### 3.5 Feature: Cold Email Outreach (Sniper Track Only)
**What it does:** For high-match jobs, finds the hiring manager's email address and sends a personalised cold email introducing the applicant.

**This feature only activates for Sniper track jobs (score > 85%).**

**The full cold email flow:**
1. Job identified as Sniper track
2. Apollo.io API called with company name → returns list of potential contacts (Engineering Managers, VP Engineering, CTOs)
3. ZeroBounce API validates every email address returned by Apollo before any send
   - Status "valid" → proceed
   - Status "catch-all" → skip (too risky)
   - Status "invalid" / "unknown" → skip
4. Check suppression list in database — has this company/domain been suppressed for this user?
   - Yes → skip entirely, log reason
   - No → proceed
5. LLM generates personalised email using: applicant profile + job description + one specific company hook (pulled from job description or company description in the listing)
6. System posts to AWS SES endpoint
7. Email sent FROM `firstname.lastname@mail.[ourdomain].com`, Reply-To set to applicant's personal email
8. All send events logged to database
9. SES bounce/complaint webhooks monitored — auto-suppress company on complaint, alert if user bounce rate > 3%

**If no valid email found via Apollo:** Route to LinkedIn DM queue (PhantomBuster) instead of skipping.

**Email quality rule — non-negotiable:** Every cold email must contain at least one specific, genuine reference to the company or role. Generic "I am writing to express my interest" language will destroy deliverability and response rates. The LLM prompt must enforce this.

**Daily sending limits:**
- Maximum 5 cold emails per user per day (to protect sender reputation)
- Maximum 25 LinkedIn DMs per user per day (to protect LinkedIn account)
- These limits are hard-coded, not configurable by users

### 3.6 Feature: Dashboard
**What it does:** Gives the user full visibility into everything the system has done on their behalf.

**Pages / views required:**
- **Overview:** Stats for today and last 30 days — jobs found, applications submitted, emails sent, response rate
- **Applications:** Table of every application with status, ATS used, date, link to the tailored resume PDF, company name, role title
- **Outreach:** Table of every cold email sent with recipient, date, delivery status, whether a reply was detected
- **Failures:** Dead-letter queue — every failed application or email with the full error payload. This is critical for debugging.
- **Settings:** User profile, job search preferences, hard filters, email preferences, suppressed companies list

### 3.7 Feature: Dead-Letter Queue
Every failed action in the system (failed ATS submission, failed email send, failed Apollo lookup) must be written to a `failed_jobs` table with:
- The full error payload
- The action that was being attempted
- The job/company it was for
- A human-readable failure reason
- Timestamp

This is surfaced in the Dashboard under "Failures" so the user can choose to manually apply to important jobs that the system couldn't handle automatically.

---

## 4. User Onboarding Flow

### Step 1 — Account Creation
Standard email/password signup.

### Step 2 — Profile Builder
User fills in:
- Full name
- Personal email (used as Reply-To on all cold emails)
- LinkedIn URL
- Current title and years of experience
- Work history (company, title, dates, bullet points per role)
- Skills (programming languages, frameworks, tools)
- Education
- Target roles (e.g. "Senior Software Engineer", "Staff Engineer")
- Target locations (cities or "Remote")
- Minimum salary (used as a filter)
- Seniority preference (mid / senior / staff)
- Visa sponsorship required (yes/no — critical filter)
- Industries to exclude (e.g. "defence", "crypto")
- Companies to exclude (user can list specific companies to never apply to)

### Step 3 — Resume Template Upload
User uploads their current resume PDF. This becomes the base template that pdf-lib injects tailored content into. System confirms it can parse and use the template.

### Step 4 — Preferences Review
User sees a summary of their settings and can adjust before activating automation.

### Step 5 — Activation
User activates the agent. First run happens the following morning at 08:00 UTC.

---

## 5. Success Metrics

| Metric | Definition | Target |
|---|---|---|
| Application submission rate | % of matched jobs that result in a successful ATS submission | > 80% |
| Email delivery rate | % of sent emails that reach inbox (not spam) | > 90% |
| Email open rate | % of delivered emails that are opened | > 40% |
| Response rate | % of cold emails that receive a reply | > 5% |
| ATS success rate (Greenhouse) | % of Greenhouse submissions returning 2xx | > 95% |
| Scraper uptime | % of daily cron runs that return > 0 results | > 98% |
| System-initiated interview rate | Interviews resulting from automated outreach | Track and report |

---

## 6. Out of Scope (V1)

- Workday / iCIMS / Taleo automation (explicitly not supported)
- Interview scheduling automation
- Salary negotiation assistance
- Follow-up email sequences (one cold email per job only in V1)
- Mobile app (web dashboard only)
- Team/agency accounts (single user per account in V1)
- Custom domain provisioning per user (Premium tier — V2)
- Referral tracking