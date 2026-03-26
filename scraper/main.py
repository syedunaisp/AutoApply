from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from jobspy import scrape_jobs
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
import os
import httpx

app = FastAPI(title="AutoApply Scraper", version="1.0.0")

API_KEY = os.environ.get("API_KEY", "dev-key-change-me")
WORKER_URL = os.environ.get("WORKER_URL", "")
WORKER_INGEST_KEY = os.environ.get("WORKER_INGEST_KEY", "")

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
            country_indeed="USA",
        )

        if jobs_df is None or len(jobs_df) == 0:
            return {"jobs": [], "count": 0, "status": "zero_results"}

        jobs_df = jobs_df.fillna("")
        records = jobs_df.to_dict(orient="records")

        normalised = []
        for j in records:
            normalised.append(
                {
                    "external_id": str(j.get("id", "")),
                    "title": str(j.get("title", "")),
                    "company": str(j.get("company", "")),
                    "location": str(j.get("location", "")),
                    "description": str(j.get("description", "")),
                    "apply_url": str(j.get("job_url", "")),
                    "source": str(j.get("site", "")),
                    "date_posted": str(j.get("date_posted", "")),
                    "salary_min": j.get("min_amount", None),
                    "salary_max": j.get("max_amount", None),
                    "remote": str(j.get("job_type", "")),
                }
            )

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
    searches = [
        ("Senior Software Engineer", "United States"),
        ("Staff Engineer", "United States"),
    ]

    for keywords, location in searches:
        try:
            jobs_df = scrape_jobs(
                site_name=["linkedin", "indeed", "glassdoor"],
                search_term=keywords,
                location=location,
                results_wanted=100,
                hours_old=24,
                country_indeed="USA",
            )

            if jobs_df is None or len(jobs_df) == 0:
                continue

            jobs_df = jobs_df.fillna("")
            records = jobs_df.to_dict(orient="records")

            normalised = []
            for j in records:
                normalised.append({
                    "external_id": str(j.get("id", "")),
                    "title": str(j.get("title", "")),
                    "company": str(j.get("company", "")),
                    "location": str(j.get("location", "")),
                    "description": str(j.get("description", "")),
                    "apply_url": str(j.get("job_url", "")),
                    "source": str(j.get("site", "")),
                    "date_posted": str(j.get("date_posted", "")),
                    "salary_min": j.get("min_amount", None),
                    "salary_max": j.get("max_amount", None),
                    "remote": str(j.get("job_type", "")),
                })

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
