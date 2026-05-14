// ══════════════════════════════════════════════════════════════════
// VIVIENNE TRADINGPANEL v2.1 — PANEL.JS
// Screens: Landing → TradeRecon | MacroSignals | Watchdog
// Engine: engine.js v8.0 (setup classification + scoring fixes)
//
// v2.1 CHANGES — coordinated with engine.js v8.0:
//   • PANEL_OPTS: useVWAP: true — enables VWAP reversion setup detection
//   • wdRenderScoreCard: sc.setup bar added to ADVANCED section (max 15pts)
//   • wdRenderScoreCard: setupType pill — shows matched strategy archetype
//   • wdRenderScoreCard: dirResult confidence pill — shown when partial EMA
//   • trRenderTable crossCell: purple setup dot when archetype matched
//   • trScanPair: res.setupType stored on scan result for table access
//
// v2.0 CHANGES — coordinated with engine.js v7.0:
//   • wdRunScan: computeRegime(klines) → resolveParams(cfg, regime)
//     Resolved cfg flows into scoreSignal, pickSL, TP/entry calcs.
//     Regime stored on WD.lastScanResult. Regime logged per scan.
//   • trScanPair: same regime resolution — all TR scans are regime-aware.
//     res._regime stored for table display.
//   • wdRenderScoreCard: regime badge added to gate pills row
//     LOW=cyan / NORMAL=text4 / ELEVATED=yellow / CHAOS=red pulsing
//   • wdRenderRegimeBanner(): new function — standalone regime info block
//     injected after gate pills: label, atrMult, minConf delta, circuit
//     breaker threshold for current regime.
//   • wdRenderVerdict: regime circuit breaker threshold shown in checklist
//   • wdRenderLevels: resolved atrMult annotated with regime source
//   • trRenderTable crossCell: regime dot appended (color-coded by tier)
//   • panel.css: .wd-regime-badge and .wd-regime-banner-* classes added
//
// v1.0 CHANGES — coordinated with engine.js v6.0:
//   • PANEL_OPTS: useAbsorption: true added
//   • poc accessor: fmtP(d.poc) → fmtP(d.poc?.value ?? d.poc)
//   • wdRenderScoreCard: Absorption + POC Drift score bars
//   • wdRenderStructure: POC migration direction display
//   • wdRenderVerdict: liquidity pressure squeeze warning
//   • trRenderTable crossCell: orange absorption dot
//
// v0.8 CHANGES (structural only — zero behavioral change):
//   • Module state objects: APP / TR / MC / WD (no more scattered globals)
//   • onModuleLeave() — WS lifecycle management (C2 fix)
//   • Landing canvas pauses when off-screen (X1 fix)
//   • wdPopulatePairDropdown() called after universe loads (X2 fix)
//   • All timers owned by their module objects
//   • window exports consolidated at bottom (unchanged set)
//
// NOTE: No top-level 'use strict' — functions must be on window scope
//       for onclick="" HTML attributes to resolve correctly.
// ══════════════════════════════════════════════════════════════════

// ── ENGINE GUARD ─────────────────────────────────────────────────────
if (typeof TFC === 'undefined' || typeof analyze !== 'function') {
  console.error('[PANEL] ENGINE LOAD ERROR — engine.js not found or incomplete');
}

// ── CONSTANTS ─────────────────────────────────────────────────────────
// FAPI already declared in engine.js — reuse it
const FNG_URL     = 'https://api.alternative.me/fng/?limit=2';
const APP_CTRL    = 'http://localhost:3001';
const MACRO_URL   = 'http://localhost:3002/macro';
const MACRO_FORCE = 'http://localhost:3002/macro/force';

const PANEL_OPTS = {
  useEMA200: true, useStructure: true, useDivergence: true,
  useSqueeze: true, useCrossEvents: true, useWyckoff: true, useCVD: true,
  useAbsorption: true,  // [v1.0] engine v6.0 absorption candle detector
  useVWAP: true,        // [v8.0] engine v8.0 VWAP reversion setup detection
};

const STATE_COLOR = {
  LONG:     '#00f5a0',
  SHORT:    '#ff2d55',
  WATCH:    '#ffd060',
  HUNT:     '#00d4ff',
  FORMING:  '#ff8c00',
  EXTENDED: '#9966ff',
  CHOP:     '#3a6080',
  WAIT:     '#1e3a52',
};

// ── DOM HELPER ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ══════════════════════════════════════════════════════════════════
// MODULE: CORE — App-level state and shared infrastructure
// ══════════════════════════════════════════════════════════════════
const APP = {
  currentScreen:      'landing',
  macroServerOnline:  false,
  macroData:          null,
  macroFetchedAt:     null,   // epoch ms when macroData was last fetched
};

// C5: Macro staleness — data older than this is flagged STALE
const MACRO_STALE_MS   = 30 * 60 * 1000;  // 30 minutes
const MACRO_WARN_MS    = 15 * 60 * 1000;  // 15 minutes — show WARNING

function macroAge() {
  if (!APP.macroFetchedAt) return Infinity;
  return Date.now() - APP.macroFetchedAt;
}

function macroStaleness() {
  const age = macroAge();
  if (age === Infinity)       return 'missing';
  if (age > MACRO_STALE_MS)  return 'stale';
  if (age > MACRO_WARN_MS)   return 'warn';
  return 'fresh';
}

// Updates the nav regime pill area with a staleness badge when needed.
// Called after every macroData fetch and on server status change.
function updateMacroStaleBadge() {
  const badge = $('nav-macro-stale');
  if (!badge) return;
  const s = macroStaleness();
  if (s === 'fresh') {
    badge.textContent = '';
    badge.className   = 'macro-stale-badge';
  } else if (s === 'warn') {
    const mins = Math.floor(macroAge() / 60000);
    badge.textContent = `MACRO ${mins}m OLD`;
    badge.className   = 'macro-stale-badge stale-warn';
  } else if (s === 'stale') {
    const mins = Math.floor(macroAge() / 60000);
    badge.textContent = `MACRO STALE ${mins}m`;
    badge.className   = 'macro-stale-badge stale-stale';
  } else {
    badge.textContent = 'MACRO NO DATA';
    badge.className   = 'macro-stale-badge stale-missing';
  }
}

// Refresh stale badge every 60s so it ages in real-time without a page action
setInterval(updateMacroStaleBadge, 60000);

// ── CLOCK ─────────────────────────────────────────────────────────────
function nowTime() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

setInterval(() => {
  const t = nowTime();
  if ($('landing-clock')) $('landing-clock').textContent = t;
  if ($('nav-clock'))     $('nav-clock').textContent     = t;
}, 1000);

// ── LOGGING HELPERS ───────────────────────────────────────────────────
function logTo(logId, msg, cls = '') {
  const box = $(logId);
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = `<span class="log-ts">[${nowTime()}]</span><span class="${cls}">${msg}</span>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 60) box.removeChild(box.firstChild);
}

// ── SHARED ENGINE HELPERS ─────────────────────────────────────────────

// ── RATE LIMITER — Binance FAPI ───────────────────────────────────────
// Binance IP limit: ~2400 weight/min. Each /klines call = 5-10 weight.
// Strategy: token bucket at 4 req/s (240/min), 429 triggers backoff.
const RLIM = {
  concurrency:  4,          // max parallel kline fetches
  active:       0,          // currently in-flight
  queue:        [],         // pending { resolve, fn } entries
  backoffUntil: 0,          // epoch ms — don't fetch before this
  backoffMs:    0,          // current backoff duration (doubles on repeat 429s)
  MAX_BACKOFF:  32000,      // cap at 32s
  MIN_DELAY:    250,        // ms between sequential fetches in scan loops
};

function rlimSchedule(fn) {
  return new Promise((resolve, reject) => {
    RLIM.queue.push({ resolve, reject, fn });
    rlimDrain();
  });
}

async function rlimDrain() {
  if (RLIM.active >= RLIM.concurrency) return;
  if (RLIM.queue.length === 0) return;

  const now = Date.now();
  if (now < RLIM.backoffUntil) {
    const wait = RLIM.backoffUntil - now;
    setTimeout(rlimDrain, wait);
    return;
  }

  const { resolve, reject, fn } = RLIM.queue.shift();
  RLIM.active++;
  try {
    const result = await fn();
    RLIM.backoffMs = 0; // success — reset backoff
    resolve(result);
  } catch(e) {
    reject(e);
  } finally {
    RLIM.active--;
    rlimDrain();
  }
}

// fetchKlines — rate-limit-aware, 429-detecting, exponential backoff
async function fetchKlines(symbol, tf, limit, attempt = 0) {
  const MAX_ATTEMPTS = 4;
  const cfg = TFC[tf];
  const url = `${FAPI}/klines?symbol=${symbol}&interval=${cfg.interval}&limit=${limit}`;

  return rlimSchedule(async () => {
    const res = await fetch(url);

    if (res.status === 429 || res.status === 418) {
      // 429 = rate limited, 418 = IP banned
      const retryAfter = parseInt(res.headers.get('Retry-After') || '0') * 1000;
      RLIM.backoffMs = retryAfter > 0
        ? retryAfter
        : Math.min(RLIM.backoffMs > 0 ? RLIM.backoffMs * 2 : 2000, RLIM.MAX_BACKOFF);
      RLIM.backoffUntil = Date.now() + RLIM.backoffMs;

      logTo('tr-log', `⚠ RATE LIMIT ${res.status} — backing off ${(RLIM.backoffMs/1000).toFixed(1)}s`, 'log-warn');
      console.warn(`[RLIM] ${res.status} on ${symbol} ${tf} — backoff ${RLIM.backoffMs}ms`);

      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, RLIM.backoffMs));
        return fetchKlines(symbol, tf, limit, attempt + 1);
      }
      throw new Error(`Rate limited after ${MAX_ATTEMPTS} attempts: ${symbol} ${tf}`);
    }

    if (!res.ok) throw new Error(`Klines HTTP ${res.status} for ${symbol} ${tf}`);
    return res.json();
  });
}

// ── C4: OI + L/S FETCHERS — Binance DAPI ────────────────────────────
// Unlocks up to 20pts of dead scoring channels (oiDiv + lsRatio).
// Both fetchers are best-effort — failures return null silently so
// scan continues unblocked. Called in parallel with kline fetches.

// DAPI declared in engine.js — reused here

async function fetchOIData(symbol, tf) {
  // Map panel TF → Binance OI period string
  const periodMap = {
    '1m':'5m', '5m':'5m', '15m':'15m',
    '1h':'1h', '4h':'4h', '1d':'1d',
  };
  const period = periodMap[tf] || '1h';
  try {
    const url = `${DAPI}/openInterestHist?symbol=${symbol}&period=${period}&limit=2`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length < 2) return null;
    return {
      current: parseFloat(data[data.length - 1].sumOpenInterest),
      prev:    parseFloat(data[data.length - 2].sumOpenInterest),
    };
  } catch(e) {
    return null; // non-blocking
  }
}

async function fetchLSData(symbol, tf) {
  const periodMap = {
    '1m':'5m', '5m':'5m', '15m':'15m',
    '1h':'1h', '4h':'4h', '1d':'1d',
  };
  const period = periodMap[tf] || '1h';
  try {
    const url = `${DAPI}/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return {
      longRatio:  parseFloat(data[0].longAccount),
      shortRatio: parseFloat(data[0].shortAccount),
    };
  } catch(e) {
    return null; // non-blocking
  }
}

// ══════════════════════════════════════════════════════════════════
// LANDING CANVAS — particle grid effect
// Pauses when leaving landing screen (X1 fix)
// ══════════════════════════════════════════════════════════════════
const CANVAS = { active: true };

