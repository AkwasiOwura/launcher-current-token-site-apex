# SolMemeHub KOLScan Proxy

Cloudflare Worker proxy for KOLScan API routes.

## Routes

- `GET /api/kolscan/leaderboard`
- `GET /api/kolscan/wallet/:address`
- `GET /api/kolscan/wallet/:address/trades`
- `GET /api/kolscan/token/:address/traders`

## Required Cloudflare secret

`SOLANA_TRACKER_API_KEY`

## Deploy

```powershell
cd C:\Users\thedo\Documents\public-token-site-apex\kolscan-proxy
npx wrangler secret put SOLANA_TRACKER_API_KEY
npx wrangler deploy
```
