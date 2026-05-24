(function () {
  'use strict';

  // Set this to a deployed workers.dev URL when the proxy is not mounted on solmemehub.tech.
  var WORKER_ENDPOINT_OVERRIDE = '';
  var API_ENDPOINT = WORKER_ENDPOINT_OVERRIDE || '/api/kolscan/leaderboard';

  var state = {
    rows: [],
    loading: false
  };

  var els = {
    refresh: document.getElementById('refresh-button'),
    status: document.getElementById('status-line'),
    profiles: document.getElementById('stat-profiles'),
    totalPnl: document.getElementById('stat-total-pnl'),
    realizedPnl: document.getElementById('stat-realized-pnl'),
    dataStatus: document.getElementById('stat-status'),
    loading: document.getElementById('loading-state'),
    empty: document.getElementById('empty-state'),
    error: document.getElementById('error-state'),
    errorMessage: document.getElementById('error-message'),
    tableWrap: document.getElementById('table-wrap'),
    body: document.getElementById('leaderboard-body')
  };

  function setText(node, value) {
    if (node) node.textContent = value;
  }

  function show(node, shouldShow) {
    if (!node) return;
    node.classList.toggle('hidden', !shouldShow);
    if (node === els.tableWrap) node.hidden = !shouldShow;
  }

  function isHttpUrl(value) {
    if (!value || typeof value !== 'string') return false;
    try {
      var url = new URL(value, window.location.origin);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  function pick(record, names) {
    for (var i = 0; i < names.length; i += 1) {
      var value = names[i].split('.').reduce(function (acc, key) {
        return acc && acc[key] !== undefined ? acc[key] : undefined;
      }, record);
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    var cleaned = value.replace(/[$,%\s,]/g, '');
    var parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function formatCompactMoney(value) {
    var number = toNumber(value);
    if (number === null) return '—';
    var abs = Math.abs(number);
    var sign = number < 0 ? '-' : '';
    if (abs >= 1000000000) return sign + '$' + (abs / 1000000000).toFixed(2) + 'B';
    if (abs >= 1000000) return sign + '$' + (abs / 1000000).toFixed(2) + 'M';
    if (abs >= 1000) return sign + '$' + (abs / 1000).toFixed(1) + 'K';
    return sign + '$' + abs.toFixed(2);
  }

  function formatPercent(value) {
    var number = toNumber(value);
    if (number === null) return '—';
    var normalized = Math.abs(number) <= 1 ? number * 100 : number;
    return normalized.toFixed(1) + '%';
  }

  function formatInteger(value) {
    var number = toNumber(value);
    if (number === null) return '—';
    return Math.round(number).toLocaleString('en-US');
  }

  function shortAddress(value) {
    if (!value || typeof value !== 'string') return 'public profile';
    if (value.length <= 14) return value;
    return value.slice(0, 5) + '…' + value.slice(-5);
  }

  function initials(value) {
    return String(value || 'KOL')
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); })
      .join('') || 'K';
  }

  function getItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload && payload.data)) return payload.data;
    if (Array.isArray(payload && payload.leaderboard)) return payload.leaderboard;
    if (Array.isArray(payload && payload.result)) return payload.result;
    if (Array.isArray(payload && payload.items)) return payload.items;
    if (Array.isArray(payload && payload.data && payload.data.items)) return payload.data.items;
    return [];
  }

  function normalizeRecord(record, index) {
    var name = pick(record, ['name', 'handle', 'username', 'displayName', 'walletName', 'profile.name']) || 'KOL Wallet';
    var address = pick(record, ['wallet', 'address', 'walletAddress', 'owner', 'profile.wallet', 'profile.address']);
    var profileUrl = pick(record, ['profileUrl', 'url', 'sourceUrl', 'profile.url']);

    return {
      rank: pick(record, ['rank', 'position']) || index + 1,
      name: String(name),
      address: address ? String(address) : '',
      totalPnl: pick(record, ['totalPnl', 'totalPnL', 'pnl', 'profit', 'totalProfit']),
      realizedPnl: pick(record, ['realizedPnl', 'realizedPnL', 'realized', 'realizedProfit']),
      winRate: pick(record, ['winRate', 'winrate', 'wins', 'performance.winRate']),
      trades: pick(record, ['trades', 'tradeCount', 'totalTrades']),
      profileUrl: isHttpUrl(profileUrl) ? String(profileUrl) : ''
    };
  }

  function setView(view, message) {
    show(els.loading, view === 'loading');
    show(els.empty, view === 'empty');
    show(els.error, view === 'error');
    show(els.tableWrap, view === 'table');
    setText(els.errorMessage, message || 'Unable to load leaderboard right now.');
  }

  function updateStats(rows) {
    var total = rows.reduce(function (sum, row) {
      var value = toNumber(row.totalPnl);
      return value === null ? sum : sum + value;
    }, 0);
    var realized = rows.reduce(function (sum, row) {
      var value = toNumber(row.realizedPnl);
      return value === null ? sum : sum + value;
    }, 0);

    setText(els.profiles, rows.length ? String(rows.length) : '—');
    setText(els.totalPnl, rows.length ? formatCompactMoney(total) : '—');
    setText(els.realizedPnl, rows.length ? formatCompactMoney(realized) : '—');
    setText(els.dataStatus, rows.length ? 'Connected' : 'Pending');
  }

  function renderRows(rows) {
    els.body.innerHTML = '';

    rows.forEach(function (row) {
      var tr = document.createElement('tr');
      var totalValue = toNumber(row.totalPnl);
      var realizedValue = toNumber(row.realizedPnl);

      var sourceHtml = row.profileUrl
        ? '<a class="source-link" href="' + row.profileUrl + '" target="_blank" rel="noopener noreferrer">Open</a>'
        : '<span class="muted">—</span>';

      tr.innerHTML = [
        '<td><span class="rank-badge">' + row.rank + '</span></td>',
        '<td><div class="wallet-cell"><span class="avatar">' + initials(row.name) + '</span><span><span class="wallet-name">' + row.name + '</span><span class="wallet-address">' + shortAddress(row.address) + '</span></span></div></td>',
        '<td><span class="' + (totalValue !== null && totalValue < 0 ? 'loss' : 'profit') + '">' + formatCompactMoney(row.totalPnl) + '</span></td>',
        '<td><span class="' + (realizedValue !== null && realizedValue < 0 ? 'loss' : 'profit') + '">' + formatCompactMoney(row.realizedPnl) + '</span></td>',
        '<td>' + formatPercent(row.winRate) + '</td>',
        '<td>' + formatInteger(row.trades) + '</td>',
        '<td>' + sourceHtml + '</td>'
      ].join('');

      els.body.appendChild(tr);
    });
  }

  async function loadLeaderboard() {
    if (state.loading) return;
    state.loading = true;
    els.refresh.disabled = true;
    setText(els.status, 'Loading leaderboard…');
    setText(els.dataStatus, 'Loading');
    setView('loading');

    try {
      var response = await fetch(API_ENDPOINT, {
        headers: { accept: 'application/json' },
        cache: 'no-store'
      });
      var payload = await response.json().catch(function () { return {}; });

      if (!response.ok || payload.error) {
        throw new Error(payload.message || payload.error || 'Leaderboard request failed.');
      }

      var rows = getItems(payload).map(normalizeRecord).filter(function (row) {
        return row.name || row.address;
      });

      state.rows = rows;
      updateStats(rows);
      renderRows(rows);

      if (rows.length) {
        setView('table');
        setText(els.status, 'Leaderboard loaded.');
      } else {
        setView('empty');
        setText(els.status, 'No leaderboard rows returned.');
      }
    } catch (error) {
      updateStats([]);
      setText(els.status, 'Leaderboard unavailable.');
      setView('error', error.message);
    } finally {
      state.loading = false;
      els.refresh.disabled = false;
    }
  }

  if (els.refresh) {
    els.refresh.addEventListener('click', loadLeaderboard);
  }

  loadLeaderboard();
})();
