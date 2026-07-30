#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3008';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = resolve(ROOT, 'test-screenshots/new-geometric-enemy-roster-sp', runId);
const REPORT_DIR = resolve(ROOT, 'reports');
const ENEMY_TYPES = ['prism_lancer', 'sentinel_orb', 'shatter_bloom'];

function commandPath(command) {
  try {
    return execSync(`command -v ${command}`, { encoding: 'utf-8' }).trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

function findCachedPuppeteerChrome() {
  const cacheRoot = resolve(process.env.HOME || '/home/antoine', '.cache/puppeteer/chrome');
  try {
    return readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('linux-'))
      .map((entry) => resolve(cacheRoot, entry.name, 'chrome-linux64/chrome'))
      .filter((path) => existsSync(path))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

const CHROME_PATH = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  commandPath('google-chrome'),
  commandPath('chromium'),
  commandPath('chromium-browser'),
  ...findCachedPuppeteerChrome(),
].filter(Boolean).find((path) => existsSync(path));

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function waitFor(page, predicate, timeoutMs = 15000, pollMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await sleep(pollMs);
  }
  return null;
}

async function analyzeProjectedBodyPixels(page, sample) {
  return page.evaluate((enemySample) => {
    const canvas = document.querySelector('canvas');
    if (!canvas || !enemySample?.screen) return { ok: false, reason: 'missing canvas/sample' };
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const ctx = tmp.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, reason: 'missing 2d context' };
    ctx.drawImage(canvas, 0, 0);

    const viewportWidth = Math.max(1, window.innerWidth || canvas.clientWidth || canvas.width);
    const viewportHeight = Math.max(1, window.innerHeight || canvas.clientHeight || canvas.height);
    const scaleX = canvas.width / viewportWidth;
    const scaleY = canvas.height / viewportHeight;
    const cx = Math.round(enemySample.screen.x * scaleX);
    const cy = Math.round(enemySample.screen.y * scaleY);

    let brightPixels = 0;
    let maxChannel = 0;
    let maxLuma = 0;
    let samples = 0;
    for (let y = -24; y <= 24; y += 2) {
      for (let x = -24; x <= 24; x += 2) {
        const px = Math.max(0, Math.min(canvas.width - 1, cx + x));
        const py = Math.max(0, Math.min(canvas.height - 1, cy + y));
        const d = ctx.getImageData(px, py, 1, 1).data;
        const luma = d[0] * 0.2126 + d[1] * 0.7152 + d[2] * 0.0722;
        maxChannel = Math.max(maxChannel, d[0], d[1], d[2]);
        maxLuma = Math.max(maxLuma, luma);
        if (luma > 24 || d[0] > 48 || d[1] > 48 || d[2] > 48) brightPixels++;
        samples++;
      }
    }
    return {
      ok: true,
      center: { x: cx, y: cy },
      brightPixels,
      samples,
      brightRatio: samples > 0 ? brightPixels / samples : 0,
      maxChannel,
      maxLuma,
    };
  }, sample);
}

async function main() {
  if (!CHROME_PATH) throw new Error('No Chrome/Chromium executable found');
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

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

  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(text);
  });
  await page.setViewport({ width: 960, height: 720 });

  try {
    const url = `${BASE_URL}?quickStart=true&surface=sphere&debug=true&testMode=true&godMode=true&noDim=true`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });
    const ready = await waitFor(page, () => page.evaluate(() =>
      Boolean(window.__TEST_API?.spawnEnemy && window.__gameDebug?.getEnemyRenderSamples)
    ));
    if (!ready) throw new Error('SP debug APIs were not ready');

    await page.evaluate(() => {
      window.__TEST_API.clearEnemies();
      window.__TEST_API.setPlayerPosition(0.5, 0.52);
      window.__gameDebug.setVisualProofIsolation(false);
    });
    await sleep(500);

    const results = [];
    for (let i = 0; i < ENEMY_TYPES.length; i++) {
      const type = ENEMY_TYPES[i];
      await page.evaluate((enemyType, index) => {
        window.__gameDebug.setVisualProofIsolation(false);
        window.__TEST_API.clearEnemies();
        window.__TEST_API.setPlayerPosition(0.5, 0.52);
        window.__TEST_API.spawnEnemy(enemyType, 0.5 + (index - 1) * 0.035, 0.34);
      }, type, i);
      await sleep(2200);
      const isolation = await page.evaluate(() => window.__gameDebug.setVisualProofIsolation(true, false, false));
      await sleep(500);
      const samples = await page.evaluate(() => window.__gameDebug.getEnemyRenderSamples());
      const matching = samples.find((sample) => sample.type === type);
      const screenshotPath = resolve(ARTIFACT_DIR, `${type}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      const pixelProbe = await analyzeProjectedBodyPixels(page, matching);
      results.push({
        type,
        passed: Boolean(
          matching?.matrixFound
          && matching?.screen?.inView
          && pixelProbe.ok
          && pixelProbe.brightPixels >= 8
          && pixelProbe.maxChannel >= 48
        ),
        screenshotPath,
        isolation,
        renderSample: matching,
        pixelProbe,
      });
    }

    const perfBefore = await page.evaluate(() => window.__TEST_API.getPerformanceProfile());
    await page.evaluate((enemyTypes) => {
      window.__gameDebug.setVisualProofIsolation(false);
      window.__TEST_API.clearEnemies();
      window.__TEST_API.resetPerformanceProfile();
      const cols = 9;
      const rows = 5;
      for (let i = 0; i < cols * rows; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        window.__TEST_API.spawnEnemy(
          enemyTypes[i % enemyTypes.length],
          0.18 + (col / (cols - 1)) * 0.64,
          0.22 + (row / (rows - 1)) * 0.28,
        );
      }
    }, ENEMY_TYPES);
    await sleep(5000);
    const perfAfter = await page.evaluate(() => window.__TEST_API.getPerformanceProfile());
    const perfEnemies = await page.evaluate(() => window.__TEST_API.getEnemies()
      .filter((enemy) => enemy.alive)
      .reduce((counts, enemy) => {
        counts[enemy.type] = (counts[enemy.type] || 0) + 1;
        return counts;
      }, {}));

    const report = {
      verdict: results.every((result) => result.passed) ? 'PASS' : 'FAIL',
      baseUrl: BASE_URL,
      artifactDir: ARTIFACT_DIR,
      screenshots: results.map((result) => result.screenshotPath),
      results,
      mixedWavePerformanceSample: {
        before: perfBefore,
        after: perfAfter,
        enemyCounts: perfEnemies,
      },
      pageErrors: errors,
      proofBoundary: 'SP proof uses real src/main.ts with TestHarnessAPI spawn, enemy-only visual isolation, and no surface/auxiliary objects.',
    };
    const reportPath = resolve(REPORT_DIR, `new-geometric-enemy-roster-sp-${runId}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ verdict: report.verdict, reportPath, artifactDir: ARTIFACT_DIR }, null, 2));
    if (report.verdict !== 'PASS') process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
