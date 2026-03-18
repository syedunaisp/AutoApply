// PDF Generator — Template Injection Pattern
// IMPORTANT: Never build a resume from scratch in the Worker.
// Always fetch the base template from R2 and inject text only.
// Never embed fonts — all font embedding happens at template creation time.
// Never attach PDFs to emails — use the R2 public URL as a link (Rule 5).

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import type { Env, UserProfile, WorkExperience } from '@autoapply/types'

interface ResumeData {
  firstName: string
  lastName: string
  email: string
  phone: string
  location: string
  linkedinUrl: string
  githubUrl: string
  summary: string
  bullets: string[]       // LLM-rewritten bullets for this specific job
  skills: string[]
  experience: WorkExperience[]
  education: Array<{ institution: string; degree: string; field?: string }>
}

/**
 * Generate a tailored resume PDF by injecting text into a pre-rendered R2 template.
 * Returns the R2 key and public URL for the generated PDF.
 * 
 * The public URL is used in cold emails as a LINK, never as an attachment.
 */
export async function generateTailoredResume(
  env: Env,
  data: ResumeData,
  jobId: string,
  userId: string
): Promise<{ r2Key: string; publicUrl: string }> {

  // Fetch base template from R2
  const templateObj = await env.R2.get('templates/base-resume.pdf')
  if (!templateObj) throw new Error('Resume template not found in R2')

  const templateBytes = await templateObj.arrayBuffer()
  const pdfDoc = await PDFDocument.load(templateBytes)

  // Get the first page and inject text into predefined positions
  const page = pdfDoc.getPages()[0]
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // ── Header ─────────────────────────────────────────────────────────
  page.drawText(`${data.firstName} ${data.lastName}`, {
    x: 50, y: 740, size: 20, font: fontBold, color: rgb(0, 0, 0),
  })

  // Contact info line
  const contactParts = [data.email, data.phone, data.location].filter(Boolean)
  page.drawText(contactParts.join(' • '), {
    x: 50, y: 718, size: 9, font, color: rgb(0.3, 0.3, 0.3),
  })

  // Links line
  const linkParts = [data.linkedinUrl, data.githubUrl].filter(Boolean)
  if (linkParts.length > 0) {
    page.drawText(linkParts.join(' • '), {
      x: 50, y: 706, size: 8, font, color: rgb(0.2, 0.2, 0.7),
    })
  }

  // ── Summary ────────────────────────────────────────────────────────
  if (data.summary) {
    page.drawText('PROFESSIONAL SUMMARY', {
      x: 50, y: 685, size: 11, font: fontBold, color: rgb(0, 0, 0),
    })
    page.drawText(data.summary, {
      x: 50, y: 670, size: 9.5, font, maxWidth: 500, lineHeight: 13, color: rgb(0, 0, 0),
    })
  }

  // ── Experience Bullets (LLM-tailored for this specific job) ────────
  let y = 630
  page.drawText('EXPERIENCE', {
    x: 50, y, size: 11, font: fontBold, color: rgb(0, 0, 0),
  })
  y -= 18

  // Write experience entries
  for (const exp of data.experience) {
    if (y < 80) break // Don't overflow the page

    page.drawText(`${exp.title} — ${exp.company}`, {
      x: 50, y, size: 10, font: fontBold, color: rgb(0, 0, 0),
    })
    const dateRange = `${exp.startDate}${exp.endDate ? ` – ${exp.endDate}` : ' – Present'}`
    page.drawText(dateRange, {
      x: 400, y, size: 8, font, color: rgb(0.4, 0.4, 0.4),
    })
    y -= 14
  }

  // Write tailored bullets
  for (const bullet of data.bullets) {
    if (y < 60) break
    page.drawText(`• ${bullet}`, {
      x: 60, y, size: 9.5, font, maxWidth: 490, color: rgb(0, 0, 0),
    })
    y -= 16
  }

  // ── Skills ─────────────────────────────────────────────────────────
  if (data.skills.length > 0 && y > 100) {
    y -= 10
    page.drawText('SKILLS', {
      x: 50, y, size: 11, font: fontBold, color: rgb(0, 0, 0),
    })
    y -= 16
    page.drawText(data.skills.join(' • '), {
      x: 50, y, size: 9, font, maxWidth: 500, lineHeight: 13, color: rgb(0, 0, 0),
    })
  }

  // ── Education ──────────────────────────────────────────────────────
  if (data.education.length > 0 && y > 80) {
    y -= 24
    page.drawText('EDUCATION', {
      x: 50, y, size: 11, font: fontBold, color: rgb(0, 0, 0),
    })
    y -= 16
    for (const edu of data.education) {
      if (y < 40) break
      page.drawText(`${edu.degree}${edu.field ? ` in ${edu.field}` : ''} — ${edu.institution}`, {
        x: 50, y, size: 9.5, font, color: rgb(0, 0, 0),
      })
      y -= 14
    }
  }

  // ── Save to R2 ─────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save()
  const r2Key = `resumes/${userId}/${jobId}-${Date.now()}.pdf`

  await env.R2.put(r2Key, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' },
  })

  // Return public URL — used in emails as a LINK, never as an attachment
  const publicUrl = `${env.R2_PUBLIC_URL}/${r2Key}`

  return { r2Key, publicUrl }
}
