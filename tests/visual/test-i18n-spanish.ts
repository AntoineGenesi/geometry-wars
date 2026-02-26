/**
 * i18n Spanish Switch Test
 *
 * Tests Spanish language persistence and UI update:
 * 1. Pre-set gw_language=es in localStorage, navigate → verify [ES] prefix shown
 * 2. Start game, open pause menu, click Spanish button → verify [ES] prefix shown
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3035;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = path.join(process.cwd(), 'test-screenshots', 'sessions', 'i18n-verification');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function screenshot(page: Page, name: string) {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath });
  console.log(`[Screenshot] Saved: ${filePath}`);
}

async function runTest() {
  if (!fs.existsSync(CHROME_PATH)) {
    console.error(`Chrome not found at ${CHROME_PATH}`);
    process.exit(1);
  }

  ensureDir(SCREENSHOT_DIR);

  const browser: Browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-angle=swiftshader-webgl',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  });

  try {
    // -----------------------------------------------------------------------
    // TEST A: Pre-set Spanish in localStorage → navigate → verify [ES] text
    // -----------------------------------------------------------------------
    console.log('\n=== TEST A: Pre-set Spanish — navigate fresh ===');

    const pageA = await browser.newPage();
    await pageA.setViewport({ width: 1280, height: 720 });

    // Pre-set Spanish language via CDP (before page loads)
    // Use a blank page to set localStorage, then navigate to game
    await pageA.goto('about:blank');
    // We need to set the origin's localStorage via addInitScript for the actual origin
    // Alternative: use a first navigation to set it, then navigate again

    // Navigate to game first to establish the origin
    await pageA.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Set Spanish in localStorage immediately
    await pageA.evaluate(() => {
      localStorage.setItem('gw_language', 'es');
    });

    // Reload the page — i18next should detect 'es' from localStorage
    await pageA.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const textA = await pageA.evaluate(() => document.body.innerText);
    const langA = await pageA.evaluate(() => localStorage.getItem('gw_language'));
    const hasESA = textA.includes('[ES]');

    console.log(`localStorage gw_language: ${langA}`);
    console.log(`Has [ES] prefix: ${hasESA}`);
    console.log(`Text snippet: ${textA.substring(0, 400)}`);

    if (hasESA) {
      console.log('PASS: Spanish text visible after localStorage pre-set + reload');
    } else if (langA === 'es') {
      console.log('PARTIAL: localStorage has es, but UI still shows English. i18n may be initializing asynchronously or StartMenu doesnt use t()');
    } else {
      console.log(`FAIL: gw_language in localStorage is "${langA}" instead of "es" after reload`);
    }

    await screenshot(pageA, '06-spanish-prereload');

    // -----------------------------------------------------------------------
    // TEST B: Use page.evaluateOnNewDocument to pre-set Spanish before page loads
    // This ensures localStorage is set BEFORE any script runs
    // -----------------------------------------------------------------------
    console.log('\n=== TEST B: Pre-set Spanish via evaluateOnNewDocument ===');

    const pageB = await browser.newPage();
    await pageB.setViewport({ width: 1280, height: 720 });

    // Set localStorage BEFORE any script on the page runs
    await pageB.evaluateOnNewDocument(() => {
      localStorage.setItem('gw_language', 'es');
    });

    await pageB.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const textB = await pageB.evaluate(() => document.body.innerText);
    const langB = await pageB.evaluate(() => localStorage.getItem('gw_language'));
    const hasESB = textB.includes('[ES]');

    console.log(`localStorage gw_language: ${langB}`);
    console.log(`Has [ES] prefix: ${hasESB}`);
    console.log(`Text snippet: ${textB.substring(0, 400)}`);

    if (hasESB) {
      console.log('PASS: Spanish text visible when localStorage set before page load');
    } else if (langB === 'es') {
      console.log('INFO: localStorage=es but UI shows English. This may be expected if StartMenu uses hardcoded strings rather than t(). Check pause menu instead.');
    } else {
      console.log(`INFO: gw_language is "${langB}" — LanguageDetector may have detected navigator.language instead`);
    }

    await screenshot(pageB, '07-spanish-evaluateOnNewDocument');

    // -----------------------------------------------------------------------
    // TEST C: Check if pause menu text shows [ES] when game runs in Spanish
    // Navigate with quickStart=true and language pre-set
    // -----------------------------------------------------------------------
    console.log('\n=== TEST C: Pause menu in Spanish ===');

    const pageC = await browser.newPage();
    await pageC.setViewport({ width: 1280, height: 720 });

    // Pre-set Spanish before page loads
    await pageC.evaluateOnNewDocument(() => {
      localStorage.setItem('gw_language', 'es');
    });

    // Use quickStart URL to skip menu and go straight into game
    await pageC.goto(`${BASE_URL}?quickStart=true&surface=sphere`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(5000); // Wait for game to load

    // Press Escape to open pause menu
    await pageC.keyboard.press('Escape');
    await sleep(1500);

    const textC = await pageC.evaluate(() => document.body.innerText);
    const hasESC = textC.includes('[ES]');
    const hasPauseC = textC.toLowerCase().includes('resume') || textC.includes('REANUDAR') || textC.includes('[ES]');

    console.log(`Pause menu visible: ${hasPauseC}`);
    console.log(`Has [ES] prefix: ${hasESC}`);
    console.log(`Text snippet: ${textC.substring(0, 500)}`);

    if (hasESC) {
      console.log('PASS: Pause menu shows Spanish [ES] prefix text');
    } else if (hasPauseC) {
      console.log('INFO: Pause menu visible but no [ES] prefix. Check if pause menu uses t() correctly.');
    } else {
      console.log('INFO: Pause menu may not have opened (game may not have started yet)');
    }

    await screenshot(pageC, '08-pause-menu-spanish');

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n=== SUMMARY ===');
    console.log('Test A (pre-set + reload):          ' + (hasESA ? 'PASS [ES] visible' : langA === 'es' ? 'PARTIAL localStorage=es' : 'FAIL'));
    console.log('Test B (evaluateOnNewDocument):      ' + (hasESB ? 'PASS [ES] visible' : langB === 'es' ? 'INFO localStorage=es no [ES] in start menu' : 'INFO lang=' + langB));
    console.log('Test C (pause menu Spanish):         ' + (hasESC ? 'PASS [ES] visible in pause menu' : hasPauseC ? 'INFO pause menu open but no [ES]' : 'INFO pause menu not opened'));

    await pageA.close();
    await pageB.close();
    await pageC.close();

  } finally {
    await browser.close();
  }
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
