INSERT INTO users (id, email, first_name, last_name, plan, active, created_at)
VALUES ('test-user-1', 'syedu@henceprove.com', 'Syed', 'U', 'basic', 1, unixepoch());

INSERT INTO profiles (
  id, user_id, personal_email, current_title, years_experience,
  summary, skills, achievements, target_roles, target_locations,
  remote_only, cached_answers, updated_at
) VALUES (
  'test-profile-1', 'test-user-1',
  'syedunais516@gmail.com',
  'Senior Software Engineer', 5,
  'Full-stack engineer with 5 years building scalable systems.',
  '["TypeScript","React","Node.js","PostgreSQL"]',
  '["Reduced API latency by 40%","Led team of 4 engineers"]',
  '["Senior Software Engineer","Staff Engineer"]',
  '["United States"]',
  0, '{}', unixepoch()
);
