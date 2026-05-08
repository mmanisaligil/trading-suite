// ══════════════════════════════════════════════════════════════════
// TRADINGPANEL v0.7 — MACRO INTELLIGENCE SERVER
// File: macro-server.js
// Port: 3002 (default)
//
// Endpoints:
//   GET /macro         — full macro payload (all indicators + regime)
//   GET /macro/health  — cache ages + last-fetch timestamps
//   GET /macro/force   — bust all caches and re-fetch immediately
//
// Data sources:
//   FRED        — DXY proxy, 10Y yield, yield curve, Fed rate
//   metals.dev  — Gold (XAU), Silver (XAG) spot prices
//   EIA         — WTI crude oil spot price
//   alternative.me — Fear & Greed Index
//   CoinGecko   — BTC Dominance
//
// Cache TTLs (conservative — respects free tier limits):
//   FRED        4h  (daily series, lags 1 business day)
//   FEDFUNDS    24h (monthly data)
//   metals.dev  8h  (free tier: 100 req/month max)
//   EIA         1h  (daily official data)
//   Fear/Greed  1h  (daily score)
//   CoinGecko   15m (more dynamic)
// ══════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config();
const express = require('express');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3002;

const FRED_KEY   = process.env.FRED_API_KEY;
const METALS_KEY = process.env.METALS_API_KEY;
const EIA_KEY    = process.env.EIA_API_KEY;

// ── CORS — allow all origins (local personal tool) ────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── STATIC FILE SERVER ────────────────────────────────────────────
// Serves tradingpanel_v06.html, tradingpanel.css, tradingpanel.js,
// engine.js from the same directory as this server file.
// Open: http://localhost:3002
// This avoids file:// CORS restrictions on fetch() to localhost.
app.use(express.static(path.join(__dirname)));

// ── TTL CONSTANTS (ms) ────────────────────────────────────────────
const TTL = {
  FRED_DAILY:   4  * 60 * 60 * 1000,   // 4h  — DXY, 10Y, curve
  FRED_MONTHLY: 24 * 60 * 60 * 1000,   // 24h — FEDFUNDS
  METALS:       8  * 60 * 60 * 1000,   // 8h  — XAU, XAG (100 req/month budget)
  EIA:          1  * 60 * 60 * 1000,   // 1h  — WTI
  FEAR_GREED:   1  * 60 * 60 * 1000,   // 1h  — F&G
  COINGECKO:    15 * 60 * 1000,         // 15m — BTC dominance
};

// ── IN-MEMORY CACHE ───────────────────────────────────────────────
// Structure per slot: { data: {...}, fetchedAt: timestamp, error: null|string }
const CACHE = {
  dxy:        { data: null, fetchedAt: 0, error: null },
  y10:        { data: null, fetchedAt: 0, error: null },
  curve:      { data: null, fetchedAt: 0, error: null },
  fed:        { data: null, fetchedAt: 0, error: null },
  metals:     { data: null, fetchedAt: 0, error: null },
  wti:        { data: null, fetchedAt: 0, error: null },
  fearGreed:  { data: null, fetchedAt: 0, error: null },
  btcDom:     { data: null, fetchedAt: 0, error: null },
};

function isExpired(slot, ttl) {
  return Date.now() - CACHE[slot].fetchedAt > ttl;
}

function setCache(slot, data) {
  CACHE[slot].data      = data;
  CACHE[slot].fetchedAt = Date.now();
  CACHE[slot].error     = null;
}

function setError(slot, msg) {
  CACHE[slot].error = msg;
  // fetchedAt stays — prevents hammering on repeated errors
  // but we set a short retry by resetting fetchedAt to (now - TTL + 5min)
  CACHE[slot].fetchedAt = Date.now() - (TTL.FRED_DAILY - 5 * 60 * 1000);
}

// ══════════════════════════════════════════════════════════════════
// DATA FETCHERS
// ══════════════════════════════════════════════════════════════════

