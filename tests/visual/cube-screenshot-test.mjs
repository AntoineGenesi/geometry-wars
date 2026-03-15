#!/usr/bin/env node
/**
 * cube-screenshot-test.mjs — Take screenshots of cube map gameplay to see what user sees.
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
  '--window-size=1024,768',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function test() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1024, height: 768 });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => {
      localStorage.removeItem('masteryOverlayShown');
      localStorage.removeItem('weaponMastery');
    });

    const url = `${BASE_URL}?quickStart=true&surface=cube&debug=true&testMode=true`;
    console.log(`Loading: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });
    await sleep(3000);

    // Screenshot at game start (round 1 enemies should be spawning)
    await page.screenshot({ path: '/tmp/cube-round1-t3s.png' });
    console.log('Screenshot: /tmp/cube-round1-t3s.png (t=3s)');

    await sleep(5000);
    await page.screenshot({ path: '/tmp/cube-round1-t8s.png' });
    console.log('Screenshot: /tmp/cube-round1-t8s.png (t=8s)');

    // Check telemetry
    const tel = await page.evaluate(() => {
      if (!window.__GAME_TELEMETRY) return 'no telemetry';
      const enemies = window.__GAME_TELEMETRY.enemies || [];
      return enemies.map(e => `${e.type}@(${e.position?.x?.toFixed(1)},${e.position?.y?.toFixed(1)}) op=${e.opacity?.toFixed(2)}`).join('\n');
    });
    console.log('\nTelemetry enemies:\n' + tel);

  } finally {
    await browser.close();
  }
}

test().catch(console.error);
