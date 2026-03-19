#!/usr/bin/env node
/**
 * verify-kill-streak.mjs — Puppeteer verification for EnemyKillStreakAnnouncer
 *
 * Usage: node tests/visual/verify-kill-streak.mjs [--port 3000]
 * Exit 0 = pass, exit 1 = fail
 *
 * Tests:
 *   1. After 2 kills: overlay visible
 *   2. After 5 kills: overlay shows "Killing Spree"
 *   3. After resetStreak(): overlay hidden
 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'tests/visual/screenshots');

const CHROME_PATH = process.env.CHROME_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-145.0.7632.46/chrome-linux64/chrome'
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const PORT = (() => {
  const idx = process.argv.indexOf('--port');
  return idx !== -1 ? process.argv[idx + 1] : (process.env.PORT || '3042');
})();
const BASE_URL = `http://localhost:${PORT}`;

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=1280,720',
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isPortInUse(port) {
  try {
    execSync(`ss -tlnp | grep ':${port} '`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

  // Start dev server if not already running
  let serverProc = null;
  const serverAlreadyRunning = isPortInUse(PORT);

  if (!serverAlreadyRunning) {
    console.log(`Starting dev server on port ${PORT}...`);
    serverProc = spawn(
      'npx', ['vite', '--port', PORT],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          PATH: '/home/antoine/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin',
        },
        detached: true,
        stdio: 'ignore',
      }
    );
    serverProc.unref();
    // Wait for server to be ready
    for (let i = 0; i < 12; i++) {
      await sleep(2000);
      if (isPortInUse(PORT)) break;
    }
    if (!isPortInUse(PORT)) {
      console.error(`FAIL — dev server did not start on port ${PORT}`);
      process.exit(1);
    }
    console.log(`Dev server ready on port ${PORT}`);
  } else {
    console.log(`Dev server already running on port ${PORT}`);
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push(`console.error: ${msg.text()}`);
  });

  const failures = [];
  let passed = true;

  try {
    // ── Load game ──────────────────────────────────────────────────────────
    console.log('Loading game...');
    await page.goto(
      `${BASE_URL}/?quickStart=true&surface=sphere&debug=true&testMode=true`,
      { waitUntil: 'domcontentloaded', timeout: 30000 }
    );
    await page.waitForSelector('canvas', { timeout: 15000 });
    // Wait for game loop to start (quickStart bypasses countdown, but game init takes ~3s)
    await sleep(4000);

    // ── Check APIs are ready ───────────────────────────────────────────────
    const apiReady = await page.evaluate(() => {
      return (
        typeof window.__TEST_API !== 'undefined' &&
        typeof window.__TEST_KILL_STREAK_ANNOUNCER !== 'undefined'
      );
    });

    if (!apiReady) {
      const apiState = await page.evaluate(() => ({
        testApi: typeof window.__TEST_API,
        streakAnnouncer: typeof window.__TEST_KILL_STREAK_ANNOUNCER,
      }));
      failures.push(
        `Test APIs not ready — __TEST_API: ${apiState.testApi}, __TEST_KILL_STREAK_ANNOUNCER: ${apiState.streakAnnouncer}. ` +
        'Check GameLoop.ts testMode exposure and TestHarnessAPI initialization.'
      );
      passed = false;
    }

    if (passed) {
      // ── Test 1: 2 kills → overlay visible ─────────────────────────────
      console.log('Test 1: triggering 2 kills...');
      await page.evaluate(() => {
        for (let i = 0; i < 2; i++) {
          window.__TEST_KILL_STREAK_ANNOUNCER.recordKill();
        }
      });
      await sleep(300);

      const overlayVisible2 = await page.evaluate(() => {
        const el = document.getElementById('enemy-kill-streak-announcer');
        if (!el) return false;
        return el.style.display !== 'none' && el.style.display !== '';
      });

      const screenshot1 = resolve(SCREENSHOT_DIR, 'kill-streak-after-2-kills.png');
      await page.screenshot({ path: screenshot1 });
      console.log(`Screenshot 1 saved: ${screenshot1}`);

      if (!overlayVisible2) {
        failures.push('After 2 kills: overlay is not visible (display === none or element missing)');
        passed = false;
      } else {
        console.log('  PASS: overlay visible after 2 kills');
      }

      // ── Test 2: 3 more kills (total 5) → overlay shows "Killing Spree" ──
      console.log('Test 2: triggering 3 more kills (total 5)...');
      await page.evaluate(() => {
        for (let i = 0; i < 3; i++) {
          window.__TEST_KILL_STREAK_ANNOUNCER.recordKill();
        }
      });
      await sleep(300);

      const streakName5 = await page.evaluate(() => {
        const nameEl = document.querySelector('#enemy-kill-streak-announcer .eksa-name');
        return nameEl ? nameEl.textContent : null;
      });

      const screenshot2 = resolve(SCREENSHOT_DIR, 'kill-streak-after-5-kills.png');
      await page.screenshot({ path: screenshot2 });
      console.log(`Screenshot 2 saved: ${screenshot2}`);

      if (streakName5 !== 'Killing Spree') {
        failures.push(`After 5 kills: expected "Killing Spree" but got "${streakName5}"`);
        passed = false;
      } else {
        console.log(`  PASS: overlay shows "${streakName5}" after 5 kills`);
      }

      // ── Test 3: resetStreak() → overlay hidden ─────────────────────────
      console.log('Test 3: calling resetStreak() (simulates player death)...');
      await page.evaluate(() => {
        window.__TEST_KILL_STREAK_ANNOUNCER.resetStreak();
      });
      await sleep(300);

      const overlayHidden = await page.evaluate(() => {
        const el = document.getElementById('enemy-kill-streak-announcer');
        if (!el) return true; // element removed = also hidden
        return el.style.display === 'none';
      });

      const screenshot3 = resolve(SCREENSHOT_DIR, 'kill-streak-after-death.png');
      await page.screenshot({ path: screenshot3 });
      console.log(`Screenshot 3 saved: ${screenshot3}`);

      if (!overlayHidden) {
        failures.push('After resetStreak(): overlay is still visible (display !== none)');
        passed = false;
      } else {
        console.log('  PASS: overlay hidden after resetStreak()');
      }
    }

  } finally {
    await browser.close();

    // Kill server only if we started it
    if (serverProc) {
      console.log('Stopping dev server...');
      try {
        execSync(
          `ss -tlnp | grep ':${PORT} ' | awk '{print $NF}' | grep -oP 'pid=\\K[0-9]+' | xargs -r kill -15`,
          { stdio: 'ignore' }
        );
      } catch {}
    }
  }

  // ── Final report ─────────────────────────────────────────────────────────
  console.log('');
  if (pageErrors.length > 0) {
    console.warn('Page errors detected (non-fatal):');
    for (const e of pageErrors) console.warn(`  ${e}`);
  }

  if (passed) {
    console.log('PASS — kill streak announcer visual verification complete');
    console.log(`Screenshots: ${SCREENSHOT_DIR}/kill-streak-*.png`);
    process.exit(0);
  } else {
    console.error('FAIL — kill streak verification failed:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
