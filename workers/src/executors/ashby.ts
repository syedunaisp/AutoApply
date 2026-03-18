// Ashby Executor — uses the Ashby Posting API

import type { Env, UserProfile, ApplicationResult } from '@autoapply/types'

const ASHBY_BASE = 'https://api.ashbyhq.com/posting-api'

/**
 * Apply to an Ashby job posting.
 * Uses the Ashby posting-api/application/create endpoint.
 */
export async function applyAshby(
  env: Env,
  companyIdentifier: string,
  jobPostingId: string,
  profile: UserProfile,
  resumeBase64: string
): Promise<ApplicationResult> {

  // Ashby uses a JSON payload for applications
  const payload = {
    jobPostingId,
    applicationForm: {
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.personalEmail,
      phoneNumber: profile.phone || undefined,
      linkedInUrl: profile.linkedinUrl || undefined,
      githubUrl: profile.githubUrl || undefined,
      portfolioUrl: profile.portfolioUrl || undefined,
      currentCompany: profile.currentTitle || undefined,
      resumeFileContent: resumeBase64,
      resumeFileName: `${profile.firstName}_${profile.lastName}_Resume.pdf`,
    },
  }

  const res = await fetch(`${ASHBY_BASE}/application/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const responseBody = await res.json().catch(() => ({ error: 'Unable to parse response' }))

  return {
    success: res.ok,
    response: responseBody,
  }
}
