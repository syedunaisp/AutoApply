// Greenhouse Executor — TWO STEPS, NEVER ONE (Rule 4)
// Step 1: Fetch job schema with ?questions=true (MANDATORY)
// Step 2: LLM generates answers to all custom questions
// Step 3a: Try direct REST API (fast — works if company has public API access)
// Step 3b: If 401/403 → fall back to Browserless.io Playwright (handles CSRF + JS rendering)

import type { Env, UserProfile, ApplicationResult, GreenhouseQuestion } from '@autoapply/types'
import { callLLM } from '../core/llm'

const BASE       = 'https://boards-api.greenhouse.io/v1/boards'
const BOARD_BASE = 'https://boards.greenhouse.io'

/**
 * Apply to a Greenhouse job. Always two steps + one of two submission paths:
 * 1. Fetch the job schema with custom questions
 * 2. LLM generates answers
 * 3. Try direct API → on 401/403 fall through to Browserless Playwright
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

  const schema = await schemaRes.json() as { title?: string; questions: GreenhouseQuestion[] }

  // ── STEP 2: LLM generates answers to all questions ───────────────────
  const answers = await generateQuestionAnswers(env, schema.questions || [], profile)

  // ── STEP 3a: Try direct REST API first ───────────────────────────────
  const payload = {
    first_name:               profile.firstName,
    last_name:                profile.lastName,
    email:                    profile.personalEmail || profile.email,
    phone:                    profile.phone || '',
    resume_content:           resumeBase64,
    resume_content_filename:  resumeFilename,
    answers: answers.map(a => ({
      question_id: a.questionId,
      answer: a.answer,
    })),
  }

  const directRes = await fetch(`${BASE}/${boardToken}/jobs/${jobId}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })

  // Success — company has public API access configured
  if (directRes.status === 200 || directRes.status === 201) {
    const body = await directRes.json().catch(() => ({}))
    return { success: true, response: body }
  }

  // ── STEP 3b: API returned auth error — use Browserless Playwright ─────
  // Greenhouse's REST API requires a private company API key.
  // Browserless.io runs a real Chromium browser that handles CSRF tokens,
  // JavaScript rendering, and session cookies automatically.
  if ((directRes.status === 401 || directRes.status === 403) && env.BROWSERLESS_API_TOKEN) {
    return applyGreenhouseViaBrowser(env, boardToken, jobId, profile, resumeBase64, resumeFilename, answers)
  }

  // No Browserless token configured — return the API failure
  const directBody = await directRes.json().catch(() => ({ error: `HTTP ${directRes.status}` }))
  return { success: false, response: directBody }
}


/**
 * Submit a Greenhouse application via Browserless.io managed Playwright.
 * Navigates to the real job board page, fills the form, and submits.
 * Handles CSRF tokens and JavaScript rendering automatically.
 */
