/**
 * S40-02: Mobile Perspective Debug — Before/After Countdown Comparison
 *
 * Captures screenshots at:
 * 1. During countdown (camera at initial position, T=1.5s)
 * 2. During gameplay (camera following player, T=7s)
 *
 * Reports camera FOV and aspect ratio at each phase.
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = '/mnt/c/Users/User/Documents/claude code experiments/Geometry Wars/test-screenshots/sessions/s40-02-mobile-perspective';
const CHROME = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3013;

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTest(browser, w, h, label) {
  console.log(`\n[${label}] viewport: ${w}×${h}`);
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });

  page.on('pageerror', err => console.log(`  [ERROR] ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`  [CONSOLE ERROR] ${msg.text().substring(0, 200)}`);
  });

  // Mock matchMedia so waitForLandscape() resolves immediately in headless mode.
  // Real landscape (w > h) is already set via viewport; this just makes the media
  // query match as it would on a real device.
  await page.evaluateOnNewDocument(() => {
    const _origMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (query === '(orientation: landscape)') {
        const result = {
          matches: true,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        };
        return result;
      }
      return _origMatchMedia(query);
    };
  });

  // renderer=webgl forces WebGL2 (skips WebGPU init which may hang in headless)
  await page.goto(`http://localhost:${PORT}?quickStart=true&surface=sphere&renderer=webgl`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  // Wait for canvas to appear (game has started)
  await page.waitForSelector('canvas', { timeout: 20000 });
  await sleep(2000); // extra wait for WebGL renderer to fully initialize

  // In quickStart mode, StartMenu never shows so the loading screen div is never
  // hidden. Remove it programmatically so the WebGL canvas is visible.
  await page.evaluate(() => {
    const el = document.getElementById('loading-screen');
    if (el) el.remove();
  });

  // Helper to get camera info from page
  const getCameraInfo = async () => {
    return page.evaluate(() => {
      // Try to find exposed game camera
      if (window.__game && window.__game.camera) {
        const cam = window.__game.camera;
        return {
          fov: cam.fov.toFixed(2),
          aspect: cam.aspect.toFixed(4),
          pos: `${cam.position.x.toFixed(1)},${cam.position.y.toFixed(1)},${cam.position.z.toFixed(1)}`,
        };
      }
      // Also check window.innerWidth/Height
      return {
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        aspect: (window.innerWidth / window.innerHeight).toFixed(4),
        fov: null,
      };
    });
  };

  // T=1.5s: During countdown (camera at initial position (0,15,25))
  await sleep(1500);
  const shotPath1 = join(SCREENSHOT_DIR, `${label}-01-countdown.png`);
  await page.screenshot({ path: shotPath1 });
  const info1 = await getCameraInfo();
  console.log(`  [T=1.5s countdown] camera: ${JSON.stringify(info1)}`);
  console.log(`  → ${shotPath1}`);

  // T=7s: After countdown (camera following player)
  await sleep(5500);
  const shotPath2 = join(SCREENSHOT_DIR, `${label}-02-gameplay.png`);
  await page.screenshot({ path: shotPath2 });
  const info2 = await getCameraInfo();
  console.log(`  [T=7s gameplay] camera: ${JSON.stringify(info2)}`);
  console.log(`  → ${shotPath2}`);

  await page.close();

  return { info1, info2 };
}

console.log('Starting S40-02 mobile perspective debug...');
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--enable-webgl',
    '--use-gl=swiftshader',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
  ],
});

try {
  // Test 1: iPhone 13 landscape (the problematic case)
  const r1 = await runTest(browser, 844, 390, 'iphone13-landscape');

  // Test 2: Desktop 1280x720 (reference/should work fine)
  const r2 = await runTest(browser, 1280, 720, 'desktop-1280x720');

  // Analyze
  console.log('\n=== Analysis ===');
  console.log(`iPhone 13 (844×390): aspect=${844/390}`);
  console.log(`  Countdown camera info: ${JSON.stringify(r1.info1)}`);
  console.log(`  Gameplay camera info:  ${JSON.stringify(r1.info2)}`);
  const aspectChanged = r1.info1.aspect !== r1.info2.aspect || r1.info1.fov !== r1.info2.fov;
  console.log(`  Aspect/FOV changed during gameplay: ${aspectChanged}`);
  console.log('\nDesktop (1280×720): aspect=', 1280/720);
  console.log(`  Countdown camera info: ${JSON.stringify(r2.info1)}`);
  console.log(`  Gameplay camera info:  ${JSON.stringify(r2.info2)}`);
  console.log('\nScreenshots saved to:', SCREENSHOT_DIR);

} finally {
  await browser.close();
}
