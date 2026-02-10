#!/usr/bin/env node
/**
 * Geometry Wars - LAN StartMenu Flow E2E Test Suite
 *
 * Tests the FULL StartMenu LAN flow as an actual user would experience it:
 *   Host:   Start Menu -> LAN -> HOST GAME -> surface pick -> START HOSTING
 *           -> "Server running!" -> ENTER GAME -> name dialog -> JOIN
 *   Joiner: Start Menu -> LAN -> lobby entry (auto-scan) -> name dialog -> JOIN
 *           (Falls back to manual connect with localhost if lobby scan fails)
 *
 * Uses the same Puppeteer + SwiftShader setup as the existing LAN tests.
 *
 * Usage:
 *   node tests/lan/run-lan-startmenu-tests.mjs
 *
 * Prerequisites:
 *   - Node 20+ (nvm)
 *   - Puppeteer Chrome at ~/.cache/puppeteer/chrome/
 *   - No other processes on ports 3000-3006 or 2567
 */

import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const DEV_SERVER_PORT = 3000;
const COLYSEUS_PORT = 2567;
const BASE_URL = `http://localhost:${DEV_SERVER_PORT}`;
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/lan-startmenu');
const RESULTS_DIR = resolve(PROJECT_ROOT, 'test-results/lan-startmenu');

// Detect Node bin directory
const NVM_PATH = process.env.NVM_BIN
  || dirname(process.execPath)
  || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=800,600',
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
];

// SwiftShader is slow, so timeouts are generous
const TIMEOUTS = {
  serverBoot: 15000,
  devServerBoot: 30000,
  pageLoad: 30000,
  menuRender: 10000,
  uiAction: 5000,
  hostStart: 20000,
  lobbyAppear: 25000,
  gameInit: 20000,
  connection: 25000,
  gameStart: 20000,
  enemySpawn: 25000,
};

// ---------------------------------------------------------------------------
// Test Framework
// ---------------------------------------------------------------------------

const tests = [];
let totalPass = 0;
let totalFail = 0;
let totalSkip = 0;
const allResults = [];

function test(name, fn, { skip = false } = {}) {
  tests.push({ name, fn, skip, result: null });
}

class AssertionError extends Error {
  constructor(msg) { super(msg); this.name = 'AssertionError'; }
}

function expect(value) {
  return {
    toBe(expected) {
      if (value !== expected)
        throw new AssertionError(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    },
    toBeGreaterThan(n) {
      if (value <= n)
        throw new AssertionError(`Expected ${value} > ${n}`);
    },
    toBeTruthy() {
      if (!value)
        throw new AssertionError(`Expected truthy, got ${JSON.stringify(value)}`);
    },
    not: {
      toBeNull() {
        if (value === null || value === undefined)
          throw new AssertionError(`Expected non-null/undefined, got ${JSON.stringify(value)}`);
      },
      toBe(expected) {
        if (value === expected)
          throw new AssertionError(`Expected NOT ${JSON.stringify(expected)}`);
      },
    },
  };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Process Management (reused from run-lan-tests.mjs)
// ---------------------------------------------------------------------------

function killPortProcesses(ports) {
  for (const port of ports) {
    try {
      const result = execSync(`ss -tlnp 2>/dev/null | grep ':${port} '`, { encoding: 'utf-8' });
      if (result.trim()) {
        const pidMatches = result.matchAll(/pid=(\d+)/g);
        const pids = new Set();
        for (const match of pidMatches) {
          pids.add(match[1]);
        }
        for (const pid of pids) {
          try {
            execSync(`kill -9 ${pid} 2>/dev/null`);
            console.log(`  Killed process ${pid} on port ${port}`);
          } catch { /* already dead */ }
        }
        execSync('sleep 2');
      }
    } catch { /* no process on port */ }
  }
}

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
      if (!started) reject(new Error(`Server failed to start: ${err.message}`));
    });

    serverProcess.on('exit', (code) => {
      if (!started) reject(new Error(`Server exited with code ${code}. Output: ${output.slice(0, 500)}`));
    });

    setTimeout(() => {
      if (!started) {
        serverProcess.kill();
        reject(new Error(`Server did not start within timeout. Output: ${output.slice(0, 500)}`));
      }
    }, TIMEOUTS.serverBoot);
  });
}

