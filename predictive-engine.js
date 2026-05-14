// ══════════════════════════════════════════════════════════════════
// VIVIENNE PREDICTIVE ENGINE v0.8.2
// File: predictive-engine.js
//
// Pre-move detection layer. Finds compression BEFORE the explosion.
// Five precursor families: volatility compression, liquidity pools,
// unmitigated structure, session windows, MTF convergence.
//
// Architecture:
//   peScanPair(symbol, klines, analyzed) — receives data already
//   fetched by trScanPair(). Zero extra API calls during TR scan.
//
//   WebSocket layer (Binance Futures + Bybit Linear):
//   Active ONLY when PE tab is open. Single symbol at a time.
//   Raw WS → ring buffer → 5s UI read cadence (isolates load).
//
// Public API (window.*):
//   peScanPair, openPredictive, peActivate, peDeactivate, peSetExchange
//
// Dependencies:
//   panel.js:  switchModule(), logTo() available on window
//   engine.js: analyze() output shape (see ANALYZE_OUTPUT comment)
// ══════════════════════════════════════════════════════════════════

/* global switchModule */
'use strict';

// ══════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════
const PE = {
  VERSION:      'v0.8.2',
  results:      {},        // symbol → PrecursorResult | null
  activeSymbol: null,      // symbol currently viewed in PE tab
  exchange:     'both',    // 'binance' | 'bybit' | 'both'
  wsBinance:    null,
  wsBybit:      null,
  liveBuffers:  {},        // symbol → ring buffer object
  wsSubbed:     null,      // currently subscribed symbol string
  peActive:     false,     // true while PE tab is mounted
  uiTimer:      null,      // 5s live-panel refresh interval
};

// ══════════════════════════════════════════════════════════════════
// SESSION CALENDAR (UTC)
// ══════════════════════════════════════════════════════════════════
const PE_SESSIONS = [
  { name: 'LONDON OPEN', utcStart: 7  * 60,      window: 90 },
  { name: 'NY OPEN',     utcStart: 13 * 60 + 30, window: 90 },
  { name: 'ASIA CLOSE',  utcStart: 2  * 60,      window: 60 },
  { name: 'NY CLOSE',    utcStart: 20 * 60,      window: 60 },
];

// ══════════════════════════════════════════════════════════════════
// FAMILY 1 — VOLATILITY COMPRESSION
// ATR ratio + BB squeeze depth + sequential range contraction.
// Primary family (weight 0.35). Most reliable cross-asset signal.
// ══════════════════════════════════════════════════════════════════
function peScoreCompression(klines, analyzed) {
  const n = klines.length;
  const FALLBACK = { score: 0, label: 'VOLATILITY COMPRESSION', stateLabel: 'INSUFFICIENT DATA',
    detail: 'Need 22+ candles', atrRatio: 1, squeeze: false, contractionCount: 0 };
  if (n < 22) return FALLBACK;

  const highs  = klines.map(k => parseFloat(k[2]));
  const lows   = klines.map(k => parseFloat(k[3]));
  const closes = klines.map(k => parseFloat(k[4]));

  // True range array
  const trArr = [];
  for (let i = 1; i < n; i++) {
    trArr.push(Math.max(
      highs[i]  - lows[i],
      Math.abs(highs[i]  - closes[i - 1]),
      Math.abs(lows[i]   - closes[i - 1])
    ));
  }

  const currentATR = analyzed.atr || 0;
  const lb         = Math.min(20, trArr.length);
  const atrMean20  = trArr.slice(-lb).reduce((a, b) => a + b, 0) / lb;
  const atrRatio   = atrMean20 > 0 ? currentATR / atrMean20 : 1;

  // Primary score: compression depth
  let score;
  if      (atrRatio < 0.35) score = 100;
  else if (atrRatio < 0.50) score = 75;
  else if (atrRatio < 0.65) score = 50;
  else if (atrRatio < 0.80) score = 25;
  else                       score = 10;

  // Bonus: BB squeeze state
  const squeezed = analyzed.squeeze?.squeeze || false;
  const sqFired  = analyzed.squeeze?.fired   || false;
  let bbBonus = 0;
  if (squeezed && !sqFired) bbBonus = 20;
  else if (sqFired)          bbBonus = 8;

  // Bonus: sequential range contraction (last 5 bars vs 20-bar avg)
  const avgRange   = trArr.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, trArr.length);
  const last5      = trArr.slice(-5);
  const contracted = last5.filter(r => r < avgRange).length;
  const contBonus  = contracted * 4; // 0–20

  const total = Math.min(100, score + bbBonus + contBonus);

  let stateLabel;
  if      (total >= 80) stateLabel = 'EXTREME COMPRESSION';
  else if (total >= 60) stateLabel = 'STRONG COMPRESSION';
  else if (total >= 40) stateLabel = 'MILD COMPRESSION';
  else                  stateLabel = 'NORMAL VOLATILITY';

  return {
    score:          total,
    label:          'VOLATILITY COMPRESSION',
    stateLabel,
    atrRatio:       parseFloat(atrRatio.toFixed(3)),
    squeeze:        squeezed,
    sqFired,
    contractionCount: contracted,
    detail: `ATR ratio ${atrRatio.toFixed(2)} · ${
      squeezed ? 'BB SQUEEZE ACTIVE' : sqFired ? 'Squeeze fired' : 'No squeeze'
    } · ${contracted}/5 bars contracted`,
  };
}

