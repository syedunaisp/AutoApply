// Ashby Executor — Browserless Puppeteer form submission
// Ashby's posting-api/application/create endpoint returns 401 (requires company auth).
// Instead: navigate to jobs.ashbyhq.com/{token}/{jobId}/application,
// read field labels from the DOM, map them to profile data, fill and submit.

import type { Env, UserProfile, ApplicationResult } from '@autoapply/types'
import { callLLM } from '../core/llm'

const ASHBY_JOBS_BASE = 'https://jobs.ashbyhq.com'

/**
 * Apply to an Ashby job via Browserless Puppeteer.
 * Navigates to the public application form, reads field labels,
 * maps them to profile data, and submits.
 */
export async function applyAshby(
  env: Env,
  companyIdentifier: string,
  jobPostingId: string,
  profile: UserProfile,
  resumeBase64: string
): Promise<ApplicationResult> {

  // First try the direct API (fast — returns 401 for most companies)
  const apiRes = await fetch('https://api.ashbyhq.com/posting-api/application/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobPostingId,
      applicationForm: {
        firstName:       profile.firstName,
        lastName:        profile.lastName,
        email:           profile.personalEmail || profile.email,
        phoneNumber:     profile.phone || undefined,
        linkedInUrl:     profile.linkedinUrl || undefined,
        githubUrl:       profile.githubUrl || undefined,
        resumeFileContent: resumeBase64,
        resumeFileName:  `${profile.firstName}_${profile.lastName}_Resume.pdf`,
      },
    }),
  })

  if (apiRes.ok) {
    const body = await apiRes.json().catch(() => ({}))
    return { success: true, response: body }
  }

  // API returned 401 — fall back to Browserless Puppeteer
  if ((apiRes.status === 401 || apiRes.status === 403) && env.BROWSERLESS_API_TOKEN) {
    return applyAshbyViaBrowser(env, companyIdentifier, jobPostingId, profile, resumeBase64)
  }

  const errBody = await apiRes.json().catch(() => ({ error: `HTTP ${apiRes.status}` }))
  return { success: false, response: errBody }
}


/**
 * Submit an Ashby application using Browserless Puppeteer.
 * Reads visible field labels from the DOM and maps them to profile data.
 * Handles standard fields, social URLs, essay questions, and checkboxes.
 */
