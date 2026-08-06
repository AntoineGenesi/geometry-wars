#!/usr/bin/env node
/**
 * Mobile short-code join proof.
 *
 * Exercises the real QR/short-code path:
 *   /12345 -> /?mode=network&surface=...
 *
 * The regression this guards is a fresh mobile client with no saved player name
 * getting stuck behind the loading screen before the network client can connect.
 */

import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const portArgIdx = process.argv.indexOf('--port');
const DEV_SERVER_PORT = portArgIdx >= 0 ? parseInt(process.argv[portArgIdx + 1], 10) : 3004;
const serverPortArgIdx = process.argv.indexOf('--server-port');
const COLYSEUS_PORT = serverPortArgIdx >= 0 ? parseInt(process.argv[serverPortArgIdx + 1], 10) : 2567;
const EXPECT_CURRENT_BUG = process.argv.includes('--expect-current-bug');

const BASE_URL = `http://localhost:${DEV_SERVER_PORT}`;
const SHORT_CODE = '48127';
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/mobile-short-code');
const REPORT_DIR = resolve(PROJECT_ROOT, 'reports');
const NVM_PATH = process.env.NVM_BIN || dirname(process.execPath) || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

const MOBILE_VIEWPORT = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=390,844',
];

const TIMEOUTS = {
  serverBoot: 15000,
  devServerBoot: 30000,
  pageLoad: 90000,
  connection: 30000,
};

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function killPort(port) {
  try {
    const result = execSync(`ss -tlnp 2>/dev/null | grep ':${port} '`, { encoding: 'utf-8' });
    for (const match of result.matchAll(/pid=(\d+)/g)) {
      try { execSync(`kill ${match[1]} 2>/dev/null`); } catch { /* already gone */ }
    }
  } catch { /* no listener */ }
}

function startColyseusServer() {
  return new Promise((resolveStart, reject) => {
    const env = { ...process.env, PATH: `${NVM_PATH}:/usr/bin:/bin`, PORT: String(COLYSEUS_PORT), SHUTDOWN_TIMEOUT: '0' };
    const proc = spawn(`${NVM_PATH}/npx`, ['tsx', 'server/index.ts'], { cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let started = false;
    let output = '';
    const onData = (data) => {
      const text = data.toString();
      output += text;
      if (!started && (text.includes('MULTIPLAYER SERVER') || text.includes(`localhost:${COLYSEUS_PORT}`))) {
        started = true;
        resolveStart(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => { if (!started) reject(err); });
    proc.on('exit', (code) => {
      if (!started) reject(new Error(`Colyseus exited before ready (${code}). ${output.slice(0, 500)}`));
    });
    setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error(`Colyseus boot timeout. ${output.slice(0, 500)}`));
      }
    }, TIMEOUTS.serverBoot);
  });
}

function startDevServer() {
  return new Promise((resolveStart, reject) => {
    const env = { ...process.env, PATH: `${NVM_PATH}:/usr/bin:/bin` };
    const proc = spawn(`${NVM_PATH}/npx`, ['vite', '--port', String(DEV_SERVER_PORT), '--host', 'localhost'], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    let output = '';
    const onData = (data) => {
      const text = data.toString();
      output += text;
      if (!started && (text.includes('Local:') || text.includes(`localhost:${DEV_SERVER_PORT}`) || text.includes('ready in'))) {
        started = true;
        resolveStart(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => { if (!started) reject(err); });
    proc.on('exit', (code) => {
      if (!started) reject(new Error(`Vite exited before ready (${code}). ${output.slice(0, 500)}`));
    });
    setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error(`Vite boot timeout. ${output.slice(0, 500)}`));
      }
    }, TIMEOUTS.devServerBoot);
  });
}

async function registerShortCode() {
  const response = await fetch(`${BASE_URL}/__lan/register-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: SHORT_CODE,
      params: { surface: 'sphere', port: String(COLYSEUS_PORT) },
    }),
  });
  if (!response.ok) throw new Error(`register-code failed: HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok || data.code !== SHORT_CODE) throw new Error(`register-code returned ${JSON.stringify(data)}`);
  return data;
}

async function inspectRedirect() {
  const response = await fetch(`${BASE_URL}/${SHORT_CODE}`, { redirect: 'manual' });
  return {
    status: response.status,
    location: response.headers.get('location'),
  };
}

async function launchMobilePage(browser) {
  const page = await browser.newPage();
  await page.setViewport(MOBILE_VIEWPORT);
  await page.setUserAgent(MOBILE_USER_AGENT);
  const logs = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));
  page.__logs = logs;
  return page;
}