// ══════════════════════════════════════════════════════════════════
// FAMILY 2 — LIQUIDITY POOLS
// Equal high/low clusters = stop order magnets. Price visits them.
// ══════════════════════════════════════════════════════════════════
function peFindClusters(prices, threshold = 0.002) {
  if (!prices || prices.length < 2) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters = [];
  let group = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    if (group[0] > 0 && Math.abs(sorted[i] - group[0]) / group[0] < threshold) {
      group.push(sorted[i]);
    } else {
      if (group.length >= 2) {
        clusters.push({
          price: group.reduce((a, b) => a + b, 0) / group.length,
          count: group.length,
        });
      }
      group = [sorted[i]];
    }
  }
  if (group.length >= 2) {
    clusters.push({ price: group.reduce((a, b) => a + b, 0) / group.length, count: group.length });
  }
  return clusters;
}

function peScoreLiquidityPools(klines, analyzed) {
  const price  = analyzed.price;
  if (!price) return { score: 0, label: 'LIQUIDITY POOLS', detail: 'No price data', nearestPool: null, poolsAbove: [], poolsBelow: [] };

  // Collect swing prices + raw kline extremes (last 50 bars)
  const swings       = analyzed.swingStruct?.swings || [];
  const swingHPrices = swings.filter(s => s.type === 'high').map(s => s.price);
  const swingLPrices = swings.filter(s => s.type === 'low').map(s => s.price);

  const lookback = Math.min(50, klines.length);
  for (let i = klines.length - lookback; i < klines.length; i++) {
    swingHPrices.push(parseFloat(klines[i][2]));
    swingLPrices.push(parseFloat(klines[i][3]));
  }

  const highClusters = peFindClusters(swingHPrices, 0.002);
  const lowClusters  = peFindClusters(swingLPrices,  0.002);

  const poolsAbove = highClusters
    .filter(c => c.price > price * 1.001)
    .map(c => ({ ...c, side: 'BUYSTOPS',  distance: (c.price - price) / price }))
    .sort((a, b) => a.distance - b.distance);

  const poolsBelow = lowClusters
    .filter(c => c.price < price * 0.999)
    .map(c => ({ ...c, side: 'SELLSTOPS', distance: (price - c.price) / price }))
    .sort((a, b) => a.distance - b.distance);

  const nearestAbove = poolsAbove[0] || null;
  const nearestBelow = poolsBelow[0] || null;

  let nearestPool = null;
  if (nearestAbove && nearestBelow) {
    nearestPool = nearestAbove.distance <= nearestBelow.distance ? nearestAbove : nearestBelow;
  } else {
    nearestPool = nearestAbove || nearestBelow;
  }

  let score = 0;
  if (nearestPool) {
    const d = nearestPool.distance;
    if      (d < 0.003) score = 95;
    else if (d < 0.007) score = 80;
    else if (d < 0.015) score = 60;
    else if (d < 0.030) score = 40;
    else if (d < 0.060) score = 20;
    else                 score = 8;
    score = Math.min(100, score + (nearestPool.count - 2) * 5);
  }

  return {
    score,
    label:      'LIQUIDITY POOLS',
    nearestPool,
    poolsAbove: poolsAbove.slice(0, 3),
    poolsBelow: poolsBelow.slice(0, 3),
    detail: nearestPool
      ? `${nearestPool.side} @ ${peFormatPrice(nearestPool.price)} · ${(nearestPool.distance * 100).toFixed(2)}% away · ${nearestPool.count} equal levels`
      : 'No significant pools detected',
  };
}

// ══════════════════════════════════════════════════════════════════
// FAMILY 3 — UNMITIGATED STRUCTURE
// Fresh FVGs, S/R proximity, BoS / CHoCH as precursor triggers.
// ══════════════════════════════════════════════════════════════════
function peScoreUnmitigatedStructure(klines, analyzed) {
  const price  = analyzed.price;
  if (!price) return { score: 0, label: 'UNMITIGATED STRUCTURE', detail: 'No price data', fvgCount: 0, nearestFVG: null };

  let score = 0;
  const detail = [];

  // FVG analysis (from analyze() output)
  const fvg = analyzed.fvg;
  if (fvg) {
    if (fvg.priceInFVG) {
      score += 35;
      detail.push('PRICE IN FVG');
    } else if (fvg.nearest) {
      const dist = Math.abs(fvg.nearest.mid - price) / price;
      if      (dist < 0.005) { score += 40; detail.push(`FVG ${(dist * 100).toFixed(1)}% away`); }
      else if (dist < 0.015) { score += 28; detail.push(`FVG ${(dist * 100).toFixed(1)}% away`); }
      else if (dist < 0.035) { score += 18; detail.push(`FVG ${(dist * 100).toFixed(1)}% away`); }
      else if (dist < 0.070) { score += 8;  detail.push(`FVG ${(dist * 100).toFixed(1)}% away`); }
    }
    const fvgCount = (fvg.bullFVGs?.length || 0) + (fvg.bearFVGs?.length || 0);
    if (fvgCount > 2) { score += 10; detail.push(`${fvgCount} unmitigated FVGs`); }
  }

  // S/R proximity
  const sr = analyzed.sr;
  if (sr) {
    const res = (sr.res || []).filter(r => r > price).sort((a, b) => a - b)[0];
    const sup = (sr.sup || []).filter(s => s < price).sort((a, b) => b - a)[0];
    if (res) {
      const d = (res - price) / price;
      if (d < 0.008) { score += 18; detail.push(`RES ${(d * 100).toFixed(1)}% above`); }
      else if (d < 0.025) { score += 8; detail.push(`RES ${(d * 100).toFixed(1)}% above`); }
    }
    if (sup) {
      const d = (price - sup) / price;
      if (d < 0.008) { score += 18; detail.push(`SUP ${(d * 100).toFixed(1)}% below`); }
      else if (d < 0.025) { score += 8; detail.push(`SUP ${(d * 100).toFixed(1)}% below`); }
    }
  }

  // BoS — fresh structural break signals institutional intent
  const bos = analyzed.bos;
  if      (bos?.bull)  { score += 12; detail.push('BULL BoS'); }
  else if (bos?.bear)  { score += 12; detail.push('BEAR BoS'); }

  // CHoCH — character change is a primary precursor trigger
  const choch = analyzed.choch;
  if      (choch?.chochBull) { score += 15; detail.push('CHoCH BULL'); }
  else if (choch?.chochBear) { score += 15; detail.push('CHoCH BEAR'); }

  score = Math.min(100, score);

  return {
    score,
    label:     'UNMITIGATED STRUCTURE',
    fvgCount:  (fvg?.bullFVGs?.length || 0) + (fvg?.bearFVGs?.length || 0),
    nearestFVG: fvg?.nearest || null,
    hasBos:    !!(bos?.bull || bos?.bear),
    hasChoch:  !!(choch?.chochBull || choch?.chochBear),
    detail:    detail.length ? detail.join(' · ') : 'No unmitigated zones nearby',
  };
}

