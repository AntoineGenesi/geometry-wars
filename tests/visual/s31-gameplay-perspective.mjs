import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';
import { join } from 'path';

const SCREENSHOT_DIR = '/mnt/c/Users/User/Documents/claude code experiments/Geometry Wars/.claude/worktrees/s31-iphone-perspective-stretched/test-screenshots/sessions/s31-iphone-perspective';
const CHROME = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = 3018;

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startGameAndScreenshot(browser, w, h, label) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for start menu
  await page.waitForSelector('#start-menu', { timeout: 30000 }).catch(() => {});
  await page.evaluate(() => {
    const ls = document.getElementById('loading-screen');
    if (ls) { ls.style.display = 'none'; }
  });
  await sleep(500);

  // Click Quick Game
  const clickedMode = await page.evaluate(() => {
    const btn = document.querySelector('[data-mode="single"]');
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log(`  Clicked mode: ${clickedMode}`);
  await sleep(600);

  // Click start button (sphere is default)
  const clickedStart = await page.evaluate(() => {
    const btn = document.querySelector('#surface-start-btn');
    if (btn) { btn.click(); return true; }
    // Try alternate selector
    const btns = Array.from(document.querySelectorAll('button'));
    const startBtn = btns.find(b => b.textContent.trim().toLowerCase().includes('start'));
    if (startBtn) { startBtn.click(); return 'found-alt'; }
    return false;
  });
  console.log(`  Clicked start: ${clickedStart}`);

  // Wait for 3D game to initialize and render
  await sleep(12000);

  const path = join(SCREENSHOT_DIR, `${label}.png`);
  await page.screenshot({ path });
  console.log(`  [screenshot] ${label}.png`);

  await page.close();
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox','--disable-setuid-sandbox','--use-gl=swiftshader','--enable-webgl','--ignore-gpu-blocklist','--disable-gpu-sandbox'],
});

try {
  console.log('[1] iPhone 13 landscape gameplay (844x390)');
  await startGameAndScreenshot(browser, 844, 390, '10-iphone13-gameplay');

  console.log('[2] Desktop 1280x720 gameplay');
  await startGameAndScreenshot(browser, 1280, 720, '11-desktop-gameplay');
} finally {
  await browser.close();
}
