// ══════════════════════════════════════════════════════════════════
// VIVIENNE TRADINGPANEL v0.7 — APP ENTRY POINT
// File: app.js  |  Port: 3001 (control + static)
//
// Responsibilities:
//   1. Serve static frontend files (HTML/CSS/JS/engine.js)
//   2. Manage macro-server.js as a child process
//   3. Expose control API for frontend start/stop/status
//
// Control API:
//   GET  /server/status  — { running, pid, uptime, keyStatus }
//   POST /server/start   — spawn macro-server if not running
//   POST /server/stop    — kill macro-server process
//   GET  /server/logs    — last N lines from macro-server stdout/stderr
// ══════════════════════════════════════════════════════════════════

'use strict';

require('dotenv').config();

const express  = require('express');
const { spawn } = require('child_process');
const path     = require('path');

const app      = express();
const PORT     = process.env.APP_PORT || 3001;

app.use(express.json());

// ── CORS ────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── STATIC FILES — serve frontend from same directory ───────────────
app.use(express.static(path.join(__dirname)));

// ── MACRO SERVER PROCESS STATE ──────────────────────────────────────
let macroProc   = null;
let macroStartAt = null;
const LOG_BUFFER_MAX = 200;
const logBuffer = [];

function appendLog(line) {
  logBuffer.push({ ts: Date.now(), line });
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
}

function spawnMacroServer() {
  if (macroProc) return { ok: false, reason: 'Already running' };

  macroProc = spawn('node', ['macro-server.js'], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  macroStartAt = Date.now();
  appendLog(`[APP] macro-server spawned (pid ${macroProc.pid})`);
  console.log(`[APP] macro-server spawned — pid ${macroProc.pid}`);

  macroProc.stdout.on('data', d => {
    d.toString().split('\n').filter(Boolean).forEach(l => {
      appendLog(l);
      console.log(`[MACRO] ${l}`);
    });
  });

  macroProc.stderr.on('data', d => {
    d.toString().split('\n').filter(Boolean).forEach(l => {
      appendLog(`[ERR] ${l}`);
      console.error(`[MACRO ERR] ${l}`);
    });
  });

  macroProc.on('close', (code) => {
    appendLog(`[APP] macro-server exited (code ${code})`);
    console.log(`[APP] macro-server exited — code ${code}`);
    macroProc    = null;
    macroStartAt = null;
  });

  macroProc.on('error', (err) => {
    appendLog(`[APP] spawn error: ${err.message}`);
    console.error(`[APP] spawn error:`, err);
    macroProc    = null;
    macroStartAt = null;
  });

  return { ok: true, pid: macroProc.pid };
}

function killMacroServer() {
  if (!macroProc) return { ok: false, reason: 'Not running' };
  macroProc.kill('SIGTERM');
  appendLog('[APP] macro-server SIGTERM sent');
  return { ok: true };
}

// ── KEY STATUS CHECK ────────────────────────────────────────────────
function keyStatus() {
  return {
    FRED:   process.env.FRED_API_KEY   ? 'SET' : 'MISSING',
    METALS: process.env.METALS_API_KEY ? 'SET' : 'MISSING',
    EIA:    process.env.EIA_API_KEY    ? 'SET' : 'MISSING',
  };
}

// ══════════════════════════════════════════════════════════════════
// CONTROL API ROUTES
// ══════════════════════════════════════════════════════════════════

app.get('/server/status', (req, res) => {
  res.json({
    running:    macroProc !== null,
    pid:        macroProc ? macroProc.pid : null,
    uptimeMs:   macroStartAt ? Date.now() - macroStartAt : null,
    keyStatus:  keyStatus(),
    appUptime:  Math.floor(process.uptime()),
  });
});

app.post('/server/start', (req, res) => {
  const result = spawnMacroServer();
  res.json({ ...result, running: macroProc !== null, pid: macroProc ? macroProc.pid : null });
});

app.post('/server/stop', (req, res) => {
  const result = killMacroServer();
  res.json(result);
});

app.get('/server/logs', (req, res) => {
  const n = parseInt(req.query.n) || 50;
  res.json({ logs: logBuffer.slice(-n) });
});

// ── ROOT ────────────────────────────────────────────────────────────
app.get('/api', (req, res) => {
  res.json({
    name: 'Vivienne TradingPanel v0.7',
    control: 'http://localhost:3001',
    macro:   'http://localhost:3002',
    static:  'http://localhost:3001/index.html',
  });
});

// ══════════════════════════════════════════════════════════════════
// STARTUP
// ══════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('\n⬡ Vivienne TradingPanel v0.7 — App Server');
  console.log(`  Control + Static : http://localhost:${PORT}`);
  console.log(`  Frontend         : http://localhost:${PORT}/index.html`);
  console.log(`  API Keys         : FRED=${process.env.FRED_API_KEY ? 'SET' : 'MISSING'} | METALS=${process.env.METALS_API_KEY ? 'SET' : 'MISSING'} | EIA=${process.env.EIA_API_KEY ? 'SET' : 'MISSING'}`);
  console.log('\n  Macro server NOT auto-started — use the frontend START button.');
  console.log('\n  Standing by.\n');
});

// ── GRACEFUL SHUTDOWN ───────────────────────────────────────────────
process.on('SIGINT',  () => { if (macroProc) macroProc.kill(); process.exit(0); });
process.on('SIGTERM', () => { if (macroProc) macroProc.kill(); process.exit(0); });
