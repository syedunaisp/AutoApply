import { sqliteTable, text, integer, real, unique } from 'drizzle-orm/sqlite-core'

// ─── USERS ───────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id:              text('id').primaryKey(),
  email:           text('email').notNull().unique(),
  firstName:       text('first_name').notNull(),
  lastName:        text('last_name').notNull(),
  plan:            text('plan').notNull().default('basic'), // 'basic' | 'premium'
  active:          integer('active', { mode: 'boolean' }).default(true),
  createdAt:       integer('created_at', { mode: 'timestamp' }).notNull(),
})

// ─── USER PROFILES (the full applicant data the LLM uses) ────────────────
export const profiles = sqliteTable('profiles', {
  id:              text('id').primaryKey(),
  userId:          text('user_id').notNull().references(() => users.id),
  // Personal
  phone:           text('phone'),
  location:        text('location'),
  linkedinUrl:     text('linkedin_url'),
  githubUrl:       text('github_url'),
  portfolioUrl:    text('portfolio_url'),
  personalEmail:   text('personal_email').notNull(), // used as Reply-To
  // Professional
  currentTitle:    text('current_title'),
  yearsExperience: integer('years_experience'),
  summary:         text('summary'),           // 2-3 sentence professional summary
  skills:          text('skills'),            // JSON array of strings
  experience:      text('experience'),        // JSON array of work experience objects
  education:       text('education'),         // JSON array of education objects
  achievements:    text('achievements'),      // JSON array — specific metrics
  // Preferences
  targetRoles:     text('target_roles'),      // JSON array e.g. ["Senior Engineer", "Staff Engineer"]
  targetLocations: text('target_locations'),  // JSON array
  remoteOnly:      integer('remote_only', { mode: 'boolean' }).default(false),
  minSalary:       integer('min_salary'),
  visaRequired:    integer('visa_required', { mode: 'boolean' }).default(false),
  // Cached question answers (for consistency across applications)
  cachedAnswers:   text('cached_answers'),    // JSON: { "question_pattern": "answer" }
  profileEmbedding: text('profile_embedding'), // Vectorize vector ID for this profile
  updatedAt:       integer('updated_at', { mode: 'timestamp' }),
})

// ─── JOBS (raw scraped + normalised) ─────────────────────────────────────
export const jobs = sqliteTable('jobs', {
  id:              text('id').primaryKey(),
  source:          text('source').notNull(),  // 'linkedin' | 'indeed' | 'glassdoor' | 'greenhouse_direct' | 'lever_direct'
  externalId:      text('external_id'),       // ID from source platform
  title:           text('title').notNull(),
  company:         text('company').notNull(),
  companyDomain:   text('company_domain'),    // e.g. "notion.so"
  location:        text('location'),
  remote:          text('remote'),            // 'remote' | 'hybrid' | 'onsite'
  description:     text('description').notNull(),
  applyUrl:        text('apply_url').notNull(),
  ats:             text('ats'),               // 'greenhouse' | 'lever' | 'ashby' | 'workday_skip' | 'unknown'
  atsCompanyToken: text('ats_company_token'), // e.g. greenhouse board token
  atsJobId:        text('ats_job_id'),        // ATS-specific job ID
  // Extracted fields (LLM triage pass)
  yearsRequired:   integer('years_required'),
  seniority:       text('seniority'),         // 'junior' | 'mid' | 'senior' | 'staff' | 'principal'
  visaSponsorship: integer('visa_sponsorship', { mode: 'boolean' }),
  salaryMin:       integer('salary_min'),
  salaryMax:       integer('salary_max'),
  // State
  scrapedAt:       integer('scraped_at', { mode: 'timestamp' }).notNull(),
  embeddingId:     text('embedding_id'),      // Vectorize vector ID
})

// ─── APPLICATIONS ────────────────────────────────────────────────────────
export const applications = sqliteTable('applications', {
  id:              text('id').primaryKey(),
  userId:          text('user_id').notNull().references(() => users.id),
  jobId:           text('job_id').notNull().references(() => jobs.id),
  track:           text('track').notNull(),   // 'sniper' | 'shotgun'
  matchScore:      real('match_score'),       // Vectorize cosine similarity 0-1
  // ATS Submission
  atsStatus:       text('ats_status'),        // 'pending' | 'submitted' | 'failed' | 'manual_required'
  atsSubmittedAt:  integer('ats_submitted_at', { mode: 'timestamp' }),
  atsResponse:     text('ats_response'),      // Raw ATS API response JSON
  // Resume
  resumeR2Key:     text('resume_r2_key'),     // R2 object key for the tailored PDF
  resumeUrl:       text('resume_url'),        // Public R2 URL
  // Metadata
  createdAt:       integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  uniq: unique().on(t.userId, t.jobId),       // NEVER apply to the same job twice
}))

