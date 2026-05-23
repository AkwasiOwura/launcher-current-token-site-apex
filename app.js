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

  function normalizeSlug(value) {
    return String(value == null ? '' : value)
      .trim()
      .replace(/^\.?\//, '')
      .replace(/\/+$/, '')
      .replace(/[^a-z0-9-]/gi, '')
      .toLowerCase();
  }

  function tokenDate(token) {
    var raw = token.publishedAt || token.updatedAt || token.createdAt || token.date || '';
    var time = Date.parse(raw);
    return Number.isFinite(time) ? time : 0;
  }

  function tokenDescription(token) {
    return token.description || token.tagline || token.summary || 'A public Solana meme-token page indexed by SolMemeHub.';
  }

  function renderEmpty(message) {
    var grid = document.getElementById('token-grid');
    if (!grid) return;
    grid.innerHTML = [
      '<article class="empty-card">',
      '<span class="empty-icon">◇</span>',
      '<h3>Token pages are being prepared</h3>',
      '<p>' + escapeHtml(message || 'No public token pages are listed yet. Check back soon for the next Solana meme-token page.') + '</p>',
      '</article>'
    ].join('');
  }

  function renderTokens(tokens) {
    var grid = document.getElementById('token-grid');
    if (!grid) return;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      renderEmpty();
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
      renderEmpty('The token index loaded, but no valid token page slugs were found.');
      return;
    }

    grid.innerHTML = cards.join('');
  }

  function loadTokens() {
    fetch('./tokens.json', { cache: 'no-store', credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('Token index unavailable');
        return response.json();
      })
      .then(function (data) {
        renderTokens(data && Array.isArray(data.tokens) ? data.tokens : []);
      })
      .catch(function () {
        renderEmpty('The public token index could not be loaded right now. Existing token pages may still be available directly.');
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
    loadTokens();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}());
