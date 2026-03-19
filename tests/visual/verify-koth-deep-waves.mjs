#!/usr/bin/env node
/**
 * verify-koth-deep-waves.mjs — KotH deep-wave enemy visibility test.
 *
 * Proves/disproves invisible enemy bug on SP KotH torus at wave 3+.
 * Uses programmatic player dodge logic (setPlayerPosition) to survive.
 * Checks instanceColorBrightness (ICB) for all alive non-materializing enemies.
 * Also reports stuck-materializing enemies (isMaterializing=true + alive) — these
 * are the RC14 bug signature: enemies permanently stuck in spawn warning state.
 *
 * Usage:
 *   node tests/visual/verify-koth-deep-waves.mjs
 *   node tests/visual/verify-koth-deep-waves.mjs --surface=torus --target-wave=5
 *   node tests/visual/verify-koth-deep-waves.mjs --no-dodge    # disable player dodge
 *   node tests/visual/verify-koth-deep-waves.mjs --port=3034   # custom port
 *
 * Exit codes:
 *   0 = PASS (all enemies visible, no stuck-materializing)
 *   1 = FAIL (invisible enemies detected or stuck materializing)
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '3032';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SCREENSHOT_DIR = resolve(__dirname, '../../test-screenshots/koth-deep-waves');
const REPORTS_DIR = resolve(__dirname, '../../reports');

const CHROME_PATH = process.env.CHROME_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const LAUNCH_ARGS = [
  '--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', '--window-size=800,600',
];

const ICB_THRESHOLD = 0.10;       // below this = invisible bug
const MATRIX_SCALE_MIN = 0.001;   // below this = zero-scale invisible
const TARGET_WAVE = parseInt(process.argv.find(a => a.startsWith('--target-wave='))?.split('=')[1] || '3');
const SURFACE = process.argv.find(a => a.startsWith('--surface='))?.split('=')[1] || 'torus';
const NO_DODGE = process.argv.includes('--no-dodge');

mkdirSync(SCREENSHOT_DIR, { recursive: true });
mkdirSync(REPORTS_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// In-browser dodge logic: called from Node via page.evaluate every 200ms
// ---------------------------------------------------------------------------
async function dodgeEnemies(page) {
  return page.evaluate(() => {
    if (!window.__TEST_API) return null;
    const api = window.__TEST_API;
    const playerPos = api.getPlayerPosition();
    if (!playerPos) return null;
    const enemies = api.getEnemies().filter(e => e.alive && !e.isMaterializing);
    if (enemies.length === 0) return { moved: false };

    let repelU = 0, repelV = 0;
    const DODGE_RADIUS = 0.15;
    let count = 0;

    for (const enemy of enemies) {
      const du = playerPos.u - enemy.u;
      const dv = playerPos.v - enemy.v;
      // Wrap UV distance (torus wraps in both U and V)
      const wdu = Math.abs(du) > 0.5 ? du - Math.sign(du) : du;
      const wdv = Math.abs(dv) > 0.5 ? dv - Math.sign(dv) : dv;
      const dist = Math.sqrt(wdu * wdu + wdv * wdv);
      if (dist < DODGE_RADIUS && dist > 0.001) {
        const w = (DODGE_RADIUS - dist) / DODGE_RADIUS;
        repelU += (wdu / dist) * w;
        repelV += (wdv / dist) * w;
        count++;
      }
    }

    if (count === 0) return { moved: false };

    const len = Math.sqrt(repelU * repelU + repelV * repelV);
    if (len > 0.001) {
      const MOVE_SPEED = 0.05;
      const newU = Math.max(0.02, Math.min(0.98, playerPos.u + (repelU / len) * MOVE_SPEED));
      const newV = Math.max(0.02, Math.min(0.98, playerPos.v + (repelV / len) * MOVE_SPEED));
      api.setPlayerPosition(newU, newV);
      return { moved: true, newU, newV };
    }
    return { moved: false };
  });
}

// ---------------------------------------------------------------------------
// Snapshot enemy visibility state
// ---------------------------------------------------------------------------
async function checkEnemyVisibility(page, label) {
  const state = await page.evaluate((icbThreshold, matScaleMin) => {
    const api = window.__TEST_API;
    if (!api) return null;
    const enemies = api.getEnemies();
    const player = api.getPlayerPosition();
    const wave = typeof api.getWave === 'function' ? api.getWave() : -1;
    const gameState = api.getGameState();

    const alive = enemies.filter(e => e.alive);
    const notMaterializing = alive.filter(e => !e.isMaterializing);
    const stuckMaterializing = alive.filter(e => e.isMaterializing);
    const invisible = notMaterializing.filter(e => e.instanceColorBrightness < icbThreshold);
    const zeroScale = notMaterializing.filter(e => (e.instanceMatrixScale || 0) < matScaleMin);

    return {
      wave,
      gameTime: gameState?.gameTime,
      isGameOver: gameState?.isGameOver,
      totalEnemies: enemies.length,
      aliveCount: alive.length,
      notMaterializingCount: notMaterializing.length,
      stuckMaterializingCount: stuckMaterializing.length,
      invisibleCount: invisible.length,
      zeroScaleCount: zeroScale.length,
      minICB: notMaterializing.length ? Math.min(...notMaterializing.map(e => e.instanceColorBrightness)) : 1.0,
      avgICB: notMaterializing.length
        ? notMaterializing.reduce((s, e) => s + e.instanceColorBrightness, 0) / notMaterializing.length
        : 1.0,
      playerU: player?.u,
      playerV: player?.v,
      invisibleSample: invisible.slice(0, 5).map(e => ({
        type: e.type,
        u: e.u.toFixed(3),
        v: e.v.toFixed(3),
        icb: e.instanceColorBrightness.toFixed(4),
        batch: e.renderBatch,
      })),
      stuckSample: stuckMaterializing.slice(0, 5).map(e => ({
        type: e.type,
        u: e.u.toFixed(3),
        v: e.v.toFixed(3),
      })),
    };
  }, ICB_THRESHOLD, MATRIX_SCALE_MIN);

  if (!state) return { passed: false, error: 'No TEST_API', label };

  const screenshotPath = resolve(SCREENSHOT_DIR, `${label}.png`);
  await page.screenshot({ path: screenshotPath });

  // PASS = no invisible, no stuck-materializing, at least 1 alive enemy
  const passed = state.invisibleCount === 0
    && state.stuckMaterializingCount === 0
    && state.aliveCount > 0;

  return { ...state, passed, label, screenshotPath };
}

// ---------------------------------------------------------------------------
// Wait for wave N with dodge loop
// ---------------------------------------------------------------------------
async function waitForWave(page, targetWave, maxMs, label) {
  const startTime = Date.now();
  let currentWave = 0;
  let dodgeTimer = null;

  if (!NO_DODGE) {
    dodgeTimer = setInterval(async () => {
      try { await dodgeEnemies(page); } catch {}
    }, 250);
  }

  while (Date.now() - startTime < maxMs) {
    await sleep(500);

    const info = await page.evaluate(() => {
      const api = window.__TEST_API;
      if (!api) return null;
      const wave = typeof api.getWave === 'function' ? api.getWave() : -1;
      const gs = api.getGameState();
      return { wave, isGameOver: gs?.isGameOver, lives: gs?.lives, gameTime: gs?.gameTime };
    });

    if (!info) break;

    currentWave = info.wave >= 0 ? info.wave : Math.floor((info.gameTime || 0) / 15) + 1;
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stdout.write(`\r  ${label}: wave=${currentWave}, t=${elapsed}s, lives=${info.lives ?? '?'}, over=${info.isGameOver}    `);

    if (info.isGameOver) {
      process.stdout.write('\n  [GAME OVER — player died despite dodge]\n');
      break;
    }

    if (currentWave >= targetWave) break;
  }

  if (dodgeTimer) clearInterval(dodgeTimer);
  process.stdout.write('\n');
  return currentWave;
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------
async function runTest() {
  console.log(`\n=== KotH Deep Wave Visibility Test ===`);
  console.log(`  Surface: ${SURFACE}, target wave: ${TARGET_WAVE}, dodge: ${!NO_DODGE}`);
  console.log(`  URL: ${BASE_URL}`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
    timeout: 30000,
  });

  const results = [];
  let passed = false;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    // Clear mastery overlay that would block quickStart
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => {
      try { localStorage.removeItem('masteryOverlayShown'); } catch {}
      try { localStorage.removeItem('weaponMastery'); } catch {}
    });

    // Launch KotH mode (SP only — gameMode=king is the correct param from main.ts:2384)
    const url = `${BASE_URL}?quickStart=true&surface=${SURFACE}&gameMode=king&testMode=true&debug=true`;
    console.log(`\nLaunching: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });
    await sleep(3000);

    // Verify TestHarnessAPI is active
    const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (!apiReady) {
      throw new Error('__TEST_API not found — is testMode=true working?');
    }

    const hasGetWave = await page.evaluate(() => typeof window.__TEST_API.getWave === 'function');
    console.log(`  getWave() available: ${hasGetWave}`);

    // --- CHECK at wave 1 (baseline) ---
    console.log(`\nBaseline check (wave 1)...`);
    const baselineWave = await waitForWave(page, 1, 30000, 'baseline');
    // Wait 2s for spawn warnings to complete (SPAWN_WARNING_DURATION=0.8s + buffer)
    await sleep(2000);
    const r0 = await checkEnemyVisibility(page, `koth-${SURFACE}-wave${baselineWave}-baseline`);
    results.push(r0);
    printResult(r0);

    // --- WAIT for target wave ---
    console.log(`\nWaiting for wave ${TARGET_WAVE}+...`);
    const reachedWave = await waitForWave(page, TARGET_WAVE, 120000, 'to-wave');

    // --- CHECK at target wave (front view) ---
    // Wait 2s for spawn warnings to complete (SPAWN_WARNING_DURATION=0.8s + buffer)
    await sleep(2000);
    console.log(`\nReached wave ${reachedWave}. Checking front view...`);
    const r1 = await checkEnemyVisibility(page, `koth-${SURFACE}-wave${reachedWave}-front`);
    results.push(r1);
    printResult(r1);

    // --- CHECK from back side (teleport player to opposite UV) ---
    console.log(`Checking back-side view (player teleported to u+0.5)...`);
    await page.evaluate(() => {
      const api = window.__TEST_API;
      const pos = api.getPlayerPosition();
      api.setPlayerPosition(((pos?.u || 0.5) + 0.5) % 1.0, pos?.v || 0.5);
    });
    // Wait 2s for any new spawn warnings triggered during teleport to complete
    await sleep(2000);
    const r2 = await checkEnemyVisibility(page, `koth-${SURFACE}-wave${reachedWave}-back`);
    results.push(r2);
    printResult(r2);

    // --- WAIT for wave 5 if target was lower ---
    if (TARGET_WAVE < 5) {
      // Teleport player back to front
      await page.evaluate(() => {
        const api = window.__TEST_API;
        const pos = api.getPlayerPosition();
        api.setPlayerPosition(((pos?.u || 0.5) + 0.5) % 1.0, pos?.v || 0.5);
      });

      console.log(`\nWaiting for wave 5+...`);
      const reachedWave5 = await waitForWave(page, 5, 120000, 'to-wave5');
      await sleep(2000);
      const r3 = await checkEnemyVisibility(page, `koth-${SURFACE}-wave${reachedWave5}-stress`);
      results.push(r3);
      console.log(`\nWave 5 stress check:`);
      printResult(r3);
    }

    // --- Final verdict ---
    passed = results.every(r => r.passed);
    const label = passed ? 'PASS' : 'FAIL';
    console.log(`\n=== RESULT: ${label} ===`);
    for (const r of results) {
      const status = r.passed ? 'PASS' : 'FAIL';
      console.log(`  ${status} ${r.label}:`);
      console.log(`       alive=${r.aliveCount}, visible=${r.notMaterializingCount - (r.invisibleCount || 0)}, invisible=${r.invisibleCount || 0}, stuck-mat=${r.stuckMaterializingCount || 0}, minICB=${r.minICB?.toFixed(3)}`);
      if (!r.passed && r.invisibleSample?.length > 0) {
        console.log(`       Invisible sample:`, JSON.stringify(r.invisibleSample));
      }
      if (!r.passed && r.stuckSample?.length > 0) {
        console.log(`       Stuck-materializing sample:`, JSON.stringify(r.stuckSample));
      }
    }

    // Write JSON report
    const reportPath = resolve(REPORTS_DIR, `koth-deep-waves-${new Date().toISOString().split('T')[0]}.json`);
    writeFileSync(reportPath, JSON.stringify({
      surface: SURFACE,
      targetWave: TARGET_WAVE,
      passed,
      results,
      timestamp: new Date().toISOString(),
    }, null, 2));
    console.log(`\nReport: ${reportPath}`);
    console.log(`Screenshots: ${SCREENSHOT_DIR}/`);

  } finally {
    await browser.close();
  }

  process.exit(passed ? 0 : 1);
}

function printResult(r) {
  const status = r.passed ? 'PASS' : 'FAIL';
  if (r.error) {
    console.log(`  ${status} ${r.label}: ERROR — ${r.error}`);
    return;
  }
  console.log(`  ${status} ${r.label}: wave=${r.wave}, alive=${r.aliveCount}, invisible=${r.invisibleCount || 0}, stuck-mat=${r.stuckMaterializingCount || 0}, minICB=${r.minICB?.toFixed(3)}`);
}

runTest().catch(err => {
  console.error('\nTest failed with error:', err.message || err);
  process.exit(1);
});
