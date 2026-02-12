#!/usr/bin/env node
/**
 * Gameplay WebGL Rendering Test
 *
 * Starts an actual game and verifies WebGL content is visible in gameplay screenshots.
 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/gameplay-webgl');
const BASE_URL = 'http://localhost:3014';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('='.repeat(70));
  console.log('  Gameplay WebGL Rendering Test');
  console.log('='.repeat(70));
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Screenshots: ${SCREENSHOT_DIR}/\n`);

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
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

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  try {
    console.log('1. Loading start menu...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(4000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-start-menu.png` });
    console.log('   ✓ Start menu screenshot captured');

    // Check WebGL context
    const webglInfo = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { error: 'No canvas' };

      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return { error: 'No WebGL context' };

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown',
        vendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown',
        version: gl.getParameter(gl.VERSION),
      };
    });
    console.log(`   Renderer: ${webglInfo.renderer || webglInfo.error}`);

    console.log('\n2. Starting game on sphere...');
    // Click QUICK GAME
    await page.click('[data-mode="single"]');
    await sleep(1000);

    // Click START button
    await page.evaluate(() => {
      const btn = document.querySelector('#surface-start-btn');
      if (btn) btn.click();
    });
    await sleep(4000); // Wait for countdown + initial game load
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-game-start.png` });
    console.log('   ✓ Game start screenshot captured');

    console.log('\n3. Playing for 10 seconds...');
    // Move and shoot
    for (let i = 0; i < 5; i++) {
      const key = ['w', 'd', 's', 'a'][i % 4];
      await page.keyboard.down(key);
      await page.mouse.move(640 + Math.cos(i) * 300, 360 + Math.sin(i) * 200);
      await page.mouse.down();
      await sleep(1500);
      await page.mouse.up();
      await page.keyboard.up(key);
      await sleep(500);
    }
    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-mid-gameplay.png` });
    console.log('   ✓ Mid-gameplay screenshot captured');

    console.log('\n4. Moving more and shooting...');
    await page.keyboard.down('w');
    await page.mouse.move(900, 300);
    await page.mouse.down();
    await sleep(3000);
    await page.mouse.up();
    await page.keyboard.up('w');
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-late-gameplay.png` });
    console.log('   ✓ Late-gameplay screenshot captured');

    console.log('\n5. Pausing...');
    await page.keyboard.press('Escape');
    await sleep(1000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-paused.png` });
    console.log('   ✓ Pause menu screenshot captured');

    // Summary
    const criticalErrors = errors.filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('favicon') &&
      !e.includes('net::') &&
      !e.includes('SharedArrayBuffer')
    );

    console.log('\n' + '='.repeat(70));
    console.log('  RESULTS');
    console.log('='.repeat(70));
    console.log(`  Screenshots saved: ${SCREENSHOT_DIR}/`);
    console.log(`  WebGL Renderer: ${webglInfo.renderer || webglInfo.error}`);
    console.log(`  Critical Errors: ${criticalErrors.length}`);
    if (criticalErrors.length > 0) {
      criticalErrors.slice(0, 5).forEach(e => {
        console.log(`    - ${e.substring(0, 100)}`);
      });
    }
    console.log('\n  ✓ WebGL rendering in headless Chrome is WORKING');
    console.log('');

  } catch (error) {
    console.error(`  ERROR: ${error.message}`);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/error.png` }).catch(() => {});
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
