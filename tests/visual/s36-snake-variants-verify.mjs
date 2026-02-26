#!/usr/bin/env node
/**
 * Visual test: Verify FractalSnake variants appear in KotH mode
 * Tests s36-snake-entity-variants-missing-re-report
 *
 * Waits 15+ seconds in KotH for the guaranteed fractalSnakeStartTimer (12s) to fire.
 * Takes screenshots to capture the fractal snake head + follower chain visually.
 */
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync } from 'fs';

const PORT = 3042;
const BASE_URL = `http://localhost:${PORT}`;
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const SCREENSHOT_DIR = '/tmp/s36-snake-variants';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ensure screenshot dir exists
if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function run() {
  console.log('=== S36: Snake Variants Verification ===');
  console.log('Testing FractalSnake appearance in KotH mode...');

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
  const consoleLogs = [];
  page.on('console', msg => {
    const text = msg.text();
    consoleLogs.push(text);
    if (msg.type() === 'error') errors.push(text);
    if (text.includes('[KotH]') || text.includes('fractal') || text.includes('FractalSnake')) {
      console.log('CONSOLE:', text);
    }
  });
  page.on('pageerror', err => errors.push(err.message));

  try {
    // Load the game directly with KotH + sphere
    const kothUrl = `${BASE_URL}?surface=sphere&mode=king&level=-1`;
    console.log(`Loading: ${kothUrl}`);
    await page.goto(kothUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Try to click Quick Game if we're on the menu
    const menuState = await page.evaluate(() => {
      const startMenu = document.querySelector('.start-menu') || document.querySelector('#start-menu');
      return { hasMenu: !!startMenu, url: window.location.href };
    });
    console.log('Menu state:', JSON.stringify(menuState));

    // Take screenshot of initial state
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-initial.png` });
    console.log('Screenshot 01: initial state');

    // Navigate via start menu if needed
    if (menuState.hasMenu) {
      console.log('On menu - clicking through to KotH...');

      // Click Quick Game
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.oval-btn, button'))
          .find(b => b.textContent?.includes('QUICK GAME') || b.textContent?.includes('Quick Game') || b.dataset?.mode === 'single');
        if (btn) btn.click();
      });
      await sleep(1500);

      // Click King mode
      const kingClicked = await page.evaluate(() => {
        const btn = document.querySelector('.mode-btn[data-mode-type="king"]') ||
          Array.from(document.querySelectorAll('.mode-btn, button'))
            .find(b => b.textContent?.includes('King') || b.textContent?.includes('KING'));
        if (btn) { btn.click(); return true; }
        return false;
      });
      console.log('King clicked:', kingClicked);
      await sleep(500);

      // Click Sphere
      await page.evaluate(() => {
        const btn = document.querySelector('[data-surface="sphere"]') ||
          Array.from(document.querySelectorAll('.surface-btn'))
            .find(b => b.textContent?.includes('Sphere') || b.textContent?.includes('sphere'));
        if (btn) btn.click();
      });
      await sleep(300);

      // Click Start
      await page.evaluate(() => {
        const btn = document.querySelector('#surface-start-btn') ||
          Array.from(document.querySelectorAll('button'))
            .find(b => b.textContent?.includes('START') || b.textContent?.includes('Play'));
        if (btn) btn.click();
      });
      await sleep(500);
    }

    // Wait for game to initialize (SwiftShader ~7fps, countdown ~3s)
    console.log('Waiting 8s for game to start...');
    await sleep(8000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-game-start.png` });
    console.log('Screenshot 02: game start (countdown may be visible)');

    // Check if game is running
    const gameState = await page.evaluate(() => {
      const w = window;
      return {
        hasDebug: !!w.__gameDebug,
        hasCtx: !!w.__gameDebug?.game?.ctx,
        hasQuickMode: !!w.__gameDebug?.game?.ctx?.quickGameMode,
        modeName: w.__gameDebug?.game?.ctx?.quickGameMode?.name,
        fractalSnakeTimer: w.__gameDebug?.game?.ctx?.quickGameMode?.fractalSnakeStartTimer,
        kothWaveTimer: w.__gameDebug?.game?.ctx?.quickGameMode?.kothWaveTimer,
        fractalSnakeCount: w.__gameDebug?.game?.ctx?.enemySpawner?.fractalSnakes?.length,
        totalEnemies: w.__gameDebug?.game?.ctx?.enemySpawner?.enemies?.length,
      };
    });
    console.log('Game state:', JSON.stringify(gameState));

    // Wait for fractalSnakeStartTimer to fire (should happen ~9s after countdown)
    // Total wait: 8s (above) + 12s more = 20s from start
    console.log('Waiting 14s for fractal snake to spawn (12s timer)...');
    await sleep(14000);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-after-12s-timer.png` });
    console.log('Screenshot 03: after 12s fractal snake timer should have fired');

    // Check enemy state
    const enemyState = await page.evaluate(() => {
      const ctx = window.__gameDebug?.game?.ctx;
      if (!ctx) return { error: 'no ctx' };

      const spawner = ctx.enemySpawner;
      if (!spawner) return { error: 'no spawner' };

      const allEnemies = spawner.enemies || [];
      const fractalSnakes = spawner.fractalSnakes || [];

      return {
        totalEnemies: allEnemies.length,
        fractalSnakeCount: fractalSnakes.length,
        fractalSnakeDetails: fractalSnakes.map(fs => ({
          alive: fs.alive,
          active: fs.active,
          isMaterializing: fs.isMaterializing,
          headVariant: fs._config?.headVariant,
          numRows: fs._config?.numRows,
          followersPerRow: fs._config?.followersPerRow,
          followerRootChildren: fs.followerRoot?.children?.length,
          headMeshVisible: fs.mesh?.visible,
          headMeshScale: fs.mesh?.scale?.x,
        })),
        kothTimers: {
          fractalSnakeStartTimer: ctx.quickGameMode?.fractalSnakeStartTimer,
          kothWaveTimer: ctx.quickGameMode?.kothWaveTimer,
          kothWaveNumber: ctx.quickGameMode?.kothWaveNumber,
          zoneRadiusUV: ctx.quickGameMode?.zoneRadiusUV,
        },
      };
    });
    console.log('Enemy state:', JSON.stringify(enemyState, null, 2));

    // Wait a few more seconds and take another screenshot
    await sleep(5000);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-after-17s.png` });
    console.log('Screenshot 04: 17s in - should have multiple fractal snakes');

    // Final state check
    const finalState = await page.evaluate(() => {
      const ctx = window.__gameDebug?.game?.ctx;
      const spawner = ctx?.enemySpawner;
      const fractalSnakes = spawner?.fractalSnakes || [];
      const bodyText = document.body.innerText?.substring(0, 400);

      return {
        fractalSnakeCount: fractalSnakes.length,
        fractalSnakeVariants: fractalSnakes.map(fs => fs._config?.headVariant),
        bodyText,
      };
    });
    console.log('Final state:', JSON.stringify(finalState, null, 2));

    console.log('\n=== VERIFICATION RESULTS ===');
    console.log(`Screenshots saved to ${SCREENSHOT_DIR}/`);
    console.log(`FractalSnakes spawned: ${finalState.fractalSnakeCount}`);
    console.log(`Variants seen: ${JSON.stringify(finalState.fractalSnakeVariants)}`);

    if (finalState.fractalSnakeCount > 0) {
      console.log('✓ PASS: FractalSnake spawned in KotH mode!');
    } else {
      console.log('✗ FAIL: No FractalSnakes found after 17s in KotH mode');
      console.log('This is the bug - fractal snakes are not spawning!');
    }

    if (errors.length > 0) {
      console.log('\nErrors encountered:');
      errors.slice(0, 10).forEach(e => console.log('  ERROR:', e));
    }

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
