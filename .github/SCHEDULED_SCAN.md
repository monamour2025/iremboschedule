# Scheduled Scan (GitHub Actions — not Vercel)

Every few minutes GitHub runs `scripts/runGithubTick.js`. That job:

1. Calls Irembo’s public schedule APIs for Busanza / Kicukiro
2. Matches waiting people to live seats of the same licence category
3. Reserves the slot and creates the application (`book-slot-temporary` + `create/ddl-registration/application`) using each person’s national ID / entity ID

Required GitHub secrets: `DATABASE_URL`, `ENCRYPTION_KEY`, `AUTOMATION_MODE=production`.

No Irembo username, password, OTP, or browser cookie.

Manual run: GitHub → **Actions** → **Scheduled Scan** → **Run workflow**.
