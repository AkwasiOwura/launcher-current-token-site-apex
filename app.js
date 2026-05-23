(function () {
  'use strict';

  var reducedMotion = false;
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

  function formatUpdated(value) {
    var time = Date.parse(value || '');
    if (!Number.isFinite(time)) return 'Updated daily';
    return 'Updated ' + new Date(time).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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

  function coinCard(coin, index, mode) {
    var name = escapeHtml(coin.name || coin.symbol || 'Unnamed coin');
    var symbol = escapeHtml(String(coin.symbol || '').replace(/^\$/, '').toUpperCase());
    var label = escapeHtml(coin.label || coin.category || coin.sourceName || 'Public source');
    var rank = Number.isFinite(Number(coin.rank)) ? '#' + Number(coin.rank) : '';
    var mint = escapeHtml(coin.mint || coin.contract || '');
    var href = safeUrl(coin.pumpFunUrl || coin.url || coin.fallbackUrl, '#');
    var image = safeUrl(coin.imageUrl || coin.image || '', '');
    var marketCap = compactNumber(coin.marketCapUsd, '$');
    var volume = compactNumber(coin.volume24hUsd, '$');
    var delay = Math.min(index * 60, 540);
    var meta = [];

    if (rank) meta.push(rank);
    if (marketCap) meta.push('Cap ' + marketCap);
    if (volume && mode !== 'highcap') meta.push('Vol ' + volume);
    if (!marketCap && !volume && coin.sourceName) meta.push(escapeHtml(coin.sourceName));

    return [
      '<a class="coin-card" style="animation-delay:' + delay + 'ms" href="' + href + '" target="_blank" rel="noopener noreferrer">',
      '<div class="coin-media">',
      image ? '<img src="' + image + '" alt="" loading="lazy" referrerpolicy="no-referrer" />' : '<span>' + escapeHtml((symbol || name).slice(0, 2)) + '</span>',
      '</div>',
      '<div class="coin-body">',
      '<div class="coin-row"><span class="coin-rank">' + (rank || 'LIVE') + '</span><span class="coin-label">' + label + '</span></div>',
      '<h3>' + name + '</h3>',
      '<p>' + (symbol ? '$' + symbol : 'Pump.fun coin') + '</p>',
      mint ? '<code>' + mint.slice(0, 6) + '...' + mint.slice(-5) + '</code>' : '',
      '</div>',
      '<div class="coin-footer"><span>' + (meta.length ? meta.join(' · ') : 'Open page') + '</span><strong>Open ↗</strong></div>',
      '</a>'
    ].join('');
  }

  function renderCoinGrid(id, coins, title, message, mode) {
    var grid = document.getElementById(id);
    if (!grid) return;
    if (!Array.isArray(coins) || coins.length === 0) {
      grid.innerHTML = emptyMarkup(title, message);
      return;
    }
    grid.innerHTML = coins.slice(0, 12).map(function (coin, index) {
      return coinCard(coin, index, mode);
    }).join('');
  }

  function renderMemeData(data) {
    var note = document.getElementById('meme-source-note');
    var trending = data && Array.isArray(data.trending) ? data.trending : [];
    var highCap = data && Array.isArray(data.highCap) ? data.highCap : [];
    var activeSource = data && data.source && data.source.active ? data.source.active : 'Public meme-coin data';
    var sourceNote = data && data.source && data.source.blocker
      ? activeSource + ' · Pump.fun direct fetch blocked'
      : activeSource;

    if (note) {
      note.textContent = sourceNote + ' · ' + formatUpdated(data && data.updatedAt);
    }

    renderCoinGrid(
      'trending-grid',
      trending,
      'Trending data unavailable',
      'No reliable public Pump.fun radar data is available yet.',
      'trending'
    );
    renderCoinGrid(
      'highcap-grid',
      highCap,
      'High-cap data unavailable',
      'No reliable public market-cap fields are available yet.',
      'highcap'
    );
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

  function setupStarfield() {
    if (reducedMotion) return;
    var canvas = document.getElementById('starfield');
    if (!canvas) return;

    var context = canvas.getContext('2d');
    if (!context) return;

    var width = 0;
    var height = 0;
    var stars = [];
    var raf = 0;

    function resize() {
      var ratio = 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      var count = Math.min(130, Math.max(48, Math.floor((width * height) / 13500)));
      stars = Array.from({ length: count }, function () {
        return {
          x: Math.random() * width,
          y: Math.random() * height,
          r: Math.random() * 1.5 + 0.25,
          v: Math.random() * 0.18 + 0.04,
          a: Math.random() * 0.5 + 0.25
        };
      });
    }

    function draw() {
      context.clearRect(0, 0, width, height);
      for (var i = 0; i < stars.length; i += 1) {
        var star = stars[i];
        star.y += star.v;
        if (star.y > height + 8) {
          star.y = -8;
          star.x = Math.random() * width;
        }
        context.beginPath();
        context.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        context.fillStyle = 'rgba(246,248,255,' + star.a + ')';
        context.fill();
      }
      raf = window.requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('pagehide', function () { window.cancelAnimationFrame(raf); }, { once: true });
  }

  function boot() {
    setupReveal();
    setupStarfield();
    loadData();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}());
