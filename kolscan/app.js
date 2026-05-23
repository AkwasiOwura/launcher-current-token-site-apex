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

  function money(value) {
    if (value == null || value === '') return '—';
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return '$' + Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
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
    var pnl = escapeHtml(money(entry.pnl || entry.realizedPnl || entry.totalPnl));
    var winRate = escapeHtml(compactValue(entry.winRate || entry.winPercent));
    var roi = escapeHtml(compactValue(entry.roi));
    var trades = escapeHtml(compactValue(entry.trades));

    return [
      '<a class="kol-row" href="' + href + '" target="_blank" rel="noopener noreferrer">',
      '<span class="kol-rank">#' + rank + '</span>',
      '<span class="kol-profile"><strong>' + name + '</strong><small>' + (handle || (address ? address.slice(0, 6) + '...' + address.slice(-4) : 'Public profile')) + '</small></span>',
      '<span class="kol-metric"><small>Total PnL</small><strong>' + pnl + '</strong></span>',
      '<span class="kol-metric"><small>Win rate</small><strong>' + winRate + '</strong></span>',
      '<span class="kol-metric"><small>ROI</small><strong>' + roi + '</strong></span>',
      '<span class="kol-metric"><small>Trades</small><strong>' + trades + '</strong></span>',
      '<span class="kol-activity">' + activity + '</span>',
      '</a>'
    ].join('');
  }

  function renderHeatmap(days) {
    var heatmap = document.getElementById('kol-heatmap');
    if (!heatmap) return;
    var now = new Date();
    var count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    setText('kol-period-label', now.toLocaleString(undefined, { month: 'long', year: 'numeric' }));
    var source = Array.isArray(days) ? days : [];
    heatmap.innerHTML = Array.from({ length: count }, function (_, index) {
      var day = source[index] || {};
      var level = Math.max(0, Math.min(3, Number(day.level || 0)));
      return '<span class="heat-cell heat-' + level + '" title="Day ' + (index + 1) + '">' + (index + 1) + '</span>';
    }).join('');
  }

  function render(data) {
    var entries = data && Array.isArray(data.entries) ? data.entries : [];
    var active = data && data.activeToday != null ? String(data.activeToday) : '—';
    var activity = data && data.topActivity ? String(data.topActivity) : '—';
    var board = document.getElementById('kol-leaderboard');

    setText('kol-stat-count', entries.length ? String(entries.length) : '—');
    setText('kol-stat-active', active);
    setText('kol-stat-activity', activity);
    setText('kol-data-status', entries.length ? 'Live' : 'Pending');
    setText('kol-today-pnl', money(data && data.todayPnl));
    setText('kol-month-pnl', money(data && data.monthPnl));
    setText('kol-month-volume', money(data && data.monthVolume));
    renderHeatmap(data && data.activityDays);

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
