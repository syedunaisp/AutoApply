// Application lifecycle interfaces

export interface Application {
  id: string
  userId: string
  jobId: string
  track: 'sniper' | 'shotgun'
  matchScore?: number           // 0-1 cosine similarity
  atsStatus?: 'pending' | 'submitted' | 'failed' | 'manual_required'
  atsSubmittedAt?: Date
  atsResponse?: string          // Raw ATS API response JSON
  resumeR2Key?: string
  resumeUrl?: string
  createdAt: Date
}

export interface ApplicationResult {
  success: boolean
  response: any
  atsType?: string
}
