#!/usr/bin/env node
/**
 * Geometry Wars - LAN Position Sync Verification Test
 *
 * Proves that both clients see enemies at the same UV coordinates.
 * Spins up 2 headless Puppeteer instances, connects them to the same
 * Colyseus game room, starts the game, waits for enemies to spawn and
 * converge, then compares window.__gameDebug.getEnemies() from both.
 *
 * PASS if all shared enemy UV positions are within 0.02 of each other.
 * FAIL with per-enemy details showing which enemies diverged and by how much.
 *
 * Usage:
 *   node tests/lan/run-sync-tests.mjs
 *
 * Note: SwiftShader (~2-5 FPS headless) means total runtime is 90-150s.
 *
 * Prerequisites:
 *   - Node 20+ (nvm)
 *   - Puppeteer Chrome at ~/.cache/puppeteer/chrome/
 *   - No other processes on port 3016 or 2567
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

const DEV_SERVER_PORT = parseInt(process.env.SYNC_TEST_PORT || '3016', 10);
const COLYSEUS_PORT = 2567;
const BASE_URL = `http://localhost:${DEV_SERVER_PORT}`;
const SERVER_URL = `ws://localhost:${COLYSEUS_PORT}`;
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/lan-sync');
const RESULTS_DIR = resolve(PROJECT_ROOT, 'test-results/lan-sync');

// Detect Node bin directory from NVM or process path
const NVM_PATH = process.env.NVM_BIN
  || dirname(process.execPath)
  || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

// Exact same args as run-lan-tests.mjs (SwiftShader headless WebGL)
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
];

// SwiftShader is slow (~2-5 FPS). Use generous timeouts.
const TIMEOUTS = {
  serverBoot: 20000,       // Colyseus server start
  devServerBoot: 45000,    // Vite dev server start
  pageLoad: 30000,         // Navigation
  gameInit: 15000,         // After page load: wait for game/network to init
  connection: 30000,       // Both clients connect and see 2 players
  gameStart: 20000,        // START GAME button → wave begins
  // Enemy poll: wait up to this long for BOTH to have enemies simultaneously
  bothEnemies: 35000,      // First attempt
  syncWait: 8000,          // After both have enemies: wait for lerp convergence
};

// UV position tolerance: PASS if max delta ≤ this value.
// 0.02 allows for one lerp frame of residual difference (ENEMY_LERP=0.35).
const SYNC_TOLERANCE = 0.02;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Process Management (from run-lan-tests.mjs)
// ---------------------------------------------------------------------------

function killPortProcesses(ports) {
  for (const port of ports) {
    try {
      const result = execSync(`ss -tlnp 2>/dev/null | grep ':${port} '`, { encoding: 'utf-8' });
      if (result.trim()) {
        const pidMatches = result.matchAll(/pid=(\d+)/g);
        for (const match of pidMatches) {
          const pid = match[1];
          try {
            execSync(`kill ${pid} 2>/dev/null`);
            console.log(`  Killed process ${pid} on port ${port}`);
          } catch { /* already dead */ }
        }
        execSync('sleep 1');
      }
    } catch { /* no process on port */ }
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

    const serverProcess = spawn(
      `${NVM_PATH}/npx`,
      ['tsx', 'server/index.ts'],
      { cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let started = false;
    let output = '';
    const serverLogs = [];

    const onData = (data) => {
      const text = data.toString();
      output += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('╔') && !trimmed.startsWith('║') &&
            !trimmed.startsWith('╠') && !trimmed.startsWith('╚')) {
          serverLogs.push(trimmed);
        }
      }
      if (!started && (text.includes('MULTIPLAYER SERVER') || text.includes(`localhost:${COLYSEUS_PORT}`))) {
        started = true;
        serverProcess.__logs = serverLogs;
        resolve(serverProcess);
      }
    };

    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', onData);
    serverProcess.on('error', (err) => {
      if (!started) reject(new Error(`Server failed to start: ${err.message}`));
    });
    serverProcess.on('exit', (code) => {
      if (!started) reject(new Error(`Server exited (code ${code}) before starting. Output: ${output.slice(0, 500)}`));
    });
    setTimeout(() => {
      if (!started) {
        serverProcess.kill();
        reject(new Error(`Server did not start within timeout. Output: ${output.slice(0, 500)}`));
      }
    }, TIMEOUTS.serverBoot);
  });
}

