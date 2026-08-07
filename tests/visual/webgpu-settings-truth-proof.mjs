#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { screenshotPixelStats } from './screenshot-pixel-stats.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || process.env.DEV_PORT || 3066);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_PATH = resolve(ROOT, 'reports', `webgpu-settings-truth-proof-${RUN_ID}.json`);
const SCREENSHOT_DIR = resolve(ROOT, 'test-screenshots/webgpu-settings-truth-proof', RUN_ID);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function findChrome() {
  const cacheRoot = resolve(process.env.HOME || '/home/antoine', '.cache/puppeteer/chrome');
  let cached = [];
  try {
    cached = readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('linux-'))
      .map((entry) => resolve(cacheRoot, entry.name, 'chrome-linux64/chrome'))
      .sort()
      .reverse();
  } catch {
    // Fall through to explicit/system paths.
  }
  return [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    ...cached,
  ].filter(Boolean).find((candidate) => existsSync(candidate));
}

function findViteBin() {
  let dir = ROOT;
  for (;;) {
    const candidate = resolve(dir, 'node_modules/vite/bin/vite.js');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // Retry.
    }
    await sleep(350);
  }
  return false;
}

function startVite(logs) {
  const viteBin = findViteBin();
  if (!viteBin) {
    throw new Error(`Missing Vite binary for ${ROOT}`);
  }
  const child = spawn(process.execPath, [
    viteBin,
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
  ], {
    cwd: ROOT,
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const capture = (stream, prefix) => stream.on('data', (data) => {
    for (const line of String(data).split('\n')) {
      if (!line.trim()) continue;
      logs.push(`[${prefix}] ${line}`);
      if (logs.length > 300) logs.shift();
    }
  });
  capture(child.stdout, 'vite');
  capture(child.stderr, 'vite-error');
  return child;
}

async function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already exited.
  }
  await sleep(400);
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Already stopped.
  }
}

function criticalErrors(entries) {
  return entries.filter((entry) => {
    const text = entry.text || entry.message || '';
    if (entry.kind === 'pageerror') return true;
    if (entry.type !== 'error') return false;
    return !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated|WebGPU|No available adapters|GPU adapter|gpu blocklist/i.test(text);
  });
}