// ── FRED generic fetcher ──────────────────────────────────────────
// Returns { value, prev, asOf } or throws
async function fetchFRED(seriesId, limit = 3) {
  if (!FRED_KEY) throw new Error('FRED_API_KEY not set');
  const url = `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}` +
    `&api_key=${FRED_KEY}` +
    `&sort_order=desc` +
    `&limit=${limit}` +
    `&file_type=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`FRED ${seriesId} HTTP ${res.status}`);
  const json = await res.json();
  const obs  = (json.observations || []).filter(o => o.value !== '.');
  if (!obs.length) throw new Error(`FRED ${seriesId} no valid observations`);
  const value = parseFloat(obs[0].value);
  const prev  = obs.length >= 2 ? parseFloat(obs[1].value) : value;
  const asOf  = obs[0].date;
  return { value, prev, delta: parseFloat((value - prev).toFixed(4)), asOf };
}

// ── FETCH DXY (DTWEXBGS) ─────────────────────────────────────────
async function fetchDXY() {
  const d = await fetchFRED('DTWEXBGS', 3);
  // Direction classification
  const dir = d.delta > 0.1 ? 'rising' : d.delta < -0.1 ? 'falling' : 'flat';
  return { ...d, dir, label: 'Broad USD Index', unit: 'Index (2006=100)' };
}

// ── FETCH 10Y TREASURY YIELD (DGS10) ────────────────────────────
async function fetchY10() {
  const d = await fetchFRED('DGS10', 3);
  const zone = d.value > 4.5 ? 'high' : d.value > 3.5 ? 'neutral' : 'low';
  return { ...d, zone, label: '10Y Treasury Yield', unit: '%' };
}

// ── FETCH YIELD CURVE (T10Y2Y) ───────────────────────────────────
async function fetchCurve() {
  const d = await fetchFRED('T10Y2Y', 3);
  const inverted = d.value < 0;
  const status   = inverted
    ? d.value < -0.5 ? 'deeply_inverted' : 'inverted'
    : d.value < 0.5  ? 'flat'            : 'normal';
  return { ...d, inverted, status, label: '10Y-2Y Spread', unit: '%' };
}

// ── FETCH FED FUNDS RATE (FEDFUNDS) ──────────────────────────────
async function fetchFed() {
  const d = await fetchFRED('FEDFUNDS', 2);
  const cycle = d.value > d.prev ? 'hiking' : d.value < d.prev ? 'cutting' : 'hold';
  return { ...d, cycle, label: 'Fed Funds Rate', unit: '%' };
}

// ── FETCH METALS (XAU + XAG via metals.dev) ──────────────────────
async function fetchMetals() {
  if (!METALS_KEY) throw new Error('METALS_API_KEY not set');
  const url = `https://api.metals.dev/v1/latest?api_key=${METALS_KEY}&currency=USD&unit=toz`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`metals.dev HTTP ${res.status}`);
  const json = await res.json();

  // metals.dev v1/latest returns:
  // { metals: { gold: 3200.50, silver: 32.10, ... }, currencies: {...} }
  // Prices are direct USD floats per troy oz when currency=USD
  const metals = json.metals || json.rates || {};

  // Normalise — key may be lowercase 'gold'/'silver' or uppercase 'XAU'/'XAG'
  const rawGold   = metals.gold   ?? metals.XAU ?? metals.xau ?? null;
  const rawSilver = metals.silver ?? metals.XAG ?? metals.xag ?? null;

  if (!rawGold)   throw new Error(`metals.dev: gold key missing. Keys: ${Object.keys(metals).slice(0,8).join(',')}`);
  if (!rawSilver) throw new Error(`metals.dev: silver key missing. Keys: ${Object.keys(metals).slice(0,8).join(',')}`);

  const gold   = parseFloat(rawGold);
  const silver = parseFloat(rawSilver);

  if (!isFinite(gold)   || gold   <= 0) throw new Error(`metals.dev: invalid gold value: ${rawGold}`);
  if (!isFinite(silver) || silver <= 0) throw new Error(`metals.dev: invalid silver value: ${rawSilver}`);

  return {
    gold:   { price: parseFloat(gold.toFixed(2)),   unit: 'toz', currency: 'USD', label: 'Gold (XAU)' },
    silver: { price: parseFloat(silver.toFixed(3)), unit: 'toz', currency: 'USD', label: 'Silver (XAG)' },
  };
}

