(function () {
  'use strict';

  var WORKER_ENDPOINT_OVERRIDE = 'https://solmemehub-kolscan-proxy.solmemehub.workers.dev';
  var API_BASE = (WORKER_ENDPOINT_OVERRIDE || '').replace(/\/$/, '');
  var SOL_MINT = 'So11111111111111111111111111111111111111112';

  var els = {
    addressLabel: document.getElementById('wallet-address-label'),
    refreshWallet: document.getElementById('refresh-wallet'),
    walletLoading: document.getElementById('wallet-loading'),
    walletEmpty: document.getElementById('wallet-empty'),
    walletError: document.getElementById('wallet-error'),
    walletSummary: document.getElementById('wallet-summary'),
    tradesLoading: document.getElementById('trades-loading'),
    tradesEmpty: document.getElementById('trades-empty'),
    tradesError: document.getElementById('trades-error'),
    tradesFeed: document.getElementById('trades-feed')
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
      return '<span class="pnl-cell muted">P&L unavailable</span>';
    }
    return '<span class="pnl-cell ' + (number >= 0 ? 'profit' : 'loss') + '">' + (number >= 0 ? 'Profit ' : 'Loss ') + money(number) + '</span>';
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
      ['Total Trades', integer(pick(source, ['counts.trades', 'trades', 'totalTrades']))],
      ['Tokens Bought', integer(pick(source, ['counts.tokensTraded', 'tokensTraded']) || pick(stats, ['total']))],
      ['Profitable Tokens', integer(pick(stats, ['profitable']) || pick(analysis, ['tokens.winning']))],
      ['Losing Tokens', integer(pick(stats, ['losing']) || pick(analysis, ['tokens.losing']))]
    ];

    els.walletSummary.innerHTML =
      '<div class="wallet-detail-head">' +
        '<div>' +
          '<p class="eyebrow">Wallet Address</p>' +
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

  function renderTrades(rows) {
    var items = rows.slice(0, 80).map(function (trade) {
      var token = tradedToken(trade);
      var tokenName = pick(token, ['token.name', 'name']) || 'Token';
      var tokenSymbol = pick(token, ['token.symbol', 'symbol']) || tokenName;
      var tokenAddress = pick(token, ['address', 'mint']) || '';
      var side = tradeSide(trade);
      var value = pick(trade, ['volume.usd', 'volume', 'usdValue', 'amountUsd', 'value']);
      var price = pick(trade, ['price.usd', 'priceUsd', 'entryPrice', 'exitPrice']);
      var sideClass = String(side).toLowerCase() === 'buy' ? 'buy-trade' : String(side).toLowerCase() === 'sell' ? 'sell-trade' : '';
      return '<div class="trade-row ' + sideClass + '">' +
        '<span class="trade-side">' + escapeHtml(side.toUpperCase()) + '</span>' +
        '<span class="trade-token"><strong>' + escapeHtml(tokenName) + '</strong></span>' +
        '<span data-label="Symbol">' + escapeHtml(tokenSymbol) + '</span>' +
        '<span data-label="Address"><code>' + escapeHtml(shortAddress(tokenAddress)) + '</code></span>' +
        '<span data-label="Value">' + money(value) + '</span>' +
        '<span data-label="Entry/exit price">' + money(price) + '</span>' +
        '<span data-label="Date / Time">' + escapeHtml(dateTime(pick(trade, ['time', 'timestamp', 'date']))) + '</span>' +
        '<span data-label="TX"><code>' + escapeHtml(shortAddress(pick(trade, ['tx', 'signature']) || '—')) + '</code></span>' +
        profitLabel(trade) +
      '</div>';
    }).join('');
    els.tradesFeed.innerHTML = '<div class="trade-table">' +
      '<div class="trade-row trade-head"><span>Side</span><span>Token</span><span>Symbol</span><span>Address</span><span>Value</span><span>Entry/exit price</span><span>Date / Time</span><span>TX</span><span>P&L</span></div>' +
      items +
    '</div>';
  }

  async function loadWallet(address) {
    address = String(address || '').trim();
    setText(els.addressLabel, address || 'No wallet address supplied.');
    if (!address) {
      show(els.walletLoading, false);
      show(els.walletEmpty, true);
      show(els.tradesEmpty, true);
      return;
    }

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

  var address = new URLSearchParams(window.location.search).get('address') || '';
  els.refreshWallet.addEventListener('click', function () {
    loadWallet(address);
  });
  loadWallet(address);
})();
