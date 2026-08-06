#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { screenshotPixelStats } from './screenshot-pixel-stats.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || process.env.SP_DEV_PORT || 3053);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/generic-mesh-imported-gameplay-live-proof', RUN_ID);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/generic-mesh-imported-gameplay-live-proof-${RUN_ID}.json`);
const MESH_PATH = process.env.CUSTOM_MESH_PROOF_PATH || '/meshes/cup.obj';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/mnt/d/WSL-Caches/home-antoine/.cache/puppeteer/chrome/linux-145.0.7632.46/chrome-linux64/chrome',
  '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME_PATH = CHROME_CANDIDATES.find(path => existsSync(path)) || CHROME_CANDIDATES[0];

function wait(ms) {
  return new Promise(resolveWait => setTimeout(resolveWait, ms));
}

function findUp(relativePath, startDir = PROJECT_ROOT) {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // keep waiting
    }
    await wait(300);
  }
  return false;
}

function criticalErrors(errors) {
  return errors.filter((entry) => {
    const type = String(entry.type || '').toLowerCase();
    const text = String(entry.text || entry.message || entry);
    const looksCritical = type === 'error'
      || text.includes('Failed to load custom mesh')
      || text.includes('Uncaught')
      || text.includes('TypeError')
      || text.includes('ReferenceError');
    return looksCritical
      && !text.includes('favicon')
      && !text.includes('AudioContext')
      && !text.includes('SharedArrayBuffer')
      && !text.includes('WebGPU')
      && !text.includes('404')
      && !text.includes('PerformanceExporter')
      && !text.includes('net::ERR_CONNECTION_REFUSED');
  });
}

function assertFiniteVec3(label, value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) {
    throw new Error(`${label} was not finite: ${JSON.stringify(value)}`);
  }
}

function assertFiniteArray(label, value) {
  if (!Array.isArray(value) || !value.every(Number.isFinite)) {
    throw new Error(`${label} was not finite: ${JSON.stringify(value)}`);
  }
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

async function pressMovementKey(page, key, durationMs) {
  await page.evaluate((pressedKey) => {
    const eventInit = { key: pressedKey, bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    document.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  }, key);
  await wait(durationMs);
  await page.evaluate((pressedKey) => {
    const eventInit = { key: pressedKey, bubbles: true, cancelable: true };
    window.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    document.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  }, key);
}

async function screenshot(page, name) {
  const screenshotPath = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath });
  const pixelStats = screenshotPixelStats(screenshotPath);
  if (!pixelStats.nonblank) {
    throw new Error(`Screenshot was blank or invalid: ${JSON.stringify(pixelStats)}`);
  }
  return { path: screenshotPath, pixelStats };
}

