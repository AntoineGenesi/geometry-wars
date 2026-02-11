#!/usr/bin/env node
/**
 * LAN Multiplayer Visual Test
 *
 * Tests the LAN multiplayer section from HUMAN_TEST.md by:
 * 1. Opening two headless browser tabs
 * 2. Tab 1 (Host): Navigates LAN UI -> HOST GAME -> START HOSTING -> ENTER GAME
 * 3. Tab 2 (Joiner): Navigates LAN UI -> clicks lobby entry -> enters name -> joins
 * 4. Both enter gameplay, take screenshots at every stage
 * 5. Tests movement, shooting, tab-out, console spam
 *
 * Usage:
 *   PATH="/home/antoine/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin" \
 *   node tests/visual/test-lan-visual.mjs [commit-hash]
 */

import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const DEV_SERVER_PORT = 3000;
const COLYSEUS_PORT = 2567;
const BASE_URL = `http://localhost:${DEV_SERVER_PORT}`;
const COMMIT_HASH = process.argv[2] || 'a722f6a';
const TASK_SLUG = 'lan-visual';

const NVM_PATH = '/home/antoine/.nvm/versions/node/v20.19.5/bin';

// Session directory
const now = new Date();
const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
const SESSION_NAME = `${ts}_${TASK_SLUG}`;
const SESSION_DIR = resolve(PROJECT_ROOT, 'test-screenshots', 'sessions', SESSION_NAME);
const ATTEMPT_DIR = resolve(SESSION_DIR, 'attempt-1');

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=640,360',
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function killPortProcesses(ports) {
  for (const port of ports) {
    try {
      const result = execSync(`ss -tlnp 2>/dev/null | grep ':${port} '`, { encoding: 'utf-8' });
      if (result.trim()) {
        const pidMatches = result.matchAll(/pid=(\d+)/g);
        for (const match of pidMatches) {
          try {
            execSync(`kill ${match[1]} 2>/dev/null`);
            console.log(`  Killed process ${match[1]} on port ${port}`);
          } catch { /* already dead */ }
        }
        execSync('sleep 1');
      }
    } catch { /* no process on port */ }
  }
}

/** Start Colyseus server as child process */
function startColyseusServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PATH: `${NVM_PATH}:/usr/bin:/bin`,
      PORT: String(COLYSEUS_PORT),
      SHUTDOWN_TIMEOUT: '0',
    };

    const serverProcess = spawn(
      `${NVM_PATH}/npx`,
      ['tsx', 'server/index.ts'],
      { cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let started = false;
    let output = '';
    const serverLogs = [];

    const onData = (data) => {
      const text = data.toString();
      output += text;
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('\u2554') && !trimmed.startsWith('\u2551') && !trimmed.startsWith('\u2560') && !trimmed.startsWith('\u255A')) {
          serverLogs.push(trimmed);
        }
      }
      if (!started && (text.includes('MULTIPLAYER SERVER') || text.includes(`localhost:${COLYSEUS_PORT}`))) {
        started = true;
        serverProcess.__logs = serverLogs;
        resolve(serverProcess);
      }
    };

    serverProcess.stdout.on('data', onData);
    serverProcess.stderr.on('data', onData);
    serverProcess.on('error', (err) => {
      if (!started) reject(new Error(`Server failed: ${err.message}`));
    });
    serverProcess.on('exit', (code) => {
      if (!started) reject(new Error(`Server exited ${code}. Output: ${output.slice(0, 500)}`));
    });

    setTimeout(() => {
      if (!started) {
        serverProcess.kill();
        reject(new Error(`Server timeout. Output: ${output.slice(0, 500)}`));
      }
    }, 20000);
  });
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch { /* not ready */ }
    await sleep(500);
  }
  return false;
}

async function screenshot(page, name) {
  const path = join(ATTEMPT_DIR, name);
  await page.screenshot({ path });
  console.log(`    [screenshot] ${name}`);
  return path;
}

/** Wait for selector to appear (with timeout) */
async function waitForSelector(page, selector, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = await page.$(selector);
    if (el) return el;
    await sleep(500);
  }
  return null;
}

