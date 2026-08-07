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
const REPORT_PATH = resolve(ROOT, 'reports', `hud-visibility-settings-proof-${RUN_ID}.json`);
const SCREENSHOT_DIR = resolve(ROOT, 'test-screenshots/hud-visibility-settings-proof', RUN_ID);

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
  if (!viteBin) throw new Error(`Missing Vite binary for ${ROOT}`);
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
  child.stdout.on('data', (chunk) => logs.push({ stream: 'stdout', text: String(chunk) }));
  child.stderr.on('data', (chunk) => logs.push({ stream: 'stderr', text: String(chunk) }));
  return child;
}

function stopProcess(child) {
  if (!child || child.killed) return;
  try {
    if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
}

async function getHudState(page) {
  return page.evaluate(() => {
    const styleOf = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return { exists: false, display: null, text: null };
      return {
        exists: true,
        display: getComputedStyle(el).display,
        text: el.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      };
    };
    return {
      minimap: styleOf('#minimap'),
      killLog: styleOf('#kill-log'),
      totalKillCounter: styleOf('.total-kill-counter'),
      enemyStreakAnnouncer: styleOf('#enemy-kill-streak-announcer'),
      storage: window.localStorage.getItem('gw3d-hud-visibility-settings'),
      hasTestAnnouncer: Boolean(window.__TEST_KILL_STREAK_ANNOUNCER),
    };
  });
}

