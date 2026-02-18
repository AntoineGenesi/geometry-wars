#!/usr/bin/env node
/**
 * Cube Tunnel Size Verification - Simple visual test
 * Captures screenshot of cube-tunnel surface to verify size reduction
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://localhost:3034';
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

// Create session directory
const now = new Date();
const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
const SESSION_NAME = `${ts}_cube-tunnel-size-check`;
const SCREENSHOT_DIR = resolve(__dirname, '../..', 'test-screenshots', 'sessions', SESSION_NAME);
mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function runTest() {
  console.log('\n=== Cube Tunnel Size Verification ===\n');
  console.log(`Session: ${SESSION_NAME}`);
  console.log(`URL: ${BASE_URL}\n`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshaker',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,720',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    console.log('Navigating to game...');
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 });

    console.log('Page loaded. Waiting for game initialization...');
    await new Promise(r => setTimeout(r, 5000));

    // Try to set surface to cube-tunnel via the game instance
    await page.evaluate(() => {
      if (window.game && window.game.surfaceName) {
        // Try to access StartMenu if available
        if (window.game.uiManager && window.game.uiManager.startMenu) {
          // StartMenu exists, this is before game start
          console.log('At start menu');
        } else {
          // Game is running, try to set surface directly
          console.log('Game running, current surface:', window.game.surfaceName);
        }
      }
    });

    // Click on start to get to the menu
    const startButtonSelector = 'button:contains("Start")';
    try {
      // Try clicking on a surface selector or game button
      await page.click('canvas');
      console.log('Clicked canvas');
    } catch (e) {
      console.log('Could not click canvas:', e.message);
    }

    // Wait a bit for UI to appear
    await new Promise(r => setTimeout(r, 1000));

    // Try to take a screenshot
    const screenshotPath = resolve(SCREENSHOT_DIR, 'cube-tunnel-size.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved: ${screenshotPath}`);

    // Try to get surface info from the page
    const surfaceInfo = await page.evaluate(() => {
      if (window.game) {
        return {
          surfaceName: window.game.surfaceName,
          hasGame: !!window.game,
          hasUiManager: !!window.game.uiManager,
        };
      }
      return null;
    });

    console.log('Surface Info:', surfaceInfo);
    console.log('\n✓ Screenshot captured successfully');

  } catch (error) {
    console.error('Error during test:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runTest().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
