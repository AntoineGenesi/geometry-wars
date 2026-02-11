#!/usr/bin/env node
/**
 * Targeted visual verification for Adventure Mode
 * Tests: level select grid, section headers, lock icons, level click → game starts
 */
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'test-screenshots', 'adventure');
const BASE_URL = 'http://localhost:3000';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
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

  const results = [];

  function log(test, pass, detail) {
    const status = pass ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${test}${detail ? ': ' + detail : ''}`);
    results.push({ test, pass, detail });
  }

  try {
    const fs = await import('fs');
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    console.log('\n=== Adventure Mode Visual Verification ===\n');

    // 1. Load start menu
    console.log('  Loading start menu...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000); // Wait for Three.js + UI to initialize
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-start-menu.png') });

    // 2. Check if ADVENTURE button exists
    const adventureBtn = await page.$('[data-mode="adventure"]');
    if (adventureBtn) {
      log('Adventure button exists', true, 'found via data-mode');
    } else {
      const btns = await page.$$('button');
      let found = false;
      for (const btn of btns) {
        const text = await page.evaluate(el => el.textContent, btn);
        if (text && text.toUpperCase().includes('ADVENTURE')) {
          found = true;
          break;
        }
      }
      log('Adventure button exists', found, found ? 'found by text' : 'NOT FOUND');
    }

    // 3. Click ADVENTURE to open level select
    console.log('  Clicking ADVENTURE...');
    const clicked = await page.evaluate(() => {
      let btn = document.querySelector('[data-mode="adventure"]');
      if (btn) { btn.click(); return 'data-mode'; }
      const buttons = document.querySelectorAll('button');
      for (const b of buttons) {
        if (b.textContent && b.textContent.toUpperCase().includes('ADVENTURE')) {
          b.click();
          return 'text-match';
        }
      }
      return null;
    });

    if (clicked) {
      await sleep(2000);
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-level-select.png') });
      log('Level select opened', true, `via ${clicked}`);

      // 4. Check for level grid elements
      const levelCells = await page.$$('.level-cell, .adventure-level, [data-level]');
      log('Level grid has cells', levelCells.length > 0, `found ${levelCells.length} level cells`);

      // 5. Check for section headers (gem names)
      const sectionHeaders = await page.evaluate(() => {
        const allText = document.body.innerText;
        const gems = ['SAPPHIRE', 'RUBY', 'EMERALD', 'OPAL', 'AMETHYST', 'TOPAZ'];
        return gems.filter(g => allText.toUpperCase().includes(g));
      });
      log('Section headers visible', sectionHeaders.length > 0,
        sectionHeaders.length > 0 ? sectionHeaders.join(', ') : 'no gem section headers');

      // 6. Check for lock icons
      const lockInfo = await page.evaluate(() => {
        const text = document.body.innerText;
        const lockCount = (text.match(/🔒/g) || []).length;
        return { lockCount, hasLocks: lockCount > 0 };
      });
      log('Locked levels show lock icons', lockInfo.hasLocks, `${lockInfo.lockCount} lock icons`);

      // 7. Click Level 1
      console.log('  Clicking Level 1...');
      const level1Clicked = await page.evaluate(() => {
        const selectors = ['[data-level="1"]', '[data-level="0"]', '.level-cell:first-child', '.adventure-level:first-child'];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) { el.click(); return sel; }
        }
        const cells = document.querySelectorAll('.level-cell, .adventure-level, [data-level]');
        if (cells.length > 0) { cells[0].click(); return 'first-cell'; }
        return null;
      });

      if (level1Clicked) {
        await sleep(5000);
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-level-1-gameplay.png') });
        const canvasInfo = await page.evaluate(() => {
          const canvas = document.querySelector('canvas');
          if (!canvas) return { exists: false };
          return { exists: true, width: canvas.width, height: canvas.height, visible: canvas.style.display !== 'none' };
        });
        log('Level 1 started (game canvas active)', canvasInfo.exists && canvasInfo.visible,
          canvasInfo.exists ? `${canvasInfo.width}x${canvasInfo.height}` : 'no canvas');
      } else {
        log('Level 1 click', false, 'could not find level 1 button');
      }
    } else {
      log('Level select opened', false, 'could not click adventure button');
    }

    // Summary
    console.log('\n=== Results ===');
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    console.log(`  ${passed} passed, ${failed} failed out of ${results.length} checks`);
    console.log(`  Screenshots saved to: ${SCREENSHOT_DIR}`);

  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
  } finally {
    await browser.close();
  }
}

run();
