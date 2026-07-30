#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, resolve, delimiter } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(arg('port') || 3007);
const OUT_DIR = resolve(ROOT, 'test-screenshots/snake-live-queue');
const REPORT_DIR = resolve(ROOT, 'reports');
const runId = new Date().toISOString().replace(/[:.]/g, '-');

function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function portListening(port) {
  try {
    execSync(`ss -tlnp | rg ':${port}\\b'`, { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function findChrome() {
  const cacheRoot = resolve(process.env.HOME || '/home/antoine', '.cache/puppeteer/chrome');
  return readdirSync(cacheRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('linux-'))
    .map((entry) => resolve(cacheRoot, entry.name, 'chrome-linux64/chrome'))
    .filter((path) => existsSync(path))
    .sort()
    .reverse()[0];
}

async function waitFor(page, predicate, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await page.evaluate(predicate).catch(() => null);
    if (value) return value;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return null;
}

async function waitForHttp(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return false;
}

async function canvasShot(page, name) {
  const file = resolve(OUT_DIR, `${name}-${runId}.png`);
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return canvas instanceof HTMLCanvasElement ? canvas.toDataURL('image/png') : '';
  });
  if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('canvas screenshot failed');
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return file;
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(REPORT_DIR, { recursive: true });

const vite = portListening(PORT)
  ? null
  : spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, PATH: [dirname(process.execPath), process.env.PATH || ''].join(delimiter) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

vite?.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
vite?.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));

const baseUrl = `http://127.0.0.1:${PORT}`;
if (!(await waitForHttp(baseUrl))) {
  vite?.kill('SIGTERM');
  throw new Error(`Vite did not respond on ${baseUrl}`);
}

const chrome = findChrome();
if (!chrome) throw new Error('No cached Puppeteer Chrome found');

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: [
    '--enable-webgl',
    '--use-gl=swiftshader',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ],
});

const page = await browser.newPage();
const consoleMessages = [];
page.on('console', (msg) => {
  consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => {
  consoleMessages.push(`[pageerror] ${err.message}`);
});
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(`${baseUrl}/?quickStart=true&surface=sphere&debug=true&testMode=true&renderer=webgl`, { waitUntil: 'domcontentloaded' });

const debugReady = await waitFor(page, () => !!window.__gameDebug?.getGameState, 45000);
if (!debugReady) {
  const debugProbe = await page.evaluate(() => ({
    href: window.location.href,
    hasDebug: !!window.__gameDebug,
    debugKeys: window.__gameDebug ? Object.keys(window.__gameDebug) : [],
    bodyText: document.body.innerText.slice(0, 500),
  })).catch((error) => ({ error: String(error) }));
  const reportPath = resolve(REPORT_DIR, `snake-live-queue-sp-debug-fail-${runId}.json`);
  writeFileSync(reportPath, JSON.stringify({ debugProbe, consoleMessages }, null, 2));
  await browser.close();
  vite?.kill('SIGTERM');
  throw new Error(`debug API did not initialize; wrote ${reportPath}`);
}

const before = await page.evaluate(() => {
  const debug = window.__gameDebug;
  const getTransform = (u, v) => {
    const point = debug.surface.getPoint(u, v);
    return {
      position: point.position,
      normal: point.normal,
      tangent: point.tangentU,
      bitangent: point.tangentV,
    };
  };
  debug.game.pause();
  debug.enemySpawner.clear();
  const snake = debug.enemySpawner.spawn('snake', 0.52, 0.5, 0, true, 8, 16);
  snake.walker = null;
  for (let i = 0; i < 120; i++) {
    snake.updateBehavior(0.016, debug.player.surfaceU, debug.player.surfaceV);
    snake.applySurfaceTransform(getTransform);
  }
  window.__snakeLiveQueueTarget = snake;
  debug.setVisualProofIsolation(true, false, false);
  return {
    activeEnemyCount: debug.enemySpawner.getActiveCount(),
    snakeSegments: snake.getSegmentData(),
    snakeHealth: snake.health,
  };
});

await new Promise((resolveWait) => setTimeout(resolveWait, 500));
const beforeShot = await canvasShot(page, 'sp-before-head-death');

const after = await page.evaluate(() => {
  const debug = window.__gameDebug;
  const getTransform = (u, v) => {
    const point = debug.surface.getPoint(u, v);
    return {
      position: point.position,
      normal: point.normal,
      tangent: point.tangentU,
      bitangent: point.tangentV,
    };
  };
  const snake = window.__snakeLiveQueueTarget;
  snake.takeDamage(snake.health);
  debug.enemySpawner.update(0.016, debug.player.surfaceU, debug.player.surfaceV);
  for (const enemy of debug.enemySpawner.getEnemies()) {
    if (enemy.active) enemy.applySurfaceTransform(getTransform);
  }
  const active = debug.enemySpawner.getEnemies().filter((enemy) => enemy.active);
  const releasedGrunts = active.filter((enemy) => (enemy.baseTypeName || enemy.constructor.name.toLowerCase()) === 'grunt');
  return {
    activeEnemyCount: debug.enemySpawner.getActiveCount(),
    activeTypes: active.map((enemy) => enemy.baseTypeName || enemy.constructor.name.toLowerCase()),
    released: releasedGrunts.map((enemy) => ({
      type: enemy.baseTypeName || enemy.constructor.name.toLowerCase(),
      health: enemy.health,
      maxHealth: enemy.maxHealth,
      u: enemy.surfacePosition.u,
      v: enemy.surfacePosition.v,
    })),
    snakeStillQueuedSegments: snake.getSegmentData(),
  };
});

await new Promise((resolveWait) => setTimeout(resolveWait, 500));
const afterShot = await canvasShot(page, 'sp-after-head-death-release');

const report = {
  verdict: before.snakeSegments.length >= 10
    && after.snakeStillQueuedSegments.length === 0
    && after.released.length === before.snakeSegments.length
    && after.released.every((enemy) => enemy.type === 'grunt' && enemy.health === 1)
    ? 'PASS'
    : 'FAIL',
  before,
  after,
  screenshots: { before: beforeShot, after: afterShot },
};

const reportPath = resolve(REPORT_DIR, `snake-live-queue-sp-${runId}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));

await browser.close();
vite?.kill('SIGTERM');

console.log(JSON.stringify({ reportPath, verdict: report.verdict, screenshots: report.screenshots }, null, 2));
if (report.verdict !== 'PASS') process.exit(1);
