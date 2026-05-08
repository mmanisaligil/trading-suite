// ══════════════════════════════════════════════════════════════════
// VIVIENNE ENGINE — v7.1
// Pure computation layer. No DOM. No state. No UI coupling.
// Shared across: Watchdog · TradeRecon · TradeGuard · backtest.js
// Load order: <script src="engine.js"></script> BEFORE tool scripts
//
// v6.0 — Absorption · POC Migration · Liquidity Pressure
//         (genesis.md spec — panel.js v1.0 coordinated)
//
//   [P1-COORD] detectAbsorption() — new pure function
//              Detects institutional absorption candles:
//              high volume + small body relative to ATR = opponent absorbing.
//              Returns: { absorptionBull, absorptionBear, ratio, bars }
//   [P1-COORD] calcPoC() refactored → calcPoCFull()
//              Now computes 100-candle + 50-candle POC and returns an object:
//              { value, poc50, migrating, velocity, pocBull, pocBear }
//              SOFT BREAK: d.poc is now an object. Panel v1.0 updated.
//              Backtest.js: receives new fields, ignores them — safe.
//   [P1-COORD] computeLiquidityPressure() — new pure function
//              Combines OI + funding + L/S into a squeeze detector.
//              Returns: { longSqueeze, shortSqueeze, pressure, squeezable }
//              Wired into scoreSignal() — new return field liquidityPressure.
//   [P1-COORD] ANALYZE_DEFAULTS: useAbsorption added (default false)
//   [P1-COORD] scoreSignal(): new sc.absorption (±18pts) + sc.pocMigration (±10pts)
//              liquidityPressure SHORT boost: +15pts conditional
//   [P1-COORD] Denominator: 160 → 195
//              Breakdown: absorption max+18, pocMigration max+10,
//              squeeze SHORT boost max+15 (conditional — not always in denom).
//              Conservative: existing 70% signals score ~57% before new signals fire.
//              minConf thresholds UNCHANGED.
//   [P2-SAFE]  CIRCUIT_BREAKER, TFC, SETUP_LIBRARY — UNCHANGED
//   [P2-SAFE]  determineSignalState() — UNCHANGED
//   [P2-SAFE]  All existing sc.* bucket scoring logic — UNCHANGED
//   [P2-SAFE]  fetchK/fetchFunding/fetchOI/fetchLSRatio — UNCHANGED
//
// Compatibility matrix:
//   analyze() signature    — UNCHANGED (new opts.useAbsorption flag, defaults false)
//   analyze() return shape — ADDITIVE + one soft break (poc object)
//   scoreSignal() signature — UNCHANGED
//   scoreSignal() return   — ADDITIVE (liquidityPressure field, new sc buckets)
//   determineSignalState() — UNCHANGED
//   backtest.js            — safe (additive fields ignored)
//
// v5.2 — Backtest-Driven Calibration (15M + 1H BTC, 2026-01 to 2026-04)
//         + Audit E-01 fix ($ removed from engine — DOM decoupling)
//
//   [P1-SAFE]  TFC['15m'].atrMult: 1.0 → 1.2
//              (58.5% SL hit rate — SL too tight for 15M volatility)
//   [P1-SAFE]  TFC['15m'].entryBandMult: 1.0 → 1.2
//              (33.8% expiry rate — entry zone critically narrow)
//   [P1-SAFE]  TFC['15m'].minConfShort: 63 → 68
//              (SHORT WR 31.8% — same structural gap as 4H)
//   [P1-SAFE]  TFC['1h'].minConf: 55 → 50
//              (best bucket 50-60 @ 3.41R — current gate cuts into edge)
//   [P1-SAFE]  TFC['1h'].minConfShort: 63 → 75
//              (SHORT WR 0% in 6 trades — emergency gate raise)
//   [P1-SAFE]  TFC['1h'].entryBandMult: 1.0 → 1.15
//              (25.9% expiry rate)
//   [P2-SAFE]  sc.crossProx cap: 10 → 7
//              (bonus inflation in 60-80 dead bucket, confirmed both TFs)
//   [P2-SAFE]  sc.wyckoff spring cap: 12 → 8
//              (same — 70-80 graveyard bucket both TFs)
//   [P2-COORD] cvdDiv bonus now gated on EMA stack alignment
//              (prevents blind bonus stacking during consolidation)
//   [P1-SAFE]  $ helper removed from engine (audit E-01 — DOM coupling
//              eliminated; each consumer defines its own $)
//
// Return shape: UNCHANGED — all existing consumers safe
// Denominator:  UNCHANGED at 160
// analyze() signature: UNCHANGED
// scoreSignal() signature: UNCHANGED
//
// v5.1 — Backtest-Driven Calibration (2018–2026 BTC/ETH 4H)
//   [P1-SAFE]  TFC['4h'].minConf: 50 → 60  (best bucket 60-70 @ 1.35R)
//   [P1-SAFE]  TFC['4h'].atrMult: 1.6 → 1.8 (SL too tight — 49% hit rate)
//   [P1-SAFE]  TFC['4h'].beMult: 1.0 added  (BE trigger audit — tune per TF)
//   [P1-COORD] TFC: minConfShort added per TF (SHORT WR 22% vs LONG 54%)
//              scoreSignal() gates SHORT signals via cfg.minConfShort
//   [P1-COORD] SHORT: CHoCH bear required (-15pt penalty if absent)
//              SHORT: bearEMA HTF penalty tightened (-5pt additional if no bearEMA)
//   [P2-SAFE]  sc.crossProx cap: 15 → 10 (score inflation in 60-70 bucket)
//   [P2-SAFE]  sc.wyckoff spring cap: 18 → 12 (same — ETH 70-80 WR paradox)
//   [P2-SAFE]  TFC['4h'].entryBandMult: 1.2 added (13.7% expiry rate BTC)
//   [P2-COORD] CIRCUIT_BREAKER config exported (Watchdog consumes; backtest logs)
//   [BUG-FIX]  stochRSI preBullCross/preBearCross — fixed boolean logic bug
//              (!kp<dp is always false; corrected to kp>=dp)
//
// v5.0 — Pre-Signal Intelligence Layer (see end of file for full log)
// ══════════════════════════════════════════════════════════════════

// v8.0 — Setup Classification Layer + Scoring Architecture Fixes
//
//   [P1-CRITICAL]  V8-01: Multi-signal direction gate (resolveDirection)
//                  Binary EMA gate → weighted vote (EMA + MACD + CHoCH + swing + RSI)
//                  Direction confidence soft cap on max achievable score
//   [P1-CRITICAL]  V8-02: TFC['1d'].minConfShort: 45→70 (inverted gate fix)
//   [P1-CRITICAL]  V8-03: TFC['1m'].minConfShort: 45→68 · TFC['5m']: 45→66 (CAL restore)
//   [P2-HIGH]      V8-04: T3 negative asymmetry fix (TIER_CONFIG.negPenalty t2×1.3 t3×1.8)
//   [P2-HIGH]      V8-05: lsRatio scoring made direction-aware (crowd against = bonus)
//   [P2-HIGH]      V8-06: Absorption gated on S/R proximity (absorptionWeak field)
//   [P3-HIGH]      V8-07: CVD upgraded to proportional delta (close-in-range method)
//   [P3-MEDIUM]    V8-08: Wyckoff enriched with POC migration context
//   [P3-MEDIUM]    V8-09: preSignal maturity caps (cross 40 · rsiDiv 16 · wyckoff 22 · fvg 16)
//                  Divisor 1.5→2.0 — WATCH now requires genuine multi-factor confluence
//   [P4-MEDIUM]    V8-10: SETUP_LIBRARY — 12 named strategy archetypes
//                  classifySetup() router · sc.setup bucket · T3 denom 71→86
//                  New: calcVWAP · detectMACDDiv · calcFibLevels · bollingerPctB
//                  New ANALYZE_DEFAULTS flag: useVWAP
//   [P4-MEDIUM]    V8-11: Regime ATR computation O(n×14)→O(n) Wilder smoothing
//
//   New analyze() return fields:  vwap · macdDiv · bollingerPctB
//   New scoreSignal() return fields: dirResult · setupType
//   T3 denominator: 71→86
//   TIER_CONFIG: negPenalty added
//   Compatibility: ALL consumers safe (additive return fields only)
//   REQUIRES: Full backtest regression before deployment
//
// v8.1 — Audit Fixes + Dynamic Denominator + Entry Band + SL-BE Calibration
//
//   PHASE 1 — AUDIT FIXES (previously applied)
//   [A1-FIX]  ENGINE_VERSION constant added (single source of truth)
//   [A2-FIX]  atr() → Wilder smoothing (was SMA — inconsistent with computeRegime)
//   [A3-FIX]  calcADX() → proper Wilder-smoothed DI/DX/ADX (was single-pass approximation)
//   [A4-FIX]  Absorption scoring → else-if chain (prevents overwrite on mixed signals)
//   [A5-FIX]  POC migration scoring → else-if chain (same fix pattern)
//   [B1-FIX]  4H SHORT gate regime-aware (CHAOS/ELEVATED lowers gate instead of raising it)
//   [B4-FIX]  Pre-signal absorption cap at 24pts (was uncapped at 28)
//   [A6-FIX]  S/R clustering tolerance → ATR-normalized (was fixed 0.4%)
//
//   PHASE 1 REGRESSION CAL (5-run matrix)
//   [CAL-01]  TFC['4h'].minConfShort: 85→65
//   [CAL-02]  adxChop threshold: 20→18
//   [CAL-03]  TFC['1h'].entryBandMult: 1.5→1.7  |  TFC['4h'].entryBandMult: 1.6→1.8
//
//   PHASE 2 — DYNAMIC DENOMINATOR (this build — DD-01/DD-02/DD-03)
//   [DD-01]  T2 denominator computed from active modules (squeeze, divergence)
//            Base: 72 (macd20+rsi15+stoch12+vol10+pattern15)
//            +15 if useSqueeze active and squeeze data present
//            +12 if useDivergence active and rsiDiv data present
//            Floor: 72
//   [DD-02]  T3 denominator computed from active + data-present modules
//            Base floor: 7 (crossProx always computable)
//            +8 wyckoff  +8 cvdDiv  +8 oiDiv  +12 lsRatio
//            +18 absorption  +10 pocMigration  +15 setup
//            Only added if data is non-null and condition is met
//            Floor: 15
//   [DD-03]  Normalization uses dynamic denoms — t1Denom fixed at 78 (correct)
//            scoreTiers return: t2Denom, t3Denom added (additive, backward safe)
//
//   ROOT CAUSE FIXED (backtest evidence):
//            Score inversion detected — 40-50 bucket +0.20R, 50-60 bucket -0.05R.
//            Fixed T3 denom (86) penalized good setups for modules that couldn't fire
//            (e.g. oiData/lsData null). Dynamic denom lifts good trades from ~39 → 50-55.
//
//   ENTRY BAND WIDENING — [EB-01]
//   [EB-01]  All TFs: entryBandMult += 0.15 (compensates 58.4% signal expiry rate)
//            1h: 1.7→1.85  |  4h: 1.8→1.95  |  15m: 1.5→1.65
//            1m/5m/1d: +0.15 each (proportional)
//            Rationale: 866/1482 signals expired (58.4%). Wilder ATR produces tighter
//            bands vs SMA ATR baseline. 0.15 additional ATR widens entry zone.
//            Roll back if post-Phase-2 expiry drops below 35%.
//
//   SL-BE TRIGGER CALIBRATION — [BE-01]
//   [BE-01]  beMult: all TFs += 0.3 (raises BE activation threshold)
//            1h: 1.0→1.3  |  4h: 1.0→1.3  |  15m: 1.0→1.3
//            1m: 0.8→1.1  |  5m: 0.9→1.2  |  1d: 1.2→1.5
//            Rationale: 131 SL_BE exits (21.3%). BE trigger fires at 1× ATR profit,
//            price then reverses to flat exit. Raising to 1.3× gives trade more room
//            before locking. The trade that moved +1R typically has +1.3R potential
//            before reversion — this preserves that capture window.
//
//   analyze() signature:     UNCHANGED
//   analyze() return shape:  UNCHANGED
//   scoreSignal() signature: UNCHANGED
//   scoreSignal() return:    ADDITIVE (t2Denom, t3Denom in scoreTiers — safe)
//   Compatibility: ALL consumers SAFE
//
// ── v7.3 changelog below ─────────────────────────────────────────
//
//   [P1-CAL] TFC['15m']:
//              minConf: 55→60  (score bucket analysis: 60-70 best @ -0.17R;
//                               40-50 and 50-60 both negative, cut them)
//              minConfShort: 45→68  (restore v5.2 anchor; 45 was CAL override)
//              atrMult: 1.2→1.0  (RR inversion fix: avg loss -1.78R > avg win +1.18R;
//                                 tighter SL reduces loss R, BE activates sooner)
//              entryBandMult: 1.2→1.5  (58.2% expiry — zone too narrow for momentum)
//              watchThresh: 25→30  (raise WATCH floor to match tighter minConf)
//
//   [P1-CAL] TFC['1h']:
//              entryBandMult: 1.15→1.5  (56.5% expiry rate — primary bottleneck.
//                                        10/23 signals filled; 80% WR on filled trades
//                                        confirms signal quality. Zone is the problem.)
//              minConfShort: 75 — HELD (v7.2 fix confirmed correct, no change)
//              All other values — HELD (geometry is clean: avg loss -1.31R sane)
//
//   [P1-CAL] TFC['4h']:
//              minConfShort: 45→85  (4H SHORT WR 19.6% in 2022-2026 run;
//                                    83.6% of 55 trades were SHORT into BTC bull cycle.
//                                    LONG WR 44.4% at minConf 60 is healthy.
//                                    85 gate holds until HTF hard-gate lands in backtest.js)
//              entryBandMult: 1.2→1.6  (41.5% expiry rate — same pattern as 1H/15M)
//              watchThresh: 25→30  (raise WATCH floor to match direction split)
//              atrMult, tp1, tp2, beMult — HELD (avg RR 2.20 is correct geometry)
//
//   Compatibility matrix:
//     All consumers — SAFE (TFC value changes only, no structural changes)
//     backtest.js    — SAFE
//     simulator.js   — SAFE
//     Watchdog / TradeRecon / TradeGuard — SAFE
//
// v7.2 — Backtest Bug Fix Release
//
//   [BUG-FIX] TFC['1h'].minConfShort: 45 → 75 (SIM-003)
//              v7.1-CAL calibration override was never reverted.
//              SHORT gate at 45 admitted low-conviction SHORTs with 26.6% WR.
//              v5.2 calibrated gate of 75 restored. No other TF changes.
//              See simulator.js v7.2 for companion SL/TP fixes.
//
//   Compatibility matrix:
//     All consumers — SAFE (only TFC['1h'].minConfShort value changed)
//     backtest.js    — SAFE
//     simulator.js   — SAFE
//
// ── CONSTANTS ─────────────────────────────────────────────────────
// [v5.2] $ helper removed — each consumer defines its own DOM accessor.
//        Engine is a pure compute layer; no DOM references belong here.
const BASE = 'https://api.binance.com/api/v3';
const FAPI = 'https://fapi.binance.com/fapi/v1';
const DAPI = 'https://fapi.binance.com/futures/data';
const ENGINE_VERSION = '8.1'; // [v8.1 A1-FIX] Single source of truth for version

// ── CIRCUIT BREAKER CONFIG — exported for Watchdog consumption ────
// Watchdog: pause new signals after maxConsecLoss consecutive losses.
// backtest.js: log streak count only — do NOT gate trades (sim mode).
// TradeRecon / TradeGuard: no action required.

// ══════════════════════════════════════════════════════════════════
// REGIME DETECTION — v7.0 (Asset-Agnostic Volatility Classification)
// Pure functions. No external dependencies. Safe layer.
//
// computeRegime(klines) → 'LOW' | 'NORMAL' | 'ELEVATED' | 'CHAOS'
//   Uses ATR percentile (100-bar) + Z-score (50-bar) dual confirmation.
//   Both metrics must agree before upgrading regime tier.
//
// resolveParams(baseCfg, regime) → resolved config object
//   Applies regime multipliers to base TFC config.
//   Returns a NEW object — baseCfg is never mutated.
//   Engine core consumes resolved config transparently.
//
// Canonical constraint: engine scoring logic UNTOUCHED.
// These functions are upstream of scoreSignal — pure input transforms.
// ══════════════════════════════════════════════════════════════════

// ── REGIME MULTIPLIER TABLE ───────────────────────────────────────
// Each regime scales base TFC params via multipliers.
// 1.0 = no change (NORMAL is the identity transform).
const REGIME_MULTIPLIERS = {
  LOW: {
    atrMult:        0.85,  // tighter SL — less noise in calm markets
    minConfDelta:  -3,     // pts — lower gate, more signals acceptable
    minConfShortDelta: -3, // pts
    beActivationR:  0.90,  // activate BE slightly sooner
    tpMultiplier:   0.95,  // modest TP — range-bound moves
    orderTTLMult:   1.00,  // no urgency on expiry
  },
  NORMAL: {
    atrMult:        1.00,  // identity — base config unchanged
    minConfDelta:   0,
    minConfShortDelta: 0,
    beActivationR:  1.00,
    tpMultiplier:   1.00,
    orderTTLMult:   1.00,
  },
  ELEVATED: {
    atrMult:        1.30,  // wider SL — absorb elevated volatility
    minConfDelta:  +5,     // pts — raise gate, filter weak setups
    minConfShortDelta: +7, // pts — SHORT needs extra confirmation
    beActivationR:  1.20,  // delay BE — give trade room to breathe
    tpMultiplier:   1.15,  // extend TP — larger swings available
    orderTTLMult:   0.85,  // expire stale orders faster
  },
  CHAOS: {
    atrMult:        1.65,  // survive liquidation-level noise
    minConfDelta:  +10,    // pts — only highest conviction entries
    minConfShortDelta: +15,// pts — SHORT nearly gated in chaos
    beActivationR:  1.50,  // BE much later — chaos kills premature BE
    tpMultiplier:   1.30,  // large swings — extend targets
    orderTTLMult:   0.70,  // stale orders dangerous in fast markets
  },
};

