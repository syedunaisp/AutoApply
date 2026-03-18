// Greenhouse Executor — TWO STEPS, NEVER ONE (Rule 4)
// Step 1: Fetch job schema with ?questions=true (MANDATORY)
// Step 2: LLM generates answers to all custom questions
// Step 3: POST the full application payload with answered questions

import type { Env, UserProfile, ApplicationResult, GreenhouseQuestion } from '@autoapply/types'

const BASE = 'https://boards-api.greenhouse.io/v1/boards'

/**
 * Apply to a Greenhouse job. This is ALWAYS a two-step process:
 * 1. Fetch the job schema with custom questions
 * 2. Submit the application with LLM-generated answers
 * 
 * NEVER submit without first fetching the schema.
 * Jobs without custom question answers are silently rejected by Greenhouse.
 */
export async function applyGreenhouse(
  env: Env,
  boardToken: string,
  jobId: string,
  profile: UserProfile,
  resumeBase64: string,
  resumeFilename: string
): Promise<ApplicationResult> {

  // ── STEP 1: Fetch job schema with questions — MANDATORY ──────────────
  const schemaRes = await fetch(
    `${BASE}/${boardToken}/jobs/${jobId}?questions=true`
  )

  if (!schemaRes.ok) {
    throw new Error(`Greenhouse schema fetch failed: ${schemaRes.status}`)
  }

  const schema = await schemaRes.json() as { questions: GreenhouseQuestion[] }

  // ── STEP 2: LLM generates answers to all questions ───────────────────
  const answers = await generateQuestionAnswers(env, schema.questions || [], profile)

  // ── STEP 3: Build and submit the application payload ─────────────────
  const payload = {
    first_name: profile.firstName,
    last_name: profile.lastName,
    email: profile.personalEmail,
    phone: profile.phone || '',
    resume_content: resumeBase64,
    resume_content_filename: resumeFilename,
    answers: answers.map(a => ({
      question_id: a.questionId,
      answer: a.answer,
    })),
  }

  const submitRes = await fetch(
    `${BASE}/${boardToken}/jobs/${jobId}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  )

  const responseBody = await submitRes.json().catch(() => ({ error: 'Unable to parse response' }))

  return {
    success: submitRes.status === 200 || submitRes.status === 201,
    response: responseBody,
  }
}

/**
 * Use the LLM to generate answers for all Greenhouse custom questions.
 * Answers are based on the candidate's profile and cached answers for consistency.
 */
async function generateQuestionAnswers(
  env: Env,
  questions: GreenhouseQuestion[],
  profile: UserProfile
): Promise<Array<{ questionId: number; answer: string | number }>> {
  // If no questions, return empty answers
  if (!questions || questions.length === 0) {
    return []
  }

  const prompt = `
You are filling out a job application on behalf of a candidate. 
Answer each question based on the candidate's profile below.

CANDIDATE PROFILE:
${JSON.stringify({
    firstName: profile.firstName,
    lastName: profile.lastName,
    currentTitle: profile.currentTitle,
    yearsExperience: profile.yearsExperience,
    skills: profile.skills,
    location: profile.location,
    linkedinUrl: profile.linkedinUrl,
    githubUrl: profile.githubUrl,
    portfolioUrl: profile.portfolioUrl,
    visaRequired: profile.visaRequired,
    summary: profile.summary,
  }, null, 2)}

CACHED PREVIOUS ANSWERS (for consistency):
${JSON.stringify(profile.cachedAnswers || {}, null, 2)}

QUESTIONS TO ANSWER:
${JSON.stringify(questions, null, 2)}

RULES:
- For yes_no questions: return exactly "Yes" or "No"
- For dropdown questions: return the exact "value" field (integer) from the options list, not the label
- For long_text questions: write 150-250 words, professional, first-person, specific to their experience
- For short_text questions: be concise, under 50 words
- For url questions: use the relevant URL from their profile
- For multi_select questions: return an array of the selected values
- Do not mention AI or automation anywhere

Return ONLY a JSON object: { "answers": [{ "questionId": number, "answer": string | number }] }
`

  const result = await env.AI.run('@cf/openai/gpt-oss-120b', {
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    reasoning: { effort: 'high' },
  })

  try {
    const parsed = JSON.parse(result.response || '{}')
    return parsed.answers || parsed || []
  } catch {
    // If LLM returns malformed JSON, retry once
    const retryResult = await env.AI.run('@cf/openai/gpt-oss-120b', {
      messages: [{ role: 'user', content: prompt + '\n\nPREVIOUS ATTEMPT RETURNED INVALID JSON. Please return ONLY valid JSON.' }],
      response_format: { type: 'json_object' },
      reasoning: { effort: 'high' },
    })

    const retryParsed = JSON.parse(retryResult.response || '{}')
    return retryParsed.answers || retryParsed || []
  }
}
