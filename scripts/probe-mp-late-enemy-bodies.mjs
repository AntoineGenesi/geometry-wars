#!/usr/bin/env node
/**
 * Targeted MP late-spawn enemy-body probe.
 *
 * Runs one real network client against Colyseus and captures enemy-body-only
 * canvas screenshots after early and later spawn groups. This intentionally
 * does not use generic non-dark pixels: it hides surface/grid/effects before
 * sampling projected enemy centers.
 */
import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, dirname, delimiter } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEV_PORT = Number(getArg('port') || 3000);
const SERVER_PORT = Number(getArg('server-port') || 2567);
const SURFACE = getArg('surface') || 'cube-tunnel';
const MODE = getArg('mode') || 'pvpve';
const MAX_SECONDS = Number(getArg('duration') || 95);
const RENDERER = getArg('renderer') || 'webgl';
const SURFACE_OPAQUE = getArg('surface-opaque') === 'true' || getArg('opaque') === 'true';
const CONNECT_DEBUG_PORT = Number(getArg('connect-debug-port') || 0);
const CONNECT_DEBUG_HOST = getArg('connect-debug-host') || '127.0.0.1';
const DEV_BIND_HOST = getArg('dev-bind-host') || '127.0.0.1';
const BROWSER_HTTP_HOST = getArg('browser-http-host') || '127.0.0.1';
const BROWSER_WS_HOST = getArg('browser-ws-host') || BROWSER_HTTP_HOST;
const SERVER_HEALTH_HOST = getArg('server-health-host') || '127.0.0.1';
const DEV_HEALTH_HOST = getArg('dev-health-host') || '127.0.0.1';
const SHOULD_START_SERVER = getArg('start-server') !== 'false';
const SHOULD_START_VITE = getArg('start-vite') !== 'false';
const OUT_DIR = resolve(ROOT, 'test-screenshots/mp-late-enemy-bodies');
const REPORT_DIR = resolve(ROOT, 'reports');
const runId = new Date().toISOString().replace(/[:.]/g, '-');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function commandPath(command) {
  try {
    if (process.platform === 'win32') {
      return execSync(`where ${command}`, { encoding: 'utf8' }).trim().split(/\r?\n/)[0] || null;
    }
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
      .reverse();
  } catch {
    return [];
  }
}