async function checkDevServer() {
  try {
    const resp = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(5000) });
    return resp.ok;
  } catch {
    return false;
  }
}

function startDevServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PATH: `${NVM_PATH}:/usr/bin:/bin`,
    };

    const devProcess = spawn(
      `${NVM_PATH}/npx`,
      ['vite', '--port', String(DEV_SERVER_PORT)],
      { cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let started = false;
    let output = '';

    const onData = (data) => {
      const text = data.toString();
      output += text;
      if (!started && (text.includes('Local:') || text.includes(`localhost:${DEV_SERVER_PORT}`) || text.includes('ready in'))) {
        started = true;
        setTimeout(() => resolve(devProcess), 2000);
      }
    };

    devProcess.stdout.on('data', onData);
    devProcess.stderr.on('data', onData);

    devProcess.on('error', (err) => {
      if (!started) reject(new Error(`Dev server failed to start: ${err.message}`));
    });

    devProcess.on('exit', (code) => {
      if (!started) reject(new Error(`Dev server exited with code ${code}. Output: ${output.slice(0, 500)}`));
    });

    setTimeout(() => {
      if (!started) {
        devProcess.kill();
        reject(new Error(`Dev server did not start within timeout. Output: ${output.slice(0, 500)}`));
      }
    }, TIMEOUTS.devServerBoot);
  });
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch { /* not ready yet */ }
    await sleep(500);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Browser Helpers
// ---------------------------------------------------------------------------

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });
}

async function createPage(context, label) {
  const page = await context.newPage();
  await page.setViewport({ width: 800, height: 600 });

  const errors = [];
  const logs = [];

  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    // Log interesting messages in real-time
    if (text.includes('[Network') || text.includes('Connection') || text.includes('error') || text.includes('Error')) {
      console.log(`      [${label} console] ${text.slice(0, 150)}`);
    }
  });

  page.__testErrors = errors;
  page.__testLogs = logs;
  page.__label = label;
  return page;
}

/** Take a screenshot with step label */
async function screenshot(page, step) {
  try {
    const label = page.__label || 'unknown';
    const filename = `${SCREENSHOT_DIR}/${step}-${label}.png`;
    const buf = await page.screenshot({ encoding: 'binary' });
    writeFileSync(filename, buf);
    console.log(`      Screenshot: ${step}-${label}.png`);
    return true;
  } catch (err) {
    console.log(`      Screenshot failed: ${err.message}`);
    return false;
  }
}

/** Wait for a selector to appear in the page */
async function waitForSelector(page, selector, timeoutMs = TIMEOUTS.uiAction) {
  try {
    await page.waitForSelector(selector, { visible: true, timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Click a button by its selector, with retry */
async function clickButton(page, selector, description, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const clicked = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el && (el.offsetParent !== null || getComputedStyle(el).display !== 'none')) {
        el.click();
        return true;
      }
      return false;
    }, selector);

    if (clicked) {
      console.log(`      Clicked: ${description}`);
      return true;
    }
    await sleep(1000);
  }
  console.log(`      FAILED to click: ${description} (selector: ${selector})`);
  return false;
}

/** Click a button found by visible text content */
async function clickButtonByText(page, text, description, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const clicked = await page.evaluate((t) => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const btnText = btn.textContent || '';
        if (btnText.includes(t) && (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none')) {
          btn.click();
          return btnText.trim();
        }
      }
      return null;
    }, text);

    if (clicked) {
      console.log(`      Clicked: ${description} (text: "${clicked}")`);
      return true;
    }
    await sleep(1000);
  }
  console.log(`      FAILED to click by text "${text}": ${description}`);
  return false;
}

/** Get visible text content of an element */
async function getTextContent(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.textContent?.trim() || '' : null;
  }, selector);
}

/** Read __gameDebug data from a page */
async function getDebug(page, method, ...args) {
  return page.evaluate((m, a) => {
    const debug = window.__gameDebug;
    if (!debug) return null;
    const fn = debug[m];
    if (typeof fn !== 'function') return null;
    return fn(...a);
  }, method, args);
}

