// ATS Detection + Application Router
// detectATS() is the gateway for all application submissions (Rule 4, 8)

import type { Env, UserProfile, ApplicationResult } from '@autoapply/types'
import type { ATSPlatform } from '@autoapply/types'
import { writeDeadLetter } from '../utils/dead-letter'
import { hasApplicationBeenSubmitted } from '../utils/idempotency'
import { applyGreenhouse } from './greenhouse'
import { applyLever } from './lever'
import { applyAshby } from './ashby'

/**
 * Detect ATS platform from apply URL.
 * This gates everything — called before any submission attempt.
 */
export function detectATS(applyUrl: string): ATSPlatform {
  const url = applyUrl.toLowerCase()
  if (url.includes('greenhouse.io') || url.includes('grnh.se'))    return 'greenhouse'
  if (url.includes('lever.co'))                                      return 'lever'
  if (url.includes('ashby.com') || url.includes('ashbyhq.com'))    return 'ashby'
  if (url.includes('workday.com') || url.includes('myworkdayjobs')) return 'workday_skip'
  if (url.includes('icims.com'))                                     return 'icims_skip'
  if (url.includes('taleo.net'))                                     return 'taleo_skip'
  if (url.includes('successfactors') || url.includes('sap.com'))   return 'sap_skip'
  return 'unknown'
}

/**
 * Route an application to the correct ATS executor.
 * Handles idempotency, skip platforms, and dead-letter logging.
 */
export async function routeApplication(
  env: Env,
  jobId: string,
  userId: string,
  profile: UserProfile,
  atsType: ATSPlatform,
  boardToken: string | null,
  atsJobId: string | null,
  resumeBase64: string,
  track: 'sniper' | 'shotgun',
  matchScore: number,
  resumeUrl?: string,
  resumeR2Key?: string
): Promise<{ success: boolean; status: string }> {

  // Idempotency check — never apply to the same job twice
  const alreadyApplied = await hasApplicationBeenSubmitted(env, userId, jobId)
  if (alreadyApplied) {
    return { success: false, status: 'skipped_duplicate' }
  }

  // Rule 8: Workday/iCIMS/Taleo/SAP = Immediate Skip
  if (atsType.endsWith('_skip')) {
    await saveApplication(env, {
      jobId, userId, track, matchScore,
      atsStatus: 'manual_required',
      atsResponse: JSON.stringify({ reason: `${atsType} — no public API, manual submission required` }),
      resumeUrl, resumeR2Key,
    })
    return { success: false, status: 'manual_required' }
  }

  // Unknown ATS — also manual
  if (atsType === 'unknown') {
    await saveApplication(env, {
      jobId, userId, track, matchScore,
      atsStatus: 'manual_required',
      atsResponse: JSON.stringify({ reason: 'Unknown ATS — could not detect platform' }),
      resumeUrl, resumeR2Key,
    })
    return { success: false, status: 'manual_required' }
  }

  // Validate tokens
  if (!boardToken || !atsJobId) {
    await writeDeadLetter(env, 'application', jobId, userId,
      'MISSING_ATS_TOKENS', `No board token or job ID for ${atsType}`,
      { atsType, boardToken, atsJobId })
    await saveApplication(env, {
      jobId, userId, track, matchScore,
      atsStatus: 'failed',
      atsResponse: JSON.stringify({ error: 'Missing ATS tokens' }),
      resumeUrl, resumeR2Key,
    })
    return { success: false, status: 'missing_tokens' }
  }

  // Route to the correct executor
  try {
    let result: ApplicationResult

    switch (atsType) {
      case 'greenhouse':
        result = await applyGreenhouse(env, boardToken, atsJobId, profile, resumeBase64,
          `${profile.firstName}_${profile.lastName}_Resume.pdf`)
        break
      case 'lever':
        result = await applyLever(env, boardToken, atsJobId, profile, resumeBase64)
        break
      case 'ashby':
        result = await applyAshby(env, boardToken, atsJobId, profile, resumeBase64)
        break
      default:
        throw new Error(`Unhandled ATS type: ${atsType}`)
    }

    // Save the application record — always, success or failure (Rule 3)
    await saveApplication(env, {
      jobId, userId, track, matchScore,
      atsStatus: result.success ? 'submitted' : 'failed',
      atsResponse: JSON.stringify(result.response),
      atsSubmittedAt: result.success ? Math.floor(Date.now() / 1000) : undefined,
      resumeUrl, resumeR2Key,
    })

    if (!result.success) {
      await writeDeadLetter(env, 'application', jobId, userId,
        'ATS_SUBMISSION_FAILED', `${atsType} submission returned error`,
        { atsType, response: result.response })
    }

    return { success: result.success, status: result.success ? 'submitted' : 'failed' }
  } catch (err) {
    await writeDeadLetter(env, 'application', jobId, userId,
      'ATS_EXCEPTION', err instanceof Error ? err.message : String(err),
      { atsType, boardToken, atsJobId })
    await saveApplication(env, {
      jobId, userId, track, matchScore,
      atsStatus: 'failed',
      atsResponse: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      resumeUrl, resumeR2Key,
    })
    return { success: false, status: 'exception' }
  }
}

/**
 * Save application record to D1.
 */
async function saveApplication(
  env: Env,
  data: {
    jobId: string
    userId: string
    track: string
    matchScore: number
    atsStatus: string
    atsResponse?: string
    atsSubmittedAt?: number
    resumeR2Key?: string
    resumeUrl?: string
  }
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO applications 
    (id, user_id, job_id, track, match_score, ats_status, ats_submitted_at, ats_response, 
     resume_r2_key, resume_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    data.userId,
    data.jobId,
    data.track,
    data.matchScore,
    data.atsStatus,
    data.atsSubmittedAt ?? null,
    data.atsResponse ?? null,
    data.resumeR2Key ?? null,
    data.resumeUrl ?? null,
    Math.floor(Date.now() / 1000)
  ).run()
}