// ── REGIME THRESHOLDS ────────────────────────────────────────────
const REGIME_THRESHOLDS = {
  // ATR percentile boundaries (0–1)
  atrPct: { LOW: 0.25, ELEVATED: 0.65, CHAOS: 0.85 },
  // Z-score boundaries
  zScore: { LOW: -0.5, ELEVATED: 1.0, CHAOS: 2.0 },
  // Lookback windows
  pctLookback: 100,
  zLookback:    50,
};

/**
 * computeRegime(klines) → 'LOW' | 'NORMAL' | 'ELEVATED' | 'CHAOS'
 *
 * Dual-metric classification:
 *   A) ATR percentile: rank of current ATR vs last 100 bars
 *   B) Volatility Z-score: stddev units from 50-bar ATR mean
 *
 * Regime upgrades require BOTH metrics to agree.
 * Regime downgrades require only one metric (conservative).
 *
 * Requires minimum 55 klines (50 for Z-score + safety buffer).
 * Returns 'NORMAL' if insufficient data.
 */
function computeRegime(klines) {
  const th = REGIME_THRESHOLDS;
  const minRequired = th.zLookback + 5;
  if (!klines || klines.length < minRequired) return 'NORMAL';

  // ── Compute ATR values for lookback window ─────────────────
  const len       = klines.length;
  const pctWindow = Math.min(th.pctLookback, len - 1);
  const zWindow   = Math.min(th.zLookback, len - 1);

  // ATR = simple true range average over 14 bars (fast, inline)
  function trueRange(i) {
    const h  = parseFloat(klines[i][2]);
    const l  = parseFloat(klines[i][3]);
    const pc = i > 0 ? parseFloat(klines[i-1][4]) : parseFloat(klines[i][1]);
    return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }

  // [v8.0] Single-pass running ATR — O(n) vs prior O(n×14) nested loop
  // Uses Wilder smoothing (standard ATR definition) rather than SMA-per-bar.
  const trValues = [];
  for (let i = 1; i < len; i++) trValues.push(trueRange(i));

  if (trValues.length < 14) return 'NORMAL';

  // Seed with SMA of first 14 TR values
  let runningATR = trValues.slice(0, 14).reduce((a, b) => a + b, 0) / 14;

  // Collect ATR values only for the percentile window
  const atrStartIdx = Math.max(0, trValues.length - pctWindow);
  const atrValues = [];
  for (let i = 14; i < trValues.length; i++) {
    runningATR = (runningATR * 13 + trValues[i]) / 14;
    if (i >= atrStartIdx) atrValues.push(runningATR);
  }

  if (atrValues.length < 10) return 'NORMAL'; // guard

  const currentATR = atrValues[atrValues.length - 1];

  // ── A: ATR Percentile ─────────────────────────────────────
  const below = atrValues.filter(v => v <= currentATR).length;
  const atrPct = below / atrValues.length; // 0–1

  // ── B: Volatility Z-Score (50-bar window) ─────────────────
  const zSlice = atrValues.slice(-zWindow);
  const zMean  = zSlice.reduce((a, b) => a + b, 0) / zSlice.length;
  const zVar   = zSlice.reduce((a, b) => a + (b - zMean) ** 2, 0) / zSlice.length;
  const zStd   = Math.sqrt(zVar);
  const zScore = zStd > 0 ? (currentATR - zMean) / zStd : 0;

  // ── Classification (both metrics must agree to upgrade) ───
  // CHAOS: both must flag extreme
  if (atrPct >= th.atrPct.CHAOS && zScore >= th.zScore.CHAOS)   return 'CHAOS';
  // ELEVATED: both must flag elevated
  if (atrPct >= th.atrPct.ELEVATED && zScore >= th.zScore.ELEVATED) return 'ELEVATED';
  // LOW: both must flag calm
  if (atrPct < th.atrPct.LOW && zScore < th.zScore.LOW)          return 'LOW';
  // Default
  return 'NORMAL';
}

/**
 * resolveParams(baseCfg, regime) → resolved config object
 *
 * Applies REGIME_MULTIPLIERS to baseCfg.
 * Returns a new object. baseCfg is never mutated.
 * Engine core receives this as its cfg argument — fully transparent.
 *
 * baseCfg: TFC[interval] object
 * regime:  string from computeRegime()
 */
function resolveParams(baseCfg, regime) {
  const mults = REGIME_MULTIPLIERS[regime] || REGIME_MULTIPLIERS.NORMAL;

  // Clone base config — never mutate canonical TFC
  const resolved = { ...baseCfg };

  // Apply multipliers
  resolved.atrMult      = +(baseCfg.atrMult      * mults.atrMult).toFixed(4);
  resolved.tp1          = +(baseCfg.tp1           * mults.tpMultiplier).toFixed(4);
  resolved.tp2          = +(baseCfg.tp2           * mults.tpMultiplier).toFixed(4);
  resolved.beMult       = +(baseCfg.beMult        * mults.beActivationR).toFixed(4);

  // Delta-based adjustments (additive, not multiplicative — preserve integer feel)
  resolved.minConf      = Math.min(95, Math.max(30,
    baseCfg.minConf      + mults.minConfDelta));

  // [v8.1 B1-FIX] SHORT gate direction-aware regime adaptation.
  // In ELEVATED/CHAOS: LONGs get harder (positive delta raises gate) but
  // SHORTs get EASIER (inverted delta lowers gate) because elevated volatility
  // is typically driven by panic/liquidation cascades — SHORT-favoring conditions.
  // In LOW regime: SHORTs get harder (calm markets = mean-reverting, SHORT risky).
  // minConfShortDelta values in REGIME_MULTIPLIERS are now interpreted as:
  //   positive = make SHORTs EASIER (inverted: subtract from gate)
  //   This only inverts for ELEVATED and CHAOS. LOW remains additive (harder SHORTs).
  const shortDeltaInverted = (regime === 'ELEVATED' || regime === 'CHAOS');
  const effectiveShortDelta = shortDeltaInverted
    ? -mults.minConfShortDelta    // invert: +15 becomes -15 → lowers SHORT gate
    : mults.minConfShortDelta;    // LOW/NORMAL: keep original direction
  resolved.minConfShort = Math.min(98, Math.max(35,
    baseCfg.minConfShort + effectiveShortDelta));
  resolved.watchThresh  = Math.min(90, Math.max(20,
    baseCfg.watchThresh  + Math.round(mults.minConfDelta * 0.5)));

  // TTL multiplier stored for backtest/simulator consumption
  resolved.orderTTLMult = mults.orderTTLMult;

  // Metadata — regime tag for logging and stats
  resolved.regime       = regime;

  return resolved;
}

// ══════════════════════════════════════════════════════════════════

// ── CIRCUIT BREAKER CONFIG — regime-aware ────────────────────────
const CIRCUIT_BREAKER = {
  maxConsecLoss: 5,    // NORMAL: pause after N consecutive losses
  resetOnWin:    true, // reset counter on next winning trade
  // Regime-aware thresholds (Watchdog reads these)
  regimeThresholds: {
    LOW:      6,       // more tolerant in calm markets
    NORMAL:   5,
    ELEVATED: 4,
    CHAOS:    3,       // hair-trigger in chaotic conditions
  },
};

// ── TF CONFIG — canonical source of truth ─────────────────────────
// Fields:
//   label          — display string
//   interval       — Binance API interval string
//   candles        — kline limit for analysis
//   atrMult        — SL distance multiplier (ATR-based fallback)
//   beMult         — BE trigger offset (× ATR from entry). 1.0 = 1 ATR in profit
//   tp1/tp2        — take profit ATR multipliers
//   htfReq         — required higher timeframe for HTF filter (null = none)
//   minConf        — minimum score % for LONG signals to show as actionable
//   minConfShort   — minimum score % for SHORT signals (always >= minConf)
//                    SHORT WR is structurally lower (~22%) — higher gate required
//   maxMove        — max % price has moved from EMA21 before signal is EXTENDED
//   entryBandMult  — entry band width multiplier (× ATR). >1 widens zone, reduces expiry
//   rL             — RSI oversold threshold for LONG scoring
//   rS             — RSI overbought threshold for SHORT scoring
//   watchThresh    — score % threshold for WATCH state (pre-signal alert)
//   note           — human-readable description
const TFC = {
  '1m': {
    label:'1m', interval:'1m', candles:200,
    // [v8.1 EB-01] entryBandMult: 1.0→1.15 (+0.15 — proportional expiry fix)
    // [v8.1 BE-01] beMult: 0.8→1.1 (+0.3 — premature BE trigger fix)
    atrMult:0.7, beMult:1.1, tp1:1.2, tp2:2.0, htfReq:'5m',
    // [v7.1-CAL] minConf: 60→40 · minConfShort: 68→45 — calibration run (open gate)
    // [v8.0-FIX] minConfShort: 45→68 — restored from CAL. Micro-TF SHORT noise is
    //            maximal; gate 45 admitted low-conviction noise trades.
    minConf:60, minConfShort:68, watchThresh:25, maxMove:0.8,
    entryBandMult:1.15, rL:30, rS:70,
    note:'[v8.1] 1m: entryBandMult 1.0→1.15 (EB-01) · beMult 0.8→1.1 (BE-01)'
  },
  '5m': {
    label:'5m', interval:'5m', candles:250,
    atrMult:0.8, beMult:1.2, tp1:1.3, tp2:2.2, htfReq:'15m',
    // [v7.1-CAL] minConf: 58→40 · minConfShort: 66→45 — calibration run
    // [v8.0-FIX] minConfShort: 45→66 — restored from CAL.
    // [v8.1 EB-01] entryBandMult: 1.0→1.15 (+0.15 — proportional expiry fix)
    // [v8.1 BE-01] beMult: 0.9→1.2 (+0.3 — premature BE trigger fix)
    minConf:58, minConfShort:66, watchThresh:25, maxMove:1.2,
    entryBandMult:1.15, rL:32, rS:68,
    note:'[v8.1] 5m: entryBandMult 1.0→1.15 (EB-01) · beMult 0.9→1.2 (BE-01)'
  },
  '15m': {
    label:'15m', interval:'15m', candles:300,
    // [v5.2] atrMult: 1.0→1.2  (58.5% SL hit rate — SL too tight for 15M volatility)
    // [v5.2] entryBandMult: 1.0→1.2  (33.8% expiry rate — entry zone critically narrow)
    // [v7.1-CAL] minConf: 55→40 · minConfShort: 68→45 — calibration run
    // [v7.3-CAL] minConf: 55→60  (best bucket 60-70 @ -0.17R; cut negative 40-50 and 50-60)
    //            minConfShort: 45→68  (restore to v5.2-calibrated gate; SHORT WR 46% acceptable)
    //            atrMult: 1.2→1.0  (RR inversion fix — avg loss -1.78R > avg win +1.18R;
    //                               tighter SL shrinks loss R, BE activates sooner)
    //            entryBandMult: 1.2→1.5  (58.2% expiry rate — zone too tight for 15M momentum)
    // [v8.1 EB-01] entryBandMult: 1.5→1.65 (+0.15 — proportional expiry fix)
    // [v8.1 BE-01] beMult: 1.0→1.3 (+0.3 — premature BE trigger fix)
    atrMult:1.0, beMult:1.3, tp1:1.5, tp2:2.5, htfReq:'1h',
    minConf:60, minConfShort:68, watchThresh:30, maxMove:2,
    entryBandMult:1.65, rL:35, rS:65,
    note:'[v8.1] 15M: entryBand 1.5→1.65 (EB-01) · beMult 1.0→1.3 (BE-01)'
  },
  '1h': {
    label:'1H', interval:'1h', candles:300,
    // [v5.2] minConf: 55→50 · entryBandMult: 1.0→1.15 · minConfShort: 63→75
    // [v7.1-CAL] minConf: 50→40 · minConfShort: 75→45 — calibration run
    // [v7.2-FIX] minConfShort: 45→75 restored — CAL override was never reverted.
    //            SHORT WR at gate 45 collapsed to 26.6% (v7.1 backtest).
    //            Gate 75 was the v5.2 calibrated value — restoring to that anchor.
    // [v7.3-CAL] entryBandMult: 1.15→1.5  (56.5% expiry rate — primary fix.
    //            10/23 signals filled at 1.15; target 16-18/23 at 1.5.
    //            80% WR on filled trades confirms signal quality is real —
    //            the zone is simply too narrow for 1H momentum breakouts.)
    // [v8.1-CAL] entryBandMult: 1.5→1.7  (CAL-03 — v8.1 regression: 57.1% BTC 1H expiry,
    //            67.1% ETH 1H expiry. Wilder ATR produces marginally lower values than
    //            SMA ATR — narrows entry bands vs prior calibration baseline.
    //            +0.2 compensates. Monitor: if expiry drops below 40%, roll back to 1.6.)
    // [v8.1 EB-01] entryBandMult: 1.7→1.85 (+0.15 — Phase 2 bundle expiry fix)
    // [v8.1 BE-01] beMult: 1.0→1.3 (+0.3 — 131 SL_BE exits at 21.3%. BE firing too early.
    //              Raise from 1.0× to 1.3× ATR profit before BE lock. Preserves +1→+1.3R window.)
    atrMult:1.3, beMult:1.3, tp1:2.0, tp2:3.5, htfReq:'4h',
    minConf:50, minConfShort:75, watchThresh:25, maxMove:3,
    entryBandMult:1.85, rL:40, rS:60,
    note:'[v8.1] 1H: entryBand 1.7→1.85 (EB-01) · beMult 1.0→1.3 (BE-01)'
  },
  '4h': {
    // [v5.1] minConf: 50→60 · atrMult: 1.6→1.8 · beMult: 1.0 · entryBandMult: 1.2
    // [v7.1-CAL] minConf: 60→40 · minConfShort: 65→45 — calibration run
    // [v7.3-CAL] minConfShort: 45→85  (4H SHORT WR 19.6% in 2022-2026 backtest.
    //            83% of trades were SHORT into a BTC bull cycle. Higher gate
    //            required until HTF hard-gate is implemented in backtest.js.
    //            LONG WR 44.4% at minConf 60 is healthy — LONG gate unchanged.
    //            entryBandMult: 1.2→1.6  (41.5% expiry rate — same issue as 1H/15M.
    //            Wider band lets trending breakouts fill without requiring pullback.)
    // [v8.1-CAL] minConfShort: 85→65  (CAL-01 — v8.1 regression: ZERO SHORTs in 4yr run.
    //            Gate 85 combined with B1 inversion (+15 CHAOS, +7 ELEVATED delta)
    //            resolves to 70/78 — still above all SHORT scores in bear cycle.
    //            Score suppression from fixed denominator is holding SHORTs at 55-65.
    //            Gate 65 → B1 CHAOS resolves to 50, ELEVATED to 58. Opens bear window.
    //            B1 fix is structurally correct; base gate was the blocker.
    //            Re-run Runs 3+4 after this CAL to validate B1 signal flow.)
    //            entryBandMult: 1.6→1.8  (CAL-03 — 55.2% expiry rate on 4H run.
    //            Wilder ATR narrows bands vs SMA ATR — compensate +0.2.)
    // [v8.1 EB-01] entryBandMult: 1.8→1.95 (+0.15 — Phase 2 bundle expiry fix)
    // [v8.1 BE-01] beMult: 1.0→1.3 (+0.3 — premature BE trigger fix, mirrors 1H)
    label:'4H', interval:'4h', candles:400,
    atrMult:1.8, beMult:1.3, tp1:2.5, tp2:5.0, htfReq:'1d',
    minConf:60, minConfShort:65, watchThresh:30, maxMove:4,
    entryBandMult:1.95, rL:45, rS:55,
    note:'[v8.1] 4H: entryBand 1.8→1.95 (EB-01) · beMult 1.0→1.3 (BE-01)'
  },
  '1d': {
    label:'1D', interval:'1d', candles:400,
    // [v7.1-CAL] already lowest — minConf:40 unchanged · minConfShort: 50→45
    // [v8.0-FIX] minConfShort: 45→70 — CAL override restored.
    //            minConfShort was BELOW minConf (45 < 50) — logically inverted.
    //            1D SHORT needs highest conviction gate across all TFs.
    // [v8.1 EB-01] entryBandMult: 1.0→1.15 (+0.15 — proportional expiry fix)
    // [v8.1 BE-01] beMult: 1.2→1.5 (+0.3 — premature BE trigger fix)
    atrMult:2.0, beMult:1.5, tp1:3.5, tp2:7.0, htfReq:null,
    minConf:50, minConfShort:70, watchThresh:25, maxMove:6,
    entryBandMult:1.15, rL:50, rS:50,
    note:'[v8.1] 1D: entryBandMult 1.0→1.15 (EB-01) · beMult 1.2→1.5 (BE-01)'
  }
};

