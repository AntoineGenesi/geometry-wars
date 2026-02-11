#!/usr/bin/env node
/**
 * Play the game: start menu → select mode → select surface → START → gameplay
 * Takes screenshots at every step and describes the full session.
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'test-screenshots', 'play-session');
const BASE_URL = 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const fs = await import('fs');
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,720',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  try {
    console.log('\n=== Playing Geometry Wars 3D ===\n');

    // 1. Load the game
    console.log('1. Loading game...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-start-menu.png') });

    // 2. Click QUICK GAME
    console.log('2. Clicking QUICK GAME...');
    await page.evaluate(() => {
      const btn = document.querySelector('[data-mode="quick"]');
      if (btn) btn.click();
    });
    await sleep(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-mode-select.png') });

    // 3. Click "Waves" mode (should already be selected, but click to be sure)
    console.log('3. Selecting Waves mode...');
    await page.evaluate(() => {
      const waveBtn = document.querySelector('.mode-btn[data-mode-type="waves"]') ||
        document.querySelector('.mode-btn');
      if (waveBtn) waveBtn.click();
    });
    await sleep(500);

    // 4. Select sphere surface (first surface button)
    console.log('4. Selecting sphere surface...');
    await page.evaluate(() => {
      // Only click surface buttons inside #surface-section (not coop/lan sections)
      const section = document.querySelector('#surface-section');
      if (section) {
        const surfBtn = section.querySelector('.surface-btn[data-surface="sphere"]') ||
          section.querySelector('.surface-btn');
        if (surfBtn) surfBtn.click();
      }
    });
    await sleep(500);

    // 5. Scroll down to see START button and take full-page screenshot
    await page.evaluate(() => {
      const section = document.querySelector('#surface-section');
      if (section) section.scrollTop = section.scrollHeight;
    });
    await sleep(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-mode-surface-selected.png'), fullPage: true });

    // 6. Click START button
    console.log('5. Clicking START...');
    const startClicked = await page.evaluate(() => {
      const btn = document.querySelector('#surface-start-btn');
      if (btn) {
        btn.scrollIntoView();
        btn.click();
        return true;
      }
      return false;
    });
    console.log('   START button found:', startClicked);
    await sleep(5000); // Wait for game to fully initialize
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-game-started.png') });

    // 7. Check if we're actually in the game now
    const inGame = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const startMenu = document.querySelector('#start-menu');
      return {
        canvasExists: !!canvas,
        canvasSize: canvas ? `${canvas.width}x${canvas.height}` : 'none',
        menuHidden: startMenu ? startMenu.style.display === 'none' || startMenu.classList.contains('hidden') : true,
        visibleText: document.body.innerText.substring(0, 200),
      };
    });
    console.log('   In game:', inGame.menuHidden ? 'YES' : 'NO (menu still visible)');
    console.log('   Canvas:', inGame.canvasSize);
    console.log('   Text:', inGame.visibleText.replace(/\n/g, ' | ').substring(0, 150));

    // 8. Move around
    console.log('\n6. Moving player...');
    await page.keyboard.down('w');
    await sleep(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-moving-w.png') });
    await page.keyboard.up('w');
    console.log('   Moved W (forward)');

    await page.keyboard.down('d');
    await sleep(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-moving-d.png') });
    await page.keyboard.up('d');
    console.log('   Moved D (right)');

    // 9. Shoot
    console.log('\n7. Shooting...');
    await page.mouse.move(900, 360);
    await page.mouse.down();
    await sleep(800);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07-shooting.png') });
    await page.mouse.up();

    // 10. Play for ~15 seconds — move and shoot
    console.log('\n8. Extended gameplay (~15s)...');
    const directions = [
      { key: 'w', mx: 640, my: 200 },
      { key: 'd', mx: 900, my: 360 },
      { key: 's', mx: 640, my: 500 },
      { key: 'a', mx: 300, my: 360 },
      { key: 'w', mx: 800, my: 250 },
    ];
    for (const dir of directions) {
      await page.keyboard.down(dir.key);
      await page.mouse.move(dir.mx, dir.my);
      await page.mouse.down();
      await sleep(2500);
      await page.mouse.up();
      await page.keyboard.up(dir.key);
      await sleep(500);
    }
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '08-mid-gameplay.png') });
    console.log('   Screenshot: mid-gameplay');

    // 11. Get game state
    const gameState = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        text: text.substring(0, 500),
        canvasCount: document.querySelectorAll('canvas').length,
      };
    });
    console.log('   Visible text:', gameState.text.replace(/\n/g, ' | ').substring(0, 200));

    // 12. Pause
    console.log('\n9. Pause menu (ESC)...');
    await page.keyboard.press('Escape');
    await sleep(1500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '09-paused.png') });

    // 13. Resume
    await page.keyboard.press('Escape');
    await sleep(1000);

    // 14. Debug overlay
    console.log('10. Debug overlay (F3)...');
    await page.keyboard.press('F3');
    await sleep(1000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '10-debug-overlay.png') });

    // 15. Play more with debug overlay
    await page.keyboard.down('w');
    await page.mouse.move(800, 300);
    await page.mouse.down();
    await sleep(3000);
    await page.mouse.up();
    await page.keyboard.up('w');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '11-gameplay-with-debug.png') });

    // 16. Bomb
    console.log('11. Using bomb (Space)...');
    await page.keyboard.press('Space');
    await sleep(800);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '12-after-bomb.png') });

    // Summary
    console.log('\n=== Session Complete ===');
    console.log(`  12 screenshots in: ${SCREENSHOT_DIR}`);
    console.log(`  Console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      consoleErrors.slice(0, 5).forEach(e => console.log(`    - ${e.substring(0, 120)}`));
    }

  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'error.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
}

run();