// ── FETCH WTI (EIA open data API) ────────────────────────────────
async function fetchWTI() {
  // EIA v2 API — WTI spot price series RWTC
  // Key is optional for low-volume access but improves rate limits
  const keyParam = EIA_KEY ? `&api_key=${EIA_KEY}` : '';
  const url = `https://api.eia.gov/v2/petroleum/pri/spt/data/` +
    `?frequency=daily` +
    `&data[0]=value` +
    `&facets[series][]=${encodeURIComponent('EER_EPRJK_PF4_Y35NY_DPG')}` +
    `&sort[0][column]=period` +
    `&sort[0][direction]=desc` +
    `&length=3` +
    keyParam;

  let res = await fetch(url, { signal: AbortSignal.timeout(10000) });

  // Fallback to simpler series ID if primary fails
  if (!res.ok) {
    const fallback = `https://api.eia.gov/v2/petroleum/pri/spt/data/` +
      `?frequency=daily` +
      `&data[0]=value` +
      `&facets[product][]=EPC0` +
      `&facets[duoarea][]=NUS` +
      `&facets[process][]=PF4` +
      `&sort[0][column]=period` +
      `&sort[0][direction]=desc` +
      `&length=3` +
      keyParam;
    res = await fetch(fallback, { signal: AbortSignal.timeout(10000) });
  }

  if (!res.ok) throw new Error(`EIA WTI HTTP ${res.status}`);
  const json = await res.json();
  const rows = (json.response?.data || []).filter(r => r.value !== null);
  if (!rows.length) throw new Error('EIA WTI no data rows');

  const value = parseFloat(rows[0].value);
  const prev  = rows.length >= 2 ? parseFloat(rows[1].value) : value;
  const asOf  = rows[0].period;
  return {
    value: parseFloat(value.toFixed(2)),
    prev:  parseFloat(prev.toFixed(2)),
    delta: parseFloat((value - prev).toFixed(2)),
    asOf,
    label: 'WTI Crude Oil',
    unit:  '$/barrel',
  };
}

// ── FETCH FEAR & GREED (alternative.me) ──────────────────────────
async function fetchFearGreed() {
  const url = 'https://api.alternative.me/fng/?limit=2&format=json';
  const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`F&G HTTP ${res.status}`);
  const json = await res.json();
  const data = json.data || [];
  if (!data.length) throw new Error('F&G empty response');

  const cur  = data[0];
  const prev = data.length >= 2 ? parseInt(data[1].value) : parseInt(cur.value);
  const val  = parseInt(cur.value);

  const label = val >= 75 ? 'Extreme Greed'
              : val >= 55 ? 'Greed'
              : val >= 45 ? 'Neutral'
              : val >= 25 ? 'Fear'
              :             'Extreme Fear';

  return { value: val, prev, delta: val - prev, label, asOf: cur.timestamp };
}

// ── FETCH BTC DOMINANCE (CoinGecko) ──────────────────────────────
async function fetchBTCDom() {
  const url = 'https://api.coingecko.com/api/v3/global';
  const res  = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const json = await res.json();
  const dom  = json.data?.market_cap_percentage?.btc;
  if (dom === undefined) throw new Error('CoinGecko missing BTC dominance');
  return {
    value: parseFloat(dom.toFixed(2)),
    label: 'BTC Dominance',
    unit:  '%',
  };
}

// ══════════════════════════════════════════════════════════════════
// CACHE REFRESH ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════

async function refreshCache(force = false) {
  const tasks = [];

  // FRED — daily series
  if (force || isExpired('dxy',   TTL.FRED_DAILY))
    tasks.push(fetchDXY().then(d => setCache('dxy', d)).catch(e => setError('dxy', e.message)));
  if (force || isExpired('y10',   TTL.FRED_DAILY))
    tasks.push(fetchY10().then(d => setCache('y10', d)).catch(e => setError('y10', e.message)));
  if (force || isExpired('curve', TTL.FRED_DAILY))
    tasks.push(fetchCurve().then(d => setCache('curve', d)).catch(e => setError('curve', e.message)));

  // FRED — monthly
  if (force || isExpired('fed', TTL.FRED_MONTHLY))
    tasks.push(fetchFed().then(d => setCache('fed', d)).catch(e => setError('fed', e.message)));

  // metals.dev — conservative TTL
  if (force || isExpired('metals', TTL.METALS))
    tasks.push(fetchMetals().then(d => setCache('metals', d)).catch(e => setError('metals', e.message)));

  // EIA WTI
  if (force || isExpired('wti', TTL.EIA))
    tasks.push(fetchWTI().then(d => setCache('wti', d)).catch(e => setError('wti', e.message)));

  // Fear & Greed
  if (force || isExpired('fearGreed', TTL.FEAR_GREED))
    tasks.push(fetchFearGreed().then(d => setCache('fearGreed', d)).catch(e => setError('fearGreed', e.message)));

  // CoinGecko BTC Dom
  if (force || isExpired('btcDom', TTL.COINGECKO))
    tasks.push(fetchBTCDom().then(d => setCache('btcDom', d)).catch(e => setError('btcDom', e.message)));

  if (tasks.length) await Promise.allSettled(tasks);
}

