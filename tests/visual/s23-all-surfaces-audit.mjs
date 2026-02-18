#!/usr/bin/env node
/**
 * s23-all-surfaces-audit.mjs — Comprehensive movement audit across ALL game surfaces.
 *
 * Extends s23-comprehensive-movement-test.mjs to test all 13 surfaces.
 * For each surface: holds W key for 8s, collects positions, runs zigzag detection.
 * Outputs: console summary + HTML report saved to reports/s23-movement-audit-[timestamp].html
 *
 * Categorization:
 *   PASS  — oscillationRatio < 0.25 (smooth movement)
 *   FAIL  — oscillationRatio >= 0.25 (jerky/zigzag movement)
 *   STUCK — player did not move (avgDisplacementMagnitude < 0.001)
 *   ERROR — test setup failed (timeout, crash)
 *
 * Usage:
 *   PORT=3033 node tests/visual/s23-all-surfaces-audit.mjs
 *
 * Surfaces tested (all 13 game surfaces):
 *   sphere, cube, pill, pipe, torus, peanut, capsule, icosahedron,
 *   mobius, sphere-tunnel, cube-ring, cube-tunnel, mobius-bevel
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3033;
const SCREENSHOT_DIR = join(__dirname, '../../test-screenshots/sessions/s23-audit');
const REPORTS_DIR = join(__dirname, '../../reports');
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

// Threshold calibrated from s23-comprehensive-movement-test.mjs
const ZIGZAG_THRESHOLD = 0.25;

// All 13 playable surfaces (URL param names)
const ALL_SURFACES = [
  'sphere',
  'cube',
  'pill',
  'pipe',
  'torus',
  'peanut',
  'capsule',
  'icosahedron',
  'mobius',
  'sphere-tunnel',
  'cube-ring',
  'cube-tunnel',
  'mobius-bevel',
];

// Surface geometry category for pattern analysis
const SURFACE_CATEGORIES = {
  'sphere':       'smooth_curved',
  'cube':         'sharp_edges',
  'pill':         'smooth_curved',
  'pipe':         'tubular',
  'torus':        'smooth_curved',
  'peanut':       'smooth_curved',
  'capsule':      'smooth_curved',
  'icosahedron':  'polyhedral',
  'mobius':       'non_orientable',
  'sphere-tunnel':'smooth_curved',
  'cube-ring':    'sharp_edges',
  'cube-tunnel':  'sharp_edges',
  'mobius-bevel': 'non_orientable',
};

// Make dirs if not present
try { mkdirSync(SCREENSHOT_DIR, { recursive: true }); } catch {}
try { mkdirSync(REPORTS_DIR, { recursive: true }); } catch {}

// ---------------------------------------------------------------------------
// Zigzag detection (same algorithm as s23-comprehensive-movement-test.mjs)
// ---------------------------------------------------------------------------

function len(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }

function detectZigzag(positions, minMagnitude = 0.001, zigzagThreshold = ZIGZAG_THRESHOLD) {
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
 */
