(function () {
  'use strict';

  var ENDPOINT = '/api/kolscan/leaderboard';

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function shortAddr(addr) {
    var s = String(addr || '');
    if (s.length <= 10) return s;
    return s.slice(0, 4) + '…' + s.slice(-4);
  }

  function fmtUsd(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return '—';
    var abs = Math.abs(v);
    var sign = v < 0 ? '-' : '';
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(2) + 'K';
    return sign + '$' + abs.toFixed(2);
  }

  function fmtSol(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return v.toFixed(2) + ' SOL';
  }

  function fmtPct(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return '—';
    // Heuristic: API may return 0..1 or 0..100.
    var pct = Math.abs(v) <= 1 ? v * 100 : v;
    return pct.toFixed(1) + '%';
  }

  function fmtInt(n) {
    var v = Number(n);
    if (!Number.isFinite(v)) return '—';
    return Math.round(v).toLocaleString('en');
  }

  function pickPnlUsd(e) {
    return e.total_pnl_usd != null ? e.total_pnl_usd
      : e.totalPnlUsd != null ? e.totalPnlUsd
      : e.pnl_usd != null ? e.pnl_usd
      : e.pnlUsd != null ? e.pnlUsd
      : e.pnl;
  }
  function pickRealized(e) {
    return e.realized_pnl_usd != null ? e.realized_pnl_usd
      : e.realizedPnlUsd != null ? e.realizedPnlUsd
      : e.realized_pnl != null ? e.realized_pnl
      : e.realizedPnl;
  }
  function pickPnlSol(e) {
    return e.total_pnl_sol != null ? e.total_pnl_sol
      : e.totalPnlSol != null ? e.totalPnlSol
      : e.pnl_sol != null ? e.pnl_sol
      : e.pnlSol;
  }
  function pickWinRate(e) {
    return e.win_rate != null ? e.win_rate
      : e.winRate != null ? e.winRate
      : e.winPercent;
  }
  function pickTrades(e) {
    if (e.trades != null) return e.trades;
    if (e.total_trades != null) return e.total_trades;
    if (e.totalTrades != null) return e.totalTrades;
    var w = Number(e.wins), l = Number(e.losses);
    if (Number.isFinite(w) && Number.isFinite(l)) return w + l;
    return null;
  }
  function pickLabel(e) {
    return e.name || e.handle || e.username || e.label || null;
  }
  function pickAddr(e) {
    return e.wallet || e.address || e.wallet_address || e.walletAddress || e.owner || '';
  }

  function setStatus(kind, text) {
    var node = $('kol-status');
    if (!node) return;
    node.className = 'status ' + kind;
    node.textContent = text;
  }

  function renderEmpty(msg, title) {
    $('kol-rows').innerHTML =
      '<div class="board-empty"><h3>' + escapeHtml(title || 'No data') + '</h3>' +
      '<p>' + escapeHtml(msg || '') + '</p></div>';
  }

  function rowHtml(entry, index) {
    var rank = Number.isFinite(Number(entry.rank)) ? Number(entry.rank) : index + 1;
    var addr = pickAddr(entry);
    var label = pickLabel(entry) || shortAddr(addr) || 'Unknown';
    var pnl = Number(pickPnlUsd(entry));
    var pnlSol = pickPnlSol(entry);
    var realized = Number(pickRealized(entry));
    var winRate = pickWinRate(entry);
    var trades = pickTrades(entry);
    var pnlText = Number.isFinite(pnl) ? fmtUsd(pnl)
      : pnlSol != null ? fmtSol(pnlSol)
      : '—';
    var pnlClass = Number.isFinite(pnl) ? (pnl >= 0 ? 'pos' : 'neg') : 'muted';
    var realClass = Number.isFinite(realized) ? (realized >= 0 ? 'pos' : 'neg') : 'muted';
    var rankClass = rank <= 3 ? ('rank top' + rank) : 'rank';

    return [
      '<div class="board-row" role="row">',
        '<span class="' + rankClass + '">' + rank + '</span>',
        '<span class="wallet">',
          '<strong>' + escapeHtml(label) + '</strong>',
          '<small>' + escapeHtml(shortAddr(addr) || '—') + '</small>',
        '</span>',
        '<span class="num ' + pnlClass + '">' + escapeHtml(pnlText) + '</span>',
        '<span class="num col-realized ' + realClass + '">' + escapeHtml(fmtUsd(realized)) + '</span>',
        '<span class="num muted">' + escapeHtml(fmtPct(winRate)) + '</span>',
        '<span class="num col-trades muted">' + escapeHtml(fmtInt(trades)) + '</span>',
      '</div>'
    ].join('');
  }

  function render(entries) {
    var rows = $('kol-rows');
    if (!entries || !entries.length) {
      renderEmpty('The upstream leaderboard returned no entries right now.', 'No KOLs to show');
      return;
    }
    rows.innerHTML = entries.slice(0, 100).map(rowHtml).join('');
  }

  function extractEntries(payload) {
    if (!payload) return [];
    var d = payload.data != null ? payload.data : payload;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d.leaderboard)) return d.leaderboard;
    if (Array.isArray(d.kols)) return d.kols;
    if (Array.isArray(d.entries)) return d.entries;
    if (Array.isArray(d.results)) return d.results;
    if (Array.isArray(d.data)) return d.data;
    return [];
  }

  function load() {
    var btn = $('kol-refresh');
    if (btn) btn.disabled = true;
    setStatus('loading', 'Loading leaderboard…');

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 10000);

    fetch(ENDPOINT, { cache: 'no-store', credentials: 'omit', signal: controller.signal })
      .then(function (r) {
        clearTimeout(timer);
        if (!r.ok) throw new Error('http_' + r.status);
        return r.json();
      })
      .then(function (payload) {
        if (payload && payload.ok === false) throw new Error(payload.error || 'upstream_error');
        var entries = extractEntries(payload);
        if (!entries.length) {
          setStatus('empty', 'Leaderboard is currently empty.');
          render([]);
        } else {
          setStatus('ok', 'Showing ' + Math.min(entries.length, 100) + ' KOLs');
          render(entries);
        }
      })
      .catch(function (err) {
        clearTimeout(timer);
        var msg = err && err.name === 'AbortError' ? 'Request timed out.' : 'Leaderboard unavailable.';
        setStatus('error', msg);
        renderEmpty('Try again in a moment. The upstream KOL data feed is temporarily unreachable.', 'Leaderboard unavailable');
      })
      .then(function () {
        if (btn) btn.disabled = false;
      });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = $('kol-refresh');
    if (btn) btn.addEventListener('click', load);
    load();
  });
}());
