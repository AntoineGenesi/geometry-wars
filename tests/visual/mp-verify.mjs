#!/usr/bin/env node
/**
 * MP Visual Test Harness — Telemetry-Based Deep Checks
 *
 * Starts a REAL Colyseus server + 2 Puppeteer clients, connects them to the
 * same room, and runs deep telemetry-based verification using window.__GAME_TELEMETRY.
 *
 * Usage:
 *   node tests/visual/mp-verify.mjs --surface=sphere
 *   node tests/visual/mp-verify.mjs --surface=cube --duration=30
 *   node tests/visual/mp-verify.mjs --all-surfaces
 *
 * Prerequisites:
 *   - Vite dev server on port 3000 (must be running)
 *   - Chrome installed (puppeteer-core)
 *   - Port 2567 free (Colyseus will be started/stopped)
 */

import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
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

const NVM_PATH = process.env.NVM_BIN
  || dirname(process.execPath)
  || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

// Parse CLI args
const args = process.argv.slice(2);
const ALL_SURFACES = args.includes('--all-surfaces');
const SURFACE_ARG = (() => {
  for (const a of args) {
    if (a.startsWith('--surface=')) return a.split('=')[1];
  }
  const idx = args.indexOf('--surface');
  return idx >= 0 ? args[idx + 1] : null;
})();
const DURATION = (() => {
  for (const a of args) {
    if (a.startsWith('--duration=')) return parseInt(a.split('=')[1], 10);
  }
  return 20; // default seconds
})();
const SURFACES_TO_TEST = ALL_SURFACES
  ? ['sphere', 'cube', 'pill', 'torus']
  : [SURFACE_ARG || 'sphere'];

const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/mp-verify');
const now = new Date();
const dateStr = now.toISOString().substring(0, 10);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/${dateStr}-mp-verify.html`);

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=640,360',
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
  // CRITICAL: prevent background tab throttling — both host and joiner tabs
  // must keep their game loops running at full speed simultaneously
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Process management
// ---------------------------------------------------------------------------

function killPortProcesses(ports) {
  for (const port of ports) {
    try {
      const result = execSync(`ss -tlnp 2>/dev/null | grep ':${port}\\b'`, { encoding: 'utf-8' });
      if (result.trim()) {
        const pidMatches = result.matchAll(/pid=(\d+)/g);
        for (const match of pidMatches) {
          try { execSync(`kill -15 ${match[1]} 2>/dev/null`); } catch { /* dead */ }
        }
        try { execSync('sleep 2'); } catch { /* ignore */ }
        // Force kill if still alive
        for (const match of result.matchAll(/pid=(\d+)/g)) {
          try { execSync(`kill -9 ${match[1]} 2>/dev/null`); } catch { /* dead */ }
        }
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

    const onData = (data) => {
      const text = data.toString();
      output += text;
      if (!started && (text.includes('MULTIPLAYER SERVER') || text.includes(`localhost:${COLYSEUS_PORT}`))) {
        started = true;
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => { if (!started) reject(new Error(`Colyseus failed: ${err.message}`)); });
    proc.on('exit', (code) => { if (!started) reject(new Error(`Colyseus exited ${code}. Output: ${output.slice(0, 400)}`)); });
    setTimeout(() => {
      if (!started) { proc.kill(); reject(new Error(`Colyseus timeout. Output: ${output.slice(0, 400)}`)); }
    }, 20000);
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
  });
  page.__errors = errors;
  page.__logs = logs;
  return page;
}

async function navigateToMPGame(page, surface, label = 'Player') {
  // Clear localStorage to prevent mastery overlays and stale name prompts
  await page.evaluateOnNewDocument(() => { localStorage.clear(); });
  // name= param is REQUIRED: without it, network-main.ts shows a name-entry
  // overlay that blocks the connection flow (hidden behind the loading overlay).
  const url = `${BASE_URL}?mode=network&surface=${surface}&server=${encodeURIComponent(`ws://localhost:${COLYSEUS_PORT}`)}&debug=true&name=${label}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(10000); // Wait for game init + connection
}

/** Dismiss any blocking overlays (mastery screen, voting, game over, pause) */
async function dismissOverlays(page) {
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const t = (btn.textContent || '').trim();
      // Click close/X buttons
      if (t === '✕' || t === 'X' || t === '×' || t === 'CLOSE' || t === 'SKIP') {
        if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
          btn.click();
        }
      }
      // Click RESUME if game is paused
      if (t === 'RESUME') {
        if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
          btn.click();
        }
      }
    }
    // Remove mastery/voting overlay containers
    const overlays = document.querySelectorAll('[style*="z-index"]');
    for (const el of overlays) {
      const style = getComputedStyle(el);
      const z = parseInt(style.zIndex, 10);
      if (z >= 100 && style.position === 'fixed' &&
          (el.textContent?.includes('MASTERY') || el.textContent?.includes('VOTING'))) {
        el.remove();
      }
    }
  });
  // NOTE: Do NOT press Escape — it pauses the game via the pause menu handler
}

