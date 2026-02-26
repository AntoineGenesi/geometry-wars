#!/usr/bin/env node
/**
 * Visual test: KotH zone positioning on small sphere
 * Tests S36 re-report: zone should be ON the surface, player should gain points
 */
import puppeteer from 'puppeteer';

const BASE_URL = 'http://localhost:3034';
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('Starting KotH zone visual test...');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,720',
      '--disable-dev-shm-usage',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
    if (msg.text().includes('[MapSize]') || msg.text().includes('King') || msg.text().includes('zone')) {
      console.log('CONSOLE:', msg.text());
    }
  });
  page.on('pageerror', err => errors.push(err.message));

  try {
    // Load start menu
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);

    // Click QUICK GAME
    const quickGameClicked = await page.evaluate(() => {
      const btn = document.querySelector('[data-mode="single"]') ||
        Array.from(document.querySelectorAll('.oval-btn')).find(b => b.textContent?.includes('QUICK GAME'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log('Quick game clicked:', quickGameClicked);
    await sleep(1500);

    // Select KING mode
    const kingClicked = await page.evaluate(() => {
      const btn = document.querySelector('.mode-btn[data-mode-type="king"]');
      if (btn) { btn.click(); return true; }
      // Try alternate selector
      const btns = Array.from(document.querySelectorAll('.mode-btn'));
      const kingBtn = btns.find(b => b.textContent?.includes('King'));
      if (kingBtn) { kingBtn.click(); return true; }
      return false;
    });
    console.log('King mode clicked:', kingClicked);
    await sleep(500);

    // Select SPHERE surface
    const sphereClicked = await page.evaluate(() => {
      const btn = document.querySelector('.surface-btn[data-surface="sphere"]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log('Sphere clicked:', sphereClicked);
    await sleep(300);

    // Try to select SMALL map size
    const smallClicked = await page.evaluate(() => {
      // Look for map size selector
      const btns = Array.from(document.querySelectorAll('button'));
      const smallBtn = btns.find(b => b.textContent?.trim() === 'S' || b.textContent?.includes('SMALL') || b.getAttribute('data-size') === 'small');
      if (smallBtn) { smallBtn.click(); return true; }
      return false;
    });
    console.log('Small map size clicked:', smallClicked);
    await sleep(300);

    await page.screenshot({ path: '/tmp/koth-01-menu.png' });
    console.log('Saved menu screenshot');

    // Click START
    const startClicked = await page.evaluate(() => {
      const btn = document.querySelector('#surface-start-btn') ||
        Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('START'));
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log('Start clicked:', startClicked);

    // Wait for game to load (SwiftShader is slow ~7fps)
    await sleep(8000);

    await page.screenshot({ path: '/tmp/koth-02-initial.png' });
    console.log('Saved initial gameplay screenshot');

    // Check game state via JS
    const gameState = await page.evaluate(() => {
      const debug = window.__gameDebug;
      if (!debug) return { error: 'no debug API' };

      const player = debug.player;
      const ctx = debug.game;

      // Check quickGameMode via ctx
      return {
        playerU: player?.surfaceU,
        playerV: player?.surfaceV,
        playerAlive: player?.alive,
        playerScore: player?.score,
        gameHasContext: !!ctx,
      };
    });
    console.log('Game state:', JSON.stringify(gameState));

    // Check for KotH HUD overlay
    const hudInfo = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasZoneIndicator: body.includes('⬛') || body.includes('⬜'),
        bodyText: body.substring(0, 300),
      };
    });
    console.log('HUD info:', JSON.stringify(hudInfo));

    // Move player around for a few seconds to find the zone
    for (let i = 0; i < 5; i++) {
      await page.keyboard.down('w');
      await sleep(600);
      await page.keyboard.up('w');
      await page.keyboard.down('d');
      await sleep(600);
      await page.keyboard.up('d');
    }

    await sleep(1000);
    await page.screenshot({ path: '/tmp/koth-03-after-movement.png' });
    console.log('Saved post-movement screenshot');

    // Check if player got any zone time
    const zoneState = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        bodyText: body.substring(0, 500),
        hasZoneTime: body.includes('s') || body.includes(':'),
      };
    });
    console.log('Zone state:', JSON.stringify(zoneState));

    // Try to get KotH mode internals via window debug
    const kothState = await page.evaluate(() => {
      try {
        // Try to access game loop context
        const w = window;
        if (w.__gameDebug?.game?.ctx?.quickGameMode) {
          const mode = w.__gameDebug.game.ctx.quickGameMode;
          return {
            hasMode: true,
            zoneU: mode.zoneU,
            zoneV: mode.zoneV,
            inZone: mode.inZone,
            zoneTimeSeconds: mode.zoneTimeSeconds,
          };
        }
        return { hasMode: false };
      } catch(e) {
        return { error: e.message };
      }
    });
    console.log('KotH mode state:', JSON.stringify(kothState));

    console.log('\n=== RESULTS ===');
    console.log('Screenshots saved to /tmp/koth-01-menu.png, /tmp/koth-02-initial.png, /tmp/koth-03-after-movement.png');
    if (errors.length > 0) {
      console.log('Errors:', errors.slice(0, 5));
    }

  } finally {
    await browser.close();
  }
}

run().catch(console.error);
