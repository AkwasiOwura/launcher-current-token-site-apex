# SolMemeHub — Recent Updates

Ongoing changelog. Newest first, grouped by category. Each entry is short enough to drop straight into a tweet, status post, or release note.

---

## 🆕 Latest

### Mobile token cards — visibility fix
Fixed an invisible-card bug on phones with Reduce Motion enabled (iOS Low Power Mode included). The `cardIn` entrance animation was being neutralized by the reduced-motion override, leaving cards stuck at `opacity: 0` while their chart hit area remained tappable. Cards now default to visible, animate in only when motion is allowed, and a 1500 ms safety net force-reveals any `[data-reveal]` section the IntersectionObserver doesn't catch.

### Modal accessibility — focus traps + Escape + focus restore
Wallet picker, wallet details, trade, chart, and sell-all modals now share a single `SMHModal` helper: focus traps inside the open modal, Escape closes consistently, and focus restores to the triggering element on close. `SMHToast` replaces blocking `alert()` calls across the trade, wallet, and "Coming soon" flows.

### Footer contrast pass
Low-opacity text colors raised toward WCAG AA across the homepage footer and every per-token placeholder page.

### About moved to its own page
The About section was extracted from the homepage into a dedicated `/about/` route with its own grid + responsive layout.

---

## 🛡️ Security & Performance

- **Self-hosted `@solana/web3.js`** — pinned to v1.95.3 under `/vendor/` with `integrity="sha384-…"` SRI; eliminates CDN supply-chain risk on the most security-critical script on the site.
- **Browser-cached data files** — dropped `cache: 'no-store'` on `meme-coins.json` and `tokens.json` so the 69 KB index can be served from the browser cache on repeat visits.
- **De-duped portfolio refreshes** — concurrent wallet refreshes collapse to a single in-flight fetch; minimum 800 ms gap between refreshes unless explicitly forced after a trade.
- **Concurrency-capped KOL enrichment** — leaderboard wallet stats fetch with `concurrency: 2`; last-trade enrichment with `concurrency: 6`.

---

## 🪪 Wallet

- **Sell All** — one-tap full exit per token, with JIT token-account resolution, frozen-account refusal, full-balance Jupiter quote, on-chain confirmation, and post-trade rent reclaim via account close.
- **Wallet details — instant paint** — cached portfolio paints instantly on reconnect while a fresh fetch runs in the background.
- **Live SPL token list** — name, symbol, image, amount, USD value, 24H tone per token, sorted by USD value with a no-show filter for SOL itself (already on the balance card).
- **Per-wallet consent persistence** — signed off-chain attestation survives reloads, scoped per wallet + domain.
- **Silent reconnect** — `onlyIfTrusted` re-attach 400 ms after load, no extra clicks.
- **Mobile wallet panel** — reflowed for ≤640 px screens with full-width address, 22 px balance numerals, and 32 px token avatars.

---

## 📊 KOL Scanner

- **Period switcher** — Daily / Weekly / Monthly with table headers that re-label on the fly.
- **Progressive enrichment** — ROI, win rate, trades, last-trade populate after first paint instead of blocking it.
- **Last-trade derivation** — pulls from the stats endpoint, falls back to the latest-trade endpoint, normalizes to "Xm ago / Xh ago / Xd ago."
- **Wallet detail page** — full PnL breakdown plus newest-first trade feed with Solscan-linked signatures.
- **Token traders view** — paste a mint, see the top wallets active on that token.
- **Cloudflare Worker proxy** — origin-locked to `solmemehub.tech`, holds the Solana Tracker key server-side, redacts long tokens from error excerpts.

---

## 📈 Charts

- **GeckoTerminal-first resolution** — every sparkline tap resolves to a GeckoTerminal embed when possible, DexScreener second, external providers third, enlarged sparkline last.
- **CoinGecko-slug fallback** — slug-only entries resolve their Solana contract at click time and feed back into the same provider pipeline.
- **Per-mint resolution cache** — once resolved, subsequent opens are instant.

---

## 💱 Trade

- **Race-safe quotes** — debounced (350 ms amount / 150 ms slippage) with a monotonic sequence id so stale Jupiter responses are discarded.
- **Slippage presets** — 0.5% / 1% / 2% / 5% / 10%; default 1%.
- **Route transparency** — every quote surfaces hop labels, price impact, and provider.
- **Disabled-state messaging** — when a token has no Solana mint or CoinGecko slug, BUY / SELL render as `aria-disabled` with a clear hover reason instead of vanishing.
- **CoinGecko trade resolution** — slug-only tokens become tradeable the moment a user clicks BUY or SELL.

---

## 🎨 UI / Design

- **Cyber-card token cards** — square edges, corner accents, mint-tone-coded based on 24H change direction.
- **Deterministic sparkline** — seed-stable per mint so the shape doesn't flicker between reloads.
- **Daily Radar** — top-3 hero panel with rank, logo, symbol, price, change, and inline BUY / SELL.
- **Footer redesign** — four columns (Brand / Explore / Tools / Resources) + disclaimer band + Powered-by-Solana mark.
- **About page extraction** — homepage stays focused on discovery; About content lives in its own route.
- **Reveal animations** — `[data-reveal]` sections fade + lift on intersection; gracefully skip on Reduce Motion.

---

## 📱 Mobile

- **Five breakpoints** — ≤1024 / ≤840 / ≤640 / ≤520 / ≤380 px with progressive grid collapse.
- **No horizontal scroll** — `html, body { overflow-x: hidden }` enforced under 1024 px.
- **`dvh`-aware modals** — wallet and trade modals respect `100dvh` so the mobile address bar doesn't clip them.
- **Reflowed token rows** — wallet token list compacts to 3-column grid with stacked Sell All button under 640 px.
- **Full-width wallet connect** — wallet button spans the nav row under 640 px.
- **Mobile-card animation fix** — Reduce Motion users see token cards immediately; motion-OK users still get the staggered cascade.

---

## 🧠 AI / Narrative Layer

- **AI-Driven Change page** — reserved landing under `/aidri/` with kicker, thesis, and source / conversation links.
- **AI-narrative slots** — additional curated routes ready for activation as those tokens mature.

---

## 🔒 Compliance + Risk Surface

- **Footer disclaimer band** — explicit volatility + informational-only language.
- **Sell-All warning** — explicit "this sells the full token balance to SOL" notice before confirm.
- **Verify section framing** — "Trade carefully — verify contracts before trading."
- **No custodial path** — every signature happens inside the user's wallet extension.

---

## 🌐 Distribution + SEO

- **GitHub Pages** — static deploy, custom domain via `CNAME`, `.nojekyll` for verbatim `vendor/` serving.
- **OG + Twitter card meta** — link previews on X, Telegram, Reddit, Discord.
- **`robots.txt` + `sitemap.xml`** — homepage and KOL Scanner indexed; per-token placeholder routes excluded from crawl.

---

## ⚙️ Under the Hood

- **`SMHModal`** — shared focus trap + Escape + focus restore helper used by every modal.
- **`SMHToast`** — non-blocking in-page status replacing browser `alert()`.
- **Mint validation** — KOL Scanner token form rejects non-base58 addresses before hitting the worker.
- **Var-hoisting fix** — kolscan leaderboard `cached`-before-declaration bug squashed; `statsTrade` now correctly reflects cached data.
- **CSS-injection close** — trade modal logo URL goes through `new URL()` + `encodeURI` before being interpolated into `style.backgroundImage`.
