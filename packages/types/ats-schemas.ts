// ATS-specific payload and question types

// ─── ATS Platform Detection ─────────────────────────────────────────────
export type ATSPlatform =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workday_skip'
  | 'icims_skip'
  | 'taleo_skip'
  | 'sap_skip'
  | 'unknown'

// ─── Greenhouse ──────────────────────────────────────────────────────────
export interface GreenhouseQuestion {
  question_id: number
  label: string
  type: 'short_text' | 'long_text' | 'yes_no' | 'dropdown' | 'url' | 'multi_select'
  required: boolean
  values?: Array<{ value: number; label: string }>  // for dropdown/multi_select
}

export interface GreenhouseJobSchema {
  questions: GreenhouseQuestion[]
  title?: string
  id?: number
}

export interface GreenhousePayload {
  first_name: string
  last_name: string
  email: string
  phone?: string
  resume_content: string         // base64
  resume_content_filename: string
  answers: Array<{ question_id: number; answer: string | number }>
}

// ─── Lever ───────────────────────────────────────────────────────────────
export interface LeverPayload {
  name: string
  email: string
  phone?: string
  org?: string                   // current title/company
  comments?: string
  urls?: Record<string, string>  // { "LinkedIn": "...", "GitHub": "..." }
  resume?: Blob
}

// ─── Ashby ───────────────────────────────────────────────────────────────
export interface AshbyPayload {
  jobPostingId: string
  firstName: string
  lastName: string
  email: string
  phoneNumber?: string
  linkedInUrl?: string
  githubUrl?: string
  portfolioUrl?: string
  resumeFileContent: string    // base64
  resumeFileName: string
  customFields?: Record<string, string>
}

// ─── Generic Question/Answer ─────────────────────────────────────────────
export interface ATSQuestionAnswer {
  questionId: number | string
  answer: string | number
}
