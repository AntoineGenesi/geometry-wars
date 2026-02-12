#!/usr/bin/env node

/**
 * S15: Player Movement Fix — Visual Verification
 *
 * Tests for:
 * 1. No crash after 1+ seconds of movement
 * 2. Forward/backward movement works (W/S keys)
 * 3. Side movement works (A/D keys)
 * 4. No jitter or 90-degree snaps
 * 5. Smooth diagonal movement
 *
 * Expected PASSING state:
 * - Player visible and moving smoothly in all 4 directions
 * - No orientation snaps or jitter
 * - Game runs for 10+ seconds without crashing
 * - No NaN errors in console
 *
 * Expected FAILING state:
 * - Game crashes after ~1 second
 * - Player jitters or snaps orientation
 * - Side keys (A/D) don't move player
 * - Console shows NaN errors
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const screenshotDir = join(__dirname, 'screenshots');

const PORT = process.env.PORT || 3024;
const URL = `http://localhost:${PORT}/`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('[S15 Movement Test] Starting visual test...');
  console.log(`[S15 Movement Test] Server URL: ${URL}`);

  const browser = await puppeteer.launch({
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
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

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Capture console messages and errors
  const consoleMessages = [];
  const errors = [];

  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push(text);
    if (text.includes('NaN') || text.includes('undefined') || text.includes('Error')) {
      console.log('[CONSOLE]', text);
      errors.push(text);
    }
  });

  page.on('pageerror', err => {
    console.log('[PAGE ERROR]', err.toString());
    errors.push(err.toString());
  });

  try {
    console.log('[S15 Movement Test] Navigating to game...');
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

    console.log('[S15 Movement Test] Waiting for start menu...');
    await sleep(4000); // Wait for start menu to render

    console.log('[S15 Movement Test] Taking screenshot: start-menu');
    await page.screenshot({ path: join(screenshotDir, 's15-player-movement-01-start-menu.png') });

    // Start game: Click QUICK GAME
    console.log('[S15 Movement Test] Clicking QUICK GAME...');
    await page.click('[data-mode="single"]');
    await sleep(1000);

    // Click START button to begin game on default surface (Sphere)
    console.log('[S15 Movement Test] Clicking START...');
    await page.evaluate(() => {
      const btn = document.querySelector('#surface-start-btn');
      if (btn) btn.click();
    });
    await sleep(5000); // Wait for countdown + game initialization

    console.log('[S15 Movement Test] Taking screenshot: game-start');
    await page.screenshot({ path: join(screenshotDir, 's15-player-movement-02-game-start.png') });

    // TEST 1: Move forward (W key) — should move smoothly without crash
    console.log('[S15 Movement Test] TEST 1: Moving forward (W)...');
    await page.keyboard.down('w');
    await sleep(2000); // Hold for 2 seconds (was crashing after ~1 second)
    await page.keyboard.up('w');
    await sleep(500);

    console.log('[S15 Movement Test] Taking screenshot: after-forward');
    await page.screenshot({ path: join(screenshotDir, 's15-player-movement-03-after-forward.png') });

    // TEST 2: Move backward (S key)
    console.log('[S15 Movement Test] TEST 2: Moving backward (S)...');
    await page.keyboard.down('s');
    await sleep(1500);
    await page.keyboard.up('s');
    await sleep(500);

    console.log('[S15 Movement Test] Taking screenshot: after-backward');
    await page.screenshot({ path: join(screenshotDir, 's15-player-movement-04-after-backward.png') });

    // TEST 3: Move left (A key) — user reports this changes camera angle but doesn't move player
    console.log('[S15 Movement Test] TEST 3: Moving left (A)...');
    await page.keyboard.down('a');
    await sleep(1500);
    await page.keyboard.up('a');
    await sleep(500);

    console.log('[S15 Movement Test] Taking screenshot: after-left');
    await page.screenshot({ path: join(screenshotDir, 's15-player-movement-05-after-left.png') });

    // TEST 4: Move right (D key)
    console.log('[S15 Movement Test] TEST 4: Moving right (D)...');
    await page.keyboard.down('d');
    await sleep(1500);
    await page.keyboard.up('d');
    await sleep(500);

    console.log('[S15 Movement Test] Taking screenshot: after-right');
    await page.screenshot({ path: join(screenshotDir, 's15-player-movement-06-after-right.png') });

    // TEST 5: Diagonal movement (W+D)
    console.log('[S15 Movement Test] TEST 5: Moving diagonally (W+D)...');
    await page.keyboard.down('w');
    await page.keyboard.down('d');
    await sleep(1500);
    await page.keyboard.up('w');
    await page.keyboard.up('d');
    await sleep(500);

    console.log('[S15 Movement Test] Taking screenshot: after-diagonal');
    await page.screenshot({ path: join(screenshotDir, 's15-player-movement-07-after-diagonal.png') });

    // TEST 6: All directions in sequence (stress test)
    console.log('[S15 Movement Test] TEST 6: All directions sequence...');
    const keys = ['w', 'a', 's', 'd'];
    for (const key of keys) {
      await page.keyboard.down(key);
      await sleep(800);
      await page.keyboard.up(key);
      await sleep(200);
    }

    console.log('[S15 Movement Test] Taking screenshot: after-all-directions');
    await page.screenshot({ path: join(screenshotDir, 's15-player-movement-08-after-all-directions.png') });

    // Check for errors
    console.log('[S15 Movement Test] Checking for errors...');
    if (errors.length > 0) {
      console.log('[FAIL] Errors detected:');
      errors.forEach(err => console.log('  - ' + err));
    } else {
      console.log('[PASS] No errors detected');
    }

    // Check for NaN in console
    const nanMessages = consoleMessages.filter(msg => msg.includes('NaN'));
    if (nanMessages.length > 0) {
      console.log('[FAIL] NaN detected in console:');
      nanMessages.forEach(msg => console.log('  - ' + msg));
    } else {
      console.log('[PASS] No NaN values detected');
    }

    console.log('[S15 Movement Test] Test complete! Screenshots saved to:', screenshotDir);
    console.log('[S15 Movement Test] Next step: Read screenshots with Read tool and analyze visually');

  } catch (err) {
    console.error('[S15 Movement Test] Test failed:', err);
    await page.screenshot({ path: join(screenshotDir, 's15-player-movement-error.png') });
  } finally {
    await browser.close();
  }
}

runTest().catch(console.error);
