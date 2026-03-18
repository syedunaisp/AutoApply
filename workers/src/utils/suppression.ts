// Suppression list — check before every email send

import type { Env } from '@autoapply/types'

/**
 * Check if a contact (email or company domain) is suppressed for a user.
 * A suppressed contact means we NEVER email them.
 * 
 * Checks both user-specific and global (all_users) suppressions.
 */
export async function checkSuppression(
  env: Env,
  userId: string,
  email: string,
  companyDomain: string
): Promise<boolean> {
  const result = await env.DB.prepare(`
    SELECT id FROM suppressed_contacts 
    WHERE (
      (user_id = ? OR scope = 'all_users')
      AND (email = ? OR company_domain = ?)
    )
    LIMIT 1
  `).bind(userId, email, companyDomain).first()

  return result !== null
}

/**
 * Add a contact to the suppression list.
 * Scope 'all_users' means no user on the platform ever emails this domain again.
 */
export async function addToSuppression(
  env: Env,
  userId: string | null,
  email: string | null,
  companyDomain: string | null,
  reason: 'unsubscribe' | 'bounce' | 'complaint' | 'manual',
  scope: 'this_user' | 'all_users'
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO suppressed_contacts 
    (id, user_id, email, company_domain, reason, scope, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    userId,
    email,
    companyDomain,
    reason,
    scope,
    Math.floor(Date.now() / 1000)
  ).run()
}

/**
 * Get the count of outreach emails sent by a user today.
 * Enforces the per-user daily cap (max 25/day).
 */
export async function getDailyEmailCount(
  env: Env,
  userId: string
): Promise<number> {
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayStartTs = Math.floor(todayStart.getTime() / 1000)

  const result = await env.DB.prepare(`
    SELECT COUNT(*) as count FROM outreach_events 
    WHERE user_id = ? AND channel = 'email' AND status = 'sent' AND sent_at >= ?
  `).bind(userId, todayStartTs).first<{ count: number }>()

  return result?.count ?? 0
}
