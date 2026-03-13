#!/usr/bin/env node
/**
 * MP Smoke Test Harness
 *
 * Automated multiplayer smoke test: spins up a real Colyseus server + 2 headless
 * Puppeteer browser clients, connects them to the same room, and verifies that:
 *   - Both players can join
 *   - Both players see each other
 *   - Enemies spawn
 *   - Game starts
 *   - Movement works
 *   - Connection stays stable for 10+ seconds
 *
 * Uses the REAL code paths: network-main.ts (client) + server/rooms/GameRoom.ts (server).
 * No mocking. No stubs. This is end-to-end automated MP testing.
 *
 * Usage:
 *   node tests/mp/mp-test-harness.mjs
 *
 *   # Run on a specific surface:
 *   node tests/mp/mp-test-harness.mjs --surface cube
 *
 *   # Run all surfaces (sphere, cube, pill, torus):
 *   node tests/mp/mp-test-harness.mjs --all-surfaces
 *
 * Outputs:
 *   - Console: pass/fail for each test scenario
 *   - reports/<date>-mp-smoke-test.html: full HTML report with screenshots
 *   - test-screenshots/mp/: PNG screenshots at key moments
 *
 * ---
 * LEVEL 6 ITEMS (cannot be automated — require human in real browser):
 *   - Hit detection "feel" (threshold tuning, does it feel right?)
 *   - Visual quality (bloom, lighting, surface texture)
 *   - Audio (music, sound effects)
 *   - Controller input on actual hardware
 *   - Mobile touch controls
 *   - Performance "feel" (smooth vs laggy)
 *   - LAN discovery (broadcast scanning for real LAN IPs)
 *   - Latency compensation feel at high latency
 * ---
 *
 * Prerequisites:
 *   - Node 20+ (nvm)
 *   - Chrome: ~/.cache/puppeteer/chrome/
 *   - No other processes on ports 3000 or 2567
 */

import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const DEV_SERVER_PORT = 3000;
const COLYSEUS_PORT = 2567;
const BASE_URL = `http://localhost:${DEV_SERVER_PORT}`;
const SERVER_URL = `ws://localhost:${COLYSEUS_PORT}`;

const NVM_PATH = process.env.NVM_BIN
  || dirname(process.execPath)
  || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

// Parse CLI args
const args = process.argv.slice(2);
const ALL_SURFACES = args.includes('--all-surfaces');
const SURFACE_ARG = (() => {
  const idx = args.indexOf('--surface');
  return idx >= 0 ? args[idx + 1] : null;
})();
const SURFACES_TO_TEST = ALL_SURFACES
  ? ['sphere', 'cube', 'pill', 'torus']
  : [SURFACE_ARG || 'sphere'];

