// Sourcer agent — calls the Python scraper VPS and logs results to D1
// Two sources:
//   1. /jobs/ats  — Greenhouse + Ashby boards directly (real ATS URLs, descriptions included)
//   2. /jobs      — jobspy LinkedIn/Indeed/Glassdoor (broad discovery, ~20% have direct URLs)
// Includes the CRITICAL zero-result alert guard

import type { Env, RawScrapedJob, ScraperResponse } from '@autoapply/types'
import { writeDeadLetter, sendAdminAlert } from '../utils/dead-letter'

/**
 * Call the Python scraper VPS to fetch job listings.
 * Queries both the ATS-direct endpoint and the jobspy endpoint, merges results.
 * ALWAYS logs the scrape run to D1, even on zero results.
 * CRITICAL: Fires an admin alert on zero results (silent failure guard).
 */
export async function runScraper(
  env: Env,
  keywords: string,
  location: string
): Promise<RawScrapedJob[]> {
  const scraperUrl = env.SCRAPER_URL
  const headers = { 'X-API-Key': env.SCRAPER_API_KEY ?? '' }
  const startTime = Date.now()

  // ── Source 1: ATS boards directly (Greenhouse + Ashby) ─────────────────
  // These return real boards.greenhouse.io / jobs.ashbyhq.com URLs that
  // detectATS() can route to the correct executor. Run this first so
  // high-quality jobs are always included regardless of jobspy quota.
  let atsJobs: RawScrapedJob[] = []
  try {
    const atsRes = await fetch(
      `${scraperUrl}/jobs/ats?keywords=${encodeURIComponent(keywords)}`,
      { headers }
    )
    if (atsRes.ok) {
      const atsData = await atsRes.json() as ScraperResponse
      atsJobs = atsData.jobs || []
      console.log(`[sourcer] ATS boards: ${atsJobs.length} jobs with direct ATS URLs`)
    }
  } catch (err) {
    // Non-fatal — ATS scraper failure doesn't block jobspy
    console.error('[sourcer] ATS board scrape failed:', err)
  }

  // ── Source 2: jobspy (LinkedIn / Indeed / Glassdoor) ───────────────────
  let response: Response
  try {
    response = await fetch(
      `${scraperUrl}/jobs?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}`,
      { headers }
    )
  } catch (err) {
    await writeDeadLetter(
      env, 'scrape', null, null, 'SCRAPER_NETWORK_ERROR',
      `Scraper unreachable: ${err instanceof Error ? err.message : String(err)}`,
      { keywords, location }
    )
    await logScrapeRun(env, keywords, location, 0, 'failed', Date.now() - startTime,
      err instanceof Error ? err.message : String(err))
    // Return ATS jobs even if jobspy failed
    return atsJobs
  }

  if (!response.ok) {
    await writeDeadLetter(
      env, 'scrape', null, null, 'SCRAPER_HTTP_ERROR',
      `Scraper returned ${response.status}`,
      { keywords, location, status: response.status }
    )
    await logScrapeRun(env, keywords, location, atsJobs.length, 'partial', Date.now() - startTime,
      `HTTP ${response.status}`)
    return atsJobs
  }

  const data = await response.json() as ScraperResponse

  // Merge: ATS-direct jobs + jobspy jobs (deduplicated by external_id in Stage 1)
  const allJobs = [...atsJobs, ...(data.jobs || [])]
  const totalCount = allJobs.length

  await logScrapeRun(
    env, keywords, location,
    totalCount,
    totalCount > 0 ? 'success' : 'zero_results',
    Date.now() - startTime
  )

  if (totalCount === 0) {
    await sendAdminAlert(
      env,
      `SCRAPER ZERO RESULTS: keywords="${keywords}" location="${location}"`
    )
    return []
  }

  console.log(`[sourcer] Total: ${totalCount} jobs (${atsJobs.length} ATS direct + ${data.jobs?.length ?? 0} jobspy)`)
  return allJobs
}

/**
 * Log every scrape run to the scrape_runs table.
 * This is the primary debugging tool for scraping failures.
 */
async function logScrapeRun(
  env: Env,
  keywords: string,
  location: string,
  resultCount: number,
  status: string,
  durationMs: number,
  errorMessage?: string
): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO scrape_runs 
      (id, search_keywords, search_location, source, result_count, status, error_message, duration_ms, run_at)
      VALUES (?, ?, ?, 'jobspy', ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      keywords,
      location,
      resultCount,
      status,
      errorMessage ?? null,
      durationMs,
      Math.floor(Date.now() / 1000)
    ).run()
  } catch (err) {
    console.error('Failed to log scrape run:', err)
  }
}
