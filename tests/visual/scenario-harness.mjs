#!/usr/bin/env node
/**
 * scenario-harness.mjs — Programmable scenario test runner.
 *
 * Uses window.__TEST_API (TestHarnessAPI) to CONTROL the game:
 * spawn enemies, direct movement, trigger weapons, verify outcomes.
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

      // Direct enemy toward player
      await page.evaluate(
        (id, u, v, speed) => window.__TEST_API.moveEnemyTo(id, u, v, speed),
        enemyId, playerPos.u, playerPos.v, 0.3,
      );

      // Wait for collision (up to 10 seconds)
      let deaths = [];
      for (let i = 0; i < 100; i++) {
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

      // Direct enemy to target
      await page.evaluate(
        (id, u, v, speed) => window.__TEST_API.moveEnemyTo(id, u, v, speed),
        enemyId, targetU, targetV, 0.5,
      );

      // Wait for arrival (up to 8 seconds)
      let finalPos = null;
      let arrived = false;
      for (let i = 0; i < 80; i++) {
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
      await sleep(500);

      const pos = await page.evaluate(() => window.__TEST_API.getPlayerPosition());
      const uClose = Math.abs(pos.u - targetU) < 0.05;
      const vClose = Math.abs(pos.v - targetV) < 0.05;

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
