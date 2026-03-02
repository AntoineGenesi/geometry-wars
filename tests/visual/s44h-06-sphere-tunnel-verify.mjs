/**
 * Visual verification for s44h-06: Sphere-Tunnel Map Clipping Fix
 *
 * Checks that player stays on the outer sphere surface and does not
 * clip through into the tunnel when walking on the sphere-tunnel map.
 *
 * Run from project root: node tests/visual/s44h-06-sphere-tunnel-verify.mjs
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = process.argv[2] || 3048;
const BASE_URL = `http://localhost:${PORT}`;

const SESSION_DIR = path.join(__dirname, '../../test-screenshots/sessions/s44h-06-sphere-tunnel');
fs.mkdirSync(SESSION_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log(`Launching browser (SwiftShader WebGL)...`);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,720',
      '--disable-dev-shm-usage',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

  const logs = [];
  const errors = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') errors.push(text);
  });
  page.on('pageerror', err => errors.push('PageError: ' + err.message));

  const url = `${BASE_URL}/?quickStart=true&surface=sphere-tunnel`;
  console.log(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for game to initialize (SwiftShader is slow)
  await sleep(8000);

  // Screenshot 1: Initial state - player should be on outer sphere
  const shot1 = path.join(SESSION_DIR, '01-initial.png');
  await page.screenshot({ path: shot1 });
  console.log(`Screenshot 1 (initial): ${shot1}`);

  // Get player world position
  const state1 = await page.evaluate(() => {
    const g = window.__gameDebug;
    if (g && g.player) {
      const pos = g.player.mesh.position;
      const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
      return {
        x: pos.x.toFixed(3),
        y: pos.y.toFixed(3),
        z: pos.z.toFixed(3),
        distFromCenter: dist.toFixed(3),
        surfaceU: g.player.surfaceU?.toFixed(3),
        surfaceV: g.player.surfaceV?.toFixed(3),
      };
    }
    // Fall back to perf log
    const log = window.__perfLog;
    if (log && log.length > 0) {
      const latest = log[log.length - 1];
      return { perfLog: latest };
    }
    return { error: 'no game debug available' };
  });
  console.log('Player state 1:', JSON.stringify(state1));

  // Check: player distance from center should be ~radius (8) for outer sphere
  // If player is in tunnel, distance from Y axis would be ~2 and |y| < 7
  const dist1 = parseFloat(state1?.distFromCenter ?? '0');
  const playerX1 = parseFloat(state1?.x ?? '0');
  const playerY1 = parseFloat(state1?.y ?? '0');
  const playerZ1 = parseFloat(state1?.z ?? '0');
  const rXZ1 = Math.sqrt(playerX1 * playerX1 + playerZ1 * playerZ1);

  console.log(`Distance from center: ${dist1.toFixed(3)} (expect ~8 for outer sphere)`);
  console.log(`XZ radius: ${rXZ1.toFixed(3)} (expect >2 for outer sphere, ~2 = in tunnel)`);

  // Move player around the sphere (press WASD)
  console.log('Moving player toward top of sphere (W key)...');
  await page.keyboard.down('w');
  await sleep(3000);  // Hold W for 3 seconds
  await page.keyboard.up('w');
  await sleep(1000);

  // Screenshot 2: After moving toward pole
  const shot2 = path.join(SESSION_DIR, '02-after-moving-up.png');
  await page.screenshot({ path: shot2 });
  console.log(`Screenshot 2 (after moving up): ${shot2}`);

  const state2 = await page.evaluate(() => {
    const g = window.__gameDebug;
    if (g && g.player) {
      const pos = g.player.mesh.position;
      const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
      return {
        x: pos.x.toFixed(3),
        y: pos.y.toFixed(3),
        z: pos.z.toFixed(3),
        distFromCenter: dist.toFixed(3),
        surfaceU: g.player.surfaceU?.toFixed(3),
        surfaceV: g.player.surfaceV?.toFixed(3),
      };
    }
    const log = window.__perfLog;
    if (log && log.length > 0) {
      const latest = log[log.length - 1];
      return { perfLog: latest };
    }
    return { error: 'no game debug available' };
  });
  console.log('Player state 2:', JSON.stringify(state2));

  const dist2 = parseFloat(state2?.distFromCenter ?? '0');
  const playerX2 = parseFloat(state2?.x ?? '0');
  const playerY2 = parseFloat(state2?.y ?? '0');
  const playerZ2 = parseFloat(state2?.z ?? '0');
  const rXZ2 = Math.sqrt(playerX2 * playerX2 + playerZ2 * playerZ2);

  console.log(`After moving - Distance from center: ${dist2.toFixed(3)}`);
  console.log(`After moving - XZ radius: ${rXZ2.toFixed(3)}`);

  // Analysis
  console.log('\n=== VERIFICATION ANALYSIS ===');

  const SPHERE_RADIUS = 8;
  const TUNNEL_RADIUS = 2;
  const CLIPPING_THRESHOLD = 4; // If XZ radius < 4 and |y| < 7, likely in tunnel

  let passed = true;
  const issues = [];

  // Check 1: Initial position on outer sphere
  if (dist1 > 1 && dist1 < SPHERE_RADIUS * 0.8) {
    issues.push(`Initial position too close to center (dist=${dist1.toFixed(2)}, expected ~${SPHERE_RADIUS})`);
    passed = false;
  }
  if (rXZ1 < CLIPPING_THRESHOLD && Math.abs(playerY1) < 7) {
    issues.push(`Player appears to be in tunnel at start (XZ radius=${rXZ1.toFixed(2)}, expected >4 for outer sphere)`);
    passed = false;
  }

  // Check 2: After moving, still on outer sphere (not clipped into tunnel)
  if (rXZ2 < CLIPPING_THRESHOLD && Math.abs(playerY2) < 7) {
    issues.push(`Player clipped into tunnel after moving (XZ radius=${rXZ2.toFixed(2)}, expected >4 for outer sphere)`);
    passed = false;
  }

  if (issues.length === 0) {
    console.log('✓ PASS: Player stayed on outer sphere surface');
    console.log(`  Initial: dist=${dist1.toFixed(2)}, XZ=${rXZ1.toFixed(2)}`);
    console.log(`  After moving: dist=${dist2.toFixed(2)}, XZ=${rXZ2.toFixed(2)}`);
  } else {
    console.log('✗ FAIL: Clipping detected:');
    issues.forEach(i => console.log(`  - ${i}`));
    passed = false;
  }

  if (errors.length > 0) {
    console.log('\nConsole errors (first 5):');
    errors.slice(0, 5).forEach(e => console.log('  ', e));
  }

  await browser.close();

  console.log(`\nVerdict: ${passed ? 'PASS' : 'FAIL'}`);
  console.log(`Screenshots saved to: ${SESSION_DIR}`);

  return passed;
}

run().then(passed => {
  process.exit(passed ? 0 : 1);
}).catch(e => {
  console.error('Test error:', e.message);
  process.exit(1);
});