// ── SETUP LIBRARY — v8.0 Named Strategy Archetypes ───────────────
// Each entry: { id, label, tfRange, detect(d, cfg, htfData), overrides, boost }
//   detect:    function → boolean. Receives full analyze() output.
//   overrides: DELTA object applied to active TFC config (additive, not absolute).
//   boost:     points added to sc.setup bucket (T3 tier).
//   tfRange:   array of valid TF intervals (skipped if cfg.interval not in list).
//
// Ordered by specificity — compound setups checked before archetypes.
// First match wins. All detect functions are wrapped in try/catch — a
// failing detect silently skips that entry (never crashes the scorer).
const SETUP_LIBRARY = [

  // ── COMPOUND SETUPS (most specific — checked first) ──────────────

  {
    id: 'spring_squeeze',
    label: 'Wyckoff spring + squeeze fire',
    tfRange: ['15m', '1h', '4h'],
    detect: (d) =>
      d.wyckoff?.spring &&
      d.squeeze?.fired &&
      d.volRatio > 1.5,
    overrides: { minConf: -8, tp2: +1.5, atrMult: +0.3 },
    boost: 15,
  },

  {
    id: 'absorption_bos',
    label: 'Absorption at S/R + structure break',
    tfRange: ['15m', '1h', '4h'],
    detect: (d) =>
      (d.absorption?.absorptionBull || d.absorption?.absorptionBear) &&
      (d.bos.bosBull || d.bos.bosBear),
    overrides: { minConf: -5, tp2: +1.0 },
    boost: 14,
  },

  {
    id: 'choch_volume',
    label: 'CHoCH + volume spike',
    tfRange: ['15m', '1h', '4h'],
    detect: (d) =>
      (d.choch?.chochBull || d.choch?.chochBear) &&
      d.volRatio > 2.0,
    overrides: { minConf: -5, entryBandMult: +0.3, tp2: +1.0 },
    boost: 12,
  },

  // ── ARCHETYPE SETUPS ─────────────────────────────────────────────

  {
    id: 'breakout',
    label: 'Breakout',
    tfRange: ['15m', '1h', '4h'],
    detect: (d) =>
      d.squeeze?.fired &&
      (d.bos.bosBull || d.bos.bosBear) &&
      d.volRatio > 1.5 &&
      d.adx > 25,
    overrides: { entryBandMult: +0.5, tp2: +1.0, minConf: -5 },
    boost: 12,
  },

  {
    id: 'trend_follow',
    label: 'Trend following',
    tfRange: ['1h', '4h', '1d'],
    detect: (d) =>
      (d.bullEMA || d.bearEMA) &&
      d.adx > 25 &&
      d.emaVelocity.accelerating &&
      d.macdSlope.dir === (d.bullEMA ? 'up' : 'down'),
    overrides: { tp2: +1.5, beMult: +0.3 },
    boost: 8,
  },

  {
    id: 'mean_reversion',
    label: 'Mean reversion',
    tfRange: ['5m', '15m', '1h'],
    detect: (d) =>
      (d.bollingerPctB < 0.05 || d.bollingerPctB > 0.95) &&
      (d.rsi < 30 || d.rsi > 70) &&
      d.pat.dir !== 'neutral' &&
      d.adx < 30,
    overrides: { tp1: -0.5, atrMult: -0.2 },
    boost: 10,
  },

  {
    id: 'sr_bounce',
    label: 'S/R bounce',
    tfRange: ['5m', '15m', '1h', '4h'],
    detect: (d) => {
      const nearSup = d.sr.sup.some(s =>
        Math.abs(d.price - s.price) / d.price < 0.003 && s.strength >= 2);
      const nearRes = d.sr.res.some(r =>
        Math.abs(d.price - r.price) / d.price < 0.003 && r.strength >= 2);
      return (nearSup || nearRes) && d.pat.dir !== 'neutral';
    },
    overrides: { atrMult: -0.3, entryBandMult: -0.3 },
    boost: 10,
  },

  {
    id: 'ema_cross',
    label: 'EMA cross',
    tfRange: ['15m', '1h', '4h'],
    detect: (d) =>
      d.crossEvents?.events.some(e =>
        e.status === 'confirmed' &&
        ['Golden Cross', 'Death Cross', 'EMA9×21 Bull', 'EMA9×21 Bear'].includes(e.name)) &&
      d.volRatio > 1.2,
    overrides: { minConf: -8, tp1: +0.5 },
    boost: 10,
  },

  {
    id: 'divergence',
    label: 'Multi-divergence',
    tfRange: ['1h', '4h'],
    detect: (d) => {
      let count = 0;
      if (d.rsiDiv?.regBull || d.rsiDiv?.regBear) count++;
      if (d.cvd?.cvdDivBull || d.cvd?.cvdDivBear) count++;
      if (d.macdDiv?.regBull || d.macdDiv?.regBear) count++;
      return count >= 2;
    },
    overrides: { atrMult: +0.3, tp2: +1.0 },
    boost: 12,
  },

  {
    id: 'vwap_reversion',
    label: 'VWAP reversion',
    tfRange: ['1m', '5m', '15m'],
    detect: (d) => {
      if (!d.vwap) return false;
      const dist = (d.price - d.vwap.value) / d.vwap.value;
      return (dist < -0.002 || dist > 0.002) &&
        d.pat.dir !== 'neutral' &&
        d.volRatio > 1.3;
    },
    overrides: { atrMult: -0.2 },
    boost: 8,
  },

  {
    id: 'news_reaction',
    label: 'News / event reaction',
    tfRange: ['5m', '15m', '1h'],
    detect: (d) =>
      d.volRatio > 3.0 &&
      Math.abs(d.pctChg) > 1.5 &&
      d.adx > 30,
    overrides: { atrMult: +0.8, tp1: +1.5, entryBandMult: +1.0 },
    boost: 10,
  },

  {
    id: 'scalp',
    label: 'Scalp',
    tfRange: ['1m', '5m'],
    detect: (d, cfg) =>
      (cfg.interval === '1m' || cfg.interval === '5m') &&
      (d.stoch.bullCross || d.stoch.bearCross) &&
      d.volRatio > 1.3 &&
      d.pat.dir !== 'neutral',
    overrides: { tp1: -0.4, tp2: -0.7, atrMult: -0.2, beMult: -0.3 },
    boost: 6,
  },

  {
    id: 'swing',
    label: 'Swing',
    tfRange: ['4h', '1d'],
    detect: (d, cfg, htfData) => {
      if (!d.swingStruct || !d.premDisc) return false;
      const htfAligned = !!(htfData?.['1d']?.bullEMA || htfData?.['1d']?.bearEMA);
      return d.swingStruct.trend !== 'neutral' &&
        (d.premDisc.inDiscount || d.premDisc.inPremium) &&
        htfAligned &&
        d.wyckoff?.phase !== 'markdown' && d.wyckoff?.phase !== 'markup';
    },
    overrides: { tp2: +3.0, beMult: +0.5, atrMult: +0.5 },
    boost: 10,
  },
];

// ── SETUP CLASSIFIER — v8.0 ───────────────────────────────────────
// Iterates SETUP_LIBRARY, runs detect functions, applies first match.
// Config overrides are additive deltas — never absolute replacements.
// Returns: { id, label, boost, resolvedCfg } | null
function classifySetup(d, cfg, htfData) {
  for (const setup of SETUP_LIBRARY) {
    // Skip if current TF not in this setup's valid range
    if (setup.tfRange && !setup.tfRange.includes(cfg.interval)) continue;

    try {
      if (!setup.detect(d, cfg, htfData)) continue;

      // Apply overrides as deltas to a cloned config
      const resolvedCfg = { ...cfg };
      if (setup.overrides) {
        for (const [key, delta] of Object.entries(setup.overrides)) {
          if (typeof resolvedCfg[key] === 'number') {
            resolvedCfg[key] = +(resolvedCfg[key] + delta).toFixed(4);
          }
        }
        // Safety clamps — overrides cannot push values outside safe bounds
        resolvedCfg.minConf        = clamp(resolvedCfg.minConf,        30, 95);
        resolvedCfg.minConfShort   = clamp(resolvedCfg.minConfShort,   35, 98);
        resolvedCfg.atrMult        = Math.max(0.3,  resolvedCfg.atrMult);
        resolvedCfg.tp1            = Math.max(0.5,  resolvedCfg.tp1);
        resolvedCfg.tp2            = Math.max(1.0,  resolvedCfg.tp2);
        resolvedCfg.beMult         = Math.max(0.3,  resolvedCfg.beMult);
        resolvedCfg.entryBandMult  = Math.max(0.5,  resolvedCfg.entryBandMult);
      }

      return { id: setup.id, label: setup.label, boost: setup.boost, resolvedCfg };
    } catch (e) {
      // Detect function threw — skip silently, never crash the scorer
      continue;
    }
  }
  return null;
}

// ── ANALYZE OPTIONS DEFAULTS ───────────────────────────────────────
const ANALYZE_DEFAULTS = {
  useEMA200:    false,
  useStructure: false,
  useDivergence:false,
  useSqueeze:   false,
  useCrossEvents:false,
  useWyckoff:   false,
  useCVD:       false,
  useAbsorption:false,   // [v6.0] absorption candle detector
  useVWAP:      false,   // [v8.0] VWAP + standard deviation bands
};

// ── UTILS ──────────────────────────────────────────────────────────
function ts() {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}
function fmt(n, d=2)  { return Number(n).toFixed(d); }
function fmtBig(n) {
  return n>=1e9 ? (n/1e9).toFixed(2)+'B'
       : n>=1e6 ? (n/1e6).toFixed(2)+'M'
       : n>=1e3 ? (n/1e3).toFixed(1)+'K'
       : n.toFixed(0);
}
function fmtP(p) {
  if (p>=10000) return p.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
  if (p>=100)   return p.toFixed(2);
  if (p>=1)     return p.toFixed(4);
  return p.toFixed(5);
}
function vc(c) {
  return { green:'#00ff88', red:'#ff3355', yellow:'#ffcc00',
           blue:'#00aaff',  cyan:'#00ddcc', orange:'#ff8800',
           purple:'#aa66ff', text3:'#4a6a88' }[c] || c;
}
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

// ══════════════════════════════════════════════════════════════════
// MATH LAYER — pure functions, no side effects
// ══════════════════════════════════════════════════════════════════

// ── EMA ────────────────────────────────────────────────────────────
function emaArr(data, p) {
  const k = 2/(p+1), a = new Array(data.length);
  a[0] = data[0];
  for (let i=1; i<data.length; i++) a[i] = data[i]*k + a[i-1]*(1-k);
  return a;
}
function ema(data, p) { return emaArr(data, p).slice(-1)[0]; }

// ── RSI ────────────────────────────────────────────────────────────
function rsiArr(closes, p=14) {
  const n=closes.length, r=new Array(n).fill(50);
  if (n<=p) return r;
  let sg=0, sl=0;
  for (let i=1; i<=p; i++) {
    const d=closes[i]-closes[i-1];
    d>0 ? sg+=d : sl-=d;
  }
  let ag=sg/p, al=sl/p;
  r[p] = al===0 ? 100 : 100-100/(1+ag/al);
  for (let i=p+1; i<n; i++) {
    const d=closes[i]-closes[i-1];
    const g=d>0?d:0, l=d<0?-d:0;
    ag=(ag*(p-1)+g)/p; al=(al*(p-1)+l)/p;
    r[i] = al===0 ? 100 : 100-100/(1+ag/al);
  }
  return r;
}
function rsi(closes, p=14) { return rsiArr(closes, p).slice(-1)[0]; }

// ── MACD ───────────────────────────────────────────────────────────
function macdFull(closes) {
  const e12=emaArr(closes,12), e26=emaArr(closes,26);
  const ml=e12.map((v,i)=>v-e26[i]);
  const sig=emaArr(ml,9);
  return { macdArr:ml, sigArr:sig, histArr:ml.map((v,i)=>v-sig[i]) };
}
function macd(closes) {
  const f=macdFull(closes);
  const n=f.macdArr.length;
  return {
    macd:f.macdArr[n-1], signal:f.sigArr[n-1], hist:f.histArr[n-1],
    histArr:f.histArr
  };
}

// ── MACD HISTOGRAM SLOPE (3-bar) ───────────────────────────────────
function macdHistSlope(histArr) {
  const n = histArr.length;
  if (n < 3) return { slope: 0, dir: 'flat', turningUp: false, turningDown: false };
  const h0=histArr[n-1], h1=histArr[n-2], h2=histArr[n-3];
  const slope = ((h0-h1) + (h1-h2)) / 2;
  const dir = slope > 0 ? 'up' : slope < 0 ? 'down' : 'flat';
  const turningUp   = h2 < h1 ? false : h1 < h0 && h2 >= h1;
  const turningDown = h2 > h1 ? false : h1 > h0 && h2 <= h1;
  return { slope, dir, turningUp, turningDown };
}

// ── StochRSI ───────────────────────────────────────────────────────
// [v5.1 BUG FIX] preBullCross/preBearCross: !kp<dp is always false
// (JS: !kp is boolean negation of kp, then compared to dp — nonsense)
// Corrected to: kp >= dp (not yet crossed) for preBull,
//               kp <= dp (not yet crossed) for preBear
function stochRSI(closes, p=14) {
  const ra=rsiArr(closes,p), n=ra.length;
  const ka=new Array(n).fill(50), da=new Array(n).fill(50);
  for (let i=p; i<n; i++) {
    const sl=ra.slice(i-p+1,i+1);
    const mn=Math.min(...sl), mx=Math.max(...sl);
    ka[i] = mx===mn ? 50 : (ra[i]-mn)/(mx-mn)*100;
  }
  for (let i=2; i<n; i++) da[i]=(ka[i]+ka[i-1]+ka[i-2])/3;
  const k=ka[n-1], d=da[n-1], kp=ka[n-2], dp=da[n-2];
  return {
    k, d,
    bullCross: kp<dp && k>d && k<25,
    bearCross: kp>dp && k<d && k>75,
    // [v5.1 FIX] Pre-cross: not yet crossed, within 3pts, in extreme zone
    preBullCross: kp>=dp && Math.abs(k-d)<3 && k<25,
    preBearCross: kp<=dp && Math.abs(k-d)<3 && k>75
  };
}

// ── BOLLINGER BANDS ────────────────────────────────────────────────
function bb(closes, p=20) {
  const s=closes.slice(-p);
  const m=s.reduce((a,b)=>a+b,0)/p;
  const std=Math.sqrt(s.map(v=>(v-m)**2).reduce((a,b)=>a+b,0)/p);
  return { upper:m+2*std, lower:m-2*std, mid:m, std };
}

// ── KELTNER CHANNEL ────────────────────────────────────────────────
function calcKC(closes, highs, lows, p=20, mult=1.5) {
  const mid = ema(closes, p);
  const atrV = atr(highs, lows, closes, 10);
  return { upper: mid + mult*atrV, lower: mid - mult*atrV, mid };
}

// ── BB + KC SQUEEZE (TTM-style) ────────────────────────────────────
function detectBBKCSqueeze(closes, highs, lows) {
  const p=20;
  if (closes.length < p+10) return { squeeze:false, bars:0, momentumDir:'flat', fired:false };

  const bbCur  = bb(closes, p);
  const kcCur  = calcKC(closes, highs, lows, p);
  const curSq  = bbCur.upper < kcCur.upper && bbCur.lower > kcCur.lower;

  const bbPrev = bb(closes.slice(0,-1), p);
  const kcPrev = calcKC(closes.slice(0,-1), highs.slice(0,-1), lows.slice(0,-1), p);
  const prevSq = bbPrev.upper < kcPrev.upper && bbPrev.lower > kcPrev.lower;
  const fired  = prevSq && !curSq;

  let bars = 0;
  if (curSq) {
    for (let i=closes.length-1; i>=p; i--) {
      const bbI = bb(closes.slice(0,i+1), p);
      const kcI = calcKC(closes.slice(0,i+1), highs.slice(0,i+1), lows.slice(0,i+1), p);
      if (bbI.upper < kcI.upper && bbI.lower > kcI.lower) bars++;
      else break;
      if (bars >= 50) break;
    }
  }

  const n = closes.length;
  const vals = closes.slice(-5).map((c,i) => {
    const bI = bb(closes.slice(0, n-4+i+1), p);
    return c - (bI.upper + bI.lower) / 2;
  });
  const slope = (vals[4]-vals[0]) / 4;
  const momentumDir = slope > 0.0001 ? 'up' : slope < -0.0001 ? 'down' : 'flat';

  return { squeeze: curSq, bars, momentumDir, fired };
}

// ── ATR ────────────────────────────────────────────────────────────
// [v8.1 A2-FIX] Wilder-smoothed ATR — matches computeRegime() and industry standard.
// Previous SMA-based ATR was noisier and inconsistent with regime detector.
// Wilder smoothing: ATR_t = (ATR_{t-1} × (p-1) + TR_t) / p
// Seed: SMA of first p true range values.
// Returns: single ATR value (latest bar). Requires h.length >= p+1.
function atr(h, l, c, p=14) {
  const n = h.length;
  if (n < p + 1) {
    // Fallback: simple average of available TR values
    const tr = [];
    for (let i = 1; i < n; i++)
      tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i-1]), Math.abs(l[i] - c[i-1])));
    return tr.length > 0 ? tr.reduce((a, b) => a + b, 0) / tr.length : 0;
  }

  // Compute all TR values
  const tr = [];
  for (let i = 1; i < n; i++)
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i-1]), Math.abs(l[i] - c[i-1])));

  // Seed with SMA of first p TR values
  let atrVal = tr.slice(0, p).reduce((a, b) => a + b, 0) / p;

  // Wilder smoothing for remaining values
  for (let i = p; i < tr.length; i++) {
    atrVal = (atrVal * (p - 1) + tr[i]) / p;
  }

  return atrVal;
}