async function run() {
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const serverLogs = [];
  const consoleEntries = [];
  const pageErrors = [];
  const server = startVite(serverLogs);
  let browser;

  try {
    const ready = await waitForHttp(BASE_URL);
    if (!ready) throw new Error(`Vite did not respond at ${BASE_URL}`);

    const chrome = findChrome();
    if (!chrome) throw new Error('Could not find Chrome/Chromium for proof');

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: chrome,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1280, height: 820 },
    });

    const page = await browser.newPage();
    page.on('console', (message) => {
      consoleEntries.push({ type: message.type(), text: message.text() });
    });
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack }));

    const url = `${BASE_URL}/?quickStart=true&surface=sphere&debug=true&testMode=true&renderer=webgpu&music=false`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__gameDebug?.getRendererInfo), { timeout: 30000 });
    await sleep(800);

    await page.keyboard.press('Escape');
    await page.waitForSelector('#pause-menu:not(.hidden) [data-action="settings"]', { timeout: 10000 });
    await page.click('#pause-menu [data-action="settings"]');
    await page.waitForSelector('#settings-menu:not(.hidden) #active-renderer-value', { timeout: 10000 });

    const settingsState = await page.evaluate(() => {
      const requested = document.querySelector('#requested-renderer-value');
      const actual = document.querySelector('#active-renderer-value');
      const webgpuStatus = document.querySelector('#webgpu-status-value');
      const status = document.querySelector('#webgpu-request-status');
      const params = new URLSearchParams(window.location.search);
      const localStorageState = {};
      for (const key of [
        'gw3d-graphics-settings',
        'gw3d-audio-settings',
        'gw3d-debug-settings',
        'gw3d-mobile-override',
      ]) {
        localStorageState[key] = window.localStorage.getItem(key);
      }
      return {
        url: window.location.href,
        query: Object.fromEntries(params.entries()),
        localStorageState,
        rendererState: window.__gameDebug?.getRendererInfo?.() ?? null,
        rendererCanvasState: {
          hasExporter: Boolean(window._rendererState),
          dimensions: window._rendererState?.getCanvasDimensions?.() ?? null,
        },
        requestedText: requested?.textContent?.trim() ?? '',
        requestedDataset: requested ? { ...requested.dataset } : null,
        actualText: actual?.textContent?.trim() ?? '',
        actualDataset: actual ? { ...actual.dataset } : null,
        webgpuStatusText: webgpuStatus?.textContent?.trim() ?? '',
        webgpuStatusDataset: webgpuStatus ? { ...webgpuStatus.dataset } : null,
        statusText: status?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        statusDataset: status ? { ...status.dataset } : null,
      };
    });

    const screenshotPath = resolve(SCREENSHOT_DIR, 'settings-renderer-truth.png');
    await page.screenshot({ path: screenshotPath });
    const pixelStats = screenshotPixelStats(screenshotPath);
    if (!pixelStats.nonblank) {
      throw new Error(`Renderer settings screenshot was blank: ${JSON.stringify(pixelStats)}`);
    }

    if (settingsState.requestedText !== 'WebGPU') {
      throw new Error(`Settings did not show requested WebGPU: ${JSON.stringify(settingsState)}`);
    }
    if (!settingsState.rendererState?.backend) {
      throw new Error(`Proof did not capture live renderer backend: ${JSON.stringify(settingsState)}`);
    }
    const actualBackend = settingsState.rendererState?.backend;
    if (actualBackend === 'webgpu') {
      if (settingsState.actualText !== 'WebGPU' || settingsState.actualDataset?.rendererIsWebgpu !== 'true' || settingsState.webgpuStatusDataset?.webgpuStatus !== 'active') {
        throw new Error(`Settings did not agree with active WebGPU renderer: ${JSON.stringify(settingsState)}`);
      }
    } else {
      if (settingsState.actualText !== 'WebGL2') {
        throw new Error(`Settings did not show actual WebGL2 fallback: ${JSON.stringify(settingsState)}`);
      }
      if (!['fallback', 'unavailable-requested'].includes(settingsState.webgpuStatusDataset?.webgpuStatus)) {
        throw new Error(`Settings did not expose WebGPU fallback/unavailable status: ${JSON.stringify(settingsState)}`);
      }
      if (!settingsState.statusText.includes('WebGPU request did not activate')) {
        throw new Error(`Settings did not explain WebGPU fallback: ${JSON.stringify(settingsState)}`);
      }
    }

    const normalizedPageErrors = pageErrors.map((entry) => ({ kind: 'pageerror', ...entry }));
    const report = {
      ok: true,
      url,
      settingsState,
      screenshot: {
        path: relative(ROOT, screenshotPath),
        pixelStats,
      },
      consoleEntries,
      pageErrors: normalizedPageErrors,
      criticalErrors: criticalErrors([...consoleEntries, ...normalizedPageErrors]),
      serverLogs: serverLogs.slice(-80),
      proofBoundary: 'Headless browser settings-path proof. Proves request/actual/settings truthfulness, not Windows WebGPU rendering quality or enemy visibility.',
    };

    if (report.criticalErrors.length) {
      throw new Error(`Critical browser errors: ${JSON.stringify(report.criticalErrors.slice(0, 5))}`);
    }

    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`PASS webgpu settings truth proof: ${relative(ROOT, REPORT_PATH)}`);
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(server);
  }
}

run().catch((error) => {
  const failure = {
    ok: false,
    error: error?.stack || error?.message || String(error),
  };
  try {
    mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
    writeFileSync(REPORT_PATH, JSON.stringify(failure, null, 2));
  } catch {
    // Ignore report write failure.
  }
  console.error(error);
  process.exit(1);
});
