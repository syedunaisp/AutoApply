#!/bin/bash
# AutoApply — one-time setup script
# Run from project root: bash scripts/setup.sh

echo "=== Uploading resume template to R2 ==="
wrangler r2 object put autoapply-resumes/templates/base-resume.pdf \
  --file=base-resume.pdf \
  --content-type=application/pdf \
  --remote

echo ""
echo "=== Setting Worker secrets ==="
echo "Run each of the following and paste the value when prompted:"
echo ""
echo "wrangler secret put RESEND_API_KEY --remote"
echo "wrangler secret put SENDING_DOMAIN --remote"
echo "wrangler secret put APOLLO_API_KEY --remote"
echo "wrangler secret put ZERO_BOUNCE_API_KEY --remote"
echo "wrangler secret put R2_PUBLIC_URL --remote"
echo "wrangler secret put ADMIN_ALERT_EMAIL --remote"
echo "wrangler secret put SCRAPER_URL --remote"
echo ""
echo "=== After secrets are set, deploy the worker ==="
echo "cd workers && wrangler deploy --remote"
