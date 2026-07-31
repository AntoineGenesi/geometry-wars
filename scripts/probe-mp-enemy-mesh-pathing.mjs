#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execSync, spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORT = Number(process.env.DEV_PORT || 3006);
const SERVER_PORT = Number(process.env.SERVER_PORT || 2568);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(ROOT, 'test-screenshots/mp-enemy-mesh-pathing', runId);
const reportPath = resolve(ROOT, 'reports', `mp-enemy-mesh-pathing-cube-tunnel-pvpve-${runId}.json`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function commandPath(command) {
  try {
    return execSync(`command -v ${command}`, { encoding: 'utf8' }).trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

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
    // Fall through to system Chrome.
  }
  return [
    process.env.CHROME_PATH,
    commandPath('google-chrome'),
    commandPath('chromium'),
    ...cached,
  ].filter(Boolean).find((candidate) => existsSync(candidate));
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // Retry within the bounded window.
    }
    await sleep(400);
  }
  return false;
}

async function waitForPage(page, predicate, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await page.evaluate(predicate).catch(() => null);
    if (result) return result;
    await sleep(500);
  }
  return null;
}

function startProcess(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));
  return child;
}

async function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already stopped.
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  await sleep(750);
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Process group exited after SIGTERM.
  }
}

function movementSummary(before, after) {
  const beforeById = new Map(before.map((sample) => [sample.id, sample]));
  return after.map((sample) => {
    const prior = beforeById.get(sample.id);
    const moved = prior
      ? Math.hypot(...sample.canonicalWorld.map((value, index) => value - prior.canonicalWorld[index]))
      : null;
    return { ...sample, movedWorld: moved };
  });
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');

  const owned = [];
  let browser;
  try {
    owned.push(startProcess(
      ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
      { PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0' },
    ));
    owned.push(startProcess(
      ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(DEV_PORT)],
    ));

    const [serverReady, viteReady] = await Promise.all([
      waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`),
      waitForHttp(`http://127.0.0.1:${DEV_PORT}`),
    ]);
    if (!serverReady || !viteReady) throw new Error(`Readiness failed: server=${serverReady} vite=${viteReady}`);

    browser = await puppeteer.launch({
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
        '--window-size=960,720',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 720 });
    const pageErrors = [];
    const consoleTail = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      const line = `[${message.type()}] ${message.text()}`;
      consoleTail.push(line);
      if (consoleTail.length > 120) consoleTail.shift();
      if (message.type() === 'error') pageErrors.push(message.text());
    });

    const params = new URLSearchParams({
      mode: 'network',
      surface: 'cube-tunnel',
      server: `ws://127.0.0.1:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      godMode: 'true',
      creator: '1',
      name: 'EnemyPathCI',
      gameMode: 'pvpve',
      pvpMode: 'pvpve',
      renderer: 'webgl',
    });
    const url = `http://127.0.0.1:${DEV_PORT}?${params.toString()}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()))) {
      throw new Error('Solo MP client did not connect');
    }

    const startedByButton = await waitForPage(page, () => {
      const button = Array.from(document.querySelectorAll('button')).find((candidate) => {
        const label = (candidate.textContent || '').trim();
        const visible = candidate.offsetParent !== null
          || getComputedStyle(candidate).display !== 'none';
        return label.includes('START GAME') && visible;
      });
      if (!button) return '';
      button.click();
      return button.textContent || 'START GAME';
    });
    if (!startedByButton) throw new Error('Could not start solo MP game');

    const before = await waitForPage(page, () => {
      const samples = window.__gameDebug?.getEnemyMeshPathingSamples?.() || [];
      return samples.length >= 3 ? samples : null;
    }, 25000);
    if (!before) throw new Error('No live enemy group appeared within 25 seconds');
    await sleep(5000);
    const after = await page.evaluate(() => window.__gameDebug?.getEnemyMeshPathingSamples?.() || []);
    const movement = movementSummary(before, after);
    const screenshot = resolve(artifactDir, 'cube-tunnel-pvpve-enemy-pathing.png');
    await page.screenshot({ path: screenshot });
    const telemetry = await page.evaluate(() => window.__GAME_TELEMETRY || null);

    const criticalErrors = pageErrors.filter((message) =>
      !/AudioContext|favicon|404|Failed to load resource/.test(message));
    const survivingSamples = movement.filter((sample) => sample.movedWorld !== null);
    const canonicalValid = movement.length >= 3 && movement.every((sample) =>
      Number.isFinite(sample.surfaceU)
      && Number.isFinite(sample.surfaceV)
      && sample.canonicalWorld.every(Number.isFinite)
      && sample.renderedWorld.every(Number.isFinite)
      && Number.isFinite(sample.renderCanonicalDelta));
    const movedCount = survivingSamples.filter((sample) => sample.movedWorld > 0.1).length;
    const maxRenderCanonicalDelta = movement.reduce(
      (max, sample) => Math.max(max, sample.renderCanonicalDelta), 0,
    );
    const passed = telemetry?.surface?.type === 'cube-tunnel'
      && telemetry?.network?.roomPhase === 'playing'
      && telemetry?.renderer?.backend === 'webgl2'
      && canonicalValid
      && movedCount > 0
      && maxRenderCanonicalDelta < 2
      && criticalErrors.length === 0;

    const report = {
      verdict: passed ? 'PASS' : 'FAIL',
      runId,
      url,
      ports: { vite: DEV_PORT, colyseus: SERVER_PORT },
      startedByButton,
      telemetry: {
        gameTime: telemetry?.time,
        waveNumber: telemetry?.waveNumber,
        renderer: telemetry?.renderer,
        surface: telemetry?.surface,
        network: telemetry?.network,
      },
      checks: {
        canonicalValid,
        beforeCount: before.length,
        afterCount: after.length,
        survivingSampleCount: survivingSamples.length,
        movedCount,
        maxRenderCanonicalDelta,
        criticalErrorCount: criticalErrors.length,
      },
      before,
      after: movement,
      screenshot,
      pageErrors,
      criticalErrors,
      consoleTail,
      proofBoundary: 'One headless browser on real network-main.ts plus one Colyseus PvPvE cube-tunnel room. Proves canonical enemy world fields reach rendering, current canonical-derived compatibility UV reaches client-side DDA/minimap consumers, rendered enemies converge on server world targets, and at least one live enemy moves. Mesh-path-distance decrease, legacy projected-target rejection, and aggro expiry/strategy resume are covered by focused deterministic server tests; no two-client LAN, WebGPU, or human play claim.',
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ verdict: report.verdict, reportPath, screenshot, checks: report.checks }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    for (const child of owned.reverse()) await stopProcessTree(child);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
