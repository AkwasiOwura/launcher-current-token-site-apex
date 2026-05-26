(function () {
  'use strict';

  var reducedMotion = false;
  var memeState = {
    data: null,
    tab: 'trending',
    query: ''
  };
  var RUGCHECK_REPORT_BASE = 'https://api.rugcheck.xyz/v1/tokens/';
  var chartResolutionCache = Object.create(null);
  try {
    reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (_err) {
    reducedMotion = false;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char];
    });
  }

  function safeUrl(value, fallback) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return fallback || '#';
    try {
      var url = new URL(raw, window.location.href);
      if (url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === window.location.protocol) {
        return url.href;
      }
    } catch (_err) {
      return fallback || '#';
    }
    return fallback || '#';
  }

  function safeAssetUrl(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    try {
      var url = new URL(raw, window.location.href);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch (_err) {
      return '';
    }
  }

  function normalizeSlug(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/^\.?\//, '')
      .replace(/\/+$/, '')
      .replace(/[^a-z0-9-]/gi, '')
      .toLowerCase();
  }

  function compactNumber(value, prefix) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    return (prefix || '') + Intl.NumberFormat('en', {
      notation: 'compact',
      maximumFractionDigits: n >= 1000000 ? 1 : 0
    }).format(n);
  }

  function compactPrice(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 0.01) return '$' + n.toPrecision(2);
    return '$' + Intl.NumberFormat('en', {
      minimumFractionDigits: n < 1 ? 4 : 2,
      maximumFractionDigits: n < 1 ? 4 : 2
    }).format(n);
  }

  function compactPercent(value) {
    var n = Number(value);
    if (!Number.isFinite(n) || n === 0) return '';
    return (n > 0 ? '+' : '') + Intl.NumberFormat('en', {
      maximumFractionDigits: 1
    }).format(n) + '%';
  }

  function percentNumber(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '';
    return Intl.NumberFormat('en', {
      maximumFractionDigits: n >= 10 ? 1 : 2
    }).format(n) + '%';
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function tokenDate(token) {
    var raw = token.publishedAt || token.updatedAt || token.createdAt || token.date || '';
    var time = Date.parse(raw);
    return Number.isFinite(time) ? time : 0;
  }

  function tokenDescription(token) {
    return token.description || token.tagline || token.summary || 'A public Solana meme-token page indexed by SolMemeHub.';
  }

  function emptyMarkup(title, message) {
    return [
      '<article class="empty-card">',
      '<span class="empty-icon">◇</span>',
      '<h3>' + escapeHtml(title) + '</h3>',
      '<p>' + escapeHtml(message) + '</p>',
      '</article>'
    ].join('');
  }

  function renderEmpty(id, title, message) {
    var grid = document.getElementById(id);
    if (!grid) return;
    grid.innerHTML = emptyMarkup(title, message);
  }

  // ── Sparkline ─────────────────────────────────────────────────────
  // Builds a compact terminal-style SVG line anchored to the 24h start and
  // current price. Intraday points are deterministic visual texture, shaped
  // to read like active market movement without claiming exact tick history.
  function hashSeed(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h;
  }
  function sparklinePath(coin) {
    var price = Number(coin && (coin.priceUsd || coin.price));
    var change = Number(coin && (coin.priceChange24h || coin.change24h || coin.priceChange));
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(change)) return null;
    var start = price / (1 + change / 100);
    if (!Number.isFinite(start) || start <= 0) return null;
    var seed = hashSeed(String(coin.mint || coin.symbol || coin.name || 'coin'));
    var N = 72;
    var pts = new Array(N);
    var dir = price - start;
    var absChange = Math.abs(change);
    var refRange = Math.max(Math.abs(dir), price * (0.018 + Math.min(absChange, 45) / 2400));
    var phase1 = ((seed       ) % 1000) / 1000 * Math.PI * 2;
    var phase2 = ((seed >>  6) % 1000) / 1000 * Math.PI * 2;
    var phase3 = ((seed >> 12) % 1000) / 1000 * Math.PI * 2;
    var phase4 = ((seed >> 18) % 1000) / 1000 * Math.PI * 2;
    var phase5 = ((seed >> 21) % 1000) / 1000 * Math.PI * 2;
    var pullbackAt = 0.45 + ((seed >> 24) % 30) / 100;   // 0.45..0.75 along the path
    var pullbackDepth = 0.34 + ((seed >> 9) % 26) / 100; // 0.34..0.60 of refRange
    var pullbackAt2 = 0.16 + ((seed >> 15) % 26) / 100;  // 0.16..0.42
    var chop = 0;
    for (var i = 0; i < N; i += 1) {
      var t = i / (N - 1);
      var ease = t * t * (3 - 2 * t);
      var stair = Math.sin(t * Math.PI * (2.3 + ((seed >> 3) % 20) / 18) + phase3) * 0.025;
      var smooth = Math.max(0, Math.min(1, ease + stair * Math.sin(Math.PI * t)));
      var base = start + dir * smooth;
      var w1 = Math.sin(t * 8.4  + phase1) * 0.125;
      var w2 = Math.sin(t * 15.7 + phase2) * 0.074;
      var w3 = Math.sin(t * 4.6  + phase3) * 0.088;
      var w4 = Math.cos(t * 28.0 + phase4) * 0.040;
      var w5 = Math.sin(t * 45.0 + phase5) * 0.020;
      var rawNoise = Math.sin((i + 1) * 12.9898 + seed * 0.00011) * 43758.5453;
      chop = chop * 0.64 + (rawNoise - Math.floor(rawNoise) - 0.5) * 0.052;
      var b = Math.exp(-Math.pow((t - pullbackAt) / 0.10, 2));
      var b2 = Math.exp(-Math.pow((t - pullbackAt2) / 0.065, 2));
      var pullback = -Math.sign(dir || 1) * pullbackDepth * b;
      var fakeout = Math.sign(dir || 1) * (0.16 + ((seed >> 5) % 14) / 100) * b2;
      var damp = Math.pow(Math.sin(Math.PI * t), 0.78);
      pts[i] = base + (w1 + w2 + w3 + w4 + w5 + chop + pullback + fakeout) * refRange * damp;
    }
    pts[0] = start;
    pts[N - 1] = price;
    // normalise to viewBox 100x40
    var lo = Math.min.apply(null, pts);
    var hi = Math.max.apply(null, pts);
    var span = hi - lo || price * 0.01;
    var xs = pts.map(function (_, i) { return (i / (N - 1)) * 100; });
    var ys = pts.map(function (p) { return 38 - ((p - lo) / span) * 34 - 2; });
    var d = 'M' + xs[0].toFixed(2) + ' ' + ys[0].toFixed(2);
    for (var j = 1; j < N; j += 1) {
      d += ' L' + xs[j].toFixed(2) + ' ' + ys[j].toFixed(2);
    }
    return { path: d, lastX: xs[N - 1], lastY: ys[N - 1], direction: change > 1 ? 'up' : change < -1 ? 'down' : 'flat' };
  }
  function sparklineSvg(coin) {
    var s = sparklinePath(coin);
    if (!s) return '';
    var area = s.path + ' L100 40 L0 40 Z';
    return [
      '<svg class="coin-sparkline" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">',
      '<path class="spark-area" d="' + area + '" fill="currentColor" stroke="none"/>',
      '<path class="spark-line" d="' + s.path + '" stroke="currentColor"/>',
      '<circle class="spark-end" cx="' + s.lastX.toFixed(2) + '" cy="' + s.lastY.toFixed(2) + '" r="1.6" fill="currentColor"/>',
      '</svg>'
    ].join('');
  }

  function chartUrlType(url) {
    var raw = String(url || '').toLowerCase();
    if (/dexscreener\.com\/solana\//.test(raw)) return 'dexscreener';
    if (/geckoterminal\.com\/solana\/pools\//.test(raw)) return 'geckoterminal';
    if (/birdeye\.so\//.test(raw)) return 'birdeye';
    if (/photon-sol\.tinyastro\.io\//.test(raw)) return 'photon';
    if (/dextools\.io\//.test(raw)) return 'dextools';
    if (/pump\.fun\/coin\//.test(raw) || /pump\.swap|pumpswap/.test(raw)) return 'pump';
    return '';
  }

  function withParams(url, params) {
    try {
      var next = new URL(url, window.location.href);
      Object.keys(params).forEach(function (key) { next.searchParams.set(key, params[key]); });
      return next.href;
    } catch (_err) {
      return url;
    }
  }

  function dexScreenerChartOnlyUrl(url) {
    return withParams(url, {
      embed: '1',
      loadChartSettings: '0',
      chartLeftToolbar: '0',
      chartTheme: 'dark',
      theme: 'dark',
      chartStyle: '0',
      chartType: 'usd',
      interval: '15',
      info: '0',
      trades: '0'
    });
  }

  function chartSourceFromUrl(url) {
    var clean = safeUrl(url, '');
    var type = chartUrlType(clean);
    if (type === 'dexscreener') {
      return { provider: 'DexScreener', mode: 'iframe', embedUrl: dexScreenerChartOnlyUrl(clean), externalUrl: clean };
    }
    if (type === 'geckoterminal') {
      return { provider: 'GeckoTerminal', mode: 'iframe', embedUrl: withParams(clean, { embed: '1', info: '0', swaps: '0' }), externalUrl: clean };
    }
    if (type === 'birdeye') return { provider: 'Birdeye', mode: 'external', externalUrl: clean };
    if (type === 'photon') return { provider: 'Photon', mode: 'external', externalUrl: clean };
    if (type === 'dextools') return { provider: 'DEXTools', mode: 'external', externalUrl: clean };
    if (type === 'pump') return { provider: 'Pump.fun', mode: 'external', externalUrl: clean };
    return null;
  }

  function urlsFromValue(value, list) {
    if (!value) return list;
    if (Array.isArray(value)) {
      value.forEach(function (item) { urlsFromValue(item, list); });
      return list;
    }
    if (typeof value === 'object') {
      Object.keys(value).forEach(function (key) { urlsFromValue(value[key], list); });
      return list;
    }
    String(value).replace(/https?:\/\/[^\s"'<>]+/g, function (url) {
      list.push(url);
      return url;
    });
    return list;
  }

  function coinGeckoSlug(coin) {
    var explicit = normalizeSlug(coin && coin.coingeckoId);
    if (explicit) return explicit;
    var fallback = String(coin && coin.fallbackUrl || '');
    var match = fallback.match(/coingecko\.com\/en\/coins\/([^/?#]+)/i);
    if (match) return normalizeSlug(match[1]);
    var mint = normalizeSlug(coin && coin.mint);
    if (mint && !isSolanaAddress(mint) && (coin && (coin.sourceName === 'CoinGecko' || String(coin.label || '').toLowerCase().indexOf('coingecko') !== -1))) {
      return mint;
    }
    return '';
  }

  function chartSourceForCoin(coin) {
    // GeckoTerminal-first policy: if we have a real Solana mint OR a
    // CoinGecko id we can resolve to a mint, defer to the async
    // resolveChartProvider() which queries GeckoTerminal before any
    // other provider. The modal opens immediately on click and the
    // resolution paints into it.
    var mint = String(coin && (coin.mint || coin.contract || coin.address) || '').trim();
    if (isSolanaAddress(mint) || coinGeckoSlug(coin)) {
      return { provider: 'GeckoTerminal', mode: 'fallback', externalUrl: '', lookupPending: true };
    }
    // No usable identifier — try any explicit provider URLs the coin
    // happens to carry, then external fallbacks.
    var providerUrls = [
      coin && coin.chartUrl,
      coin && coin.geckoTerminalUrl,
      coin && coin.dexScreenerUrl,
      coin && coin.tradingViewUrl,
      coin && coin.birdeyeUrl,
      coin && coin.photonUrl,
      coin && coin.dextoolsUrl
    ].concat(urlsFromValue(coin && coin.sources, [])).map(function (url) { return safeUrl(url, ''); }).filter(Boolean);
    for (var i = 0; i < providerUrls.length; i += 1) {
      var source = chartSourceFromUrl(providerUrls[i]);
      if (source) return source;
    }
    if (coin && coin.pumpFunUrl) {
      return { provider: 'Pump.fun', mode: 'external', externalUrl: safeUrl(coin.pumpFunUrl, '') };
    }
    var fallbackUrls = [coin && coin.fallbackUrl, coin && coin.url]
      .map(function (url) { return safeUrl(url, ''); }).filter(Boolean);
    for (var f = 0; f < fallbackUrls.length; f += 1) {
      var fbs = chartSourceFromUrl(fallbackUrls[f]);
      if (fbs) return fbs;
    }
    return { provider: 'Sparkline', mode: 'fallback', externalUrl: '', lookupPending: false };
  }

  function chartCacheKey(payload) {
    return [
      payload && payload.mint,
      payload && payload.contract,
      payload && payload.address,
      payload && payload.coingeckoId,
      payload && payload.fallbackUrl,
      payload && payload.symbol,
      payload && payload.name
    ].filter(Boolean).join('|').toLowerCase();
  }

  function fetchChartJson(url) {
    return fetch(url, { cache: 'force-cache', credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('Chart lookup HTTP ' + response.status);
        return response.json();
      });
  }

  function bestDexScreenerPair(pairs) {
    return (Array.isArray(pairs) ? pairs : [])
      .filter(function (pair) { return pair && pair.chainId === 'solana' && pair.url; })
      .sort(function (a, b) {
        var bl = Number(b && b.liquidity && b.liquidity.usd) || 0;
        var al = Number(a && a.liquidity && a.liquidity.usd) || 0;
        var bv = Number(b && b.volume && b.volume.h24) || 0;
        var av = Number(a && a.volume && a.volume.h24) || 0;
        return (bl + bv) - (al + av);
      })[0] || null;
  }

  function resolveDexScreenerByMint(mint) {
    if (!isSolanaAddress(mint)) return Promise.resolve(null);
    return fetchChartJson('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(mint))
      .then(function (data) {
        var pair = bestDexScreenerPair(data && data.pairs);
        return pair && pair.url ? chartSourceFromUrl(pair.url) : null;
      })
      .catch(function () { return null; });
  }

  function bestGeckoPoolUrl(data) {
    var pools = Array.isArray(data && data.data) ? data.data : [];
    var pool = pools
      .filter(function (item) { return item && item.type === 'pool' && item.attributes && item.attributes.address; })
      .sort(function (a, b) {
        var br = Number(b.attributes.reserve_in_usd) || 0;
        var ar = Number(a.attributes.reserve_in_usd) || 0;
        var bv = Number(b.attributes.volume_usd && b.attributes.volume_usd.h24) || 0;
        var av = Number(a.attributes.volume_usd && a.attributes.volume_usd.h24) || 0;
        return (br + bv) - (ar + av);
      })[0];
    return pool ? 'https://www.geckoterminal.com/solana/pools/' + encodeURIComponent(pool.attributes.address) : '';
  }

  function resolveGeckoTerminalByMint(mint) {
    if (!isSolanaAddress(mint)) return Promise.resolve(null);
    return fetchChartJson('https://api.geckoterminal.com/api/v2/networks/solana/tokens/' + encodeURIComponent(mint) + '/pools')
      .then(function (data) {
        var url = bestGeckoPoolUrl(data);
        return url ? chartSourceFromUrl(url) : null;
      })
      .catch(function () { return null; });
  }

  function resolveCoinGeckoAddress(slug) {
    if (!slug) return Promise.resolve('');
    return fetchChartJson('https://api.coingecko.com/api/v3/coins/' + encodeURIComponent(slug) + '?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false')
      .then(function (data) {
        var platforms = data && data.platforms || {};
        var detail = data && data.detail_platforms && data.detail_platforms.solana || {};
        return String(platforms.solana || detail.contract_address || data.contract_address || '').trim();
      })
      .catch(function () { return ''; });
  }

  function resolveChartProvider(payload) {
    var key = chartCacheKey(payload);
    if (key && chartResolutionCache[key]) return Promise.resolve(chartResolutionCache[key]);
    var mint = String(payload && (payload.mint || payload.contract || payload.address) || '').trim();
    var mintKey = isSolanaAddress(mint) ? mint.toLowerCase() : '';
    if (mintKey && chartResolutionCache[mintKey]) return Promise.resolve(chartResolutionCache[mintKey]);
    var slug = normalizeSlug(payload && payload.coingeckoId) || coinGeckoSlug(payload);
    var sequence = Promise.resolve(null);

    if (isSolanaAddress(mint)) {
      // GeckoTerminal FIRST per policy; DexScreener only as fallback.
      sequence = sequence
        .then(function (source) { return source || resolveGeckoTerminalByMint(mint); })
        .then(function (source) { return source || resolveDexScreenerByMint(mint); });
    }

    if (slug && !isSolanaAddress(mint)) {
      sequence = sequence.then(function (source) {
        if (source) return source;
        return resolveCoinGeckoAddress(slug).then(function (resolvedMint) {
          if (!isSolanaAddress(resolvedMint)) return null;
          payload.mint = resolvedMint;
          return resolveGeckoTerminalByMint(resolvedMint)
            .then(function (gt) { return gt || resolveDexScreenerByMint(resolvedMint); });
        });
      });
    }

    return sequence.then(function (source) {
      if (source && key) chartResolutionCache[key] = source;
      if (source && isSolanaAddress(payload && payload.mint)) chartResolutionCache[String(payload.mint).toLowerCase()] = source;
      return source;
    });
  }

  function coinCard(coin, index, mode) {
    var name = escapeHtml(coin.name || coin.symbol || 'Unnamed coin');
    var symbol = escapeHtml(String(coin.symbol || '').replace(/^\$/, '').toUpperCase());
    var label = escapeHtml(coin.label || coin.category || 'Market radar');
    var rank = Number.isFinite(Number(coin.rank)) ? '#' + Number(coin.rank) : '';
    var mint = escapeHtml(coin.mint || coin.contract || '');
    var href = safeUrl(coin.pumpFunUrl || coin.url || coin.fallbackUrl, '#');
    var initials = escapeHtml((symbol || name).replace(/[^a-z0-9]/gi, '').slice(0, 2) || 'SM');
    var image = safeAssetUrl(coin.imageUrl || coin.image || coin.icon || coin.logo || '');
    var marketCap = compactNumber(coin.marketCapUsd, '$');
    var volume = compactNumber(coin.volume24hUsd, '$');
    var delay = Math.min(index * 28, 360);
    var meta = [];

    if (rank) meta.push(rank);
    if (marketCap) meta.push('Cap ' + marketCap);
    if (volume && mode !== 'highcap') meta.push('Vol ' + volume);
    if (!marketCap && !volume) meta.push('Market radar');

    var sparkSvg = sparklineSvg(coin);
    var chartSource = chartSourceForCoin(coin);
    var changeNum = Number(coin && (coin.priceChange24h || coin.change24h || coin.priceChange));
    var changeDir = Number.isFinite(changeNum) ? (changeNum > 1 ? 'is-up' : changeNum < -1 ? 'is-down' : 'is-flat') : 'is-flat';
    var changeClass = Number.isFinite(changeNum) ? (changeNum > 1 ? 'up' : changeNum < -1 ? 'down' : 'flat') : 'flat';
    var changeText = Number.isFinite(changeNum) ? (changeNum > 0 ? '▲ ' : changeNum < 0 ? '▼ ' : '') + Math.abs(changeNum).toFixed(2) + '%' : '';
    var chartPayload = {
      name: coin.name || '',
      symbol: coin.symbol || '',
      mint: coin.mint || coin.contract || '',
      coingeckoId: coin.coingeckoId || coinGeckoSlug(coin),
      sourceName: coin.sourceName || '',
      fallbackUrl: coin.fallbackUrl || '',
      pumpFunUrl: coin.pumpFunUrl || '',
      url: coin.url || '',
      provider: chartSource.provider,
      mode: chartSource.mode,
      embedUrl: chartSource.embedUrl || '',
      externalUrl: chartSource.externalUrl || '',
      lookupPending: !!chartSource.lookupPending,
      sparkSvg: sparkSvg
    };
    var sparkBlock = sparkSvg ? [
      '<div class="coin-spark-wrap" role="button" tabindex="0" title="Click to reveal chart" aria-label="Click to reveal chart for ' + (symbol || name) + '" data-chart="' + escapeHtml(JSON.stringify(chartPayload)) + '">',
      sparkSvg,
      '<div class="spark-meta"><span class="label">24h trend</span>' + (changeText ? '<span class="delta ' + changeClass + '">' + changeText + '</span>' : '') + '</div>',
      '</div>'
    ].join('') : '';
    // BUY/SELL render policy: every card MUST show both buttons.
    //   - Real Solana mint (base58 32-44 chars)  -> enabled, direct payload
    //   - CoinGecko-id-only entry (no native mint) -> enabled, payload
    //     carries coingeckoSlug so trade.js can resolve it to a mint at
    //     click time via /coins/<slug>.platforms.solana
    //   - Neither -> rendered as DISABLED with a hover/tap reason; never
    //     removed from the card.
    var rawMint = coin && (coin.mint || coin.contract || coin.address) || '';
    var validMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(rawMint || ''));
    var cgSlug = !validMint ? coinGeckoSlug(coin) : '';
    var disabledReason = '';
    var slim = { name: coin.name || '', symbol: coin.symbol || '', imageUrl: coin.imageUrl || '' };
    if (validMint) {
      slim.mint = rawMint;
    } else if (cgSlug) {
      slim.coingeckoSlug = cgSlug;
    } else {
      disabledReason = 'Trading unavailable — no Solana mint mapped for this token.';
    }
    var tradePayload = ' data-coin="' + escapeHtml(JSON.stringify(slim)) + '"';
    var disAttr = disabledReason ? ' disabled aria-disabled="true" title="' + escapeHtml(disabledReason) + '"' : '';
    var tradeBlock = [
      '<div class="coin-trade">',
      '<button type="button" class="trade-btn trade-buy" data-trade="buy" aria-label="Buy ' + (symbol || name) + '"' + disAttr + '><span class="cyber-corner-tl" aria-hidden="true"></span><span class="cyber-corner-br" aria-hidden="true"></span>BUY</button>',
      '<button type="button" class="trade-btn trade-sell" data-trade="sell" aria-label="Sell ' + (symbol || name) + '"' + disAttr + '><span class="cyber-corner-tl" aria-hidden="true"></span><span class="cyber-corner-br" aria-hidden="true"></span>SELL</button>',
      '</div>'
    ].join('');
    var openHref = safeUrl(href, '');
    var openLink = openHref
      ? '<a class="coin-open" href="' + openHref + '" target="_blank" rel="noopener noreferrer" aria-label="Open source page for ' + (symbol || name) + '">Open ↗</a>'
      : '<span class="coin-open is-disabled" aria-disabled="true" title="No source page available">Open ↗</span>';
    return [
      '<article class="coin-card ' + changeDir + '" style="animation-delay:' + delay + 'ms"' + tradePayload + '>',
      '<span class="cyber-corner-tl" aria-hidden="true"></span>',
      '<span class="cyber-corner-br" aria-hidden="true"></span>',
      '<div class="coin-media">',
      image ? '<img src="' + image + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-coin-image />' : '',
      '<span class="coin-fallback">' + initials + '</span>',
      '</div>',
      '<div class="coin-body">',
      '<h3 class="coin-title"><span class="coin-rank-text">' + (rank || '#—') + '</span> <span class="coin-name">' + name + '</span></h3>',
      '<p class="coin-symbol">' + (symbol ? '$' + symbol : 'Pump.fun coin') + '</p>',
      mint ? '<code class="coin-mint">' + mint.slice(0, 6) + '...' + mint.slice(-5) + '</code>' : '',
      sparkBlock,
      tradeBlock,
      '</div>',
      '<div class="coin-footer"><span>' + (meta.length ? meta.join(' · ') : 'Open page') + '</span>' + openLink + '</div>',
      '</article>'
    ].join('');
  }

  function tickerText(coin) {
    var symbol = String(coin && coin.symbol ? coin.symbol : coin && coin.name ? coin.name : 'MEME')
      .replace(/^\$/, '')
      .trim()
      .toUpperCase()
      .slice(0, 14);
    var price = compactPrice(coin && (coin.priceUsd || coin.price));
    var change = compactPercent(coin && (coin.priceChange24h || coin.change24h || coin.priceChange));
    var marketCap = compactNumber(coin && coin.marketCapUsd, '$');
    var volume = compactNumber(coin && coin.volume24hUsd, '$');

    if (change) return '$' + symbol + ' ' + change;
    if (price) return '$' + symbol + ' ' + price;
    if (marketCap) return '$' + symbol + ' mcap ' + marketCap;
    if (volume) return '$' + symbol + ' vol ' + volume;
    return '$' + symbol + ' · Trending';
  }

  function renderTicker(data) {
    var track = document.getElementById('meme-ticker-track');
    if (!track) return;
    var pool = []
      .concat(data && Array.isArray(data.trending) ? data.trending : [])
      .concat(data && Array.isArray(data.highCap) ? data.highCap : []);
    var seen = {};
    var coins = pool.filter(function (coin) {
      var key = coin && (coin.mint || coin.symbol || coin.name);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    }).slice(0, 14);

    if (!coins.length) {
      track.innerHTML = '<a href="#trending">$MEME · Radar loading</a><a href="#trending">$SOL · Updated regularly</a><a href="#trending">$PUMP · Trending</a><a href="#trending">$COIN · Meme radar</a>';
      return;
    }

    var items = coins.map(function (coin) {
      var href = safeUrl(coin.pumpFunUrl || coin.url || coin.fallbackUrl, '#');
      var change = Number(coin.priceChange24h || coin.change24h || coin.priceChange);
      var trendClass = Number.isFinite(change) && change !== 0 ? (change > 0 ? ' ticker-up' : ' ticker-down') : '';
      return '<a class="' + trendClass.trim() + '" href="' + href + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(tickerText(coin)) + '</a>';
    });
    track.innerHTML = items.concat(items).join('');
  }

  function allCoins(data) {
    return []
      .concat(data && Array.isArray(data.dailyRadar) ? data.dailyRadar : [])
      .concat(data && Array.isArray(data.trending) ? data.trending : [])
      .concat(data && Array.isArray(data.highCap) ? data.highCap : [])
      .concat(data && Array.isArray(data.lowCap) ? data.lowCap : []);
  }

  function uniqueCoins(coins) {
    var seen = {};
    return (Array.isArray(coins) ? coins : []).filter(function (coin) {
      var key = coin && (coin.mint || coin.symbol || coin.name);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function currentCoins() {
    var data = memeState.data || {};
    var pool;
    if (memeState.tab === 'highcap' && Array.isArray(data.highCap)) pool = data.highCap;
    else if (memeState.tab === 'lowcap' && Array.isArray(data.lowCap)) pool = data.lowCap;
    else pool = data.trending;
    var query = memeState.query.trim().toLowerCase();
    var coins = uniqueCoins(pool || []);
    if (!query) return coins;
    return coins.filter(function (coin) {
      return [coin.name, coin.symbol, coin.mint].some(function (value) {
        return String(value || '').toLowerCase().indexOf(query) !== -1;
      });
    });
  }

  function renderStats(data) {
    var trending = Array.isArray(data && data.trending) ? data.trending : [];
    var highCap = Array.isArray(data && data.highCap) ? data.highCap : [];
    var lowCap = Array.isArray(data && data.lowCap) ? data.lowCap : [];
    var volume = uniqueCoins(allCoins(data)).reduce(function (sum, coin) {
      var n = Number(coin && coin.volume24hUsd);
      return Number.isFinite(n) && n > 0 ? sum + n : sum;
    }, 0);
    var largest = highCap.reduce(function (max, coin) {
      var n = Number(coin && coin.marketCapUsd);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);

    setText('stat-trending', trending.length ? String(trending.length) : '—');
    setText('stat-highcap', highCap.length ? String(highCap.length) : '—');
    setText('stat-volume', compactNumber(volume, '$') || '—');
    setText('stat-largest', compactNumber(largest, '$') || '—');
    setText('stat-lowcap', lowCap.length ? String(lowCap.length) : '—');
    setText('hero-token-count', String(uniqueCoins(allCoins(data)).length || '—') + ' assets');
  }

  function setupCoinImages() {
    Array.prototype.slice.call(document.querySelectorAll('[data-coin-image]')).forEach(function (image) {
      var media = image.closest ? image.closest('.coin-media') : image.parentNode;
      function loaded() {
        if (media) {
          media.classList.add('image-loaded');
          media.classList.remove('image-broken');
        }
      }
      function broken() {
        if (media) {
          media.classList.add('image-broken');
          media.classList.remove('image-loaded');
        }
      }
      image.addEventListener('load', loaded, { once: true });
      image.addEventListener('error', broken, { once: true });
      if (image.complete && image.naturalWidth > 0) loaded();
      if (image.complete && image.naturalWidth === 0) broken();
    });
  }

  function renderCoinGrid(id, coins, title, message, mode) {
    var grid = document.getElementById(id);
    if (!grid) return;
    if (!Array.isArray(coins) || coins.length === 0) {
      grid.innerHTML = emptyMarkup(title, message);
      return;
    }
    grid.innerHTML = coins.slice(0, 30).map(function (coin, index) {
      return coinCard(coin, index, mode);
    }).join('');
  }

  function renderDailyRadar(data) {
    var list = document.getElementById('daily-radar-list');
    if (!list) return;
    var radarPool = (data && Array.isArray(data.dailyRadar) && data.dailyRadar.length)
      ? data.dailyRadar
      : (data && Array.isArray(data.trending)) ? data.trending : [];
    var top = uniqueCoins(radarPool).slice(0, 3);
    if (!top.length) {
      list.innerHTML = '<li class="radar-row radar-row--placeholder">Top movers unavailable right now.</li>';
      return;
    }
    list.innerHTML = top.map(function (coin, idx) {
      var name = escapeHtml(coin.name || coin.symbol || 'Unnamed');
      var symbol = escapeHtml(String(coin.symbol || '').replace(/^\$/, '').toUpperCase() || 'COIN');
      var image = safeAssetUrl(coin.imageUrl || coin.image || coin.icon || coin.logo || '');
      var initials = escapeHtml((symbol || name).replace(/[^a-z0-9]/gi, '').slice(0, 2) || 'SM');
      var price = compactPrice(coin.priceUsd || coin.price);
      var mcap = compactNumber(coin.marketCapUsd, '$');
      var change = Number(coin.priceChange24h || coin.change24h || coin.priceChange);
      var changeText = '';
      var changeClass = '';
      if (Number.isFinite(change) && change !== 0) {
        changeClass = change > 0 ? 'up' : 'down';
        changeText = (change > 0 ? '▲ ' : '▼ ') + Math.abs(change).toFixed(2) + '%';
      }
      var primary = price || (mcap ? 'Cap ' + mcap : '');
      // Same chart-payload shape used by the trending coin cards so the
      // existing chart-modal handler picks it up. GeckoTerminal-first
      // resolution runs inside openChartModal -> resolveChartProvider.
      var chartSource = chartSourceForCoin(coin);
      var chartPayload = {
        mint: coin.mint || coin.contract || coin.address || '',
        contract: coin.contract || '',
        address: coin.address || '',
        coingeckoId: coin.coingeckoId || '',
        fallbackUrl: coin.fallbackUrl || '',
        symbol: symbol,
        name: coin.name || coin.symbol || 'Token',
        provider: chartSource.provider,
        mode: chartSource.mode,
        embedUrl: chartSource.embedUrl || '',
        externalUrl: chartSource.externalUrl || '',
        lookupPending: !!chartSource.lookupPending,
        sparkSvg: ''
      };
      // Trade payload — same shape coin cards use. Disabled state when
      // neither a real Solana mint nor a CoinGecko slug is available.
      var rawMint = coin && (coin.mint || coin.contract || coin.address) || '';
      var validMint = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(rawMint || ''));
      var cgSlug = !validMint ? coinGeckoSlug(coin) : '';
      var disabledReason = '';
      var slim = { name: coin.name || '', symbol: coin.symbol || '', imageUrl: coin.imageUrl || '' };
      if (validMint) slim.mint = rawMint;
      else if (cgSlug) slim.coingeckoSlug = cgSlug;
      else disabledReason = 'Trading unavailable — no Solana mint mapped for this token.';
      var disAttr = disabledReason ? ' disabled aria-disabled="true" title="' + escapeHtml(disabledReason) + '"' : '';
      var coinAttr = ' data-coin="' + escapeHtml(JSON.stringify(slim)) + '"';

      return [
        '<li>',
        '<div class="radar-row"' + coinAttr + '>',
        '<span class="rank">' + (idx + 1) + '</span>',
        '<span class="logo">' + (image ? '<img src="' + image + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : initials) + '</span>',
        '<span class="meta"><strong>' + name + '</strong><small>$' + symbol + (mcap && price ? ' · ' + mcap : '') + '</small></span>',
        '<span class="values radar-values-clickable" role="button" tabindex="0" title="Click to reveal chart" aria-label="Open chart for ' + name + '" data-chart="' + escapeHtml(JSON.stringify(chartPayload)) + '">',
          (primary ? '<span class="price">' + escapeHtml(primary) + '</span>' : '<span class="price">—</span>'),
          (changeText ? '<span class="change ' + changeClass + '">' + escapeHtml(changeText) + '</span>' : '<span class="change">—</span>'),
        '</span>',
        '<span class="radar-trade">',
          '<button type="button" class="trade-btn trade-buy radar-trade-btn" data-trade="buy" aria-label="Buy ' + name + '"' + disAttr + '>BUY</button>',
          '<button type="button" class="trade-btn trade-sell radar-trade-btn" data-trade="sell" aria-label="Sell ' + name + '"' + disAttr + '>SELL</button>',
        '</span>',
        '</div>',
        '</li>'
      ].join('');
    }).join('');
  }

  function renderMemeData(data) {
    memeState.data = data || {};
    var coins = currentCoins();
    renderTicker(data);
    renderStats(data);
    renderDailyRadar(data);

    renderCoinGrid(
      'trending-grid',
      coins,
      'Trending data unavailable',
      'No matching Solana token radar entries are available yet.',
      memeState.tab
    );
    setupCoinImages();
    setupChartReveal();
  }

  function ensureChartModal() {
    var modal = document.getElementById('chart-reveal-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'chart-reveal-modal';
    modal.className = 'modal-root chart-modal-root';
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = [
      '<div class="modal-backdrop" data-chart-close></div>',
      '<div class="modal-card chart-modal-card cyber-card" role="dialog" aria-modal="true" aria-labelledby="chart-modal-title">',
      '<span class="cyber-corner-tl" aria-hidden="true"></span>',
      '<span class="cyber-corner-br" aria-hidden="true"></span>',
      '<header class="modal-head chart-modal-head">',
      '<div><h3 id="chart-modal-title">Token chart</h3><p id="chart-modal-subtitle"></p></div>',
      '<button class="modal-close" type="button" data-chart-close aria-label="Close">×</button>',
      '</header>',
      '<div id="chart-modal-body" class="chart-modal-body"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);
    modal.addEventListener('click', function (event) {
      var close = event.target && event.target.closest && event.target.closest('[data-chart-close]');
      if (close) closeChartModal();
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeChartModal();
    });
    return modal;
  }

  function closeChartModal() {
    var modal = document.getElementById('chart-reveal-modal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.removeAttribute('data-chart-key');
    var body = document.getElementById('chart-modal-body');
    if (body) body.innerHTML = '';
  }

  function renderChartModalBody(body, payload) {
    var symbol = String(payload.symbol || '').replace(/^\$/, '').toUpperCase();
    var name = payload.name || symbol || 'Token';
    if (payload.mode === 'iframe' && payload.embedUrl) {
      body.innerHTML = [
        '<iframe class="chart-frame" src="' + escapeHtml(payload.embedUrl) + '" title="' + escapeHtml(name) + ' full chart" loading="lazy" referrerpolicy="no-referrer"></iframe>'
      ].join('');
    } else if (payload.mode === 'external' && payload.externalUrl) {
      body.innerHTML = [
        '<div class="chart-fallback-panel">',
        '<strong>' + escapeHtml(payload.provider || 'External chart') + ' chart opens externally</strong>',
        '<p>Embedded chart unavailable for this provider.</p>',
        '<a class="chart-open-link" href="' + escapeHtml(payload.externalUrl) + '" target="_blank" rel="noopener noreferrer">Open full chart</a>',
        '</div>'
      ].join('');
    } else {
      body.innerHTML = [
        '<div class="chart-fallback-panel">',
        '<strong>Full chart unavailable</strong>',
        '<p>Showing enlarged 24H sparkline for this token.</p>',
        '<div class="chart-spark-large">' + (payload.sparkSvg || '') + '</div>',
        '</div>'
      ].join('');
    }
  }

  function openChartModal(payload) {
    var modal = ensureChartModal();
    var title = document.getElementById('chart-modal-title');
    var subtitle = document.getElementById('chart-modal-subtitle');
    var body = document.getElementById('chart-modal-body');
    var symbol = String(payload.symbol || '').replace(/^\$/, '').toUpperCase();
    var name = payload.name || symbol || 'Token';
    var mint = payload.mint || '';
    var key = chartCacheKey(payload) || String(Date.now());
    modal.setAttribute('data-chart-key', key);
    title.textContent = name + (symbol ? ' · $' + symbol : '');
    subtitle.textContent = [mint, payload.provider].filter(Boolean).join(' · ');
    if (payload.mode === 'fallback' && payload.lookupPending) {
      body.innerHTML = [
        '<div class="chart-fallback-panel chart-loading-panel">',
        '<strong>Loading real chart</strong>',
        '<p>Resolving the token source provider.</p>',
        '</div>'
      ].join('');
      resolveChartProvider(payload).then(function (source) {
        if (modal.hidden || modal.getAttribute('data-chart-key') !== key) return;
        if (source) {
          payload.provider = source.provider;
          payload.mode = source.mode;
          payload.embedUrl = source.embedUrl || '';
          payload.externalUrl = source.externalUrl || '';
          subtitle.textContent = [payload.mint || mint, payload.provider].filter(Boolean).join(' · ');
        }
        renderChartModalBody(body, payload);
      });
    } else {
      renderChartModalBody(body, payload);
    }
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
  }

  function setupChartReveal() {
    if (setupChartReveal.bound) return;
    setupChartReveal.bound = true;
    document.addEventListener('click', function (event) {
      var trigger = event.target && event.target.closest && event.target.closest('[data-chart]');
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      try { openChartModal(JSON.parse(trigger.getAttribute('data-chart') || '{}')); } catch (_err) {}
    }, true);
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      var trigger = event.target && event.target.closest && event.target.closest('[data-chart]');
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      try { openChartModal(JSON.parse(trigger.getAttribute('data-chart') || '{}')); } catch (_err) {}
    }, true);
  }

  function setupControls() {
    Array.prototype.slice.call(document.querySelectorAll('[data-radar-tab]')).forEach(function (button) {
      button.addEventListener('click', function () {
        memeState.tab = button.getAttribute('data-radar-tab') || 'trending';
        Array.prototype.slice.call(document.querySelectorAll('[data-radar-tab]')).forEach(function (item) {
          item.classList.toggle('is-active', item === button);
        });
        renderMemeData(memeState.data || {});
      });
    });

    var search = document.getElementById('radar-search');
    if (search) {
      search.addEventListener('input', function () {
        memeState.query = search.value || '';
        renderMemeData(memeState.data || {});
      });
    }
  }

  function renderTokenPages(tokens) {
    var grid = document.getElementById('token-grid');
    if (!grid) return;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      grid.innerHTML = emptyMarkup(
        'Token pages are being prepared',
        'No SolMemeHub token pages are listed yet. Check back soon for the next public page.'
      );
      return;
    }

    var cards = tokens
      .filter(function (token) { return token && normalizeSlug(token.slug || token.path || token.url); })
      .sort(function (a, b) { return tokenDate(b) - tokenDate(a); })
      .map(function (token, index) {
        var slug = normalizeSlug(token.slug || token.path || token.url);
        var name = escapeHtml(token.name || token.title || token.symbol || slug);
        var symbol = escapeHtml(String(token.symbol || '').replace(/^\$/, '').toUpperCase());
        var status = escapeHtml(token.status || token.phase || 'Token page');
        var description = escapeHtml(tokenDescription(token));
        var href = './' + slug + '/';
        var delay = Math.min(index * 70, 560);

        return [
          '<a class="token-card" style="animation-delay:' + delay + 'ms" href="' + href + '">',
          '<span class="cyber-corner-tl" aria-hidden="true"></span>',
          '<span class="cyber-corner-br" aria-hidden="true"></span>',
          '<div>',
          '<div class="token-top">',
          '<span class="token-symbol">' + (symbol ? '$' + symbol : 'SOL') + '</span>',
          '<span class="token-meta">Open ↗</span>',
          '</div>',
          '<h3>' + name + '</h3>',
          '<p>' + description + '</p>',
          '</div>',
          '<div class="token-meta">',
          '<span>' + status + '</span>',
          '<span>/' + escapeHtml(slug) + '/</span>',
          '</div>',
          '</a>'
        ].join('');
      });

    if (cards.length === 0) {
      grid.innerHTML = emptyMarkup('Token pages are being prepared', 'The token page index loaded, but no valid page slugs were found.');
      return;
    }

    grid.innerHTML = cards.join('');
  }

  function isSolanaAddress(value) {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || '').trim());
  }

  function shortAddress(value) {
    var raw = String(value || '');
    return raw.length > 12 ? raw.slice(0, 6) + '...' + raw.slice(-5) : raw;
  }

  function authorityState(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw || raw === '11111111111111111111111111111111') return { text: 'Disabled', tone: 'good' };
    return { text: 'Active', tone: 'danger' };
  }

  function riskTone(report) {
    var risks = Array.isArray(report && report.risks) ? report.risks : [];
    var score = Number(report && (report.score_normalised != null ? report.score_normalised : report.score));
    var hasDanger = risks.some(function (risk) { return /danger|critical|high/i.test(String(risk && risk.level)); });
    var hasWarn = risks.some(function (risk) { return /warn|medium/i.test(String(risk && risk.level)); });
    if (report && report.rugged) return { tone: 'danger', label: 'Rugged token' };
    if (hasDanger || (Number.isFinite(score) && score >= 40)) return { tone: 'danger', label: 'High risk' };
    if (hasWarn || risks.length || (Number.isFinite(score) && score >= 15)) return { tone: 'warn', label: 'Review risks' };
    return { tone: 'good', label: 'Low visible risk' };
  }

  function bestLp(report) {
    var markets = Array.isArray(report && report.markets) ? report.markets : [];
    return markets.reduce(function (best, market) {
      var lp = market && market.lp ? market.lp : {};
      var locked = Number(lp.lpLockedPct);
      var usd = Number(lp.lpLockedUSD);
      if (!Number.isFinite(locked)) locked = -1;
      if (!best || locked > best.locked || (locked === best.locked && Number.isFinite(usd) && usd > best.usd)) {
        return { locked: locked, usd: Number.isFinite(usd) ? usd : 0 };
      }
      return best;
    }, null);
  }

  function topHolderPct(report) {
    var holders = Array.isArray(report && report.topHolders) ? report.topHolders : [];
    var topTen = holders.slice(0, 10).reduce(function (sum, holder) {
      var n = Number(holder && holder.pct);
      return Number.isFinite(n) ? sum + n : sum;
    }, 0);
    return topTen || null;
  }

  function metricCard(label, value, tone) {
    return [
      '<div class="rug-metric ' + escapeHtml(tone || '') + '">',
      '<span>' + escapeHtml(label) + '</span>',
      '<strong>' + escapeHtml(value || 'Unavailable') + '</strong>',
      '</div>'
    ].join('');
  }

  function renderRugcheckResult(report, address) {
    var results = document.getElementById('rugcheck-results');
    if (!results) return;
    var tokenMeta = report && (report.tokenMeta || (report.token_extensions && report.token_extensions.tokenMetadata)) || {};
    var name = tokenMeta.name || 'Token contract';
    var symbol = tokenMeta.symbol ? '$' + String(tokenMeta.symbol).replace(/^\$/, '').toUpperCase() : shortAddress(address);
    var tone = riskTone(report);
    var mint = authorityState(report && (report.mintAuthority || (report.token && report.token.mintAuthority)));
    var freeze = authorityState(report && (report.freezeAuthority || (report.token && report.token.freezeAuthority)));
    var lp = bestLp(report);
    var holderPct = topHolderPct(report);
    var transferFee = report && report.transferFee ? Number(report.transferFee.pct) : 0;
    var mutable = tokenMeta.mutable;
    var liquidity = compactNumber(report && report.totalMarketLiquidity, '$') || 'Unavailable';
    var score = report && report.score_normalised != null ? String(report.score_normalised) + '/100' : (report && report.score != null ? String(report.score) : 'Unavailable');
    var risks = Array.isArray(report && report.risks) ? report.risks : [];
    var explorer = 'https://rugcheck.xyz/tokens/' + encodeURIComponent(address);
    var warnings = risks.length ? risks.slice(0, 6).map(function (risk) {
      var level = /danger|critical|high/i.test(String(risk && risk.level)) ? 'danger' : 'warn';
      return [
        '<div class="rug-warning ' + level + '">',
        '<strong>' + escapeHtml(risk.name || 'Risk signal') + '</strong>',
        '<p>' + escapeHtml(risk.description || risk.value || risk.level || 'Review this token signal before trading.') + '</p>',
        '</div>'
      ].join('');
    }).join('') : '<p>No major RugCheck warnings returned for this contract.</p>';

    results.innerHTML = [
      '<article class="rug-summary">',
      '<div class="rug-summary-head">',
      '<div><span class="rug-kicker">RugCheck scan</span><h3>' + escapeHtml(name) + '</h3><p>' + escapeHtml(symbol) + ' · ' + escapeHtml(shortAddress(address)) + '</p></div>',
      '<span class="rug-badge ' + tone.tone + '">' + escapeHtml(tone.label) + '</span>',
      '</div>',
      '<div class="rug-metrics">',
      metricCard('Score', score, tone.tone),
      metricCard('Liquidity', liquidity, liquidity === 'Unavailable' ? 'warn' : 'good'),
      metricCard('Mint authority', mint.text, mint.tone),
      metricCard('Freeze authority', freeze.text, freeze.tone),
      metricCard('LP locked', lp && lp.locked >= 0 ? percentNumber(lp.locked) : 'Unavailable', lp && lp.locked >= 80 ? 'good' : 'warn'),
      metricCard('Top 10 holders', holderPct ? percentNumber(holderPct) : 'Unavailable', holderPct && holderPct > 50 ? 'danger' : 'warn'),
      metricCard('Transfer tax', Number.isFinite(transferFee) ? percentNumber(transferFee) : 'Unavailable', transferFee > 0 ? 'warn' : 'good'),
      metricCard('Metadata', mutable === false ? 'Immutable' : mutable === true ? 'Mutable' : 'Unavailable', mutable === false ? 'good' : 'warn'),
      '</div>',
      '<div class="rug-warning-list"><h4>Security signals</h4>' + warnings + '</div>',
      '<div class="rug-actions"><a href="' + explorer + '" target="_blank" rel="noopener noreferrer">Open RugCheck report</a></div>',
      '</article>'
    ].join('');
  }

  function setupRugcheck() {
    var form = document.getElementById('rugcheck-form');
    var input = document.getElementById('rugcheck-address');
    var status = document.getElementById('rugcheck-status');
    var button = form ? form.querySelector('button[type="submit"]') : null;
    if (!form || !input || !status || !button) return;

    function setStatus(text, state) {
      status.textContent = text;
      status.classList.toggle('is-error', state === 'error');
      status.classList.toggle('is-good', state === 'good');
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var address = input.value.trim();
      if (!isSolanaAddress(address)) {
        setStatus('Enter a valid Solana token mint address.', 'error');
        return;
      }
      button.disabled = true;
      setStatus('Checking public RugCheck risk signals...', '');
      fetch(RUGCHECK_REPORT_BASE + encodeURIComponent(address) + '/report', {
        cache: 'no-store',
        credentials: 'omit'
      })
        .then(function (response) {
          if (!response.ok) throw new Error('RugCheck returned HTTP ' + response.status);
          return response.json();
        })
        .then(function (report) {
          renderRugcheckResult(report, address);
          setStatus('Verification signals loaded. Review every source before trading.', 'good');
        })
        .catch(function (err) {
          setStatus(err && err.message ? err.message : 'Verification data unavailable right now.', 'error');
        })
        .finally(function () {
          button.disabled = false;
        });
    });
  }

  function loadJson(path) {
    return fetch(path, { cache: 'no-store', credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error(path + ' unavailable');
        return response.json();
      });
  }

  function loadData() {
    loadJson('./meme-coins.json')
      .then(renderMemeData)
      .catch(function () {
        renderMemeData({
          updatedAt: '',
          source: { active: 'Public data unavailable', blocker: 'meme-coins.json unavailable' },
          trending: [],
          highCap: []
        });
      });

    loadJson('./tokens.json')
      .then(function (data) {
        renderTokenPages(data && Array.isArray(data.tokens) ? data.tokens : []);
      })
      .catch(function () {
        renderTokenPages([]);
      });
  }

  function setupReveal() {
    var items = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
    if (reducedMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (node) { node.classList.add('is-revealed'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-revealed');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });

    items.forEach(function (node) { observer.observe(node); });
  }

  function boot() {
    setupReveal();
    setupControls();
    setupRugcheck();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}());