// ── ADX ────────────────────────────────────────────────────────────
// [v8.1 A3-FIX] Proper Wilder-smoothed ADX — matches TradingView / industry standard.
// Previous implementation used single-pass SMA which produced significantly different
// values (more volatile, different thresholds) than standard ADX.
//
// Algorithm:
//   1. Compute +DM, -DM, TR per bar
//   2. Seed smoothed +DM14, -DM14, TR14 with SMA of first p bars
//   3. Wilder smooth: val = val - (val/p) + current
//   4. +DI = (+DM14/TR14)×100, -DI = (-DM14/TR14)×100
//   5. DX = |+DI - -DI| / (+DI + -DI) × 100
//   6. ADX = Wilder-smoothed DX over p bars
//
// Requires: highs.length >= 2*p + 1 for proper ADX smoothing.
// Returns 25 (neutral) if insufficient data.
function calcADX(highs, lows, closes, p=14) {
  const n = highs.length;
  if (n < 2 * p + 1) return 25; // need p bars for DI smooth + p bars for ADX smooth + 1

  // Step 1: Raw +DM, -DM, TR arrays (start from index 1)
  const plusDM = [], minusDM = [], trArr = [];
  for (let i = 1; i < n; i++) {
    const upMove   = highs[i] - highs[i-1];
    const downMove = lows[i-1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trArr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i-1]),
      Math.abs(lows[i] - closes[i-1])
    ));
  }

  // Step 2: Seed with SMA of first p values
  let smoothPlusDM  = plusDM.slice(0, p).reduce((a, b) => a + b, 0);
  let smoothMinusDM = minusDM.slice(0, p).reduce((a, b) => a + b, 0);
  let smoothTR      = trArr.slice(0, p).reduce((a, b) => a + b, 0);

  // Step 3: Wilder smooth +DM14, -DM14, TR14 — collect DX values for ADX smoothing
  const dxArr = [];

  for (let i = p; i < trArr.length; i++) {
    smoothPlusDM  = smoothPlusDM  - (smoothPlusDM  / p) + plusDM[i];
    smoothMinusDM = smoothMinusDM - (smoothMinusDM / p) + minusDM[i];
    smoothTR      = smoothTR      - (smoothTR      / p) + trArr[i];

    if (smoothTR === 0) { dxArr.push(0); continue; }

    const plusDI  = (smoothPlusDM  / smoothTR) * 100;
    const minusDI = (smoothMinusDM / smoothTR) * 100;
    const diSum   = plusDI + minusDI;

    dxArr.push(diSum === 0 ? 0 : (Math.abs(plusDI - minusDI) / diSum) * 100);
  }

  // Step 4: ADX = Wilder-smoothed DX
  if (dxArr.length < p) return 25;

  // Seed ADX with SMA of first p DX values
  let adxVal = dxArr.slice(0, p).reduce((a, b) => a + b, 0) / p;

  // Wilder smooth remaining DX values
  for (let i = p; i < dxArr.length; i++) {
    adxVal = (adxVal * (p - 1) + dxArr[i]) / p;
  }

  return adxVal;
}

// ── MOMENTUM OSCILLATOR (Rate of Change) ───────────────────────────
function calcMomentum(closes, p=10) {
  const n = closes.length;
  if (n < p+2) return { roc:0, rocDir:'flat' };
  const roc = ((closes[n-1] - closes[n-1-p]) / closes[n-1-p]) * 100;
  const rocPrev = ((closes[n-2] - closes[n-2-p]) / closes[n-2-p]) * 100;
  const rocDir = roc > rocPrev ? 'up' : roc < rocPrev ? 'down' : 'flat';
  return { roc, rocDir };
}

// ── EMA VELOCITY (slope) ────────────────────────────────────────────
function calcEMAVelocity(closes, lookback=3) {
  const n = closes.length;
  if (n < 50 + lookback) return { e9slope:0, e21slope:0, accelerating:false };
  const e9now  = ema(closes, 9);
  const e9prev = ema(closes.slice(0,-lookback), 9);
  const e21now = ema(closes, 21);
  const e21prev= ema(closes.slice(0,-lookback), 21);
  const e9slope  = (e9now  - e9prev)  / lookback;
  const e21slope = (e21now - e21prev) / lookback;
  const e9slope2  = (e9prev  - ema(closes.slice(0,-lookback*2), 9))  / lookback;
  const accelerating = Math.abs(e9slope) > Math.abs(e9slope2);
  return { e9slope, e21slope, accelerating };
}

// ── CVD PROXY (proportional volume delta) — v8.0 upgrade ──────────
// [v8.0] Replaces binary close>=open → ±volume with proportional estimation.
// buyPct = (close - low) / range — close at high = 100% buy, close at low = 0%.
// delta = volume × (2×buyPct - 1) — ranges -1 to +1 per bar.
// Significantly more accurate on lower TFs where binary approach introduces noise.
function calcCVD(opens, highs, lows, closes, volumes, lb=20) {
  const n = closes.length;
  if (n < lb+5) return { cvd:0, cvdDir:'flat', cvdDivBull:false, cvdDivBear:false };

  let cvdCur = 0;
  for (let i = n - lb; i < n; i++) {
    const range = highs[i] - lows[i] || 0.001;
    const buyPct = (closes[i] - lows[i]) / range;
    cvdCur += volumes[i] * (2 * buyPct - 1);
  }

  let cvdPrev = 0;
  for (let i = n - lb - 1; i < n - 1; i++) {
    const range = highs[i] - lows[i] || 0.001;
    const buyPct = (closes[i] - lows[i]) / range;
    cvdPrev += volumes[i] * (2 * buyPct - 1);
  }

  const cvdDir = cvdCur > cvdPrev ? 'up' : cvdCur < cvdPrev ? 'down' : 'flat';

  const priceHighCur  = Math.max(...closes.slice(-lb));
  const priceHighPrev = Math.max(...closes.slice(-lb-5, -5));
  const priceLowCur   = Math.min(...closes.slice(-lb));
  const priceLowPrev  = Math.min(...closes.slice(-lb-5, -5));

  const cvdDivBear = priceHighCur > priceHighPrev && cvdCur < cvdPrev;
  const cvdDivBull = priceLowCur < priceLowPrev && cvdCur > cvdPrev;

  return { cvd:cvdCur, cvdDir, cvdDivBull, cvdDivBear };
}

// ── VWAP — v8.0 ──────────────────────────────────────────────────
// Volume-Weighted Average Price with ±1σ and ±2σ standard deviation bands.
// anchor: number of bars for rolling VWAP window (null = use all available bars)
// Returns: { value, upper1, lower1, upper2, lower2 }
function calcVWAP(closes, highs, lows, volumes, anchor = null) {
  const n = closes.length;
  const start = anchor ? Math.max(0, n - anchor) : 0;
  let cumTPV = 0, cumV = 0;
  const tpArr = [];

  for (let i = start; i < n; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumTPV += tp * volumes[i];
    cumV   += volumes[i];
    tpArr.push(tp);
  }

  if (cumV === 0) {
    const p = closes[n - 1];
    return { value: p, upper1: p, lower1: p, upper2: p, lower2: p };
  }

  const vwap = cumTPV / cumV;
  const variance = tpArr.reduce((sum, tp) => sum + (tp - vwap) ** 2, 0) / tpArr.length;
  const std = Math.sqrt(variance);

  return {
    value:  vwap,
    upper1: vwap + std,
    lower1: vwap - std,
    upper2: vwap + 2 * std,
    lower2: vwap - 2 * std,
  };
}

// ── MACD DIVERGENCE — v8.0 ────────────────────────────────────────
// Same pivot comparison logic as detectRSIDiv but against MACD histogram.
// Enables multi-divergence detection in the setup classifier.
// Returns: { regBull, regBear, hidBull, hidBear }
function detectMACDDiv(highs, lows, closes, lb = 40) {
  const n = closes.length;
  if (n < lb + 26) return { regBull: false, regBear: false, hidBull: false, hidBear: false };

  const { histArr } = macdFull(closes);

  const pHighs = [], pLows = [];
  for (let i = n - lb; i < n - 2; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1])
      pHighs.push({ p: highs[i], h: histArr[i] });
    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1])
      pLows.push({ p: lows[i], h: histArr[i] });
  }

  let regBull = false, regBear = false, hidBull = false, hidBear = false;

  if (pHighs.length >= 2) {
    const [h1, h2] = pHighs.slice(-2);
    if (h2.p > h1.p && h2.h < h1.h) regBear = true;
    if (h2.p < h1.p && h2.h > h1.h) hidBear = true;
  }

  if (pLows.length >= 2) {
    const [l1, l2] = pLows.slice(-2);
    if (l2.p < l1.p && l2.h > l1.h) regBull = true;
    if (l2.p > l1.p && l2.h < l1.h) hidBull = true;
  }

  return { regBull, regBear, hidBull, hidBear };
}

// ── FIBONACCI RETRACEMENT LEVELS — v8.0 ──────────────────────────
// Returns standard retracement levels from swingHigh to swingLow.
// Used by the swing setup detector to confirm pullback depth.
function calcFibLevels(swingH, swingL) {
  const range = swingH - swingL;
  return {
    lvl236: swingH - range * 0.236,
    lvl382: swingH - range * 0.382,
    lvl500: swingH - range * 0.500,
    lvl618: swingH - range * 0.618,
    lvl786: swingH - range * 0.786,
    range,
  };
}

// ── POINT OF CONTROL — v6.0 refactored ───────────────────────────
// [v6.0] SOFT BREAK: now returns an object instead of a scalar.
// Panel v1.0 updated to access poc.value. Backtest ignores new fields.
// Computes 100-candle POC (value) + 50-candle POC (poc50) and computes
// migration direction (up/down/flat) and velocity.
function calcPoCFull(closes, volumes, n=100) {
  function pocPrice(c, v, len) {
    const mn=Math.min(...c), mx=Math.max(...c);
    const bins=30, step=(mx-mn)/bins||1;
    const prof=new Array(bins).fill(0);
    for (let i=0; i<c.length; i++) {
      const b=Math.min(Math.floor((c[i]-mn)/step), bins-1);
      prof[b]+=v[i];
    }
    let maxIdx=0;
    for (let i=1; i<bins; i++) if (prof[i]>prof[maxIdx]) maxIdx=i;
    return mn + (maxIdx*step) + (step/2);
  }

  const c100 = closes.slice(-n);
  const v100 = volumes.slice(-n);
  const c50  = closes.slice(-50);
  const v50  = volumes.slice(-50);

  const value = pocPrice(c100, v100, n);
  const poc50 = pocPrice(c50,  v50,  50);

  const diff     = poc50 - value;
  const velocity = Math.abs(diff / (value || 1)) * 100; // % shift
  const migrating = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';

  const pocBull = migrating === 'up'   && velocity > 0.05;
  const pocBear = migrating === 'down' && velocity > 0.05;

  return { value, poc50, migrating, velocity, pocBull, pocBear };
}

// ── ABSORPTION CANDLE DETECTOR — v6.0 ────────────────────────────
// [v6.0] Detects institutional absorption: high volume + small body.
// A 3-5× volume spike with a small candle body means the opposing side
// absorbed the aggression — institutional accumulation / distribution.
// Inputs: all available in analyze() — no new data required.
// Returns: { absorptionBull, absorptionBear, ratio, bars }
//   absorptionBull: vol spike + small body + prior downtrend → buying absorption
//   absorptionBear: vol spike + small body + prior uptrend  → selling absorption
//   ratio: body-to-ATR ratio (lower = more absorption)
//   bars: consecutive absorption bars detected
function detectAbsorption(opens, highs, lows, closes, volumes, atrVal, sr = null) {
  const n = closes.length;
  if (n < 25 || atrVal <= 0) {
    return { absorptionBull:false, absorptionBear:false, ratio:1, bars:0 };
  }

  const avgVol = volumes.slice(-20).reduce((a,b)=>a+b,0) / 20;
  if (avgVol <= 0) return { absorptionBull:false, absorptionBear:false, ratio:1, bars:0 };

  // Last candle
  const lastBody = Math.abs(closes[n-1] - opens[n-1]);
  const volRatio = volumes[n-1] / avgVol;
  const bodyToATR = lastBody / atrVal;

  const volumeSpike = volRatio >= 2.5;
  const smallBody   = bodyToATR < 0.35;   // body < 35% of ATR = indecisive vs volume

  // Count consecutive absorption-qualifying bars (last 3 candles)
  let bars = 0;
  for (let i = n-1; i >= Math.max(0, n-3); i--) {
    const b   = Math.abs(closes[i] - opens[i]);
    const vr  = volumes[i] / avgVol;
    if (vr >= 2.0 && b / atrVal < 0.45) bars++;
    else break;
  }

  // Prior trend detection (last 10 candles net direction)
  const recentCloses = closes.slice(-11);
  const netMove = recentCloses[recentCloses.length-1] - recentCloses[0];
  const priorDown = netMove < -atrVal * 0.5;
  const priorUp   = netMove >  atrVal * 0.5;

  const absorptionBull = volumeSpike && smallBody && priorDown;
  const absorptionBear = volumeSpike && smallBody && priorUp;

  // [v8.0] S/R proximity validation
  // Absorption at a structural level = high-conviction institutional signal.
  // Absorption in open space = noise. Gate accordingly.
  let nearStructure = true; // default true if sr not provided (backward compat)
  if (sr) {
    const closePrice = closes[n-1];
    const nearSup = sr.sup.some(s => Math.abs(closePrice - s.price) / closePrice < 0.005);
    const nearRes = sr.res.some(r => Math.abs(closePrice - r.price) / closePrice < 0.005);
    nearStructure = nearSup || nearRes;
  }

  const absorptionWeak = (absorptionBull || absorptionBear) && !nearStructure;

  return {
    absorptionBull: absorptionBull && nearStructure,
    absorptionBear: absorptionBear && nearStructure,
    absorptionWeak,  // v8.0 — absorption without S/R confirmation (scores reduced)
    ratio: bodyToATR, bars
  };
}

// ── LIQUIDITY PRESSURE — v6.0 ────────────────────────────────────
// [v6.0] Combines OI + funding + L/S into a squeeze pressure object.
// All three inputs already exist in scoreSignal() — zero new API calls.
// Logic:
//   longSqueeze:  funding>+0.05% AND lsRatio>65% AND OI rising
//                 → any down move self-amplifies (cascade liquidations)
//   shortSqueeze: funding<-0.05% AND lsRatio<35% AND OI rising
//                 → any up move self-amplifies
//   pressure:     weighted 0-100 score
//   squeezable:   true if current direction trades INTO the squeeze
// Returns: { longSqueeze, shortSqueeze, pressure, squeezable }
function computeLiquidityPressure(oiData, funding, lsData, dir) {
  if (!oiData || funding === null || !lsData) {
    return { longSqueeze:false, shortSqueeze:false, pressure:0, squeezable:false };
  }

  const f       = funding * 100;           // % form
  const lsPct   = lsData.longRatio * 100;
  const oiRising = oiData.current > oiData.prev;

  const longSqueeze = (
    f > 0.05 &&
    lsPct > 65 &&
    oiRising
  );

  const shortSqueeze = (
    f < -0.05 &&
    lsPct < 35 &&
    oiRising
  );

  // Pressure score — weighted components
  let pressure = 0;
  if (longSqueeze) {
    pressure += 40;
    if (f > 0.10)   pressure += 20;  // extreme funding
    if (lsPct > 75) pressure += 20;  // extreme crowding
    if (oiRising)   pressure += 20;
  } else if (shortSqueeze) {
    pressure += 40;
    if (f < -0.10)   pressure += 20;
    if (lsPct < 25)  pressure += 20;
    if (oiRising)    pressure += 20;
  }
  pressure = Math.min(100, pressure);

  // squeezable: true when we're trading INTO a squeeze (aligned = danger)
  // e.g. LONG into a long squeeze = counter-productive (crowd is long, will capitulate)
  // SHORT into a long squeeze = you're on the right side of the cascade
  const squeezable = (longSqueeze && dir === 'LONG') || (shortSqueeze && dir === 'SHORT');

  return { longSqueeze, shortSqueeze, pressure, squeezable };
}

// ══════════════════════════════════════════════════════════════════
// STRUCTURAL DETECTORS
// ══════════════════════════════════════════════════════════════════

function detectSwingStructure(highs, lows, closes, lb=60) {
  const n = highs.length;
  const start = Math.max(2, n-lb);
  const pivotH=[], pivotL=[];

  for (let i=start; i<n-2; i++) {
    if (highs[i]>highs[i-1]&&highs[i]>highs[i-2]&&highs[i]>highs[i+1]&&highs[i]>highs[i+2])
      pivotH.push({ price:highs[i], idx:i });
    if (lows[i]<lows[i-1]&&lows[i]<lows[i-2]&&lows[i]<lows[i+1]&&lows[i]<lows[i+2])
      pivotL.push({ price:lows[i], idx:i });
  }

  const swings = [];
  for (let i=1; i<pivotH.length; i++) {
    const type = pivotH[i].price > pivotH[i-1].price ? 'HH' : 'LH';
    swings.push({ type, price:pivotH[i].price, idx:pivotH[i].idx });
  }
  for (let i=1; i<pivotL.length; i++) {
    const type = pivotL[i].price > pivotL[i-1].price ? 'HL' : 'LL';
    swings.push({ type, price:pivotL[i].price, idx:pivotL[i].idx });
  }
  swings.sort((a,b)=>a.idx-b.idx);

  const recent = swings.slice(-4);
  const bullSwings = recent.filter(s=>s.type==='HH'||s.type==='HL').length;
  const bearSwings = recent.filter(s=>s.type==='LL'||s.type==='LH').length;
  const trend = bullSwings > bearSwings ? 'bull' : bearSwings > bullSwings ? 'bear' : 'neutral';

  const lastSwingH = pivotH.length ? pivotH[pivotH.length-1].price : null;
  const lastSwingL = pivotL.length ? pivotL[pivotL.length-1].price : null;

  return { swings, trend, lastSwingH, lastSwingL, pivotH, pivotL };
}

