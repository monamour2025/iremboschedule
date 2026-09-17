# Cloudflare proxy (cache + reachability)

This Worker is the URL you open in the browser (`https://irembo-schedule-proxy.caramel-pickup.workers.dev`).

It does **two** jobs:

1. Reach the app when a local ISP blocks Vercel.
2. **Cut Vercel CPU** by caching static files (~1 day) and GET APIs (~20 seconds) on Cloudflare. Repeat refreshes of lists and slots do not hit Vercel every time.

It is **not** a replacement for Vercel. Booking, Estimate matching, and the 15-minute GitHub scan still run on Vercel. If nobody is searching (everyone on hold / finished), that scan now returns immediately so it barely uses CPU.

## Deploy after code changes

From the repo:

```powershell
cd cloudflare-proxy
npx wrangler deploy
```

Until you deploy the Worker, the live `workers.dev` URL still has the old “forward everything” proxy.

GitHub Actions should keep calling `iremboschedule-seven.vercel.app` (not this Worker) so cron is never served from cache.

## Optional custom domain

In Cloudflare dashboard → Workers → your worker → Settings → Domains, attach a subdomain you own.
