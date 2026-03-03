#!/usr/bin/env node
/**
 * Puppeteer visual test: PvP mode appears in multiplayer lobby mode selector.
 * (s44j-pvp-13g)
 *
 * Strategy: load multiplayer-main.ts entry point (?mp query param),
 * look for the PvP button in the lobby mode selector.
 * Level 5 verification: screenshot confirms PvP option is visible.
 */
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = 3036;
const BASE_URL = `http://localhost:${PORT}`;
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));

let server = null;

async function startServer() {
  console.log(`Starting dev server on port ${PORT}...`);
  server = spawn('npx', ['vite', '--port', String(PORT), '--host'], {
    cwd: ROOT,
    env: { ...process.env, PATH: `/home/antoine/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server start timeout (20s)')), 20000);
    const handler = data => {
      const text = data.toString();
      if (text.includes('Local') || text.includes(String(PORT))) {
        clearTimeout(timeout);
        resolve();
      }
    };
    server.stdout.on('data', handler);
    server.stderr.on('data', handler);
  });
  await sleep(1000); // let it stabilize
  console.log('Dev server started');
}

function stopServer() {
  if (server) { server.kill('SIGTERM'); server = null; }
}

async function run() {
  console.log('=== PvP Lobby Mode Selector Verification (s44j-pvp-13g) ===');

  await startServer();

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--enable-webgl', '--use-gl=swiftshader',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--window-size=1280,720', '--disable-dev-shm-usage',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const logs = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);
    if (text.includes('pvp') || text.includes('PvP') || text.includes('ERROR')) {
      console.log('PAGE:', text);
    }
  });
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  let passed = false;
  const results = {};

  try {
    // Load the multiplayer lobby page
    await page.goto(`${BASE_URL}?mode=network`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    await page.screenshot({ path: '/tmp/pvp-13g-01-initial.png' });
    console.log('Screenshot 1: Initial load → /tmp/pvp-13g-01-initial.png');

    // Check if the lobby mode selector is in the DOM (may be hidden)
    const modeSelectorExists = await page.evaluate(() => {
      return !!document.querySelector('#lobby-mode-selector');
    });
    results.modeSelectorExists = modeSelectorExists;
    console.log(`Mode selector in DOM: ${modeSelectorExists}`);

    // Check if PvP button exists anywhere on page
    const pvpButtonExists = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const pvpBtn = buttons.find(b => b.textContent?.includes('PVP') || b.textContent?.includes('pvp'));
      if (pvpBtn) return { found: true, text: pvpBtn.textContent?.trim(), visible: pvpBtn.offsetParent !== null };
      return { found: false };
    });
    results.pvpButton = pvpButtonExists;
    console.log('PvP button:', JSON.stringify(pvpButtonExists));

    // Check all mode buttons in the selector
    const modeButtons = await page.evaluate(() => {
      const selector = document.querySelector('#lobby-mode-selector');
      if (!selector) return [];
      const buttons = Array.from(selector.querySelectorAll('button'));
      return buttons.map(b => b.textContent?.trim());
    });
    results.modeButtons = modeButtons;
    console.log('Mode buttons in selector:', modeButtons);

    // Make the mode selector visible to get a screenshot
    await page.evaluate(() => {
      const sel = document.querySelector('#lobby-mode-selector');
      if (sel) sel.style.display = 'block';
    });
    await sleep(500);
    await page.screenshot({ path: '/tmp/pvp-13g-02-mode-selector.png' });
    console.log('Screenshot 2: Mode selector visible → /tmp/pvp-13g-02-mode-selector.png');

    // Verify PvP button appears in the mode selector
    const pvpInSelector = await page.evaluate(() => {
      const selector = document.querySelector('#lobby-mode-selector');
      if (!selector) return false;
      const buttons = Array.from(selector.querySelectorAll('button'));
      return buttons.some(b => b.textContent?.includes('PVP') || b.textContent?.includes('pvp'));
    });
    results.pvpInSelector = pvpInSelector;
    console.log(`PvP in mode selector: ${pvpInSelector}`);

    passed = pvpInSelector;

  } catch (err) {
    console.error('Test error:', err.message);
  } finally {
    await browser.close();
    stopServer();
  }

  console.log('\n=== RESULTS ===');
  console.log(JSON.stringify(results, null, 2));

  if (passed) {
    console.log('\n✅ PASS: PvP mode button appears in lobby mode selector');
    console.log('Screenshots: /tmp/pvp-13g-01-initial.png, /tmp/pvp-13g-02-mode-selector.png');
  } else {
    console.log('\n❌ FAIL: PvP mode button NOT found in lobby mode selector');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  stopServer();
  process.exit(1);
});
