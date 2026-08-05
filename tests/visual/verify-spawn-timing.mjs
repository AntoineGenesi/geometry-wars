#!/usr/bin/env node
/**
 * verify-spawn-timing.mjs — Tests enemy visibility AT THE MOMENT OF SPAWN.
 *
 * Takes rapid screenshots during the first wave spawn to detect if enemies
 * are invisible during/after materialization.
 */

import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = resolve(__dirname, 'screenshots');
const PORT = process.env.PORT || '3032';
const BASE_URL = `http://localhost:${PORT}`;
const SURFACE = process.argv.find(a => a.startsWith('--surface='))?.split('=')[1] || 'sphere';
const CHROME_PATH = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log(`=== Spawn Timing Test — ${SURFACE} ===`);
  console.log(`URL: ${BASE_URL}`);

  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--enable-webgl2',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--window-size=1280,720',
    ],
  };
  if (CHROME_PATH && existsSync(CHROME_PATH)) {
    launchOptions.executablePath = CHROME_PATH;
  }
  const browser = await puppeteer.launch(launchOptions);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const url = `${BASE_URL}/?quickStart=true&surface=${SURFACE}&debug=true&testMode=true`;
  console.log(`Navigating to: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  } catch (e) {
    console.error(`Failed to navigate: ${e.message}`);
    await browser.close();
    process.exit(1);
  }

  // Wait for game to initialize (SwiftShader is slow)
  console.log('Waiting for game to load (up to 30s)...');
  let loaded = false;
  for (let i = 0; i < 60; i++) {
    const hasApi = await page.evaluate(() => !!window.__TEST_API);
    if (hasApi) {
      console.log(`Game loaded after ${i * 0.5}s`);
      loaded = true;
      break;
    }
    await sleep(500);
  }
  if (!loaded) {
    console.error('FAIL: __TEST_API never became available; game did not initialize.');
    await browser.close();
    process.exit(1);
  }
  // Extra wait for first wave to spawn
  await sleep(3000);

  // Take screenshots every 200ms for 10 seconds to catch the exact spawn moment
  const results = [];
  const startTime = Date.now();
  const duration = 15000; // 15 seconds
  const interval = 500; // every 500ms

  let shotIndex = 0;
  while (Date.now() - startTime < duration) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Get enemy state from test API
    const state = await page.evaluate(() => {
      const api = window.__TEST_API;
      if (!api) return { error: 'no API' };

      const enemies = api.getEnemies();
      const materializing = enemies.filter(e => e.isMaterializing);
      const alive = enemies.filter(e => e.alive && !e.isMaterializing);

      // Check instance color brightness for all enemies
      const enemyDetails = enemies.map(e => ({
        type: e.type,
        alive: e.alive,
        active: e.active,
        isMaterializing: e.isMaterializing,
        icb: e.instanceColorBrightness,
        position: e.screenPosition,
        scale: e.mesh?.scale?.x ?? -1,
      }));

      return {
        total: enemies.length,
        materializing: materializing.length,
        alive: alive.length,
        wave: api.getGameState?.()?.wave ?? -1,
        details: enemyDetails.slice(0, 10), // first 10
      };
    });

    // Take screenshot
    const screenshotPath = resolve(SCREENSHOT_DIR, `spawn-timing-${SURFACE}-${String(shotIndex).padStart(3, '0')}.png`);
    await page.screenshot({ path: screenshotPath });

    console.log(
      `[${elapsed}s] wave=${state.wave ?? '?'} total=${state.total ?? 0} ` +
      `materializing=${state.materializing ?? 0} alive=${state.alive ?? 0}`
    );

    // Log details for enemies that just finished materializing (low ICB or scale)
    if (state.details) {
      for (const e of state.details) {
        const hasMeshScale = e.scale >= 0;
        if (e.alive && !e.isMaterializing && (e.icb < 0.10 || (hasMeshScale && e.scale < 0.1))) {
          console.log(`  WARNING: ${e.type} alive+visible but icb=${e.icb?.toFixed(3)} scale=${e.scale?.toFixed(3)}`);
        }
      }
    }

    results.push({ elapsed, ...state });
    shotIndex++;

    await sleep(interval);
  }

  // Summary
  console.log('\n=== Summary ===');
  const invisibleFrames = results.filter(r =>
    r.details?.some(e => e.alive && !e.isMaterializing && e.icb < 0.10)
  );
  const framesWithEnemies = results.filter(r => (r.alive ?? 0) > 0);
  if (framesWithEnemies.length === 0) {
    console.log('FAIL: No materialized alive enemies were observed');
    process.exitCode = 1;
  } else if (invisibleFrames.length > 0) {
    console.log(`FAIL: Found ${invisibleFrames.length} frames with invisible alive enemies`);
    process.exitCode = 1;
  } else {
    console.log('PASS: No invisible alive enemies detected');
  }

  await browser.close();
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
