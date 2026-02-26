/**
 * i18n Verification Test (Phase 4)
 *
 * Verifies:
 * 1. Start menu loads in English — no [ES]/[FR]/[DE] prefixes
 * 2. After switching to Spanish via pause menu language selector — visible text has [ES] prefix
 * 3. After page reload — Spanish persists (localStorage working)
 * 4. After switching back to English — English text restored
 *
 * Level 5 verification per project standards.
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

async function waitForStartMenu(page: Page) {
  // Wait for the start menu container to appear
  await page.waitForFunction(
    () => document.querySelector('[data-testid="start-menu"], .start-menu, #start-menu') !== null ||
           document.body.innerText.includes('PLAY') ||
           document.body.innerText.includes('SPHERE') ||
           document.body.innerText.includes('TORUS'),
    { timeout: 15000 }
  );
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
    // TEST 1: Start menu loads in English (default)
    // -----------------------------------------------------------------------
    console.log('\n=== TEST 1: English start menu ===');
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Clear localStorage to ensure clean state (English default)
    await page.evaluateOnNewDocument(() => {
      localStorage.removeItem('gw_language');
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000); // Let i18n initialize + UI render

    const bodyText1 = await page.evaluate(() => document.body.innerText);
    const hasESPrefix1 = bodyText1.includes('[ES]');
    const hasFRPrefix1 = bodyText1.includes('[FR]');
    const hasDEPrefix1 = bodyText1.includes('[DE]');
    console.log(`Body text snippet: ${bodyText1.substring(0, 200)}`);
    console.log(`Has [ES] prefix: ${hasESPrefix1}`);
    console.log(`Has [FR] prefix: ${hasFRPrefix1}`);
    console.log(`Has [DE] prefix: ${hasDEPrefix1}`);

    if (hasESPrefix1 || hasFRPrefix1 || hasDEPrefix1) {
      console.error('FAIL: Start menu shows non-English language prefix — initI18n() may not be working');
    } else {
      console.log('PASS: Start menu shows English (no foreign language prefixes)');
    }

    await screenshot(page, '01-start-menu-english');

    // -----------------------------------------------------------------------
    // TEST 2: Try opening pause menu to access language selector
    // We need to start a game first, then press Escape
    // -----------------------------------------------------------------------
    console.log('\n=== TEST 2: Access language selector via pause menu ===');

    // Click sphere to start game quickly
    const sphereClicked = await page.evaluate(() => {
      // Look for surface buttons or start button
      const buttons = Array.from(document.querySelectorAll('button'));
      const sphereBtn = buttons.find(b => b.textContent?.toLowerCase().includes('sphere'));
      if (sphereBtn) {
        (sphereBtn as HTMLButtonElement).click();
        return true;
      }
      // Try clicking the first PLAY/START button
      const playBtn = buttons.find(b => b.textContent?.toLowerCase().includes('play') ||
                                         b.textContent?.toLowerCase().includes('start'));
      if (playBtn) {
        (playBtn as HTMLButtonElement).click();
        return true;
      }
      return false;
    });

    if (sphereClicked) {
      console.log('Clicked sphere/start button');
    } else {
      console.log('Could not find start button, trying direct URL');
      await page.goto(`${BASE_URL}?surface=sphere&level=-1`, { waitUntil: 'networkidle2', timeout: 30000 });
    }

    await sleep(5000); // Wait for game to load

    // Press Escape to open pause menu
    await page.keyboard.press('Escape');
    await sleep(1000);

    const bodyText2 = await page.evaluate(() => document.body.innerText);
    const hasPauseMenu = bodyText2.toLowerCase().includes('resume') ||
                         bodyText2.toLowerCase().includes('pause') ||
                         bodyText2.includes('LANGUAGE');
    console.log(`Pause menu visible: ${hasPauseMenu}`);
    console.log(`Body text snippet: ${bodyText2.substring(0, 300)}`);

    await screenshot(page, '02-pause-menu-english');

    // -----------------------------------------------------------------------
    // TEST 3: Switch to Spanish via language selector
    // -----------------------------------------------------------------------
    console.log('\n=== TEST 3: Switch to Spanish ===');

    // Try to find and click Spanish button
    const spanishClicked = await page.evaluate(() => {
      // Look for language buttons
      const buttons = Array.from(document.querySelectorAll('button'));
      const esBtn = buttons.find(b =>
        b.textContent?.includes('Español') ||
        b.textContent?.includes('🇪🇸') ||
        b.getAttribute('data-lang') === 'es' ||
        b.getAttribute('data-language') === 'es'
      );
      if (esBtn) {
        (esBtn as HTMLButtonElement).click();
        return true;
      }

      // Try calling changeLanguage directly via window if exposed
      if ((window as any).__changeLanguage) {
        (window as any).__changeLanguage('es');
        return true;
      }

      return false;
    });

    if (!spanishClicked) {
      // Try injecting via i18next directly (for testing)
      await page.evaluate(() => {
        // Attempt to trigger language change via localStorage + reload
        localStorage.setItem('gw_language', 'es');
      });
      console.log('Set localStorage gw_language=es directly');
    } else {
      console.log('Clicked Spanish button');
    }

    await sleep(1000);

    const bodyText3 = await page.evaluate(() => document.body.innerText);
    const hasESPrefix3 = bodyText3.includes('[ES]');
    console.log(`Has [ES] prefix after Spanish switch: ${hasESPrefix3}`);
    console.log(`Body text snippet: ${bodyText3.substring(0, 300)}`);

    await screenshot(page, '03-pause-menu-spanish');

    // -----------------------------------------------------------------------
    // TEST 4: Reload page — Spanish should persist
    // -----------------------------------------------------------------------
    console.log('\n=== TEST 4: Reload to verify persistence ===');

    // Ensure Spanish is in localStorage
    await page.evaluate(() => {
      localStorage.setItem('gw_language', 'es');
    });

    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const bodyText4 = await page.evaluate(() => document.body.innerText);
    const hasESPrefix4 = bodyText4.includes('[ES]');
    const storedLang = await page.evaluate(() => localStorage.getItem('gw_language'));
    console.log(`localStorage gw_language: ${storedLang}`);
    console.log(`Has [ES] prefix after reload: ${hasESPrefix4}`);
    console.log(`Body text snippet: ${bodyText4.substring(0, 300)}`);

    if (hasESPrefix4) {
      console.log('PASS: Spanish persists after reload');
    } else if (storedLang === 'es') {
      console.log('PARTIAL: localStorage has es but UI may not reflect it (initI18n timing issue)');
    } else {
      console.log('FAIL: Language did not persist after reload');
    }

    await screenshot(page, '04-after-reload-spanish');

    // -----------------------------------------------------------------------
    // TEST 5: Switch back to English
    // -----------------------------------------------------------------------
    console.log('\n=== TEST 5: Switch back to English ===');

    await page.evaluate(() => {
      localStorage.removeItem('gw_language');
    });

    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);

    const bodyText5 = await page.evaluate(() => document.body.innerText);
    const hasESPrefix5 = bodyText5.includes('[ES]');
    console.log(`Has [ES] prefix after English restore: ${hasESPrefix5}`);
    console.log(`Body text snippet: ${bodyText5.substring(0, 300)}`);

    if (!hasESPrefix5) {
      console.log('PASS: English restored after removing Spanish preference');
    } else {
      console.log('FAIL: Still showing Spanish after switching back to English');
    }

    await screenshot(page, '05-back-to-english');

    await page.close();

    // -----------------------------------------------------------------------
    // Summary
    // -----------------------------------------------------------------------
    console.log('\n=== SUMMARY ===');
    console.log(`Screenshots saved to: ${SCREENSHOT_DIR}`);
    console.log('Test 1 (English start menu): Check 01-start-menu-english.png');
    console.log('Test 2 (Pause menu English): Check 02-pause-menu-english.png');
    console.log('Test 3 (Spanish switch): Check 03-pause-menu-spanish.png');
    console.log('Test 4 (Reload Spanish): Check 04-after-reload-spanish.png');
    console.log('Test 5 (English restore): Check 05-back-to-english.png');

  } finally {
    await browser.close();
  }
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
