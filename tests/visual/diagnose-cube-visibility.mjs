#!/usr/bin/env node
/**
 * diagnose-cube-visibility.mjs — Deep cube map enemy visibility probe.
 * Spawns enemies on ALL cube faces and checks if they're actually visible.
 * The cube has faces at:
 *   - Top face (+Y): v ≈ 0.85 to 1.0
 *   - Bottom face (-Y): v ≈ 0.0 to 0.15
 *   - Side faces: v ≈ 0.31 to 0.69 (all u values)
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

async function diagnose() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });

    // Clear mastery overlay
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => {
      localStorage.removeItem('masteryOverlayShown');
      localStorage.removeItem('weaponMastery');
    });

    // Load cube map in quickStart mode
    const url = `${BASE_URL}?quickStart=true&surface=cube&debug=true&testMode=true`;
    console.log(`Loading: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });
    await sleep(5000); // Wait for full game init

    const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (!apiReady) {
      console.log('ERROR: No __TEST_API available');
      return;
    }

    const gameState = await page.evaluate(() => {
      const api = window.__TEST_API;
      return api.getGameState();
    });
    console.log(`Game state: surface=${gameState.surface}, playerU=${gameState.playerU?.toFixed(3)}, playerV=${gameState.playerV?.toFixed(3)}`);

    // Clear all enemies first
    await page.evaluate(() => window.__TEST_API.clearEnemies());
    await sleep(500);

    // Spawn enemies at specific positions covering ALL cube faces
    const positions = [
      // Middle belt (should always be visible — reference)
      { u: 0.5, v: 0.5, label: 'side-center', expectVisible: true },
      { u: 0.1, v: 0.5, label: 'side-front', expectVisible: true },
      { u: 0.75, v: 0.5, label: 'side-right', expectVisible: true },
      // Top face (v > 0.82, facing UP — likely visible from camera)
      { u: 0.5, v: 0.90, label: 'top-face', expectVisible: true },
      { u: 0.2, v: 0.95, label: 'top-face-edge', expectVisible: true },
      // Bottom face (v < 0.18, facing DOWN — likely BEHIND surface)
      { u: 0.5, v: 0.05, label: 'bottom-face', expectVisible: false },
      { u: 0.8, v: 0.10, label: 'bottom-face-edge', expectVisible: false },
    ];

    console.log('\nSpawning enemies at specific positions...');
    for (const pos of positions) {
      await page.evaluate((u, v) => {
        window.__TEST_API.spawnEnemy('wanderer', u, v);
      }, pos.u, pos.v);
    }
    await sleep(3000); // Wait for spawn + materialization

    // Read enemy states
    const enemies = await page.evaluate(() => {
      const api = window.__TEST_API;
      return api.getEnemies().map(e => ({
        type: e.type,
        alive: e.alive,
        u: e.u,
        v: e.v,
        opacity: e.opacity,
        scale: e.scale,
        visible: e.visible,
        isMaterializing: e.isMaterializing,
      }));
    });

    console.log(`\nEnemy states (${enemies.length} total):`);
    let problemCount = 0;
    for (const e of enemies) {
      const opacity = parseFloat(e.opacity || '1.0');
      const scale = parseFloat(e.scale || '1.0');
      const isInvisible = opacity < 0.05 || scale < 0.05;
      const isVeryDim = opacity < 0.3;

      // Find matching position by UV
      const matchPos = positions.find(p => Math.abs(p.u - e.u) < 0.1 && Math.abs(p.v - e.v) < 0.1);
      const label = matchPos?.label || 'unknown';
      const wasExpectedInvisible = matchPos ? !matchPos.expectVisible : false;

      const status = isInvisible ? (wasExpectedInvisible ? 'OK (expected dim)' : '⚠️ INVISIBLE UNEXPECTED') :
                     isVeryDim ? (wasExpectedInvisible ? 'OK (dim as expected)' : '⚠️ TOO DIM') :
                     '✓ visible';

      console.log(`  [${label}] u=${e.u?.toFixed(3)} v=${e.v?.toFixed(3)}: opacity=${e.opacity} scale=${e.scale} ${status}`);

      if (isInvisible && !wasExpectedInvisible) problemCount++;
    }

    // Also check telemetry
    const telemetry = await page.evaluate(() => {
      if (window.__GAME_TELEMETRY) {
        return {
          enemies: window.__GAME_TELEMETRY.enemies?.map(e => ({
            type: e.type,
            opacity: e.opacity,
            position: e.position,
          })),
        };
      }
      return null;
    });

    if (telemetry?.enemies) {
      console.log('\nTelemetry enemy opacities:');
      for (const e of telemetry.enemies) {
        console.log(`  type=${e.type} opacity=${e.opacity?.toFixed(3)}`);
      }
    }

    // Take screenshot
    const screenshotPath = '/tmp/cube-visibility-diagnose.png';
    await page.screenshot({ path: screenshotPath });
    console.log(`\nScreenshot saved: ${screenshotPath}`);

    console.log(`\n${problemCount === 0 ? '✓ ALL OK — no unexpected invisibility' : `⚠️ ${problemCount} PROBLEMS FOUND`}`);
  } finally {
    await browser.close();
  }
}

diagnose().catch(console.error);
