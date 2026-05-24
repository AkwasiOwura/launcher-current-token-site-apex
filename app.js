(function () {
  'use strict';

  var reducedMotion = false;
  var memeState = {
    data: null,
    tab: 'trending',
    query: ''
  };
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
    var changeNum = Number(coin && (coin.priceChange24h || coin.change24h || coin.priceChange));
    var changeDir = Number.isFinite(changeNum) ? (changeNum > 1 ? 'is-up' : changeNum < -1 ? 'is-down' : 'is-flat') : 'is-flat';
    var changeClass = Number.isFinite(changeNum) ? (changeNum > 1 ? 'up' : changeNum < -1 ? 'down' : 'flat') : 'flat';
    var changeText = Number.isFinite(changeNum) ? (changeNum > 0 ? '▲ ' : changeNum < 0 ? '▼ ' : '') + Math.abs(changeNum).toFixed(2) + '%' : '';
    var sparkBlock = sparkSvg ? [
      '<div class="coin-spark-wrap">',
      sparkSvg,
      '<div class="spark-meta"><span class="label">24h trend</span>' + (changeText ? '<span class="delta ' + changeClass + '">' + changeText + '</span>' : '') + '</div>',
      '</div>'
    ].join('') : '';
    return [
      '<a class="coin-card ' + changeDir + '" style="animation-delay:' + delay + 'ms" href="' + href + '" target="_blank" rel="noopener noreferrer">',
      '<span class="cyber-corner-tl" aria-hidden="true"></span>',
      '<span class="cyber-corner-br" aria-hidden="true"></span>',
      '<div class="coin-media">',
      image ? '<img src="' + image + '" alt="" loading="lazy" referrerpolicy="no-referrer" data-coin-image />' : '',
      '<span class="coin-fallback">' + initials + '</span>',
      '</div>',
      '<div class="coin-body">',
      '<div class="coin-row"><span class="coin-rank">' + (rank || 'LIVE') + '</span><span class="coin-label">' + label + '</span></div>',
      '<h3>' + name + '</h3>',
      '<p>' + (symbol ? '$' + symbol : 'Pump.fun coin') + '</p>',
      mint ? '<code>' + mint.slice(0, 6) + '...' + mint.slice(-5) + '</code>' : '',
      sparkBlock,
      '</div>',
      '<div class="coin-footer"><span>' + (meta.length ? meta.join(' · ') : 'Open page') + '</span><strong>Open ↗</strong></div>',
      '</a>'
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
      var href = safeUrl(coin.pumpFunUrl || coin.url || coin.fallbackUrl, '#trending');
      var external = href !== '#trending';
      return [
        '<li>',
        '<a class="radar-row" href="' + href + '"' + (external ? ' target="_blank" rel="noopener noreferrer"' : '') + '>',
        '<span class="rank">' + (idx + 1) + '</span>',
        '<span class="logo">' + (image ? '<img src="' + image + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : initials) + '</span>',
        '<span class="meta"><strong>' + name + '</strong><small>$' + symbol + (mcap && price ? ' · ' + mcap : '') + '</small></span>',
        '<span class="values">' + (primary ? '<span class="price">' + escapeHtml(primary) + '</span>' : '') + (changeText ? '<span class="change ' + changeClass + '">' + escapeHtml(changeText) + '</span>' : '') + '</span>',
        '</a>',
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
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}());
