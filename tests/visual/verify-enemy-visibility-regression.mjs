#!/usr/bin/env node
/**
 * verify-enemy-visibility-regression.mjs — Fast regression test for invisible enemies.
 *
 * Spawns 70 enemies directly via TestHarnessAPI and checks instanceColorBrightness.
 * FAILS if ANY enemy has brightness < 0.10 (perceptually invisible).
 * WARNS if any enemy has brightness < 0.20 (nearly invisible).
 *
 * Also performs screenshot-based pixel analysis (belt AND suspenders):
 * - Takes baseline screenshot after clearEnemies()
 * - Takes with-enemies screenshot after 4s wait
 * - Computes brightRatio delta; FAILS if delta < SCREENSHOT_DELTA_THRESHOLD
 *
 * Designed to catch RC1–RC8 regressions WITHOUT the user finding it at wave 7.
 * Known root causes caught by this test:
 *   RC1: vis² double-multiply in shader (s44r12-03)
 *   RC2: MeshStandardMaterial emissive dominates (s44r11-01)
 *   RC3: compound dimming depth × LOD (s44r17-01)
 *   RC4: EnemySpawner 400-cap dummy (s44r18-01)
 *   RC5: MeshWalker freezes MP enemies (s44r20-01)
 *   RC6: NaN surfaceVis undefined propagation (s44r21-01)
 *   RC7: Möbius UV seam V inversion (s44r22-19)
 *   RC8: AdaptiveQuality 50-enemy cap (s44r26-01)
 *
 * Usage:
 *   node tests/visual/verify-enemy-visibility-regression.mjs
 *   node tests/visual/verify-enemy-visibility-regression.mjs --surfaces=sphere,torus
 *   BASE_URL=http://localhost:3032 node tests/visual/verify-enemy-visibility-regression.mjs
 *
 * Exit: 0 = PASS, 1 = FAIL
 *
 * Surfaces tested: sphere (baseline), torus (RC1/RC6 history), cube-ring (user-reported),
 *                  sphere-tunnel (current problem map)
 * Target runtime: < 2 minutes (4 surfaces × ~25s each)
 *
 * Requires: dev server running at BASE_URL (default: http://localhost:3032)
 */

import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.BASE_URL || 'http://localhost:3032';
const SCREENSHOT_DIR = resolve(__dirname, '../../test-screenshots/enemy-visibility-regression');
const REPORTS_DIR = resolve(__dirname, '../../reports');

// Surfaces with a history of invisible enemy regressions (ordered: easiest → hardest)
const DEFAULT_SURFACES = ['sphere', 'torus', 'cube-ring', 'sphere-tunnel'];

// Thresholds (matches verify-enemies-all-surfaces.mjs for consistency)
const INVISIBLE_THRESHOLD = 0.10;  // below this = invisible = FAIL (RC8 caused 0 brightness)
const DIM_THRESHOLD = 0.20;        // below this = warning (nearly invisible)
const CRITICAL_PCT = 0.10;         // >10% invisible = CRITICAL FAIL

// Must be > 50 to catch RC8-A's 50-enemy AdaptiveQuality cap bug
const SPAWN_COUNT = 70;

// Minimum increase in brightRatio (any channel > 60) after spawning 70 enemies.
// Tunnel/cube surfaces can keep enemies small on screen, so the screenshot gate
// is a render-output sanity check alongside the stronger per-enemy API checks.
const SCREENSHOT_DELTA_THRESHOLD = 0.003;

// Simple enemy types (no snake segments or bosses that have complex teardown)
const ENEMY_TYPES = ['wanderer', 'grunt', 'duck', 'mayfly'];

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH;

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=800,600',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Canvas pixel analysis — independent of instanceColorBrightness API
// ---------------------------------------------------------------------------

/**
 * Count pixels with any RGB channel > 60 (neon enemy colors).
 * Background surfaces in SwiftShader headless are mostly < 30 on all channels.
 * Returns brightRatio = brightCount / totalPixels.
 */
