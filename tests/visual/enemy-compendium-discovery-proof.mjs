#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { screenshotPixelStats } from './screenshot-pixel-stats.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || process.env.ENEMY_COMPENDIUM_PORT || 3078);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/enemy-compendium-discovery-proof', RUN_ID);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/enemy-compendium-discovery-proof-${RUN_ID}.json`);
const REPORT_MD_PATH = resolve(PROJECT_ROOT, `reports/enemy-compendium-discovery-proof-${RUN_ID}.md`);
const STORAGE_KEY = 'gw_enemy_discoveries_v1';
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

async function screenshot(page, name) {
  const screenshotPath = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const pixelStats = screenshotPixelStats(screenshotPath);
  if (!pixelStats.nonblank) throw new Error(`Blank screenshot: ${screenshotPath}`);
  return { path: relative(PROJECT_ROOT, screenshotPath), pixelStats };
}

function criticalErrors(entries) {
  return entries.filter((entry) => {
    const text = String(entry.text || entry.message || '');
    const type = String(entry.type || '').toLowerCase();
    return (type === 'error' || /Uncaught|TypeError|ReferenceError/i.test(text))
      && !/favicon|404|AudioContext|WebGPU|No available adapters|SharedArrayBuffer/i.test(text);
  });
}

async function openEnemyTypesFromStart(page) {
  await page.waitForSelector('#enemy-types-btn', { timeout: 30_000 });
  await page.click('#enemy-types-btn');
  await page.waitForSelector('#enemy-compendium-screen:not(.hidden)', { timeout: 10_000 });
  await wait(500);
}

