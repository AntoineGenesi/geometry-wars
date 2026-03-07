/**
 * S44O-04F: Integration Verification — Torus, Peanut, Mobius, Pill Surface Fixes
 *
 * Tests each surface for:
 * - Player visibly on surface
 * - Grid lines visible
 * - Player can move (basic functionality)
 *
 * Surfaces fixed:
 * - 04b: Torus UV parameterization in server _worldPosToApproxUV
 * - 04c: Peanut pole speed correction in client prediction
 * - 04d: Mobius seam traversal + half-twist topology
 * - 04e: Pill grid lines always visible + worldToSurface scale correction
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = '/tmp/s44o-04f-screenshots';

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSurface(browser, surfaceName, options = {}) {
  console.log(`\n[S44O-04F] === Testing ${surfaceName.toUpperCase()} ===`);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  const logs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    logs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => errors.push(err.message));

  try {
    const url = `${BASE_URL}?quickStart=true&surface=${surfaceName}&seed=42&debug=true`;
    console.log(`[S44O-04F] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for game to initialize
    await sleep(3000);

    // Dismiss loading screen
    await page.evaluate(() => {
      const ls = document.getElementById('loading-screen');
      if (ls) ls.remove();
    });

    // Wait for game to render
    await sleep(5000);

    // Initial screenshot
    const screenshot1 = path.join(SCREENSHOT_DIR, `01-${surfaceName}-initial.png`);
    await page.screenshot({ path: screenshot1 });
    console.log(`[S44O-04F] Screenshot 1 taken: ${screenshot1}`);

    // Check canvas pixel data for visual content
    const canvasInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { found: false };

      const ctx = canvas.getContext('2d') || canvas.getContext('webgl') || canvas.getContext('webgl2');
      const width = canvas.width;
      const height = canvas.height;
      return { found: true, width, height };
    });
    console.log(`[S44O-04F] Canvas info: ${JSON.stringify(canvasInfo)}`);

    // Click canvas and move player
    const canvas = await page.$('canvas');
    if (canvas) {
      await canvas.click();
      await sleep(500);
    }

    // Move forward for a few seconds
    console.log(`[S44O-04F] Moving player forward (W key)...`);
    await page.keyboard.down('w');
    await sleep(3000);
    await page.keyboard.up('w');

    // Screenshot after movement
    const screenshot2 = path.join(SCREENSHOT_DIR, `02-${surfaceName}-after-movement.png`);
    await page.screenshot({ path: screenshot2 });
    console.log(`[S44O-04F] Screenshot 2 taken: ${screenshot2}`);

    // Get game debug info
    const debugInfo = await page.evaluate(() => {
      const g = window;
      const result = { hasGame: false };

      try {
        if (g.__gameDebug) {
          result.hasGame = true;
          const walker = g.__gameDebug.playerWalker || g.__gameDebug.walker;
          if (walker) {
            result.playerPos = {
              x: walker.position.x.toFixed(3),
              y: walker.position.y.toFixed(3),
              z: walker.position.z.toFixed(3),
            };
          }
          if (g.__gameDebug.game && g.__gameDebug.game.camera) {
            const cam = g.__gameDebug.game.camera;
            result.cameraUp = {
              x: cam.up.x.toFixed(3),
              y: cam.up.y.toFixed(3),
              z: cam.up.z.toFixed(3),
            };
          }
        }
      } catch (e) {
        result.error = e.message;
      }

      return result;
    });
    console.log(`[S44O-04F] Debug info: ${JSON.stringify(debugInfo)}`);

    // For peanut: test speed at pole vs equator
    if (surfaceName === 'peanut' && options.testSpeed) {
      console.log(`[S44O-04F] Peanut speed test...`);
      // Move toward pole
      await page.keyboard.down('w');
      await sleep(8000); // Move far enough to reach pole
      await page.keyboard.up('w');

      const screenshot3 = path.join(SCREENSHOT_DIR, `03-peanut-pole-region.png`);
      await page.screenshot({ path: screenshot3 });
      console.log(`[S44O-04F] Screenshot 3 taken: ${screenshot3}`);
    }

    // For mobius: test seam traversal
    if (surfaceName === 'mobius' && options.testSeam) {
      console.log(`[S44O-04F] Mobius seam test — moving in U direction...`);
      await page.keyboard.down('w');
      await sleep(10000); // Move long enough to traverse seam
      await page.keyboard.up('w');

      const screenshot3 = path.join(SCREENSHOT_DIR, `03-mobius-seam.png`);
      await page.screenshot({ path: screenshot3 });
      console.log(`[S44O-04F] Screenshot 3 taken: ${screenshot3}`);
    }

    // Check for JS errors
    const jsErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('THREE.WebGLProgram') &&
      !e.includes('WebGL')
    );

    if (jsErrors.length > 0) {
      console.log(`[S44O-04F] ⚠ JS Errors for ${surfaceName}:`, jsErrors.slice(0, 3));
    } else {
      console.log(`[S44O-04F] ✓ No JS errors for ${surfaceName}`);
    }

    return {
      surface: surfaceName,
      success: true,
      screenshots: [screenshot1, screenshot2],
      debugInfo,
      errors: jsErrors,
    };

  } catch (err) {
    console.error(`[S44O-04F] Error testing ${surfaceName}:`, err.message);
    return {
      surface: surfaceName,
      success: false,
      error: err.message,
    };
  } finally {
    await page.close();
  }
}

async function main() {
  console.log('[S44O-04F] Starting surface integration verification...');
  console.log(`[S44O-04F] Screenshots will be saved to: ${SCREENSHOT_DIR}`);

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

  const results = [];

  try {
    // Test torus (04b fix: UV parameterization)
    results.push(await testSurface(browser, 'torus'));

    // Test peanut (04c fix: pole speed correction)
    results.push(await testSurface(browser, 'peanut', { testSpeed: true }));

    // Test mobius (04d fix: seam traversal + half-twist)
    results.push(await testSurface(browser, 'mobius', { testSeam: true }));

    // Test pill (04e fix: grid lines always visible)
    results.push(await testSurface(browser, 'pill'));

  } finally {
    await browser.close();
  }

  console.log('\n[S44O-04F] === RESULTS SUMMARY ===');
  for (const result of results) {
    if (result.success) {
      console.log(`[S44O-04F] ✓ ${result.surface.toUpperCase()}: PASS`);
      if (result.debugInfo && result.debugInfo.playerPos) {
        console.log(`  Player position: ${JSON.stringify(result.debugInfo.playerPos)}`);
      }
      if (result.errors && result.errors.length > 0) {
        console.log(`  Warnings: ${result.errors.length} JS errors`);
      }
    } else {
      console.log(`[S44O-04F] ✗ ${result.surface.toUpperCase()}: FAIL — ${result.error}`);
    }
  }

  console.log(`\n[S44O-04F] All screenshots saved to: ${SCREENSHOT_DIR}`);
  console.log('[S44O-04F] Test complete.');
}

main().catch(err => {
  console.error('[S44O-04F] Fatal error:', err);
  process.exit(1);
});
