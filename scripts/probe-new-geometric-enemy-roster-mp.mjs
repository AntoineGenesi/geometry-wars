#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3008';
const COLYSEUS_PORT = Number(process.env.COLYSEUS_PORT || '2567');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = resolve(ROOT, 'test-screenshots/new-geometric-enemy-roster-mp', runId);
const REPORT_DIR = resolve(ROOT, 'reports');
const TARGET_TYPES = ['prism_lancer', 'sentinel_orb', 'shatter_bloom'];

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

function countTypes(enemies) {
  return enemies.reduce((counts, enemy) => {
    counts[enemy.type] = (counts[enemy.type] || 0) + 1;
    return counts;
  }, {});
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
    let samples = 0;
    for (let y = -22; y <= 22; y += 2) {
      for (let x = -22; x <= 22; x += 2) {
        const px = Math.max(0, Math.min(canvas.width - 1, cx + x));
        const py = Math.max(0, Math.min(canvas.height - 1, cy + y));
        const d = ctx.getImageData(px, py, 1, 1).data;
        const luma = d[0] * 0.2126 + d[1] * 0.7152 + d[2] * 0.0722;
        maxChannel = Math.max(maxChannel, d[0], d[1], d[2]);
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
    };
  }, sample);
}

async function runScenario(browser, scenario) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') errors.push(text);
  });
  await page.setViewport({ width: 960, height: 720 });

  try {
    const params = new URLSearchParams({
      mode: 'network',
      surface: 'sphere',
      server: `ws://localhost:${COLYSEUS_PORT}`,
      debug: 'true',
      testMode: 'true',
      debugVisibility: 'true',
      godMode: 'true',
      gameMode: 'pvpve',
      pvpMode: 'pvpve',
      name: 'WorkerAC',
      testDifficultyMultiplier: '2',
      testEnemySpawnRateMultiplier: '3',
      testEnemyCountCap: '100',
      testStartWave: String(scenario.startWave),
    });
    await page.goto(`${BASE_URL}?${params.toString()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });

    const connected = await waitFor(page, () => page.evaluate(() =>
      Boolean(window.__gameDebug?.isConnected?.() && window.__gameDebug?.getPlayerCount?.() >= 1)
    ), 25000);
    if (!connected) throw new Error('MP browser did not connect to the Colyseus room');

    const started = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const start = buttons.find((button) => (button.textContent || '').includes('START GAME'));
      if (!start) return false;
      start.click();
      return true;
    });
    if (!started) throw new Error('Could not find START GAME button in MP lobby');

    const pvpveReady = await waitFor(page, () => page.evaluate(() =>
      window.__GAME_TELEMETRY?.gameMode === 'pvpve' && window.__GAME_TELEMETRY?.pvpMode === 'pvpve'
    ), 15000);
    if (!pvpveReady) throw new Error('MP room did not enter PvPvE mode');

    const observations = [];
    const deadline = Date.now() + 45000;
    let covered = new Set();
    while (Date.now() < deadline && covered.size < scenario.targets.length) {
      await sleep(2000);
      const state = await page.evaluate(() => ({
        telemetry: window.__GAME_TELEMETRY || null,
        enemies: window.__gameDebug?.getEnemies?.() || [],
        renderSamples: window.__gameDebug?.getEnemyRenderSamples?.() || [],
      }));
      const typeCounts = countTypes(state.enemies);
      for (const type of scenario.targets) {
        if (typeCounts[type] > 0) covered.add(type);
      }
      observations.push({
        atMs: Date.now(),
        waveNumber: state.telemetry?.waveNumber ?? null,
        gameTime: state.telemetry?.time ?? null,
        gameMode: state.telemetry?.gameMode ?? null,
        pvpMode: state.telemetry?.pvpMode ?? null,
        enemyCount: state.enemies.length,
        typeCounts,
      });
    }

    await page.evaluate(() => window.__gameDebug.setVisualProofIsolation(true, false, false));
    await sleep(700);
    const renderSamples = await page.evaluate(() => window.__gameDebug.getEnemyRenderSamples());
    const samplesByType = {};
    const pixelProbes = {};
    const screenshots = [];
    for (const type of scenario.targets) {
      const sample = renderSamples.find((entry) => entry.type === type && entry.screen?.inView)
        || renderSamples.find((entry) => entry.type === type);
      samplesByType[type] = sample || null;
      if (sample) pixelProbes[type] = await analyzeProjectedBodyPixels(page, sample);
    }
    const screenshotPath = resolve(ARTIFACT_DIR, `${scenario.label}-isolated.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    screenshots.push(screenshotPath);

    const finalState = await page.evaluate(() => ({
      telemetry: window.__GAME_TELEMETRY || null,
      enemies: window.__gameDebug?.getEnemies?.() || [],
      renderSamples: window.__gameDebug?.getEnemyRenderSamples?.() || [],
    }));
    const finalTypeCounts = countTypes(finalState.enemies);
    const proofResults = scenario.targets.map((type) => ({
      type,
      serverStatePresent: finalTypeCounts[type] > 0 || observations.some((obs) => (obs.typeCounts[type] || 0) > 0),
      renderSamplePresent: Boolean(samplesByType[type]),
      bodyPixelsVisible: Boolean(pixelProbes[type]?.ok && pixelProbes[type].brightPixels >= 6 && pixelProbes[type].maxChannel >= 48),
      sample: samplesByType[type],
      pixelProbe: pixelProbes[type] || null,
    }));
    return {
      label: scenario.label,
      startWave: scenario.startWave,
      targets: scenario.targets,
      passed: proofResults.every((result) => result.serverStatePresent && result.renderSamplePresent && result.bodyPixelsVisible),
      screenshots,
      baseUrl: BASE_URL,
      colyseusPort: COLYSEUS_PORT,
      proofResults,
      observations,
      finalTypeCounts,
      finalTelemetry: finalState.telemetry,
      pageErrors: errors,
    };
  } finally {
    await page.close().catch(() => {});
    await sleep(1500);
  }
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
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });

  try {
    const scenarios = [
      { label: 'wave12-prism-lancer', startWave: 11, targets: ['prism_lancer'] },
      { label: 'wave13-sentinel-shatter', startWave: 12, targets: ['sentinel_orb', 'shatter_bloom'] },
    ];
    const scenarioResults = [];
    for (const scenario of scenarios) {
      scenarioResults.push(await runScenario(browser, scenario));
    }
    const proofResults = TARGET_TYPES.map((type) => {
      const scenario = scenarioResults.find((result) => result.proofResults.some((proof) => proof.type === type));
      return scenario?.proofResults.find((proof) => proof.type === type) || {
        type,
        serverStatePresent: false,
        renderSamplePresent: false,
        bodyPixelsVisible: false,
        sample: null,
        pixelProbe: null,
      };
    });
    const report = {
      verdict: proofResults.every((result) => result.serverStatePresent && result.renderSamplePresent && result.bodyPixelsVisible)
        ? 'PASS'
        : 'FAIL',
      baseUrl: BASE_URL,
      colyseusPort: COLYSEUS_PORT,
      artifactDir: ARTIFACT_DIR,
      screenshots: scenarioResults.flatMap((result) => result.screenshots),
      proofResults,
      scenarioResults,
      proofBoundary: 'MP proof uses one browser process with sequential solo PvPvE rooms connected to real Colyseus; enemy bodies are client render objects created from server wave state and isolated with surface/auxiliary objects hidden. The server must be started with GEOMETRY_WARS_MP_PROOF_CONTROLS=1 so testMode late-wave controls are explicitly opt-in. Two start waves are used because solo MP caps live enemies at 60, which prevents the later prism group and the sentinel/shatter group from appearing in the same bounded wave.',
    };
    const reportPath = resolve(REPORT_DIR, `new-geometric-enemy-roster-mp-${runId}.json`);
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
