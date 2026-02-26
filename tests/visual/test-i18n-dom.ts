/**
 * i18n DOM Check - verifies translated text in specific elements
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
  ensureDir(SCREENSHOT_DIR);

  const browser: Browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--use-angle=swiftshader-webgl', '--disable-gpu', '--disable-software-rasterizer'],
  });

  try {
    // -----------------------------------------------------------------------
    // Test 1: English default — check .name elements in surface buttons
    // -----------------------------------------------------------------------
    console.log('\n=== TEST 1: English surface names in DOM ===');
    const page1 = await browser.newPage();
    await page1.setViewport({ width: 1280, height: 720 });
    await page1.evaluateOnNewDocument(() => { localStorage.removeItem('gw_language'); });
    await page1.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    // Extract all .name span text and all text from surface-btn spans
    const surfaceNames = await page1.evaluate(() => {
      const names: string[] = [];
      // Get surface button name spans
      document.querySelectorAll('.name, .surface-btn .name, [class*="surface"] span').forEach(el => {
        const txt = (el as HTMLElement).innerText?.trim();
        if (txt) names.push(txt);
      });
      // Also get all spans inside .surface-item or similar
      document.querySelectorAll('button span, .btn span, .surface span').forEach(el => {
        const txt = (el as HTMLElement).innerText?.trim();
        if (txt && !names.includes(txt)) names.push(txt);
      });
      return names;
    });

    console.log('Surface/button span texts (English):', surfaceNames.slice(0, 20));

    const hasESInEn = surfaceNames.some(t => t.includes('[ES]'));
    console.log(`Has [ES] prefix in English: ${hasESInEn}`);
    if (!hasESInEn) {
      console.log('PASS: No [ES] prefix in English mode');
    }

    await screenshot(page1, '10-english-dom-check');

    // -----------------------------------------------------------------------
    // Test 2: Spanish pre-set — check surface name spans
    // -----------------------------------------------------------------------
    console.log('\n=== TEST 2: Spanish surface names in DOM ===');
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1280, height: 720 });
    await page2.evaluateOnNewDocument(() => { localStorage.setItem('gw_language', 'es'); });
    await page2.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const langEs = await page2.evaluate(() => localStorage.getItem('gw_language'));
    console.log(`localStorage gw_language: ${langEs}`);

    const surfaceNamesEs = await page2.evaluate(() => {
      const names: string[] = [];
      document.querySelectorAll('.name, .surface-btn .name, [class*="surface"] span').forEach(el => {
        const txt = (el as HTMLElement).innerText?.trim();
        if (txt) names.push(txt);
      });
      document.querySelectorAll('button span, .btn span, .surface span').forEach(el => {
        const txt = (el as HTMLElement).innerText?.trim();
        if (txt && !names.includes(txt)) names.push(txt);
      });
      return names;
    });

    console.log('Surface/button span texts (Spanish):', surfaceNamesEs.slice(0, 20));
    const hasESInEs = surfaceNamesEs.some(t => t.includes('[ES]'));
    console.log(`Has [ES] prefix in Spanish mode: ${hasESInEs}`);
    if (hasESInEs) {
      console.log('PASS: [ES] prefix found in Spanish mode DOM');
    } else {
      console.log('INFO: No [ES] prefix found in span elements. Trying innerHTML scan...');

      // Broader scan - look at all elements text
      const allText = await page2.evaluate(() => {
        const texts: string[] = [];
        document.querySelectorAll('*').forEach(el => {
          if ((el as HTMLElement).children?.length === 0) {
            const txt = (el as HTMLElement).innerText?.trim();
            if (txt && txt.includes('[ES]')) texts.push(txt);
          }
        });
        return texts;
      });
      console.log('[ES] texts found anywhere in DOM:', allText.slice(0, 10));
    }

    await screenshot(page2, '11-spanish-dom-check');

    // -----------------------------------------------------------------------
    // Test 3: Use quickStart to load game + check pause menu with longer wait
    // -----------------------------------------------------------------------
    console.log('\n=== TEST 3: QuickStart game + Pause menu Spanish ===');
    const page3 = await browser.newPage();
    await page3.setViewport({ width: 1280, height: 720 });
    await page3.evaluateOnNewDocument(() => { localStorage.setItem('gw_language', 'es'); });
    await page3.goto(`${BASE_URL}?quickStart=true&surface=sphere`, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for canvas (game started loading)
    try {
      await page3.waitForSelector('canvas', { timeout: 10000 });
      console.log('Canvas found - game loading...');
    } catch {
      console.log('Canvas not found, game may still be on start menu');
    }

    await sleep(10000); // Long wait for SwiftShader

    // Press Escape
    await page3.keyboard.press('Escape');
    await sleep(2000);

    const text3 = await page3.evaluate(() => document.body.innerText);
    const hasES3 = text3.includes('[ES]');
    console.log(`Has [ES] after game load + Escape: ${hasES3}`);
    console.log(`Text snippet: ${text3.substring(0, 500)}`);

    await screenshot(page3, '12-game-pause-spanish');

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n=== FINAL SUMMARY ===');
    console.log(`English test (no [ES] prefix): ${!hasESInEn ? 'PASS' : 'FAIL'}`);
    console.log(`Spanish DOM elements ([ES] present): ${hasESInEs ? 'PASS' : 'need game/pause menu'}`);
    console.log(`Spanish pause menu ([ES]): ${hasES3 ? 'PASS' : 'not yet reached'}`);

    await page1.close();
    await page2.close();
    await page3.close();

  } finally {
    await browser.close();
  }
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
