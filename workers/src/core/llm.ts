// Workers AI LLM wrapper for @cf/openai/gpt-oss-120b
// Supports reasoning.effort levels: low (classification), medium (emails), high (resume rewriting)
// Always uses json_object mode for structured output — never parse free-text with regex

import type { Env, TriagedJobFields, UserProfile } from '@autoapply/types'

export type ReasoningEffort = 'low' | 'medium' | 'high'

/**
 * Core LLM call wrapper.
 * Uses @cf/openai/gpt-oss-120b via Cloudflare Workers AI binding.
 */
export async function callLLM(
  env: Env,
  systemPrompt: string,
  userPrompt: string,
  effort: ReasoningEffort = 'medium',
  jsonMode: boolean = false
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = []

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: userPrompt })

  const options: any = {
    messages,
    thinking: {
      type: 'enabled',
      budget_tokens: effort === 'high' ? 4096 : effort === 'medium' ? 2048 : 1024
    },
    max_tokens: 2048,
  }

  if (jsonMode) {
    options.response_format = { type: 'json_object' }
  }

  const result = await env.AI.run('@cf/openai/gpt-oss-120b', options)
  return result.response || result.result?.response || ''
}

/**
 * Rewrite resume bullets for a specific job description.
 * Uses HIGH reasoning effort — quality is visible to humans.
 */
export async function rewriteResumeBullets(
  env: Env,
  profile: UserProfile,
  jobDescription: string
): Promise<string[]> {
  const raw = await callLLM(
    env,
    `You are an expert resume writer. Rewrite bullet points to be highly relevant to the specific job description. 
     Use strong action verbs. Include specific metrics where they exist in the profile. 
     Keep each bullet under 20 words. Do not invent metrics that aren't in the profile.`,
    `JOB DESCRIPTION:\n${jobDescription}\n\nPROFILE EXPERIENCE:\n${JSON.stringify(profile.experience)}\n\nACHIEVEMENTS:\n${JSON.stringify(profile.achievements)}\n\nReturn JSON: { "bullets": string[] }`,
    'high',
    true
  )

  try {
    const parsed = JSON.parse(raw)
    return parsed.bullets || []
  } catch {
    // Retry once on malformed JSON
    const retry = await callLLM(
      env,
      'Return ONLY valid JSON. No markdown, no explanation.',
      `Rewrite these resume bullets for this job:\n\nJOB:\n${jobDescription.substring(0, 1000)}\n\nBULLETS:\n${JSON.stringify(profile.achievements)}\n\nReturn JSON: { "bullets": string[] }`,
      'high',
      true
    )
    const retryParsed = JSON.parse(retry)
    return retryParsed.bullets || []
  }
}

/**
 * LLM triage of job fields — extract structured data from job description.
 * Uses LOW reasoning effort — fast classification task.
 */
export async function triageJobFields(
  env: Env,
  jobDescription: string
): Promise<TriagedJobFields> {
  const raw = await callLLM(
    env,
    'Extract structured fields from this job description. Return only JSON.',
    `${jobDescription}\n\nReturn JSON: { "years_required": number|null, "seniority": "junior"|"mid"|"senior"|"staff"|"principal"|null, "visa_sponsorship": boolean|null, "remote": "remote"|"hybrid"|"onsite"|null }`,
    'low',
    true
  )

  try {
    return JSON.parse(raw) as TriagedJobFields
  } catch {
    return {
      years_required: null,
      seniority: null,
      visa_sponsorship: null,
      remote: null,
    }
  }
}
