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
  var CONSENT_KEY_PREFIX = 'smh:consent:';
  var CONSENT_DOMAIN = 'solmemehub.tech';
  var RPC_URLS = [
    'https://solana-rpc.publicnode.com',
    'https://api.mainnet-beta.solana.com'
  ];
  var TOKEN_RPC_URLS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-rpc.publicnode.com'
  ];
  var TOKEN_PROGRAMS = [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
  ];
  var JUP_PRICE_URL = 'https://lite-api.jup.ag/price/v3?ids=';
  var JUP_QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
  var JUP_SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';
  var WALLET_PORTFOLIO_ENDPOINT = 'https://solmemehub-kolscan-proxy.solmemehub.workers.dev/api/wallet/portfolio/';
  var SOL_MINT = 'So11111111111111111111111111111111111111112';
  var TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  var TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  var metadataCache = null;
  var lastRpcUrl = null;
  var previousTokenValues = Object.create(null);

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
    address: null,         // base58 string
    consent: null,         // { address, signatureHex, nonce, timestamp, domain }
    consentPending: false  // true while a signMessage prompt is open
  };

  function bytesToHex(u8) {
    var out = '';
    for (var i = 0; i < u8.length; i += 1) {
      var h = u8[i].toString(16);
      out += h.length === 1 ? '0' + h : h;
    }
    return out;
  }

  function loadStoredConsent(address) {
    if (!address) return null;
    try {
      var raw = localStorage.getItem(CONSENT_KEY_PREFIX + address);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (!obj || obj.address !== address || obj.domain !== CONSENT_DOMAIN) return null;
      if (!obj.signatureHex || !obj.nonce || !obj.timestamp) return null;
      return obj;
    } catch (_e) { return null; }
  }
  function storeConsent(consent) {
    try { localStorage.setItem(CONSENT_KEY_PREFIX + consent.address, JSON.stringify(consent)); } catch (_e) {}
  }
  function clearStoredConsent(address) {
    try { localStorage.removeItem(CONSENT_KEY_PREFIX + address); } catch (_e) {}
  }
  function consentSigned() {
    return !!(state.consent && state.address && state.consent.address === state.address);
  }

  function emit() {
    var snap = {
      connected: !!state.publicKey,
      address: state.address,
      shortAddress: state.address ? shortAddr(state.address) : null,
      adapterId: state.adapter ? state.adapter.id : null,
      adapterName: state.adapter ? state.adapter.name : null,
      consentSigned: consentSigned(),
      consentPending: !!state.consentPending
    };
    listeners.forEach(function (fn) { try { fn(snap); } catch (_e) {} });
  }

  function shortAddr(s) {
    s = String(s || '');
    return s.length > 12 ? s.slice(0, 4) + '…' + s.slice(-4) : s;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtAmount(value, max) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString(undefined, { maximumFractionDigits: max == null ? 6 : max });
  }
  function fmtUsd(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return '';
    return '$' + n.toLocaleString(undefined, { minimumFractionDigits: n >= 1 ? 2 : 4, maximumFractionDigits: n >= 1 ? 2 : 6 });
  }
  function lamportsToUiAmount(raw, decimals) {
    if (raw == null) return NaN;
    var text = String(raw);
    if (!/^\d+$/.test(text)) return NaN;
    var places = Math.max(0, Number(decimals) || 0);
    if (!places) return Number(text);
    while (text.length <= places) text = '0' + text;
    var whole = text.slice(0, text.length - places) || '0';
    var frac = text.slice(text.length - places).replace(/0+$/, '');
    return Number(whole + (frac ? '.' + frac : ''));
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
      state.consent = loadStoredConsent(state.address); // restore prior consent for this wallet, if any
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
        state.consent = loadStoredConsent(state.address); // wallet changed → re-check
        emit();
      });
    } catch (_e) {}
  }

  async function disconnect() {
    var provider = state.provider;
    var address = state.address;
    handleDisconnect();
    if (address) clearStoredConsent(address);
    try {
      if (provider && typeof provider.disconnect === 'function') {
        await provider.disconnect();
      }
    } catch (_e) {}
  }

  function handleDisconnect() {
    var address = state.address;
    state.adapter = null;
    state.provider = null;
    state.publicKey = null;
    state.address = null;
    state.consent = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch (_e) {}
    if (address) clearStoredConsent(address);
    emit();
  }

  // Ask the wallet to sign a one-time human-readable consent message.
  // Does NOT sign or send any transaction; signMessage is a pure
  // off-chain attestation. The signature bytes are stored as proof of
  // intent, keyed by the wallet address and the SolMemeHub domain.
  async function signConsent() {
    if (!state.provider || !state.address) throw new Error('Wallet is not connected.');
    if (typeof state.provider.signMessage !== 'function') {
      throw new Error(state.adapter.name + ' does not support message signing.');
    }
    if (state.consentPending) {
      // Another consent prompt is already in flight — Phantom/Solflare
      // serialize prompts so a duplicate would queue up. Refuse cleanly.
      var e = new Error('Consent prompt already open.'); e.code = 'CONSENT_PENDING'; throw e;
    }
    state.consentPending = true;
    emit();
    var nonce = (function () {
      try {
        var buf = new Uint8Array(16);
        crypto.getRandomValues(buf);
        return bytesToHex(buf);
      } catch (_e) { return String(Date.now()) + Math.floor(Math.random() * 1e9).toString(16); }
    })();
    var ts = new Date().toISOString();
    var message =
      'SolMemeHub wallet consent\n\n' +
      'I confirm that I want to connect this wallet to SolMemeHub.\n\n' +
      'This signature does not execute a transaction.\n' +
      'This signature does not give permission to move funds.\n' +
      'Each buy or sell still requires a separate wallet confirmation.\n\n' +
      'Wallet: '   + state.address + '\n' +
      'Domain: '   + CONSENT_DOMAIN + '\n' +
      'Timestamp: ' + ts + '\n' +
      'Nonce: '    + nonce;
    var bytes = new TextEncoder().encode(message);
    try {
      var resp;
      try {
        // Phantom + Solflare: signMessage(uint8array, 'utf8'). Backpack: signMessage(uint8array).
        resp = await state.provider.signMessage(bytes, 'utf8');
      } catch (err) {
        if (err && (err.code === 4001 || /reject|denied|user|cancel/i.test(err.message || ''))) {
          var e = new Error('User rejected consent signature.'); e.code = 'USER_REJECTED'; throw e;
        }
        throw err;
      }
      var sigBytes = resp && (resp.signature || resp) ;
      if (sigBytes && sigBytes.signature) sigBytes = sigBytes.signature;
      if (!sigBytes || typeof sigBytes.length !== 'number') throw new Error('Wallet returned no signature.');
      var consent = {
        address:     state.address,
        adapterId:   state.adapter && state.adapter.id,
        domain:      CONSENT_DOMAIN,
        nonce:       nonce,
        timestamp:   ts,
        messagePreview: message.split('\n').slice(0, 1)[0],
        signatureHex: bytesToHex(sigBytes instanceof Uint8Array ? sigBytes : new Uint8Array(sigBytes))
      };
      state.consent = consent;
      storeConsent(consent);
      return consent;
    } finally {
      state.consentPending = false;
      emit();
    }
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

  async function rpcRequest(payload, urls) {
    var lastError = null;
    var list = urls || RPC_URLS;
    for (var i = 0; i < list.length; i += 1) {
      var url = list[i];
      try {
        var resp = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error('RPC ' + resp.status);
        var json = await resp.json();
        if (json && json.error) throw new Error(json.error.message || 'RPC error');
        lastRpcUrl = url;
        return json.result;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('RPC unavailable');
  }

  async function fetchSolBalance() {
    if (!state.address) throw new Error('Wallet not connected.');
    var result = await rpcRequest({
      jsonrpc: '2.0', id: 1, method: 'getBalance',
      params: [state.address, { commitment: 'confirmed' }]
    });
    var lamports = result && (typeof result.value === 'number' ? result.value : result);
    if (!Number.isFinite(Number(lamports))) throw new Error('RPC: unexpected balance response');
    return Number(lamports) / 1e9;
  }

  async function fetchParsedTokenAccounts(programId, index) {
    var errors = [];
    if (window.solanaWeb3 && window.solanaWeb3.Connection && window.solanaWeb3.PublicKey) {
      for (var i = 0; i < TOKEN_RPC_URLS.length; i += 1) {
        try {
          var connection = new window.solanaWeb3.Connection(TOKEN_RPC_URLS[i], 'confirmed');
          var result = await connection.getParsedTokenAccountsByOwner(
            new window.solanaWeb3.PublicKey(state.address),
            { programId: new window.solanaWeb3.PublicKey(programId) },
            'confirmed'
          );
          lastRpcUrl = TOKEN_RPC_URLS[i];
          return (result && result.value) || [];
        } catch (err) {
          errors.push(err && err.message ? err.message : String(err));
        }
      }
    }
    try {
      var fallback = await rpcRequest({
        jsonrpc: '2.0', id: 'tokens-' + index, method: 'getTokenAccountsByOwner',
        params: [
          state.address,
          { programId: programId },
          { encoding: 'jsonParsed', commitment: 'confirmed' }
        ]
      }, TOKEN_RPC_URLS);
      return (fallback && fallback.value) || [];
    } catch (err2) {
      errors.push(err2 && err2.message ? err2.message : String(err2));
    }
    throw new Error(errors.filter(Boolean).slice(-2).join(' | ') || 'token account RPC failed');
  }

  async function fetchTokenAccounts() {
    if (!state.address) throw new Error('Wallet not connected.');
    var all = [];
    var errors = [];
    for (var i = 0; i < TOKEN_PROGRAMS.length; i += 1) {
      try {
        all = all.concat(await fetchParsedTokenAccounts(TOKEN_PROGRAMS[i], i));
      } catch (err) {
        errors.push(err && err.message ? err.message : String(err));
      }
    }
    if (!all.length && errors.length === TOKEN_PROGRAMS.length) {
      throw new Error('Token balances unavailable: ' + errors.join(' | '));
    }
    return all.map(function (entry) {
      var info = entry && entry.account && entry.account.data && entry.account.data.parsed && entry.account.data.parsed.info;
      var amount = info && info.tokenAmount;
      var rawAmount = amount && amount.amount != null ? String(amount.amount) : '0';
      var uiAmount = Number(amount && amount.uiAmountString);
      if (!Number.isFinite(uiAmount)) uiAmount = Number(amount && amount.uiAmount);
      if (!Number.isFinite(uiAmount)) uiAmount = lamportsToUiAmount(rawAmount, amount && amount.decimals);
      return {
        mint: info && info.mint,
        amount: uiAmount,
        rawAmount: rawAmount,
        decimals: amount && amount.decimals,
        state: info && info.state,
        owner: info && info.owner,
        tokenProgram: entry && entry.account && entry.account.owner && entry.account.owner.toString ? entry.account.owner.toString() : entry && entry.account && entry.account.owner,
        account: entry && entry.pubkey && entry.pubkey.toString ? entry.pubkey.toString() : entry && entry.pubkey
      };
    }).filter(function (token) {
      return token.mint && token.rawAmount !== '0' && Number.isFinite(token.amount);
    }).filter(function (token, index, list) {
      var key = token.account || token.mint;
      return list.findIndex(function (item) { return (item.account || item.mint) === key; }) === index;
    }).sort(function (a, b) { return b.amount - a.amount; });
  }

  async function loadLocalMetadata() {
    if (metadataCache) return metadataCache;
    metadataCache = Object.create(null);
    function ingest(item) {
      if (!item) return;
      var mint = item.mint || item.address || item.contract || item.tokenAddress;
      if (!mint) return;
      metadataCache[mint] = {
        name: item.name || item.tokenName || item.title || 'SPL Token',
        symbol: String(item.symbol || item.ticker || '').replace(/^\$/, '').toUpperCase() || shortAddr(mint),
        imageUrl: item.imageUrl || item.image || item.logo || item.icon || '',
        url: item.url || item.href || item.pumpfunUrl || item.fallbackUrl || ('https://solscan.io/token/' + mint)
      };
    }
    try {
      var meme = await fetch('./meme-coins.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; });
      [].concat(meme && meme.dailyRadar || [], meme && meme.trending || [], meme && meme.highCap || [], meme && meme.highcap || [], meme && meme.lowCap || [], meme && meme.lowcap || [], meme && meme.coins || [], Array.isArray(meme) ? meme : []).forEach(ingest);
    } catch (_e) {}
    try {
      var tokens = await fetch('./tokens.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; });
      [].concat(tokens && tokens.tokens || [], tokens && tokens.pages || [], Array.isArray(tokens) ? tokens : []).forEach(ingest);
    } catch (_e2) {}
    return metadataCache;
  }

  async function fetchTokenPrices(mints) {
    var prices = Object.create(null);
    var ids = mints.filter(Boolean).slice(0, 50);
    if (!ids.length) return prices;
    try {
      var data = await fetch(JUP_PRICE_URL + ids.map(encodeURIComponent).join(','), { headers: { accept: 'application/json' }, cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; });
      ids.forEach(function (mint) {
        var item = data && data[mint];
        var price = item && Number(item.usdPrice || item.price);
        if (Number.isFinite(price)) prices[mint] = price;
      });
    } catch (_e) {}
    return prices;
  }

  function normalizeIndexedToken(token) {
    var mint = token && (token.mint || token.address);
    if (!mint) return null;
    var amount = Number(token.amount != null ? token.amount : token.balance);
    if (!(amount > 0)) return null;
    return {
      mint: mint,
      amount: amount,
      decimals: token.decimals,
      rawAmount: token.rawAmount != null ? String(token.rawAmount) : null,
      account: token.account || token.tokenAccount || null,
      tokenProgram: token.tokenProgram || null,
      state: token.state || null,
      name: token.name || shortAddr(mint),
      symbol: String(token.symbol || '').replace(/^\$/, '').toUpperCase() || shortAddr(mint),
      imageUrl: token.imageUrl || token.image || '',
      url: token.url || ('https://solscan.io/token/' + mint),
      usdValue: Number.isFinite(Number(token.usdValue != null ? token.usdValue : token.value)) ? Number(token.usdValue != null ? token.usdValue : token.value) : null,
      changeUsd: Number.isFinite(Number(token.changeUsd)) ? Number(token.changeUsd) : null,
      changePercent: Number.isFinite(Number(token.changePercent)) ? Number(token.changePercent) : null
    };
  }

  async function fetchIndexedWalletPortfolio() {
    if (!state.address) throw new Error('Wallet not connected.');
    var resp = await fetch(WALLET_PORTFOLIO_ENDPOINT + encodeURIComponent(state.address), {
      headers: { accept: 'application/json' },
      cache: 'no-store'
    });
    var payload = await resp.json().catch(function () { return null; });
    if (!resp.ok || !payload || payload.ok === false) {
      var message = payload && (payload.message || payload.error || payload.upstreamBodyExcerpt);
      throw new Error(message || ('Wallet portfolio API ' + resp.status));
    }
    var data = payload.data || {};
    var tokens = (Array.isArray(data.tokens) ? data.tokens : []).map(normalizeIndexedToken).filter(Boolean).sort(function (a, b) {
      var av = Number.isFinite(a.usdValue) ? a.usdValue : null;
      var bv = Number.isFinite(b.usdValue) ? b.usdValue : null;
      if (av !== null || bv !== null) return (bv || 0) - (av || 0);
      return b.amount - a.amount;
    });
    return {
      sol: Number(data.sol && data.sol.amount),
      solUsdValue: Number.isFinite(Number(data.sol && data.sol.usdValue)) ? Number(data.sol.usdValue) : null,
      tokens: tokens,
      tokenError: null,
      rpcUrl: payload.source || 'solana-tracker',
      updatedAt: Date.now()
    };
  }

  async function fetchWalletPortfolio() {
    try {
      var indexed = await fetchIndexedWalletPortfolio();
      try {
        var chain = await fetchTokenAccounts();
        var byMint = Object.create(null);
        chain.forEach(function (token) { if (!byMint[token.mint]) byMint[token.mint] = token; });
        indexed.tokens = indexed.tokens.map(function (token) {
          var live = byMint[token.mint];
          return live ? Object.assign({}, token, {
            amount: live.amount,
            rawAmount: live.rawAmount,
            decimals: live.decimals,
            account: live.account,
            tokenProgram: live.tokenProgram,
            state: live.state,
            owner: live.owner
          }) : token;
        });
      } catch (_chainErr) {}
      return indexed;
    } catch (err) {
      try {
        var accounts = await fetchTokenAccounts();
        var meta = await loadLocalMetadata();
        var prices = await fetchTokenPrices(accounts.map(function (token) { return token.mint; }));
        return {
          sol: await fetchSolBalance().catch(function () { return NaN; }),
          solUsdValue: null,
          tokens: accounts.map(function (token) {
            var item = meta[token.mint] || {};
            var price = prices[token.mint];
            return Object.assign({}, token, {
              name: item.name || shortAddr(token.mint),
              symbol: item.symbol || shortAddr(token.mint),
              imageUrl: item.imageUrl || '',
              url: item.url || ('https://solscan.io/token/' + token.mint),
              usdValue: Number.isFinite(price) ? price * token.amount : null
            });
          }),
          tokenError: null,
          rpcUrl: lastRpcUrl || 'public rpc',
          updatedAt: Date.now()
        };
      } catch (fallbackErr) {
        throw new Error('Wallet portfolio unavailable: ' + (fallbackErr && fallbackErr.message ? fallbackErr.message : err && err.message ? err.message : err));
      }
    }
  }

  function isValidMint(s) {
    return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
  }

  function solscanTx(signature) {
    return 'https://solscan.io/tx/' + encodeURIComponent(signature);
  }

  function rawAmountToUi(rawAmount, decimals) {
    return lamportsToUiAmount(rawAmount, decimals);
  }

  async function getJupiterSellQuote(token) {
    if (!token || !isValidMint(token.mint)) throw new Error('Token mint is invalid.');
    if (!/^\d+$/.test(String(token.rawAmount || ''))) throw new Error('Live raw token balance is required before selling.');
    if (String(token.rawAmount) === '0') throw new Error('Token balance is already zero.');
    if (String(token.state || '').toLowerCase() === 'frozen') throw new Error('Token account is frozen. Sell All is blocked.');
    var url = JUP_QUOTE_URL
      + '?inputMint=' + encodeURIComponent(token.mint)
      + '&outputMint=' + encodeURIComponent(SOL_MINT)
      + '&amount=' + encodeURIComponent(String(token.rawAmount))
      + '&slippageBps=100';
    var resp = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
    if (!resp.ok) {
      var body = await resp.text();
      throw new Error('Jupiter quote ' + resp.status + ': ' + body.slice(0, 200));
    }
    var quote = await resp.json();
    if (!quote || !quote.outAmount) throw new Error('Jupiter returned no sell quote.');
    return quote;
  }

  async function confirmSignature(connection, signature) {
    var latest = await connection.getLatestBlockhash('confirmed');
    var confirmation = await connection.confirmTransaction({
      signature: signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight
    }, 'confirmed');
    if (!confirmation || !confirmation.value) throw new Error('Transaction confirmation returned no result.');
    if (confirmation.value.err) throw new Error('Transaction failed on-chain: ' + JSON.stringify(confirmation.value.err));
    return confirmation;
  }

  async function fetchTokenAccountRawAmount(account) {
    var result = await rpcRequest({
      jsonrpc: '2.0', id: 'token-account-check', method: 'getTokenAccountBalance',
      params: [account, { commitment: 'confirmed' }]
    }, TOKEN_RPC_URLS);
    return result && result.value && result.value.amount != null ? String(result.value.amount) : null;
  }

  async function closeEmptyTokenAccount(token, connection) {
    if (!window.solanaWeb3) throw new Error('Solana web3 library failed to load.');
    if (!token.account) throw new Error('Rent reclaim blocked: token account address is missing.');
    if (token.tokenProgram !== TOKEN_PROGRAM_ID) {
      if (token.tokenProgram === TOKEN_2022_PROGRAM_ID) {
        throw new Error('Rent reclaim blocked: Token-2022 close-account support requires extension-aware handling.');
      }
      throw new Error('Rent reclaim blocked: unsupported token program ' + (token.tokenProgram || 'unknown') + '.');
    }
    var remaining = await fetchTokenAccountRawAmount(token.account);
    if (remaining !== '0') throw new Error('Rent reclaim blocked: token account balance is not zero.');

    var wallet = api.getState();
    var tokenProgram = new window.solanaWeb3.PublicKey(TOKEN_PROGRAM_ID);
    var tokenAccount = new window.solanaWeb3.PublicKey(token.account);
    var owner = new window.solanaWeb3.PublicKey(wallet.address);
    var closeIx = new window.solanaWeb3.TransactionInstruction({
      programId: tokenProgram,
      keys: [
        { pubkey: tokenAccount, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false }
      ],
      data: new Uint8Array([9])
    });
    var latest = await connection.getLatestBlockhash('confirmed');
    var tx = new window.solanaWeb3.Transaction({
      feePayer: owner,
      recentBlockhash: latest.blockhash
    }).add(closeIx);
    var sig = await signAndSend(tx, connection);
    await confirmSignature(connection, sig);
    return sig;
  }

  async function executeSellAll(token, quote, onStatus) {
    if (!window.solanaWeb3) throw new Error('Solana web3 library failed to load.');
    if (!consentSigned()) throw new Error('Wallet authentication is required before selling.');
    var wallet = api.getState();
    if (!wallet.connected || !wallet.address) throw new Error('Wallet is not connected.');
    var connection = new window.solanaWeb3.Connection(RPC_URLS[0], 'confirmed');
    onStatus('info', 'Building Jupiter sell transaction...');
    var swapResp = await fetch(JUP_SWAP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.address,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto'
      })
    });
    if (!swapResp.ok) {
      var body = await swapResp.text();
      throw new Error('Jupiter swap ' + swapResp.status + ': ' + body.slice(0, 200));
    }
    var swap = await swapResp.json();
    if (!swap.swapTransaction) throw new Error('Jupiter returned no swap transaction.');
    var swBytes = atob(swap.swapTransaction);
    var raw = new Uint8Array(swBytes.length);
    for (var i = 0; i < swBytes.length; i += 1) raw[i] = swBytes.charCodeAt(i);
    var tx = window.solanaWeb3.VersionedTransaction.deserialize(raw);

    onStatus('info', 'Awaiting wallet approval...');
    var sellSig = await signAndSend(tx, connection);
    onStatus('info', 'Sell submitted. Confirming on-chain...', solscanTx(sellSig));
    await confirmSignature(connection, sellSig);

    var closeSig = null;
    var closeBlocked = '';
    try {
      onStatus('info', 'Sell confirmed. Checking token account for rent reclaim...', solscanTx(sellSig));
      closeSig = await closeEmptyTokenAccount(token, connection);
    } catch (closeErr) {
      closeBlocked = closeErr && closeErr.message ? closeErr.message : String(closeErr);
    }
    return { sellSignature: sellSig, closeSignature: closeSig, closeBlocked: closeBlocked };
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
        shortAddress: state.address ? shortAddr(state.address) : null,
        consentSigned: consentSigned(),
        consent: state.consent ? {
          address: state.consent.address,
          domain: state.consent.domain,
          timestamp: state.consent.timestamp,
          nonce: state.consent.nonce
        } : null
      };
    },
    signConsent: signConsent,
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
      btn.classList.toggle('is-connected', !!snap.connected);
      btn.classList.toggle('is-pending', !!snap.consentPending);
      btn.classList.toggle('is-consent-required', !!(snap.connected && !snap.consentSigned && !snap.consentPending));
      if (snap.connected) {
        if (snap.consentPending) {
          if (label) label.textContent = 'Authenticating…';
        } else if (!snap.consentSigned) {
          if (label) label.textContent = 'Wallet';
        } else {
          if (label) label.textContent = 'Wallet';
        }
        if (dot) dot.classList.add('is-on');
        btn.setAttribute('title', snap.address + ' (' + snap.adapterName + ')'
          + (snap.consentSigned ? ' — click for wallet menu' : ' — consent required'));
      } else {
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
      api.connect(id).then(function () {
        closeModal();
        var snap = api.getState();
        if (snap.connected && !snap.consentSigned && !snap.consentPending) {
          try {
            var hint = document.createElement('div');
            hint.textContent = 'Wallet connected. Click Authenticate before trading.';
            hint.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:200;padding:10px 16px;border:1px solid rgba(255,200,77,.55);background:rgba(255,200,77,.08);color:#ffcf5a;font-size:13px;font-weight:800;max-width:560px;text-align:center';
            document.body.appendChild(hint);
            setTimeout(function () { hint.remove(); }, 6000);
          } catch (_e) {}
        }
      }).catch(function (err) {
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
    var dUsd        = document.getElementById('wallet-details-usd');
    var dConsent    = document.getElementById('wallet-details-consent');
    var dNetwork    = document.getElementById('wallet-mainnet-status');
    var tokenCount  = document.getElementById('wallet-token-count');
    var tokenList   = document.getElementById('wallet-token-list');
    var solscanLink = document.getElementById('wallet-solscan-link');
    var consentBtn  = document.getElementById('wallet-consent-btn');
    var disconBtn   = document.getElementById('wallet-disconnect-btn');
    var currentPortfolioTokens = [];
    var sellAllBusy = false;
    var sellAllModal = null;
    var sellAllEls = null;

    function paintDetails(snap) {
      if (!detailsModal) return;
      if (!snap.connected) { closeDetails(); return; }
      if (dAdapter) dAdapter.textContent = snap.adapterName || '—';
      if (dAddress) {
        dAddress.innerHTML = escapeHtml(snap.shortAddress || shortAddr(snap.address) || '—') + ' <span aria-hidden="true">⧉</span>';
        dAddress.title = snap.address || 'Copy wallet address';
        dAddress.setAttribute('data-address', snap.address || '');
      }
      if (dConsent) {
        dConsent.textContent = snap.consentSigned ? 'Authenticated' : 'Required';
        dConsent.className = 'wallet-status-pill consent-state ' + (snap.consentSigned ? 'is-ok' : 'is-warn');
      }
      if (dNetwork) dNetwork.textContent = 'Solana Mainnet';
      if (solscanLink && snap.address) solscanLink.href = 'https://solscan.io/account/' + encodeURIComponent(snap.address) + '#portfolio';
      if (consentBtn) {
        consentBtn.hidden = !!snap.consentSigned;
      }
    }

    function tokenAvatar(token) {
      var symbol = String(token.symbol || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
      if (token.imageUrl) {
        return '<span class="wallet-token-avatar"><img src="' + escapeHtml(token.imageUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();"></span>';
      }
      return '<span class="wallet-token-avatar wallet-token-fallback">' + escapeHtml(symbol) + '</span>';
    }

    function renderTokens(tokens) {
      if (!tokenList || !tokenCount) return;
      tokenCount.textContent = tokens.length + (tokens.length === 1 ? ' Token' : ' Tokens');
      if (!tokens.length) {
        currentPortfolioTokens = [];
        tokenList.innerHTML = '<div class="wallet-token-empty">No SPL token balances found.</div>';
        return;
      }
      var nextValues = Object.create(null);
      currentPortfolioTokens = tokens.slice();
      tokenList.innerHTML = tokens.map(function (token, index) {
        var mintLabel = shortAddr(token.mint);
        var valueTone = ' value-neutral';
        if (Number.isFinite(token.changeUsd) && token.changeUsd !== 0) valueTone = token.changeUsd > 0 ? ' value-up' : ' value-down';
        else if (Number.isFinite(token.changePercent) && token.changePercent !== 0) valueTone = token.changePercent > 0 ? ' value-up' : ' value-down';
        else if (Number.isFinite(token.usdValue) && Number.isFinite(previousTokenValues[token.mint]) && token.usdValue !== previousTokenValues[token.mint]) {
          valueTone = token.usdValue > previousTokenValues[token.mint] ? ' value-up' : ' value-down';
        }
        if (Number.isFinite(token.usdValue)) nextValues[token.mint] = token.usdValue;
        // NEVER ship a hard-disabled Sell All button: silently-disabled
        // buttons swallow the click and the user sees no feedback. Always
        // render enabled; the click handler does just-in-time recovery
        // (associated-account lookup + getTokenAccountBalance) and only
        // surfaces a disabled message via the modal if recovery fails.
        return '<div class="wallet-token-row">' +
          tokenAvatar(token) +
          '<span class="wallet-token-meta"><strong>' + escapeHtml(token.name || token.symbol || mintLabel) + '</strong>' +
            '<span class="wallet-token-contract"><button class="wallet-token-mint" type="button" data-mint="' + escapeHtml(token.mint) + '" title="Copy contract address">' + escapeHtml(mintLabel) + ' <span aria-hidden="true">⧉</span></button>' +
            '<a class="wallet-token-solscan" href="' + escapeHtml(token.url) + '" target="_blank" rel="noopener noreferrer" title="Open on Solscan">↗</a></span></span>' +
          '<span class="wallet-token-amount"><strong>' + escapeHtml(fmtAmount(token.amount, 6)) + '</strong>' +
            (Number.isFinite(token.usdValue) ? '<small class="' + valueTone.trim() + '">' + escapeHtml(fmtUsd(token.usdValue)) + '</small>' : '') +
          '</span><button class="wallet-token-sell-all" type="button" data-token-index="' + index + '" title="Sell full balance to SOL">Sell All</button></div>';
      }).join('');
      previousTokenValues = nextValues;
    }

    // ── Portfolio cache + background hydration ───────────────────────
    // Persist the last successful portfolio per wallet address so a
    // reconnect/refresh paints SOL + token rows instantly while a fresh
    // fetch runs in the background.
    var PORTFOLIO_CACHE_PREFIX = 'smh:portfolio:';
    var portfolioFetchInFlight = null;     // de-duplicates concurrent refreshes
    var portfolioRefreshTimer = null;       // throttle (>=800ms gap)
    var portfolioLastFetchAt = 0;
    var portfolioPaintedAddress = '';       // last address actually painted into the DOM

    function loadCachedPortfolio(address) {
      if (!address) return null;
      try {
        var raw = localStorage.getItem(PORTFOLIO_CACHE_PREFIX + address);
        if (!raw) return null;
        var obj = JSON.parse(raw);
        if (!obj || obj.address !== address) return null;
        return obj;
      } catch (_e) { return null; }
    }
    function saveCachedPortfolio(address, portfolio) {
      if (!address || !portfolio) return;
      try {
        var snapshot = {
          address: address,
          ts: Date.now(),
          sol: portfolio.sol,
          solUsdValue: portfolio.solUsdValue,
          rpcUrl: portfolio.rpcUrl,
          tokens: Array.isArray(portfolio.tokens) ? portfolio.tokens : [],
          tokenError: portfolio.tokenError ? String(portfolio.tokenError.message || portfolio.tokenError) : ''
        };
        localStorage.setItem(PORTFOLIO_CACHE_PREFIX + address, JSON.stringify(snapshot));
      } catch (_e) {}
    }
    function clearCachedPortfolio(address) {
      if (!address) return;
      try { localStorage.removeItem(PORTFOLIO_CACHE_PREFIX + address); } catch (_e) {}
    }

    function paintPortfolio(address, portfolio) {
      if (!address || !portfolio) return;
      // Guard: if the active wallet has changed since this paint was
      // scheduled, drop the result on the floor. NEVER show another
      // wallet's cached data.
      var live = api.getState();
      if (!live.connected || live.address !== address) return;
      if (dBalance) dBalance.textContent = Number.isFinite(portfolio.sol) ? fmtAmount(portfolio.sol, 4) + ' SOL' : 'Unavailable';
      if (dUsd) dUsd.textContent = Number.isFinite(portfolio.solUsdValue) ? fmtUsd(portfolio.solUsdValue) + ' USD' : '';
      if (portfolio.tokenError) {
        if (tokenCount) tokenCount.textContent = 'Unavailable';
        if (tokenList) tokenList.innerHTML = '<div class="wallet-token-empty">Token holdings unavailable. ' + escapeHtml(portfolio.tokenError.message || portfolio.tokenError) + '</div>';
      } else {
        renderTokens(portfolio.tokens || []);
      }
      if (dNetwork) dNetwork.textContent = portfolio.rpcUrl && portfolio.rpcUrl.indexOf('publicnode') !== -1 ? 'Solana Mainnet' : 'Solana Mainnet';
      portfolioPaintedAddress = address;
    }

    function hydrateFromCache() {
      var live = api.getState();
      if (!live.connected || !live.address) return false;
      if (portfolioPaintedAddress === live.address) return true;
      var cached = loadCachedPortfolio(live.address);
      if (!cached) return false;
      paintPortfolio(live.address, cached);
      return true;
    }

    function refreshPortfolio(opts) {
      opts = opts || {};
      var live = api.getState();
      if (!live.connected || !live.address) return Promise.resolve(null);
      var address = live.address;
      // De-dupe: if a fetch for the same wallet is already running, return it.
      if (portfolioFetchInFlight && portfolioFetchInFlight.address === address) {
        return portfolioFetchInFlight.promise;
      }
      // Throttle: ignore refreshes that fire within 800ms of the previous one,
      // unless opts.force is true (after Buy/Sell/Sell-All).
      var now = Date.now();
      if (!opts.force && now - portfolioLastFetchAt < 800) {
        if (portfolioRefreshTimer) return Promise.resolve(null);
        portfolioRefreshTimer = setTimeout(function () {
          portfolioRefreshTimer = null;
          refreshPortfolio({ force: true });
        }, 800 - (now - portfolioLastFetchAt));
        return Promise.resolve(null);
      }
      portfolioLastFetchAt = now;

      // Show cache instantly while the background fetch runs. If no
      // cache and nothing painted yet, surface a 'Loading…' state.
      if (portfolioPaintedAddress !== address) {
        if (!hydrateFromCache()) {
          if (dBalance) dBalance.textContent = 'Loading…';
          if (tokenCount) tokenCount.textContent = '…';
          if (tokenList) tokenList.innerHTML = '<div class="wallet-token-empty">Loading wallet holdings…</div>';
        }
      }

      var p = fetchWalletPortfolio()
        .then(function (portfolio) {
          if (api.getState().address !== address) return null; // wallet changed mid-flight
          paintPortfolio(address, portfolio);
          saveCachedPortfolio(address, portfolio);
          return portfolio;
        })
        .catch(function (err) {
          if (api.getState().address !== address) return null;
          // Only overwrite the screen with an error if there's nothing painted yet.
          if (portfolioPaintedAddress !== address) {
            if (dBalance) dBalance.textContent = 'Unavailable';
            if (tokenCount) tokenCount.textContent = 'Unavailable';
            if (tokenList) tokenList.innerHTML = '<div class="wallet-token-empty">Token holdings unavailable. ' + escapeHtml(err && err.message ? err.message : '') + '</div>';
          }
          return null;
        })
        .then(function (result) {
          if (portfolioFetchInFlight && portfolioFetchInFlight.address === address) portfolioFetchInFlight = null;
          return result;
        });
      portfolioFetchInFlight = { address: address, promise: p };
      return p;
    }

    function openDetails() {
      if (!detailsModal) return;
      paintDetails(api.getState());
      detailsModal.hidden = false;
      detailsModal.setAttribute('aria-hidden', 'false');
      hydrateFromCache();
      refreshPortfolio();
    }
    function closeDetails() {
      if (!detailsModal) return;
      detailsModal.hidden = true;
      detailsModal.setAttribute('aria-hidden', 'true');
    }

    function ensureSellAllModal() {
      if (sellAllModal) return;
      sellAllModal = document.createElement('div');
      sellAllModal.id = 'wallet-sell-all-modal';
      sellAllModal.className = 'modal-root';
      sellAllModal.hidden = true;
      sellAllModal.setAttribute('aria-hidden', 'true');
      sellAllModal.innerHTML =
        '<div class="modal-backdrop" data-sell-all-close></div>' +
        '<div class="modal-card sell-all-card cyber-card" role="dialog" aria-modal="true" aria-labelledby="sell-all-title">' +
          '<span class="cyber-corner-tl" aria-hidden="true"></span>' +
          '<span class="cyber-corner-br" aria-hidden="true"></span>' +
          '<header class="modal-head"><h3 id="sell-all-title">Sell All</h3><button class="modal-close" type="button" data-sell-all-close aria-label="Close">×</button></header>' +
          '<div class="sell-all-summary">' +
            '<strong id="sell-all-token">Token</strong>' +
            '<span id="sell-all-amount">Amount: —</span>' +
            '<span id="sell-all-receive">Estimated receive: —</span>' +
          '</div>' +
          '<p class="sell-all-warning">This sells the full token balance to SOL using Jupiter. Meme tokens are volatile and the wallet must approve the transaction.</p>' +
          '<div id="sell-all-status" class="trade-status" hidden></div>' +
          '<div class="trade-actions"><button class="trade-btn-cancel" type="button" data-sell-all-close>Cancel</button><button class="trade-btn-confirm" id="sell-all-confirm" type="button" disabled>Confirm Sell All</button></div>' +
        '</div>';
      document.body.appendChild(sellAllModal);
      sellAllEls = {
        token: sellAllModal.querySelector('#sell-all-token'),
        amount: sellAllModal.querySelector('#sell-all-amount'),
        receive: sellAllModal.querySelector('#sell-all-receive'),
        status: sellAllModal.querySelector('#sell-all-status'),
        confirm: sellAllModal.querySelector('#sell-all-confirm')
      };
      sellAllModal.addEventListener('click', function (event) {
        var t = event.target;
        if (t && t.matches && t.matches('[data-sell-all-close]') && !sellAllBusy) closeSellAllModal();
      });
    }

    function setSellAllStatus(kind, text, link) {
      if (!sellAllEls || !sellAllEls.status) return;
      sellAllEls.status.hidden = !text;
      if (!text) { sellAllEls.status.className = 'trade-status'; sellAllEls.status.innerHTML = ''; return; }
      sellAllEls.status.className = 'trade-status is-' + kind;
      sellAllEls.status.innerHTML = escapeHtml(text) + (link ? ' <a href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer">View on Solscan ↗</a>' : '');
    }

    function closeSellAllModal() {
      if (!sellAllModal) return;
      sellAllModal.hidden = true;
      sellAllModal.setAttribute('aria-hidden', 'true');
    }

    async function enrichSellToken(token) {
      // Just-in-time recovery for tokens that came back from an upstream
      // index without a usable `account` / `rawAmount`. The upstream
      // sometimes ships the MINT address as `account` by mistake, or
      // ships no `account` at all. We always do an authoritative RPC
      // lookup against the wallet -> mint pair to find the real token
      // account, falling back across token programs if needed.
      if (!window.solanaWeb3) throw new Error('Solana web3 library failed to load — refresh the page.');
      var wallet = api.getState();
      if (!wallet.address) throw new Error('Wallet not connected.');
      var ownerStr = wallet.address;

      // Ask the RPC for every token account this wallet owns for THIS
      // mint, across both token programs. Pick the account with the
      // largest non-zero balance (covers wallets that ended up with
      // multiple ATAs for the same mint).
      async function listAccounts(programId) {
        try {
          var resp = await rpcRequest({
            jsonrpc: '2.0', id: 'enrich-' + programId, method: 'getTokenAccountsByOwner',
            params: [
              ownerStr,
              { mint: token.mint },
              { encoding: 'jsonParsed', commitment: 'confirmed' }
            ]
          }, TOKEN_RPC_URLS);
          return (resp && resp.value) || [];
        } catch (_e) { return []; }
      }

      var matches = await listAccounts(TOKEN_PROGRAM_ID);
      var program = TOKEN_PROGRAM_ID;
      if (!matches.length) {
        matches = await listAccounts(TOKEN_2022_PROGRAM_ID);
        if (matches.length) program = TOKEN_2022_PROGRAM_ID;
      }
      if (!matches.length) throw new Error('Sell All blocked: no token account found for this mint on the connected wallet.');

      var best = null;
      var bestRaw = '0';
      var decimals = token.decimals;
      var stateFlag = null;
      for (var i = 0; i < matches.length; i += 1) {
        var entry = matches[i];
        var info = entry && entry.account && entry.account.data && entry.account.data.parsed
          && entry.account.data.parsed.info;
        var amt = info && info.tokenAmount;
        var raw = String(amt && amt.amount != null ? amt.amount : '0');
        if (raw === '0') continue;
        // pick the highest raw amount (string compare works for equal-length numerics; use BigInt-safe compare)
        if (best === null || (raw.length > bestRaw.length) || (raw.length === bestRaw.length && raw > bestRaw)) {
          best = entry;
          bestRaw = raw;
          if (amt && Number.isFinite(Number(amt.decimals))) decimals = Number(amt.decimals);
          stateFlag = info && info.state;
        }
      }
      if (!best) throw new Error('Sell All blocked: every token account for this mint reads zero — token may already be sold.');
      var account = (best.pubkey && best.pubkey.toString ? best.pubkey.toString() : best.pubkey) || '';
      if (!account) throw new Error('Sell All blocked: RPC returned no usable token account address.');
      if (String(stateFlag || '').toLowerCase() === 'frozen') throw new Error('Sell All blocked: token account is frozen.');
      return Object.assign({}, token, {
        account: account,
        rawAmount: bestRaw,
        decimals: decimals,
        tokenProgram: program,
        state: stateFlag || token.state
      });
    }

    async function openSellAllModal(token) {
      ensureSellAllModal();
      var snap = api.getState();
      if (!snap.connected) { alert('Connect wallet before selling.'); return; }
      if (!token || !token.mint || !isValidMint(token.mint)) {
        alert('Sell All blocked: token mint is invalid.');
        return;
      }
      sellAllModal.hidden = false;
      sellAllModal.setAttribute('aria-hidden', 'false');
      sellAllEls.token.textContent = token.name || token.symbol || shortAddr(token.mint);
      sellAllEls.amount.textContent = 'Amount: resolving…';
      sellAllEls.receive.textContent = 'Estimated receive: —';
      sellAllEls.confirm.disabled = true;
      setSellAllStatus('info', 'Resolving live token account…');
      try {
        token = await enrichSellToken(token);
      } catch (err) {
        sellAllEls.amount.textContent = 'Amount: unavailable';
        setSellAllStatus('error', err && err.message ? err.message : String(err));
        return;
      }
      sellAllEls.amount.textContent = 'Amount: ' + fmtAmount(rawAmountToUi(token.rawAmount, token.decimals), 6) + ' ' + String(token.symbol || 'TOKEN').toUpperCase();
      sellAllEls.receive.textContent = 'Estimated receive: loading…';
      if (!snap.consentSigned) {
        setSellAllStatus('info', 'Awaiting wallet authentication…');
        try {
          await api.signConsent();
        } catch (err) {
          if (err && err.code === 'USER_REJECTED') setSellAllStatus('warn', 'Authentication rejected — signature required before selling.');
          else setSellAllStatus('error', 'Authentication failed: ' + (err && err.message ? err.message : err));
          return;
        }
      }
      setSellAllStatus('info', 'Fetching full-balance Jupiter quote…');
      try {
        var quote = await getJupiterSellQuote(token);
        var outSol = Number(quote.outAmount) / 1e9;
        sellAllEls.receive.textContent = 'Estimated receive: ' + fmtAmount(outSol, 6) + ' SOL';
        setSellAllStatus('warn', 'Quote ready. Confirm only if you want to sell the full balance.');
        sellAllEls.confirm.disabled = false;
        sellAllEls.confirm.onclick = async function () {
          if (sellAllBusy) return;
          sellAllBusy = true;
          sellAllEls.confirm.disabled = true;
          try {
            var result = await executeSellAll(token, quote, setSellAllStatus);
            var message = 'Sell confirmed.';
            if (result.closeSignature) {
              message += ' Empty token account closed and rent reclaim submitted.';
            } else if (result.closeBlocked) {
              message += ' ' + result.closeBlocked;
            }
            setSellAllStatus('ok', message, solscanTx(result.sellSignature));
            refreshPortfolio({ force: true });
            [2500, 6500, 12000].forEach(function (delay) { setTimeout(function () { refreshPortfolio({ force: true }); }, delay); });
          } catch (err) {
            var msg = err && err.message ? err.message : String(err);
            if (/reject|denied|user|cancel/i.test(msg)) setSellAllStatus('warn', 'Transaction rejected in wallet.');
            else setSellAllStatus('error', msg);
          } finally {
            sellAllBusy = false;
            sellAllEls.confirm.disabled = false;
          }
        };
      } catch (err) {
        sellAllEls.receive.textContent = 'Estimated receive: unavailable';
        setSellAllStatus('error', err && err.message ? err.message : String(err));
      }
    }

    if (detailsModal) {
      detailsModal.addEventListener('click', function (e) {
        var t = e.target;
        if (t && t.matches && t.matches('[data-modal-close]')) closeDetails();
      });
    }

    if (consentBtn) consentBtn.addEventListener('click', function () {
      var snap = api.getState();
      if (!snap.connected) return;
      consentBtn.disabled = true;
      consentBtn.textContent = 'Authenticating…';
      api.signConsent().then(function () {
        consentBtn.textContent = 'Authenticate';
        consentBtn.disabled = false;
      }).catch(function (err) {
        consentBtn.textContent = 'Authenticate';
        consentBtn.disabled = false;
        if (err && err.code !== 'USER_REJECTED') alert('Consent failed: ' + (err && err.message ? err.message : err));
      });
    });
    if (disconBtn)  disconBtn.addEventListener('click', function () {
      closeDetails();
      api.disconnect();
    });
    if (dAddress) dAddress.addEventListener('click', function () {
      var address = dAddress.getAttribute('data-address') || api.getState().address || '';
      var original = dAddress.innerHTML;
      function copied() {
        dAddress.innerHTML = 'Copied <span aria-hidden="true">⧉</span>';
        dAddress.classList.add('is-copied');
        setTimeout(function () {
          dAddress.innerHTML = original;
          dAddress.classList.remove('is-copied');
        }, 1200);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(address).then(copied).catch(copied);
      else copied();
    });
    if (tokenList) tokenList.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('.wallet-token-solscan')) {
        e.stopPropagation();
        return;
      }
      if (e.target && e.target.closest && e.target.closest('.wallet-token-sell-all')) {
        e.preventDefault();
        e.stopPropagation();
        var sellBtn = e.target.closest('.wallet-token-sell-all');
        var index = Number(sellBtn.getAttribute('data-token-index'));
        var token = currentPortfolioTokens[index];
        if (token) openSellAllModal(token);
        return;
      }
      var btn = e.target && e.target.closest && e.target.closest('.wallet-token-mint');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      var mint = btn.getAttribute('data-mint') || '';
      var original = btn.textContent;
      function copied() {
        btn.textContent = 'Copied';
        btn.classList.add('is-copied');
        setTimeout(function () {
          btn.textContent = original;
          btn.classList.remove('is-copied');
        }, 1200);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(mint).then(copied).catch(copied);
      } else {
        copied();
      }
    });

    var lastSeenAddress = '';
    api.on(function (snap) {
      // Live-paint the open details modal on account/disconnect events.
      if (detailsModal && !detailsModal.hidden) paintDetails(snap);
      // Wallet connected (or address changed): hydrate from cache instantly
      // and kick off a background fetch — even if the details modal hasn't
      // been opened. Disconnect clears the painted-address marker so a
      // future reconnect always re-renders.
      if (snap.connected && snap.address && snap.address !== lastSeenAddress) {
        lastSeenAddress = snap.address;
        portfolioPaintedAddress = '';
        hydrateFromCache();
        refreshPortfolio();
      } else if (!snap.connected) {
        lastSeenAddress = '';
        portfolioPaintedAddress = '';
      }
    });

    window.addEventListener('smh:wallet-refresh', function () { refreshPortfolio({ force: true }); });
    setInterval(function () {
      if (api.getState().connected) refreshPortfolio();
    }, 25000);

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
