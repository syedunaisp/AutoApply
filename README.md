# AutoApply

AutoApply is a B2C SaaS platform that automates the full job application pipeline — discovering jobs daily, tailoring resumes per job, submitting to ATS platforms, and sending personalised cold emails to hiring managers. Built entirely on Cloudflare's serverless edge infrastructure.

---

## Architecture

```
Python Scraper (Render / any VPS)
        │
        │  POST /ingest-jobs
        ▼
Cloudflare Worker  ──────────────────────────────────────────────────────────
        │                                                                    │
        ▼                                                                    │
job-processing-queue  (Stage 1)                              HTTP API ◄──── Next.js Dashboard
  • dedup by external_id                                                     │
  • ATS detection (Greenhouse / Lever / Ashby)                               │
  • save to D1                                                                │
  • enqueue to match-queue                                                    │
        │                                                                    │
        ▼                                                                    │
match-queue  (Stage 2 — 1 job at a time)                                    │
  • Vectorize semantic similarity                                             │
  • LLM triage (years required, visa, remote, seniority)                     │
  • Hard filter enforcement                                                   │
  • Sniper (>85%) or Shotgun (65–84%) routing                                │
  • Tailored PDF resume → R2                                                  │
  • ATS submission                                                            │
  • Cold email → Resend (sniper track only)                                  │
        │                                                                    │
        ▼                                                                    │
Cloudflare D1 (SQLite) ◄─────────────────────────────────────────────────── ┘
```

| Layer | Technology |
|---|---|
| Backend | Cloudflare Workers (TypeScript) |
| Database | Cloudflare D1 (SQLite via Drizzle ORM) |
| Vector Search | Cloudflare Vectorize (BAAI BGE-base-en-v1.5) |
| LLM | Cloudflare Workers AI — Llama 3.1 8B Instruct |
| File Storage | Cloudflare R2 (tailored resume PDFs) |
| Job Queue | Cloudflare Queues (2-stage decoupled pipeline) |
| Email | Resend API |
| Scraper | FastAPI + jobspy (LinkedIn / Indeed / Glassdoor) |
| Dashboard | Next.js 14 + Tailwind CSS on Cloudflare Pages |

---

## Monorepo Structure

```
AutoApply/
├── packages/
│   ├── db/               # Drizzle schema + migrations (10 tables)
│   └── types/            # Shared TypeScript types across workers + web
├── workers/              # Cloudflare Worker — backend + queue consumers
│   └── src/
│       ├── index.ts              # HTTP API + cron + queue router
│       ├── agents/
│       │   ├── sourcer.ts        # Scraper integration
│       │   ├── matchmaker.ts     # Vectorize + LLM dual-pass matching
│       │   ├── networker.ts      # 9-step cold email pipeline
│       │   └── email-validator.ts
│       ├── executors/
│       │   ├── apply.ts          # ATS detection + routing
│       │   ├── greenhouse.ts
│       │   ├── lever.ts
│       │   └── ashby.ts
│       ├── core/
│       │   ├── llm.ts            # Workers AI wrapper (Llama 3.1 8B)
│       │   └── pdf-generator.ts  # Resume PDF injection via pdf-lib
│       ├── queues/
│       │   └── job-processor.ts  # Stage 1 + Stage 2 queue consumers
│       └── utils/
│           ├── dead-letter.ts    # Dead-letter queue writer
│           ├── idempotency.ts    # Duplicate prevention
│           └── suppression.ts    # Bounce/complaint list
├── web/                  # Next.js dashboard (Cloudflare Pages)
│   └── src/app/
│       ├── login/        # Password-protected entry
│       ├── dashboard/    # Stats + applications table
│       ├── logs/         # Scrape run history
│       ├── failures/     # Dead-letter queue viewer
│       └── settings/     # Profile editor + PDF resume upload
└── scraper/              # Python FastAPI scraper service
    └── main.py
```

---

## Prerequisites