async function waitForGameReady(page, timeoutMs = 25000) {
  try {
    await page.waitForFunction(() => {
      const gs = window._gameState;
      if (!gs) return false;
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
  await page.evaluate(() => {
    window._positionCollector = { active: false, positions: [], lastFrame: -1 };
    function collect() {
      const col = window._positionCollector;
      if (!col.active) return;
      const gs = window._gameState;
      if (gs && gs.game.frameCount !== col.lastFrame && !gs.game.isPaused) {
        col.lastFrame = gs.game.frameCount;
        // Collect both walker.position (for zigzag) and player.alive (for stuck detection)
        col.positions.push({
          x: gs.walker.position.x,
          y: gs.walker.position.y,
          z: gs.walker.position.z,
          alive: gs.player.alive,
        });
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

  return page.evaluate(() => {
    window._positionCollector.active = false;
    return window._positionCollector.positions;
  });
}

// ---------------------------------------------------------------------------
// Per-surface audit runner
// ---------------------------------------------------------------------------

async function runSurfaceAudit(page, surface) {
  const url = `http://localhost:${PORT}/?quickStart=true&surface=${surface}&testMode=true`;
  console.log(`\n[audit] Testing: ${surface}`);

  let pageError = null;
  page.removeAllListeners('pageerror');
  page.on('pageerror', err => {
    pageError = err.message;
    console.error(`  [PAGE ERROR] ${err.message.substring(0, 100)}`);
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  const initialState = await waitForGameReady(page, 25000);
  if (!initialState) {
    console.error(`  TIMEOUT: window._gameState not ready`);
    await page.screenshot({ path: join(SCREENSHOT_DIR, `${surface}-timeout.png`) });
    return {
      surface,
      category: SURFACE_CATEGORIES[surface] || 'unknown',
      status: 'ERROR',
      reason: 'timeout: _gameState not ready',
      oscillationRatio: null,
      avgDisplacementMagnitude: null,
      sampleCount: 0,
      pageError,
    };
  }

  console.log(`  Game ready. frameCount=${initialState.game.frameCount}, alive=${initialState.player.alive}`);

  // If player is dead at start, the test is compromised
  if (!initialState.player.alive) {
    console.warn(`  WARNING: Player not alive at game ready — results may be unreliable`);
  }

  await page.screenshot({ path: join(SCREENSHOT_DIR, `${surface}-01-ready.png`) });

  // Collect positions while holding W (8 seconds)
  const rawPositions = await collectPositions(page, 'w', 8000);

  await page.screenshot({ path: join(SCREENSHOT_DIR, `${surface}-02-moved.png`) });

  // Filter out dead frames (player died during collection)
  const positions = rawPositions.filter(p => p.alive !== false);
  const hadDeaths = rawPositions.some(p => p.alive === false);

  console.log(`  Collected ${rawPositions.length} samples (${positions.length} alive)`);
  if (hadDeaths) {
    console.warn(`  WARNING: Player died during collection — some frames filtered`);
  }

  if (positions.length < 5) {
    return {
      surface,
      category: SURFACE_CATEGORIES[surface] || 'unknown',
      status: 'ERROR',
      reason: `too few alive samples: ${positions.length}`,
      oscillationRatio: null,
      avgDisplacementMagnitude: null,
      sampleCount: positions.length,
      pageError,
    };
  }

  const result = detectZigzag(positions, 0.001, ZIGZAG_THRESHOLD);
  const { oscillationRatio, avgDisplacementMagnitude, isZigzag } = result;

  let status;
  if (avgDisplacementMagnitude < 0.001) {
    status = 'STUCK';
  } else if (isZigzag) {
    status = 'FAIL';
  } else {
    status = 'PASS';
  }

  console.log(`  oscillationRatio=${oscillationRatio.toFixed(3)}  avgDisp=${avgDisplacementMagnitude.toFixed(4)}  samples=${positions.length}  → ${status}`);

  return {
    surface,
    category: SURFACE_CATEGORIES[surface] || 'unknown',
    status,
    oscillationRatio,
    avgDisplacementMagnitude,
    sampleCount: positions.length,
    hadDeaths,
    pageError,
    reason: hadDeaths ? 'player died during collection' : null,
  };
}

// ---------------------------------------------------------------------------
// HTML report generator
// ---------------------------------------------------------------------------

function generateHtmlReport(results, totalElapsedMs) {
  const timestamp = new Date().toISOString();
  const date = new Date().toLocaleString();

  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const stuckCount = results.filter(r => r.status === 'STUCK').length;
  const errorCount = results.filter(r => r.status === 'ERROR').length;

  // Sort by oscillationRatio (worst first) for ranking
  const sortedByRatio = [...results]
    .filter(r => r.oscillationRatio !== null)
    .sort((a, b) => b.oscillationRatio - a.oscillationRatio);

  // Group by category
  const categoryGroups = {};
  for (const r of results) {
    if (!categoryGroups[r.category]) categoryGroups[r.category] = [];
    categoryGroups[r.category].push(r);
  }

  // Pattern analysis: do high-curvature surfaces fail more?
  const categoryStats = {};
  for (const [cat, group] of Object.entries(categoryGroups)) {
    const total = group.length;
    const passing = group.filter(g => g.status === 'PASS').length;
    categoryStats[cat] = { total, passing, failRate: ((total - passing) / total * 100).toFixed(0) };
  }

  function statusBadge(status) {
    const colors = { PASS: '#22c55e', FAIL: '#ef4444', STUCK: '#f59e0b', ERROR: '#6b7280' };
    const color = colors[status] || '#6b7280';
    return `<span style="background:${color};color:white;padding:2px 8px;border-radius:4px;font-weight:bold;font-size:0.85em">${status}</span>`;
  }

  function ratioBar(ratio, status) {
    if (ratio === null) return '<em>N/A</em>';
    const pct = Math.min(100, ratio * 250);
    const color = status === 'PASS' ? '#22c55e' : status === 'FAIL' ? '#ef4444' : '#f59e0b';
    return `
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:150px;background:#e5e7eb;border-radius:3px;height:14px">
          <div style="width:${pct}%;background:${color};height:100%;border-radius:3px"></div>
        </div>
        <span style="font-size:0.9em;color:#374151">${ratio.toFixed(3)}</span>
        <span style="font-size:0.75em;color:#9ca3af">(threshold: ${ZIGZAG_THRESHOLD})</span>
      </div>`;
  }

  const tableRows = results.map(r => `
    <tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:10px 12px;font-weight:600">${r.surface}</td>
      <td style="padding:10px 12px;color:#6b7280;font-size:0.85em">${r.category.replace('_', ' ')}</td>
      <td style="padding:10px 12px">${statusBadge(r.status)}</td>
      <td style="padding:10px 12px">${ratioBar(r.oscillationRatio, r.status)}</td>
      <td style="padding:10px 12px;text-align:right;color:#6b7280">${r.avgDisplacementMagnitude !== null ? r.avgDisplacementMagnitude.toFixed(4) : 'N/A'}</td>
      <td style="padding:10px 12px;text-align:right;color:#6b7280">${r.sampleCount}</td>
      <td style="padding:10px 12px;color:#6b7280;font-size:0.8em">${r.reason || ''}</td>
    </tr>`).join('');

  const rankingRows = sortedByRatio.map((r, i) => `
    <tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:8px 12px;font-weight:600">#${i + 1}</td>
      <td style="padding:8px 12px">${r.surface}</td>
      <td style="padding:8px 12px">${statusBadge(r.status)}</td>
      <td style="padding:8px 12px">${r.oscillationRatio.toFixed(3)}</td>
    </tr>`).join('');

  const categoryRows = Object.entries(categoryStats).map(([cat, s]) => `
    <tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:8px 12px;font-weight:600">${cat.replace('_', ' ')}</td>
      <td style="padding:8px 12px">${s.passing}/${s.total} passing</td>
      <td style="padding:8px 12px">${s.failRate}% fail rate</td>
    </tr>`).join('');

  const failedSurfaces = results.filter(r => r.status === 'FAIL');
  const analysisNotes = [];

  if (failedSurfaces.length === 0) {
    analysisNotes.push('✅ All tested surfaces pass movement smoothness threshold (oscillationRatio < 0.25).');
  } else {
    analysisNotes.push(`❌ ${failedSurfaces.length} surface(s) fail movement test: ${failedSurfaces.map(r => r.surface).join(', ')}`);
  }

  const sharpEdgeFails = results.filter(r => r.category === 'sharp_edges' && r.status !== 'PASS');
  const curvedFails = results.filter(r => r.category === 'smooth_curved' && r.status !== 'PASS');
  if (sharpEdgeFails.length > curvedFails.length) {
    analysisNotes.push('📊 Pattern: Sharp-edge surfaces show higher failure rates than smooth curved surfaces.');
  }

  const nonOrientableFails = results.filter(r => r.category === 'non_orientable' && r.status !== 'PASS');
  if (nonOrientableFails.length > 0) {
    analysisNotes.push(`⚠️ Non-orientable surfaces (${nonOrientableFails.map(r => r.surface).join(', ')}) have movement issues.`);
  }

  // Identify worst surfaces for fixing priority
  const fixPriority = results
    .filter(r => r.status === 'FAIL')
    .sort((a, b) => b.oscillationRatio - a.oscillationRatio)
    .map(r => `${r.surface} (${r.oscillationRatio.toFixed(3)})`);

  if (fixPriority.length > 0) {
    analysisNotes.push(`🔧 Fix priority (worst first): ${fixPriority.join(', ')}`);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>S23 Movement Audit — All Surfaces</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #f9fafb; color: #111827; }
    .container { max-width: 1100px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 1.8em; margin-bottom: 4px; }
    .subtitle { color: #6b7280; margin-bottom: 24px; font-size: 0.95em; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
    .stat { background: white; border-radius: 8px; padding: 16px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); min-width: 120px; }
    .stat-value { font-size: 2em; font-weight: 700; }
    .stat-label { color: #6b7280; font-size: 0.85em; }
    .section { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 24px; overflow: hidden; }
    .section-header { padding: 16px 20px; border-bottom: 1px solid #e5e7eb; font-weight: 600; font-size: 1.05em; }
    table { width: 100%; border-collapse: collapse; }
    th { padding: 10px 12px; text-align: left; background: #f3f4f6; font-weight: 600; font-size: 0.85em; color: #374151; }
    .analysis { padding: 20px; }
    .analysis p { margin: 8px 0; line-height: 1.5; }
    .meta { color: #9ca3af; font-size: 0.8em; padding: 16px 20px; }
  </style>
</head>
<body>
<div class="container">
  <h1>S23 Movement Audit — All Surfaces</h1>
  <p class="subtitle">Cross-map movement quality audit using W-key zigzag detection (threshold: ${ZIGZAG_THRESHOLD})<br>
  Generated: ${date} &nbsp;|&nbsp; Total runtime: ${(totalElapsedMs / 1000).toFixed(1)}s &nbsp;|&nbsp; Server: port ${PORT}</p>

  <div class="stats">
    <div class="stat">
      <div class="stat-value" style="color:#22c55e">${passCount}</div>
      <div class="stat-label">PASS</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:#ef4444">${failCount}</div>
      <div class="stat-label">FAIL</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:#f59e0b">${stuckCount}</div>
      <div class="stat-label">STUCK</div>
    </div>
    <div class="stat">
      <div class="stat-value" style="color:#6b7280">${errorCount}</div>
      <div class="stat-label">ERROR</div>
    </div>
    <div class="stat">
      <div class="stat-value">${results.length}</div>
      <div class="stat-label">TOTAL</div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">Results by Surface</div>
    <table>
      <thead>
        <tr>
          <th>Surface</th>
          <th>Category</th>
          <th>Status</th>
          <th>Oscillation Ratio</th>
          <th>Avg Displacement</th>
          <th>Samples</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-header">Severity Ranking (worst oscillation first)</div>
    <table>
      <thead>
        <tr><th>Rank</th><th>Surface</th><th>Status</th><th>Oscillation Ratio</th></tr>
      </thead>
      <tbody>${rankingRows || '<tr><td colspan="4" style="padding:12px;color:#6b7280;text-align:center">No data</td></tr>'}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-header">Analysis by Surface Category</div>
    <table>
      <thead>
        <tr><th>Category</th><th>Pass Rate</th><th>Fail Rate</th></tr>
      </thead>
      <tbody>${categoryRows}</tbody>
    </table>
  </div>

  <div class="section">
    <div class="section-header">Pattern Analysis &amp; Conclusions</div>
    <div class="analysis">
      ${analysisNotes.map(n => `<p>${n}</p>`).join('')}
      <p style="color:#6b7280;margin-top:16px;font-size:0.85em">
        Methodology: Each surface tested with W key (forward movement) held for 8 seconds at SwiftShader ~7fps.
        Zigzag detection measures direction reversals in consecutive displacement vectors.
        Threshold ${ZIGZAG_THRESHOLD}: ratio ≥ ${ZIGZAG_THRESHOLD} = FAIL (jerky), &lt; ${ZIGZAG_THRESHOLD} = PASS (smooth).
        Stuck = total displacement &lt; 0.001 world units.
      </p>
    </div>
  </div>

  <div class="section">
    <div class="section-header">Raw Data</div>
    <div style="padding:16px 20px">
      <pre style="font-size:0.8em;overflow-x:auto;background:#f3f4f6;padding:16px;border-radius:4px">${JSON.stringify(results, null, 2)}</pre>
    </div>
  </div>

  <p class="meta">Generated by tests/visual/s23-all-surfaces-audit.mjs | Session S23 | ${timestamp}</p>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  console.log('[s23-all-surfaces-audit] Starting comprehensive movement audit...');
  console.log(`[audit] Server: http://localhost:${PORT}`);
  console.log(`[audit] Testing ${ALL_SURFACES.length} surfaces: ${ALL_SURFACES.join(', ')}`);
  console.log(`[audit] Threshold: ${ZIGZAG_THRESHOLD} | Key: W | Duration: 8s per surface\n`);

  const browser = await launchBrowser();
  const allResults = [];

  try {
    for (const surface of ALL_SURFACES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });

      try {
        const result = await runSurfaceAudit(page, surface);
        allResults.push(result);
      } catch (err) {
        console.error(`[audit] CRASH on ${surface}: ${err.message}`);
        allResults.push({
          surface,
          category: SURFACE_CATEGORIES[surface] || 'unknown',
          status: 'ERROR',
          reason: `crash: ${err.message}`,
          oscillationRatio: null,
          avgDisplacementMagnitude: null,
          sampleCount: 0,
          pageError: err.message,
        });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }

  const totalElapsedMs = Date.now() - startTime;

  // Console summary
  const elapsed = (totalElapsedMs / 1000).toFixed(1);
  console.log('\n========== S23 ALL-SURFACES AUDIT SUMMARY ==========');
  console.log(`Total time: ${elapsed}s`);
  console.log('');

  const statusOrder = { FAIL: 0, STUCK: 1, ERROR: 2, PASS: 3 };
  const sorted = [...allResults].sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  for (const r of sorted) {
    const icon = r.status === 'PASS' ? '✓' : '✗';
    const ratio = r.oscillationRatio !== null ? `osc=${r.oscillationRatio.toFixed(3)}` : 'osc=N/A';
    const disp = r.avgDisplacementMagnitude !== null ? `disp=${r.avgDisplacementMagnitude.toFixed(4)}` : '';
    console.log(`  ${icon} ${r.status.padEnd(5)}  ${r.surface.padEnd(14)}  ${ratio}  ${disp}  ${r.reason || ''}`);
  }

  const passCount = allResults.filter(r => r.status === 'PASS').length;
  const failCount = allResults.filter(r => r.status === 'FAIL').length;
  const stuckCount = allResults.filter(r => r.status === 'STUCK').length;
  const errorCount = allResults.filter(r => r.status === 'ERROR').length;

  console.log('');
  console.log(`Result: ${passCount} PASS, ${failCount} FAIL, ${stuckCount} STUCK, ${errorCount} ERROR`);
  console.log('=====================================================\n');

  // Generate and save HTML report
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = join(REPORTS_DIR, `s23-movement-audit-${ts}.html`);
  const html = generateHtmlReport(allResults, totalElapsedMs);
  writeFileSync(reportPath, html, 'utf8');
  console.log(`[audit] HTML report saved: ${reportPath}`);

  // Exit with non-zero if any FAIL (not STUCK/ERROR — those are worth investigating)
  const hasFails = failCount > 0;
  process.exit(hasFails ? 1 : 0);
}

main().catch(err => {
  console.error('[s23-all-surfaces-audit] Fatal error:', err);
  process.exit(1);
});