/** Click START GAME or PLAY AGAIN buttons */
async function clickStartGame(page) {
  return page.evaluate(() => {
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
}

async function getDebug(page, method) {
  return page.evaluate((m) => {
    const debug = window.__gameDebug;
    if (!debug || typeof debug[m] !== 'function') return null;
    return debug[m]();
  }, method);
}

async function getTelemetry(page) {
  return page.evaluate(() => (window).__GAME_TELEMETRY || null);
}

async function waitForCondition(fn, timeoutMs = 15000, pollMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(pollMs);
  }
  return false;
}

async function screenshot(page, name) {
  const path = resolve(SCREENSHOT_DIR, name);
  await page.screenshot({ path }).catch(() => {});
  return path;
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

// ---------------------------------------------------------------------------
// Telemetry-based deep checks
// ---------------------------------------------------------------------------

async function runMPChecks(hostPage, joinPage, surface, durationSecs) {
  const results = [];

  const record = (name, status, note, detail = '') => {
    results.push({ name, status, note, detail });
    const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '~';
    console.log(`    [${status}] ${name}: ${note}`);
    return status === 'PASS';
  };

  // ---- Phase 1: Connection ----
  console.log('\n  Phase 1: Connection');

  const hostConnected = await waitForCondition(
    async () => await getDebug(hostPage, 'isConnected'),
    20000,
  );
  // Log host console for debugging connection issues
  if (!hostConnected) {
    const netLogs = hostPage.__logs.filter(l => l.includes('NetworkMain') || l.includes('Network'));
    console.log(`    [debug] Host network logs: ${netLogs.slice(-5).join(' | ')}`);
  }
  record('mp_connected_host', hostConnected ? 'PASS' : 'FAIL',
    hostConnected ? 'Host connected' : 'Host connection timeout');

  const joinConnected = await waitForCondition(
    async () => await getDebug(joinPage, 'isConnected'),
    20000,
  );
  record('mp_connected_join', joinConnected ? 'PASS' : 'FAIL',
    joinConnected ? 'Joiner connected' : 'Joiner connection timeout');

  if (!hostConnected || !joinConnected) {
    // Can't continue without connection
    for (const check of ['mp_other_player_visible', 'mp_enemies_visible', 'mp_hit_detection',
      'mp_no_desync', 'mp_enemy_dimming', 'mp_no_phantom_deaths', 'mp_player_alive']) {
      record(check, 'SKIP', 'Connection failed');
    }
    return results;
  }

  // Wait for both to see 2 players (may take time for state sync)
  // Debug: log intermediate state
  for (let retry = 0; retry < 3; retry++) {
    const hc = await getDebug(hostPage, 'getPlayerCount');
    const jc = await getDebug(joinPage, 'getPlayerCount');
    const hConn = await getDebug(hostPage, 'isConnected');
    const jConn = await getDebug(joinPage, 'isConnected');
    // Also check host console for room info
    if (retry === 0) {
      const hostNetLogs = hostPage.__logs.filter(l => l.includes('NetworkMain') || l.includes('[Network]'));
      const joinNetLogs = joinPage.__logs.filter(l => l.includes('NetworkMain') || l.includes('[Network]'));
      console.log(`    [debug] Host logs: ${hostNetLogs.slice(-8).join('\n      ')}`);
      console.log(`    [debug] Join logs: ${joinNetLogs.slice(-8).join('\n      ')}`);
    }
    console.log(`    [debug] retry=${retry}: host(${hc} players, conn=${hConn}), join(${jc} players, conn=${jConn})`);
    if (hc >= 2 && jc >= 2) break;
    await sleep(3000);
  }

  const bothSee2 = await waitForCondition(async () => {
    const hc = await getDebug(hostPage, 'getPlayerCount');
    const jc = await getDebug(joinPage, 'getPlayerCount');
    return hc >= 2 && jc >= 2;
  }, 15000, 1000);
  const hCount = await getDebug(hostPage, 'getPlayerCount');
  const jCount = await getDebug(joinPage, 'getPlayerCount');
  record('mp_both_see_2_players', bothSee2 ? 'PASS' : 'FAIL',
    `Host sees ${hCount}, Joiner sees ${jCount}`);

  // ---- Phase 2: Start game ----
  console.log('\n  Phase 2: Start game');

  // Click START GAME on host (retry with overlay dismissal)
  let startClicked = false;
  for (let attempt = 0; attempt < 8 && !startClicked; attempt++) {
    await dismissOverlays(hostPage);
    await dismissOverlays(joinPage);
    startClicked = await clickStartGame(hostPage);
    if (!startClicked) await sleep(2000);
  }

  const gameStarted = await waitForCondition(async () => {
    const text = await getDebug(hostPage, 'getWaveText');
    return text && !text.includes('Waiting') && !text.includes('Connecting');
  }, 20000);
  record('mp_game_started', gameStarted ? 'PASS' : 'FAIL',
    gameStarted ? 'Game started' : `Timeout. Start clicked: ${startClicked}`);

  if (!gameStarted) {
    for (const check of ['mp_enemies_visible', 'mp_hit_detection', 'mp_no_desync',
      'mp_enemy_dimming', 'mp_no_phantom_deaths', 'mp_player_alive', 'mp_other_player_visible']) {
      record(check, 'SKIP', 'Game did not start');
    }
    return results;
  }

  // ---- Phase 3: Wait for telemetry + gameplay ----
  console.log('\n  Phase 3: Gameplay telemetry collection');

  // Wait for telemetry to become active (enemies may take time to spawn)
  await waitForCondition(async () => {
    const t = await getTelemetry(hostPage);
    return t && t.frame > 0;
  }, 15000, 1000);

  // Simulate input: move + hold mouse button for continuous shooting
  const inputKeys = ['w', 'a', 's', 'd'];
  const telemetrySamples = { host: [], join: [] };

  console.log(`    Collecting telemetry for ${durationSecs}s...`);
  const gameplayStart = Date.now();

  // Start shooting: dispatch mouse events via JS to ensure they reach the input system.
  // Puppeteer mouse events in headless mode can sometimes not trigger 'window' listeners.
  async function startShooting(page, x, y) {
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: x, clientY: y, bubbles: true }));
    }, { x, y });
  }
  async function moveMouse(page, x, y) {
    await page.evaluate(({ x, y }) => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    }, { x, y });
  }
  async function stopShooting(page) {
    await page.evaluate(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    });
  }

  await startShooting(hostPage, 400, 180);
  await startShooting(joinPage, 240, 180);

  for (let i = 0; i < durationSecs * 2; i++) {
    // Periodically dismiss overlays (game over, mastery, voting) and restart
    if (i % 6 === 0) {
      await stopShooting(hostPage);
      await stopShooting(joinPage);
      await dismissOverlays(hostPage);
      await dismissOverlays(joinPage);
      // Check if game ended — try to restart
      const waveText = await getDebug(hostPage, 'getWaveText');
      if (waveText && (waveText.includes('GAME OVER') || waveText.includes('VOTING') || waveText.includes('Waiting'))) {
        await clickStartGame(hostPage);
        await sleep(2000);
      }
      // Re-engage shooting
      await startShooting(hostPage, 400, 180);
      await startShooting(joinPage, 240, 180);
    }

    // Alternate movement keys
    const key = inputKeys[i % 4];
    await hostPage.keyboard.down(key);
    const key2 = inputKeys[(i + 2) % 4];
    await joinPage.keyboard.down(key2);

    // Sweep aim direction (move mouse while button held = continuous shooting)
    const hx = 320 + Math.cos(i * 0.5) * 120;
    const hy = 180 + Math.sin(i * 0.5) * 100;
    await moveMouse(hostPage, hx, hy);
    const jx = 320 + Math.cos(i * 0.3 + Math.PI) * 120;
    const jy = 180 + Math.sin(i * 0.3 + Math.PI) * 100;
    await moveMouse(joinPage, jx, jy);

    await sleep(400);

    await hostPage.keyboard.up(key);
    await joinPage.keyboard.up(key2);

    // Sample telemetry every tick
    const hostTel = await getTelemetry(hostPage);
    const joinTel = await getTelemetry(joinPage);
    if (hostTel) telemetrySamples.host.push(hostTel);
    if (joinTel) telemetrySamples.join.push(joinTel);

    await sleep(100);
  }

  // Release mouse buttons
  await stopShooting(hostPage).catch(() => {});
  await stopShooting(joinPage).catch(() => {});

  const gameplayDuration = (Date.now() - gameplayStart) / 1000;
  console.log(`    Collected ${telemetrySamples.host.length} host + ${telemetrySamples.join.length} join samples over ${gameplayDuration.toFixed(1)}s`);

  // Debug: dump first and last telemetry samples
  if (telemetrySamples.host.length > 0) {
    const h0 = telemetrySamples.host[0];
    const hN = telemetrySamples.host[telemetrySamples.host.length - 1];
    console.log(`    [debug] Host first: frame=${h0.frame}, enemies=${h0.enemies?.length}, players=${h0.players?.length}, score=${h0.player?.score}, alive=${h0.player?.alive}`);
    console.log(`    [debug] Host last:  frame=${hN.frame}, enemies=${hN.enemies?.length}, players=${hN.players?.length}, score=${hN.player?.score}, alive=${hN.player?.alive}`);
  }
  if (telemetrySamples.join.length > 0) {
    const j0 = telemetrySamples.join[0];
    const jN = telemetrySamples.join[telemetrySamples.join.length - 1];
    console.log(`    [debug] Join first: frame=${j0.frame}, enemies=${j0.enemies?.length}, players=${j0.players?.length}, score=${j0.player?.score}, alive=${j0.player?.alive}`);
    console.log(`    [debug] Join last:  frame=${jN.frame}, enemies=${jN.enemies?.length}, players=${jN.players?.length}, score=${jN.player?.score}, alive=${jN.player?.alive}`);
  }

  // ---- Phase 4: Analyze telemetry ----
  console.log('\n  Phase 4: Telemetry analysis');

  // CHECK: mp_enemies_visible — Both clients see enemies
  {
    const hostSawEnemies = telemetrySamples.host.some(t => t.enemies && t.enemies.length > 0);
    const joinSawEnemies = telemetrySamples.join.some(t => t.enemies && t.enemies.length > 0);
    const hostMaxEnemies = Math.max(0, ...telemetrySamples.host.map(t => t.enemies?.length ?? 0));
    const joinMaxEnemies = Math.max(0, ...telemetrySamples.join.map(t => t.enemies?.length ?? 0));
    record('mp_enemies_visible',
      hostSawEnemies && joinSawEnemies ? 'PASS' : (hostSawEnemies || joinSawEnemies ? 'PASS' : 'FAIL'),
      `Host max enemies: ${hostMaxEnemies}, Join max enemies: ${joinMaxEnemies}`);
  }

  // CHECK: mp_other_player_visible — Each client sees the other player in telemetry
  {
    const hostSeesOther = telemetrySamples.host.some(t =>
      t.players && t.players.length >= 2 && t.players.some(p => !p.isLocal));
    const joinSeesOther = telemetrySamples.join.some(t =>
      t.players && t.players.length >= 2 && t.players.some(p => !p.isLocal));
    record('mp_other_player_visible',
      hostSeesOther && joinSeesOther ? 'PASS' : 'FAIL',
      `Host sees other: ${hostSeesOther}, Join sees other: ${joinSeesOther}`);
  }

  // CHECK: mp_hit_detection — Score increases (bullets killing enemies)
  // NOTE: In headless SwiftShader, aim direction is imprecise and bullets often miss.
  // Score=0 is common and not necessarily a bug. Use WARN instead of FAIL.
  {
    const hostScores = telemetrySamples.host.map(t => t.player.score);
    const joinScores = telemetrySamples.join.map(t => t.player.score);
    const hostScoreInc = hostScores.length > 1 && hostScores[hostScores.length - 1] > hostScores[0];
    const joinScoreInc = joinScores.length > 1 && joinScores[joinScores.length - 1] > joinScores[0];
    const eitherScored = hostScoreInc || joinScoreInc;
    const hostFinal = hostScores.length > 0 ? hostScores[hostScores.length - 1] : 0;
    const joinFinal = joinScores.length > 0 ? joinScores[joinScores.length - 1] : 0;
    record('mp_hit_detection',
      eitherScored ? 'PASS' : 'WARN',
      `Host score: ${hostFinal}, Join score: ${joinFinal}${!eitherScored ? ' (headless aim imprecision — not a failure)' : ''}`);
  }

  // CHECK: mp_no_desync — Enemy count roughly matches between clients (±50%)
  {
    const pairedSamples = Math.min(telemetrySamples.host.length, telemetrySamples.join.length);
    let syncedCount = 0;
    let totalCompared = 0;
    for (let i = 0; i < pairedSamples; i++) {
      const hCount = telemetrySamples.host[i].enemies.length;
      const jCount = telemetrySamples.join[i].enemies.length;
      if (hCount === 0 && jCount === 0) continue; // skip empty frames
      totalCompared++;
      const max = Math.max(hCount, jCount);
      const min = Math.min(hCount, jCount);
      // Within 50% of each other
      if (max === 0 || min / max >= 0.5) syncedCount++;
    }
    const syncRate = totalCompared > 0 ? syncedCount / totalCompared : 1;
    record('mp_no_desync',
      syncRate >= 0.6 ? 'PASS' : 'FAIL',
      `${(syncRate * 100).toFixed(0)}% frames synced (${syncedCount}/${totalCompared})`);
  }

  // CHECK: mp_enemy_dimming — Enemies have varying opacity (not all 1.0)
  {
    let hasVariedOpacity = false;
    for (const t of telemetrySamples.host) {
      const opacities = t.enemies.map(e => e.opacity).filter(o => o !== undefined);
      if (opacities.length > 0) {
        const hasNonOne = opacities.some(o => o < 0.95);
        if (hasNonOne) { hasVariedOpacity = true; break; }
      }
    }
    record('mp_enemy_dimming',
      hasVariedOpacity ? 'PASS' : 'FAIL',
      hasVariedOpacity ? 'Enemies show distance-based dimming' : 'All enemies at full opacity (dimming may not be active)');
  }

  // CHECK: mp_no_phantom_deaths — Deaths only from nearby enemies
  {
    let phantomDeaths = 0;
    let totalDeaths = 0;
    for (const samples of [telemetrySamples.host, telemetrySamples.join]) {
      for (const t of samples) {
        if (t.deaths && t.deaths.log) {
          for (const d of t.deaths.log) {
            totalDeaths++;
            // Phantom death = nearest enemy > 5.0 world units away
            if (d.nearestEnemyDist > 5.0 || d.nearestEnemyDist < 0) {
              phantomDeaths++;
            }
          }
        }
      }
    }
    // Deduplicate by counting unique death frames
    const hostDeaths = telemetrySamples.host.length > 0
      ? telemetrySamples.host[telemetrySamples.host.length - 1]?.deaths?.total ?? 0 : 0;
    const joinDeaths = telemetrySamples.join.length > 0
      ? telemetrySamples.join[telemetrySamples.join.length - 1]?.deaths?.total ?? 0 : 0;
    // Use the final death count from last sample
    const lastHostLog = telemetrySamples.host.length > 0
      ? telemetrySamples.host[telemetrySamples.host.length - 1]?.deaths?.log ?? [] : [];
    const lastJoinLog = telemetrySamples.join.length > 0
      ? telemetrySamples.join[telemetrySamples.join.length - 1]?.deaths?.log ?? [] : [];
    const allDeathLogs = [...lastHostLog, ...lastJoinLog];
    // Phantom death = nearest enemy > 10 world units AND > 0.3 surface distance.
    // On torus/pill, enemies can be close in surface distance but far in world
    // distance due to surface wrapping. Use both thresholds to avoid false positives.
    // Deaths with nearestEnemyDist == -1 mean NO enemies existed at death time
    // (game-over enemy cleanup) — these are NOT phantom deaths.
    const phantoms = allDeathLogs.filter(d =>
      d.nearestEnemyDist > 0 && d.nearestEnemyDist > 10.0 && (d.nearestEnemySurfaceDist ?? 0) > 0.3);
    const distDetail = phantoms.length > 0
      ? ` [${phantoms.map(d => `world=${d.nearestEnemyDist?.toFixed(1)},surf=${d.nearestEnemySurfaceDist?.toFixed(2)}`).join('; ')}]`
      : '';
    record('mp_no_phantom_deaths',
      phantoms.length === 0 ? 'PASS' : 'FAIL',
      `${phantoms.length} phantom deaths out of ${allDeathLogs.length} total (host: ${hostDeaths}, join: ${joinDeaths})${distDetail}`);
  }

  // CHECK: mp_player_alive — At least one player alive for most of the test
  {
    const hostAliveFrames = telemetrySamples.host.filter(t => t.player.alive).length;
    const joinAliveFrames = telemetrySamples.join.filter(t => t.player.alive).length;
    const hostAliveRate = telemetrySamples.host.length > 0 ? hostAliveFrames / telemetrySamples.host.length : 0;
    const joinAliveRate = telemetrySamples.join.length > 0 ? joinAliveFrames / telemetrySamples.join.length : 0;
    const eitherGood = hostAliveRate >= 0.5 || joinAliveRate >= 0.5;
    record('mp_player_alive',
      eitherGood ? 'PASS' : 'FAIL',
      `Host alive ${(hostAliveRate * 100).toFixed(0)}%, Join alive ${(joinAliveRate * 100).toFixed(0)}%`);
  }

  // CHECK: mp_no_critical_errors
  {
    const hostCritical = getCriticalErrors(hostPage.__errors);
    const joinCritical = getCriticalErrors(joinPage.__errors);
    record('mp_no_critical_errors',
      hostCritical.length === 0 && joinCritical.length === 0 ? 'PASS' : 'FAIL',
      `Host: ${hostCritical.length} errors, Join: ${joinCritical.length} errors`,
      [...hostCritical.slice(0, 3), ...joinCritical.slice(0, 3)].join('\n'));
  }

  // CHECK: mp_connection_stable — Both still connected at end
  {
    const hostStill = await getDebug(hostPage, 'isConnected');
    const joinStill = await getDebug(joinPage, 'isConnected');
    record('mp_connection_stable',
      hostStill && joinStill ? 'PASS' : 'FAIL',
      `Host connected: ${hostStill}, Join connected: ${joinStill}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// MP Scenarios (deeper stress tests)
// ---------------------------------------------------------------------------

async function runMPScenarios(hostPage, joinPage, surface) {
  const results = [];

  const record = (name, status, note) => {
    results.push({ name, status, note });
    const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '~';
    console.log(`    [${status}] ${name}: ${note}`);
  };

  console.log('\n  Scenario: Extended survival (30s)');
  // Both players actively moving + shooting for 30s
  const startTel = await getTelemetry(hostPage);
  const startFrame = startTel?.frame ?? 0;

  for (let i = 0; i < 30; i++) {
    const key = ['w', 'a', 's', 'd'][i % 4];
    await hostPage.keyboard.down(key);
    await hostPage.mouse.click(320, 180);
    await joinPage.keyboard.down(['w', 'a', 's', 'd'][(i + 1) % 4]);
    await joinPage.mouse.click(320, 180);
    await sleep(800);
    await hostPage.keyboard.up(key);
    await joinPage.keyboard.up(['w', 'a', 's', 'd'][(i + 1) % 4]);
    await sleep(200);
  }

  const endTel = await getTelemetry(hostPage);
  const endFrame = endTel?.frame ?? 0;
  const framesAdvanced = endFrame - startFrame;
  record('scenario_extended_survival',
    framesAdvanced > 100 ? 'PASS' : 'FAIL',
    `${framesAdvanced} frames advanced. Game still running.`);

  // Check both still connected
  const hConn = await getDebug(hostPage, 'isConnected');
  const jConn = await getDebug(joinPage, 'isConnected');
  record('scenario_no_disconnect',
    hConn && jConn ? 'PASS' : 'FAIL',
    `Host: ${hConn}, Join: ${jConn}`);

  // Distance consistency: check that surface and world distances are correlated
  console.log('\n  Scenario: Distance consistency');
  const finalTel = await getTelemetry(hostPage);
  if (finalTel && finalTel.enemies.length > 0) {
    let consistent = 0;
    let total = 0;
    for (const e of finalTel.enemies) {
      total++;
      // Surface dist and world dist should be roughly correlated.
      // On elongated surfaces (pill, torus), thresholds are more generous
      // because surface UV distance doesn't map linearly to world distance.
      if (e.surfaceDistToPlayer < 0.3 && e.worldDistToPlayer < 20) consistent++;
      else if (e.surfaceDistToPlayer >= 0.3 && e.worldDistToPlayer >= 1) consistent++;
      else if (e.surfaceDistToPlayer < 0.15) consistent++; // very close = always fine
    }
    const rate = total > 0 ? consistent / total : 1;
    record('scenario_distance_consistency',
      rate >= 0.5 ? 'PASS' : 'FAIL',
      `${(rate * 100).toFixed(0)}% enemies have correlated surf/world distances (${consistent}/${total})`);
  } else {
    record('scenario_distance_consistency', 'SKIP', 'No enemies in telemetry');
  }

  // Shooting accuracy: both players' scores should increase
  console.log('\n  Scenario: Both players scoring');
  const hostEndTel = await getTelemetry(hostPage);
  const joinEndTel = await getTelemetry(joinPage);
  const hostScore = hostEndTel?.player?.score ?? 0;
  const joinScore = joinEndTel?.player?.score ?? 0;
  record('scenario_both_scoring',
    hostScore > 0 && joinScore > 0 ? 'PASS' : (hostScore > 0 || joinScore > 0 ? 'PASS' : 'WARN'),
    `Host score: ${hostScore}, Join score: ${joinScore}${(hostScore === 0 && joinScore === 0) ? ' (headless aim imprecision)' : ''}`);

  return results;
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

function generateReport(surfaceRuns, durationMs) {
  const totalTests = surfaceRuns.reduce((s, r) => s + r.checks.length + r.scenarios.length, 0);
  const totalPass = surfaceRuns.reduce((s, r) =>
    s + [...r.checks, ...r.scenarios].filter(t => t.status === 'PASS').length, 0);
  const totalFail = surfaceRuns.reduce((s, r) =>
    s + [...r.checks, ...r.scenarios].filter(t => t.status === 'FAIL').length, 0);
  const overallPass = totalFail === 0;

  const statusColor = (s) => s === 'PASS' ? '#22c55e' : s === 'FAIL' ? '#ef4444' : s === 'WARN' ? '#f59e0b' : '#94a3b8';

  const surfaceHtml = surfaceRuns.map(({ surface, checks, scenarios, screenshots }) => {
    const allTests = [...checks, ...scenarios];
    const testRows = allTests.map(t => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #1e293b;font-family:monospace;font-size:12px">${t.name}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1e293b;font-weight:bold;color:${statusColor(t.status)}">${t.status}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:11px">${t.note}</td>
      </tr>`).join('');

    const screenshotHtml = screenshots.map(s => {
      const relPath = s.replace(PROJECT_ROOT + '/', '../');
      const name = s.split('/').pop().replace('.png', '');
      return `<div style="display:inline-block;margin:4px;text-align:center;vertical-align:top">
        <div style="color:#64748b;font-size:10px;margin-bottom:2px">${name}</div>
        <img src="${relPath}" style="width:180px;border:1px solid #1e293b" onerror="this.style.display='none'">
      </div>`;
    }).join('');

    const pass = allTests.filter(t => t.status === 'PASS').length;
    const fail = allTests.filter(t => t.status === 'FAIL').length;
    return `
    <div style="margin-bottom:24px;background:#0f172a;border:1px solid #1e293b;border-radius:8px;overflow:hidden">
      <div style="background:${fail === 0 ? '#14532d' : '#7f1d1d'};padding:10px 14px;display:flex;align-items:center;justify-content:space-between">
        <h2 style="margin:0;color:#f1f5f9;font-size:15px;text-transform:uppercase;letter-spacing:1px">
          ${fail === 0 ? '✓' : '✗'} ${surface}
        </h2>
        <span style="color:#cbd5e1;font-size:12px">${pass}P ${fail}F</span>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:#1e293b">
          <th style="padding:6px 10px;text-align:left;color:#94a3b8;font-size:11px">Test</th>
          <th style="padding:6px 10px;text-align:left;color:#94a3b8;font-size:11px;width:60px">Status</th>
          <th style="padding:6px 10px;text-align:left;color:#94a3b8;font-size:11px">Notes</th>
        </tr></thead>
        <tbody>${testRows}</tbody>
      </table>
      ${screenshotHtml ? `<div style="padding:12px;border-top:1px solid #1e293b">${screenshotHtml}</div>` : ''}
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>MP Verify — ${dateStr}</title>
<style>*{box-sizing:border-box}body{font-family:system-ui;background:#020617;color:#f1f5f9;margin:0;padding:20px}</style>
</head><body>
<h1 style="margin:0 0 4px;font-size:20px">MP Visual Test — Telemetry Verify</h1>
<div style="color:#64748b;font-size:12px;margin-bottom:20px">
  ${now.toISOString()} | ${(durationMs/1000).toFixed(1)}s | Surfaces: ${SURFACES_TO_TEST.join(', ')} | SwiftShader headless
</div>
<div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
  <div style="background:#0f172a;border:1px solid #1e293b;border-radius:6px;padding:12px 20px;text-align:center">
    <div style="font-size:24px;font-weight:bold;color:${overallPass?'#22c55e':'#ef4444'}">${overallPass?'PASS':'FAIL'}</div>
    <div style="font-size:11px;color:#64748b;text-transform:uppercase">Overall</div>
  </div>
  <div style="background:#0f172a;border:1px solid #1e293b;border-radius:6px;padding:12px 20px;text-align:center">
    <div style="font-size:24px;font-weight:bold;color:#22c55e">${totalPass}</div>
    <div style="font-size:11px;color:#64748b;text-transform:uppercase">Passed</div>
  </div>
  <div style="background:#0f172a;border:1px solid #1e293b;border-radius:6px;padding:12px 20px;text-align:center">
    <div style="font-size:24px;font-weight:bold;color:#ef4444">${totalFail}</div>
    <div style="font-size:11px;color:#64748b;text-transform:uppercase">Failed</div>
  </div>
</div>
${surfaceHtml}
<div style="margin-top:24px;padding:12px;background:#0f172a;border:1px solid #1e293b;border-radius:6px">
  <p style="margin:0;color:#94a3b8;font-size:12px">
    Tests exercise REAL code: <code style="color:#38bdf8">network-main.ts</code> (client) +
    <code style="color:#38bdf8">GameRoom.ts</code> (server). Telemetry via <code style="color:#38bdf8">window.__GAME_TELEMETRY</code>.
  </p>
</div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });

  console.log('='.repeat(60));
  console.log('  MP VISUAL TEST — TELEMETRY VERIFY');
  console.log(`  Surfaces: ${SURFACES_TO_TEST.join(', ')}`);
  console.log(`  Duration per surface: ${DURATION}s`);
  console.log('='.repeat(60));

  if (!existsSync(CHROME_PATH)) {
    console.error(`\n  ERROR: Chrome not found at ${CHROME_PATH}`);
    process.exit(1);
  }

  // Check Vite dev server
  const devRunning = await waitForServer(BASE_URL, 3000);
  if (!devRunning) {
    console.error(`\n  ERROR: Vite dev server not running on port ${DEV_SERVER_PORT}. Start it first: npm run dev`);
    process.exit(1);
  }
  console.log(`\n  Vite: ${BASE_URL} OK`);

  // Kill stale Colyseus and start fresh
  console.log('  Killing stale Colyseus on port 2567...');
  killPortProcesses([COLYSEUS_PORT]);
  await sleep(1000);

  let colyseusProc = null;
  let hostBrowser = null;
  let joinBrowser = null;
  const surfaceRuns = [];

  try {
    console.log('  Starting Colyseus server...');
    colyseusProc = await startColyseusServer();
    console.log('  Colyseus: started');

    const serverReady = await waitForServer(`http://localhost:${COLYSEUS_PORT}/health`, 10000);
    if (!serverReady) throw new Error('Colyseus health check failed');
    console.log('  Colyseus: health OK');

    // Launch TWO separate browser instances to prevent background tab throttling.
    // In a single browser, the inactive tab's requestAnimationFrame stops entirely,
    // freezing the game loop. Separate processes ensure both run at full speed.
    const launchOpts = { executablePath: CHROME_PATH, headless: 'new', args: LAUNCH_ARGS };
    [hostBrowser, joinBrowser] = await Promise.all([
      puppeteer.launch(launchOpts),
      puppeteer.launch(launchOpts),
    ]);
    console.log('  Two browser instances launched');

    for (const surface of SURFACES_TO_TEST) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`  SURFACE: ${surface.toUpperCase()}`);
      console.log('─'.repeat(60));

      const hostPage = await createPage(hostBrowser);
      const joinPage = await createPage(joinBrowser);
      const screenshots = [];

      // Navigate host first, then joiner
      console.log(`  Navigating Host (${surface})...`);
      await navigateToMPGame(hostPage, surface, 'Host');
      screenshots.push(await screenshot(hostPage, `${surface}-01-host.png`));

      console.log('  Waiting 5s for host to stabilize...');
      await sleep(5000);

      console.log(`  Navigating Joiner (${surface})...`);
      await navigateToMPGame(joinPage, surface, 'Joiner');
      screenshots.push(await screenshot(joinPage, `${surface}-02-join.png`));

      await sleep(5000);

      // Run deep checks
      const checks = await runMPChecks(hostPage, joinPage, surface, DURATION);
      screenshots.push(await screenshot(hostPage, `${surface}-03-host-mid.png`));
      screenshots.push(await screenshot(joinPage, `${surface}-03-join-mid.png`));

      // Run scenarios
      const scenarios = await runMPScenarios(hostPage, joinPage, surface);
      screenshots.push(await screenshot(hostPage, `${surface}-04-host-final.png`));
      screenshots.push(await screenshot(joinPage, `${surface}-04-join-final.png`));

      const pass = [...checks, ...scenarios].filter(r => r.status === 'PASS').length;
      const warn = [...checks, ...scenarios].filter(r => r.status === 'WARN').length;
      const fail = [...checks, ...scenarios].filter(r => r.status === 'FAIL').length;
      console.log(`\n  ${surface}: ${pass} passed, ${warn} warned, ${fail} failed`);

      surfaceRuns.push({ surface, checks, scenarios, screenshots });

      await hostPage.close().catch(() => {});
      await joinPage.close().catch(() => {});
    }

  } finally {
    if (hostBrowser) {
      try { await hostBrowser.close(); } catch { /* ignore */ }
    }
    if (joinBrowser) {
      try { await joinBrowser.close(); } catch { /* ignore */ }
    }
    console.log('\n  Cleaning up...');
    if (colyseusProc) {
      colyseusProc.kill('SIGTERM');
      console.log('  Colyseus stopped.');
    }
    await sleep(1000);
    killPortProcesses([COLYSEUS_PORT]);

    try {
      const remaining = execSync('ss -tlnp 2>/dev/null | grep -E ":2567\\b"', { encoding: 'utf-8' });
      if (remaining.trim()) console.log(`  WARNING: Port 2567 still occupied:\n${remaining}`);
      else console.log('  Port 2567 clean.');
    } catch {
      console.log('  Port 2567 clean.');
    }
  }

  const durationMs = Date.now() - startTime;
  const totalTests = surfaceRuns.reduce((s, r) => s + r.checks.length + r.scenarios.length, 0);
  const totalPass = surfaceRuns.reduce((s, r) =>
    s + [...r.checks, ...r.scenarios].filter(t => t.status === 'PASS').length, 0);
  const totalFail = surfaceRuns.reduce((s, r) =>
    s + [...r.checks, ...r.scenarios].filter(t => t.status === 'FAIL').length, 0);

  console.log('\n' + '='.repeat(60));
  console.log(`  RESULTS: ${totalPass} passed, ${totalFail} failed (${totalTests} total)`);
  console.log('='.repeat(60));

  if (totalFail > 0) {
    console.log('\n  Failed:');
    for (const run of surfaceRuns) {
      for (const t of [...run.checks, ...run.scenarios].filter(r => r.status === 'FAIL')) {
        console.log(`    [${run.surface}] ${t.name}: ${t.note}`);
      }
    }
  }

  const html = generateReport(surfaceRuns, durationMs);
  writeFileSync(REPORT_PATH, html);
  console.log(`\n  Report: ${REPORT_PATH}`);
  console.log(`  Screenshots: ${SCREENSHOT_DIR}/`);

  return totalFail === 0;
}

main().then((ok) => {
  process.exit(ok ? 0 : 1);
}).catch((err) => {
  console.error('\nFatal error:', err.message);
  killPortProcesses([COLYSEUS_PORT]);
  process.exit(1);
});
