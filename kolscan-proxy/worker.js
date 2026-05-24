const ALLOWED_ORIGIN = 'https://solmemehub.tech';
const API_BASE = 'https://data.solanatracker.io';
const TIMEOUT_MS = 12000;
const ERROR_EXCERPT_LIMIT = 700;

const ROUTES = [
  {
    pattern: /^\/api\/kolscan\/leaderboard\/?$/,
    upstream: (_match, searchParams) => {
      const period = normalizeLeaderboardPeriod(searchParams.get('period') || searchParams.get('timeframe'));
      searchParams.delete('timeframe');
      if (!period) return '/v2/pnl/leaderboard/kols';
      searchParams.set('period', period);
      return '/v2/pnl/leaderboard/kols/period';
    }
  },
  {
    pattern: /^\/api\/kolscan\/wallet\/([1-9A-HJ-NP-Za-km-z]{32,44})\/?$/,
    upstream: (match) => `/v2/pnl/wallets/${match[1]}`
  },
  {
    pattern: /^\/api\/kolscan\/wallet\/([1-9A-HJ-NP-Za-km-z]{32,44})\/trades\/?$/,
    upstream: (match) => `/wallet/${match[1]}/trades`
  },
  {
    pattern: /^\/api\/kolscan\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})\/traders\/?$/,
    upstream: (match) => `/v2/pnl/tokens/${match[1]}/traders`
  }
];

function isAllowedOrigin(origin) {
  return !origin || origin === ALLOWED_ORIGIN;
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
  if (isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
  return headers;
}

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin)
    }
  });
}

function safeExcerpt(value) {
  if (!value) return '';
  return String(value).replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]').slice(0, ERROR_EXCERPT_LIMIT);
}

function safeJsonExcerpt(text) {
  try {
    const parsed = JSON.parse(text);
    const message = parsed.error || parsed.message || parsed.details || parsed.statusText || parsed.status || parsed.code || parsed;
    return safeExcerpt(typeof message === 'string' ? message : JSON.stringify(message));
  } catch {
    return safeExcerpt(text);
  }
}

function resolveRoute(pathname) {
  for (const route of ROUTES) {
    const match = pathname.match(route.pattern);
    if (match) return route.upstream(match, arguments[1]);
  }
  return null;
}

function normalizeLeaderboardPeriod(value) {
  const period = String(value || '').trim().toLowerCase();
  if (period === 'daily' || period === 'day' || period === '1d') return '1d';
  if (period === 'weekly' || period === 'week' || period === '7d') return '7d';
  if (period === 'monthly' || period === 'month' || period === '30d') return '30d';
  if (['14d', '90d'].includes(period)) return period;
  return '';
}

function pick(source, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), source);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value.replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveWalletStats(payload, wallet) {
  const directWinRate = toNumber(pick(payload, ['analysis.winRate', 'winRate']));
  const winning = toNumber(pick(payload, ['stats.profitable', 'analysis.tokens.winning', 'profitableTokens']));
  const losing = toNumber(pick(payload, ['stats.losing', 'analysis.tokens.losing', 'losingTokens']));
  const winRate = directWinRate !== null
    ? directWinRate
    : winning !== null && losing !== null && winning + losing > 0
      ? (winning / (winning + losing)) * 100
      : null;
  return {
    wallet,
    roi: toNumber(pick(payload, ['summary.roi', 'roi'])),
    winRate,
    trades: toNumber(pick(payload, ['summary.counts.trades', 'counts.trades', 'trades', 'totalTrades'])),
    sourceFields: {
      roi: pick(payload, ['summary.roi', 'roi']) !== null ? 'summary.roi' : null,
      winRate: directWinRate !== null ? 'analysis.winRate' : winning !== null && losing !== null ? 'stats.profitable/stats.losing' : null,
      trades: pick(payload, ['summary.counts.trades', 'counts.trades', 'trades', 'totalTrades']) !== null ? 'summary.counts.trades' : null
    }
  };
}