// ══════════════════════════════════════════════════════════════════
// FAMILY 4 — SESSION WINDOW
// High-liquidity session proximity. A compression inside a window
// has ~2× the resolution probability of the same compression at 02UTC.
// ══════════════════════════════════════════════════════════════════
function peScoreSessionWindow() {
  const now      = new Date();
  const utcH     = now.getUTCHours();
  const utcM     = now.getUTCMinutes();
  const utcTotal = utcH * 60 + utcM;

  let bestScore       = 0;
  let activeSession   = null;
  let nearestUpcoming = null;
  let minMinsAway     = Infinity;

  for (const s of PE_SESSIONS) {
    const minsFromStart = ((utcTotal - s.utcStart) + 1440) % 1440;

    if (minsFromStart < s.window) {
      // Inside this session window right now
      bestScore     = Math.max(bestScore, 100);
      activeSession = { name: s.name, minsRemaining: s.window - minsFromStart };
    } else {
      // Minutes until next occurrence of this session
      const minsUntil = 1440 - minsFromStart;
      if (minsUntil < minMinsAway) {
        minMinsAway = minsUntil;
        const sc    = minsUntil < 30 ? 85 : minsUntil < 90 ? 65 : minsUntil < 180 ? 40 : 15;
        bestScore   = Math.max(bestScore, sc);
        nearestUpcoming = { name: s.name, minutesAway: minsUntil };
      }
    }
  }

  return {
    score:          bestScore,
    label:          'SESSION WINDOW',
    activeSession,
    nearestUpcoming,
    utcTime:        `${String(utcH).padStart(2, '0')}:${String(utcM).padStart(2, '0')} UTC`,
    detail: activeSession
      ? `${activeSession.name} ACTIVE — ${activeSession.minsRemaining}min remaining`
      : nearestUpcoming
        ? `${nearestUpcoming.name} in ${nearestUpcoming.minutesAway}min`
        : 'Calculating session…',
  };
}

// ══════════════════════════════════════════════════════════════════
// FAMILY 5 — MTF CONVERGENCE
// EMA coil, E21 proximity, Wyckoff structure, PoC, RSI midline.
// ══════════════════════════════════════════════════════════════════
function peScoreMTFConvergence(analyzed) {
  let score = 0;
  const signals = [];

  const { e9, e21, e50, price } = analyzed;

  // EMA coil: all three EMAs within tight band
  if (e9 && e21 && e50 && price) {
    const emaSpread = Math.abs(Math.max(e9, e21, e50) - Math.min(e9, e21, e50));
    const emaPct    = emaSpread / price;
    if      (emaPct < 0.003) { score += 35; signals.push('EMA TIGHT COIL'); }
    else if (emaPct < 0.008) { score += 20; signals.push('EMA COMPRESSING'); }
    else if (emaPct < 0.015) { score += 8;  signals.push('EMA SPREAD'); }
  }

  // E21 proximity (primary dynamic S/R)
  const distE21 = Math.abs(analyzed.distFromE21 || 0);
  if      (distE21 < 0.3)  { score += 20; signals.push('ON E21'); }
  else if (distE21 < 0.8)  { score += 10; signals.push('NEAR E21'); }
  else if (distE21 < 1.5)  { score += 4;  signals.push('APPROACHING E21'); }

  // Wyckoff structure
  const wyc = analyzed.wyckoff;
  if (wyc) {
    if (wyc.spring && wyc.phase === 'accumulation') { score += 25; signals.push('WYCK SPRING'); }
    else if (wyc.phase === 'accumulation')           { score += 12; signals.push('WYCK ACCUM'); }
    else if (wyc.phase === 'distribution')           { score += 12; signals.push('WYCK DIST'); }
  }

  // PoC proximity (value area gravity)
  const poc = analyzed.poc;
  if (poc && price) {
    const pocDist = Math.abs(poc.value - price) / price;
    if      (pocDist < 0.003) { score += 15; signals.push('AT POC'); }
    else if (pocDist < 0.010) { score += 8;  signals.push('NEAR POC'); }
    else if (pocDist < 0.025) { score += 3;  signals.push('POC ZONE'); }
  }

  // RSI midline coil (47–56 = neither extreme — coiling energy)
  const rsiVal = analyzed.rsi;
  if (rsiVal >= 47 && rsiVal <= 56) { score += 10; signals.push(`RSI ${rsiVal.toFixed(0)} MIDLINE`); }

  score = Math.min(100, score);

  return {
    score,
    label:   'MTF CONVERGENCE',
    signals,
    detail:  signals.length ? signals.join(' · ') : 'No convergence signals detected',
  };
}