// Dates + paths
const now = new Date();
const dateStr = now.toISOString().substring(0, 10); // YYYY-MM-DD
const timeStr = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/${dateStr}-mp-smoke-test.html`);
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/mp');

const TIMEOUTS = {
  serverBoot: 20000,
  devServerBoot: 30000,
  pageLoad: 30000,
  gameInit: 15000,
  connection: 20000,
  gameStart: 20000,
  enemySpawn: 25000,
  stability: 12000,
};

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=640,360',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

function killPortProcesses(ports) {
  for (const port of ports) {
    try {
      const result = execSync(`ss -tlnp 2>/dev/null | grep ':${port} '`, { encoding: 'utf-8' });
      if (result.trim()) {
        const pidMatches = result.matchAll(/pid=(\d+)/g);
        for (const match of pidMatches) {
          try { execSync(`kill ${match[1]} 2>/dev/null`); } catch { /* dead */ }
        }
        try { execSync('sleep 1'); } catch { /* ignore */ }
      }
    } catch { /* no process */ }
  }
}

function startColyseusServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PATH: `${NVM_PATH}:/usr/bin:/bin`,
      PORT: String(COLYSEUS_PORT),
      SHUTDOWN_TIMEOUT: '0',
    };
    const proc = spawn(`${NVM_PATH}/npx`, ['tsx', 'server/index.ts'], {
      cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;
    let output = '';
    const logs = [];

    const onData = (data) => {
      const text = data.toString();
      output += text;
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('╔') && !t.startsWith('║') && !t.startsWith('╠') && !t.startsWith('╚')) {
          logs.push(t);
        }
      }
      if (!started && (text.includes('MULTIPLAYER SERVER') || text.includes(`localhost:${COLYSEUS_PORT}`))) {
        started = true;
        proc.__logs = logs;
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => { if (!started) reject(new Error(`Colyseus failed: ${err.message}`)); });
    proc.on('exit', (code) => { if (!started) reject(new Error(`Colyseus exited ${code}. Output: ${output.slice(0, 400)}`)); });
    setTimeout(() => {
      if (!started) { proc.kill(); reject(new Error(`Colyseus timeout. Output: ${output.slice(0, 400)}`)); }
    }, TIMEOUTS.serverBoot);
  });
}

function startDevServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: `${NVM_PATH}:/usr/bin:/bin` };
    const proc = spawn(`${NVM_PATH}/npx`, ['vite', '--port', String(DEV_SERVER_PORT)], {
      cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;
    let output = '';
    const onData = (data) => {
      const text = data.toString();
      output += text;
      if (!started && (text.includes('Local:') || text.includes(`localhost:${DEV_SERVER_PORT}`) || text.includes('ready in'))) {
        started = true;
        setTimeout(() => resolve(proc), 2000);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => { if (!started) reject(new Error(`Dev server failed: ${err.message}`)); });
    proc.on('exit', (code) => { if (!started) reject(new Error(`Dev server exited ${code}. Output: ${output.slice(0, 400)}`)); });
    setTimeout(() => {
      if (!started) { proc.kill(); reject(new Error(`Dev server timeout. Output: ${output.slice(0, 400)}`)); }
    }, TIMEOUTS.devServerBoot);
  });
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch { /* not ready */ }
    await sleep(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  const errors = [];
  const logs = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') errors.push(text);
  });
  page.__errors = errors;
  page.__logs = logs;
  return page;
}

async function navigateToGame(page, surface) {
  const url = `${BASE_URL}?mode=network&surface=${surface}&server=${encodeURIComponent(SERVER_URL)}&debug=true&testMode=true`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageLoad });
  await sleep(TIMEOUTS.gameInit);
}

async function getDebug(page, method) {
  return page.evaluate((m) => {
    const debug = window.__gameDebug;
    if (!debug || typeof debug[m] !== 'function') return null;
    return debug[m]();
  }, method);
}

async function waitForDebug(page, method, timeoutMs = 15000, pollMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await getDebug(page, method);
    if (result) return result;
    await sleep(pollMs);
  }
  return null;
}

async function waitForCondition(fn, timeoutMs = 15000, pollMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(pollMs);
  }
  return false;
}

function getCriticalErrors(errors) {
  return errors.filter((e) =>
    !e.includes('AudioContext') &&
    !e.includes('user gesture') &&
    !e.includes('favicon') &&
    !e.includes('net::') &&
    !e.includes('404') &&
    !e.includes('Failed to load resource') &&
    !e.includes('SharedArrayBuffer') &&
    !e.includes('crossOriginIsolated') &&
    !e.includes('websocket') &&
    !e.includes('WebSocket')
  );
}

async function screenshot(page, name) {
  const path = resolve(SCREENSHOT_DIR, name);
  await page.screenshot({ path }).catch(() => {/* ignore if page closed */});
  return path;
}

// ---------------------------------------------------------------------------
// Smoke test scenarios
// ---------------------------------------------------------------------------

async function runSmokeTests(hostPage, joinPage, surface) {
  const results = [];

  const record = (name, status, note, detail = '') => {
    results.push({ name, status, note, detail });
    const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '?';
    console.log(`    [${status}] ${name}: ${note}`);
    return status === 'PASS';
  };

  // ---- Scenario 1: Connection ----
  console.log('\n  Scenario 1: Connection');

  const hostConnected = await waitForDebug(hostPage, 'isConnected', TIMEOUTS.connection);
  record('1a: Host connects to server', hostConnected ? 'PASS' : 'FAIL',
    hostConnected ? 'isConnected=true' : 'Timed out waiting for connection');

  const joinConnected = await waitForDebug(joinPage, 'isConnected', TIMEOUTS.connection);
  record('1b: Joiner connects to server', joinConnected ? 'PASS' : 'FAIL',
    joinConnected ? 'isConnected=true' : 'Timed out waiting for connection');

  if (!hostConnected || !joinConnected) {
    record('1c: Both clients see 2 players', 'SKIP', 'Skipped (connection failed)');
    record('2a: Host starts the game', 'SKIP', 'Skipped (connection failed)');
    record('2b: Movement changes position', 'SKIP', 'Skipped (connection failed)');
    record('3a: Enemies spawn', 'SKIP', 'Skipped (connection failed)');
    record('3b: Enemies visible on joiner', 'SKIP', 'Skipped (connection failed)');
    record('4: 10s stability', 'SKIP', 'Skipped (connection failed)');
    record('5: No critical errors', 'SKIP', 'Skipped (connection failed)');
    return results;
  }

  // Both see 2 players
  const hostSees2 = await waitForCondition(
    async () => (await getDebug(hostPage, 'getPlayerCount')) >= 2,
    TIMEOUTS.connection,
  );
  const joinSees2 = await waitForCondition(
    async () => (await getDebug(joinPage, 'getPlayerCount')) >= 2,
    TIMEOUTS.connection,
  );
  const hostCount = await getDebug(hostPage, 'getPlayerCount');
  const joinCount = await getDebug(joinPage, 'getPlayerCount');
  record('1c: Both clients see 2 players', hostSees2 && joinSees2 ? 'PASS' : 'FAIL',
    `Host sees ${hostCount} players, Joiner sees ${joinCount} players`);

  // ---- Scenario 2: Game start + movement ----
  console.log('\n  Scenario 2: Game start + movement');

  // Click START GAME
  let startClicked = false;
  for (let attempt = 0; attempt < 5 && !startClicked; attempt++) {
    startClicked = await hostPage.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const t = (btn.textContent || '').trim();
        if (t.includes('START GAME') || t.includes('PLAY AGAIN')) {
          if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
            btn.click();
            return true;
          }
        }
      }
      return false;
    });
    if (!startClicked) await sleep(2000);
  }

  const gameStarted = await waitForCondition(
    async () => {
      const text = await getDebug(hostPage, 'getWaveText');
      return text && !text.includes('Waiting') && !text.includes('Connecting');
    },
    TIMEOUTS.gameStart,
  );
  const waveText = await getDebug(hostPage, 'getWaveText');
  record('2a: Host starts the game', gameStarted ? 'PASS' : 'FAIL',
    gameStarted ? `Wave text: "${waveText}"` : `Timeout. Wave text: "${waveText}". Start clicked: ${startClicked}`);

  // Movement
  const posBefore = await getDebug(hostPage, 'getPlayerPosition');
  let moved = false;
  if (posBefore) {
    await hostPage.keyboard.down('d');
    for (let i = 0; i < 20 && !moved; i++) {
      await sleep(300);
      const pos = await getDebug(hostPage, 'getPlayerPosition');
      if (pos) {
        const diff = Math.abs(pos.u - posBefore.u) + Math.abs(pos.v - posBefore.v);
        if (diff > 0.001) moved = true;
      }
    }
    await hostPage.keyboard.up('d');
  }
  record('2b: Movement changes player position', moved ? 'PASS' : (posBefore ? 'FAIL' : 'SKIP'),
    moved ? 'UV position changed after pressing D' : (!posBefore ? 'getPlayerPosition returned null' : 'No position change detected'));

  // ---- Scenario 3: Enemy spawn ----
  console.log('\n  Scenario 3: Enemy spawn');

  // Restart if game over
  const waveNow = await getDebug(hostPage, 'getWaveText');
  if (waveNow && (waveNow.includes('GAME OVER') || waveNow.includes('Waiting'))) {
    await hostPage.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const t = btn.textContent || '';
        if ((t.includes('PLAY AGAIN') || t.includes('START GAME')) &&
            (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none')) {
          btn.click();
        }
      }
    });
    await sleep(3000);
  }

  const hasEnemies = await waitForCondition(
    async () => {
      const count = await getDebug(hostPage, 'getEnemyCount');
      return count > 0;
    },
    TIMEOUTS.enemySpawn,
    1000,
  );
  const enemyCount = await getDebug(hostPage, 'getEnemyCount');
  record('3a: Enemies spawn on host', hasEnemies ? 'PASS' : 'FAIL',
    `getEnemyCount = ${enemyCount}`);

  const joinEnemyCount = await getDebug(joinPage, 'getEnemyCount');
  const joinHasEnemies = joinEnemyCount > 0;
  record('3b: Enemies visible on joiner', joinHasEnemies ? 'PASS' : 'FAIL',
    `getEnemyCount = ${joinEnemyCount}`);

  // Surface type matches
  const hostSurface = await getDebug(hostPage, 'getSurfaceType');
  const joinSurface = await getDebug(joinPage, 'getSurfaceType');
  record('3c: Both clients use same surface', hostSurface === surface && joinSurface === surface ? 'PASS' : 'FAIL',
    `Host: ${hostSurface}, Joiner: ${joinSurface}, Expected: ${surface}`);

  // ---- Scenario 4: Stability ----
  console.log('\n  Scenario 4: Stability');

  const stabilityStart = Date.now();
  for (let i = 0; i < 12; i++) {
    const key = ['w', 'a', 's', 'd'][i % 4];
    await hostPage.keyboard.down(key);
    const x = 320 + Math.cos(i * 0.5) * 150;
    const y = 180 + Math.sin(i * 0.5) * 100;
    await hostPage.mouse.click(x, y);
    const key2 = ['w', 'a', 's', 'd'][(i + 2) % 4];
    await joinPage.keyboard.down(key2);
    await sleep(600);
    await hostPage.keyboard.up(key);
    await joinPage.keyboard.up(key2);
    await sleep(200);
  }

  const stabilityDuration = Date.now() - stabilityStart;
  const hostStillConnected = await getDebug(hostPage, 'isConnected');
  const joinStillConnected = await getDebug(joinPage, 'isConnected');
  record('4: 10s stability without disconnection',
    stabilityDuration >= 10000 && hostStillConnected && joinStillConnected ? 'PASS' : 'FAIL',
    `${Math.round(stabilityDuration / 1000)}s gameplay. Host connected: ${hostStillConnected}, Joiner connected: ${joinStillConnected}`);

  // ---- Scenario 5: No critical errors ----
  console.log('\n  Scenario 5: Error check');

  const hostCritical = getCriticalErrors(hostPage.__errors);
  const joinCritical = getCriticalErrors(joinPage.__errors);
  record('5: No critical JS errors',
    hostCritical.length === 0 && joinCritical.length === 0 ? 'PASS' : 'FAIL',
    `Host: ${hostCritical.length} errors, Joiner: ${joinCritical.length} errors`,
    [...hostCritical.slice(0, 3), ...joinCritical.slice(0, 3)].join('\n'));

  return results;
}

// ---------------------------------------------------------------------------
// HTML report generation
// ---------------------------------------------------------------------------

function generateHtmlReport(surfaceRuns, screenshotPaths, durationMs) {
  const totalTests = surfaceRuns.reduce((sum, r) => sum + r.results.length, 0);
  const totalPass = surfaceRuns.reduce((sum, r) => sum + r.results.filter(t => t.status === 'PASS').length, 0);
  const totalFail = surfaceRuns.reduce((sum, r) => sum + r.results.filter(t => t.status === 'FAIL').length, 0);
  const totalSkip = surfaceRuns.reduce((sum, r) => sum + r.results.filter(t => t.status === 'SKIP').length, 0);
  const overallPass = totalFail === 0;

  const statusColor = (s) => s === 'PASS' ? '#22c55e' : s === 'FAIL' ? '#ef4444' : '#94a3b8';

  const surfaceRows = surfaceRuns.map(({ surface, results, screenshots }) => {
    const surfacePass = results.filter(t => t.status === 'PASS').length;
    const surfaceFail = results.filter(t => t.status === 'FAIL').length;
    const surfaceSkip = results.filter(t => t.status === 'SKIP').length;
    const surfaceOk = surfaceFail === 0;

    const testRows = results.map((t) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;font-family:monospace;font-size:13px;">${t.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;font-weight:bold;color:${statusColor(t.status)}">${t.status}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:12px;">${t.note}</td>
      </tr>`).join('');

    const screenshotHtml = screenshots.map((s) => {
      // Make path relative to reports/
      const relPath = s.replace(PROJECT_ROOT + '/', '../');
      const name = s.split('/').pop();
      return `<div style="display:inline-block;margin:4px;text-align:center;vertical-align:top">
        <div style="color:#64748b;font-size:11px;margin-bottom:2px">${name.replace('.png', '')}</div>
        <img src="${relPath}" alt="${name}" style="width:200px;height:auto;border:1px solid #1e293b;display:block" onerror="this.style.display='none'">
      </div>`;
    }).join('');

    return `
    <div style="margin-bottom:32px;background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden">
      <div style="background:${surfaceOk ? '#14532d' : '#7f1d1d'};padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
        <h2 style="margin:0;color:#f1f5f9;font-size:16px;text-transform:uppercase;letter-spacing:1px">
          ${surfaceOk ? '✓' : '✗'} Surface: <strong>${surface}</strong>
        </h2>
        <span style="color:#cbd5e1;font-size:13px">${surfacePass} pass, ${surfaceFail} fail, ${surfaceSkip} skip</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#1e293b">
            <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:500">Test</th>
            <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:500;width:80px">Status</th>
            <th style="padding:8px 12px;text-align:left;color:#94a3b8;font-size:12px;font-weight:500">Notes</th>
          </tr>
        </thead>
        <tbody>${testRows}</tbody>
      </table>
      ${screenshotHtml ? `<div style="padding:16px;border-top:1px solid #1e293b"><h3 style="color:#64748b;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px">Screenshots</h3>${screenshotHtml}</div>` : ''}
    </div>`;
  }).join('');

  const level6Items = `
    <ul style="margin:8px 0;padding-left:20px;color:#94a3b8;font-size:13px;line-height:1.8">
      <li>Hit detection <em>feel</em> (threshold tuning — "does it feel right?")</li>
      <li>Visual quality (bloom, lighting, surface texture sharpness)</li>
      <li>Audio (music, sound effects, volume balance)</li>
      <li>Controller / gamepad input on real hardware</li>
      <li>Mobile touch controls</li>
      <li>Performance feel (smooth vs laggy at target hardware)</li>
      <li>LAN discovery (mDNS/broadcast scanning for real LAN IPs)</li>
      <li>Latency compensation feel at high network latency</li>
      <li>Enemy bullet direction on surfaces (requires human judgment)</li>
    </ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MP Smoke Test — ${dateStr}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #020617; color: #f1f5f9; margin: 0; padding: 24px; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
    .summary { display: flex; gap: 16px; margin-bottom: 32px; flex-wrap: wrap; }
    .stat { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 16px 24px; text-align: center; min-width: 100px; }
    .stat .num { font-size: 28px; font-weight: bold; }
    .stat .lbl { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: bold; }
    .level6 { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin-bottom: 32px; }
    .level6 h3 { margin: 0 0 8px; color: #fbbf24; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
  </style>
</head>
<body>
  <h1>MP Smoke Test Report</h1>
  <div class="meta">
    Generated: ${now.toISOString()} &nbsp;|&nbsp;
    Duration: ${(durationMs / 1000).toFixed(1)}s &nbsp;|&nbsp;
    Surfaces: ${SURFACES_TO_TEST.join(', ')} &nbsp;|&nbsp;
    Renderer: WebGL2 via SwiftShader (headless)
  </div>

  <div class="summary">
    <div class="stat"><div class="num" style="color:${overallPass ? '#22c55e' : '#ef4444'}">${overallPass ? 'PASS' : 'FAIL'}</div><div class="lbl">Overall</div></div>
    <div class="stat"><div class="num" style="color:#22c55e">${totalPass}</div><div class="lbl">Passed</div></div>
    <div class="stat"><div class="num" style="color:#ef4444">${totalFail}</div><div class="lbl">Failed</div></div>
    <div class="stat"><div class="num" style="color:#94a3b8">${totalSkip}</div><div class="lbl">Skipped</div></div>
    <div class="stat"><div class="num">${totalTests}</div><div class="lbl">Total</div></div>
  </div>

  <div class="level6">
    <h3>⚠ Level 6 items (requires human testing)</h3>
    ${level6Items}
  </div>

  ${surfaceRows}

  <div style="margin-top:32px;padding:16px;background:#0f172a;border:1px solid #1e293b;border-radius:8px">
    <h3 style="margin:0 0 8px;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:1px">Code Path Verified</h3>
    <p style="margin:0;color:#94a3b8;font-size:13px">
      Tests exercise the REAL code paths:<br>
      <code style="color:#38bdf8">src/network-main.ts</code> (client) →
      <code style="color:#38bdf8">server/rooms/GameRoom.ts</code> (server)<br>
      No mocking. Two real WebSocket clients connected to a live Colyseus server.
    </p>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runSurfaceSmokeTest(hostPage, joinPage, surface, runIdx) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  SURFACE: ${surface.toUpperCase()}`);
  console.log('─'.repeat(60));

  const screenshots = [];

  // Navigate both pages
  console.log(`\n  Navigating Host page (${surface})...`);
  await navigateToGame(hostPage, surface);
  const ss1 = await screenshot(hostPage, `${surface}-01-host-loaded.png`);
  screenshots.push(ss1);

  console.log(`  Waiting 5s for host connection to stabilize...`);
  await sleep(5000);

  console.log(`  Navigating Join page (${surface})...`);
  await navigateToGame(joinPage, surface);
  const ss2 = await screenshot(joinPage, `${surface}-02-join-loaded.png`);
  screenshots.push(ss2);

  await sleep(3000);

  const ss3 = await screenshot(hostPage, `${surface}-03-host-post-connect.png`);
  const ss4 = await screenshot(joinPage, `${surface}-03-join-post-connect.png`);
  screenshots.push(ss3, ss4);

  // Run tests
  const results = await runSmokeTests(hostPage, joinPage, surface);

  // Take final screenshots
  const ss5 = await screenshot(hostPage, `${surface}-04-host-final.png`);
  const ss6 = await screenshot(joinPage, `${surface}-04-join-final.png`);
  screenshots.push(ss5, ss6);

  const pass = results.filter(r => r.status === 'PASS').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  console.log(`\n  ${surface}: ${pass} passed, ${fail} failed`);

  return { surface, results, screenshots };
}

