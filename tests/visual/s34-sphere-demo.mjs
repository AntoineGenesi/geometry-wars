/**
 * s34-sphere-demo.mjs — Visual test for the sphere-mode demo in OBJDebugPanel.
 *
 * Opens OBJDebugPanel (F4), switches to SPHERE mode, waits for GLB loading,
 * and screenshots the result.
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = 'test-screenshots/sessions/s34-sphere-demo';
const CHROME = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3045;

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log('Launching browser (SwiftShader)...');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(msg.text()));
  page.on('pageerror', err => consoleLogs.push('ERROR: ' + err.message));

  console.log(`Navigating to http://localhost:${PORT}...`);
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(3000);

  // Dispatch F4 to open OBJDebugPanel
  console.log('Dispatching F4 to open debug panel...');
  await page.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'F4', code: 'F4', bubbles: true, cancelable: true, keyCode: 115,
    }));
  });
  await sleep(2000);

  const panelVisible = await page.evaluate(() => {
    const p = document.getElementById('obj-debug-panel');
    return p !== null && !p.classList.contains('hidden');
  });
  console.log(`Panel visible: ${panelVisible}`);

  if (!panelVisible) {
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'diagnostic.png') });
    console.log('Panel not visible — see diagnostic.png');
    console.log('Console:', consoleLogs.slice(0, 10).join('\n'));
    await browser.close();
    process.exit(1);
  }

  await page.screenshot({ path: join(SCREENSHOT_DIR, '01-panel-flat-mode.png') });
  console.log('01-panel-flat-mode.png taken');
  await sleep(1000);

  // Check sphere button exists
  const sphereBtnExists = await page.evaluate(() => {
    return !!document.getElementById('obj-mode-sphere');
  });
  console.log(`Sphere button exists: ${sphereBtnExists}`);

  if (!sphereBtnExists) {
    const allIds = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[id]')).map(e => e.id),
    );
    console.log('All IDs in DOM:', allIds.filter(id => id.includes('obj')).join(', '));
    await browser.close();
    process.exit(1);
  }

  // Click sphere mode button
  console.log('Clicking sphere mode button...');
  await page.click('#obj-mode-sphere');
  await sleep(1000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '02-sphere-mode-clicked.png') });
  console.log('02-sphere-mode-clicked.png (GLBs loading)');

  // Wait for GLBs to load (they load from /characters/*.glb over localhost — fast)
  await sleep(5000);
  await page.screenshot({ path: join(SCREENSHOT_DIR, '03-sphere-demo-loaded.png') });
  console.log('03-sphere-demo-loaded.png — characters should be walking on sphere');

  // Check status text
  const status = await page.evaluate(() => {
    const el = document.getElementById('obj-status');
    return el ? el.textContent : '(not found)';
  });
  console.log(`Status text: "${status}"`);

  // Check canvas size
  const canvasInfo = await page.evaluate(() => {
    const canvas = document.getElementById('obj-preview-canvas');
    if (!canvas) return null;
    return { width: canvas.width, height: canvas.height };
  });
  console.log(`Canvas: ${JSON.stringify(canvasInfo)}`);

  // Check mode button state
  const sphereActive = await page.evaluate(() => {
    const btn = document.getElementById('obj-mode-sphere');
    return btn ? btn.classList.contains('obj-char-active') : false;
  });
  console.log(`Sphere mode active (CSS class): ${sphereActive}`);

  writeFileSync(join(SCREENSHOT_DIR, 'result.json'), JSON.stringify({
    panelOpened: panelVisible,
    sphereButtonFound: sphereBtnExists,
    sphereModeActive: sphereActive,
    statusText: status,
    canvasInfo,
  }, null, 2));

  console.log('\nVerification: Level 5 — Puppeteer screenshot taken');
  console.log('Screenshots saved to:', SCREENSHOT_DIR);

  await browser.close();
}

run().catch(err => {
  console.error('Test failed:', err.message);
  process.exit(1);
});
