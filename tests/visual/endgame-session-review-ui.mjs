#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || 3027);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/endgame-session-review-ui');
const REPORT_PATH = resolve(PROJECT_ROOT, 'reports/endgame-session-review-ui-worker-ag-2026-07-31.json');
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/mnt/d/WSL-Caches/home-antoine/.cache/puppeteer/chrome/linux-145.0.7632.46/chrome-linux64/chrome',
  '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);
const CHROME_PATH = CHROME_CANDIDATES.find(path => existsSync(path)) || CHROME_CANDIDATES[0];

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });

  if (!existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}`);
  }

  const env = {
    ...process.env,
    PATH: `${process.env.HOME}/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin`,
  };
  const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
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
      '--window-size=960,720',
    ],
  });

  const report = {
    status: 'FAILED',
    baseUrl: BASE_URL,
    screenshots: {},
    evidence: {},
    boundary: 'Uses real src/main.ts entry path with ?debugEndgameReview=1 fixture logger; does not prove a full manually-played game-over flow or two-client PvP kill production.',
  };

  try {
    const ready = await waitForHttp(BASE_URL);
    if (!ready) {
      throw new Error(`Vite server did not become reachable. Output: ${serverOutput.slice(-1000)}`);
    }

    const page = await browser.newPage();
    page.on('console', msg => {
      const text = msg.text();
      if (/error|warn/i.test(text)) console.log(`[browser] ${msg.type()}: ${text}`);
    });
    await page.setViewport({ width: 960, height: 720, deviceScaleFactor: 1 });
    await page.goto(`${BASE_URL}/?quickStart=true&surface=sphere&debugEndgameReview=1&debug=true&renderer=webgl`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForFunction(() => window.__endgameReviewDebugReady === true, { timeout: 30_000 });
    await page.waitForSelector('#analytics-panel:not(.hidden)', { timeout: 10_000 });
    await wait(900);

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.ap-tab'));
      buttons.find(btn => btn.textContent === 'KILLS')?.click();
    });
    await wait(600);

    const killsScreenshot = resolve(SCREENSHOT_DIR, 'kills-tab-worker-ag-2026-07-31.png');
    await page.screenshot({ path: killsScreenshot, fullPage: false });

    const killsEvidence = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.ap-kill-row'));
      return {
        rowCount: rows.length,
        previewCount: document.querySelectorAll('[data-enemy-preview]').length,
        renderedImageCount: document.querySelectorAll('.ap-enemy-preview-img').length,
        fallbackCount: document.querySelectorAll('.ap-enemy-preview-fallback').length,
        visibleNames: rows.map(row => row.querySelector('.ap-kill-name')?.textContent ?? ''),
        newRosterPreviews: ['prism_lancer', 'sentinel_orb', 'shatter_bloom'].map(type => ({
          type,
          present: Boolean(document.querySelector(`[data-enemy-preview="${type}"]`)),
        })),
      };
    });

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.ap-tab'));
      buttons.find(btn => btn.textContent === 'SCORE GRAPH')?.click();
    });
    await wait(1300);
    const canvasBox = await page.$eval('.sgp-canvas', el => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    await page.mouse.move(canvasBox.left + canvasBox.width * 0.34, canvasBox.top + canvasBox.height * 0.42);
    await wait(250);

    const graphScreenshot = resolve(SCREENSHOT_DIR, 'score-graph-combos-worker-ag-2026-07-31.png');
    await page.screenshot({ path: graphScreenshot, fullPage: false });

    const graphEvidence = await page.evaluate(() => ({
      legendText: Array.from(document.querySelectorAll('.sgp-legend-text')).map(el => el.textContent),
      tooltipText: document.querySelector('.sgp-tooltip')?.textContent ?? '',
      hasCanvas: Boolean(document.querySelector('.sgp-canvas')),
    }));

    report.status = (
      killsEvidence.rowCount >= 6 &&
      killsEvidence.previewCount >= 6 &&
      killsEvidence.newRosterPreviews.every(item => item.present) &&
      graphEvidence.legendText.includes('PvE Combo') &&
      graphEvidence.legendText.includes('PvP Kill') &&
      graphEvidence.hasCanvas
    ) ? 'PASS' : 'FAILED';
    report.screenshots = {
      killsTab: killsScreenshot,
      scoreGraph: graphScreenshot,
    };
    report.evidence = { killsEvidence, graphEvidence };
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify({ report: REPORT_PATH, status: report.status, screenshots: report.screenshots }, null, 2));
  if (report.status !== 'PASS') process.exit(1);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
