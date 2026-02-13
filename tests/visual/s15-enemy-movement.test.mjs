#!/usr/bin/env node

/**
 * S15: Enemy Movement Glitch — Visual Verification
 *
 * Tests for:
 * 1. Enemies spawn and move smoothly
 * 2. No jitter or glitching in enemy movement
 * 3. No 90-degree snaps or orientation bugs
 * 4. Movement appears continuous across multiple surfaces
 *
 * Expected PASSING state:
 * - Enemies move smoothly toward player
 * - No visible jitter or snapping
 * - Consistent movement across all enemy types
 * - No console errors related to enemy position/orientation
 *
 * Expected FAILING state (if bug exists):
 * - Enemies jitter or glitch as they move
 * - 90-degree orientation snaps visible
 * - Enemies teleport or have discontinuous movement
 * - Console shows NaN or orientation errors
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdir } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const screenshotDir = join(__dirname, 'screenshots');

const PORT = process.env.PORT || 3004;
const URL = `http://localhost:${PORT}/`;

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureScreenshotDir() {
  try {
    await mkdir(screenshotDir, { recursive: true });
  } catch (err) {
    // Directory exists, ignore
  }
}

async function runTest() {
  await ensureScreenshotDir();

  console.log('[S15 Enemy Test] Starting visual test...');
  console.log(`[S15 Enemy Test] Server URL: ${URL}`);

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
    // Look for enemy-related errors or NaN
    if (text.includes('Enemy') || text.includes('NaN') || text.includes('undefined') || text.includes('Error')) {
      console.log('[CONSOLE]', text);
      if (text.includes('NaN') || text.includes('Error')) {
        errors.push(text);
      }
    }
  });

  page.on('pageerror', err => {
    console.log('[PAGE ERROR]', err.toString());
    errors.push(err.toString());
  });

  try {
    console.log('[S15 Enemy Test] Navigating to game...');
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 });

    console.log('[S15 Enemy Test] Waiting for start menu...');
    await sleep(4000);

    console.log('[S15 Enemy Test] Taking screenshot: start-menu');
    await page.screenshot({ path: join(screenshotDir, 's15-enemy-movement-01-start-menu.png') });

    // Start game: Click QUICK GAME
    console.log('[S15 Enemy Test] Clicking QUICK GAME...');
    await page.click('[data-mode="single"]');
    await sleep(1000);

    // Click START button to begin game on default surface (Sphere)
    console.log('[S15 Enemy Test] Clicking START...');
    await page.evaluate(() => {
      const btn = document.querySelector('#surface-start-btn');
      if (btn) btn.click();
    });

    console.log('[S15 Enemy Test] Game starting... waiting for gameplay...');
    await sleep(5000); // Wait for game to fully initialize and first wave to spawn

    // Take screenshots showing enemy movement over time
    console.log('[S15 Enemy Test] Capturing enemy movement sequence...');

    for (let i = 0; i < 8; i++) {
      const timestamp = Date.now();
      const screenshotNum = String(i + 2).padStart(2, '0');
      const filename = `s15-enemy-movement-${screenshotNum}-t${i}s.png`;
      await page.screenshot({ path: join(screenshotDir, filename) });
      console.log(`[S15 Enemy Test] Screenshot ${i + 1}/8: ${filename}`);

      // Wait 2 seconds between screenshots to observe movement
      if (i < 7) await sleep(2000);
    }

    // Get final game state info
    const gameState = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'No canvas found' };

      // Try to access game state if available
      const hasVisibleContent = canvas.width > 0 && canvas.height > 0;
      return {
        canvasSize: { width: canvas.width, height: canvas.height },
        hasVisibleContent,
        consoleErrorCount: 0 // Placeholder, actual errors captured by page.on('console')
      };
    });

    console.log('[S15 Enemy Test] Game state:', JSON.stringify(gameState, null, 2));

    // Final assessment
    console.log('\n[S15 Enemy Test] ===== TEST COMPLETE =====');
    console.log(`Screenshots saved to: ${screenshotDir}`);
    console.log(`Console errors detected: ${errors.length}`);

    if (errors.length > 0) {
      console.log('[S15 Enemy Test] ❌ FAILED - Errors detected:');
      errors.forEach(err => console.log(`  - ${err}`));
    } else {
      console.log('[S15 Enemy Test] ✓ No console errors detected');
      console.log('[S15 Enemy Test] Review screenshots to visually confirm smooth enemy movement');
      console.log('[S15 Enemy Test] Look for:');
      console.log('[S15 Enemy Test]   - Enemies moving smoothly toward player');
      console.log('[S15 Enemy Test]   - No jitter or orientation snaps');
      console.log('[S15 Enemy Test]   - Continuous, fluid motion');
    }

  } catch (err) {
    console.error('[S15 Enemy Test] ❌ TEST FAILED:', err.message);
    throw err;
  } finally {
    await browser.close();
  }
}

runTest().catch(err => {
  console.error('[S15 Enemy Test] Fatal error:', err);
  process.exit(1);
});
