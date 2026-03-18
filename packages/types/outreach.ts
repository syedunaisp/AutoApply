// Outreach event interfaces — cold email + LinkedIn DM

export interface OutreachEvent {
  id: string
  userId: string
  applicationId?: string
  channel: 'email' | 'linkedin_dm'
  recipientEmail?: string
  recipientName?: string
  recipientTitle?: string
  fromAddress?: string
  subject?: string
  bodyText?: string
  status: 'queued' | 'sent' | 'bounced' | 'complained' | 'failed'
  sesMessageId?: string
  sentAt?: Date
  createdAt: Date
}

// LLM-generated email content
export interface EmailContent {
  subject: string
  text: string
  html: string
}

// Apollo.io contact lookup result
export interface ApolloContact {
  name?: string
  title?: string
  email?: string
  linkedinUrl?: string
  companyDomain: string
}

// AWS SES send parameters
export interface SESParams {
  from: string
  replyTo: string
  to: string
  subject: string
  html: string
  text: string
  metadata: {
    userId: string
    jobId: string
    applicationId: string
  }
}

// SES send result
export interface SESResult {
  success: boolean
  messageId?: string
}

// ZeroBounce validation result
export type ZeroBounceStatus = 'valid' | 'invalid' | 'catch-all' | 'unknown'
