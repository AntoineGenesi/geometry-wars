#!/usr/bin/env node
/**
 * S36 Phase 5 verification: screenshot the pause menu showing "WEAPON MASTERY" button
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'fs';

const PORT = process.env.PORT || 3014;
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function run() {
  const browser = await puppeteer.launch({
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
    headless: 'new',
    args: [
      '--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--window-size=1280,720',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.error('[PAGE ERROR]', msg.text());
  });

  const url = `http://localhost:${PORT}/?quickStart=true&surface=sphere`;
  console.log('Loading:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for game to start
  console.log('Waiting 8s for game to load...');
  await sleep(8000);

  // Press Escape to open pause menu
  console.log('Opening pause menu...');
  await page.keyboard.press('Escape');
  await sleep(1000);

  // Check if pause menu is visible
  const pauseMenuVisible = await page.evaluate(() => {
    const el = document.getElementById('pause-menu');
    if (!el) return 'not found';
    return el.classList.contains('hidden') ? 'hidden' : 'visible';
  });
  console.log('Pause menu state:', pauseMenuVisible);

  // Check if WEAPON MASTERY button exists
  const masteryBtnText = await page.evaluate(() => {
    const btn = document.querySelector('[data-action="mastery"]');
    if (!btn) return 'NOT FOUND';
    return btn.textContent?.trim() || 'found but empty';
  });
  console.log('WEAPON MASTERY button:', masteryBtnText);

  // Take screenshot
  mkdirSync('test-screenshots/sessions', { recursive: true });
  const screenshotPath = 'test-screenshots/sessions/s36-pause-mastery-button.png';
  await page.screenshot({ path: screenshotPath });
  console.log('Screenshot saved:', screenshotPath);

  await browser.close();
  console.log('Done.');
  return { pauseMenuVisible, masteryBtnText };
}

run().then(result => {
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));
}).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
