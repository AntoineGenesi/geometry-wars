#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { screenshotPixelStats } from './screenshot-pixel-stats.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || process.env.DEV_PORT || 3074);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const PROTOTYPE_ROOT = 'reports/prototypes/menu-ui-redesign-2026-08-07';
const PROOF_DIR = resolve(ROOT, PROTOTYPE_ROOT, 'proof');
const SCREENSHOT_ROOT = resolve(PROOF_DIR, 'screenshots', RUN_ID);
const REPORT_PATH = resolve(PROOF_DIR, `menu-ui-redesign-prototype-proof-${RUN_ID}.json`);

const mockups = [
  '00-current-default-baseline',
  '01-orbital-cartography',
  '02-arcade-cabinet-crt',
  '03-tactical-lan-console',
  '04-kinetic-geometry-gallery',
];

const screens = ['main', 'pause', 'settings', 'sp', 'mp', 'upgrade'];
const viewports = [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'mobile-390x844', width: 390, height: 844, isMobile: true },
];
const previewRequiredScreens = new Set(['main', 'sp', 'mp']);

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
      // retry
    }
    await sleep(350);
  }
  return false;
}

function startVite(logs) {
  const viteBin = findViteBin();
  if (!viteBin) throw new Error(`Missing Vite binary for ${ROOT}`);
  const child = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(PORT)], {
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

async function inspectScreen(page, screen) {
  return page.evaluate((activeScreen, requiresPreview) => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const doc = document.documentElement;
    const active = document.querySelector(`[data-screen="${activeScreen}"]`);
    const activeVisible = Boolean(active && visible(active));
    const horizontalOverflow = doc.scrollWidth - doc.clientWidth;
    const textOverflow = [...document.querySelectorAll('button, .btn, .tile, .surface-btn, .choice, .choice-card, .upgrade-card, .panel')]
      .filter(visible)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
          tag: el.tagName.toLowerCase(),
          className: String(el.className || ''),
          scrollWidth: Math.ceil(el.scrollWidth),
          clientWidth: Math.ceil(el.clientWidth),
          scrollHeight: Math.ceil(el.scrollHeight),
          clientHeight: Math.ceil(el.clientHeight),
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
        };
      })
      .filter((entry) => (
        entry.scrollWidth > entry.clientWidth + 3 ||
        entry.scrollHeight > entry.clientHeight + 12
      ));

    const overlapTargets = [...document.querySelectorAll('button, input, select, .tile, .surface-btn, .choice, .choice-card, .upgrade-card')]
      .filter(visible)
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        return {
          index,
          text: (el.textContent || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 70),
          tag: el.tagName.toLowerCase(),
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
        };
      });
    const overlaps = [];
    for (let i = 0; i < overlapTargets.length; i += 1) {
      for (let j = i + 1; j < overlapTargets.length; j += 1) {
        const a = overlapTargets[i];
        const b = overlapTargets[j];
        const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        const area = ix * iy;
        if (area > 24) overlaps.push({ a: a.text, b: b.text, area: Math.round(area) });
      }
    }

    const previewElements = active ? [...active.querySelectorAll('.map-preview .spin')] : [];
    const animatedPreviews = previewElements.filter((el) => {
      const style = getComputedStyle(el);
      return style.animationName !== 'none' && Number.parseFloat(style.animationDuration) > 0;
    }).length;

    return {
      title: document.title,
      activeVisible,
      horizontalOverflow,
      textOverflow,
      overlaps: overlaps.slice(0, 10),
      animatedPreviews,
      previewRequired: requiresPreview,
    };
  }, screen, previewRequiredScreens.has(screen));
}