(function initCanvas() {
  const canvas = $('landing-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, nodes = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
    buildNodes();
  }

  function buildNodes() {
    nodes = [];
    const cols = Math.ceil(W / 60);
    const rows = Math.ceil(H / 60);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() > 0.7) {
          nodes.push({
            x: c * 60 + Math.random() * 30,
            y: r * 60 + Math.random() * 30,
            alpha: Math.random() * 0.4 + 0.05,
            speed: Math.random() * 0.003 + 0.001,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
    }
  }

  let frame = 0;
  function draw() {
    if (!CANVAS.active) return; // pause when off-screen
    ctx.clearRect(0, 0, W, H);
    frame++;

    ctx.strokeStyle = 'rgba(10,28,48,0.8)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x < W; x += 80) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 80) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    nodes.forEach(n => {
      const a = (Math.sin(frame * n.speed + n.phase) * 0.5 + 0.5) * n.alpha;
      ctx.beginPath();
      ctx.arc(n.x, n.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,212,255,${a})`;
      ctx.fill();
    });

    if (frame % 180 < 60) {
      const progress = (frame % 180) / 60;
      const y = progress * H;
      const grad = ctx.createLinearGradient(0, y - 30, 0, y + 2);
      grad.addColorStop(0, 'rgba(0,212,255,0)');
      grad.addColorStop(1, 'rgba(0,212,255,0.03)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - 30, W, 32);
    }

    requestAnimationFrame(draw);
  }

  // Expose restart so router can resume it
  CANVAS.restart = () => { CANVAS.active = true; draw(); };

  window.addEventListener('resize', resize);
  resize();
  draw();
})();

// ══════════════════════════════════════════════════════════════════
// SCREEN ROUTER — with onModuleLeave / onModuleEnter lifecycle
// ══════════════════════════════════════════════════════════════════
function showScreen(name) {
  // Lifecycle: leave current screen
  onModuleLeave(APP.currentScreen);

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(`screen-${name}`);
  if (el) el.classList.add('active');

  const nav = $('app-nav');
  if (name === 'landing') {
    nav.classList.remove('visible');
  } else {
    nav.classList.add('visible');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const nb = $(`nav-${name}`);
    if (nb) nb.classList.add('active');
    $('nav-breadcrumb').textContent = {
      traderecon: '◈ TRADERECON',
      macro:      '⬡ MACRO',
      watchdog:   '◉ WATCHDOG',
      siglog:     '◎ SIGNAL LOG',
      predictive: '◬ PREDICTIVE ENGINE',
    }[name] || '';
  }

  APP.currentScreen = name;
}

function goHome() {
  showScreen('landing');
}

function launchModule(name) {
  showScreen(name);
  onModuleEnter(name);
}

function switchModule(name) {
  showScreen(name);
  onModuleEnter(name);
}

// ── Module enter — start resources ────────────────────────────────
function onModuleEnter(name) {
  if (name === 'landing') {
    CANVAS.active = true;
    if (CANVAS.restart) CANVAS.restart();
  }
  if (name === 'traderecon') {
    TR.wsActive = true; // re-enable message processing
    // T3: restore TF selection
    const savedTF = lsLoad(LS_KEYS.trTF);
    if (savedTF && TFC[savedTF]) {
      TR.tf = savedTF;
      document.querySelectorAll('#tr-tf-selector .tf-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tf === savedTF);
      });
    }
    // T3: restore auto-scan state
    const savedAuto = lsLoad(LS_KEYS.autoScan, false);
    if (savedAuto && !TR.autoScanActive) {
      const btn = $('tr-auto-btn');
      if (btn) { btn.textContent = 'AUTO: ON'; btn.classList.add('auto-active'); }
      TR.autoScanActive = true;
      TR.autoCountdown = 60;
      trStartAutoCountdown();
      TR.autoScanTimer = setInterval(() => { trRunAutoScan(); TR.autoCountdown = 60; }, 60000);
    }
    if (TR.universe.length === 0) trBootUniverse();
    wlRenderStrip(); // T1: render watchlist strip on re-entry
    wlStartRefresh();
  }
  if (name === 'macro') {
    fetchMacroData(false);
  }
  if (name === 'watchdog') {
    // T3: restore last pair
    const savedPair = lsLoad(LS_KEYS.wdPair);
    if (savedPair) {
      WD.pair = savedPair;
      const inp = $('wd-pair-input');
      if (inp) inp.value = savedPair;
    }
    // Don't auto-scan; wait for user
  }
  if (name === 'siglog') {
    sigLogRender();
  }
  // ── PREDICTIVE ENGINE v0.8.2 ──────────────────────────────────
  if (name === 'predictive' && typeof peActivate === 'function') {
    peActivate();
  }
}

// ── Module leave — release resources ─────────────────────────────
function onModuleLeave(name) {
  if (name === 'landing') {
    CANVAS.active = false;
  }

  if (name === 'traderecon') {
    TR.wsActive = false;
    wlStopRefresh(); // T1: pause watchlist refresh while off-screen
    clearInterval(TR.autoCountdownTimer);
    TR.autoCountdownTimer = null;
    const cd = $('tr-auto-countdown');
    if (cd && !TR.autoScanActive) cd.textContent = '';
  }

  if (name === 'macro') {
    // No persistent resources to tear down — fetches are one-shot
  }

  // ── PREDICTIVE ENGINE v0.8.2 ──────────────────────────────────
  if (name === 'predictive' && typeof peDeactivate === 'function') {
    peDeactivate();
  }

  if (name === 'watchdog') {
    // Close Bybit WS — it will reconnect when user returns and runs scan
    if (WD.ws) {
      try {
        if (WD.ws._pingTimer) clearInterval(WD.ws._pingTimer);
        WD.ws.onclose = null; // prevent auto-reconnect loop
        WD.ws.close();
      } catch(e) {}
      WD.ws    = null;
      WD.wsPair = null;
    }
    // Pause candle countdown
    clearInterval(WD.candleCdownTimer);
    WD.candleCdownTimer = null;
    // Pause alarm checks (re-arm on next scan)
    clearInterval(WD.alarmCheckTimer);
    WD.alarmCheckTimer = null;
    wdSetWSState('offline');
    logTo('wd-log', '[WSS] Disconnected on module leave', 'log-warn');
  }
}

// ══════════════════════════════════════════════════════════════════
// MODULE: MACRO SERVER CONTROL
// ══════════════════════════════════════════════════════════════════
async function checkServerStatus() {
  try {
    const res = await fetch(`${APP_CTRL}/server/status`, { signal: AbortSignal.timeout(3000) });
    const d   = await res.json();
    setServerState(d.running);
    return d;
  } catch {
    setServerState(false);
    return { running: false };
  }
}

function setServerState(online) {
  APP.macroServerOnline = online;

  const dot = $('lsb-macro-dot');
  const val = $('lsb-macro-val');
  if (dot) dot.className = 'lsb-dot ' + (online ? 'lsb-dot-green' : 'lsb-dot-red');
  if (val) val.textContent = online ? 'ONLINE' : 'OFFLINE';

  const navDot   = $('nav-srv-dot');
  const navLabel = $('nav-srv-label');
  const navBtn   = $('nav-srv-btn');
  if (navDot)   navDot.className   = 'srv-dot ' + (online ? 'online' : 'offline');
  if (navLabel) navLabel.textContent = online ? 'SERVER ON' : 'SERVER OFF';
  if (navBtn) {
    navBtn.textContent = online ? 'STOP' : 'START';
    navBtn.className   = 'srv-btn ' + (online ? 'stop-mode' : '');
  }

  const banner = $('macro-offline-banner');
  const grid   = $('macro-grid');
  if (banner) banner.style.display = online ? 'none' : 'flex';
  if (grid)   grid.style.display   = online ? 'flex' : 'none';

  // C5: when server goes offline, immediately re-evaluate staleness
  updateMacroStaleBadge();
}

async function toggleMacroServer() {
  const btn = $('nav-srv-btn');
  if (btn) btn.disabled = true;
  const dot = $('nav-srv-dot');
  if (dot) dot.className = 'srv-dot starting';

  try {
    if (APP.macroServerOnline) {
      await fetch(`${APP_CTRL}/server/stop`, { method: 'POST' });
      await new Promise(r => setTimeout(r, 1000));
      await checkServerStatus();
    } else {
      await fetch(`${APP_CTRL}/server/start`, { method: 'POST' });
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const st = await checkServerStatus();
        if (st.running) {
          if (APP.currentScreen === 'macro') fetchMacroData(false);
          break;
        }
      }
    }
  } catch (e) {
    console.error('[PANEL] Server toggle error:', e);
  }

  if (btn) btn.disabled = false;
}

// Poll server status every 5s
setInterval(checkServerStatus, 5000);
checkServerStatus();

// ══════════════════════════════════════════════════════════════════
// MODULE: TRADERECON
// ══════════════════════════════════════════════════════════════════
const TR = {
  universe:          [],
  ws:                null,
  wsActive:          true,   // gates message processing — false when module inactive
  livePrice:         {},
  scanResults:       {},     // symbol → scoreSignal result | 'scanning'
  tf:                '1h',
  sortCol:           'rank',
  sortDir:           1,
  scanQueue:         [],
  scanActive:        false,
  autoScanTimer:     null,
  autoScanActive:    false,
  autoCountdown:     60,
  autoCountdownTimer: null,
  fullScanActive:    false,
  batchScanActive:   false,
  scanAbortFlag:     false,
  batchScanSize:     25,
};

// ══════════════════════════════════════════════════════════════════
// MODULE: WATCHLIST (T1)
// Persistent, localStorage-backed. Max 15 pairs. Drives the PSI
// monitor strip above the TradeRecon table and quick-scan refresh.
// ══════════════════════════════════════════════════════════════════
const WL = {
  pairs:           [],        // ordered array of symbol strings
  MAX_PAIRS:       15,
  refreshTimer:    null,
  REFRESH_MS:      75000,     // 75s auto-refresh cycle
  lastTransitions: {},        // symbol → last signalState for transition detection
};

// ── PERSISTENCE ───────────────────────────────────────────────────
const LS_KEYS = {
  watchlist:    'viv_watchlist',
  trTF:         'viv_tr_tf',
  wdPair:       'viv_wd_pair',
  autoScan:     'viv_auto_scan',
};

function lsSave(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch(e) {}
}
function lsLoad(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch(e) { return fallback; }
}

function wlSave() { lsSave(LS_KEYS.watchlist, WL.pairs); }

function wlLoad() {
  WL.pairs = lsLoad(LS_KEYS.watchlist, []);
}

// ── MEMBERSHIP ────────────────────────────────────────────────────
function wlHas(symbol) { return WL.pairs.includes(symbol); }

function wlToggle(symbol) {
  if (wlHas(symbol)) {
    WL.pairs = WL.pairs.filter(s => s !== symbol);
    logTo('tr-log', `★ Removed ${symbol} from watchlist`, 'log-warn');
  } else {
    if (WL.pairs.length >= WL.MAX_PAIRS) {
      logTo('tr-log', `Watchlist full (${WL.MAX_PAIRS} max) — remove a pair first`, 'log-warn');
      return;
    }
    WL.pairs.push(symbol);
    logTo('tr-log', `★ Added ${symbol} to watchlist`, 'log-ok');
  }
  wlSave();
  trRenderTable();      // refresh star column in main table
  wlRenderStrip();      // refresh watchlist monitor
}

// ── AUTO-REFRESH ──────────────────────────────────────────────────
// ── T7: SIGNAL TRANSITION TOAST SYSTEM ──────────────────────────
// Fires when auto-scan or watchlist-refresh detects a state change.
// Transition priority: WATCH/LONG/SHORT > FORMING > HUNT (descending urgency)
const TOAST = {
  queue:     [],
  showing:   false,
  container: null,
};

const TOAST_PRIORITY = { LONG:5, SHORT:5, WATCH:4, FORMING:3, HUNT:2, EXTENDED:1, CHOP:0, WAIT:0 };

function toastInit() {
  if (TOAST.container) return;
  TOAST.container = document.createElement('div');
  TOAST.container.id = 'toast-container';
  TOAST.container.className = 'toast-container';
  document.body.appendChild(TOAST.container);
}

function toastFire(symbol, prevState, newState, score, dir) {
  toastInit();
  const prevPri = TOAST_PRIORITY[prevState] || 0;
  const newPri  = TOAST_PRIORITY[newState]  || 0;
  // Only toast on meaningful upgrades: HUNT→FORMING, FORMING→WATCH, any→LONG/SHORT
  if (newPri <= prevPri && newState !== 'LONG' && newState !== 'SHORT') return;
  if (newState === 'WAIT' || newState === 'CHOP') return;

  const dirColor = dir === 'LONG' ? 'var(--green)' : dir === 'SHORT' ? 'var(--red)' : 'var(--yellow)';
  const arrow    = dir === 'LONG' ? '▲' : dir === 'SHORT' ? '▼' : '→';
  const label    = newState === 'LONG' || newState === 'SHORT'
    ? `${arrow} ${dir} SIGNAL FIRED`
    : `${prevState} → ${newState}`;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${(newState||'').toLowerCase()}`;
  toast.innerHTML = `
    <span class="toast-sym">${symbol.replace('USDT','')}</span>
    <span class="toast-label" style="color:${dirColor}">${label}</span>
    <span class="toast-score">${score ? score.toFixed(0)+'%' : ''}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;
  // Click to open Watchdog
  toast.addEventListener('click', (e) => {
    if (e.target.classList.contains('toast-close')) return;
    openWatchdog(symbol);
  });

  TOAST.container.prepend(toast);
  // Auto-dismiss after 12s
  setTimeout(() => { if (toast.parentElement) toast.remove(); }, 12000);

  // Browser notification for background monitoring
  if (Notification.permission === 'granted') {
    new Notification(`VIVIENNE · ${symbol}`, {
      body: `${label}${score ? ' · ' + score.toFixed(0) + '%' : ''}`,
    });
  }
}

// Called after each scan result is stored — compares to last known state
function toastCheckTransition(symbol, result) {
  if (!result || result === 'scanning') return;
  const prev = WL.lastTransitions[symbol];
  const curr = result.signalState;
  if (prev && prev !== curr) {
    toastFire(symbol, prev, curr, result.score, result.dir);
    // Log every transition to the persistent signal log
    const ps = result.preSignal || { maturity: 0 };
    sigLogAdd({
      symbol,
      prevState: prev,
      newState:  curr,
      dir:       result.dir,
      score:     result.score,
      tf:        TR.tf,
      maturity:  ps.maturity || 0,
      source:    WL.pairs.includes(symbol) ? 'watchlist' : 'auto',
    });
  }
  WL.lastTransitions[symbol] = curr;
}

// ══════════════════════════════════════════════════════════════════
// MODULE: SIGNAL LOG (new screen)
// Persistent ring buffer — survives refresh, browser close.
// Captures every state transition detected by the suite.
// ══════════════════════════════════════════════════════════════════
const SIGLOG = {
  LS_KEY:   'viv_siglog',
  MAX:      200,
  entries:  [],           // in-memory mirror of localStorage
  filterDir: 'all',       // 'all' | 'LONG' | 'SHORT'
  filterState: 'all',     // 'all' | 'WATCH' | 'FORMING' | 'HUNT' | 'LONG' | 'SHORT'
};

// ── PERSISTENCE ───────────────────────────────────────────────────
function sigLogLoad() {
  SIGLOG.entries = lsLoad(SIGLOG.LS_KEY, []);
}

function sigLogSave() {
  lsSave(SIGLOG.LS_KEY, SIGLOG.entries);
}

// ── ADD ENTRY ─────────────────────────────────────────────────────
// Called from toastCheckTransition — single source of truth.
function sigLogAdd({ symbol, prevState, newState, dir, score, tf, maturity, source }) {
  const entry = {
    id:        Date.now() + Math.random(), // unique even on same ms
    ts:        Date.now(),
    symbol,
    prevState: prevState || '—',
    newState:  newState  || '—',
    dir:       dir       || '',
    score:     score     ? parseFloat(score.toFixed(1)) : 0,
    tf:        tf        || TR.tf || '—',
    maturity:  maturity  || 0,
    source:    source    || 'auto',
  };

  SIGLOG.entries.unshift(entry); // newest first

  // Cap ring buffer
  if (SIGLOG.entries.length > SIGLOG.MAX) {
    SIGLOG.entries = SIGLOG.entries.slice(0, SIGLOG.MAX);
  }

  sigLogSave();

  // Live-update the log screen if it's open
  if (APP.currentScreen === 'siglog') sigLogRender();

  // Update nav badge count
  sigLogUpdateBadge();
}

// ── NAV BADGE ─────────────────────────────────────────────────────
// Shows count of entries logged today
function sigLogUpdateBadge() {
  const badge = $('nav-siglog-badge');
  if (!badge) return;
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayCount = SIGLOG.entries.filter(e => e.ts >= todayStart.getTime()).length;
  badge.textContent = todayCount > 0 ? todayCount : '';
  badge.style.display = todayCount > 0 ? 'inline-block' : 'none';
}

// ── FILTER HELPERS ────────────────────────────────────────────────
function sigLogSetFilterDir(val) {
  SIGLOG.filterDir = val;
  // Update button states
  document.querySelectorAll('.slg-dir-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.dir === val);
  });
  sigLogRender();
}

function sigLogSetFilterState(val) {
  SIGLOG.filterState = val;
  const sel = $('slg-filter-state');
  if (sel) sel.value = val;
  sigLogRender();
}

function sigLogGetFiltered() {
  return SIGLOG.entries.filter(e => {
    if (SIGLOG.filterDir !== 'all' && e.dir !== SIGLOG.filterDir) return false;
    if (SIGLOG.filterState !== 'all' && e.newState !== SIGLOG.filterState) return false;
    return true;
  });
}

// ── RENDER ────────────────────────────────────────────────────────
function sigLogRender() {
  const container = $('slg-entries');
  if (!container) return;

  const entries = sigLogGetFiltered();
  sigLogUpdateBadge();

  // Update count chips
  const today = new Date(); today.setHours(0,0,0,0);
  const todayEntries = SIGLOG.entries.filter(e => e.ts >= today.getTime());
  const totalEl = $('slg-total'); if (totalEl) totalEl.textContent = SIGLOG.entries.length;
  const todayEl = $('slg-today'); if (todayEl) todayEl.textContent = todayEntries.length;

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="slg-empty">
        <div class="slg-empty-icon">◎</div>
        <div class="slg-empty-txt">No signals logged yet</div>
        <div class="slg-empty-sub">Auto-scan and watchlist refresh will populate this log automatically</div>
      </div>`;
    return;
  }

  // Group by calendar date
  const groups = {};
  entries.forEach(e => {
    const d = new Date(e.ts);
    const key = d.toLocaleDateString('en-GB', { weekday:'short', year:'numeric', month:'short', day:'numeric' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  let html = '';
  for (const [dateLabel, group] of Object.entries(groups)) {
    html += `
      <div class="slg-date-group">
        <div class="slg-date-hdr">
          <span class="slg-date-lbl">${dateLabel}</span>
          <span class="slg-date-count">${group.length} signal${group.length !== 1 ? 's' : ''}</span>
        </div>
        ${group.map(e => sigLogEntryHTML(e)).join('')}
      </div>`;
  }

  container.innerHTML = html;
}

function sigLogEntryHTML(e) {
  const time     = new Date(e.ts).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const dirColor = e.dir === 'LONG' ? 'var(--green)' : e.dir === 'SHORT' ? 'var(--red)' : 'var(--text3)';
  const arrow    = e.dir === 'LONG' ? '▲' : e.dir === 'SHORT' ? '▼' : '→';
  const newCls   = trStateCls(e.newState);
  const srcColor = e.source === 'watchlist' ? 'var(--yellow)' : 'var(--cyan2)';

  // Transition importance — brighten high-priority transitions
  const isPrime  = e.newState === 'LONG' || e.newState === 'SHORT' || e.newState === 'WATCH';
  const cardCls  = isPrime ? 'slg-entry slg-entry-prime' : 'slg-entry';

  return `
    <div class="${cardCls}" onclick="openWatchdog('${e.symbol}')" title="Click to open in Watchdog">
      <div class="slg-entry-left">
        <span class="slg-time">${time}</span>
        <span class="slg-sym">${e.symbol.replace('USDT','')}</span>
        <span class="slg-tf">${e.tf.toUpperCase()}</span>
      </div>
      <div class="slg-entry-mid">
        <span class="slg-prev">${e.prevState}</span>
        <span class="slg-arrow">→</span>
        <span class="sig-badge ${newCls} slg-new">${e.newState}</span>
      </div>
      <div class="slg-entry-right">
        <span class="slg-dir" style="color:${dirColor}">${e.dir ? arrow+' '+e.dir : '—'}</span>
        <span class="slg-score" style="color:${dirColor}">${e.score.toFixed(0)}%</span>
        <span class="slg-psi">PSI ${e.maturity}%</span>
        <span class="slg-src" style="color:${srcColor}">${e.source}</span>
      </div>
      <div class="slg-entry-action">↗</div>
    </div>`;
}

// ── EXPORT — Antigravity-compatible markdown ──────────────────────
function sigLogExport() {
  const entries = sigLogGetFiltered();
  if (entries.length === 0) {
    logTo('tr-log', 'Signal log empty — nothing to export', 'log-warn');
    return;
  }

  const now    = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const header = `# VIVIENNE SIGNAL LOG
Exported: ${now}
Entries: ${entries.length}

---

`;

  // Group by date for readable output
  const groups = {};
  entries.forEach(e => {
    const d   = new Date(e.ts);
    const key = d.toLocaleDateString('en-GB', { year:'numeric', month:'2-digit', day:'2-digit' });
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  let body = '';
  for (const [date, group] of Object.entries(groups)) {
    body += `## ${date}

`;
    group.forEach(e => {
      const time = new Date(e.ts).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
      const dir  = e.dir ? `${e.dir}` : 'NO DIR';
      const line = '- `' + time + '` **' + e.symbol + '** ' + e.prevState + ' → **' + e.newState + '** · ' + dir + ' · ' + e.score.toFixed(0) + '% · PSI ' + e.maturity + '% · ' + e.tf.toUpperCase() + ' · _' + e.source + '_';
      body += line + '\n';
    });
    body += '\n';
  }

  const md       = header + body;
  const blob     = new Blob([md], { type: 'text/markdown' });
  const url      = URL.createObjectURL(blob);
  const a        = document.createElement('a');
  const filename = `vivienne-signals-${new Date().toISOString().slice(0,10)}.md`;
  a.href         = url;
  a.download     = filename;
  a.click();
  URL.revokeObjectURL(url);
  logTo('tr-log', `Signal log exported: ${filename} (${entries.length} entries)`, 'log-ok');
}

// ── CLEAR ─────────────────────────────────────────────────────────
function sigLogClear() {
  if (!confirm(`Clear all ${SIGLOG.entries.length} signal log entries? This cannot be undone.`)) return;
  SIGLOG.entries = [];
  sigLogSave();
  sigLogRender();
  logTo('tr-log', 'Signal log cleared', 'log-warn');
}

function wlStartRefresh() {
  clearInterval(WL.refreshTimer);
  if (WL.pairs.length === 0) return;
  WL.refreshTimer = setInterval(wlRefreshScan, WL.REFRESH_MS);
}

function wlStopRefresh() {
  clearInterval(WL.refreshTimer);
  WL.refreshTimer = null;
}

async function wlRefreshScan() {
  if (WL.pairs.length === 0) return;
  for (const sym of WL.pairs) {
    await trScanPair(sym);
    await new Promise(r => setTimeout(r, RLIM.MIN_DELAY));
  }
  wlRenderStrip();
}

// ── RENDER: WATCHLIST MONITOR STRIP ──────────────────────────────
function wlRenderStrip() {
  const wrap = $('wl-strip-wrap');
  const strip = $('wl-strip');
  if (!wrap || !strip) return;

  if (WL.pairs.length === 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';

  strip.innerHTML = WL.pairs.map(sym => {
    const r = TR.scanResults[sym];
    const isScanning = r === 'scanning';
    const hasData    = r && r !== 'scanning';

    const state    = hasData ? (r.signalState || 'WAIT') : '—';
    const score    = hasData ? r.score.toFixed(0) + '%' : '—';
    const maturity = hasData && r.preSignal ? r.preSignal.maturity : 0;
    const dir      = hasData ? (r.dir || '') : '';

    // Freshness
    const ageMs = hasData && r.scannedAt ? Date.now() - r.scannedAt : Infinity;
    const stale  = ageMs > 15 * 60 * 1000;
    const aged   = ageMs > 5  * 60 * 1000 && !stale;

    // State transition glow — lastTransitions updated by toastCheckTransition
    const prev = WL.lastTransitions[sym];
    const transitioned = prev && prev !== state && hasData;

    const stateCls  = trStateCls(state);
    const dirColor  = dir === 'LONG' ? 'var(--green)' : dir === 'SHORT' ? 'var(--red)' : 'var(--text4)';
    const matColor  = maturity >= 75 ? 'var(--watch)' : maturity >= 50 ? '#aa66ff' : 'var(--cyan2)';
    const cardCls   = [
      'wl-card',
      isScanning ? 'wl-card-scanning' : '',
      transitioned ? 'wl-card-transition' : '',
      stale ? 'wl-card-stale' : aged ? 'wl-card-aged' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${cardCls}" title="${sym} · last scan ${ageMs === Infinity ? 'never' : Math.floor(ageMs/60000)+'m ago'}">
        <div class="wlc-header">
          <span class="wlc-sym">${sym.replace('USDT','')}</span>
          <span class="wlc-dir" style="color:${dirColor}">${dir || '—'}</span>
          <button class="wlc-rm" onclick="wlToggle('${sym}')" title="Remove from watchlist">✕</button>
        </div>
        <span class="sig-badge ${stateCls} wlc-state">${isScanning ? '···' : state}</span>
        <div class="wlc-mat-wrap" title="PSI Maturity ${maturity}%">
          <div class="wlc-mat-track">
            <div class="wlc-mat-fill" style="width:${maturity}%;background:${matColor}"></div>
          </div>
          <span class="wlc-mat-pct" style="color:${matColor}">${hasData ? maturity+'%' : '—'}</span>
        </div>
        <div class="wlc-score" style="color:${dirColor}">${score}</div>
      </div>
    `;
  }).join('');
}

function trSetTF(btn) {
  document.querySelectorAll('#tr-tf-selector .tf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  TR.tf = btn.dataset.tf;
  lsSave(LS_KEYS.trTF, TR.tf); // T3: persist TF
  logTo('tr-log', `TF set to ${TR.tf}`, 'log-info');
}

async function trBootUniverse() {
  const btn = $('tr-refresh-btn');
  btn.disabled = true;
  btn.textContent = '↺ LOADING...';
  btn.classList.add('scanning-anim');
  logTo('tr-log', 'Fetching Binance universe + F&G...', 'log-info');

  try {
    const [fngRes, tickerRes] = await Promise.all([
      fetch(FNG_URL).then(r => r.json()).catch(() => null),
      fetch(`${FAPI}/ticker/24hr`).then(r => r.json()),
    ]);

    if (fngRes?.data?.length >= 1) {
      const now = fngRes.data[0];
      const val = parseInt(now.value);
      const fgEl = $('tr-fg');
      if (fgEl) fgEl.textContent = `${val} (${now.value_classification})`;
    }

    const futures = tickerRes
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('_'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));

    let fundingMap = {};
    try {
      const fRates = await fetch(`${FAPI}/premiumIndex`).then(r => r.json());
      fRates.forEach(f => { fundingMap[f.symbol] = parseFloat(f.lastFundingRate) || 0; });
    } catch { logTo('tr-log', 'Funding fetch skipped', 'log-warn'); }

    TR.universe = futures.map((t, i) => ({
      rank:    i + 1,
      symbol:  t.symbol,
      price:   parseFloat(t.lastPrice),
      chg:     parseFloat(t.priceChangePercent),
      vol:     parseFloat(t.quoteVolume),
      funding: fundingMap[t.symbol] || 0,
    }));

    if ($('tr-pairs')) $('tr-pairs').textContent = `${TR.universe.length}`;
    logTo('tr-log', `Universe loaded: ${TR.universe.length} pairs`, 'log-ok');

    trRenderTable();
    trInitWS();
    wdPopulatePairDropdown(); // X2 fix — refresh datalist after universe loads

  } catch (e) {
    logTo('tr-log', `Boot error: ${e.message}`, 'log-err');
  }

  btn.disabled = false;
  btn.textContent = '↺ REFRESH UNIVERSE';
  btn.classList.remove('scanning-anim');
}

function trInitWS() {
  if (TR.ws) { try { TR.ws.close(); } catch(e) {} }

  const wsDot   = $('tr-ws-dot');
  const wsLabel = $('tr-ws-label');
  if (wsDot)   wsDot.className    = 'ws-dot connecting';
  if (wsLabel) wsLabel.textContent = 'CONNECTING...';

  TR.ws = new WebSocket('wss://fstream.binance.com/ws/!miniTicker@arr');

  TR.ws.onopen = () => {
    if (wsDot)   wsDot.className    = 'ws-dot live';
    if (wsLabel) wsLabel.textContent = 'WS LIVE';
    logTo('tr-log', 'WebSocket connected', 'log-ok');
    const lsbDot = $('lsb-ws-dot');
    const lsbVal = $('lsb-ws-val');
    if (lsbDot) lsbDot.className = 'lsb-dot lsb-dot-cyan';
    if (lsbVal) lsbVal.textContent = 'LIVE';
  };

  TR.ws.onmessage = (e) => {
    if (!TR.wsActive) return; // gate: ignore messages when module inactive
    try {
      const tickers = JSON.parse(e.data);
      if (!Array.isArray(tickers)) return;
      tickers.forEach(t => {
        TR.livePrice[t.s] = parseFloat(t.c);
        const u = TR.universe.find(x => x.symbol === t.s);
        if (u) u.price = parseFloat(t.c);
      });
      trUpdatePriceCells();
    } catch(err) {}
  };

  TR.ws.onerror = () => {
    if (wsDot)   wsDot.className    = 'ws-dot error';
    if (wsLabel) wsLabel.textContent = 'WS ERROR';
  };

  TR.ws.onclose = () => {
    if (wsDot)   wsDot.className    = 'ws-dot';
    if (wsLabel) wsLabel.textContent = 'WS CLOSED';
    // Reconnect only if this module's WS is the one that closed
    // (not if it was manually closed by onModuleLeave)
    setTimeout(() => {
      if (TR.ws === null || TR.ws.readyState === WebSocket.CLOSED) {
        trInitWS();
      }
    }, 5000);
  };
}

function trUpdatePriceCells() {
  TR.universe.forEach(u => {
    const cell = $(`trprice-${u.symbol}`);
    if (cell && TR.livePrice[u.symbol]) {
      cell.textContent = fmtP(TR.livePrice[u.symbol]);
    }
  });
}

// ── SORT — three-state cycle: desc → asc → reset ─────────────────
// State machine per column:
//   New column   → desc first (largest to smallest)
//   Same col desc → asc (smallest to largest)
//   Same col asc  → reset (back to rank/default)
function trSort(col) {
  if (TR.sortCol !== col) {
    TR.sortCol = col;
    TR.sortDir = -1;          // first click → desc (largest first)
  } else if (TR.sortDir === -1) {
    TR.sortDir = 1;           // second click → asc (smallest first)
  } else {
    TR.sortCol = 'rank';      // third click → reset to original rank
    TR.sortDir = 1;
  }
  trRenderTable();
}

function trFilterTable() {
  trRenderTable();
}

function trGetFiltered() {
  const search = $('tr-search')?.value.trim().toUpperCase() || '';
  const dirF   = $('tr-filter-dir')?.value || 'all';
  const fundF  = $('tr-filter-fund')?.value || 'all';

  let rows = [...TR.universe];

  if (search) rows = rows.filter(u => u.symbol.includes(search));
  if (fundF === 'extreme') rows = rows.filter(u => Math.abs(u.funding * 100) > 0.05);
  if (fundF === 'pos')     rows = rows.filter(u => u.funding > 0);
  if (fundF === 'neg')     rows = rows.filter(u => u.funding < 0);

  if (dirF !== 'all') {
    rows = rows.filter(u => {
      const r = TR.scanResults[u.symbol];
      if (!r) return false;
      return r.signalState === dirF || (r.dir === dirF && (dirF === 'LONG' || dirF === 'SHORT'));
    });
  }

  // Signal/state priority map for text-column sorting
  const STATE_PRIORITY = { LONG:6, SHORT:5, WATCH:4, FORMING:3, HUNT:2, CHOP:1 };

  rows.sort((a, b) => {
    let av, bv;

    // ── Universe fields (direct properties) ──────────────────────
    if (['rank','symbol','price','chg','vol','funding'].includes(TR.sortCol)) {
      av = a[TR.sortCol];
      bv = b[TR.sortCol];
      if (TR.sortCol === 'symbol') return TR.sortDir * String(av).localeCompare(String(bv));
      return TR.sortDir * ((av || 0) - (bv || 0));
    }

    // ── scanResult fields ─────────────────────────────────────────
    const ra = TR.scanResults[a.symbol];
    const rb = TR.scanResults[b.symbol];
    const rdA = (ra && ra !== 'scanning') ? ra : null;
    const rdB = (rb && rb !== 'scanning') ? rb : null;

    if (TR.sortCol === 'score') {
      av = rdA ? (rdA.score  || 0) : -1;
      bv = rdB ? (rdB.score  || 0) : -1;
    } else if (TR.sortCol === 'signal') {
      av = rdA ? (STATE_PRIORITY[rdA.dir || rdA.signalState] || 0) : -1;
      bv = rdB ? (STATE_PRIORITY[rdB.dir || rdB.signalState] || 0) : -1;
    } else if (TR.sortCol === 'state') {
      av = rdA ? (STATE_PRIORITY[rdA.signalState] || 0) : -1;
      bv = rdB ? (STATE_PRIORITY[rdB.signalState] || 0) : -1;
    } else if (TR.sortCol === 'psi') {
      av = rdA ? (rdA.preSignal?.maturity || 0) : -1;
      bv = rdB ? (rdB.preSignal?.maturity || 0) : -1;
    } else if (TR.sortCol === 'age') {
      // Sort by recency: larger scannedAt = more recent = "smaller age"
      av = rdA?.scannedAt || 0;
      bv = rdB?.scannedAt || 0;
    } else if (TR.sortCol === 'pe') {
      const pa = (typeof PE !== 'undefined') ? PE.results[a.symbol] : null;
      const pb = (typeof PE !== 'undefined') ? PE.results[b.symbol] : null;
      av = pa ? (pa.score || 0) : -1;
      bv = pb ? (pb.score || 0) : -1;
    } else {
      // Fallback: universe rank
      av = a.rank; bv = b.rank;
    }

    return TR.sortDir * ((av || 0) - (bv || 0));
  });

  return rows;
}

function trRenderTable() {
  const rows  = trGetFiltered();
  const tbody = $('tr-tbody');
  if (!tbody) return;

  // ── Sort indicators: ↓ desc · ↑ asc · blank = unsorted / reset ──
  const SORT_COLS = ['rank','symbol','price','chg','vol','funding','signal','score','state','psi','age','pe'];
  SORT_COLS.forEach(col => {
    const el = $(`tri-${col}`);
    if (!el) return;
    if (TR.sortCol !== col) { el.textContent = ''; el.className = 'tri'; return; }
    el.textContent  = TR.sortDir === -1 ? '↓' : '↑';
    el.className    = `tri tri-${TR.sortDir === -1 ? 'desc' : 'asc'}`;
  });

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="table-empty">No pairs match filter</td></tr>';
    return;
  }

  let longs = 0, shorts = 0, scanned = 0;
  Object.values(TR.scanResults).forEach(r => {
    scanned++;
    if (r.signalState === 'LONG')  longs++;
    if (r.signalState === 'SHORT') shorts++;
  });
  if ($('tr-scanned')) $('tr-scanned').textContent = scanned;
  if ($('tr-longs'))   $('tr-longs').textContent   = longs;
  if ($('tr-shorts'))  $('tr-shorts').textContent  = shorts;

  const frag = document.createDocumentFragment();

  rows.forEach(u => {
    const r       = TR.scanResults[u.symbol];
    const trEl    = document.createElement('tr');
    const inWL    = wlHas(u.symbol);
    const starTxt = inWL ? '★' : '☆';

    const chgCls  = u.chg >= 0 ? 'cell-pos' : 'cell-neg';
    const fundCls = u.funding > 0 ? 'cell-pos' : u.funding < 0 ? 'cell-neg' : 'cell-neutral';

    let signalCell = '<span class="sig-badge sig-none">—</span>';
    let scoreCell  = '<span class="cell-neutral">—</span>';
    let stateCell  = '<span class="cell-neutral">—</span>';
    let freshCell  = '';

    // T2: heatmap row background based on signal state
    let rowBg = '';
    if (r && r !== 'scanning') {
      const st = r.signalState;
      if (st === 'LONG')    rowBg = 'background:rgba(0,245,160,0.04)';
      else if (st === 'SHORT')   rowBg = 'background:rgba(255,45,85,0.04)';
      else if (st === 'WATCH')   rowBg = 'background:rgba(255,208,96,0.03)';
      else if (st === 'FORMING') rowBg = 'background:rgba(255,140,0,0.03)';
    }

    // T4: scan freshness
    let rowOpacity = '';
    if (r && r !== 'scanning' && r.scannedAt) {
      const ageMs = Date.now() - r.scannedAt;
      if (ageMs > 15 * 60 * 1000)     { rowOpacity = 'opacity:0.45'; freshCell = '<span class="fresh-badge fresh-stale">STALE</span>'; }
      else if (ageMs > 5 * 60 * 1000) { rowOpacity = 'opacity:0.7';  freshCell = '<span class="fresh-badge fresh-aged">' + Math.floor(ageMs/60000) + 'm</span>'; }
      else { freshCell = '<span class="fresh-badge fresh-ok">LIVE</span>'; }
    }

    const rowStyle = [rowBg, rowOpacity].filter(Boolean).join(';');

    // T6: PSI maturity bar
    let psiCell = '<span class="cell-neutral">—</span>';
    // T6: cross events indicators
    let crossCell = '';
    // T7 prereq: inline macro coherence badge
    let cohBadge = '';

    if (r === 'scanning') {
      signalCell = '<span class="sig-badge sig-scanning">SCANNING</span>';
    } else if (r) {
      signalCell = trSignalBadge(r);
      scoreCell  = trScoreBar(r.score, r.dir);
      stateCell  = `<span class="sig-badge ${trStateCls(r.signalState)}">${r.signalState || '—'}</span>`;

      // T6: PSI maturity mini-bar
      const ps  = r.preSignal || { maturity: 0 };
      const mat = ps.maturity || 0;
      const matColor = mat >= 75 ? 'var(--watch)' : mat >= 50 ? '#aa66ff' : mat >= 35 ? 'var(--cyan2)' : 'var(--text4)';
      psiCell = `
        <div class="tr-psi-wrap">
          <div class="tr-psi-track">
            <div class="tr-psi-fill" style="width:${mat}%;background:${matColor}"></div>
          </div>
          <span class="tr-psi-pct" style="color:${matColor}">${mat}%</span>
        </div>`;

      // T6: cross events dots
      const d_  = r._d;
      if (d_?.crossEvents?.events?.length) {
        crossCell = d_.crossEvents.events.slice(0, 3).map(e => {
          const bull = e.dir === 'bull';
          const conf = e.status === 'confirmed';
          const col  = conf ? (bull ? 'var(--green)' : 'var(--red)') : 'var(--text4)';
          const tip  = `${e.name} ${e.status}`;
          return `<span class="tr-cross-dot" style="background:${col}" title="${tip}"></span>`;
        }).join('');
      }
      if (d_?.squeeze?.squeeze || d_?.squeeze?.fired) {
        const col = d_.squeeze.fired ? 'var(--yellow)' : 'var(--cyan2)';
        crossCell += `<span class="tr-cross-dot" style="background:${col}" title="Squeeze ${d_.squeeze.fired ? 'FIRED' : 'active'}"></span>`;
      }
      // [v1.0] Absorption dot — orange, larger — signals institutional activity
      if (d_?.absorption?.absorptionBull || d_?.absorption?.absorptionBear) {
        const absorpDir = d_.absorption.absorptionBull ? 'BULL' : 'BEAR';
        const absorpTip = `Absorption ${absorpDir} — vol spike + small body (ratio ${(d_.absorption.ratio||0).toFixed(2)})`;
        crossCell += `<span class="tr-absorb-dot" title="${absorpTip}"></span>`;
      }
      // [v2.0] Regime dot — color-coded by volatility tier
      if (r._regime) {
        const regimeDotCol = { LOW:'var(--cyan2)', NORMAL:'var(--text4)', ELEVATED:'var(--yellow)', CHAOS:'var(--red)' }[r._regime] || 'var(--text4)';
        const regimeTip = `Regime: ${r._regime}`;
        crossCell += `<span class="tr-cross-dot tr-regime-dot" style="background:${regimeDotCol}" title="${regimeTip}"></span>`;
      }

      // [v8.0] Setup archetype dot — purple, signals a named strategy matched
      if (r.setupType) {
        crossCell += `<span class="tr-cross-dot tr-setup-dot" title="Setup: ${r.setupType.label}"></span>`;
      }

      // Macro coherence inline badge (T7 prereq — cached, zero cost)
      if (APP.macroData && r.dir) {
        const coh = computeCoherence(r, APP.macroData);
        const cohColor = coh.color === 'confirm' ? 'var(--green2)' : coh.color === 'conflict' ? 'var(--red)' : 'var(--text4)';
        const cohTxt   = coh.color === 'confirm' ? '✓' : coh.color === 'conflict' ? '✕' : '~';
        cohBadge = `<span class="tr-coh-badge" style="color:${cohColor}" title="${coh.verdict} ${coh.score}%">${cohTxt}</span>`;
      }
    }

    // ── PREDICTIVE ENGINE v0.8.2 — PE column mini-cell ───────────
    let peCell = '<span class="cell-neutral" style="font-size:10px">—</span>';
    const pRes = (typeof PE !== 'undefined') ? PE.results[u.symbol] : null;
    if (pRes && pRes.score !== undefined) {
      const peCol  = pRes.score >= 70 ? '#aa55ff' : pRes.score >= 50 ? '#7744cc' : pRes.score >= 30 ? 'var(--cyan2)' : 'var(--text4)';
      const peDir  = pRes.dirBias === 'LONG' ? 'var(--green)' : pRes.dirBias === 'SHORT' ? 'var(--red)' : 'var(--text4)';
      const peDirChar = pRes.dirBias === 'LONG' ? '▲' : pRes.dirBias === 'SHORT' ? '▼' : '·';
      peCell = `<div class="pe-mini-wrap" onclick="openPredictive('${u.symbol}')" title="Predictive: ${pRes.score}/100 · ${pRes.dirBias} · ${pRes.ignitionWindow?.label || ''}">
        <div class="pe-mini-bar-track"><div class="pe-mini-bar-fill" style="width:${pRes.score}%;background:${peCol}"></div></div>
        <span class="pe-mini-score" style="color:${peCol}">${pRes.score}</span>
        <span class="pe-mini-dir"   style="color:${peDir}">${peDirChar}</span>
      </div>`;
    }

    // T2: compact row
    trEl.setAttribute('style', rowStyle);
    trEl.innerHTML = `
      <td class="cell-rank">${u.rank}</td>
      <td class="cell-star" onclick="wlToggle('${u.symbol}')" title="${inWL ? 'Remove from watchlist' : 'Add to watchlist'}" style="cursor:pointer;color:${inWL ? 'var(--yellow)' : 'var(--text4)'}">${starTxt}</td>
      <td class="cell-symbol">${u.symbol}</td>
      <td class="cell-price" id="trprice-${u.symbol}">${fmtP(u.price)}</td>
      <td class="${chgCls}">${u.chg >= 0 ? '+' : ''}${u.chg.toFixed(2)}%</td>
      <td class="cell-neutral">${fmtBig(u.vol)}</td>
      <td class="${fundCls}">${(u.funding * 100).toFixed(4)}%</td>
      <td>${signalCell}${cohBadge}</td>
      <td>${scoreCell}</td>
      <td>${stateCell}</td>
      <td class="cell-psi">${psiCell}</td>
      <td class="cell-cross">${crossCell}</td>
      <td class="cell-fresh">${freshCell}</td>
      <td class="cell-pe">${peCell}</td>
      <td class="cell-actions">
        <button class="act-btn act-scan" onclick="trScanPair('${u.symbol}')" ${r === 'scanning' ? 'disabled' : ''}>⟳</button>
        <button class="act-btn act-detail" onclick="openWatchdog('${u.symbol}')">↗</button>
      </td>
    `;
    frag.appendChild(trEl);
  });

  tbody.innerHTML = '';
  tbody.appendChild(frag);
}

function trSignalBadge(r) {
  if (!r || !r.dir) {
    const st = r?.signalState || 'WAIT';
    return `<span class="sig-badge ${trStateCls(st)}">${st}</span>`;
  }
  const cls = r.dir === 'LONG' ? 'sig-long' : 'sig-short';
  return `<span class="sig-badge ${cls}">${r.dir}</span>`;
}

function trStateCls(state) {
  const map = {
    LONG: 'sig-long', SHORT: 'sig-short', WATCH: 'sig-watch',
    HUNT: 'sig-hunt', FORMING: 'sig-forming', EXTENDED: 'sig-extended',
    CHOP: 'sig-chop', WAIT: 'sig-wait',
  };
  return map[state] || 'sig-wait';
}

function trScoreBar(score, dir) {
  const pct = Math.min(Math.max(score || 0, 0), 100);
  const color = dir === 'LONG' ? '#00f5a0' : dir === 'SHORT' ? '#ff2d55' : '#3a6080';
  return `
    <div class="score-bar-wrap">
      <div class="score-bar-bg">
        <div class="score-bar-fill" style="width:${pct}%;background:${color}"></div>
      </div>
      <span class="score-val" style="color:${color}">${pct.toFixed(0)}%</span>
    </div>
  `;
}

async function trScanPair(symbol) {
  logTo('tr-log', `Scanning ${symbol} [${TR.tf}]...`, 'log-info');
  // Preserve last good result during re-scan — show as scanning but keep old data
  const prev = TR.scanResults[symbol];
  TR.scanResults[symbol] = 'scanning';
  trRenderTable();

  try {
    const baseCfg = TFC[TR.tf];

    // C4: fetch klines + OI + L/S in parallel — OI/LS are best-effort (null on failure)
    const [klines, oiData, lsData] = await Promise.all([
      fetchKlines(symbol, TR.tf, baseCfg.candles),
      fetchOIData(symbol, TR.tf),
      fetchLSData(symbol, TR.tf),
    ]);

    // [v2.0] Regime detection — pure engine call, no cost
    const regime = computeRegime(klines);
    const cfg    = resolveParams(baseCfg, regime);

    let htfData = null;
    if (cfg.htfReq) {
      try {
        const htfCfg    = TFC[cfg.htfReq];
        const htfKlines = await fetchKlines(symbol, cfg.htfReq, htfCfg.candles);
        htfData = analyze(htfKlines, PANEL_OPTS);
      } catch(e) {
        logTo('tr-log', `HTF fetch failed for ${symbol}: ${e.message}`, 'log-warn');
      }
    }

    const d = analyze(klines, PANEL_OPTS);
    // C3: real funding rate from universe map
    const univEntry = TR.universe.find(u => u.symbol === symbol);
    const fundingRate = univEntry ? univEntry.funding : 0;
    // C4: pass OI + L/S — unlocks oiDiv + lsRatio scoring channels
    const res = scoreSignal(d, cfg, htfData, fundingRate, oiData, lsData);
    res.scannedAt  = Date.now();   // freshness timestamp (T4)
    res._d         = d;            // T6: store analyze result for PSI + cross events
    res._regime    = regime;       // [v2.0] store regime for table display
    res.setupType  = res.setupType || null; // [v8.0] named setup archetype from classifySetup()
    toastCheckTransition(symbol, res);
    TR.scanResults[symbol] = res;
    // ── PREDICTIVE ENGINE v0.8.2: reuse already-fetched data ─────
    if (typeof peScanPair === 'function') {
      try { peScanPair(symbol, klines, d); } catch (peErr) { /* non-blocking */ }
    }
    logTo('tr-log', `${symbol}: ${res.dir || 'NO DIR'} | ${res.signalState} | ${res.score.toFixed(0)}% | ${regime}`, res.dir ? 'log-ok' : 'log-warn');

  } catch (e) {
    // Rate-limit or network error: restore previous result so data isn't lost
    if (prev && prev !== 'scanning') {
      TR.scanResults[symbol] = prev;
      logTo('tr-log', `Scan error ${symbol} — keeping last result: ${e.message}`, 'log-warn');
    } else {
      delete TR.scanResults[symbol];
      logTo('tr-log', `Scan error ${symbol}: ${e.message}`, 'log-err');
    }
  }

  trRenderTable();
}

function openWatchdog(symbol) {
  WD.pair = symbol.toUpperCase();
  const sel = $('wd-pair-input');
  if (sel) sel.value = WD.pair;
  lsSave(LS_KEYS.wdPair, WD.pair); // T3: persist last pair
  switchModule('watchdog');
  wdRunScan();
}

// ── TRADERECON AUTO SCAN + FULL SCAN ─────────────────────────────────
function trToggleAutoScan() {
  TR.autoScanActive = !TR.autoScanActive;
  const btn = $('tr-auto-btn');
  if (TR.autoScanActive) {
    if (btn) { btn.textContent = 'AUTO: ON'; btn.classList.add('auto-active'); }
    trRunAutoScan();
    TR.autoCountdown = 60;
    trStartAutoCountdown();
    TR.autoScanTimer = setInterval(() => {
      trRunAutoScan();
      TR.autoCountdown = 60;
    }, 60000);
    lsSave(LS_KEYS.autoScan, true); // T3
    logTo('tr-log', 'Auto-scan ON — pre-scanned pairs refresh every 60s', 'log-ok');
  } else {
    if (btn) { btn.textContent = 'AUTO: OFF'; btn.classList.remove('auto-active'); }
    clearInterval(TR.autoScanTimer);
    clearInterval(TR.autoCountdownTimer);
    TR.autoScanTimer      = null;
    TR.autoCountdownTimer = null;
    const cd = $('tr-auto-countdown');
    if (cd) cd.textContent = '';
    lsSave(LS_KEYS.autoScan, false); // T3
    logTo('tr-log', 'Auto-scan OFF', 'log-warn');
  }
}

function trStartAutoCountdown() {
  clearInterval(TR.autoCountdownTimer);
  TR.autoCountdownTimer = setInterval(() => {
    TR.autoCountdown--;
    const cd = $('tr-auto-countdown');
    if (cd) cd.textContent = `↻ ${TR.autoCountdown}s`;
    if (TR.autoCountdown <= 0) TR.autoCountdown = 60;
  }, 1000);
}

async function trRunAutoScan() {
  const scanned = Object.keys(TR.scanResults).filter(s => TR.scanResults[s] !== 'scanning');
  if (scanned.length === 0) {
    logTo('tr-log', 'Auto-scan: no pre-scanned pairs — use SCAN buttons first', 'log-warn');
    return;
  }
  logTo('tr-log', `Auto-scan: refreshing ${scanned.length} pairs [${TR.tf}]...`, 'log-info');
  for (const sym of scanned) {
    await trScanPair(sym);
    await new Promise(r => setTimeout(r, 300));
  }
  logTo('tr-log', `Auto-scan complete — ${scanned.length} pairs refreshed`, 'log-ok');
}

// ── BATCH SCAN — scans next N unscanned pairs on each click (C1) ─────
// Genesis spec: "create another button to scan 25 pairs from top unscanned.
// When I want to scan I'll click again." — replaces runaway full scan.
async function trBatchScan() {
  if (TR.batchScanActive || TR.fullScanActive) {
    logTo('tr-log', 'Scan already running', 'log-warn');
    return;
  }
  if (TR.universe.length === 0) {
    logTo('tr-log', 'Load universe first', 'log-warn');
    return;
  }

  // Pick next N unscanned pairs from top of universe
  const unscanned = TR.universe.filter(u => !TR.scanResults[u.symbol]);
  if (unscanned.length === 0) {
    logTo('tr-log', 'All pairs already scanned — use AUTO or REFRESH', 'log-info');
    return;
  }

  const batch = unscanned.slice(0, TR.batchScanSize);
  TR.batchScanActive = true;
  TR.scanAbortFlag   = false;
  const btn = $('tr-batchscan-btn');
  if (btn) { btn.disabled = true; btn.textContent = `0/${batch.length}`; btn.classList.add('scanning-anim'); }

  logTo('tr-log', `Batch scan: ${batch.length} pairs [${TR.tf}] — ${unscanned.length - batch.length} remaining after`, 'log-info');

  let done = 0;
  for (const u of batch) {
    if (TR.scanAbortFlag) {
      logTo('tr-log', 'Batch scan aborted', 'log-warn');
      break;
    }
    await trScanPair(u.symbol);
    done++;
    if (btn) btn.textContent = `${done}/${batch.length}`;
    // Rate-limit guard: honour backoff before next request
    const waitMs = Math.max(RLIM.MIN_DELAY, RLIM.backoffUntil - Date.now());
    await new Promise(r => setTimeout(r, waitMs));
  }

  TR.batchScanActive = false;
  const remaining = TR.universe.filter(u => !TR.scanResults[u.symbol]).length;
  if (btn) {
    btn.disabled = false;
    btn.textContent = remaining > 0 ? `⚡ SCAN +${TR.batchScanSize}` : '⚡ SCAN DONE';
    btn.classList.remove('scanning-anim');
  }
  logTo('tr-log', `Batch done — ${done} scanned · ${remaining} remaining`, 'log-ok');
}

// ── FULL SCAN (abort-capable, rate-limit-aware) ───────────────────────
async function trFullScan() {
  if (TR.fullScanActive || TR.batchScanActive) {
    // If already running, treat button as ABORT
    TR.scanAbortFlag = true;
    logTo('tr-log', 'Full scan ABORT signalled', 'log-warn');
    return;
  }
  if (TR.universe.length === 0) {
    logTo('tr-log', 'Load universe first', 'log-warn');
    return;
  }

  TR.fullScanActive = true;
  TR.scanAbortFlag  = false;
  const btn = $('tr-fullscan-btn');
  if (btn) { btn.disabled = false; btn.textContent = '■ ABORT'; btn.classList.add('scanning-anim'); }

  const total = TR.universe.length;
  logTo('tr-log', `Full scan started — ${total} pairs [${TR.tf}] · click ABORT to stop`, 'log-info');

  let done = 0;
  for (const u of TR.universe) {
    if (TR.scanAbortFlag) {
      logTo('tr-log', `Full scan aborted at ${done}/${total}`, 'log-warn');
      break;
    }
    await trScanPair(u.symbol);
    done++;
    if (done % 10 === 0) {
      logTo('tr-log', `Full scan: ${done}/${total} (${Math.round(done/total*100)}%)`, 'log-info');
      if (btn) btn.textContent = `■ ${done}/${total}`;
    }
    // Rate-limit guard: honour backoff before next request
    const waitMs = Math.max(RLIM.MIN_DELAY, RLIM.backoffUntil - Date.now());
    await new Promise(r => setTimeout(r, waitMs));
  }

  TR.fullScanActive = false;
  if (btn) { btn.disabled = false; btn.textContent = '⚡ FULL SCAN'; btn.classList.remove('scanning-anim'); }
  if (!TR.scanAbortFlag) logTo('tr-log', `Full scan complete — ${total} pairs`, 'log-ok');
}

// ══════════════════════════════════════════════════════════════════
// MODULE: MACRO SIGNALS
// ══════════════════════════════════════════════════════════════════
const MC = {
  // No long-lived resources beyond APP.macroData — no timers to own here
};

async function fetchMacroData(force = false) {
  if (!APP.macroServerOnline) {
    logTo('macro-log', 'Macro server offline', 'log-warn');
    return;
  }

  logTo('macro-log', `Fetching macro data${force ? ' (forced)' : ''}...`, 'log-info');
  const url = force ? MACRO_FORCE : MACRO_URL;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    APP.macroData      = await res.json();
    APP.macroFetchedAt = Date.now();
    renderMacroGrid(APP.macroData);
    updateRegimePill(APP.macroData.regime);
    updateMacroStaleBadge(); // C5: reset badge after fresh fetch
    logTo('macro-log', `Macro loaded — Regime: ${APP.macroData.regime?.label || '?'}`, 'log-ok');
  } catch (e) {
    logTo('macro-log', `Macro fetch error: ${e.message}`, 'log-err');
  }
}

function updateRegimePill(regime) {
  const pills = [$('nav-regime-pill'), $('global-regime-pill')];
  pills.forEach(pill => {
    if (!pill || !regime) return;
    pill.textContent = `${regime.label} ${regime.score >= 0 ? '+' : ''}${regime.score}`;
    pill.className = pill.className.replace(/risk-on|risk-off|neutral/g, '').trim();
    if (regime.label === 'RISK-ON')  pill.classList.add('risk-on');
    if (regime.label === 'RISK-OFF') pill.classList.add('risk-off');
    if (regime.label === 'NEUTRAL')  pill.classList.add('neutral');
  });

  const badge = $('macro-regime-badge');
  if (badge && regime) {
    badge.textContent = `${regime.label}  ${regime.score >= 0 ? '+' : ''}${regime.score} / ±5`;
    badge.className = 'macro-regime-badge';
    if (regime.label === 'RISK-ON')  badge.classList.add('risk-on');
    if (regime.label === 'RISK-OFF') badge.classList.add('risk-off');
    if (regime.label === 'NEUTRAL')  badge.classList.add('neutral');
  }
}

function renderMacroGrid(d) {
  if (!d) return;

  const scoreEl = $('regime-score');
  if (scoreEl) {
    scoreEl.textContent = `${d.regime.score >= 0 ? '+' : ''}${d.regime.score}`;
    scoreEl.style.color = d.regime.color === 'green' ? 'var(--green)' : d.regime.color === 'red' ? 'var(--red)' : 'var(--yellow)';
  }

  const sigsEl = $('regime-signals');
  if (sigsEl && d.regime.signals) {
    sigsEl.innerHTML = d.regime.signals.map(s => `
      <div class="regime-signal-item">
        <div class="rsi-dot ${s.bias}"></div>
        <span style="color:${s.bias === 'bull' ? 'var(--green)' : 'var(--red)'};">${s.text}</span>
      </div>
    `).join('');
  }

  const cardsEl = $('macro-cards');
  if (!cardsEl) return;

  const cards = [];

  function bias(val, bullCond, bearCond) {
    if (bullCond) return 'bull';
    if (bearCond) return 'bear';
    return 'neutral-card';
  }

  const dxy = d.fred?.dxy;
  if (dxy?.value) {
    cards.push({
      label: 'DXY — Broad USD Index',
      value: dxy.value?.toFixed(2),
      delta: dxy.delta,
      note:  `Direction: ${dxy.dir || '—'} · As of ${dxy.asOf || '—'}`,
      cls:   bias(null, dxy.dir === 'falling', dxy.dir === 'rising'),
      err:   dxy.error,
    });
  }

  const y10 = d.fred?.y10;
  if (y10?.value) {
    cards.push({
      label: '10Y Treasury Yield',
      value: y10.value?.toFixed(2) + '%',
      delta: y10.delta,
      note:  `Zone: ${y10.zone || '—'}`,
      cls:   bias(null, y10.zone === 'low', y10.zone === 'high'),
      err:   y10.error,
    });
  }

  const curve = d.fred?.curve;
  if (curve?.value != null) {
    cards.push({
      label: '10Y−2Y Yield Spread',
      value: curve.value?.toFixed(2) + '%',
      delta: curve.delta,
      note:  `Status: ${curve.status || '—'}`,
      cls:   bias(null, curve.status === 'normal', curve.inverted),
      err:   curve.error,
    });
  }

  const fed = d.fred?.fed;
  if (fed?.value) {
    cards.push({
      label: 'Fed Funds Rate',
      value: fed.value?.toFixed(2) + '%',
      delta: fed.delta,
      note:  `Cycle: ${fed.cycle || '—'}`,
      cls:   bias(null, fed.cycle === 'cutting', fed.cycle === 'hiking'),
      err:   fed.error,
    });
  }

  const gold = d.metals?.gold;
  if (gold?.price) {
    cards.push({
      label: 'Gold (XAU) — $/toz',
      value: '$' + gold.price?.toFixed(0),
      delta: null,
      note:  'Safe haven asset',
      cls:   'neutral-card',
      err:   null,
    });
  }

  const silver = d.metals?.silver;
  if (silver?.price) {
    cards.push({
      label: 'Silver (XAG) — $/toz',
      value: '$' + silver.price?.toFixed(2),
      delta: null,
      note:  'Industrial & safe haven',
      cls:   'neutral-card',
      err:   null,
    });
  }

  const wti = d.oil?.wti;
  if (wti?.value) {
    cards.push({
      label: 'WTI Crude Oil — $/bbl',
      value: '$' + wti.value?.toFixed(2),
      delta: wti.delta,
      note:  `As of ${wti.asOf || '—'}`,
      cls:   'neutral-card',
      err:   wti.error,
    });
  }

  const fg = d.sentiment?.fearGreed;
  if (fg?.value != null) {
    cards.push({
      label: 'Fear & Greed Index',
      value: fg.value,
      delta: null,
      note:  fg.label || '—',
      cls:   bias(null, fg.value >= 60, fg.value < 30),
      err:   fg.error,
    });
  }

  const btcD = d.crypto?.btcDominance;
  if (btcD?.value != null) {
    cards.push({
      label: 'BTC Dominance',
      value: btcD.value?.toFixed(1) + '%',
      delta: null,
      note:  btcD.value > 55 ? 'Alts weak — capital in BTC' : btcD.value < 45 ? 'Alt season appetite' : 'Balanced',
      cls:   bias(null, btcD.value < 45, btcD.value > 55),
      err:   null,
    });
  }

  cardsEl.innerHTML = cards.map(c => `
    <div class="macro-card ${c.cls}">
      <div class="mc-label">${c.label}</div>
      ${c.err
        ? `<div class="mc-error">⚠ ${c.err}</div>`
        : `<div class="mc-value">${c.value ?? '—'}</div>`
      }
      ${c.delta != null ? `<div class="mc-delta ${c.delta >= 0 ? 'cell-pos' : 'cell-neg'}">${c.delta >= 0 ? '+' : ''}${c.delta?.toFixed(4)}</div>` : ''}
      <div class="mc-note">${c.note}</div>
    </div>
  `).join('');

  const footer = $('macro-footer');
  if (footer) footer.textContent = `Last updated: ${new Date(d.timestamp).toLocaleTimeString()}`;

  if (btcD?.value && $('tr-btcd')) $('tr-btcd').textContent = btcD.value.toFixed(1) + '%';
}

// ── Coherence engine ──────────────────────────────────────────────
function computeCoherence(signal, macro) {
  if (!macro || !signal || !signal.dir) return { score:50, verdict:'INSUFFICIENT DATA', color:'neutral', factors:[] };
  const isBull = signal.dir === 'LONG';
  const regime = macro.regime, fred = macro.fred;
  const fg = macro.sentiment?.fearGreed, btcD = macro.crypto?.btcDominance;
  let score = 50; const factors = [];
  if (regime) {
    if (regime.label==='RISK-ON'  && isBull)  { score+=20; factors.push({text:'Regime RISK-ON confirms LONG',bias:'bull'}); }
    if (regime.label==='RISK-OFF' && !isBull) { score+=20; factors.push({text:'Regime RISK-OFF confirms SHORT',bias:'bull'}); }
    if (regime.label==='RISK-ON'  && !isBull) { score-=15; factors.push({text:'Regime RISK-ON conflicts SHORT',bias:'bear'}); }
    if (regime.label==='RISK-OFF' && isBull)  { score-=15; factors.push({text:'Regime RISK-OFF conflicts LONG',bias:'bear'}); }
  }
  const dxy = fred?.dxy;
  if (dxy?.dir) {
    if (dxy.dir==='falling'&& isBull)  { score+=8;  factors.push({text:'DXY falling — crypto-positive',bias:'bull'}); }
    if (dxy.dir==='rising' &&!isBull)  { score+=8;  factors.push({text:'DXY rising — crypto-negative',bias:'bull'}); }
    if (dxy.dir==='rising' && isBull)  { score-=8;  factors.push({text:'DXY rising — LONG headwind',bias:'bear'}); }
    if (dxy.dir==='falling'&&!isBull)  { score-=8;  factors.push({text:'DXY falling — SHORT tailwind conflict',bias:'bear'}); }
  }
  if (fg?.value!=null) {
    if (fg.value<25 && isBull)  { score+=10; factors.push({text:`F&G ${fg.value} — extreme fear, contrarian LONG`,bias:'bull'}); }
    if (fg.value>75 &&!isBull)  { score+=10; factors.push({text:`F&G ${fg.value} — extreme greed, contrarian SHORT`,bias:'bull'}); }
    if (fg.value>75 && isBull)  { score-=5;  factors.push({text:`F&G ${fg.value} — extreme greed, LONG caution`,bias:'bear'}); }
    if (fg.value<25 &&!isBull)  { score-=5;  factors.push({text:`F&G ${fg.value} — extreme fear, SHORT caution`,bias:'bear'}); }
  }
  if (btcD?.value!=null) {
    if (btcD.value<45 && isBull)  { score+=7; factors.push({text:`BTC.D ${btcD.value.toFixed(1)}% — alt season`,bias:'bull'}); }
    if (btcD.value>55 && isBull)  { score-=7; factors.push({text:`BTC.D ${btcD.value.toFixed(1)}% — alts weak`,bias:'bear'}); }
  }
  const y10 = fred?.y10;
  if (y10?.zone) {
    if (y10.zone==='high'&& isBull) { score-=5; factors.push({text:`10Y ${y10.value.toFixed(2)}% — risk-off pressure`,bias:'bear'}); }
    if (y10.zone==='low' && isBull) { score+=5; factors.push({text:`10Y ${y10.value.toFixed(2)}% — liquidity-positive`,bias:'bull'}); }
  }
  score = Math.min(Math.max(score,0),100);
  let verdict,color;
  if (score>=70)      { verdict='CONFIRMED'; color='confirm'; }
  else if (score>=50) { verdict='PARTIAL';   color='neutral'; }
  else if (score>=35) { verdict='WEAK';      color='neutral'; }
  else                { verdict='CONFLICT';  color='conflict'; }
  return { score, verdict, color, factors };
}

// ══════════════════════════════════════════════════════════════════
// MODULE: WATCHDOG v2
// Bybit WSS + REST · Live Candles · Engine v7.0 · Macro Fusion
// ══════════════════════════════════════════════════════════════════

const BYBIT_REST = 'https://api.bybit.com/v5';
const BYBIT_WSS  = 'wss://stream.bybit.com/v5/public/linear';
const BYBIT_INTERVAL = { '1m':'1','5m':'5','15m':'15','1h':'60','4h':'240','1d':'D' };
const TF_MS = { '1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000 };

const WD = {
  pair:             'BTCUSDT',
  tf:               '1h',
  ws:               null,
  wsPair:           null,
  tickerData:       {},
  candles:          [],
  candleCdownTimer: null,
  lastCandleTs:     0,
  lastScanResult:   null,
  alarms:           [],
  alarmCheckTimer:  null,
};

// ── TF SET ────────────────────────────────────────────────────────
function wdSetTF(btn) {
  document.querySelectorAll('#screen-watchdog .tf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  WD.tf = btn.dataset.tf;
  if ($('wd-tf-label')) $('wd-tf-label').textContent = WD.tf.toUpperCase();
  lsSave(LS_KEYS.trTF, WD.tf); // T3: persist WD TF (shares key with TR TF intentionally)
  if (WD.pair) wdFetchBybitCandles(WD.pair, WD.tf);
}

// ── PAIR DATALIST ─────────────────────────────────────────────────
function wdPopulatePairDropdown() {
  const dl = document.getElementById('wd-pair-datalist');
  if (!dl) return;
  const pairs = TR.universe.length > 0
    ? TR.universe.map(u => u.symbol)
    : ['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LTCUSDT','LINKUSDT','DOTUSDT','UNIUSDT'];
  dl.innerHTML = pairs.map(p => `<option value="${p}">`).join('');
}

// ── T8: WATCHDOG QUICK-SWITCH ────────────────────────────────────
// Cycles through watchlist pairs. Falls back to universe top-10 if
// watchlist is empty so keyboard nav always works.
function wdGetNavList() {
  return WL.pairs.length > 0
    ? WL.pairs
    : TR.universe.slice(0, 10).map(u => u.symbol);
}

function wdNavPrev() {
  const list = wdGetNavList();
  if (list.length === 0) return;
  const idx = list.indexOf(WD.pair);
  const next = idx <= 0 ? list[list.length - 1] : list[idx - 1];
  openWatchdog(next);
}

function wdNavNext() {
  const list = wdGetNavList();
  if (list.length === 0) return;
  const idx = list.indexOf(WD.pair);
  const next = idx < 0 || idx >= list.length - 1 ? list[0] : list[idx + 1];
  openWatchdog(next);
}

// Keyboard shortcuts: [ = prev, ] = next, R = re-scan, Escape = back to TradeRecon
document.addEventListener('keydown', (e) => {
  if (APP.currentScreen !== 'watchdog') return;
  // Ignore if user is typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === '[')         { e.preventDefault(); wdNavPrev(); }
  if (e.key === ']')         { e.preventDefault(); wdNavNext(); }
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); wdRunScan(); }
  if (e.key === 'Escape')    { e.preventDefault(); switchModule('traderecon'); }
});

// ── BYBIT WSS ─────────────────────────────────────────────────────
function wdConnectWSS(symbol) {
  if (WD.ws && WD.ws.readyState === WebSocket.OPEN && WD.wsPair === symbol) return;

  if (WD.ws) {
    try {
      if (WD.ws._pingTimer) clearInterval(WD.ws._pingTimer);
      WD.ws.onclose = null; // prevent stale reconnect firing
      WD.ws.close();
    } catch(e) {}
    WD.ws = null;
  }

  wdSetWSState('connecting');
  logTo('wd-log', `[WSS] Connecting Bybit — ${symbol}`, 'log-info');

  try {
    WD.ws = new WebSocket(BYBIT_WSS);
  } catch(e) {
    wdSetWSState('error');
    logTo('wd-log', `[WSS] WebSocket unavailable: ${e.message}`, 'log-err');
    return;
  }

  WD.ws.onopen = () => {
    WD.wsPair = symbol;
    wdSetWSState('live');
    WD.ws.send(JSON.stringify({ op: 'subscribe', args: [`tickers.${symbol}`] }));
    logTo('wd-log', `[WSS] LIVE — subscribed tickers.${symbol}`, 'log-ok');
    WD.ws._pingTimer = setInterval(() => {
      if (WD.ws && WD.ws.readyState === WebSocket.OPEN)
        WD.ws.send(JSON.stringify({ op: 'ping' }));
    }, 20000);
  };

  WD.ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.op === 'subscribe' || msg.op === 'pong') return;
      if (!msg.topic || !msg.data) return;
      const sym = msg.topic.replace('tickers.', '');
      if (sym !== WD.pair) return;
      wdApplyTickerDelta(msg.data);
    } catch(e) {}
  };

  WD.ws.onerror = () => {
    wdSetWSState('error');
    logTo('wd-log', '[WSS] ERROR', 'log-err');
  };

  WD.ws.onclose = () => {
    wdSetWSState('offline');
    if (WD.ws && WD.ws._pingTimer) clearInterval(WD.ws._pingTimer);
    logTo('wd-log', '[WSS] CLOSED — will reconnect in 8s', 'log-warn');
    // Only reconnect if the close was not triggered by onModuleLeave
    // (onModuleLeave sets ws.onclose = null before closing)
    setTimeout(() => {
      if (APP.currentScreen === 'watchdog' && WD.pair) {
        wdConnectWSS(WD.pair);
      }
    }, 8000);
  };
}

function wdSetWSState(state) {
  const dot   = $('wd-ws-dot');
  const label = $('wd-ws-label');
  const states = {
    live:       { cls: 'ws-dot live',       txt: 'BYBIT LIVE' },
    connecting: { cls: 'ws-dot connecting', txt: 'CONNECTING' },
    error:      { cls: 'ws-dot error',      txt: 'WSS ERR' },
    offline:    { cls: 'ws-dot',            txt: 'BYBIT OFF' },
  };
  const s = states[state] || states.offline;
  if (dot)   dot.className    = s.cls;
  if (label) label.textContent = s.txt;
}

function wdApplyTickerDelta(d) {
  const S = WD.tickerData;
  const prevPrice = S.price || 0;
  if (d.lastPrice)    S.price    = parseFloat(d.lastPrice);
  if (d.price24hPcnt) S.pct24h   = parseFloat(d.price24hPcnt);
  if (d.markPrice)    S.mark     = parseFloat(d.markPrice);
  if (d.indexPrice)   S.index    = parseFloat(d.indexPrice);
  if (d.highPrice24h) S.high     = parseFloat(d.highPrice24h);
  if (d.lowPrice24h)  S.low      = parseFloat(d.lowPrice24h);
  if (d.volume24h)    S.vol      = parseFloat(d.volume24h);
  if (d.turnover24h)  S.turnover = parseFloat(d.turnover24h);
  if (d.bid1Price)    S.bid      = parseFloat(d.bid1Price);
  if (d.ask1Price)    S.ask      = parseFloat(d.ask1Price);
  if (d.fundingRate)  S.funding  = parseFloat(d.fundingRate);
  if (d.openInterest) S.oi       = parseFloat(d.openInterest);
  S.prevPrice = prevPrice;
  wdRenderLiveTicker();
}

// ── BYBIT REST ────────────────────────────────────────────────────
async function wdFetchBybitTicker(symbol) {
  try {
    const r = await fetch(`${BYBIT_REST}/market/tickers?category=linear&symbol=${symbol}`);
    const j = await r.json();
    if (j.retCode !== 0) { logTo('wd-log', `[REST] Ticker err: ${j.retMsg}`, 'log-warn'); return; }
    const d = j.result.list[0];
    if (!d) return;
    const S = WD.tickerData;
    S.prevPrice = S.price || 0;
    S.price     = parseFloat(d.lastPrice);
    S.pct24h    = parseFloat(d.price24hPcnt);
    S.mark      = parseFloat(d.markPrice   || d.lastPrice);
    S.index     = parseFloat(d.indexPrice  || d.lastPrice);
    S.high      = parseFloat(d.highPrice24h);
    S.low       = parseFloat(d.lowPrice24h);
    S.vol       = parseFloat(d.volume24h);
    S.turnover  = parseFloat(d.turnover24h);
    S.bid       = parseFloat(d.bid1Price);
    S.ask       = parseFloat(d.ask1Price);
    S.funding   = parseFloat(d.fundingRate || 0);
    S.oi        = parseFloat(d.openInterest || 0);
    wdRenderLiveTicker();

    if ($('wd-price-label')) $('wd-price-label').textContent = fmtP(S.price);
    if ($('wd-mark-label'))  $('wd-mark-label').textContent  = fmtP(S.mark);
    const pctSign = S.pct24h >= 0 ? '+' : '';
    if ($('wd-pct-label')) {
      $('wd-pct-label').textContent = `${pctSign}${(S.pct24h * 100).toFixed(2)}%`;
      $('wd-pct-label').style.color = S.pct24h >= 0 ? 'var(--green)' : 'var(--red)';
    }
    if ($('wd-fund-label')) {
      $('wd-fund-label').textContent = `${(S.funding * 100).toFixed(4)}%`;
      $('wd-fund-label').style.color = S.funding > 0 ? 'var(--green)' : S.funding < 0 ? 'var(--red)' : 'var(--text3)';
    }
    if ($('wd-oi-label')) $('wd-oi-label').textContent = fmtBig(S.oi);
  } catch(e) {
    logTo('wd-log', `[REST] Ticker fail: ${e.message}`, 'log-warn');
  }
}

async function wdFetchBybitCandles(symbol, tf) {
  const interval = BYBIT_INTERVAL[tf] || '60';
  try {
    const r = await fetch(`${BYBIT_REST}/market/kline?category=linear&symbol=${symbol}&interval=${interval}&limit=9`);
    const j = await r.json();
    if (j.retCode !== 0) { logTo('wd-log', `[REST] Kline err: ${j.retMsg}`, 'log-warn'); return; }
    const raw = j.result.list.slice().reverse();
    if (!raw || raw.length < 2) {
      logTo('wd-log', `[REST] Kline: not enough data (${raw?.length||0} candles)`, 'log-warn');
      return;
    }
    const closed = raw.slice(0, raw.length - 1).slice(-8);
    const latest = raw[raw.length - 1];

    WD.candles = closed;
    const latestTs = parseInt(latest[0]);

    if (WD.lastCandleTs > 0 && latestTs > WD.lastCandleTs) {
      logTo('wd-log', `[CANDLE] ${symbol} ${tf.toUpperCase()} CLOSE @ $${fmtP(parseFloat(raw[raw.length-2][4]))}`, 'log-ok');
    }
    WD.lastCandleTs = latestTs;

    wdRenderCandleStrip(closed, latest, tf);
    wdStartCandleCountdown(latestTs, tf);
    if ($('wd-candle-tf'))      $('wd-candle-tf').textContent = tf.toUpperCase();
    if ($('wd-candle-updated')) $('wd-candle-updated').textContent = `Updated ${nowTime()}`;
    logTo('wd-log', `[CANDLES] ${symbol} ${tf.toUpperCase()} — ${closed.length} candles loaded`, 'log-ok');
  } catch(e) {
    logTo('wd-log', `[REST] Kline fail: ${e.message}`, 'log-warn');
  }
}

function wdForceCandles() {
  if (WD.pair) wdFetchBybitCandles(WD.pair, WD.tf);
}

// ── CANDLE COUNTDOWN ──────────────────────────────────────────────
function wdStartCandleCountdown(candleOpenTs, tf) {
  clearInterval(WD.candleCdownTimer);
  const tfMs = TF_MS[tf] || 3600000;

  function tick() {
    const elapsed   = Date.now() - candleOpenTs;
    const remaining = Math.max(0, tfMs - (elapsed % tfMs));
    const s = Math.floor(remaining / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    let str;
    if (h > 0) str = `${h}h ${m % 60}m`;
    else if (m > 0) str = `${m}m ${s % 60}s`;
    else str = `${s}s`;
    if ($('wd-candle-cdown')) $('wd-candle-cdown').textContent = str;
    if (remaining < 1000 && WD.pair) {
      setTimeout(() => wdFetchBybitCandles(WD.pair, WD.tf), 1500);
    }
  }

  tick();
  WD.candleCdownTimer = setInterval(tick, 1000);
}

// ── RENDER: LIVE TICKER ───────────────────────────────────────────
function wdRenderLiveTicker() {
  const S = WD.tickerData;
  if (!S.price) return;

  const priceBig = $('wd-price-big');
  if (priceBig) {
    priceBig.textContent = fmtP(S.price);
    if (S.prevPrice && S.price !== S.prevPrice) {
      priceBig.classList.remove('up', 'down');
      priceBig.classList.add(S.price > S.prevPrice ? 'up' : 'down');
      setTimeout(() => { if(priceBig) priceBig.classList.remove('up','down'); }, 600);
    }
    const ring = $('wd-ring-circle');
    if (ring && S.price !== S.prevPrice) {
      ring.style.fill = S.price > S.prevPrice ? 'rgba(0,245,160,0.5)' : 'rgba(255,45,85,0.5)';
      setTimeout(() => { if(ring) ring.style.fill = 'rgba(0,212,255,0.3)'; }, 400);
    }
  }

  if ($('wd-bid-ask')) {
    $('wd-bid-ask').textContent = `BID ${S.bid ? fmtP(S.bid) : '—'} · ASK ${S.ask ? fmtP(S.ask) : '—'}`;
  }

  const meta = [
    { id: 'wd-high',     val: S.high     ? fmtP(S.high)           : '—' },
    { id: 'wd-low',      val: S.low      ? fmtP(S.low)            : '—' },
    { id: 'wd-vol',      val: S.vol      ? fmtBig(S.vol)          : '—' },
    { id: 'wd-turnover', val: S.turnover ? '$'+fmtBig(S.turnover) : '—' },
    { id: 'wd-spread',   val: S.bid && S.ask ? ((S.ask-S.bid)/S.bid*100).toFixed(4)+'%' : '—' },
    { id: 'wd-index',    val: S.index    ? fmtP(S.index)          : '—' },
  ];
  meta.forEach(m => { if ($(m.id)) $(m.id).textContent = m.val; });
}

// ── RENDER: CANDLE STRIP ──────────────────────────────────────────
function wdRenderCandleStrip(candles, forming, tf) {
  const strip = $('wd-candle-strip');
  if (!strip) return;
  if (!candles || candles.length === 0) {
    strip.innerHTML = '<div class="wdv2-empty">No candle data</div>';
    return;
  }

  const all   = [...candles, forming].filter(Boolean);
  const highs = all.map(c => parseFloat(c[2]));
  const lows  = all.map(c => parseFloat(c[3]));
  const maxH  = Math.max(...highs);
  const minL  = Math.min(...lows);
  const range = maxH - minL || 1;
  const HEIGHT = 60;

  function tsLabel(ts, tf) {
    const d = new Date(parseInt(ts));
    if (tf === '1d') return d.toLocaleDateString('en-GB', { month:'short', day:'numeric' });
    return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
  }

  let html = '';
  all.forEach((c, i) => {
    const isForming = i === all.length - 1;
    const o = parseFloat(c[1]), h = parseFloat(c[2]), l = parseFloat(c[3]), cl = parseFloat(c[4]);
    const bull = cl >= o;

    const bodyTop  = ((maxH - Math.max(o, cl)) / range) * HEIGHT;
    const bodyH    = Math.max(2, ((Math.abs(cl - o)) / range) * HEIGHT);
    const wickTop  = ((maxH - h) / range) * HEIGHT;
    const wickH    = ((h - l) / range) * HEIGHT;

    const color     = bull ? 'var(--green)' : 'var(--red)';
    const bodyAlpha = isForming ? '0.5' : '0.85';
    const wrapCls   = isForming ? 'wdc-wrap latest' : 'wdc-wrap';
    const pctChg    = ((cl - o) / o * 100);
    const pctStr    = `${pctChg >= 0 ? '+' : ''}${pctChg.toFixed(2)}%`;

    html += `
      <div class="${wrapCls}" title="O:${fmtP(o)} H:${fmtP(h)} L:${fmtP(l)} C:${fmtP(cl)} V:${fmtBig(parseFloat(c[5]))}">
        <div class="wdc-bar-area">
          <div class="wdc-wick" style="top:${wickTop.toFixed(1)}px;height:${wickH.toFixed(1)}px"></div>
          <div class="wdc-body" style="top:${bodyTop.toFixed(1)}px;height:${bodyH.toFixed(1)}px;background:${color};opacity:${bodyAlpha}"></div>
        </div>
        <div class="wdc-label">${isForming ? '▸' : tsLabel(c[0], tf)}</div>
        <div class="wdc-price" style="color:${bull ? 'var(--green)' : 'var(--red)'}">${pctStr}</div>
      </div>
    `;
  });

  strip.innerHTML = html;

  const stats = $('wd-candle-stats');
  if (stats && candles.length > 0) {
    const last     = candles[candles.length - 1];
    const avgVol   = candles.reduce((s, c) => s + parseFloat(c[5]), 0) / candles.length;
    const lastVol  = parseFloat(last[5]);
    const volRatio = (lastVol / avgVol).toFixed(2);
    const bullCount = candles.filter(c => parseFloat(c[4]) >= parseFloat(c[1])).length;
    const bearCount = candles.length - bullCount;
    const clLast  = parseFloat(last[4]);
    const clFirst = parseFloat(candles[0][4]);
    const netChg  = ((clLast - clFirst) / clFirst * 100).toFixed(2);

    stats.innerHTML = `
      <span class="wdcs-item">BULL<span class="wdcs-val" style="color:var(--green)">${bullCount}</span></span>
      <span class="wdcs-item">BEAR<span class="wdcs-val" style="color:var(--red)">${bearCount}</span></span>
      <span class="wdcs-item">AVG VOL<span class="wdcs-val">${fmtBig(avgVol)}</span></span>
      <span class="wdcs-item">VOL RATIO<span class="wdcs-val" style="color:${volRatio>1.5?'var(--green)':volRatio<0.7?'var(--red)':'var(--text1)'}">${volRatio}×</span></span>
      <span class="wdcs-item">NET (8C)<span class="wdcs-val" style="color:${netChg>=0?'var(--green)':'var(--red)'}">${netChg>=0?'+':''}${netChg}%</span></span>
    `;
  }
}

// ── ALARM SYSTEM ──────────────────────────────────────────────────
function wdStartAlarmCheck() {
  clearInterval(WD.alarmCheckTimer);
  WD.alarmCheckTimer = setInterval(wdCheckAlarms, 2000);
}

function wdCheckAlarms() {
  const S = WD.tickerData;
  if (!S.price) return;
  WD.alarms.forEach(a => {
    if (a.triggered) return;
    let hit = false;
    if (a.type === 'price') {
      hit = a.dir === 'above' ? S.price >= a.value : S.price <= a.value;
    } else if (a.type === 'entry_agg') {
      hit = true;
    } else if (a.type === 'entry_pat') {
      hit = a.dir === 'LONG' ? S.price <= a.value : S.price >= a.value;
    }
    if (hit) {
      a.triggered = true;
      logTo('wd-log', `🔔 ALARM TRIGGERED: ${a.label} @ ${fmtP(a.value)}`, 'log-ok');
      wdRenderAlarms();
      if (Notification.permission === 'granted') {
        new Notification(`VIVIENNE · ${WD.pair}`, { body: `${a.label} @ ${fmtP(a.value)}` });
      }
    }
  });
}

function wdAddAlarm(type, value, dir, label) {
  const id = Date.now();
  WD.alarms.push({ id, type, value, dir, label, triggered: false });
  wdRenderAlarms();
  wdStartAlarmCheck();
  logTo('wd-log', `🔔 Alarm set: ${label} @ ${fmtP(value)}`, 'log-info');
}

function wdRemoveAlarm(id) {
  WD.alarms = WD.alarms.filter(a => a.id !== id);
  wdRenderAlarms();
}

function wdClearAlarms() {
  WD.alarms = [];
  wdRenderAlarms();
}

function wdRenderAlarms() {
  const box = $('wd-alarm-list');
  if (!box) return;
  if (WD.alarms.length === 0) {
    box.innerHTML = '<div class="wda-empty">No alarms set</div>';
    return;
  }
  box.innerHTML = WD.alarms.map(a => {
    const cls = a.triggered ? 'wda-item triggered' : 'wda-item armed';
    return `
      <div class="${cls}">
        <span class="wda-icon">${a.triggered ? '🔔' : '⏰'}</span>
        <span class="wda-label">${a.label}</span>
        <span class="wda-val">${fmtP(a.value)}</span>
        <span class="wda-status">${a.triggered ? 'HIT' : 'ARMED'}</span>
        <button class="wda-rm" onclick="wdRemoveAlarm(${a.id})">✕</button>
      </div>
    `;
  }).join('');
}

function wdSetAlarmFromScan() {
  const r = WD.lastScanResult;
  if (!r || !r.signal.dir) {
    logTo('wd-log', 'Run scan first to set entry alarms', 'log-warn');
    return;
  }
  const dir = r.signal.dir;
  wdAddAlarm('entry_pat', r.entryFar, dir, `${WD.pair} ${dir} PATIENT ENTRY`);
  wdAddAlarm('price', r.slObj.sl, dir === 'LONG' ? 'below' : 'above', `${WD.pair} SL BREACH`);
  wdAddAlarm('price', r.tp1V, dir === 'LONG' ? 'above' : 'below', `${WD.pair} TP1 HIT`);
  if (Notification.permission === 'default') Notification.requestPermission();
}

// ── DEEP SCAN ─────────────────────────────────────────────────────
async function wdRunScan() {
  const pairInput = $('wd-pair-input');
  WD.pair = (pairInput?.value || 'BTCUSDT').trim().toUpperCase();
  if (!WD.pair) { logTo('wd-log', 'No pair specified', 'log-warn'); return; }

  const useMacro = $('wd-use-macro')?.checked ?? true;
  const useMTF   = $('wd-use-mtf')?.checked ?? true;

  if ($('wd-pair-label'))  $('wd-pair-label').textContent  = WD.pair;
  if ($('wd-tf-label'))    $('wd-tf-label').textContent    = WD.tf.toUpperCase();
  if ($('wd-pair-sub'))    $('wd-pair-sub').textContent    = `${WD.pair} · ${WD.tf.toUpperCase()}`;
  if ($('wd-candle-tf'))   $('wd-candle-tf').textContent   = WD.tf.toUpperCase();

  ['wd-score-bars','wd-gate-pills','wd-price-ladder','wd-ema-levels','wd-mtf-grid','wd-levels-grid','wd-coherence-body','wd-verdict-checklist']
    .forEach(id => { if($(id)) $(id).innerHTML = '<div class="wdv2-empty" style="animation:pulse 0.8s infinite">SCANNING...</div>'; });

  logTo('wd-log', `Deep scan: ${WD.pair} [${WD.tf}]${useMacro?' +MACRO':''}${useMTF?' +MTF':''}`, 'log-info');

  wdFetchBybitTicker(WD.pair);
  wdFetchBybitCandles(WD.pair, WD.tf);
  wdConnectWSS(WD.pair);

  try {
    const baseCfg = TFC[WD.tf];

    // C4: fetch klines + OI + L/S in parallel — OI/LS best-effort (null on failure)
    const [klines, oiData, lsData] = await Promise.all([
      fetchKlines(WD.pair, WD.tf, baseCfg.candles),
      fetchOIData(WD.pair, WD.tf),
      fetchLSData(WD.pair, WD.tf),
    ]);

    // [v2.0] Regime detection — asset-agnostic volatility classification
    // computeRegime + resolveParams are pure engine functions (v7.0).
    // resolved cfg is a NEW object — baseCfg is never mutated.
    const regime     = computeRegime(klines);
    const cfg        = resolveParams(baseCfg, regime);
    logTo('wd-log', `Regime: ${regime} — atrMult ${cfg.atrMult} · minConf ${cfg.minConf}%`, 'log-info');

    const d = analyze(klines, PANEL_OPTS);

    let htfData = null;
    if (cfg.htfReq) {
      try {
        const htfCfg    = TFC[cfg.htfReq];
        const htfKlines = await fetchKlines(WD.pair, cfg.htfReq, htfCfg.candles);
        htfData         = analyze(htfKlines, PANEL_OPTS);
      } catch(e) { logTo('wd-log', `HTF fail: ${e.message}`, 'log-warn'); }
    }

    // C3: real funding from Bybit ticker · C4: OI + L/S unlocked
    const signal = scoreSignal(d, cfg, htfData, WD.tickerData.funding || 0, oiData, lsData);

    const entry  = d.price;
    const slObj  = pickSL(signal.dir || 'LONG', entry, d.sr, d.atr, cfg);
    const isLong = signal.dir === 'LONG';
    const tp1V   = isLong ? entry + d.atr * cfg.tp1 : entry - d.atr * cfg.tp1;
    const tp2V   = isLong ? entry + d.atr * cfg.tp2 : entry - d.atr * cfg.tp2;
    const rrV    = slObj.sl !== entry ? Math.abs((tp2V - entry) / (entry - slObj.sl)) : 0;

    const entryNear = entry;
    const entryFar  = isLong
      ? entry - d.atr * cfg.entryBandMult
      : entry + d.atr * cfg.entryBandMult;

    let mtfRes = null;
    if (useMTF) mtfRes = await wdFetchMTF(WD.pair, WD.tf);

    let coherence = null;
    if (useMacro && APP.macroData) coherence = computeCoherence(signal, APP.macroData);

    WD.lastScanResult = { d, signal, cfg, regime, entry, entryNear, entryFar, slObj, tp1V, tp2V, rrV, mtfRes, coherence };

    wdRenderScoreCard(d, signal, cfg, regime);
    wdRenderRegimeBanner(regime, cfg, baseCfg);
    wdRenderStructure(d, signal, entry, entryNear, entryFar, slObj, tp1V, tp2V);
    wdRenderMTF(mtfRes, WD.tf, signal.dir);
    wdRenderLevels(entry, slObj, tp1V, tp2V, rrV, cfg, signal.dir, d, regime);
    wdRenderCoherence(coherence);
    wdRenderVerdict(signal, d, cfg, mtfRes, slObj, rrV, coherence, regime);

    logTo('wd-log', `${WD.pair}: ${signal.dir||'NO DIR'} | ${signal.signalState} | ${signal.score.toFixed(0)}% | regime:${regime} | coh:${coherence?.verdict||'N/A'}`, signal.dir ? 'log-ok' : 'log-warn');

  } catch(e) {
    logTo('wd-log', `Scan error: ${e.message}`, 'log-err');
    console.error('[WD]', e);
  }
}

// ── MTF FETCH ─────────────────────────────────────────────────────
async function wdFetchMTF(symbol, primaryTF) {
  const MTF_WINDOWS = {
    '1m':['1m','5m','15m','1h'], '5m':['5m','15m','1h','4h'],
    '15m':['15m','1h','4h','1d'], '1h':['15m','1h','4h','1d'],
    '4h':['1h','4h','1d','1d'],   '1d':['4h','1d','1d','1d'],
  };
  const tfs    = MTF_WINDOWS[primaryTF] || ['15m','1h','4h','1d'];
  const unique = [...new Set(tfs)];
  const results = {};
  await Promise.allSettled(unique.map(async tf => {
    try {
      const c   = TFC[tf];
      const kl  = await fetchKlines(symbol, tf, c.candles);
      const d   = analyze(kl, { useEMA200:true, useStructure:false, useDivergence:false, useSqueeze:false, useCrossEvents:false, useWyckoff:false, useCVD:false });
      results[tf] = scoreSignal(d, c, null, 0);
    } catch(e) { results[tf] = null; }
  }));
  return { tfs, results };
}

// ── RENDER: SCORE CARD ────────────────────────────────────────────
function wdRenderScoreCard(d, signal, cfg, regime='NORMAL') {
  const dir        = signal.dir;
  const scoreColor = dir === 'LONG' ? 'var(--green)' : dir === 'SHORT' ? 'var(--red)' : 'var(--text4)';

  const dirBadge = $('wd-score-dir-badge');
  if (dirBadge) {
    const stateMap = {
      LONG:'sig-long', SHORT:'sig-short', WATCH:'sig-watch',
      HUNT:'sig-hunt', FORMING:'sig-forming', EXTENDED:'sig-extended',
      CHOP:'sig-chop', WAIT:'sig-wait',
    };
    dirBadge.className = `sig-badge ${stateMap[signal.signalState]||'sig-wait'}`;
    dirBadge.textContent = `${dir||'—'} · ${signal.signalState||'WAIT'}`;
  }

  const sc = signal.sc || {};
  const bars = [
    { section: 'CORE SIGNALS', items: [
      { lbl:'EMA Stack', val:sc.ema,     max:25 },
      { lbl:'MACD',      val:sc.macd,    max:20 },
      { lbl:'RSI',       val:sc.rsi,     max:15 },
      { lbl:'StochRSI',  val:sc.stoch,   max:12 },
      { lbl:'Volume',    val:sc.vol,     max:10 },
      { lbl:'Pattern',   val:sc.pattern, max:15 },
    ]},
    { section: 'STRUCTURE', items: [
      { lbl:'HTF Filter', val:sc.htf,       max:20 },
      { lbl:'EMA200',     val:sc.e200,      max:10 },
      { lbl:'BoS',        val:sc.bos,       max:10 },
      { lbl:'Structure',  val:sc.structure, max:12 },
      { lbl:'Divergence', val:sc.divergence,max:12 },
    ]},
    { section: 'ADVANCED', items: [
      { lbl:'Squeeze',    val:sc.squeeze,      max:10  },
      { lbl:'Cross Prox', val:sc.crossProx,    max:7   },
      { lbl:'Wyckoff',    val:sc.wyckoff,      max:8   },
      { lbl:'CVD Div',    val:sc.cvdDiv,       max:8   },
      { lbl:'OI Div',     val:sc.oiDiv,        max:8   },
      { lbl:'L/S Ratio',  val:sc.lsRatio,      max:12  },
      { lbl:'Absorption', val:sc.absorption,   max:18  }, // [v1.0] engine v6.0
      { lbl:'POC Drift',  val:sc.pocMigration, max:10  }, // [v1.0] engine v6.0
      { lbl:'Setup',      val:sc.setup,        max:15  }, // [v8.0] strategy archetype boost
    ]},
  ];

  let html = '';
  bars.forEach(section => {
    html += `<div class="wd-sbar-section-lbl">${section.section}</div>`;
    section.items.forEach(b => {
      const v = b.val || 0;
      const pct = b.max > 0 ? Math.max(0, Math.min(100, (v / b.max) * 100)) : 0;
      const col = v > 0 ? scoreColor : v < 0 ? 'var(--red)' : 'var(--text4)';
      html += `
        <div class="wd-sbar-row">
          <span class="wd-sbar-lbl">${b.lbl}</span>
          <div class="wd-sbar-track">
            <div class="wd-sbar-fill" style="width:${pct.toFixed(1)}%;background:${col}"></div>
          </div>
          <span class="wd-sbar-val" style="color:${col}">${v > 0 ? '+' : ''}${v || 0}</span>
          <span class="wd-sbar-max">/${b.max}</span>
        </div>
      `;
    });
  });
  if ($('wd-score-bars')) $('wd-score-bars').innerHTML = html;

  const tot = $('wd-score-total');
  if (tot) { tot.textContent = `${signal.score.toFixed(0)}%`; tot.style.color = scoreColor; }

  const pills = [];
  if (signal.adxChop)        pills.push({ cls:'wdgp-warn', txt:'ADX CHOP' });
  if (!dir)                  pills.push({ cls:'wdgp-fail', txt:'NO DIR' });
  if (signal.extended)       pills.push({ cls:'wdgp-ext',  txt:'EXTENDED' });
  if (signal.fundMod < -10)  pills.push({ cls:'wdgp-fail', txt:`FUND ${signal.fundMod}pts` });
  if (signal.score >= cfg.minConf && dir) pills.push({ cls:'wdgp-ok',   txt:`CONF ✓ ${signal.score.toFixed(0)}%` });
  else if (dir)              pills.push({ cls:'wdgp-fail', txt:`LOW CONF ${signal.score.toFixed(0)}%` });
  // [v2.0] Regime badge — always shown, color-coded by tier
  const regimeCls = { LOW:'wdgp-regime-low', NORMAL:'wdgp-regime-normal', ELEVATED:'wdgp-regime-elevated', CHAOS:'wdgp-regime-chaos' }[regime] || 'wdgp-regime-normal';
  pills.push({ cls: regimeCls, txt: `${regime}` });

  // [v8.0] Setup archetype badge — shown when a named strategy matched
  if (signal.setupType) {
    pills.push({ cls: 'wdgp-setup', txt: `◈ ${signal.setupType.label.toUpperCase()}` });
  }

  // [v8.0] Direction confidence badge — shown when partial EMA alignment
  if (signal.dirResult && signal.dirResult.confidence < 80 && signal.dir) {
    pills.push({ cls: 'wdgp-warn', txt: `DIR ${signal.dirResult.confidence}% CONF` });
  }

  if ($('wd-gate-pills')) $('wd-gate-pills').innerHTML = pills.map(p =>
    `<span class="wd-gate-pill ${p.cls}">${p.txt}</span>`).join('');

  wdRenderPSI(d, signal);
}

// ── RENDER: REGIME BANNER — v2.0 ─────────────────────────────────
// Regime banner — full resolved parameter display.
// Shows every value the engine is ACTUALLY using this scan,
// with delta vs base config so Commander sees exactly what regime changed.
function wdRenderRegimeBanner(regime, resolvedCfg, baseCfg) {
  const el = $('wd-regime-banner');
  if (!el) return;

  const REGIME_COLOR = {
    LOW:      'var(--cyan2)',
    NORMAL:   'var(--text3)',
    ELEVATED: 'var(--yellow)',
    CHAOS:    'var(--red)',
  };
  const REGIME_DESC = {
    LOW:      'Calm — tighter SL · lower gate',
    NORMAL:   'Standard — base config active',
    ELEVATED: 'Elevated — wider SL · raised gate',
    CHAOS:    'Chaos — survival mode',
  };

  const col      = REGIME_COLOR[regime] || 'var(--text3)';
  const desc     = REGIME_DESC[regime]  || '';
  const cbThresh = (CIRCUIT_BREAKER.regimeThresholds || {})[regime] ?? CIRCUIT_BREAKER.maxConsecLoss;

  // Delta helpers — show resolved value + change from base
  const fmtDelta = (resolved, base, unit='', isHigherBad=false) => {
    const delta = +(resolved - base).toFixed(4);
    const deltaStr = delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}${unit}`;
    const col = delta === 0
      ? 'var(--text4)'
      : (isHigherBad ? (delta > 0 ? 'var(--red)' : 'var(--green)')
                     : (delta > 0 ? 'var(--green)' : 'var(--red)'));
    return { resolved, deltaStr, col, changed: delta !== 0 };
  };

  const atr   = fmtDelta(resolvedCfg.atrMult,       baseCfg.atrMult,       '×', false);
  const be    = fmtDelta(resolvedCfg.beMult,         baseCfg.beMult,        '×', false);
  const tp1   = fmtDelta(resolvedCfg.tp1,            baseCfg.tp1,           '×', false);
  const tp2   = fmtDelta(resolvedCfg.tp2,            baseCfg.tp2,           '×', false);
  const conf  = fmtDelta(resolvedCfg.minConf,        baseCfg.minConf,       'pt', true);
  const sconf = fmtDelta(resolvedCfg.minConfShort,   baseCfg.minConfShort,  'pt', true);
  const watch = fmtDelta(resolvedCfg.watchThresh,    baseCfg.watchThresh,   'pt', false);
  const ttl   = resolvedCfg.orderTTLMult ?? 1.0;

  const chip = (label, val, delta, col, title='') => `
    <span class="wd-regime-delta${delta.changed ? ' wd-regime-delta-changed' : ''}" title="${title}">
      <span class="wrd-lbl">${label}</span>
      <span class="wrd-val">${typeof val === 'number' ? val.toFixed(2) : val}</span>
      ${delta.deltaStr ? `<span class="wrd-delta" style="color:${delta.col}">${delta.deltaStr}</span>` : ''}
    </span>`;

  el.innerHTML = `
    <div class="wd-regime-banner wd-regime-${regime.toLowerCase()}">
      <div class="wd-regime-hdr">
        <span class="wd-regime-label" style="color:${col}">${regime}</span>
        <span class="wd-regime-desc">${desc}</span>
        <span class="wd-regime-cb" title="Pause after N consecutive losses in this regime">⚡ CB: ${cbThresh} losses</span>
      </div>
      <div class="wd-regime-deltas">
        ${chip('SL ATR',    atr.resolved,   atr,   '',  'Stop-loss ATR multiplier')}
        ${chip('BE',        be.resolved,    be,    '',  'Break-even activation (× ATR)')}
        ${chip('TP1',       tp1.resolved,   tp1,   '',  'Take-profit 1 ATR multiplier')}
        ${chip('TP2',       tp2.resolved,   tp2,   '',  'Take-profit 2 ATR multiplier')}
        ${chip('LONG gate', conf.resolved+'%', conf, '',  'Min confidence for LONG signal')}
        ${chip('SHORT gate',sconf.resolved+'%',sconf,'', 'Min confidence for SHORT signal')}
        ${chip('WATCH',     watch.resolved+'%',watch,'', 'Watch threshold')}
        ${chip('TTL',       ttl.toFixed(2)+'×', {changed:ttl!==1, deltaStr:ttl!==1?`${ttl>1?'+':''}${((ttl-1)*100).toFixed(0)}%`:'', col:ttl<1?'var(--yellow)':'var(--text4)'}, '', 'Order expiry window multiplier')}
      </div>
    </div>
  `;
}

// ── RENDER: PSI ───────────────────────────────────────────────────
function wdRenderPSI(d, signal) {
  const ps       = d.preSignal || { active:false, reasons:[], maturity:0, score:0 };
  const state    = signal.signalState;
  const psiPanel = $('wd-psi-panel');
  if (!psiPanel) return;

  let panelCls = 'wd-psi-panel';
  let badgeCls = 'wd-psi-badge psb-inactive';
  let badgeTxt = 'INACTIVE';

  if (state === 'WATCH')        { panelCls += ' psi-watch';   badgeCls = 'wd-psi-badge psb-watch';   badgeTxt = 'WATCH'; }
  else if (state === 'FORMING') { panelCls += ' psi-forming'; badgeCls = 'wd-psi-badge psb-forming'; badgeTxt = 'FORMING'; }
  else if (state === 'HUNT')    { panelCls += ' psi-hunt';    badgeCls = 'wd-psi-badge psb-hunt';    badgeTxt = 'HUNT'; }

  psiPanel.className = panelCls;
  if ($('wd-psi-badge')) { $('wd-psi-badge').className = badgeCls; $('wd-psi-badge').textContent = badgeTxt; }

  const matColor = ps.maturity >= 75 ? 'var(--watch)' : ps.maturity >= 50 ? '#aa66ff' : 'var(--cyan2)';
  if ($('wd-mat-fill')) { $('wd-mat-fill').style.width = ps.maturity + '%'; $('wd-mat-fill').style.background = matColor; }
  if ($('wd-mat-pct'))  { $('wd-mat-pct').textContent = ps.maturity + '%'; $('wd-mat-pct').style.color = matColor; }

  if ($('wd-psi-reasons')) {
    $('wd-psi-reasons').innerHTML = (ps.reasons || []).slice(0, 6).map((r, i) =>
      `<div class="wd-psi-reason ${i < 2 ? 'rh' : i < 4 ? 'rm' : ''}">${r}</div>`
    ).join('') || '<div class="wd-psi-reason">No pre-signal activity</div>';
  }

  if ($('wd-cross-events') && d.crossEvents) {
    $('wd-cross-events').innerHTML = d.crossEvents.events.map(e => {
      const isBull = e.dir === 'bull';
      const cls = e.status === 'confirmed'
        ? (isBull ? 'wdcb-conf-bull' : 'wdcb-conf-bear')
        : (isBull ? 'wdcb-form-bull' : 'wdcb-form-bear');
      return `<span class="wd-cross-badge ${cls}">${e.name} ${e.status === 'confirmed' ? '✓' : '~'}</span>`;
    }).join('');
  }
}

// ── RENDER: STRUCTURAL MAP ────────────────────────────────────────
function wdRenderStructure(d, signal, entry, entryNear, entryFar, slObj, tp1V, tp2V) {
  const ladder = $('wd-price-ladder');
  if (!ladder) return;

  const rows  = [];
  const dir   = signal.dir;
  const isLong = dir === 'LONG';

  const dirColor  = dir === 'LONG' ? 'var(--green)' : dir === 'SHORT' ? 'var(--red)' : 'var(--text4)';
  const dirBanner = dir
    ? `<div class="wdl-dir-banner" style="border-color:${dirColor};background:${dir==='LONG'?'rgba(0,245,160,0.06)':'rgba(255,45,85,0.06)'}">
         <span class="wdl-dir-arrow">${dir === 'LONG' ? '▲' : '▼'}</span>
         <span class="wdl-dir-txt" style="color:${dirColor}">${dir}</span>
         <span class="wdl-dir-state">${signal.signalState || ''}</span>
         <span class="wdl-dir-score" style="color:${dirColor}">${signal.score.toFixed(0)}%</span>
       </div>`
    : `<div class="wdl-dir-banner" style="border-color:var(--text4);background:transparent">
         <span class="wdl-dir-txt" style="color:var(--text4)">NO DIRECTION — EMA stack mixed</span>
       </div>`;

  (d.sr?.res || []).slice(0, 3).forEach(r => {
    const pct  = ((r.price - entry) / entry * 100).toFixed(2);
    const dots = [1,2,3].map(i => `<div class="wdl-dot ${i <= r.strength ? 'on' : ''}"></div>`).join('');
    rows.push({ cls:'wdl-res', label:'RESISTANCE', price:r.price, meta:`+${pct}%`, extra:`<div class="wdl-dots">${dots}</div>` });
  });

  if (dir) {
    if (isLong  && tp2V > entry)  rows.push({ cls:'wdl-tp', label:'TP2', price:tp2V, meta:`+${((tp2V-entry)/entry*100).toFixed(2)}%`, extra:'<span class="wdl-tag wdl-tag-tp">TARGET 2</span>' });
    if (!isLong && tp2V < entry)  rows.push({ cls:'wdl-tp', label:'TP2', price:tp2V, meta:`-${((entry-tp2V)/entry*100).toFixed(2)}%`, extra:'<span class="wdl-tag wdl-tag-tp">TARGET 2</span>' });
    if (isLong  && tp1V > entry)  rows.push({ cls:'wdl-tp', label:'TP1', price:tp1V, meta:`+${((tp1V-entry)/entry*100).toFixed(2)}%`, extra:'<span class="wdl-tag wdl-tag-tp">TARGET 1</span>' });
    if (!isLong && tp1V < entry)  rows.push({ cls:'wdl-tp', label:'TP1', price:tp1V, meta:`-${((entry-tp1V)/entry*100).toFixed(2)}%`, extra:'<span class="wdl-tag wdl-tag-tp">TARGET 1</span>' });
  }

  if (dir) {
    rows.push({ cls:'wdl-entry-agg', label:'ENTRY AGG', price:entryNear, meta:'market / aggressive', extra:'<span class="wdl-tag wdl-tag-agg">NOW</span>' });
  }

  if (dir && Math.abs(entryFar - entryNear) > 0) {
    const pct = ((entryFar - entryNear) / entryNear * 100).toFixed(2);
    rows.push({ cls:'wdl-entry-pat', label:'ENTRY PAT', price:entryFar, meta:`${pct}% pullback limit`, extra:'<span class="wdl-tag wdl-tag-pat">LIMIT</span>' });
  }

  rows.sort((a, b) => b.price - a.price);

  let insertedCurrent = false;
  const finalRows = [];
  for (const r of rows) {
    if (!insertedCurrent && r.price <= entry) {
      finalRows.push({ cls:'wdl-current', label:'PRICE', price:entry, meta:'← current', extra:'' });
      finalRows.push({ type:'sep', label:'CURRENT PRICE' });
      insertedCurrent = true;
    }
    finalRows.push(r);
  }
  if (!insertedCurrent) {
    finalRows.push({ cls:'wdl-current', label:'PRICE', price:entry, meta:'← current', extra:'' });
    finalRows.push({ type:'sep', label:'CURRENT PRICE' });
  }

  (d.sr?.sup || []).slice(0, 3).forEach(s => {
    const pct  = ((entry - s.price) / entry * 100).toFixed(2);
    const dots = [1,2,3].map(i => `<div class="wdl-dot ${i <= s.strength ? 'on' : ''}"></div>`).join('');
    finalRows.push({ cls:'wdl-sup', label:'SUPPORT', price:s.price, meta:`-${pct}%`, extra:`<div class="wdl-dots">${dots}</div>` });
  });

  if (dir) {
    finalRows.push({ cls:'wdl-sl', label:'STOP LOSS', price:slObj.sl, meta:`${slObj.source === 'structure' ? 'SR' : 'ATR'}`, extra:'<span class="wdl-tag wdl-tag-sl">INVALIDATION</span>' });
  }

  ladder.innerHTML = dirBanner + finalRows.map(r => {
    if (r.type === 'sep') return `<div class="wdl-sep"><span class="wdl-sep-lbl">${r.label}</span></div>`;
    return `
      <div class="wdl-item ${r.cls}">
        <span class="wdl-label">${r.label}</span>
        <span class="wdl-price">${fmtP(r.price)}</span>
        <span class="wdl-meta">${r.meta}</span>
        ${r.extra}
      </div>
    `;
  }).join('');

  if ($('wd-bos-lbl')) {
    const bos = d.bos || {};
    $('wd-bos-lbl').textContent = bos.bosBull ? 'BoS BULL ✓' : bos.bosBear ? 'BoS BEAR ✓' : 'No BoS';
    $('wd-bos-lbl').style.color = bos.bosBull ? 'var(--green)' : bos.bosBear ? 'var(--red)' : 'var(--text4)';
  }

  const emaEl = $('wd-ema-levels');
  if (emaEl) {
    const emas = [
      { lbl:'EMA9',  val:d.e9   },
      { lbl:'EMA21', val:d.e21  },
      { lbl:'EMA50', val:d.e50  },
      { lbl:'EMA200',val:d.e200 },
    ].filter(e => e.val);
    emaEl.innerHTML = emas.map(e => {
      const dist = ((entry - e.val) / e.val * 100).toFixed(2);
      const col  = entry > e.val ? 'var(--green)' : 'var(--red)';
      return `<span class="wd-ema-pill"><span style="color:var(--text3)">${e.lbl}</span><span style="color:${col};margin-left:4px">${fmtP(e.val)}</span><span style="color:var(--text4);font-size:8px;margin-left:2px">${dist}%</span></span>`;
    }).join('');

    // [v1.0] POC migration display — poc is now object from engine v6.0
    // Safe accessor: poc.value (new) or poc (legacy scalar — backtest compat)
    const poc = d.poc;
    if (poc) {
      const pocVal  = poc.value ?? poc;                          // soft-break safe
      const pocDir  = poc.migrating || 'flat';
      const pocVel  = poc.velocity  || 0;
      const pocArrow = pocDir === 'up' ? '↑' : pocDir === 'down' ? '↓' : '→';
      const pocCol   = pocDir === 'up' ? 'var(--green)' : pocDir === 'down' ? 'var(--red)' : 'var(--text4)';
      const pocLabel = pocDir !== 'flat'
        ? `${pocArrow} ${pocDir.toUpperCase()} (vel ${pocVel.toFixed(3)}%)`
        : '→ FLAT';
      emaEl.innerHTML += `<span class="wd-ema-pill wd-poc-dir" style="margin-top:4px"><span style="color:var(--text3)">POC</span><span style="color:var(--text4);margin-left:4px">${fmtP(pocVal)}</span><span class="wd-poc-dir-lbl" style="color:${pocCol};margin-left:4px;font-size:9px">${pocLabel}</span></span>`;
    }
  }
}

// ── RENDER: MTF GRID ──────────────────────────────────────────────
function wdRenderMTF(mtfRes, primaryTF, primaryDir) {
  const grid = $('wd-mtf-grid');
  if (!grid) return;
  if (!mtfRes) { grid.innerHTML = '<div class="wdv2-empty">MTF disabled</div>'; return; }

  const { tfs, results } = mtfRes;
  let aligned = 0;

  grid.innerHTML = tfs.map(tf => {
    const r      = results[tf];
    const cur    = tf === primaryTF;
    const dir    = r?.dir;
    const aligns = dir && primaryDir && dir === primaryDir;
    if (aligns) aligned++;
    const cls      = dir === 'LONG' ? 'bull' : dir === 'SHORT' ? 'bear' : 'neutral-mtf';
    const dirColor = dir === 'LONG' ? 'var(--green)' : dir === 'SHORT' ? 'var(--red)' : 'var(--text4)';
    const alignCls = cur ? 'mtf-align-cur' : aligns ? 'mtf-align-yes' : 'mtf-align-no';
    const alignTxt = cur ? 'PRIMARY' : aligns ? 'ALIGNED' : 'DIVERGE';
    const rsiVal   = r ? `RSI ${r.d?.rsi?.toFixed(0)||'—'}` : '—';
    return `
      <div class="wd-mtf-card ${cls}${cur?' wd-mtf-card-cur':''}">
        <div class="wd-mtf-tf">${tf.toUpperCase()}${cur?' ★':''}</div>
        <div class="wd-mtf-dir" style="color:${dirColor}">${dir || r?.signalState || 'WAIT'}</div>
        <div class="wd-mtf-row"><span>${rsiVal}</span><span>${r?.score?.toFixed(0)||'—'}%</span></div>
        <div class="wd-mtf-row"><span>EMA</span><span>${r?.d?.bullEMA?'BULL':r?.d?.bearEMA?'BEAR':'MIX'}</span></div>
        <div class="wd-mtf-align ${alignCls}">${alignTxt}</div>
      </div>
    `;
  }).join('');

  if ($('wd-mtf-score-lbl')) $('wd-mtf-score-lbl').textContent = `${aligned}/${tfs.length} aligned`;
}

// ── RENDER: LEVELS ────────────────────────────────────────────────
function wdRenderLevels(entry, slObj, tp1V, tp2V, rrV, cfg, dir, d, regime='NORMAL') {
  const grid = $('wd-levels-grid');
  if (!grid) return;

  const sl     = slObj.sl;
  const slPct  = Math.abs((sl - entry) / entry * 100).toFixed(2);
  const tp1Pct = Math.abs((tp1V - entry) / entry * 100).toFixed(2);
  const tp2Pct = Math.abs((tp2V - entry) / entry * 100).toFixed(2);
  const srcCls = slObj.source === 'structure' ? 'src-struct' : 'src-atr';
  // [v2.0] Show resolved atrMult with regime annotation
  const srcTxt = slObj.source === 'structure'
    ? 'SR STRUCT'
    : `ATR ×${cfg.atrMult} [${regime}]`;

  const items = [
    { lbl:'ENTRY',     valCls:'wdlv-entry', val:fmtP(entry),   sub:'Current price', src:null },
    { lbl:'STOP LOSS', valCls:'wdlv-sl',    val:fmtP(sl),      sub:`${slPct}% risk`, src:{ cls:srcCls, txt:srcTxt } },
    { lbl:'INVALIDATE',valCls:'wdlv-inv',   val:fmtP(slObj.invalidationZone), sub:'Thesis dies here', src:null },
    { lbl:`TP1 ×${cfg.tp1}`,valCls:'wdlv-tp', val:fmtP(tp1V), sub:`${tp1Pct}% target`, src:null },
    { lbl:`TP2 ×${cfg.tp2}`,valCls:'wdlv-tp', val:fmtP(tp2V), sub:`${tp2Pct}% target`, src:null },
    { lbl:'R:R (TP2)', valCls:rrV>=1.5?'wdlv-rr-good':'wdlv-rr-bad', val:rrV>0?`1:${rrV.toFixed(2)}`:'—', sub:rrV>=1.5?'✅ Good R:R':'⚠ Low R:R', src:null },
  ];

  grid.innerHTML = items.map(it => `
    <div class="wdlv-item">
      <div class="wdlv-lbl">${it.lbl}</div>
      <div class="wdlv-val ${it.valCls}">${it.val}</div>
      <div class="wdlv-sub">${it.sub}</div>
      ${it.src ? `<span class="wdlv-src ${it.src.cls}">${it.src.txt}</span>` : ''}
    </div>
  `).join('');

  if ($('wd-sl-source-lbl')) {
    $('wd-sl-source-lbl').textContent = slObj.source === 'structure' ? '✅ SL on SR structure' : '⚠ SL ATR fallback';
    $('wd-sl-source-lbl').style.color = slObj.source === 'structure' ? 'var(--green)' : 'var(--yellow)';
  }
}

// ── RENDER: COHERENCE ─────────────────────────────────────────────
function wdRenderCoherence(coherence) {
  const body = $('wd-coherence-body');
  if (!body) return;

  if (!APP.macroServerOnline) {
    body.innerHTML = '<div class="wdv2-empty">Start macro server in nav bar</div>'; return;
  }
  if (!APP.macroData) {
    body.innerHTML = '<div class="wdv2-empty">Macro data not loaded — visit Macro tab</div>'; return;
  }
  if (!coherence) {
    body.innerHTML = '<div class="wdv2-empty">No direction — run scan first</div>'; return;
  }

  // C5: inject staleness warning inline so coherence score is not blindly trusted
  const staleState = macroStaleness();
  let staleWarn = '';
  if (staleState === 'stale') {
    const mins = Math.floor(macroAge() / 60000);
    staleWarn = `<div class="macro-stale-inline stale-stale">⚠ MACRO DATA ${mins}m OLD — coherence may be unreliable</div>`;
  } else if (staleState === 'warn') {
    const mins = Math.floor(macroAge() / 60000);
    staleWarn = `<div class="macro-stale-inline stale-warn">⚠ Macro data ${mins}m old</div>`;
  }

  const cohColor = coherence.color === 'confirm' ? 'var(--green)' : coherence.color === 'conflict' ? 'var(--red)' : 'var(--yellow)';
  const cohCls   = coherence.color === 'confirm' ? 'coh-confirm' : coherence.color === 'conflict' ? 'coh-conflict' : 'coh-neutral';

  if ($('wd-coh-verdict-lbl')) {
    $('wd-coh-verdict-lbl').textContent = `${coherence.verdict} ${coherence.score}%`;
    $('wd-coh-verdict-lbl').style.color = cohColor;
  }

  body.innerHTML = staleWarn + `
    <div class="wd-coh-bar-wrap">
      <div class="wd-coh-hdr">
        <span class="wd-coh-score-lbl">ENGINE × MACRO ALIGNMENT</span>
        <span class="wd-coh-score-val ${cohCls}">${coherence.score}%</span>
      </div>
      <div class="wd-coh-bar-bg">
        <div class="wd-coh-bar-fill" style="width:${coherence.score}%;background:${cohColor}"></div>
      </div>
    </div>
    <div class="wd-coh-factors">
      ${coherence.factors.length
        ? coherence.factors.map(f => `<div class="wd-coh-factor ${f.bias}">· ${f.text}</div>`).join('')
        : '<div class="wdv2-empty">No macro factors available</div>'
      }
    </div>
  `;
}

// ── RENDER: VERDICT ───────────────────────────────────────────────
function wdRenderVerdict(signal, d, cfg, mtfRes, slObj, rrV, coherence, regime='NORMAL') {
  const dir      = signal.dir;
  const score    = signal.score;
  const lowConf  = score < cfg.minConf;
  const htfFail  = signal.sc?.htf === -20;
  const mtfCount = mtfRes ? Object.values(mtfRes.results).filter(r => r?.dir === dir).length : 0;
  const ps       = d.preSignal || { active:false, reasons:[], maturity:0 };
  const lp       = signal.liquidityPressure || { longSqueeze:false, shortSqueeze:false, pressure:0, squeezable:false };
  // [v2.0] Regime-aware circuit breaker threshold
  const cbThresh = (typeof CIRCUIT_BREAKER !== 'undefined' && CIRCUIT_BREAKER.regimeThresholds)
    ? (CIRCUIT_BREAKER.regimeThresholds[regime] ?? CIRCUIT_BREAKER.maxConsecLoss)
    : 5;

  let verdictCls, icon, title;
  if (signal.adxChop || !dir) {
    verdictCls = 'vs-standdown'; icon = '⬛'; title = `STAND DOWN — ${!dir ? 'NO DIRECTION' : 'ADX CHOP'}`;
  } else if (signal.extended) {
    verdictCls = 'vs-block'; icon = '🔴'; title = `STAND DOWN — PRICE EXTENDED`;
  } else if (!lowConf && !htfFail && !signal.extended && mtfCount >= 3 && rrV >= 1.5 && ps.maturity >= 60) {
    verdictCls = 'vs-strong'; icon = '🟢'; title = `STRONG ENTRY — ${dir} ${score.toFixed(0)}% · PSI ${ps.maturity}%`;
  } else if (!lowConf && !htfFail && !signal.extended && mtfCount >= 3 && rrV >= 1.5) {
    verdictCls = 'vs-strong'; icon = '🟢'; title = `STRONG ENTRY — ${dir} ${score.toFixed(0)}%`;
  } else if (!lowConf) {
    verdictCls = 'vs-cond'; icon = '🟡'; title = `CONDITIONAL ENTRY — ${dir} ${score.toFixed(0)}%`;
  } else {
    verdictCls = 'vs-block'; icon = '🔴'; title = 'NO TRADE — CONDITIONS NOT MET';
  }

  const panel = $('wd-verdict-panel');
  if (panel) panel.className = `wdv2-panel wd-verdict-panel ${verdictCls}`;
  if ($('wd-verdict-icon'))  $('wd-verdict-icon').textContent  = icon;
  if ($('wd-verdict-title')) $('wd-verdict-title').textContent = title;

  const checks = [
    { ok:!signal.adxChop,  w:signal.adxChop,   txt:`<strong>ADX:</strong> ${signal.adxChop?'CHOP — ranging':'OK — trending'}` },
    { ok:!!dir,            w:!dir,              txt:`<strong>Direction:</strong> ${dir||'NONE'} — EMA stack ${dir?'confirmed':'mixed'}` },
    { ok:!lowConf,         w:lowConf,           txt:`<strong>Score:</strong> ${score.toFixed(0)}% (min ${cfg.minConf}%)` },
    { ok:!signal.extended, w:signal.extended,   txt:`<strong>Extended:</strong> ${signal.extended?`${d.distFromE21.toFixed(2)}% from EMA21`:'NOT extended'}` },
    { ok:!htfFail,         w:htfFail,           txt:`<strong>HTF:</strong> ${htfFail?'CONFLICT':'Aligned'}` },
    { ok:mtfCount>=3,      w:mtfCount<2,        txt:`<strong>MTF:</strong> ${mtfCount}/4 timeframes aligned` },
    { ok:rrV>=1.5,         w:rrV<1,             txt:`<strong>R:R:</strong> ${rrV>0?'1:'+rrV.toFixed(2):'—'}${rrV>=1.5?' ✅':' ⚠'}` },
    { ok:slObj.source==='structure', w:slObj.source!=='structure', txt:`<strong>SL:</strong> ${slObj.source==='structure'?'SR-anchored':'ATR fallback'}` },
    { ok:ps.maturity>=60,  w:false,             txt:`<strong>PSI:</strong> ${ps.maturity}% — ${ps.maturity>=60?'WATCH READY':ps.maturity>=35?'FORMING':ps.active?'HUNT':'inactive'}` },
    { ok:!!d.choch?.chochBull||!!d.choch?.chochBear, w:false, txt:`<strong>CHoCH:</strong> ${d.choch?.chochBull?'BULL ✓':d.choch?.chochBear?'BEAR ✓':'none'}` },
    { ok:!!d.squeeze?.fired,  w:false, txt:`<strong>Squeeze:</strong> ${d.squeeze?.fired?'FIRED':d.squeeze?.squeeze?`active ${d.squeeze.bars}b`:'none'}` },
    { ok:!!d.wyckoff?.spring, w:false, txt:`<strong>Wyckoff:</strong> ${d.wyckoff?.spring?'SPRING ✓':(d.wyckoff?.phase||'unknown')}` },
    { ok:coherence?.score>=70, w:coherence?.score<40, txt:`<strong>Macro:</strong> ${coherence?`${coherence.verdict} ${coherence.score}%`:'N/A — server offline'}` },
    { ok:!!d.bos?.bosBull||!!d.bos?.bosBear, w:false, txt:`<strong>BoS:</strong> ${d.bos?.bosBull?'BULL ✓':d.bos?.bosBear?'BEAR ✓':'none'}` },
    { ok:!!signal.dir && signal.score >= cfg.minConf, w:false, txt:`<strong>TF Note:</strong> ${cfg.note.split('·')[0].trim()}` },
    // [v1.0] Absorption — informational, shown when detected
    { ok:!!d.absorption?.absorptionBull||!!d.absorption?.absorptionBear, w:false,
      txt:`<strong>Absorption:</strong> ${d.absorption?.absorptionBull?'BULL ✓ buying absorbed':d.absorption?.absorptionBear?'BEAR ✓ selling absorbed':'none'}` },
    // [v1.0] POC Migration — informational
    { ok:d.poc?.pocBull||d.poc?.pocBear, w:false,
      txt:`<strong>POC Drift:</strong> ${d.poc?.migrating==='up'?'↑ RISING':d.poc?.migrating==='down'?'↓ FALLING':'FLAT'} (vel ${(d.poc?.velocity||0).toFixed(3)}%)` },
    // [v1.0] Liquidity Pressure — squeeze warning (yellow if squeezable, not a blocker)
    { ok:!lp.squeezable, w:lp.squeezable,
      txt:`<strong>Liquidity:</strong> ${lp.squeezable?`⚠ ${lp.longSqueeze?'LONG SQUEEZE RISK':'SHORT SQUEEZE RISK'} — crowd will capitulate (pressure ${lp.pressure})`:lp.longSqueeze||lp.shortSqueeze?`Squeeze present (${lp.pressure}) — not in your direction`:'No squeeze detected'}` },
    // [v2.0] Regime — always shown, warns on CHAOS
    { ok: regime === 'NORMAL' || regime === 'LOW',
      w:  regime === 'CHAOS',
      txt:`<strong>Regime:</strong> ${regime} — CB threshold: ${cbThresh} consecutive losses${regime==='CHAOS'?' ⚠ CAUTION':regime==='ELEVATED'?' ⚠ elevated':''}` },
  ];

  if ($('wd-verdict-checklist')) {
    $('wd-verdict-checklist').innerHTML = checks.map(c => {
      const ico = c.ok ? '✅' : c.w ? '❌' : '⚠️';
      const col = c.ok ? 'var(--green)' : c.w ? 'var(--red)' : 'var(--yellow)';
      return `<div class="wd-vi"><span class="wd-vi-ico" style="color:${col}">${ico}</span><span class="wd-vi-txt">${c.txt}</span></div>`;
    }).join('');
  }
}

// ══════════════════════════════════════════════════════════════════
// INIT — startup sequence
// ══════════════════════════════════════════════════════════════════
wdPopulatePairDropdown(); // default datalist before universe loads
wlLoad();                 // T1/T3: restore watchlist from localStorage
sigLogLoad();             // Signal log: restore from localStorage
toastInit();              // T7: pre-create toast container

// ══════════════════════════════════════════════════════════════════
// WINDOW EXPORTS
// All functions called via onclick="" HTML attributes must be
// explicitly attached to window. Runs after all declarations.
// ══════════════════════════════════════════════════════════════════
window.goHome             = goHome;
window.launchModule       = launchModule;
window.switchModule       = switchModule;
window.toggleMacroServer  = toggleMacroServer;
window.fetchMacroData     = fetchMacroData;
window.trBootUniverse     = trBootUniverse;
window.trSetTF            = trSetTF;
window.trFilterTable      = trFilterTable;
window.trSort             = trSort;
window.trScanPair         = trScanPair;
window.trToggleAutoScan   = trToggleAutoScan;
window.trBatchScan        = trBatchScan;
window.trFullScan         = trFullScan;
window.openWatchdog       = openWatchdog;
window.wdSetTF            = wdSetTF;
window.wdRunScan          = wdRunScan;
window.wdForceCandles     = wdForceCandles;
window.wdRemoveAlarm      = wdRemoveAlarm;
window.wdClearAlarms      = wdClearAlarms;
window.wdSetAlarmFromScan = wdSetAlarmFromScan;
window.wdPopulatePairDropdown = wdPopulatePairDropdown;
window.wlToggle           = wlToggle;
window.sigLogExport       = sigLogExport;
window.sigLogClear        = sigLogClear;
window.sigLogSetFilterDir = sigLogSetFilterDir;
window.sigLogSetFilterState = sigLogSetFilterState;
window.wdNavPrev          = wdNavPrev;
window.wdNavNext          = wdNavNext;
window.wlRenderStrip      = wlRenderStrip;
