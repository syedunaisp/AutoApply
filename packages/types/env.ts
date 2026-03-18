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

  // Worker Secrets
  SCRAPER_URL: string
  APOLLO_API_KEY: string
  ZERO_BOUNCE_API_KEY: string
  AWS_SES_ENDPOINT: string
  AWS_API_KEY: string
  R2_PUBLIC_URL: string
  SENDING_DOMAIN: string
  ADMIN_ALERT_EMAIL: string
}