/** Wait for element to become visible (not display:none, not hidden class) */
async function waitForVisible(page, selector, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const visible = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && !el.classList.contains('hidden') && style.visibility !== 'hidden';
    }, selector);
    if (visible) return true;
    await sleep(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Test Results Tracking
// ---------------------------------------------------------------------------

const testResults = {};

function recordResult(item, status, note) {
  testResults[item] = { status, note };
  const icon = status === 'PASS' ? 'PASS' : status === 'FAIL' ? 'FAIL' : 'INCONCLUSIVE';
  console.log(`  [${icon}] ${item}: ${note}`);
}

// ---------------------------------------------------------------------------
// Main Test
// ---------------------------------------------------------------------------

async function run() {
  mkdirSync(ATTEMPT_DIR, { recursive: true });

  console.log('='.repeat(70));
  console.log('  LAN MULTIPLAYER VISUAL TEST');
  console.log(`  Session: ${SESSION_NAME}`);
  console.log(`  Commit: ${COMMIT_HASH}`);
  console.log('='.repeat(70));

  // Kill any stale Colyseus server
  console.log('\n  Killing stale Colyseus processes...');
  killPortProcesses([COLYSEUS_PORT]);
  await sleep(1000);

  // Verify dev server is running
  console.log(`\n  Checking dev server on port ${DEV_SERVER_PORT}...`);
  const devReady = await waitForServer(BASE_URL, 5000);
  if (!devReady) {
    console.error('  ERROR: Vite dev server not running on port 3000. Start it first.');
    process.exit(1);
  }
  console.log('  Dev server: OK');

  // Start Colyseus server
  console.log(`\n  Starting Colyseus server on port ${COLYSEUS_PORT}...`);
  let serverProcess = null;
  try {
    serverProcess = await startColyseusServer();
  } catch (err) {
    console.error(`  ERROR: Could not start Colyseus: ${err.message}`);
    process.exit(1);
  }
  console.log('  Colyseus server: started');

  // Verify server health
  const serverReady = await waitForServer(`http://localhost:${COLYSEUS_PORT}/health`, 10000);
  if (!serverReady) {
    console.error('  ERROR: Colyseus health check failed');
    serverProcess.kill();
    process.exit(1);
  }
  console.log('  Colyseus health: OK');

  let browser = null;
  const hostErrors = [];
  const hostLogs = [];
  const joinErrors = [];
  const joinLogs = [];

  try {
    // Launch browser
    console.log('\n  Launching browser...');
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: LAUNCH_ARGS,
    });

    const hostPage = await browser.newPage();
    await hostPage.setViewport({ width: 640, height: 360 });
    hostPage.on('pageerror', (err) => hostErrors.push(err.message));
    hostPage.on('console', (msg) => {
      const text = msg.text();
      hostLogs.push(`[${msg.type()}] ${text}`);
      if (msg.type() === 'error') hostErrors.push(text);
    });

    const joinPage = await browser.newPage();
    await joinPage.setViewport({ width: 640, height: 360 });
    joinPage.on('pageerror', (err) => joinErrors.push(err.message));
    joinPage.on('console', (msg) => {
      const text = msg.text();
      joinLogs.push(`[${msg.type()}] ${text}`);
      if (msg.type() === 'error') joinErrors.push(text);
    });

    // ======================================================================
    // PHASE 1: HOST — Navigate through LAN UI
    // ======================================================================
    console.log('\n--- PHASE 1: HOST PAGE ---\n');

    console.log('  1. Loading start menu...');
    await hostPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    await screenshot(hostPage, '01-host-start-menu.png');

    console.log('  2. Clicking LAN button...');
    await hostPage.evaluate(() => {
      const btn = document.querySelector('.oval-btn[data-mode="lan"]');
      if (btn) btn.click();
    });
    await sleep(2000);
    await screenshot(hostPage, '02-host-lan-section.png');

    console.log('  3. Clicking HOST GAME...');
    await hostPage.evaluate(() => {
      const btn = document.querySelector('#lan-host-btn');
      if (btn) btn.click();
    });
    await sleep(1500);
    await screenshot(hostPage, '03-host-surface-pick.png');

    console.log('  4. Selecting sphere surface...');
    await hostPage.evaluate(() => {
      const btn = document.querySelector('.lan-surface-grid .surface-btn[data-surface="sphere"]');
      if (btn) btn.click();
    });
    await sleep(500);

    console.log('  5. Clicking START HOSTING...');
    await hostPage.evaluate(() => {
      const btn = document.querySelector('#lan-start-host-btn');
      if (btn) {
        btn.scrollIntoView();
        btn.click();
      }
    });

    // Wait for server to be ready (the Vite plugin starts another server, but we already have one).
    // The UI will try /__lan/start, which calls the Vite plugin, which spawns ANOTHER server.
    // Since our server is already on 2567, the plugin might fail or detect it.
    // Let's wait and see what happens.
    console.log('  6. Waiting for hosting status...');
    await sleep(8000);
    await screenshot(hostPage, '04-host-hosting-status.png');

    // Check the host status text
    const hostStatusText = await hostPage.evaluate(() => {
      const el = document.querySelector('#lan-host-status');
      return el ? el.textContent : '';
    });
    console.log(`     Host status: "${hostStatusText}"`);

    // Check if ENTER GAME button appeared
    const enterBtnVisible = await hostPage.evaluate(() => {
      const btn = document.querySelector('#lan-enter-btn');
      return btn && !btn.classList.contains('hidden');
    });
    console.log(`     ENTER GAME visible: ${enterBtnVisible}`);

    // If hosting failed because port was in use, try the alternative approach:
    // Navigate directly with mode=network params
    let hostUsedDirectNav = false;
    if (!enterBtnVisible) {
      console.log('  >> Hosting via UI may have conflicted with our Colyseus server.');
      console.log('  >> Trying direct navigation approach...');

      // Kill our Colyseus server and let the host UI start it
      serverProcess.kill('SIGTERM');
      await sleep(2000);
      killPortProcesses([COLYSEUS_PORT]);
      await sleep(2000);

      // Reload and try again
      await hostPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(5000);

      // Click LAN -> HOST GAME -> select sphere -> START HOSTING
      await hostPage.evaluate(() => {
        document.querySelector('.oval-btn[data-mode="lan"]')?.click();
      });
      await sleep(2000);
      await hostPage.evaluate(() => {
        document.querySelector('#lan-host-btn')?.click();
      });
      await sleep(1000);
      await hostPage.evaluate(() => {
        document.querySelector('.lan-surface-grid .surface-btn[data-surface="sphere"]')?.click();
      });
      await sleep(500);
      await hostPage.evaluate(() => {
        document.querySelector('#lan-start-host-btn')?.click();
      });

      console.log('  >> Waiting for server start via UI...');
      await sleep(12000);
      await screenshot(hostPage, '04b-host-hosting-retry.png');

      const retryStatus = await hostPage.evaluate(() => {
        const el = document.querySelector('#lan-host-status');
        return el ? el.textContent : '';
      });
      console.log(`     Retry status: "${retryStatus}"`);

      const retryEnterVisible = await hostPage.evaluate(() => {
        const btn = document.querySelector('#lan-enter-btn');
        return btn && !btn.classList.contains('hidden');
      });

      if (!retryEnterVisible) {
        console.log('  >> UI hosting still failed. Falling back to direct navigation.');
        hostUsedDirectNav = true;

        // Start Colyseus ourselves again
        killPortProcesses([COLYSEUS_PORT]);
        await sleep(2000);
        serverProcess = await startColyseusServer();
        await waitForServer(`http://localhost:${COLYSEUS_PORT}/health`, 10000);
        console.log('  >> Colyseus restarted externally.');

        // Navigate host directly
        const hostUrl = `${BASE_URL}?mode=network&surface=sphere&server=${encodeURIComponent(`ws://localhost:${COLYSEUS_PORT}`)}&debug=true`;
        console.log(`  >> Host URL: ${hostUrl}`);
        await hostPage.goto(hostUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(12000);
        await screenshot(hostPage, '05-host-direct-gameplay.png');
      }
    }

    // If ENTER GAME is visible, click it (goes to name dialog)
    if (!hostUsedDirectNav) {
      console.log('  7. Clicking ENTER GAME...');
      await hostPage.evaluate(() => {
        const btn = document.querySelector('#lan-enter-btn');
        if (btn) btn.click();
      });
      await sleep(2000);
      await screenshot(hostPage, '05-host-name-dialog.png');

      // Type name and click JOIN
      console.log('  8. Entering host name...');
      await hostPage.evaluate(() => {
        const input = document.querySelector('#lan-name-input');
        if (input) {
          input.value = 'HostPlayer';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await sleep(500);

      await hostPage.evaluate(() => {
        const btn = document.querySelector('#lan-name-join-btn');
        if (btn) btn.click();
      });
      await sleep(10000); // Wait for game to load
      await screenshot(hostPage, '06-host-entered-game.png');
    }

    // ======================================================================
    // PHASE 2: JOINER — Navigate through LAN UI or direct
    // ======================================================================
    console.log('\n--- PHASE 2: JOINER PAGE ---\n');

    if (hostUsedDirectNav) {
      // Direct navigation for joiner too
      const joinUrl = `${BASE_URL}?mode=network&surface=sphere&server=${encodeURIComponent(`ws://localhost:${COLYSEUS_PORT}`)}&debug=true`;
      console.log(`  1. Joiner direct URL: ${joinUrl}`);
      await joinPage.goto(joinUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(12000);
      await screenshot(joinPage, '07-join-direct-gameplay.png');
    } else {
      console.log('  1. Loading joiner start menu...');
      await joinPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(5000);
      await screenshot(joinPage, '07-join-start-menu.png');

      console.log('  2. Clicking LAN button...');
      await joinPage.evaluate(() => {
        document.querySelector('.oval-btn[data-mode="lan"]')?.click();
      });
      await sleep(3000);
      await screenshot(joinPage, '08-join-lan-section.png');

      // Click REFRESH to scan for games
      console.log('  3. Refreshing lobby...');
      await joinPage.evaluate(() => {
        document.querySelector('#lan-refresh-btn')?.click();
      });
      await sleep(5000);
      await screenshot(joinPage, '09-join-lobby-list.png');

      // Check if any lobby entries appeared
      const lobbyEntries = await joinPage.evaluate(() => {
        return document.querySelectorAll('.lan-lobby-entry').length;
      });
      console.log(`     Lobby entries found: ${lobbyEntries}`);

      if (lobbyEntries > 0) {
        console.log('  4. Clicking first lobby entry...');
        await joinPage.evaluate(() => {
          const entry = document.querySelector('.lan-lobby-entry');
          if (entry) entry.click();
        });
        await sleep(2000);
        await screenshot(joinPage, '10-join-name-dialog.png');

        console.log('  5. Entering joiner name...');
        await joinPage.evaluate(() => {
          const input = document.querySelector('#lan-name-input');
          if (input) {
            input.value = 'JoinPlayer';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        await sleep(500);

        await joinPage.evaluate(() => {
          document.querySelector('#lan-name-join-btn')?.click();
        });
        await sleep(10000);
        await screenshot(joinPage, '11-join-entered-game.png');
      } else {
        console.log('  >> No lobby entries. Trying manual connect...');
        await joinPage.evaluate(() => {
          const input = document.querySelector('#lan-ip-input');
          if (input) {
            input.value = 'localhost';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        await sleep(500);
        await joinPage.evaluate(() => {
          document.querySelector('#lan-connect-btn')?.click();
        });
        await sleep(2000);
        await screenshot(joinPage, '10-join-manual-connect.png');

        // Enter name
        await joinPage.evaluate(() => {
          const input = document.querySelector('#lan-name-input');
          if (input) {
            input.value = 'JoinPlayer';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        await sleep(500);
        await joinPage.evaluate(() => {
          document.querySelector('#lan-name-join-btn')?.click();
        });
        await sleep(10000);
        await screenshot(joinPage, '11-join-entered-game.png');
      }
    }

    // ======================================================================
    // PHASE 2.5: CLICK START GAME
    // ======================================================================
    console.log('\n--- PHASE 2.5: STARTING THE GAME ---\n');

    // The host page should show a START GAME button. Click it.
    console.log('  1. Clicking START GAME on host page...');
    const startGameClicked = await hostPage.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const text = (btn.textContent || '').trim();
        if (text.includes('START GAME') || text.includes('PLAY AGAIN')) {
          if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
            btn.click();
            return text;
          }
        }
      }
      return null;
    });
    console.log(`     Clicked: ${startGameClicked || 'NONE FOUND'}`);

    if (!startGameClicked) {
      // Maybe it's a different button text; try clicking center of screen
      console.log('     Trying click at center of host page...');
      await hostPage.mouse.click(320, 180);
    }

    // Wait for game to transition from lobby to gameplay
    console.log('  2. Waiting for game to start...');
    await sleep(8000);
    await screenshot(hostPage, 'G01-host-game-started.png');
    await screenshot(joinPage, 'G01-join-game-started.png');

    // Check if still showing "Waiting for players"
    const postStartStatus = await hostPage.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasWaiting: body.includes('Waiting for players'),
        hasWave: body.includes('Wave'),
        hasStartButton: !!document.querySelector('button')?.textContent?.includes('START GAME'),
        visibleText: body.substring(0, 200),
      };
    });
    console.log(`     Has "Waiting": ${postStartStatus.hasWaiting}`);
    console.log(`     Has "Wave": ${postStartStatus.hasWave}`);
    console.log(`     Text: ${postStartStatus.visibleText.replace(/\n/g, ' | ').substring(0, 150)}`);

    // If still waiting, try clicking START GAME again more aggressively
    if (postStartStatus.hasWaiting || postStartStatus.hasStartButton) {
      console.log('  3. Game still in lobby, retrying START GAME click...');
      for (let attempt = 0; attempt < 5; attempt++) {
        const clicked = await hostPage.evaluate(() => {
          const btns = document.querySelectorAll('button');
          for (const btn of btns) {
            const text = (btn.textContent || '').trim();
            if (text.includes('START GAME') || text.includes('PLAY AGAIN')) {
              btn.scrollIntoView();
              btn.click();
              return true;
            }
          }
          return false;
        });
        if (clicked) {
          console.log(`     Attempt ${attempt + 1}: clicked`);
          await sleep(3000);
          const stillWaiting = await hostPage.evaluate(() =>
            document.body.innerText.includes('Waiting for players')
          );
          if (!stillWaiting) {
            console.log('     Game started!');
            break;
          }
        } else {
          await sleep(2000);
        }
      }
      await sleep(5000);
      await screenshot(hostPage, 'G02-host-after-retry-start.png');
    }

    // Give enemies time to spawn (SwiftShader is slow)
    console.log('  4. Waiting for enemies to spawn...');
    await sleep(10000);
    await screenshot(hostPage, 'G03-host-enemies-spawning.png');
    await screenshot(joinPage, 'G03-join-enemies-spawning.png');

    // ======================================================================
    // PHASE 3: GAMEPLAY VERIFICATION
    // ======================================================================
    console.log('\n--- PHASE 3: GAMEPLAY VERIFICATION ---\n');

    // Check if both pages have a visible canvas (indicating game is running)
    const hostHasCanvas = await hostPage.evaluate(() => {
      const c = document.querySelector('canvas');
      return c ? `${c.width}x${c.height}` : null;
    });
    const joinHasCanvas = await joinPage.evaluate(() => {
      const c = document.querySelector('canvas');
      return c ? `${c.width}x${c.height}` : null;
    });
    console.log(`  Host canvas: ${hostHasCanvas || 'NONE'}`);
    console.log(`  Join canvas: ${joinHasCanvas || 'NONE'}`);

    // Check if game debug API is available
    const hostDebug = await hostPage.evaluate(() => typeof window.__gameDebug !== 'undefined');
    const joinDebug = await joinPage.evaluate(() => typeof window.__gameDebug !== 'undefined');
    console.log(`  Debug API - Host: ${hostDebug}, Join: ${joinDebug}`);

    // ----- TEST 1: Both players can move (WASD) -----
    console.log('\n  TEST 1: Both players can move');

    // Take before screenshot
    await screenshot(hostPage, '12-host-before-move.png');
    await screenshot(joinPage, '12-join-before-move.png');

    // Host: press W for 3 seconds
    await hostPage.keyboard.down('w');
    await sleep(3000);
    await hostPage.keyboard.up('w');
    await sleep(500);
    await screenshot(hostPage, '13-host-after-move-w.png');

    // Host: press D for 3 seconds
    await hostPage.keyboard.down('d');
    await sleep(3000);
    await hostPage.keyboard.up('d');
    await sleep(500);
    await screenshot(hostPage, '14-host-after-move-d.png');

    // Joiner: press A for 3 seconds
    await joinPage.keyboard.down('a');
    await sleep(3000);
    await joinPage.keyboard.up('a');
    await sleep(500);
    await screenshot(joinPage, '15-join-after-move-a.png');

    // Joiner: press S for 3 seconds
    await joinPage.keyboard.down('s');
    await sleep(3000);
    await joinPage.keyboard.up('s');
    await sleep(500);
    await screenshot(joinPage, '16-join-after-move-s.png');

    // Check via debug API if position changed (if available)
    if (hostDebug) {
      const hostPos = await hostPage.evaluate(() => window.__gameDebug?.getPlayerPosition?.());
      console.log(`    Host position: ${hostPos ? `u=${hostPos.u?.toFixed(3)}, v=${hostPos.v?.toFixed(3)}` : 'N/A'}`);
    }
    if (joinDebug) {
      const joinPos = await joinPage.evaluate(() => window.__gameDebug?.getPlayerPosition?.());
      console.log(`    Join position: ${joinPos ? `u=${joinPos.u?.toFixed(3)}, v=${joinPos.v?.toFixed(3)}` : 'N/A'}`);
    }

    recordResult('both-players-move', 'INCONCLUSIVE',
      'Screenshots taken before/after WASD. Visual inspection needed to confirm movement.');

    // ----- TEST 2: Bullets fire in correct direction -----
    console.log('\n  TEST 2: Bullets fire in correct direction');

    // Host: aim right and click
    await hostPage.mouse.move(500, 180);
    await sleep(500);
    await hostPage.mouse.down();
    await sleep(2000);
    await screenshot(hostPage, '17-host-shooting-right.png');
    await hostPage.mouse.up();

    // Host: aim left
    await hostPage.mouse.move(100, 180);
    await sleep(500);
    await hostPage.mouse.down();
    await sleep(2000);
    await screenshot(hostPage, '18-host-shooting-left.png');
    await hostPage.mouse.up();

    // Joiner: aim and shoot
    await joinPage.mouse.move(500, 180);
    await sleep(500);
    await joinPage.mouse.down();
    await sleep(2000);
    await screenshot(joinPage, '19-join-shooting.png');
    await joinPage.mouse.up();

    recordResult('bullets-direction', 'INCONCLUSIVE',
      'Screenshots taken while shooting right/left. Visual inspection needed.');

    // ----- TEST 3: Bullets exist (move smoothly hard to verify at 7fps) -----
    console.log('\n  TEST 3: Bullets exist');
    if (hostDebug) {
      const bulletCount = await hostPage.evaluate(() => window.__gameDebug?.getBulletCount?.() ?? 0);
      console.log(`    Host bullet count: ${bulletCount}`);
    }
    recordResult('bullets-exist', 'INCONCLUSIVE',
      'Need to visually check screenshots for bullet trails.');

    // ----- TEST 4: Enemies/geoms appear -----
    console.log('\n  TEST 4: Enemies appear');
    if (hostDebug) {
      const enemyCount = await hostPage.evaluate(() => window.__gameDebug?.getEnemyCount?.() ?? 0);
      console.log(`    Host enemy count: ${enemyCount}`);
      if (enemyCount > 0) {
        recordResult('enemies-appear', 'PASS', `${enemyCount} enemies visible on host`);
      } else {
        recordResult('enemies-appear', 'INCONCLUSIVE', 'No debug API count. Check screenshots.');
      }
    } else {
      recordResult('enemies-appear', 'INCONCLUSIVE', 'No debug API. Check screenshots.');
    }

    // ----- TEST 5: Player aim updates while stationary -----
    console.log('\n  TEST 5: Player aim updates while stationary');
    // Move mouse to different positions while not pressing WASD
    await hostPage.mouse.move(500, 50);
    await sleep(1500);
    await screenshot(hostPage, '20-host-aim-up.png');

    await hostPage.mouse.move(500, 300);
    await sleep(1500);
    await screenshot(hostPage, '21-host-aim-down.png');

    await hostPage.mouse.move(50, 180);
    await sleep(1500);
    await screenshot(hostPage, '22-host-aim-left.png');

    recordResult('aim-while-stationary', 'INCONCLUSIVE',
      'Screenshots taken with mouse at 3 positions. Visual check needed for player rotation.');

    // ----- TEST 6: Tab-out handling -----
    console.log('\n  TEST 6: Tab-out handling');
    // We can simulate tab-out by switching focus to another page
    // In headless, this is approximate: bring joinPage to front, wait, then hostPage
    await screenshot(hostPage, '23-host-before-tabout.png');
    await joinPage.bringToFront();
    await sleep(3000);
    await hostPage.bringToFront();
    await sleep(2000);
    await screenshot(hostPage, '24-host-after-tabout.png');

    recordResult('tab-out-handling', 'INCONCLUSIVE',
      'Simulated tab-out via page focus switch. Hard to verify in headless.');

    // ----- TEST 7: No spawn ring ghosts -----
    console.log('\n  TEST 7: Spawn ring ghosts');
    // Play more to let enemies spawn and die
    await hostPage.mouse.move(400, 180);
    await hostPage.mouse.down();
    await hostPage.keyboard.down('w');
    await sleep(5000);
    await hostPage.keyboard.up('w');
    await hostPage.mouse.up();
    await screenshot(hostPage, '25-host-after-combat.png');
    await screenshot(joinPage, '25-join-after-combat.png');

    recordResult('no-spawn-ring-ghosts', 'INCONCLUSIVE',
      'Screenshots after combat. Visual check for lingering rings needed.');

    // ----- TEST 8: Respawn (hard to test — need to die) -----
    console.log('\n  TEST 8: Respawn');
    // Run into enemies to try to die
    await hostPage.keyboard.down('w');
    await sleep(8000);
    await hostPage.keyboard.up('w');
    await screenshot(hostPage, '26-host-after-long-run.png');
    // Check if there's a "GAME OVER" or respawn happened
    if (hostDebug) {
      const waveText = await hostPage.evaluate(() => window.__gameDebug?.getWaveText?.());
      console.log(`    Host wave text: "${waveText}"`);
    }
    recordResult('respawn-works', 'INCONCLUSIVE',
      'Attempted to die by running forward. Check screenshot for respawn state.');

    // ----- TEST 9: Cube surface (would need restart) -----
    console.log('\n  TEST 9: Cube surface');
    recordResult('cube-surface', 'INCONCLUSIVE',
      'Not tested in this session (would require restarting with cube surface). Separate test needed.');

    // ----- TEST 10: Overall feel -----
    console.log('\n  TEST 10: Overall feel');
    // Take a final gameplay screenshot with both pages
    await hostPage.mouse.move(400, 180);
    await hostPage.mouse.down();
    await hostPage.keyboard.down('d');
    await sleep(3000);
    await hostPage.keyboard.up('d');
    await hostPage.mouse.up();
    await screenshot(hostPage, '27-host-final-gameplay.png');
    await screenshot(joinPage, '27-join-final-gameplay.png');

    recordResult('overall-feel', 'INCONCLUSIVE',
      'Final gameplay screenshots taken. Visual assessment needed.');

    // ----- TEST 11: Stable FPS (via debug overlay) -----
    console.log('\n  TEST 11: FPS check');
    // Press F3 for debug overlay
    await hostPage.keyboard.press('F3');
    await sleep(2000);
    await screenshot(hostPage, '28-host-debug-overlay.png');

    await joinPage.keyboard.press('F3');
    await sleep(2000);
    await screenshot(joinPage, '28-join-debug-overlay.png');

    recordResult('stable-fps', 'INCONCLUSIVE',
      'Debug overlay screenshots taken. Check for FPS readout.');

    // ----- TEST 12: No debug spam -----
    console.log('\n  TEST 12: No debug spam');
    // We loaded WITHOUT ?debug in the host URL (unless fallback was used)
    const lanDebugMessages = hostLogs.filter((l) =>
      l.toLowerCase().includes('[lan') ||
      l.toLowerCase().includes('[network') ||
      l.toLowerCase().includes('colyseus')
    );
    const joinLanDebugMessages = joinLogs.filter((l) =>
      l.toLowerCase().includes('[lan') ||
      l.toLowerCase().includes('[network') ||
      l.toLowerCase().includes('colyseus')
    );

    const debugSpamCount = lanDebugMessages.length + joinLanDebugMessages.length;
    if (hostUsedDirectNav) {
      // We used ?debug=true, so debug messages are expected
      recordResult('no-debug-spam', 'INCONCLUSIVE',
        `Used direct nav with ?debug=true. ${debugSpamCount} debug messages found (expected with debug flag).`);
    } else if (debugSpamCount > 20) {
      recordResult('no-debug-spam', 'FAIL',
        `${debugSpamCount} LAN/network debug messages in console without ?debug flag.`);
    } else {
      recordResult('no-debug-spam', 'PASS',
        `Only ${debugSpamCount} LAN/network messages in console.`);
    }

    // ======================================================================
    // PHASE 4: Connection verification
    // ======================================================================
    console.log('\n--- PHASE 4: CONNECTION VERIFICATION ---\n');

    if (hostDebug) {
      const hostConnected = await hostPage.evaluate(() => window.__gameDebug?.isConnected?.());
      const hostPlayerCount = await hostPage.evaluate(() => window.__gameDebug?.getPlayerCount?.());
      console.log(`  Host connected: ${hostConnected}, players: ${hostPlayerCount}`);
    }
    if (joinDebug) {
      const joinConnected = await joinPage.evaluate(() => window.__gameDebug?.isConnected?.());
      const joinPlayerCount = await joinPage.evaluate(() => window.__gameDebug?.getPlayerCount?.());
      console.log(`  Join connected: ${joinConnected}, players: ${joinPlayerCount}`);
    }

    // Final screenshots
    console.log('\n--- FINAL SCREENSHOTS ---\n');
    await screenshot(hostPage, '29-host-final.png');
    await screenshot(joinPage, '29-join-final.png');

    // ======================================================================
    // RESULTS
    // ======================================================================
    console.log('\n' + '='.repeat(70));
    console.log('  RESULTS SUMMARY');
    console.log('='.repeat(70));

    for (const [item, result] of Object.entries(testResults)) {
      console.log(`  [${result.status}] ${item}: ${result.note}`);
    }

    // Count errors (filtering noise)
    const hostCritical = hostErrors.filter((e) =>
      !e.includes('AudioContext') && !e.includes('user gesture') && !e.includes('favicon') &&
      !e.includes('net::') && !e.includes('404') && !e.includes('Failed to load resource') &&
      !e.includes('SharedArrayBuffer') && !e.includes('crossOriginIsolated') &&
      !e.includes('websocket') && !e.includes('WebSocket')
    );
    const joinCritical = joinErrors.filter((e) =>
      !e.includes('AudioContext') && !e.includes('user gesture') && !e.includes('favicon') &&
      !e.includes('net::') && !e.includes('404') && !e.includes('Failed to load resource') &&
      !e.includes('SharedArrayBuffer') && !e.includes('crossOriginIsolated') &&
      !e.includes('websocket') && !e.includes('WebSocket')
    );

    console.log(`\n  Host console errors (critical): ${hostCritical.length}`);
    if (hostCritical.length > 0) {
      hostCritical.slice(0, 5).forEach((e) => console.log(`    - ${e.substring(0, 150)}`));
    }
    console.log(`  Join console errors (critical): ${joinCritical.length}`);
    if (joinCritical.length > 0) {
      joinCritical.slice(0, 5).forEach((e) => console.log(`    - ${e.substring(0, 150)}`));
    }

    console.log(`\n  Host total console lines: ${hostLogs.length}`);
    console.log(`  Join total console lines: ${joinLogs.length}`);

    // Write RESULTS.md
    const screenshotFiles = readdirSync(ATTEMPT_DIR).filter((f) => f.endsWith('.png')).sort();
    const resultsContent = `# Visual Test: LAN Multiplayer
**Timestamp:** ${now.toISOString()}
**Commit:** ${COMMIT_HASH}
**Script:** tests/visual/test-lan-visual.mjs
**Renderer:** WebGL2 via SwiftShader (headless)
**Goal:** "I need to see both players connected, moving, and shooting in a LAN game to confirm LAN multiplayer works."

## Attempt 1
**Script:** Two headless browser pages connect to LAN game, host + join flow, then gameplay verification.
**Connection method:** ${hostUsedDirectNav ? 'Direct URL navigation (UI hosting failed)' : 'Full UI flow (LAN button -> HOST GAME -> ENTER GAME)'}

### Screenshots
${screenshotFiles.map((f) => `- ${f}`).join('\n')}

### Console Errors
**Host (critical):** ${hostCritical.length}
${hostCritical.slice(0, 10).map((e) => `- ${e.substring(0, 200)}`).join('\n') || 'None'}

**Join (critical):** ${joinCritical.length}
${joinCritical.slice(0, 10).map((e) => `- ${e.substring(0, 200)}`).join('\n') || 'None'}

### Debug Messages (LAN/Network)
**Host:** ${lanDebugMessages.length} messages
${lanDebugMessages.slice(0, 10).map((m) => `- ${m.substring(0, 150)}`).join('\n') || 'None'}

**Join:** ${joinLanDebugMessages.length} messages
${joinLanDebugMessages.slice(0, 10).map((m) => `- ${m.substring(0, 150)}`).join('\n') || 'None'}

### Test Results (automated assessment)
${Object.entries(testResults).map(([item, r]) => `- **${item}**: ${r.status} - ${r.note}`).join('\n')}

### Visual Analysis
> **Claude must fill this in after reading each screenshot.**
> Describe what you see in each screenshot. Note anything broken, missing, or unexpected.

### HUMAN_TEST.md Item Assessment
| # | Item | Verdict | Notes |
|---|------|---------|-------|
| 1 | Both players can move | | |
| 2 | Bullets fire in correct direction | | |
| 3 | Bullets move smoothly | | |
| 4 | Geoms/enemy movement smooth | | |
| 5 | Player aim updates while stationary | | |
| 6 | Tab-out doesn't break movement | | |
| 7 | No spawn ring ghosts | | |
| 8 | Respawn works | | |
| 9 | Cube surface works | | |
| 10 | Overall feel | | |
| 11 | Stable FPS | | |
| 12 | No debug spam | | |

## Conclusion
> Overall assessment after visual analysis.
`;

    writeFileSync(join(SESSION_DIR, 'RESULTS.md'), resultsContent);
    console.log(`\n  RESULTS.md written to ${SESSION_DIR}/RESULTS.md`);
    console.log(`  Screenshots in ${ATTEMPT_DIR}/`);

    // Close browser
    await hostPage.close();
    await joinPage.close();
    await browser.close();
    browser = null;

  } catch (err) {
    console.error(`\n  FATAL ERROR: ${err.message}`);
    console.error(err.stack);
    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
  } finally {
    // ---- Cleanup ----
    console.log('\n  Cleaning up...');

    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      console.log('  Colyseus server stopped.');
    }
    await sleep(1000);
    killPortProcesses([COLYSEUS_PORT]);

    // Verify cleanup
    try {
      const remaining = execSync('ss -tlnp 2>/dev/null | grep -E ":(300[0-9]|2567)\\b"', { encoding: 'utf-8' });
      if (remaining.trim()) {
        console.log(`  WARNING: Processes still running:\n${remaining}`);
      }
    } catch {
      console.log('  Port cleanup verified: no game processes running (except dev server).');
    }
  }
}

run().catch((err) => {
  console.error('Fatal:', err);
  killPortProcesses([COLYSEUS_PORT]);
  process.exit(1);
});
