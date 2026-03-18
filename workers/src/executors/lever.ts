// Lever Executor — uses multipart/form-data for resume upload

import type { Env, UserProfile, ApplicationResult } from '@autoapply/types'

/**
 * Apply to a Lever job posting.
 * Lever uses multipart/form-data, not JSON, for the application payload.
 * Resume is sent as a Blob, not base64.
 */
export async function applyLever(
  env: Env,
  companySlug: string,
  postingId: string,
  profile: UserProfile,
  resumeBase64: string
): Promise<ApplicationResult> {

  // Generate a brief cover note via LLM
  const coverNote = await generateCoverNote(env, profile)

  // Build multipart form — Lever requires this format
  const formData = new FormData()
  formData.append('name', `${profile.firstName} ${profile.lastName}`)
  formData.append('email', profile.personalEmail)
  formData.append('phone', profile.phone || '')
  formData.append('org', profile.currentTitle || '')
  formData.append('comments', coverNote)

  // Append URLs
  if (profile.linkedinUrl) formData.append('urls[LinkedIn]', profile.linkedinUrl)
  if (profile.githubUrl)   formData.append('urls[GitHub]', profile.githubUrl)
  if (profile.portfolioUrl) formData.append('urls[Portfolio]', profile.portfolioUrl)

  // Resume as Blob — NOT base64, NOT as attachment
  const resumeBytes = Uint8Array.from(atob(resumeBase64), c => c.charCodeAt(0))
  const resumeBlob = new Blob([resumeBytes], { type: 'application/pdf' })
  formData.append('resume', resumeBlob, `${profile.firstName}_${profile.lastName}_Resume.pdf`)

  const res = await fetch(
    `https://api.lever.co/v0/postings/${companySlug}/${postingId}/apply`,
    { method: 'POST', body: formData }
  )

  const responseBody = await res.json().catch(() => ({ error: 'Unable to parse response' }))

  return {
    success: res.ok,
    response: responseBody,
  }
}

/**
 * Generate a brief cover note for the Lever comments field.
 */
async function generateCoverNote(
  env: Env,
  profile: UserProfile
): Promise<string> {
  const result = await env.AI.run('@cf/openai/gpt-oss-120b', {
    messages: [{
      role: 'user',
      content: `Write a 2-3 sentence professional note for a job application comments field.
The candidate is ${profile.firstName} ${profile.lastName}, currently ${profile.currentTitle || 'a professional'} 
with ${profile.yearsExperience || 'several'} years of experience.
Key skills: ${(profile.skills || []).slice(0, 5).join(', ')}.
Keep it brief, professional, and genuine. No generic phrases like "I am passionate about".
Return ONLY the text, no JSON wrapping.`,
    }],
    reasoning: { effort: 'low' },
  })

  return result.response || ''
}
