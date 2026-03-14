#!/usr/bin/env node
/**
 * check-enemy-visibility.mjs — Deep visibility probe for all surfaces.
 *
 * For each surface:
 * 1. Spawns enemies at various UV positions
 * 2. Reads their actual opacity/visibility values via telemetry
 * 3. Takes screenshots showing what the player sees
 * 4. Reports surfaces where enemies are too dim to see
 */

import puppeteer from 'puppeteer';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const ALL_SURFACES = [
  'sphere', 'torus', 'cube', 'pill', 'peanut', 'mobius',
  'cube-tunnel', 'cube-ring', 'mobius-bevel', 'pill-ring',
  'sphere-ring', 'torus-ring', 'cylinder',
];

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
  '--window-size=640,360',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function checkSurface(surface) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 640, height: 360 });

    // Clear mastery overlay
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => {
      localStorage.removeItem('masteryOverlayShown');
      localStorage.removeItem('weaponMastery');
    });

    // Load with testMode
    const url = `${BASE_URL}?quickStart=true&surface=${surface}&debug=true&testMode=true`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });
    await sleep(4000); // Wait for game to fully start

    // Check if testMode API is available
    const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (!apiReady) {
      return { surface, status: 'SKIP', reason: 'No __TEST_API' };
    }

    // Get game state
    const gameState = await page.evaluate(() => {
      const api = window.__TEST_API;
      const state = api.getGameState();
      return {
        surface: state.surface,
        playerU: state.playerU,
        playerV: state.playerV,
        enemyCount: state.enemyCount,
        paused: state.paused,
      };
    });

    // Get initial enemy positions and visibility
    const initialEnemies = await page.evaluate(() => {
      const api = window.__TEST_API;
      const enemies = api.getEnemies();
      return enemies.slice(0, 10).map(e => ({
        type: e.type,
        alive: e.alive,
        u: e.u?.toFixed(3),
        v: e.v?.toFixed(3),
        opacity: e.opacity?.toFixed(3),
        scale: e.scale?.toFixed(3),
        visible: e.visible,
      }));
    });

    // Clear and spawn enemies at known positions
    await page.evaluate(() => window.__TEST_API.clearEnemies());
    await sleep(500);

    // Spawn enemies at various UV positions around the surface
    const spawnPositions = [
      [0.5, 0.5],   // center
      [0.3, 0.3],   // offset
      [0.7, 0.7],   // other offset
      [0.5, 0.3],   // near player typical position
      [0.2, 0.5],   // far from center
    ];
    for (const [u, v] of spawnPositions) {
      await page.evaluate((u, v) => window.__TEST_API.spawnEnemy('wanderer', u, v), u, v);
    }
    await sleep(2000);

    // Read spawned enemies' visibility
    const spawnedEnemies = await page.evaluate(() => {
      const api = window.__TEST_API;
      const enemies = api.getEnemies();
      return enemies.map(e => ({
        type: e.type,
        alive: e.alive,
        u: e.u?.toFixed(3),
        v: e.v?.toFixed(3),
        opacity: e.opacity?.toFixed(3),
        scale: e.scale?.toFixed(3),
        visible: e.visible,
      }));
    });

    // Get telemetry for more detail
    const telemetry = await page.evaluate(() => {
      if (window.__GAME_TELEMETRY) {
        return {
          playerPosition: window.__GAME_TELEMETRY.player?.position,
          enemyOpacities: window.__GAME_TELEMETRY.enemies?.map(e => ({
            type: e.type,
            opacity: e.opacity,
            position: e.position,
          })),
        };
      }
      return null;
    });

    // Take screenshot
    const screenshotPath = `test-screenshots/visibility-${surface}.png`;
    await page.screenshot({ path: screenshotPath });

    // Analyze: how many enemies have very low opacity?
    const lowOpacityCount = spawnedEnemies.filter(e =>
      e.alive && parseFloat(e.opacity || '1') < 0.1
    ).length;
    const invisibleCount = spawnedEnemies.filter(e =>
      e.alive && parseFloat(e.opacity || '1') < 0.03
    ).length;
    const zeroScaleCount = spawnedEnemies.filter(e =>
      e.alive && parseFloat(e.scale || '1') < 0.01
    ).length;

    const aliveCount = spawnedEnemies.filter(e => e.alive).length;

    // Check canvas brightness
    const brightness = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      try {
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width;
        tmp.height = canvas.height;
        const ctx = tmp.getContext('2d');
        ctx.drawImage(canvas, 0, 0);

        // Sample full canvas
        let totalLum = 0, sampleCount = 0, brightCount = 0;
        const step = 20;
        for (let x = 0; x < canvas.width; x += step) {
          for (let y = 0; y < canvas.height; y += step) {
            const px = ctx.getImageData(x, y, 1, 1).data;
            const lum = 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];
            totalLum += lum;
            sampleCount++;
            if (lum > 15) brightCount++;
          }
        }
        return { avgLum: totalLum / sampleCount, brightRatio: brightCount / sampleCount };
      } catch { return null; }
    });

    return {
      surface,
      status: aliveCount === 0 ? 'NO_ENEMIES' :
              invisibleCount > 0 ? 'INVISIBLE' :
              lowOpacityCount > 0 ? 'VERY_DIM' :
              zeroScaleCount > 0 ? 'ZERO_SCALE' : 'OK',
      aliveCount,
      lowOpacityCount,
      invisibleCount,
      zeroScaleCount,
      gameState,
      enemies: spawnedEnemies,
      brightness,
      screenshotPath,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const surfaces = process.argv.includes('--all') ? ALL_SURFACES :
    ALL_SURFACES.filter(s => !s.includes('-ring') && s !== 'cylinder');

  console.log(`\nChecking enemy visibility on ${surfaces.length} surfaces...\n`);

  const results = [];
  for (const surface of surfaces) {
    try {
      process.stdout.write(`  ${surface.padEnd(15)} ... `);
      const result = await checkSurface(surface);
      results.push(result);

      const statusIcon = {
        OK: 'PASS',
        SKIP: 'SKIP',
        VERY_DIM: 'WARN',
        INVISIBLE: 'FAIL',
        ZERO_SCALE: 'FAIL',
        NO_ENEMIES: 'FAIL',
      }[result.status] || '???';

      let detail = `alive=${result.aliveCount}`;
      if (result.lowOpacityCount > 0) detail += `, lowOpacity=${result.lowOpacityCount}`;
      if (result.invisibleCount > 0) detail += `, invisible=${result.invisibleCount}`;
      if (result.zeroScaleCount > 0) detail += `, zeroScale=${result.zeroScaleCount}`;
      if (result.brightness) detail += `, avgLum=${result.brightness.avgLum.toFixed(1)}`;

      console.log(`${statusIcon}  (${detail})`);

      // Print enemy details for failures
      if (result.status === 'INVISIBLE' || result.status === 'ZERO_SCALE' || result.status === 'VERY_DIM') {
        for (const e of result.enemies.filter(e => e.alive)) {
          console.log(`    enemy: u=${e.u} v=${e.v} opacity=${e.opacity} scale=${e.scale} visible=${e.visible}`);
        }
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({ surface, status: 'ERROR', reason: err.message });
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  const problems = results.filter(r => r.status !== 'OK' && r.status !== 'SKIP');
  if (problems.length === 0) {
    console.log('All surfaces passed enemy visibility check.');
  } else {
    console.log(`${problems.length} surfaces have visibility issues:`);
    for (const p of problems) {
      console.log(`  ${p.surface}: ${p.status}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