function detectCHoCH(swingStruct, closes) {
  const { swings, trend } = swingStruct;
  const n = closes.length;
  const price = closes[n-1];

  if (swings.length < 4) return { chochBull:false, chochBear:false, chochPrice:null };

  const lastLH = swings.filter(s=>s.type==='LH').slice(-1)[0];
  const lastHL = swings.filter(s=>s.type==='HL').slice(-1)[0];

  const chochBull = trend === 'bear' && lastLH && price > lastLH.price;
  const chochBear = trend === 'bull' && lastHL && price < lastHL.price;
  const chochPrice = chochBull ? lastLH?.price : chochBear ? lastHL?.price : null;

  return { chochBull, chochBear, chochPrice };
}

function detectFVG(highs, lows, closes, lb=50) {
  const n = highs.length;
  const price = closes[n-1];
  const fvgs = [];

  for (let i=Math.max(2, n-lb); i<n-1; i++) {
    if (lows[i] > highs[i-2]) {
      const top    = lows[i];
      const bottom = highs[i-2];
      const mid    = (top+bottom)/2;
      const mitigated = closes.slice(i+1).some(c => c <= top && c >= bottom);
      fvgs.push({ dir:'bull', top, bottom, midpoint:mid, age:n-1-i, mitigated });
    }
    if (highs[i] < lows[i-2]) {
      const top    = lows[i-2];
      const bottom = highs[i];
      const mid    = (top+bottom)/2;
      const mitigated = closes.slice(i+1).some(c => c >= bottom && c <= top);
      fvgs.push({ dir:'bear', top, bottom, midpoint:mid, age:n-1-i, mitigated });
    }
  }

  const unmitigated = fvgs.filter(f=>!f.mitigated);
  const bullFVGs = unmitigated.filter(f=>f.dir==='bull' && f.top < price)
                              .sort((a,b)=>b.top - a.top).slice(0,2);
  const bearFVGs = unmitigated.filter(f=>f.dir==='bear' && f.bottom > price)
                              .sort((a,b)=>a.bottom - b.bottom).slice(0,2);

  const nearest = [...bullFVGs, ...bearFVGs].sort((a,b) =>
    Math.abs(a.midpoint-price) - Math.abs(b.midpoint-price)
  )[0] || null;

  const priceInFVG = unmitigated.some(f => price >= f.bottom && price <= f.top);

  return { bullFVGs, bearFVGs, nearest, priceInFVG, all: unmitigated };
}

function calcPremiumDiscount(swingStruct, price) {
  const { lastSwingH, lastSwingL } = swingStruct;
  if (!lastSwingH || !lastSwingL) return { equilibrium:null, inDiscount:false, inPremium:false, distFromEQ:0 };

  const equilibrium = (lastSwingH + lastSwingL) / 2;
  const range = lastSwingH - lastSwingL;
  const inDiscount = price < equilibrium;
  const inPremium  = price > equilibrium;
  const distFromEQ = range > 0 ? ((price - equilibrium) / range) * 100 : 0;

  return { equilibrium, inDiscount, inPremium, distFromEQ };
}

function detectRSIDiv(highs, lows, closes, lb=40) {
  const n = closes.length;
  if (n < lb+14) return { regBull:false, regBear:false, hidBull:false, hidBear:false };

  const rsiVals = rsiArr(closes, 14);

  const pHighs=[], pLows=[];
  for (let i=n-lb; i<n-2; i++) {
    if (highs[i]>highs[i-1]&&highs[i]>highs[i+1]) pHighs.push({ p:highs[i], r:rsiVals[i], i });
    if (lows[i]<lows[i-1]&&lows[i]<lows[i+1])     pLows.push({ p:lows[i],  r:rsiVals[i], i });
  }

  let regBull=false, regBear=false, hidBull=false, hidBear=false;

  if (pHighs.length >= 2) {
    const [h1, h2] = pHighs.slice(-2);
    if (h2.p > h1.p && h2.r < h1.r) regBear = true;
    if (h2.p < h1.p && h2.r > h1.r) hidBear = true;
  }

  if (pLows.length >= 2) {
    const [l1, l2] = pLows.slice(-2);
    if (l2.p < l1.p && l2.r > l1.r) regBull = true;
    if (l2.p > l1.p && l2.r < l1.r) hidBull = true;
  }

  return { regBull, regBear, hidBull, hidBear };
}

function detectCrossEvents(closes, e9v, e21v, e50v, e200v) {
  const n = closes.length;
  if (n < 60) return { events:[], goldenCross:false, deathCross:false };

  const events = [];
  const PROX = 0.003;

  const e9p  = ema(closes.slice(0,-1), 9);
  const e21p = ema(closes.slice(0,-1), 21);
  const e50p = ema(closes.slice(0,-1), 50);
  const e200p = e200v !== null ? ema(closes.slice(0,-1), 200) : null;

  if (e200v !== null) {
    const confirmed = e50v > e200v && e50p <= e200p;
    const forming   = !confirmed && Math.abs(e50v-e200v)/e200v < PROX && e50v > e50p;
    if (confirmed) events.push({ name:'Golden Cross',  status:'confirmed', dir:'bull' });
    if (forming)   events.push({ name:'Golden Cross',  status:'forming',   dir:'bull' });

    const dcConf = e50v < e200v && e50p >= e200p;
    const dcForm = !dcConf && Math.abs(e50v-e200v)/e200v < PROX && e50v < e50p;
    if (dcConf) events.push({ name:'Death Cross',   status:'confirmed', dir:'bear' });
    if (dcForm) events.push({ name:'Death Cross',   status:'forming',   dir:'bear' });
  }

  const scBullConf = e21v > e50v && e21p <= e50p;
  const scBullForm = !scBullConf && Math.abs(e21v-e50v)/e50v < PROX && e21v > e21p;
  if (scBullConf) events.push({ name:'Silver Cross', status:'confirmed', dir:'bull' });
  if (scBullForm) events.push({ name:'Silver Cross', status:'forming',   dir:'bull' });

  const scBearConf = e21v < e50v && e21p >= e50p;
  const scBearForm = !scBearConf && Math.abs(e21v-e50v)/e50v < PROX && e21v < e21p;
  if (scBearConf) events.push({ name:'Dark Cross',   status:'confirmed', dir:'bear' });
  if (scBearForm) events.push({ name:'Dark Cross',   status:'forming',   dir:'bear' });

  const e9BullConf = e9v > e21v && e9p <= e21p;
  const e9BullForm = !e9BullConf && Math.abs(e9v-e21v)/e21v < PROX && e9v > e9p;
  if (e9BullConf) events.push({ name:'EMA9×21 Bull', status:'confirmed', dir:'bull' });
  if (e9BullForm) events.push({ name:'EMA9×21 Bull', status:'forming',   dir:'bull' });

  const e9BearConf = e9v < e21v && e9p >= e21p;
  const e9BearForm = !e9BearConf && Math.abs(e9v-e21v)/e21v < PROX && e9v < e9p;
  if (e9BearConf) events.push({ name:'EMA9×21 Bear', status:'confirmed', dir:'bear' });
  if (e9BearForm) events.push({ name:'EMA9×21 Bear', status:'forming',   dir:'bear' });

  const mFull = macdFull(closes);
  const mLen  = mFull.macdArr.length;
  const macdNow  = mFull.macdArr[mLen-1], sigNow  = mFull.sigArr[mLen-1];
  const macdPrev = mFull.macdArr[mLen-2], sigPrev = mFull.sigArr[mLen-2];
  const histNow  = macdNow - sigNow, histPrev = macdPrev - sigPrev;

  const macdBullConf = histNow > 0 && histPrev <= 0;
  const macdBullForm = !macdBullConf && histNow < 0 && histNow > histPrev && Math.abs(histNow) < Math.abs(histPrev)*0.3;
  if (macdBullConf) events.push({ name:'MACD Bull X', status:'confirmed', dir:'bull' });
  if (macdBullForm) events.push({ name:'MACD Bull X', status:'forming',   dir:'bull' });

  const macdBearConf = histNow < 0 && histPrev >= 0;
  const macdBearForm = !macdBearConf && histNow > 0 && histNow < histPrev && Math.abs(histNow) < Math.abs(histPrev)*0.3;
  if (macdBearConf) events.push({ name:'MACD Bear X', status:'confirmed', dir:'bear' });
  if (macdBearForm) events.push({ name:'MACD Bear X', status:'forming',   dir:'bear' });

  const goldenCross = events.some(e=>e.name==='Golden Cross'&&e.status==='confirmed');
  const deathCross  = events.some(e=>e.name==='Death Cross' &&e.status==='confirmed');

  return { events, goldenCross, deathCross };
}

function detectWyckoff(highs, lows, closes, volumes, swingStruct, poc = null) {
  const n = closes.length;
  if (n < 60) return { phase:'unknown', spring:false, confidence:0 };

  const { trend, lastSwingH, lastSwingL } = swingStruct;

  const volRecent = volumes.slice(-20).reduce((a,b)=>a+b,0)/20;
  const volPrior  = volumes.slice(-40,-20).reduce((a,b)=>a+b,0)/20;
  const volRising = volRecent > volPrior * 1.1;
  const volFalling= volRecent < volPrior * 0.9;

  const rangeRecent = Math.max(...highs.slice(-20)) - Math.min(...lows.slice(-20));
  const rangePrior  = Math.max(...highs.slice(-40,-20)) - Math.min(...lows.slice(-40,-20));
  const compressed  = rangeRecent < rangePrior * 0.7;

  let phase = 'unknown', confidence = 0;

  if (trend==='bull' && volRising && !compressed) { phase='markup'; confidence=70; }
  else if (trend==='bear' && volRising && !compressed) { phase='markdown'; confidence=70; }
  else if (compressed && volFalling && (trend==='bear'||trend==='neutral')) { phase='accumulation'; confidence=55; }
  else if (compressed && volFalling && (trend==='bull'||trend==='neutral')) { phase='distribution'; confidence=55; }
  else if (compressed && volRising) {
    phase = trend==='bear' ? 'accumulation' : 'distribution';
    confidence = 45;
  }

  let spring = false;
  if (lastSwingL !== null) {
    const lastCandle   = closes[n-1], prevLow = lows[n-1];
    const volSpike     = volumes[n-1] > volRecent * 1.8;
    const dipBelowSup  = prevLow < lastSwingL;
    const closeAboveSup= lastCandle > lastSwingL;
    spring = dipBelowSup && closeAboveSup && volSpike;
  }

  if (spring) { phase='accumulation'; confidence=Math.max(confidence, 75); }

  // [v8.0] POC migration confirms Wyckoff phase
  if (poc && poc.migrating !== 'flat' && poc.velocity > 0.05) {
    if (phase === 'accumulation' && poc.migrating === 'up') {
      confidence += 15; // institutional bid rising inside range — confirms accumulation
    }
    if (phase === 'distribution' && poc.migrating === 'down') {
      confidence += 15; // institutional offer falling — confirms distribution
    }
    // Spring validation: if poc50 is below the spring candle's close,
    // volume is concentrated at the lows — this is a genuine breakdown, not a spring.
    if (spring && poc.poc50 < closes[n-1]) {
      spring = false;
      confidence = Math.max(confidence - 10, 0);
    }
  }
  confidence = Math.min(confidence, 100);

  return { phase, spring, confidence };
}

// ══════════════════════════════════════════════════════════════════
// PATTERN + S/R DETECTORS
// ══════════════════════════════════════════════════════════════════

function detectPattern(opens, highs, lows, closes, atrVal) {
  const i=closes.length-1;
  const o=opens[i], h=highs[i], l=lows[i], c=closes[i];
  const po=opens[i-1], pc=closes[i-1];
  const body=Math.abs(c-o), pbody=Math.abs(pc-po);
  const uw=h-Math.max(o,c), lw=Math.min(o,c)-l, range=h-l||atrVal*0.01;

  if (c>po&&o<pc&&body>pbody*0.85&&body>atrVal*0.35&&c>o)
    return { p:'BULL ENGULF', dir:'bull', w:15, detail:'Bullish engulfing' };
  if (c<po&&o>pc&&body>pbody*0.85&&body>atrVal*0.35&&c<o)
    return { p:'BEAR ENGULF', dir:'bear', w:15, detail:'Bearish engulfing' };
  if (lw>body*2&&uw<body*0.5&&lw>atrVal*0.25&&c>o)
    return { p:'HAMMER',      dir:'bull', w:10, detail:'Hammer' };
  if (uw>body*2&&lw<body*0.5&&uw>atrVal*0.25&&c<o)
    return { p:'SHOOT STAR',  dir:'bear', w:10, detail:'Shooting star' };
  if (lw/range>0.6&&body/range<0.25)
    return { p:'PIN BAR ↑',  dir:'bull', w:8,  detail:'Pin bar bull' };
  if (uw/range>0.6&&body/range<0.25)
    return { p:'PIN BAR ↓',  dir:'bear', w:8,  detail:'Pin bar bear' };
  if (body<atrVal*0.08)
    return { p:'DOJI',        dir:'neutral', w:-5, detail:'Doji — indecision' };
  if (h<highs[i-1]&&l>lows[i-1])
    return { p:'INSIDE BAR',  dir:'neutral', w:0,  detail:'Inside bar' };
  return   { p:'NONE',        dir:'neutral', w:0,  detail:'—' };
}

// [v8.1 A6-FIX] Added atrVal parameter for ATR-normalized clustering.
// Previous fixed 0.004 (0.4%) tolerance worked for BTC but produced garbage
// on small-cap assets. ATR-based tolerance adapts to actual price volatility.
// Fallback: if atrVal not provided, uses 0.4% of price (backward compatible).
function findSR(highs, lows, closes, lb=60, atrVal=null) {
  const n=highs.length, start=Math.max(0,n-lb), price=closes[n-1];
  const sh=[], sl=[];
  for (let i=start+2; i<n-2; i++) {
    if (highs[i]>highs[i-1]&&highs[i]>highs[i-2]&&highs[i]>highs[i+1]&&highs[i]>highs[i+2])
      sh.push(highs[i]);
    if (lows[i]<lows[i-1]&&lows[i]<lows[i-2]&&lows[i]<lows[i+1]&&lows[i]<lows[i+2])
      sl.push(lows[i]);
  }
  // [v8.1 A6-FIX] ATR-normalized clustering tolerance.
  // Tolerance = 0.5 × ATR / reference_price — scales with actual volatility.
  // Clamp between 0.001 (0.1%) and 0.008 (0.8%) to prevent extremes.
  // Fallback: 0.004 (0.4%) if no ATR provided.
  const refPrice = closes[closes.length - 1] || 1;
  const tolerance = atrVal
    ? clamp(0.5 * atrVal / refPrice, 0.001, 0.008)
    : 0.004;

  function cluster(lvls) {
    const s = lvls.slice().sort((a, b) => a - b), out = [];
    for (let i = 0; i < s.length;) {
      let g = [s[i]], j = i + 1;
      while (j < s.length && (s[j] - g[0]) / g[0] < tolerance) { g.push(s[j]); j++; }
      out.push({ price: g.reduce((a, b) => a + b, 0) / g.length, strength: g.length });
      i = j;
    }
    return out;
  }
  const res=cluster(sh).filter(l=>l.price>price).sort((a,b)=>a.price-b.price).slice(0,3);
  const sup=cluster(sl).filter(l=>l.price<price).sort((a,b)=>b.price-a.price).slice(0,3);
  return { res, sup };
}

function pickSL(dir, entry, sr, atrV, cfg) {
  const isLong   = dir === 'LONG';
  const maxDist  = atrV * cfg.atrMult * 2;
  if (isLong) {
    const candidate = sr.sup.find(s => s.price < entry && (entry - s.price) <= maxDist);
    if (candidate) {
      const sl = +(candidate.price * 0.999).toFixed(6);
      return { sl, invalidationZone: candidate.price, source: 'structure' };
    }
  } else {
    const candidate = sr.res.find(r => r.price > entry && (r.price - entry) <= maxDist);
    if (candidate) {
      const sl = +(candidate.price * 1.001).toFixed(6);
      return { sl, invalidationZone: candidate.price, source: 'structure' };
    }
  }
  // [v5.1] atrMult now 1.8 for 4H — wider ATR fallback SL
  const sl = isLong
    ? +(entry - atrV * cfg.atrMult).toFixed(6)
    : +(entry + atrV * cfg.atrMult).toFixed(6);
  return { sl, invalidationZone: sl, source: 'atr_fallback' };
}

function detectBoS(highs, lows, closes) {
  const n=highs.length;
  let lastSwingH=null, lastSwingL=null;
  for (let i=2; i<n-2; i++) {
    if (highs[i]>highs[i-1]&&highs[i]>highs[i+1]) lastSwingH=highs[i];
    if (lows[i]<lows[i-1]&&lows[i]<lows[i+1])     lastSwingL=lows[i];
  }
  const p=closes[n-1];
  return {
    bosBull: lastSwingH!==null && p>lastSwingH,
    bosBear: lastSwingL!==null && p<lastSwingL
  };
}

