(function () {
  'use strict';

  var WORKER_ENDPOINT_OVERRIDE = 'https://solmemehub-kolscan-proxy.solmemehub.workers.dev';
  var API_BASE = (WORKER_ENDPOINT_OVERRIDE || '').replace(/\/$/, '');
  var POLL_INTERVAL_MS = 120000;
  var pollTimer = null;

  var els = {
    globalStatus: document.getElementById('global-status'),
    dataMode: document.getElementById('data-mode'),
    statKols: document.getElementById('stat-kols'),
    statTotalPnl: document.getElementById('stat-total-pnl'),
    statRealizedPnl: document.getElementById('stat-realized-pnl'),
    statTrades: document.getElementById('stat-trades'),
    leaderboardLoading: document.getElementById('leaderboard-loading'),
    leaderboardEmpty: document.getElementById('leaderboard-empty'),
    leaderboardError: document.getElementById('leaderboard-error'),
    leaderboardTable: document.getElementById('leaderboard-table'),
    leaderboardBody: document.getElementById('leaderboard-body'),
    refreshLeaderboard: document.getElementById('refresh-leaderboard'),
    walletForm: document.getElementById('wallet-form'),
    walletInput: document.getElementById('wallet-input'),
    walletLoading: document.getElementById('wallet-loading'),
    walletEmpty: document.getElementById('wallet-empty'),
    walletError: document.getElementById('wallet-error'),
    walletSummary: document.getElementById('wallet-summary'),
    tradesLoading: document.getElementById('trades-loading'),
    tradesEmpty: document.getElementById('trades-empty'),
    tradesError: document.getElementById('trades-error'),
    tradesFeed: document.getElementById('trades-feed'),
    tokenForm: document.getElementById('token-form'),
    tokenInput: document.getElementById('token-input'),
    tokenLoading: document.getElementById('token-loading'),
    tokenEmpty: document.getElementById('token-empty'),
    tokenError: document.getElementById('token-error'),
    tokenTable: document.getElementById('token-table'),
    tokenBody: document.getElementById('token-body')
  };

  function endpoint(path) {
    return API_BASE + path;
  }

  function setText(node, value) {
    if (node) node.textContent = value;
  }

  function show(node, visible) {
    if (!node) return;
    node.classList.toggle('hidden', !visible);
    if ('hidden' in node) node.hidden = !visible;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function pick(source, paths) {
    for (var i = 0; i < paths.length; i += 1) {
      var value = paths[i].split('.').reduce(function (acc, key) {
        return acc && acc[key] !== undefined ? acc[key] : undefined;
      }, source);
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;
    var parsed = Number(value.replace(/[$,%\s,]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function money(value) {
    var number = toNumber(value);
    if (number === null) return '—';
    var abs = Math.abs(number);
    var sign = number < 0 ? '-' : '';
    if (abs >= 1000000000) return sign + '$' + (abs / 1000000000).toFixed(2) + 'B';
    if (abs >= 1000000) return sign + '$' + (abs / 1000000).toFixed(2) + 'M';
    if (abs >= 1000) return sign + '$' + (abs / 1000).toFixed(1) + 'K';
    return sign + '$' + abs.toFixed(2);
  }

  function percent(value) {
    var number = toNumber(value);
    if (number === null) return '—';
    return number.toFixed(1) + '%';
  }

  function integer(value) {
    var number = toNumber(value);
    if (number === null) return '—';
    return Math.round(number).toLocaleString('en-US');
  }

  function shortAddress(value) {
    var text = String(value || '');
    return text.length > 14 ? text.slice(0, 5) + '...' + text.slice(-5) : text || 'public wallet';
  }

  function timeAgo(value) {
    var stamp = toNumber(value);
    if (stamp === null && value) stamp = Date.parse(value);
    if (!stamp) return '—';
    var diff = Date.now() - stamp;
    if (diff < 0) diff = 0;
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 48) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  function initials(name) {
    return String(name || 'KOL')
      .replace(/[^a-zA-Z0-9 ]/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); })
      .join('') || 'K';
  }

  function avatarHtml(row) {
    var image = pick(row, ['identity.avatar', 'avatar', 'image']);
    var name = pick(row, ['identity.name', 'name', 'wallet']) || 'KOL';
    var fallback = escapeHtml(initials(name));
    if (typeof image === 'string' && /^https?:\/\//.test(image)) {
      return '<span class="avatar" data-initials="' + fallback + '"><img src="' + escapeHtml(image) + '" alt="" onerror="this.parentElement.textContent=this.parentElement.dataset.initials"></span>';
    }
    return '<span class="avatar">' + fallback + '</span>';
  }

  async function fetchJson(path) {
    var response = await fetch(endpoint(path), {
      headers: { accept: 'application/json' },
      cache: 'no-store'
    });
    var payload = await response.json().catch(function () { return {}; });
    if (!response.ok || payload.error) {
      throw new Error(payload.message || payload.error || 'Request failed');
    }
    return payload.data || payload;
  }

  function leaderboardRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.traders)) return payload.traders;
    if (Array.isArray(payload.data && payload.data.traders)) return payload.data.traders;
    return [];
  }

  function renderLeaderboard(rows) {
    els.leaderboardBody.innerHTML = rows.map(function (row, index) {
      var name = pick(row, ['identity.name', 'name']) || 'KOL Wallet';
      var wallet = pick(row, ['wallet', 'address']) || '';
      var total = pick(row, ['pnl.total', 'totalPnl']);
      var realized = pick(row, ['pnl.realized', 'realizedPnl']);
      var totalClass = toNumber(total) < 0 ? 'loss' : 'profit';
      var realizedClass = toNumber(realized) < 0 ? 'loss' : 'profit';
      return '<tr>' +
        '<td><span class="rank">' + (index + 1) + '</span></td>' +
        '<td><div class="wallet-cell">' + avatarHtml(row) + '<span><span class="primary">' + escapeHtml(name) + '</span><span class="secondary">' + escapeHtml(shortAddress(wallet)) + '</span></span></div></td>' +
        '<td class="' + totalClass + '">' + money(total) + '</td>' +
        '<td class="' + realizedClass + '">' + money(realized) + '</td>' +
        '<td>' + percent(pick(row, ['winRate'])) + '</td>' +
        '<td class="profit">' + percent(pick(row, ['roi'])) + '</td>' +
        '<td>' + integer(pick(row, ['counts.trades', 'trades'])) + '</td>' +
        '<td class="muted">' + timeAgo(pick(row, ['timing.lastTrade', 'lastTrade', 'updatedAt'])) + '</td>' +
        '<td><button type="button" data-wallet="' + escapeHtml(wallet) + '" class="scan-wallet">Scan</button></td>' +
        '</tr>';
    }).join('');

    els.leaderboardBody.querySelectorAll('.scan-wallet').forEach(function (button) {
      button.addEventListener('click', function () {
        els.walletInput.value = button.getAttribute('data-wallet') || '';
        loadWallet(els.walletInput.value);
      });
    });
  }

  function updateStats(rows) {
    var totalPnl = rows.reduce(function (sum, row) { return sum + (toNumber(pick(row, ['pnl.total', 'totalPnl'])) || 0); }, 0);
    var realized = rows.reduce(function (sum, row) { return sum + (toNumber(pick(row, ['pnl.realized', 'realizedPnl'])) || 0); }, 0);
    var trades = rows.reduce(function (sum, row) { return sum + (toNumber(pick(row, ['counts.trades', 'trades'])) || 0); }, 0);
    setText(els.statKols, integer(rows.length));
    setText(els.statTotalPnl, money(totalPnl));
    setText(els.statRealizedPnl, money(realized));
    setText(els.statTrades, integer(trades));
  }

  async function loadLeaderboard() {
    show(els.leaderboardLoading, true);
    show(els.leaderboardEmpty, false);
    show(els.leaderboardError, false);
    show(els.leaderboardTable, false);
    setText(els.globalStatus, 'Refreshing leaderboard...');

    try {
      var data = await fetchJson('/api/kolscan/leaderboard');
      var rows = leaderboardRows(data);
      updateStats(rows);
      renderLeaderboard(rows);
      show(els.leaderboardLoading, false);
      show(els.leaderboardTable, rows.length > 0);
      show(els.leaderboardEmpty, rows.length === 0);
      setText(els.globalStatus, rows.length ? 'Leaderboard live via proxy.' : 'No leaderboard rows returned.');
    } catch (error) {
      show(els.leaderboardLoading, false);
      show(els.leaderboardError, true);
      setText(els.leaderboardError, error.message);
      setText(els.globalStatus, 'Leaderboard unavailable.');
    }
  }

  function renderWallet(data, address) {
    var source = data.summary || data.wallet || data;
    var metrics = [
      ['Total PnL', money(pick(source, ['pnl.total', 'totalPnl', 'total']))],
      ['Realized PnL', money(pick(source, ['pnl.realized', 'realizedPnl', 'realized']))],
      ['Win Rate', percent(pick(source, ['winRate']))],
      ['Trades', integer(pick(source, ['counts.trades', 'trades', 'totalTrades']))]
    ];

    els.walletSummary.innerHTML = '<h3>' + escapeHtml(shortAddress(address)) + '</h3><div class="metric-grid">' +
      metrics.map(function (item) {
        return '<div class="metric"><span class="metric-label">' + item[0] + '</span><strong>' + item[1] + '</strong></div>';
      }).join('') +
      '</div>';
  }

  function tradeRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.trades)) return payload.trades;
    if (Array.isArray(payload.data)) return payload.data;
    return [];
  }

  function renderTrades(rows) {
    els.tradesFeed.innerHTML = rows.slice(0, 24).map(function (trade) {
      var token = pick(trade, ['token.symbol', 'symbol', 'token.name', 'name', 'mint']) || 'Token';
      var type = pick(trade, ['type', 'side', 'action']) || 'trade';
      var value = pick(trade, ['volume.usd', 'volume', 'usdValue', 'amountUsd', 'value']);
      return '<div class="feed-item"><strong>' + escapeHtml(String(type).toUpperCase()) + ' ' + escapeHtml(token) + '</strong>' +
        '<span class="muted">' + money(value) + ' · ' + escapeHtml(timeAgo(pick(trade, ['time', 'timestamp', 'date']))) + '</span></div>';
    }).join('');
  }

  async function loadWallet(address) {
    address = String(address || '').trim();
    if (!address) return;
    show(els.walletEmpty, false);
    show(els.walletError, false);
    show(els.walletLoading, true);
    show(els.walletSummary, false);
    show(els.tradesEmpty, false);
    show(els.tradesError, false);
    show(els.tradesLoading, true);
    els.tradesFeed.innerHTML = '';

    try {
      var walletData = await fetchJson('/api/kolscan/wallet/' + encodeURIComponent(address));
      renderWallet(walletData, address);
      show(els.walletSummary, true);
    } catch (error) {
      show(els.walletError, true);
      setText(els.walletError, error.message);
    } finally {
      show(els.walletLoading, false);
    }

    try {
      var tradesData = await fetchJson('/api/kolscan/wallet/' + encodeURIComponent(address) + '/trades');
      var rows = tradeRows(tradesData);
      renderTrades(rows);
      show(els.tradesEmpty, rows.length === 0);
    } catch (error) {
      show(els.tradesError, true);
      setText(els.tradesError, error.message);
    } finally {
      show(els.tradesLoading, false);
    }
  }

  function tokenTraderRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.traders)) return payload.traders;
    if (Array.isArray(payload.data && payload.data.traders)) return payload.data.traders;
    return [];
  }

  function renderTokenTraders(rows) {
    els.tokenBody.innerHTML = rows.slice(0, 50).map(function (row, index) {
      var wallet = pick(row, ['wallet', 'address']) || '';
      var tokenPnl = pick(row, ['pnl.token.total', 'pnl.total', 'totalPnl']);
      var walletPnl = pick(row, ['pnl.wallet.total', 'walletPnl.total']);
      return '<tr>' +
        '<td><span class="rank">' + (index + 1) + '</span></td>' +
        '<td><span class="primary">' + escapeHtml(shortAddress(wallet)) + '</span><span class="secondary">' + escapeHtml(wallet) + '</span></td>' +
        '<td class="' + (toNumber(tokenPnl) < 0 ? 'loss' : 'profit') + '">' + money(tokenPnl) + '</td>' +
        '<td>' + money(walletPnl) + '</td>' +
        '<td class="profit">' + percent(pick(row, ['roi'])) + '</td>' +
        '<td>' + integer(pick(row, ['counts.buys', 'buys'])) + '</td>' +
        '<td>' + integer(pick(row, ['counts.sells', 'sells'])) + '</td>' +
        '<td class="muted">' + timeAgo(pick(row, ['timing.lastTrade', 'lastTrade'])) + '</td>' +
        '</tr>';
    }).join('');
  }

  async function loadToken(address) {
    address = String(address || '').trim();
    if (!address) return;
    show(els.tokenEmpty, false);
    show(els.tokenError, false);
    show(els.tokenTable, false);
    show(els.tokenLoading, true);

    try {
      var data = await fetchJson('/api/kolscan/token/' + encodeURIComponent(address) + '/traders');
      var rows = tokenTraderRows(data);
      renderTokenTraders(rows);
      show(els.tokenTable, rows.length > 0);
      show(els.tokenEmpty, rows.length === 0);
    } catch (error) {
      show(els.tokenError, true);
      setText(els.tokenError, error.message);
    } finally {
      show(els.tokenLoading, false);
    }
  }

  els.refreshLeaderboard.addEventListener('click', loadLeaderboard);
  els.walletForm.addEventListener('submit', function (event) {
    event.preventDefault();
    loadWallet(els.walletInput.value);
  });
  els.tokenForm.addEventListener('submit', function (event) {
    event.preventDefault();
    loadToken(els.tokenInput.value);
  });

  setText(els.dataMode, 'REST polling');
  loadLeaderboard();
  pollTimer = window.setInterval(loadLeaderboard, POLL_INTERVAL_MS);
  window.addEventListener('beforeunload', function () {
    window.clearInterval(pollTimer);
  });
})();
