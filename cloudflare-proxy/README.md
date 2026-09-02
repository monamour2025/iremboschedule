# Cloudflare proxy (for networks that block Vercel)

Some ISPs block Vercel CDN IPs. This Worker proxies the live app through Cloudflare, which is reachable from those networks.

## Setup (one time, ~3 minutes)

1. Create a free account at [cloudflare.com](https://dash.cloudflare.com/sign-up).
2. Install Wrangler and log in:

   ```powershell
   npm install -g wrangler
   wrangler login
   ```

3. Deploy:

   ```powershell
   cd cloudflare-proxy
   wrangler deploy
   ```

4. Open the URL Wrangler prints, e.g. `https://irembo-schedule-proxy.<your-account>.workers.dev`

Use that URL on PCs that cannot reach `iremboschedule-seven.vercel.app`. GitHub Actions and Vercel automation keep using the original URL.

## Optional custom domain

In Cloudflare dashboard → Workers → your worker → Settings → Domains, attach a subdomain you own (e.g. `schedule.yourdomain.com`).
