# SolMemeHub KOLScan Proxy

Cloudflare Worker proxy for the public KOLScan leaderboard page.

## Route

`GET /api/kolscan/leaderboard`

## Required Secret

`SOLANA_TRACKER_API_KEY`

## Deploy

```powershell
cd C:\Users\thedo\Documents\public-token-site-apex\kolscan-proxy
npx wrangler login
npx wrangler secret put SOLANA_TRACKER_API_KEY
npx wrangler deploy
```

If using a `workers.dev` URL instead of a custom route on `solmemehub.tech`, set `WORKER_ENDPOINT_OVERRIDE` in `kolscan/app.js` to:

```js
var WORKER_ENDPOINT_OVERRIDE = 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/api/kolscan/leaderboard';
```

Do not place the API key in frontend files.
