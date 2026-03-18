// Idempotency guard — check D1 for existing record before any action
// that calls an external service or costs money (Rule 2)

import type { Env } from '@autoapply/types'

/**
 * Check if a record already exists in a table by a unique key.
 * Returns true if a record exists (action should be SKIPPED).
 * 
 * Usage pattern:
 *   const exists = await checkExists(env, 'applications', 'user_id = ? AND job_id = ?', [userId, jobId])
 *   if (exists) return { skipped: true }
 */
export async function checkExists(
  env: Env,
  table: string,
  whereClause: string,
  params: (string | number | null)[]
): Promise<boolean> {
  const result = await env.DB.prepare(
    `SELECT id FROM ${table} WHERE ${whereClause} LIMIT 1`
  ).bind(...params).first()

  return result !== null
}

/**
 * Check if we've already processed a specific job for a specific user.
 * Used before saving scraped jobs to prevent duplicates.
 */
export async function hasJobBeenProcessed(
  env: Env,
  userId: string,
  externalId: string
): Promise<boolean> {
  // Check if job with this external ID already exists
  const existing = await env.DB.prepare(
    'SELECT id FROM jobs WHERE external_id = ? LIMIT 1'
  ).bind(externalId).first()

  return existing !== null
}

/**
 * Check if an application already exists for this user + job combo.
 * Critical: never apply to the same job twice.
 */
export async function hasApplicationBeenSubmitted(
  env: Env,
  userId: string,
  jobId: string
): Promise<boolean> {
  return checkExists(env, 'applications', 'user_id = ? AND job_id = ?', [userId, jobId])
}

/**
 * Check if outreach has already been sent for this user + application + channel.
 */
export async function hasOutreachBeenSent(
  env: Env,
  userId: string,
  applicationId: string,
  channel: string
): Promise<boolean> {
  return checkExists(
    env,
    'outreach_events',
    'user_id = ? AND application_id = ? AND channel = ?',
    [userId, applicationId, channel]
  )
}

/**
 * Check if Apollo has already been queried for this user + company domain.
 * Never pay for the same lookup twice.
 */
export async function hasApolloBeenQueried(
  env: Env,
  userId: string,
  companyDomain: string
): Promise<boolean> {
  return checkExists(
    env,
    'apollo_lookups',
    'user_id = ? AND company_domain = ?',
    [userId, companyDomain]
  )
}