// ══════════════════════════════════════════════════════════════════
// DIRECTION BIAS RESOLVER
// Combines pool location + FVG gravity + CHoCH + EMA + PremDisc.
// ══════════════════════════════════════════════════════════════════
function peResolveDirectionBias(f2, f3, analyzed) {
  let bull = 0, bear = 0;

  // Pool location — nearest stop cluster defines probable hunt direction
  if (f2.nearestPool) {
    if (f2.nearestPool.side === 'BUYSTOPS')  bull += 3;
    else                                      bear += 3;
    if (f2.poolsAbove.length > f2.poolsBelow.length) bull += 1;
    else if (f2.poolsBelow.length > f2.poolsAbove.length) bear += 1;
  }

  // FVG gravity — FVG above price pulls it up; below pulls it down
  if (f3.nearestFVG) {
    if (f3.nearestFVG.mid > analyzed.price) bull += 2;
    else                                     bear += 2;
  }

  // CHoCH direction — strongest structural precursor
  const choch = analyzed.choch;
  if      (choch?.chochBull) bull += 3;
  else if (choch?.chochBear) bear += 3;

  // EMA alignment
  if      (analyzed.bullEMA) bull += 1;
  else if (analyzed.bearEMA) bear += 1;

  // Premium/Discount zone
  const pd = analyzed.premDisc;
  if      (pd?.inDiscount)  bull += 1;
  else if (pd?.inPremium)   bear += 1;

  const net = bull - bear;
  if (net >=  3) return 'LONG';
  if (net <= -3) return 'SHORT';
  return 'NEUTRAL';
}

// ══════════════════════════════════════════════════════════════════
// IGNITION WINDOW ESTIMATOR
// ══════════════════════════════════════════════════════════════════
function peEstimateIgnitionWindow(f1, f4) {
  if (f1.score >= 75 && f4.score >= 85) return { label: 'NOW',    color: 'var(--red)'    };
  if (f1.score >= 60 && f4.score >= 65) return { label: '< 1H',   color: 'var(--yellow)' };
  if (f1.score >= 45 && f4.score >= 40) return { label: '1–4H',   color: 'var(--cyan2)'  };
  if (f1.score >= 25)                    return { label: '4H+',    color: 'var(--text3)'  };
  return                                         { label: 'LOADING', color: 'var(--text4)' };
}

// ══════════════════════════════════════════════════════════════════
// INVALIDATION LEVEL
// ══════════════════════════════════════════════════════════════════
function peComputeInvalidation(analyzed, dirBias) {
  const price  = analyzed.price || 0;
  const atrVal = analyzed.atr   || 0;

  if (dirBias === 'LONG') {
    const swingL    = analyzed.swingStruct?.lastSwingL;
    const candidate = price - 1.5 * atrVal;
    return swingL ? Math.min(swingL * 0.999, candidate) : candidate;
  }
  if (dirBias === 'SHORT') {
    const swingH    = analyzed.swingStruct?.lastSwingH;
    const candidate = price + 1.5 * atrVal;
    return swingH ? Math.max(swingH * 1.001, candidate) : candidate;
  }
  return price - atrVal;
}