async function walletStatsResponse(wallet, env, origin) {
  if (!env.SOLANA_TRACKER_API_KEY) {
    return jsonResponse({ ok: false, error: 'missing_secret', data: { wallet, roi: null, winRate: null, trades: null } }, 200, origin);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(API_BASE + `/v2/pnl/wallets/${wallet}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-api-key': env.SOLANA_TRACKER_API_KEY
      },
      signal: controller.signal
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      return jsonResponse({ ok: false, error: 'upstream_unavailable', upstreamStatus: upstream.status, data: { wallet, roi: null, winRate: null, trades: null } }, 200, origin);
    }
    const parsed = JSON.parse(text);
    return jsonResponse({ ok: true, source: 'solana-tracker', route: `/api/kolscan/wallet/${wallet}/stats`, data: deriveWalletStats(parsed, wallet) }, 200, origin);
  } catch (error) {
    return jsonResponse({ ok: false, error: error && error.name === 'AbortError' ? 'timeout' : 'request_failed', data: { wallet, roi: null, winRate: null, trades: null } }, 200, origin);
  } finally {
    clearTimeout(timeout);
  }
}

function safeQuery(searchParams) {
  const params = new URLSearchParams();
  const allowed = new Set([
    'cursor',
    'direction',
    'limit',
    'sort',
    'sortBy',
    'sortDirection',
    'timeframe',
    'period',
    'from',
    'to',
    'platform',
    'excludeArbitrage',
    'excludeZeroBuys',
    'activeOnly',
    'pnlMode'
  ]);
  for (const [key, value] of searchParams.entries()) {
    if (allowed.has(key)) params.append(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (!isAllowedOrigin(origin)) {
      return jsonResponse({ error: 'forbidden', message: 'Origin is not allowed.' }, 403, origin);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed', message: 'Use GET for this route.' }, 405, origin);
    }

    const statsMatch = url.pathname.match(/^\/api\/kolscan\/wallet\/([1-9A-HJ-NP-Za-km-z]{32,44})\/stats\/?$/);
    if (statsMatch) {
      return walletStatsResponse(statsMatch[1], env, origin);
    }

    const upstreamPath = resolveRoute(url.pathname, url.searchParams);
    if (!upstreamPath) {
      return jsonResponse({ error: 'not_found', message: 'Kolscan proxy route not found.', route: url.pathname }, 404, origin);
    }

    if (!env.SOLANA_TRACKER_API_KEY) {
      return jsonResponse({ error: 'missing_secret', message: 'Missing Cloudflare secret: SOLANA_TRACKER_API_KEY.' }, 500, origin);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const upstreamUrl = API_BASE + upstreamPath + safeQuery(url.searchParams);

    try {
      const upstream = await fetch(upstreamUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-api-key': env.SOLANA_TRACKER_API_KEY
        },
        signal: controller.signal
      });

      const text = await upstream.text();

      if (!upstream.ok) {
        return jsonResponse(
          {
            error: 'upstream_error',
            message: 'Solana Tracker returned an error.',
            upstreamStatus: upstream.status,
            upstreamStatusText: upstream.statusText,
            upstreamBodyExcerpt: safeJsonExcerpt(text)
          },
          502,
          origin
        );
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return jsonResponse(
          {
            error: 'invalid_upstream_json',
            message: 'Solana Tracker returned invalid JSON.',
            upstreamStatus: upstream.status,
            upstreamBodyExcerpt: safeExcerpt(text)
          },
          502,
          origin
        );
      }

      return jsonResponse(
        {
          ok: true,
          source: 'solana-tracker',
          route: url.pathname,
          updatedAt: new Date().toISOString(),
          data
        },
        200,
        origin
      );
    } catch (error) {
      const timedOut = error && error.name === 'AbortError';
      return jsonResponse(
        {
          error: timedOut ? 'timeout' : 'request_failed',
          message: timedOut ? 'Solana Tracker request timed out.' : 'Solana Tracker request failed.',
          detail: safeExcerpt(error && error.message)
        },
        timedOut ? 504 : 502,
        origin
      );
    } finally {
      clearTimeout(timeout);
    }
  }
};
