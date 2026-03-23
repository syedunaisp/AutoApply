CREATE TABLE `apollo_lookups` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company_domain` text NOT NULL,
	`contact_name` text,
	`contact_title` text,
	`contact_email` text,
	`zero_bounce_status` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apollo_lookups_user_id_company_domain_unique` ON `apollo_lookups` (`user_id`,`company_domain`);--> statement-breakpoint
CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`job_id` text NOT NULL,
	`track` text NOT NULL,
	`match_score` real,
	`ats_status` text,
	`ats_submitted_at` integer,
	`ats_response` text,
	`resume_r2_key` text,
	`resume_url` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `applications_user_id_job_id_unique` ON `applications` (`user_id`,`job_id`);--> statement-breakpoint
CREATE TABLE `failed_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`user_id` text,
	`error_code` text,
	`error_message` text NOT NULL,
	`raw_payload` text,
	`retry_count` integer DEFAULT 0,
	`resolved` integer DEFAULT false,
	`resolved_note` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text,
	`title` text NOT NULL,
	`company` text NOT NULL,
	`company_domain` text,
	`location` text,
	`remote` text,
	`description` text NOT NULL,
	`apply_url` text NOT NULL,
	`ats` text,
	`ats_company_token` text,
	`ats_job_id` text,
	`years_required` integer,
	`seniority` text,
	`visa_sponsorship` integer,
	`salary_min` integer,
	`salary_max` integer,
	`scraped_at` integer NOT NULL,
	`embedding_id` text
);
--> statement-breakpoint
CREATE TABLE `linkedin_dm_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text NOT NULL,
	`linkedin_profile_url` text NOT NULL,
	`recipient_name` text,
	`message_text` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` integer NOT NULL,
	`sent_at` integer
);
--> statement-breakpoint
CREATE TABLE `outreach_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text,
	`channel` text NOT NULL,
	`recipient_email` text,
	`recipient_name` text,
	`recipient_title` text,
	`from_address` text,
	`subject` text,
	`body_text` text,
	`status` text NOT NULL,
	`ses_message_id` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`application_id`) REFERENCES `applications`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_events_user_id_application_id_channel_unique` ON `outreach_events` (`user_id`,`application_id`,`channel`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`phone` text,
	`location` text,
	`linkedin_url` text,
	`github_url` text,
	`portfolio_url` text,
	`personal_email` text NOT NULL,
	`current_title` text,
	`years_experience` integer,
	`summary` text,
	`skills` text,
	`experience` text,
	`education` text,
	`achievements` text,
	`target_roles` text,
	`target_locations` text,
	`remote_only` integer DEFAULT false,
	`min_salary` integer,
	`visa_required` integer DEFAULT false,
	`cached_answers` text,
	`profile_embedding` text,
	`updated_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scrape_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`search_keywords` text NOT NULL,
	`search_location` text,
	`source` text NOT NULL,
	`result_count` integer NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`duration_ms` integer,
	`run_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suppressed_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text,
	`company_domain` text,
	`reason` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`plan` text DEFAULT 'basic' NOT NULL,
	`active` integer DEFAULT true,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);