async function openGameplaySettings(page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause-menu:not(.hidden) [data-action="settings"]', { timeout: 10000 });
  await page.click('#pause-menu [data-action="settings"]');
  await page.waitForSelector('#settings-menu:not(.hidden)', { timeout: 10000 });
  await page.click('#settings-menu .tab-btn[data-tab="gameplay"]');
  await page.waitForSelector('#toggle-hud-minimap', { timeout: 10000 });
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });

  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome/Chromium executable not found');

  const logs = [];
  const server = startVite(logs);
  const browser = await puppeteer.launch({
    executablePath: chrome,
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
    defaultViewport: { width: 1280, height: 820 },
  });

  const report = {
    status: 'FAILED',
    baseUrl: BASE_URL,
    evidence: {},
    screenshots: {},
    logsTail: [],
    proofBoundary: 'Real src/main.ts SP Settings path proof. MP uses the same HUDVisibilitySettings and SettingsMenu callback in src/network-main.ts, but this script does not run a full LAN/two-client session.',
  };

  try {
    const ready = await waitForHttp(BASE_URL);
    if (!ready) throw new Error(`Vite did not start. Logs: ${logs.slice(-8).map(l => l.text).join('\n')}`);

    const page = await browser.newPage();
    page.on('console', (message) => logs.push({ stream: `console:${message.type()}`, text: message.text() }));
    page.on('pageerror', (error) => logs.push({ stream: 'pageerror', text: error.message }));

    await page.goto(`${BASE_URL}/?quickStart=true&surface=sphere&debug=true&testMode=true&renderer=webgl&music=false`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__gameDebug && window.__TEST_KILL_STREAK_ANNOUNCER), { timeout: 30000 });
    await page.evaluate(() => {
      window.localStorage.removeItem('gw3d-hud-visibility-settings');
      window.__TEST_KILL_STREAK_ANNOUNCER.recordKill();
    });
    await sleep(500);

    const defaultState = await getHudState(page);
    const defaultScreenshot = resolve(SCREENSHOT_DIR, 'sp-hud-default-visible.png');
    await page.screenshot({ path: defaultScreenshot });

    await openGameplaySettings(page);
    const settingsOpenScreenshot = resolve(SCREENSHOT_DIR, 'settings-hud-toggles-visible.png');
    await page.screenshot({ path: settingsOpenScreenshot });
    for (const selector of [
      '#toggle-hud-minimap',
      '#toggle-hud-kill-log',
      '#toggle-hud-total-kills',
      '#toggle-hud-enemy-streaks',
    ]) {
      await page.click(selector);
      await sleep(80);
    }
    await sleep(350);
    const hiddenState = await getHudState(page);
    const hiddenScreenshot = resolve(SCREENSHOT_DIR, 'sp-hud-hidden-live.png');
    await page.screenshot({ path: hiddenScreenshot });

    await page.click('#settings-menu [data-action="close"]');
    await sleep(250);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__gameDebug && window.__TEST_KILL_STREAK_ANNOUNCER), { timeout: 30000 });
    await page.evaluate(() => window.__TEST_KILL_STREAK_ANNOUNCER.recordKill());
    await sleep(500);
    const persistedHiddenState = await getHudState(page);

    await openGameplaySettings(page);
    for (const selector of [
      '#toggle-hud-minimap',
      '#toggle-hud-kill-log',
      '#toggle-hud-total-kills',
      '#toggle-hud-enemy-streaks',
    ]) {
      await page.click(selector);
      await sleep(80);
    }
    await sleep(350);
    await page.click('#settings-menu [data-action="close"]');
    await sleep(250);
    await page.evaluate(() => window.__TEST_KILL_STREAK_ANNOUNCER.recordKill());
    await sleep(500);
    const restoredState = await getHudState(page);
    const restoredScreenshot = resolve(SCREENSHOT_DIR, 'sp-hud-restored-live.png');
    await page.screenshot({ path: restoredScreenshot });

    const hiddenStorage = JSON.parse(hiddenState.storage || '{}');
    const defaultVisible = (
      defaultState.minimap.display !== 'none' &&
      defaultState.killLog.display !== 'none' &&
      defaultState.totalKillCounter.display !== 'none' &&
      defaultState.enemyStreakAnnouncer.display === 'block'
    );
    const hiddenLive = (
      hiddenState.minimap.display === 'none' &&
      hiddenState.killLog.display === 'none' &&
      hiddenState.totalKillCounter.display === 'none' &&
      hiddenState.enemyStreakAnnouncer.display === 'none' &&
      hiddenStorage.minimap === false &&
      hiddenStorage.killLog === false &&
      hiddenStorage.totalKillCounter === false &&
      hiddenStorage.enemyStreakAnnouncements === false
    );
    const hiddenPersisted = (
      persistedHiddenState.minimap.display === 'none' &&
      persistedHiddenState.killLog.display === 'none' &&
      persistedHiddenState.totalKillCounter.display === 'none' &&
      persistedHiddenState.enemyStreakAnnouncer.display === 'none'
    );
    const restoredLive = (
      restoredState.minimap.display !== 'none' &&
      restoredState.killLog.display !== 'none' &&
      restoredState.totalKillCounter.display !== 'none' &&
      restoredState.enemyStreakAnnouncer.display === 'block'
    );

    const screenshotStats = {
      default: screenshotPixelStats(defaultScreenshot),
      settings: screenshotPixelStats(settingsOpenScreenshot),
      hidden: screenshotPixelStats(hiddenScreenshot),
      restored: screenshotPixelStats(restoredScreenshot),
    };

    report.status = (
      defaultVisible &&
      hiddenLive &&
      hiddenPersisted &&
      restoredLive &&
      Object.values(screenshotStats).every((stats) => stats.nonblank)
    ) ? 'PASS' : 'FAILED';
    report.evidence = {
      defaultState,
      hiddenState,
      persistedHiddenState,
      restoredState,
      defaultVisible,
      hiddenLive,
      hiddenPersisted,
      restoredLive,
      screenshotStats,
    };
    report.screenshots = {
      default: defaultScreenshot,
      settingsOpen: settingsOpenScreenshot,
      hidden: hiddenScreenshot,
      restored: restoredScreenshot,
    };
  } finally {
    await browser.close();
    stopProcess(server);
    report.logsTail = logs.slice(-20);
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({
    status: report.status,
    report: relative(ROOT, REPORT_PATH),
    screenshots: Object.fromEntries(
      Object.entries(report.screenshots).map(([key, value]) => [key, relative(ROOT, value)]),
    ),
  }, null, 2));
  if (report.status !== 'PASS') process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
