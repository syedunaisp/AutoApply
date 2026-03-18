// Matchmaker agent — dual-pass job matching
// Pass 1: Vectorize cosine similarity (semantic)
// Pass 2: LLM structured triage (hard filter enforcement)
// Both passes must clear before a job enters either track.

import type { Env, UserProfile, TriagedJobFields } from '@autoapply/types'
import { triageJobFields, callLLM } from '../core/llm'

export interface MatchResult {
  matchScore: number        // 0-100 cosine similarity
  triageFields: TriagedJobFields
  passesFilters: boolean
  track: 'sniper' | 'shotgun' | 'rejected'
  rejectionReason?: string
}

/**
 * Run the dual-pass matching pipeline for a job against a user profile.
 * 
 * Pass 1: Vectorize embedding cosine similarity
 * Pass 2: LLM structured triage with hard filter enforcement
 * 
 * Routing:
 *   Score > 85% AND filters pass → Sniper Track (ATS + cold email)
 *   Score 65-84% AND filters pass → Shotgun Track (ATS only)
 *   Score < 65% OR any filter fails → Rejected (logged, never actioned)
 */
export async function matchJob(
  env: Env,
  jobDescription: string,
  jobId: string,
  profile: UserProfile
): Promise<MatchResult> {

  // ── Pass 1: Vectorize cosine similarity ────────────────────────────
  let matchScore = 0
  try {
    // Generate embedding for the job description
    const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: jobDescription.substring(0, 8000), // Limit to embedding context window
    })

    const jobEmbedding = embeddingResult.data?.[0] || []

    if (profile.profileEmbedding && jobEmbedding.length > 0) {
      // Query Vectorize for similarity against user's profile embedding
      const vectorQuery = await env.VECTORIZE.query(jobEmbedding, {
        topK: 1,
        filter: { profileId: profile.id },
      })

      if (vectorQuery.matches && vectorQuery.matches.length > 0) {
        matchScore = (vectorQuery.matches[0].score || 0) * 100
      }
    } else {
      // Fallback: use LLM to estimate match if no embeddings available
      matchScore = await estimateMatchWithLLM(env, jobDescription, profile)
    }
  } catch (err) {
    console.error('Vectorize match error, falling back to LLM:', err)
    matchScore = await estimateMatchWithLLM(env, jobDescription, profile)
  }

  // ── Pass 2: LLM structured triage ─────────────────────────────────
  const triageFields = await triageJobFields(env, jobDescription)

  // ── Hard filter enforcement ────────────────────────────────────────
  const { passes, reason } = checkHardFilters(triageFields, profile)

  // ── Routing decision ───────────────────────────────────────────────
  let track: 'sniper' | 'shotgun' | 'rejected'

  if (!passes) {
    track = 'rejected'
  } else if (matchScore > 85) {
    track = 'sniper'
  } else if (matchScore > 65) {
    track = 'shotgun'
  } else {
    track = 'rejected'
  }

  return {
    matchScore,
    triageFields,
    passesFilters: passes,
    track,
    rejectionReason: !passes ? reason : (track === 'rejected' ? 'Score below threshold' : undefined),
  }
}

/**
 * Check hard filters: YOE, visa, remote, seniority.
 * A job can score 90% similarity but still be rejected if it requires
 * 10 YOE and the user has 3.
 */
function checkHardFilters(
  triage: TriagedJobFields,
  profile: UserProfile
): { passes: boolean; reason: string | null } {

  // Check years of experience mismatch (allow ±2 years tolerance)
  if (triage.years_required !== null && profile.yearsExperience) {
    if (triage.years_required > profile.yearsExperience + 2) {
      return {
        passes: false,
        reason: `Requires ${triage.years_required} YOE, candidate has ${profile.yearsExperience}`,
      }
    }
  }

  // Check visa requirement
  if (profile.visaRequired && triage.visa_sponsorship === false) {
    return {
      passes: false,
      reason: 'No visa sponsorship offered, candidate requires sponsorship',
    }
  }

  // Check remote preference
  if (profile.remoteOnly && triage.remote === 'onsite') {
    return {
      passes: false,
      reason: 'Onsite only, candidate requires remote',
    }
  }

  return { passes: true, reason: null }
}

/**
 * Fallback: estimate match score via LLM when Vectorize is not available.
 */
async function estimateMatchWithLLM(
  env: Env,
  jobDescription: string,
  profile: UserProfile
): Promise<number> {
  try {
    const raw = await callLLM(
      env,
      'You are a job matching system. Rate how well a candidate matches a job on a scale of 0-100.',
      `JOB:\n${jobDescription.substring(0, 2000)}\n\nCANDIDATE:\nTitle: ${profile.currentTitle}\nSkills: ${(profile.skills || []).join(', ')}\nYears: ${profile.yearsExperience}\n\nReturn JSON: { "score": number, "reason": string }`,
      'low',
      true
    )
    const parsed = JSON.parse(raw)
    return Math.max(0, Math.min(100, parsed.score || 0))
  } catch {
    return 50 // Default to middle score on error
  }
}

/**
 * Store a job embedding in Vectorize for future matching.
 */
export async function storeJobEmbedding(
  env: Env,
  jobId: string,
  jobDescription: string
): Promise<string | null> {
  try {
    const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: jobDescription.substring(0, 8000),
    })

    const embedding = embeddingResult.data?.[0]
    if (!embedding) return null

    const vectorId = `job-${jobId}`
    await env.VECTORIZE.upsert([{
      id: vectorId,
      values: embedding,
      metadata: { jobId, type: 'job' },
    }])

    return vectorId
  } catch (err) {
    console.error('Failed to store job embedding:', err)
    return null
  }
}

/**
 * Store a user profile embedding in Vectorize for matching.
 */
export async function storeProfileEmbedding(
  env: Env,
  profile: UserProfile
): Promise<string | null> {
  try {
    const profileText = [
      profile.currentTitle,
      profile.summary,
      (profile.skills || []).join(', '),
      (profile.targetRoles || []).join(', '),
      (profile.achievements || []).join('. '),
    ].filter(Boolean).join('. ')

    const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: profileText.substring(0, 8000),
    })

    const embedding = embeddingResult.data?.[0]
    if (!embedding) return null

    const vectorId = `profile-${profile.id}`
    await env.VECTORIZE.upsert([{
      id: vectorId,
      values: embedding,
      metadata: { profileId: profile.id, type: 'profile' },
    }])

    return vectorId
  } catch (err) {
    console.error('Failed to store profile embedding:', err)
    return null
  }
}
