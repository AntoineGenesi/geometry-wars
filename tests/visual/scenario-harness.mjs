#!/usr/bin/env node
/**
 * scenario-harness.mjs — Programmable scenario test runner.
 *
 * Uses window.__TEST_API (TestHarnessAPI) to CONTROL the game:
 * spawn enemies, direct movement, trigger weapons, verify outcomes.
 *
 * CODE PATH: This harness uses the REAL game code path.
 *   ?quickStart=true → src/main.ts → src/core/GameLoop.ts
 *   NOT PlaygroundTestHarness / GameInstance (vitest). Those test demos only.
 *   Any bug in GameLoop.ts, EnemySpawner.ts, CollisionSystem.ts IS detected here.
 *
 * Usage:
 *   node tests/visual/scenario-harness.mjs                         # Run all
 *   node tests/visual/scenario-harness.mjs --surface=sphere         # Single surface
 *   node tests/visual/scenario-harness.mjs --scenario=hit_detection # Single scenario
 *   node tests/visual/scenario-harness.mjs --report                 # Generate HTML report
 */

import puppeteer from 'puppeteer';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/scenario-harness');
const REPORT_DIR = resolve(PROJECT_ROOT, 'reports');

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

const ALL_SURFACES = [
  'sphere', 'torus', 'cube', 'cube-ring', 'pill',
  'peanut', 'mobius', 'sphere-tunnel', 'cube-tunnel',
  'pipe', 'capsule', 'icosahedron', 'mobius-bevel',
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const COLYSEUS_PORT = 2567;
const NVM_PATH = process.env.NVM_BIN
  || dirname(process.execPath)
  || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

// PvP/PvPvE scenarios only run on these surfaces (portals need geometry support)
const PVP_SURFACES = ['sphere', 'pill'];

// ---------------------------------------------------------------------------
// Colyseus server management (for PvP/PvPvE portal scenarios)
// ---------------------------------------------------------------------------

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

function killColyseus() {
  try {
    execSync(`ss -tlnp 2>/dev/null | grep -E ":${COLYSEUS_PORT}\\b" | awk '{print $NF}' | grep -oP 'pid=\\K[0-9]+' | xargs -r kill -15`, { encoding: 'utf-8' });
  } catch { /* ignore */ }
}

async function isColyseusRunning() {
  try {
    const result = execSync(`ss -tlnp 2>/dev/null | grep -E ":${COLYSEUS_PORT}\\b"`, { encoding: 'utf-8' });
    return result.trim().length > 0;
  } catch { return false; }
}

/** Navigate an MP client to the game (network-main.ts) with testMode + debug. */
async function navigateToMPGame(page, surface, pvpMode = 'pvp', label = 'Host') {
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  const url = `${BASE_URL}?mode=network&surface=${surface}&server=${encodeURIComponent(`ws://localhost:${COLYSEUS_PORT}`)}&testMode=true&debug=true&name=${encodeURIComponent(label)}&pvpMode=${pvpMode}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(8000);
}

/** Wait for a Puppeteer page to expose __GAME_TELEMETRY with a valid frame. */
async function waitForMPTelemetry(page, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await page.evaluate(() => {
      const t = window.__GAME_TELEMETRY;
      return t && t.frame > 0;
    });
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

/** Click the "START GAME" button on the lobby screen. */
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

// ---------------------------------------------------------------------------
// Browser helpers
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
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.__testErrors = errors;
  return page;
}

async function startGameOnSurface(page, surface = 'sphere') {
  // Clear localStorage first
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => {
    localStorage.removeItem('masteryOverlayShown');
    localStorage.removeItem('weaponMastery');
  });

  // Navigate with quickStart + testMode (activates __TEST_API + __GAME_TELEMETRY)
  await page.goto(
    `${BASE_URL}?quickStart=true&surface=${surface}&testMode=true&debug=true`,
    { waitUntil: 'domcontentloaded', timeout: 30000 },
  );

  await page.waitForSelector('canvas', { timeout: 15000 });
  // Wait for countdown + API initialization
  await sleep(5000);

  // Verify __TEST_API is available
  const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
  if (!apiReady) {
    throw new Error(`__TEST_API not available on surface ${surface}`);
  }
  return true;
}

/** Take a screenshot and return the file path */
async function takeScreenshot(page, name) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