async function inspectNamePrompt(page) {
  return page.evaluate(() => {
    const loading = document.getElementById('loading-screen');
    const input = document.querySelector('input[placeholder="Your name..."]');
    const joinButton = [...document.querySelectorAll('button')]
      .find((button) => (button.textContent || '').trim() === 'JOIN GAME');
    const prompt = input?.closest('[data-network-name-prompt]') || input?.parentElement || null;
    const inputRect = input?.getBoundingClientRect();
    const probeX = inputRect ? inputRect.left + inputRect.width / 2 : window.innerWidth / 2;
    const probeY = inputRect ? inputRect.top + inputRect.height / 2 : window.innerHeight / 2;
    const topElement = document.elementFromPoint(probeX, probeY);
    return {
      finalUrl: window.location.href,
      loadingExists: !!loading,
      loadingZIndex: loading ? getComputedStyle(loading).zIndex : null,
      promptExists: !!prompt,
      promptZIndex: prompt ? getComputedStyle(prompt).zIndex : null,
      inputExists: !!input,
      inputVisible: !!input && !!inputRect && inputRect.width > 0 && inputRect.height > 0,
      joinButtonExists: !!joinButton,
      topElementId: topElement?.id || '',
      topElementTag: topElement?.tagName || '',
      topElementText: (topElement?.textContent || '').trim().slice(0, 80),
      inputTopmost: !!input && (topElement === input || input.contains(topElement)),
    };
  });
}

async function waitForConnected(page) {
  const start = Date.now();
  while (Date.now() - start < TIMEOUTS.connection) {
    const logs = page.__logs || [];
    if (logs.some((line) => line.includes('[NetworkMain] Connected!') || line.includes('[Network] Connected as'))) {
      return true;
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  let browser = null;
  let viteProc = null;
  let colyseusProc = null;
  const report = {
    ok: false,
    expectCurrentBug: EXPECT_CURRENT_BUG,
    baseUrl: BASE_URL,
    shortCode: SHORT_CODE,
    shortUrl: `${BASE_URL}/${SHORT_CODE}`,
    steps: [],
    errors: [],
  };

  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    mkdirSync(REPORT_DIR, { recursive: true });

    killPort(DEV_SERVER_PORT);
    killPort(COLYSEUS_PORT);
    colyseusProc = await startColyseusServer();
    viteProc = await startDevServer();
    await registerShortCode();
    report.redirect = await inspectRedirect();

    browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', args: LAUNCH_ARGS });
    const page = await launchMobilePage(browser);
    await page.goto(`${BASE_URL}/${SHORT_CODE}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageLoad });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded', timeout: TIMEOUTS.pageLoad });
    await sleep(2000);

    const beforeSubmit = await inspectNamePrompt(page);
    report.steps.push({ name: 'fresh-mobile-name-prompt', result: beforeSubmit });
    const beforePath = resolve(SCREENSHOT_DIR, 'fresh-mobile-name-prompt.png');
    await page.screenshot({ path: beforePath });
    report.promptScreenshot = beforePath;

    const promptUsable = beforeSubmit.inputExists && beforeSubmit.inputVisible && beforeSubmit.inputTopmost;
    if (!promptUsable) {
      const message = `Name prompt is not usable: ${JSON.stringify(beforeSubmit)}`;
      report.errors.push(message);
      if (!EXPECT_CURRENT_BUG) throw new Error(message);
      console.log(`[expected current bug] ${message}`);
      return;
    }

    await page.click('input[placeholder="Your name..."]');
    await page.keyboard.type('MobileProof');
    await page.evaluate(() => {
      const joinButton = [...document.querySelectorAll('button')]
        .find((button) => (button.textContent || '').trim() === 'JOIN GAME');
      joinButton?.click();
    });

    const connected = await waitForConnected(page);
    report.steps.push({
      name: 'fresh-mobile-connects-after-name',
      result: { connected, logs: (page.__logs || []).filter((line) => line.includes('[Network')).slice(-20) },
    });
    const afterPath = resolve(SCREENSHOT_DIR, 'fresh-mobile-after-name-submit.png');
    await page.screenshot({ path: afterPath });
    report.connectedScreenshot = afterPath;
    if (!connected) throw new Error('Mobile short-code client did not connect after submitting name');

    report.ok = true;
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err));
    if (!EXPECT_CURRENT_BUG) process.exitCode = 1;
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try { if (viteProc) viteProc.kill(); } catch { /* ignore */ }
    try { if (colyseusProc) colyseusProc.kill(); } catch { /* ignore */ }
    await sleep(500);
    killPort(DEV_SERVER_PORT);
    killPort(COLYSEUS_PORT);
    const reportPath = resolve(REPORT_DIR, `mobile-short-code-join-proof-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`Report: ${reportPath}`);
    if (report.ok) {
      console.log('PASS: mobile short-code join prompt is usable and connects.');
    } else if (EXPECT_CURRENT_BUG && report.errors.length > 0) {
      console.log('EXPECTED-BUG: mobile short-code join prompt remains unusable.');
    } else {
      console.log(`FAIL: ${report.errors.join('; ')}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
