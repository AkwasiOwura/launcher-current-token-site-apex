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

  function safeImageUrl(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    try {
      var url = new URL(raw, window.location.href);
      return /^https?:$/.test(url.protocol) ? url.href : '';
    } catch (_error) {
      return '';
    }
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

  function twitterUrl(value) {
    var raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) {
      try {
        var parsed = new URL(raw);
        return /^https?:$/.test(parsed.protocol) ? parsed.href : '';
      } catch (_error) {
        return '';
      }
    }
    var handle = raw.replace(/^@+/, '').replace(/[^A-Za-z0-9_]/g, '');
    return handle ? 'https://x.com/' + handle : '';
  }

  function sparklineSvg(tone) {
    var cls = tone === 'loss' ? ' loss-spark' : '';
    return '<svg class="metric-spark' + cls + '" viewBox="0 0 120 22" aria-hidden="true"><path d="M3 18 C18 12 27 14 38 10 S59 12 69 7 S88 11 117 4"/></svg>';
  }

  function copyAddress(address, button) {
    if (!address || !button) return;
    var old = button.textContent;
    var done = function () {
      button.classList.add('copied');
      button.textContent = 'Copied';
      window.setTimeout(function () {
        button.classList.remove('copied');
        button.textContent = old;
      }, 1100);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(address).then(done).catch(done);
    } else {
      done();
    }
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
    var name = pick(identity, ['name']) || 'KOL Wallet';
    var avatar = safeImageUrl(pick(identity, ['avatar', 'image']));
    var twitter = twitterUrl(pick(identity, ['twitter', 'x', 'twitterUrl', 'xUrl']));
    var metrics = [
      ['Total PnL', money(pick(source, ['pnl.total', 'totalPnl', 'total'])), 'chart'],
      ['Realized PnL', money(pick(source, ['pnl.realized', 'realizedPnl', 'realized'])), 'coin'],
      ['Unrealized PnL', money(pick(source, ['pnl.unrealized', 'unrealizedPnl', 'unrealized'])), 'nodes'],
      ['Win Rate', percent(pick(analysis, ['winRate']) || pick(source, ['winRate'])), 'target'],
      ['Total Trades', integer(pick(source, ['counts.trades', 'trades', 'totalTrades'])), 'swap'],
      ['Tokens Bought', integer(pick(source, ['counts.tokensTraded', 'tokensTraded']) || pick(stats, ['total'])), 'cart'],
      ['Profitable Tokens', integer(pick(stats, ['profitable']) || pick(analysis, ['tokens.winning'])), 'trophy'],
      ['Losing Tokens', integer(pick(stats, ['losing']) || pick(analysis, ['tokens.losing'])), 'flame', 'loss']
    ];
    var dailyPnl = money(pick(source, ['pnl.realized', 'realizedPnl', 'realized']));
    var dailyVolume = money(pick(source, ['proceeds']) || pick(source, ['openPositions.value']));
    var lifetime = money(pick(source, ['pnl.total', 'totalPnl', 'total']));
    var roi = percent(pick(source, ['roi']));
    var winRate = percent(pick(analysis, ['winRate']) || pick(source, ['winRate']));
    var trades = integer(pick(source, ['counts.trades', 'trades', 'totalTrades']));

    els.walletSummary.innerHTML =
      '<div class="wallet-hero-card">' +
        '<div class="wallet-profile-main">' +
          '<span class="wallet-avatar">' + (avatar ? '<img src="' + escapeHtml(avatar) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();">' : '') + '<span>' + escapeHtml(initials(name)) + '</span></span>' +
          '<div>' +
            '<div class="wallet-name-line"><h3>' + escapeHtml(name) + '</h3>' + (twitter ? '<a class="x-link" href="' + escapeHtml(twitter) + '" target="_blank" rel="noopener noreferrer" aria-label="Open X profile">𝕏</a>' : '') + '</div>' +
            '<button class="wallet-copy" type="button" data-copy-address="' + escapeHtml(address) + '">' + escapeHtml(shortAddress(address)) + '</button>' +
            '<span class="rank-badge">Ranked KOL</span>' +
          '</div>' +
        '</div>' +
        '<div class="wallet-hero-stats">' +
          '<div><span>Daily PnL</span><strong class="profit">' + dailyPnl + '</strong></div>' +
          '<div><span>Daily Volume</span><strong>' + dailyVolume + '</strong></div>' +
          '<div><span>Lifetime PnL</span><strong class="profit">' + lifetime + '</strong></div>' +
          '<div><span>ROI</span><strong>' + roi + '</strong></div>' +
          '<div><span>Win Rate</span><strong>' + winRate + '</strong></div>' +
          '<div><span>Trades</span><strong>' + trades + '</strong></div>' +
        '</div>' +
      '</div>' +
      '<div class="wallet-summary-head"><p class="eyebrow">PnL Summary</p><h2>Wallet performance</h2></div>' +
      '<div class="metric-grid">' +
      metrics.map(function (item) {
        var tone = item[3] === 'loss' ? ' loss-metric' : '';
        return '<div class="metric wallet-metric' + tone + '"><span class="metric-icon metric-icon-' + item[2] + '"></span><span class="metric-label">' + item[0] + '</span><strong>' + item[1] + '</strong>' + sparklineSvg(item[3]) + '</div>';
      }).join('') +
      '</div>';
    var copyButton = els.walletSummary.querySelector('[data-copy-address]');
    if (copyButton) {
      copyButton.addEventListener('click', function () {
        copyAddress(address, copyButton);
      });
    }
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
