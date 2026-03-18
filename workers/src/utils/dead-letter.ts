// Dead-Letter Queue — BUILT FIRST before any feature code (Rule 1)
// Every external call must call writeDeadLetter() on failure.

import type { Env } from '@autoapply/types'

/**
 * Write a failure record to the dead-letter queue (failed_jobs table).
 * This must be called for EVERY failed external call: scraper, ATS API,
 * Apollo, ZeroBounce, SES.
 */
export async function writeDeadLetter(
  env: Env,
  entityType: 'scrape' | 'match' | 'application' | 'email' | 'apollo' | 'zerobounce',
  entityId: string | null,
  userId: string | null,
  errorCode: string,
  errorMessage: string,
  rawPayload?: any
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO failed_jobs 
      (id, entity_type, entity_id, user_id, error_code, error_message, raw_payload, retry_count, resolved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
    `).bind(
      crypto.randomUUID(),
      entityType,
      entityId,
      userId,
      errorCode,
      errorMessage,
      rawPayload ? JSON.stringify(rawPayload) : null,
      Math.floor(Date.now() / 1000)
    ).run()
  } catch (err) {
    // If even the dead-letter write fails, log to console as last resort
    console.error('CRITICAL: Failed to write to dead-letter queue', {
      entityType,
      entityId,
      userId,
      errorCode,
      errorMessage,
      writeError: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Send an alert to the admin (e.g., for zero-result scrapes).
 * In production, this could send an email via SES or a webhook.
 * For now, logs to console and writes to dead-letter.
 */
export async function sendAdminAlert(
  env: Env,
  message: string
): Promise<void> {
  console.error(`ADMIN ALERT: ${message}`)
  
  // Also write to dead-letter so it appears in the failures dashboard
  await writeDeadLetter(
    env,
    'scrape',
    null,
    null,
    'ADMIN_ALERT',
    message
  )
}
