const ALLOWED_ORIGIN = 'https://solmemehub.tech';
const LEADERBOARD_PATH = '/api/kolscan/leaderboard';
const SOLANA_TRACKER_URL = 'https://data.solanatracker.io/v2/pnl/leaderboard/kols';
const TIMEOUT_MS = 10000;
const ERROR_EXCERPT_LIMIT = 700;

function isAllowedOrigin(origin) {
  return !origin || origin === ALLOWED_ORIGIN;
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };

  if (isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
  }

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
  return String(value)
    .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
    .slice(0, ERROR_EXCERPT_LIMIT);
}

function safeJsonExcerpt(text) {
  try {
    const parsed = JSON.parse(text);
    const message =
      parsed.error ||
      parsed.message ||
      parsed.details ||
      parsed.statusText ||
      parsed.status ||
      parsed.code ||
      parsed;

    return safeExcerpt(typeof message === 'string' ? message : JSON.stringify(message));
  } catch {
    return safeExcerpt(text);
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (!isAllowedOrigin(origin)) {
      return jsonResponse({ error: 'forbidden', message: 'Origin is not allowed.' }, 403, origin);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin)
      });
    }

    if (url.pathname !== LEADERBOARD_PATH) {
      return jsonResponse(
        { error: 'not_found', message: 'Route not found.', route: url.pathname, expected: LEADERBOARD_PATH },
        404,
        origin
      );
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed', message: 'Use GET for this route.' }, 405, origin);
    }

    if (!env.SOLANA_TRACKER_API_KEY) {
      return jsonResponse(
        { error: 'missing_secret', message: 'Missing Cloudflare secret: SOLANA_TRACKER_API_KEY.' },
        500,
        origin
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const upstream = await fetch(SOLANA_TRACKER_URL, {
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
            message: 'Leaderboard provider returned an error.',
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
            message: 'Leaderboard provider returned invalid JSON.',
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
          message: timedOut ? 'Leaderboard request timed out.' : 'Leaderboard request failed.',
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
