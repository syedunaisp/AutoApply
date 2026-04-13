from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from jobspy import scrape_jobs
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
import os
import httpx

app = FastAPI(title="AutoApply Scraper", version="1.0.0")

if not os.environ.get("API_KEY"):
    print("WARNING: API_KEY env var is not set. All requests will be rejected.")


API_KEY           = os.environ.get("API_KEY", "")
WORKER_URL        = os.environ.get("WORKER_URL", "")
WORKER_INGEST_KEY = os.environ.get("WORKER_INGEST_KEY", "")

# Configurable search terms — comma-separated, e.g. "ML Engineer,MLOps,Data Scientist"
_raw_terms    = os.environ.get("SEARCH_TERMS", "Senior Software Engineer,Staff Engineer")
_raw_location = os.environ.get("SEARCH_LOCATION", "United States")
SEARCH_TERMS    = [t.strip() for t in _raw_terms.split(",") if t.strip()]
SEARCH_LOCATION = _raw_location.strip()

# Indeed country code — derived from SEARCH_LOCATION or override with COUNTRY_INDEED
COUNTRY_INDEED = os.environ.get("COUNTRY_INDEED", "India" if "india" in SEARCH_LOCATION.lower() else "USA")


def normalize_job(j: dict) -> dict:
    """
    Normalize a raw jobspy record into AutoApply's standard job shape.

    Key: prefer job_url_direct over job_url so we get real ATS board URLs
    (e.g. boards.greenhouse.io/stripe/jobs/123) rather than LinkedIn wrappers.
    This is what allows detectATS() in the worker to identify Greenhouse/Lever/Ashby
    and route to the correct executor.
    """
    direct = str(j.get("job_url_direct", "") or "").strip()
    listing = str(j.get("job_url", "") or "").strip()
    apply_url = direct if direct else listing

    return {
        "external_id":  str(j.get("id", "")),
        "title":        str(j.get("title", "")),
        "company":      str(j.get("company", "")),
        "location":     str(j.get("location", "")),
        "description":  str(j.get("description", "")),
        "apply_url":    apply_url,
        "source":       str(j.get("site", "")),
        "date_posted":  str(j.get("date_posted", "")),
        "salary_min":   j.get("min_amount", None),
        "salary_max":   j.get("max_amount", None),
        "remote":       str(j.get("job_type", "")),
    }

# ----------------------------
# DAILY SCHEDULER
# ----------------------------
def run_daily_scrape():
    """APScheduler daily job — runs _scrape_and_push as a sync wrapper."""
    import asyncio
    print("Running scheduled scrape at", datetime.utcnow().isoformat())
    try:
        asyncio.run(_scrape_and_push())
        print("Scheduled scrape and push complete")
    except Exception as e:
        print("Scheduled scrape failed:", str(e))


scheduler = BackgroundScheduler()
scheduler.add_job(run_daily_scrape, 'cron', hour=9, minute=0, misfire_grace_time=3600)
scheduler.start()


@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.get("/jobs")
def get_jobs(
    keywords: str,
    location: str = "United States",
    hours_old: int = 24,
    results_wanted: int = 100,
    x_api_key: str = Header(None),
):
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    try:
        jobs_df = scrape_jobs(
            site_name=["linkedin", "indeed", "glassdoor"],
            search_term=keywords,
            location=location,
            results_wanted=results_wanted,
            hours_old=hours_old,
            country_indeed=COUNTRY_INDEED,
        )

        if jobs_df is None or len(jobs_df) == 0:
            return {"jobs": [], "count": 0, "status": "zero_results"}

        jobs_df = jobs_df.fillna("")
        normalised = [normalize_job(j) for j in jobs_df.to_dict(orient="records")]

        # Log how many have real ATS URLs vs LinkedIn wrappers (for monitoring)
        ats_urls = sum(1 for j in normalised if any(
            k in j["apply_url"] for k in ["greenhouse.io", "lever.co", "ashbyhq.com", "ashby.com"]
        ))
        print(f"[scraper] {len(normalised)} jobs | {ats_urls} with direct ATS URLs | {len(normalised)-ats_urls} LinkedIn/other")

        return {"jobs": normalised, "count": len(normalised), "status": "success"}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run")
async def run_and_push(
    background_tasks: BackgroundTasks,
    x_api_key: str = Header(None),
):
    """
    Scrape jobs for all configured searches and push results to the worker.
    Called by the VPS cron — not by the worker directly.
    Returns immediately; scraping happens in background.
    """
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not WORKER_URL or not WORKER_INGEST_KEY:
        raise HTTPException(status_code=500, detail="WORKER_URL or WORKER_INGEST_KEY not configured")

    background_tasks.add_task(_scrape_and_push)
    return {"status": "started", "timestamp": datetime.utcnow().isoformat()}


async def _scrape_and_push():
    """Background task: scrape each search term and POST results to worker."""
    searches = [(term, SEARCH_LOCATION) for term in SEARCH_TERMS]

    for keywords, location in searches:
        try:
            jobs_df = scrape_jobs(
                site_name=["linkedin", "indeed", "glassdoor"],
                search_term=keywords,
                location=location,
                results_wanted=100,
                hours_old=24,
                country_indeed=COUNTRY_INDEED,
            )

            if jobs_df is None or len(jobs_df) == 0:
                print(f"[scraper] Zero results for '{keywords}' in '{location}'")
                continue

            jobs_df = jobs_df.fillna("")
            normalised = [normalize_job(j) for j in jobs_df.to_dict(orient="records")]

            ats_urls = sum(1 for j in normalised if any(
                k in j["apply_url"] for k in ["greenhouse.io", "lever.co", "ashbyhq.com", "ashby.com"]
            ))
            print(f"[scraper] '{keywords}': {len(normalised)} jobs | {ats_urls} direct ATS URLs")

            # Push to worker ingest endpoint
            async with httpx.AsyncClient(timeout=30) as client:
                await client.post(
                    f"{WORKER_URL}/ingest-jobs",
                    headers={"x-ingest-key": WORKER_INGEST_KEY},
                    json={"keywords": keywords, "location": location, "jobs": normalised},
                )

        except Exception as e:
            # Log but don't crash — continue with next search
            print(f"[scraper] Error for '{keywords}': {e}")
