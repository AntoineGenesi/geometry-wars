/**
 * Visual test for S20 splitscreen viewport fix
 *
 * Tests that 2-player split-screen correctly divides the screen:
 * - Player 1: left half (x: 0, width: 50%)
 * - Player 2: right half (x: 50%, width: 50%)
 * - Both players: full vertical height
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

async function testSplitscreenLayout() {
  console.log('[Visual Test] S20 Splitscreen Layout - Starting...');

  const executablePath = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--use-gl=swiftshader',
      '--disable-software-rasterizer',
      '--disable-extensions',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Navigate to multiplayer mode with 2 players
    const url = `http://localhost:3024/?mode=multiplayer&surface=sphere&players=2`;
    console.log(`[Visual Test] Loading: ${url}`);

    // Set up console listeners before navigation
    const errors = [];
    page.on('pageerror', err => {
      console.log('[Visual Test] Page error:', err.message);
      errors.push(err.message);
    });
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('error') || text.includes('Error')) {
        console.log('[Visual Test] Console error:', text);
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('[Visual Test] Page loaded, waiting for render...');

    // Wait for a canvas element to appear
    try {
      await page.waitForSelector('canvas', { timeout: 5000 });
      console.log('[Visual Test] Canvas found');
    } catch (e) {
      console.log('[Visual Test] Warning: Canvas not found, continuing anyway...');
    }

    // Wait a few seconds for the game to render
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Take screenshot
    const sessionDir = join(rootDir, 'test-screenshots', 'sessions', 's20-splitscreen');
    fs.mkdirSync(sessionDir, { recursive: true });
    const screenshotPath = join(sessionDir, 'layout-test.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`[Visual Test] Screenshot saved: ${screenshotPath}`);

    // Get canvas dimensions and viewport info
    const canvasInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      return {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
      };
    });
    console.log('[Visual Test] Canvas info:', canvasInfo);

    // Try to get viewport info from the renderer (if exposed via window)
    const rendererInfo = await page.evaluate(() => {
      // Check if there's any debug info exposed
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      };
    });
    console.log('[Visual Test] Renderer info:', rendererInfo);

    // Check if there are any HUD elements and their positions
    const hudInfo = await page.evaluate(() => {
      const hudElements = Array.from(document.querySelectorAll('[id*="hud"], [class*="hud"]'));
      return hudElements.map(el => ({
        id: el.id,
        className: el.className,
        left: el.style.left || getComputedStyle(el).left,
        top: el.style.top || getComputedStyle(el).top,
        width: el.style.width || getComputedStyle(el).width,
        height: el.style.height || getComputedStyle(el).height,
      }));
    });
    console.log('[Visual Test] HUD elements:', JSON.stringify(hudInfo, null, 2));

    console.log('\n[Visual Test] Analysis:');
    console.log('- Expected: Player 1 on LEFT half (0 to 640px), Player 2 on RIGHT half (640px to 1280px)');
    console.log('- Screenshot saved for manual inspection');
    console.log('- If both players are crammed into one half, the viewport math is being applied twice');
    console.log('\n[Visual Test] ✓ Test completed - review screenshot');

  } catch (error) {
    console.error('[Visual Test] Error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

testSplitscreenLayout().catch(err => {
  console.error('[Visual Test] Fatal error:', err);
  process.exit(1);
});
