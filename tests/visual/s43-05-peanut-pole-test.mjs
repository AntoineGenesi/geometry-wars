/**
 * S43-05: Peanut Pole Crossing Controls Test
 * Tests that controls remain consistent after crossing peanut poles.
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3045;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = '/tmp/s43-05-screenshots';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('[S43-05] Starting peanut pole crossing controls test...');

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
    const logs = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
      logs.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', err => errors.push(err.message));

    // Start peanut game with quickStart
    const url = `${BASE_URL}?quickStart=true&surface=peanut&seed=12345&debug=true`;
    console.log('[S43-05] Navigating to:', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await sleep(3000);
    // Dismiss loading screen
    await page.evaluate(() => {
      const ls = document.getElementById('loading-screen');
      if (ls) ls.remove();
    });
    console.log('[S43-05] Loading screen dismissed. Waiting 8s for game to start...');
    await sleep(8000);

    // Baseline screenshot
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-peanut-baseline.png') });
    console.log('[S43-05] 01-peanut-baseline.png taken');

    // Get player position
    const initialPos = await page.evaluate(() => {
      const g = window;
      if (g.__gameDebug) {
        const walker = g.__gameDebug.playerWalker || g.__gameDebug.walker;
        if (walker) return { x: walker.position.x, y: walker.position.y, z: walker.position.z };
      }
      return null;
    });
    console.log('[S43-05] Initial player position:', initialPos);

    // Click canvas to focus
    const canvas = await page.$('canvas');
    if (canvas) await canvas.click();

    // Press W to move toward the north pole
    console.log('[S43-05] Pressing W for 15s to move toward peanut north pole...');
    await page.keyboard.down('w');

    await sleep(3000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-approaching-pole.png') });
    console.log('[S43-05] 02-approaching-pole.png taken');

    await sleep(4000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-near-pole.png') });
    console.log('[S43-05] 03-near-pole.png taken');

    await sleep(4000);
    await page.keyboard.up('w');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-post-crossing.png') });
    console.log('[S43-05] 04-post-crossing.png taken');

    // Get camera state after crossing
    const cameraState = await page.evaluate(() => {
      const g = window;
      try {
        if (g.__gameDebug && g.__gameDebug.game && g.__gameDebug.game.camera) {
          const cam = g.__gameDebug.game.camera;
          return { upX: cam.up.x, upY: cam.up.y, upZ: cam.up.z };
        }
      } catch(e) { return { error: e.message }; }
      return null;
    });
    console.log('[S43-05] Camera up after crossing:', cameraState);

    // Now try pressing W again to verify controls are not inverted
    console.log('[S43-05] Pressing W again for 5s to verify controls...');
    const posBeforeW = await page.evaluate(() => {
      const g = window;
      if (g.__gameDebug) {
        const walker = g.__gameDebug.playerWalker || g.__gameDebug.walker;
        if (walker) return { x: walker.position.x, y: walker.position.y, z: walker.position.z };
      }
      return null;
    });

    await page.keyboard.down('w');
    await sleep(3000);
    await page.keyboard.up('w');

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-after-controls-test.png') });
    console.log('[S43-05] 05-after-controls-test.png taken');

    const posAfterW = await page.evaluate(() => {
      const g = window;
      if (g.__gameDebug) {
        const walker = g.__gameDebug.playerWalker || g.__gameDebug.walker;
        if (walker) return { x: walker.position.x, y: walker.position.y, z: walker.position.z };
      }
      return null;
    });

    console.log('[S43-05] Position before W press:', posBeforeW);
    console.log('[S43-05] Position after W press:', posAfterW);

    if (posBeforeW && posAfterW) {
      const dx = posAfterW.x - posBeforeW.x;
      const dy = posAfterW.y - posBeforeW.y;
      const dz = posAfterW.z - posBeforeW.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      console.log('[S43-05] Player moved distance:', dist.toFixed(3));
      console.log('[S43-05] Movement direction:', { dx: dx.toFixed(3), dy: dy.toFixed(3), dz: dz.toFixed(3) });
    }

    // Now try pressing S to see if that moves backward correctly
    console.log('[S43-05] Pressing S for 3s to test backward movement...');
    const posBeforeS = await page.evaluate(() => {
      const g = window;
      if (g.__gameDebug) {
        const walker = g.__gameDebug.playerWalker || g.__gameDebug.walker;
        if (walker) return { x: walker.position.x, y: walker.position.y, z: walker.position.z };
      }
      return null;
    });
    await page.keyboard.down('s');
    await sleep(3000);
    await page.keyboard.up('s');
    const posAfterS = await page.evaluate(() => {
      const g = window;
      if (g.__gameDebug) {
        const walker = g.__gameDebug.playerWalker || g.__gameDebug.walker;
        if (walker) return { x: walker.position.x, y: walker.position.y, z: walker.position.z };
      }
      return null;
    });
    console.log('[S43-05] Position before S press:', posBeforeS);
    console.log('[S43-05] Position after S press:', posAfterS);

    console.log('\n[S43-05] === TEST COMPLETE ===');
    console.log('Screenshots in:', SCREENSHOT_DIR);

    if (errors.length > 0) {
      console.log('\nBrowser errors:', errors.slice(0, 5));
    }

  } finally {
    await browser.close();
  }
}

runTest().catch(err => {
  console.error('[S43-05] Error:', err);
  process.exit(1);
});
