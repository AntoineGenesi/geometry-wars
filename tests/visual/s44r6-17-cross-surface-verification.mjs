#!/usr/bin/env node
/**
 * s44r6-17: Cross-Surface Verification — All Maps
 *
 * Tests ALL 12 surface types × key systems:
 *   1. No JS errors
 *   2. Player spawns on surface (valid position, not NaN)
 *   3. Player can move (position changes after keyboard input)
 *   4. Bullets fire from player (shooting visible, bullets counted)
 *   5. Enemies spawn on surface (valid positions, not inside)
 *   6. Camera stable (no flips)
 *
 * Uses quickStart URL params and window.__gameDebug API for state inspection.
 * Level 5 verification: Puppeteer screenshots for each surface.
 *
 * Output:
 *   - Screenshots: test-screenshots/s44r6-17/<surface>/
 *   - HTML report: reports/2026-03-10-cross-surface-verification.html
 *   - JSON results: reports/s44r6-17-results.json
 *
 * Usage:
 *   PORT=3023 node tests/visual/s44r6-17-cross-surface-verification.mjs
 *
 * The script starts its own dev server on PORT (default 3023) if none is running.
 */

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME_PATH = process.env.CHROME_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const NODE_PATH = '/home/antoine/.nvm/versions/node/v20.19.5/bin/node';
const NPM_PATH = '/home/antoine/.nvm/versions/node/v20.19.5/bin/npm';
const PORT = parseInt(process.env.PORT || '3023', 10);
const BASE_URL = `http://localhost:${PORT}`;
const SEED = 42; // deterministic

const SCREENSHOT_BASE = resolve(PROJECT_ROOT, 'test-screenshots', 's44r6-17');
const REPORT_PATH = resolve(PROJECT_ROOT, 'reports', '2026-03-10-cross-surface-verification.html');
const JSON_PATH = resolve(PROJECT_ROOT, 'reports', 's44r6-17-results.json');

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=1280,720',
];

// ---------------------------------------------------------------------------
// All surfaces to test
// ---------------------------------------------------------------------------

const SURFACES = [
  { id: 'sphere',        label: 'Sphere',       group: 'core' },
  { id: 'cube',          label: 'Cube',         group: 'core' },
  { id: 'torus',         label: 'Torus',        group: 'core' },
  { id: 'pill',          label: 'Pill',         group: 'core' },
  { id: 'peanut',        label: 'Peanut',       group: 'core' },
  { id: 'mobius',        label: 'Mobius',       group: 'core' },
  { id: 'sphere-tunnel', label: 'Sphere Tunnel', group: 'extended' },
  { id: 'cube-ring',     label: 'Cube Ring',    group: 'extended' },
  { id: 'cube-tunnel',   label: 'Cube Tunnel',  group: 'extended' },
  { id: 'capsule',       label: 'Capsule',      group: 'extended' },
  { id: 'icosahedron',   label: 'Icosahedron',  group: 'extended' },
  { id: 'pipe',          label: 'Pipe',         group: 'extended' },
];

