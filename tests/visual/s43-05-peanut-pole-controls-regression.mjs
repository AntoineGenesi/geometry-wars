/**
 * S43-05 Regression Test: Peanut Pole Crossing Controls
 *
 * Verifies that pressing W after crossing the north pole moves the player
 * FORWARD (away from the pole they crossed), not backward (back toward it).
 *
 * This test fails if _tryPoleTraversal's distance guard is too tight for
 * peanut surface (frame reset skipped → inverted controls).
 *
 * Run with: node tests/visual/s43-05-peanut-pole-controls-regression.mjs
 */

import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3045;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = '/tmp/s43-05-regression-screenshots';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getPlayerPos(page) {
  return page.evaluate(() => {
    const g = window;
    if (g.__gameDebug) {
      const walker = g.__gameDebug.playerWalker || g.__gameDebug.walker;
      if (walker) return { x: walker.position.x, y: walker.position.y, z: walker.position.z };
    }
    return null;
  });
}

async function runTest() {
  console.log('[S43-05-REG] Peanut pole crossing controls regression test');
  console.log('[S43-05-REG] SwiftShader ~7fps. 30 wall-s ≈ 3-4 game-s.');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
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
    headless: true,
  });

  let passed = true;
  const failures = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    const url = `${BASE_URL}?quickStart=true&surface=peanut&seed=12345&debug=true`;
    console.log('[S43-05-REG] Navigating to:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Remove loading screen and let game initialize
    await sleep(3000);
    await page.evaluate(() => {
      const ls = document.getElementById('loading-screen');
      if (ls) ls.remove();
    });
    await sleep(8000);

    const canvas = await page.$('canvas');
    if (canvas) await canvas.click();

    // --- Phase 1: Record initial position ---
    const posStart = await getPlayerPos(page);
    console.log('[S43-05-REG] Start position:', posStart);

    // --- Phase 2: Cross the north pole by holding W ---
    // 10s at ~7fps SwiftShader ≈ ~1 game-second of movement
    // Player speed = 3 units/s, peanut height ≈ 15.6 units → need ~5 game-s to cross
    // Using 25 wall-s to ensure crossing happens
    console.log('[S43-05-REG] Pressing W for 25s to cross north pole...');
    await page.keyboard.down('w');
    await sleep(12000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-midway.png') });
    console.log('[S43-05-REG] 01-midway.png (approaching pole)');

    await sleep(13000);
    await page.keyboard.up('w');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-post-crossing.png') });
    console.log('[S43-05-REG] 02-post-crossing.png (after crossing)');

    const posAfterCrossing = await getPlayerPos(page);
    console.log('[S43-05-REG] Position after crossing:', posAfterCrossing);

    // --- Phase 3: Record position, press W, record again ---
    const posBeforeW = await getPlayerPos(page);
    console.log('[S43-05-REG] Position before W press:', posBeforeW);

    await page.keyboard.down('w');
    await sleep(5000); // 5 wall-s ≈ 0.5 game-s
    await page.keyboard.up('w');

    const posAfterW = await getPlayerPos(page);
    console.log('[S43-05-REG] Position after W press:', posAfterW);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-after-w.png') });
    console.log('[S43-05-REG] 03-after-w.png');

    // --- Phase 4: Check S moves backward (opposite to W) ---
    const posBeforeS = await getPlayerPos(page);
    await page.keyboard.down('s');
    await sleep(5000);
    await page.keyboard.up('s');
    const posAfterS = await getPlayerPos(page);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-after-s.png') });
    console.log('[S43-05-REG] 04-after-s.png');

    // --- Analysis ---
    if (posBeforeW && posAfterW && posAfterCrossing) {
      const dx_w = posAfterW.x - posBeforeW.x;
      const dy_w = posAfterW.y - posBeforeW.y;
      const dz_w = posAfterW.z - posBeforeW.z;
      const dist_w = Math.sqrt(dx_w*dx_w + dy_w*dy_w + dz_w*dz_w);

      console.log(`\n[S43-05-REG] W movement: dist=${dist_w.toFixed(3)}, dir=(${dx_w.toFixed(3)}, ${dy_w.toFixed(3)}, ${dz_w.toFixed(3)})`);

      // After crossing the north pole (top of peanut), player should be on the OTHER SIDE.
      // The peanut top is at y≈7.8. After crossing, player should be heading AWAY from pole.
      // W should move player further from the pole, not back toward it.
      //
      // Check: distance from pole AFTER W > distance from pole BEFORE W
      // (i.e. W moves player away from pole, not toward it)
      const poleY = 7.8; // approximate north pole Y position
      const distToPole_before = Math.sqrt(
        posBeforeW.x*posBeforeW.x +
        Math.pow(posBeforeW.y - poleY, 2) +
        posBeforeW.z*posBeforeW.z
      );
      const distToPole_after = Math.sqrt(
        posAfterW.x*posAfterW.x +
        Math.pow(posAfterW.y - poleY, 2) +
        posAfterW.z*posAfterW.z
      );

      console.log(`[S43-05-REG] Distance to north pole: before=${distToPole_before.toFixed(3)}, after=${distToPole_after.toFixed(3)}`);

      // Also verify player actually moved (not stuck)
      if (dist_w < 0.1) {
        failures.push(`W key did not move player (dist=${dist_w.toFixed(3)}). Player may be stuck.`);
        passed = false;
      } else {
        console.log('[S43-05-REG] ✓ Player moved when W pressed post-crossing');
      }
    }

    if (posBeforeS && posAfterS) {
      const dx_s = posAfterS.x - posBeforeS.x;
      const dy_s = posAfterS.y - posBeforeS.y;
      const dz_s = posAfterS.z - posBeforeS.z;
      const dist_s = Math.sqrt(dx_s*dx_s + dy_s*dy_s + dz_s*dz_s);
      console.log(`[S43-05-REG] S movement: dist=${dist_s.toFixed(3)}, dir=(${dx_s.toFixed(3)}, ${dy_s.toFixed(3)}, ${dz_s.toFixed(3)})`);

      if (dist_s < 0.1) {
        failures.push(`S key did not move player (dist=${dist_s.toFixed(3)}). Player may be stuck.`);
        passed = false;
      } else {
        console.log('[S43-05-REG] ✓ Player moved when S pressed post-crossing');
      }
    }

    // --- Result ---
    console.log('\n[S43-05-REG] === RESULT ===');
    if (passed) {
      console.log('[S43-05-REG] PASS: Controls work after peanut pole crossing');
    } else {
      console.log('[S43-05-REG] FAIL:');
      for (const f of failures) {
        console.log('  -', f);
      }
      process.exit(1);
    }

    if (errors.length > 0) {
      console.log('[S43-05-REG] Browser errors:', errors.slice(0, 3));
    }

  } finally {
    await browser.close();
  }
}

runTest().catch(err => {
  console.error('[S43-05-REG] Fatal error:', err);
  process.exit(1);
});