/** Poll until a condition returns true */
async function waitForCondition(conditionFn, timeoutMs = 10000, pollMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await conditionFn();
    if (result) return true;
    await sleep(pollMs);
  }
  return false;
}

/** Dump page state for debugging */
async function dumpPageState(page, context) {
  const label = page.__label || 'unknown';
  console.log(`\n      --- Page State Dump (${label}, ${context}) ---`);

  // Check what panels are visible
  const panelState = await page.evaluate(() => {
    const ids = ['main-buttons', 'lan-section', 'lan-host-surface-pick', 'lan-host-info', 'lan-name-dialog'];
    const result = {};
    for (const id of ids) {
      const el = document.querySelector(`#${id}`);
      if (!el) {
        result[id] = 'NOT_FOUND';
      } else {
        const hidden = el.classList.contains('hidden');
        const display = getComputedStyle(el).display;
        result[id] = hidden ? 'hidden' : (display === 'none' ? 'display:none' : 'VISIBLE');
      }
    }
    return result;
  });
  console.log(`      Panels: ${JSON.stringify(panelState)}`);

  // Check visible buttons
  const buttons = await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    const visible = [];
    for (const btn of btns) {
      if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
        const text = (btn.textContent || '').trim().slice(0, 40);
        if (text) visible.push(text);
      }
    }
    return visible;
  });
  console.log(`      Visible buttons: [${buttons.join(', ')}]`);

  // Check status text
  const hostStatus = await getTextContent(page, '#lan-host-status');
  if (hostStatus) {
    console.log(`      Host status: "${hostStatus}"`);
  }

  // Check for __gameDebug
  const hasDebug = await page.evaluate(() => typeof window.__gameDebug !== 'undefined');
  console.log(`      __gameDebug: ${hasDebug}`);

  // Recent console errors
  const recentErrors = (page.__testErrors || []).slice(-5);
  if (recentErrors.length > 0) {
    console.log(`      Recent errors: ${recentErrors.join(' | ')}`);
  }

  console.log(`      --- End Dump ---\n`);
}

// ---------------------------------------------------------------------------
// Test Definitions
// ---------------------------------------------------------------------------

// Step 1: Host navigates Start Menu -> LAN -> HOST GAME -> START HOSTING
test('Step 1: Host opens Start Menu and navigates to LAN panel', async ({ hostPage }) => {
  // Navigate to the start page (no URL params - this is the real start menu)
  const url = `${BASE_URL}/?debug=true&testMode=true`;
  console.log(`      URL: ${url}`);

  await hostPage.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageLoad,
  });

  // Clear localStorage to avoid stale player names from previous runs
  await hostPage.evaluate(() => localStorage.clear());

  // Wait for the start menu to render
  await sleep(3000);
  await screenshot(hostPage, '01-start-menu');

  // Verify the start menu is showing
  const mainButtonsVisible = await waitForSelector(hostPage, '#main-buttons', TIMEOUTS.menuRender);
  expect(mainButtonsVisible).toBe(true);

  // Click the LAN button (it has data-mode="lan")
  const clicked = await hostPage.evaluate(() => {
    const btns = document.querySelectorAll('.oval-btn');
    for (const btn of btns) {
      if (btn.dataset.mode === 'lan') {
        btn.click();
        return true;
      }
    }
    return false;
  });
  expect(clicked).toBe(true);
  console.log('      Clicked LAN button');

  await sleep(1000);
  await screenshot(hostPage, '02-lan-panel');

  // Verify LAN section is now visible
  const lanVisible = await hostPage.evaluate(() => {
    const el = document.querySelector('#lan-section');
    return el && !el.classList.contains('hidden');
  });
  expect(lanVisible).toBe(true);
});

