// Canonical Job interface — after scraping and normalisation

export interface Job {
  id: string
  source: string             // 'linkedin' | 'indeed' | 'glassdoor' | 'greenhouse_direct' | 'lever_direct'
  externalId?: string
  title: string
  company: string
  companyDomain?: string     // e.g. "notion.so"
  location?: string
  remote?: string            // 'remote' | 'hybrid' | 'onsite'
  description: string
  applyUrl: string
  ats?: string               // 'greenhouse' | 'lever' | 'ashby' | 'workday_skip' | 'unknown'
  atsCompanyToken?: string
  atsJobId?: string
  // Extracted fields (LLM triage)
  yearsRequired?: number
  seniority?: string         // 'junior' | 'mid' | 'senior' | 'staff' | 'principal'
  visaSponsorship?: boolean
  salaryMin?: number
  salaryMax?: number
  // State
  scrapedAt: Date
  embeddingId?: string
}

// Raw job from the Python scraper before normalisation
export interface RawScrapedJob {
  external_id: string
  title: string
  company: string
  location: string
  description: string
  apply_url: string
  source: string
  date_posted: string
  salary_min?: number | null
  salary_max?: number | null
  remote?: string
}

// LLM triage extraction result
export interface TriagedJobFields {
  years_required: number | null
  seniority: 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | null
  visa_sponsorship: boolean | null
  remote: 'remote' | 'hybrid' | 'onsite' | null
}

// Scraper API response
export interface ScraperResponse {
  jobs: RawScrapedJob[]
  count: number
  status: 'success' | 'zero_results' | 'error'
}
