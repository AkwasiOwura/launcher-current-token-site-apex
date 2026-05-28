# SolMemeHub — Features Overview

Reference catalog of every shipped feature on [solmemehub.tech](https://solmemehub.tech/). Each section describes what the feature is, how it works at a user level, and what makes it distinct. Written for autonomous content agents — every claim here is verifiable against the live product.

---

## Token Discovery

A curated, browsable index of Solana meme-token pages. Tokens are surfaced in three contexts:

- **Daily Radar** — the homepage top-3 momentum picks
- **Trending Grid** — full radar of active tokens
- **Planned & Live Token Pages** — SolMemeHub-owned per-token landing routes (`/aidri/`, `/andrew/`, `/apple/`, `/belief/`, `/near/`, …)

The grid supports tabbed filtering (`Trending`, `High-cap`, `Low-cap`) and instant client-side search across symbol, name, and mint.

---

## Daily Radar

A dedicated hero panel highlighting the three tokens with the strongest 24-hour momentum signal. Each row carries rank, logo, symbol, market cap or price, and 24H change, with click-through to a chart modal and inline BUY / SELL buttons. The radar refreshes from the same data source as the full trending grid and re-renders on tab switch.

---

## Chart Modal — Embedded Charts

Every token sparkline is interactive. Tapping (or pressing Enter / Space on) a sparkline opens a full-bleed chart modal that resolves the best chart source for the token in this order:

1. **GeckoTerminal** — preferred provider; embedded iframe with `embed=1&info=0&swaps=0`
2. **DexScreener** — fallback embed with chart-only parameters
3. **External providers** (Birdeye, Photon, DEXTools, Pump.fun) — open in a new tab if no embed is possible
4. **Enlarged sparkline** — when no provider is available, the modal degrades to a styled 24H sparkline panel rather than failing silently

Resolution results are cached per-mint and per-payload-key so re-opens are instant.

---

## GeckoTerminal Integration

For any token with a valid Solana mint, SolMemeHub queries the GeckoTerminal pools API, picks the pool with the highest combined liquidity + 24H volume, and embeds that pool's chart. For CoinGecko-slug-only entries, the slug is resolved to a Solana contract first, then routed through the same flow.

---

## Wallet Integration

A dependency-free Solana wallet layer exposed on `window.SMHWallet`. Detects Phantom, Solflare, and Backpack from injected providers, opens a picker modal, and persists only the chosen adapter id (never a key). Signing always happens inside the wallet extension.

Key capabilities:

- `connect(adapterId, opts)` — opens the wallet's connect prompt; supports silent `onlyIfTrusted`
- `signConsent()` — domain- and wallet-bound off-chain attestation
- `signAndSend(tx, connection)` — versioned transaction signing + send via Phantom-style `signAndSendTransaction` with a `signTransaction + sendRawTransaction` fallback
- `getState()` — connected adapter, address, short address, consent state
- `on(fn)` — event subscription for connect / disconnect / account change

---

## Wallet Consent + Authentication

A user must explicitly authenticate after connecting before any trade can be initiated. The consent message is plain-English, nonce-bound, timestamped, and domain-scoped to `solmemehub.tech`. The signature is stored only as proof of intent and never as a key. Disconnecting clears the consent record. Account changes re-evaluate consent against the new address.

---

## Wallet Persistence + Silent Reconnect

The most-recently-used adapter id and the per-wallet consent record are persisted to `localStorage`. On next page load SolMemeHub silently re-attaches via `onlyIfTrusted` after a 400 ms delay (allowing time for providers to inject). If consent already exists for the restored address, the user lands authenticated.

---

## Wallet Details Modal — Portfolio Dashboard

A second wallet modal opens on click of the connected-state wallet button. It shows:

- Adapter name + icon
- Address with one-tap copy
- Live SOL balance with USD value
- A stylized mini-chart on the balance card
- Authentication / consent status pill
- Full SPL token holdings (name, symbol, image, amount, USD value, 24H tone)
- Per-token Sell All action
- Disconnect

Holdings can be sourced from the SolMemeHub kolscan proxy (Solana Tracker upstream) and reconciled against direct RPC token-account reads + Jupiter spot prices.

---

## Portfolio Cache + Background Hydration

Per-wallet portfolio snapshots are cached in `localStorage`. On any reconnect:

1. Cached portfolio paints instantly
2. A background refresh runs (de-duped if one is already in flight)
3. Successful refresh overwrites the painted UI + cache
4. Failed refresh leaves the cached UI in place

A 25-second poll keeps the data fresh while the modal is open. Refreshes are throttled to a minimum 800 ms gap unless `force: true` (used after Buy / Sell / Sell All).

---

## Buy / Sell Trade System

A frontend-only Jupiter swap flow exposed as `window.SMHTrade.open(coin, side, trigger)`. Every coin card and Daily Radar row has BUY and SELL buttons.

The trade modal:

- Pre-fills 0.1 SOL on BUY; blank on SELL
- Shows token name, symbol, mint, logo
- Lets the user pick slippage from 0.5% / 1% / 2% / 5% / 10%
- Fetches live Jupiter quotes (debounced + race-safe)
- Displays estimated receive, route (Jupiter hop labels), price impact, and provider
- Gates execution behind connection, authentication, and a valid quote
- Signs via the connected wallet, sends to a public RPC, confirms on-chain, and links the transaction to Solscan

CoinGecko-slug-only tokens resolve their Solana contract at click time via the CoinGecko `/coins/<slug>` endpoint before the modal opens.

---

## Sell All System

Each token row in the wallet details modal carries a Sell All button. The full flow:

1. Validates the mint and wallet connection
2. Enriches the token by looking up every token account the connected wallet owns for that mint across SPL Token + Token-2022, picking the account with the largest non-zero balance
3. Refuses if the account is frozen or zero
4. Requests authentication if consent isn't already signed
5. Fetches a Jupiter quote for the entire raw balance to SOL
6. Surfaces the estimated SOL receive in the modal
7. On confirm: signs + sends the Jupiter swap, confirms on-chain
8. Attempts to close the now-empty token account to reclaim rent (SPL Token only; Token-2022 close is blocked with a clear reason)
9. Triggers staggered portfolio refreshes at 2.5s / 6.5s / 12s so the wallet panel reflects the new balance

Every step is reported via the modal's status row with appropriate tone (info / warn / ok / error) and a Solscan link on success.

---

## KOL Tracking — KOL Scanner

The `/kolscan/` sub-site is a full KOL leaderboard powered by a Cloudflare Worker proxy fronting Solana Tracker.

Capabilities:

- **Leaderboard** — daily / weekly / monthly periods, ranked by realized PnL, with period PnL, period volume, lifetime PnL, ROI, win rate, total trades, last-trade timing
- **Wallet detail** — `/kolscan/wallet.html?address=<wallet>` shows identity, avatar, Twitter/X link, full PnL breakdown, win rate, trades, profitable / losing tokens, and a recent-trades feed with per-signature Solscan links
- **Token traders** — paste any mint and surface the top wallets active on that token, with per-wallet token PnL, wallet PnL, ROI, buy/sell counts, and last-trade timing
- **Wallet stats enrichment** — leaderboard rows render first, then enrich asynchronously with concurrency-capped fetches (2 for stats, 6 for last-trade)
- **Address copy** — every wallet address is a copy-to-clipboard button with a transient "Copied" state

---

## Token Analytics — RugCheck Verify

The Verify section accepts a Solana mint and renders a structured RugCheck report:

- Headline risk badge (Low risk / Review risks / High risk / Rugged token)
- RugCheck score (normalized to 100)
- Total liquidity
- Mint authority + Freeze authority state (active vs disabled)
- LP locked % (best of all markets)
- Top 10 holder concentration
- Transfer tax %
- Metadata mutability
- Up to six top risk signals with level + description
- Link out to the full RugCheck report

---

## Footer + Resources

A four-column footer surface:

- **Brand** — logo, mission tagline, and verified socials (TikTok, X, Reddit, Email; Telegram + YouTube marked Coming Soon with toast-driven feedback)
- **Explore** — Trending KOLs, New Launches, Top Gainers, Watchlist, Wallet Tracker
- **Tools** — Solana Explorer, Jupiter, DexScreener, Photon, Birdeye
- **Resources** — About, Contact, Terms, Privacy, API Documentation
- **Disclaimer band** — explicit volatility / informational-only notice
- **Powered by Solana** — official mark linking to solana.com

---

## Mobile Responsiveness

Five breakpoints with progressive collapse:

- **≤1024 px** — multi-column grids reflow to 2 columns; topbar stacks; modals adopt `100vw - 20px` widths with `100dvh` height limits
- **≤840 px** — wallet details modal compacts to a 460 px card; profile / balance rows reflow
- **≤640 px** — grids collapse to single column; trade buttons size to 38 px min-height; nav becomes 2 cols with a full-width wallet button
- **≤520 px** — fine-grain spacing tweaks
- **≤380 px** — smallest-phone overrides for nav, hero, coin media, and radar rows

`html, body { overflow-x: hidden }` is enforced under 1024 px so no horizontal scroll is possible on phones.

---

## AI-Project Discovery

Curated landing pages for AI-narrative meme tokens (e.g. `/aidri/` "AI Driven Change") sit alongside the standard token pages. Each carries a "Coming soon" kicker, a one-line thesis, and outbound links to source coverage and X conversation. The homepage radar can promote these to the Daily Radar when they begin trading.

---

## Responsive Layout System

CSS Grid + Flexbox throughout with explicit `minmax(0, 1fr)` constraints to prevent overflow from long token names or addresses. Modal cards use `min(targetWidth, 100vw - gutter)` patterns so they fit any viewport. `overscroll-behavior: contain` prevents body-scroll leakage from open modals.

---

## Chart Systems

Two complementary chart layers:

- **Sparkline** — inline SVG per coin card, deterministic from the mint, anchored to 24H start + current price, with tone-mapped color (mint = up, rose = down, amber = flat)
- **Full chart modal** — provider-resolved embed (GeckoTerminal first, DexScreener second, external links third, enlarged sparkline as final fallback) with cache-keyed resolution

---

## Token Intelligence (Compositional)

SolMemeHub aggregates and surfaces three classes of signal per token:

1. **Momentum** — sparkline, 24H change, Daily Radar rank
2. **Liquidity / market** — market cap, 24H volume, best pool reserve
3. **Risk** — RugCheck score, mint / freeze authority state, LP locked %, holder concentration, transfer tax, metadata mutability

When combined with the KOL Scanner's "who is trading this," users get a complete picture inside a single product surface.

---

## In-Page Toast System

A shared `window.SMHToast(message, { kind })` helper replaces `alert()` for non-blocking status. Kinds: `info`, `warn`, `error`. Automatically positioned bottom-center with role / aria-live for screen readers.

---

## Modal Accessibility

A shared `window.SMHModal.activate(modal, trigger)` / `deactivate(modal)` helper:

- Traps focus inside the open modal via `Tab` / `Shift+Tab` cycling
- Auto-focuses the first focusable on open
- Restores focus to the triggering element on close (when still in DOM)
- Standardizes Escape-to-close across wallet picker, wallet details, trade, chart, and sell-all modals

---

## Security Posture

- Self-hosted `@solana/web3.js@1.95.3` under `/vendor/` with `integrity="sha384-…"` SRI to block CDN supply-chain compromise
- `escapeHtml` and `safeUrl` / `safeAssetUrl` helpers applied at every untrusted-data injection point
- No private-key handling: every signature path delegates to the wallet extension
- Cloudflare Worker proxy holds the Solana Tracker API key server-side and redacts long tokens from error excerpts
- Origin allow-listing on the worker (`Access-Control-Allow-Origin: https://solmemehub.tech`)
- `referrerpolicy="no-referrer"` on user-content images

---

## Hosting + Distribution

- **Primary**: GitHub Pages, custom domain `solmemehub.tech` via `CNAME`
- **Static**: no build step; `.nojekyll` to ship `vendor/` verbatim
- **SEO surface**: `robots.txt` + `sitemap.xml` + Open Graph + Twitter card meta on the apex homepage
- **API surface**: Cloudflare Worker at `solmemehub-kolscan-proxy.solmemehub.workers.dev` for KOL data