// ══════════════════════════════════════════════════════════════════
// MASTER PRECURSOR SCORER
// ══════════════════════════════════════════════════════════════════
function peScorePrecursor(symbol, klines, analyzed) {
  try {
    const f1 = peScoreCompression(klines, analyzed);
    const f2 = peScoreLiquidityPools(klines, analyzed);
    const f3 = peScoreUnmitigatedStructure(klines, analyzed);
    const f4 = peScoreSessionWindow();
    const f5 = peScoreMTFConvergence(analyzed);

    // Weighted composite — single factor output, NOT correlated summation
    const composite = Math.round(
      f1.score * 0.35 +
      f2.score * 0.25 +
      f3.score * 0.20 +
      f4.score * 0.10 +
      f5.score * 0.10
    );

    const dirBias        = peResolveDirectionBias(f2, f3, analyzed);
    const ignitionWindow = peEstimateIgnitionWindow(f1, f4);
    const invalidation   = peComputeInvalidation(analyzed, dirBias);

    return {
      score:          composite,
      dirBias,
      ignitionWindow,
      invalidation,
      scannedAt:      Date.now(),
      families:       { f1, f2, f3, f4, f5 },
      price:          analyzed.price,
      symbol,
    };
  } catch (e) {
    console.warn('[PE] Scoring error for', symbol, e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// WEBSOCKET INFRASTRUCTURE
// Binance Futures + Bybit Linear. Active only when PE tab open.
// Single symbol at a time. Ring buffers; UI reads every 5s.
// ══════════════════════════════════════════════════════════════════

function peInitBuffer(symbol) {
  if (PE.liveBuffers[symbol]) return;
  PE.liveBuffers[symbol] = {
    cvdBuckets:     new Array(15).fill(0),  // 1-min buckets, rolling 15min
    cvdBucketIdx:   0,
    cvdBucketStart: Date.now(),
    cvdRunning:     0,
    obiCurrent:     0,
    lastBidStack:   0,
    lastAskStack:   0,
    liqEvents:      [],                     // rolling 20 liquidation events
    lastUpdate:     0,
  };
}

function peUpdateCVD(symbol, qty, isBuyerMaker) {
  const buf = PE.liveBuffers[symbol];
  if (!buf) return;
  const delta = isBuyerMaker ? -qty : qty;
  if (Date.now() - buf.cvdBucketStart > 60000) {
    buf.cvdBucketIdx    = (buf.cvdBucketIdx + 1) % 15;
    buf.cvdBuckets[buf.cvdBucketIdx] = 0;
    buf.cvdBucketStart  = Date.now();
  }
  buf.cvdBuckets[buf.cvdBucketIdx] += delta;
  buf.cvdRunning  += delta;
  buf.lastUpdate   = Date.now();
}

function peUpdateOBI(symbol, bids, asks) {
  const buf = PE.liveBuffers[symbol];
  if (!buf) return;
  const TOP    = 10;
  const bidVol = bids.slice(0, TOP).reduce((s, b) => s + parseFloat(b[1] || 0), 0);
  const askVol = asks.slice(0, TOP).reduce((s, a) => s + parseFloat(a[1] || 0), 0);
  const total  = bidVol + askVol;
  buf.obiCurrent  = total > 0 ? (bidVol - askVol) / total : 0;
  buf.lastBidStack = bidVol;
  buf.lastAskStack = askVol;
}

function peAddLiqEvent(symbol, event) {
  const buf = PE.liveBuffers[symbol];
  if (!buf) return;
  buf.liqEvents.push({ ...event, ts: Date.now() });
  if (buf.liqEvents.length > 20) buf.liqEvents.shift();
}

function peGetLiveMetrics(symbol) {
  const buf = PE.liveBuffers[symbol];
  if (!buf || buf.lastUpdate === 0) return null;
  const cvd1m  = buf.cvdBuckets[buf.cvdBucketIdx];
  const cvd5m  = buf.cvdBuckets.slice(-5).reduce((a, b) => a + b, 0);
  const cvd15m = buf.cvdBuckets.reduce((a, b) => a + b, 0);
  const now    = Date.now();
  const recent = buf.liqEvents.filter(e => now - e.ts < 60000);
  const liqBuyUSD  = recent.filter(e => e.side === 'Buy').reduce((s, e) => s + (e.usd || 0), 0);
  const liqSellUSD = recent.filter(e => e.side === 'Sell').reduce((s, e) => s + (e.usd || 0), 0);
  return { cvd1m, cvd5m, cvd15m, obi: buf.obiCurrent, liqBuyUSD, liqSellUSD, lastUpdate: buf.lastUpdate };
}

// ── BINANCE FUTURES WS ────────────────────────────────────────────
function peConnectBinance(symbol) {
  if (PE.wsBinance) {
    try { PE.wsBinance.onclose = null; PE.wsBinance.close(); } catch (e) { /* ignore */ }
    PE.wsBinance = null;
  }
  const sym = symbol.toLowerCase();
  const url  = `wss://fstream.binance.com/stream?streams=${sym}@aggTrade/${sym}@depth@500ms/${sym}@forceOrder`;
  peInitBuffer(symbol);

  const ws = new WebSocket(url);

  ws.onopen = () => {
    peLog(`[BINANCE WS] Connected — ${symbol}`);
    peSetWsDot('binance', 'green');
  };

  ws.onmessage = (evt) => {
    try {
      const wrapper = JSON.parse(evt.data);
      const { stream, data } = wrapper;
      if (!stream || !data) return;

      if (stream.endsWith('@aggTrade')) {
        // m = isBuyerMaker: true means buyer was market maker (passive) → aggressive SELL
        peUpdateCVD(symbol, parseFloat(data.q || 0), data.m === true);

      } else if (stream.includes('@depth')) {
        if (data.b && data.a) peUpdateOBI(symbol, data.b, data.a);

      } else if (stream.endsWith('@forceOrder')) {
        const o = data.o;
        if (o) {
          const usd = parseFloat(o.q || 0) * parseFloat(o.p || 0);
          if (usd > 50000) {
            // S='BUY' means a SHORT was liquidated (forced to buy back)
            peAddLiqEvent(symbol, { side: o.S === 'BUY' ? 'Buy' : 'Sell', usd, price: parseFloat(o.p) });
          }
        }
      }
    } catch (e) { /* silent — high-frequency stream */ }
  };

  ws.onerror = () => { peSetWsDot('binance', 'red'); peLog('[BINANCE WS] Error', 'log-err'); };
  ws.onclose = () => { peSetWsDot('binance', 'off'); peLog('[BINANCE WS] Disconnected', 'log-warn'); };

  PE.wsBinance = ws;
}

// ── BYBIT LINEAR WS ───────────────────────────────────────────────
function peConnectBybit(symbol) {
  if (PE.wsBybit) {
    try { clearInterval(PE.wsBybit._pingTimer); PE.wsBybit.onclose = null; PE.wsBybit.close(); } catch (e) { /* ignore */ }
    PE.wsBybit = null;
  }
  peInitBuffer(symbol);

  const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');

  ws.onopen = () => {
    peLog(`[BYBIT WS] Connected — ${symbol}`);
    peSetWsDot('bybit', 'green');
    ws.send(JSON.stringify({
      op: 'subscribe',
      args: [`publicTrade.${symbol}`, `orderbook.25.${symbol}`, `liquidation.${symbol}`],
    }));
  };

  ws.onmessage = (evt) => {
    try {
      const d = JSON.parse(evt.data);
      if (!d.topic || !d.data) return;

      if (d.topic.startsWith('publicTrade.')) {
        const trades = Array.isArray(d.data) ? d.data : [d.data];
        trades.forEach(t => {
          // Bybit: S='Buy' = aggressive buy (taker), 'Sell' = aggressive sell
          peUpdateCVD(symbol, parseFloat(t.v || 0), t.S === 'Sell');
        });

      } else if (d.topic.startsWith('orderbook.')) {
        const ob = d.data;
        if (ob && ob.b && ob.a) peUpdateOBI(symbol, ob.b, ob.a);

      } else if (d.topic.startsWith('liquidation.')) {
        const liq = d.data;
        if (liq) {
          const usd = parseFloat(liq.size || liq.qty || 0) * parseFloat(liq.price || 0);
          if (usd > 50000) {
            peAddLiqEvent(symbol, { side: liq.side === 'Buy' ? 'Buy' : 'Sell', usd, price: parseFloat(liq.price) });
          }
        }
      }
    } catch (e) { /* silent */ }
  };

  ws._pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: 'ping' }));
  }, 20000);

  ws.onerror = () => { peSetWsDot('bybit', 'red'); peLog('[BYBIT WS] Error', 'log-err'); };
  ws.onclose = () => {
    clearInterval(ws._pingTimer);
    peSetWsDot('bybit', 'off');
    peLog('[BYBIT WS] Disconnected', 'log-warn');
  };

  PE.wsBybit = ws;
}

