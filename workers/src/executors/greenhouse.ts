// Greenhouse Executor — TWO STEPS, NEVER ONE (Rule 4)
// Step 1: Fetch job schema with ?questions=true (MANDATORY)
// Step 2: LLM generates answers to all custom questions
// Step 3a: Try direct REST API (fast — works if company has public API access)
// Step 3b: If 401/403 → fall back to Browserless.io Playwright (handles CSRF + JS rendering)

import type { Env, UserProfile, ApplicationResult, GreenhouseQuestion } from '@autoapply/types'
import { callLLM } from '../core/llm'

const BASE       = 'https://boards-api.greenhouse.io/v1/boards'
// Greenhouse migrated the job board UI to job-boards.greenhouse.io
// This is where the React SPA renders the actual application form
const BOARD_BASE = 'https://job-boards.greenhouse.io'

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
  // NOTE: Browserless /function endpoint uses Puppeteer API, not Playwright.
  // Use page.evaluate() + native value setter for React form filling.
  // page.fill() is Playwright-only and will throw here.
  const puppeteerScript = `
    export default async ({ page, context }) => {
      const { profile, answers, jobUrl } = context;

      await page.goto(jobUrl, { waitUntil: 'networkidle0', timeout: 30000 });

      // Wait for Greenhouse React SPA to hydrate and render the form
      try {
        await page.waitForSelector('#first_name', { timeout: 10000 });
      } catch (e) {
        return { success: false, error: 'Form not rendered — company uses custom career page: ' + page.url() };
      }

      // Helper: set value on a React-controlled input and trigger synthetic events
      const setInputValue = async (selector, value) => {
        if (!value) return;
        await page.evaluate((sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const nativeSetter =
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeSetter) nativeSetter.call(el, val); else el.value = val;
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, selector, value);
      };

      // Fill standard fields — consistent across all Greenhouse boards
      await setInputValue('#first_name', profile.firstName || '');
      await setInputValue('#last_name',  profile.lastName  || '');
      await setInputValue('#email',      profile.email     || '');
      await setInputValue('#phone',      profile.phone     || '');

      // Upload resume — base64 → tmp file → Puppeteer file input
      if (context.resumeBase64) {
        const os   = require('os');
        const fs   = require('fs');
        const path = require('path');
        const tmpPath = path.join(os.tmpdir(), 'resume_' + Date.now() + '.pdf');
        fs.writeFileSync(tmpPath, Buffer.from(context.resumeBase64, 'base64'));
        const resumeInput = await page.$('input[name="resume"], #resume, input[type="file"][accept*="pdf"]');
        if (resumeInput) await resumeInput.uploadFile(tmpPath);
        fs.unlinkSync(tmpPath);
      }

      // LinkedIn URL field
      await setInputValue('input[id*="linkedin"], input[name*="linkedin"]', profile.linkedinUrl || '');

      // Answer custom questions (named question_XXXXXXXX in the new Greenhouse UI)
      for (const answer of answers) {
        const qId = answer.questionId;
        const val = String(answer.answer);

        const textSel = 'input[name="question_' + qId + '"], textarea[name="question_' + qId + '"], input[id="question_' + qId + '"], textarea[id="question_' + qId + '"]';
        const textEl = await page.$(textSel);
        if (textEl) { await setInputValue(textSel.split(',')[0].trim(), val); continue; }

        const selectEl = await page.$('select[name="question_' + qId + '"], select[id="question_' + qId + '"]');
        if (selectEl) { await page.select('select[name="question_' + qId + '"]', val); continue; }

        const radioEl = await page.$('input[type="radio"][name="question_' + qId + '"][value="' + val + '"]');
        if (radioEl) { await radioEl.click(); continue; }
      }

      // Submit the form
      const submitBtn = await page.$('button[data-submits="true"], button[type="submit"], input[type="submit"]');
      if (!submitBtn) return { success: false, error: 'Submit button not found' };

      await Promise.all([
        page.waitForNavigation({ timeout: 20000 }).catch(() => {}),
        submitBtn.click(),
      ]);

      // Greenhouse renders a confirmation block after successful submission
      const confirmed = await page.$('[data-confirmation], .application-confirmation, .confirmation, [class*="confirmation"]');
      if (confirmed) return { success: true, message: 'Application submitted successfully' };

      const errorEl = await page.$('.error-message, .alert-danger, [role="alert"]');
      if (errorEl) {
        const errText = await page.evaluate(el => el.innerText, errorEl);
        return { success: false, error: errText };
      }

      return { success: true, message: 'Submitted — final URL: ' + page.url() };
    }
  `

  const browserlessRes = await fetch(
    `https://chrome.browserless.io/function?token=${env.BROWSERLESS_API_TOKEN}`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: puppeteerScript,
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
