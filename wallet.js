// SolMemeHub — minimal Solana wallet adapter (no external libraries).
// Detects Phantom / Solflare / Backpack from window injections, opens a
// picker modal, persists only the wallet NAME (never a key), and
// exposes a tiny event-driven API on window.SMHWallet.
//
// Private keys are NEVER read or stored. Signing happens inside the
// wallet extension; we only call provider.connect() / signTransaction /
// signAndSendTransaction.

(function () {
  'use strict';

  var STORAGE_KEY = 'smh:wallet:last';

  var ADAPTERS = [
    {
      id: 'phantom',
      name: 'Phantom',
      installUrl: 'https://phantom.app/download',
      detect: function () {
        var p = window.phantom && window.phantom.solana;
        if (p) return p;
        var s = window.solana;
        return s && s.isPhantom ? s : null;
      }
    },
    {
      id: 'solflare',
      name: 'Solflare',
      installUrl: 'https://solflare.com/download',
      detect: function () {
        if (window.solflare) return window.solflare;
        var s = window.solana;
        return s && s.isSolflare ? s : null;
      }
    },
    {
      id: 'backpack',
      name: 'Backpack',
      installUrl: 'https://backpack.app/download',
      detect: function () {
        if (window.backpack && window.backpack.isBackpack) return window.backpack;
        var x = window.xnft && window.xnft.solana;
        if (x) return x;
        return null;
      }
    }
  ];

  var listeners = [];
  var state = {
    adapter: null,         // current adapter object
    provider: null,        // window-injected provider
    publicKey: null,       // PublicKey instance
    address: null          // base58 string
  };

  function emit() {
    var snap = {
      connected: !!state.publicKey,
      address: state.address,
      shortAddress: state.address ? shortAddr(state.address) : null,
      adapterId: state.adapter ? state.adapter.id : null,
      adapterName: state.adapter ? state.adapter.name : null
    };
    listeners.forEach(function (fn) { try { fn(snap); } catch (_e) {} });
  }

  function shortAddr(s) {
    s = String(s || '');
    return s.length > 12 ? s.slice(0, 4) + '…' + s.slice(-4) : s;
  }

  function detectInstalled() {
    return ADAPTERS.map(function (a) {
      return { adapter: a, provider: a.detect() };
    });
  }

  async function connect(adapterId, opts) {
    opts = opts || {};
    var entry = detectInstalled().find(function (e) { return e.adapter.id === adapterId; });
    if (!entry) throw new Error('Unknown adapter ' + adapterId);
    if (!entry.provider) {
      var err = new Error(entry.adapter.name + ' is not installed.');
      err.code = 'NOT_INSTALLED';
      err.installUrl = entry.adapter.installUrl;
      throw err;
    }
    var provider = entry.provider;
    try {
      var connectOpts = opts.onlyIfTrusted ? { onlyIfTrusted: true } : undefined;
      var resp = await provider.connect(connectOpts);
      var pk = (resp && resp.publicKey) || provider.publicKey;
      if (!pk) throw new Error('Wallet did not return a public key.');
      state.adapter = entry.adapter;
      state.provider = provider;
      state.publicKey = pk;
      state.address = pk.toString();
      try { localStorage.setItem(STORAGE_KEY, entry.adapter.id); } catch (_e) {}
      attachProviderListeners(provider);
      emit();
      return state.address;
    } catch (err) {
      if (err && (err.code === 4001 || /reject|denied|user|cancel/i.test(err.message || ''))) {
        err.code = 'USER_REJECTED';
      }
      throw err;
    }
  }

  function attachProviderListeners(provider) {
    if (!provider || typeof provider.on !== 'function') return;
    try {
      provider.on('disconnect', function () { handleDisconnect(); });
      provider.on('accountChanged', function (pk) {
        if (!pk) { handleDisconnect(); return; }
        state.publicKey = pk;
        state.address = pk.toString();
        emit();
      });
    } catch (_e) {}
  }

  async function disconnect() {
    try {
      if (state.provider && typeof state.provider.disconnect === 'function') {
        await state.provider.disconnect();
      }
    } catch (_e) {}
    handleDisconnect();
  }

  function handleDisconnect() {
    state.adapter = null;
    state.provider = null;
    state.publicKey = null;
    state.address = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_e) {}
    emit();
  }

  // Sign + send a Versioned/legacy transaction. Uses signAndSendTransaction
  // if the wallet supports it (Phantom does); otherwise signs locally then
  // sends via an injected Connection.
  async function signAndSend(tx, connection) {
    if (!state.provider || !state.publicKey) throw new Error('Wallet is not connected.');
    if (typeof state.provider.signAndSendTransaction === 'function') {
      var resp = await state.provider.signAndSendTransaction(tx);
      return resp.signature || resp;
    }
    if (typeof state.provider.signTransaction === 'function') {
      var signed = await state.provider.signTransaction(tx);
      var raw = signed.serialize();
      var sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
      return sig;
    }
    throw new Error('Wallet does not support transaction signing.');
  }

  // Live SOL balance via mainnet RPC (no key). Returns SOL as a Number.
  var RPC_BALANCE_URL = 'https://api.mainnet-beta.solana.com';
  async function fetchSolBalance() {
    if (!state.address) throw new Error('Wallet not connected.');
    var resp = await fetch(RPC_BALANCE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getBalance',
        params: [state.address, { commitment: 'confirmed' }]
      })
    });
    if (!resp.ok) throw new Error('RPC ' + resp.status);
    var j = await resp.json();
    if (j && j.error) throw new Error(j.error.message || 'RPC error');
    var lamports = j && j.result && (typeof j.result.value === 'number' ? j.result.value : j.result);
    if (!Number.isFinite(Number(lamports))) throw new Error('RPC: unexpected balance response');
    return Number(lamports) / 1e9;
  }

  // Best-effort silent reconnect on page load.
  async function autoReconnect() {
    var last;
    try { last = localStorage.getItem(STORAGE_KEY); } catch (_e) { last = null; }
    if (!last) return;
    try { await connect(last, { onlyIfTrusted: true }); } catch (_e) { /* ignore */ }
  }

  // Public API
  var api = {
    list: detectInstalled,
    connect: connect,
    disconnect: disconnect,
    signAndSend: signAndSend,
    getState: function () {
      return {
        connected: !!state.publicKey,
        adapter: state.adapter,
        adapterId: state.adapter ? state.adapter.id : null,
        adapterName: state.adapter ? state.adapter.name : null,
        provider: state.provider,
        publicKey: state.publicKey,
        address: state.address,
        shortAddress: state.address ? shortAddr(state.address) : null
      };
    },
    fetchSolBalance: fetchSolBalance,
    on: function (fn) { if (typeof fn === 'function') listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },
    shortAddr: shortAddr,
    adapters: ADAPTERS
  };
  window.SMHWallet = api;

  // ── UI wiring ────────────────────────────────────────────────────
  function setupUi() {
    var btn = document.getElementById('wallet-connect-btn');
    var modal = document.getElementById('wallet-modal');
    var list = document.getElementById('wallet-list');
    if (!btn || !modal || !list) return;

    function paint(snap) {
      var label = btn.querySelector('.wallet-label');
      var dot = btn.querySelector('.wallet-dot');
      if (snap.connected) {
        btn.classList.add('is-connected');
        if (label) label.textContent = snap.shortAddress;
        if (dot) dot.classList.add('is-on');
        btn.setAttribute('title', snap.address + ' (' + snap.adapterName + ') — click to disconnect');
      } else {
        btn.classList.remove('is-connected');
        if (label) label.textContent = 'Connect Wallet';
        if (dot) dot.classList.remove('is-on');
        btn.removeAttribute('title');
      }
    }
    api.on(paint);
    paint(api.getState());

    function openModal() {
      list.innerHTML = api.list().map(function (e) {
        var installed = !!e.provider;
        return '<li><button class="wallet-option" type="button" data-wallet="' + e.adapter.id + '">'
          + '<span class="wallet-option-name">' + e.adapter.name + '</span>'
          + '<span class="wallet-option-tag">' + (installed ? 'Detected' : '<a href="' + e.adapter.installUrl + '" target="_blank" rel="noopener noreferrer">Install</a>') + '</span>'
          + '</button></li>';
      }).join('');
      modal.hidden = false;
      modal.setAttribute('aria-hidden', 'false');
    }
    function closeModal() {
      modal.hidden = true;
      modal.setAttribute('aria-hidden', 'true');
    }

    btn.addEventListener('click', function () {
      if (api.getState().connected) {
        openDetails();
        return;
      }
      openModal();
    });

    modal.addEventListener('click', function (event) {
      var t = event.target;
      if (t && t.matches && t.matches('[data-modal-close]')) { closeModal(); return; }
      var opt = t && t.closest && t.closest('[data-wallet]');
      if (!opt) return;
      var id = opt.getAttribute('data-wallet');
      api.connect(id).then(function () { closeModal(); }).catch(function (err) {
        if (err && err.code === 'NOT_INSTALLED') {
          if (confirm(err.message + ' Open install page?')) window.open(err.installUrl, '_blank', 'noopener');
        } else if (err && err.code === 'USER_REJECTED') {
          // silent — user cancelled the wallet popup
        } else {
          alert('Wallet connect failed: ' + (err && err.message ? err.message : err));
        }
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) closeModal();
    });

    // ── Wallet details modal ───────────────────────────────────────
    var detailsModal = document.getElementById('wallet-details-modal');
    var dAdapter    = document.getElementById('wallet-details-adapter');
    var dAddress    = document.getElementById('wallet-details-address');
    var dBalance    = document.getElementById('wallet-details-balance');
    var copyBtn     = document.getElementById('wallet-copy-btn');
    var refreshBtn  = document.getElementById('wallet-refresh-btn');
    var disconBtn   = document.getElementById('wallet-disconnect-btn');

    function paintDetails(snap) {
      if (!detailsModal) return;
      if (!snap.connected) { closeDetails(); return; }
      if (dAdapter) dAdapter.textContent = snap.adapterName || '—';
      if (dAddress) { dAddress.textContent = snap.address || '—'; dAddress.title = snap.address || ''; }
    }

    async function loadBalance() {
      if (!dBalance) return;
      dBalance.textContent = 'Loading…';
      try {
        var sol = await fetchSolBalance();
        dBalance.textContent = (Math.round(sol * 10000) / 10000).toFixed(4) + ' SOL';
      } catch (err) {
        dBalance.textContent = 'Unavailable (' + (err && err.message ? err.message : 'rpc error') + ')';
      }
    }

    function openDetails() {
      if (!detailsModal) return;
      paintDetails(api.getState());
      detailsModal.hidden = false;
      detailsModal.setAttribute('aria-hidden', 'false');
      loadBalance();
    }
    function closeDetails() {
      if (!detailsModal) return;
      detailsModal.hidden = true;
      detailsModal.setAttribute('aria-hidden', 'true');
    }

    if (detailsModal) {
      detailsModal.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.matches && t.matches('[data-modal-close]')) closeDetails();
      });
    }

    if (copyBtn) copyBtn.addEventListener('click', function () {
      var addr = api.getState().address;
      if (!addr) return;
      var done = function () { copyBtn.textContent = 'Copied'; setTimeout(function () { copyBtn.textContent = 'Copy address'; }, 1400); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(addr).then(done, function () { window.prompt('Copy address:', addr); });
      } else {
        window.prompt('Copy address:', addr);
      }
    });
    if (refreshBtn) refreshBtn.addEventListener('click', loadBalance);
    if (disconBtn)  disconBtn.addEventListener('click', function () {
      api.disconnect().finally(closeDetails);
    });

    api.on(function (snap) {
      // Live-paint the open details modal on account/disconnect events.
      if (detailsModal && !detailsModal.hidden) paintDetails(snap);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && detailsModal && !detailsModal.hidden) closeDetails();
    });

    // attempt silent reconnect after providers have time to inject
    setTimeout(function () { api.autoReconnect ? api.autoReconnect() : autoReconnect(); }, 400);
  }
  api.autoReconnect = autoReconnect;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupUi, { once: true });
  } else {
    setupUi();
  }
})();