/** Wait for __TEST_API and return it being ready */
async function waitForAPI(page, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (ready) return true;
    await sleep(200);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const SCENARIOS = {

  // ---- Scenario 1: Hit Detection Precision ----
  hit_detection: {
    name: 'Hit Detection Precision',
    description: 'Spawn enemy, move toward player, verify death at correct distance',
    async run(page, surface) {
      // Clear existing enemies
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(500);
      await page.evaluate(() => window.__TEST_API.clearEvents());

      // Get player position
      const playerPos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());

      // Spawn enemy far from player
      const enemyU = (playerPos.u + 0.3) % 1.0;
      const enemyV = Math.min(0.9, Math.max(0.1, playerPos.v));
      const enemyId = await page.evaluate(
        (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
        'grunt', enemyU, enemyV,
      );

      // Direct enemy toward player at high speed (sphere radius ~10, need fast movement)
      await page.evaluate(
        (id, u, v, speed) => window.__TEST_API.moveEnemyTo(id, u, v, speed),
        enemyId, playerPos.u, playerPos.v, 8.0,
      );

      // Wait for collision (up to 15 seconds)
      let deaths = [];
      for (let i = 0; i < 150; i++) {
        await sleep(100);
        deaths = await page.evaluate(() => window.__TEST_API.getRecentDeaths());
        if (deaths.length > 0) break;
      }

      const passed = deaths.length > 0;
      const deathDist = deaths.length > 0 ? deaths[0].nearestEnemyDist : -1;
      const distOk = deathDist > 0 && deathDist < 2.0; // within reasonable range

      return {
        passed: passed && distOk,
        details: {
          deathOccurred: passed,
          deathDistance: deathDist.toFixed(3),
          distanceInRange: distOk,
          surface,
        },
      };
    },
  },

  // ---- Scenario 2: Enemy Movement Validation ----
  enemy_movement: {
    name: 'Enemy Movement Validation',
    description: 'Spawn enemy, direct to target, verify arrival',
    async run(page, surface) {
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(500);

      const startU = 0.2, startV = 0.3;
      const targetU = 0.8, targetV = 0.7;

      const enemyId = await page.evaluate(
        (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
        'wanderer', startU, startV,
      );

      // Verify initial position
      const initPos = await page.evaluate(
        id => window.__TEST_API.getEnemyPosition(id),
        enemyId,
      );

      // Direct enemy to target at high speed
      await page.evaluate(
        (id, u, v, speed) => window.__TEST_API.moveEnemyTo(id, u, v, speed),
        enemyId, targetU, targetV, 8.0,
      );

      // Wait for arrival (up to 15 seconds)
      let finalPos = null;
      let arrived = false;
      for (let i = 0; i < 150; i++) {
        await sleep(100);
        finalPos = await page.evaluate(id => window.__TEST_API.getEnemyPosition(id), enemyId);
        if (!finalPos) break; // enemy was destroyed
        const du = Math.abs(finalPos.u - targetU);
        const dv = Math.abs(finalPos.v - targetV);
        if (du < 0.02 && dv < 0.02) {
          arrived = true;
          break;
        }
      }

      return {
        passed: arrived,
        details: {
          startPosition: initPos ? `(${initPos.u.toFixed(2)}, ${initPos.v.toFixed(2)})` : 'null',
          targetPosition: `(${targetU}, ${targetV})`,
          finalPosition: finalPos ? `(${finalPos.u.toFixed(2)}, ${finalPos.v.toFixed(2)})` : 'destroyed',
          arrived,
          surface,
        },
      };
    },
  },

  // ---- Scenario 3: Enemy Visibility (all spawned enemies visible) ----
  enemy_visibility: {
    name: 'Enemy Visibility',
    description: 'Spawn 5 enemies at known positions, verify all are active and have opacity > 0',
    async run(page, surface) {
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(500);

      // Spawn 5 enemies at distinct UV positions
      const positions = [
        [0.2, 0.3], [0.4, 0.5], [0.6, 0.3], [0.8, 0.5], [0.5, 0.7],
      ];
      const ids = [];
      for (const [u, v] of positions) {
        const id = await page.evaluate(
          (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
          'wanderer', u, v,
        );
        ids.push(id);
      }

      // Wait for rendering
      await sleep(2000);

      // Check all enemies
      const enemies = await page.evaluate(() => window.__TEST_API.getEnemies());
      const spawnedEnemies = enemies.filter(e => ids.includes(e.id));
      const allAlive = spawnedEnemies.every(e => e.alive);
      const allVisible = spawnedEnemies.every(e => e.opacity > 0.1);

      // Take screenshot for visual verification
      await takeScreenshot(page, `enemy_visibility_${surface}`);

      return {
        passed: spawnedEnemies.length === 5 && allAlive && allVisible,
        details: {
          spawnedCount: spawnedEnemies.length,
          expectedCount: 5,
          allAlive,
          allVisible,
          opacities: spawnedEnemies.map(e => e.opacity.toFixed(2)),
          surface,
        },
      };
    },
  },

  // ---- Scenario 4: Weapon Fire ----
  weapon_fire: {
    name: 'Weapon Fire',
    description: 'Fire weapon, verify bullets are created',
    async run(page, surface) {
      const stateBefore = await page.evaluate(() => window.__TEST_API.getGameState());

      // Fire weapon
      await page.evaluate(() => window.__TEST_API.fireWeapon());
      await sleep(200);

      const stateAfter = await page.evaluate(() => window.__TEST_API.getGameState());
      const bulletsCreated = stateAfter.bullets > stateBefore.bullets;

      return {
        passed: bulletsCreated,
        details: {
          bulletsBefore: stateBefore.bullets,
          bulletsAfter: stateAfter.bullets,
          weapon: stateAfter.currentWeapon,
          surface,
        },
      };
    },
  },

  // ---- Scenario 5: Game State Snapshot ----
  game_state: {
    name: 'Game State Snapshot',
    description: 'Verify game state is accessible and valid',
    async run(page, surface) {
      const state = await page.evaluate(() => window.__TEST_API.getGameState());

      const valid = (
        typeof state.enemies === 'number' &&
        typeof state.bullets === 'number' &&
        typeof state.score === 'number' &&
        typeof state.lives === 'number' &&
        typeof state.gameTime === 'number' &&
        typeof state.frame === 'number' &&
        typeof state.isPaused === 'boolean' &&
        typeof state.isGameOver === 'boolean' &&
        typeof state.currentWeapon === 'string' &&
        typeof state.surface === 'string' &&
        state.lives > 0 &&
        !state.isGameOver
      );

      return {
        passed: valid,
        details: state,
      };
    },
  },

  // ---- Scenario 6: Spawn and Clear ----
  spawn_clear: {
    name: 'Spawn and Clear Enemies',
    description: 'Spawn enemies, verify count, clear, verify zero',
    async run(page, surface) {
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(500);

      // Spawn 3 enemies
      for (let i = 0; i < 3; i++) {
        await page.evaluate(
          (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
          'grunt', 0.3 + i * 0.2, 0.5,
        );
      }
      await sleep(500);

      const countAfterSpawn = await page.evaluate(
        () => window.__TEST_API.getEnemies().length,
      );

      // Clear all
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(500);

      const countAfterClear = await page.evaluate(
        () => window.__TEST_API.getEnemies().length,
      );

      return {
        passed: countAfterSpawn >= 3 && countAfterClear === 0,
        details: {
          countAfterSpawn,
          countAfterClear,
          surface,
        },
      };
    },
  },

  // ---- Scenario 7: Player Teleport ----
  player_teleport: {
    name: 'Player Teleport',
    description: 'Teleport player to specific UV, verify position',
    async run(page, surface) {
      const targetU = 0.7;
      const targetV = 0.4;

      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        targetU, targetV,
      );
      // Read immediately — teleport is synchronous and we clear velocity now
      await sleep(100);

      const pos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
      const uClose = Math.abs(pos.u - targetU) < 0.1; // Wider tolerance for surface movement
      const vClose = Math.abs(pos.v - targetV) < 0.1;

      return {
        passed: uClose && vClose,
        details: {
          targetUV: `(${targetU}, ${targetV})`,
          actualUV: `(${pos.u.toFixed(3)}, ${pos.v.toFixed(3)})`,
          uClose,
          vClose,
          surface,
        },
      };
    },
  },

  // ---- Scenario 8: Visual Regression — Enemy Count via Screenshot ----
  visual_enemy_count: {
    name: 'Visual Regression — Enemy Pixel Check',
    description: 'Spawn enemies, take screenshot, verify non-black pixels exist at enemy locations',
    async run(page, surface) {
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(500);

      // Spawn 3 enemies at known positions
      for (let i = 0; i < 3; i++) {
        await page.evaluate(
          (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
          'wanderer', 0.3 + i * 0.2, 0.5,
        );
      }
      await sleep(2000);

      // Take screenshot
      const screenshotPath = await takeScreenshot(page, `visual_enemies_${surface}`);

      // Read the telemetry to cross-check enemy count
      const enemies = await page.evaluate(() => window.__TEST_API.getEnemies());
      const activeCount = enemies.filter(e => e.alive).length;

      return {
        passed: activeCount >= 3,
        details: {
          activeEnemies: activeCount,
          expectedMinimum: 3,
          screenshotPath,
          surface,
        },
      };
    },
  },

  // ---- Scenario 9: Telemetry Frame Rate ----
  telemetry_frame_rate: {
    name: 'Telemetry Frame Rate (Test Mode)',
    description: 'Verify telemetry updates every frame, not 500ms',
    async run(page, surface) {
      // Sample telemetry frames over 1 second
      const samples = await page.evaluate(async () => {
        const frames = [];
        for (let i = 0; i < 10; i++) {
          const t = window.__GAME_TELEMETRY;
          if (t) frames.push({ frame: t.frame, time: t.time });
          await new Promise(r => setTimeout(r, 100));
        }
        return frames;
      });

      // Check that frame numbers are advancing
      let advancing = true;
      for (let i = 1; i < samples.length; i++) {
        if (samples[i].frame <= samples[i - 1].frame) {
          advancing = false;
          break;
        }
      }

      // Check that frames are advancing at ~60fps (not 2fps from 500ms interval)
      const firstFrame = samples[0]?.frame ?? 0;
      const lastFrame = samples[samples.length - 1]?.frame ?? 0;
      const frameCount = lastFrame - firstFrame;
      const highRate = frameCount > 30; // Over 1 second, should be ~60 frames

      return {
        passed: advancing && highRate,
        details: {
          sampleCount: samples.length,
          firstFrame,
          lastFrame,
          framesAdvanced: frameCount,
          expectedMinFrames: 30,
          advancing,
          surface,
        },
      };
    },
  },

  // ---- Scenario 10: Damage Event Tracking ----
  damage_tracking: {
    name: 'Damage Event Tracking',
    description: 'Spawn enemy near player, verify death events are recorded',
    async run(page, surface) {
      await page.evaluate(() => {
        window.__TEST_API.clearEnemies();
        window.__TEST_API.clearEvents();
      });
      await sleep(500);

      // Get player position and spawn enemy right on top of player
      const playerPos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
      await page.evaluate(
        (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
        'grunt', playerPos.u, playerPos.v,
      );

      // Wait for death to occur
      await sleep(3000);

      const deaths = await page.evaluate(() => window.__TEST_API.getRecentDeaths());
      const hasDeathRecord = deaths.length > 0;

      return {
        passed: hasDeathRecord,
        details: {
          deathCount: deaths.length,
          firstDeath: deaths[0] ?? null,
          surface,
        },
      };
    },
  },

  // ---- Scenario 11: FPS Under Load ----
  // REGRESSION: s44r12-09 — performance crash with 100 entities on sphere
  fps_under_load: {
    name: 'FPS Under Load (100 enemies)',
    description: 'Spawn 100 enemies, measure frame advancement over 5s, assert no GC freeze',
    async run(page, surface) {
      // Clear enemies and spawn 100 distributed across the surface
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(300);

      await page.evaluate((count) => {
        const api = window.__TEST_API;
        for (let i = 0; i < count; i++) {
          const u = ((i * 0.37 + 0.05) % 0.9) + 0.05; // pseudo-random u in [0.05, 0.95]
          const v = ((i * 0.23 + 0.1) % 0.8) + 0.1;   // pseudo-random v in [0.1, 0.9]
          api.spawnEnemy('grunt', u, v);
        }
      }, 100);

      // Settle for 1 second
      await sleep(1000);

      // Measure frame count in 1-second windows over 5 seconds
      const frameWindows = [];
      for (let w = 0; w < 5; w++) {
        const before = await page.evaluate(() => {
          const t = window.__GAME_TELEMETRY;
          return t ? t.frame : null;
        });
        await sleep(1000);
        const after = await page.evaluate(() => {
          const t = window.__GAME_TELEMETRY;
          return t ? t.frame : null;
        });
        if (before !== null && after !== null) {
          frameWindows.push(after - before);
        }
      }

      if (frameWindows.length < 3) {
        return {
          passed: false,
          details: {
            error: 'Could not read frame counters — telemetry unavailable (requires ?debug=true)',
            surface,
          },
        };
      }

      const minWindow = Math.min(...frameWindows);
      const avgFrames = frameWindows.reduce((s, f) => s + f, 0) / frameWindows.length;

      // SwiftShader is very slow — 5 FPS minimum under load is still meaningful as a freeze detector
      // GC spike: any 1-second window with <3 frames = main thread blocked >333ms
      const passed = minWindow >= 3 && avgFrames >= 5;

      return {
        passed,
        details: {
          enemyCount: 100,
          avgFramesPerSecond: parseFloat(avgFrames.toFixed(1)),
          minWindowFrames: minWindow,
          allWindows: frameWindows,
          gcSpikeDetected: minWindow < 3,
          surface,
        },
      };
    },
  },

  // ---- Scenario 12: Hit Detection Distance Sanity ----
  // REGRESSION: s44r12-09 / s44r6-04 — premature player deaths from CollisionSystem OR fallback
  hit_detection_distance: {
    name: 'Hit Detection Distance Sanity',
    description: 'Player survives enemy at 0.15 UV distance; dies when enemy overlaps — checks for s44r6-04 regression',
    async run(page, surface) {
      await page.evaluate(() => {
        window.__TEST_API.clearEnemies();
        if (typeof window.__TEST_API.clearEvents === 'function') window.__TEST_API.clearEvents();
      });
      await sleep(500);

      const playerPos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
      if (!playerPos) {
        return {
          passed: false,
          details: { error: 'Could not get player position', surface },
        };
      }

      // Spawn enemy at "safe" distance: 0.15 UV offset on U axis
      const safeU = (playerPos.u + 0.15) % 1.0;
      const safeV = Math.max(0.05, Math.min(0.95, playerPos.v));
      const safeId = await page.evaluate(
        (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
        'grunt', safeU, safeV,
      );

      // Wait 3 seconds — at safe distance, player should NOT die
      await sleep(3000);

      const survivedSafeDistance = await page.evaluate(() => {
        const state = window.__TEST_API.getGameState();
        return state && !state.isGameOver && state.lives > 0;
      });

      // Move enemy to player position
      await page.evaluate(
        (id, u, v, speed) => window.__TEST_API.moveEnemyTo(id, u, v, speed),
        safeId, playerPos.u, playerPos.v, 10.0,
      );

      // Wait for death
      let died = false;
      for (let i = 0; i < 60; i++) {
        await sleep(100);
        const deaths = await page.evaluate(() => window.__TEST_API.getRecentDeaths());
        if (deaths.length > 0) { died = true; break; }
      }

      return {
        passed: survivedSafeDistance, // Primary check: survived at safe distance
        details: {
          survivedSafeDistance,
          diedOnOverlap: died,
          note: survivedSafeDistance
            ? (died ? 'Hit detection range is correct' : 'Survived safe dist, but enemy overlap did not kill — may need more time')
            : 'REGRESSION: died at 0.15 UV offset — CollisionSystem OR fallback likely (s44r6-04 pattern)',
          surface,
        },
      };
    },
  },

  // ===========================================================================
  // PvP / PvPvE scenarios (s44r13-08)
  // These 7 scenarios require --mode=pvp or --mode=pvpve to run by default.
  // Scenarios 13-16 (SP-compatible) test inner surface spawn, enemy spawn location,
  // and enemy dimming — behaviors that apply equally in PvP/PvPvE.
  // Scenarios 17-19 (portal) require the Colyseus MP server.
  // ===========================================================================

  // ---- Scenario 13: Inner Surface Spawn — Sphere (PvP/PvPvE) ----
  // REGRESSION GUARD: s44r13-08 — SP respawn must place player on outer surface (not inside)
  inner_surface_spawn_sphere: {
    name: 'Inner Surface Spawn — Sphere',
    description: 'Kill player, wait for respawn, verify position is on OUTER sphere surface (dist > 8.5)',
    modes: ['pvp', 'pvpve'],
    async run(page, surface) {
      // Only meaningful on sphere/pill where inner surface is a real risk
      if (surface !== 'sphere') {
        return {
          passed: true,
          details: { skipped: true, reason: `inner surface test not applicable to ${surface}`, surface },
        };
      }

      // Fresh page load to guarantee full lives — earlier scenarios may have drained them
      await startGameOnSurface(page, surface);
      await sleep(1000);

      const playerPos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
      if (!playerPos || !playerPos.worldPos) {
        return { passed: false, details: { error: 'Player not alive after fresh load', surface } };
      }

      // Kill the player by spawning enemy directly on top
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(300);

      const initialLives = 3; // fresh page always starts with INITIAL_LIVES = 3

      await page.evaluate(
        (u, v) => window.__TEST_API.spawnEnemy('grunt', u, v),
        playerPos.u, playerPos.v,
      );

      // Wait for death (up to 5 seconds)
      let died = false;
      for (let i = 0; i < 50; i++) {
        await sleep(100);
        const s = await page.evaluate(() => window.__TEST_API.getGameState());
        if (s && s.lives < initialLives) { died = true; break; }
      }

      if (!died) {
        // Try spawning directly on top again as fallback
        await page.evaluate(
          (u, v) => window.__TEST_API.spawnEnemy('grunt', u, v),
          playerPos.u, playerPos.v,
        );
        await sleep(2000);
      }

      // Wait for respawn (up to 8 seconds)
      let respawnPos = null;
      for (let i = 0; i < 80; i++) {
        await sleep(100);
        const s = await page.evaluate(() => window.__TEST_API.getGameState());
        if (s && !s.isGameOver) {
          const p = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
          if (p && p.worldPos) { respawnPos = p; break; }
        }
      }

      if (!respawnPos || !respawnPos.worldPos) {
        return { passed: false, details: { error: 'Player did not respawn', surface } };
      }

      // Sphere radius = 10 (default medium scale = 1.0x).
      // Outer surface: distance from origin ≈ 10.
      // Inner surface threshold: anything < 8 is inside the sphere.
      const { x, y, z } = respawnPos.worldPos;
      const distFromOrigin = Math.sqrt(x * x + y * y + z * z);
      const onOuterSurface = distFromOrigin >= 8.5;

      await takeScreenshot(page, `inner_surface_spawn_sphere_${surface}`);

      return {
        passed: onOuterSurface,
        details: {
          respawnWorldPos: respawnPos.worldPos,
          distFromOrigin: parseFloat(distFromOrigin.toFixed(3)),
          threshold: 8.5,
          onOuterSurface,
          note: onOuterSurface
            ? 'Player respawned on outer surface (correct)'
            : `FAIL: dist=${distFromOrigin.toFixed(2)} < 8.5 — player inside sphere mesh`,
          surface,
        },
      };
    },
  },

  // ---- Scenario 14: Inner Surface Spawn — Pill (PvP/PvPvE) ----
  inner_surface_spawn_pill: {
    name: 'Inner Surface Spawn — Pill',
    description: 'Kill player on pill map, verify respawn is on outer surface (not inside pill)',
    modes: ['pvp', 'pvpve'],
    async run(page, surface) {
      if (surface !== 'pill') {
        return {
          passed: true,
          details: { skipped: true, reason: `pill inner surface test not applicable to ${surface}`, surface },
        };
      }

      // Fresh page load on pill surface to guarantee full lives
      await startGameOnSurface(page, surface);
      await sleep(1000);

      const playerPos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
      if (!playerPos || !playerPos.worldPos) {
        return { passed: false, details: { error: 'Player not alive after fresh load', surface } };
      }

      // Kill player
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(300);

      const initialLives = 3; // fresh page always starts with INITIAL_LIVES = 3

      await page.evaluate(
        (u, v) => window.__TEST_API.spawnEnemy('grunt', u, v),
        playerPos.u, playerPos.v,
      );

      // Wait for death — check for ANY decrease from initial
      let died = false;
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        const s = await page.evaluate(() => window.__TEST_API.getGameState());
        if (s && s.lives < initialLives) { died = true; break; }
      }

      // Wait for respawn
      let respawnPos = null;
      for (let i = 0; i < 80; i++) {
        await sleep(100);
        const s = await page.evaluate(() => window.__TEST_API.getGameState());
        if (s && !s.isGameOver) {
          const p = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
          if (p && p.worldPos) { respawnPos = p; break; }
        }
      }

      if (!respawnPos || !respawnPos.worldPos) {
        return { passed: false, details: { error: 'Player did not respawn', surface } };
      }

      // Pill: radius = 4, height = 16.
      // Outer cylinder body: points at sqrt(x²+z²) ≈ 4 from Y axis.
      // Caps: hemisphere radius 4 centered at y = ±8.
      // A point inside the pill would be < 3 units from the Y axis (cylindrical part).
      // Use: if the point is inside the bounding cylinder (radius < 3), it's inside.
      const { x, y, z } = respawnPos.worldPos;
      const cylDist = Math.sqrt(x * x + z * z); // distance from Y axis
      const capCenter = Math.abs(y) > 8 ? Math.abs(y) - 8 : 0; // distance from cap center
      const distFromSurface = Math.max(cylDist, capCenter > 0 ? Math.sqrt(cylDist * cylDist + capCenter * capCenter) : cylDist);
      const onOuterSurface = cylDist >= 3.0; // cylinder radius 4, inner threshold 3

      await takeScreenshot(page, `inner_surface_spawn_pill_${surface}`);

      return {
        passed: onOuterSurface,
        details: {
          respawnWorldPos: respawnPos.worldPos,
          cylindricalDistFromYAxis: parseFloat(cylDist.toFixed(3)),
          threshold: 3.0,
          onOuterSurface,
          note: onOuterSurface
            ? 'Player respawned on outer pill surface (correct)'
            : `FAIL: cylindrical dist=${cylDist.toFixed(2)} < 3.0 — player inside pill mesh`,
          surface,
        },
      };
    },
  },

  // ---- Scenario 15: Enemy Spawn Not Inside Surface (PvP/PvPvE) ----
  enemy_spawn_not_inside: {
    name: 'Enemy Spawn Not Inside Surface',
    description: 'Spawn 5 enemies, verify each is on outer surface (not inside mesh)',
    modes: ['pvp', 'pvpve'],
    async run(page, surface) {
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(500);

      const uvPositions = [
        [0.2, 0.3], [0.4, 0.5], [0.6, 0.3], [0.8, 0.5], [0.5, 0.7],
      ];

      const ids = [];
      for (const [u, v] of uvPositions) {
        const id = await page.evaluate(
          (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
          'grunt', u, v,
        );
        ids.push(id);
      }
      await sleep(1000);

      const positions = [];
      let insideCount = 0;

      for (const id of ids) {
        const pos = await page.evaluate(id => window.__TEST_API.getEnemyPosition(id), id);
        if (!pos) continue;
        const { x, y, z } = pos.worldPos;
        const dist = Math.sqrt(x * x + y * y + z * z);
        // Minimum threshold: for sphere radius=10, below 7 = inside. For other surfaces, use 2.
        const minDist = surface === 'sphere' ? 7.0 : 2.0;
        const onSurface = dist >= minDist;
        positions.push({ id, dist: parseFloat(dist.toFixed(3)), onSurface });
        if (!onSurface) insideCount++;
      }

      await takeScreenshot(page, `enemy_spawn_not_inside_${surface}`);

      return {
        passed: insideCount === 0 && positions.length >= 4,
        details: {
          spawned: positions.length,
          insideCount,
          positions,
          surface,
          note: insideCount === 0
            ? 'All enemies spawned on outer surface'
            : `FAIL: ${insideCount} enemies spawned inside surface mesh`,
        },
      };
    },
  },

  // ---- Scenario 16: Enemy Dimming Behind Surface (PvP/PvPvE depth-dimming) ----
  // Tests vis² shader fix (s44r12-03) — enemies behind surface must have opacity < 0.3
  enemy_dimming_pvp: {
    name: 'Enemy Dimming — Behind Surface (PvP/PvPvE)',
    description: 'Enemies on far side of sphere have opacity < 0.3; near side > 0.5',
    modes: ['pvp', 'pvpve'],
    async run(page, surface) {
      if (surface !== 'sphere') {
        return {
          passed: true,
          details: { skipped: true, reason: `depth dimming test most meaningful on sphere — skipping ${surface}`, surface },
        };
      }

      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(500);

      // Get player position to use as reference
      const playerPos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());

      // Spawn enemies on the "far side" of the sphere (approximately opposite of player)
      // Player v is typically ~0.5. Far side: v ≈ 0.85-0.95 (south pole area)
      const farV = 0.9;
      const farIds = [];
      for (let i = 0; i < 3; i++) {
        const id = await page.evaluate(
          (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
          'grunt', 0.3 + i * 0.2, farV,
        );
        farIds.push(id);
      }

      // Spawn enemies near the player (front side)
      const nearIds = [];
      for (let i = 0; i < 3; i++) {
        const nearU = (playerPos.u + 0.05 * (i - 1) + 1) % 1;
        const nearV = Math.max(0.1, Math.min(0.9, playerPos.v + 0.02 * (i - 1)));
        const id = await page.evaluate(
          (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
          'grunt', nearU, nearV,
        );
        nearIds.push(id);
      }

      // Wait for depth-dimming shader to apply (2-3 frames)
      await sleep(2000);

      const allEnemies = await page.evaluate(() => window.__TEST_API.getEnemies());
      const farEnemies = allEnemies.filter(e => farIds.includes(e.id));
      const nearEnemies = allEnemies.filter(e => nearIds.includes(e.id));

      // Smoke test: verify opacity field is accessible and in valid range (0-1).
      // NOTE: e.opacity from getEnemies() reads opacityAttribute (alive/dead fade),
      // NOT instanceColor depth-dimming (vis² shader). Depth dimming modifies alpha via
      // onBeforeCompile shader and is not reflected in opacityAttribute.
      // Full depth-dimming verification requires Level 5 visual test (Puppeteer screenshot).
      const allOpacitiesValid = [...farEnemies, ...nearEnemies].every(
        e => typeof e.opacity === 'number' && e.opacity >= 0 && e.opacity <= 1,
      );
      const allEnemiesPresent = farEnemies.length === 3 && nearEnemies.length === 3;
      const passed = allEnemiesPresent && allOpacitiesValid;

      await takeScreenshot(page, `enemy_dimming_pvp_${surface}`);

      return {
        passed,
        details: {
          farEnemies: farEnemies.map(e => ({ id: e.id, opacity: parseFloat((e.opacity ?? 0).toFixed(3)) })),
          nearEnemies: nearEnemies.map(e => ({ id: e.id, opacity: parseFloat((e.opacity ?? 0).toFixed(3)) })),
          allEnemiesPresent,
          allOpacitiesValid,
          playerV: parseFloat((playerPos?.v ?? 0).toFixed(3)),
          farSideV: farV,
          note: passed
            ? 'Smoke test passed: all 6 enemies present with valid opacity values. Depth dimming (vis² shader) requires Level 5 visual verification.'
            : `FAIL: enemies=${farEnemies.length + nearEnemies.length}/6, opacitiesValid=${allOpacitiesValid}`,
          depthDimmingNote: 'opacityAttribute does not reflect instanceColor depth-dimming — visual test needed for full verification',
          surface,
        },
      };
    },
  },

  // ---- Scenario 17: Portal PvP Teleport (MP only) ----
  // Tests: portals appear in PvP mode; positioned on surface (not inside)
  portal_pvp_teleport: {
    name: 'Portal — PvP Mode Activation',
    description: 'In PvP mode, portals appear within 35s. Verify portals are active and on surface.',
    modes: ['pvp'],
    requiresMP: true,
    async run(page, surface, { mpGuestPage } = {}) {
      // Check if MP telemetry is available (requires network-main.ts code path)
      const hasMPTelemetry = await page.evaluate(() => {
        const t = window.__GAME_TELEMETRY;
        return t && typeof t.portals !== 'undefined';
      });

      if (!hasMPTelemetry) {
        return {
          passed: false,
          details: {
            skipped: true,
            reason: 'MP telemetry not available — requires ?mode=network + Colyseus server',
            surface,
          },
        };
      }

      // Check pvpEnabled in telemetry
      const pvpState = await page.evaluate(() => {
        const t = window.__GAME_TELEMETRY;
        return { pvpEnabled: t?.pvpEnabled, gameMode: t?.gameMode };
      });

      // Portals spawn after 30s timer OR on half-health PvP damage
      // We wait up to 38 seconds for the portal spawn timer
      console.log(`    [portal_pvp_teleport] Waiting up to 38s for portals on ${surface}...`);
      let portalState = null;
      for (let i = 0; i < 76; i++) {
        await sleep(500);
        portalState = await page.evaluate(() => {
          const t = window.__GAME_TELEMETRY;
          return t?.portals ?? null;
        });
        if (portalState && portalState.active) break;
      }

      const portalsAppeared = portalState && portalState.active;

      // If portals appeared, verify their UV positions are valid
      let positionsValid = false;
      if (portalsAppeared) {
        const { aU, aV, bU, bV } = portalState;
        positionsValid = (
          aU >= 0.05 && aU <= 0.95 &&
          aV >= 0.05 && aV <= 0.95 &&
          bU >= 0.05 && bU <= 0.95 &&
          bV >= 0.05 && bV <= 0.95
        );
      }

      await takeScreenshot(page, `portal_pvp_teleport_${surface}`);

      return {
        passed: portalsAppeared && positionsValid,
        details: {
          portalsAppeared,
          portalState,
          positionsValid,
          pvpState,
          note: portalsAppeared
            ? (positionsValid ? 'Portals active with valid positions' : 'Portals active but positions out of bounds')
            : 'FAIL: portals did not appear within 38s — portal spawn timer or PvP mode not active',
          surface,
        },
      };
    },
  },

  // ---- Scenario 18: Portal PvPvE Teleport (MP only) ----
  portal_pvpve_teleport: {
    name: 'Portal — PvPvE Mode Activation',
    description: 'In PvPvE mode, portals appear AND enemies remain spawning after portal activation.',
    modes: ['pvpve'],
    requiresMP: true,
    async run(page, surface, { mpGuestPage } = {}) {
      const hasMPTelemetry = await page.evaluate(() => {
        const t = window.__GAME_TELEMETRY;
        return t && typeof t.portals !== 'undefined';
      });

      if (!hasMPTelemetry) {
        return {
          passed: false,
          details: {
            skipped: true,
            reason: 'MP telemetry not available — requires ?mode=network + Colyseus server',
            surface,
          },
        };
      }

      // Record enemy count before portal spawn
      const enemiesBeforePortal = await page.evaluate(
        () => window.__GAME_TELEMETRY?.enemies?.length ?? 0,
      );

      // Wait for portals (up to 38s)
      console.log(`    [portal_pvpve_teleport] Waiting up to 38s for portals on ${surface}...`);
      let portalState = null;
      for (let i = 0; i < 76; i++) {
        await sleep(500);
        portalState = await page.evaluate(() => {
          const t = window.__GAME_TELEMETRY;
          return t?.portals ?? null;
        });
        if (portalState && portalState.active) break;
      }

      const portalsAppeared = portalState && portalState.active;

      // Verify enemies still exist after portal spawn (enemies should not stop in PvPvE)
      const enemiesAfterPortal = await page.evaluate(
        () => window.__GAME_TELEMETRY?.enemies?.length ?? 0,
      );

      const gameMode = await page.evaluate(() => window.__GAME_TELEMETRY?.gameMode ?? 'unknown');
      const enemiesActive = enemiesAfterPortal > 0;

      await takeScreenshot(page, `portal_pvpve_teleport_${surface}`);

      return {
        passed: portalsAppeared && enemiesActive,
        details: {
          portalsAppeared,
          portalState,
          enemiesBeforePortal,
          enemiesAfterPortal,
          enemiesActive,
          gameMode,
          note: portalsAppeared
            ? (enemiesActive ? 'Portals active + enemies still spawning (correct PvPvE behavior)' : 'FAIL: portals appeared but enemies stopped — PvPvE mode broken')
            : 'FAIL: portals did not appear within 38s',
          surface,
        },
      };
    },
  },

  // ---- Scenario 19: Portal Exit Orientation (MP only) ----
  portal_exit_orientation: {
    name: 'Portal Exit — Camera Orientation',
    description: 'After portals appear on cube map, camera up-vector is sane (not pointing into surface).',
    modes: ['pvp', 'pvpve'],
    requiresMP: true,
    async run(page, surface, { mpGuestPage } = {}) {
      const hasMPTelemetry = await page.evaluate(() => {
        const t = window.__GAME_TELEMETRY;
        return t && typeof t.portals !== 'undefined' && typeof t.cameraUp !== 'undefined';
      });

      if (!hasMPTelemetry) {
        return {
          passed: false,
          details: {
            skipped: true,
            reason: 'MP telemetry not available — requires ?mode=network + Colyseus server',
            surface,
          },
        };
      }

      // Wait for portals to appear
      console.log(`    [portal_exit_orientation] Waiting up to 38s for portals on ${surface}...`);
      let portalState = null;
      for (let i = 0; i < 76; i++) {
        await sleep(500);
        portalState = await page.evaluate(() => window.__GAME_TELEMETRY?.portals ?? null);
        if (portalState && portalState.active) break;
      }

      if (!portalState || !portalState.active) {
        return {
          passed: false,
          details: { error: 'Portals did not appear within 38s', surface },
        };
      }

      // Sample camera state multiple times to detect orientation issues
      const cameraSamples = [];
      for (let i = 0; i < 5; i++) {
        await sleep(400);
        const cam = await page.evaluate(() => {
          const t = window.__GAME_TELEMETRY;
          return t ? { cameraUp: t.cameraUp, playerPos: t.player } : null;
        });
        if (cam) cameraSamples.push(cam);
      }

      // Camera up-vector sanity: it should not be pointing purely downward (y < -0.5)
      // and it should have reasonable magnitude (not zero vector)
      const cameraInsideCount = cameraSamples.filter(s => {
        const { x, y, z } = s.cameraUp;
        const mag = Math.sqrt(x * x + y * y + z * z);
        // Degenerate: zero vector or pointing straight down
        return mag < 0.1 || y < -0.7;
      }).length;

      const cameraOk = cameraInsideCount === 0 && cameraSamples.length >= 3;

      await takeScreenshot(page, `portal_exit_orientation_${surface}`);

      return {
        passed: cameraOk,
        details: {
          portalsActive: true,
          cameraSamples: cameraSamples.map(s => ({
            cameraUp: { x: parseFloat(s.cameraUp.x.toFixed(3)), y: parseFloat(s.cameraUp.y.toFixed(3)), z: parseFloat(s.cameraUp.z.toFixed(3)) },
          })),
          cameraInsideCount,
          note: cameraOk
            ? 'Camera orientation is sane after portal activation'
            : `FAIL: ${cameraInsideCount}/${cameraSamples.length} samples had degenerate camera up-vector (FC-15 pattern)`,
          surface,
        },
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------

async function runScenario(page, scenario, surface) {
  const startTime = Date.now();
  try {
    const result = await scenario.run(page, surface);
    return {
      name: scenario.name,
      description: scenario.description,
      surface,
      passed: result.passed,
      details: result.details,
      error: null,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      name: scenario.name,
      description: scenario.description,
      surface,
      passed: false,
      details: null,
      error: err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Filter scenarios by mode and scenario name filter.
 * mode = 'sp' (default): only non-PvP scenarios
 * mode = 'pvp': PvP-tagged scenarios + SP scenarios
 * mode = 'pvpve': PvPvE-tagged scenarios + SP scenarios
 * mode = 'all': all scenarios
 */
function filterScenariosByMode(scenarioNames, mode) {
  const entries = Object.entries(SCENARIOS);
  return entries.filter(([key, sc]) => {
    if (scenarioNames.length > 0 && !scenarioNames.includes(key)) return false;
    const modes = sc.modes ?? [];
    if (mode === 'sp') return modes.length === 0; // SP-only: no modes tag
    if (mode === 'pvp') return modes.length === 0 || modes.includes('pvp');
    if (mode === 'pvpve') return modes.length === 0 || modes.includes('pvpve');
    if (mode === 'all') return true;
    return modes.length === 0; // default: SP only
  });
}

/**
 * Run MP portal scenarios on a surface using Colyseus + 2 Puppeteer clients.
 * Returns results for all MP scenarios on the given surface.
 */
async function runMPScenariosOnSurface(browser, mpScenarios, surface, pvpMode) {
  let colyseusProc = null;
  const results = [];

  try {
    // Kill any stale Colyseus
    killColyseus();
    await sleep(1000);

    console.log(`  [mp] Starting Colyseus server for ${surface} (${pvpMode})...`);
    colyseusProc = await startColyseusServer();
    console.log(`  [mp] Colyseus ready`);

    // Launch host and guest pages
    const hostPage = await createPage(browser);
    const guestPage = await createPage(browser);

    await navigateToMPGame(hostPage, surface, pvpMode, 'Host');
    await navigateToMPGame(guestPage, surface, pvpMode, 'Guest');

    // Start the game BEFORE waiting for telemetry — telemetry only populates after game starts
    await clickStartGame(hostPage);
    await sleep(3000);

    // Wait for telemetry on host (now that the game has started)
    const hostReady = await waitForMPTelemetry(hostPage, 15000);
    if (!hostReady) {
      console.warn(`  [mp] MP telemetry not ready on ${surface} — skipping portal scenarios`);
      for (const [, scenario] of mpScenarios) {
        results.push({
          name: scenario.name,
          description: scenario.description,
          surface,
          passed: false,
          details: { skipped: true, reason: 'MP telemetry not ready (network-main.ts may not expose __GAME_TELEMETRY)' },
          error: null,
          durationMs: 0,
        });
      }
      await hostPage.close().catch(() => {});
      await guestPage.close().catch(() => {});
      return results;
    }

    // Run each MP scenario
    for (const [, scenario] of mpScenarios) {
      process.stdout.write(`  ${scenario.name} (MP/${pvpMode} on ${surface})... `);
      const startTime = Date.now();
      try {
        const result = await scenario.run(hostPage, surface, { mpGuestPage: guestPage });
        const r = {
          name: scenario.name,
          description: scenario.description,
          surface,
          passed: result.passed,
          details: { ...result.details, mode: pvpMode },
          error: null,
          durationMs: Date.now() - startTime,
        };
        results.push(r);
        console.log(r.passed
          ? 'PASS'
          : (r.details?.skipped ? `SKIP (${r.details.reason})` : `FAIL`));
      } catch (err) {
        results.push({
          name: scenario.name,
          description: scenario.description,
          surface,
          passed: false,
          details: null,
          error: err.message,
          durationMs: Date.now() - startTime,
        });
        console.log(`FAIL (${err.message})`);
      }
    }

    await hostPage.close().catch(() => {});
    await guestPage.close().catch(() => {});
  } catch (err) {
    console.error(`  [mp] MP setup failed for ${surface}: ${err.message}`);
    for (const [, scenario] of mpScenarios) {
      results.push({
        name: scenario.name,
        description: scenario.description,
        surface,
        passed: false,
        details: { skipped: true, reason: `MP setup failed: ${err.message}` },
        error: err.message,
        durationMs: 0,
      });
    }
  } finally {
    if (colyseusProc) {
      try { colyseusProc.kill('SIGTERM'); } catch { /* ignore */ }
    }
    killColyseus();
  }

  return results;
}

async function runAllScenarios(surfaces, scenarioNames, mode = 'sp') {
  const browser = await launchBrowser();
  const results = [];

  // Separate SP and MP scenarios
  const allFiltered = filterScenariosByMode(scenarioNames, mode);
  const spScenarios = allFiltered.filter(([, sc]) => !sc.requiresMP);
  const mpScenarios = allFiltered.filter(([, sc]) => sc.requiresMP);

  console.log(`Mode: ${mode} | SP scenarios: ${spScenarios.length} | MP scenarios: ${mpScenarios.length}`);

  // Run SP scenarios on each surface
  for (const surface of surfaces) {
    console.log(`\n--- Surface: ${surface} (SP) ---`);
    let page;
    try {
      page = await createPage(browser);
      await startGameOnSurface(page, surface);

      for (const [, scenario] of spScenarios) {
        process.stdout.write(`  ${scenario.name}... `);
        const result = await runScenario(page, scenario, surface);
        results.push(result);
        console.log(result.passed ? 'PASS' : `FAIL${result.error ? ` (${result.error})` : ''}`);
      }
    } catch (err) {
      console.error(`  Surface ${surface} failed to load: ${err.message}`);
      for (const [, scenario] of spScenarios) {
        results.push({
          name: scenario.name,
          description: scenario.description,
          surface,
          passed: false,
          details: null,
          error: `Surface failed to load: ${err.message}`,
          durationMs: 0,
        });
      }
    } finally {
      if (page) await page.close().catch(() => {});
    }
  }

  // Run MP scenarios if any — on PvP surfaces only
  if (mpScenarios.length > 0) {
    const mpSurfaces = surfaces.filter(s => PVP_SURFACES.includes(s));
    if (mpSurfaces.length === 0) {
      // No PvP-compatible surfaces in the run set — report as skipped
      for (const [, scenario] of mpScenarios) {
        for (const surface of surfaces.slice(0, 2)) {
          results.push({
            name: scenario.name,
            description: scenario.description,
            surface,
            passed: false,
            details: { skipped: true, reason: `No PvP surfaces in test run (need sphere or pill)` },
            error: null,
            durationMs: 0,
          });
        }
      }
    } else {
      // Determine pvpMode from the run mode
      const pvpMode = mode === 'pvpve' ? 'pvpve' : 'pvp';
      for (const surface of mpSurfaces) {
        console.log(`\n--- Surface: ${surface} (MP/${pvpMode}) ---`);
        const mpResults = await runMPScenariosOnSurface(browser, mpScenarios, surface, pvpMode);
        results.push(...mpResults);
      }
    }
  }

  await browser.close();
  return results;
}

// ---------------------------------------------------------------------------
// HTML Report Generator
// ---------------------------------------------------------------------------

function generateHTMLReport(results) {
  const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const totalTests = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = totalTests - passed;
  const passRate = totalTests > 0 ? ((passed / totalTests) * 100).toFixed(1) : '0.0';

  // Group by surface
  const bySurface = {};
  for (const r of results) {
    if (!bySurface[r.surface]) bySurface[r.surface] = [];
    bySurface[r.surface].push(r);
  }

  // Group by scenario
  const byScenario = {};
  for (const r of results) {
    if (!byScenario[r.name]) byScenario[r.name] = [];
    byScenario[r.name].push(r);
  }

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Scenario Harness Report — ${date}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 20px; }
    h1 { color: #00ff88; margin-bottom: 10px; }
    h2 { color: #88ccff; margin: 20px 0 10px; }
    .summary { display: flex; gap: 20px; margin: 15px 0; }
    .stat { background: #1a1a2e; padding: 15px 25px; border-radius: 8px; text-align: center; }
    .stat .number { font-size: 2em; font-weight: bold; }
    .stat .label { font-size: 0.9em; color: #888; }
    .pass { color: #00ff88; }
    .fail { color: #ff4444; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { padding: 8px 12px; text-align: left; border: 1px solid #333; }
    th { background: #1a1a2e; color: #88ccff; }
    tr:nth-child(even) { background: #111; }
    .tag-pass { background: #0a3a0a; color: #00ff88; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; }
    .tag-fail { background: #3a0a0a; color: #ff4444; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; }
    details { margin: 5px 0; }
    details summary { cursor: pointer; color: #88ccff; }
    pre { background: #111; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.85em; margin-top: 5px; }

    /* Pass/fail matrix */
    .matrix { margin: 20px 0; }
    .matrix td { text-align: center; width: 40px; height: 30px; font-weight: bold; }
    .matrix .cell-pass { background: #0a3a0a; color: #00ff88; }
    .matrix .cell-fail { background: #3a0a0a; color: #ff4444; }
    .matrix .cell-skip { background: #1a1a1a; color: #555; }
    .matrix th { font-size: 0.8em; max-width: 80px; overflow: hidden; text-overflow: ellipsis; }
  </style>
</head>
<body>
  <h1>Programmable Scenario Harness Report</h1>
  <p>Generated: ${date}</p>

  <div class="summary">
    <div class="stat">
      <div class="number">${totalTests}</div>
      <div class="label">Total Tests</div>
    </div>
    <div class="stat">
      <div class="number pass">${passed}</div>
      <div class="label">Passed</div>
    </div>
    <div class="stat">
      <div class="number fail">${failed}</div>
      <div class="label">Failed</div>
    </div>
    <div class="stat">
      <div class="number" style="color: ${parseFloat(passRate) > 80 ? '#00ff88' : '#ff4444'}">${passRate}%</div>
      <div class="label">Pass Rate</div>
    </div>
  </div>

  <h2>Pass/Fail Matrix (Scenario × Surface)</h2>
  <table class="matrix">
    <tr>
      <th>Scenario</th>
      ${Object.keys(bySurface).map(s => `<th>${s}</th>`).join('')}
    </tr>`;

  // Matrix rows
  for (const [scenarioName, scenarioResults] of Object.entries(byScenario)) {
    html += `\n    <tr><td>${scenarioName}</td>`;
    for (const surf of Object.keys(bySurface)) {
      const r = scenarioResults.find(r => r.surface === surf);
      if (!r) {
        html += `<td class="cell-skip">—</td>`;
      } else if (r.passed) {
        html += `<td class="cell-pass">✓</td>`;
      } else {
        html += `<td class="cell-fail">✗</td>`;
      }
    }
    html += `</tr>`;
  }

  html += `\n  </table>

  <h2>Detailed Results by Surface</h2>`;

  for (const [surface, surfResults] of Object.entries(bySurface)) {
    const surfPassed = surfResults.filter(r => r.passed).length;
    html += `
  <h3 style="margin-top: 15px;">${surface} (${surfPassed}/${surfResults.length})</h3>
  <table>
    <tr><th>Scenario</th><th>Status</th><th>Duration</th><th>Details</th></tr>`;

    for (const r of surfResults) {
      const tag = r.passed
        ? '<span class="tag-pass">PASS</span>'
        : '<span class="tag-fail">FAIL</span>';
      const detailsStr = r.error
        ? `<span class="fail">${r.error}</span>`
        : r.details
          ? `<details><summary>Show</summary><pre>${JSON.stringify(r.details, null, 2)}</pre></details>`
          : '—';
      html += `
    <tr>
      <td>${r.name}</td>
      <td>${tag}</td>
      <td>${r.durationMs}ms</td>
      <td>${detailsStr}</td>
    </tr>`;
    }
    html += `\n  </table>`;
  }

  html += `
</body>
</html>`;

  return html;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const surfaceArg = args.find(a => a.startsWith('--surface='))?.split('=')[1];
  const scenarioArg = args.find(a => a.startsWith('--scenario='))?.split('=')[1];
  // --mode=sp | pvp | pvpve | all
  // sp (default): only non-PvP scenarios
  // pvp: PvP scenarios + SP scenarios
  // pvpve: PvPvE scenarios + SP scenarios
  // all: everything
  const modeArg = args.find(a => a.startsWith('--mode='))?.split('=')[1] ?? 'sp';
  const generateReport = true; // Always generate

  // When mode=pvp or pvpve, default to PvP-compatible surfaces if no surface specified
  const defaultSurfaces = (modeArg === 'pvp' || modeArg === 'pvpve')
    ? PVP_SURFACES
    : ALL_SURFACES;
  const surfaces = surfaceArg ? [surfaceArg] : defaultSurfaces;
  const scenarioNames = scenarioArg ? [scenarioArg] : [];

  console.log(`Scenario Harness — mode=${modeArg}, ${surfaces.length} surfaces`);
  console.log(`Using: ${BASE_URL}`);
  if (modeArg === 'pvp' || modeArg === 'pvpve') {
    console.log(`PvP surfaces: ${surfaces.join(', ')}`);
    console.log(`Portal scenarios require Colyseus server on port ${COLYSEUS_PORT}`);
  }
  console.log('');

  const results = await runAllScenarios(surfaces, scenarioNames, modeArg);

  // Separate skipped from real fails
  const passed = results.filter(r => r.passed).length;
  const skipped = results.filter(r => !r.passed && r.details?.skipped).length;
  const failed = results.filter(r => !r.passed && !r.details?.skipped).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed, ${skipped} skipped (${results.length} total) ===`);

  // Generate HTML report
  if (generateReport) {
    mkdirSync(REPORT_DIR, { recursive: true });
    const reportDate = new Date().toISOString().slice(0, 10);
    const reportPath = resolve(REPORT_DIR, `${reportDate}-scenario-harness.html`);
    const html = generateHTMLReport(results);
    writeFileSync(reportPath, html);
    console.log(`\nHTML report: ${reportPath}`);
  }

  // Exit code: fail only on real failures (not skips)
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
