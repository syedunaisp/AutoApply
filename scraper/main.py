from fastapi import FastAPI, HTTPException, Header
from jobspy import scrape_jobs
import json
from datetime import datetime
import os

app = FastAPI(title="AutoApply Scraper", version="1.0.0")

API_KEY = os.environ.get("API_KEY", "dev-key-change-me")


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
    # API key auth
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

        # Normalise to clean JSON
        jobs_df = jobs_df.fillna("")
        records = jobs_df.to_dict(orient="records")

        # Map to canonical shape
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