// ══════════════════════════════════════════════════════════════════
// REGIME CLASSIFIER
// Inputs: current cache snapshot
// Output: { label, score, signals[] }
//
// Score range: -5 to +5
//   >= +2 → RISK-ON
//   <= -2 → RISK-OFF
//   else  → NEUTRAL
// ══════════════════════════════════════════════════════════════════
function computeRegime() {
  let score   = 0;
  const signals = [];

  const dxy  = CACHE.dxy.data;
  const y10  = CACHE.y10.data;
  const curve= CACHE.curve.data;
  const fg   = CACHE.fearGreed.data;
  const dom  = CACHE.btcDom.data;

  // DXY direction
  if (dxy) {
    if (dxy.dir === 'rising')  { score -= 1; signals.push({ text: 'DXY rising — dollar strengthening', bias: 'bear' }); }
    if (dxy.dir === 'falling') { score += 1; signals.push({ text: 'DXY falling — dollar weakening',   bias: 'bull' }); }
  }

  // 10Y yield level
  if (y10) {
    if (y10.value > 4.5) { score -= 1; signals.push({ text: `10Y yield ${y10.value}% — elevated, risk-off pressure`, bias: 'bear' }); }
    if (y10.value < 3.5) { score += 1; signals.push({ text: `10Y yield ${y10.value}% — low, liquidity-friendly`,     bias: 'bull' }); }
  }

  // Yield curve
  if (curve) {
    if (curve.status === 'inverted' || curve.status === 'deeply_inverted') {
      score -= 1;
      signals.push({ text: `Yield curve ${curve.value.toFixed(2)}% — inverted, recession signal`, bias: 'bear' });
    }
    if (curve.status === 'normal' && curve.value > 0.5) {
      score += 1;
      signals.push({ text: `Yield curve ${curve.value.toFixed(2)}% — normal, expansion signal`, bias: 'bull' });
    }
  }

  // Fear & Greed
  if (fg) {
    if (fg.value < 30)      { score -= 1; signals.push({ text: `Fear & Greed ${fg.value} (${fg.label}) — fear dominant`, bias: 'bear' }); }
    else if (fg.value >= 60) { score += 1; signals.push({ text: `Fear & Greed ${fg.value} (${fg.label}) — greed dominant`, bias: 'bull' }); }
  }

  // BTC dominance
  if (dom) {
    if (dom.value > 55) { score -= 1; signals.push({ text: `BTC.D ${dom.value}% — capital flight to BTC, alts weak`, bias: 'bear' }); }
    if (dom.value < 45) { score += 1; signals.push({ text: `BTC.D ${dom.value}% — alt season appetite, risk-on`,    bias: 'bull' }); }
  }

  const label = score >= 2 ? 'RISK-ON' : score <= -2 ? 'RISK-OFF' : 'NEUTRAL';
  const color = label === 'RISK-ON' ? 'green' : label === 'RISK-OFF' ? 'red' : 'yellow';

  return { label, score, color, signals };
}

// ══════════════════════════════════════════════════════════════════
// RESPONSE ASSEMBLER
// ══════════════════════════════════════════════════════════════════
function buildResponse() {
  const now    = Date.now();
  const errors = [];

  // Collect errors from cache slots
  Object.keys(CACHE).forEach(slot => {
    if (CACHE[slot].error) errors.push({ slot, message: CACHE[slot].error });
  });

  // Helper: mark cached/stale status
  function slotMeta(slot, ttl) {
    return {
      cached:    CACHE[slot].data !== null,
      stale:     isExpired(slot, ttl * 2),    // >2× TTL = stale
      fetchedAt: CACHE[slot].fetchedAt || null,
      error:     CACHE[slot].error || null,
    };
  }

  const regime = computeRegime();

  return {
    timestamp: now,
    regime,
    fred: {
      dxy:   { ...(CACHE.dxy.data   || {}), ...slotMeta('dxy',   TTL.FRED_DAILY / 1000) },
      y10:   { ...(CACHE.y10.data   || {}), ...slotMeta('y10',   TTL.FRED_DAILY / 1000) },
      curve: { ...(CACHE.curve.data || {}), ...slotMeta('curve', TTL.FRED_DAILY / 1000) },
      fed:   { ...(CACHE.fed.data   || {}), ...slotMeta('fed',   TTL.FRED_MONTHLY / 1000) },
    },
    metals: {
      gold:   { ...(CACHE.metals.data?.gold   || {}), ...slotMeta('metals', TTL.METALS / 1000) },
      silver: { ...(CACHE.metals.data?.silver || {}), ...slotMeta('metals', TTL.METALS / 1000) },
    },
    oil: {
      wti: { ...(CACHE.wti.data || {}), ...slotMeta('wti', TTL.EIA / 1000) },
    },
    sentiment: {
      fearGreed: { ...(CACHE.fearGreed.data || {}), ...slotMeta('fearGreed', TTL.FEAR_GREED / 1000) },
    },
    crypto: {
      btcDominance: { ...(CACHE.btcDom.data || {}), ...slotMeta('btcDom', TTL.COINGECKO / 1000) },
    },
    cacheAges: Object.fromEntries(
      Object.keys(CACHE).map(k => [k, CACHE[k].fetchedAt ? Math.floor((now - CACHE[k].fetchedAt) / 1000) : null])
    ),
    errors,
  };
}