async function run() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });

  const viteBin = findUp('node_modules/vite/bin/vite.js');
  if (!viteBin) throw new Error('Could not find node_modules/vite/bin/vite.js');

  const server = spawn(process.execPath, [
    viteBin,
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
  ], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });

  const serverOutput = [];
  server.stdout.on('data', chunk => serverOutput.push(String(chunk)));
  server.stderr.on('data', chunk => serverOutput.push(String(chunk)));

  let browser;
  const pageErrors = [];
  const consoleEntries = [];
  try {
    const ready = await waitForHttp(BASE_URL);
    if (!ready) throw new Error(`Vite server did not respond at ${BASE_URL}`);

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROME_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1280, height: 900 },
    });

    const page = await browser.newPage();
    page.on('console', (msg) => consoleEntries.push({ type: msg.type(), text: msg.text() }));
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack }));

    const url = `${BASE_URL}/?quickStart=true&surface=custom&mesh=${encodeURIComponent(MESH_PATH)}&debug=true&testMode=true&renderer=webgl2&godMode=true&music=false`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    await page.waitForFunction(() => {
      const state = window._gameState;
      return Boolean(
        state
        && state.game
        && state.game.surface === 'custom'
        && state.walker
        && Number.isFinite(state.walker.position.x)
        && window.__TEST_API
        && window.__GAME_TELEMETRY
      );
    }, { timeout: 30_000 });
    await wait(1000);

    const initial = await page.evaluate(() => ({
      gameState: window._gameState,
      telemetry: window.__GAME_TELEMETRY,
      parity: window.__TEST_API.getParityFrame(),
      customMeshLoadError: window.__customMeshLoadError || null,
    }));
    if (initial.customMeshLoadError) {
      throw new Error(`Custom mesh load error was set: ${initial.customMeshLoadError}`);
    }
    assertFiniteVec3('initial walker position', initial.gameState.walker.position);
    assertFiniteVec3('initial walker normal', initial.gameState.walker.normal);
    assertFiniteVec3('initial camera position', initial.gameState.camera.position);

    const beforeMove = initial.gameState.walker.position;
    await page.click('canvas');
    let afterMove = null;
    let playerMovedDistance = 0;
    const movementAttempts = [];
    for (const key of ['w', 'd', 's', 'a']) {
      await pressMovementKey(page, key, 900);
      await wait(250);
      afterMove = await page.evaluate(() => ({
        gameState: window._gameState,
        parity: window.__TEST_API.getParityFrame(),
      }));
      assertFiniteVec3(`moved walker position after ${key}`, afterMove.gameState.walker.position);
      playerMovedDistance = distance(beforeMove, afterMove.gameState.walker.position);
      movementAttempts.push({ key, distance: playerMovedDistance });
      if (playerMovedDistance > 0.1) break;
    }
    if (playerMovedDistance <= 0.1) {
      throw new Error(`Player did not move enough on imported mesh: ${JSON.stringify(movementAttempts)}`);
    }

    await page.evaluate(() => {
      window.__TEST_API.clearEnemies();
      window.__TEST_API.clearEvents();
    });
    const setup = await page.evaluate(() => {
      const api = window.__TEST_API;
      const player = api.getPlayerPosition();
      const enemyId = api.spawnEnemy('grunt', 0.18, 0.56);
      api.configureEnemy(enemyId, { health: 20, speed: 0.02, releaseMovement: true });
      const pickupProof = api.spawnPickupVisualProofSet(0.26, 0.58);
      return {
        player,
        enemyId,
        pickupProof,
        enemyBefore: api.getEnemyPosition(enemyId),
        state: api.getGameState(),
      };
    });
    await wait(900);

    const fired = await page.evaluate((enemyId) => window.__TEST_API.fireWeapon(enemyId), setup.enemyId);
    await wait(800);
    const pickupCollection = await page.evaluate(async () => {
      const api = window.__TEST_API;
      const before = api.getGameState();
      const player = api.getPlayerPosition();
      const pickupId = api.spawnPickup('weapon', player.u, player.v);
      await new Promise(resolve => setTimeout(resolve, 750));
      const after = api.getGameState();
      const runtime = api.getWeaponRuntimeSnapshot();
      return { pickupId, before, after, runtime };
    });
    const interaction = await page.evaluate((enemyId) => ({
      state: window.__TEST_API.getGameState(),
      telemetry: window.__GAME_TELEMETRY,
      enemies: window.__TEST_API.getEnemies(),
      targetEnemy: window.__TEST_API.getEnemyPosition(enemyId),
      bullets: window.__TEST_API.getBulletTrajectories(),
      weaponRuntime: window.__TEST_API.getWeaponRuntimeSnapshot(),
      pickupSamples: window.__TEST_API.getPickupVisualProofSamples(),
      parity: window.__TEST_API.getParityFrame(),
    }), setup.enemyId);

    if (!fired.firedSignal) {
      throw new Error(`Weapon fire did not produce a runtime signal: ${JSON.stringify(fired)}`);
    }
    if (interaction.enemies.length < 1) {
      throw new Error('No live enemy remained for imported mesh proof.');
    }
    const proofEnemy = interaction.enemies.find(enemy => enemy.id === setup.enemyId) ?? interaction.enemies[0];
    assertFiniteVec3('enemy world position', proofEnemy.worldPos);
    if (proofEnemy.movementMode !== 'walker') {
      throw new Error(`Enemy did not use walker movement mode: ${JSON.stringify(proofEnemy)}`);
    }
    if (!proofEnemy.surfaceVisibility) {
      throw new Error(`Enemy surface visibility was not published: ${JSON.stringify(proofEnemy)}`);
    }
    if (!Number.isFinite(proofEnemy.surfaceVisibility.visibility) || proofEnemy.surfaceVisibility.visibility < 0 || proofEnemy.surfaceVisibility.visibility > 1) {
      throw new Error(`Enemy surface visibility was invalid: ${JSON.stringify(proofEnemy.surfaceVisibility)}`);
    }
    if (proofEnemy.instanceMatrixScale <= 0 || proofEnemy.instanceColorBrightness <= 0) {
      throw new Error(`Enemy render slot looked invisible: ${JSON.stringify(proofEnemy)}`);
    }
    if (interaction.pickupSamples.length < 3) {
      throw new Error(`Pickup proof set did not publish enough samples: ${JSON.stringify(interaction.pickupSamples)}`);
    }
    for (const sample of interaction.pickupSamples) {
      assertFiniteArray(`pickup ${sample.id} world position`, sample.worldPosition);
      if (!sample.pose || sample.pose.revision < 1) {
        throw new Error(`Pickup ${sample.id} did not receive a surface pose: ${JSON.stringify(sample)}`);
      }
    }
    if (pickupCollection.after.currentWeapon !== 'spread' && !pickupCollection.runtime.inventory.some(entry => entry.type === 'spread')) {
      throw new Error(`Deterministic pickup was not collected on imported mesh: ${JSON.stringify(pickupCollection)}`);
    }
    assertFiniteVec3('parity camera position', interaction.parity.camera.position);
    assertFiniteVec3('parity player normal', interaction.parity.player.normal);
    if (!Number.isFinite(interaction.parity.camera.outsideSurfaceDot)) {
      throw new Error(`Camera orientation proof was invalid: ${JSON.stringify(interaction.parity.camera)}`);
    }

    const screenshots = [
      await screenshot(page, 'custom-cup-gameplay'),
    ];

    const report = {
      status: 'PASS',
      runId: RUN_ID,
      url,
      meshPath: MESH_PATH,
      screenshots,
      initial,
      movement: {
        before: beforeMove,
        after: afterMove.gameState.walker.position,
        distance: playerMovedDistance,
        attempts: movementAttempts,
        parity: afterMove.parity,
      },
      setup,
      fired,
      pickupCollection,
      interaction,
      pageErrors,
      criticalConsole: criticalErrors(consoleEntries),
      serverOutputTail: serverOutput.join('').split('\n').slice(-40),
    };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`PASS generic mesh imported gameplay live proof: ${REPORT_PATH}`);
  } catch (error) {
    const report = {
      status: 'FAIL',
      runId: RUN_ID,
      meshPath: MESH_PATH,
      error: error instanceof Error ? error.message : String(error),
      pageErrors,
      criticalConsole: criticalErrors(consoleEntries),
      serverOutputTail: serverOutput.join('').split('\n').slice(-80),
    };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await wait(300);
  }

  if (!existsSync(REPORT_PATH) || statSync(REPORT_PATH).size === 0) {
    throw new Error(`Report was not retained: ${REPORT_PATH}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