function portListening(port) {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell.exe -NoProfile -Command "if (Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"`,
        { cwd: ROOT, stdio: 'ignore' },
      );
      return true;
    }
    execSync(`ss -tlnp | rg ':${port}\\b'`, { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function waitForHttp(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      // keep polling
    }
    await sleep(500);
  }
  return false;
}

function startServerIfNeeded() {
  if (portListening(SERVER_PORT)) return null;
  const node = process.execPath;
  const proc = spawn(node, ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
  proc.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return proc;
}

function startViteIfNeeded() {
  if (portListening(DEV_PORT)) return null;
  const node = process.execPath;
  const proc = spawn(node, ['node_modules/vite/bin/vite.js', '--host', DEV_BIND_HOST, '--port', String(DEV_PORT)], {
    cwd: ROOT,
    env: { ...process.env, PATH: [dirname(process.execPath), process.env.PATH || ''].join(delimiter) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
  proc.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  return proc;
}

async function waitForDebug(page, predicate, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await page.evaluate(predicate).catch(() => null);
    if (value) return value;
    await sleep(500);
  }
  return null;
}

async function clickStartGame(page) {
  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const button of buttons) {
      const text = (button.textContent || '').trim();
      const visible = button.offsetParent !== null || getComputedStyle(button).display !== 'none';
      if (visible && (text.includes('START GAME') || text.includes('PLAY AGAIN'))) {
        button.click();
        return text;
      }
    }
    return '';
  });
}

async function collectBodyCheckpoint(page, label) {
  try {
    await page.evaluate(() => window.__gameDebug?.setVisualProofIsolation?.(true, false, false));
    await sleep(250);
    const screenshot = resolve(OUT_DIR, `${label}-${runId}.png`);
    const canvasDataUrl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return canvas instanceof HTMLCanvasElement ? canvas.toDataURL('image/png') : '';
    });
    if (!canvasDataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('Canvas toDataURL failed; refusing page-screenshot fallback for body proof');
    }
    writeFileSync(screenshot, Buffer.from(canvasDataUrl.split(',')[1], 'base64'));

    const metrics = await page.evaluate(() => {
      const telemetry = window.__GAME_TELEMETRY || null;
      const debug = window.__gameDebug?.getEnemyInstanceDebug?.() || null;
      const renderSamples = window.__gameDebug?.getEnemyRenderSamples?.() || [];
      const canvas = document.querySelector('canvas');
      if (!canvas || !telemetry) return { ok: false, reason: 'missing canvas or telemetry', telemetry, debug };

      const tmp = document.createElement('canvas');
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx = tmp.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { ok: false, reason: 'missing 2d context', telemetry, debug };
      ctx.drawImage(canvas, 0, 0);

      const width = canvas.width;
      const height = canvas.height;
      const sx = width / Math.max(1, window.innerWidth || canvas.clientWidth || width);
      const sy = height / Math.max(1, window.innerHeight || canvas.clientHeight || height);
      const enemies = renderSamples.filter((enemy) => enemy.isAlive !== false && enemy.screen?.inView);
      const samples = [];
      let visible = 0;
      for (const enemy of enemies.slice(0, 48)) {
        const cx = Math.round(enemy.screen.x * sx);
        const cy = Math.round(enemy.screen.y * sy);
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
        let localMax = 0;
        let saturated = 0;
        let bodyPixels = 0;
        for (let yy = -16; yy <= 16; yy += 2) {
          for (let xx = -16; xx <= 16; xx += 2) {
            const px = Math.min(width - 1, Math.max(0, cx + xx));
            const py = Math.min(height - 1, Math.max(0, cy + yy));
            const d = ctx.getImageData(px, py, 1, 1).data;
            const max = Math.max(d[0], d[1], d[2]);
            const min = Math.min(d[0], d[1], d[2]);
            const luma = d[0] * 0.2126 + d[1] * 0.7152 + d[2] * 0.0722;
            localMax = Math.max(localMax, max, luma);
            if (max > 42 && max - min > 18) saturated++;
            if (max > 55 || luma > 35) bodyPixels++;
          }
        }
        const isVisible = saturated >= 3 || bodyPixels >= 5 || localMax > 70;
        if (isVisible) visible++;
        samples.push({
          id: enemy.id,
          type: enemy.type,
          worldPos: enemy.worldPos,
          renderWorldPos: enemy.renderWorldPos,
          renderBatch: enemy.renderBatch,
          slot: enemy.slot,
          drawCount: enemy.drawCount,
          batchVisible: enemy.batchVisible,
          matrixFound: enemy.matrixFound,
          instanceMatrixScale: enemy.instanceMatrixScale,
          screen: enemy.screen,
          opacity: enemy.opacity,
          colorBrightness: enemy.colorBrightness,
          localMax,
          saturated,
          bodyPixels,
          visible: isVisible,
        });
      }
      return {
        ok: true,
        waveNumber: telemetry.waveNumber,
        gameTime: telemetry.time,
        enemyCount: renderSamples.length,
        telemetryEnemyCount: telemetry.enemies?.length ?? 0,
        inViewEnemyCount: enemies.length,
        sampled: samples.length,
        visible,
        visibleRate: samples.length ? visible / samples.length : 0,
        renderer: telemetry.renderer,
        isolation: { includeSurface: false, includeAuxiliary: false, capture: 'canvas-only' },
        samples,
        debug,
      };
    });
    return { label, screenshot, metrics };
  } finally {
    await page.evaluate(() => window.__gameDebug?.setVisualProofIsolation?.(false)).catch(() => {});
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  const owned = [];
  const serverProc = SHOULD_START_SERVER ? startServerIfNeeded() : null;
  if (serverProc) owned.push(serverProc);
  if (!(await waitForHttp(`http://${SERVER_HEALTH_HOST}:${SERVER_PORT}/health`, 30000))) {
    throw new Error(`Colyseus did not become healthy on ${SERVER_PORT}`);
  }
  const viteProc = SHOULD_START_VITE ? startViteIfNeeded() : null;
  if (viteProc) owned.push(viteProc);
  if (!(await waitForHttp(`http://${DEV_HEALTH_HOST}:${DEV_PORT}`, 30000))) {
    throw new Error(`Vite did not become healthy on ${DEV_PORT}`);
  }

  const chromeCandidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    commandPath('google-chrome'),
    commandPath('chromium'),
    commandPath('chromium-browser'),
    ...findCachedChrome(),
  ].filter(Boolean);
  let connectedExternal = false;
  let browser;
  let page;
  let browserProfileDir = null;
  let launchedBrowser = null;
  if (CONNECT_DEBUG_PORT > 0) {
    const version = await fetch(`http://${CONNECT_DEBUG_HOST}:${CONNECT_DEBUG_PORT}/json/version`, {
      signal: AbortSignal.timeout(3000),
    }).then((res) => res.json());
    browser = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl });
    connectedExternal = true;
  } else {
    const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
    if (!chrome) throw new Error('No Chrome executable found');

    browserProfileDir = mkdtempSync(resolve(tmpdir(), 'gw-mp-body-probe-'));
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      userDataDir: browserProfileDir,
      args: [
        '--enable-webgl',
        '--use-gl=swiftshader',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=800,600',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    launchedBrowser = {
      mode: 'owned-headless',
      executablePath: chrome,
      pid: browser.process()?.pid ?? null,
      profileDir: browserProfileDir,
      spawnargs: browser.process()?.spawnargs ?? [],
    };
  }

  const errors = [];
  const logs = [];
  try {
    page = await browser.newPage();
    await page.evaluateOnNewDocument((surfaceOpaque) => {
      localStorage.setItem('gw3d-graphics-settings', JSON.stringify({
        qualityPreset: 'custom',
        bloomEnabled: true,
        bloomStrength: 1,
        particleCount: 2000,
        trailEffects: true,
        maxEnemies: 500,
        resolutionScale: 1,
        surfaceOpaque,
        surfaceOpacity: 0.05,
        surfaceColor: 0x141440,
        enable90DegreeHide: false,
      }));
    }, SURFACE_OPAQUE);
    await page.setViewport({ width: 800, height: 600 });
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));

    const params = new URLSearchParams({
      mode: 'network',
      surface: SURFACE,
      server: `ws://${BROWSER_WS_HOST}:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      debugVisibility: 'true',
      godMode: 'true',
      name: 'SoloHost',
      creator: '1',
      gameMode: MODE,
      pvpMode: MODE === 'pvp' || MODE === 'pvpve' ? MODE : '',
    });
    if (RENDERER && RENDERER !== 'auto') params.set('renderer', RENDERER);
    const url = `http://${BROWSER_HTTP_HOST}:${DEV_PORT}?${params.toString()}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDebug(page, () => window.__gameDebug?.isConnected?.(), 30000);

    let clicked = '';
    for (let i = 0; i < 10 && !clicked; i++) {
      clicked = await clickStartGame(page);
      if (!clicked) await sleep(1000);
    }
    await waitForDebug(page, () => window.__GAME_TELEMETRY?.waveNumber >= 1, 30000);

    const checkpoints = [];
    const targets = [
      { label: 'wave1-early', wave: 1, minEnemies: 3 },
      { label: 'wave2-second-group', wave: 2, minEnemies: 8 },
      { label: 'wave3-late-group', wave: 3, minEnemies: 14 },
      { label: 'wave4-plus-later-group', wave: 4, minEnemies: 18 },
    ];
    const captured = new Set();
    const start = Date.now();
    while (Date.now() - start < MAX_SECONDS * 1000 && captured.size < targets.length) {
      const state = await page.evaluate(() => ({
        wave: window.__GAME_TELEMETRY?.waveNumber ?? 0,
        enemies: window.__GAME_TELEMETRY?.enemies?.length ?? 0,
        text: window.__gameDebug?.getWaveText?.() ?? '',
      })).catch(() => ({ wave: 0, enemies: 0, text: '' }));
      for (const target of targets) {
        if (captured.has(target.label)) continue;
        if (state.wave >= target.wave && state.enemies >= target.minEnemies) {
          checkpoints.push(await collectBodyCheckpoint(page, target.label));
          captured.add(target.label);
        }
      }
      await sleep(1000);
    }

    if (!captured.has('final')) {
      checkpoints.push(await collectBodyCheckpoint(page, 'final'));
    }

    const allSamples = checkpoints.flatMap((checkpoint) => checkpoint.metrics?.samples ?? []);
    const hiddenSamples = allSamples.filter((sample) => (sample.opacity ?? 1) <= 0 || (sample.colorBrightness ?? 1) <= 0.02);
    const visibleBodySamples = allSamples.filter((sample) => sample.visible);
    const dimReadableSamples = allSamples.filter((sample) =>
      (sample.opacity ?? 0) > 0
        && (sample.colorBrightness ?? 1) > 0.02
        && (sample.colorBrightness ?? 1) < 0.35
        && sample.visible
    );
    const proofPassed = SURFACE_OPAQUE
      ? hiddenSamples.length > 0
      : visibleBodySamples.length > 0;
    if (!proofPassed) {
      errors.push(SURFACE_OPAQUE
        ? 'opaque mode did not produce any intentionally hidden enemy render samples'
        : 'readable mode did not produce any body-visible enemy samples');
    }

    const report = {
      kind: 'mp-late-enemy-body-probe',
      runId,
      surface: SURFACE,
      mode: MODE,
      surfaceOpaque: SURFACE_OPAQUE,
      visibilityMode: SURFACE_OPAQUE ? 'opaque-hidden' : 'readable-dim',
      url,
      maxSeconds: MAX_SECONDS,
      serverHealthHost: SERVER_HEALTH_HOST,
      devHealthHost: DEV_HEALTH_HOST,
      startServer: SHOULD_START_SERVER,
      startVite: SHOULD_START_VITE,
      browser: connectedExternal
        ? {
            mode: 'external-devtools',
            debugHost: CONNECT_DEBUG_HOST,
            debugPort: CONNECT_DEBUG_PORT,
            browserHttpHost: BROWSER_HTTP_HOST,
            browserWsHost: BROWSER_WS_HOST,
          }
        : launchedBrowser,
      startedByButton: clicked,
      checkpoints,
      sampleSummary: {
        totalSamples: allSamples.length,
        visibleBodySamples: visibleBodySamples.length,
        dimReadableSamples: dimReadableSamples.length,
        hiddenSamples: hiddenSamples.length,
        proofPassed,
      },
      errors,
      criticalErrors: errors.filter((e) => !/AudioContext|favicon|404|WebSocket|Failed to load resource/.test(e)),
      logTail: logs.slice(-80),
    };
    const reportPath = resolve(REPORT_DIR, `mp-late-enemy-body-probe-${SURFACE}-${MODE}-${runId}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      reportPath,
      checkpoints: checkpoints.map((c) => ({
        label: c.label,
        wave: c.metrics?.waveNumber,
        enemies: c.metrics?.enemyCount,
        inView: c.metrics?.inViewEnemyCount,
        visible: c.metrics?.visible,
        sampled: c.metrics?.sampled,
        visibleRate: c.metrics?.visibleRate,
        screenshot: c.screenshot,
      })),
      sampleSummary: report.sampleSummary,
      criticalErrors: report.criticalErrors,
    }, null, 2));
    if (!report.sampleSummary.proofPassed) {
      throw new Error(`MP enemy body proof failed; report written to ${reportPath}`);
    }
  } finally {
    if (connectedExternal) {
      await page?.close?.().catch(() => {});
      browser.disconnect();
    } else {
      await browser.close().catch(() => {});
      if (browserProfileDir) {
        rmSync(browserProfileDir, { recursive: true, force: true });
      }
    }
    for (const proc of owned.reverse()) {
      proc.kill('SIGTERM');
      proc.stdout?.destroy();
      proc.stderr?.destroy();
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 1000).unref();
    }
  }
}

main().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});
