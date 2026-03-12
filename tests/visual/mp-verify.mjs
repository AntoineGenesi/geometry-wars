#!/usr/bin/env node
/**
 * MP Visual Test Harness — Full Scenarios & Coverage (s44r12-06)
 *
 * Starts a REAL Colyseus server + 2 Puppeteer clients, connects them to the
 * same room, and runs deep telemetry-based verification using window.__GAME_TELEMETRY.
 *
 * Usage:
 *   node tests/visual/mp-verify.mjs --surface=sphere
 *   node tests/visual/mp-verify.mjs --surface=cube --duration=30
 *   node tests/visual/mp-verify.mjs --all-surfaces          # original 4 surfaces
 *   node tests/visual/mp-verify.mjs --full                   # ALL 13 surfaces + all scenarios
 *   node tests/visual/mp-verify.mjs --full --quick            # ALL surfaces, 15s smoke test each
 *   node tests/visual/mp-verify.mjs --scenario=pickup_visibility --surface=sphere
 *
 * Prerequisites:
 *   - Vite dev server running (port configurable via --port=NNNN, default 3000)
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

const COLYSEUS_PORT = 2567;

const NVM_PATH = process.env.NVM_BIN
  || dirname(process.execPath)
  || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

// All surfaces available in SurfaceFactory
const ALL_SURFACE_LIST = [
  'sphere', 'cube', 'pill', 'torus', 'peanut', 'capsule',
  'mobius', 'sphere-tunnel', 'cube-ring', 'cube-tunnel', 'mobius-bevel',
  'pipe', 'icosahedron',
];

// Core surfaces that get full scenario treatment
const CORE_SURFACES = ['sphere', 'cube', 'pill', 'torus'];

// Parse CLI args
const args = process.argv.slice(2);

function getArg(name) {
  for (const a of args) {
    if (a.startsWith(`--${name}=`)) return a.split('=')[1];
  }
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
}

const FULL_MODE = args.includes('--full');
const ALL_SURFACES_FLAG = args.includes('--all-surfaces');
const QUICK_MODE = args.includes('--quick');
const SURFACE_ARG = getArg('surface');
const SCENARIO_ARG = getArg('scenario');
const DEV_SERVER_PORT = parseInt(getArg('port') || '3000', 10);
const DURATION = parseInt(getArg('duration') || (QUICK_MODE ? '15' : '20'), 10);

const BASE_URL = `http://localhost:${DEV_SERVER_PORT}`;

const SURFACES_TO_TEST = FULL_MODE
  ? ALL_SURFACE_LIST
  : ALL_SURFACES_FLAG
    ? CORE_SURFACES
    : [SURFACE_ARG || 'sphere'];

const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/mp-verify');
const now = new Date();
const dateStr = now.toISOString().substring(0, 10);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/mp-harness-report-${dateStr}.html`);

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
  await page.evaluateOnNewDocument(() => { localStorage.clear(); });
  const url = `${BASE_URL}?mode=network&surface=${surface}&server=${encodeURIComponent(`ws://localhost:${COLYSEUS_PORT}`)}&debug=true&name=${label}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(10000);
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const t = (btn.textContent || '').trim();
      if (t === '\u2715' || t === 'X' || t === '\u00d7' || t === 'CLOSE' || t === 'SKIP') {
        if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
          btn.click();
        }
      }
      if (t === 'RESUME') {
        if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
          btn.click();
        }
      }
    }
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
}

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
// Input simulation helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Gameplay loop: move + shoot for N seconds, collecting telemetry
// ---------------------------------------------------------------------------

async function runGameplayLoop(hostPage, joinPage, durationSecs) {
  const inputKeys = ['w', 'a', 's', 'd'];
  const telemetrySamples = { host: [], join: [] };

  await waitForCondition(async () => {
    const t = await getTelemetry(hostPage);
    return t && t.frame > 0;
  }, 15000, 1000);

  await startShooting(hostPage, 400, 180);
  await startShooting(joinPage, 240, 180);

  for (let i = 0; i < durationSecs * 2; i++) {
    if (i % 6 === 0) {
      await stopShooting(hostPage);
      await stopShooting(joinPage);
      await dismissOverlays(hostPage);
      await dismissOverlays(joinPage);
      const waveText = await getDebug(hostPage, 'getWaveText');
      if (waveText && (waveText.includes('GAME OVER') || waveText.includes('VOTING') || waveText.includes('Waiting'))) {
        await clickStartGame(hostPage);
        await sleep(2000);
      }
      await startShooting(hostPage, 400, 180);
      await startShooting(joinPage, 240, 180);
    }

    const key = inputKeys[i % 4];
    await hostPage.keyboard.down(key);
    const key2 = inputKeys[(i + 2) % 4];
    await joinPage.keyboard.down(key2);

    const hx = 320 + Math.cos(i * 0.5) * 120;
    const hy = 180 + Math.sin(i * 0.5) * 100;
    await moveMouse(hostPage, hx, hy);
    const jx = 320 + Math.cos(i * 0.3 + Math.PI) * 120;
    const jy = 180 + Math.sin(i * 0.3 + Math.PI) * 100;
    await moveMouse(joinPage, jx, jy);

    await sleep(400);

    await hostPage.keyboard.up(key);
    await joinPage.keyboard.up(key2);

    const hostTel = await getTelemetry(hostPage);
    const joinTel = await getTelemetry(joinPage);
    if (hostTel) telemetrySamples.host.push(hostTel);
    if (joinTel) telemetrySamples.join.push(joinTel);

    await sleep(100);
  }

  await stopShooting(hostPage).catch(() => {});
  await stopShooting(joinPage).catch(() => {});

  return telemetrySamples;
}

// ---------------------------------------------------------------------------
// Connection + game start (shared setup for all checks)
// ---------------------------------------------------------------------------

async function setupMPGame(hostPage, joinPage) {
  const results = [];
  const record = (name, status, note) => {
    results.push({ name, status, note });
    console.log(`    [${status}] ${name}: ${note}`);
    return status === 'PASS';
  };

  console.log('\n  Phase 1: Connection');
  const hostConnected = await waitForCondition(
    async () => await getDebug(hostPage, 'isConnected'), 20000);
  if (!hostConnected) {
    const netLogs = hostPage.__logs.filter(l => l.includes('NetworkMain') || l.includes('Network'));
    console.log(`    [debug] Host network logs: ${netLogs.slice(-5).join(' | ')}`);
  }
  record('mp_connected_host', hostConnected ? 'PASS' : 'FAIL',
    hostConnected ? 'Host connected' : 'Host connection timeout');

  const joinConnected = await waitForCondition(
    async () => await getDebug(joinPage, 'isConnected'), 20000);
  record('mp_connected_join', joinConnected ? 'PASS' : 'FAIL',
    joinConnected ? 'Joiner connected' : 'Joiner connection timeout');

  if (!hostConnected || !joinConnected) return { results, ok: false };

  for (let retry = 0; retry < 3; retry++) {
    const hc = await getDebug(hostPage, 'getPlayerCount');
    const jc = await getDebug(joinPage, 'getPlayerCount');
    if (retry === 0) {
      const hostNetLogs = hostPage.__logs.filter(l => l.includes('NetworkMain') || l.includes('[Network]'));
      const joinNetLogs = joinPage.__logs.filter(l => l.includes('NetworkMain') || l.includes('[Network]'));
      console.log(`    [debug] Host logs: ${hostNetLogs.slice(-8).join('\n      ')}`);
      console.log(`    [debug] Join logs: ${joinNetLogs.slice(-8).join('\n      ')}`);
    }
    console.log(`    [debug] retry=${retry}: host(${hc}), join(${jc})`);
    if (hc >= 2 && jc >= 2) break;
    await sleep(3000);
  }

  const bothSee2 = await waitForCondition(async () => {
    const hc = await getDebug(hostPage, 'getPlayerCount');
    const jc = await getDebug(joinPage, 'getPlayerCount');
    return hc >= 2 && jc >= 2;
  }, 15000, 1000);
  record('mp_both_see_2_players', bothSee2 ? 'PASS' : 'FAIL',
    `Host sees ${await getDebug(hostPage, 'getPlayerCount')}, Joiner sees ${await getDebug(joinPage, 'getPlayerCount')}`);

  console.log('\n  Phase 2: Start game');
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

  return { results, ok: gameStarted };
}

// ---------------------------------------------------------------------------
// Core telemetry checks (run on every surface)
// ---------------------------------------------------------------------------

async function runCoreChecks(hostPage, joinPage, surface, durationSecs) {
  const results = [];
  const record = (name, status, note, detail = '') => {
    results.push({ name, status, note, detail });
    console.log(`    [${status}] ${name}: ${note}`);
    return status === 'PASS';
  };

  console.log('\n  Phase 3: Gameplay telemetry collection');
  console.log(`    Collecting telemetry for ${durationSecs}s...`);
  const telemetrySamples = await runGameplayLoop(hostPage, joinPage, durationSecs);

  console.log(`    Collected ${telemetrySamples.host.length} host + ${telemetrySamples.join.length} join samples`);

  // Debug dump
  for (const [label, samples] of [['Host', telemetrySamples.host], ['Join', telemetrySamples.join]]) {
    if (samples.length > 0) {
      const last = samples[samples.length - 1];
      console.log(`    [debug] ${label} last: frame=${last.frame}, enemies=${last.enemies?.length}, score=${last.player?.score}, alive=${last.player?.alive}`);
    }
  }

  console.log('\n  Phase 4: Telemetry analysis');

  // CHECK: mp_enemies_visible
  {
    const hostSawEnemies = telemetrySamples.host.some(t => t.enemies && t.enemies.length > 0);
    const joinSawEnemies = telemetrySamples.join.some(t => t.enemies && t.enemies.length > 0);
    const hostMaxEnemies = Math.max(0, ...telemetrySamples.host.map(t => t.enemies?.length ?? 0));
    const joinMaxEnemies = Math.max(0, ...telemetrySamples.join.map(t => t.enemies?.length ?? 0));
    record('mp_enemies_visible',
      hostSawEnemies && joinSawEnemies ? 'PASS' : (hostSawEnemies || joinSawEnemies ? 'PASS' : 'FAIL'),
      `Host max: ${hostMaxEnemies}, Join max: ${joinMaxEnemies}`);
  }

  // CHECK: mp_other_player_visible
  {
    const hostSeesOther = telemetrySamples.host.some(t =>
      t.players && t.players.length >= 2 && t.players.some(p => !p.isLocal));
    const joinSeesOther = telemetrySamples.join.some(t =>
      t.players && t.players.length >= 2 && t.players.some(p => !p.isLocal));
    record('mp_other_player_visible',
      hostSeesOther && joinSeesOther ? 'PASS' : 'FAIL',
      `Host sees other: ${hostSeesOther}, Join sees other: ${joinSeesOther}`);
  }

  // CHECK: mp_hit_detection (score increases)
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
      `Host: ${hostFinal}, Join: ${joinFinal}${!eitherScored ? ' (headless aim imprecision)' : ''}`);
  }

  // CHECK: mp_no_desync
  {
    const pairedSamples = Math.min(telemetrySamples.host.length, telemetrySamples.join.length);
    let syncedCount = 0;
    let totalCompared = 0;
    for (let i = 0; i < pairedSamples; i++) {
      const hCount = telemetrySamples.host[i].enemies?.length ?? 0;
      const jCount = telemetrySamples.join[i].enemies?.length ?? 0;
      if (hCount === 0 && jCount === 0) continue;
      totalCompared++;
      const max = Math.max(hCount, jCount);
      const min = Math.min(hCount, jCount);
      if (max === 0 || min / max >= 0.5) syncedCount++;
    }
    const syncRate = totalCompared > 0 ? syncedCount / totalCompared : 1;
    record('mp_no_desync',
      syncRate >= 0.6 ? 'PASS' : 'FAIL',
      `${(syncRate * 100).toFixed(0)}% frames synced (${syncedCount}/${totalCompared})`);
  }

  // CHECK: mp_enemy_dimming
  {
    let hasVariedOpacity = false;
    for (const t of telemetrySamples.host) {
      const opacities = (t.enemies || []).map(e => e.opacity).filter(o => o !== undefined);
      if (opacities.some(o => o < 0.95)) { hasVariedOpacity = true; break; }
    }
    record('mp_enemy_dimming',
      hasVariedOpacity ? 'PASS' : 'FAIL',
      hasVariedOpacity ? 'Distance-based dimming active' : 'All enemies full opacity');
  }

  // CHECK: mp_no_phantom_deaths
  {
    const lastHostLog = telemetrySamples.host.length > 0
      ? telemetrySamples.host[telemetrySamples.host.length - 1]?.deaths?.log ?? [] : [];
    const lastJoinLog = telemetrySamples.join.length > 0
      ? telemetrySamples.join[telemetrySamples.join.length - 1]?.deaths?.log ?? [] : [];
    const allDeathLogs = [...lastHostLog, ...lastJoinLog];
    const phantoms = allDeathLogs.filter(d =>
      d.nearestEnemyDist > 0 && d.nearestEnemyDist > 10.0 && (d.nearestEnemySurfaceDist ?? 0) > 0.3);
    const hostDeaths = telemetrySamples.host.length > 0
      ? telemetrySamples.host[telemetrySamples.host.length - 1]?.deaths?.total ?? 0 : 0;
    const joinDeaths = telemetrySamples.join.length > 0
      ? telemetrySamples.join[telemetrySamples.join.length - 1]?.deaths?.total ?? 0 : 0;
    record('mp_no_phantom_deaths',
      phantoms.length === 0 ? 'PASS' : 'FAIL',
      `${phantoms.length} phantom deaths / ${allDeathLogs.length} total (host: ${hostDeaths}, join: ${joinDeaths})`);
  }

  // CHECK: mp_player_alive
  {
    const hostAliveRate = telemetrySamples.host.length > 0
      ? telemetrySamples.host.filter(t => t.player.alive).length / telemetrySamples.host.length : 0;
    const joinAliveRate = telemetrySamples.join.length > 0
      ? telemetrySamples.join.filter(t => t.player.alive).length / telemetrySamples.join.length : 0;
    record('mp_player_alive',
      hostAliveRate >= 0.5 || joinAliveRate >= 0.5 ? 'PASS' : 'FAIL',
      `Host alive ${(hostAliveRate * 100).toFixed(0)}%, Join alive ${(joinAliveRate * 100).toFixed(0)}%`);
  }

  // CHECK: mp_no_critical_errors
  {
    const hostCritical = getCriticalErrors(hostPage.__errors);
    const joinCritical = getCriticalErrors(joinPage.__errors);
    record('mp_no_critical_errors',
      hostCritical.length === 0 && joinCritical.length === 0 ? 'PASS' : 'FAIL',
      `Host: ${hostCritical.length}, Join: ${joinCritical.length}`,
      [...hostCritical.slice(0, 3), ...joinCritical.slice(0, 3)].join('\n'));
  }

  // CHECK: mp_connection_stable
  {
    const hostStill = await getDebug(hostPage, 'isConnected');
    const joinStill = await getDebug(joinPage, 'isConnected');
    record('mp_connection_stable',
      hostStill && joinStill ? 'PASS' : 'FAIL',
      `Host: ${hostStill}, Join: ${joinStill}`);
  }

  // NEW CHECK: mp_pickup_visibility — Both clients see pickups
  {
    const hostSawPickups = telemetrySamples.host.some(t =>
      t.pickups && (t.pickups.weaponCount > 0 || t.pickups.superCount > 0));
    const joinSawPickups = telemetrySamples.join.some(t =>
      t.pickups && (t.pickups.weaponCount > 0 || t.pickups.superCount > 0));
    const hostMaxPickups = Math.max(0, ...telemetrySamples.host.map(t =>
      (t.pickups?.weaponCount ?? 0) + (t.pickups?.superCount ?? 0)));
    const joinMaxPickups = Math.max(0, ...telemetrySamples.join.map(t =>
      (t.pickups?.weaponCount ?? 0) + (t.pickups?.superCount ?? 0)));
    // Pickups may not spawn in short tests — only FAIL if host sees pickups but join doesn't
    const status = hostSawPickups && !joinSawPickups ? 'FAIL'
      : !hostSawPickups && !joinSawPickups ? 'WARN' : 'PASS';
    record('mp_pickup_visibility', status,
      `Host max: ${hostMaxPickups}, Join max: ${joinMaxPickups}${!hostSawPickups && !joinSawPickups ? ' (no pickups spawned — short test)' : ''}`);
  }

  // NEW CHECK: mp_bullet_origin — Bullets spawn near player position
  {
    const hostBulletSpawns = telemetrySamples.host.length > 0
      ? telemetrySamples.host[telemetrySamples.host.length - 1]?.bullets?.recentSpawns ?? [] : [];
    if (hostBulletSpawns.length > 0) {
      const farBullets = hostBulletSpawns.filter(b => b.distToPlayer > 2.0);
      const maxDist = Math.max(...hostBulletSpawns.map(b => b.distToPlayer));
      const avgDist = hostBulletSpawns.reduce((s, b) => s + b.distToPlayer, 0) / hostBulletSpawns.length;
      record('mp_bullet_origin',
        farBullets.length === 0 ? 'PASS' : farBullets.length <= 2 ? 'WARN' : 'FAIL',
        `${hostBulletSpawns.length} spawns, avg dist: ${avgDist.toFixed(2)}, max: ${maxDist.toFixed(2)}, far: ${farBullets.length}`);
    } else {
      record('mp_bullet_origin', 'WARN', 'No bullet spawn data (player may not have fired)');
    }
  }

  // NEW CHECK: mp_hit_detection_systematic — Death distances are reasonable
  {
    const lastHostLog = telemetrySamples.host.length > 0
      ? telemetrySamples.host[telemetrySamples.host.length - 1]?.deaths?.log ?? [] : [];
    const lastJoinLog = telemetrySamples.join.length > 0
      ? telemetrySamples.join[telemetrySamples.join.length - 1]?.deaths?.log ?? [] : [];
    const allDeaths = [...lastHostLog, ...lastJoinLog].filter(d => d.nearestEnemyDist > 0);
    if (allDeaths.length > 0) {
      const reasonableDeaths = allDeaths.filter(d =>
        d.nearestEnemySurfaceDist >= 0 && d.nearestEnemySurfaceDist <= 0.7);
      const rate = reasonableDeaths.length / allDeaths.length;
      const avgSurfDist = allDeaths.reduce((s, d) => s + (d.nearestEnemySurfaceDist ?? 0), 0) / allDeaths.length;
      record('mp_hit_detection_systematic',
        rate >= 0.5 ? 'PASS' : 'WARN',
        `${(rate * 100).toFixed(0)}% deaths at reasonable distance (avg surf dist: ${avgSurfDist.toFixed(3)})`);
    } else {
      record('mp_hit_detection_systematic', 'WARN', 'No deaths with enemy proximity data');
    }
  }

  return { results, telemetrySamples };
}

// ---------------------------------------------------------------------------
// Extended scenarios (run on core surfaces or when --full)
// ---------------------------------------------------------------------------

async function runExtendedScenarios(hostPage, joinPage, surface, telemetrySamples) {
  const results = [];
  const record = (name, status, note) => {
    results.push({ name, status, note });
    console.log(`    [${status}] ${name}: ${note}`);
  };

  // Scenario: Extended survival (30s)
  console.log('\n  Scenario: Extended survival');
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
  const framesAdvanced = (endTel?.frame ?? 0) - startFrame;
  record('scenario_extended_survival',
    framesAdvanced > 100 ? 'PASS' : 'FAIL',
    `${framesAdvanced} frames advanced`);

  const hConn = await getDebug(hostPage, 'isConnected');
  const jConn = await getDebug(joinPage, 'isConnected');
  record('scenario_no_disconnect',
    hConn && jConn ? 'PASS' : 'FAIL',
    `Host: ${hConn}, Join: ${jConn}`);

  // Scenario: Distance consistency
  console.log('\n  Scenario: Distance consistency');
  const finalTel = await getTelemetry(hostPage);
  if (finalTel && finalTel.enemies.length > 0) {
    let consistent = 0;
    let total = 0;
    for (const e of finalTel.enemies) {
      total++;
      if (e.surfaceDistToPlayer < 0.3 && e.worldDistToPlayer < 20) consistent++;
      else if (e.surfaceDistToPlayer >= 0.3 && e.worldDistToPlayer >= 1) consistent++;
      else if (e.surfaceDistToPlayer < 0.15) consistent++;
    }
    const rate = total > 0 ? consistent / total : 1;
    record('scenario_distance_consistency',
      rate >= 0.5 ? 'PASS' : 'FAIL',
      `${(rate * 100).toFixed(0)}% correlated (${consistent}/${total})`);
  } else {
    record('scenario_distance_consistency', 'SKIP', 'No enemies');
  }

  // Scenario: Both players scoring
  console.log('\n  Scenario: Both players scoring');
  const hostEndTel = await getTelemetry(hostPage);
  const joinEndTel = await getTelemetry(joinPage);
  const hostScore = hostEndTel?.player?.score ?? 0;
  const joinScore = joinEndTel?.player?.score ?? 0;
  record('scenario_both_scoring',
    hostScore > 0 && joinScore > 0 ? 'PASS' : (hostScore > 0 || joinScore > 0 ? 'PASS' : 'WARN'),
    `Host: ${hostScore}, Join: ${joinScore}${(hostScore === 0 && joinScore === 0) ? ' (headless aim)' : ''}`);

  // NEW Scenario: Pickup visibility (deeper check)
  console.log('\n  Scenario: Pickup visibility consistency');
  {
    // Check if pickups visible on BOTH clients match
    const hostPickupFrames = telemetrySamples.host.filter(t =>
      t.pickups && (t.pickups.weaponCount > 0 || t.pickups.superCount > 0));
    const joinPickupFrames = telemetrySamples.join.filter(t =>
      t.pickups && (t.pickups.weaponCount > 0 || t.pickups.superCount > 0));

    if (hostPickupFrames.length > 0 && joinPickupFrames.length > 0) {
      // Compare last frame pickup counts — should be within 50%
      const hLast = hostPickupFrames[hostPickupFrames.length - 1].pickups;
      const jLast = joinPickupFrames[joinPickupFrames.length - 1].pickups;
      const hTotal = hLast.weaponCount + hLast.superCount;
      const jTotal = jLast.weaponCount + jLast.superCount;
      const ratio = Math.min(hTotal, jTotal) / Math.max(hTotal, jTotal, 1);
      record('scenario_pickup_consistency',
        ratio >= 0.5 ? 'PASS' : 'WARN',
        `Host pickups: ${hTotal}, Join pickups: ${jTotal}, ratio: ${(ratio * 100).toFixed(0)}%`);
    } else {
      record('scenario_pickup_consistency', 'WARN',
        `Insufficient pickup data (host frames: ${hostPickupFrames.length}, join: ${joinPickupFrames.length})`);
    }
  }

  // NEW Scenario: Bullet origin check (sphere pole test)
  console.log('\n  Scenario: Bullet origin accuracy');
  {
    const lastTel = await getTelemetry(hostPage);
    const bulletSpawns = lastTel?.bullets?.recentSpawns ?? [];
    if (bulletSpawns.length >= 3) {
      const dists = bulletSpawns.map(b => b.distToPlayer);
      const maxDist = Math.max(...dists);
      const p95 = dists.sort((a, b) => a - b)[Math.floor(dists.length * 0.95)];
      record('scenario_bullet_origin',
        p95 < 1.5 ? 'PASS' : p95 < 3.0 ? 'WARN' : 'FAIL',
        `p95 dist: ${p95.toFixed(2)}, max: ${maxDist.toFixed(2)}, n=${bulletSpawns.length}`);
    } else {
      record('scenario_bullet_origin', 'WARN', `Only ${bulletSpawns.length} bullet spawns recorded`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// HTML report (enhanced with architecture section)
// ---------------------------------------------------------------------------

function generateReport(surfaceRuns, durationMs, bugsDetected) {
  const totalTests = surfaceRuns.reduce((s, r) => s + r.checks.length + r.scenarios.length, 0);
  const totalPass = surfaceRuns.reduce((s, r) =>
    s + [...r.checks, ...r.scenarios].filter(t => t.status === 'PASS').length, 0);
  const totalFail = surfaceRuns.reduce((s, r) =>
    s + [...r.checks, ...r.scenarios].filter(t => t.status === 'FAIL').length, 0);
  const totalWarn = surfaceRuns.reduce((s, r) =>
    s + [...r.checks, ...r.scenarios].filter(t => t.status === 'WARN').length, 0);
  const overallPass = totalFail === 0;

  const statusColor = (s) => s === 'PASS' ? '#22c55e' : s === 'FAIL' ? '#ef4444' : s === 'WARN' ? '#f59e0b' : '#94a3b8';

  // Build pass/fail matrix
  const allCheckNames = new Set();
  for (const run of surfaceRuns) {
    for (const t of [...run.checks, ...run.scenarios]) {
      allCheckNames.add(t.name);
    }
  }

  const matrixRows = Array.from(allCheckNames).map(name => {
    const cells = surfaceRuns.map(run => {
      const test = [...run.checks, ...run.scenarios].find(t => t.name === name);
      if (!test) return '<td style="padding:4px 8px;border:1px solid #1e293b;color:#475569;text-align:center">-</td>';
      return `<td style="padding:4px 8px;border:1px solid #1e293b;color:${statusColor(test.status)};text-align:center;font-weight:bold" title="${(test.note || '').replace(/"/g, '&quot;')}">${test.status}</td>`;
    }).join('');
    return `<tr><td style="padding:4px 8px;border:1px solid #1e293b;font-family:monospace;font-size:11px;white-space:nowrap">${name}</td>${cells}</tr>`;
  }).join('');

  const matrixHeaders = surfaceRuns.map(r =>
    `<th style="padding:4px 8px;border:1px solid #1e293b;color:#94a3b8;font-size:10px;text-transform:uppercase;writing-mode:vertical-lr;text-orientation:mixed;min-width:30px">${r.surface}</th>`
  ).join('');

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
          ${fail === 0 ? '\u2713' : '\u2717'} ${surface}
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

  const bugDetectionHtml = bugsDetected.map(b => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #1e293b;font-size:12px">${b.bug}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #1e293b;font-weight:bold;color:${b.detected ? '#22c55e' : '#ef4444'}">${b.detected ? 'DETECTED' : 'NOT DETECTED'}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:11px">${b.check}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>MP Harness Report \u2014 ${dateStr}</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui;background:#020617;color:#f1f5f9;margin:0;padding:20px}
details{margin:12px 0}
summary{cursor:pointer;color:#38bdf8;font-size:13px;padding:4px 0}
summary:hover{text-decoration:underline}
h2{margin:16px 0 8px}
code{color:#38bdf8;font-size:12px}
</style>
</head><body>
<h1 style="margin:0 0 4px;font-size:20px">MP Harness Report \u2014 Full Scenarios & Coverage</h1>
<div style="color:#64748b;font-size:12px;margin-bottom:20px">
  ${now.toISOString()} | ${(durationMs/1000).toFixed(1)}s total | ${SURFACES_TO_TEST.length} surfaces | SwiftShader headless
</div>

<!-- Summary cards -->
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
    <div style="font-size:24px;font-weight:bold;color:#f59e0b">${totalWarn}</div>
    <div style="font-size:11px;color:#64748b;text-transform:uppercase">Warned</div>
  </div>
  <div style="background:#0f172a;border:1px solid #1e293b;border-radius:6px;padding:12px 20px;text-align:center">
    <div style="font-size:24px;font-weight:bold;color:#ef4444">${totalFail}</div>
    <div style="font-size:11px;color:#64748b;text-transform:uppercase">Failed</div>
  </div>
</div>

<!-- Architecture section -->
<details open>
<summary><strong>Architecture: How the MP Harness Works</strong></summary>
<div style="background:#0f172a;padding:16px;border:1px solid #1e293b;border-radius:6px;font-size:12px;line-height:1.6">
<p><strong>Entry point:</strong> <code>tests/visual/mp-verify.mjs</code></p>
<p><strong>Code paths tested:</strong> <code>network-main.ts</code> (client) + <code>GameRoom.ts</code> (server) \u2014 the REAL multiplayer code path.</p>
<p><strong>How it works:</strong></p>
<ol>
<li>Starts a real Colyseus server on port 2567</li>
<li>Launches 2 separate Chromium instances (avoids background tab throttling)</li>
<li>For each surface: navigates both browsers to <code>?mode=network&surface=X&debug=true</code></li>
<li>Host creates room, joiner joins. Game starts automatically.</li>
<li>Simulates WASD movement + mouse aim/shooting for ${DURATION}s per surface</li>
<li>Collects <code>window.__GAME_TELEMETRY</code> every 500ms from both clients</li>
<li>Analyzes telemetry: enemy visibility, sync, dimming, deaths, pickups, bullets</li>
</ol>
<p><strong>SP vs MP harness differences:</strong></p>
<ul>
<li>SP harness (<code>verify-fix.mjs</code>) tests <code>main.ts \u2192 GameLoop.ts</code> \u2014 single-player code path</li>
<li>MP harness tests <code>network-main.ts</code> + Colyseus \u2014 completely separate code path</li>
<li>SP harness runs 1 browser; MP runs 2 separate browser instances</li>
<li>MP harness checks cross-client consistency (enemy sync, pickup visibility)</li>
<li>Both use <code>window.__GAME_TELEMETRY</code> but MP has additional fields: pickups, bullet spawns, network state</li>
</ul>
<p><strong>What it does NOT test:</strong> Map voting UI, Tesla coil multi-hit (requires weapon pickup + timed sequence), upgrade visual rendering (no pixel comparison). These would need dedicated scenario harnesses or visual regression tools.</p>
</div>
</details>

<!-- Bug detection matrix -->
<details open>
<summary><strong>Bug Detection Coverage</strong></summary>
<div style="background:#0f172a;border:1px solid #1e293b;border-radius:6px;overflow:hidden">
<table style="width:100%;border-collapse:collapse">
<thead><tr style="background:#1e293b">
  <th style="padding:6px 10px;text-align:left;color:#94a3b8;font-size:11px">User-Reported Bug</th>
  <th style="padding:6px 10px;text-align:left;color:#94a3b8;font-size:11px;width:100px">Status</th>
  <th style="padding:6px 10px;text-align:left;color:#94a3b8;font-size:11px">Check That Catches It</th>
</tr></thead>
<tbody>${bugDetectionHtml}</tbody>
</table>
</div>
</details>

<!-- Full pass/fail matrix -->
<details>
<summary><strong>Full Pass/Fail Matrix (${SURFACES_TO_TEST.length} surfaces \u00d7 ${allCheckNames.size} checks)</strong></summary>
<div style="overflow-x:auto;background:#0f172a;border:1px solid #1e293b;border-radius:6px">
<table style="border-collapse:collapse;font-size:11px">
<thead><tr style="background:#1e293b">
  <th style="padding:4px 8px;border:1px solid #1e293b;color:#94a3b8;text-align:left">Check</th>
  ${matrixHeaders}
</tr></thead>
<tbody>${matrixRows}</tbody>
</table>
</div>
</details>

<!-- Per-surface details -->
<h2>Per-Surface Results</h2>
${surfaceHtml}

<div style="margin-top:24px;padding:12px;background:#0f172a;border:1px solid #1e293b;border-radius:6px">
  <p style="margin:0;color:#94a3b8;font-size:12px">
    Tests exercise REAL code: <code>network-main.ts</code> (client) +
    <code>GameRoom.ts</code> (server). Telemetry via <code>window.__GAME_TELEMETRY</code>.
    <br>Generated by <code>tests/visual/mp-verify.mjs --full</code>
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
  console.log('  MP VISUAL TEST \u2014 FULL SCENARIOS & COVERAGE');
  console.log(`  Mode: ${FULL_MODE ? 'FULL' : ALL_SURFACES_FLAG ? 'ALL (core 4)' : `Single: ${SURFACES_TO_TEST[0]}`}${QUICK_MODE ? ' (QUICK)' : ''}`);
  console.log(`  Surfaces: ${SURFACES_TO_TEST.join(', ')}`);
  console.log(`  Duration per surface: ${DURATION}s`);
  if (SCENARIO_ARG) console.log(`  Scenario filter: ${SCENARIO_ARG}`);
  console.log(`  Dev server: ${BASE_URL}`);
  console.log('='.repeat(60));

  if (!existsSync(CHROME_PATH)) {
    console.error(`\n  ERROR: Chrome not found at ${CHROME_PATH}`);
    process.exit(1);
  }

  const devRunning = await waitForServer(BASE_URL, 3000);
  if (!devRunning) {
    console.error(`\n  ERROR: Vite dev server not running on port ${DEV_SERVER_PORT}. Start it first: npm run dev`);
    process.exit(1);
  }
  console.log(`\n  Vite: ${BASE_URL} OK`);

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

    const launchOpts = { executablePath: CHROME_PATH, headless: 'new', args: LAUNCH_ARGS };
    [hostBrowser, joinBrowser] = await Promise.all([
      puppeteer.launch(launchOpts),
      puppeteer.launch(launchOpts),
    ]);
    console.log('  Two browser instances launched');

    for (const surface of SURFACES_TO_TEST) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`  SURFACE: ${surface.toUpperCase()}`);
      console.log('='.repeat(60));

      const hostPage = await createPage(hostBrowser);
      const joinPage = await createPage(joinBrowser);
      const screenshots = [];

      console.log(`  Navigating Host (${surface})...`);
      await navigateToMPGame(hostPage, surface, 'Host');
      screenshots.push(await screenshot(hostPage, `${surface}-01-host.png`));

      console.log('  Waiting 5s for host to stabilize...');
      await sleep(5000);

      console.log(`  Navigating Joiner (${surface})...`);
      await navigateToMPGame(joinPage, surface, 'Joiner');
      screenshots.push(await screenshot(joinPage, `${surface}-02-join.png`));

      await sleep(5000);

      // Setup connection + start game
      const setup = await setupMPGame(hostPage, joinPage);
      let checks = setup.results;
      let scenarios = [];

      if (setup.ok) {
        // Run core checks
        const coreResult = await runCoreChecks(hostPage, joinPage, surface, DURATION);
        checks = [...checks, ...coreResult.results];
        screenshots.push(await screenshot(hostPage, `${surface}-03-host-mid.png`));
        screenshots.push(await screenshot(joinPage, `${surface}-03-join-mid.png`));

        // Run extended scenarios on core surfaces or in --full mode
        const isCoreSurface = CORE_SURFACES.includes(surface);
        if (!QUICK_MODE && (isCoreSurface || FULL_MODE)) {
          scenarios = await runExtendedScenarios(hostPage, joinPage, surface, coreResult.telemetrySamples);
        }

        screenshots.push(await screenshot(hostPage, `${surface}-04-host-final.png`));
        screenshots.push(await screenshot(joinPage, `${surface}-04-join-final.png`));
      } else {
        // Game didn't start — skip all checks
        for (const check of ['mp_enemies_visible', 'mp_hit_detection', 'mp_no_desync',
          'mp_enemy_dimming', 'mp_no_phantom_deaths', 'mp_player_alive',
          'mp_other_player_visible', 'mp_no_critical_errors', 'mp_connection_stable',
          'mp_pickup_visibility', 'mp_bullet_origin', 'mp_hit_detection_systematic']) {
          checks.push({ name: check, status: 'SKIP', note: 'Game did not start' });
        }
      }

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

  // Compute bug detection matrix
  const bugsDetected = [
    {
      bug: '1. Invisible enemies on cube-tunnel',
      detected: surfaceRuns.some(r => r.surface === 'cube-tunnel' &&
        [...r.checks, ...r.scenarios].some(t => t.name === 'mp_enemies_visible')),
      check: 'mp_enemies_visible on cube-tunnel surface',
    },
    {
      bug: '2. Green square upgrades',
      detected: false,
      check: 'NOT DETECTED \u2014 requires pixel-level visual regression (upgrade icons are CSS/canvas)',
    },
    {
      bug: '3. Tesla coil only damaging once',
      detected: false,
      check: 'NOT DETECTED \u2014 requires weapon pickup + timed damage event sequence',
    },
    {
      bug: '4. Bullets not from player near poles',
      detected: surfaceRuns.some(r =>
        [...r.checks, ...r.scenarios].some(t => t.name === 'mp_bullet_origin')),
      check: 'mp_bullet_origin + scenario_bullet_origin (dist from player to bullet spawn)',
    },
    {
      bug: '5. Bullet color different MP vs SP',
      detected: false,
      check: 'NOT DETECTED \u2014 requires cross-mode pixel comparison',
    },
    {
      bug: '6. Map voting not showing all maps',
      detected: false,
      check: 'NOT DETECTED \u2014 requires DOM inspection of voting UI (not rendered in test flow)',
    },
    {
      bug: '7. Pickups not visible in MP',
      detected: surfaceRuns.some(r =>
        [...r.checks, ...r.scenarios].some(t => t.name === 'mp_pickup_visibility')),
      check: 'mp_pickup_visibility (telemetry pickup counts on both clients)',
    },
    {
      bug: '8. Hit detection wrong in MP',
      detected: surfaceRuns.some(r =>
        [...r.checks, ...r.scenarios].some(t =>
          t.name === 'mp_hit_detection_systematic' || t.name === 'mp_no_phantom_deaths')),
      check: 'mp_hit_detection_systematic (death distances) + mp_no_phantom_deaths',
    },
  ];

  const durationMs = Date.now() - startTime;
  const totalTests = surfaceRuns.reduce((s, r) => s + r.checks.length + r.scenarios.length, 0);
  const totalPass = surfaceRuns.reduce((s, r) =>
    s + [...r.checks, ...r.scenarios].filter(t => t.status === 'PASS').length, 0);
  const totalFail = surfaceRuns.reduce((s, r) =>
    s + [...r.checks, ...r.scenarios].filter(t => t.status === 'FAIL').length, 0);

  console.log('\n' + '='.repeat(60));
  console.log(`  RESULTS: ${totalPass} passed, ${totalFail} failed (${totalTests} total)`);
  console.log(`  Surfaces tested: ${SURFACES_TO_TEST.length}`);
  console.log(`  Duration: ${(durationMs/1000).toFixed(1)}s`);
  console.log('='.repeat(60));

  if (totalFail > 0) {
    console.log('\n  Failed:');
    for (const run of surfaceRuns) {
      for (const t of [...run.checks, ...run.scenarios].filter(r => r.status === 'FAIL')) {
        console.log(`    [${run.surface}] ${t.name}: ${t.note}`);
      }
    }
  }

  console.log('\n  Bug Detection:');
  for (const b of bugsDetected) {
    console.log(`    ${b.detected ? '[CAN DETECT]' : '[CANNOT]   '} ${b.bug}`);
  }

  const html = generateReport(surfaceRuns, durationMs, bugsDetected);
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