// ══════════════════════════════════════════════════════════════════
// ANALYZE — master kline parser
// ══════════════════════════════════════════════════════════════════
// Legacy call: analyze(klines, true) still works (useEMA200=true)
function analyze(klines, optsOrBool={}) {
  const opts = typeof optsOrBool === 'boolean'
    ? { ...ANALYZE_DEFAULTS, useEMA200: optsOrBool }
    : { ...ANALYZE_DEFAULTS, ...optsOrBool };

  const closes = klines.map(k=>parseFloat(k[4]));
  const opens  = klines.map(k=>parseFloat(k[1]));
  const highs  = klines.map(k=>parseFloat(k[2]));
  const lows   = klines.map(k=>parseFloat(k[3]));
  const qvols  = klines.map(k=>parseFloat(k[7]));
  const price  = closes[closes.length-1];

  const e9  = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e50 = ema(closes, 50);
  const e200= opts.useEMA200 && closes.length>=200 ? ema(closes,200) : null;
  const aboveE200 = e200!==null ? price>e200 : null;

  const macdData = macd(closes);
  const b   = bb(closes);
  const a   = atr(highs, lows, closes);
  const st  = stochRSI(closes);
  const adx = calcADX(highs, lows, closes);
  const poc = calcPoCFull(closes, qvols);   // [v6.0] returns object { value, poc50, migrating, velocity, pocBull, pocBear }
  const r   = rsi(closes);

  const lqv      = qvols[qvols.length-1];
  const aqv      = qvols.slice(-20).reduce((a,b)=>a+b,0)/20;
  const volRatio = lqv/aqv;
  const lastClose= closes[closes.length-1];
  const lastOpen = opens[opens.length-1];
  const volConfL = volRatio>1.5 && lastClose>lastOpen;
  const volConfS = volRatio>1.5 && lastClose<lastOpen;
  const pctChg   = ((price-closes[closes.length-2])/closes[closes.length-2])*100;

  const distFromE21 = Math.abs((price-e21)/e21*100);
  const bullEMA = e9>e21 && e21>e50;
  const bearEMA = e9<e21 && e21<e50;

  const pat = detectPattern(opens, highs, lows, closes, a);
  const sr  = findSR(highs, lows, closes, 60, a);  // [v8.1 A6-FIX] pass ATR for normalized clustering
  const bos = detectBoS(highs, lows, closes);

  const macdSlope    = macdHistSlope(macdData.histArr);
  const emaVelocity  = calcEMAVelocity(closes);
  const momentum     = calcMomentum(closes);

  let swingStruct=null, choch=null, fvg=null, premDisc=null;
  if (opts.useStructure) {
    swingStruct = detectSwingStructure(highs, lows, closes);
    choch       = detectCHoCH(swingStruct, closes);
    fvg         = detectFVG(highs, lows, closes);
    premDisc    = calcPremiumDiscount(swingStruct, price);
  }

  let rsiDiv = null;
  if (opts.useDivergence) rsiDiv = detectRSIDiv(highs, lows, closes);

  let squeeze = null;
  if (opts.useSqueeze) squeeze = detectBBKCSqueeze(closes, highs, lows);

  let crossEvents = null;
  if (opts.useCrossEvents) crossEvents = detectCrossEvents(closes, e9, e21, e50, e200);

  let wyckoff = null;
  if (opts.useWyckoff && swingStruct) {
    wyckoff = detectWyckoff(highs, lows, closes, qvols, swingStruct, poc);
  } else if (opts.useWyckoff) {
    const sw = detectSwingStructure(highs, lows, closes);
    wyckoff  = detectWyckoff(highs, lows, closes, qvols, sw, poc);
  }

  let cvd = null;
  if (opts.useCVD) cvd = calcCVD(opens, highs, lows, closes, qvols);

  // [v6.0] Absorption candle detection — gated on useAbsorption flag
  let absorption = null;
  if (opts.useAbsorption) absorption = detectAbsorption(opens, highs, lows, closes, qvols, a, sr);

  // [v8.0] VWAP — gated on useVWAP flag
  let vwap = null;
  if (opts.useVWAP) vwap = calcVWAP(closes, highs, lows, qvols);

  // [v8.0] MACD divergence — computed whenever useDivergence is on
  let macdDiv = null;
  if (opts.useDivergence) macdDiv = detectMACDDiv(highs, lows, closes);

  // [v8.0] Bollinger %B — position of price within the BB envelope
  // 0 = at lower band, 0.5 = at midline, 1 = at upper band, <0 or >1 = outside
  const bollingerPctB = (b.upper - b.lower) > 0
    ? (price - b.lower) / (b.upper - b.lower)
    : 0.5;

  return {
    // ── Core (v4.2 compatible) ──
    price, closes, opens, highs, lows,
    e9, e21, e50, e200, aboveE200,
    rsi:r, macd:macdData, bb:b, atr:a, stoch:st, adx, poc,
    volRatio, volConfL, volConfS, pctChg,
    distFromE21,
    bullEMA, bearEMA,
    pat, sr, bos,

    // ── v5.0 additions — always present ──
    macdSlope,
    emaVelocity,
    momentum,

    // ── v5.0 additions — conditional (null if opt not set) ──
    swingStruct,
    choch,
    fvg,
    premDisc,
    rsiDiv,
    squeeze,
    crossEvents,
    wyckoff,
    cvd,

    // ── v6.0 additions — conditional (null if opt not set) ──
    absorption,  // { absorptionBull, absorptionBear, absorptionWeak, ratio, bars } | null

    // ── v8.0 additions ──
    vwap,           // { value, upper1, lower1, upper2, lower2 } | null (useVWAP)
    macdDiv,        // { regBull, regBear, hidBull, hidBear }    | null (useDivergence)
    bollingerPctB,  // 0–1 position within BB envelope (always computed)
  };
}

// ══════════════════════════════════════════════════════════════════
// DIRECTION RESOLVER — v8.0
// Replaces binary EMA gate with weighted multi-signal voting.
//
// Vote weights:
//   EMA full stack (e9>e21>e50 or inverse):  weight 3
//   EMA partial (one leg aligned):           weight 1
//   MACD histogram sign:                     weight 2
//   MACD histogram slope direction:          weight 1
//   CHoCH (if available):                    weight 2
//   Swing structure trend (if available):    weight 1
//   RSI position (>55 bull / <45 bear):      weight 1
//
// Direction threshold: net vote >= 3 to resolve.
// Confidence = |net| / maxVote * 100 — feeds score soft cap.
// Returns: { dir, confidence, votes, bullVotes, bearVotes, net }
// ══════════════════════════════════════════════════════════════════
function resolveDirection(d) {
  let bullVotes = 0, bearVotes = 0;
  const voteLog = {};

  // EMA stack — strongest signal (weight 3 full, weight 1 partial)
  if (d.bullEMA) {
    bullVotes += 3; voteLog.ema = { dir: 'bull', w: 3 };
  } else if (d.bearEMA) {
    bearVotes += 3; voteLog.ema = { dir: 'bear', w: 3 };
  } else {
    // Partial: e9>e21 but e21<e50 = early bull transition
    if (d.e9 > d.e21 && d.e21 < d.e50)      { bullVotes += 1; voteLog.ema = { dir: 'bull-partial', w: 1 }; }
    else if (d.e9 < d.e21 && d.e21 > d.e50) { bearVotes += 1; voteLog.ema = { dir: 'bear-partial', w: 1 }; }
    else { voteLog.ema = { dir: 'neutral', w: 0 }; }
  }

  // MACD histogram sign (weight 2)
  if (d.macd.hist > 0)      { bullVotes += 2; voteLog.macdHist = { dir: 'bull', w: 2 }; }
  else if (d.macd.hist < 0) { bearVotes += 2; voteLog.macdHist = { dir: 'bear', w: 2 }; }
  else { voteLog.macdHist = { dir: 'neutral', w: 0 }; }

  // MACD histogram slope (weight 1)
  if (d.macdSlope.dir === 'up')        { bullVotes += 1; voteLog.macdSlope = { dir: 'bull', w: 1 }; }
  else if (d.macdSlope.dir === 'down') { bearVotes += 1; voteLog.macdSlope = { dir: 'bear', w: 1 }; }
  else { voteLog.macdSlope = { dir: 'neutral', w: 0 }; }

  // CHoCH — optional, null if useStructure is off (weight 2)
  if (d.choch) {
    if (d.choch.chochBull)      { bullVotes += 2; voteLog.choch = { dir: 'bull', w: 2 }; }
    else if (d.choch.chochBear) { bearVotes += 2; voteLog.choch = { dir: 'bear', w: 2 }; }
    else { voteLog.choch = { dir: 'neutral', w: 0 }; }
  }

  // Swing structure trend — optional (weight 1)
  if (d.swingStruct) {
    if (d.swingStruct.trend === 'bull')      { bullVotes += 1; voteLog.swing = { dir: 'bull', w: 1 }; }
    else if (d.swingStruct.trend === 'bear') { bearVotes += 1; voteLog.swing = { dir: 'bear', w: 1 }; }
    else { voteLog.swing = { dir: 'neutral', w: 0 }; }
  }

  // RSI lean (weight 1)
  if (d.rsi > 55)      { bullVotes += 1; voteLog.rsi = { dir: 'bull', w: 1 }; }
  else if (d.rsi < 45) { bearVotes += 1; voteLog.rsi = { dir: 'bear', w: 1 }; }
  else { voteLog.rsi = { dir: 'neutral', w: 0 }; }

  // Resolve direction — threshold: net >= 3
  const net = bullVotes - bearVotes;
  const maxVote = 10; // 3+2+1+2+1+1 = 10 max one-sided
  const threshold = 3;

  let dir = null;
  if (net >= threshold)       dir = 'LONG';
  else if (net <= -threshold) dir = 'SHORT';

  const confidence = clamp(Math.round(Math.abs(net) / maxVote * 100), 0, 100);

  return { dir, confidence, votes: voteLog, bullVotes, bearVotes, net };
}