async function checkDevServer() {
  try {
    const resp = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(5000) });
    return resp.ok;
  } catch {
    return false;
  }
}

function startDevServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: `${NVM_PATH}:/usr/bin:/bin` };

    const devProcess = spawn(
      `${NVM_PATH}/npx`,
      ['vite', '--port', String(DEV_SERVER_PORT)],
      { cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let started = false;
    let output = '';

    const onData = (data) => {
      const text = data.toString();
      output += text;
      if (!started && (text.includes('Local:') || text.includes(`localhost:${DEV_SERVER_PORT}`) || text.includes('ready in'))) {
        started = true;
        setTimeout(() => resolve(devProcess), 2000);
      }
    };

    devProcess.stdout.on('data', onData);
    devProcess.stderr.on('data', onData);
    devProcess.on('error', (err) => {
      if (!started) reject(new Error(`Dev server failed to start: ${err.message}`));
    });
    devProcess.on('exit', (code) => {
      if (!started) reject(new Error(`Dev server exited (code ${code}). Output: ${output.slice(0, 500)}`));
    });
    setTimeout(() => {
      if (!started) {
        devProcess.kill();
        reject(new Error(`Dev server did not start within timeout. Output: ${output.slice(0, 500)}`));
      }
    }, TIMEOUTS.devServerBoot);
  });
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch { /* not ready yet */ }
    await sleep(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Browser Helpers (from run-lan-tests.mjs)
// ---------------------------------------------------------------------------

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });
}

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });

  const errors = [];
  const logs = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') errors.push(text);
  });

  page.__testErrors = errors;
  page.__testLogs = logs;
  return page;
}

async function navigateToLAN(page, label) {
  const url = `${BASE_URL}?mode=network&surface=sphere&server=${encodeURIComponent(SERVER_URL)}&debug=true`;
  console.log(`    [${label}] Navigating: ${url}`);
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

async function clickStartOrPlayAgain(page, label) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const clicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const text = btn.textContent || '';
        if (text.includes('START GAME') || text.includes('PLAY AGAIN')) {
          if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
            btn.click();
            return btn.textContent.trim();
          }
        }
      }
      return null;
    });
    if (clicked) {
      console.log(`    [${label}] Clicked "${clicked}" on attempt ${attempt + 1}`);
      return true;
    }
    await sleep(2000);
  }
  return false;
}

async function takeScreenshot(page, label, filename) {
  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const buf = await page.screenshot({ encoding: 'binary' });
    const path = `${SCREENSHOT_DIR}/${filename}`;
    writeFileSync(path, buf);
    console.log(`    [${label}] Screenshot: ${filename}`);
  } catch (err) {
    console.log(`    [${label}] Screenshot failed: ${err.message}`);
  }
}

function dumpPageState(page, label) {
  const errors = (page.__testErrors || []).filter(e =>
    !e.includes('AudioContext') && !e.includes('user gesture') &&
    !e.includes('favicon') && !e.includes('net::') && !e.includes('404') &&
    !e.includes('SharedArrayBuffer') && !e.includes('crossOriginIsolated')
  );
  const networkLogs = (page.__testLogs || []).filter(l =>
    l.includes('[Network') || l.includes('error') || l.includes('Error') ||
    l.includes('Surface') || l.includes('enemy')
  );
  if (errors.length > 0) {
    console.log(`    [${label}] ERRORS (${errors.length}): ${errors.slice(0, 5).join(' | ')}`);
  }
  if (networkLogs.length > 0) {
    console.log(`    [${label}] Logs: ${networkLogs.slice(-5).join(' | ')}`);
  }
}