function peSubscribe(symbol) {
  if (!symbol) return;
  PE.wsSubbed = symbol;
  if (PE.exchange === 'binance' || PE.exchange === 'both') peConnectBinance(symbol);
  if (PE.exchange === 'bybit'   || PE.exchange === 'both') peConnectBybit(symbol);
}

function peUnsubscribeAll() {
  if (PE.wsBinance) {
    try { PE.wsBinance.onclose = null; PE.wsBinance.close(); } catch (e) { /* ignore */ }
    PE.wsBinance = null;
  }
  if (PE.wsBybit) {
    try { clearInterval(PE.wsBybit._pingTimer); PE.wsBybit.onclose = null; PE.wsBybit.close(); } catch (e) { /* ignore */ }
    PE.wsBybit = null;
  }
  PE.wsSubbed = null;
  peSetWsDot('binance', 'off');
  peSetWsDot('bybit',   'off');
}

// ══════════════════════════════════════════════════════════════════
// UI HELPERS
// ══════════════════════════════════════════════════════════════════
function peEl(id) { return document.getElementById(id); }

function peLog(msg, cls = 'log-info') {
  const el = peEl('pe-log');
  if (!el) return;
  const line = document.createElement('div');
  line.className = `log-line ${cls}`;
  const t = new Date();
  line.textContent = `[${t.toLocaleTimeString('en-GB')}] ${msg}`;
  el.insertBefore(line, el.firstChild);
  if (el.children.length > 80) el.removeChild(el.lastChild);
}

function peSetWsDot(which, state) {
  const id = which === 'binance' ? 'pe-ws-dot-binance' : 'pe-ws-dot-bybit';
  const el = peEl(id);
  if (!el) return;
  el.className = `pe-ws-dot pe-ws-dot-${state}`;
  el.title     = `${which.toUpperCase()} WS — ${state.toUpperCase()}`;
}

function peFormatPrice(p) {
  if (!p || isNaN(p)) return '—';
  if (p >= 10000) return p.toFixed(0);
  if (p >= 100)   return p.toFixed(2);
  if (p >= 1)     return p.toFixed(4);
  return p.toFixed(6);
}