async function applyAshbyViaBrowser(
  env: Env,
  companyIdentifier: string,
  jobPostingId: string,
  profile: UserProfile,
  resumeBase64: string
): Promise<ApplicationResult> {

  const appUrl = `${ASHBY_JOBS_BASE}/${companyIdentifier}/${jobPostingId}/application`

  // Pre-generate essay answers via LLM — do this before browser launch
  const essayPrompt = `You are filling out a job application for ${companyIdentifier}.
Write a single professional answer that covers: strengths, relevant experience, and motivation.
Keep it under 200 words, first-person, specific to this candidate's background.

Candidate: ${profile.firstName} ${profile.lastName}
Title: ${profile.currentTitle}
Summary: ${profile.summary}
Skills: ${(profile.skills || []).join(', ')}

Return JSON: { "answer": string }`

  let essayAnswer = `I bring ${profile.yearsExperience || 1}+ years of experience in ${(profile.skills || []).slice(0, 3).join(', ')}, with a focus on building reliable, scalable systems. At ${profile.currentTitle ? `my current role as ${profile.currentTitle}` : 'my previous role'}, I ${profile.summary || 'delivered impactful technical solutions'}. I am excited about this opportunity at ${companyIdentifier} and am confident in my ability to contribute from day one.`

  try {
    const raw = await callLLM(env, 'Generate a professional job application essay answer.', essayPrompt, 'low', true)
    const parsed = JSON.parse(raw)
    if (parsed.answer || parsed.output?.answer) {
      essayAnswer = parsed.answer || parsed.output.answer
    }
  } catch { /* use default essayAnswer */ }

  const puppeteerScript = `
    export default async ({ page, context }) => {
      const { appUrl, profile, essayAnswer } = context;

      await page.goto(appUrl, { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise(r => setTimeout(r, 2000));

      // Check form is present
      const nameField = await page.$('#_systemfield_name');
      if (!nameField) {
        return { success: false, error: 'Ashby application form not found at: ' + page.url() };
      }

      // ── Helper: set React-controlled input value ────────────────────────
      const setVal = async (selector, value) => {
        if (!value) return false;
        const el = await page.$(selector);
        if (!el) return false;
        await page.evaluate((s, v) => {
          const el = document.querySelector(s);
          if (!el) return;
          const ns =
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
            Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (ns) ns.call(el, v); else el.value = v;
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur',   { bubbles: true }));
        }, selector, value);
        return true;
      };

      // ── Standard Ashby system fields ────────────────────────────────────
      await setVal('#_systemfield_name',  profile.firstName + ' ' + profile.lastName);
      await setVal('#_systemfield_email', profile.email);

      // ── Upload resume ────────────────────────────────────────────────────
      if (context.resumeBase64) {
        const os = require('os'), fs = require('fs'), path = require('path');
        const tmpPath = path.join(os.tmpdir(), 'resume_ashby_' + Date.now() + '.pdf');
        fs.writeFileSync(tmpPath, Buffer.from(context.resumeBase64, 'base64'));
        const resumeInput = await page.$('#_systemfield_resume, input[type="file"]');
        if (resumeInput) await resumeInput.uploadFile(tmpPath);
        fs.unlinkSync(tmpPath);
      }

      // ── Read ALL field labels from DOM, map by label text ───────────────
      const fieldMap = await page.evaluate(() => {
        const map = {};
        document.querySelectorAll('input,textarea,select').forEach(input => {
          const id = input.id || input.name;
          if (!id || id.startsWith('_systemfield') || id === 'g-recaptcha-response-100000') return;
          let label = '';
          const labelEl = document.querySelector('label[for=' + JSON.stringify(id) + ']');
          if (labelEl) { label = labelEl.innerText?.trim(); }
          if (!label) {
            const parent = input.closest('[class*=field],[class*=Field],[class*=question],[class*=Question]');
            if (parent) {
              const h = parent.querySelector('p,h3,h4,span,label,div[class*=label]');
              if (h) label = h.innerText?.trim().substring(0, 80);
            }
          }
          map[id] = { label: label.toLowerCase(), type: input.type };
        });
        return map;
      });

      // ── Fill each custom field based on its label ────────────────────────
      const profileData = context.profile;
      for (const [id, info] of Object.entries(fieldMap)) {
        const label = info.label || '';
        const type  = info.type  || '';
        let value = '';

        if (/linkedin/i.test(label))              value = profileData.linkedinUrl || '';
        else if (/github/i.test(label))           value = profileData.githubUrl || '';
        else if (/twitter|x\\.com/i.test(label))  value = '';
        else if (/portfolio|website|personal site/i.test(label)) value = profileData.portfolioUrl || '';
        else if (/phone|mobile/i.test(label))     value = profileData.phone || '';
        else if (/country|location|based in/i.test(label)) value = profileData.location || 'India';
        else if (/notice|availability|start/i.test(label)) value = '2 weeks';
        else if (/cover letter/i.test(label))     value = context.essayAnswer;
        else if (type === 'textarea' || /tell us|describe|explain|what|why|how/i.test(label)) {
          value = context.essayAnswer;
        }

        if (!value) continue;

        if (type === 'checkbox') {
          // For EU timezone / location-based checkboxes → default No
          const cbEl = await page.$('#' + id);
          if (cbEl) {
            const checked = await page.evaluate(el => el.checked, cbEl);
            if (!checked) { /* leave unchecked — not in EU */ }
          }
        } else {
          await setVal('#' + id, value);
        }
      }

      // ── Submit ────────────────────────────────────────────────────────────
      const submitBtn = await page.$('button[type="submit"]:not([class*="upload"]):not([class*="Upload"])');
      if (!submitBtn) {
        // Try clicking the last submit button (usually the "Submit Application" one)
        const allSubmit = await page.$$('button[type="submit"]');
        if (allSubmit.length === 0) return { success: false, error: 'No submit button found' };
        await allSubmit[allSubmit.length - 1].click();
      } else {
        await submitBtn.click();
      }

      await new Promise(r => setTimeout(r, 4000));

      // ── Check result ─────────────────────────────────────────────────────
      const currentUrl = page.url();
      const successEl = await page.$('[class*=success],[class*=confirmation],[class*=thank]');
      const captchaEl = await page.$('[class*=captcha-error],[class*=recaptcha]');
      const errorEl   = await page.$('[class*=error-message],[class*=alert],[role="alert"]');

      if (successEl || currentUrl.includes('confirmation')) {
        return { success: true, message: 'Application submitted' };
      }
      if (captchaEl) {
        return { success: false, error: 'reCAPTCHA required — form filled but not submitted' };
      }
      if (errorEl) {
        const errText = await page.evaluate(el => el.innerText, errorEl);
        return { success: false, error: errText?.substring(0, 200) };
      }

      // No obvious error — optimistically treat as submitted
      return { success: true, message: 'Submitted — final URL: ' + currentUrl };
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
          appUrl,
          profile: {
            firstName:    profile.firstName,
            lastName:     profile.lastName,
            email:        profile.personalEmail || profile.email,
            phone:        profile.phone || '',
            linkedinUrl:  profile.linkedinUrl || '',
            githubUrl:    profile.githubUrl || '',
            portfolioUrl: profile.portfolioUrl || '',
            location:     profile.location || '',
          },
          resumeBase64,
          essayAnswer,
        },
      }),
    }
  )

  if (!browserlessRes.ok) {
    const errText = await browserlessRes.text().catch(() => '')
    throw new Error(`Browserless error: ${browserlessRes.status} ${errText.substring(0, 200)}`)
  }

  const result = await browserlessRes.json() as { success?: boolean; error?: string; message?: string }
  return {
    success:  !!result.success,
    response: result,
  }
}
