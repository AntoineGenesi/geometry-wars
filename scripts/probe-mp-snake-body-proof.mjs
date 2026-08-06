#!/usr/bin/env node
/**
 * MP snake body visual proof.
 *
 * Starts a real Colyseus + Vite network game, uses opt-in proof controls to
 * spawn one mixed-body snake, verifies its queued body meshes render near the
 * head, then kills the head through the server release path and verifies the
 * queued body IDs become normal enemies.
 */

import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEV_PORT = Number(getArg('port') || 3006);
const SERVER_PORT = Number(getArg('server-port') || 2567);
const BASE_URL = `http://localhost:${DEV_PORT}`;
const OUT_DIR = resolve(ROOT, 'test-screenshots/mp-snake-body-proof');
const REPORT_DIR = resolve(ROOT, 'reports');
const runId = new Date().toISOString().replace(/[:.]/g, '-');

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function commandPath(command) {
  try {
    return execSync(`command -v ${command}`, { encoding: 'utf8' }).trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

function findCachedChrome() {
  const cacheRoot = resolve(process.env.HOME || '/home/antoine', '.cache/puppeteer/chrome');
  try {
    return readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('linux-'))
      .map((entry) => resolve(cacheRoot, entry.name, 'chrome-linux64/chrome'))
      .filter((path) => existsSync(path))
      .sort()
      .reverse()[0] || null;
  } catch {
    return null;
  }
}

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || findCachedChrome()
  || commandPath('google-chrome')
  || commandPath('chromium')
  || commandPath('chromium-browser');

function killPort(port) {
  try {
    const result = execSync(`ss -tlnp 2>/dev/null | grep ':${port} '`, { encoding: 'utf8' });
    for (const match of result.matchAll(/pid=(\d+)/g)) {
      try { execSync(`kill ${match[1]} 2>/dev/null`); } catch { /* already gone */ }
    }
  } catch { /* no listener */ }
}

function startServer() {
  const proc = spawn('npx', ['tsx', 'server/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(SERVER_PORT),
      SHUTDOWN_TIMEOUT: '0',
      GEOMETRY_WARS_MP_PROOF_CONTROLS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (data) => process.stdout.write(`[server] ${data}`));
  proc.stderr.on('data', (data) => process.stderr.write(`[server] ${data}`));
  return proc;
}

function startVite() {
  const proc = spawn('npx', ['vite', '--host', 'localhost', '--port', String(DEV_PORT)], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (data) => process.stdout.write(`[vite] ${data}`));
  proc.stderr.on('data', (data) => process.stderr.write(`[vite] ${data}`));
  return proc;
}

async function waitForHttp(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch { /* keep polling */ }
    await sleep(500);
  }
  return false;
}

async function waitForPage(page, fn, timeoutMs = 30000, pollMs = 500) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (err) {
      lastError = err;
    }
    await sleep(pollMs);
  }
  throw new Error(`Timed out waiting for page condition${lastError ? `: ${lastError.message}` : ''}`);
}

