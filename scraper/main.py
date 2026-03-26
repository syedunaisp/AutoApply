from fastapi import FastAPI, HTTPException, Header
from jobspy import scrape_jobs
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
import os

app = FastAPI(title="AutoApply Scraper", version="1.0.0")

API_KEY = os.environ.get("API_KEY", "dev-key-change-me")

# ----------------------------
# DAILY SCHEDULER
# ----------------------------
def run_daily_scrape():
    print("Running scheduled scrape at", datetime.utcnow().isoformat())
    try:
        jobs_df = scrape_jobs(
            site_name=["linkedin", "indeed", "glassdoor"],
            search_term="software engineer",
            location="United States",
            results_wanted=50,
            hours_old=24,
            country_indeed="USA",
        )

        if jobs_df is not None and len(jobs_df) > 0:
            print(f"Scraped {len(jobs_df)} jobs successfully")
        else:
            print("No jobs found in scheduled run")

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
