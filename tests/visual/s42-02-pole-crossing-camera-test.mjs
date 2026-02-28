/**
 * S42-02: Pole Crossing Camera Inversion Test
 *
 * Simulates a player moving toward and across the north pole of a sphere.
 * Verifies camera does NOT invert after crossing.
 *
 * Run with: node tests/visual/s42-02-pole-crossing-camera-test.mjs
 */

import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3020;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = '/tmp/s42-02-screenshots';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait until the canvas is rendering non-black 3D content.
 * Samples multiple pixels across the canvas; passes when enough are non-black.
 */
async function waitForRendering(page, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const hasContent = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return false;
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return false;
      // Sample pixels from the canvas
      const pixels = new Uint8Array(4 * 16);
      // Sample from center area
      const w = canvas.width || 1280;
      const h = canvas.height || 720;
      gl.readPixels(w/2 - 50, h/2 - 50, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      // Count non-black pixels
      let nonBlack = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 10 || pixels[i+1] > 10 || pixels[i+2] > 10) nonBlack++;
      }
      return nonBlack >= 2;
    });
    if (hasContent) return true;
    await sleep(1000);
  }
  return false; // timed out, but don't throw — take screenshot anyway
}

async function runTest() {
  console.log('[S42-02] Starting pole crossing camera inversion test...');
  console.log('[S42-02] Note: SwiftShader is slow (~7fps). Allowing up to 60s for load.');

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

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    // quickStart=true skips the start menu, starts sphere game directly
    const url = `${BASE_URL}?quickStart=true&surface=sphere&seed=12345&debug=true`;
    console.log('[S42-02] Navigating to:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // In quickStart mode, StartMenu.ts is never shown, so the loading screen is never dismissed.
    // Wait 3s for the game to init, then forcibly remove the loading screen overlay.
    console.log('[S42-02] Waiting 3s for initial game load...');
    await sleep(3000);
    await page.evaluate(() => {
      const ls = document.getElementById('loading-screen');
      if (ls) ls.remove();
    });
    console.log('[S42-02] Loading screen dismissed. Waiting 8s for game to fully start...');
    // Wait for game loop to start. SwiftShader ~7 FPS; 8s ≈ ~1 game second (safe before enemies arrive).
    await sleep(8000);

    // Take baseline screenshot — player at starting position
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-baseline.png') });
    console.log('[S42-02] 01-baseline.png taken');

    // Focus and start moving toward north pole
    const canvas = await page.$('canvas');
    if (canvas) {
      await canvas.click();
    }

    // Move toward north pole — hold W key
    // On a sphere, the initial player position is at the equator (v≈0.5)
    // The north pole is at v=0. Moving "forward" (W key) goes in the camera-relative
    // up direction, which on a default sphere camera view is "northward" = toward pole.
    console.log('[S42-02] Pressing W to move toward north pole (6 seconds)...');
    await page.keyboard.down('w');
    await sleep(2000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-approaching.png') });
    console.log('[S42-02] 02-approaching.png taken');

    await sleep(4000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-at-pole.png') });
    console.log('[S42-02] 03-at-pole.png taken (near/at pole)');

    await sleep(4000);
    await page.keyboard.up('w');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-post-crossing.png') });
    console.log('[S42-02] 04-post-crossing.png taken (after pole crossing)');

    // Check camera state if debug API provides it
    const cameraInfo = await page.evaluate(() => {
      const g = window;
      try {
        if (g.__gameDebug && g.__gameDebug.getCameraState) {
          return g.__gameDebug.getCameraState();
        }
        // Try to get camera from raw debug reference
        if (g.__gameDebug && g.__gameDebug.game && g.__gameDebug.game.camera) {
          const cam = g.__gameDebug.game.camera;
          return {
            upX: cam.up.x,
            upY: cam.up.y,
            upZ: cam.up.z,
          };
        }
        return null;
      } catch (e) {
        return { error: e.message };
      }
    });
    console.log('[S42-02] Camera state:', JSON.stringify(cameraInfo));

    // Continue pressing W for more movement (verify player can still move normally)
    console.log('[S42-02] Pressing W again (3s) to verify controls work post-crossing...');
    await page.keyboard.down('w');
    await sleep(3000);
    await page.keyboard.up('w');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-continued-movement.png') });
    console.log('[S42-02] 05-continued-movement.png taken');

    if (errors.length > 0) {
      console.log('\n[S42-02] Browser errors:', errors.slice(0, 5));
    }

    console.log('\n[S42-02] === VISUAL TEST COMPLETE ===');
    console.log('Screenshots saved to:', SCREENSHOT_DIR);
    console.log('\nReview checklist:');
    console.log('  01-baseline.png       — sphere visible, player at start');
    console.log('  02-approaching.png    — player moving toward north pole');
    console.log('  03-at-pole.png        — player at/near pole (no stalling)');
    console.log('  04-post-crossing.png  — player past pole, camera NOT inverted');
    console.log('  05-continued.png      — player moving freely, controls normal');
    console.log('\nPASS: Sphere visible in all shots, camera not flipped in 04-05');
    console.log('FAIL: Sphere appears inside-out or camera flipped in 04-05');

  } finally {
    await browser.close();
    console.log('\n[S42-02] Browser closed.');
  }
}

runTest().catch(err => {
  console.error('[S42-02] Test error:', err);
  process.exit(1);
});