function peFormatK(n) {
  if (!n || isNaN(n)) return '0';
  const abs  = Math.abs(n);
  const sign = n < 0 ? '-' : '+';
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(2)}`;
}

function peScoreColor(score) {
  if (score >= 70) return '#aa55ff';
  if (score >= 50) return '#7744cc';
  if (score >= 30) return 'var(--cyan2)';
  return 'var(--text4)';
}

function peDirColor(dir) {
  if (dir === 'LONG')  return 'var(--green)';
  if (dir === 'SHORT') return 'var(--red)';
  return 'var(--text4)';
}

// ══════════════════════════════════════════════════════════════════
// UI RENDERERS
// ══════════════════════════════════════════════════════════════════

function peFamilyBar(score, color) {
  return `<div class="pe-fam-bar-track">
    <div class="pe-fam-bar-fill" style="width:${score}%;background:${color}"></div>
  </div>`;
}

function peRenderFamilyCard(family, idx) {
  const colors = ['var(--cyan2)', '#aa66ff', 'var(--yellow)', 'var(--green)', 'var(--red)'];
  const icons  = ['◈', '⬡', '◉', '◎', '◬'];
  const color  = colors[idx] || 'var(--text3)';
  const icon   = icons[idx]  || '·';
  const sc     = family.score;

  // Extra detail rows per family
  let extraHtml = '';
  if (idx === 0 && family.atrRatio !== undefined) {
    extraHtml = `<div class="pe-fc-extra">
      <span>ATR Ratio: <strong>${family.atrRatio}</strong></span>
      <span>${family.stateLabel || ''}</span>
      ${family.squeeze ? '<span class="pe-fc-tag" style="color:var(--yellow)">SQUEEZE</span>' : ''}
    </div>`;
  }
  if (idx === 1 && family.nearestPool) {
    const p = family.nearestPool;
    extraHtml = `<div class="pe-fc-extra">
      <span style="color:${p.side === 'BUYSTOPS' ? 'var(--green)' : 'var(--red)'}">
        ${p.side}</span>
      <span>@ ${peFormatPrice(p.price)}</span>
      <span>${(p.distance * 100).toFixed(2)}% away</span>
    </div>`;
  }
  if (idx === 2) {
    extraHtml = `<div class="pe-fc-extra">
      ${family.hasBos   ? '<span class="pe-fc-tag" style="color:var(--yellow)">BoS</span>'   : ''}
      ${family.hasChoch ? '<span class="pe-fc-tag" style="color:var(--purple,#aa55ff)">CHoCH</span>' : ''}
      ${family.fvgCount > 0 ? `<span>${family.fvgCount} FVGs</span>` : ''}
    </div>`;
  }
  if (idx === 3 && family.activeSession) {
    extraHtml = `<div class="pe-fc-extra">
      <span class="pe-fc-tag" style="color:var(--green)">LIVE</span>
      <span>${family.activeSession.name} · ${family.activeSession.minsRemaining}min left</span>
    </div>`;
  }
  if (idx === 4 && family.signals?.length) {
    extraHtml = `<div class="pe-fc-extra">
      ${family.signals.slice(0, 3).map(s => `<span class="pe-fc-tag">${s}</span>`).join('')}
    </div>`;
  }

  return `
    <div class="pe-family-card">
      <div class="pe-fc-header">
        <span class="pe-fc-icon" style="color:${color}">${icon}</span>
        <span class="pe-fc-label">${family.label}</span>
        <span class="pe-fc-score" style="color:${color}">${sc}</span>
      </div>
      ${peFamilyBar(sc, color)}
      <div class="pe-fc-detail">${family.detail || '—'}</div>
      ${extraHtml}
    </div>`;
}

function peRenderDetail(symbol) {
  const symEl = peEl('pe-symbol');
  if (symEl) symEl.textContent = symbol || '—';

  const pr = PE.results[symbol];

  if (!pr) {
    const bodyEl = peEl('pe-body');
    if (bodyEl) bodyEl.innerHTML = `
      <div class="pe-no-data">
        <div class="pe-no-data-icon">◬</div>
        <div class="pe-no-data-txt">No precursor data for ${symbol || '—'}</div>
        <div class="pe-no-data-sub">Run TradeRecon scan on this pair first, then return here.</div>
      </div>`;
    return;
  }

  // Restore body if needed
  const bodyEl = peEl('pe-body');
  if (bodyEl && bodyEl.querySelector('.pe-no-data')) {
    peRestoreBody(bodyEl);
  }

  // Score hero
  const heroEl = peEl('pe-score-hero');
  if (heroEl) {
    const col  = peScoreColor(pr.score);
    const dcol = peDirColor(pr.dirBias);
    heroEl.innerHTML = `
      <span class="pe-hero-score" style="color:${col}">${pr.score}</span>
      <span class="pe-hero-slash" style="color:var(--text4)">/100</span>
      <span class="pe-hero-sep">·</span>
      <span class="pe-hero-dir" style="color:${dcol};font-weight:700">${pr.dirBias}</span>
      <span class="pe-hero-sep">·</span>
      <span class="pe-hero-price" style="color:var(--text3)">${peFormatPrice(pr.price)}</span>`;
  }

  // Ignition pill
  const ignEl = peEl('pe-ignition');
  if (ignEl && pr.ignitionWindow) {
    ignEl.innerHTML = `IGNITION <span style="color:${pr.ignitionWindow.color};font-weight:700">${pr.ignitionWindow.label}</span>`;
  }

  // Invalidation
  const invEl = peEl('pe-invalidation');
  if (invEl && pr.dirBias !== 'NEUTRAL') {
    const col = pr.dirBias === 'LONG' ? 'var(--red)' : 'var(--green)';
    invEl.innerHTML = `INVALIDATION <span style="color:${col}">${peFormatPrice(pr.invalidation)}</span>`;
    invEl.style.display = '';
  } else if (invEl) {
    invEl.style.display = 'none';
  }

  // Family cards
  const gridEl = peEl('pe-family-grid');
  if (gridEl && pr.families) {
    const { f1, f2, f3, f4, f5 } = pr.families;
    gridEl.innerHTML = [f1, f2, f3, f4, f5].map((f, i) => peRenderFamilyCard(f, i)).join('');
  }

  // Scan age
  peUpdateScanAge(symbol);
  peLog(`[PE] ${symbol} — Score ${pr.score} · ${pr.dirBias} · Ignition ${pr.ignitionWindow?.label}`);
}

function peUpdateScanAge(symbol) {
  const ageEl = peEl('pe-scan-age');
  const pr    = PE.results[symbol];
  if (!ageEl || !pr?.scannedAt) return;
  const secs  = Math.floor((Date.now() - pr.scannedAt) / 1000);
  ageEl.textContent = secs < 60
    ? `Scanned ${secs}s ago`
    : `Scanned ${Math.floor(secs / 60)}m ago`;
}

function peRestoreBody(bodyEl) {
  bodyEl.innerHTML = `
    <div class="pe-hero-row">
      <div class="pe-hero-block" id="pe-score-hero">—</div>
      <div class="pe-meta-block">
        <div class="pe-ignition-pill" id="pe-ignition">IGNITION —</div>
        <div class="pe-invalidation"  id="pe-invalidation" style="display:none">—</div>
        <div class="pe-scan-age"      id="pe-scan-age">—</div>
      </div>
    </div>
    <div class="pe-family-grid" id="pe-family-grid"></div>`;
}

function peRenderLivePanel(symbol) {
  const metrics = peGetLiveMetrics(symbol);
  if (!metrics) return;

  const cvd1mEl  = peEl('pe-live-cvd1m');
  const cvd5mEl  = peEl('pe-live-cvd5m');
  const cvd15mEl = peEl('pe-live-cvd15m');
  const obiEl    = peEl('pe-live-obi');
  const liqEl    = peEl('pe-live-liqs');

  const cvdCol = (v) => v > 0 ? 'var(--green)' : v < 0 ? 'var(--red)' : 'var(--text4)';

  if (cvd1mEl)  cvd1mEl.innerHTML  = `1m <span style="color:${cvdCol(metrics.cvd1m)}">${peFormatK(metrics.cvd1m)}</span>`;
  if (cvd5mEl)  cvd5mEl.innerHTML  = `5m <span style="color:${cvdCol(metrics.cvd5m)}">${peFormatK(metrics.cvd5m)}</span>`;
  if (cvd15mEl) cvd15mEl.innerHTML = `15m <span style="color:${cvdCol(metrics.cvd15m)}">${peFormatK(metrics.cvd15m)}</span>`;

  if (obiEl) {
    const obi    = metrics.obi;
    const obiCol = obi > 0.15 ? 'var(--green)' : obi < -0.15 ? 'var(--red)' : 'var(--text4)';
    obiEl.innerHTML = `OBI <span style="color:${obiCol}">${obi >= 0 ? '+' : ''}${(obi * 100).toFixed(1)}%</span>`;
  }

  if (liqEl) {
    const net = metrics.liqBuyUSD - metrics.liqSellUSD;
    const col  = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--text4)';
    liqEl.innerHTML = `LIQ/1m <span style="color:var(--green)">B:${peFormatK(metrics.liqBuyUSD)}</span> <span style="color:var(--red)">S:${peFormatK(metrics.liqSellUSD)}</span>`;
  }
}

function peStartUIRefresh() {
  clearInterval(PE.uiTimer);
  PE.uiTimer = setInterval(() => {
    if (!PE.peActive || !PE.activeSymbol) return;
    peRenderLivePanel(PE.activeSymbol);
    peUpdateScanAge(PE.activeSymbol);
  }, 5000);
}

// ══════════════════════════════════════════════════════════════════
// PUBLIC FUNCTIONS (also used internally)
// ══════════════════════════════════════════════════════════════════

function openPredictive(symbol) {
  if (!symbol) return;
  PE.activeSymbol = symbol.toUpperCase().trim();
  if (typeof switchModule === 'function') switchModule('predictive');
  peRenderDetail(PE.activeSymbol);
  if (PE.peActive) peSubscribe(PE.activeSymbol);
}

function peSetExchange(mode) {
  PE.exchange = mode;
  document.querySelectorAll('.pe-exc-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.exc === mode);
  });
  if (PE.peActive && PE.activeSymbol) {
    peUnsubscribeAll();
    peSubscribe(PE.activeSymbol);
  }
  peLog(`[PE] Exchange mode: ${mode.toUpperCase()}`);
}

function peActivate() {
  PE.peActive = true;
  peStartUIRefresh();
  if (PE.activeSymbol) {
    peSubscribe(PE.activeSymbol);
    peRenderDetail(PE.activeSymbol);
  }
  peLog('[PE] Module active — WebSocket feeds starting');
}

function peDeactivate() {
  PE.peActive = false;
  clearInterval(PE.uiTimer);
  PE.uiTimer = null;
  peUnsubscribeAll();
  peLog('[PE] Module inactive — all WS closed');
}

// ══════════════════════════════════════════════════════════════════
// WINDOW EXPORTS
// ══════════════════════════════════════════════════════════════════

// Called by panel.js trScanPair() — receives already-fetched data
window.peScanPair = function peScanPair(symbol, klines, analyzed) {
  if (!klines || !analyzed || !symbol) return;
  const result = peScorePrecursor(symbol, klines, analyzed);
  if (result) PE.results[symbol] = result;
};

// Called by TradeRecon PE cell click
window.openPredictive  = openPredictive;

// Called by panel.js lifecycle hooks
window.peActivate      = peActivate;
window.peDeactivate    = peDeactivate;

// Called by exchange selector buttons
window.peSetExchange   = peSetExchange;

// Expose state for trRenderTable PE cell access
window.PE = PE;

console.log(`[PE] Predictive Engine ${PE.VERSION} initialised`);