async function main() {
  const startTime = Date.now();

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });

  console.log('='.repeat(60));
  console.log('  GEOMETRY WARS — MP SMOKE TEST HARNESS');
  console.log(`  Surfaces: ${SURFACES_TO_TEST.join(', ')}`);
  console.log(`  Report: ${REPORT_PATH}`);
  console.log('='.repeat(60));

  if (!existsSync(CHROME_PATH)) {
    console.error(`\n  ERROR: Chrome not found at ${CHROME_PATH}`);
    process.exit(1);
  }
  console.log(`\n  Chrome: ${CHROME_PATH}`);

  // Kill stale processes
  console.log('\n  Killing stale processes on ports 3000, 2567...');
  killPortProcesses([3000, 2567]);
  await sleep(1000);

  let colyseusProc = null;
  let devProc = null;
  let browser = null;
  const surfaceRuns = [];

  try {
    // Start Colyseus server
    console.log(`\n  Starting Colyseus server (port ${COLYSEUS_PORT})...`);
    colyseusProc = await startColyseusServer();
    console.log('  Colyseus: started');

    const serverReady = await waitForServer(`http://localhost:${COLYSEUS_PORT}/health`, 10000);
    if (!serverReady) throw new Error('Colyseus health check failed');
    console.log('  Colyseus: health OK');

    // Start Vite dev server (if not already running)
    const devRunning = await waitForServer(BASE_URL, 3000);
    if (devRunning) {
      console.log(`  Vite: already running on port ${DEV_SERVER_PORT}`);
    } else {
      console.log(`  Starting Vite dev server (port ${DEV_SERVER_PORT})...`);
      devProc = await startDevServer();
      console.log('  Vite: started');
      await waitForServer(BASE_URL, 10000);
    }
    console.log(`  Vite: ${BASE_URL} OK`);

    // Launch browser with 2 pages
    console.log('\n  Launching browser (2 pages)...');
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: LAUNCH_ARGS,
    });

    for (const surface of SURFACES_TO_TEST) {
      const hostPage = await createPage(browser);
      const joinPage = await createPage(browser);

      const run = await runSurfaceSmokeTest(hostPage, joinPage, surface, surfaceRuns.length);
      surfaceRuns.push(run);

      await hostPage.close().catch(() => {});
      await joinPage.close().catch(() => {});
    }

    await browser.close();
    browser = null;

  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    console.log('\n  Cleaning up servers...');
    if (colyseusProc) {
      colyseusProc.kill('SIGTERM');
      console.log('  Colyseus stopped.');
    }
    if (devProc) {
      devProc.kill('SIGTERM');
      console.log('  Vite stopped.');
    }
    await sleep(1000);
    killPortProcesses([COLYSEUS_PORT]);

    // Verify cleanup
    try {
      const remaining = execSync('ss -tlnp 2>/dev/null | grep -E ":(3000|2567)\\b"', { encoding: 'utf-8' });
      if (remaining.trim()) {
        console.log(`  WARNING: Ports still occupied:\n${remaining}`);
      } else {
        console.log('  Port cleanup verified: no game processes running.');
      }
    } catch {
      console.log('  Port cleanup verified: no game processes running.');
    }
  }

  const durationMs = Date.now() - startTime;

  // Summary
  const totalTests = surfaceRuns.reduce((sum, r) => sum + r.results.length, 0);
  const totalPass = surfaceRuns.reduce((sum, r) => sum + r.results.filter(t => t.status === 'PASS').length, 0);
  const totalFail = surfaceRuns.reduce((sum, r) => sum + r.results.filter(t => t.status === 'FAIL').length, 0);
  const totalSkip = surfaceRuns.reduce((sum, r) => sum + r.results.filter(t => t.status === 'SKIP').length, 0);

  console.log('\n' + '='.repeat(60));
  console.log(`  RESULTS: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`);
  console.log('='.repeat(60));

  if (totalFail > 0) {
    console.log('\n  Failed tests:');
    for (const run of surfaceRuns) {
      for (const t of run.results.filter(r => r.status === 'FAIL')) {
        console.log(`    [${run.surface}] ${t.name}: ${t.note}`);
      }
    }
  }

  // Generate HTML report
  const html = generateHtmlReport(surfaceRuns, [], durationMs);
  writeFileSync(REPORT_PATH, html);
  console.log(`\n  HTML Report: ${REPORT_PATH}`);
  console.log(`  Screenshots: ${SCREENSHOT_DIR}/`);

  return totalFail === 0;
}

main().then((ok) => {
  process.exit(ok ? 0 : 1);
}).catch((err) => {
  console.error('\nFatal error:', err.message);
  killPortProcesses([2567]);
  process.exit(1);
});
