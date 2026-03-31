// Cloudflare Worker environment bindings
export interface Env {
  // Cloudflare D1 (SQLite)
  DB: D1Database

  // Cloudflare R2 (Object Storage)
  R2: R2Bucket

  // Cloudflare Vectorize
  VECTORIZE: VectorizeIndex

  // Cloudflare Workers AI
  AI: Ai

  // Cloudflare Queues
  JOB_QUEUE: Queue
  MATCH_QUEUE: Queue

  // Worker Secrets
  SCRAPER_URL: string
  APOLLO_API_KEY: string
  ZERO_BOUNCE_API_KEY: string
  RESEND_API_KEY: string
  SCRAPER_API_KEY: string
  WORKER_INGEST_KEY: string
  SENDING_DOMAIN: string
  R2_PUBLIC_URL: string
  ADMIN_ALERT_EMAIL: string
}
