(function () {
  'use strict';

  var WORKER_ENDPOINT_OVERRIDE = 'https://solmemehub-kolscan-proxy.solmemehub.workers.dev';
  var API_BASE = (WORKER_ENDPOINT_OVERRIDE || '').replace(/\/$/, '');
  var POLL_INTERVAL_MS = 120000;
  var pollTimer = null;
  var currentPeriod = 'daily';
  var SOL_MINT = 'So11111111111111111111111111111111111111112';

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
    periodTabs: document.querySelectorAll('.period-tab'),
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

  function periodLabel(period) {
    return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' }[period] || 'Daily';
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

  function dateTime(value) {
    var stamp = toNumber(value);
    if (stamp === null && value) stamp = Date.parse(value);
    if (!stamp) return '—';
    return new Date(stamp).toLocaleString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
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
    var name = pick(row, ['identity.name', 'name', 'wallet']) || 'KOL';
    var fallback = escapeHtml(initials(name));
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
      var url = walletDetailUrl(wallet);
      var periodPnl = pick(row, ['period.realized', 'pnl.realized', 'realizedPnl']);
      var periodVolume = pick(row, ['period.volume', 'volume']);
      var lifetime = pick(row, ['ending.pnl.total', 'pnl.total', 'totalPnl']);
      var tradingDays = pick(row, ['period.tradingDays', 'tradingDays']);
      var snapshot = pick(row, ['lastSnapshotDate', 'updatedAt', 'timing.lastTrade']);
      var periodClass = toNumber(periodPnl) < 0 ? 'loss' : 'profit';
      var lifetimeClass = toNumber(lifetime) < 0 ? 'loss' : 'profit';
      return '<tr class="leaderboard-row" data-wallet-url="' + escapeHtml(url) + '" tabindex="0" role="link" aria-label="Open wallet ' + escapeHtml(shortAddress(wallet)) + '">' +
        '<td><span class="rank">' + (index + 1) + '</span></td>' +
        '<td><a class="wallet-cell wallet-link" href="' + escapeHtml(url) + '">' + avatarHtml(row) + '<span><span class="primary">' + escapeHtml(name) + '</span><span class="secondary">' + escapeHtml(shortAddress(wallet)) + '</span></span></a></td>' +
        '<td class="' + periodClass + '">' + money(periodPnl) + '</td>' +
        '<td>' + money(periodVolume) + '</td>' +
        '<td class="' + lifetimeClass + '">' + money(lifetime) + '</td>' +
        '<td>' + integer(tradingDays) + '</td>' +
        '<td class="muted">' + escapeHtml(snapshotLabel(snapshot)) + '</td>' +
        '<td><a href="' + escapeHtml(url) + '" class="scan-wallet">Open</a></td>' +
        '</tr>';
    }).join('');

    els.leaderboardBody.querySelectorAll('.leaderboard-row').forEach(function (row) {
      row.addEventListener('click', function () {
        window.location.href = row.getAttribute('data-wallet-url') || './wallet.html';
      });
      row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          window.location.href = row.getAttribute('data-wallet-url') || './wallet.html';
        }
      });
    });
  }

  function walletDetailUrl(address) {
    return './wallet.html?address=' + encodeURIComponent(String(address || '').trim());
  }

  function updateStats(rows) {
    var periodPnl = rows.reduce(function (sum, row) { return sum + (toNumber(pick(row, ['period.realized', 'pnl.realized', 'realizedPnl'])) || 0); }, 0);
    var periodVolume = rows.reduce(function (sum, row) { return sum + (toNumber(pick(row, ['period.volume', 'volume'])) || 0); }, 0);
    var lifetimePnl = rows.reduce(function (sum, row) { return sum + (toNumber(pick(row, ['ending.pnl.total', 'pnl.total', 'totalPnl'])) || 0); }, 0);
    setText(els.statKols, integer(rows.length));
    setText(els.statTotalPnl, money(periodPnl));
    setText(els.statRealizedPnl, money(periodVolume));
    setText(els.statTrades, money(lifetimePnl));
    var label = periodLabel(currentPeriod);
    var pnlLabel = document.getElementById('stat-period-pnl-label');
    var volLabel = document.getElementById('stat-period-volume-label');
    var thPnl = document.getElementById('th-period-pnl');
    var thVol = document.getElementById('th-period-volume');
    if (pnlLabel) pnlLabel.textContent = label + ' PnL';
    if (volLabel) volLabel.textContent = label + ' Volume';
    if (thPnl) thPnl.textContent = label + ' PnL';
    if (thVol) thVol.textContent = label + ' Volume';
  }

  function snapshotLabel(value) {
    if (!value) return '—';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    var stamp = toNumber(value);
    if (stamp === null) stamp = Date.parse(String(value));
    if (!stamp) return '—';
    var diff = Date.now() - stamp;
    if (diff < 0) diff = 0;
    var mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 48) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  async function loadLeaderboard() {
    show(els.leaderboardLoading, true);
    show(els.leaderboardEmpty, false);
    show(els.leaderboardError, false);
    show(els.leaderboardTable, false);
    setText(els.globalStatus, 'Refreshing ' + periodLabel(currentPeriod).toLowerCase() + ' leaderboard...');

    try {
      var data = await fetchJson('/api/kolscan/leaderboard?period=' + encodeURIComponent(currentPeriod) + '&sort=realized&direction=desc&limit=100');
      var rows = leaderboardRows(data);
      updateStats(rows);
      renderLeaderboard(rows);
      show(els.leaderboardLoading, false);
      show(els.leaderboardTable, rows.length > 0);
      show(els.leaderboardEmpty, rows.length === 0);
      setText(els.globalStatus, rows.length ? periodLabel(currentPeriod) + ' leaderboard live via proxy.' : 'No leaderboard rows returned.');
    } catch (error) {
      show(els.leaderboardLoading, false);
      show(els.leaderboardError, true);
      setText(els.leaderboardError, error.message);
      setText(els.globalStatus, 'Leaderboard unavailable.');
    }
  }

  function setActivePeriod(period) {
    currentPeriod = period;
    els.periodTabs.forEach(function (button) {
      var active = button.getAttribute('data-period') === currentPeriod;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderWallet(data, address) {
    var source = data.summary || data.wallet || data;
    var analysis = data.analysis || {};
    var stats = data.stats || {};
    var identity = data.identity || {};
    var metrics = [
      ['Total PnL', money(pick(source, ['pnl.total', 'totalPnl', 'total']))],
      ['Realized PnL', money(pick(source, ['pnl.realized', 'realizedPnl', 'realized']))],
      ['Unrealized PnL', money(pick(source, ['pnl.unrealized', 'unrealizedPnl', 'unrealized']))],
      ['Win Rate', percent(pick(analysis, ['winRate']) || pick(source, ['winRate']))],
      ['Trades', integer(pick(source, ['counts.trades', 'trades', 'totalTrades']))],
      ['Tokens Bought', integer(pick(source, ['counts.tokensTraded', 'tokensTraded']) || pick(stats, ['total']))],
      ['Profitable Tokens', integer(pick(stats, ['profitable']) || pick(analysis, ['tokens.winning']))],
      ['Losing Tokens', integer(pick(stats, ['losing']) || pick(analysis, ['tokens.losing']))]
    ];

    els.walletSummary.innerHTML =
      '<div class="wallet-detail-head">' +
        '<div>' +
          '<p class="eyebrow">Wallet Detail</p>' +
          '<h3>' + escapeHtml(pick(identity, ['name']) || 'KOL Wallet') + '</h3>' +
          '<span class="secondary full-address">' + escapeHtml(address) + '</span>' +
        '</div>' +
        '<span class="status-pill">' + escapeHtml(pick(data, ['pnlMode']) || 'pnl') + '</span>' +
      '</div>' +
      '<div class="metric-grid">' +
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

  function isSol(address) {
    return String(address || '') === SOL_MINT;
  }

  function tradeSide(trade) {
    var fromAddress = pick(trade, ['from.address']);
    var toAddress = pick(trade, ['to.address']);
    if (isSol(fromAddress) && !isSol(toAddress)) return 'Buy';
    if (!isSol(fromAddress) && isSol(toAddress)) return 'Sell';
    return String(pick(trade, ['type', 'side', 'action']) || 'Trade');
  }

  function tradedToken(trade) {
    var fromAddress = pick(trade, ['from.address']);
    var toAddress = pick(trade, ['to.address']);
    if (!isSol(fromAddress)) return trade.from || {};
    if (!isSol(toAddress)) return trade.to || {};
    return trade.to || trade.from || {};
  }

  function profitLabel(trade) {
    var pnl = pick(trade, ['pnl', 'profit', 'profitUsd', 'realizedPnl', 'realizedProfit']);
    var number = toNumber(pnl);
    if (number === null) {
      return '<span class="status-pill muted-pill">P&L unavailable</span>';
    }
    return '<span class="status-pill ' + (number >= 0 ? 'good-pill' : 'bad-pill') + '">' + (number >= 0 ? 'Profitable' : 'Loss') + ' ' + money(number) + '</span>';
  }

  function renderTrades(rows) {
    els.tradesFeed.innerHTML = rows.slice(0, 24).map(function (trade) {
      var token = tradedToken(trade);
      var tokenName = pick(token, ['token.name', 'name']) || 'Token';
      var tokenSymbol = pick(token, ['token.symbol', 'symbol']) || tokenName;
      var tokenAddress = pick(token, ['address', 'mint']) || '';
      var side = tradeSide(trade);
      var value = pick(trade, ['volume.usd', 'volume', 'usdValue', 'amountUsd', 'value']);
      var price = pick(trade, ['price.usd', 'priceUsd', 'entryPrice', 'exitPrice']);
      return '<div class="feed-item trade-item ' + (String(side).toLowerCase() === 'buy' ? 'buy-trade' : String(side).toLowerCase() === 'sell' ? 'sell-trade' : '') + '">' +
        '<div class="trade-main">' +
          '<strong>' + escapeHtml(side.toUpperCase()) + ' ' + escapeHtml(tokenSymbol) + '</strong>' +
          profitLabel(trade) +
        '</div>' +
        '<div class="trade-grid">' +
          '<span><b>Token</b>' + escapeHtml(tokenName) + '</span>' +
          '<span><b>Address</b>' + escapeHtml(shortAddress(tokenAddress)) + '</span>' +
          '<span><b>Value</b>' + money(value) + '</span>' +
          '<span><b>Entry/exit price</b>' + money(price) + '</span>' +
          '<span><b>Date</b>' + escapeHtml(dateTime(pick(trade, ['time', 'timestamp', 'date']))) + '</span>' +
          '<span><b>Tx</b>' + escapeHtml(shortAddress(pick(trade, ['tx', 'signature']) || '—')) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function openWallet(address) {
    address = String(address || '').trim();
    if (!address) return;
    els.walletInput.value = address;
    loadWallet(address);
    var target = document.getElementById('wallet-tools');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  els.periodTabs.forEach(function (button) {
    button.addEventListener('click', function () {
      var period = button.getAttribute('data-period') || 'daily';
      setActivePeriod(period);
      loadLeaderboard();
    });
  });
  els.walletForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var address = String(els.walletInput.value || '').trim();
    if (address) window.location.href = walletDetailUrl(address);
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
