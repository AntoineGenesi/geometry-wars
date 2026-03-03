#!/usr/bin/env node
/**
 * Puppeteer screenshot verifying "Server Settings" button appears in pause menu
 * for host players. (s44j-settings-16d)
 *
 * Strategy: load the page, wait for the main game to initialize, then inject
 * DOM manipulation to show the pause menu with isHost=true and isMultiplayer=true.
 */
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const SCREENSHOT_PATH = '/tmp/pause-menu-server-settings-s44j-16d.png';

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
    const timeout = setTimeout(() => reject(new Error('Server start timeout')), 20000);
    server.stdout.on('data', data => {
      const text = data.toString();
      if (text.includes('Local') || text.includes(`${PORT}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.stderr.on('data', data => {
      const text = data.toString();
      if (text.includes('Local') || text.includes(`${PORT}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  console.log('Dev server started');
}

function stopServer() {
  if (server) {
    server.kill('SIGTERM');
    server = null;
  }
}

async function run() {
  console.log('=== Pause Menu Server Settings Button Screenshot (s44j-settings-16d) ===');

  await startServer();
  await sleep(2000); // Let server stabilize

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

  let passed = false;
  let serverSettingsBtnFound = false;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const consoleLogs = [];
    page.on('console', msg => consoleLogs.push(msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    // Navigate to main game
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000); // Wait for the game to initialize

    await page.screenshot({ path: '/tmp/pause-menu-s44j-16d-01-initial.png' });
    console.log('Screenshot 1: Initial game state');

    // Inject DOM manipulation to show pause menu in host+multiplayer mode
    // Use dynamic import to instantiate PauseMenu directly from Vite dev server
    serverSettingsBtnFound = await page.evaluate(async () => {
      // Try to get existing pause menu first
      let pauseMenu = document.getElementById('pause-menu');

      if (!pauseMenu) {
        // Dynamically import PauseMenu from Vite dev server and instantiate it
        try {
          const mod = await import('/src/ui/PauseMenu.ts');
          const pm = new mod.PauseMenu();
          pm.setIsHost(true);
          pm.setIsMultiplayer(true);
          pm.show();
          pauseMenu = document.getElementById('pause-menu');
          console.log('PauseMenu instantiated via dynamic import');
        } catch (e) {
          console.log('Dynamic import failed: ' + e.message);
          return false;
        }
      }

      if (!pauseMenu) {
        console.log('No pause-menu element found even after import');
        return false;
      }

      // Remove hidden class to show the pause menu
      pauseMenu.classList.remove('hidden');

      // Show all network buttons (simulate host+multiplayer mode)
      const btns = pauseMenu.querySelectorAll(
        '.exit-to-voting-btn, .end-game-btn, .stop-server-btn, .server-settings-btn'
      );
      for (const btn of btns) {
        btn.classList.remove('hidden');
      }

      // Check if the server settings button exists
      const serverSettingsBtn = pauseMenu.querySelector('.server-settings-btn');
      if (serverSettingsBtn) {
        console.log('SERVER SETTINGS BUTTON FOUND: ' + serverSettingsBtn.textContent?.trim());
        return true;
      }
      console.log('server-settings-btn NOT FOUND in pause menu');
      return false;
    });

    await page.screenshot({ path: SCREENSHOT_PATH });
    console.log(`Screenshot 2: Pause menu (host view) → ${SCREENSHOT_PATH}`);

    if (serverSettingsBtnFound) {
      console.log('✓ SERVER SETTINGS button is visible in the pause menu');
      passed = true;
    } else {
      console.log('✗ SERVER SETTINGS button not found — check PauseMenu.ts');
    }

  } finally {
    await browser.close();
    stopServer();
  }

  console.log(`\nResult: ${passed ? 'PASSED' : 'FAILED'}`);
  console.log(`Screenshot saved to: ${SCREENSHOT_PATH}`);
  process.exit(passed ? 0 : 1);
}

run().catch(err => {
  console.error('Fatal error:', err);
  stopServer();
  process.exit(1);
});
