#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { screenshotPixelStats } from './screenshot-pixel-stats.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || process.env.DEV_PORT || 3068);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_PATH = resolve(ROOT, 'reports', `webgpu-menu-launch-persistence-proof-${RUN_ID}.json`);
const SCREENSHOT_DIR = resolve(ROOT, 'test-screenshots/webgpu-menu-launch-persistence-proof', RUN_ID);
const RENDERER_STORAGE_KEY = 'gw3d-renderer-preference';

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
    return !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated|WebGPU|No available adapters|GPU adapter|gpu blocklist|WebGPURenderer|RendererFactory.*logs above|fallback to WebGL2/i.test(text);
  });
}

async function installWebGPUAvailabilityShim(page) {
  await page.evaluateOnNewDocument(() => {
    const fakeAdapter = {
      info: {
        vendor: 'Codex',
        architecture: 'Shim',
        device: 'LaunchPersistence',
        description: 'controlled WebGPU availability shim',
      },
      requestDevice: async () => ({ destroy() {} }),
      requestAdapterInfo: async () => ({
        vendor: 'Codex',
        architecture: 'Shim',
        device: 'LaunchPersistence',
        description: 'controlled WebGPU availability shim',
      }),
    };
    const fakeGpu = {
      requestAdapter: async () => fakeAdapter,
    };
    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get: () => fakeGpu,
    });
  });
}

async function readMenuSettingsState(page) {
  return page.evaluate((storageKey) => ({
    url: window.location.href,
    query: Object.fromEntries(new URLSearchParams(window.location.search).entries()),
    persistedRendererPreference: window.localStorage.getItem(storageKey),
    requestedText: document.querySelector('#requested-renderer-value')?.textContent?.trim() ?? '',
    activeText: document.querySelector('#active-renderer-value')?.textContent?.trim() ?? '',
    webgpuStatusText: document.querySelector('#webgpu-status-value')?.textContent?.trim() ?? '',
    enableButtonVisible: Boolean(document.querySelector('#enable-webgpu')),
    switchToWebGLVisible: Boolean(document.querySelector('#switch-to-webgl')),
  }), RENDERER_STORAGE_KEY);
}

