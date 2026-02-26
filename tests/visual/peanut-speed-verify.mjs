#!/usr/bin/env node
/**
 * Peanut speed variation fix verification (S36)
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

const BASE_URL = 'http://localhost:3043';
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const SCREENSHOT_DIR = '/tmp/peanut-verify';
const sleep = ms => new Promise(r => setTimeout(r, ms));

mkdirSync(SCREENSHOT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl',
    '--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('pageerror', err => errors.push(err.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

try {
  console.log('1. Loading start menu...');
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await sleep(5000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/01-start-menu.png` });

  console.log('2. Clicking QUICK GAME...');
  await page.evaluate(() => {
    const btn = document.querySelector('[data-mode="quick"]') ||
      [...document.querySelectorAll('button, .btn')].find(el => el.textContent.includes('QUICK'));
    if (btn) btn.click();
  });
  await sleep(1500);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/02-quick-game.png` });

  console.log('3. Selecting Peanut surface...');
  const peanutResult = await page.evaluate(() => {
    const btn = document.querySelector('[data-surface="peanut"]') ||
      [...document.querySelectorAll('button, .surface-btn')].find(el =>
        el.textContent.toLowerCase().includes('peanut'));
    if (btn) { btn.click(); return btn.textContent; }
    // List all surface buttons for debug
    return 'Not found. Buttons: ' + [...document.querySelectorAll('[data-surface]')].map(b => b.dataset.surface).join(',');
  });
  console.log('   Peanut:', peanutResult);
  await sleep(500);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/03-peanut-selected.png` });

  console.log('4. Clicking START...');
  const startResult = await page.evaluate(() => {
    const btn = document.querySelector('#surface-start-btn') ||
      [...document.querySelectorAll('button')].find(el =>
        el.textContent.trim().includes('START'));
    if (btn) { btn.scrollIntoView(); btn.click(); return btn.textContent.trim(); }
    return 'Not found';
  });
  console.log('   START:', startResult);
  await sleep(8000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/04-game-started.png` });

  // Move around to test speed
  console.log('5. Moving toward waist (S key 3s)...');
  await page.keyboard.down('s');
  await sleep(3000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/05-waist.png` });
  await page.keyboard.up('s');

  console.log('6. Moving toward bulge (W key 3s)...');
  await page.keyboard.down('w');
  await sleep(3000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/06-bulge.png` });
  await page.keyboard.up('w');

  await sleep(2000);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/07-final.png` });

  console.log('\n=== Done ===');
  console.log('Errors:', errors.filter(e => !e.includes('404')).length ? errors.join('\n') : 'none');
} catch (e) {
  console.error('Error:', e.message);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/error.png` }).catch(() => {});
} finally {
  await browser.close();
}
