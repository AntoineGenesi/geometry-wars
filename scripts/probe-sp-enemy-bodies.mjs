#!/usr/bin/env node
/**
 * Targeted SP enemy-body probe.
 *
 * Runs the real single-player path:
 *   index.html -> src/main.ts -> src/core/GameLoop.ts -> src/core/RenderLoop.ts
 *
 * Captures enemy-body-only canvas screenshots from toDataURL() and samples
 * pixels around actual instanced/LOD render matrices exposed by debug hooks.
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
const SURFACE = getArg('surface') || 'sphere-tunnel';
const GAME_MODE = getArg('game-mode') || 'waves';
const MAX_SECONDS = Number(getArg('duration') || 75);
const RENDERER = getArg('renderer') || 'auto';
const SURFACE_OPAQUE = getArg('surface-opaque') === 'true' || getArg('opaque') === 'true';
const DEV_BIND_HOST = getArg('dev-bind-host') || '127.0.0.1';
const BROWSER_HTTP_HOST = getArg('browser-http-host') || '127.0.0.1';
const DEV_HEALTH_HOST = getArg('dev-health-host') || '127.0.0.1';
const SHOULD_START_VITE = getArg('start-vite') !== 'false';
const OUT_DIR = resolve(ROOT, 'test-screenshots/sp-enemy-bodies');
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
      const gameState = window.__gameDebug?.getGameState?.() || null;
      const renderer = window.__gameDebug?.getRendererInfo?.() || null;
      const waveText = window.__gameDebug?.getWaveText?.() || '';
      const debug = window.__gameDebug?.getEnemyInstanceDebug?.() || null;
      const renderSamples = window.__gameDebug?.getEnemyRenderSamples?.() || [];
      const canvas = document.querySelector('canvas');
      if (!canvas || !telemetry) {
        return { ok: false, reason: 'missing canvas or telemetry', telemetry, gameState, renderer, debug };
      }

      const tmp = document.createElement('canvas');
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx = tmp.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { ok: false, reason: 'missing 2d context', telemetry, gameState, renderer, debug };
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
          lodLevel: enemy.lodLevel,
          geometryType: enemy.geometryType,
          depthTest: enemy.depthTest,
          depthWrite: enemy.depthWrite,
          renderOrder: enemy.renderOrder,
          instanceMatrixScale: enemy.instanceMatrixScale,
          instanceMatrixScaleXYZ: enemy.instanceMatrixScaleXYZ,
          surfaceVisibility: enemy.surfaceVisibility,
          screen: enemy.screen,
          opacity: enemy.opacity,
          colorBrightness: enemy.colorBrightness,
          localMax,
          saturated,
          bodyPixels,
          visible: isVisible,
        });
      }
      const waveMatch = /(\d+)/.exec(waveText);
      return {
        ok: true,
        waveText,
        waveNumber: waveMatch ? Number(waveMatch[1]) : null,
        gameTime: telemetry.time,
        enemyCount: renderSamples.length,
        telemetryEnemyCount: telemetry.enemies?.length ?? 0,
        inViewEnemyCount: enemies.length,
        sampled: samples.length,
        visible,
        visibleRate: samples.length ? visible / samples.length : 0,
        renderer,
        visibilityStats: window.__surfaceVisibilityStats || null,
        isolation: { includeSurface: false, includeAuxiliary: false, capture: 'canvas-only' },
        samples,
        debug,
      };
    });
    await page.evaluate(() => window.__gameDebug?.setVisualProofIsolation?.(false));
    await page.evaluate(() => window.__gameDebug?.setVisualProofIsolation?.(true, true, false));
    await sleep(250);
    const composedScreenshot = resolve(OUT_DIR, `${label}-composed-${runId}.png`);
    const composedDataUrl = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      return canvas instanceof HTMLCanvasElement ? canvas.toDataURL('image/png') : '';
    });
    if (!composedDataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('Canvas toDataURL failed for composed proof');
    }
    writeFileSync(composedScreenshot, Buffer.from(composedDataUrl.split(',')[1], 'base64'));
    return { label, screenshot, composedScreenshot, metrics };
  } finally {
    await page.evaluate(() => window.__gameDebug?.setVisualProofIsolation?.(false)).catch(() => {});
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });

  const owned = [];
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
  const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!chrome) throw new Error('No Chrome executable found');

  const browserProfileDir = mkdtempSync(resolve(tmpdir(), 'gw-sp-body-probe-'));
  let browser;
  try {
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
    const page = await browser.newPage();
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
    const errors = [];
    const logs = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));

    const params = new URLSearchParams({
      quickStart: 'true',
      surface: SURFACE,
      gameMode: GAME_MODE,
      debug: 'true',
      testMode: 'true',
      debugVisibility: 'true',
      godMode: 'true',
    });
    if (RENDERER && RENDERER !== 'auto') params.set('renderer', RENDERER);
    const url = `http://${BROWSER_HTTP_HOST}:${DEV_PORT}?${params.toString()}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    await waitForDebug(page, () => window.__GAME_TELEMETRY && window.__gameDebug?.getEnemyRenderSamples, 30000);
    await waitForDebug(page, () => (window.__GAME_TELEMETRY?.enemies?.length ?? 0) >= 1, 30000);

    const checkpoints = [];
    const targets = [
      { label: 'natural-early-spawn', minTime: 2, minEnemies: 1 },
      { label: 'natural-second-group', minTime: 12, minEnemies: 6 },
      { label: 'natural-later-spawn', minTime: 28, minEnemies: 10 },
      { label: 'natural-deep-later-spawn', minTime: 45, minEnemies: 14 },
    ];
    const captured = new Set();
    const start = Date.now();
    while (Date.now() - start < MAX_SECONDS * 1000 && captured.size < targets.length) {
      const state = await page.evaluate(() => ({
        time: window.__GAME_TELEMETRY?.time ?? 0,
        enemies: window.__GAME_TELEMETRY?.enemies?.length ?? 0,
        waveText: window.__gameDebug?.getWaveText?.() ?? '',
      })).catch(() => ({ time: 0, enemies: 0, waveText: '' }));
      for (const target of targets) {
        if (captured.has(target.label)) continue;
        if (state.time >= target.minTime && state.enemies >= target.minEnemies) {
          checkpoints.push(await collectBodyCheckpoint(page, target.label));
          captured.add(target.label);
        }
      }
      await sleep(1000);
    }

    if (!captured.has('final')) {
      checkpoints.push(await collectBodyCheckpoint(page, 'final'));
    }

    const rendererInfo = await page.evaluate(() => window.__gameDebug?.getRendererInfo?.() || null).catch(() => null);
    const allSamples = checkpoints.flatMap((checkpoint) => checkpoint.metrics?.samples ?? []);
    const hiddenSamples = allSamples.filter((sample) => (sample.opacity ?? 1) <= 0 || (sample.colorBrightness ?? 1) <= 0.02);
    const visibleBodySamples = allSamples.filter((sample) => sample.visible);
    const dimReadableSamples = allSamples.filter((sample) =>
      (sample.opacity ?? 0) > 0
        && (sample.colorBrightness ?? 1) > 0.02
        && (sample.colorBrightness ?? 1) < 0.35
        && sample.visible
    );
    const classifiedSamples = allSamples.filter((sample) => sample.surfaceVisibility?.className);
    const visibilityClassCounts = classifiedSamples.reduce((counts, sample) => {
      const name = sample.surfaceVisibility.className;
      counts[name] = (counts[name] || 0) + 1;
      return counts;
    }, {});
    const depthViolations = allSamples.filter((sample) =>
      sample.renderBatch !== 'mesh' && (sample.depthTest !== true || sample.depthWrite !== true)
    );
    const low3DViolations = allSamples.filter((sample) => sample.lodLevel === 'LOW' && (
      sample.geometryType === 'PlaneGeometry'
        || !sample.instanceMatrixScaleXYZ
        || Math.min(
          sample.instanceMatrixScaleXYZ.x,
          sample.instanceMatrixScaleXYZ.y,
          sample.instanceMatrixScaleXYZ.z,
        ) <= 0
    ));
    const visualModePassed = SURFACE_OPAQUE
      ? hiddenSamples.length > 0
      : visibleBodySamples.length > 0;
    const proofPassed = visualModePassed
      && classifiedSamples.length > 0
      && depthViolations.length === 0
      && low3DViolations.length === 0;
    if (!proofPassed) {
      errors.push(SURFACE_OPAQUE
        ? 'opaque mode did not produce any intentionally hidden enemy render samples'
        : 'readable mode did not produce any body-visible enemy samples');
    }

    const report = {
      kind: 'sp-enemy-body-probe',
      runId,
      surface: SURFACE,
      gameMode: GAME_MODE,
      surfaceOpaque: SURFACE_OPAQUE,
      visibilityMode: SURFACE_OPAQUE ? 'opaque-hidden' : 'readable-dim',
      url,
      maxSeconds: MAX_SECONDS,
      devHealthHost: DEV_HEALTH_HOST,
      startVite: SHOULD_START_VITE,
      browser: {
        mode: 'owned-headless',
        executablePath: chrome,
        pid: browser.process()?.pid ?? null,
        profileDir: browserProfileDir,
        spawnargs: browser.process()?.spawnargs ?? [],
      },
      renderer: rendererInfo,
      checkpoints,
      sampleSummary: {
        totalSamples: allSamples.length,
        visibleBodySamples: visibleBodySamples.length,
        dimReadableSamples: dimReadableSamples.length,
        hiddenSamples: hiddenSamples.length,
        classifiedSamples: classifiedSamples.length,
        visibilityClassCounts,
        depthViolations: depthViolations.length,
        low3DViolations: low3DViolations.length,
        proofPassed,
      },
      errors,
      criticalErrors: errors.filter((e) => !/AudioContext|favicon|404|WebSocket|Failed to load resource/.test(e)),
      logTail: logs.slice(-80),
    };
    const reportPath = resolve(REPORT_DIR, `sp-enemy-body-probe-${SURFACE}-${GAME_MODE}-${runId}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      reportPath,
      renderer: rendererInfo,
      checkpoints: checkpoints.map((c) => ({
        label: c.label,
        waveText: c.metrics?.waveText,
        gameTime: c.metrics?.gameTime,
        enemies: c.metrics?.enemyCount,
        inView: c.metrics?.inViewEnemyCount,
        visible: c.metrics?.visible,
        sampled: c.metrics?.sampled,
        visibleRate: c.metrics?.visibleRate,
        screenshot: c.screenshot,
        composedScreenshot: c.composedScreenshot,
      })),
      sampleSummary: report.sampleSummary,
      criticalErrors: report.criticalErrors,
    }, null, 2));
    if (!report.sampleSummary.proofPassed) {
      throw new Error(`SP enemy body proof failed; report written to ${reportPath}`);
    }
  } finally {
    await browser?.close?.().catch(() => {});
    rmSync(browserProfileDir, { recursive: true, force: true });
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