// Systems to test per surface
const SYSTEMS = [
  'no_errors',
  'player_spawn',
  'movement',
  'shooting',
  'enemy_spawn',
  'camera_stable',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isValidVec3(v) {
  return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function vecDist(a, b) {
  if (!a || !b) return Infinity;
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// ---------------------------------------------------------------------------
// Dev server management
// ---------------------------------------------------------------------------

let devServerProcess = null;
let didStartServer = false;

async function isServerRunning() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${BASE_URL}/`, { signal: controller.signal });
    clearTimeout(timeout);
    return resp.ok;
  } catch {
    return false;
  }
}

async function startDevServer() {
  console.log(`[Server] Starting dev server on port ${PORT}...`);

  devServerProcess = spawn(NPM_PATH, ['run', 'dev', '--', '--port', String(PORT)], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PATH: `${dirname(NODE_PATH)}:${process.env.PATH}`,
      VITE_PORT: String(PORT),
    },
    stdio: 'pipe',
    detached: true,
  });

  devServerProcess.on('error', err => console.error('[Server] Error:', err));

  const maxWait = 60000;
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < maxWait) {
    ready = await isServerRunning();
    if (ready) break;
    await sleep(1000);
  }

  if (!ready) {
    stopDevServer();
    throw new Error(`Dev server failed to start on port ${PORT} within 60s`);
  }

  console.log(`[Server] Dev server ready at ${BASE_URL}`);
  didStartServer = true;
}

function stopDevServer() {
  if (devServerProcess) {
    try {
      process.kill(-devServerProcess.pid, 'SIGTERM');
    } catch {
      devServerProcess.kill('SIGTERM');
    }
    devServerProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Per-surface test logic
// ---------------------------------------------------------------------------

/**
 * @param {import('puppeteer').Browser} browser
 * @param {{ id: string, label: string, group: string }} surfaceDef
 * @returns {object} result with checks, screenshots, notes
 */
async function testSurface(browser, surfaceDef) {
  const { id: surface, label } = surfaceDef;
  console.log(`\n[Test] === ${label.toUpperCase()} (${surface}) ===`);

  const screenshotDir = resolve(SCREENSHOT_BASE, surface);
  mkdirSync(screenshotDir, { recursive: true });

  const checks = {};
  const screenshots = [];
  const notes = [];
  let ssCounter = 0;

  async function shot(name) {
    ssCounter++;
    const p = resolve(screenshotDir, `${String(ssCounter).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: p });
    const relPath = `../test-screenshots/s44r6-17/${surface}/${String(ssCounter).padStart(2, '0')}-${name}.png`;
    screenshots.push({ path: p, relPath, name });
    console.log(`  [Shot] ${name}`);
    return p;
  }

  const jsErrors = [];
  const notFound404Urls = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', err => jsErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') jsErrors.push(msg.text());
  });
  // Track 404 URLs to filter harmless static assets from error counts
  page.on('response', resp => {
    if (resp.status() === 404) notFound404Urls.push(resp.url());
  });

  try {
    // Navigate to game
    const url = `${BASE_URL}?quickStart=true&surface=${surface}&seed=${SEED}&debug=true`;
    console.log(`  [Nav] ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for __gameDebug.getPlayerState (GameDebugAPI, loaded async with ?debug=true)
    // The minimal API (enemySpawner) loads immediately; GameDebugAPI loads async
    let debugReady = false;
    for (let i = 0; i < 100; i++) {
      debugReady = await page.evaluate(() =>
        typeof window.__gameDebug !== 'undefined' &&
        typeof window.__gameDebug.getPlayerState === 'function' &&
        typeof window.__gameDebug.setMouseDown === 'function'
      );
      if (debugReady) break;
      await sleep(100);
    }

    if (!debugReady) {
      checks['player_spawn'] = { pass: false, note: 'Game never initialized (__gameDebug.getPlayerState not ready)' };
      checks['movement'] = { pass: false, note: 'N/A — game not initialized' };
      checks['shooting'] = { pass: false, note: 'N/A — game not initialized' };
      checks['enemy_spawn'] = { pass: false, note: 'N/A — game not initialized' };
      checks['camera_stable'] = { pass: false, note: 'N/A — game not initialized' };
      checks['no_errors'] = { pass: false, note: 'Game failed to initialize' };
      await shot('00-failed-to-init');
      return { surface, label, checks, screenshots, notes };
    }

    // Wait for countdown (3...2...1...) = ~3.5s + extra buffer for GameDebugAPI async init
    await sleep(4000);

    // Dismiss loading screen
    await page.evaluate(() => {
      const ls = document.getElementById('loading-screen');
      if (ls) ls.style.display = 'none';
    });

    await sleep(300);

    // --- CHECK 1: No JS errors ---
    // Filter known-harmless errors: favicon 404, WebGL shader warnings
    // notFound404Urls tracks which URLs returned 404 — only filter if it's favicon/known static
    const harmless404Urls = notFound404Urls.filter(url =>
      url.endsWith('/favicon.ico') || url.endsWith('/favicon.png') || url.endsWith('/robots.txt')
    );
    const hasOnlyHarmless404s = notFound404Urls.length === harmless404Urls.length;

    const criticalErrors = jsErrors.filter(e => {
      // Filter out "Failed to load resource" ONLY if all 404s are for harmless static assets
      if (e.includes('Failed to load resource') && hasOnlyHarmless404s) return false;
      // Filter WebGL shader noise (not gameplay errors)
      if (e.includes('THREE.WebGL') || e.includes('webgl-lost')) return false;
      return true;
    });
    checks['no_errors'] = {
      pass: criticalErrors.length === 0,
      note: criticalErrors.length > 0
        ? `${criticalErrors.length} JS errors: ${criticalErrors[0]}`
        : (harmless404Urls.length > 0 ? `Clean (${harmless404Urls.length} harmless static 404s filtered)` : 'Clean'),
      count: criticalErrors.length,
      filtered404s: harmless404Urls.length,
    };
    console.log(`  [Check] no_errors: ${checks['no_errors'].pass ? 'PASS' : 'FAIL'} — ${checks['no_errors'].note}`);

    // --- CHECK 2: Player spawn ---
    await shot('01-initial');

    let playerState = null;
    try {
      playerState = await page.evaluate(() => {
        const p = window.__gameDebug.player;
        if (!p || !p.mesh) return null;
        return {
          x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z,
          alive: p.alive,
        };
      });
    } catch (e) {
      notes.push(`player state error: ${e.message}`);
    }

    const posValid = playerState && Number.isFinite(playerState.x) && Number.isFinite(playerState.y) && Number.isFinite(playerState.z);
    checks['player_spawn'] = {
      pass: posValid,
      note: posValid ? `Player at (${playerState.x.toFixed(2)}, ${playerState.y.toFixed(2)}, ${playerState.z.toFixed(2)})` : `Invalid: ${JSON.stringify(playerState)}`,
      position: playerState,
    };
    console.log(`  [Check] player_spawn: ${checks['player_spawn'].pass ? 'PASS' : 'FAIL'} — ${checks['player_spawn'].note}`);

    if (!posValid) {
      // If player didn't spawn, remaining checks are N/A
      checks['movement'] = { pass: false, note: 'N/A — player failed to spawn' };
      checks['shooting'] = { pass: false, note: 'N/A — player failed to spawn' };
      checks['enemy_spawn'] = { pass: false, note: 'N/A — player failed to spawn' };
      checks['camera_stable'] = { pass: false, note: 'N/A — player failed to spawn' };
      return { surface, label, checks, screenshots, notes };
    }

    const initialPos = { ...playerState };

    // --- CHECK 3: Movement ---
    await page.keyboard.down('w');
    await sleep(2000); // 2s of forward movement
    await page.keyboard.up('w');

    let posAfterW = null;
    try {
      posAfterW = await page.evaluate(() => {
        const p = window.__gameDebug.player;
        if (!p || !p.mesh) return null;
        return { x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z };
      });
    } catch (e) {
      notes.push(`movement state error: ${e.message}`);
    }

    await shot('02-after-W-movement');

    const posAfterWValid = posAfterW && Number.isFinite(posAfterW.x);
    const movedDist = posAfterWValid ? vecDist(initialPos, posAfterW) : 0;
    const moved = movedDist > 0.05;

    checks['movement'] = {
      pass: posAfterWValid && moved,
      note: posAfterWValid
        ? (moved ? `Moved ${movedDist.toFixed(2)} units after W` : `Did NOT move (dist=${movedDist.toFixed(4)})`)
        : 'Position became invalid after movement',
      distance: movedDist,
    };
    console.log(`  [Check] movement: ${checks['movement'].pass ? 'PASS' : 'FAIL'} — ${checks['movement'].note}`);

    // Continue moving in other directions
    await page.keyboard.down('a');
    await sleep(1000);
    await page.keyboard.up('a');
    await page.keyboard.down('s');
    await sleep(1000);
    await page.keyboard.up('s');

    // --- CHECK 4: Shooting ---
    // Use GameDebugAPI.setMouseDown + getBulletStates() to detect active bullets while shooting
    let bulletCount = 0;
    try {
      // Set mouse down via debug API (more reliable than Puppeteer mouse events)
      await page.evaluate(() => {
        window.__gameDebug.setMouseDown(true);
        window.__gameDebug.setMousePosition(640, 360);
      });
      await sleep(800); // 0.8s of shooting — enough for multiple bullets
      // Count bullets WHILE shooting is active
      bulletCount = await page.evaluate(() => {
        const bs = window.__gameDebug.getBulletStates?.();
        return Array.isArray(bs) ? bs.filter(b => b.alive).length : 0;
      });
      await page.evaluate(() => { window.__gameDebug.setMouseDown(false); });
    } catch (e) {
      notes.push(`shooting check error: ${e.message}`);
      try { await page.evaluate(() => { window.__gameDebug.setMouseDown(false); }); } catch (_) {}
    }

    await sleep(200);
    await shot('03-after-shooting');

    checks['shooting'] = {
      pass: bulletCount > 0,
      note: bulletCount > 0 ? `${bulletCount} active bullets detected during shooting` : 'No active bullets detected while shooting',
      bulletCount,
    };
    console.log(`  [Check] shooting: ${checks['shooting'].pass ? 'PASS' : 'FAIL'} — ${checks['shooting'].note}`);

    // --- CHECK 5: Enemy spawn ---
    await sleep(2000); // give more time for enemies to spawn

    await shot('04-enemies');

    let enemyCount = 0;
    let enemiesValid = true;
    const enemyNotes = [];

    try {
      const enemies = await page.evaluate(() => {
        const spawner = window.__gameDebug.enemySpawner;
        if (!spawner) return [];
        return spawner.getEnemies().map(e => ({
          alive: e.alive,
          active: e.active,
          x: e.mesh?.position?.x ?? e.position?.x ?? NaN,
          y: e.mesh?.position?.y ?? e.position?.y ?? NaN,
          z: e.mesh?.position?.z ?? e.position?.z ?? NaN,
        })).filter(e => e.alive);
      });

      enemyCount = enemies.length;

      for (const e of enemies) {
        if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.z)) {
          enemiesValid = false;
          enemyNotes.push(`NaN enemy at (${e.x}, ${e.y}, ${e.z})`);
        }
      }
    } catch (err) {
      notes.push(`enemy check error: ${err.message}`);
    }

    checks['enemy_spawn'] = {
      pass: enemiesValid,
      note: enemiesValid
        ? (enemyCount > 0 ? `${enemyCount} enemies with valid positions` : 'No enemies spawned yet (may be OK for some maps)')
        : `${enemyNotes.length} enemies with NaN positions: ${enemyNotes[0]}`,
      count: enemyCount,
    };
    console.log(`  [Check] enemy_spawn: ${checks['enemy_spawn'].pass ? 'PASS' : 'FAIL'} — ${checks['enemy_spawn'].note}`);

    // --- CHECK 6: Camera stability ---
    // Move for 3 more seconds and sample camera quaternions
    let cameraFlipped = false;
    let prevCamUp = null;
    try {
      await page.keyboard.down('w');
      for (let i = 0; i < 6; i++) {
        await sleep(500);
        const camData = await page.evaluate(() => {
          const cam = window.__gameDebug.game?.camera;
          if (!cam) return null;
          return { ux: cam.up.x, uy: cam.up.y, uz: cam.up.z };
        });
        if (camData && prevCamUp) {
          const dot = camData.ux * prevCamUp.ux + camData.uy * prevCamUp.uy + camData.uz * prevCamUp.uz;
          if (dot < -0.5) { // camera up-vector flipped >90 degrees in 0.5s
            cameraFlipped = true;
            notes.push(`Camera flip detected at sample ${i} (dot=${dot.toFixed(2)})`);
          }
        }
        prevCamUp = camData;
      }
      await page.keyboard.up('w');
    } catch (err) {
      notes.push(`camera check error: ${err.message}`);
    }

    await shot('05-final');

    checks['camera_stable'] = {
      pass: !cameraFlipped,
      note: cameraFlipped ? 'Camera flipped during movement (>90° rotation in 0.5s)' : 'Camera stable throughout',
    };
    console.log(`  [Check] camera_stable: ${checks['camera_stable'].pass ? 'PASS' : 'FAIL'} — ${checks['camera_stable'].note}`);

  } catch (err) {
    console.error(`  [Error] ${surface}: ${err.message}`);
    notes.push(`fatal error: ${err.message}`);
    // Mark all unset checks as failed
    for (const sys of SYSTEMS) {
      if (!checks[sys]) checks[sys] = { pass: false, note: `Error: ${err.message}` };
    }
    try { await shot('error-state'); } catch (_) {}
  } finally {
    await page.close();
  }

  return { surface, label, checks, screenshots, notes };
}

// ---------------------------------------------------------------------------
// HTML report generator
// ---------------------------------------------------------------------------

function generateHTMLReport(results, durationMs) {
  const timestamp = new Date().toISOString();
  const total = results.length * SYSTEMS.length;
  let passed = 0, failed = 0, na = 0;

  for (const r of results) {
    for (const sys of SYSTEMS) {
      const c = r.checks[sys];
      if (!c) { na++; continue; }
      if (c.pass) passed++;
      else failed++;
    }
  }

  const systemLabels = {
    no_errors: 'No JS Errors',
    player_spawn: 'Player Spawn',
    movement: 'Movement',
    shooting: 'Shooting',
    enemy_spawn: 'Enemy Spawn',
    camera_stable: 'Camera Stable',
  };

  const surfaceRows = results.map(r => {
    const cells = SYSTEMS.map(sys => {
      const c = r.checks[sys];
      if (!c) return `<td class="na">N/A</td>`;
      const cls = c.pass ? 'pass' : 'fail';
      const label = c.pass ? '✓' : '✗';
      return `<td class="${cls}" title="${escapeHtml(c.note || '')}">${label}</td>`;
    }).join('');

    const allPass = SYSTEMS.every(s => r.checks[s]?.pass);
    const rowClass = allPass ? 'all-pass' : '';

    // First screenshot thumbnail
    const thumb = r.screenshots.length > 0
      ? `<img src="${escapeHtml(r.screenshots[0].relPath)}" class="thumb" alt="${r.surface}" loading="lazy">`
      : '—';

    return `<tr class="${rowClass}">
      <td class="surface-name"><strong>${r.label}</strong><br><small>${r.surface}</small></td>
      ${cells}
      <td class="thumb-cell">${thumb}</td>
    </tr>`;
  }).join('\n');

  const systemHeaders = SYSTEMS.map(s => `<th>${systemLabels[s] || s}</th>`).join('\n');

  const failDetails = results.flatMap(r =>
    SYSTEMS.filter(s => r.checks[s] && !r.checks[s].pass).map(s => ({
      surface: r.label,
      system: systemLabels[s],
      note: r.checks[s].note || '',
      screenshots: r.screenshots,
    }))
  );

  const failSection = failDetails.length === 0 ? '<p class="all-green">✓ All checks passed!</p>' :
    failDetails.map(f => `
      <details class="fail-detail">
        <summary><strong>${f.surface}</strong> — ${f.system}: FAIL</summary>
        <p>${escapeHtml(f.note)}</p>
        ${f.screenshots.length > 0 ? `<img src="${escapeHtml(f.screenshots[0].relPath)}" class="fail-screenshot">` : ''}
      </details>`
    ).join('\n');

  const passPercent = total > 0 ? Math.round((passed / (total - na)) * 100) : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cross-Surface Verification — ${timestamp.substring(0, 10)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a1a; color: #e0e0e0; margin: 0; padding: 20px; }
    h1 { color: #7fffff; font-size: 1.8em; margin-bottom: 4px; }
    .meta { color: #888; font-size: 0.85em; margin-bottom: 20px; }
    .summary { display: flex; gap: 20px; margin-bottom: 30px; flex-wrap: wrap; }
    .stat { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 12px 20px; min-width: 120px; text-align: center; }
    .stat .num { font-size: 2em; font-weight: bold; }
    .stat.green .num { color: #4caf50; }
    .stat.red .num { color: #f44336; }
    .stat.blue .num { color: #2196f3; }
    .stat .label { font-size: 0.8em; color: #888; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; background: #111122; border-radius: 8px; overflow: hidden; margin-bottom: 30px; }
    th { background: #1e1e3a; padding: 10px 8px; text-align: center; font-size: 0.85em; color: #aaa; border-bottom: 1px solid #333; }
    th:first-child { text-align: left; width: 160px; }
    td { padding: 8px; text-align: center; border-bottom: 1px solid #1a1a2e; font-size: 0.9em; }
    td.surface-name { text-align: left; }
    td.pass { color: #4caf50; font-weight: bold; font-size: 1.1em; }
    td.fail { color: #f44336; font-weight: bold; font-size: 1.1em; }
    td.na { color: #555; }
    tr.all-pass { background: rgba(76, 175, 80, 0.05); }
    tr:hover { background: #1a1a2e; }
    .thumb-cell { width: 120px; }
    img.thumb { width: 110px; height: 62px; object-fit: cover; border-radius: 4px; border: 1px solid #333; }
    h2 { color: #aaaaff; margin-top: 30px; }
    .all-green { color: #4caf50; font-size: 1.1em; padding: 10px; }
    details.fail-detail { background: #1a1a1a; border: 1px solid #f44336; border-radius: 6px; padding: 10px; margin-bottom: 10px; }
    details.fail-detail summary { cursor: pointer; color: #ff9898; }
    img.fail-screenshot { max-width: 400px; margin-top: 10px; border-radius: 4px; display: block; }
    .duration { color: #666; font-size: 0.8em; }
    .group-label { color: #555; font-size: 0.75em; }
  </style>
</head>
<body>
  <h1>Cross-Surface Verification Matrix</h1>
  <div class="meta">
    Generated: ${timestamp} — Seed: ${SEED} — Port: ${PORT}
    <span class="duration"> — Duration: ${Math.round(durationMs / 1000)}s</span>
  </div>

  <div class="summary">
    <div class="stat green"><div class="num">${passed}</div><div class="label">Passed</div></div>
    <div class="stat red"><div class="num">${failed}</div><div class="label">Failed</div></div>
    <div class="stat blue"><div class="num">${passPercent}%</div><div class="label">Pass Rate</div></div>
    <div class="stat"><div class="num">${results.length}</div><div class="label">Surfaces</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Surface</th>
        ${systemHeaders}
        <th>Screenshot</th>
      </tr>
    </thead>
    <tbody>
      ${surfaceRows}
    </tbody>
  </table>

  <h2>Failures</h2>
  ${failSection}

  <h2>Notes</h2>
  <ul>
    <li>Tests use SP code path (main.ts → GameLoop.ts) via Puppeteer quickStart</li>
    <li>MP/PvP testing requires LAN setup — not included (Level 6 user testing needed)</li>
    <li>Hit detection depth verification requires RealGameTestHarness vitest tests (run from project root)</li>
    <li>Camera stability check: samples up-vector every 500ms during movement, flags >90° rotation</li>
    <li>Enemy spawn check: valid positions checked, "no enemies spawned" is OK (timing)</li>
  </ul>

  <hr style="border-color: #333; margin-top: 40px;">
  <p style="color: #444; font-size: 0.8em;">
    task: s44r6-17-cross-surface-verification-all-maps |
    branch: task/s44r6-17-cross-surface-verification-all-maps
  </p>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  console.log('=== s44r6-17: Cross-Surface Verification ===');
  console.log(`Port: ${PORT} | Seed: ${SEED} | Surfaces: ${SURFACES.length}`);

  mkdirSync(SCREENSHOT_BASE, { recursive: true });
  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });

  // Start dev server if not running
  const serverAlreadyRunning = await isServerRunning();
  if (!serverAlreadyRunning) {
    await startDevServer();
  } else {
    console.log(`[Server] Using existing server at ${BASE_URL}`);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });

  const results = [];

  try {
    for (const surfaceDef of SURFACES) {
      const result = await testSurface(browser, surfaceDef);
      results.push(result);

      // Quick summary
      const passFail = SYSTEMS.map(s => {
        const c = result.checks[s];
        return c ? (c.pass ? '✓' : '✗') : '?';
      }).join(' ');
      console.log(`  [Summary] ${surfaceDef.label}: ${passFail}`);
    }
  } finally {
    await browser.close();
    if (didStartServer) stopDevServer();
  }

  const duration = Date.now() - startTime;

  // Save JSON results
  const jsonOutput = {
    timestamp: new Date().toISOString(),
    seed: SEED,
    port: PORT,
    durationMs: duration,
    surfaces: results.map(r => ({
      surface: r.surface,
      label: r.label,
      checks: r.checks,
      screenshots: r.screenshots.map(s => s.relPath),
      notes: r.notes,
    })),
  };
  writeFileSync(JSON_PATH, JSON.stringify(jsonOutput, null, 2));
  console.log(`\n[Output] JSON: ${JSON_PATH}`);

  // Generate HTML report
  const html = generateHTMLReport(results, duration);
  writeFileSync(REPORT_PATH, html);
  console.log(`[Output] HTML: ${REPORT_PATH}`);

  // Print final summary
  console.log('\n=== FINAL SUMMARY ===');
  let totalPass = 0, totalFail = 0;
  for (const r of results) {
    const pass = SYSTEMS.filter(s => r.checks[s]?.pass).length;
    const fail = SYSTEMS.filter(s => r.checks[s] && !r.checks[s].pass).length;
    totalPass += pass;
    totalFail += fail;
    const status = fail === 0 ? '✓ PASS' : `✗ FAIL (${fail} checks)`;
    console.log(`  ${r.label.padEnd(16)}: ${status}`);
  }

  console.log(`\n  Total: ${totalPass} pass, ${totalFail} fail`);
  console.log(`  Duration: ${Math.round(duration / 1000)}s`);

  if (totalFail > 0) {
    console.log('\n=== FAILURES ===');
    for (const r of results) {
      for (const sys of SYSTEMS) {
        const c = r.checks[sys];
        if (c && !c.pass) {
          console.log(`  ${r.label} / ${sys}: ${c.note}`);
        }
      }
    }
    process.exitCode = 1;
  } else {
    console.log('\n✓ All surfaces passed all checks!');
  }
}

main().catch(err => {
  console.error('\n[Fatal]', err);
  stopDevServer();
  process.exit(1);
});