async function readGameSettingsState(page) {
  return page.evaluate((storageKey) => {
    const requested = document.querySelector('#requested-renderer-value');
    const actual = document.querySelector('#active-renderer-value');
    const status = document.querySelector('#webgpu-status-value');
    const requestStatus = document.querySelector('#webgpu-request-status');
    return {
      url: window.location.href,
      query: Object.fromEntries(new URLSearchParams(window.location.search).entries()),
      persistedRendererPreference: window.localStorage.getItem(storageKey),
      rendererState: window.__gameDebug?.getRendererInfo?.() ?? null,
      requestedText: requested?.textContent?.trim() ?? '',
      requestedDataset: requested ? { ...requested.dataset } : null,
      activeText: actual?.textContent?.trim() ?? '',
      activeDataset: actual ? { ...actual.dataset } : null,
      webgpuStatusText: status?.textContent?.trim() ?? '',
      webgpuStatusDataset: status ? { ...status.dataset } : null,
      requestStatusText: requestStatus?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    };
  }, RENDERER_STORAGE_KEY);
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
    await installWebGPUAvailabilityShim(page);

    const startUrl = `${BASE_URL}/?debug=true&testMode=true&music=false`;
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#start-menu #settings-btn', { timeout: 30000 });
    await page.click('#settings-btn');
    await page.waitForSelector('#settings-menu:not(.hidden) #enable-webgpu', { timeout: 30000 });
    const menuSettingsBeforeEnable = await readMenuSettingsState(page);
    if (!menuSettingsBeforeEnable.enableButtonVisible) {
      throw new Error(`Start Menu Settings did not expose Enable WebGPU: ${JSON.stringify(menuSettingsBeforeEnable)}`);
    }

    await page.click('#enable-webgpu');
    await page.waitForFunction(
      (storageKey) => new URLSearchParams(window.location.search).get('renderer') === 'webgpu'
        && window.localStorage.getItem(storageKey) === 'webgpu',
      { timeout: 30000 },
      RENDERER_STORAGE_KEY,
    );
    await page.waitForSelector('#start-menu .oval-btn[data-mode="single"]', { timeout: 30000 });
    const afterEnableReload = await page.evaluate((storageKey) => ({
      url: window.location.href,
      query: Object.fromEntries(new URLSearchParams(window.location.search).entries()),
      persistedRendererPreference: window.localStorage.getItem(storageKey),
    }), RENDERER_STORAGE_KEY);

    await page.click('#start-menu .oval-btn[data-mode="single"]');
    await page.waitForSelector('#surface-section:not(.hidden) #surface-start-btn', { timeout: 10000 });
    await page.click('#surface-start-btn');
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__gameDebug?.getRendererInfo), { timeout: 30000 });
    await sleep(1000);
    const launchState = await page.evaluate((storageKey) => ({
      url: window.location.href,
      query: Object.fromEntries(new URLSearchParams(window.location.search).entries()),
      persistedRendererPreference: window.localStorage.getItem(storageKey),
      rendererState: window.__gameDebug?.getRendererInfo?.() ?? null,
    }), RENDERER_STORAGE_KEY);

    await page.keyboard.press('Escape');
    await page.waitForSelector('#pause-menu:not(.hidden) [data-action="settings"]', { timeout: 10000 });
    await page.click('#pause-menu [data-action="settings"]');
    await page.waitForSelector('#settings-menu:not(.hidden) #active-renderer-value', { timeout: 10000 });
    const pauseSettingsState = await readGameSettingsState(page);

    const screenshotPath = resolve(SCREENSHOT_DIR, 'pause-settings-renderer-request.png');
    await page.screenshot({ path: screenshotPath });
    const pixelStats = screenshotPixelStats(screenshotPath);
    if (!pixelStats.nonblank) {
      throw new Error(`Pause Settings screenshot was blank: ${JSON.stringify(pixelStats)}`);
    }

    if (afterEnableReload.query.renderer !== 'webgpu') {
      throw new Error(`Enable WebGPU did not set renderer=webgpu: ${JSON.stringify(afterEnableReload)}`);
    }
    if (afterEnableReload.persistedRendererPreference !== 'webgpu') {
      throw new Error(`Enable WebGPU did not persist preference: ${JSON.stringify(afterEnableReload)}`);
    }
    if (launchState.query.renderer !== 'webgpu') {
      throw new Error(`Start Menu launch dropped renderer=webgpu: ${JSON.stringify(launchState)}`);
    }
    if (launchState.persistedRendererPreference !== 'webgpu') {
      throw new Error(`Launch did not preserve persisted WebGPU preference: ${JSON.stringify(launchState)}`);
    }
    if (launchState.rendererState?.requestedRenderer !== 'webgpu') {
      throw new Error(`Live renderer debug state did not keep requested WebGPU: ${JSON.stringify(launchState)}`);
    }
    if (pauseSettingsState.requestedText !== 'WebGPU') {
      throw new Error(`Pause Settings did not show Requested WebGPU: ${JSON.stringify(pauseSettingsState)}`);
    }
    if (pauseSettingsState.activeText === 'WebGL2') {
      if (!['fallback', 'unavailable-requested'].includes(pauseSettingsState.webgpuStatusDataset?.webgpuStatus)) {
        throw new Error(`Pause Settings did not explain WebGPU fallback: ${JSON.stringify(pauseSettingsState)}`);
      }
      if (!pauseSettingsState.requestStatusText.includes('WebGPU request did not activate')) {
        throw new Error(`Pause Settings fallback text missing: ${JSON.stringify(pauseSettingsState)}`);
      }
    }

    const normalizedPageErrors = pageErrors.map((entry) => ({ kind: 'pageerror', ...entry }));
    const report = {
      ok: true,
      startUrl,
      menuSettingsBeforeEnable,
      afterEnableReload,
      launchState,
      pauseSettingsState,
      screenshot: {
        path: relative(ROOT, screenshotPath),
        pixelStats,
      },
      consoleEntries,
      pageErrors: normalizedPageErrors,
      criticalErrors: criticalErrors([...consoleEntries, ...normalizedPageErrors]),
      serverLogs: serverLogs.slice(-80),
      proofBoundary: 'Headless menu/settings launch propagation proof with controlled WebGPU availability shim. Proves request persistence, URL propagation, live requested-renderer state, and Settings fallback truthfulness; does not prove actual Windows WebGPU gameplay rendering or enemy visibility.',
    };

    if (report.criticalErrors.length) {
      throw new Error(`Critical browser errors: ${JSON.stringify(report.criticalErrors.slice(0, 5))}`);
    }

    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`PASS webgpu menu launch persistence proof: ${relative(ROOT, REPORT_PATH)}`);
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
