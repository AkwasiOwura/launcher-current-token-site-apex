// SolMemeHub — Jupiter swap flow.
//
// Frontend-only: browser calls Jupiter's public quote + swap APIs
// directly (no key), receives a serialized versioned transaction,
// the connected wallet signs it, the browser submits it to a public
// Solana RPC. No backend, no secrets, no private keys ever stored.

(function () {
  'use strict';

  var JUP_QUOTE = 'https://lite-api.jup.ag/swap/v1/quote';
  var JUP_SWAP  = 'https://lite-api.jup.ag/swap/v1/swap';
  var RPC_FALLBACKS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-rpc.publicnode.com'
  ];
  var SOL_MINT  = 'So11111111111111111111111111111111111111112';
  var SOL_DECIMALS = 9;
  // Pump.fun-style mint; we'll fetch live decimals from token list via Jupiter
  var DECIMALS_CACHE = Object.create(null);

  // ── helpers ──────────────────────────────────────────────────────
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isValidMint(s) {
    return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  }
  function shortAddr(s) {
    s = String(s || '');
    return s.length > 14 ? s.slice(0, 5) + '…' + s.slice(-5) : s;
  }
  function fmt(n, max) {
    var v = Number(n);
    if (!Number.isFinite(v)) return '—';
    var abs = Math.abs(v);
    if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return (v / 1e3).toFixed(2) + 'K';
    return v.toFixed(max != null ? max : 6).replace(/\.?0+$/, '');
  }

  // ── decimals lookup ──────────────────────────────────────────────
  async function getDecimals(mint) {
    if (mint === SOL_MINT) return SOL_DECIMALS;
    if (DECIMALS_CACHE[mint] != null) return DECIMALS_CACHE[mint];
    // Query RPC getMint via getAccountInfo parsed
    try {
      var rpcUrl = RPC_FALLBACKS[0];
      var resp = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'getAccountInfo',
          params: [mint, { encoding: 'jsonParsed' }]
        })
      });
      var j = await resp.json();
      var d = j && j.result && j.result.value && j.result.value.data
        && j.result.value.data.parsed && j.result.value.data.parsed.info
        && j.result.value.data.parsed.info.decimals;
      if (Number.isFinite(Number(d))) { DECIMALS_CACHE[mint] = Number(d); return Number(d); }
    } catch (_e) {}
    DECIMALS_CACHE[mint] = 6; // pump.fun default
    return 6;
  }

  // ── modal state ──────────────────────────────────────────────────
  var modal, els, currentCoin, currentSide, lastQuote, busy = false;
  var quoteSeq = 0;          // monotonic id to discard stale Jupiter responses
  var quoteDebounceTimer = null;
  var BUY_DEFAULT_SOL = 0.1; // pre-fill for BUY (denominated in SOL)

  function $(id) { return document.getElementById(id); }

  function setStatus(kind, text, link) {
    var s = els.status;
    s.hidden = !text;
    if (!text) { s.className = 'trade-status'; s.innerHTML = ''; return; }
    s.className = 'trade-status is-' + kind;
    s.innerHTML = escapeHtml(text) + (link
      ? ' <a href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">View on Solscan ↗</a>'
      : '');
  }

  function buyOrSellLabel() {
    return currentSide === 'buy' ? 'Buy' : 'Sell';
  }
  function refreshConfirmState() {
    var label = buyOrSellLabel().toUpperCase();
    if (!connected()) {
      els.confirm.textContent = currentSide === 'buy' ? 'Connect wallet to buy' : 'Connect wallet to sell';
      els.confirm.disabled = true;
      return;
    }
    if (busy)        { els.confirm.textContent = label; els.confirm.disabled = true;  return; }
    if (!lastQuote)  { els.confirm.textContent = label; els.confirm.disabled = true;  return; }
    els.confirm.textContent = label;
    els.confirm.disabled = false;
  }
  function resetQuoteDisplay() {
    els.receive.textContent = '—';
    els.route.textContent = '—';
    els.impact.textContent = '—';
    lastQuote = null;
    refreshConfirmState();
  }

  function connected() {
    var w = window.SMHWallet;
    return !!(w && w.getState().connected);
  }

  function openTrade(coin, side) {
    if (!coin || !isValidMint(coin.mint)) {
      alert('Token mint address is invalid — refusing to quote.');
      return;
    }
    currentCoin = coin;
    currentSide = side === 'sell' ? 'sell' : 'buy';
    els.title.textContent = currentSide === 'buy' ? 'Buy' : 'Sell';
    els.symbol.textContent = '$' + String(coin.symbol || '').replace(/^\$/, '').toUpperCase();
    els.tokenName.textContent = coin.name || coin.symbol || 'Token';
    els.tokenMint.textContent = shortAddr(coin.mint);
    els.tokenMint.setAttribute('title', coin.mint);
    var initials = String(coin.symbol || coin.name || '?')
      .replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
    els.tokenLogo.textContent = initials;
    els.tokenLogo.style.backgroundImage = coin.imageUrl ? 'url("' + coin.imageUrl + '")' : 'none';
    // Pre-fill BUY with a sensible default so the quote panel populates
    // immediately on open. SELL has no safe default (we don't know the
    // user's token balance), so leave it blank and let onChange drive it.
    els.amount.value = currentSide === 'buy' ? String(BUY_DEFAULT_SOL) : '';
    els.amountLabel.textContent = currentSide === 'buy' ? 'Amount (SOL)' : 'Amount (' + (coin.symbol || 'TOKEN').toUpperCase() + ')';
    resetQuoteDisplay();
    setStatus('', '');
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(function () { els.amount.focus(); els.amount.select && els.amount.select(); }, 60);
    if (currentSide === 'buy') scheduleQuote(0);
  }
  function closeTrade() {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }

  // ── Jupiter quote (auto, race-safe) ──────────────────────────────
  function scheduleQuote(delayMs) {
    if (quoteDebounceTimer) { clearTimeout(quoteDebounceTimer); quoteDebounceTimer = null; }
    quoteDebounceTimer = setTimeout(fetchQuote, Number.isFinite(delayMs) ? delayMs : 350);
  }

  async function fetchQuote() {
    if (!currentCoin) return;
    if (modal.hidden) return;
    var amount = Number(els.amount.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      lastQuote = null;
      els.receive.textContent = '—';
      els.route.textContent = '—';
      els.impact.textContent = '—';
      refreshConfirmState();
      return;
    }
    var seq = ++quoteSeq;
    busy = true;
    refreshConfirmState();
    setStatus('info', 'Fetching live Jupiter quote…');
    try {
      var inputMint, outputMint, decimals;
      if (currentSide === 'buy') {
        inputMint = SOL_MINT;
        outputMint = currentCoin.mint;
        decimals = SOL_DECIMALS;
      } else {
        inputMint = currentCoin.mint;
        outputMint = SOL_MINT;
        decimals = await getDecimals(currentCoin.mint);
      }
      if (seq !== quoteSeq) return; // stale: a newer quote was kicked off
      var rawAmount = Math.floor(amount * Math.pow(10, decimals));
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) throw new Error('Amount too small.');
      var slip = Math.max(10, Math.min(5000, Number(els.slippage.value) || 100));
      var url = JUP_QUOTE
        + '?inputMint=' + encodeURIComponent(inputMint)
        + '&outputMint=' + encodeURIComponent(outputMint)
        + '&amount=' + rawAmount
        + '&slippageBps=' + slip;
      var r = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
      if (seq !== quoteSeq) return;
      if (!r.ok) {
        var t = await r.text();
        throw new Error('Jupiter ' + r.status + ': ' + t.slice(0, 200));
      }
      var quote = await r.json();
      if (seq !== quoteSeq) return;
      if (!quote || !quote.outAmount) throw new Error('Jupiter returned no quote.');
      var outDecimals = currentSide === 'buy' ? await getDecimals(currentCoin.mint) : SOL_DECIMALS;
      if (seq !== quoteSeq) return;
      lastQuote = quote;
      var outAmount = Number(quote.outAmount) / Math.pow(10, outDecimals);
      var outSym = currentSide === 'buy'
        ? (currentCoin.symbol || 'TOKEN').toUpperCase().replace(/^\$/, '')
        : 'SOL';
      els.receive.textContent = fmt(outAmount, 6) + ' ' + outSym;
      var hops = (quote.routePlan || []).map(function (h) {
        return (h.swapInfo && (h.swapInfo.label || h.swapInfo.ammKey || '')) || '';
      }).filter(Boolean);
      els.route.textContent = hops.length ? hops.join(' → ') : 'Jupiter';
      var impact = Number(quote.priceImpactPct);
      els.impact.textContent = Number.isFinite(impact) ? (impact * 100).toFixed(3) + '%' : '—';
      setStatus(connected() ? 'ok' : 'warn',
        connected() ? 'Quote ready.' : 'Quote ready — connect a wallet to sign.');
    } catch (err) {
      if (seq !== quoteSeq) return;
      lastQuote = null;
      els.receive.textContent = '—';
      els.route.textContent = '—';
      els.impact.textContent = '—';
      setStatus('error', 'Quote failed: ' + (err && err.message ? err.message : err));
    } finally {
      if (seq === quoteSeq) {
        busy = false;
        refreshConfirmState();
      }
    }
  }

  // ── Jupiter swap → wallet sign → RPC send ────────────────────────
  async function executeSwap() {
    if (busy) return;
    if (!lastQuote) { setStatus('warn', 'No quote loaded yet — change the amount to refresh.'); return; }
    if (!connected()) { setStatus('warn', 'Connect a wallet first.'); refreshConfirmState(); return; }
    if (!window.solanaWeb3) { setStatus('error', 'Solana web3 library failed to load. Refresh the page.'); return; }
    busy = true;
    refreshConfirmState();
    setStatus('info', 'Building transaction…');
    try {
      var wallet = window.SMHWallet.getState();
      var swapResp = await fetch(JUP_SWAP, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: lastQuote,
          userPublicKey: wallet.address,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto'
        })
      });
      if (!swapResp.ok) {
        var et = await swapResp.text();
        throw new Error('Jupiter swap ' + swapResp.status + ': ' + et.slice(0, 200));
      }
      var swap = await swapResp.json();
      if (!swap.swapTransaction) throw new Error('Jupiter returned no swap transaction.');

      var swBytes = atob(swap.swapTransaction);
      var raw = new Uint8Array(swBytes.length);
      for (var i = 0; i < swBytes.length; i += 1) raw[i] = swBytes.charCodeAt(i);
      var tx = window.solanaWeb3.VersionedTransaction.deserialize(raw);

      var connection = new window.solanaWeb3.Connection(RPC_FALLBACKS[0], 'confirmed');

      setStatus('info', 'Awaiting wallet signature…');
      var sig = await window.SMHWallet.signAndSend(tx, connection);

      setStatus('info', 'Submitted. Confirming on-chain…');
      var solscan = 'https://solscan.io/tx/' + sig;
      try {
        var latest = await connection.getLatestBlockhash('confirmed');
        await connection.confirmTransaction({
          signature: sig,
          blockhash: latest.blockhash,
          lastValidBlockHeight: latest.lastValidBlockHeight
        }, 'confirmed');
        setStatus('ok', 'Trade confirmed on-chain.', solscan);
      } catch (_confErr) {
        setStatus('ok', 'Trade submitted. Confirmation pending — check Solscan.', solscan);
      }
      // success: refreshConfirmState() in finally will re-label the button
    } catch (err) {
      var msg = err && err.message ? err.message : String(err);
      if (/reject|denied|user|cancel/i.test(msg)) {
        setStatus('warn', 'Transaction rejected in wallet.');
      } else if (/insufficient/i.test(msg)) {
        setStatus('error', 'Insufficient balance for this trade.');
      } else {
        setStatus('error', 'Trade failed: ' + msg);
      }
    } finally {
      busy = false;
      refreshConfirmState();
    }
  }

  // ── UI wiring ────────────────────────────────────────────────────
  function setupUi() {
    modal = $('trade-modal');
    if (!modal) return;
    els = {
      title:      $('trade-side-label'),
      symbol:     $('trade-symbol-label'),
      tokenName:  $('trade-token-name'),
      tokenMint:  $('trade-token-mint'),
      tokenLogo:  $('trade-token-logo'),
      amount:     $('trade-amount-input'),
      amountLabel:$('trade-amount-label'),
      slippage:   $('trade-slippage'),
      receive:    $('trade-receive'),
      route:      $('trade-route'),
      impact:     $('trade-impact'),
      status:     $('trade-status'),
      confirm:    $('trade-confirm')
    };

    modal.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.matches && t.matches('[data-modal-close]')) {
        if (!busy) closeTrade();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden && !busy) closeTrade();
    });

    function onAmountInput() {
      lastQuote = null;
      els.receive.textContent = '—';
      els.route.textContent = '—';
      els.impact.textContent = '—';
      refreshConfirmState();
      var amount = Number(els.amount.value);
      if (Number.isFinite(amount) && amount > 0) {
        setStatus('info', 'Fetching live Jupiter quote…');
        scheduleQuote(350);
      } else {
        setStatus('', '');
        if (quoteDebounceTimer) { clearTimeout(quoteDebounceTimer); quoteDebounceTimer = null; }
      }
    }
    function onSlippageChange() {
      if (!Number.isFinite(Number(els.amount.value)) || Number(els.amount.value) <= 0) return;
      lastQuote = null;
      refreshConfirmState();
      setStatus('info', 'Fetching live Jupiter quote…');
      scheduleQuote(150);
    }
    els.amount.addEventListener('input', onAmountInput);
    els.slippage.addEventListener('change', onSlippageChange);
    els.amount.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (lastQuote && connected()) executeSwap(); }
    });

    els.confirm.addEventListener('click', function () {
      if (!lastQuote || !connected() || busy) return;
      executeSwap();
    });

    // Re-render confirm state whenever wallet connects/disconnects.
    if (window.SMHWallet && typeof window.SMHWallet.on === 'function') {
      window.SMHWallet.on(function () { if (!modal.hidden) refreshConfirmState(); });
    }

    // delegated buy/sell from coin cards. Use capture-phase + preventDefault
    // so the click does not also follow the parent <a class="coin-card">.
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-trade]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var card = btn.closest('[data-coin]');
      if (!card) return;
      var coin;
      try { coin = JSON.parse(card.getAttribute('data-coin')); } catch (_e) { coin = null; }
      if (!coin) return;
      openTrade(coin, btn.getAttribute('data-trade'));
    }, true);
  }

  window.SMHTrade = { open: openTrade, close: closeTrade };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupUi, { once: true });
  } else {
    setupUi();
  }
})();