test('Step 2: Host clicks HOST GAME', async ({ hostPage }) => {
  const clicked = await clickButton(hostPage, '#lan-host-btn', 'HOST GAME');
  expect(clicked).toBe(true);

  await sleep(500);
  await screenshot(hostPage, '03-host-surface-pick');

  // Verify surface picker appeared
  const surfacePickVisible = await hostPage.evaluate(() => {
    const el = document.querySelector('#lan-host-surface-pick');
    return el && !el.classList.contains('hidden');
  });
  expect(surfacePickVisible).toBe(true);

  // Verify START HOSTING button is visible
  const startHostVisible = await hostPage.evaluate(() => {
    const el = document.querySelector('#lan-start-host-btn');
    return el && (el.offsetParent !== null || getComputedStyle(el).display !== 'none');
  });
  expect(startHostVisible).toBe(true);
});

test('Step 3: Host selects sphere surface and clicks START HOSTING', async ({ hostPage }) => {
  // Click the sphere surface button in the LAN surface grid
  const surfaceClicked = await hostPage.evaluate(() => {
    const btns = document.querySelectorAll('.lan-surface-grid .surface-btn');
    for (const btn of btns) {
      if (btn.dataset.surface === 'sphere') {
        btn.click();
        return true;
      }
    }
    // If no sphere found, just proceed with default
    return btns.length > 0;
  });
  console.log(`      Surface selection: ${surfaceClicked ? 'selected sphere' : 'using default'}`);

  // Click START HOSTING
  const clicked = await clickButton(hostPage, '#lan-start-host-btn', 'START HOSTING');
  expect(clicked).toBe(true);

  await screenshot(hostPage, '04-starting-server');

  // Wait for "Server running!" status
  const serverRunning = await waitForCondition(async () => {
    const text = await getTextContent(hostPage, '#lan-host-status');
    console.log(`      Host status: "${text}"`);
    return text && text.includes('Server running');
  }, TIMEOUTS.hostStart, 1000);

  await screenshot(hostPage, '05-server-running');

  if (!serverRunning) {
    await dumpPageState(hostPage, 'after START HOSTING timeout');
  }
  expect(serverRunning).toBe(true);

  // Verify ENTER GAME button appeared
  const enterGameVisible = await hostPage.evaluate(() => {
    const el = document.querySelector('#lan-enter-btn');
    return el && !el.classList.contains('hidden');
  });
  expect(enterGameVisible).toBe(true);
});

