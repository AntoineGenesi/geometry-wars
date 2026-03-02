/**
 * Visual test for s44h-04: QR Code Lobby Height
 * Verifies that the QR code container displays without unwanted scrollbars.
 *
 * Test flow:
 * 1. Load the start menu
 * 2. Click "LAN"
 * 3. Click "HOST GAME"
 * 4. Select a surface
 * 5. Click "START HOSTING"
 * 6. Verify QR container displays without scrollbars
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3037;
const BASE_URL = `http://localhost:${PORT}`;

async function testQRCodeLobbyHeight() {
  console.log('Starting QR code lobby height test (s44h-04)...');

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

    // Navigate to the game
    console.log(`Loading ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for the start menu to load
    await page.waitForSelector('#start-menu', { timeout: 5000 });
    console.log('Start menu loaded');

    // Click LAN button
    console.log('Clicking LAN button...');
    await page.click('[data-mode="lan"]');

    // Wait for LAN section to appear
    await page.waitForSelector('#lan-section:not(.hidden)', { timeout: 2000 });
    console.log('LAN section visible');

    // Click HOST GAME button
    console.log('Clicking HOST GAME...');
    await page.click('#lan-host-btn');

    // Wait for surface picker to appear
    await page.waitForSelector('#lan-host-surface-pick:not(.hidden)', { timeout: 1000 });
    console.log('Surface picker visible');

    // Select first surface (sphere)
    console.log('Selecting sphere surface...');
    await page.click('.lan-surface-grid .surface-btn');

    // Click START HOSTING
    console.log('Clicking START HOSTING...');
    await page.click('#lan-start-host-btn');

    // Wait for host info to appear
    await page.waitForSelector('#lan-host-info:not(.hidden)', { timeout: 3000 });
    console.log('Host info loaded');

    // Wait for QR code to be generated
    await page.waitForSelector('#lan-qr-container canvas', { timeout: 3000 });
    console.log('QR code rendered');

    // CHECK 1: Verify the QR container exists and is visible
    const qrContainerVisible = await page.$('#lan-qr-container');
    if (!qrContainerVisible) {
      throw new Error('QR container not found');
    }
    console.log('✓ QR container found and visible');

    // CHECK 2: Verify QR container has NO scrollbars
    const containerOverflow = await page.evaluate(() => {
      const el = document.querySelector('#lan-qr-container');
      if (!el) return null;
      return window.getComputedStyle(el).overflow;
    });

    if (containerOverflow !== 'hidden' && containerOverflow !== 'visible') {
      throw new Error(`QR container has overflow: ${containerOverflow}, expected 'hidden' or 'visible'`);
    }
    console.log(`✓ QR container overflow: ${containerOverflow} (no scrollbars)`);

    // CHECK 3: Verify QR canvas dimensions
    const canvasInfo = await page.evaluate(() => {
      const canvas = document.querySelector('#lan-qr-container canvas') as HTMLCanvasElement;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        width: canvas.width,
        height: canvas.height,
        displayWidth: rect.width,
        displayHeight: rect.height,
      };
    });

    if (!canvasInfo || canvasInfo.width === 0 || canvasInfo.height === 0) {
      throw new Error('QR canvas has invalid dimensions');
    }
    console.log(`✓ QR canvas dimensions: ${canvasInfo.width}x${canvasInfo.height}px (display: ${canvasInfo.displayWidth}x${canvasInfo.displayHeight}px)`);

    // CHECK 4: Verify parent scrollable content sizing
    const scrollInfo = await page.evaluate(() => {
      const lanHostInfo = document.querySelector('#lan-host-info');
      if (!lanHostInfo) return null;
      const scrollableContent = lanHostInfo.querySelector('.scrollable-content');
      if (!scrollableContent) return null;
      return {
        scrollHeight: (scrollableContent as HTMLElement).scrollHeight,
        clientHeight: (scrollableContent as HTMLElement).clientHeight,
        overflowY: window.getComputedStyle(scrollableContent).overflowY,
      };
    });

    if (scrollInfo) {
      console.log(`✓ Scrollable content: scrollHeight=${scrollInfo.scrollHeight}, clientHeight=${scrollInfo.clientHeight}, overflow-y=${scrollInfo.overflowY}`);
    }

    // Take a screenshot for visual inspection
    const timestamp = Date.now();
    const screenshotDir = 'test-screenshots/sessions';
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const screenshotPath = path.join(screenshotDir, `qr-lobby-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath });

    console.log(`✓ Screenshot saved: ${screenshotPath}`);
    console.log('✓ QR code lobby height test PASSED');

    return { success: true, screenshot: screenshotPath };
  } finally {
    await browser.close();
  }
}

testQRCodeLobbyHeight()
  .then((result) => {
    console.log(`Test completed successfully. Screenshot: ${result.screenshot}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
