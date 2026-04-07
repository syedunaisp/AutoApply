-- Fake application tied to the Acme Corp job
INSERT INTO applications (id, user_id, job_id, track, match_score, ats_status, created_at)
VALUES (
  'test-app-1', 'test-user-1', '00e741db-b844-4965-ac0f-9965c4682717',
  'sniper', 0.92, 'submitted', unixepoch()
);

-- Fake outreach event with a known ses_message_id we can reference in the webhook test
INSERT INTO outreach_events (
  id, user_id, application_id, channel,
  recipient_email, recipient_name, from_address,
  subject, body_text, status, ses_message_id,
  sent_at, created_at
) VALUES (
  'test-outreach-1', 'test-user-1', 'test-app-1', 'email',
  'hiring@acmecorp.com', 'Jane Smith', 'syed.u@jobagent.aiworkers.in',
  'Senior Engineer role at Acme', 'Hey Jane, saw the role...',
  'sent', 'test-resend-msg-001',
  unixepoch(), unixepoch()
);
