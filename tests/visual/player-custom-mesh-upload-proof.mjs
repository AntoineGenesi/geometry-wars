#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { screenshotPixelStats } from './screenshot-pixel-stats.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || process.env.SP_DEV_PORT || 3055);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/player-custom-mesh-upload-proof', RUN_ID);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/player-custom-mesh-upload-proof-${RUN_ID}.json`);
const REPORT_MD_PATH = resolve(PROJECT_ROOT, `reports/player-custom-mesh-upload-proof-${RUN_ID}.md`);
const VALID_MESH_PATH = resolve(PROJECT_ROOT, process.env.CUSTOM_MESH_UPLOAD_PROOF_FILE || 'public/meshes/cup.obj');
const INVALID_FILE_PATH = resolve(SCREENSHOT_DIR, 'not-a-mesh.txt');
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

async function screenshot(page, name) {
  const screenshotPath = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath });
  const pixelStats = screenshotPixelStats(screenshotPath);
  if (!pixelStats.nonblank) {
    throw new Error(`Screenshot was blank or invalid: ${JSON.stringify(pixelStats)}`);
  }
  return { path: relative(PROJECT_ROOT, screenshotPath), pixelStats };
}

async function openQuickGameSurfacePanel(page) {
  await page.waitForSelector('#start-menu .oval-btn[data-mode="single"]', { timeout: 30_000 });
  await page.click('#start-menu .oval-btn[data-mode="single"]');
  await page.waitForSelector('#surface-section:not(.hidden) #custom-mesh-file-input', { timeout: 10_000 });
}

async function uploadMeshFile(page, filePath) {
  await page.evaluate(() => {
    const input = document.querySelector('#custom-mesh-file-input');
    if (input) input.__gridClass = 'quick-game-surface-grid';
  });
  const input = await page.$('#custom-mesh-file-input');
  if (!input) throw new Error('Could not find custom mesh file input');
  await input.uploadFile(filePath);
  await wait(300);
  return page.evaluate(() => {
    const status = document.querySelector('#custom-mesh-status');
    const customButton = document.querySelector('#surface-section .custom-mesh-btn');
    const startMenu = document.querySelector('#start-menu');
    return {
      text: status?.textContent || '',
      ready: status?.classList.contains('ready') || false,
      error: status?.classList.contains('error') || false,
      customSelected: customButton?.classList.contains('selected') || false,
      menuVisible: Boolean(startMenu),
    };
  });
}

async function run() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });
  writeFileSync(INVALID_FILE_PATH, 'not a mesh');

  if (!existsSync(VALID_MESH_PATH)) {
    throw new Error(`Proof mesh does not exist: ${VALID_MESH_PATH}`);
  }

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

    const url = `${BASE_URL}/?debug=true&testMode=true&renderer=webgl2&music=false`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await openQuickGameSurfacePanel(page);

    const initialStatus = await page.evaluate(() => document.querySelector('#custom-mesh-status')?.textContent || '');
    const invalidUpload = await uploadMeshFile(page, INVALID_FILE_PATH);
    if (!invalidUpload.error || !invalidUpload.text.includes('Unsupported file type') || !invalidUpload.menuVisible) {
      throw new Error(`Invalid upload did not fail closed in-menu: ${JSON.stringify(invalidUpload)}`);
    }

    const invalidScreenshot = await screenshot(page, 'invalid-upload-error');
    const validUpload = await uploadMeshFile(page, VALID_MESH_PATH);
    if (!validUpload.ready || !validUpload.customSelected || !validUpload.text.includes('Selected')) {
      throw new Error(`Valid upload did not select the custom map: ${JSON.stringify(validUpload)}`);
    }

    const selectedScreenshot = await screenshot(page, 'valid-upload-selected');
    await page.click('#surface-start-btn');
    await page.waitForSelector('canvas', { timeout: 30_000 });
    await page.waitForFunction(() => {
      const state = window._gameState;
      return Boolean(
        state
        && state.game
        && state.game.surface === 'custom'
        && state.walker
        && Number.isFinite(state.walker.position.x)
        && window.__TEST_API
        && window.__GAME_TELEMETRY
      );
    }, { timeout: 30_000 });
    await wait(1000);

    const runtime = await page.evaluate(() => ({
      gameState: window._gameState,
      telemetry: window.__GAME_TELEMETRY,
      parity: window.__TEST_API.getParityFrame(),
      customMeshLoadError: window.__customMeshLoadError || null,
    }));

    if (runtime.customMeshLoadError) {
      throw new Error(`Custom mesh load error was set after upload start: ${runtime.customMeshLoadError}`);
    }

    const gameplayScreenshot = await screenshot(page, 'uploaded-custom-gameplay');
    const criticalConsole = criticalErrors(consoleEntries);
    if (criticalConsole.length > 0 || pageErrors.length > 0) {
      throw new Error(`Critical browser errors during upload proof: ${JSON.stringify({ criticalConsole, pageErrors })}`);
    }

    const report = {
      status: 'PASS',
      runId: RUN_ID,
      proofBoundary: 'Normal Start Menu -> Quick Game -> hidden file input uploadFile(File) -> Start -> real SP src/main.ts custom surface. Does not use quickStart mesh URL.',
      url,
      validMeshPath: relative(PROJECT_ROOT, VALID_MESH_PATH),
      invalidFilePath: relative(PROJECT_ROOT, INVALID_FILE_PATH),
      initialStatus,
      invalidUpload,
      validUpload,
      screenshots: [invalidScreenshot, selectedScreenshot, gameplayScreenshot],
      runtime,
      pageErrors,
      criticalConsole,
      serverOutputTail: serverOutput.join('').split('\n').slice(-40),
    };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    writeFileSync(REPORT_MD_PATH, [
      '# Player Custom Mesh Upload Proof',
      '',
      `- status: ${report.status}`,
      `- runId: ${RUN_ID}`,
      `- valid mesh: ${report.validMeshPath}`,
      `- proof boundary: ${report.proofBoundary}`,
      `- invalid upload error: ${invalidUpload.text}`,
      `- valid upload status: ${validUpload.text}`,
      `- gameplay surface: ${runtime.gameState?.game?.surface}`,
      `- screenshot directory: ${relative(PROJECT_ROOT, SCREENSHOT_DIR)}`,
      '',
    ].join('\n'));
    console.log(`PASS player custom mesh upload proof: ${REPORT_PATH}`);
  } catch (error) {
    const report = {
      status: 'FAIL',
      runId: RUN_ID,
      validMeshPath: relative(PROJECT_ROOT, VALID_MESH_PATH),
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
