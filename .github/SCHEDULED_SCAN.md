# Scheduled Scan (GitHub Actions — not Vercel)

Scanning and code creation run on **GitHub’s computers**. Vercel only shows the admin site. That is how the free Vercel plan stays alive.

## Required GitHub secrets

**https://github.com/monamour2025/iremboschedule/settings/secrets/actions**

Copy the same values you already have on Vercel:

| Secret | Required |
|--------|----------|
| `DATABASE_URL` | yes |
| `ENCRYPTION_KEY` | yes |
| `AUTOMATION_MODE` | yes (`production`) |
| `IREMBO_CITIZEN_COOKIE` or `IREMBO_USERNAME` + `IREMBO_PASSWORD` | yes to book |
| `RESEND_API_KEY` | for SMS/email after a code |

Do **not** point this workflow at `iremboschedule-seven.vercel.app`. Calling Vercel for scan is what almost paused the app.

## What it does

Every 20 minutes (and on **Run workflow**): checkout → `node scripts/runGithubTick.js` → scan Busanza, match people who are **not** on hold, reserve, create the Irembo application.

If everyone is on hold, the job exits immediately.

## Manual test

GitHub → **Actions** → **Scheduled Scan** → **Run workflow**.