async function analyzeCanvasForEnemies(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { brightCount: 0, totalCount: 0, brightRatio: 0 };
    try {
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx = tmp.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const data = ctx.getImageData(0, 0, tmp.width, tmp.height).data;
      let brightCount = 0;
      const totalCount = tmp.width * tmp.height;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 60 || data[i + 1] > 60 || data[i + 2] > 60) brightCount++;
      }
      return { brightCount, totalCount, brightRatio: brightCount / totalCount };
    } catch (e) {
      return { error: e.message, brightCount: 0, totalCount: 0, brightRatio: 0 };
    }
  });
}

// ---------------------------------------------------------------------------
// Test one surface
// ---------------------------------------------------------------------------

async function testSurface(surface) {
  const launchOptions = {
    headless: 'new',
    args: LAUNCH_ARGS,
    timeout: 30000,
  };
  if (CHROME_PATH && existsSync(CHROME_PATH)) {
    launchOptions.executablePath = CHROME_PATH;
  }
  const browser = await puppeteer.launch(launchOptions);

  const start = Date.now();

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    // Navigate once to clear localStorage mastery overlay (prevents UI blocking canvas)
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => {
      try {
        localStorage.removeItem('masteryOverlayShown');
        localStorage.removeItem('weaponMastery');
        localStorage.setItem('gw3d-graphics-settings', JSON.stringify({
          surfaceOpaque: false,
          surfaceOpacity: 0.05,
          surfaceVisibilityPreferenceVersion: 2,
        }));
      } catch (_) {}
    });

    // Load the real game (NOT PlaygroundTestHarness) with testMode=true
    const url = `${BASE_URL}?quickStart=true&surface=${surface}&debug=true&testMode=true`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });

    // Wait for game to fully initialize — TestHarnessAPI.update() must have run at least once
    // and RenderLoop must have processed at least one visibility frame
    await sleep(3000);

    // Verify TestHarnessAPI is live
    const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (!apiReady) {
      return {
        surface,
        passed: false,
        apiReady: false,
        reason: '__TEST_API not found — testMode=true not activating on this surface',
        duration: Date.now() - start,
      };
    }

    // Ensure screenshot directory exists before taking any screenshots
    mkdirSync(SCREENSHOT_DIR, { recursive: true });

    // Clear any natural spawns
    await page.evaluate(() => window.__TEST_API.clearEnemies());

    // Short wait for render to clear enemy pixels before baseline snapshot
    await sleep(500);

    // Baseline screenshot (enemies cleared — measures ambient surface brightness only)
    const baselineScreenshotPath = resolve(SCREENSHOT_DIR, `${surface}-baseline.png`);
    await page.screenshot({ path: baselineScreenshotPath, fullPage: false });
    const baselinePixels = await analyzeCanvasForEnemies(page);

    // Force-spawn 70 enemies distributed across UV space
    // 7 rows × 10 cols = 70 enemies, offset to avoid exact U=0 or V=0 edges
    await page.evaluate((spawnCount, enemyTypes) => {
      const api = window.__TEST_API;
      const cols = 10;
      const rows = Math.ceil(spawnCount / cols);
      for (let i = 0; i < spawnCount; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const u = (col + 0.5) / cols;             // 0.05, 0.15, ..., 0.95
        const v = (row + 0.5) / rows;             // spread evenly across V
        const type = enemyTypes[i % enemyTypes.length];
        api.spawnEnemy(type, u, v);
      }
    }, SPAWN_COUNT, ENEMY_TYPES);

    // Wait for several game frames — visibility system (RenderLoop.ts) updates instanceColor
    // each frame, but there's at least a 1-2 frame lag before instanceColor is fully applied.
    // 4s = ~240 frames at 60fps, more than enough.
    await sleep(4000);

    // Screenshot with enemies (for visual inspection + pixel analysis)
    const screenshotPath = resolve(SCREENSHOT_DIR, `${surface}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    const withEnemiesPixels = await analyzeCanvasForEnemies(page);

    // Compute brightRatio delta: how much brighter is the scene with enemies vs without?
    const pixelDelta = (withEnemiesPixels?.brightRatio ?? 0) - (baselinePixels?.brightRatio ?? 0);
    const screenshotPassed = pixelDelta >= SCREENSHOT_DELTA_THRESHOLD;
    const screenshotAnalysis = {
      baseline: baselinePixels,
      withEnemies: withEnemiesPixels,
      pixelDelta: parseFloat(pixelDelta.toFixed(4)),
      screenshotPassed,
      baselineScreenshotPath,
    };

    // Read all active enemies and their instanceColorBrightness
    const enemies = await page.evaluate(() => {
      if (!window.__TEST_API) return null;
      return window.__TEST_API.getEnemies();
    });

    if (!enemies) {
      return {
        surface,
        passed: false,
        reason: 'getEnemies() returned null after spawn',
        duration: Date.now() - start,
        screenshotPath,
        screenshotAnalysis,
      };
    }

    // getEnemies() already filters inactive (e.active == false), but alive is an additional check
    const alive = enemies.filter(e => e.alive);
    const invisible = alive.filter(e => e.instanceColorBrightness < INVISIBLE_THRESHOLD);
    const dim = alive.filter(e =>
      e.instanceColorBrightness >= INVISIBLE_THRESHOLD &&
      e.instanceColorBrightness < DIM_THRESHOLD
    );
    const bright = alive.filter(e => e.instanceColorBrightness >= DIM_THRESHOLD);

    const invisiblePct = alive.length > 0 ? invisible.length / alive.length : 0;
    const minBrightness = alive.length > 0
      ? Math.min(...alive.map(e => e.instanceColorBrightness))
      : 1.0;
    const avgBrightness = alive.length > 0
      ? alive.reduce((s, e) => s + e.instanceColorBrightness, 0) / alive.length
      : 1.0;

    // FAIL if: any enemy invisible, OR alive count suspiciously low, OR screenshot pixel delta too low
    const passed = alive.length >= 10 && invisible.length === 0 && screenshotPassed;
    const isCritical = invisiblePct > CRITICAL_PCT;

    return {
      surface,
      apiReady: true,
      passed,
      isCritical,
      aliveCount: alive.length,
      spawnedCount: SPAWN_COUNT,
      invisibleCount: invisible.length,
      dimCount: dim.length,
      brightCount: bright.length,
      invisiblePct: (invisiblePct * 100).toFixed(1),
      minBrightness: minBrightness.toFixed(4),
      avgBrightness: avgBrightness.toFixed(4),
      screenshotPath,
      screenshotAnalysis,
      duration: Date.now() - start,
      // Sample of failing enemies for debugging — includes UV position and brightness
      invisibleSample: invisible.slice(0, 5).map(e => ({
        id: e.id,
        type: e.type,
        u: e.u.toFixed(3),
        v: e.v.toFixed(3),
        icb: e.instanceColorBrightness.toFixed(4),
      })),
    };

  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const surfaceArg = args.find(a => a.startsWith('--surfaces='))?.split('=')[1];
  const surfaces = surfaceArg ? surfaceArg.split(',') : DEFAULT_SURFACES;

  mkdirSync(REPORTS_DIR, { recursive: true });

  console.log('\n=== Enemy Visibility Regression Test ===');
  console.log(`Server:  ${BASE_URL}`);
  console.log(`Surfaces: ${surfaces.join(', ')}`);
  console.log(`Spawn count: ${SPAWN_COUNT} enemies per surface (> 50 catches RC8-A cap bug)`);
  console.log(`Invisible threshold: instanceColorBrightness < ${INVISIBLE_THRESHOLD}`);
  console.log(`Warning threshold:   instanceColorBrightness < ${DIM_THRESHOLD}`);
  console.log(`Screenshot delta:    brightRatio increase >= ${SCREENSHOT_DELTA_THRESHOLD} required`);
  console.log('');

  const results = [];

  for (const surface of surfaces) {
    process.stdout.write(`  ${surface.padEnd(20)} `);
    try {
      const result = await testSurface(surface);
      results.push(result);

      if (!result.apiReady) {
        console.log(`SKIP  ${result.reason}`);
      } else if (result.passed) {
        const dimNote = result.dimCount > 0 ? ` warn_dim=${result.dimCount}` : '';
        const pxNote = result.screenshotAnalysis
          ? ` px_delta=+${result.screenshotAnalysis.pixelDelta}` : '';
        console.log(`PASS  alive=${result.aliveCount}/${result.spawnedCount} invisible=0 min_icb=${result.minBrightness} avg_icb=${result.avgBrightness}${dimNote}${pxNote} (${result.duration}ms)`);
      } else {
        const criticalFlag = result.isCritical ? ' [CRITICAL]' : '';
        console.log(`FAIL${criticalFlag}  alive=${result.aliveCount}/${result.spawnedCount} invisible=${result.invisibleCount} (${result.invisiblePct}%) min_icb=${result.minBrightness}`);
        for (const e of (result.invisibleSample || [])) {
          console.log(`         ${e.type} id=${e.id} u=${e.u} v=${e.v} icb=${e.icb}`);
        }
        if (result.screenshotAnalysis && !result.screenshotAnalysis.screenshotPassed) {
          console.log(`         [SCREENSHOT] pixel delta too low: ${result.screenshotAnalysis.pixelDelta} < ${SCREENSHOT_DELTA_THRESHOLD} (enemies not visible in render output)`);
          console.log(`         baseline:     ${result.screenshotAnalysis.baselineScreenshotPath}`);
          console.log(`         with-enemies: ${result.screenshotPath}`);
        }
      }
    } catch (err) {
      console.log(`ERROR  ${err.message}`);
      results.push({ surface, passed: false, error: err.message, duration: 0 });
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const passed = results.filter(r => r.passed);
  const failed = results.filter(r => !r.passed && r.apiReady !== false && !r.error);
  const errored = results.filter(r => r.error);
  const skipped = results.filter(r => r.apiReady === false);
  const allPassed = failed.length === 0 && errored.length === 0;
  const totalMs = results.reduce((s, r) => s + (r.duration || 0), 0);

  console.log('\n=== SUMMARY ===');
  console.log(`PASS: ${passed.length}/${surfaces.length} surfaces  (${(totalMs / 1000).toFixed(1)}s total)`);
  if (skipped.length > 0) console.log(`SKIP: ${skipped.length} (testMode not available)`);
  if (errored.length > 0) console.log(`ERROR: ${errored.length} (${errored.map(r => r.surface).join(', ')})`);

  if (failed.length > 0) {
    console.log('\nFAILED surfaces:');
    for (const f of failed) {
      const critical = f.isCritical ? ' [CRITICAL — >10% invisible]' : '';
      const screenshotFail = f.screenshotAnalysis && !f.screenshotAnalysis.screenshotPassed
        ? ` [SCREENSHOT px_delta=${f.screenshotAnalysis.pixelDelta}]` : '';
      console.log(`  [SP] ${f.surface}${critical}${screenshotFail}: ${f.invisibleCount ?? '?'} invisible enemies`);
    }
    console.log('\nACTION REQUIRED: Invisible enemy regression detected.');
    console.log('Root cause checklist:');
    console.log('  RC1/RC6: src/core/RenderLoop.ts — visibility shader logic');
    console.log('  RC2:     src/entities/enemies/ — MeshStandardMaterial → MeshBasicMaterial');
    console.log('  RC3:     src/rendering/AdaptiveQuality.ts — compound dimming multipliers');
    console.log('  RC4:     src/entities/enemies/EnemySpawner.ts — 400-cap dummy return');
    console.log('  RC8:     src/rendering/AdaptiveQuality.ts — maxVisibleEnemies cap');
  }

  if (allPassed) {
    console.log('\nPASS: All surfaces — no invisible enemies detected.');
  }

  // Write machine-readable JSON report
  const runDate = new Date().toISOString().split('T')[0];
  const reportPath = resolve(REPORTS_DIR, `enemy-visibility-regression-${runDate}.json`);
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    passed: allPassed,
    baseUrl: BASE_URL,
    surfaces: results,
    thresholds: {
      invisible: INVISIBLE_THRESHOLD,
      dim: DIM_THRESHOLD,
      criticalPct: CRITICAL_PCT,
      spawnCount: SPAWN_COUNT,
      screenshotDelta: SCREENSHOT_DELTA_THRESHOLD,
    },
  }, null, 2));
  console.log(`\nReport: ${reportPath}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