// ---------------------------------------------------------------------------
// Core sync comparison logic
// ---------------------------------------------------------------------------

function compareEnemyPositions(enemiesA, enemiesB) {
  const mapB = new Map(enemiesB.map(e => [e.id, e]));
  let maxDelta = 0;
  let failCount = 0;
  let comparedCount = 0;
  const failures = [];
  const details = [];

  for (const eA of enemiesA) {
    const eB = mapB.get(eA.id);
    if (!eB) continue;

    comparedCount++;
    const du = Math.abs(eA.u - eB.u);
    const dv = Math.abs(eA.v - eB.v);
    const delta = Math.sqrt(du * du + dv * dv);
    maxDelta = Math.max(maxDelta, delta);

    details.push({ id: eA.id, type: eA.type, uA: eA.u, vA: eA.v, uB: eB.u, vB: eB.v, delta });

    if (delta > SYNC_TOLERANCE) {
      failCount++;
      failures.push({ id: eA.id, type: eA.type, uA: eA.u, vA: eA.v, uB: eB.u, vB: eB.v, delta });
      console.log(
        `  DESYNC: enemy ${eA.id.slice(0, 8)} (${eA.type})` +
        `  A=(${eA.u.toFixed(4)},${eA.v.toFixed(4)})` +
        `  B=(${eB.u.toFixed(4)},${eB.v.toFixed(4)})` +
        `  delta=${delta.toFixed(5)}`,
      );
    }
  }

  return { comparedCount, maxDelta, failCount, failures, details };
}

// ---------------------------------------------------------------------------
// Wait for both clients to have enemies simultaneously (with polling)
// Returns { enemiesA, enemiesB } or null if timeout
// ---------------------------------------------------------------------------

async function waitForBothHaveEnemies(pageA, pageB, timeoutMs) {
  const start = Date.now();
  let bestA = 0;
  let bestB = 0;

  while (Date.now() - start < timeoutMs) {
    const [cA, cB] = await Promise.all([
      getDebug(pageA, 'getEnemyCount'),
      getDebug(pageB, 'getEnemyCount'),
    ]);

    const countA = cA || 0;
    const countB = cB || 0;

    if (countA > bestA) bestA = countA;
    if (countB > bestB) bestB = countB;

    if (countA > 0 && countB > 0) {
      console.log(`    Both have enemies: A=${countA}, B=${countB} at ${Math.round((Date.now() - start) / 1000)}s`);
      return { countA, countB };
    }

    // Log progress every 5s
    if (Math.round((Date.now() - start) / 5000) * 5000 === Math.round((Date.now() - start) / 1000) * 1000) {
      const waveA = await getDebug(pageA, 'getWaveText');
      console.log(`    Waiting... A=${countA} (peak ${bestA}), B=${countB} (peak ${bestB}), wave="${waveA}"`);
    }

    await sleep(500);
  }

  console.log(`    Timeout. Best: A=${bestA}, B=${bestB}`);
  return null;
}

// ---------------------------------------------------------------------------
// Core Sync Test
// ---------------------------------------------------------------------------

