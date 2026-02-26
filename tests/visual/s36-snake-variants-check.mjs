#!/usr/bin/env node
/**
 * Quick check: Does FractalSnake actually spawn in KotH mode?
 * Uses correct debug API path: window.__gameDebug.enemySpawner directly
 */
import puppeteer from 'puppeteer';

const PORT = 3042;
const BASE_URL = `http://localhost:${PORT}`;
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log('=== FractalSnake KotH Quick Check ===');

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
    const text = msg.text();
    if (msg.type() === 'error') errors.push(text);
  });
  page.on('pageerror', err => errors.push(err.message));

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);

    // Navigate through menu to KotH
    // Quick Game
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('.oval-btn, button'))
        .find(b => b.textContent?.includes('QUICK GAME') || b.dataset?.mode === 'single');
      if (btn) btn.click();
    });
    await sleep(1200);

    // King mode
    await page.evaluate(() => {
      const btn = document.querySelector('.mode-btn[data-mode-type="king"]') ||
        Array.from(document.querySelectorAll('.mode-btn, button'))
          .find(b => b.textContent?.includes('King') || b.textContent?.includes('KING'));
      if (btn) btn.click();
    });
    await sleep(400);

    // Sphere
    await page.evaluate(() => {
      const btn = document.querySelector('[data-surface="sphere"]');
      if (btn) btn.click();
    });
    await sleep(300);

    // Start
    await page.evaluate(() => {
      const btn = document.querySelector('#surface-start-btn') ||
        Array.from(document.querySelectorAll('button'))
          .find(b => b.textContent?.includes('START'));
      if (btn) btn.click();
    });

    // Wait through countdown (3s) + 13s gameplay = 16s after start click
    console.log('Waiting 18s for FractalSnake to spawn (12s timer)...');
    await sleep(18000);

    // Check state using correct debug path
    const state = await page.evaluate(() => {
      const spawner = window.__gameDebug?.enemySpawner;
      if (!spawner) return { error: 'no spawner in debug API' };

      const fractalSnakes = spawner.fractalSnakes || [];
      const allEnemies = spawner.enemies || [];

      return {
        fractalSnakeCount: fractalSnakes.length,
        fractalSnakeDetails: fractalSnakes.map(fs => ({
          alive: fs.alive,
          active: fs.active,
          isMaterializing: fs.isMaterializing,
          headVariant: fs._config?.headVariant,
          numRows: fs._config?.numRows,
        })),
        totalEnemies: allEnemies.length,
        activeEnemies: allEnemies.filter(e => e.active).length,
        bodyText: document.body.innerText?.substring(0, 200),
      };
    });
    console.log('State at 18s:', JSON.stringify(state, null, 2));

    await page.screenshot({ path: '/tmp/s36-fractal-check-18s.png' });
    console.log('Screenshot saved: /tmp/s36-fractal-check-18s.png');

    // Wait more - every 3rd wave also spawns fractal_snake
    console.log('Waiting 10 more seconds...');
    await sleep(10000);

    const state2 = await page.evaluate(() => {
      const spawner = window.__gameDebug?.enemySpawner;
      const fractalSnakes = spawner?.fractalSnakes || [];
      const allEnemies = spawner?.enemies || [];
      return {
        fractalSnakeCount: fractalSnakes.length,
        fractalSnakeVariants: fractalSnakes.map(fs => fs._config?.headVariant),
        totalEnemies: allEnemies.length,
        bodyText: document.body.innerText?.substring(0, 300),
      };
    });
    console.log('State at 28s:', JSON.stringify(state2, null, 2));

    await page.screenshot({ path: '/tmp/s36-fractal-check-28s.png' });
    console.log('Screenshot saved: /tmp/s36-fractal-check-28s.png');

    console.log('\n=== RESULTS ===');
    if (state.fractalSnakeCount > 0 || state2.fractalSnakeCount > 0) {
      const count = Math.max(state.fractalSnakeCount, state2.fractalSnakeCount);
      const variants = state.fractalSnakeDetails?.map(d => d.headVariant) || state2.fractalSnakeVariants || [];
      console.log(`✓ PASS: ${count} FractalSnake(s) found in KotH!`);
      console.log(`  Variants: ${JSON.stringify(variants)}`);
    } else {
      console.log('✗ FAIL: No FractalSnakes found in 28s of KotH mode!');
      console.log('  This confirms the bug: snake variants are not appearing');
    }

  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
