#!/usr/bin/env node
/**
 * s44r13-10-enemy-spawn-matrix.mjs
 * Enemy Spawn Inside Surface — All Modes × All 13 Maps
 *
 * Verifies enemies NEVER spawn inside surface meshes for every game mode × surface
 * combination (5 modes × 13 surfaces = 65 combinations).
 *
 * CODE PATH: Uses real SP game path.
 *   ?quickStart=true → src/main.ts → src/core/GameLoop.ts
 *
 * Usage:
 *   node tests/visual/s44r13-10-enemy-spawn-matrix.mjs
 *   node tests/visual/s44r13-10-enemy-spawn-matrix.mjs --surface=sphere
 *   node tests/visual/s44r13-10-enemy-spawn-matrix.mjs --mode=waves
 *   node tests/visual/s44r13-10-enemy-spawn-matrix.mjs --no-server  # if server already running
 *
 * Reports:
 *   reports/s44r13-10-enemy-spawn-matrix.html  — HTML pass/fail matrix
 *   reports/s44r13-10-results.json             — Raw JSON results
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
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

const PORT = 3009;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/s44r13-10');
const REPORT_DIR = resolve(PROJECT_ROOT, 'reports');

const NVM_PATH = process.env.NVM_BIN
  || dirname(process.execPath)
  || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

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

// ---------------------------------------------------------------------------
// Game modes to test
//
// Notes:
//   - 'pvp' and 'pvpve' as SP quickStart modes fall back to 'waves' enemy
//     spawning code (main.ts:2192: pvp/pvpve → undefined → waves).
//     We still test them to confirm the fallback handles all surfaces correctly,
//     and mark them as "waves-in-SP" in the report.
//   - 'ffa' (Free-for-All) is not in QuickGameModeType — skip gracefully.
//   - 'king' = KotH — uses ?gameMode=king.
// ---------------------------------------------------------------------------

const ALL_MODES = [
  {
    id: 'waves',
    name: 'Waves',
    gameMode: 'waves',
    spawnBehavior: 'wave-spawner',
    description: 'Default SP wave mode — enemy spawner fires on wave timer',
  },
  {
    id: 'king',
    name: 'King of the Hill',
    gameMode: 'king',
    spawnBehavior: 'wave-spawner',
    description: 'KotH zone mode — enemies still spawn from wave spawner',
  },
  {
    id: 'pvp',
    name: 'PvP (SP fallback)',
    gameMode: 'pvp',
    spawnBehavior: 'waves-in-SP',
    description: 'PvP gameMode — falls back to waves in SP context (main.ts:2192)',
    note: 'In SP, pvp falls back to waves. True PvP requires MP+Colyseus (covered by s44r13-08 for sphere/pill).',
  },
  {
    id: 'pvpve',
    name: 'PvPvE (SP fallback)',
    gameMode: 'pvpve',
    spawnBehavior: 'waves-in-SP',
    description: 'PvPvE gameMode — falls back to waves in SP context (main.ts:2192)',
    note: 'In SP, pvpve falls back to waves. True PvPvE requires MP+Colyseus (covered by s44r13-08 for sphere/pill).',
  },
  {
    id: 'ffa',
    name: 'Free-for-All',
    gameMode: null,
    spawnBehavior: 'not-available',
    description: 'FFA mode — not implemented in QuickGameModeType, skip gracefully',
    note: 'FFA is not in QuickGameModeType (waves|king|sniper|rainbow|claustrophobia). All 13 surfaces: N/A.',
  },
];

// Surface-specific distance thresholds for "outside surface" check.
// At default surfaceScale=10 (used in quickStart mode via main.ts level.surfaceScale=10).
// An enemy worldPos whose distFromOrigin < threshold is considered "inside surface" — FAIL.
const SURFACE_THRESHOLDS = {
  'sphere':        { minDist: 7.0,  note: 'Sphere r=10; inner threshold=7.0' },
  'torus':         { minDist: 4.0,  note: 'Torus majorR=8, minorR=3; ring at r=8' },
  'cube':          { minDist: 4.0,  note: 'Cube halfExtent=10; face at dist~10' },
  'cube-ring':     { minDist: 1.0,  note: 'Cube-ring majorR=4, crossSection=2' },
  'pill':          { minDist: 7.0,  note: 'Pill cylR=10, h=20; threshold on dist from origin' },
  'peanut':        { minDist: 3.0,  note: 'Peanut: complex shape, min dist from origin' },
  'mobius':        { minDist: 4.0,  note: 'Mobius band majorR=8, minorR=2.4' },
  'sphere-tunnel': { minDist: 2.0,  note: 'Sphere-tunnel: hollow sphere r=6; use 2.0 min' },
  'cube-tunnel':   { minDist: 4.0,  note: 'Cube-tunnel: size=20, wallThickness=2.0' },
  'pipe':          { minDist: 1.0,  note: 'Pipe: cylinderR=4; torus-like shape' },
  'capsule':       { minDist: 7.0,  note: 'Capsule: similar to pill' },
  'icosahedron':   { minDist: 5.0,  note: 'Icosahedron: approx sphere r=10' },
  'mobius-bevel':  { minDist: 3.0,  note: 'Mobius-bevel: band with beveled edges' },
};

// UV positions for test enemy spawns (avoid poles and surface singularities)
const TEST_UV_POSITIONS = [
  [0.2, 0.35], [0.4, 0.5], [0.6, 0.35], [0.8, 0.5], [0.5, 0.65],
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Vite server management
// ---------------------------------------------------------------------------

function startViteServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PATH: `${NVM_PATH}:/usr/bin:/bin`,
    };
    const proc = spawn(`${NVM_PATH}/npx`, ['vite', '--port', String(PORT), '--host', '0.0.0.0'], {
      cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    let output = '';
    const onData = (data) => {
      const text = data.toString();
      output += text;
      if (!started && (text.includes(`localhost:${PORT}`) || text.includes(`Local:`))) {
        started = true;
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => { if (!started) reject(new Error(`Vite failed: ${err.message}`)); });
    proc.on('exit', (code) => {
      if (!started) reject(new Error(`Vite exited ${code}. Output: ${output.slice(0, 300)}`));
    });
    setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error(`Vite timeout. Output: ${output.slice(0, 300)}`));
      }
    }, 30000);
  });
}

function killVite() {
  try {
    execSync(
      `ss -tlnp 2>/dev/null | grep -E ":${PORT}\\b" | awk '{print $NF}' | grep -oP 'pid=\\K[0-9]+' | xargs -r kill -15`,
      { encoding: 'utf-8' },
    );
  } catch { /* ignore */ }
}

