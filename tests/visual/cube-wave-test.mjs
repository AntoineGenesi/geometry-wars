#!/usr/bin/env node
/**
 * cube-wave-test.mjs — Test cube map visibility over multiple waves.
 * Plays the cube map and checks if enemies become invisible after rounds.
 */

import puppeteer from 'puppeteer';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3012';

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=800,600',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkVisibility(page) {
  const enemies = await page.evaluate(() => {
    const api = window.__TEST_API;
    if (!api) return [];
    return api.getEnemies().map(e => ({
      type: e.type,
      alive: e.alive,
      u: e.u,
      v: e.v,
      opacity: e.opacity,
      scale: e.scale,
      isMaterializing: e.isMaterializing,
    }));
  });

  const alive = enemies.filter(e => e.alive);
  const invisible = alive.filter(e => parseFloat(e.opacity || '1') < 0.05);
  const dim = alive.filter(e => {
    const op = parseFloat(e.opacity || '1');
    return op >= 0.05 && op < 0.3;
  });

  return { alive: alive.length, invisible: invisible.length, dim: dim.length, enemies: alive };
}

async function test() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => {
      localStorage.removeItem('masteryOverlayShown');
      localStorage.removeItem('weaponMastery');
    });

    const url = `${BASE_URL}?quickStart=true&surface=cube&debug=true&testMode=true`;
    console.log(`Loading: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });
    await sleep(5000);

    const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (!apiReady) {
      console.log('ERROR: No __TEST_API');
      return;
    }

    const state = await page.evaluate(() => window.__TEST_API.getGameState());
    console.log(`Game state: surface=${state.surface}, mode=${state.mode}`);

    // Check visibility at game start
    console.log('\n--- t=0 (game start) ---');
    let vis = await checkVisibility(page);
    console.log(`  alive=${vis.alive}, invisible=${vis.invisible}, dim=${vis.dim}`);
    if (vis.invisible > 0) console.log('  ⚠️ INVISIBLE AT START!');

    // Wait 5s, check again
    await sleep(5000);
    console.log('\n--- t=5s ---');
    vis = await checkVisibility(page);
    console.log(`  alive=${vis.alive}, invisible=${vis.invisible}, dim=${vis.dim}`);
    if (vis.invisible > 0) console.log('  ⚠️ INVISIBLE AT 5s!');

    // Wait 10s, check again
    await sleep(10000);
    console.log('\n--- t=15s ---');
    vis = await checkVisibility(page);
    console.log(`  alive=${vis.alive}, invisible=${vis.invisible}, dim=${vis.dim}`);
    if (vis.invisible > 0) {
      console.log('  ⚠️ INVISIBLE AT 15s!');
      for (const e of vis.enemies) {
        const op = parseFloat(e.opacity || '1');
        if (op < 0.05) {
          console.log(`    Invisible: type=${e.type} u=${e.u?.toFixed(3)} v=${e.v?.toFixed(3)} opacity=${e.opacity} isMat=${e.isMaterializing}`);
        }
      }
    }

    // Wait another 15s
    await sleep(15000);
    console.log('\n--- t=30s ---');
    vis = await checkVisibility(page);
    console.log(`  alive=${vis.alive}, invisible=${vis.invisible}, dim=${vis.dim}`);
    if (vis.invisible > 0) {
      console.log('  ⚠️ INVISIBLE AT 30s!');
      for (const e of vis.enemies) {
        const op = parseFloat(e.opacity || '1');
        if (op < 0.05) {
          console.log(`    Invisible: type=${e.type} u=${e.u?.toFixed(3)} v=${e.v?.toFixed(3)} opacity=${e.opacity} isMat=${e.isMaterializing}`);
        }
      }
    }

    const screenshotPath = '/tmp/cube-wave-test.png';
    await page.screenshot({ path: screenshotPath });
    console.log(`\nScreenshot: ${screenshotPath}`);

    if (vis.invisible === 0) {
      console.log('\n✓ No invisible enemies found in 30s of gameplay');
    } else {
      console.log(`\n⚠️ ${vis.invisible} invisible enemies found!`);
    }

  } finally {
    await browser.close();
  }
}

test().catch(console.error);
