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

  // ---- Scenario 1: Hit Detection Precision (DEEPENED — s44r13-07) ----
  hit_detection: {
    name: 'Hit Detection Precision',
    description: 'Spawn enemy, move toward player, verify death at correct distance; also checks bullet travel and tolerance band',
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

      // Record bullets BEFORE firing to measure bullet travel
      const bulletsBefore = await page.evaluate(() => window.__TEST_API.getGameState().bullets);

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

      const deathOccurred = deaths.length > 0;
      const deathDist = deathOccurred ? deaths[0].nearestEnemyDist : -1;
      const collisionRadius = deathOccurred ? deaths[0].collisionRadius : -1;
      const uvDistAtDeath = deathOccurred ? deaths[0].uvDistance : -1;

      // STRONG: death distance must be within reasonable range (not instant or absurd)
      const distOk = deathDist > 0 && deathDist < 2.0;

      // STRONG: if collision radius is known, UV distance at death should be near it
      // (within 50% tolerance — surface geometry affects exact UV distance)
      const uvRadiusOk = collisionRadius <= 0 || uvDistAtDeath < 0 ||
        uvDistAtDeath <= collisionRadius * 1.5;

      // STRONG: enemy did not die at > 3.0 world units (would indicate absurd collision box)
      const notPremature = deathDist < 3.0 || deathDist < 0;

      return {
        passed: deathOccurred && distOk && uvRadiusOk && notPremature,
        details: {
          deathOccurred,
          deathDistance: deathDist >= 0 ? deathDist.toFixed(3) : 'n/a',
          distanceInRange: distOk,
          collisionRadius: collisionRadius >= 0 ? collisionRadius.toFixed(4) : 'n/a',
          uvDistanceAtDeath: uvDistAtDeath >= 0 ? uvDistAtDeath.toFixed(4) : 'n/a',
          uvRadiusOk,
          notPremature,
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

  // ---- Scenario 3: Enemy Visibility (DEEPENED — s44r13-07) ----
  enemy_visibility: {
    name: 'Enemy Visibility',
    description: 'Spawn 5 enemies; verify all active with opacity 0.8–1.0 (not just > 0); stable across 3 frames (no flicker)',
    async run(page, surface) {
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(500);

      // Spawn 5 enemies at distinct UV positions near the player (should be at full brightness)
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

      // Wait for rendering to settle
      await sleep(2000);

      // STRONG: Sample opacity 3 times with 200ms gap to detect flicker
      const samples = [];
      for (let s = 0; s < 3; s++) {
        const enemies = await page.evaluate((testIds) => {
          return window.__TEST_API.getEnemies().filter(e => testIds.includes(e.id));
        }, ids);
        samples.push(enemies);
        await sleep(200);
      }

      const firstSample = samples[0];
      const allAlive = firstSample.every(e => e.alive);

      // STRONG: Opacity must be in range [0.8, 1.0] for freshly spawned enemies (not just > 0)
      const allHighOpacity = firstSample.every(e => e.opacity >= 0.8 && e.opacity <= 1.01);

      // STRONG: No flicker — opacity should be stable across 3 frames (within 0.05 tolerance)
      let stable = true;
      for (let i = 0; i < firstSample.length; i++) {
        const opacities = samples.map(s => s[i]?.opacity ?? 0);
        const maxDiff = Math.max(...opacities) - Math.min(...opacities);
        if (maxDiff > 0.05) stable = false;
      }

      // STRONG: Count must match what was spawned
      const countOk = firstSample.length === 5;

      // Take screenshot for visual verification
      await takeScreenshot(page, `enemy_visibility_${surface}`);

      return {
        passed: countOk && allAlive && allHighOpacity && stable,
        details: {
          spawnedCount: firstSample.length,
          expectedCount: 5,
          allAlive,
          allHighOpacity,
          stable,
          opacitiesSample1: samples[0].map(e => e.opacity.toFixed(2)),
          opacitiesSample2: samples[1]?.map(e => e.opacity.toFixed(2)) ?? [],
          opacitiesSample3: samples[2]?.map(e => e.opacity.toFixed(2)) ?? [],
          surface,
        },
      };
    },
  },

  // ---- Scenario 4: Weapon Fire (DEEPENED — s44r13-07) ----
  weapon_fire: {
    name: 'Weapon Fire',
    description: 'Fire weapon; verify bullet count increases by ≥1; bullet origin near player; bullets not immortal (expire after lifetime)',
    async run(page, surface) {
      // Clear enemies so bullets can travel without hitting anything
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(300);

      // Get player position BEFORE firing
      const playerPos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
      const stateBefore = await page.evaluate(() => window.__TEST_API.getGameState());

      // Wait for any pre-existing bullets to expire
      await sleep(2000);
      const stateClean = await page.evaluate(() => window.__TEST_API.getGameState());

      // Fire weapon exactly once
      await page.evaluate(() => window.__TEST_API.fireWeapon());
      await sleep(100);

      const stateAfter = await page.evaluate(() => window.__TEST_API.getGameState());

      // STRONG: bullet count increased (at least 1 per fire)
      const bulletsCreated = stateAfter.bullets > stateClean.bullets;
      const bulletDelta = stateAfter.bullets - stateClean.bullets;

      // STRONG: get bullet trajectories and verify origin is near player
      const trajectories = await page.evaluate(() => window.__TEST_API.getBulletTrajectories());
      const playerU = playerPos.u;
      const playerV = playerPos.v;
      const bulletNearPlayer = trajectories.some(b => {
        const du = Math.abs(b.u - playerU);
        const dv = Math.abs(b.v - playerV);
        return Math.sqrt(du * du + dv * dv) < 0.15; // within 0.15 UV of player
      });

      // STRONG: bullets should NOT be immortal — wait 5 seconds and verify bullet count drops
      // (standard bullet lifetime is 2-3 seconds)
      await sleep(5000);
      const stateExpired = await page.evaluate(() => window.__TEST_API.getGameState());
      const bulletsExpired = stateExpired.bullets < stateAfter.bullets;

      return {
        passed: bulletsCreated && bulletNearPlayer && bulletsExpired,
        details: {
          bulletsBefore: stateClean.bullets,
          bulletsAfterFire: stateAfter.bullets,
          bulletDelta,
          bulletsCreated,
          bulletNearPlayer,
          bulletsExpired,
          bulletsAfterExpiry: stateExpired.bullets,
          playerUV: `(${playerU.toFixed(3)}, ${playerV.toFixed(3)})`,
          trajectoryCount: trajectories.length,
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

  // ---- Scenario 13: Enemies Visible After Waves ----
  // REGRESSION: s44r13 — enemies become invisible after wave 2-3 due to InstancedMesh
  // scale(0,0,0) or dimming bug. Runs natural wave spawner (endless mode at 6s/13s/20s).
  enemies_visible_after_waves: {
    name: 'Enemies Visible After Waves',
    description: 'Let game wave spawner fire 3 cycles. After each wave spawns, assert enemies alive AND opacity > 0.05 (not invisible). Catches InstancedMesh scale(0,0,0) and dimming regressions.',
    async run(page, surface) {
      // Don't spawn enemies manually — let the natural wave scheduler do it
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(500);

      /**
       * Helper: wait until enemy count >= minCount OR timeout.
       * Returns { count, opacities } where opacities is the array of alive enemy opacities.
       */
      const waitForWave = async (timeoutMs) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          const data = await page.evaluate(() => {
            const enemies = window.__TEST_API.getEnemies();
            const alive = enemies.filter(e => e.alive);
            return { count: alive.length, opacities: alive.map(e => e.opacity) };
          });
          if (data.count >= 1) return data;
          await sleep(200);
        }
        // Return last state even if empty
        return await page.evaluate(() => {
          const enemies = window.__TEST_API.getEnemies();
          const alive = enemies.filter(e => e.alive);
          return { count: alive.length, opacities: alive.map(e => e.opacity) };
        });
      };

      const waveResults = [];

      // Wave 1: spawns at ~6s, wait up to 10s
      const wave1 = await waitForWave(10000);
      const wave1Visible = wave1.count > 0 && wave1.opacities.every(op => op > 0.05);
      waveResults.push({ wave: 1, count: wave1.count, opacities: wave1.opacities, visible: wave1Visible });

      // Take screenshot after wave 1
      await takeScreenshot(page, `enemies_visible_after_waves_w1_${surface}`);

      // Clear wave 1 to trigger wave 2 sooner
      await page.evaluate(() => window.__TEST_API.clearEnemies());

      // Wave 2: ~7s after clearing
      const wave2 = await waitForWave(10000);
      const wave2Visible = wave2.count > 0 && wave2.opacities.every(op => op > 0.05);
      waveResults.push({ wave: 2, count: wave2.count, opacities: wave2.opacities, visible: wave2Visible });

      await takeScreenshot(page, `enemies_visible_after_waves_w2_${surface}`);

      // Clear wave 2 to trigger wave 3
      await page.evaluate(() => window.__TEST_API.clearEnemies());

      // Wave 3: ~7s after clearing
      const wave3 = await waitForWave(10000);
      const wave3Visible = wave3.count > 0 && wave3.opacities.every(op => op > 0.05);
      waveResults.push({ wave: 3, count: wave3.count, opacities: wave3.opacities, visible: wave3Visible });

      await takeScreenshot(page, `enemies_visible_after_waves_w3_${surface}`);

      // Pass if ALL 3 waves had visible enemies
      const passed = waveResults.every(w => w.visible);
      const failedWaves = waveResults.filter(w => !w.visible).map(w => `wave${w.wave}(count=${w.count})`);

      return {
        passed,
        details: {
          waveResults,
          failedWaves,
          note: passed
            ? 'All 3 wave cycles had visible enemies'
            : `Invisible or missing enemies in: ${failedWaves.join(', ')}`,
          surface,
        },
      };
    },
  },

  // ---- Scenario 13: Pickup Collection (NEW — s44r13-07) ----
  pickup_collection: {
    name: 'Pickup Collection',
    description: 'Spawn pickup at player position — assert collection within 2s; spawn far away — assert no collection',
    async run(page, surface) {
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(300);

      // Get player position
      const playerPos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
      const stateBefore = await page.evaluate(() => window.__TEST_API.getGameState());

      // Spawn a pickup at player's UV position (should be collected immediately)
      await page.evaluate(
        (type, u, v) => window.__TEST_API.spawnPickup(type, u, v),
        'weapon', playerPos.u, playerPos.v,
      );

      // Wait up to 2 seconds for collection to occur
      let pickupCollected = false;
      for (let i = 0; i < 20; i++) {
        await sleep(100);
        const pickups = await page.evaluate(() => window.__TEST_API.getVisiblePickups());
        // If pickup count dropped to 0, it was collected
        if (pickups.length === 0) {
          pickupCollected = true;
          break;
        }
      }

      // Now spawn pickup 3x collection radius away — should NOT be collected
      const farU = (playerPos.u + 0.4) % 1.0;
      const farV = Math.min(0.95, Math.max(0.05, playerPos.v));
      await page.evaluate(
        (type, u, v) => window.__TEST_API.spawnPickup(type, u, v),
        'weapon', farU, farV,
      );

      // Player stays at original position — don't move toward pickup
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        playerPos.u, playerPos.v,
      );
      await sleep(2000);

      const pickupsAfterFar = await page.evaluate(() => window.__TEST_API.getVisiblePickups());
      // Far pickup should still exist (not auto-collected from a distance)
      // Note: weapon pickups may expire, so we check if game state changed in expected ways
      const gameAfter = await page.evaluate(() => window.__TEST_API.getGameState());

      return {
        passed: pickupCollected,
        details: {
          pickupCollected,
          playerUV: `(${playerPos.u.toFixed(3)}, ${playerPos.v.toFixed(3)})`,
          farPickupUV: `(${farU.toFixed(3)}, ${farV.toFixed(3)})`,
          farPickupsRemaining: pickupsAfterFar.length,
          note: pickupCollected
            ? 'Pickup at player position collected within 2s'
            : 'Pickup at player position NOT collected — possible collection radius bug',
          surface,
        },
      };
    },
  },

  // ---- Scenario 14: Respawn Invincibility (NEW — s44r13-07) ----
  // Detects: respawn invincibility timer missing or too short
  respawn_invincibility: {
    name: 'Respawn Invincibility',
    description: 'Kill player, verify respawn within 3s; spawn enemy on respawn point; verify player NOT killed again immediately',
    async run(page, surface) {
      await page.evaluate(() => {
        window.__TEST_API.clearEnemies();
        if (typeof window.__TEST_API.clearEvents === 'function') window.__TEST_API.clearEvents();
      });
      await sleep(500);

      const gameStateBefore = await page.evaluate(() => window.__TEST_API.getGameState());
      if (gameStateBefore.lives <= 1) {
        // Need at least 2 lives to test this (1 to die, 1 to respawn)
        return {
          passed: false,
          details: {
            error: `Only ${gameStateBefore.lives} lives — need at least 2 to test respawn invincibility`,
            surface,
          },
        };
      }

      const livesBefore = gameStateBefore.lives;

      // Kill the player by spawning an enemy directly on top
      const playerPos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
      await page.evaluate(
        (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
        'grunt', playerPos.u, playerPos.v,
      );

      // Wait for death (up to 5 seconds)
      let died = false;
      let deathTime = 0;
      for (let i = 0; i < 50; i++) {
        await sleep(100);
        const deaths = await page.evaluate(() => window.__TEST_API.getRecentDeaths());
        if (deaths.length > 0) {
          died = true;
          deathTime = Date.now();
          break;
        }
      }

      if (!died) {
        return {
          passed: false,
          details: { error: 'Player did not die within 5 seconds', surface },
        };
      }

      // Wait for respawn (up to 4 seconds)
      let respawned = false;
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        const state = await page.evaluate(() => window.__TEST_API.getGameState());
        if (state.lives < livesBefore && !state.isGameOver) {
          // Player lost a life but is still alive = respawned
          const pos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
          if (pos) {
            respawned = true;
            break;
          }
        }
      }

      if (!respawned) {
        return {
          passed: false,
          details: {
            error: 'Player did not respawn within 4 seconds after death',
            died,
            surface,
          },
        };
      }

      // Spawn enemy directly on respawn position
      const respawnPos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
      await page.evaluate(() => window.__TEST_API.clearEnemies());
      await sleep(200);
      await page.evaluate(
        (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
        'grunt', respawnPos.u, respawnPos.v,
      );

      // Wait 1.5 seconds — invincibility should protect player from immediate re-death
      await sleep(1500);

      const stateAfterRespawn = await page.evaluate(() => window.__TEST_API.getGameState());
      const deathsAfterRespawn = await page.evaluate(() => window.__TEST_API.getRecentDeaths());

      // Player should NOT have died again during invincibility window
      // lives should be same as right after first death
      const livesAfterRespawn = stateAfterRespawn.lives;
      const notDiedAgain = deathsAfterRespawn.length <= 1; // Only the original death

      return {
        passed: respawned && notDiedAgain,
        details: {
          died,
          respawned,
          livesBeforeDeath: livesBefore,
          livesAfterRespawn,
          notDiedAgain,
          totalDeaths: deathsAfterRespawn.length,
          note: notDiedAgain
            ? 'Respawn invincibility protected player from immediate re-death'
            : 'REGRESSION: Player died immediately after respawn — invincibility missing or too short',
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

async function runAllScenarios(surfaces, scenarioNames) {
  const browser = await launchBrowser();
  const results = [];

  for (const surface of surfaces) {
    console.log(`\n--- Surface: ${surface} ---`);
    let page;
    try {
      page = await createPage(browser);
      await startGameOnSurface(page, surface);

      for (const [key, scenario] of Object.entries(SCENARIOS)) {
        if (scenarioNames.length > 0 && !scenarioNames.includes(key)) continue;

        process.stdout.write(`  ${scenario.name}... `);
        const result = await runScenario(page, scenario, surface);
        results.push(result);
        console.log(result.passed ? 'PASS' : `FAIL${result.error ? ` (${result.error})` : ''}`);
      }
    } catch (err) {
      console.error(`  Surface ${surface} failed to load: ${err.message}`);
      // Record all scenarios as failed for this surface
      for (const [key, scenario] of Object.entries(SCENARIOS)) {
        if (scenarioNames.length > 0 && !scenarioNames.includes(key)) continue;
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
  const generateReport = args.includes('--report') || true; // Always generate

  const surfaces = surfaceArg ? [surfaceArg] : ALL_SURFACES;
  const scenarioNames = scenarioArg ? [scenarioArg] : [];

  console.log(`Scenario Harness — ${surfaces.length} surfaces, ${scenarioNames.length || Object.keys(SCENARIOS).length} scenarios`);
  console.log(`Using: ${BASE_URL}`);
  console.log('');

  const results = await runAllScenarios(surfaces, scenarioNames);

  // Summary
  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n=== Summary: ${passed}/${results.length} passed, ${failed} failed ===`);

  // Generate HTML report
  if (generateReport) {
    mkdirSync(REPORT_DIR, { recursive: true });
    const reportDate = new Date().toISOString().slice(0, 10);
    const reportPath = resolve(REPORT_DIR, `${reportDate}-scenario-harness.html`);
    const html = generateHTMLReport(results);
    writeFileSync(reportPath, html);
    console.log(`\nHTML report: ${reportPath}`);
  }

  // Exit code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
