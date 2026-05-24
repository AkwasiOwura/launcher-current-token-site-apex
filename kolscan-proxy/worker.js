const ALLOWED_ORIGIN = 'https://solmemehub.tech';
const API_BASE = 'https://data.solanatracker.io';
const TIMEOUT_MS = 12000;
const ERROR_EXCERPT_LIMIT = 700;

const ROUTES = [
  {
    pattern: /^\/api\/kolscan\/leaderboard\/?$/,
    upstream: () => '/v2/pnl/leaderboard/kols'
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
    if (match) return route.upstream(match);
  }
  return null;
}

function safeQuery(searchParams) {
  const params = new URLSearchParams();
  const allowed = new Set([
    'cursor',
    'limit',
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

    const upstreamPath = resolveRoute(url.pathname);
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