// ══════════════════════════════════════════════════════════════════
// SCORE SIGNAL — extended scoring with pre-signal intelligence
// ══════════════════════════════════════════════════════════════════
// Input:  d (from analyze()), cfg (from TFC[tf]), htfData, funding,
//         oiData (optional), lsData (optional)
// Output: { score, dir, sc, mods, fundMod, adxChop, extended,
//           preSignal, signalState, liquidityPressure,
//           dirResult, setupType }           ← v8.0 additive fields
//
// [v8.0] resolveDirection() replaces binary EMA gate
// [v8.0] dirResult exposed on return — vote breakdown for debugging
// [v8.0] setupType — classified setup archetype from SETUP_LIBRARY
// [v6.0] New sc.absorption (±18pts), sc.pocMigration (±10pts)
// [v6.0] liquidityPressure: { longSqueeze, shortSqueeze, pressure, squeezable }
// [v6.0] SHORT boost +15pts when trading WITH long squeeze cascade
// [v5.1] SHORT gating: cfg.minConfShort gates SHORT separately
// [v5.1] SHORT: CHoCH bear required — penalty if absent + useStructure
// [v5.1] SHORT: tightened bearEMA HTF requirement
// [v5.1] sc.crossProx cap: 15→10, sc.wyckoff spring cap: 18→12
function scoreSignal(d, cfg, htfData, funding, oiData=null, lsData=null) {
  const { e21, e200, aboveE200, rsi:r, macd:m, bb:b, stoch,
          volRatio, volConfL, volConfS, bullEMA, bearEMA,
          pctChg, distFromE21, pat, adx, poc, bos,
          macdSlope, emaVelocity, momentum,
          swingStruct, choch, fvg, premDisc,
          rsiDiv, squeeze, crossEvents, wyckoff, cvd,
          absorption } = d;   // [v6.0] absorption destructured
  const price = d.price;

  const activeCfg = { ...cfg };

  // [v8.0] Setup classification — runs before scoring so overrides affect all gates
  const setupResult = classifySetup(d, activeCfg, htfData);
  let setupType = null;
  if (setupResult) {
    setupType = { id: setupResult.id, label: setupResult.label };
    Object.assign(activeCfg, setupResult.resolvedCfg);
    // sc.setup boost is applied after sc init below
  }

  const sc = {
    ema:0, macd:0, rsi:0, stoch:0, vol:0, pattern:0,
    htf:0, e200:0, bos:0,
    structure:0, divergence:0, squeeze:0, crossProx:0,
    oiDiv:0, lsRatio:0, cvdDiv:0, wyckoff:0,
    absorption:0,    // [v6.0] ±18pts — institutional absorption candle
    pocMigration:0,  // [v6.0] ±10pts — POC velocity migration direction
    setup:0,         // [v8.0] setup archetype bonus — T3 bucket
  };

  let mods = [];

  // ── DIRECTION GATE — v8.0 multi-signal vote ──────────────────────
  // Replaces binary EMA stack check. resolveDirection() casts weighted
  // votes across EMA, MACD, CHoCH, swing structure, and RSI.
  // Full EMA alignment still scores 25pts; partial alignment scores 12pts.
  const dirResult = resolveDirection(d);
  let dir = dirResult.dir;

  // EMA scoring — partial-aware
  if (bullEMA)      { sc.ema = 25; }
  else if (bearEMA) { sc.ema = 25; }
  else if (dirResult.votes.ema?.w === 1) {
    sc.ema = 12; // partial EMA alignment during transition
    mods.push(`EMA partial (${dirResult.votes.ema.dir}) — 12pts`);
  }

  if (dir !== null && dirResult.confidence < 50) {
    mods.push(`DIR: ${dir} at ${dirResult.confidence}% confidence (transitional)`);
  }

  // Apply setup boost to sc.setup bucket now that sc is initialized
  if (setupResult) {
    sc.setup = setupResult.boost;
    mods.push(`SETUP: ${setupResult.label} (+${setupResult.boost}pts)`);
  }

  const preSignalReasons = [];
  let preSignalScore = 0;

  // ── PRE-SIGNAL LAYER — v8.0 per-module caps prevent noise saturation ──
  // [v8.0] Cross events capped at 40pts total (N concurrent crosses could stack infinitely)
  if (crossEvents) {
    let crossContrib = 0;
    const forming   = crossEvents.events.filter(e=>e.status==='forming');
    const confirmed = crossEvents.events.filter(e=>e.status==='confirmed');
    forming.forEach(e => {
      preSignalReasons.push(`${e.name} forming (${e.dir})`);
      crossContrib += 18;
    });
    confirmed.forEach(e => {
      preSignalReasons.push(`${e.name} confirmed`);
      crossContrib += 10;
    });
    preSignalScore += Math.min(crossContrib, 40); // cap at 40
  }

  if (macdSlope.turningUp)   { preSignalReasons.push('MACD hist slope turning up'); preSignalScore += 15; }
  if (macdSlope.turningDown) { preSignalReasons.push('MACD hist slope turning down'); preSignalScore += 15; }

  if (squeeze) {
    if (squeeze.squeeze) {
      preSignalReasons.push(`BB squeeze active — ${squeeze.bars} bars (breakout pending)`);
      preSignalScore += 12 + Math.min(squeeze.bars, 10);
    }
    if (squeeze.fired) {
      preSignalReasons.push(`Squeeze FIRED — momentum ${squeeze.momentumDir}`);
      preSignalScore += 20;
    }
  }

  // [v8.0] RSI divergence capped at 16pts (was unbounded reg+hid = 28)
  if (rsiDiv) {
    let rsiDivContrib = 0;
    if (rsiDiv.regBull) { preSignalReasons.push('Regular bull divergence (RSI)'); rsiDivContrib += 16; }
    if (rsiDiv.regBear) { preSignalReasons.push('Regular bear divergence (RSI)'); rsiDivContrib += 16; }
    if (rsiDiv.hidBull) { preSignalReasons.push('Hidden bull divergence (continuation)'); rsiDivContrib += 12; }
    if (rsiDiv.hidBear) { preSignalReasons.push('Hidden bear divergence (continuation)'); rsiDivContrib += 12; }
    preSignalScore += Math.min(rsiDivContrib, 16); // cap at 16
  }

  if (choch) {
    if (choch.chochBull) { preSignalReasons.push('CHoCH: Bull structural shift'); preSignalScore += 20; }
    if (choch.chochBear) { preSignalReasons.push('CHoCH: Bear structural shift'); preSignalScore += 20; }
  }

  // [v8.0] Wyckoff capped at 22pts (spring 22 + phase 10 was 32, too high)
  if (wyckoff) {
    let wyckoffContrib = 0;
    if (wyckoff.spring) { preSignalReasons.push('Wyckoff Spring detected'); wyckoffContrib += 22; }
    if (wyckoff.phase==='accumulation' && wyckoff.confidence>=55)
      { preSignalReasons.push('Wyckoff: Accumulation phase'); wyckoffContrib += 10; }
    if (wyckoff.phase==='distribution' && wyckoff.confidence>=55)
      { preSignalReasons.push('Wyckoff: Distribution phase'); wyckoffContrib += 10; }
    preSignalScore += Math.min(wyckoffContrib, 22); // cap at 22
  }

  if (cvd) {
    if (cvd.cvdDivBull) { preSignalReasons.push('CVD bull div: buying into dip'); preSignalScore += 14; }
    if (cvd.cvdDivBear) { preSignalReasons.push('CVD bear div: selling into rally'); preSignalScore += 14; }
  }

  // [v8.0] FVG capped at 16pts (proximity + inFVG was 28)
  if (fvg && fvg.nearest) {
    let fvgContrib = 0;
    const dist = Math.abs(fvg.nearest.midpoint - price) / price * 100;
    if (dist < 0.5) { preSignalReasons.push(`FVG ${fvg.nearest.dir} zone — price within 0.5%`); fvgContrib += 12; }
    if (fvg.priceInFVG) { preSignalReasons.push('Price inside FVG entry zone'); fvgContrib += 16; }
    preSignalScore += Math.min(fvgContrib, 16); // cap at 16
  }

  if (premDisc) {
    if (premDisc.inDiscount) { preSignalReasons.push('Price in discount zone (buy zone)'); preSignalScore += 8; }
    if (premDisc.inPremium)  { preSignalReasons.push('Price in premium zone (sell zone)'); preSignalScore += 8; }
  }

  if (emaVelocity.accelerating) { preSignalReasons.push('EMA velocity accelerating'); preSignalScore += 8; }

  // [v5.1 BUG FIX applied in stochRSI() — these now work correctly]
  if (stoch.preBullCross) { preSignalReasons.push('StochRSI pre-bull-cross (K≈D<25)'); preSignalScore += 10; }
  if (stoch.preBearCross) { preSignalReasons.push('StochRSI pre-bear-cross (K≈D>75)'); preSignalScore += 10; }

  if (momentum.rocDir === 'up'   && momentum.roc > 0) { preSignalReasons.push('ROC momentum building bullish'); preSignalScore += 7; }
  if (momentum.rocDir === 'down' && momentum.roc < 0) { preSignalReasons.push('ROC momentum building bearish'); preSignalScore += 7; }

  // [v8.1 B4-FIX] Absorption pre-signal capped at 24pts (was uncapped at 28).
  // All other pre-signal modules are capped (cross:40, rsiDiv:16, wyckoff:22, fvg:16).
  // Uncapped absorption could dominate maturity on a single volume anomaly.
  // 24pts chosen: still highest single-module weight (institutional signal is rare + high-value)
  // but cannot single-handedly push maturity from WAIT to WATCH without support.
  if (absorption) {
    let absorptionContrib = 0;
    if (absorption.absorptionBull) {
      preSignalReasons.push(`Absorption: buying absorption (ratio ${absorption.ratio.toFixed(2)})`);
      absorptionContrib += 24;
    }
    if (absorption.absorptionBear) {
      preSignalReasons.push(`Absorption: selling absorption (ratio ${absorption.ratio.toFixed(2)})`);
      absorptionContrib += 24;
    }
    preSignalScore += Math.min(absorptionContrib, 24); // cap at 24
  }

  // [v6.0] POC migration — pre-signal contribution
  if (poc && poc.migrating !== 'flat' && poc.velocity > 0.05) {
    if (poc.pocBull) {
      preSignalReasons.push(`POC rising — institutional valuation climbing (vel ${poc.velocity.toFixed(3)}%)`);
      preSignalScore += 12;
    }
    if (poc.pocBear) {
      preSignalReasons.push(`POC falling — institutional valuation declining (vel ${poc.velocity.toFixed(3)}%)`);
      preSignalScore += 12;
    }
  }

  // Tier 2: OI divergence
  if (oiData) {
    const oiRising = oiData.current > oiData.prev * 1.02;
    const oiFalling= oiData.current < oiData.prev * 0.98;
    if (oiRising && pctChg > 0)  { sc.oiDiv=8;  mods.push('OI rising with price — conviction'); }
    if (oiFalling && pctChg > 0) { sc.oiDiv=-6; mods.push('OI falling with price — weak move'); preSignalReasons.push('OI divergence: weak rally'); }
    if (oiRising && pctChg < 0)  { sc.oiDiv=-6; mods.push('OI rising on down — building shorts'); }
  }

  // [v8.0] Tier 2: Long/Short ratio pre-signal awareness
  // Direction-aware scoring runs after iL is declared (post early-return block below).
  // Pre-signal layer only captures squeeze risk reasons for PSI display.
  if (lsData) {
    const lsPct = lsData.longRatio * 100;
    if (lsPct > 75) preSignalReasons.push('Crowded long — squeeze risk');
    if (lsPct < 25) preSignalReasons.push('Crowded short — squeeze risk');
  }

  // [v8.0] Divisor raised 1.5→2.0. At 2.0, score of 200 maps to 100;
  // typical 60pt session maps to 30 instead of 40. WATCH (>=60) now
  // requires genuine multi-factor confluence rather than moderate stacking.
  const preSignalMaturity = clamp(Math.round(preSignalScore / 2.0), 0, 100);
  const preSignal = {
    active:   preSignalReasons.length > 0,
    reasons:  preSignalReasons,
    maturity: preSignalMaturity,
    score:    preSignalScore
  };

  if (!dir) {
    // [v8.1-CAL] CAL-02: adxChop threshold lowered 20→18. Wilder ADX reads structurally
    // lower than SMA ADX — same trend strength now produces ~15-20% lower ADX value.
    // Threshold 20 was over-filtering: too many trending bars flagged as CHOP.
    // Threshold 18 recalibrates to equivalent filtering at Wilder smoothing levels.
    const signalState = determineSignalState(0, activeCfg, false, adx<18, preSignal);
    return {
      score:0, dir:null, sc, mods:['No directional consensus — votes cancelled'],
      fundMod:0, adxChop:adx<18, extended:false,
      preSignal, signalState,
      liquidityPressure: { longSqueeze:false, shortSqueeze:false, pressure:0, squeezable:false },
      dirResult,    // v8.0 — vote breakdown even on null
      setupType: null,
      scoreTiers: null,
    };
  }

  const iL = dir==='LONG';
  const adxChop = adx < 18; // [v8.1-CAL] CAL-02: 20→18 (Wilder ADX recalibration — see null-dir block above)
  const extended = distFromE21 > activeCfg.maxMove;
  if (extended) mods.push(`EXTENDED: ${distFromE21.toFixed(2)}% from EMA21 (max ${activeCfg.maxMove}%)`);

  // ── MACD (0–20) ──
  if (iL&&m.hist>0)        sc.macd=20;
  else if (!iL&&m.hist<0)  sc.macd=20;
  else if (Math.abs(m.hist)<0.001*price) sc.macd=8;
  else sc.macd=0;

  if (iL&&macdSlope.turningUp)   { sc.macd=Math.min(sc.macd+5,20); mods.push('MACD hist slope turning up +5pts'); }
  if (!iL&&macdSlope.turningDown){ sc.macd=Math.min(sc.macd+5,20); mods.push('MACD hist slope turning down +5pts'); }

  // ── RSI (0–15) ──
  if (iL)  { if(r<activeCfg.rL) sc.rsi=15; else if(r<50) sc.rsi=8; else if(r>70) sc.rsi=-5; else sc.rsi=3; }
  else     { if(r>activeCfg.rS) sc.rsi=15; else if(r>50) sc.rsi=8; else if(r<30) sc.rsi=-5; else sc.rsi=3; }

  if (rsiDiv) {
    if (iL&&(rsiDiv.regBull||rsiDiv.hidBull))  { sc.divergence=12; mods.push('RSI bull divergence +12pts'); }
    if (!iL&&(rsiDiv.regBear||rsiDiv.hidBear)) { sc.divergence=12; mods.push('RSI bear divergence +12pts'); }
  }

  // ── StochRSI (0–12) ──
  if (iL)  { if(stoch.bullCross) sc.stoch=12; else if(stoch.k<20&&stoch.k>stoch.d) sc.stoch=8; else if(stoch.k<stoch.d&&stoch.k>80) sc.stoch=-4; else sc.stoch=2; }
  else     { if(stoch.bearCross) sc.stoch=12; else if(stoch.k>80&&stoch.k<stoch.d) sc.stoch=8; else if(stoch.k>stoch.d&&stoch.k<20) sc.stoch=-4; else sc.stoch=2; }

  // ── Volume (0–10) ──
  if (iL&&volConfL)        sc.vol=10;
  else if (!iL&&volConfS)  sc.vol=10;
  else if (volRatio>1.3)   sc.vol=5;

  // CVD divergence modifier
  // [v5.2] Bonus now gated on EMA stack alignment — prevents blind stacking
  //        during consolidation where cvdDiv fires without directional follow-through
  if (cvd) {
    if (iL&&cvd.cvdDivBear)  { sc.cvdDiv=-8; mods.push('CVD bear div: selling into rally -8pts'); }
    if (!iL&&cvd.cvdDivBull) { sc.cvdDiv=-8; mods.push('CVD bull div: buying into dip -8pts'); }
    // Positive bonus only when cvdDiv direction AND EMA stack both agree
    if (iL&&cvd.cvdDivBull&&bullEMA)  { sc.cvdDiv=8; mods.push('CVD bull div confirms LONG +8pts (EMA aligned)'); }
    if (!iL&&cvd.cvdDivBear&&bearEMA) { sc.cvdDiv=8; mods.push('CVD bear div confirms SHORT +8pts (EMA aligned)'); }
  }

  // ── Candle Pattern (0–15 or –5) + BB position bonus ──
  const bbPos = (price-b.lower)/(b.upper-b.lower)*100;
  if (pat.dir==='bull'&&iL)        sc.pattern=pat.w;
  else if (pat.dir==='bear'&&!iL)  sc.pattern=pat.w;
  else if (pat.dir==='neutral')    sc.pattern=pat.w;
  if (iL&&bbPos<25)   sc.pattern=Math.min(sc.pattern+3,15);
  if (!iL&&bbPos>75)  sc.pattern=Math.min(sc.pattern+3,15);

  // ── BB+KC Squeeze bonus ──
  if (squeeze) {
    if (squeeze.fired && ((iL&&squeeze.momentumDir==='up')||(!iL&&squeeze.momentumDir==='down'))) {
      sc.squeeze=15; mods.push(`Squeeze fired — momentum ${squeeze.momentumDir} +15pts`);
    } else if (squeeze.squeeze) {
      sc.squeeze=5; mods.push(`Squeeze active (${squeeze.bars} bars) — breakout imminent`);
    }
  }

  // ── Structure scoring ──
  if (choch) {
    if (iL&&choch.chochBull)  { sc.structure+=15; mods.push('CHoCH: Bull shift +15pts'); }
    if (!iL&&choch.chochBear) { sc.structure+=15; mods.push('CHoCH: Bear shift +15pts'); }
  }

  // [v5.1] SHORT requires CHoCH bear confirmation.
  // If useStructure was enabled and CHoCH bear is absent, apply -15pt penalty.
  // If useStructure was disabled (choch===null), no penalty — we cannot know.
  // Rationale: SHORT WR 22% vs LONG 54% — entry timing is the core failure.
  if (!iL && choch !== null && !choch.chochBear) {
    sc.structure -= 15;
    mods.push('SHORT: No CHoCH bear confirmation -15pts');
  }

  if (premDisc) {
    if (iL&&premDisc.inDiscount)  { sc.structure+=8; mods.push('Discount zone entry +8pts'); }
    if (!iL&&premDisc.inPremium)  { sc.structure+=8; mods.push('Premium zone short +8pts'); }
    if (iL&&premDisc.inPremium)   { sc.structure-=5; mods.push('Long in premium zone -5pts'); }
    if (!iL&&premDisc.inDiscount) { sc.structure-=5; mods.push('Short in discount zone -5pts'); }
  }

  if (fvg && fvg.priceInFVG) {
    const fvgDir = fvg.nearest?.dir;
    if (iL&&fvgDir==='bull')  { sc.structure+=10; mods.push('Price in bull FVG zone +10pts'); }
    if (!iL&&fvgDir==='bear') { sc.structure+=10; mods.push('Price in bear FVG zone +10pts'); }
  }
  sc.structure = clamp(sc.structure, -25, 20);  // expanded floor for SHORT penalty

  // ── Wyckoff scoring ──
  // [v5.1] Spring cap: 18→12, accumulation/distribution unchanged at 8
  // [v5.2] Spring cap: 12→8  (70-80 graveyard bucket confirmed on both 15M and 1H)
  // Rationale: bonus stacking inflated 70-80 bucket without directional edge
  if (wyckoff) {
    if (wyckoff.spring&&iL)  { sc.wyckoff=8; mods.push('Wyckoff Spring +8pts'); }   // was 12 in v5.1, 18 in v5.0
    if (wyckoff.phase==='accumulation'&&iL)  { sc.wyckoff=Math.max(sc.wyckoff,8); }
    if (wyckoff.phase==='distribution'&&!iL) { sc.wyckoff=Math.max(sc.wyckoff,8); }
    if (wyckoff.phase==='markdown'&&iL)      { sc.wyckoff=-8; mods.push('Wyckoff markdown — counter-trend long'); }
    if (wyckoff.phase==='markup'&&!iL)       { sc.wyckoff=-8; mods.push('Wyckoff markup — counter-trend short'); }
  }

  // ── Named cross event bonus ──
  // [v5.1] crossProx cap: 15→10
  // [v5.2] crossProx cap: 10→7  (bonus inflation in 60-80 dead bucket confirmed both TFs)
  // Rationale: stacking with structure inflated both 15M and 1H buckets without WR improvement
  if (crossEvents) {
    crossEvents.events.forEach(e => {
      const aligns = (iL && e.dir==='bull') || (!iL && e.dir==='bear');
      if (aligns && e.status==='confirmed') { sc.crossProx+=8; mods.push(`${e.name} confirmed +8pts`); }
      if (aligns && e.status==='forming')   { sc.crossProx+=5; mods.push(`${e.name} forming +5pts`); }
    });
    sc.crossProx = clamp(sc.crossProx, -10, 7);  // was 10 in v5.1, 15 in v5.0
  }

  // ── HTF Filter (0–15 or –20) ──
  // [v5.1] Additional SHORT-specific bearEMA HTF enforcement:
  // If SHORT and HTF exists but bearEMA not confirmed — extra -5pt penalty
  if (activeCfg.htfReq && htfData && htfData[activeCfg.htfReq]) {
    const htf = htfData[activeCfg.htfReq];
    const aligns = iL ? htf.bullEMA : htf.bearEMA;
    const e200ok = htf.aboveE200!==null && ((iL&&htf.aboveE200)||(!iL&&!htf.aboveE200));
    if (aligns) {
      sc.htf=15;
    } else if (e200ok) {
      sc.htf=5; mods.push('HTF: EMA200 aligns, stack mixed');
      // [v5.1] SHORT without bearEMA — additional tightening
      if (!iL) { sc.htf=2; mods.push('SHORT: HTF bearEMA absent — reduced HTF score'); }
    } else {
      sc.htf=-20; mods.push(`HTF CONFLICT: ${activeCfg.htfReq.toUpperCase()} opposes ${dir}`);
    }
  }

  // ── EMA200 (0–8 or –8) ──
  if (aboveE200!==null) {
    if ((iL&&aboveE200)||(!iL&&!aboveE200)) sc.e200=8;
    else { sc.e200=-8; mods.push('Counter-trend vs EMA200'); }
  }

  // ── BoS ──
  if (iL&&bos.bosBull)  { sc.bos=10; mods.push('BoS: Bullish structure break +10pts'); }
  if (!iL&&bos.bosBear) { sc.bos=10; mods.push('BoS: Bearish structure break +10pts'); }

  // ── [v8.0] L/S Ratio — DIRECTION-AWARE (moved here from pre-signal, post iL) ──
  // Trading AGAINST the crowd is rewarded; trading WITH the crowd is penalized.
  if (lsData) {
    const lsPct = lsData.longRatio * 100;
    if (lsPct > 75) {
      if (iL)  { sc.lsRatio = -12; mods.push(`L/S: ${lsPct.toFixed(0)}% long — with crowd (capitulation risk) -12pts`); }
      else     { sc.lsRatio =  8;  mods.push(`L/S: ${lsPct.toFixed(0)}% long — SHORT against crowd (cascade edge) +8pts`); }
    } else if (lsPct > 65) {
      if (iL)  { sc.lsRatio = -6; mods.push(`L/S: ${lsPct.toFixed(0)}% long — elevated crowding -6pts`); }
      else     { sc.lsRatio =  4; mods.push(`L/S: ${lsPct.toFixed(0)}% long — SHORT has L/S edge +4pts`); }
    } else if (lsPct < 25) {
      if (!iL) { sc.lsRatio = -12; mods.push(`L/S: ${lsPct.toFixed(0)}% long — with crowd (squeeze risk) -12pts`); }
      else     { sc.lsRatio =  8;  mods.push(`L/S: ${lsPct.toFixed(0)}% long — LONG against crowd (cascade edge) +8pts`); }
    } else if (lsPct < 35) {
      if (!iL) { sc.lsRatio = -6; mods.push(`L/S: ${lsPct.toFixed(0)}% long — elevated short crowding -6pts`); }
      else     { sc.lsRatio =  4; mods.push(`L/S: ${lsPct.toFixed(0)}% long — LONG has L/S edge +4pts`); }
    }
  }

  // ── Funding modifier ──
  let fundMod=0;
  if (funding!==null) {
    const f=funding*100;
    if (iL&&f>0.10)         { fundMod=-20; mods.push(`Funding +${f.toFixed(3)}% — EXTREME`); }
    else if (iL&&f>0.05)    { fundMod=-10; mods.push(`Funding +${f.toFixed(3)}% — crowded longs`); }
    if (!iL&&f<-0.10)       { fundMod=-20; mods.push(`Funding ${f.toFixed(3)}% — EXTREME`); }
    else if (!iL&&f<-0.05)  { fundMod=-10; mods.push(`Funding ${f.toFixed(3)}% — crowded shorts`); }
  }

  // ── [v6.0] Absorption scoring — [v8.0] S/R-gated — [v8.1 A4-FIX] else-if chain ──
  // absorptionBull/Bear = confirmed at S/R level → full ±18pts
  // absorptionWeak     = in open space, no S/R → reduced ±8pts
  // [v8.1 A4-FIX] Explicit priority chain — prevents last-write-wins overwrite.
  // Priority: aligned at S/R (+18) > aligned weak (+8) > counter-directional (-8)
  if (absorption) {
    if (iL) {
      if (absorption.absorptionBull) {
        sc.absorption = 18;
        mods.push(`Absorption BULL at S/R (ratio ${absorption.ratio.toFixed(2)}) +18pts`);
      } else if (absorption.absorptionWeak) {
        sc.absorption = 8;
        mods.push(`Absorption BULL (no S/R confirm) +8pts`);
      } else if (absorption.absorptionBear) {
        sc.absorption = -8;
        mods.push('Absorption BEAR on LONG entry -8pts');
      }
    } else {
      if (absorption.absorptionBear) {
        sc.absorption = 18;
        mods.push(`Absorption BEAR at S/R (ratio ${absorption.ratio.toFixed(2)}) +18pts`);
      } else if (absorption.absorptionWeak) {
        sc.absorption = 8;
        mods.push(`Absorption BEAR (no S/R confirm) +8pts`);
      } else if (absorption.absorptionBull) {
        sc.absorption = -8;
        mods.push('Absorption BULL on SHORT entry -8pts');
      }
    }
  }

  // ── [v6.0] POC Migration scoring (±10pts + velocity bonus) ──
  // poc is now an object from calcPoCFull(). Aligns with direction = bullish.
  // velocity bonus: +5pts if velocity > 0.15% (strong institutional migration)
  // [v8.1 A5-FIX] Explicit priority chain — aligned positive > counter negative.
  // pocBull and pocBear are currently mutually exclusive by construction,
  // but else-if guards against future refactors breaking that invariant.
  if (poc && poc.migrating !== 'flat') {
    if (iL) {
      if (poc.pocBull) {
        sc.pocMigration = 10;
        mods.push(`POC rising ${poc.migrating} (vel ${poc.velocity.toFixed(3)}%) — institutional bid +10pts`);
        if (poc.velocity > 0.15) {
          sc.pocMigration = Math.min(sc.pocMigration + 5, 15);
          mods.push('POC velocity high +5pts');
        }
      } else if (poc.pocBear) {
        sc.pocMigration = -5;
        mods.push('POC migrating DOWN — institutional valuation falling -5pts');
      }
    } else {
      if (poc.pocBear) {
        sc.pocMigration = 10;
        mods.push(`POC falling ${poc.migrating} (vel ${poc.velocity.toFixed(3)}%) — institutional offer +10pts`);
        if (poc.velocity > 0.15) {
          sc.pocMigration = Math.min(sc.pocMigration + 5, 15);
          mods.push('POC velocity high +5pts');
        }
      } else if (poc.pocBull) {
        sc.pocMigration = -5;
        mods.push('POC migrating UP — counter to SHORT thesis -5pts');
      }
    }
  }

  // ── [v6.0] Liquidity Pressure — combines OI + funding + L/S ──
  // computeLiquidityPressure returns squeeze diagnosis.
  // squeezable = we're trading INTO the crowd that will capitulate → AVOID.
  // Trading WITH a squeeze (SHORT into long squeeze) = +15pts cascade boost.
  const liquidityPressure = computeLiquidityPressure(oiData, funding, lsData, dir);
  let liqBoost = 0;
  if (liquidityPressure.longSqueeze && !iL) {
    liqBoost = 15;
    mods.push(`SHORT with long squeeze — cascade risk boost +15pts (pressure ${liquidityPressure.pressure})`);
  }
  if (liquidityPressure.shortSqueeze && iL) {
    liqBoost = 15;
    mods.push(`LONG with short squeeze — cascade risk boost +15pts (pressure ${liquidityPressure.pressure})`);
  }
  if (liquidityPressure.squeezable) {
    mods.push(`⚠ SQUEEZABLE: trading into crowded ${dir} — crowd will capitulate`);
  }

  // ══════════════════════════════════════════════════════════════════
  // TIER SCORING SYSTEM — v7.1 (B3 Threshold-Gated Blend)
  // ──────────────────────────────────────────────────────────────────
  // Architecture: Structure anchors. Confirmation amplifies. Confluence
  // rewards. None of these tiers are interchangeable.
  //
  // TIER 1 — Structural Integrity (load-bearing)
  //   "Is the market architecture aligned for this move?"
  //   Components: ema, htf, e200, bos, structure
  //   Max theoretical: 25+15+8+10+20 = 78pts
  //   Normalized denominator: TIER_DENOM.t1 = 78
  //
  // TIER 2 — Momentum Confirmation (amplifier)
  //   "Is momentum actually materializing right now?"
  //   Components: macd, rsi, stoch, vol, pattern, squeeze, divergence
  //   Max theoretical: 20+15+12+10+15+15+12 = 99pts
  //   Normalized denominator: TIER_DENOM.t2 = 99
  //
  // TIER 3 — Advanced Confluence (reward layer)
  //   "Are deeper market forces aligned?"
  //   Components: crossProx, wyckoff, cvdDiv, oiDiv, lsRatio,
  //               absorption, pocMigration
  //   Max theoretical: 7+8+8+8+12+18+10 = 71pts
  //   Normalized denominator: TIER_DENOM.t3 = 71
  //
  // BLEND RULE (B3 Threshold-Gated):
  //   IF T1 normalized >= TIER_CONFIG.structureThreshold (50%):
  //     score = T1×w1_high + T2×w2_high + T3×w3_high
  //   ELSE (structure deficit):
  //     score = T1×w1_low  + T2×w2_low  + T3×w3_low
  //     T2/T3 weight collapses — structure deficit is penalized.
  //
  // TUNING HANDLES (safe to experiment — only these values):
  //   TIER_CONFIG.structureThreshold — gate between blend modes (default 0.50)
  //     Lower → easier to qualify for full blend (more signals)
  //     Higher → harder (fewer, higher quality signals)
  //
  //   TIER_CONFIG.weights.high → [T1, T2, T3] when structure passes gate
  //     Default: [0.55, 0.30, 0.15]
  //     → Raise T1 weight to further penalize confirmation stacking
  //     → Raise T2 weight if momentum matters more than structure
  //
  //   TIER_CONFIG.weights.low → [T1, T2, T3] when structure fails gate
  //     Default: [0.70, 0.20, 0.10]
  //     → T2/T3 contribution collapses hard — structure deficit costs
  //
  //   TFC[interval].minConf — set to 40 for calibration run
  //     After calibration: re-anchor to where expectancy curve goes positive
  //
  // DO NOT TOUCH: sc.* bucket logic, denominator values, tier membership
  // ══════════════════════════════════════════════════════════════════

  // ── Tier denominators — [v8.1 DD-01/DD-02] DYNAMIC ─────────────────
  // T1: fixed 78 — all structural components always computable, no dynamic modules.
  // T2: base 72 (macd+rsi+stoch+vol+pattern). +15 if squeeze present, +12 if rsiDiv present.
  //     Only add a module's points if: (a) its flag was on AND (b) data was returned non-null.
  //     Floor: 72 (prevents division artifacts when both optional modules are off).
  // T3: base floor 7 (crossProx — always computable from crossEvents or scored 0).
  //     Each module added only if its data source is non-null and condition is met.
  //     Floor: 15 (prevents extreme normalization when few modules are active).
  //     This directly fixes the score inversion: good trades were scoring ~39 with fixed
  //     denom because T3 penalized them for modules that could never fire (null API data).
  //     With dynamic denom, a trade that fires all available signals scores proportionally high.
  //
  // NOTE: T1 structureThreshold (0.50) still uses t1Denom=78. Correct — T1 is fixed.
  // NOTE: Dynamic T3 amplifies negative scores at floor (15). A single counter-directional
  //       absorption module (-8/15 = -0.53 vs -8/86 = -0.09) now hurts meaningfully.
  //       This is intentional — if the only active T3 module screams against the trade, it should.
  //       Monitor edge case in backtest: check T3 negative score distribution post-Phase-2.

  const t1Denom = 78; // fixed — structural tier, always fully present

  // [DD-01] T2 dynamic denominator
  let t2Denom = 72;  // base: macd(20) + rsi(15) + stoch(12) + vol(10) + pattern(15)
  if (squeeze !== null)  t2Denom += 15;  // useSqueeze was on and data was computed
  if (rsiDiv !== null)   t2Denom += 12;  // useDivergence was on and rsiDiv data present
  t2Denom = Math.max(t2Denom, 72);       // floor — both off: base denominator holds

  // [DD-02] T3 dynamic denominator
  let t3Denom = 7;   // crossProx floor — always computable (zero when crossEvents null)
  if (wyckoff !== null)                   t3Denom += 8;
  if (cvd !== null)                       t3Denom += 8;
  if (oiData !== null)                    t3Denom += 8;
  if (lsData !== null)                    t3Denom += 12;
  if (absorption !== null)                t3Denom += 18;
  if (poc && poc.migrating !== 'flat')    t3Denom += 10;
  if (setupResult !== null)               t3Denom += 15;
  t3Denom = Math.max(t3Denom, 15);       // floor — prevent extreme normalization

  // ── Tier blend configuration — PRIMARY TUNING SURFACE ────────────
  const TIER_CONFIG = {
    structureThreshold: 0.50,   // T1 must reach 50% of its max to qualify for full blend
                                 // EXPERIMENT: try 0.40–0.65 to shift signal volume/quality
    weights: {
      high: [0.55, 0.30, 0.15], // [T1, T2, T3] when structure passes gate
                                 // EXPERIMENT: [0.60, 0.28, 0.12] for stricter structure gate
                                 //             [0.50, 0.35, 0.15] if momentum matters more
      low:  [0.70, 0.20, 0.10], // [T1, T2, T3] when structure fails gate
                                 // EXPERIMENT: [0.75, 0.18, 0.07] to further punish weak structure
    },
    // [v8.0] Negative penalty amplifiers — bad confluence should hurt more than it helps.
    // A deeply negative T3 was only contributing ~7pts penalty before.
    // With negPenalty.t3=1.8, a -0.49 norm contributes -0.88×w3 instead of -0.49×w3.
    negPenalty: { t2: 1.3, t3: 1.8 },
  };

  // ── Tier raw sums ─────────────────────────────────────────────────
  const t1Raw = sc.ema + sc.htf + sc.e200 + sc.bos + sc.structure;
  const t2Raw = sc.macd + sc.rsi + sc.stoch + sc.vol + sc.pattern
              + sc.squeeze + sc.divergence;
  const t3Raw = sc.crossProx + sc.wyckoff + sc.cvdDiv + sc.oiDiv
              + sc.lsRatio + sc.absorption + sc.pocMigration + sc.setup;

  // ── Normalize each tier — [v8.1 DD-03] dynamic denoms applied ───────
  // [v8.0] Asymmetric negative penalty: negative tiers are amplified before blending
  // so that bad confluence signals actually dent the score meaningfully.
  const t1Norm    = clamp(t1Raw / t1Denom, -0.5, 1.0);
  const t2NormRaw = clamp(t2Raw / t2Denom, -0.5, 1.0);
  const t3NormRaw = clamp(t3Raw / t3Denom, -0.5, 1.0);
  const t2Norm    = t2NormRaw >= 0 ? t2NormRaw : t2NormRaw * TIER_CONFIG.negPenalty.t2;
  const t3Norm    = t3NormRaw >= 0 ? t3NormRaw : t3NormRaw * TIER_CONFIG.negPenalty.t3;

  // ── Gate check — does T1 pass the structural threshold? ───────────
  const structurePasses = t1Norm >= TIER_CONFIG.structureThreshold;
  const [w1, w2, w3]    = structurePasses
    ? TIER_CONFIG.weights.high
    : TIER_CONFIG.weights.low;

  // ── Blended score (0–100) ────────────────────────────────────────
  // Modifiers (fundMod, liqBoost) applied after blend as flat adjustments
  // normalized against a reference scale of 100.
  const blended  = (t1Norm * w1) + (t2Norm * w2) + (t3Norm * w3);
  const modAdj   = (fundMod + liqBoost) / 100;

  // [v8.0] Direction confidence soft cap
  // Full confidence (>=80) = uncapped at 95.
  // Partial alignment reduces the maximum achievable score proportionally.
  // At 50% confidence, score is capped at 73. Below 30%, capped at 64.
  const confCap = dirResult.confidence >= 80
    ? 95
    : clamp(Math.round(50 + dirResult.confidence * 0.45), 50, 95);
  const score = clamp(Math.round((blended + modAdj) * 100), 0, confCap);

  // ── Score tier metadata (exposed on return for debugging/tuning) ──
  const scoreTiers = {
    t1Raw, t2Raw, t3Raw,
    t1Norm: +t1Norm.toFixed(3),
    t2Norm: +t2Norm.toFixed(3),
    t3Norm: +t3Norm.toFixed(3),
    t2NormRaw: +t2NormRaw.toFixed(3),  // v8.0 — pre-penalty value
    t3NormRaw: +t3NormRaw.toFixed(3),  // v8.0 — pre-penalty value
    structurePasses,
    weights: [w1, w2, w3],
    blended: +blended.toFixed(4),
    confCap,  // v8.0 — direction confidence ceiling
    // [v8.1 DD-03] Dynamic denominators — additive, backward safe
    t1Denom,   // always 78 (fixed structural tier)
    t2Denom,   // 72–99 depending on active squeeze/divergence modules
    t3Denom,   // 15–86 depending on active modules + data availability
  };

  // ── Signal state machine ──
  // [v5.1] SHORT uses cfg.minConfShort as effective threshold
  const effectiveCfg = !iL
    ? { ...activeCfg, minConf: activeCfg.minConfShort ?? activeCfg.minConf }
    : activeCfg;
  const signalState = determineSignalState(score, effectiveCfg, extended, adxChop, preSignal);

  return {
    score, dir, sc, mods, fundMod, adxChop, extended,
    preSignal, signalState, liquidityPressure, scoreTiers,
    dirResult,    // v8.0 — direction vote breakdown
    setupType,    // v8.0 — classified setup archetype
  };
}

