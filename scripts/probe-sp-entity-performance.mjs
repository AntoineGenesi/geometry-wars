#!/usr/bin/env node

import puppeteer from 'puppeteer';
import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { delimiter, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const valueArg = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const PHASE = valueArg('phase', 'baseline');
const SURFACE = valueArg('surface', 'sphere-tunnel');
const RENDERER = valueArg('renderer', 'webgl');
const SEED = Number(valueArg('seed', '424242'));
const WINDOW_MS = Number(valueArg('windowMs', '5000'));
const NATURAL_SECONDS = Number(valueArg('naturalSeconds', '90'));
const DEV_PORT = Number(valueArg('port', process.env.PORT || '3037'));
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${DEV_PORT}`;
const START_VITE = !process.env.BASE_URL;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_DIR = resolve(ROOT, 'reports', 'sp-entity-performance');
const SCREENSHOT_DIR = resolve(ROOT, 'test-screenshots', 'sp-entity-performance', RUN_ID);
const COUNTS = valueArg('counts', '0,50,100,150').split(',').map(Number).filter(Number.isFinite);
const TYPES = ['grunt', 'wanderer', 'duck', 'mayfly', 'weaver', 'orbiter', 'lurker', 'neutron'];

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function stats(values) {
  if (values.length === 0) return { count: 0, median: 0, p95: 0, p99: 0, max: 0, mean: 0 };
  return {
    count: values.length,
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function commandPath(command) {
  try {
    return execSync(`command -v ${command}`, { encoding: 'utf8' }).trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    commandPath('google-chrome'),
    commandPath('chromium'),
  ].filter(Boolean);
  const cacheRoot = resolve(process.env.HOME || '/home/antoine', '.cache/puppeteer/chrome');
  try {
    candidates.push(...readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('linux-'))
      .map((entry) => resolve(cacheRoot, entry.name, 'chrome-linux64/chrome'))
      .sort().reverse());
  } catch { /* cache is optional */ }
  return candidates.find((candidate) => existsSync(candidate));
}

async function waitForHttp(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch { /* retry */ }
    await sleep(400);
  }
  return false;
}

function startVite() {
  return spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(DEV_PORT)], {
    cwd: ROOT,
    env: { ...process.env, PATH: [dirname(process.execPath), process.env.PATH || ''].join(delimiter) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function makeUrl(testArena) {
  const params = new URLSearchParams({
    quickStart: 'true',
    surface: SURFACE,
    gameMode: 'waves',
    debug: 'true',
    testMode: 'true',
    godMode: 'true',
    seed: String(SEED),
  });
  if (testArena) params.set('testArena', 'true');
  if (RENDERER !== 'auto') params.set('renderer', RENDERER);
  return `${BASE_URL}/?${params.toString()}`;
}

async function waitForGame(page) {
  await page.waitForFunction(() => (
    window.__TEST_API?.spawnEnemy
      && window.__gameDebug?.getEnemyRenderSamples
      && window.__gameDebug?.captureTargetIsolatedBody
      && window.__GAME_TELEMETRY
  ), { timeout: 30000 });
  await sleep(1000);
}

async function setControlledEnemies(page, count) {
  return page.evaluate((targetCount, types) => {
    const api = window.__TEST_API;
    api.clearEnemies();
    const spawner = api.ctx?.enemySpawner;
    spawner?.setMaxActiveEnemies?.(400);
    const cols = Math.max(1, Math.ceil(Math.sqrt(targetCount * 2)));
    const rows = Math.max(1, Math.ceil(targetCount / cols));
    for (let i = 0; i < targetCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const u = 0.08 + (col / Math.max(1, cols - 1)) * 0.84;
      const v = 0.08 + (row / Math.max(1, rows - 1)) * 0.84;
      api.spawnEnemy(types[i % types.length], u, v);
    }
    return api.getEnemies().length;
  }, count, TYPES);
}

async function measureWindow(page, label) {
  await page.evaluate(() => {
    window.__TEST_API?.resetPerformanceProfile?.();
    window.__GW_RENDER_FRAME_CAPTURE = { enabled: true, maxFrames: 2000, frames: [] };
  });
  const memoryBefore = await page.metrics();
  await sleep(WINDOW_MS);
  const memoryAfter = await page.metrics();
  const raw = await page.evaluate(() => {
    const capture = window.__GW_RENDER_FRAME_CAPTURE;
    capture.enabled = false;
    const renderSamples = window.__gameDebug.getEnemyRenderSamples();
    const telemetry = window.__GAME_TELEMETRY;
    return {
      frames: capture.frames || [],
      fixedProfile: window.__TEST_API?.getPerformanceProfile?.() || null,
      renderer: window.__gameDebug.getRendererInfo(),
      enemyCount: renderSamples.length,
      typeCounts: renderSamples.reduce((out, enemy) => {
        out[enemy.type] = (out[enemy.type] || 0) + 1;
        return out;
      }, {}),
      visibilityCounts: renderSamples.reduce((out, enemy) => {
        const classification = enemy.isMaterializing
          ? 'materializing'
          : String(enemy.type).toLowerCase().includes('phaser')
            ? 'phaser-ghost'
            : enemy.surfaceVisibility?.className || 'unclassified';
        out[classification] = (out[classification] || 0) + 1;
        return out;
      }, {}),
      lodCounts: renderSamples.reduce((out, enemy) => {
        out[enemy.lodLevel] = (out[enemy.lodLevel] || 0) + 1;
        return out;
      }, {}),
      activeBullets: telemetry?.bullets?.length ?? 0,
      activeEffects: telemetry?.particles?.active ?? telemetry?.effects ?? null,
      telemetryFrame: telemetry?.frame ?? null,
      quality: window.__perfLog?.getLiveData?.().at?.(-1)?.qualityLevel ?? null,
      surfaceVisibilityStats: window.__surfaceVisibilityStats || null,
      instanceDebug: window.__gameDebug.getEnemyInstanceDebug(),
    };
  });

  const intervals = raw.frames.slice(1).map((frame, index) => frame.rafTimestamp - raw.frames[index].rafTimestamp);
  const elapsed = raw.frames.length > 1
    ? raw.frames.at(-1).rafTimestamp - raw.frames[0].rafTimestamp
    : 0;
  const scopeValues = new Map();
  for (const frame of raw.frames) {
    for (const scope of frame.scopes || []) {
      if (!scopeValues.has(scope.name)) scopeValues.set(scope.name, []);
      scopeValues.get(scope.name).push(scope.totalMs);
    }
  }
  const scopes = [...scopeValues.entries()]
    .map(([name, values]) => ({ name, ...stats(values) }))
    .sort((a, b) => b.mean - a.mean);

  return {
    label,
    ...raw,
    frames: undefined,
    renderedFrames: raw.frames.length,
    renderedFps: elapsed > 0 ? ((raw.frames.length - 1) * 1000) / elapsed : 0,
    frameDurationMs: stats(intervals),
    callbackMs: stats(raw.frames.map((frame) => frame.callbackMs)),
    updateMs: stats(raw.frames.map((frame) => frame.updateMs)),
    preRenderMs: stats(raw.frames.map((frame) => frame.preRenderMs)),
    rendererCallMs: stats(raw.frames.map((frame) => frame.rendererCallMs)),
    scopes,
    memory: {
      jsHeapUsedBefore: memoryBefore.JSHeapUsedSize,
      jsHeapUsedAfter: memoryAfter.JSHeapUsedSize,
      jsHeapDelta: memoryAfter.JSHeapUsedSize - memoryBefore.JSHeapUsedSize,
      nodesBefore: memoryBefore.Nodes,
      nodesAfter: memoryAfter.Nodes,
    },
  };
}

async function compareTargetPixels(page, hiddenDataUrl, targetDataUrl, sample) {
  return page.evaluate(async ({ hiddenUrl, targetUrl, targetSample }) => {
    const load = async (url) => createImageBitmap(await (await fetch(url)).blob());
    const [hidden, target] = await Promise.all([load(hiddenUrl), load(targetUrl)]);
    const canvas = document.createElement('canvas');
    canvas.width = hidden.width;
    canvas.height = hidden.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(hidden, 0, 0);
    const hiddenData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(target, 0, 0);
    const targetData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const sx = canvas.width / Math.max(1, window.innerWidth);
    const sy = canvas.height / Math.max(1, window.innerHeight);
    const cx = Math.round(targetSample.screen.x * sx);
    const cy = Math.round(targetSample.screen.y * sy);
    let changedPixels = 0;
    let targetPixels = 0;
    let maxRgbDelta = 0;
    let totalRgbDelta = 0;
    const radius = 20;
    for (let y = Math.max(0, cy - radius); y <= Math.min(canvas.height - 1, cy + radius); y++) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(canvas.width - 1, cx + radius); x++) {
        const offset = (y * canvas.width + x) * 4;
        const delta = Math.abs(targetData[offset] - hiddenData[offset])
          + Math.abs(targetData[offset + 1] - hiddenData[offset + 1])
          + Math.abs(targetData[offset + 2] - hiddenData[offset + 2]);
        maxRgbDelta = Math.max(maxRgbDelta, delta);
        totalRgbDelta += delta;
        if (delta >= 30) changedPixels++;
        if (Math.max(targetData[offset], targetData[offset + 1], targetData[offset + 2]) >= 35) targetPixels++;
      }
    }
    hidden.close();
    target.close();
    return {
      crop: { cx, cy, radius, width: canvas.width, height: canvas.height },
      changedPixels,
      targetPixels,
      maxRgbDelta,
      totalRgbDelta,
      passed: changedPixels >= 4 && maxRgbDelta >= 60,
    };
  }, { hiddenUrl: hiddenDataUrl, targetUrl: targetDataUrl, targetSample: sample });
}

async function captureBodyProof(page, label, maxTargets = 16) {
  await page.evaluate(() => window.__gameDebug.pause());
  await sleep(50);
  const candidates = await page.evaluate(() => window.__gameDebug.getEnemyRenderSamples()
    .filter((enemy) => enemy.isAlive !== false && enemy.screen?.inView)
    .map((enemy) => ({
      id: enemy.id,
      type: enemy.type,
      isMaterializing: enemy.isMaterializing,
      surfaceVisibility: enemy.surfaceVisibility,
      screen: enemy.screen,
      opacity: enemy.opacity,
      colorBrightness: enemy.colorBrightness,
      matrixFound: enemy.matrixFound,
      instanceMatrixScale: enemy.instanceMatrixScale,
      renderBatch: enemy.renderBatch,
      lodLevel: enemy.lodLevel,
    })));
  const classified = candidates.map((enemy) => ({
    ...enemy,
    intentionalClass: enemy.isMaterializing
      ? 'materializing'
      : String(enemy.type).toLowerCase().includes('phaser')
        ? 'phaser-ghost'
        : enemy.surfaceVisibility?.className === 'opaque-hidden'
          ? 'opaque-hidden'
          : null,
  }));
  const eligible = classified.filter((enemy) => !enemy.intentionalClass);
  const selected = [];
  const seenTypes = new Set();
  for (const enemy of eligible) {
    if (!seenTypes.has(enemy.type)) {
      selected.push(enemy);
      seenTypes.add(enemy.type);
    }
  }
  for (const enemy of eligible) {
    if (selected.length >= maxTargets) break;
    if (!selected.includes(enemy)) selected.push(enemy);
  }

  const results = [];
  let savedPair = false;
  try {
    for (const target of selected.slice(0, maxTargets)) {
      const pair = await page.evaluate((targetId) => ({
        hidden: window.__gameDebug.captureTargetIsolatedBody(targetId, false),
        target: window.__gameDebug.captureTargetIsolatedBody(targetId, true),
      }), target.id);
      if (!pair.hidden.ok || !pair.target.ok) {
        results.push({ ...target, passed: false, reason: 'capture failed' });
        continue;
      }
      const captureSample = pair.target.sample || target;
      const delta = await compareTargetPixels(page, pair.hidden.dataUrl, pair.target.dataUrl, captureSample);
      const shouldSave = !savedPair || !delta.passed;
      let hiddenScreenshot = null;
      let targetScreenshot = null;
      if (shouldSave) {
        const safeId = target.id.replace(/[^a-zA-Z0-9_-]/g, '_');
        hiddenScreenshot = resolve(SCREENSHOT_DIR, `${label}-${safeId}-target-hidden.png`);
        targetScreenshot = resolve(SCREENSHOT_DIR, `${label}-${safeId}-target-only.png`);
        writeFileSync(hiddenScreenshot, Buffer.from(pair.hidden.dataUrl.split(',')[1], 'base64'));
        writeFileSync(targetScreenshot, Buffer.from(pair.target.dataUrl.split(',')[1], 'base64'));
        savedPair = true;
      }
      results.push({ ...target, captureSample, ...delta, hiddenScreenshot, targetScreenshot });
    }
    return {
      label,
      candidateCount: classified.length,
      eligibleCount: eligible.length,
      intentionalCounts: classified.reduce((out, enemy) => {
        if (enemy.intentionalClass) out[enemy.intentionalClass] = (out[enemy.intentionalClass] || 0) + 1;
        return out;
      }, {}),
      sampled: results.length,
      passed: results.length > 0 && results.every((result) => result.passed),
      results,
    };
  } finally {
    await page.evaluate(() => window.__gameDebug.resume());
  }
}

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true });
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const owned = [];
  const vite = START_VITE ? startVite() : null;
  if (vite) owned.push(vite);
  if (!await waitForHttp(BASE_URL)) throw new Error(`Vite unavailable at ${BASE_URL}`);

  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome executable not found');
  const profileDir = mkdtempSync(resolve(tmpdir(), 'gw-sp-entity-perf-'));
  let browser;
  const errors = [];
  const consoleTail = [];
  try {
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      userDataDir: profileDir,
      args: [
        '--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--enable-precise-memory-info',
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--window-size=800,600', '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      consoleTail.push(`[${message.type()}] ${message.text()}`);
      if (consoleTail.length > 200) consoleTail.shift();
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('gw3d-graphics-settings', JSON.stringify({
        qualityPreset: 'custom', bloomEnabled: true, bloomStrength: 1,
        particleCount: 2000, trailEffects: true, maxEnemies: 500,
        resolutionScale: 1, surfaceOpaque: false, surfaceOpacity: 0.05,
        surfaceColor: 0x141440, enable90DegreeHide: false,
      }));
    });

    await page.goto(makeUrl(true), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForGame(page);
    const ladder = [];
    let bodyProof = null;
    for (const count of COUNTS) {
      const spawned = await setControlledEnemies(page, count);
      await sleep(1500);
      const measurement = await measureWindow(page, `controlled-${count}`);
      ladder.push({ requestedEnemies: count, spawned, ...measurement });
      if (count === Math.max(...COUNTS)) bodyProof = await captureBodyProof(page, `controlled-${count}`);
    }

    let natural = null;
    if (NATURAL_SECONDS > 0) {
      await page.goto(makeUrl(false), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForGame(page);
      const start = Date.now();
      let peakEnemies = 0;
      while (Date.now() - start < NATURAL_SECONDS * 1000) {
        const count = await page.evaluate(() => window.__gameDebug.getEnemyRenderSamples().length).catch(() => 0);
        peakEnemies = Math.max(peakEnemies, count);
        if (count >= 140) break;
        await sleep(1000);
      }
      natural = await measureWindow(page, 'natural-wave-pressure');
      natural.peakEnemiesBeforeWindow = peakEnemies;
      natural.bodyProof = await captureBodyProof(page, 'natural-wave-pressure', 12);
    }

    const criticalErrors = errors.filter((error) => !/AudioContext|favicon|404|Failed to load resource/.test(error));
    const report = {
      kind: 'sp-entity-performance-proof',
      phase: PHASE,
      runId: RUN_ID,
      surface: SURFACE,
      seed: SEED,
      requestedRenderer: RENDERER,
      controlledUrl: makeUrl(true),
      naturalUrl: makeUrl(false),
      windowMs: WINDOW_MS,
      naturalSeconds: NATURAL_SECONDS,
      browser: { executablePath: chrome, headless: true, swiftShader: true },
      ladder,
      controlledBodyProof: bodyProof,
      natural,
      criticalErrors,
      errors,
      consoleTail,
    };
    const reportPath = resolve(REPORT_DIR, `${PHASE}-${SURFACE}-${RUN_ID}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      reportPath,
      ladder: ladder.map((entry) => ({
        enemies: entry.enemyCount,
        fps: entry.renderedFps,
        p95: entry.frameDurationMs.p95,
        p99: entry.frameDurationMs.p99,
        max: entry.frameDurationMs.max,
        callback: entry.callbackMs.mean,
        update: entry.updateMs.mean,
        preRender: entry.preRenderMs.mean,
        renderer: entry.rendererCallMs.mean,
        heapDelta: entry.memory.jsHeapDelta,
        topScopes: entry.scopes.slice(0, 6).map((scope) => [scope.name, scope.mean]),
      })),
      bodyProof: bodyProof && { sampled: bodyProof.sampled, passed: bodyProof.passed },
      natural: natural && { enemies: natural.enemyCount, peak: natural.peakEnemiesBeforeWindow, fps: natural.renderedFps, p95: natural.frameDurationMs.p95, bodyProof: natural.bodyProof?.passed },
      criticalErrors,
    }, null, 2));
    if (criticalErrors.length > 0 || !bodyProof?.passed || (natural && !natural.bodyProof?.passed)) process.exitCode = 1;
  } finally {
    await browser?.close?.().catch(() => {});
    rmSync(profileDir, { recursive: true, force: true });
    for (const proc of owned.reverse()) {
      proc.kill('SIGTERM');
      proc.stdout?.destroy();
      proc.stderr?.destroy();
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
