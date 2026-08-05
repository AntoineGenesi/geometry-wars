#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, resolve, delimiter } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(arg('port') || 3037);
const OUT_DIR = resolve(ROOT, 'test-screenshots/snake-segment-visual-formation');
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

function findUp(relativePath) {
  let current = ROOT;
  for (;;) {
    const candidate = resolve(current, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
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
  : spawn(process.execPath, [findUp('node_modules/vite/bin/vite.js') ?? 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(PORT)], {
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
if (!chrome) {
  vite?.kill('SIGTERM');
  throw new Error('No cached Puppeteer Chrome found');
}

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
await page.goto(`${baseUrl}/?quickStart=true&surface=sphere&debug=true&testMode=true&renderer=webgl&music=false`, {
  waitUntil: 'domcontentloaded',
});

const debugReady = await waitFor(page, () => !!window.__gameDebug?.enemySpawner && !!window.__gameDebug?.surface, 45000);
if (!debugReady) {
  const debugProbe = await page.evaluate(() => ({
    href: window.location.href,
    hasDebug: !!window.__gameDebug,
    debugKeys: window.__gameDebug ? Object.keys(window.__gameDebug) : [],
    bodyText: document.body.innerText.slice(0, 500),
  })).catch((error) => ({ error: String(error) }));
  const reportPath = resolve(REPORT_DIR, `snake-segment-visual-formation-sp-debug-fail-${runId}.json`);
  writeFileSync(reportPath, JSON.stringify({ debugProbe, consoleMessages }, null, 2));
  await browser.close();
  vite?.kill('SIGTERM');
  throw new Error(`debug API did not initialize; wrote ${reportPath}`);
}

const formation = await page.evaluate(() => {
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
  const collectColors = (root) => {
    const colors = [];
    root.traverse((child) => {
      const material = child.material;
      if (!material) return;
      const materials = Array.isArray(material) ? material : [material];
      for (const item of materials) {
        if (item?.color?.getHexString) colors.push(`#${item.color.getHexString()}`);
      }
    });
    return [...new Set(colors)].sort();
  };
  const worldDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  window.__TEST_API?.setPlayerPosition?.(0.5, 0.5);
  debug.game.pause();
  debug.enemySpawner.clear();
  const snake = debug.enemySpawner.spawn('snake', 0.52, 0.5, 0, true, 8, 16);
  snake.walker = null;
  for (let i = 0; i < 160; i++) {
    snake.updateBehavior(0.016, debug.player.surfaceU, debug.player.surfaceV);
    snake.applySurfaceTransform(getTransform);
  }
  debug.setVisualProofIsolation(true, false, true);

  const segmentData = snake.getSegmentData();
  const segmentWorld = snake.segmentRoot.children.map((child) => ({
    x: child.position.x,
    y: child.position.y,
    z: child.position.z,
  }));
  const worldGaps = [];
  for (let i = 1; i < segmentWorld.length; i++) {
    worldGaps.push(worldDist(segmentWorld[i - 1], segmentWorld[i]));
  }
  const uvGaps = [];
  for (let i = 1; i < segmentData.length; i++) {
    uvGaps.push(Math.hypot(
      segmentData[i - 1].surfaceU - segmentData[i].surfaceU,
      segmentData[i - 1].surfaceV - segmentData[i].surfaceV,
    ));
  }

  return {
    activeEnemyCount: debug.enemySpawner.getActiveCount(),
    segmentCount: segmentData.length,
    segmentRadii: [...new Set(segmentData.map((segment) => segment.radius))],
    segmentTypes: [...new Set(segmentData.map((segment) => segment.type))],
    segmentColors: collectColors(snake.segmentRoot),
    worldGaps,
    uvGaps,
    maxWorldGap: worldGaps.length ? Math.max(...worldGaps) : 0,
    maxUvGap: uvGaps.length ? Math.max(...uvGaps) : 0,
    avgWorldGap: worldGaps.length ? worldGaps.reduce((sum, value) => sum + value, 0) / worldGaps.length : 0,
    avgUvGap: uvGaps.length ? uvGaps.reduce((sum, value) => sum + value, 0) / uvGaps.length : 0,
  };
});

await new Promise((resolveWait) => setTimeout(resolveWait, 500));
const screenshot = await canvasShot(page, 'sp-attached-snake-formation');

const pass = formation.segmentCount >= 10
  && formation.segmentTypes.length === 1
  && formation.segmentTypes[0] === 'grunt'
  && formation.segmentColors.includes('#4444ff')
  && !formation.segmentColors.includes('#44ff88')
  && formation.segmentRadii.length === 1
  && formation.segmentRadii[0] >= 0.21
  && formation.maxUvGap > 0
  && formation.maxUvGap <= 0.07;

const report = {
  verdict: pass ? 'PASS' : 'FAIL',
  proofBoundary: 'SP proof uses real src/main.ts quickStart with debug/test APIs, a live EnemySpawner snake, WebGL2/SwiftShader rendering, material inspection, segment spacing checks, and a retained canvas screenshot. MP visual sync is covered by shared Snake.setQueuedSegmentsFromNetwork unit behavior unless a separate MP browser proof is run.',
  formation,
  screenshot,
  consoleMessages: consoleMessages.slice(-60),
};

const reportPath = resolve(REPORT_DIR, `snake-segment-visual-formation-sp-${runId}.json`);
writeFileSync(reportPath, JSON.stringify(report, null, 2));

await browser.close();
vite?.kill('SIGTERM');

console.log(JSON.stringify({ reportPath, verdict: report.verdict, screenshot }, null, 2));
if (report.verdict !== 'PASS') process.exit(1);