async function collectCompendiumState(page) {
  return page.evaluate(() => {
    const screen = document.querySelector('#enemy-compendium-screen');
    const entries = Array.from(document.querySelectorAll('#enemy-compendium-screen [data-enemy-type]'));
    const states = entries.map((entry) => ({
      type: entry.getAttribute('data-enemy-type'),
      state: entry.getAttribute('data-discovery-state'),
      text: entry.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      previewFrames: entry.querySelectorAll('.ap-enemy-preview-img').length,
      lockedQuestion: Boolean(entry.querySelector('.ap-enemy-preview-question')),
    }));
    const rects = entries.slice(0, 8).map((entry) => {
      const rect = entry.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    return {
      visible: Boolean(screen && !screen.classList.contains('hidden')),
      totalEntries: entries.length,
      seenCount: states.filter((entry) => entry.state === 'seen').length,
      lockedCount: states.filter((entry) => entry.state === 'locked').length,
      grunt: states.find((entry) => entry.type === 'grunt'),
      rocket: states.find((entry) => entry.type === 'rocket'),
      subtitle: document.querySelector('#enemy-compendium-screen .ecs-subtitle')?.textContent ?? '',
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
      rectsInsideViewport: rects.every((rect) => rect.left >= -1 && rect.right <= window.innerWidth + 1 && rect.width > 0),
    };
  });
}

async function run() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });

  if (!existsSync(CHROME_PATH)) throw new Error(`Chrome not found at ${CHROME_PATH}`);
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

  let serverOutput = '';
  server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,820',
    ],
    defaultViewport: { width: 1280, height: 820, deviceScaleFactor: 1 },
  });

  const browserLog = [];
  const report = {
    status: 'FAILED',
    baseUrl: BASE_URL,
    screenshots: {},
    evidence: {},
    boundary: 'Discovery is proven at active-client enemy creation/materialization, not camera line-of-sight visibility. MP proof is source-level alias/local-creation wiring plus focused unit coverage, not a two-client LAN session.',
  };

  try {
    const ready = await waitForHttp(BASE_URL);
    if (!ready) throw new Error(`Vite server did not become reachable. Output: ${serverOutput.slice(-1000)}`);

    const page = await browser.newPage();
    page.on('console', msg => browserLog.push({ type: msg.type(), text: msg.text() }));
    page.on('pageerror', err => browserLog.push({ type: 'pageerror', text: err.message }));
    await page.evaluateOnNewDocument((key) => {
      window.localStorage.setItem(key, JSON.stringify({ seen: ['grunt'] }));
    }, STORAGE_KEY);

    await page.goto(`${BASE_URL}/?renderer=webgl2&music=false`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await openEnemyTypesFromStart(page);
    report.screenshots.startMenu = await screenshot(page, 'start-menu-enemy-types');
    report.evidence.startMenu = await collectCompendiumState(page);

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 });
    await openEnemyTypesFromStart(page);
    report.evidence.persistenceAfterReload = await collectCompendiumState(page);

    const mobile = await browser.newPage();
    mobile.on('console', msg => browserLog.push({ type: msg.type(), text: msg.text() }));
    mobile.on('pageerror', err => browserLog.push({ type: 'pageerror', text: err.message }));
    await mobile.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 });
    await mobile.evaluateOnNewDocument((key) => {
      window.localStorage.setItem(key, JSON.stringify({ seen: ['grunt'] }));
    }, STORAGE_KEY);
    await mobile.goto(`${BASE_URL}/?renderer=webgl2&music=false`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await openEnemyTypesFromStart(mobile);
    report.screenshots.mobile = await screenshot(mobile, 'mobile-enemy-types');
    report.evidence.mobile = await collectCompendiumState(mobile);
    await mobile.close();

    const game = await browser.newPage();
    game.on('console', msg => browserLog.push({ type: msg.type(), text: msg.text() }));
    game.on('pageerror', err => browserLog.push({ type: 'pageerror', text: err.message }));
    await game.evaluateOnNewDocument((key) => {
      window.localStorage.removeItem(key);
    }, STORAGE_KEY);
    await game.goto(`${BASE_URL}/?quickStart=true&surface=sphere&debug=true&testMode=true&renderer=webgl2&music=false`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await game.waitForSelector('canvas', { timeout: 30_000 });
    await game.waitForSelector('#enemy-discovery-toast.visible [data-enemy-discovery-toast]', { timeout: 20_000 });
    await wait(500);
    report.screenshots.firstSightingToast = await screenshot(game, 'sp-first-sighting-toast');
    report.evidence.firstSightingToast = await game.evaluate((key) => {
      const toast = document.querySelector('#enemy-discovery-toast [data-enemy-discovery-toast]');
      return {
        visible: Boolean(toast),
        type: toast?.getAttribute('data-enemy-discovery-toast') ?? null,
        text: toast?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        previewFrames: toast?.querySelectorAll('.ap-enemy-preview-img').length ?? 0,
        stored: window.localStorage.getItem(key),
      };
    }, STORAGE_KEY);

    await game.keyboard.press('Escape');
    await game.waitForSelector('#pause-menu:not(.hidden) [data-action="enemy-types"]', { timeout: 10_000 });
    await game.click('#pause-menu [data-action="enemy-types"]');
    await game.waitForSelector('#enemy-compendium-screen:not(.hidden)', { timeout: 10_000 });
    await wait(500);
    report.screenshots.pauseMenu = await screenshot(game, 'pause-menu-enemy-types');
    report.evidence.pauseMenu = await collectCompendiumState(game);

    const networkMain = readFileSync(resolve(PROJECT_ROOT, 'src/network-main.ts'), 'utf8');
    report.evidence.mpAliasLocalCreationWiring = {
      mapsBlackholeAlias: networkMain.includes("blackhole: 'gravity_well'"),
      mapsArrowAlias: networkMain.includes("arrow: 'grunt'"),
      marksAfterSpawnerCreation: networkMain.includes('enemyDiscoveryStore.markSeen(type)'),
      enqueuesToast: networkMain.includes('enemyDiscoveryToast.enqueue(type)'),
    };

    const errors = criticalErrors(browserLog);
    report.evidence.criticalErrors = errors;

    const pass = [
      report.evidence.startMenu.visible,
      report.evidence.startMenu.totalEntries >= 40,
      report.evidence.startMenu.grunt?.state === 'seen',
      report.evidence.startMenu.grunt?.previewFrames >= 1,
      report.evidence.startMenu.rocket?.state === 'locked',
      report.evidence.startMenu.rocket?.lockedQuestion === true,
      report.evidence.persistenceAfterReload.grunt?.state === 'seen',
      report.evidence.mobile.rectsInsideViewport,
      report.evidence.mobile.horizontalOverflow === false,
      report.evidence.firstSightingToast.visible,
      report.evidence.firstSightingToast.type,
      report.evidence.firstSightingToast.stored?.includes(report.evidence.firstSightingToast.type),
      report.evidence.pauseMenu.visible,
      report.evidence.mpAliasLocalCreationWiring.mapsBlackholeAlias,
      report.evidence.mpAliasLocalCreationWiring.marksAfterSpawnerCreation,
      errors.length === 0,
    ].every(Boolean);

    report.status = pass ? 'PASS' : 'FAIL';
  } catch (error) {
    report.error = error instanceof Error ? error.stack || error.message : String(error);
    report.status = 'FAIL';
  } finally {
    report.browserLogTail = browserLog.slice(-40);
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    writeFileSync(REPORT_MD_PATH, [
      '# Enemy Compendium Discovery Proof',
      '',
      `- Status: ${report.status}`,
      `- JSON: \`${relative(PROJECT_ROOT, REPORT_PATH)}\``,
      `- Boundary: ${report.boundary}`,
      `- Start menu entries: ${report.evidence.startMenu?.totalEntries ?? 'n/a'}`,
      `- Mobile overflow: ${report.evidence.mobile?.horizontalOverflow ?? 'n/a'}`,
      `- First toast type: ${report.evidence.firstSightingToast?.type ?? 'n/a'}`,
      `- Critical browser errors: ${report.evidence.criticalErrors?.length ?? 'n/a'}`,
      '',
    ].join('\n'));
    await browser.close();
    server.kill('SIGTERM');
  }

  if (report.status !== 'PASS') {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({
      status: report.status,
      report: relative(PROJECT_ROOT, REPORT_PATH),
      markdown: relative(PROJECT_ROOT, REPORT_MD_PATH),
      screenshots: report.screenshots,
    }, null, 2));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
