// ZeroBounce API client — email validation before every send (Rule 6)
// No email is ever sent without ZeroBounce validation.

import type { Env, ZeroBounceStatus } from '@autoapply/types'
import { writeDeadLetter } from '../utils/dead-letter'

/**
 * Validate an email address via ZeroBounce API.
 * MANDATORY before every email send — never skip this (Rule 6).
 * 
 * Returns:
 *   'valid'     → proceed to send
 *   'catch-all' → proceed with caution (~50% bounce chance)
 *   'invalid'   → discard, route to LinkedIn DM fallback
 *   'unknown'   → discard, route to LinkedIn DM fallback
 */
export async function validateEmail(
  env: Env,
  email: string
): Promise<ZeroBounceStatus> {
  try {
    const res = await fetch(
      `https://api.zerobounce.net/v2/validate?api_key=${env.ZERO_BOUNCE_API_KEY}&email=${encodeURIComponent(email)}`
    )

    if (!res.ok) {
      await writeDeadLetter(
        env, 'zerobounce', null, null,
        'ZEROBOUNCE_HTTP_ERROR',
        `ZeroBounce returned ${res.status}`,
        { email, status: res.status }
      )
      return 'unknown'
    }

    const data = await res.json() as { status: string; sub_status?: string }

    // Map ZeroBounce status to our simplified enum
    switch (data.status?.toLowerCase()) {
      case 'valid':
        return 'valid'
      case 'catch-all':
        return 'catch-all'
      case 'invalid':
      case 'spamtrap':
      case 'abuse':
      case 'do_not_mail':
        return 'invalid'
      default:
        return 'unknown'
    }
  } catch (err) {
    await writeDeadLetter(
      env, 'zerobounce', null, null,
      'ZEROBOUNCE_NETWORK_ERROR',
      err instanceof Error ? err.message : String(err),
      { email }
    )
    return 'unknown'
  }
}
