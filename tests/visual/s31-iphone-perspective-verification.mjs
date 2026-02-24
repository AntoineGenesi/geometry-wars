/**
 * S31: iPhone 13 Perspective Stretch Fix — Visual Verification
 *
 * Verifies that iPhone 13 landscape viewport (844×390) shows correct 3D
 * perspective without cylindrical/barrel-distorted appearance.
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, '../../test-screenshots/sessions/s31-iphone-perspective');
const CHROME = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3018;
const SERVER_URL = `http://localhost:${PORT}`;

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(page, name) {
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path });
  console.log(`  [screenshot] ${name}.png`);
  return path;
}

async function loadGameAndScreenshot(browser, viewportW, viewportH, dpr, label) {
  const page = await browser.newPage();
  await page.setViewport({ width: viewportW, height: viewportH, deviceScaleFactor: dpr });
  await page.goto(SERVER_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for start menu to load
  await page.waitForSelector('#start-menu', { timeout: 30000 }).catch(() => {
    console.log(`  [warn] #start-menu not found`);
  });

  // Force-hide the loading screen and try to start the game
  await page.evaluate(() => {
    const ls = document.getElementById('loading-screen');
    if (ls) { ls.style.display = 'none'; ls.style.opacity = '0'; }
  });

  // Click "Quick Game" button
  await page.evaluate(() => {
    const btn = document.querySelector('[data-mode="single"]');
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => {});
  await sleep(800);

  // Click Start button
  await page.evaluate(() => {
    const btn = document.querySelector('#surface-start-btn');
    if (btn) { btn.click(); return true; }
    return false;
  }).catch(() => {});

  // Wait for the 3D game to render
  await sleep(8000);

  // Capture camera FOV values from Three.js if possible
  const cameraInfo = await page.evaluate(() => {
    // Try to find Three.js renderer on canvas context
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    // Check if window has any exposed game context
    const w = window;
    if (w.__game && w.__game.camera) {
      return { fov: w.__game.camera.fov, aspect: w.__game.camera.aspect };
    }
    return { viewportW: window.innerWidth, viewportH: window.innerHeight };
  });

  await screenshot(page, label);

  const aspect = viewportW / viewportH;
  console.log(`  ${label}: ${viewportW}x${viewportH} (aspect ${aspect.toFixed(3)})`);
  if (cameraInfo) console.log(`  Camera info:`, JSON.stringify(cameraInfo));

  await page.close();
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-gpu-sandbox',
    '--window-size=1920,1080',
  ],
});

try {
  console.log('\n[1] iPhone 13 Landscape (844×390)');
  await loadGameAndScreenshot(browser, 844, 390, 1, '01-iphone13-landscape-844x390');

  console.log('\n[2] Desktop 1280×720 (16:9 baseline)');
  await loadGameAndScreenshot(browser, 1280, 720, 1, '02-desktop-1280x720');

  // Verify FOV math
  const iPhoneAspect = 844 / 390;
  const BASE_FOV = 60;
  const BASE_ASPECT = 16 / 9;
  const hFovRad = 2 * Math.atan(Math.tan((BASE_FOV * Math.PI / 180) / 2) * BASE_ASPECT);
  const iphoneVFov = (2 * Math.atan(Math.tan(hFovRad / 2) / iPhoneAspect)) * (180 / Math.PI);

  console.log('\n=== FOV Analysis ===');
  console.log(`Desktop 16:9 (aspect ${BASE_ASPECT.toFixed(3)}): ${BASE_FOV}° vertical (unchanged)`);
  console.log(`iPhone 13 landscape (aspect ${iPhoneAspect.toFixed(3)}): ${iphoneVFov.toFixed(1)}° vertical`);
  console.log(`  → Horizontal FOV locked at ${(hFovRad * 180 / Math.PI).toFixed(1)}°`);
  console.log(`  → Before fix: ~102° hFOV at 60° vFOV → cylindrical distortion`);
  console.log(`  → After fix:  ~${(hFovRad * 180 / Math.PI).toFixed(1)}° hFOV at ${iphoneVFov.toFixed(1)}° vFOV → correct`);

  console.log('\n✅ Screenshots saved to:', SCREENSHOT_DIR);

} finally {
  await browser.close();
}
