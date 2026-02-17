#!/usr/bin/env node
/**
 * s23-comprehensive-movement-test.mjs — Comprehensive 3D movement testing harness.
 *
 * Uses window._gameState (from GameStateExporter) to collect frame-by-frame
 * player positions while pressing movement keys, then runs zigzag detection.
 *
 * Tests:
 *   1. Sphere: forward press → smooth movement (should NOT zigzag) → PASSES
 *   2. Pill: forward press → should NOT zigzag → FAILS while pill bug is present
 *            After pill fix: flip expectZigzag from false/true in runSurfaceTest call → PASSES
 *
 * Performance target: <30 seconds total on WSL2 SwiftShader (~7 fps rendered)
 *
 * Zigzag threshold calibration:
 *   At SwiftShader ~7fps, each rendered frame averages ~8-9 fixed-update ticks.
 *   This partially cancels fast zigzag oscillation. Observed ratios:
 *     - Smooth sphere: ~0.00 (no oscillation)
 *     - Buggy pill:    ~0.30-0.40 (partial cancellation of 60Hz zigzag)
 *   Threshold of 0.25 is used: catches pill bug, clear separation from smooth movement.
 *
 * Usage:
 *   PORT=3013 node tests/visual/s23-comprehensive-movement-test.mjs
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3013;
const SCREENSHOT_DIR = join(__dirname, '../../test-screenshots/sessions/s23');
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

// Make screenshot dir if not present
try { mkdirSync(SCREENSHOT_DIR, { recursive: true }); } catch {}

// ---------------------------------------------------------------------------
// Zigzag detection (mirrors src/test/s23-zigzag-detection.test.ts algorithm)
// ---------------------------------------------------------------------------

function len(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }

function detectZigzag(positions, minMagnitude = 0.001, zigzagThreshold = 0.25) {
  if (positions.length < 3) {
    return { isZigzag: false, oscillationRatio: 0, avgDisplacementMagnitude: 0, frameCount: positions.length };
  }

  const displacements = [];
  for (let i = 1; i < positions.length; i++) {
    const d = sub(positions[i], positions[i - 1]);
    if (len(d) >= minMagnitude) displacements.push(d);
  }

  if (displacements.length < 2) {
    return { isZigzag: false, oscillationRatio: 0, avgDisplacementMagnitude: 0, frameCount: positions.length };
  }

  let oscillatingPairs = 0;
  let totalMagnitude = 0;
  for (let i = 0; i < displacements.length; i++) {
    totalMagnitude += len(displacements[i]);
    if (i > 0 && dot(displacements[i - 1], displacements[i]) < 0) {
      oscillatingPairs++;
    }
  }

  const oscillationRatio = oscillatingPairs / (displacements.length - 1);
  return {
    isZigzag: oscillationRatio >= zigzagThreshold,
    oscillationRatio,
    avgDisplacementMagnitude: totalMagnitude / displacements.length,
    frameCount: positions.length,
  };
}

// ---------------------------------------------------------------------------
// Puppeteer helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,720',
    ],
  });
}

/**
 * Wait until window._gameState exists and game is past countdown.
 * Uses page.waitForFunction for efficiency (no manual polling loop).
 */
async function waitForGameReady(page, timeoutMs = 20000) {
  try {
    await page.waitForFunction(() => {
      const gs = window._gameState;
      if (!gs) return false;
      // Past countdown when not paused, not game over, and a few frames in
      return !gs.game.isPaused && !gs.game.isGameOver && gs.game.frameCount > 10;
    }, { timeout: timeoutMs, polling: 300 });
    return await page.evaluate(() => window._gameState);
  } catch {
    return null;
  }
}

/**
 * Collect walker positions while holding a key for `durationMs` milliseconds.
 * Samples at rAF rate (~7fps on SwiftShader), deduplicated by frame count.
 */
async function collectPositions(page, key, durationMs) {
  // Inject rAF-based position collector
  await page.evaluate(() => {
    window._positionCollector = { active: false, positions: [], lastFrame: -1 };
    function collect() {
      const col = window._positionCollector;
      if (!col.active) return;
      const gs = window._gameState;
      if (gs && gs.game.frameCount !== col.lastFrame && !gs.game.isPaused) {
        col.lastFrame = gs.game.frameCount;
        col.positions.push({ x: gs.walker.position.x, y: gs.walker.position.y, z: gs.walker.position.z });
      }
      requestAnimationFrame(collect);
    }
    window._positionCollector.active = true;
    requestAnimationFrame(collect);
  });

  await page.keyboard.down(key);
  await sleep(durationMs);
  await page.keyboard.up(key);
  await sleep(150);

  // Stop collector and return positions
  return page.evaluate(() => {
    window._positionCollector.active = false;
    return window._positionCollector.positions;
  });
}

