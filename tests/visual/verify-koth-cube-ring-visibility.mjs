#!/usr/bin/env node
/**
 * verify-koth-cube-ring-visibility.mjs — KotH cube-ring enemy visibility test.
 *
 * Tests that enemies remain visible on cube-ring in King of the Hill mode (SP).
 * KotH uses a different wave spawner (KingMode.ts kothWaveTimer) than default waves.
 *
 * Two phases:
 *   Phase 1 (0–20s): Let KotH spawn naturally. Screenshot. Check visibility.
 *   Phase 2 (20–25s): Force-spawn 70 additional enemies via TestHarnessAPI. Wait 4s.
 *
 * FAIL if any enemy has instanceColorBrightness < 0.10 (perceptually invisible).
 * WARN if any enemy has instanceColorBrightness < 0.20 (nearly invisible).
 *
 * Usage:
 *   node tests/visual/verify-koth-cube-ring-visibility.mjs
 *   BASE_URL=http://localhost:3032 node tests/visual/verify-koth-cube-ring-visibility.mjs
 *
 * Exit: 0 = PASS, 1 = FAIL
 * Target runtime: < 90 seconds
 *
 * Requires: dev server running at BASE_URL (default: http://localhost:3032)
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.BASE_URL || 'http://localhost:3032';
const SCREENSHOT_DIR = resolve(__dirname, '../../test-screenshots/koth-cube-ring');
const REPORTS_DIR = resolve(__dirname, '../../reports');

// Thresholds (consistent with verify-enemy-visibility-regression.mjs)
const INVISIBLE_THRESHOLD = 0.10;  // below this = invisible = FAIL
const DIM_THRESHOLD = 0.20;        // below this = warning (nearly invisible)
const CRITICAL_PCT = 0.10;         // >10% invisible = CRITICAL FAIL

// Must be > 50 to catch RC8-A's 50-enemy AdaptiveQuality cap bug
const SPAWN_COUNT = 70;

// Simple enemy types (no snake segments or bosses that have complex teardown)
const ENEMY_TYPES = ['wanderer', 'grunt', 'duck', 'mayfly'];

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

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
// Evaluate enemy brightness stats for a set of enemies
// ---------------------------------------------------------------------------

function computeStats(enemies, threshold, dimThreshold) {
  const alive = (enemies || []).filter(e => e.alive);
  const invisible = alive.filter(e => e.instanceColorBrightness < threshold);
  const dim = alive.filter(e =>
    e.instanceColorBrightness >= threshold &&
    e.instanceColorBrightness < dimThreshold
  );
  const bright = alive.filter(e => e.instanceColorBrightness >= dimThreshold);

  const invisiblePct = alive.length > 0 ? invisible.length / alive.length : 0;
  const minBrightness = alive.length > 0
    ? Math.min(...alive.map(e => e.instanceColorBrightness))
    : 1.0;
  const avgBrightness = alive.length > 0
    ? alive.reduce((s, e) => s + e.instanceColorBrightness, 0) / alive.length
    : 1.0;

  return {
    aliveCount: alive.length,
    invisibleCount: invisible.length,
    dimCount: dim.length,
    brightCount: bright.length,
    invisiblePct: (invisiblePct * 100).toFixed(1),
    isCritical: invisiblePct > CRITICAL_PCT,
    minBrightness: minBrightness.toFixed(4),
    avgBrightness: avgBrightness.toFixed(4),
    // Sample of failing enemies for debugging
    invisibleSample: invisible.slice(0, 5).map(e => ({
      id: e.id,
      type: e.type,
      u: typeof e.u === 'number' ? e.u.toFixed(3) : '?',
      v: typeof e.v === 'number' ? e.v.toFixed(3) : '?',
      icb: e.instanceColorBrightness.toFixed(4),
    })),
  };
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function runTest() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
    timeout: 30000,
  });

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
      } catch (_) {}
    });

    // Load KotH mode on cube-ring — gameMode=king activates KingMode.ts
    const url = `${BASE_URL}?quickStart=true&surface=cube-ring&gameMode=king&testMode=true&debug=true`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });

    // Wait for game to initialize — TestHarnessAPI.update() must have run at least once
    await sleep(3000);

    // Verify TestHarnessAPI is live
    const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (!apiReady) {
      return {
        passed: false,
        apiReady: false,
        reason: '__TEST_API not found — testMode=true not activating',
        duration: Date.now() - start,
      };
    }

    // Verify KotH mode activated via getKOTHZoneState() — returns null if not in KotH mode
    const zoneState = await page.evaluate(() => {
      if (!window.__TEST_API) return null;
      return window.__TEST_API.getKOTHZoneState();
    });
    if (!zoneState) {
      return {
        passed: false,
        apiReady: true,
        reason: 'KotH mode not active — getKOTHZoneState() returned null. gameMode=king URL param may not be working.',
        duration: Date.now() - start,
      };
    }

    // -----------------------------------------------------------------------
    // PHASE 1: Natural KotH wave spawning
    // KingMode.ts: kothWaveTimer = 8s → first wave at t=8s.
    // We've already waited 3s. Wait 17s more = 20s total, covering 2+ natural KotH waves.
    // -----------------------------------------------------------------------
    console.log('  Phase 1: Waiting 17s for natural KotH waves to spawn...');
    await sleep(17000);

    // Screenshot phase 1 — captures natural KotH state
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const phase1ScreenshotPath = resolve(SCREENSHOT_DIR, 'phase1-natural.png');
    await page.screenshot({ path: phase1ScreenshotPath, fullPage: false });

    const phase1Enemies = await page.evaluate(() => {
      if (!window.__TEST_API) return null;
      return window.__TEST_API.getEnemies();
    });

    if (!phase1Enemies) {
      return {
        passed: false,
        apiReady: true,
        reason: 'getEnemies() returned null after phase 1 natural spawn',
        phase1Screenshot: phase1ScreenshotPath,
        duration: Date.now() - start,
      };
    }

    const phase1Stats = computeStats(phase1Enemies, INVISIBLE_THRESHOLD, DIM_THRESHOLD);
    // Phase 1 pass: at least 1 natural enemy alive (KotH wave may be small), no invisible
    const phase1Passed = phase1Stats.aliveCount >= 1 && phase1Stats.invisibleCount === 0;

    // -----------------------------------------------------------------------
    // PHASE 2: Force-spawn 70 additional enemies on top of natural KotH spawns
    // DON'T clear natural enemies — test maximum load and catch RC8-A type cap bugs.
    // 7 rows × 10 cols = 70 enemies across full UV space.
    // -----------------------------------------------------------------------
    console.log('  Phase 2: Force-spawning 70 additional enemies via TestHarnessAPI...');
    await page.evaluate((spawnCount, enemyTypes) => {
      const api = window.__TEST_API;
      const cols = 10;
      const rows = Math.ceil(spawnCount / cols);
      for (let i = 0; i < spawnCount; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const u = (col + 0.5) / cols;   // 0.05, 0.15, ..., 0.95
        const v = (row + 0.5) / rows;   // spread evenly across V
        const type = enemyTypes[i % enemyTypes.length];
        api.spawnEnemy(type, u, v);
      }
    }, SPAWN_COUNT, ENEMY_TYPES);

    // Wait for visibility system (RenderLoop.ts) to process instanceColor for all enemies.
    // 4s = ~240 frames at 60fps, more than enough.
    await sleep(4000);

    // Screenshot phase 2 — captures state after forced spawn
    const phase2ScreenshotPath = resolve(SCREENSHOT_DIR, 'phase2-forced.png');
    await page.screenshot({ path: phase2ScreenshotPath, fullPage: false });

    const phase2Enemies = await page.evaluate(() => {
      if (!window.__TEST_API) return null;
      return window.__TEST_API.getEnemies();
    });

    if (!phase2Enemies) {
      return {
        passed: false,
        apiReady: true,
        reason: 'getEnemies() returned null after phase 2 forced spawn',
        phase1: { ...phase1Stats, passed: phase1Passed, screenshotPath: phase1ScreenshotPath },
        phase2Screenshot: phase2ScreenshotPath,
        duration: Date.now() - start,
      };
    }

    const phase2Stats = computeStats(phase2Enemies, INVISIBLE_THRESHOLD, DIM_THRESHOLD);
    // Phase 2 pass: at least 10 enemies alive (natural + forced), no invisible
    const phase2Passed = phase2Stats.aliveCount >= 10 && phase2Stats.invisibleCount === 0;

    const overallPassed = phase1Passed && phase2Passed;

    return {
      passed: overallPassed,
      apiReady: true,
      surface: 'cube-ring',
      mode: 'king',
      phase1: {
        ...phase1Stats,
        passed: phase1Passed,
        screenshotPath: phase1ScreenshotPath,
      },
      phase2: {
        ...phase2Stats,
        passed: phase2Passed,
        spawnedCount: SPAWN_COUNT,
        screenshotPath: phase2ScreenshotPath,
      },
      duration: Date.now() - start,
    };

  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(REPORTS_DIR, { recursive: true });

  console.log('\n=== KotH Cube-Ring Enemy Visibility Test ===');
  console.log(`Server:  ${BASE_URL}`);
  console.log(`Surface: cube-ring  Mode: King of the Hill`);
  console.log(`Phase 1: Natural KotH waves (wait 20s)`);
  console.log(`Phase 2: +${SPAWN_COUNT} forced enemies (catches RC8-A 50-enemy cap bug)`);
  console.log(`Invisible threshold: instanceColorBrightness < ${INVISIBLE_THRESHOLD}`);
  console.log(`Warning threshold:   instanceColorBrightness < ${DIM_THRESHOLD}`);
  console.log('');

  let result;
  try {
    result = await runTest();
  } catch (err) {
    console.error(`ERROR  ${err.message}`);
    process.exit(1);
  }

  if (!result.apiReady) {
    console.log(`SKIP  ${result.reason}`);
    console.log('\nCannot test: TestHarnessAPI not available.');
    process.exit(1);
  }

  if (result.reason && !result.phase1) {
    // Early exit (KotH mode not active, or other setup failure)
    console.log(`FAIL  ${result.reason}`);
    process.exit(1);
  }

  // Print phase 1 stats
  const p1 = result.phase1;
  if (p1.passed) {
    const dimNote = p1.dimCount > 0 ? ` warn_dim=${p1.dimCount}` : '';
    console.log(`  Phase 1 (natural KotH): PASS  alive=${p1.aliveCount} invisible=0 min_icb=${p1.minBrightness} avg_icb=${p1.avgBrightness}${dimNote}`);
  } else {
    const criticalFlag = p1.isCritical ? ' [CRITICAL]' : '';
    console.log(`  Phase 1 (natural KotH): FAIL${criticalFlag}  alive=${p1.aliveCount} invisible=${p1.invisibleCount} (${p1.invisiblePct}%) min_icb=${p1.minBrightness}`);
    for (const e of (p1.invisibleSample || [])) {
      console.log(`         ${e.type} id=${e.id} u=${e.u} v=${e.v} icb=${e.icb}`);
    }
  }

  // Print phase 2 stats
  const p2 = result.phase2;
  if (p2.passed) {
    const dimNote = p2.dimCount > 0 ? ` warn_dim=${p2.dimCount}` : '';
    console.log(`  Phase 2 (forced spawn): PASS  alive=${p2.aliveCount}/${p2.spawnedCount}+ invisible=0 min_icb=${p2.minBrightness} avg_icb=${p2.avgBrightness}${dimNote}`);
  } else {
    const criticalFlag = p2.isCritical ? ' [CRITICAL]' : '';
    console.log(`  Phase 2 (forced spawn): FAIL${criticalFlag}  alive=${p2.aliveCount}/${p2.spawnedCount}+ invisible=${p2.invisibleCount} (${p2.invisiblePct}%) min_icb=${p2.minBrightness}`);
    for (const e of (p2.invisibleSample || [])) {
      console.log(`         ${e.type} id=${e.id} u=${e.u} v=${e.v} icb=${e.icb}`);
    }
  }

  console.log('');

  if (result.passed) {
    console.log(`PASS: Both phases — no invisible enemies detected on cube-ring in KotH mode. (${(result.duration / 1000).toFixed(1)}s)`);
  } else {
    const failedPhases = [];
    if (!p1.passed) failedPhases.push('Phase 1 (natural KotH)');
    if (!p2.passed) failedPhases.push('Phase 2 (forced spawn)');
    console.log(`FAIL: ${failedPhases.join(', ')} — invisible enemies detected.`);
    console.log('\nACTION REQUIRED: Invisible enemy regression detected on cube-ring KotH.');
    console.log('Root cause checklist:');
    console.log('  RC1/RC6: src/core/RenderLoop.ts — visibility shader logic');
    console.log('  RC2:     src/entities/enemies/ — MeshStandardMaterial → MeshBasicMaterial');
    console.log('  RC3:     src/rendering/AdaptiveQuality.ts — compound dimming multipliers');
    console.log('  RC8:     src/rendering/AdaptiveQuality.ts — maxVisibleEnemies cap');
    console.log('  KotH:    src/core/modes/KingMode.ts — kothWaveTimer, spawnTimedKothWave()');
  }

  // Write machine-readable JSON report
  const runDate = new Date().toISOString().split('T')[0];
  const reportPath = resolve(REPORTS_DIR, `koth-cube-ring-visibility-${runDate}.json`);
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    passed: result.passed,
    baseUrl: BASE_URL,
    surface: 'cube-ring',
    mode: 'king',
    phase1: result.phase1,
    phase2: result.phase2,
    thresholds: {
      invisible: INVISIBLE_THRESHOLD,
      dim: DIM_THRESHOLD,
      criticalPct: CRITICAL_PCT,
      spawnCount: SPAWN_COUNT,
    },
    duration: result.duration,
  }, null, 2));
  console.log(`\nReport: ${reportPath}`);

  process.exit(result.passed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
