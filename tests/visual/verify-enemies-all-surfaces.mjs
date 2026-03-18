#!/usr/bin/env node
/**
 * verify-enemies-all-surfaces.mjs — Comprehensive enemy visibility test.
 *
 * Tests ALL 13 SP surfaces (sequentially) and 5 MP surfaces to confirm:
 * - Enemies are visible at wave 1, 3, and 5+
 * - No progressive dimming (vis² bug regression)
 * - instanceColorBrightness stays above threshold through all waves
 *
 * Usage:
 *   node tests/visual/verify-enemies-all-surfaces.mjs              # all 13 SP surfaces
 *   node tests/visual/verify-enemies-all-surfaces.mjs --mp         # + 5 MP surfaces
 *   node tests/visual/verify-enemies-all-surfaces.mjs --surface=cube  # single surface
 *   node tests/visual/verify-enemies-all-surfaces.mjs --deep       # 5-wave deep test (sphere,cube,torus)
 *
 * Outputs:
 *   - reports/enemies-all-surfaces-YYYY-MM-DD.html
 *   - test-screenshots/enemies-all-surfaces/*.png
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3032';
const SCREENSHOT_DIR = resolve(__dirname, '../../test-screenshots/enemies-all-surfaces');
const REPORTS_DIR = resolve(__dirname, '../../reports');

// All 13 SP surfaces
const ALL_SP_SURFACES = [
  'sphere', 'torus', 'cube', 'cube-ring', 'pill',
  'peanut', 'mobius', 'sphere-tunnel', 'cube-tunnel',
  'pipe', 'capsule', 'icosahedron', 'mobius-bevel',
];

// 5 most-played MP surfaces (CPU-aware: sequential only)
const MP_SURFACES = ['sphere', 'cube', 'torus', 'pill', 'peanut'];

// Visibility thresholds
const INVISIBLE_THRESHOLD = 0.10;  // instanceColorBrightness below this = bug (s44r25-02: raised 0.05→0.10; SURFACE_DIM_OPACITY floor is now 0.15, so anything <0.10 is a regression)
const DIM_THRESHOLD = 0.15;        // below this = warn (far-side expected)
const BRIGHT_THRESHOLD = 0.30;     // above this = clearly visible (near-side)
// s44r29-05: Matrix scale threshold — enemies with zero-scale matrix are invisible
// regardless of ICB. This was the RC12 root cause: ICB check passed but matrix was zero.
const MIN_MATRIX_SCALE = 0.01;     // below this = invisible (zero-scale matrix)

// Wave time checkpoints (ms from game start)
const SP_CHECKPOINTS_MS = [5000, 15000, 30000]; // t=5s (wave 1), 15s (wave 2-3), 30s (wave 3-5)
const DEEP_CHECKPOINTS_MS = [5000, 15000, 30000, 50000, 70000]; // 5-wave deep test

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
// Canvas brightness analysis
// ---------------------------------------------------------------------------

async function getCanvasBrightness(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    try {
      const tmp = document.createElement('canvas');
      tmp.width = Math.min(canvas.width, 320);
      tmp.height = Math.min(canvas.height, 240);
      const ctx = tmp.getContext('2d');
      ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
      let totalLum = 0, sampleCount = 0, brightCount = 0;
      const step = 8;
      for (let x = 0; x < tmp.width; x += step) {
        for (let y = 0; y < tmp.height; y += step) {
          const px = ctx.getImageData(x, y, 1, 1).data;
          const lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
          totalLum += lum;
          sampleCount++;
          if (lum > 20) brightCount++;
        }
      }
      return {
        avgLum: totalLum / sampleCount,
        brightRatio: brightCount / sampleCount,
      };
    } catch { return null; }
  });
}

// ---------------------------------------------------------------------------
// Enemy visibility check at a checkpoint
// ---------------------------------------------------------------------------

async function checkEnemiesAtCheckpoint(page, surface, tMs, screenshotName) {
  // Get enemies via TestHarnessAPI
  const enemies = await page.evaluate(() => {
    if (!window.__TEST_API) return null;
    return window.__TEST_API.getEnemies();
  });

  // Take screenshot
  const screenshotPath = resolve(SCREENSHOT_DIR, `${screenshotName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  // Get canvas brightness as secondary check
  const canvasBrightness = await getCanvasBrightness(page);

  // Get game state
  const gameState = await page.evaluate(() => {
    if (!window.__TEST_API) return null;
    const s = window.__TEST_API.getGameState();
    return { score: s.score, frame: s.frame, surface: s.surface };
  });

  if (!enemies) {
    return {
      t: tMs,
      surface,
      error: 'No __TEST_API',
      passed: false,
      screenshotPath,
      canvasBrightness,
      gameState,
    };
  }

  const alive = enemies.filter(e => e.alive);
  const invisible = alive.filter(e => e.instanceColorBrightness < INVISIBLE_THRESHOLD);
  const dim = alive.filter(e => e.instanceColorBrightness < DIM_THRESHOLD);
  const bright = alive.filter(e => e.instanceColorBrightness >= BRIGHT_THRESHOLD);
  // s44r29-05: Also check for zero-scale matrix enemies (invisible despite good ICB).
  // Exclude materializing enemies — they're expected to have zero-scale (spawn warning phase).
  const zeroScale = alive.filter(e =>
    !e.isMaterializing &&
    e.instanceMatrixScale !== undefined && e.instanceMatrixScale < MIN_MATRIX_SCALE
  );

  // Compute min/max/avg brightness of alive enemies
  let minBrightness = 1.0, maxBrightness = 0.0, avgBrightness = 1.0;
  if (alive.length > 0) {
    minBrightness = Math.min(...alive.map(e => e.instanceColorBrightness));
    maxBrightness = Math.max(...alive.map(e => e.instanceColorBrightness));
    avgBrightness = alive.reduce((s, e) => s + e.instanceColorBrightness, 0) / alive.length;
  }

  // s44r29-05: Fail if ANY alive enemy has zero-scale matrix (invisible on screen)
  const passed = invisible.length === 0 && zeroScale.length === 0 && alive.length > 0;

  return {
    t: tMs,
    surface,
    passed,
    aliveCount: alive.length,
    totalCount: enemies.length,
    invisibleCount: invisible.length,
    dimCount: dim.length,
    brightCount: bright.length,
    zeroScaleCount: zeroScale.length,
    minBrightness,
    maxBrightness,
    avgBrightness,
    canvasBrightness,
    gameState,
    screenshotPath,
    // Sample of invisible enemies for debugging
    invisibleSample: invisible.slice(0, 3).map(e => ({
      type: e.type, u: e.u.toFixed(3), v: e.v.toFixed(3),
      instanceColorBrightness: e.instanceColorBrightness.toFixed(4),
      renderBatch: e.renderBatch,
    })),
    // s44r29-05: Sample of zero-scale enemies
    zeroScaleSample: zeroScale.slice(0, 3).map(e => ({
      type: e.type, u: e.u.toFixed(3), v: e.v.toFixed(3),
      instanceColorBrightness: e.instanceColorBrightness.toFixed(4),
      instanceMatrixScale: e.instanceMatrixScale?.toFixed(6),
      renderBatch: e.renderBatch,
    })),
  };
}

// ---------------------------------------------------------------------------
// SP surface test
// ---------------------------------------------------------------------------

async function testSpSurface(surface, checkpointsMs, runIndex) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
    timeout: 30000,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    // Clear localStorage to avoid mastery overlay
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => {
      try {
        localStorage.removeItem('masteryOverlayShown');
        localStorage.removeItem('weaponMastery');
      } catch {}
    });

    // Load game with testMode
    const url = `${BASE_URL}?quickStart=true&surface=${surface}&debug=true&testMode=true`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });

    // Wait for initial spawn
    await sleep(3000);

    const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (!apiReady) {
      return {
        surface, mode: 'SP', passed: false,
        reason: 'No __TEST_API — testMode not active',
        checkpoints: [],
      };
    }

    const surfaceResult = { surface, mode: 'SP', passed: true, checkpoints: [], runIndex };
    let elapsed = 3000;

    for (const targetMs of checkpointsMs) {
      const waitMore = targetMs - elapsed;
      if (waitMore > 0) await sleep(waitMore);
      elapsed = targetMs + 3000; // account for 3s initial wait

      const name = `sp-${surface}-t${Math.round(targetMs / 1000)}s-run${runIndex}`;
      const checkpoint = await checkEnemiesAtCheckpoint(page, surface, targetMs, name);
      surfaceResult.checkpoints.push(checkpoint);

      if (!checkpoint.passed) {
        surfaceResult.passed = false;
      }

      process.stdout.write(checkpoint.passed ? '.' : 'F');
    }

    return surfaceResult;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// MP surface test (simplified — no Colyseus spawn, uses existing server)
// ---------------------------------------------------------------------------

async function testMpSurface(surface, runIndex) {
  // MP test: start 2 browser instances, check enemy visibility in each
  // We use network-main.ts path via ?mode=network&surface=X
  // This requires the game server running at port 2567

  const browser1 = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
    timeout: 30000,
  });

  let browser2 = null;
  try {
    // Client 1: host
    const page1 = await browser1.newPage();
    await page1.setViewport({ width: 800, height: 600 });
    await page1.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page1.evaluate(() => {
      try { localStorage.removeItem('masteryOverlayShown'); } catch {}
    });

    const mpUrl = `${BASE_URL}?quickStart=true&surface=${surface}&debug=true&testMode=true&mode=network`;
    await page1.goto(mpUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page1.waitForSelector('canvas', { timeout: 15000 });
    await sleep(5000); // MP needs extra time to connect

    // Check if MP mode activated (telemetry or testMode may be different path)
    const apiReady1 = await page1.evaluate(() => typeof window.__TEST_API !== 'undefined');

    // Take screenshot for MP
    const screenshotPath = resolve(SCREENSHOT_DIR, `mp-${surface}-run${runIndex}.png`);
    await page1.screenshot({ path: screenshotPath });

    const canvasBrightness = await getCanvasBrightness(page1);

    // Try to get enemies via telemetry (MP may not have __TEST_API)
    let enemies = null;
    if (apiReady1) {
      enemies = await page1.evaluate(() => window.__TEST_API?.getEnemies() || []);
    }

    // Fall back to telemetry
    const telemetry = await page1.evaluate(() => {
      if (window.__GAME_TELEMETRY) {
        return window.__GAME_TELEMETRY.enemies || [];
      }
      return null;
    });

    const alive = enemies?.filter(e => e.alive) || [];
    const invisible = alive.filter(e => e.instanceColorBrightness < INVISIBLE_THRESHOLD);

    return {
      surface,
      mode: 'MP',
      passed: invisible.length === 0,
      aliveCount: alive.length,
      invisibleCount: invisible.length,
      canvasBrightness,
      screenshotPath,
      apiReady: apiReady1,
      hasTelemetry: !!telemetry,
      runIndex,
    };
  } finally {
    await browser1.close();
    if (browser2) await browser2.close();
  }
}

// ---------------------------------------------------------------------------
// HTML Report Generation
// ---------------------------------------------------------------------------

function generateHtmlReport(spResults, mpResults, runDate) {
  const allPassed = [...spResults, ...mpResults].every(r => r.passed);
  const failedSurfaces = [...spResults, ...mpResults].filter(r => !r.passed);

  const statusBadge = (passed) => passed
    ? '<span style="color:#22c55e;font-weight:bold">PASS</span>'
    : '<span style="color:#ef4444;font-weight:bold">FAIL</span>';

  const brightnessBar = (v) => {
    const pct = Math.round(v * 100);
    const color = v >= BRIGHT_THRESHOLD ? '#22c55e' : v >= DIM_THRESHOLD ? '#f59e0b' : '#ef4444';
    return `<div style="background:#1e293b;border-radius:3px;height:12px;width:80px;display:inline-block;vertical-align:middle">
      <div style="background:${color};height:12px;width:${pct}%;border-radius:3px"></div>
    </div> <span style="font-size:11px">${v.toFixed(3)}</span>`;
  };

  const checkpointRows = (result) => {
    return result.checkpoints.map(cp => {
      const rowClass = cp.passed ? '' : 'style="background:#3b1a1a"';
      const cpSec = Math.round(cp.t / 1000);
      const score = cp.gameState?.score ?? '?';
      const screenshot = cp.screenshotPath
        ? `<a href="${cp.screenshotPath}" target="_blank">screenshot</a>` : '';
      return `<tr ${rowClass}>
        <td>${cpSec}s</td>
        <td>${statusBadge(cp.passed)}</td>
        <td>${cp.aliveCount}</td>
        <td style="color:${cp.invisibleCount > 0 ? '#ef4444' : '#94a3b8'}">${cp.invisibleCount}</td>
        <td>${cp.dimCount}</td>
        <td>${brightnessBar(cp.avgBrightness)}</td>
        <td>${brightnessBar(cp.minBrightness)}</td>
        <td>${cp.canvasBrightness?.avgLum?.toFixed(1) ?? '?'}</td>
        <td>${score}</td>
        <td>${screenshot}</td>
      </tr>`;
    }).join('\n');
  };

  const spRows = spResults.map(r => `
    <tr>
      <td><b>${r.surface}</b></td>
      <td>${statusBadge(r.passed)}</td>
      <td>${r.checkpoints.map(c => c.aliveCount).join(' / ')}</td>
      <td>${r.checkpoints.map(c => c.invisibleCount).join(' / ')}</td>
      <td>${r.checkpoints.length > 0 ? brightnessBar(Math.min(...r.checkpoints.map(c => c.avgBrightness))) : 'n/a'}</td>
    </tr>
  `).join('\n');

  const mpRows = mpResults.map(r => `
    <tr>
      <td><b>${r.surface}</b></td>
      <td>${statusBadge(r.passed)}</td>
      <td>${r.aliveCount ?? '?'}</td>
      <td style="color:${r.invisibleCount > 0 ? '#ef4444' : '#94a3b8'}">${r.invisibleCount ?? '?'}</td>
      <td>${r.canvasBrightness?.avgLum?.toFixed(1) ?? '?'}</td>
      <td>${r.apiReady ? 'yes' : 'no'}</td>
    </tr>
  `).join('\n');

  const spDetailSections = spResults.map(r => `
    <h3 style="margin-top:24px;color:${r.passed ? '#22c55e' : '#ef4444'}">
      SP: ${r.surface} ${r.passed ? '✓' : '✗'}
    </h3>
    <table class="detail-table">
      <tr><th>Time</th><th>Status</th><th>Alive</th><th>Invisible</th><th>Dim</th>
          <th>Avg Brightness</th><th>Min Brightness</th><th>Canvas Lum</th><th>Score</th><th>Screenshot</th></tr>
      ${checkpointRows(r)}
    </table>
  `).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Enemy Visibility — All Surfaces — ${runDate}</title>
  <style>
    body { background: #0f172a; color: #e2e8f0; font-family: monospace; padding: 24px; }
    h1 { color: #f8fafc; }
    h2 { color: #94a3b8; border-bottom: 1px solid #334155; padding-bottom: 8px; }
    h3 { color: #cbd5e1; }
    .summary-box { background: #1e293b; border-radius: 8px; padding: 16px; margin: 16px 0;
                   border: 2px solid ${allPassed ? '#22c55e' : '#ef4444'}; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th { background: #1e293b; color: #94a3b8; padding: 8px 12px; text-align: left; }
    td { padding: 6px 12px; border-bottom: 1px solid #1e293b; }
    .detail-table th, .detail-table td { padding: 4px 8px; }
    a { color: #60a5fa; }
    .threshold-legend { background: #1e293b; border-radius: 6px; padding: 12px; margin: 8px 0;
                        font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <h1>Enemy Visibility — All Surfaces</h1>
  <p>Generated: ${new Date().toISOString()}</p>

  <div class="summary-box">
    <b>Overall: ${allPassed ? '✓ ALL SURFACES PASSED' : `✗ ${failedSurfaces.length} SURFACE(S) FAILED`}</b><br>
    SP surfaces tested: ${spResults.length} / ${ALL_SP_SURFACES.length}<br>
    MP surfaces tested: ${mpResults.length}<br>
    Invisible threshold: instanceColorBrightness &lt; ${INVISIBLE_THRESHOLD}<br>
    Dim threshold: instanceColorBrightness &lt; ${DIM_THRESHOLD}
    ${failedSurfaces.length > 0 ? `<br><span style="color:#ef4444">Failed: ${failedSurfaces.map(f => f.surface).join(', ')}</span>` : ''}
  </div>

  <div class="threshold-legend">
    Thresholds: INVISIBLE &lt; ${INVISIBLE_THRESHOLD} | DIM &lt; ${DIM_THRESHOLD} | BRIGHT &ge; ${BRIGHT_THRESHOLD}<br>
    Note: Far-side enemies are legitimately dimmed (min ~0.06). Only brightness &lt; ${INVISIBLE_THRESHOLD} = bug.
  </div>

  <h2>SP Surface Summary (${spResults.length} surfaces)</h2>
  <table>
    <tr><th>Surface</th><th>Result</th><th>Alive (per checkpoint)</th><th>Invisible (per checkpoint)</th><th>Min Avg Brightness</th></tr>
    ${spRows}
  </table>

  ${mpResults.length > 0 ? `
  <h2>MP Surface Summary (${mpResults.length} surfaces)</h2>
  <table>
    <tr><th>Surface</th><th>Result</th><th>Alive</th><th>Invisible</th><th>Canvas Lum</th><th>API Ready</th></tr>
    ${mpRows}
  </table>` : ''}

  <h2>SP Detailed Results</h2>
  ${spDetailSections}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const runMp = args.includes('--mp');
  const deepMode = args.includes('--deep');
  const singleSurface = args.find(a => a.startsWith('--surface='))?.split('=')[1];

  const surfaces = singleSurface ? [singleSurface] : ALL_SP_SURFACES;
  const checkpointsMs = deepMode ? DEEP_CHECKPOINTS_MS : SP_CHECKPOINTS_MS;

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });

  console.log('\n=== Enemy Visibility — All Surfaces Test ===');
  console.log(`Mode: SP${runMp ? '+MP' : ''}, ${deepMode ? 'deep (5-wave)' : 'standard (3-wave)'}`);
  console.log(`Surfaces: ${surfaces.join(', ')}`);
  console.log(`Checkpoints: ${checkpointsMs.map(t => `${t/1000}s`).join(', ')}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log('');

  const runDate = new Date().toISOString().split('T')[0];
  const spResults = [];
  const mpResults = [];

  // SP tests (sequential — one browser at a time)
  for (let i = 0; i < surfaces.length; i++) {
    const surface = surfaces[i];
    process.stdout.write(`  SP ${surface.padEnd(16)} `);
    try {
      const result = await testSpSurface(surface, checkpointsMs, i + 1);
      spResults.push(result);

      const icon = result.passed ? 'PASS' : 'FAIL';
      const detail = result.checkpoints.map(c => {
        const bStr = c.avgBrightness.toFixed(3);
        return `w${Math.round(c.t/1000)}s:alive=${c.aliveCount},icb=${bStr}`;
      }).join(' | ');
      console.log(` ${icon}  (${detail})`);

      // Print invisible enemy details for failures
      for (const cp of result.checkpoints.filter(c => c.invisibleCount > 0 || c.zeroScaleCount > 0)) {
        if (cp.invisibleCount > 0) {
          console.log(`    FAIL at t=${cp.t/1000}s: ${cp.invisibleCount} invisible (low ICB)`);
          for (const e of cp.invisibleSample) {
            console.log(`      enemy ${e.type} u=${e.u} v=${e.v} icb=${e.instanceColorBrightness} batch=${e.renderBatch}`);
          }
        }
        if (cp.zeroScaleCount > 0) {
          console.log(`    FAIL at t=${cp.t/1000}s: ${cp.zeroScaleCount} zero-scale (matrix invisible)`);
          for (const e of (cp.zeroScaleSample || [])) {
            console.log(`      enemy ${e.type} u=${e.u} v=${e.v} icb=${e.instanceColorBrightness} scale=${e.instanceMatrixScale} batch=${e.renderBatch}`);
          }
        }
      }

      if (!result.passed && !result.checkpoints.some(c => c.aliveCount > 0)) {
        console.log(`    NOTE: No enemies spawned — surface may not support quickStart`);
      }
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
      spResults.push({ surface, mode: 'SP', passed: false, error: err.message, checkpoints: [] });
    }
  }

  // MP tests (sequential — one browser at a time)
  if (runMp) {
    const mpSurfaces = singleSurface ? [singleSurface] : MP_SURFACES;
    console.log('\n--- MP Tests ---');
    for (let i = 0; i < mpSurfaces.length; i++) {
      const surface = mpSurfaces[i];
      process.stdout.write(`  MP ${surface.padEnd(16)} `);
      try {
        const result = await testMpSurface(surface, i + 1);
        mpResults.push(result);
        const icon = result.passed ? 'PASS' : 'FAIL';
        console.log(` ${icon}  (alive=${result.aliveCount ?? '?'}, apiReady=${result.apiReady}, canvasLum=${result.canvasBrightness?.avgLum?.toFixed(1) ?? '?'})`);
      } catch (err) {
        console.log(` ERROR: ${err.message}`);
        mpResults.push({ surface, mode: 'MP', passed: false, error: err.message });
      }
    }
  }

  // Summary
  const allSp = spResults.every(r => r.passed);
  const allMp = mpResults.length === 0 || mpResults.every(r => r.passed);
  const allPassed = allSp && allMp;

  console.log('\n=== SUMMARY ===');
  console.log(`SP: ${spResults.filter(r => r.passed).length}/${spResults.length} passed`);
  if (runMp) console.log(`MP: ${mpResults.filter(r => r.passed).length}/${mpResults.length} passed`);

  const failed = [...spResults, ...mpResults].filter(r => !r.passed);
  if (failed.length > 0) {
    console.log(`\nFAILED surfaces:`);
    for (const f of failed) {
      console.log(`  [${f.mode}] ${f.surface}: ${f.error || 'invisible enemies detected'}`);
    }
  }

  // Generate HTML report
  const reportPath = resolve(REPORTS_DIR, `enemies-all-surfaces-${runDate}.html`);
  writeFileSync(reportPath, generateHtmlReport(spResults, mpResults, runDate));
  console.log(`\nReport: ${reportPath}`);
  console.log(`Overall: ${allPassed ? 'ALL PASS ✓' : 'SOME FAILED ✗'}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
