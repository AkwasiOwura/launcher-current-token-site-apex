(function () {
  'use strict';

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
      return (url.protocol === 'https:' || url.protocol === 'http:') ? url.href : fallback || '#';
    } catch (_err) {
      return fallback || '#';
    }
  }

  function compactValue(value) {
    if (value == null || value === '') return '—';
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function row(entry, index) {
    var rank = Number.isFinite(Number(entry.rank)) ? Number(entry.rank) : index + 1;
    var name = escapeHtml(entry.name || entry.handle || entry.profile || 'Unknown profile');
    var handle = escapeHtml(entry.handle || entry.username || '');
    var address = escapeHtml(entry.address || entry.wallet || '');
    var href = safeUrl(entry.profileUrl || entry.sourceUrl || entry.url, '#');
    var activity = escapeHtml(entry.activity || entry.lastActivity || entry.lastTrade || '—');
    var pnl = escapeHtml(compactValue(entry.pnl || entry.realizedPnl || entry.totalPnl));
    var winRate = escapeHtml(compactValue(entry.winRate || entry.winPercent));
    var volume = escapeHtml(compactValue(entry.volume || entry.volumeUsd));
    var tokens = Array.isArray(entry.tokens) ? entry.tokens.slice(0, 3).map(function (token) {
      return '<span>' + escapeHtml(String(token).replace(/^\$/, '').toUpperCase()) + '</span>';
    }).join('') : '';

    return [
      '<a class="kol-row" href="' + href + '" target="_blank" rel="noopener noreferrer">',
      '<span class="kol-rank">#' + rank + '</span>',
      '<span class="kol-profile"><strong>' + name + '</strong><small>' + (handle || (address ? address.slice(0, 6) + '...' + address.slice(-4) : 'Public profile')) + '</small></span>',
      '<span class="kol-metric"><small>PnL</small><strong>' + pnl + '</strong></span>',
      '<span class="kol-metric"><small>Win rate</small><strong>' + winRate + '</strong></span>',
      '<span class="kol-metric"><small>Volume</small><strong>' + volume + '</strong></span>',
      '<span class="kol-tokens">' + (tokens || '<span>Watch</span>') + '</span>',
      '<span class="kol-activity">' + activity + '</span>',
      '</a>'
    ].join('');
  }

  function render(data) {
    var entries = data && Array.isArray(data.entries) ? data.entries : [];
    var active = data && data.activeToday != null ? String(data.activeToday) : '—';
    var activity = data && data.topActivity ? String(data.topActivity) : '—';
    var board = document.getElementById('kol-leaderboard');

    setText('kol-stat-count', entries.length ? String(entries.length) : '—');
    setText('kol-strip-count', entries.length ? String(entries.length) : '—');
    setText('kol-stat-active', active);
    setText('kol-strip-active', active);
    setText('kol-stat-activity', activity);
    setText('kol-data-status', entries.length ? 'Live' : 'Pending');

    if (!board) return;
    if (!entries.length) {
      board.innerHTML = [
        '<article class="kol-empty">',
        '<span class="empty-icon">◇</span>',
        '<h3>KOL radar source pending</h3>',
        '<p>Public wallet activity will appear once a verified source is connected.</p>',
        '</article>'
      ].join('');
      return;
    }
    board.innerHTML = entries.slice(0, 40).map(row).join('');
  }

  function reveal() {
    Array.prototype.slice.call(document.querySelectorAll('[data-reveal]')).forEach(function (node) {
      node.classList.add('is-revealed');
    });
  }

  function boot() {
    reveal();
    fetch('../kol-radar.json', { cache: 'no-store', credentials: 'omit' })
      .then(function (response) {
        if (!response.ok) throw new Error('unavailable');
        return response.json();
      })
      .then(render)
      .catch(function () {
        render({ entries: [] });
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
}());