- **Node.js** 20+ and **npm** 9+
- **Python** 3.11+
- **Cloudflare account** (free tier works for development; paid plan needed for cron triggers)
- **Wrangler CLI** v4: `npm install -g wrangler`
- Accounts for external services: Resend, ZeroBounce, Apollo.io (optional)

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/henceproveOrg/job-agent.git
cd job-agent
npm install
```

### 2. Cloudflare infrastructure setup

Log in to Cloudflare:
```bash
wrangler login
```

Create required Cloudflare resources:
```bash
# D1 database
wrangler d1 create autoapply
# → copy the database_id into workers/wrangler.toml

# Vectorize index
wrangler vectorize create job-embeddings --dimensions=768 --metric=cosine

# Vectorize metadata index (required for profile filtering)
wrangler vectorize create-metadata-index job-embeddings --property-name=profileId --type=string

# R2 bucket
wrangler r2 bucket create autoapply-resumes

# Queues
wrangler queues create job-processing-queue
wrangler queues create match-queue
```

### 3. Configure wrangler.toml

```bash
cp workers/wrangler.example.toml workers/wrangler.toml
```

Edit `workers/wrangler.toml` and replace `REPLACE_WITH_YOUR_D1_ID` with the database_id from step 2.

### 4. Run database migrations

```bash
cd packages/db
npm run generate   # generate migration files from schema
npm run migrate    # apply to D1 (remote)
```

### 5. Seed your user

```bash
wrangler d1 execute autoapply --remote --command="
INSERT INTO users (id, email, first_name, last_name, plan, active, created_at)
VALUES ('your-user-id', 'you@example.com', 'Your', 'Name', 'basic', 1, unixepoch());

INSERT INTO profiles (id, user_id, created_at, updated_at)
VALUES (lower(hex(randomblob(16))), 'your-user-id', unixepoch(), unixepoch());
"
```

### 6. Set Cloudflare secrets

```bash
cd workers
wrangler secret put RESEND_API_KEY
wrangler secret put SENDING_DOMAIN        # e.g. mail.yourdomain.com
wrangler secret put APOLLO_API_KEY
wrangler secret put ZERO_BOUNCE_API_KEY
wrangler secret put R2_PUBLIC_URL         # e.g. https://resumes.yourdomain.com
wrangler secret put ADMIN_ALERT_EMAIL
wrangler secret put SCRAPER_URL           # e.g. https://your-scraper.onrender.com
wrangler secret put WORKER_INGEST_KEY     # generate: openssl rand -hex 32
wrangler secret put SCRAPER_API_KEY       # same value as scraper API_KEY
```

### 7. Upload base resume template to R2

```bash
wrangler r2 object put autoapply-resumes/templates/base-resume.pdf --file=your-resume.pdf
```

### 8. Deploy the worker

```bash
cd workers
npm run deploy
```

### 9. Set up the scraper

```bash
cd scraper
cp .env.example .env
# Edit .env with your values
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 10. Set up and deploy the dashboard

```bash
cd web
cp .env.example .env.local
# Edit .env.local with your values

# Build and deploy to Cloudflare Pages
npm run build
wrangler pages project create autoapply-dashboard
wrangler pages deploy out --project-name autoapply-dashboard
```

---

## Environment Variables

### Scraper (`scraper/.env`)

| Variable | Required | Description |
|---|---|---|
| `API_KEY` | Yes | Shared secret — must match worker's `SCRAPER_API_KEY` |
| `WORKER_URL` | Yes | Your deployed worker URL |
| `WORKER_INGEST_KEY` | Yes | Auth key for `/ingest-jobs` — must match worker's `WORKER_INGEST_KEY` |
| `SEARCH_TERMS` | No | Comma-separated job titles to scrape. Default: `Senior Software Engineer,Staff Engineer` |
| `SEARCH_LOCATION` | No | Location for all searches. Default: `United States` |

### Dashboard (`web/.env.local`)

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Worker URL. Use `http://localhost:8787` for local dev |
| `NEXT_PUBLIC_DASHBOARD_PASSWORD` | Yes | Login password for the dashboard |
| `NEXT_PUBLIC_USER_ID` | Yes | D1 user ID to load/save profile for |