// ── SIGNAL STATE MACHINE ───────────────────────────────────────────
// [v5.1] Receives effectiveCfg from scoreSignal — minConf already
// adjusted for direction before this function is called.
// No internal changes to this function — return shape preserved.
function determineSignalState(score, cfg, extended, adxChop, preSignal) {
  if (adxChop && score < cfg.minConf) return 'CHOP';
  if (extended && score >= cfg.minConf) return 'EXTENDED';

  if (score >= cfg.minConf) {
    return 'CONFIRMED'; // resolved to LONG/SHORT by scoreSignal caller
  }

  if (preSignal.maturity >= 60 && score >= cfg.watchThresh) return 'WATCH';
  if (preSignal.maturity >= 35) return 'FORMING';
  if (preSignal.active && preSignal.maturity >= 15) return 'HUNT';

  return 'WAIT';
}

// ══════════════════════════════════════════════════════════════════
// DATA FETCHERS — REST layer (unchanged)
// ══════════════════════════════════════════════════════════════════

async function fetchK(sym, iv, lim) {
  const r = await fetch(`${BASE}/klines?symbol=${sym}&interval=${iv}&limit=${lim}`);
  if (!r.ok) throw new Error(`Klines ${iv} ${r.status}`);
  return r.json();
}

async function fetchFunding(sym) {
  try {
    const r = await fetch(`${FAPI}/premiumIndex?symbol=${sym}`);
    if (!r.ok) return null;
    const d = await r.json();
    return parseFloat(d.lastFundingRate) || null;
  } catch { return null; }
}

async function fetchOI(sym) {
  try {
    const r1 = await fetch(`${FAPI}/openInterest?symbol=${sym}`);
    if (!r1.ok) return null;
    const d1 = await r1.json();
    const current = parseFloat(d1.openInterest);

    const r2 = await fetch(`${FAPI}/openInterestHist?symbol=${sym}&period=5m&limit=3`);
    if (!r2.ok) return { current, prev: current };
    const d2 = await r2.json();
    const prev = d2.length >= 2 ? parseFloat(d2[d2.length-2].sumOpenInterest) : current;

    return { current, prev };
  } catch { return null; }
}

async function fetchLSRatio(sym, period='5m') {
  try {
    const r = await fetch(`${DAPI}/topLongShortPositionRatio?symbol=${sym}&period=${period}&limit=1`);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.length) return null;
    return { longRatio: parseFloat(d[0].longAccount) };
  } catch { return null; }
}

// ══════════════════════════════════════════════════════════════════
// END OF ENGINE — v8.1 (Phase 2 + EB-01 + BE-01)
// Changelog summary:
//
//   v8.1 (Phase 2 + EB-01 + BE-01) — this build
//     [DD-01/02/03] Dynamic T2/T3 denominators — score inversion fix
//     [EB-01]       All TFs: entryBandMult +0.15 — 58.4% expiry reduction
//     [BE-01]       All TFs: beMult +0.3 — 131 premature SL_BE exits fix
//
//   v8.1 (Phase 1 + CAL)
//     [A1–A6]       ATR/ADX Wilder smoothing · absorption/POC else-if · S/R ATR-norm
//     [B1/B4]       4H SHORT regime-aware gate · pre-signal absorption cap 24pts
//     [CAL-01/02/03] SHORT gate · ADX threshold · entry band compensation
//
//   v8.0 — Setup Classification Layer + Scoring Architecture Fixes
//   v7.3 — Backtest-Driven Calibration (15M · 1H · 4H)
//   v7.2 — Backtest Bug Fix Release
//   v7.1 — Tier Scoring System (B3 Threshold-Gated Blend)
//   v7.0 — Asset-Agnostic Regime Detection
//   v6.0 — Absorption · POC Migration · Liquidity Pressure
//   v5.2 — Backtest-Driven Calibration (15M + 1H)
//   v5.1 — Backtest-Driven Calibration (4H BTC/ETH 2018–2026)
//   v5.0 — Pre-Signal Intelligence Layer
// ══════════════════════════════════════════════════════════════════