// ---------------------------------------------------------------------------
// Per-surface test runner
// ---------------------------------------------------------------------------

async function runSurfaceTest(page, surface, expectZigzag) {
  const url = `http://localhost:${PORT}/?quickStart=true&surface=${surface}&testMode=true`;
  console.log(`\n[s23] Testing surface: ${surface} (expect ${expectZigzag ? 'zigzag' : 'smooth'})`);

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for _gameState to be live and game to be playing (no fixed sleep needed)
  const initialState = await waitForGameReady(page, 20000);
  if (!initialState) {
    console.error(`[s23] TIMEOUT: window._gameState not ready on ${surface}`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, `s23-${surface}-timeout.png`) });
    return { surface, passed: false, reason: 'timeout: _gameState not ready' };
  }

  console.log(`[s23] Game ready. frameCount=${initialState.game.frameCount}`);
  await page.screenshot({ path: join(SCREENSHOT_DIR, `s23-${surface}-01-ready.png`) });

  // Collect positions while holding W (10 seconds → ~70 rAF frames at 7fps)
  console.log('[s23] Collecting positions (W key, 10s)...');
  const positions = await collectPositions(page, 'w', 10000);
  console.log(`[s23] Collected ${positions.length} position samples`);
  await page.screenshot({ path: join(SCREENSHOT_DIR, `s23-${surface}-02-moved.png`) });

  if (positions.length < 15) {
    return { surface, passed: false, reason: `too few positions: ${positions.length}` };
  }

  // Zigzag detection (threshold 0.25 — calibrated for SwiftShader 7fps sampling rate)
  const result = detectZigzag(positions, 0.001, 0.25);
  console.log(`[s23] oscillationRatio=${result.oscillationRatio.toFixed(3)}, isZigzag=${result.isZigzag}, avgDisp=${result.avgDisplacementMagnitude.toFixed(4)}, samples=${positions.length}`);

  if (result.avgDisplacementMagnitude < 0.001) {
    return { surface, passed: false, reason: 'player did not move', result };
  }

  const detectionCorrect = result.isZigzag === expectZigzag;
  console.log(`[s23] ${detectionCorrect ? 'PASS' : 'FAIL'}`);
  return { surface, passed: detectionCorrect, result };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  console.log('[s23-comprehensive-movement-test] Starting...');
  console.log(`[s23] Server: http://localhost:${PORT}`);

  const browser = await launchBrowser();
  const results = [];

  try {
    // Test 1: Sphere — smooth movement (should NOT zigzag)
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      page.on('pageerror', err => console.error(`  [PAGE ERROR] ${err.message}`));
      const r = await runSurfaceTest(page, 'sphere', false);
      results.push(r);
      await page.close();
    }

    // Test 2: Pill — expects SMOOTH movement (no zigzag).
    // This test FAILS while the pill movement bug is present (oscillationRatio ≈ 0.33).
    // This test PASSES after the pill movement bug is fixed (oscillationRatio < 0.25).
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      page.on('pageerror', err => console.error(`  [PAGE ERROR] ${err.message}`));
      const r = await runSurfaceTest(page, 'pill', false /* smooth expected: FAILS while bug is present */);
      results.push({
        ...r,
        note: r.passed
          ? 'Pill movement smooth — bug appears fixed!'
          : 'KNOWN BUG: Pill movement zigzags (oscillationRatio ≈ 0.33 > threshold 0.25). Fix needed.',
      });
      await page.close();
    }

  } finally {
    await browser.close();
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const perfPass = parseFloat(elapsed) < 30;

  console.log('\n========== s23 TEST SUMMARY ==========');
  console.log(`Total time: ${elapsed}s`);
  let allPassed = true;
  for (const r of results) {
    const s = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${s}  surface=${r.surface}${r.reason ? '  (' + r.reason + ')' : ''}`);
    if (r.result) {
      console.log(`          oscillationRatio=${r.result.oscillationRatio.toFixed(3)}, avgDisp=${r.result.avgDisplacementMagnitude.toFixed(4)}, samples=${r.result.frameCount}`);
    }
    if (r.note) console.log(`          NOTE: ${r.note}`);
    if (!r.passed) allPassed = false;
  }
  console.log(`  ${perfPass ? '✓ PASS' : '✗ FAIL (acceptable on slow hardware)'}  Performance (${elapsed}s, target <30s)`);
  console.log('\nOverall:', allPassed ? '✓ ALL PASSED' : '✗ SOME FAILED');
  console.log('======================================\n');

  // Exit 0 if test logic passes (ignore perf on slow hardware)
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('[s23] Fatal error:', err);
  process.exit(1);
});