### Worker secrets (`wrangler secret put`)

| Secret | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | Yes | Resend API key for email sending |
| `SENDING_DOMAIN` | Yes | Verified domain on Resend (e.g. `mail.yourdomain.com`) |
| `APOLLO_API_KEY` | No | Apollo.io key for hiring manager lookup (paid plan required) |
| `ZERO_BOUNCE_API_KEY` | Yes | ZeroBounce key for email validation |
| `R2_PUBLIC_URL` | Yes | Public URL for R2 bucket |
| `ADMIN_ALERT_EMAIL` | Yes | Email for zero-result scrape alerts |
| `SCRAPER_URL` | Yes | Deployed scraper URL |
| `WORKER_INGEST_KEY` | Yes | Auth key for `/ingest-jobs` endpoint |
| `SCRAPER_API_KEY` | Yes | Must match scraper's `API_KEY` |

---

## Local Development

```bash
# Worker (runs on http://localhost:8787)
cd workers && wrangler dev

# Dashboard (runs on http://localhost:3000)
cd web && npm run dev

# Scraper (runs on http://localhost:8000)
cd scraper && uvicorn main:app --reload
```

Test the full pipeline locally:
```bash
# Push a test job
curl -X POST http://localhost:8787/ingest-jobs \
  -H "x-ingest-key: your-ingest-key" \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": "Software Engineer",
    "location": "Remote",
    "jobs": [{
      "external_id": "test-001",
      "title": "Software Engineer",
      "company": "Acme Corp",
      "location": "Remote",
      "description": "We are hiring...",
      "apply_url": "https://boards.greenhouse.io/acme/jobs/123",
      "source": "linkedin"
    }]
  }'
```

---

## Deployment Overview

| Component | Platform | Command |
|---|---|---|
| Worker | Cloudflare Workers | `cd workers && npm run deploy` |
| Dashboard | Cloudflare Pages | `cd web && npm run build && wrangler pages deploy out` |
| Scraper | Render / any VPS | Deploy as Python web service, set env vars |
| Database | Cloudflare D1 | `cd packages/db && npm run migrate` |

---

## Key Design Decisions

**Two-stage queue pipeline** — Stage 1 is fast (dedup + DB write, batch 5). Stage 2 is LLM-heavy (one job at a time). Decoupling prevents CPU timeout on large scrape bursts.

**Dual-pass matching** — Vectorize cosine similarity (Pass 1) + LLM structured triage (Pass 2). Both must clear. Reduces false positives vs single-signal matching.

**Dead-letter first** — Every external call failure is logged to `failed_jobs` before any feature code runs. Zero silent failures by design.

**Idempotency everywhere** — Unique constraints on `(userId, jobId)` in applications, `(userId, applicationId, channel)` in outreach, `(userId, companyDomain)` in Apollo lookups. Never duplicate external API calls.

**Resume as R2 link** — PDFs are generated, uploaded to R2, and sent as public URLs in emails. Never attached. Prevents email bloat and allows link tracking.

---

## Workers AI Free Tier

The free tier provides **10,000 neurons/day**. Estimated usage at 100 jobs/day:

| Operation | Neurons per call | Frequency |
|---|---|---|
| LLM triage per job | ~19 | Every job |
| Match score (LLM fallback) | ~14 | Every job |
| Resume bullets rewrite | ~61 | Shotgun + Sniper only |
| Cold email generation | ~64 | Sniper only |
| Resume parse (one-time) | ~69 | Profile setup |

**Total: ~6,400 neurons/day** at 100 jobs. Upgrade to **Workers Paid ($5/month)** to:
- Enable the native daily cron trigger
- Handle bursts beyond 150 jobs/day
- Avoid quota interruptions

---

## Contributing

1. Fork the repo and create a branch: `git checkout -b feature/your-feature`
2. Make changes and test locally with `wrangler dev`
3. Ensure TypeScript compiles: `cd workers && npx tsc --noEmit`
4. Open a pull request with a clear description of what and why

---

## License

MIT