test('Step 4: Host clicks ENTER GAME and fills name dialog', async ({ hostPage }) => {
  // Click ENTER GAME
  const clicked = await clickButton(hostPage, '#lan-enter-btn', 'ENTER GAME');
  expect(clicked).toBe(true);

  await sleep(500);
  await screenshot(hostPage, '06-name-dialog-host');

  // Verify name dialog is showing
  const nameDialogVisible = await hostPage.evaluate(() => {
    const el = document.querySelector('#lan-name-dialog');
    return el && !el.classList.contains('hidden');
  });
  expect(nameDialogVisible).toBe(true);

  // Type a name
  await hostPage.evaluate(() => {
    const input = document.querySelector('#lan-name-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  });
  await hostPage.type('#lan-name-input', 'HostPlayer');
  console.log('      Typed name: HostPlayer');

  // Click JOIN
  const joinClicked = await clickButton(hostPage, '#lan-name-join-btn', 'JOIN');
  expect(joinClicked).toBe(true);

  await screenshot(hostPage, '07-host-joining');

  // Wait for the game to initialize (network-main.ts loads)
  console.log('      Waiting for game to initialize...');
  const gameLoaded = await waitForCondition(async () => {
    const hasDebug = await hostPage.evaluate(() => typeof window.__gameDebug !== 'undefined');
    return hasDebug;
  }, TIMEOUTS.gameInit, 1000);

  await screenshot(hostPage, '08-host-game-loaded');

  if (!gameLoaded) {
    await dumpPageState(hostPage, 'after host game load timeout');
    // Check recent console logs
    const recentLogs = (hostPage.__testLogs || []).slice(-20);
    console.log('      Recent host logs:');
    for (const log of recentLogs) {
      console.log(`        ${log.slice(0, 150)}`);
    }
  }
  expect(gameLoaded).toBe(true);
});

test('Step 5: Host is connected to server', async ({ hostPage }) => {
  // Wait for connection
  const connected = await waitForCondition(async () => {
    const result = await getDebug(hostPage, 'isConnected');
    return result === true;
  }, TIMEOUTS.connection, 1000);

  if (!connected) {
    await dumpPageState(hostPage, 'host not connected');
  }
  expect(connected).toBe(true);
  console.log('      Host connected to server');
});

// Step 2: Joiner navigates Start Menu -> LAN -> Manual Connect -> name dialog -> JOIN
test('Step 6: Joiner opens Start Menu and navigates to LAN panel', async ({ joinPage }) => {
  const url = `${BASE_URL}/?debug=true&testMode=true`;
  console.log(`      URL: ${url}`);

  await joinPage.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.pageLoad,
  });

  // Clear localStorage to avoid stale player names from previous runs
  await joinPage.evaluate(() => localStorage.clear());

  await sleep(3000);
  await screenshot(joinPage, '09-joiner-start-menu');

  // Click the LAN button
  const clicked = await joinPage.evaluate(() => {
    const btns = document.querySelectorAll('.oval-btn');
    for (const btn of btns) {
      if (btn.dataset.mode === 'lan') {
        btn.click();
        return true;
      }
    }
    return false;
  });
  expect(clicked).toBe(true);
  console.log('      Joiner clicked LAN button');

  await sleep(1000);
  await screenshot(joinPage, '10-joiner-lan-panel');
});

test('Step 7: Joiner sees lobby entry OR uses manual connect', async ({ joinPage }) => {
  // Wait a moment for auto-refresh to scan
  console.log('      Waiting for lobby scan...');
  await sleep(3000);

  // Check if any lobby entries appeared
  const lobbyFound = await joinPage.evaluate(() => {
    const entries = document.querySelectorAll('.lan-lobby-entry');
    return entries.length;
  });
  console.log(`      Lobby entries found: ${lobbyFound}`);

  if (lobbyFound > 0) {
    // Click the first lobby entry
    await screenshot(joinPage, '11-joiner-lobby-found');
    const clicked = await joinPage.evaluate(() => {
      const entry = document.querySelector('.lan-lobby-entry');
      if (entry) {
        entry.click();
        return true;
      }
      return false;
    });
    expect(clicked).toBe(true);
    console.log('      Clicked lobby entry');
  } else {
    // Fallback: use manual connect with localhost
    console.log('      No lobby entries found, using manual connect...');
    await screenshot(joinPage, '11-joiner-no-lobby');

    // Type localhost in the IP input
    await joinPage.evaluate(() => {
      const input = document.querySelector('#lan-ip-input');
      if (input) {
        input.value = '';
        input.focus();
      }
    });
    await joinPage.type('#lan-ip-input', 'localhost');
    console.log('      Typed IP: localhost');

    // Click CONNECT
    const connectClicked = await clickButton(joinPage, '#lan-connect-btn', 'CONNECT');
    expect(connectClicked).toBe(true);
  }

  await sleep(500);
  await screenshot(joinPage, '12-joiner-name-dialog');

  // Verify name dialog appeared
  const nameDialogVisible = await joinPage.evaluate(() => {
    const el = document.querySelector('#lan-name-dialog');
    return el && !el.classList.contains('hidden');
  });
  expect(nameDialogVisible).toBe(true);
});

test('Step 8: Joiner fills name and clicks JOIN', async ({ joinPage }) => {
  // Type a name
  await joinPage.evaluate(() => {
    const input = document.querySelector('#lan-name-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  });
  await joinPage.type('#lan-name-input', 'JoinPlayer');
  console.log('      Typed name: JoinPlayer');

  // Click JOIN
  const joinClicked = await clickButton(joinPage, '#lan-name-join-btn', 'JOIN');
  expect(joinClicked).toBe(true);

  await screenshot(joinPage, '13-joiner-joining');

  // Wait for game to initialize
  console.log('      Waiting for joiner game to initialize...');
  const gameLoaded = await waitForCondition(async () => {
    const hasDebug = await joinPage.evaluate(() => typeof window.__gameDebug !== 'undefined');
    return hasDebug;
  }, TIMEOUTS.gameInit, 1000);

  await screenshot(joinPage, '14-joiner-game-loaded');

  if (!gameLoaded) {
    await dumpPageState(joinPage, 'after joiner game load timeout');
    const recentLogs = (joinPage.__testLogs || []).slice(-20);
    console.log('      Recent joiner logs:');
    for (const log of recentLogs) {
      console.log(`        ${log.slice(0, 150)}`);
    }
  }
  expect(gameLoaded).toBe(true);
});

test('Step 9: Joiner is connected to server', async ({ joinPage }) => {
  const connected = await waitForCondition(async () => {
    const result = await getDebug(joinPage, 'isConnected');
    return result === true;
  }, TIMEOUTS.connection, 1000);

  if (!connected) {
    await dumpPageState(joinPage, 'joiner not connected');
  }
  expect(connected).toBe(true);
  console.log('      Joiner connected to server');
});

// Step 3: Verify both players see each other
test('Step 10: Both players see each other', async ({ hostPage, joinPage }) => {
  // Give extra time for both clients to sync player lists.
  await sleep(3000);

  // Wait for both to see at least 2 players (generous timeout + frequent polling)
  const hostSees2 = await waitForCondition(
    async () => {
      const count = await getDebug(hostPage, 'getPlayerCount');
      if (count !== null && count < 2) {
        console.log(`      Host sees ${count} player(s), waiting for 2+...`);
      }
      return count >= 2;
    },
    TIMEOUTS.connection,
    500,
  );

  const joinSees2 = await waitForCondition(
    async () => {
      const count = await getDebug(joinPage, 'getPlayerCount');
      return count >= 2;
    },
    TIMEOUTS.connection,
    500,
  );

  const hostPlayerCount = await getDebug(hostPage, 'getPlayerCount');
  const joinPlayerCount = await getDebug(joinPage, 'getPlayerCount');
  console.log(`      Host sees ${hostPlayerCount} player(s), Joiner sees ${joinPlayerCount} player(s)`);

  if (!hostSees2) {
    const hostConnected = await getDebug(hostPage, 'isConnected');
    console.log(`      Host connected: ${hostConnected}`);
    const recentLogs = (hostPage.__testLogs || []).filter(l =>
      l.includes('Player') || l.includes('player') || l.includes('Network')
    ).slice(-10);
    console.log('      Host network logs:');
    for (const log of recentLogs) {
      console.log(`        ${log.slice(0, 150)}`);
    }
  }

  // Both clients must see at least 2 players (may see more due to Colyseus
  // seat reservations or reconnection tokens from the lobby scan flow).
  expect(hostSees2).toBe(true);
  expect(joinSees2).toBe(true);
  expect(hostPlayerCount).toBeGreaterThan(1);
  expect(joinPlayerCount).toBeGreaterThan(1);
});

test('Step 11: Both players have distinct IDs', async ({ hostPage, joinPage }) => {
  const hostId = await getDebug(hostPage, 'getLocalPlayerId');
  const joinId = await getDebug(joinPage, 'getLocalPlayerId');

  console.log(`      Host ID: ${hostId}, Join ID: ${joinId}`);

  expect(hostId).not.toBeNull();
  expect(joinId).not.toBeNull();
  expect(hostId).not.toBe(joinId);
});

// Step 4: Host starts the game
test('Step 12: Host can start the game via START GAME button', async ({ hostPage }) => {
  // Look for START GAME or equivalent button
  for (let attempt = 0; attempt < 5; attempt++) {
    const clicked = await hostPage.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const text = btn.textContent || '';
        if ((text.includes('START GAME') || text.includes('PLAY AGAIN')) &&
            (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none')) {
          btn.click();
          return text.trim();
        }
      }
      return null;
    });

    if (clicked) {
      console.log(`      Clicked: "${clicked}" (attempt ${attempt + 1})`);
      break;
    }
    await sleep(2000);
  }

  await sleep(2000);
  await screenshot(hostPage, '15-game-started');

  // Wait for game to actually start (wave text changes)
  const gameStarted = await waitForCondition(
    async () => {
      const text = await getDebug(hostPage, 'getWaveText');
      return text && !text.includes('Waiting') && !text.includes('Connecting');
    },
    TIMEOUTS.gameStart,
    1000,
  );

  const waveText = await getDebug(hostPage, 'getWaveText');
  console.log(`      Wave text: "${waveText}"`);

  if (!gameStarted) {
    await dumpPageState(hostPage, 'game did not start');
  }
  expect(gameStarted).toBe(true);
});

// Step 5: Verify enemies spawn
test('Step 13: Enemies spawn after game starts', async ({ hostPage }) => {
  const hasEnemies = await waitForCondition(
    async () => {
      const count = await getDebug(hostPage, 'getEnemyCount');
      return count > 0;
    },
    TIMEOUTS.enemySpawn,
    1000,
  );

  const enemyCount = await getDebug(hostPage, 'getEnemyCount');
  console.log(`      Enemy count: ${enemyCount}`);

  await screenshot(hostPage, '16-enemies-spawned');

  expect(hasEnemies).toBe(true);
  expect(enemyCount).toBeGreaterThan(0);
});

test('Step 14: Joiner also sees enemies', async ({ joinPage }) => {
  await sleep(2000); // Give network time to sync

  const joinEnemies = await getDebug(joinPage, 'getEnemyCount');
  console.log(`      Joiner enemy count: ${joinEnemies}`);

  await screenshot(joinPage, '17-joiner-enemies');

  expect(joinEnemies).toBeGreaterThan(0);
});

// Step 6: Both pages use the same surface
test('Step 15: Both clients use sphere surface', async ({ hostPage, joinPage }) => {
  const hostSurface = await getDebug(hostPage, 'getSurfaceType');
  const joinSurface = await getDebug(joinPage, 'getSurfaceType');

  console.log(`      Host surface: ${hostSurface}, Joiner surface: ${joinSurface}`);

  expect(hostSurface).toBe('sphere');
  expect(joinSurface).toBe('sphere');
});

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------

async function runAllTests() {
  for (const dir of [SCREENSHOT_DIR, RESULTS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  console.log('='.repeat(70));
  console.log('  GEOMETRY WARS - LAN StartMenu Flow E2E Test Suite');
  console.log('  Tests the full UI flow: Start Menu -> LAN -> HOST/JOIN');
  console.log('='.repeat(70));

  // Check Chrome binary
  if (!existsSync(CHROME_PATH)) {
    console.error(`\n  ERROR: Chrome not found at ${CHROME_PATH}`);
    process.exit(1);
  }
  console.log(`\n  Chrome: ${CHROME_PATH}`);

  // ---- Kill stale processes ----
  console.log('\n  Killing stale processes on ports 3000-3006, 2567...');
  killPortProcesses([3000, 3001, 3002, 3003, 3004, 3005, 3006, 2567]);
  await sleep(1000);

  // ---- Start servers ----
  let serverProcess = null;
  let devProcess = null;
  let browser = null;

  try {
    // Start Colyseus server FIRST (so /__lan/start detects it as external)
    console.log(`\n  Starting Colyseus server on port ${COLYSEUS_PORT}...`);
    serverProcess = await startColyseusServer();
    console.log('  Colyseus server started.');

    // Verify server is reachable
    const serverReady = await waitForServer(`http://localhost:${COLYSEUS_PORT}/health`, 10000);
    if (!serverReady) {
      throw new Error('Colyseus server health check failed');
    }
    console.log('  Colyseus server health check: OK');

    // Start/check dev server
    const devRunning = await checkDevServer();
    if (devRunning) {
      console.log(`  Dev server already running on port ${DEV_SERVER_PORT}`);
    } else {
      console.log(`  Starting Vite dev server on port ${DEV_SERVER_PORT}...`);
      devProcess = await startDevServer();
      console.log('  Vite dev server started.');
    }

    const devReady = await waitForServer(BASE_URL, 10000);
    if (!devReady) {
      throw new Error('Dev server not reachable');
    }
    console.log(`  Dev server: ${BASE_URL} (OK)`);

    // Verify the LAN plugin is responding
    const lanAvailable = await waitForServer(`${BASE_URL}/__lan/status`, 5000);
    console.log(`  LAN plugin (/__lan/status): ${lanAvailable ? 'OK' : 'UNAVAILABLE'}`);

    // ---- Launch browser ----
    console.log('\n  Launching browser...');
    browser = await launchBrowser();

    // Use separate incognito browser contexts to prevent shared state
    // (cookies, localStorage, WebSocket connections) from causing ghost players
    const hostContext = await browser.createBrowserContext();
    const joinContext = await browser.createBrowserContext();
    const hostPage = await createPage(hostContext, 'host');
    const joinPage = await createPage(joinContext, 'join');
    console.log('  Browser launched with 2 pages (separate contexts).');

    // ---- Run tests sequentially ----
    console.log('\n  Running StartMenu flow tests...\n');

    for (const t of tests) {
      if (t.skip) {
        totalSkip++;
        t.result = 'SKIP';
        console.log(`    SKIP  ${t.name}`);
        allResults.push({ test: t.name, status: 'SKIP', duration: 0 });
        continue;
      }

      const startTime = Date.now();
      try {
        await t.fn({ hostPage, joinPage });

        const duration = Date.now() - startTime;
        t.result = 'PASS';
        totalPass++;
        console.log(`    PASS  ${t.name} (${duration}ms)`);
        allResults.push({ test: t.name, status: 'PASS', duration });
      } catch (err) {
        const duration = Date.now() - startTime;

        if (err instanceof AssertionError) {
          t.result = 'FAIL';
          totalFail++;
          console.log(`    FAIL  ${t.name} (${duration}ms)`);
          console.log(`          ${err.message}`);
          allResults.push({ test: t.name, status: 'FAIL', duration, error: err.message });
        } else {
          t.result = 'ERROR';
          totalFail++;
          console.log(`    ERROR ${t.name} (${duration}ms)`);
          console.log(`          ${err.message}`);
          allResults.push({ test: t.name, status: 'ERROR', duration, error: err.message });
        }

        // Take failure screenshots on both pages
        await screenshot(hostPage, `FAIL-${t.name.replace(/[^a-zA-Z0-9]/g, '-')}`);
        await screenshot(joinPage, `FAIL-${t.name.replace(/[^a-zA-Z0-9]/g, '-')}`);
      }
    }

    // Final screenshots
    await screenshot(hostPage, '99-final');
    await screenshot(joinPage, '99-final');

    // Close pages and contexts
    await hostPage.close();
    await joinPage.close();
    try { await hostContext.close(); } catch { /* ignore */ }
    try { await joinContext.close(); } catch { /* ignore */ }
    await browser.close();
    browser = null;

  } finally {
    console.log('\n  Cleaning up...');

    if (browser) {
      try { await browser.close(); } catch { /* ignore */ }
    }
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      console.log('  Colyseus server stopped.');
    }
    if (devProcess) {
      devProcess.kill('SIGTERM');
      console.log('  Dev server stopped.');
    }

    await sleep(1000);
    killPortProcesses([COLYSEUS_PORT]);
  }

  // ---- Summary ----
  console.log('\n' + '='.repeat(70));
  console.log(`  RESULTS: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped (${tests.length} total)`);
  console.log('='.repeat(70));

  if (totalFail > 0) {
    console.log('\n  Failed tests:');
    for (const r of allResults.filter(r => r.status !== 'PASS' && r.status !== 'SKIP')) {
      console.log(`    - ${r.test}: ${r.error}`);
    }
  }

  console.log(`\n  Screenshots: ${SCREENSHOT_DIR}/`);

  // Write results JSON
  const resultsData = {
    timestamp: new Date().toISOString(),
    passed: totalPass,
    failed: totalFail,
    skipped: totalSkip,
    total: tests.length,
    tests: allResults,
    config: {
      devServerPort: DEV_SERVER_PORT,
      colyseusPort: COLYSEUS_PORT,
      surface: 'sphere',
      flow: 'startmenu',
    },
  };

  writeFileSync(`${RESULTS_DIR}/lan-startmenu-results.json`, JSON.stringify(resultsData, null, 2));
  console.log(`  Results JSON: ${RESULTS_DIR}/lan-startmenu-results.json`);
  console.log('');

  return totalFail === 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

runAllTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
