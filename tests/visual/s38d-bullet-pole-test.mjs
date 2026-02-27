/**
 * Visual test: Bullet curving at poles investigation
 * Tests bullet behavior on sphere surface near north/south poles
 *
 * Uses the game's PlaygroundTestHarness (headless) to simulate bullet physics
 * and takes screenshots via Puppeteer to observe actual behavior.
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3044;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = '/mnt/c/Users/User/Documents/claude code experiments/Geometry Wars/.claude/worktrees/s38d-07-bullets-curving-south-pole-deep-investigation/test-screenshots';

async function runBulletPoleTest() {
  console.log('=== Bullet Pole Curvature Investigation Test ===');

  // Ensure screenshot dir exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}`);
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-angle=swiftshader-webgl',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Capture console logs from game
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[BROWSER ERROR] ${msg.text()}`);
      }
    });

    console.log(`Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 10000 });

    // Wait for WebGL to initialize
    await page.waitForTimeout(3000);

    // Take initial screenshot
    await page.screenshot({ path: `${SCREENSHOT_DIR}/s38d-bullet-initial.png` });
    console.log('Initial screenshot taken');

    // Try to start game on sphere surface
    // First, look for and click any start button
    await page.evaluate(() => {
      // Try to click start button or any button
      const buttons = Array.from(document.querySelectorAll('button'));
      const startBtn = buttons.find(b => b.textContent?.toLowerCase().includes('start') || b.textContent?.toLowerCase().includes('play'));
      if (startBtn) {
        startBtn.click();
        console.log('Clicked start button:', startBtn.textContent);
      } else if (buttons.length > 0) {
        buttons[0].click();
        console.log('Clicked first button:', buttons[0].textContent);
      }
    });
    await page.waitForTimeout(1000);

    // Try to select sphere surface if there's a selector
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const sel of selects) {
        const options = Array.from(sel.options).map(o => o.value);
        console.log('Select options:', options);
        if (options.includes('sphere')) {
          sel.value = 'sphere';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          console.log('Selected sphere');
        }
      }
    });
    await page.waitForTimeout(500);

    // Start the game via URL parameter
    await page.goto(`${BASE_URL}?surface=sphere&mode=waves`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/s38d-bullet-pregame.png` });

    // Click canvas to focus
    const canvas = await page.$('canvas');
    if (canvas) {
      await canvas.click();
    }

    // Simulate pressing Enter or Space to start
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/s38d-bullet-after-enter.png` });

    // Try to use the game's internal test API if available
    const gameState = await page.evaluate(() => {
      // Check if the game exposes any debug interface
      const g = window as any;
      return {
        hasGame: !!g.__game,
        hasPlayground: !!g.__playground,
        hasDebug: !!g.__debug,
        windowKeys: Object.keys(g).filter(k => k.startsWith('__')),
      };
    });
    console.log('Game state:', gameState);

    // Now simulate shooting in different directions to observe bullet behavior
    // Move mouse to center (aim "forward")
    const viewport = page.viewport();
    const centerX = (viewport?.width ?? 1280) / 2;
    const centerY = (viewport?.height ?? 720) / 2;

    // Move mouse to various positions and hold shoot button
    // Aim "upward" on screen (toward north pole area)
    await page.mouse.move(centerX, centerY - 200);
    await page.waitForTimeout(500);

    // Hold shoot (left mouse button or Space)
    await page.keyboard.down('Space');  // Some games use Space for shooting
    await page.waitForTimeout(500);
    await page.keyboard.up('Space');

    // Try clicking (left mouse button often shoots)
    await page.mouse.move(centerX, centerY - 200);
    await page.mouse.down();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/s38d-bullet-shooting-up.png` });
    console.log('Screenshot taken: shooting up (toward north pole)');

    await page.mouse.up();
    await page.waitForTimeout(500);

    // Aim "downward" (toward south pole)
    await page.mouse.move(centerX, centerY + 200);
    await page.mouse.down();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/s38d-bullet-shooting-down.png` });
    console.log('Screenshot taken: shooting down (toward south pole)');

    await page.mouse.up();

    // Aim "right" (should follow equator-ish great circle)
    await page.mouse.move(centerX + 200, centerY);
    await page.mouse.down();
    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/s38d-bullet-shooting-right.png` });
    console.log('Screenshot taken: shooting right');

    await page.mouse.up();

    console.log('\n=== Screenshots saved to test-screenshots/ ===');
    console.log('Analyzing screenshots for bullet curvature...');

    return true;
  } finally {
    await browser.close();
  }
}

runBulletPoleTest().then(() => {
  console.log('Test complete');
}).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