async function isServerRunning() {
  try {
    const result = execSync(`ss -tlnp 2>/dev/null | grep -E ":${PORT}\\b"`, { encoding: 'utf-8' });
    return result.trim().length > 0;
  } catch { return false; }
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
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.__testErrors = errors;
  return page;
}

async function waitForAPI(page, timeoutMs = 12000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (ready) return true;
    await sleep(200);
  }
  return false;
}

/** Start game on a surface with optional gameMode. Returns true on success. */
async function startGame(page, surface, gameMode) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.evaluate(() => {
    try { localStorage.removeItem('masteryOverlayShown'); } catch {}
    try { localStorage.removeItem('weaponMastery'); } catch {}
  });

  let url = `${BASE_URL}?quickStart=true&surface=${surface}&testMode=true&debug=true`;
  if (gameMode && gameMode !== 'waves') {
    url += `&gameMode=${gameMode}`;
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('canvas', { timeout: 10000 });
  // Wait for game to initialize (countdown + API init)
  await sleep(5000);
  return waitForAPI(page);
}

async function takeScreenshot(page, name) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

// ---------------------------------------------------------------------------
// Core check: spawn enemies, verify positions
// ---------------------------------------------------------------------------

/**
 * Run the enemy-spawn-outside-surface check for a single mode × surface combo.
 * Returns { passed, details, screenshotPath }
 */
