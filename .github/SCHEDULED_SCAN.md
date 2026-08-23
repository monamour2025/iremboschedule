# Scheduled Scan (GitHub Actions)

Automatic Irembo scanning runs every **5 minutes** via GitHub Actions because **Vercel Hobby** only allows daily cron jobs.

## Required repository secrets

Add these at:

**https://github.com/monamour2025/iremboschedule/settings/secrets/actions**

Click **New repository secret** for each:

| Secret name   | Value |
|---------------|-------|
| `WEBSITE_URL` | `iremboschedule-seven.vercel.app` (host only — no `https://`, no trailing slash) |
| `CRON_SECRET` | Same value as `CRON_SECRET` in your Vercel production env (and local `.env`) |

`CRON_SECRET` must match **exactly** on GitHub Actions and Vercel. If they differ, `/api/cron/tick` returns 401.

## What the workflow does

1. GitHub Actions runs `.github/workflows/schedule-scan.yml` on a schedule (every 5 minutes).
2. It calls `GET https://<WEBSITE_URL>/api/cron/tick` with header `Authorization: Bearer <CRON_SECRET>`.
3. The live site scans Irembo, matches applicants, and runs pending automation.

## Manual test

After secrets are set, run **Actions → Scheduled Scan → Run workflow**.

Or from a terminal (replace with your secret):

```bash
curl -fsS "https://iremboschedule-seven.vercel.app/api/cron/tick" \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Expected: JSON with `"ok": true`.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Job fails in ~3s with "Missing GitHub repository secrets" | Add `WEBSITE_URL` and `CRON_SECRET` in repo Settings → Secrets |
| HTTP 401 Unauthorized | `CRON_SECRET` on GitHub ≠ Vercel — align both |
| HTTP 503 CRON_SECRET not configured | Set `CRON_SECRET` on Vercel production and redeploy |
| Job times out (~10 min) | Normal on full country scan; increase `timeout-minutes` if needed |