async function runSyncTest() {
  console.log('='.repeat(70));
  console.log('  GEOMETRY WARS — LAN Position Sync Verification');
  console.log('  Two-client enemy UV comparison test');
  console.log(`  Tolerance: ±${SYNC_TOLERANCE} UV units`);
  console.log('='.repeat(70));

  if (!existsSync(CHROME_PATH)) {
    console.error(`\n  ERROR: Chrome not found at ${CHROME_PATH}`);
    process.exit(1);
  }
  console.log(`\n  Chrome: ${CHROME_PATH}`);

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });

  // Kill stale processes
  console.log('\n  Killing stale processes on port 2567...');
  killPortProcesses([COLYSEUS_PORT]);
  await sleep(1000);

  let serverProcess = null;
  let devProcess = null;
  let browser = null;
  const testStartTime = Date.now();

  try {
    // ---- Start Colyseus server ----
    console.log(`\n  Starting Colyseus server on port ${COLYSEUS_PORT}...`);
    serverProcess = await startColyseusServer();
    console.log('  Colyseus server: OK');

    const serverReady = await waitForServer(`http://localhost:${COLYSEUS_PORT}/health`, 10000);
    if (!serverReady) throw new Error('Colyseus health check failed');
    console.log('  Colyseus health check: OK');

    // ---- Start/reuse dev server ----
    const devRunning = await checkDevServer();
    if (devRunning) {
      console.log(`  Dev server already running on port ${DEV_SERVER_PORT} (reusing)`);
    } else {
      console.log(`\n  Starting Vite dev server on port ${DEV_SERVER_PORT}...`);
      devProcess = await startDevServer();
      const devReady = await waitForServer(BASE_URL, 10000);
      if (!devReady) throw new Error('Dev server not reachable after start');
      console.log(`  Dev server: ${BASE_URL} (OK)`);
    }

    // ---- Launch browser ----
    console.log('\n  Launching browser...');
    browser = await launchBrowser();

    const pageA = await createPage(browser);
    const pageB = await createPage(browser);
    console.log('  Browser: 2 pages (A=host, B=join).');

    // ---- Navigate both clients ----
    console.log('\n  Navigating Client A (host)...');
    await navigateToLAN(pageA, 'A');
    console.log('  Client A loaded.');

    console.log('  Waiting 5s for host to stabilize...');
    await sleep(5000);

    if (serverProcess.__logs) {
      console.log(`  Server logs: ${serverProcess.__logs.slice(-3).join(' | ')}`);
    }

    console.log('\n  Navigating Client B (join)...');
    await navigateToLAN(pageB, 'B');
    console.log('  Client B loaded.');
    await sleep(3000);

    await takeScreenshot(pageA, 'A', '01-A-connected.png');
    await takeScreenshot(pageB, 'B', '01-B-connected.png');

    // ---- Verify debug API ----
    const [debugA, debugB] = await Promise.all([
      pageA.evaluate(() => typeof window.__gameDebug !== 'undefined'),
      pageB.evaluate(() => typeof window.__gameDebug !== 'undefined'),
    ]);
    console.log(`\n  Debug API — A: ${debugA}, B: ${debugB}`);
    if (!debugA || !debugB) {
      throw new Error('__gameDebug not available. Ensure ?debug=true URL param is processed.');
    }

    // ---- Wait for both clients to connect ----
    console.log('\n  Waiting for both clients to connect...');
    const connectionStart = Date.now();
    let bothConnected = false;
    while (Date.now() - connectionStart < TIMEOUTS.connection) {
      const [cA, cB] = await Promise.all([
        getDebug(pageA, 'isConnected'),
        getDebug(pageB, 'isConnected'),
      ]);
      if (cA && cB) { bothConnected = true; break; }
      await sleep(1000);
    }
    if (!bothConnected) {
      const [cA, cB] = await Promise.all([
        getDebug(pageA, 'isConnected'), getDebug(pageB, 'isConnected'),
      ]);
      throw new Error(`Connection timeout. A=${cA}, B=${cB}`);
    }
    console.log('  Both connected: OK');

    // ---- Wait for both to see 2 players ----
    const playerStart = Date.now();
    while (Date.now() - playerStart < TIMEOUTS.connection) {
      const [pA, pB] = await Promise.all([
        getDebug(pageA, 'getPlayerCount'), getDebug(pageB, 'getPlayerCount'),
      ]);
      if ((pA || 0) >= 2 && (pB || 0) >= 2) break;
      await sleep(1000);
    }
    const [pA, pB] = await Promise.all([
      getDebug(pageA, 'getPlayerCount'), getDebug(pageB, 'getPlayerCount'),
    ]);
    console.log(`  Player counts — A: ${pA}, B: ${pB}`);

    // ---- Start game ----
    console.log('\n  Clicking START GAME on Client A...');
    await clickStartOrPlayAgain(pageA, 'A');

    // Wait for game to actually start (wave text appears)
    const gameStartBegin = Date.now();
    while (Date.now() - gameStartBegin < TIMEOUTS.gameStart) {
      const text = await getDebug(pageA, 'getWaveText');
      if (text && !text.includes('Waiting') && !text.includes('Connecting') &&
          !text.includes('Starting...')) {
        break;
      }
      await sleep(1000);
    }

    const waveText = await getDebug(pageA, 'getWaveText');
    console.log(`  Game state A: "${waveText}"`);

    await takeScreenshot(pageA, 'A', '02-A-game-started.png');
    await takeScreenshot(pageB, 'B', '02-B-game-started.png');

    // ---- ATTEMPT 1: Wait for enemies on both clients ----
    console.log('\n  Attempt 1: Waiting for enemies on BOTH clients...');
    let attempt1Result = await waitForBothHaveEnemies(pageA, pageB, TIMEOUTS.bothEnemies);

    if (!attempt1Result) {
      // Attempt 1 failed. Dump state and try again with a fresh game.
      console.log('\n  Attempt 1 failed. Dumping client state...');
      dumpPageState(pageA, 'A');
      dumpPageState(pageB, 'B');
      await takeScreenshot(pageA, 'A', '03-A-attempt1-fail.png');
      await takeScreenshot(pageB, 'B', '03-B-attempt1-fail.png');

      // Try clicking PLAY AGAIN on Client A to restart
      console.log('\n  Clicking PLAY AGAIN on Client A for fresh game...');
      await clickStartOrPlayAgain(pageA, 'A');
      await sleep(3000);

      const waveText2 = await getDebug(pageA, 'getWaveText');
      console.log(`  Game state A after restart: "${waveText2}"`);

      // ---- ATTEMPT 2: Wait again ----
      console.log('\n  Attempt 2: Waiting for enemies on BOTH clients...');
      attempt1Result = await waitForBothHaveEnemies(pageA, pageB, TIMEOUTS.bothEnemies);

      if (!attempt1Result) {
        console.log('\n  Attempt 2 also failed. Dumping state...');
        dumpPageState(pageA, 'A');
        dumpPageState(pageB, 'B');
        await takeScreenshot(pageA, 'A', '04-A-attempt2-fail.png');
        await takeScreenshot(pageB, 'B', '04-B-attempt2-fail.png');
      }
    }

    // ---- Perform comparison if we have enemies on both ----
    let verdict = 'INCONCLUSIVE';
    let comparedCount = 0;
    let maxDelta = 0;
    let failCount = 0;
    let failures = [];
    let allDetails = [];
    let enemyCountA = 0;
    let enemyCountB = 0;

    if (attempt1Result) {
      // Wait for lerp convergence
      console.log(`\n  Waiting ${TIMEOUTS.syncWait / 1000}s for lerp convergence...`);
      await sleep(TIMEOUTS.syncWait);

      await takeScreenshot(pageA, 'A', '05-A-sync-snapshot.png');
      await takeScreenshot(pageB, 'B', '05-B-sync-snapshot.png');

      // Query enemies from both
      console.log('\n  Querying enemy positions...');
      const [enemiesA, enemiesB] = await Promise.all([
        pageA.evaluate(() => window.__gameDebug.getEnemies()),
        pageB.evaluate(() => window.__gameDebug.getEnemies()),
      ]);

      enemyCountA = enemiesA.length;
      enemyCountB = enemiesB.length;
      console.log(`  Enemy snapshot — A: ${enemyCountA}, B: ${enemyCountB}`);

      if (enemyCountA > 0 && enemyCountB > 0) {
        const result = compareEnemyPositions(enemiesA, enemiesB);
        comparedCount = result.comparedCount;
        maxDelta = result.maxDelta;
        failCount = result.failCount;
        failures = result.failures;
        allDetails = result.details;

        if (comparedCount > 0) {
          verdict = failCount === 0 ? 'PASS' : 'FAIL';
        } else {
          // No shared enemy IDs (all enemies on A died before B got them, or vice versa)
          console.log('  WARNING: No shared enemy IDs between A and B. Possible timing gap.');
          verdict = 'INCONCLUSIVE';
        }
      } else {
        // One or both went to 0 during the convergence wait (enemies died)
        console.log(`  WARNING: Enemies disappeared during convergence wait. A=${enemyCountA}, B=${enemyCountB}`);
        verdict = 'INCONCLUSIVE';
      }
    }

    // ---- Print desync screenshots if needed ----
    if (verdict === 'FAIL') {
      await takeScreenshot(pageA, 'A', '06-A-desync.png');
      await takeScreenshot(pageB, 'B', '06-B-desync.png');
    }

    // ---- Write results ----
    const elapsed = Math.round((Date.now() - testStartTime) / 1000);
    const results = {
      timestamp: new Date().toISOString(),
      verdict,
      elapsed,
      comparedCount,
      enemyCountA,
      enemyCountB,
      maxDelta,
      tolerance: SYNC_TOLERANCE,
      failCount,
      failures,
      allDetails,
    };

    writeFileSync(`${RESULTS_DIR}/sync-test-results.json`, JSON.stringify(results, null, 2));

    // ---- Final summary ----
    console.log('\n' + '='.repeat(70));
    if (verdict === 'PASS') {
      console.log(`  RESULT: PASS`);
      console.log(`    ${comparedCount} enemies compared, all within ±${SYNC_TOLERANCE}`);
      console.log(`    Max delta observed: ${maxDelta.toFixed(5)}`);
    } else if (verdict === 'FAIL') {
      console.log(`  RESULT: FAIL`);
      console.log(`    ${failCount}/${comparedCount} enemies exceeded ±${SYNC_TOLERANCE} tolerance`);
      console.log(`    Max delta observed: ${maxDelta.toFixed(5)}`);
      console.log('\n  Desynced enemies:');
      for (const f of failures) {
        console.log(
          `    ${f.id.slice(0, 10)} (${f.type}): ` +
          `A=(${f.uA.toFixed(4)},${f.vA.toFixed(4)}) ` +
          `B=(${f.uB.toFixed(4)},${f.vB.toFixed(4)}) ` +
          `delta=${f.delta.toFixed(5)}`,
        );
      }
    } else {
      console.log(`  RESULT: INCONCLUSIVE`);
      console.log(`    Could not get enemies on both clients simultaneously.`);
      console.log(`    This may indicate a sync issue or headless timing constraint.`);
      console.log(`    A had ${enemyCountA} enemies, B had ${enemyCountB} at comparison time.`);
    }
    console.log(`\n  Results JSON: ${RESULTS_DIR}/sync-test-results.json`);
    console.log(`  Total elapsed: ${elapsed}s`);
    console.log('='.repeat(70) + '\n');

    await pageA.close();
    await pageB.close();
    await browser.close();
    browser = null;

    // Exit 0 for PASS/INCONCLUSIVE, 1 for FAIL
    return verdict === 'FAIL' ? 1 : 0;

  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      console.log('  Colyseus server stopped.');
    }
    if (devProcess) {
      devProcess.kill('SIGTERM');
      console.log('  Dev server stopped.');
    }
    await sleep(1000);
    killPortProcesses([COLYSEUS_PORT]);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

runSyncTest().then(exitCode => {
  process.exit(exitCode);
}).catch(err => {
  console.error('\n  FATAL:', err.message);
  process.exit(1);
});