async function applyGreenhouseViaBrowser(
  env: Env,
  boardToken: string,
  jobId: string,
  profile: UserProfile,
  resumeBase64: string,
  _resumeFilename: string,
  answers: Array<{ questionId: number; answer: string | number }>
): Promise<ApplicationResult> {

  const jobUrl = `${BOARD_BASE}/${boardToken}/jobs/${jobId}`

  // The Playwright script runs inside Browserless's Chromium instance.
  // We pass profile data via the `context` object so no strings need escaping.
  const playwrightScript = `
    export default async ({ page, context }) => {
      const { profile, answers, jobUrl } = context;

      await page.goto(jobUrl, { waitUntil: 'networkidle', timeout: 30000 });

      // Fill standard fields — Greenhouse uses consistent IDs
      await page.fill('#first_name', profile.firstName || '');
      await page.fill('#last_name',  profile.lastName  || '');
      await page.fill('#email',      profile.email     || '');
      if (profile.phone) await page.fill('#phone', profile.phone);

      // Upload resume — convert base64 to a temporary file input
      if (context.resumeBase64) {
        const resumeBuffer = Buffer.from(context.resumeBase64, 'base64');
        await page.setInputFiles('#resume', {
          name:     'resume.pdf',
          mimeType: 'application/pdf',
          buffer:   resumeBuffer,
        });
      }

      // Fill LinkedIn / website URLs if fields exist
      const linkedinField = await page.$('#job_application_linkedin_profile_url');
      if (linkedinField && profile.linkedinUrl) await linkedinField.fill(profile.linkedinUrl);

      const websiteField = await page.$('#job_application_website');
      if (websiteField && profile.portfolioUrl) await websiteField.fill(profile.portfolioUrl);

      // Answer each custom question
      for (const answer of answers) {
        const qId = answer.questionId;
        const val = String(answer.answer);

        // Text inputs
        const textInput = await page.$('input[name="answers[' + qId + '][value]"], textarea[name="answers[' + qId + '][value]"]');
        if (textInput) { await textInput.fill(val); continue; }

        // Select / dropdown
        const selectEl = await page.$('select[name="answers[' + qId + '][value]"]');
        if (selectEl) { await selectEl.selectOption({ value: val }); continue; }

        // Radio (yes/no)
        const radio = await page.$('input[type="radio"][name="answers[' + qId + '][value]"][value="' + val + '"]');
        if (radio) { await radio.check(); continue; }
      }

      // Submit the form
      const submitBtn = await page.$('button[data-submits="true"], input[type="submit"], button[type="submit"]');
      if (!submitBtn) return { success: false, error: 'Submit button not found' };

      await Promise.all([
        page.waitForNavigation({ timeout: 20000 }).catch(() => {}),
        submitBtn.click(),
      ]);

      // Check for success — Greenhouse shows a confirmation section
      const confirmed = await page.$('.application-confirmation, [data-confirmation], .success-message');
      const errorMsg  = await page.$('.error, .alert-danger');

      if (confirmed) return { success: true, message: 'Application submitted successfully' };
      if (errorMsg)  return { success: false, error: await errorMsg.innerText() };

      // If redirected away from the board page, treat as success
      const finalUrl = page.url();
      const redirectedAway = !finalUrl.includes('greenhouse.io');
      return { success: redirectedAway, message: finalUrl };
    }
  `

  const browserlessRes = await fetch(
    `https://chrome.browserless.io/function?token=${env.BROWSERLESS_API_TOKEN}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: playwrightScript,
        context: {
          jobUrl,
          profile: {
            firstName:    profile.firstName,
            lastName:     profile.lastName,
            email:        profile.personalEmail || profile.email,
            phone:        profile.phone || '',
            linkedinUrl:  profile.linkedinUrl || '',
            portfolioUrl: profile.portfolioUrl || '',
          },
          resumeBase64,
          answers,
        },
      }),
    }
  )

  if (!browserlessRes.ok) {
    const errText = await browserlessRes.text().catch(() => '')
    throw new Error(`Browserless request failed: ${browserlessRes.status} ${errText.substring(0, 200)}`)
  }

  const result = await browserlessRes.json() as { success?: boolean; error?: string; message?: string }
  return {
    success:  !!result.success,
    response: result,
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
  if (!questions || questions.length === 0) return []

  const prompt = `You are filling out a job application on behalf of a candidate.
Answer each question based on the candidate profile below.

CANDIDATE PROFILE:
${JSON.stringify({
    firstName:     profile.firstName,
    lastName:      profile.lastName,
    currentTitle:  profile.currentTitle,
    yearsExperience: profile.yearsExperience,
    skills:        profile.skills,
    location:      profile.location,
    linkedinUrl:   profile.linkedinUrl,
    githubUrl:     profile.githubUrl,
    portfolioUrl:  profile.portfolioUrl,
    visaRequired:  profile.visaRequired,
    summary:       profile.summary,
  }, null, 2)}

CACHED PREVIOUS ANSWERS (for consistency):
${JSON.stringify(profile.cachedAnswers || {}, null, 2)}

QUESTIONS TO ANSWER:
${JSON.stringify(questions, null, 2)}

RULES:
- yes_no: return exactly "Yes" or "No"
- dropdown: return the exact integer "value" field from the options list
- long_text: 150-250 words, professional, first-person
- short_text: under 50 words
- url: use the relevant URL from their profile
- multi_select: return array of selected values
- Never mention AI or automation

Return JSON: { "answers": [{ "questionId": number, "answer": string | number }] }`

  const raw = await callLLM(env, 'You generate structured job application answers.', prompt, 'medium', true)

  try {
    const parsed = JSON.parse(raw)
    return (parsed.output ?? parsed).answers || []
  } catch {
    return []
  }
}
