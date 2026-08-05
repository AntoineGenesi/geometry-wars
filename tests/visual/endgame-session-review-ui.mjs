#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || 3027);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/endgame-session-review-ui');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/endgame-session-review-ui-redo-${RUN_ID}.json`);
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
  const viteBin = findUp('node_modules/vite/bin/vite.js');
  const serverCommand = viteBin ? process.execPath : 'npm';
  const serverArgs = viteBin
    ? [viteBin, '--host', '127.0.0.1', '--port', String(PORT)]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT)];
  const server = spawn(serverCommand, serverArgs, {
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

    const killsScreenshot = resolve(SCREENSHOT_DIR, `kills-tab-redo-${RUN_ID}.png`);
    await page.screenshot({ path: killsScreenshot, fullPage: false });

    const killsEvidence = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.ap-kill-row'));
      const previews = Array.from(document.querySelectorAll('[data-enemy-preview]'));
      return {
        rowCount: rows.length,
        previewCount: previews.length,
        renderedImageCount: document.querySelectorAll('.ap-enemy-preview-img').length,
        fallbackCount: document.querySelectorAll('.ap-enemy-preview-fallback').length,
        visibleNames: rows.map(row => row.querySelector('.ap-kill-name')?.textContent ?? ''),
        newRosterPreviews: ['prism_lancer', 'sentinel_orb', 'shatter_bloom'].map(type => ({
          type,
          present: Boolean(document.querySelector(`[data-enemy-preview="${type}"]`)),
        })),
        frameCounts: previews.map(preview => ({
          type: preview.getAttribute('data-enemy-preview'),
          frameCount: Number(preview.getAttribute('data-enemy-preview-frames') ?? '0'),
          uniqueFrameCount: new Set(Array.from(preview.querySelectorAll('img')).map(img => img.getAttribute('src'))).size,
        })),
      };
    });
    const previewAnimationBefore = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('[data-enemy-preview] .ap-enemy-preview-frame'));
      return frames.slice(0, 8).map(frame => getComputedStyle(frame).opacity);
    });
    await wait(800);
    const previewAnimationAfter = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('[data-enemy-preview] .ap-enemy-preview-frame'));
      return frames.slice(0, 8).map(frame => getComputedStyle(frame).opacity);
    });
    const killsSecondScreenshot = resolve(SCREENSHOT_DIR, `kills-tab-redo-animated-${RUN_ID}.png`);
    await page.screenshot({ path: killsSecondScreenshot, fullPage: false });

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

    const graphScreenshot = resolve(SCREENSHOT_DIR, `score-graph-combos-redo-${RUN_ID}.png`);
    await page.screenshot({ path: graphScreenshot, fullPage: false });

    const graphEvidence = await page.evaluate(() => ({
      legendText: Array.from(document.querySelectorAll('.sgp-legend-text')).map(el => el.textContent),
      tooltipText: document.querySelector('.sgp-tooltip')?.textContent ?? '',
      hasCanvas: Boolean(document.querySelector('.sgp-canvas')),
    }));

    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('.sgp-toggle-btn'));
      buttons.find(btn => btn.textContent === 'KILLS')?.click();
      buttons.find(btn => btn.textContent === 'BY TYPE')?.click();
    });
    await wait(900);

    const byTypeScreenshot = resolve(SCREENSHOT_DIR, `score-graph-by-type-redo-${RUN_ID}.png`);
    await page.screenshot({ path: byTypeScreenshot, fullPage: false });

    const byTypeEvidence = await page.evaluate(() => {
      const entries = Array.from(document.querySelectorAll('.sgp-legend-entry-by-type'));
      return {
        entryCount: entries.length,
        previewCount: document.querySelectorAll('.sgp-legend-entry-by-type [data-enemy-preview]').length,
        swatchCount: document.querySelectorAll('.sgp-legend-swatch').length,
        legendText: entries.map(entry => entry.querySelector('.sgp-legend-text')?.textContent ?? ''),
        frameCounts: entries.map(entry => {
          const preview = entry.querySelector('[data-enemy-preview]');
          return {
            type: preview?.getAttribute('data-enemy-preview') ?? 'none',
            frameCount: Number(preview?.getAttribute('data-enemy-preview-frames') ?? '0'),
          };
        }),
      };
    });

    const byTypeCanvasBox = await page.$eval('.sgp-canvas', el => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    const zoomBefore = await page.$eval('.sgp-wrapper', el => ({
      start: el.getAttribute('data-zoom-start'),
      end: el.getAttribute('data-zoom-end'),
    }));
    await page.mouse.move(byTypeCanvasBox.left + byTypeCanvasBox.width * 0.22, byTypeCanvasBox.top + byTypeCanvasBox.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(byTypeCanvasBox.left + byTypeCanvasBox.width * 0.74, byTypeCanvasBox.top + byTypeCanvasBox.height * 0.48, { steps: 8 });
    await page.mouse.up();
    await wait(350);
    const zoomAfterDrag = await page.$eval('.sgp-wrapper', el => ({
      start: el.getAttribute('data-zoom-start'),
      end: el.getAttribute('data-zoom-end'),
      resetDisplay: getComputedStyle(document.querySelector('.sgp-zoom-reset')).display,
    }));
    await page.evaluate(() => document.querySelector('.sgp-zoom-reset')?.click());
    await wait(250);
    const zoomAfterReset = await page.$eval('.sgp-wrapper', el => ({
      start: el.getAttribute('data-zoom-start'),
      end: el.getAttribute('data-zoom-end'),
      resetDisplay: getComputedStyle(document.querySelector('.sgp-zoom-reset')).display,
    }));
    const dragScreenshot = resolve(SCREENSHOT_DIR, `score-graph-drag-reset-redo-${RUN_ID}.png`);
    await page.screenshot({ path: dragScreenshot, fullPage: false });

    const previewFramesAreDistinct = killsEvidence.frameCounts
      .filter(item => item.frameCount > 0)
      .every(item => item.frameCount >= 8 && item.uniqueFrameCount >= 4);
    const previewAnimationAdvanced = JSON.stringify(previewAnimationBefore) !== JSON.stringify(previewAnimationAfter);
    const byTypeHasModelLegend = (
      byTypeEvidence.entryCount >= 4 &&
      byTypeEvidence.previewCount >= 4 &&
      byTypeEvidence.swatchCount >= byTypeEvidence.entryCount &&
      byTypeEvidence.frameCounts.filter(item => item.frameCount >= 8).length >= 4
    );
    const dragZoomWorked = (
      zoomBefore.start === '0.0000' &&
      zoomBefore.end === '1.0000' &&
      zoomAfterDrag.start !== zoomBefore.start &&
      zoomAfterDrag.end !== zoomBefore.end &&
      zoomAfterDrag.resetDisplay !== 'none' &&
      zoomAfterReset.start === '0.0000' &&
      zoomAfterReset.end === '1.0000' &&
      zoomAfterReset.resetDisplay === 'none'
    );

    report.status = (
      killsEvidence.rowCount >= 6 &&
      killsEvidence.previewCount >= 6 &&
      killsEvidence.newRosterPreviews.every(item => item.present) &&
      previewFramesAreDistinct &&
      previewAnimationAdvanced &&
      graphEvidence.legendText.includes('PvE Combo') &&
      graphEvidence.legendText.includes('PvP Kill') &&
      graphEvidence.hasCanvas &&
      byTypeHasModelLegend &&
      dragZoomWorked
    ) ? 'PASS' : 'FAILED';
    report.screenshots = {
      killsTab: killsScreenshot,
      killsTabAnimated: killsSecondScreenshot,
      scoreGraph: graphScreenshot,
      scoreGraphByType: byTypeScreenshot,
      scoreGraphDragReset: dragScreenshot,
    };
    report.evidence = {
      killsEvidence,
      previewAnimationBefore,
      previewAnimationAfter,
      graphEvidence,
      byTypeEvidence,
      zoomBefore,
      zoomAfterDrag,
      zoomAfterReset,
      previewFramesAreDistinct,
      previewAnimationAdvanced,
      byTypeHasModelLegend,
      dragZoomWorked,
    };
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
