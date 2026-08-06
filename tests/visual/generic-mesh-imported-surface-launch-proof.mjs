#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { screenshotPixelStats } from './screenshot-pixel-stats.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || process.env.SP_DEV_PORT || 3052);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/generic-mesh-imported-surface-launch', RUN_ID);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/generic-mesh-imported-surface-launch-${RUN_ID}.json`);
const MESH_PATH = process.env.CUSTOM_MESH_PROOF_PATH || '/meshes/cup.obj';
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/mnt/d/WSL-Caches/home-antoine/.cache/puppeteer/chrome/linux-145.0.7632.46/chrome-linux64/chrome',
  '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME_PATH = CHROME_CANDIDATES.find(path => existsSync(path)) || CHROME_CANDIDATES[0];

function wait(ms) {
  return new Promise(resolveWait => setTimeout(resolveWait, ms));
}

function findUp(relativePath, startDir = PROJECT_ROOT) {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // keep waiting
    }
    await wait(300);
  }
  return false;
}

function criticalErrors(errors) {
  return errors.filter((entry) => {
    const type = String(entry.type || '').toLowerCase();
    const text = String(entry.text || entry.message || entry);
    const looksCritical = type === 'error'
      || text.includes('Failed to load custom mesh')
      || text.includes('Uncaught')
      || text.includes('TypeError')
      || text.includes('ReferenceError');
    return looksCritical
      && !text.includes('favicon')
      && !text.includes('AudioContext')
      && !text.includes('SharedArrayBuffer')
      && !text.includes('WebGPU')
      && !text.includes('404')
      && !text.includes('PerformanceExporter')
      && !text.includes('net::ERR_CONNECTION_REFUSED');
  });
}

async function run() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });

  const viteBin = findUp('node_modules/vite/bin/vite.js');
  if (!viteBin) throw new Error('Could not find node_modules/vite/bin/vite.js');

  const server = spawn(process.execPath, [
    viteBin,
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
  ], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });

  const serverOutput = [];
  server.stdout.on('data', chunk => serverOutput.push(String(chunk)));
  server.stderr.on('data', chunk => serverOutput.push(String(chunk)));

  let browser;
  const pageErrors = [];
  const consoleEntries = [];
  try {
    const ready = await waitForHttp(BASE_URL);
    if (!ready) throw new Error(`Vite server did not respond at ${BASE_URL}`);

    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROME_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1280, height: 900 },
    });

    const page = await browser.newPage();
    page.on('console', (msg) => consoleEntries.push({ type: msg.type(), text: msg.text() }));
    page.on('pageerror', (error) => pageErrors.push({ message: error.message, stack: error.stack }));

    const url = `${BASE_URL}/?quickStart=true&surface=custom&mesh=${encodeURIComponent(MESH_PATH)}&debug=true&testMode=true&renderer=webgl2`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('canvas', { timeout: 30_000 });
    await page.waitForFunction(() => {
      const state = window._gameState;
      return Boolean(state && state.game && state.game.surface === 'custom' && state.walker && Number.isFinite(state.walker.position.x));
    }, { timeout: 30_000 });
    await wait(1600);

    const screenshotPath = resolve(SCREENSHOT_DIR, 'custom-cup-quickstart.png');
    await page.screenshot({ path: screenshotPath });
    const pixelStats = screenshotPixelStats(screenshotPath);
    if (!pixelStats.nonblank) {
      throw new Error(`Screenshot was blank or invalid: ${JSON.stringify(pixelStats)}`);
    }

    const state = await page.evaluate(() => ({
      gameState: window._gameState,
      rendererState: window._rendererState,
      customMeshLoadError: window.__customMeshLoadError || null,
      canvas: (() => {
        const canvas = document.querySelector('canvas');
        return canvas ? { width: canvas.width, height: canvas.height } : null;
      })(),
    }));
    if (state.customMeshLoadError) {
      throw new Error(`Custom mesh load error was set: ${state.customMeshLoadError}`);
    }

    const report = {
      status: 'PASS',
      runId: RUN_ID,
      url,
      meshPath: MESH_PATH,
      screenshotPath,
      pixelStats,
      state,
      pageErrors,
      criticalConsole: criticalErrors(consoleEntries),
      serverOutputTail: serverOutput.join('').split('\n').slice(-40),
    };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    console.log(`PASS generic mesh imported surface launch proof: ${REPORT_PATH}`);
  } catch (error) {
    const report = {
      status: 'FAIL',
      runId: RUN_ID,
      meshPath: MESH_PATH,
      error: error instanceof Error ? error.message : String(error),
      pageErrors,
      criticalConsole: criticalErrors(consoleEntries),
      serverOutputTail: serverOutput.join('').split('\n').slice(-80),
    };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await wait(300);
  }

  if (!existsSync(REPORT_PATH) || statSync(REPORT_PATH).size === 0) {
    throw new Error(`Report was not retained: ${REPORT_PATH}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