function summarizeSnake(sample) {
  const segmentWorld = sample?.segmentWorld || [];
  const adjacentDistances = [];
  for (let i = 1; i < segmentWorld.length; i++) {
    const a = segmentWorld[i - 1].world;
    const b = segmentWorld[i].world;
    adjacentDistances.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  return {
    id: sample?.id ?? null,
    segmentCount: sample?.segmentCount ?? 0,
    serverQueuedRows: sample?.serverQueuedRows?.length ?? 0,
    segmentTypes: sample?.segmentTypes || [],
    releasedIds: (sample?.serverQueuedRows || []).map((row) => row.id),
    maxAdjacentDistance: adjacentDistances.length ? Math.max(...adjacentDistances) : null,
    maxDistanceToHead: segmentWorld.length ? Math.max(...segmentWorld.map((row) => row.distanceToHead)) : null,
    minDistanceToHead: segmentWorld.length ? Math.min(...segmentWorld.map((row) => row.distanceToHead)) : null,
  };
}

async function main() {
  if (!CHROME_PATH) throw new Error('No Chrome/Chromium executable found');
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  let server = null;
  let vite = null;
  let browser = null;
  const report = {
    verdict: 'FAIL',
    baseUrl: BASE_URL,
    serverPort: SERVER_PORT,
    chromePath: CHROME_PATH,
    errors: [],
  };

  try {
    killPort(DEV_PORT);
    killPort(SERVER_PORT);
    server = startServer();
    vite = startVite();
    if (!await waitForHttp(`http://localhost:${SERVER_PORT}/health`, 30000)) {
      throw new Error('Colyseus health check failed');
    }
    if (!await waitForHttp(BASE_URL, 30000)) {
      throw new Error('Vite health check failed');
    }

    browser = await puppeteer.launch({
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

    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 720 });
    const pageErrors = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (/error|failed|exception/i.test(text)) pageErrors.push(`[${msg.type()}] ${text}`);
    });
    page.on('pageerror', (err) => pageErrors.push(`[pageerror] ${err.message}`));

    const params = new URLSearchParams({
      mode: 'network',
      surface: 'sphere',
      server: `ws://localhost:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      godMode: 'true',
      gameMode: 'pvp',
      pvpMode: 'pvp',
      name: 'SnakeProof',
      testEnemyCountCap: '120',
      testStartWave: '1',
    });
    await page.goto(`${BASE_URL}/?${params.toString()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await waitForPage(page, () => page.evaluate(() => Boolean(window.__gameDebug?.isConnected?.())), 30000);

    const started = await page.evaluate(() => {
      const start = [...document.querySelectorAll('button')]
        .find((button) => (button.textContent || '').includes('START GAME'));
      if (!start) return false;
      start.click();
      return true;
    });
    if (!started) throw new Error('Could not click START GAME');
    await waitForPage(page, () => page.evaluate(() => window.__GAME_TELEMETRY?.network?.roomPhase === 'playing'), 30000);

    await page.evaluate(() => window.__gameDebug.setupSnakeBodyProof(40, 12));
    const beforeSample = await waitForPage(page, () => page.evaluate(() => {
      const samples = window.__gameDebug?.getSnakeBodyDebug?.() || [];
      return samples.find((sample) => sample.segmentCount >= 12 && sample.serverQueuedRows?.length >= 12) || null;
    }), 15000);
    await sleep(750);
    const beforeScreenshot = resolve(OUT_DIR, `before-head-death-${runId}.png`);
    await page.screenshot({ path: beforeScreenshot, fullPage: false });
    const before = summarizeSnake(beforeSample);

    await page.evaluate((headId) => window.__gameDebug.killSnakeBodyProofHead(headId), before.id);
    const afterState = await waitForPage(page, () => page.evaluate((releasedIds) => {
      const enemies = window.__gameDebug?.getEnemies?.() || [];
      const snakes = window.__gameDebug?.getSnakeBodyDebug?.() || [];
      const released = enemies.filter((enemy) => releasedIds.includes(enemy.id));
      return released.length >= releasedIds.length && !snakes.some((sample) => sample.id === releasedIds[0]?.split(':q')[0])
        ? { enemies, snakes, released }
        : null;
    }, before.releasedIds), 15000);
    await sleep(750);
    const afterScreenshot = resolve(OUT_DIR, `after-head-death-release-${runId}.png`);
    await page.screenshot({ path: afterScreenshot, fullPage: false });

    const typeSet = new Set(before.segmentTypes);
    const releaseTypeSet = new Set(afterState.released.map((enemy) => enemy.type));
    const spacingOk = before.maxAdjacentDistance !== null && before.maxAdjacentDistance < 5.5;
    const compositionOk = ['grunt', 'weaver', 'spinner', 'neutron'].every((type) => typeSet.has(type));
    const releaseOk = ['grunt', 'weaver', 'spinner', 'neutron'].every((type) => releaseTypeSet.has(type));

    Object.assign(report, {
      verdict: spacingOk && compositionOk && releaseOk ? 'PASS' : 'FAIL',
      before,
      after: {
        releasedCount: afterState.released.length,
        releasedTypes: [...releaseTypeSet].sort(),
        remainingSnakeDebug: afterState.snakes,
      },
      screenshots: [beforeScreenshot, afterScreenshot],
      checks: { spacingOk, compositionOk, releaseOk },
      pageErrors,
      proofBoundary: 'Real network-main.ts client connected to real Colyseus GameRoom. Proof controls require GEOMETRY_WARS_MP_PROOF_CONTROLS=1 and are host-only; they spawn one deterministic snake and kill the head through removeKilledEnemyAt().',
    });
  } catch (err) {
    report.errors.push(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    try { if (browser) await browser.close(); } catch { /* ignore */ }
    try { if (vite) vite.kill(); } catch { /* ignore */ }
    try { if (server) server.kill(); } catch { /* ignore */ }
    await sleep(500);
    killPort(DEV_PORT);
    killPort(SERVER_PORT);
    const reportPath = resolve(REPORT_DIR, `mp-snake-body-proof-${runId}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ verdict: report.verdict, reportPath, screenshots: report.screenshots || [], errors: report.errors }, null, 2));
    if (report.verdict !== 'PASS') process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