// ══════════════════════════════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════════════════════════════

// Primary endpoint — returns full macro payload
app.get('/macro', async (req, res) => {
  try {
    await refreshCache();
    res.json(buildResponse());
  } catch (err) {
    console.error('[/macro ERROR]', err.message);
    res.status(500).json({ error: err.message, timestamp: Date.now() });
  }
});

// Health endpoint — cache status without triggering refresh
app.get('/macro/health', (req, res) => {
  const now = Date.now();
  const health = {};
  for (const [slot, entry] of Object.entries(CACHE)) {
    health[slot] = {
      hasData:   entry.data !== null,
      ageSeconds: entry.fetchedAt ? Math.floor((now - entry.fetchedAt) / 1000) : null,
      error:      entry.error || null,
    };
  }
  res.json({
    status:    'ok',
    uptime:    Math.floor(process.uptime()),
    timestamp: now,
    cache:     health,
    regime:    computeRegime(),
  });
});

// Force refresh — busts all caches immediately
app.get('/macro/force', async (req, res) => {
  try {
    console.log('[/macro/force] Cache bust triggered');
    // Reset all fetchedAt to 0 to force re-fetch
    Object.keys(CACHE).forEach(slot => { CACHE[slot].fetchedAt = 0; });
    await refreshCache(true);
    res.json({ status: 'refreshed', timestamp: Date.now(), ...buildResponse() });
  } catch (err) {
    res.status(500).json({ error: err.message, timestamp: Date.now() });
  }
});

// Root — basic info
app.get('/', (req, res) => {
  res.json({
    name:      'TradingPanel v0.7 — Macro Server',
    version:   '0.7.0',
    endpoints: ['/macro', '/macro/health', '/macro/force', '/macro/debug'],
    port:      PORT,
  });
});

// Debug endpoint — raw cache contents, useful for diagnosing parse issues
app.get('/macro/debug', (req, res) => {
  const raw = {};
  for (const [slot, entry] of Object.entries(CACHE)) {
    raw[slot] = {
      data:      entry.data,
      fetchedAt: entry.fetchedAt,
      error:     entry.error,
    };
  }
  res.json({ raw, keys: { FRED: !!FRED_KEY, METALS: !!METALS_KEY, EIA: !!EIA_KEY } });
});

// ══════════════════════════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════════════════════════
app.listen(PORT, async () => {
  console.log(`\n⬡ TradingPanel v0.7 — Macro Server`);
  console.log(`  Port   : ${PORT}`);
  console.log(`  Keys   : FRED=${FRED_KEY ? 'SET' : 'MISSING'} | METALS=${METALS_KEY ? 'SET' : 'MISSING'} | EIA=${EIA_KEY ? 'SET' : 'MISSING'}`);
  console.log(`  Routes : GET /macro | /macro/health | /macro/force | /macro/debug`);
  console.log(`\n  ► Open panel at: http://localhost:3001/index.html\n`);
  console.log(`  Warming cache on startup...\n`);

  // Pre-warm cache on boot so first /macro request is instant
  try {
    await refreshCache(true);
    console.log('  [BOOT] Cache warmed successfully.');
  } catch (err) {
    console.warn('  [BOOT] Partial cache warm:', err.message);
  }
  console.log('\n  Standing by.\n');
});
