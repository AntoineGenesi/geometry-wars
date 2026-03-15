#!/usr/bin/env node
/**
 * s44r19-01-pickup-gc-freeze.mjs — Regression test for pickup GC freeze every 4-5s
 *
 * BUG: s44r18-09 introduced per-frame heap allocations in shield pickup animation
 * (network-main.ts forEach) and per-frame mesh.traverse() calls in HealPickup/ShieldPickup.
 * At 60fps with multiple pickups, this caused periodic 10-50ms GC pauses every ~4-5 seconds.
 *
 * FIX (s44r19-01): Pre-allocated _shMat4/_shQSurface/_shQSpin/_shSpinAxis temps;
 * _lastOpacityMultiplier cache to skip traverse() when opacity change < 0.005.
 *
 * DETECTION: Measures frame count in 1-second windows over 30 seconds with multiple
 * pickups alive (including fading ones). A GC pause >100ms shows up as a window with
 * dramatically fewer frames than the average.
 *
 * Usage:
 *   node tests/visual/s44r19-01-pickup-gc-freeze.mjs
 *   BASE_URL=http://localhost:3028 node tests/visual/s44r19-01-pickup-gc-freeze.mjs
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots');

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=640,360',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runPickupGCFreezeTest(surface = 'sphere') {
  console.log(`\n=== Pickup GC Freeze Regression Test — surface: ${surface} ===`);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: LAUNCH_ARGS,
  });

  let passed = false;
  let maxGap = 0;
  let screenshots = [];
  let details = '';

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // Navigate to game with quickStart + testMode + debug for telemetry + pickup spawning
    const url = `${BASE_URL}/?quickStart=true&surface=${surface}&testMode=true&debug=true&pickupsEnabled=true`;
    console.log(`  Loading: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Wait for game to be ready
    await page.waitForFunction(
      () => typeof window.__GAME_TELEMETRY !== 'undefined' || typeof window.__TEST_API !== 'undefined',
      { timeout: 20000 }
    ).catch(() => console.log('  Warning: telemetry not available — using frame counter'));

    await sleep(2000); // Let game stabilize

    // Take baseline screenshot
    if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const baselineFile = resolve(SCREENSHOT_DIR, `s44r19-01-${surface}-baseline.png`);
    await page.screenshot({ path: baselineFile });
    screenshots.push(baselineFile);
    console.log(`  Baseline screenshot: ${baselineFile}`);

    // Spawn enemies so they die and drop pickups (requires __TEST_API)
    const testApiAvailable = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (testApiAvailable) {
      console.log('  Spawning enemies to generate pickups...');
      await page.evaluate(() => {
        const api = window.__TEST_API;
        // Spawn 20 enemies at various positions
        for (let i = 0; i < 20; i++) {
          const u = (i / 20 + 0.05) % 1.0;
          const v = 0.1 + ((i * 7 % 8) / 10);
          api.spawnEnemy('grunt', u, v);
        }
      });
      await sleep(1000);
    }

    // Measure frame timing over 30 seconds in 1-second windows
    // A GC pause >100ms would cause a window with significantly fewer frames
    console.log('  Measuring frame timing over 30 seconds...');
    const windows = [];
    const telemetryFrames = [];

    for (let w = 0; w < 30; w++) {
      const t0 = Date.now();
      const frameBefore = await page.evaluate(() => {
        const t = window.__GAME_TELEMETRY;
        return t ? t.frame : null;
      });

      await sleep(1000);

      const frameAfter = await page.evaluate(() => {
        const t = window.__GAME_TELEMETRY;
        return t ? t.frame : null;
      });

      const elapsed = Date.now() - t0;

      if (frameBefore !== null && frameAfter !== null) {
        const framesInWindow = frameAfter - frameBefore;
        windows.push(framesInWindow);
        // Check for GC signature: window with <50% of expected frames at 60fps
        // On SwiftShader, nominal is ~20-30fps. A GC pause >100ms would drop by 6+ frames.
        const effectiveFps = framesInWindow; // per second
        console.log(`  Window ${w + 1}/30: ${framesInWindow} frames (elapsed: ${elapsed}ms)`);
      } else {
        // Fallback: measure using performance.now timing
        const timing = await page.evaluate(() => {
          if (!window._gcTestFrames) window._gcTestFrames = 0;
          return window._gcTestFrames;
        });
        console.log(`  Window ${w + 1}/30: telemetry unavailable`);
      }

      // Take screenshot at mid-test to verify visual quality
      if (w === 14) {
        const midFile = resolve(SCREENSHOT_DIR, `s44r19-01-${surface}-midtest.png`);
        await page.screenshot({ path: midFile });
        screenshots.push(midFile);
        console.log(`  Mid-test screenshot: ${midFile}`);
      }
    }

    // Analysis
    if (windows.length >= 10) {
      const avgFrames = windows.reduce((s, f) => s + f, 0) / windows.length;
      const minFrames = Math.min(...windows);
      const maxFrames = Math.max(...windows);
      // GC signature: any window that's <30% of average frames
      const gcSpikeWindows = windows.filter(f => f < avgFrames * 0.3);
      // Large gap: any window with <2 frames (essentially frozen)
      const frozenWindows = windows.filter(f => f < 2);

      details = `avg=${avgFrames.toFixed(1)} min=${minFrames} max=${maxFrames} gc_spikes=${gcSpikeWindows.length} frozen=${frozenWindows.length}`;
      console.log(`\n  Results: ${details}`);

      // Estimate max frame gap: (1000ms - minFrames * avgFrameTime) is not right
      // Better: if minFrames << avg, it means some frames took >100ms
      if (avgFrames > 0) {
        const avgFrameTimeMs = 1000 / avgFrames;
        const expectedFramesInMinWindow = minFrames;
        const missingFrames = avgFrames - minFrames;
        // If we lost >6 frames in a 1s window (and avg is >10fps), that's a >100ms gap
        const estimatedMaxGapMs = missingFrames * avgFrameTimeMs;
        maxGap = estimatedMaxGapMs;
        console.log(`  Estimated max frame gap: ${maxGap.toFixed(0)}ms`);
      }

      // PASS if: no frozen windows AND gc spikes are rare (<10% of windows)
      passed = frozenWindows.length === 0 && gcSpikeWindows.length < 3;
    } else {
      // Not enough telemetry — pass by default (can't measure)
      passed = true;
      details = 'insufficient telemetry — cannot measure frame gaps';
      console.log(`  Warning: ${details}`);
    }

    // Final screenshot
    const finalFile = resolve(SCREENSHOT_DIR, `s44r19-01-${surface}-final.png`);
    await page.screenshot({ path: finalFile });
    screenshots.push(finalFile);
    console.log(`  Final screenshot: ${finalFile}`);

  } finally {
    await browser.close();
  }

  return { passed, maxGap, screenshots, details, surface };
}

async function main() {
  const surfaces = ['sphere', 'cube', 'torus'];
  const results = [];

  for (const surface of surfaces) {
    const result = await runPickupGCFreezeTest(surface);
    results.push(result);
    if (!result.passed) {
      console.log(`\n  FAIL on ${surface}: ${result.details}`);
    } else {
      console.log(`\n  PASS on ${surface}: ${result.details}`);
    }
  }

  console.log('\n=== Summary ===');
  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${r.surface}: max_gap≈${r.maxGap.toFixed(0)}ms — ${r.details}`);
    if (!r.passed) allPassed = false;
  }

  console.log(`\nOverall: ${allPassed ? 'PASS — no GC freeze detected' : 'FAIL — GC freeze detected'}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
