# AutoApply — Claude Code Context

This file gives Claude Code the architectural context needed to assist with this codebase.

## What This Project Is

B2C SaaS job application automation. Scrapes jobs → matches against user profile → tailors resume → submits to ATS → sends cold emails. Runs entirely on Cloudflare Workers edge infrastructure.

## Critical Rules (never violate these)

1. **Greenhouse is always 2-step**: fetch schema with `?questions=true` first, then submit. Never skip the schema fetch.
2. **Never embed fonts in the Worker** — fonts live in the R2 PDF template, not the Worker bundle.
3. **Never attach PDFs to emails** — generate PDF, upload to R2, send the public URL as a link.
4. **ZeroBounce validation is mandatory** before every email send — never skip it.
5. **Apollo lookup must check D1 cache first** — never call Apollo twice for the same user + company.
6. **Idempotency on everything** — every external call checks the DB before executing.
7. **Every failure writes to `failed_jobs`** — no silent failures, ever.
8. **Dual-pass matching** — Vectorize cosine similarity AND LLM triage, both must pass.

## Tech Stack

- **Workers**: Cloudflare Workers (TypeScript) — `workers/src/`
- **LLM**: `@cf/meta/llama-3.1-8b-instruct` via Workers AI binding
- **Vectors**: Cloudflare Vectorize (cosine similarity, 768 dimensions, BAAI BGE)
- **DB**: Cloudflare D1 (SQLite) via Drizzle ORM — `packages/db/schema.ts`
- **Storage**: Cloudflare R2 (resume PDFs) — bucket: `autoapply-resumes`
- **Queue**: Cloudflare Queues — `job-processing-queue` (Stage 1) + `match-queue` (Stage 2)
- **Email**: Resend API
- **Scraper**: Python FastAPI + jobspy on Render
- **Dashboard**: Next.js 14 static export on Cloudflare Pages

## Key Files

- `workers/src/index.ts` — HTTP API routes, cron handler, queue router
- `workers/src/queues/job-processor.ts` — Stage 1 (fast) + Stage 2 (LLM-heavy) queue consumers
- `workers/src/agents/matchmaker.ts` — Vectorize + LLM dual-pass matching
- `workers/src/agents/networker.ts` — 9-step cold email pipeline
- `workers/src/core/llm.ts` — Workers AI wrapper (Llama 3.1 8B)
- `workers/src/core/pdf-generator.ts` — R2 template fetch + pdf-lib injection
- `workers/src/executors/apply.ts` — ATS detection + routing
- `packages/db/schema.ts` — Full Drizzle schema (10 tables)
- `web/src/app/settings/page.tsx` — Profile editor + PDF resume upload + AI parse
- `scraper/main.py` — FastAPI + jobspy (search terms configurable via SEARCH_TERMS env var)

## Queue Architecture

Two separate queues to avoid CPU timeout on LLM-heavy operations:

```
JOB_QUEUE (job-processing-queue)  — Stage 1: fast, batch 5
  dedup → ATS detect → D1 insert → enqueue to MATCH_QUEUE

MATCH_QUEUE (match-queue)  — Stage 2: slow, batch 1
  load profile → Vectorize → LLM triage → hard filters → PDF → ATS → cold email
```

Queue routing in `index.ts` uses `batch.queue` name as discriminator.

## LLM Usage

All LLM calls go through `callLLM()` in `workers/src/core/llm.ts`.

- Model: `@cf/meta/llama-3.1-8b-instruct`
- JSON mode uses `response_format: { type: 'json_schema', json_schema: { name: 'output', schema: { type: 'object' } } }`
- Response is wrapped in `{ output: {...} }` — unwrap with `parsed.output ?? parsed`
- Empty string response = quota exhausted (free tier: 10,000 neurons/day)
- Neuron cost: ~19/triage call, ~61/resume bullets, ~64/cold email

## Known Limitations

- **Cron disabled** (`wrangler.toml: crons = []`) — re-enable on Workers Paid plan ($5/mo)
- **ATS submission** — needs real scraped ATS URLs (not LinkedIn-wrapped) for actual submission
- **Apollo** — deferred (requires $49/mo paid plan); LinkedIn DM fallback active
- **PhantomBuster** — `linkedin_dm_queue` table populated but no consumer written yet
- **Profile embedding** — generated once on first Stage 2 run, not auto-updated on profile changes