// ─── OUTREACH (cold email + LinkedIn DM) ─────────────────────────────────
export const outreachEvents = sqliteTable('outreach_events', {
  id:              text('id').primaryKey(),
  userId:          text('user_id').notNull().references(() => users.id),
  applicationId:   text('application_id').references(() => applications.id),
  channel:         text('channel').notNull(), // 'email' | 'linkedin_dm'
  recipientEmail:  text('recipient_email'),
  recipientName:   text('recipient_name'),
  recipientTitle:  text('recipient_title'),
  fromAddress:     text('from_address'),      // The address we sent FROM
  subject:         text('subject'),
  bodyText:        text('body_text'),
  status:          text('status').notNull(),  // 'queued' | 'sent' | 'bounced' | 'complained' | 'failed'
  sesMessageId:    text('ses_message_id'),
  sentAt:          integer('sent_at', { mode: 'timestamp' }),
  createdAt:       integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  uniq: unique().on(t.userId, t.applicationId, t.channel), // never email about same job twice
}))

// ─── APOLLO LOOKUPS (cached to avoid duplicate API calls) ────────────────
export const apolloLookups = sqliteTable('apollo_lookups', {
  id:              text('id').primaryKey(),
  userId:          text('user_id').notNull(),
  companyDomain:   text('company_domain').notNull(),
  contactName:     text('contact_name'),
  contactTitle:    text('contact_title'),
  contactEmail:    text('contact_email'),
  zeroBounceStatus: text('zero_bounce_status'), // 'valid' | 'invalid' | 'catch-all' | 'unknown'
  createdAt:       integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  uniq: unique().on(t.userId, t.companyDomain), // NEVER call Apollo twice for same company per user
}))

// ─── SUPPRESSION LIST ────────────────────────────────────────────────────
export const suppressedContacts = sqliteTable('suppressed_contacts', {
  id:              text('id').primaryKey(),
  userId:          text('user_id'),           // null = applies to all users
  email:           text('email'),
  companyDomain:   text('company_domain'),
  reason:          text('reason').notNull(),  // 'unsubscribe' | 'bounce' | 'complaint' | 'manual'
  scope:           text('scope').notNull(),   // 'this_user' | 'all_users'
  createdAt:       integer('created_at', { mode: 'timestamp' }).notNull(),
})

// ─── LINKEDIN DM QUEUE (PhantomBuster polls this) ────────────────────────
export const linkedinDmQueue = sqliteTable('linkedin_dm_queue', {
  id:              text('id').primaryKey(),
  userId:          text('user_id').notNull(),
  applicationId:   text('application_id').notNull(),
  linkedinProfileUrl: text('linkedin_profile_url').notNull(),
  recipientName:   text('recipient_name'),
  messageText:     text('message_text').notNull(),
  status:          text('status').notNull().default('queued'), // 'queued' | 'sent' | 'failed'
  createdAt:       integer('created_at', { mode: 'timestamp' }).notNull(),
  sentAt:          integer('sent_at', { mode: 'timestamp' }),
})

// ─── SCRAPE RUNS (for monitoring + silent failure detection) ─────────────
export const scrapeRuns = sqliteTable('scrape_runs', {
  id:              text('id').primaryKey(),
  searchKeywords:  text('search_keywords').notNull(),
  searchLocation:  text('search_location'),
  source:          text('source').notNull(),
  resultCount:     integer('result_count').notNull(),
  status:          text('status').notNull(),  // 'success' | 'failed' | 'zero_results'
  errorMessage:    text('error_message'),
  durationMs:      integer('duration_ms'),
  runAt:           integer('run_at', { mode: 'timestamp' }).notNull(),
})

// ─── DEAD LETTER QUEUE — built FIRST before anything else ────────────────
export const failedJobs = sqliteTable('failed_jobs', {
  id:              text('id').primaryKey(),
  entityType:      text('entity_type').notNull(), // 'scrape' | 'match' | 'application' | 'email' | 'apollo' | 'zerobounce'
  entityId:        text('entity_id'),
  userId:          text('user_id'),
  errorCode:       text('error_code'),
  errorMessage:    text('error_message').notNull(),
  rawPayload:      text('raw_payload'),       // full JSON of what was attempted
  retryCount:      integer('retry_count').default(0),
  resolved:        integer('resolved', { mode: 'boolean' }).default(false),
  resolvedNote:    text('resolved_note'),
  createdAt:       integer('created_at', { mode: 'timestamp' }).notNull(),
})