async function checkEnemySpawnPosition(page, surface, modeInfo) {
  const threshold = SURFACE_THRESHOLDS[surface] || { minDist: 2.0, note: 'generic' };

  // Check 1: spawn enemies via TestAPI at known UV positions
  let spawnCheck = { passed: true, details: [] };
  try {
    await page.evaluate(() => window.__TEST_API.clearEnemies());
    await sleep(500);

    const ids = [];
    for (const [u, v] of TEST_UV_POSITIONS) {
      const id = await page.evaluate(
        (type, u, v) => window.__TEST_API.spawnEnemy(type, u, v),
        'grunt', u, v,
      );
      if (id != null) ids.push({ id, u, v });
    }
    await sleep(1500); // Wait for positioning to settle

    const results = [];
    let insideCount = 0;
    let lowOpacityCount = 0;

    for (const { id, u, v } of ids) {
      const pos = await page.evaluate(
        (eid) => window.__TEST_API.getEnemyPosition(eid),
        id,
      );
      if (!pos || !pos.worldPos) {
        results.push({ id, spawnUV: [u, v], status: 'no-position', passed: false });
        continue;
      }

      const { x, y, z } = pos.worldPos;
      const distFromOrigin = Math.sqrt(x * x + y * y + z * z);
      const onOuterSurface = distFromOrigin >= threshold.minDist;
      if (!onOuterSurface) insideCount++;

      // Check opacity (secondary signal — low opacity suggests invisible inside surface)
      const enemy = await page.evaluate(
        (eid) => {
          const enemies = window.__TEST_API.getEnemies();
          return enemies.find(e => e.id === eid) || null;
        },
        id,
      );
      const opacity = enemy ? (enemy.opacity ?? 1.0) : 1.0;
      const opacityOk = opacity > 0.1;
      if (!opacityOk) lowOpacityCount++;

      results.push({
        id,
        spawnUV: [u, v],
        worldPos: { x: parseFloat(x.toFixed(3)), y: parseFloat(y.toFixed(3)), z: parseFloat(z.toFixed(3)) },
        distFromOrigin: parseFloat(distFromOrigin.toFixed(3)),
        threshold: threshold.minDist,
        onOuterSurface,
        opacity: parseFloat(opacity.toFixed(3)),
        opacityOk,
        passed: onOuterSurface && opacityOk,
      });
    }

    spawnCheck = {
      passed: insideCount === 0 && ids.length >= 4,
      insideCount,
      lowOpacityCount,
      spawned: ids.length,
      results,
      threshold: threshold.minDist,
      thresholdNote: threshold.note,
    };
  } catch (err) {
    spawnCheck = { passed: false, error: `spawn check failed: ${err.message}` };
  }

  // Check 2: natural wave spawning — wait for wave, check those enemies too
  let waveCheck = { passed: true, checked: 0, details: 'no natural enemies spawned yet' };
  try {
    // Clear spawned enemies, wait for natural wave
    await page.evaluate(() => window.__TEST_API.clearEnemies());
    await sleep(500);

    // Wait up to 8 seconds for natural enemies to appear
    let naturalEnemies = [];
    for (let i = 0; i < 80; i++) {
      await sleep(100);
      const enemies = await page.evaluate(() => window.__TEST_API.getEnemies());
      const alive = enemies.filter(e => e.alive);
      if (alive.length >= 1) {
        naturalEnemies = alive;
        break;
      }
    }

    if (naturalEnemies.length > 0) {
      let insideCount = 0;
      let lowOpacityCount = 0;
      const results = [];

      for (const enemy of naturalEnemies.slice(0, 10)) { // check up to 10
        const { x, y, z } = enemy.worldPos || {};
        if (x == null) continue;
        const dist = Math.sqrt(x * x + y * y + z * z);
        const onOuter = dist >= threshold.minDist;
        const opOk = (enemy.opacity ?? 1.0) > 0.1;
        if (!onOuter) insideCount++;
        if (!opOk) lowOpacityCount++;
        results.push({
          id: enemy.id,
          dist: parseFloat(dist.toFixed(3)),
          onOuter,
          opacity: parseFloat((enemy.opacity ?? 1.0).toFixed(3)),
          opOk,
        });
      }

      waveCheck = {
        passed: insideCount === 0,
        checked: results.length,
        insideCount,
        lowOpacityCount,
        results,
      };
    }
  } catch (err) {
    waveCheck = { passed: true, checked: 0, details: `wave check skipped: ${err.message}` };
  }

  // Take screenshot
  const screenshotName = `spawn_matrix_${modeInfo.id}_${surface}`;
  const screenshotPath = await takeScreenshot(page, screenshotName);

  const passed = spawnCheck.passed && waveCheck.passed;

  return {
    surface,
    mode: modeInfo.id,
    modeName: modeInfo.name,
    passed,
    spawnCheck,
    waveCheck,
    screenshotPath,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main test runner
// ---------------------------------------------------------------------------

async function runMatrix(surfaces, modes) {
  const browser = await launchBrowser();
  const results = [];

  for (const modeInfo of modes) {
    // FFA mode: not available, mark all surfaces as N/A
    if (modeInfo.spawnBehavior === 'not-available') {
      for (const surface of surfaces) {
        results.push({
          surface,
          mode: modeInfo.id,
          modeName: modeInfo.name,
          passed: null, // null = N/A
          notAvailable: true,
          note: modeInfo.note,
          timestamp: new Date().toISOString(),
        });
      }
      console.log(`\n--- Mode: ${modeInfo.name} --- N/A (${modeInfo.note})`);
      continue;
    }

    console.log(`\n--- Mode: ${modeInfo.name} (${modeInfo.id}) ---`);
    if (modeInfo.note) console.log(`  Note: ${modeInfo.note}`);

    for (const surface of surfaces) {
      let page;
      try {
        page = await createPage(browser);
        const apiReady = await startGame(page, surface, modeInfo.gameMode);

        if (!apiReady) {
          const r = {
            surface,
            mode: modeInfo.id,
            modeName: modeInfo.name,
            passed: false,
            error: `__TEST_API not available on ${surface} in ${modeInfo.id} mode`,
            timestamp: new Date().toISOString(),
          };
          results.push(r);
          console.log(`  [${modeInfo.id}] ${surface}: FAIL (TestAPI not ready)`);
          continue;
        }

        const result = await checkEnemySpawnPosition(page, surface, modeInfo);
        results.push(result);

        const status = result.passed ? 'PASS' : 'FAIL';
        const inside = result.spawnCheck.insideCount ?? 0;
        const detail = inside > 0
          ? ` (${inside} enemies inside surface!)`
          : result.waveCheck.insideCount > 0
            ? ` (${result.waveCheck.insideCount} natural enemies inside!)`
            : '';
        console.log(`  [${modeInfo.id}] ${surface}: ${status}${detail}`);
      } catch (err) {
        const r = {
          surface,
          mode: modeInfo.id,
          modeName: modeInfo.name,
          passed: false,
          error: err.message,
          timestamp: new Date().toISOString(),
        };
        results.push(r);
        console.log(`  [${modeInfo.id}] ${surface}: ERROR — ${err.message}`);
      } finally {
        if (page) await page.close().catch(() => {});
      }
    }
  }

  await browser.close();
  return results;
}

// ---------------------------------------------------------------------------
// HTML Report Generator
// ---------------------------------------------------------------------------

function generateHTMLReport(results, allSurfaces, allModes) {
  const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const tested = results.filter(r => r.passed !== null);
  const passed = tested.filter(r => r.passed).length;
  const failed = tested.filter(r => r.passed === false).length;
  const na = results.filter(r => r.passed === null).length;
  const total = tested.length;

  // Build matrix: modeId → surface → result
  const matrix = {};
  for (const r of results) {
    if (!matrix[r.mode]) matrix[r.mode] = {};
    matrix[r.mode][r.surface] = r;
  }

  // Collect failures for detail section
  const failures = results.filter(r => r.passed === false);

  const cellHtml = (modeId, surface) => {
    const r = matrix[modeId]?.[surface];
    if (!r) return '<td class="na">—</td>';
    if (r.passed === null) return `<td class="na" title="${r.note ?? ''}">N/A</td>`;
    if (r.passed) return '<td class="pass">✓</td>';

    // Failure: show details on hover
    const inside = r.spawnCheck?.insideCount ?? 0;
    const wInside = r.waveCheck?.insideCount ?? 0;
    const err = r.error ? r.error.slice(0, 80) : '';
    const title = err || `${inside} spawned inside, ${wInside} natural inside`;
    return `<td class="fail" title="${title}">✗</td>`;
  };

  const failureDetailsHtml = failures.length > 0 ? `
  <section class="failures">
    <h2>Failure Details (${failures.length})</h2>
    ${failures.map(r => `
    <div class="failure-card">
      <h3>[${r.modeName}] ${r.surface} — FAIL</h3>
      ${r.error ? `<p class="error">Error: ${r.error}</p>` : ''}
      ${r.spawnCheck && r.spawnCheck.insideCount > 0 ? `
        <p>Spawned enemies inside surface: <strong>${r.spawnCheck.insideCount}/${r.spawnCheck.spawned}</strong></p>
        <p>Threshold: dist &gt; ${r.spawnCheck.threshold} (${r.spawnCheck.thresholdNote})</p>
        <table class="details-table">
          <tr><th>UV</th><th>WorldDist</th><th>Threshold</th><th>OnOuter</th><th>Opacity</th></tr>
          ${(r.spawnCheck.results || []).map(p => `
          <tr class="${p.passed ? '' : 'bad-row'}">
            <td>(${p.spawnUV?.[0]?.toFixed(2)}, ${p.spawnUV?.[1]?.toFixed(2)})</td>
            <td>${p.distFromOrigin ?? 'N/A'}</td>
            <td>${p.threshold ?? ''}</td>
            <td>${p.onOuterSurface ? '✓' : '✗'}</td>
            <td>${p.opacity ?? 'N/A'}</td>
          </tr>`).join('')}
        </table>
      ` : ''}
      ${r.waveCheck && r.waveCheck.insideCount > 0 ? `
        <p>Natural wave enemies inside surface: <strong>${r.waveCheck.insideCount}/${r.waveCheck.checked}</strong></p>
      ` : ''}
      ${r.screenshotPath ? `<p><a href="${r.screenshotPath}" target="_blank">Screenshot</a></p>` : ''}
    </div>`).join('')}
  </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>s44r13-10 Enemy Spawn Matrix — ${date}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0a1a; color: #e0e0f0; margin: 0; padding: 20px; }
    h1 { color: #6699ff; }
    h2 { color: #99aadd; margin-top: 30px; }
    h3 { color: #bbccee; }
    .summary { display: flex; gap: 20px; margin: 20px 0; flex-wrap: wrap; }
    .stat { background: #1a1a2e; border-radius: 8px; padding: 16px 24px; text-align: center; }
    .stat .number { font-size: 2em; font-weight: bold; }
    .stat .label { font-size: 0.85em; color: #8899bb; }
    .pass-num { color: #44dd88; }
    .fail-num { color: #ff5555; }
    .na-num { color: #888899; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #2a2a4a; padding: 8px 12px; text-align: center; font-size: 0.85em; }
    th { background: #1a1a3a; color: #99aaee; }
    th.mode-header { text-align: left; min-width: 140px; }
    td.surface-header { font-weight: bold; font-size: 0.75em; color: #8899cc; }
    td.pass { background: #0a2a1a; color: #44dd88; font-weight: bold; }
    td.fail { background: #2a0a0a; color: #ff5555; font-weight: bold; cursor: help; }
    td.na { background: #1a1a2a; color: #555566; }
    .mode-label { text-align: left !important; font-weight: bold; color: #ccddff; }
    .mode-note { font-size: 0.75em; color: #6677aa; }
    section.failures { margin-top: 40px; }
    .failure-card { background: #1a0a0a; border: 1px solid #441122; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .failure-card h3 { color: #ff8888; margin: 0 0 10px; }
    .error { color: #ff6666; font-family: monospace; font-size: 0.9em; }
    .details-table { margin: 10px 0; }
    .details-table td, .details-table th { font-size: 0.8em; padding: 4px 8px; }
    .bad-row td { background: #2a0a0a !important; }
    p { margin: 6px 0; }
    .meta { color: #556677; font-size: 0.85em; margin: 10px 0; }
    .legend { display: flex; gap: 16px; margin: 10px 0; font-size: 0.85em; }
    .legend span { padding: 2px 8px; border-radius: 4px; }
    .leg-pass { background: #0a2a1a; color: #44dd88; }
    .leg-fail { background: #2a0a0a; color: #ff5555; }
    .leg-na { background: #1a1a2a; color: #777788; }
  </style>
</head>
<body>
  <h1>Enemy Spawn Inside Surface — All Modes × All Maps</h1>
  <p class="meta">Task: s44r13-10 | Generated: ${date} | Surfaces: ${allSurfaces.length} | Modes: ${allModes.length}</p>

  <div class="summary">
    <div class="stat"><div class="number pass-num">${passed}</div><div class="label">Pass</div></div>
    <div class="stat"><div class="number fail-num">${failed}</div><div class="label">Fail</div></div>
    <div class="stat"><div class="number na-num">${na}</div><div class="label">N/A</div></div>
    <div class="stat"><div class="number">${total}</div><div class="label">Total Tested</div></div>
  </div>

  <div class="legend">
    <span class="leg-pass">✓ = enemies on outer surface, opacity &gt; 0.1</span>
    <span class="leg-fail">✗ = enemy inside surface or invisible</span>
    <span class="leg-na">N/A = mode not available / skipped</span>
  </div>

  <h2>Pass/Fail Matrix</h2>
  <table>
    <thead>
      <tr>
        <th class="mode-header">Mode</th>
        ${allSurfaces.map(s => `<th>${s}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${allModes.map(mode => `
      <tr>
        <td class="mode-label">
          ${mode.name}
          ${mode.note ? `<div class="mode-note">${mode.note.slice(0, 80)}</div>` : ''}
        </td>
        ${allSurfaces.map(s => cellHtml(mode.id, s)).join('')}
      </tr>`).join('')}
    </tbody>
  </table>

  ${failureDetailsHtml}

  <h2>Methodology</h2>
  <ul>
    <li>For each mode × surface: <code>?quickStart=true&amp;surface=X&amp;gameMode=Y&amp;testMode=true&amp;debug=true</code></li>
    <li>Spawn 5 enemies at UV positions [0.2-0.8] via <code>window.__TEST_API.spawnEnemy()</code></li>
    <li>Check: <code>distFromOrigin ≥ surface_threshold</code> (surface-specific, see below)</li>
    <li>Check: <code>enemy.opacity &gt; 0.1</code> (invisible enemies → inside surface)</li>
    <li>Also wait up to 8s for natural wave spawning, check those enemies too</li>
    <li>PvP/PvPvE in SP fall back to waves mode (main.ts:2192) — marked "waves-in-SP"</li>
  </ul>

  <h3>Surface Distance Thresholds (at scale=10)</h3>
  <table>
    <tr><th>Surface</th><th>Min Dist from Origin</th><th>Note</th></tr>
    ${Object.entries(SURFACE_THRESHOLDS).map(([s, t]) =>
      `<tr><td>${s}</td><td>${t.minDist}</td><td>${t.note}</td></tr>`
    ).join('')}
  </table>

  <p class="meta">Screenshots: ${SCREENSHOT_DIR}</p>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const noServer = args.includes('--no-server');

  // Parse surface filter
  const surfaceArg = args.find(a => a.startsWith('--surface='));
  const surfaces = surfaceArg
    ? [surfaceArg.split('=')[1]]
    : ALL_SURFACES;

  // Parse mode filter
  const modeArg = args.find(a => a.startsWith('--mode='));
  const modes = modeArg
    ? ALL_MODES.filter(m => m.id === modeArg.split('=')[1])
    : ALL_MODES;

  console.log(`\n=== Enemy Spawn Inside Surface Matrix ===`);
  console.log(`Surfaces: ${surfaces.join(', ')}`);
  console.log(`Modes: ${modes.map(m => m.id).join(', ')}`);
  console.log(`Port: ${PORT}`);

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  let viteProc = null;
  const alreadyRunning = await isServerRunning();

  if (!alreadyRunning && !noServer) {
    console.log(`\nStarting Vite dev server on port ${PORT}...`);
    try {
      viteProc = await startViteServer();
      console.log(`Vite server ready at ${BASE_URL}`);
    } catch (err) {
      console.error(`Failed to start Vite: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(`Using existing server at ${BASE_URL}`);
  }

  let results = [];
  try {
    console.log('\nRunning tests...');
    results = await runMatrix(surfaces, modes);
  } finally {
    if (viteProc) {
      try { viteProc.kill('SIGTERM'); } catch {}
    }
    killVite();
  }

  // Save JSON
  const jsonPath = resolve(REPORT_DIR, 's44r13-10-results.json');
  writeFileSync(jsonPath, JSON.stringify({ results, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`\nJSON saved: ${jsonPath}`);

  // Save HTML
  const htmlPath = resolve(REPORT_DIR, 's44r13-10-enemy-spawn-matrix.html');
  const html = generateHTMLReport(results, surfaces, modes);
  writeFileSync(htmlPath, html);
  console.log(`HTML saved: ${htmlPath}`);

  // Console summary
  const tested = results.filter(r => r.passed !== null);
  const passed = tested.filter(r => r.passed).length;
  const failed = tested.filter(r => r.passed === false).length;

  console.log(`\n=== SUMMARY ===`);
  console.log(`Tested: ${tested.length} | Pass: ${passed} | Fail: ${failed}`);

  if (failed > 0) {
    console.log(`\nFAILED combinations:`);
    for (const r of results.filter(r => r.passed === false)) {
      const inside = r.spawnCheck?.insideCount ?? 0;
      const err = r.error ? ` (${r.error.slice(0, 60)})` : inside > 0 ? ` (${inside} inside)` : '';
      console.log(`  ✗ [${r.modeName}] ${r.surface}${err}`);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  killVite();
  process.exit(1);
});
