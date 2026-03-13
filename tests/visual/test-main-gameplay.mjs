#!/usr/bin/env node
/**
 * Visual Test: Main.ts Refactor + Performance + Difficulty & Gameplay
 *
 * Tests items from HUMAN_TEST.md:
 *
 * Main.ts Refactor:
 *   - Player movement (WASD all directions)
 *   - Shooting (click to fire, bullets hit enemies, enemies die)
 *   - Pickups spawn after kills
 *   - Pickup collection (walk over pickups)
 *   - Camera controls (scroll zoom)
 *   - Screen flash on death
 *   - UI updates (score, multiplier, lives, bombs)
 *   - Pause menu (ESC opens, shows stats, resume)
 *
 * Performance:
 *   - FPS counter visible (debug overlay F3)
 *   - Performance graphs (pause -> performance tab)
 *
 * Difficulty & Gameplay:
 *   - Gets harder over waves (enemy count increases)
 *   - Enemy speed visible
 *   - Cube-tunnel speed normalization
 *
 * Run 1: Sphere surface (main gameplay tests)
 * Run 2: Cube-tunnel surface (speed normalization)
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TASK_SLUG = 'main-gameplay';
const COMMIT_HASH = process.argv[2] || 'a722f6a';

const now = new Date();
const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
const SESSION_NAME = `${ts}_${TASK_SLUG}`;
const SESSION_DIR = path.join(__dirname, '..', '..', 'test-screenshots', 'sessions', SESSION_NAME);

// Sub-directories for each run
const SPHERE_DIR = path.join(SESSION_DIR, 'attempt-1-sphere');
const CUBETUNNEL_DIR = path.join(SESSION_DIR, 'attempt-2-cube-tunnel');

const consoleErrors = [];
const consoleWarnings = [];
const allConsoleLogs = [];

async function launchBrowser() {
  return puppeteer.launch({
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
      '--disable-features=VizDisplayCompositor',
    ],
  });
}

function setupPageListeners(page) {
  page.on('console', msg => {
    const text = msg.text();
    allConsoleLogs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') consoleErrors.push(text);
    if (msg.type() === 'warning') consoleWarnings.push(text);
  });
  page.on('pageerror', err => {
    consoleErrors.push(err.message);
    allConsoleLogs.push(`[pageerror] ${err.message}`);
  });
}

async function navigateToGame(page, surface = 'sphere') {
  console.log(`\n--- Navigating to game on ${surface} ---`);

  // 1. Load start menu
  console.log('  Loading start menu...');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);

  // 2. Click QUICK GAME
  console.log('  Clicking QUICK GAME...');
  const quickGameClicked = await page.evaluate(() => {
    const btn = document.querySelector('[data-mode="single"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log(`  Quick Game button found: ${quickGameClicked}`);
  await sleep(2000);

  // 3. Select Waves mode (should be default)
  console.log('  Selecting Waves mode...');
  await page.evaluate(() => {
    const waveBtn = document.querySelector('.mode-btn[data-mode-type="waves"]') ||
      document.querySelector('.mode-btn');
    if (waveBtn) waveBtn.click();
  });
  await sleep(500);

  // 4. Select surface
  console.log(`  Selecting ${surface} surface...`);
  const surfaceClicked = await page.evaluate((surf) => {
    const section = document.querySelector('#surface-section');
    if (!section) return false;
    const surfBtn = section.querySelector(`.surface-btn[data-surface="${surf}"]`);
    if (surfBtn) { surfBtn.click(); return true; }
    return false;
  }, surface);
  console.log(`  Surface button found: ${surfaceClicked}`);
  await sleep(500);

  // 5. Click START
  console.log('  Clicking START...');
  const startClicked = await page.evaluate(() => {
    const btn = document.querySelector('#surface-start-btn');
    if (btn) {
      btn.scrollIntoView();
      btn.click();
      return true;
    }
    return false;
  });
  console.log(`  START button found: ${startClicked}`);

  // Wait for game to fully initialize (countdown + first render)
  await sleep(8000);

  // Verify we're in the game
  const inGame = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const startMenu = document.querySelector('#start-menu');
    const menuHidden = startMenu ? (startMenu.style.display === 'none' || startMenu.classList.contains('hidden') || getComputedStyle(startMenu).display === 'none') : true;
    return {
      canvasExists: !!canvas,
      canvasSize: canvas ? `${canvas.width}x${canvas.height}` : 'none',
      menuHidden,
    };
  });
  console.log(`  In game: canvas=${inGame.canvasSize}, menuHidden=${inGame.menuHidden}`);
  return inGame;
}

async function runSphereTests(page) {
  console.log('\n========================================');
  console.log('  RUN 1: SPHERE — Main Gameplay Tests');
  console.log('========================================\n');

  fs.mkdirSync(SPHERE_DIR, { recursive: true });
  await page.setViewport({ width: 1280, height: 720 });
  setupPageListeners(page);

  try {
    // --- STEP 1: Start Menu ---
    console.log('STEP 1: Start Menu');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '01-start-menu.png') });
    console.log('  Screenshot: 01-start-menu.png');

    // --- STEP 2: Click Quick Game, screenshot mode select ---
    console.log('\nSTEP 2: Quick Game -> Mode Select');
    await page.evaluate(() => {
      const btn = document.querySelector('[data-mode="single"]');
      if (btn) btn.click();
    });
    await sleep(2000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '02-mode-surface-select.png') });
    console.log('  Screenshot: 02-mode-surface-select.png');

    // --- STEP 3: Select Waves + Sphere + START ---
    console.log('\nSTEP 3: Select Waves + Sphere + START');
    await page.evaluate(() => {
      const waveBtn = document.querySelector('.mode-btn[data-mode-type="waves"]') ||
        document.querySelector('.mode-btn');
      if (waveBtn) waveBtn.click();
    });
    await sleep(300);
    await page.evaluate(() => {
      const section = document.querySelector('#surface-section');
      if (section) {
        const surfBtn = section.querySelector('.surface-btn[data-surface="sphere"]');
        if (surfBtn) surfBtn.click();
      }
    });
    await sleep(300);
    await page.evaluate(() => {
      const btn = document.querySelector('#surface-start-btn');
      if (btn) { btn.scrollIntoView(); btn.click(); }
    });
    await sleep(8000); // Wait for countdown + game init
    await page.screenshot({ path: path.join(SPHERE_DIR, '03-game-started.png') });
    console.log('  Screenshot: 03-game-started.png');

    // --- STEP 4: UI elements check (score, multiplier, lives, bombs) ---
    console.log('\nSTEP 4: Check UI elements');
    const uiState = await page.evaluate(() => {
      const getText = (sel) => {
        const el = document.querySelector(sel);
        return el ? el.textContent.trim() : null;
      };
      // Try common UI selectors
      const bodyText = document.body.innerText;
      return {
        bodyTextSnippet: bodyText.substring(0, 300),
        scoreEl: getText('#score-display') || getText('.score'),
        livesEl: getText('#lives-display') || getText('.lives'),
        bombsEl: getText('#bombs-display') || getText('.bombs'),
        multiplierEl: getText('#multiplier-display') || getText('.multiplier'),
      };
    });
    console.log('  UI state:', JSON.stringify(uiState, null, 2));

    // --- STEP 5: Player movement — W (forward) ---
    console.log('\nSTEP 5: Movement — W key');
    await page.keyboard.down('w');
    await sleep(2000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '04-moving-w.png') });
    await page.keyboard.up('w');
    console.log('  Screenshot: 04-moving-w.png');

    // --- STEP 6: Movement — A (left) ---
    console.log('\nSTEP 6: Movement — A key');
    await page.keyboard.down('a');
    await sleep(2000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '05-moving-a.png') });
    await page.keyboard.up('a');
    console.log('  Screenshot: 05-moving-a.png');

    // --- STEP 7: Movement — S (backward) ---
    console.log('\nSTEP 7: Movement — S key');
    await page.keyboard.down('s');
    await sleep(2000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '06-moving-s.png') });
    await page.keyboard.up('s');
    console.log('  Screenshot: 06-moving-s.png');

    // --- STEP 8: Movement — D (right) ---
    console.log('\nSTEP 8: Movement — D key');
    await page.keyboard.down('d');
    await sleep(2000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '07-moving-d.png') });
    await page.keyboard.up('d');
    console.log('  Screenshot: 07-moving-d.png');

    // --- STEP 9: Shooting — click to fire, hold to spray ---
    console.log('\nSTEP 9: Shooting — click to fire');
    await page.mouse.move(900, 360);
    await page.mouse.down();
    await sleep(3000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '08-shooting-right.png') });
    await page.mouse.up();
    console.log('  Screenshot: 08-shooting-right.png');

    // Shoot in another direction
    await page.mouse.move(400, 200);
    await page.mouse.down();
    await sleep(2000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '09-shooting-left.png') });
    await page.mouse.up();
    console.log('  Screenshot: 09-shooting-left.png');

    // --- STEP 10: Extended gameplay — move + shoot to kill enemies ---
    console.log('\nSTEP 10: Extended gameplay (move + shoot, ~30s)');
    const moveShootCombos = [
      { key: 'w', mx: 800, my: 250, dur: 3000 },
      { key: 'd', mx: 950, my: 360, dur: 3000 },
      { key: 's', mx: 640, my: 550, dur: 3000 },
      { key: 'a', mx: 300, my: 360, dur: 3000 },
      { key: 'w', mx: 750, my: 200, dur: 3000 },
      { key: 'd', mx: 900, my: 400, dur: 3000 },
      { key: 'w', mx: 640, my: 100, dur: 4000 },
      { key: 'a', mx: 200, my: 300, dur: 4000 },
      { key: 's', mx: 640, my: 600, dur: 3000 },
      { key: 'd', mx: 1000, my: 360, dur: 3000 },
    ];
    for (const combo of moveShootCombos) {
      await page.keyboard.down(combo.key);
      await page.mouse.move(combo.mx, combo.my);
      await page.mouse.down();
      await sleep(combo.dur);
      await page.mouse.up();
      await page.keyboard.up(combo.key);
      await sleep(200);
    }
    await page.screenshot({ path: path.join(SPHERE_DIR, '10-mid-gameplay.png') });
    console.log('  Screenshot: 10-mid-gameplay.png');

    // Check score to see if it changed (kills happened)
    const midGameUI = await page.evaluate(() => {
      return document.body.innerText.substring(0, 500);
    });
    console.log('  Mid-game text:', midGameUI.replace(/\n/g, ' | ').substring(0, 200));

    // --- STEP 11: Camera zoom — scroll wheel ---
    console.log('\nSTEP 11: Camera zoom — scroll wheel');
    // Zoom in
    for (let i = 0; i < 5; i++) {
      await page.mouse.wheel({ deltaY: -120 });
      await sleep(300);
    }
    await sleep(1000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '11-zoomed-in.png') });
    console.log('  Screenshot: 11-zoomed-in.png');

    // Zoom out
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel({ deltaY: 120 });
      await sleep(300);
    }
    await sleep(1000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '12-zoomed-out.png') });
    console.log('  Screenshot: 12-zoomed-out.png');

    // --- STEP 12: More gameplay to increase score + potentially trigger pickups ---
    console.log('\nSTEP 12: More gameplay for pickups + difficulty increase');
    for (let round = 0; round < 5; round++) {
      // Move and shoot in various directions
      const angle = (round / 5) * Math.PI * 2;
      const mx = 640 + Math.cos(angle) * 400;
      const my = 360 + Math.sin(angle) * 250;
      const key = ['w', 'd', 's', 'a', 'w'][round];
      await page.keyboard.down(key);
      await page.mouse.move(mx, my);
      await page.mouse.down();
      await sleep(4000);
      await page.mouse.up();
      await page.keyboard.up(key);
      await sleep(200);
    }
    await page.screenshot({ path: path.join(SPHERE_DIR, '13-later-gameplay.png') });
    console.log('  Screenshot: 13-later-gameplay.png');

    // --- STEP 13: Check if score updated (UI updates test) ---
    console.log('\nSTEP 13: Check UI updates');
    const laterUI = await page.evaluate(() => {
      return document.body.innerText.substring(0, 500);
    });
    console.log('  Later game text:', laterUI.replace(/\n/g, ' | ').substring(0, 200));

    // --- STEP 14: Debug overlay (F3) — FPS counter ---
    console.log('\nSTEP 14: Debug overlay (F3)');
    await page.keyboard.press('F3');
    await sleep(2000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '14-debug-overlay.png') });
    console.log('  Screenshot: 14-debug-overlay.png');

    // Check debug overlay contents
    const debugInfo = await page.evaluate(() => {
      const overlay = document.getElementById('debug-overlay');
      if (!overlay) return { visible: false, text: '' };
      const style = getComputedStyle(overlay);
      return {
        visible: style.display !== 'none',
        text: overlay.innerText.substring(0, 500),
      };
    });
    console.log('  Debug overlay visible:', debugInfo.visible);
    console.log('  Debug overlay text:', debugInfo.text.replace(/\n/g, ' | ').substring(0, 200));

    // Keep playing with debug overlay on
    await page.keyboard.down('w');
    await page.mouse.move(800, 300);
    await page.mouse.down();
    await sleep(3000);
    await page.mouse.up();
    await page.keyboard.up('w');
    await page.screenshot({ path: path.join(SPHERE_DIR, '15-gameplay-with-debug.png') });
    console.log('  Screenshot: 15-gameplay-with-debug.png');

    // Turn off debug overlay
    await page.keyboard.press('F3');
    await sleep(500);

    // --- STEP 15: Pause menu (ESC) ---
    console.log('\nSTEP 15: Pause menu');
    await page.keyboard.press('Escape');
    await sleep(2000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '16-pause-menu.png') });
    console.log('  Screenshot: 16-pause-menu.png');

    // Check pause menu contents
    const pauseInfo = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      return {
        hasPaused: bodyText.includes('PAUSED') || bodyText.includes('Paused'),
        text: bodyText.substring(0, 800),
      };
    });
    console.log('  Pause menu visible:', pauseInfo.hasPaused);
    console.log('  Pause text:', pauseInfo.text.replace(/\n/g, ' | ').substring(0, 300));

    // --- STEP 16: Performance tab in pause menu ---
    console.log('\nSTEP 16: Performance tab in pause menu');
    const perfTabClicked = await page.evaluate(() => {
      // Look for performance tab button in the pause menu
      const buttons = document.querySelectorAll('button, [role="tab"], .tab, .tab-btn');
      for (const btn of buttons) {
        const text = btn.textContent.trim().toUpperCase();
        if (text.includes('PERF') || text.includes('PERFORMANCE') || text.includes('STATS')) {
          btn.click();
          return text;
        }
      }
      // Try clicking by class
      const perfBtn = document.querySelector('.perf-tab, .performance-tab, [data-tab="performance"]');
      if (perfBtn) { perfBtn.click(); return perfBtn.textContent; }
      return null;
    });
    console.log('  Performance tab clicked:', perfTabClicked);
    await sleep(1500);
    await page.screenshot({ path: path.join(SPHERE_DIR, '17-performance-tab.png') });
    console.log('  Screenshot: 17-performance-tab.png');

    // --- STEP 17: Resume from pause ---
    console.log('\nSTEP 17: Resume from pause');
    // Try clicking Resume button
    const resumeClicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        if (btn.textContent.trim().toUpperCase().includes('RESUME')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    if (!resumeClicked) {
      // Fallback: press ESC again
      await page.keyboard.press('Escape');
    }
    await sleep(2000);
    await page.screenshot({ path: path.join(SPHERE_DIR, '18-resumed.png') });
    console.log('  Screenshot: 18-resumed.png');

    // --- STEP 18: Use bomb to test screen effects ---
    console.log('\nSTEP 18: Bomb (Space)');
    await page.keyboard.press('Space');
    await sleep(1500);
    await page.screenshot({ path: path.join(SPHERE_DIR, '19-after-bomb.png') });
    console.log('  Screenshot: 19-after-bomb.png');

    // --- STEP 19: Keep playing more for difficulty testing ---
    console.log('\nSTEP 19: More gameplay for difficulty increase');
    for (let round = 0; round < 8; round++) {
      const angle = (round / 8) * Math.PI * 2;
      const mx = 640 + Math.cos(angle) * 400;
      const my = 360 + Math.sin(angle) * 250;
      const key = ['w', 'd', 's', 'a'][round % 4];
      await page.keyboard.down(key);
      await page.mouse.move(mx, my);
      await page.mouse.down();
      await sleep(4000);
      await page.mouse.up();
      await page.keyboard.up(key);
      await sleep(200);
    }
    await page.screenshot({ path: path.join(SPHERE_DIR, '20-difficulty-later.png') });
    console.log('  Screenshot: 20-difficulty-later.png');

    // Get final state
    const finalState = await page.evaluate(() => {
      return {
        bodyText: document.body.innerText.substring(0, 500),
        canvasExists: !!document.querySelector('canvas'),
      };
    });
    console.log('  Final state text:', finalState.bodyText.replace(/\n/g, ' | ').substring(0, 200));

  } catch (err) {
    console.error('Sphere run error:', err.message);
    await page.screenshot({ path: path.join(SPHERE_DIR, 'error.png') }).catch(() => {});
  }
}

async function runCubeTunnelTests(page) {
  console.log('\n========================================');
  console.log('  RUN 2: CUBE-TUNNEL — Speed Tests');
  console.log('========================================\n');

  fs.mkdirSync(CUBETUNNEL_DIR, { recursive: true });
  await page.setViewport({ width: 1280, height: 720 });
  setupPageListeners(page);

  try {
    // Navigate to game on cube-tunnel
    console.log('STEP 1: Start menu');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    await page.screenshot({ path: path.join(CUBETUNNEL_DIR, '01-start-menu.png') });

    console.log('\nSTEP 2: Select Quick Game');
    await page.evaluate(() => {
      const btn = document.querySelector('[data-mode="single"]');
      if (btn) btn.click();
    });
    await sleep(2000);

    // Select Waves mode
    await page.evaluate(() => {
      const waveBtn = document.querySelector('.mode-btn[data-mode-type="waves"]') ||
        document.querySelector('.mode-btn');
      if (waveBtn) waveBtn.click();
    });
    await sleep(500);

    console.log('\nSTEP 3: Select cube-tunnel surface');
    // Scroll down if needed to find cube-tunnel
    const ctFound = await page.evaluate(() => {
      const section = document.querySelector('#surface-section');
      if (!section) return false;
      // First try exact match
      let surfBtn = section.querySelector('.surface-btn[data-surface="cube-tunnel"]');
      if (!surfBtn) {
        // Try all surface buttons and find one with "tunnel" in text
        const btns = section.querySelectorAll('.surface-btn');
        for (const btn of btns) {
          if (btn.textContent.toLowerCase().includes('tunnel') ||
              btn.getAttribute('data-surface')?.includes('tunnel')) {
            surfBtn = btn;
            break;
          }
        }
      }
      if (surfBtn) {
        surfBtn.scrollIntoView();
        surfBtn.click();
        return surfBtn.getAttribute('data-surface');
      }
      return false;
    });
    console.log('  Cube-tunnel found:', ctFound);
    await sleep(500);
    await page.screenshot({ path: path.join(CUBETUNNEL_DIR, '02-surface-selected.png') });

    console.log('\nSTEP 4: Click START');
    await page.evaluate(() => {
      const btn = document.querySelector('#surface-start-btn');
      if (btn) { btn.scrollIntoView(); btn.click(); }
    });
    await sleep(8000);
    await page.screenshot({ path: path.join(CUBETUNNEL_DIR, '03-game-started.png') });
    console.log('  Screenshot: 03-game-started.png');

    // --- Movement test on cube-tunnel ---
    console.log('\nSTEP 5: Movement on cube-tunnel');
    await page.keyboard.down('w');
    await sleep(3000);
    await page.screenshot({ path: path.join(CUBETUNNEL_DIR, '04-moving-forward.png') });
    await page.keyboard.up('w');
    console.log('  Screenshot: 04-moving-forward.png');

    await page.keyboard.down('d');
    await sleep(3000);
    await page.screenshot({ path: path.join(CUBETUNNEL_DIR, '05-moving-right.png') });
    await page.keyboard.up('d');
    console.log('  Screenshot: 05-moving-right.png');

    // --- Shooting + gameplay on cube-tunnel ---
    console.log('\nSTEP 6: Shooting + gameplay');
    for (let round = 0; round < 6; round++) {
      const angle = (round / 6) * Math.PI * 2;
      const mx = 640 + Math.cos(angle) * 400;
      const my = 360 + Math.sin(angle) * 250;
      const key = ['w', 'd', 's', 'a'][round % 4];
      await page.keyboard.down(key);
      await page.mouse.move(mx, my);
      await page.mouse.down();
      await sleep(4000);
      await page.mouse.up();
      await page.keyboard.up(key);
      await sleep(200);
    }
    await page.screenshot({ path: path.join(CUBETUNNEL_DIR, '06-mid-gameplay.png') });
    console.log('  Screenshot: 06-mid-gameplay.png');

    // --- Debug overlay for FPS on cube-tunnel ---
    console.log('\nSTEP 7: Debug overlay on cube-tunnel');
    await page.keyboard.press('F3');
    await sleep(2000);
    await page.screenshot({ path: path.join(CUBETUNNEL_DIR, '07-debug-overlay.png') });
    console.log('  Screenshot: 07-debug-overlay.png');

    const debugText = await page.evaluate(() => {
      const overlay = document.getElementById('debug-overlay');
      return overlay ? overlay.innerText : '';
    });
    console.log('  Debug text:', debugText.replace(/\n/g, ' | ').substring(0, 200));

    // Continue playing for difficulty observation
    console.log('\nSTEP 8: More gameplay for difficulty');
    await page.keyboard.press('F3'); // toggle off
    for (let round = 0; round < 6; round++) {
      const key = ['w', 'a', 's', 'd'][round % 4];
      await page.keyboard.down(key);
      await page.mouse.move(640 + (round - 3) * 150, 360);
      await page.mouse.down();
      await sleep(4000);
      await page.mouse.up();
      await page.keyboard.up(key);
      await sleep(200);
    }
    await page.screenshot({ path: path.join(CUBETUNNEL_DIR, '08-later-gameplay.png') });
    console.log('  Screenshot: 08-later-gameplay.png');

    // Pause to see stats
    console.log('\nSTEP 9: Pause on cube-tunnel');
    await page.keyboard.press('Escape');
    await sleep(2000);
    await page.screenshot({ path: path.join(CUBETUNNEL_DIR, '09-pause-menu.png') });
    console.log('  Screenshot: 09-pause-menu.png');

    const ctPauseInfo = await page.evaluate(() => {
      return document.body.innerText.substring(0, 800);
    });
    console.log('  Pause text:', ctPauseInfo.replace(/\n/g, ' | ').substring(0, 300));

  } catch (err) {
    console.error('Cube-tunnel run error:', err.message);
    await page.screenshot({ path: path.join(CUBETUNNEL_DIR, 'error.png') }).catch(() => {});
  }
}

async function writeResultsSkeleton() {
  const sphereScreenshots = fs.existsSync(SPHERE_DIR)
    ? fs.readdirSync(SPHERE_DIR).filter(f => f.endsWith('.png')).sort()
    : [];
  const ctScreenshots = fs.existsSync(CUBETUNNEL_DIR)
    ? fs.readdirSync(CUBETUNNEL_DIR).filter(f => f.endsWith('.png')).sort()
    : [];

  const results = `# Visual Test: ${TASK_SLUG}

**Timestamp:** ${now.toISOString()}
**Commit:** ${COMMIT_HASH}
**Script:** tests/visual/test-main-gameplay.mjs
**Renderer:** WebGL2 via SwiftShader (headless)
**Goal:** Verify Main.ts Refactor, Performance, and Difficulty & Gameplay items from HUMAN_TEST.md

## Console Errors (${consoleErrors.length} total, first 15)

${consoleErrors.slice(0, 15).map(e => '- ' + e.substring(0, 200)).join('\n') || 'None'}

## Attempt 1: Sphere Surface (Main Gameplay)

**Screenshots:**
${sphereScreenshots.map(f => '- ' + f).join('\n')}

**Visual Analysis:**
> Claude must fill this in after reading each screenshot.

## Attempt 2: Cube-Tunnel Surface (Speed Normalization)

**Screenshots:**
${ctScreenshots.map(f => '- ' + f).join('\n')}

**Visual Analysis:**
> Claude must fill this in after reading each screenshot.

## HUMAN_TEST.md Item Verdicts

### Main.ts Refactor
- [ ] Player movement (WASD all directions): PENDING
- [ ] Shooting (click to fire, bullets hit enemies, enemies die): PENDING
- [ ] Pickups spawn after kills: PENDING
- [ ] Pickup collection (walk over pickups): PENDING
- [ ] Camera controls (scroll zoom): PENDING
- [ ] Screen flash on death: PENDING
- [ ] UI updates (score, multiplier, lives, bombs): PENDING
- [ ] Pause menu (ESC opens, shows stats, resume): PENDING

### Performance
- [ ] FPS counter visible (debug overlay F3): PENDING
- [ ] Performance graphs (pause -> performance tab): PENDING

### Difficulty & Gameplay
- [ ] Gets harder over waves (enemy count increases): PENDING
- [ ] Enemy speed visible: PENDING
- [ ] Cube-tunnel speed normalization: PENDING

## Conclusion

> Overall assessment pending visual analysis.
`;

  fs.writeFileSync(path.join(SESSION_DIR, 'RESULTS.md'), results);
  console.log(`\nRESULTS.md skeleton written to ${SESSION_DIR}/RESULTS.md`);
}

async function main() {
  console.log('=== Geometry Wars Visual Test: Main Gameplay ===');
  console.log(`Session: ${SESSION_NAME}`);
  console.log(`Commit: ${COMMIT_HASH}`);
  console.log(`Session dir: ${SESSION_DIR}`);

  fs.mkdirSync(SESSION_DIR, { recursive: true });

  // Check dev server
  try {
    const resp = await fetch(BASE_URL, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error('Dev server not responding');
    console.log('Dev server: OK');
  } catch (e) {
    console.error('ERROR: Dev server not running at', BASE_URL);
    process.exit(1);
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    await runSphereTests(page);
    await runCubeTunnelTests(page);
  } finally {
    await page.close();
    await browser.close();
  }

  await writeResultsSkeleton();

  console.log('\n=== Session Complete ===');
  console.log(`Screenshots: ${SESSION_DIR}`);
  console.log(`Console errors: ${consoleErrors.length}`);
  console.log(`Console warnings: ${consoleWarnings.length}`);

  if (consoleErrors.length > 0) {
    console.log('\nFirst 10 console errors:');
    consoleErrors.slice(0, 10).forEach(e => console.log('  - ' + e.substring(0, 150)));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
