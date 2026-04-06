// Typed HTTP client for the AutoApply Workers API

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`)
  }

  return res.json()
}

// ─── Applications ────────────────────────────────────────────────────────

export interface ApplicationRow {
  id: string
  user_id: string
  job_id: string
  track: string
  match_score: number
  ats_status: string
  ats_submitted_at: number | null
  ats_response: string | null
  resume_r2_key: string | null
  resume_url: string | null
  created_at: number
  job_title: string
  job_company: string
  ats: string
}

export async function getApplications(page = 1, limit = 20, status?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status) params.set('status', status)
  return apiFetch<{ data: ApplicationRow[]; total: number; page: number; limit: number }>(
    `/api/applications?${params}`
  )
}

// ─── Failures ────────────────────────────────────────────────────────────

export interface FailureRow {
  id: string
  entity_type: string
  entity_id: string | null
  user_id: string | null
  error_code: string | null
  error_message: string
  raw_payload: string | null
  retry_count: number
  resolved: boolean
  resolved_note: string | null
  created_at: number
}

export async function getFailures(page = 1, limit = 20, resolved?: boolean) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (resolved !== undefined) params.set('resolved', String(resolved))
  return apiFetch<{ data: FailureRow[]; page: number; limit: number }>(
    `/api/failures?${params}`
  )
}

export async function resolveFailure(id: string, note?: string) {
  return apiFetch<{ success: boolean }>('/api/failures/resolve', {
    method: 'POST',
    body: JSON.stringify({ id, note }),
  })
}

// ─── Scrape Runs ─────────────────────────────────────────────────────────

export interface ScrapeRunRow {
  id: string
  search_keywords: string
  search_location: string | null
  source: string
  result_count: number
  status: string
  error_message: string | null
  duration_ms: number | null
  run_at: number
}

export async function getScrapeRuns(limit = 50) {
  return apiFetch<{ data: ScrapeRunRow[] }>(`/api/scrape-runs?limit=${limit}`)
}

// ─── Profile ─────────────────────────────────────────────────────────────

export async function getProfile(userId: string) {
  return apiFetch<{ user: any; profile: any }>(`/api/profile?userId=${userId}`)
}

export async function updateProfile(data: any) {
  return apiFetch<{ success: boolean }>('/api/profile', {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

// ─── Resume Parser ───────────────────────────────────────────────────────

export async function parseResume(text: string) {
  return apiFetch<any>('/api/parse-resume', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

// ─── Stats ───────────────────────────────────────────────────────────────

export interface DashboardStats {
  today: { jobsFound: number; applications: number; emailsSent: number }
  last30Days: { applications: number; emailsSent: number }
  unresolvedFailures: number
}

export async function getStats(userId?: string) {
  const params = userId ? `?userId=${userId}` : ''
  return apiFetch<DashboardStats>(`/api/stats${params}`)
}
