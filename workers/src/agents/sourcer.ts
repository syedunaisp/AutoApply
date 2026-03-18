// Sourcer agent — calls the Python scraper VPS and logs results to D1
// Includes the CRITICAL zero-result alert guard

import type { Env, RawScrapedJob, ScraperResponse } from '@autoapply/types'
import { writeDeadLetter, sendAdminAlert } from '../utils/dead-letter'

/**
 * Call the Python scraper VPS to fetch job listings.
 * ALWAYS logs the scrape run to D1, even on zero results.
 * CRITICAL: Fires an admin alert on zero results (silent failure guard).
 */
export async function runScraper(
  env: Env,
  keywords: string,
  location: string
): Promise<RawScrapedJob[]> {
  const scraperUrl = env.SCRAPER_URL
  const startTime = Date.now()

  let response: Response
  try {
    response = await fetch(
      `${scraperUrl}/jobs?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}`,
      {
        headers: {
          'X-API-Key': env.SCRAPER_URL.includes('dev') ? 'dev-key-change-me' : '',
        },
      }
    )
  } catch (err) {
    await writeDeadLetter(
      env, 'scrape', null, null, 'SCRAPER_NETWORK_ERROR',
      `Scraper unreachable: ${err instanceof Error ? err.message : String(err)}`,
      { keywords, location }
    )
    // Log failed scrape run
    await logScrapeRun(env, keywords, location, 0, 'failed', Date.now() - startTime,
      err instanceof Error ? err.message : String(err))
    return []
  }

  if (!response.ok) {
    await writeDeadLetter(
      env, 'scrape', null, null, 'SCRAPER_HTTP_ERROR',
      `Scraper returned ${response.status}`,
      { keywords, location, status: response.status }
    )
    await logScrapeRun(env, keywords, location, 0, 'failed', Date.now() - startTime,
      `HTTP ${response.status}`)
    return []
  }

  const data = await response.json() as ScraperResponse

  // Log the scrape run — ALWAYS, even on zero results
  await logScrapeRun(
    env, keywords, location,
    data.count, data.status,
    Date.now() - startTime
  )

  // CRITICAL: Alert on zero results — silent failure guard
  if (data.count === 0 || data.status === 'zero_results') {
    await sendAdminAlert(
      env,
      `SCRAPER ZERO RESULTS: keywords="${keywords}" location="${location}"`
    )
    return []
  }

  return data.jobs
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
