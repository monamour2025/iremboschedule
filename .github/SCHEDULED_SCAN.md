# Scheduled Scan (GitHub Actions — not Vercel)

Scanning and code creation run on **GitHub’s computers**. Vercel only shows the admin site.

## Required GitHub secrets

**https://github.com/monamour2025/iremboschedule/settings/secrets/actions**

| Secret | Required |
|--------|----------|
| `DATABASE_URL` | yes |
| `ENCRYPTION_KEY` | yes |
| `AUTOMATION_MODE` | yes (`production`) |
| `IREMBO_USERNAME` | yes — Irembo phone or email |
| `IREMBO_PASSWORD` | yes — Irembo password |
| `IREMBO_OTP` | only if Irembo asks for SMS once |
| `RESEND_API_KEY` | for SMS/email after a code |

Do not use browser cookies. The job logs in through the Irembo API (`id.irembohub.com` token + `/irembo/public/exchange`), then:

1. Detects open Busanza seats from the public schedule APIs
2. Matches waiting people to live Category A/B/C/D seats
3. Reserves the slot and creates the application (`book-slot-temporary` + `create/ddl-registration/application`)

## Manual test

GitHub → **Actions** → **Scheduled Scan** → **Run workflow**.