async function main() {
  mkdirSync(SCREENSHOT_ROOT, { recursive: true });
  mkdirSync(PROOF_DIR, { recursive: true });

  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome/Chromium executable not found');

  const logs = [];
  const server = startVite(logs);
  let browser;
  const report = {
    status: 'FAILED',
    runId: RUN_ID,
    baseUrl: BASE_URL,
    prototypeRoot: PROTOTYPE_ROOT,
    mockups,
    screens,
    viewports,
    captures: [],
    failures: [],
    logsTail: [],
    proofBoundary: 'Prototype-only HTML/CSS/JS proof. This does not exercise production StartMenu, PauseMenu, SettingsMenu, or BuildChoiceScreen paths.',
  };

  try {
    const ready = await waitForHttp(BASE_URL);
    if (!ready) throw new Error(`Vite did not start. Logs: ${logs.slice(-8).map((line) => line.text).join('\n')}`);

    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1440, height: 900 },
    });

    for (const viewport of viewports) {
      for (const mockup of mockups) {
        for (const screen of screens) {
          const page = await browser.newPage();
          const browserErrors = [];
          page.on('console', (message) => {
            if (message.type() === 'error') browserErrors.push(message.text());
          });
          page.on('pageerror', (error) => browserErrors.push(error.message));
          await page.setViewport({
            width: viewport.width,
            height: viewport.height,
            isMobile: Boolean(viewport.isMobile),
            deviceScaleFactor: 1,
          });
          const url = `${BASE_URL}/${PROTOTYPE_ROOT}/mockups/${mockup}.html#${screen}`;
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
          await page.waitForSelector(`[data-screen="${screen}"].active`, { timeout: 10000 });
          await sleep(350);

          const screenshotDir = resolve(SCREENSHOT_ROOT, mockup, viewport.name);
          mkdirSync(screenshotDir, { recursive: true });
          const screenshotPath = resolve(screenshotDir, `${screen}.png`);
          await page.screenshot({ path: screenshotPath });
          const pixelStats = screenshotPixelStats(screenshotPath);
          const inspection = await inspectScreen(page, screen);

          const capture = {
            mockup,
            screen,
            viewport: viewport.name,
            url,
            screenshot: screenshotPath,
            pixelStats,
            inspection,
            browserErrors,
          };
          report.captures.push(capture);

          if (!pixelStats.nonblank) report.failures.push({ mockup, screen, viewport: viewport.name, reason: 'blank_screenshot', pixelStats });
          if (!inspection.activeVisible) report.failures.push({ mockup, screen, viewport: viewport.name, reason: 'active_screen_not_visible' });
          if (inspection.horizontalOverflow > 2) report.failures.push({ mockup, screen, viewport: viewport.name, reason: 'horizontal_overflow', horizontalOverflow: inspection.horizontalOverflow });
          if (inspection.textOverflow.length > 0) report.failures.push({ mockup, screen, viewport: viewport.name, reason: 'text_or_control_overflow', details: inspection.textOverflow.slice(0, 5) });
          if (inspection.overlaps.length > 0) report.failures.push({ mockup, screen, viewport: viewport.name, reason: 'control_overlap', details: inspection.overlaps.slice(0, 5) });
          if (inspection.previewRequired && inspection.animatedPreviews < 1) report.failures.push({ mockup, screen, viewport: viewport.name, reason: 'missing_animated_map_preview' });
          if (browserErrors.length > 0) report.failures.push({ mockup, screen, viewport: viewport.name, reason: 'critical_browser_errors', browserErrors });

          await page.close();
        }
      }
    }

    report.status = report.failures.length === 0 ? 'PASSED' : 'FAILED';
    report.logsTail = logs.slice(-20);
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    if (report.status !== 'PASSED') {
      throw new Error(`Menu UI redesign prototype proof failed with ${report.failures.length} failure(s). Report: ${REPORT_PATH}`);
    }
    console.log(`PASS menu UI redesign prototype proof`);
    console.log(`runId=${RUN_ID}`);
    console.log(`report=${REPORT_PATH}`);
    console.log(`screenshots=${SCREENSHOT_ROOT}`);
  } finally {
    if (browser) await browser.close();
    stopProcess(server);
    if (report.status !== 'PASSED' && !existsSync(REPORT_PATH)) {
      report.logsTail = logs.slice(-20);
      writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
