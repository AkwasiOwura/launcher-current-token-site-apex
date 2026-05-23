(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
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

  function moneyPrecise(value) {
    if (value == null || value === '') return '—';
    var n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    if (Math.abs(n) >= 1000000) return '$' + (n / 1000000).toFixed(2) + 'M';
    if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(2) + 'K';
    return '$' + n.toFixed(2);
  }

  function setText(id, value) {
    var node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function row(entry, index) {
    var rank = Number.isFinite(Number(entry.rank)) ? Number(entry.rank) : index + 1;
    var name = escapeHtml(entry.name || entry.handle || entry.profile || 'Unknown profile');
    var handle = escapeHtml(entry.handle || entry.username || 'Preview profile');
    var href = safeUrl(entry.profileUrl || entry.sourceUrl || entry.url, '#');
    var activity = escapeHtml(entry.activity || entry.lastActivity || entry.lastTrade || '—');
    var pnl = escapeHtml(moneyPrecise(entry.pnl || entry.totalPnl));
    var realized = escapeHtml(moneyPrecise(entry.realizedPnl || entry.pnl || entry.totalPnl));
    var winRate = escapeHtml(compactValue(entry.winRate || entry.winPercent));
    var roi = escapeHtml(compactValue(entry.roi));
    var trades = escapeHtml(compactValue(entry.trades));
    var avatar = escapeHtml((name || 'KO').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || 'KO');

    return [
      '<a class="leader-row" href="' + href + '" target="_blank" rel="noopener noreferrer">',
      '<span class="rank top-' + Math.min(rank, 3) + '">' + rank + '</span>',
      '<span class="wallet"><i class="avatar">' + avatar + '</i><span><strong>' + name + '</strong><small>' + handle + '</small></span><em class="xmark">×</em></span>',
      '<span class="profit">' + pnl + '</span>',
      '<span class="profit">' + realized + '</span>',
      '<span class="neutral">' + winRate + '</span>',
      '<span class="profit">' + roi + '</span>',
      '<span class="muted">' + trades + '</span>',
      '<span class="muted">' + activity + '</span>',
      '</a>'
    ].join('');
  }

  function renderHeatmap(days) {
    var heatmap = document.getElementById('activity-grid');
    if (!heatmap) return;
    var source = Array.isArray(days) ? days : [];
    heatmap.innerHTML = Array.from({ length: 31 }, function (_, index) {
      var day = source[index] || {};
      var level = Math.max(0, Math.min(3, Number(day.level || 0)));
      var value = day.value ? '<small>' + escapeHtml(day.value) + '</small>' : '';
      var muted = level ? '' : ' muted';
      return '<span class="day-cell level-' + level + muted + '">' + (index + 1) + value + '</span>';
    }).join('');
  }

  function render(data) {
    var entries = data && Array.isArray(data.entries) ? data.entries : [];
    var active = data && data.activeToday != null ? String(data.activeToday) : '—';
    var board = document.getElementById('leaderboard-rows');

    setText('today-pnl', moneyPrecise(data && data.todayPnl));
    setText('month-pnl', moneyPrecise(data && data.monthPnl));
    setText('month-volume', moneyPrecise(data && data.monthVolume));
    setText('active-kols', active);
    setText('active-sub', active + ' active KOLs');
    setText('days-sub', data && data.tradingDays ? data.tradingDays + ' trading days' : 'Preview period');
    setText('activity-sub', data && data.topActivity ? data.topActivity : 'Preview activity');
    setText('volume-sub', data && data.todayVolume ? moneyPrecise(data.todayVolume) + ' vol' : 'Preview volume');
    setText('data-mode', data && data.dataMode === 'live' ? 'Live public data' : 'Preview dataset');
    renderHeatmap(data && data.activityDays);

    if (!board) return;
    if (!entries.length) {
      board.innerHTML = '<article class="empty-state"><h3>KOL radar source pending</h3><p>Connect a verified public source to replace this preview layout.</p></article>';
      return;
    }
    board.innerHTML = entries.slice(0, 40).map(row).join('');
  }

  fetch('../kol-radar.json', { cache: 'no-store', credentials: 'omit' })
    .then(function (response) {
      if (!response.ok) throw new Error('unavailable');
      return response.json();
    })
    .then(render)
    .catch(function () { render({ entries: [] }); });
}());
