const ALLOWED_ORIGIN = 'https://solmemehub.tech';
const LEADERBOARD_PATH = '/api/kolscan/leaderboard';
const SOLANA_TRACKER_URL = 'https://data.solanatracker.io/v2/pnl/leaderboard/kols';
const TIMEOUT_MS = 10000;

function isAllowedOrigin(origin) {
  return !origin || origin === ALLOWED_ORIGIN;
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
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
      return jsonResponse({ error: 'not_found', message: 'Route not found.' }, 404, origin);
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: 'method_not_allowed', message: 'Use GET for this route.' }, 405, origin);
    }

    if (!env.SOLANA_TRACKER_API_KEY) {
      return jsonResponse({ error: 'missing_secret', message: 'Proxy is missing required configuration.' }, 500, origin);
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
          { error: 'upstream_error', message: 'Leaderboard provider returned an error.', status: upstream.status },
          502,
          origin
        );
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        return jsonResponse({ error: 'invalid_upstream_json', message: 'Leaderboard provider returned invalid JSON.' }, 502, origin);
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
          message: timedOut ? 'Leaderboard request timed out.' : 'Leaderboard request failed.'
        },
        timedOut ? 504 : 502,
        origin
      );
    } finally {
      clearTimeout(timeout);
    }
  }
};
