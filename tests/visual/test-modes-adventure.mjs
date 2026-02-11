#!/usr/bin/env node
/**
 * Visual Test: Game Modes + Adventure Mode
 *
 * Tests all 5 game modes (Waves, King, Rainbow, Sniper, Claustrophobia)
 * and Adventure Mode (level grid, level start, timer/lives/bombs HUD).
 *
 * Usage:
 *   node tests/visual/test-modes-adventure.mjs [task-slug] [commit-hash]
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3000';
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// CLI args
const TASK_SLUG = process.argv[2] || 'modes-adventure';
const COMMIT_HASH = process.argv[3] || 'unknown';

// Session directory
const now = new Date();
const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
const SESSION_NAME = `${ts}_${TASK_SLUG}`;
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'test-screenshots', 'sessions', SESSION_NAME);

// Sub-directories
const MODES_DIR = path.join(SCREENSHOT_DIR, 'modes');
const ADVENTURE_DIR = path.join(SCREENSHOT_DIR, 'adventure');

const consoleErrors = [];
const consoleWarnings = [];
let screenshotIndex = 0;

function nextScreenshot(dir, name) {
  screenshotIndex++;
  const idx = String(screenshotIndex).padStart(2, '0');
  return path.join(dir, `${idx}-${name}.png`);
}

async function run() {
  // Create directories
  fs.mkdirSync(MODES_DIR, { recursive: true });
  fs.mkdirSync(ADVENTURE_DIR, { recursive: true });

  console.log('='.repeat(70));
  console.log('  VISUAL TEST: Game Modes + Adventure Mode');
  console.log(`  Session: ${SESSION_NAME}`);
  console.log(`  Commit: ${COMMIT_HASH}`);
  console.log('='.repeat(70));

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

  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  try {
    // ==================================================================
    // PART 1: GAME MODES
    // ==================================================================
    console.log('\n=== PART 1: GAME MODES ===\n');

    // 1a. Load start menu and navigate to Quick Game
    console.log('1a. Loading start menu...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    await page.screenshot({ path: nextScreenshot(MODES_DIR, 'start-menu') });
    console.log('    Screenshot: start menu');

    // 1b. Click QUICK GAME
    console.log('1b. Clicking QUICK GAME...');
    const quickGameClicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('.oval-btn');
      for (const btn of btns) {
        if (btn.textContent?.includes('QUICK GAME')) {
          btn.click();
          return true;
        }
      }
      // Fallback: data-mode="single"
      const btn = document.querySelector('[data-mode="single"]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log(`    Quick Game button found: ${quickGameClicked}`);
    await sleep(2000);

    // Screenshot the mode selector panel
    await page.screenshot({ path: nextScreenshot(MODES_DIR, 'mode-selector') });
    console.log('    Screenshot: mode selector panel');

    // Check which mode buttons exist
    const modeButtonInfo = await page.evaluate(() => {
      const modeBtns = document.querySelectorAll('.mode-btn');
      const info = [];
      modeBtns.forEach(btn => {
        info.push({
          type: btn.getAttribute('data-mode-type'),
          text: btn.textContent?.trim(),
          selected: btn.classList.contains('selected'),
          visible: btn.offsetParent !== null,
        });
      });
      return info;
    });
    console.log('    Mode buttons found:', JSON.stringify(modeButtonInfo, null, 2));

    // 1c. Test each game mode
    const modes = ['waves', 'king', 'rainbow', 'sniper', 'claustrophobia'];

    for (const mode of modes) {
      console.log(`\n--- Testing mode: ${mode.toUpperCase()} ---`);

      // If not on the mode selector, navigate back
      const onModeSelector = await page.evaluate(() => {
        const surfaceSection = document.querySelector('#surface-section');
        return surfaceSection && !surfaceSection.classList.contains('hidden');
      });

      if (!onModeSelector) {
        console.log('    Navigating back to mode selector...');
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(5000);

        // Click Quick Game
        await page.evaluate(() => {
          const btn = document.querySelector('[data-mode="single"]');
          if (btn) btn.click();
        });
        await sleep(2000);
      }

      // Click the mode button
      const modeClicked = await page.evaluate((modeType) => {
        const btn = document.querySelector(`.mode-btn[data-mode-type="${modeType}"]`);
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      }, mode);
      console.log(`    Mode button clicked: ${modeClicked}`);
      await sleep(500);

      // Screenshot mode selection
      await page.screenshot({ path: nextScreenshot(MODES_DIR, `mode-${mode}-selected`) });
      console.log(`    Screenshot: ${mode} mode selected`);

      // Select sphere surface
      await page.evaluate(() => {
        const section = document.querySelector('#surface-section');
        if (section) {
          const btn = section.querySelector('.surface-btn[data-surface="sphere"]') ||
            section.querySelector('.surface-btn');
          if (btn) btn.click();
        }
      });
      await sleep(300);

      // Click START
      const startClicked = await page.evaluate(() => {
        const btn = document.querySelector('#surface-start-btn');
        if (btn) {
          btn.scrollIntoView();
          btn.click();
          return true;
        }
        return false;
      });
      console.log(`    START clicked: ${startClicked}`);
      await sleep(7000); // Wait for game to load (SwiftShader is slow)

      // Screenshot gameplay
      await page.screenshot({ path: nextScreenshot(MODES_DIR, `mode-${mode}-gameplay`) });
      console.log(`    Screenshot: ${mode} gameplay`);

      // Interact: move and shoot
      await page.keyboard.down('w');
      await page.mouse.move(800, 400);
      await page.mouse.down();
      await sleep(3000);
      await page.mouse.up();
      await page.keyboard.up('w');
      await sleep(500);

      // Screenshot after gameplay
      await page.screenshot({ path: nextScreenshot(MODES_DIR, `mode-${mode}-playing`) });
      console.log(`    Screenshot: ${mode} after play`);

      // Pause to check HUD
      await page.keyboard.press('Escape');
      await sleep(2000);
      await page.screenshot({ path: nextScreenshot(MODES_DIR, `mode-${mode}-paused`) });
      console.log(`    Screenshot: ${mode} paused`);

      // Check for mode-specific HUD elements
      const hudInfo = await page.evaluate(() => {
        const body = document.body.innerText;
        return {
          hasPaused: body.includes('PAUSED'),
          bodyText: body.substring(0, 500),
          hasScore: !!document.getElementById('score-display'),
          hasLives: !!document.getElementById('lives-display'),
          hasBombs: !!document.getElementById('bombs-display'),
          hasTimer: !!document.getElementById('timer-display'),
        };
      });
      console.log(`    HUD info: score=${hudInfo.hasScore}, lives=${hudInfo.hasLives}, bombs=${hudInfo.hasBombs}, timer=${hudInfo.hasTimer}`);
      console.log(`    Paused text visible: ${hudInfo.hasPaused}`);
    }

    // ==================================================================
    // PART 2: ADVENTURE MODE
    // ==================================================================
    console.log('\n\n=== PART 2: ADVENTURE MODE ===\n');

    // 2a. Navigate back to start menu
    console.log('2a. Navigating to start menu...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    await page.screenshot({ path: nextScreenshot(ADVENTURE_DIR, 'start-menu') });
    console.log('    Screenshot: start menu for adventure');

    // 2b. Check if Adventure button exists
    const adventureButtonInfo = await page.evaluate(() => {
      const btns = document.querySelectorAll('.oval-btn');
      let adventureBtn = null;
      btns.forEach(btn => {
        if (btn.textContent?.includes('ADVENTURE')) {
          adventureBtn = {
            text: btn.textContent?.trim(),
            mode: btn.getAttribute('data-mode'),
            visible: btn.offsetParent !== null,
            isPrimary: btn.classList.contains('oval-btn-primary'),
          };
        }
      });
      return adventureBtn;
    });
    console.log('    Adventure button:', JSON.stringify(adventureButtonInfo));

    // 2c. Click Adventure
    console.log('2c. Clicking ADVENTURE...');
    const adventureClicked = await page.evaluate(() => {
      const btn = document.querySelector('[data-mode="adventure"]');
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log(`    Adventure clicked: ${adventureClicked}`);
    await sleep(2000);

    // Screenshot level grid
    await page.screenshot({ path: nextScreenshot(ADVENTURE_DIR, 'level-grid') });
    console.log('    Screenshot: level grid');

    // Get level grid info
    const levelGridInfo = await page.evaluate(() => {
      const levelBtns = document.querySelectorAll('.level-btn');
      const sections = document.querySelectorAll('.level-section h4');
      const sectionNames = [];
      sections.forEach(s => sectionNames.push(s.textContent?.trim()));

      const levels = [];
      levelBtns.forEach((btn, i) => {
        levels.push({
          index: i,
          num: btn.querySelector('.level-num')?.textContent?.trim(),
          name: btn.querySelector('.level-name')?.textContent?.trim(),
          stars: btn.querySelector('.level-stars')?.textContent?.trim(),
          locked: btn.classList.contains('locked'),
          disabled: btn.hasAttribute('disabled'),
        });
      });

      return {
        totalLevels: levelBtns.length,
        sectionNames,
        sectionCount: sections.length,
        levels: levels.slice(0, 10), // first 10 for brevity
        lockedCount: levels.filter(l => l.locked).length,
        unlockedCount: levels.filter(l => !l.locked).length,
      };
    });
    console.log(`    Total levels: ${levelGridInfo.totalLevels}`);
    console.log(`    Sections (${levelGridInfo.sectionCount}): ${levelGridInfo.sectionNames.join(', ')}`);
    console.log(`    Unlocked: ${levelGridInfo.unlockedCount}, Locked: ${levelGridInfo.lockedCount}`);
    console.log(`    First 5 levels:`, JSON.stringify(levelGridInfo.levels.slice(0, 5), null, 2));

    // Scroll down to see more of the grid
    await page.evaluate(() => {
      const grid = document.querySelector('.level-grid');
      if (grid) grid.scrollTop = grid.scrollHeight;
    });
    await sleep(500);
    await page.screenshot({ path: nextScreenshot(ADVENTURE_DIR, 'level-grid-scrolled') });
    console.log('    Screenshot: level grid scrolled down');

    // 2d. Click Level 1
    console.log('2d. Clicking Level 1...');
    const level1Clicked = await page.evaluate(() => {
      const btn = document.querySelector('.level-btn[data-level="0"]:not(.locked)');
      if (btn) {
        btn.click();
        return true;
      }
      // Fallback: first non-locked level
      const firstUnlocked = document.querySelector('.level-btn:not(.locked)');
      if (firstUnlocked) { firstUnlocked.click(); return true; }
      return false;
    });
    console.log(`    Level 1 clicked: ${level1Clicked}`);
    await sleep(8000); // Wait for game to load

    // Screenshot adventure gameplay
    await page.screenshot({ path: nextScreenshot(ADVENTURE_DIR, 'adventure-gameplay') });
    console.log('    Screenshot: adventure gameplay');

    // Check for timer, lives, bombs in HUD
    const adventureHudInfo = await page.evaluate(() => {
      const timerEl = document.getElementById('timer-display');
      const livesEl = document.getElementById('lives-display');
      const bombsEl = document.getElementById('bombs-display');
      const scoreEl = document.getElementById('score-display');
      const body = document.body.innerText;

      return {
        timer: timerEl ? { visible: timerEl.offsetParent !== null, text: timerEl.textContent?.trim() } : null,
        lives: livesEl ? { visible: livesEl.offsetParent !== null, text: livesEl.textContent?.trim() } : null,
        bombs: bombsEl ? { visible: bombsEl.offsetParent !== null, text: bombsEl.textContent?.trim() } : null,
        score: scoreEl ? { visible: scoreEl.offsetParent !== null, text: scoreEl.textContent?.trim() } : null,
        bodyText: body.substring(0, 300),
        menuHidden: (() => {
          const menu = document.getElementById('start-menu');
          return menu ? (menu.style.display === 'none' || menu.classList.contains('hidden')) : true;
        })(),
        canvasExists: !!document.querySelector('canvas'),
      };
    });
    console.log('    Adventure HUD:', JSON.stringify(adventureHudInfo, null, 2));

    // Play a bit in adventure mode
    await page.keyboard.down('w');
    await page.mouse.move(700, 300);
    await page.mouse.down();
    await sleep(4000);
    await page.mouse.up();
    await page.keyboard.up('w');

    // Move in different direction and shoot
    await page.keyboard.down('d');
    await page.mouse.move(900, 350);
    await page.mouse.down();
    await sleep(3000);
    await page.mouse.up();
    await page.keyboard.up('d');

    await page.screenshot({ path: nextScreenshot(ADVENTURE_DIR, 'adventure-playing') });
    console.log('    Screenshot: adventure after playing');

    // Pause and check HUD
    await page.keyboard.press('Escape');
    await sleep(2000);
    await page.screenshot({ path: nextScreenshot(ADVENTURE_DIR, 'adventure-paused') });
    console.log('    Screenshot: adventure paused');

    const pauseInfo = await page.evaluate(() => {
      return {
        bodyText: document.body.innerText.substring(0, 600),
        hasPaused: document.body.innerText.includes('PAUSED'),
      };
    });
    console.log(`    Paused: ${pauseInfo.hasPaused}`);

    // 2e. Check for locked level behavior
    console.log('2e. Testing locked level behavior...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    // Click Adventure
    await page.evaluate(() => {
      const btn = document.querySelector('[data-mode="adventure"]');
      if (btn) btn.click();
    });
    await sleep(2000);

    // Try to click a locked level
    const lockedLevelClick = await page.evaluate(() => {
      const lockedBtns = document.querySelectorAll('.level-btn.locked');
      if (lockedBtns.length > 0) {
        const btn = lockedBtns[0];
        btn.click();
        return {
          clicked: true,
          disabled: btn.hasAttribute('disabled'),
          levelNum: btn.querySelector('.level-num')?.textContent?.trim(),
          stars: btn.querySelector('.level-stars')?.textContent?.trim(),
        };
      }
      return { clicked: false };
    });
    console.log('    Locked level click test:', JSON.stringify(lockedLevelClick));
    await sleep(1000);

    // Screenshot - we should still be on the level grid (locked level shouldn't start)
    await page.screenshot({ path: nextScreenshot(ADVENTURE_DIR, 'locked-level-test') });
    console.log('    Screenshot: after clicking locked level');

    // Check if still on level grid
    const stillOnGrid = await page.evaluate(() => {
      const adventureSection = document.querySelector('#adventure-levels');
      return adventureSection && !adventureSection.classList.contains('hidden');
    });
    console.log(`    Still on level grid after clicking locked: ${stillOnGrid}`);

    // 2f. Test Back button
    console.log('2f. Testing Back button...');
    await page.evaluate(() => {
      const btn = document.querySelector('#adventure-back');
      if (btn) btn.click();
    });
    await sleep(1000);
    await page.screenshot({ path: nextScreenshot(ADVENTURE_DIR, 'back-to-menu') });

    const backToMenu = await page.evaluate(() => {
      const mainBtns = document.querySelector('#main-buttons');
      return mainBtns && !mainBtns.classList.contains('hidden');
    });
    console.log(`    Back to main menu: ${backToMenu}`);

    // ==================================================================
    // WRITE RESULTS
    // ==================================================================
    console.log('\n\n=== Writing RESULTS.md ===');

    const allScreenshots = [];
    for (const dir of [MODES_DIR, ADVENTURE_DIR]) {
      const dirName = path.basename(dir);
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.png')).sort();
      files.forEach(f => allScreenshots.push(`${dirName}/${f}`));
    }

    const resultsContent = `# Visual Test: Game Modes + Adventure Mode
**Timestamp:** ${now.toISOString()}
**Task:** ${TASK_SLUG}
**Commit:** ${COMMIT_HASH}
**Script:** tests/visual/test-modes-adventure.mjs
**Renderer:** WebGL2 via SwiftShader (headless)
**Console Errors:** ${consoleErrors.length}

## Goal
"I need to see the mode selector with 5 modes in Quick Game, each mode starting gameplay on sphere, and the Adventure level grid with 50 levels in 6 sections."

## Screenshots

${allScreenshots.map(f => `- ${f}`).join('\n')}

## Console Errors (first 10)

${consoleErrors.slice(0, 10).map(e => `- ${e.substring(0, 200)}`).join('\n') || 'None'}

## Mode Button Info

${JSON.stringify(modeButtonInfo, null, 2)}

## Level Grid Info

- Total levels: ${levelGridInfo.totalLevels}
- Sections (${levelGridInfo.sectionCount}): ${levelGridInfo.sectionNames.join(', ')}
- Unlocked: ${levelGridInfo.unlockedCount}, Locked: ${levelGridInfo.lockedCount}
- First 5 levels: ${JSON.stringify(levelGridInfo.levels.slice(0, 5), null, 2)}

## Adventure HUD Info

${JSON.stringify(adventureHudInfo, null, 2)}

## Visual Analysis

> **Claude must fill this in after reading each screenshot.**

## HUMAN_TEST.md Checklist Results

### Game Modes
- [ ] Mode selector visible — ?
- [ ] Waves mode — ?
- [ ] King mode — ?
- [ ] Rainbow mode — ?
- [ ] Sniper mode — ?
- [ ] Claustrophobia mode — ?

### Adventure Mode - Level Select UI
- [ ] Adventure button visible — ?
- [ ] Level grid displays (50 levels, 6 sections) — ?
- [ ] Locked levels show lock icon — ?
- [ ] Star ratings display — ?
- [ ] Section headers visible — ?

### Adventure Mode - Level Gameplay
- [ ] Level starts on click — ?
- [ ] Scripted waves spawn — ?
- [ ] Timer/lives/bombs shown — ?

### Adventure Mode - Edge Cases
- [ ] Can't click locked levels — ?
- [ ] Back button works — ?

## Conclusion

> Fill in after analysis.
`;

    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'RESULTS.md'), resultsContent);
    console.log(`  RESULTS.md written to ${SCREENSHOT_DIR}`);

  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    try {
      await page.screenshot({ path: nextScreenshot(SCREENSHOT_DIR, 'error') });
    } catch (_) {}
  } finally {
    await browser.close();
    console.log('\n=== Test Complete ===');
    console.log(`  Screenshots: ${SCREENSHOT_DIR}`);
    console.log(`  Console errors: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      consoleErrors.slice(0, 5).forEach(e => console.log(`    - ${e.substring(0, 150)}`));
    }
  }
}

run();
