// User profile — the full shape the LLM receives for resume tailoring and question answering

export interface UserProfile {
  id: string
  userId: string
  // Personal
  firstName: string
  lastName: string
  phone?: string
  location?: string
  linkedinUrl?: string
  githubUrl?: string
  portfolioUrl?: string
  personalEmail: string      // used as Reply-To on cold emails
  // Professional
  currentTitle?: string
  yearsExperience?: number
  summary?: string           // 2-3 sentence professional summary
  skills: string[]           // parsed from JSON
  experience: WorkExperience[]
  education: Education[]
  achievements: string[]     // specific metrics, e.g. "Reduced latency by 40%"
  // Preferences
  targetRoles: string[]
  targetLocations: string[]
  remoteOnly: boolean
  minSalary?: number
  visaRequired: boolean
  // Cached
  cachedAnswers?: Record<string, string>  // { "question_pattern": "answer" }
  profileEmbedding?: string
  // Plan info (from users table)
  plan?: 'basic' | 'premium'
  customDomain?: string
}

export interface WorkExperience {
  company: string
  title: string
  startDate: string
  endDate?: string           // null = current
  location?: string
  bullets: string[]
}

export interface Education {
  institution: string
  degree: string
  field?: string
  startDate?: string
  endDate?: string
  gpa?: string
}
