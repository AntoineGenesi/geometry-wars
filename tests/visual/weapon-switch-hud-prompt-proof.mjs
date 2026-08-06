#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { screenshotPixelStats } from './screenshot-pixel-stats.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || process.env.SP_DEV_PORT || 3056);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/weapon-switch-hud-prompt-proof', RUN_ID);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/weapon-switch-hud-prompt-proof-${RUN_ID}.json`);
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

const viewports = [
  { name: 'desktop', width: 1280, height: 800, isMobile: false, hasTouch: false, expectPrompt: true },
  { name: 'touch-narrow-landscape', width: 844, height: 390, isMobile: true, hasTouch: true, expectPrompt: false },
];

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
      // retry until timeout
    }
    await wait(300);
  }
  return false;
}

function criticalErrors(entries) {
  return entries.filter((entry) => {
    const type = String(entry.type || '').toLowerCase();
    const text = String(entry.text || entry.message || entry);
    return (type === 'error' || text.includes('Uncaught') || text.includes('TypeError') || text.includes('ReferenceError'))
      && !text.includes('favicon')
      && !text.includes('AudioContext')
      && !text.includes('SharedArrayBuffer')
      && !text.includes('WebGPU')
      && !text.includes('404')
      && !text.includes('net::ERR_CONNECTION_REFUSED');
  });
}

function rectsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function inspectViewport(page, viewport) {
  await page.setViewport({
    width: viewport.width,
    height: viewport.height,
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    deviceScaleFactor: viewport.isMobile ? 2 : 1,
  });

  const url = `${BASE_URL}/?quickStart=true&surface=sphere&testMode=true&renderer=webgl2&music=false&mobile=${viewport.isMobile ? 'true' : 'false'}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.weapon-hud', { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('.weapon-hud-item').length > 0, { timeout: 30_000 });
  await wait(800);

  const layout = await page.evaluate(() => {
    const rectOf = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const prompt = document.querySelector('.weapon-hud-switch-prompt');
    const hud = document.querySelector('.weapon-hud');
    const firstItem = document.querySelector('.weapon-hud-item');
    const promptStyle = prompt ? getComputedStyle(prompt) : null;
    const promptVisible = Boolean(
      prompt
      && promptStyle
      && promptStyle.display !== 'none'
      && promptStyle.visibility !== 'hidden'
      && prompt.getBoundingClientRect().height > 0
    );
    const promptRect = prompt ? rectOf(prompt) : null;
    const firstItemRect = firstItem ? rectOf(firstItem) : null;
    const hudRect = hud ? rectOf(hud) : null;
    const text = prompt?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const candidates = Array.from(document.body.children)
      .filter(el => !el.classList.contains('weapon-hud'))
      .map(el => ({ tag: el.tagName, id: el.id, className: el.className, text: el.textContent?.slice(0, 80) ?? '', rect: rectOf(el) }))
      .filter(entry => {
        const textLower = entry.text.toLowerCase();
        return entry.rect.width > 0
          && entry.rect.height > 0
          && (textLower.includes('score') || textLower.includes('pause') || entry.id.toLowerCase().includes('pause'));
      });
    return { promptVisible, promptRect, firstItemRect, hudRect, text, candidates };
  });

  const screenshot = resolve(SCREENSHOT_DIR, `${viewport.name}-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  const pixelStats = screenshotPixelStats(screenshot);

  const promptTextOk = layout.text.includes('SWAP')
    && layout.text.includes('Q')
    && layout.text.includes('E')
    && layout.text.includes('PAD Y');
  const promptAboveWeaponRows = !layout.promptVisible
    || (layout.promptRect && layout.firstItemRect && layout.promptRect.bottom <= layout.firstItemRect.top + 1);
  const promptInsideViewport = !layout.promptVisible
    || (layout.promptRect.left >= 0 && layout.promptRect.top >= 0 && layout.promptRect.right <= viewport.width && layout.promptRect.bottom <= viewport.height);
  const promptOverlapsUi = Boolean(layout.promptVisible && layout.promptRect && layout.candidates.some(candidate => rectsIntersect(layout.promptRect, candidate.rect)));
  const passed = viewport.expectPrompt
    ? layout.promptVisible && promptTextOk && promptAboveWeaponRows && promptInsideViewport && !promptOverlapsUi && pixelStats.nonblank
    : !layout.promptVisible && pixelStats.nonblank;

  return {
    viewport,
    url,
    screenshot,
    pixelStats,
    layout,
    checks: {
      promptTextOk,
      promptAboveWeaponRows,
      promptInsideViewport,
      promptOverlapsUi,
    },
    passed,
  };
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });
  if (!existsSync(CHROME_PATH)) throw new Error(`Chrome not found at ${CHROME_PATH}`);

  const viteBin = findUp('node_modules/vite/bin/vite.js');
  if (!viteBin) throw new Error('Could not find node_modules/vite/bin/vite.js');

  const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: PROJECT_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BROWSER: 'none' },
  });
  let serverOutput = '';
  server.stdout.on('data', chunk => { serverOutput += String(chunk); });
  server.stderr.on('data', chunk => { serverOutput += String(chunk); });

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_PATH,
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,800',
    ],
  });

  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('gw3d-debug-settings', JSON.stringify({ showDebugStatistics: false }));
  });
  const errors = [];
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message, stack: error.stack }));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) {
      errors.push({ type: message.type(), text: message.text() });
    }
  });

  const results = [];
  let fatalError = null;
  try {
    if (!await waitForHttp(BASE_URL)) {
      throw new Error(`Vite server did not respond at ${BASE_URL}\n${serverOutput}`);
    }
    for (const viewport of viewports) {
      results.push(await inspectViewport(page, viewport));
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }

  const filteredErrors = criticalErrors(errors);
  const report = {
    generatedAt: new Date().toISOString(),
    codePath: 'Vite app -> src/main.ts quickStart -> shared src/ui/WeaponHUD.ts',
    baseUrl: BASE_URL,
    screenshotDir: SCREENSHOT_DIR,
    results,
    errors,
    criticalErrors: filteredErrors,
    fatalError,
    serverOutput: serverOutput.slice(-5000),
  };
  report.passed = !fatalError
    && filteredErrors.length === 0
    && results.length === viewports.length
    && results.every(result => result.passed);

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${REPORT_PATH}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`Result: ${report.passed ? 'PASS' : 'FAIL'}`);
  process.exit(report.passed ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
