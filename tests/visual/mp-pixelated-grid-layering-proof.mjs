#!/usr/bin/env node
/**
 * Usage:
 *   CHROME_PATH=/usr/bin/google-chrome node tests/visual/mp-pixelated-grid-layering-proof.mjs --phase=baseline --port=3008 --server-port=2570
 *   CHROME_PATH=/usr/bin/google-chrome node tests/visual/mp-pixelated-grid-layering-proof.mjs --phase=post-fix --port=3008 --server-port=2570
 *
 * Writes JSON/Markdown reports under reports/ and four isolated screenshots
 * under test-screenshots/mp-pixelated-grid-layering-proof/<phase>-<run-id>/.
 */
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEV_PORT = Number(getArg('port') || process.env.DEV_PORT || 3008);
const SERVER_PORT = Number(getArg('server-port') || process.env.SERVER_PORT || 2570);
const PHASE = getArg('phase') || 'baseline';
const SURFACE = getArg('surface') || 'sphere';
const INCLUDE_SP_CONTROL = getArg('sp-control') === 'true';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = resolve(ROOT, 'test-screenshots/mp-pixelated-grid-layering-proof', `${PHASE}-${RUN_ID}`);
const JSON_PATH = resolve(ROOT, 'reports', `mp-pixelated-grid-layering-${PHASE}-${RUN_ID}.json`);
const MD_PATH = resolve(ROOT, 'reports', `mp-pixelated-grid-layering-${PHASE}-${RUN_ID}.md`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function commandPath(command) {
  try {
    return execFileSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).trim() || null;
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
    // System Chrome remains a valid fallback.
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
      // Retry within the bounded readiness window.
    }
    await sleep(350);
  }
  return false;
}

function startProcess(command, args, env, logs) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const capture = (stream, source) => stream.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      if (!line.trim()) continue;
      logs.push(`[${source}] ${line}`);
      if (logs.length > 500) logs.shift();
    }
  });
  capture(child.stdout, 'server');
  capture(child.stderr, 'server-error');
  return child;
}

async function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already exited.
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  await sleep(400);
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Graceful shutdown completed.
  }
}

async function createPage(browser, label) {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 720 });
  page.__label = label;
  page.__errors = [];
  page.__consoleTail = [];
  page.on('pageerror', (error) => page.__errors.push(error.message));
  page.on('console', (message) => {
    const line = `[${message.type()}] ${message.text()}`;
    page.__consoleTail.push(line);
    if (page.__consoleTail.length > 160) page.__consoleTail.shift();
    if (message.type() === 'error') page.__errors.push(message.text());
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('gw3d-visual-mode', 'pixelated');
    localStorage.removeItem('gw3d-visual-style');
    localStorage.setItem('gw3d-music-muted', 'true');
  });
  return page;
}

async function waitForPage(page, predicate, timeoutMs = 30000, argument = undefined) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await page.evaluate(predicate, argument).catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  return null;
}

function criticalPageErrors(errors) {
  return errors.filter((message) =>
    !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated/i.test(message));
}

function criticalServerErrors(logs) {
  return logs.filter((line) => /\b(fatal|uncaught|unhandled|exception|error:)\b/i.test(line));
}

function writePng(name, dataUrl) {
  if (!dataUrl?.startsWith('data:image/png;base64,')) return null;
  const relativePath = relative(ROOT, resolve(ARTIFACT_DIR, `${name}.png`));
  writeFileSync(resolve(ROOT, relativePath), Buffer.from(dataUrl.split(',')[1], 'base64'));
  return relativePath;
}

function sanitizeEvidenceLine(line) {
  return line.replaceAll(ROOT, '<project-root>');
}

async function runMpSetup(page) {
  const params = new URLSearchParams({
    mode: 'network',
    surface: SURFACE,
    server: `ws://127.0.0.1:${SERVER_PORT}`,
    debug: 'true',
    testMode: 'true',
    godMode: 'true',
    name: 'GridLayeringProof',
    gameMode: 'waves',
    renderer: 'webgl',
    music: 'false',
  });
  params.set('creator', '1');
  await page.goto(`http://127.0.0.1:${DEV_PORT}?${params.toString()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  const connected = await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
  if (!connected) throw new Error('MP client did not connect');
  const started = await waitForPage(
    page,
    (surface) => window.__gameDebug?.startChevronAimProofGame?.(surface) || false,
    30000,
    SURFACE,
  );
  if (!started) throw new Error(`Could not start MP proof game on ${SURFACE}`);
  const playing = await waitForPage(
    page,
    (surface) => {
      const state = window.__gameDebug?.getChevronAimProofState?.();
      return state?.roomPhase === 'playing' && state?.surface === surface ? state : null;
    },
    30000,
    SURFACE,
  );
  if (!playing) throw new Error('MP proof game did not enter playing state');
  await page.evaluate(() => {
    window.__gameDebug?.resumeChevronAimProofGame?.();
    const style = document.createElement('style');
    style.textContent = '#debug-overlay,#profiling-overlay,.debug-overlay,.profiling-overlay{display:none!important}';
    document.head.appendChild(style);
  });
  await sleep(500);
}

async function runSpSetup(page) {
  await page.goto(
    `http://127.0.0.1:${DEV_PORT}/?quickStart=true&surface=${encodeURIComponent(SURFACE)}&testMode=true&renderer=webgl&music=false&godMode=true`,
    { waitUntil: 'domcontentloaded', timeout: 30000 },
  );
  const ready = await waitForPage(
    page,
    () => Boolean(window.__gameDebug?.ctx?.surface && window.__gameDebug?.ctx?.player && window.__gameDebug?.ctx?.game),
    30000,
  );
  if (!ready) throw new Error('SP debug context unavailable');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '#debug-overlay,#profiling-overlay,.debug-overlay,.profiling-overlay{display:none!important}';
    document.head.appendChild(style);
  });
  await sleep(500);
}

async function captureLayering(page, proofMode) {
  const result = await page.evaluate(async (mode) => {
    const waitFrames = async (count = 3) => {
      for (let i = 0; i < count; i++) await new Promise((done) => requestAnimationFrame(done));
    };
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return { ok: false, reason: 'no canvas' };

    const spRestore = [];
    const setSpMode = (isolationMode) => {
      const debug = window.__gameDebug;
      const ctx = debug?.ctx;
      const scene = ctx?.game?.scene;
      const surface = ctx?.surface;
      const player = ctx?.player?.mesh;
      if (!scene || !surface || !player) return { ok: false, reason: 'missing SP scene/surface/player' };
      if (isolationMode === 'restore') {
        while (spRestore.length > 0) {
          const entry = spRestore.pop();
          entry.object.visible = entry.visible;
        }
        return getSpState();
      }
      if (spRestore.length === 0) {
        for (const object of scene.children) spRestore.push({ object, visible: object.visible });
        player.traverse((object) => {
          if (object !== player) spRestore.push({ object, visible: object.visible });
        });
        spRestore.push({ object: surface.mesh, visible: surface.mesh.visible });
        spRestore.push({ object: surface.gridMesh, visible: surface.gridMesh.visible });
        spRestore.push({ object: player, visible: player.visible });
      }
      for (const object of scene.children) {
        object.visible = object.isLight || object === surface.group || object === player;
      }
      surface.group.visible = true;
      surface.mesh.visible = false;
      surface.gridMesh.visible = isolationMode === 'grid' || isolationMode === 'layered';
      const showPlayer = isolationMode === 'player' || isolationMode === 'layered';
      player.visible = showPlayer;
      player.traverse((object) => {
        object.visible = showPlayer;
      });
      return getSpState();
    };
    const getSpState = () => {
      const ctx = window.__gameDebug?.ctx;
      const surface = ctx?.surface;
      const player = ctx?.player?.mesh;
      const game = ctx?.game;
      const gridMat = surface?.gridMesh?.material;
      let centerWorld = null;
      let centerScreen = null;
      if (player) {
        const c = player.position.clone();
        player.getWorldPosition(c);
        centerWorld = c.toArray();
        const rect = game.renderer.domElement.getBoundingClientRect();
        const projected = c.clone().project(game.camera);
        centerScreen = {
          x: rect.left + (projected.x + 1) * rect.width / 2,
          y: rect.top + (1 - projected.y) * rect.height / 2,
          ndcZ: projected.z,
          inView: Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1
            && projected.z >= -1 && projected.z <= 1,
        };
      }
      return {
        ok: Boolean(surface && player),
        visualMode: localStorage.getItem('gw3d-visual-mode'),
        surfaceType: ctx?.surfaceType ?? null,
        renderer: {
          backend: game?.backend ?? null,
          isWebGPU: game?.isWebGPU ?? null,
          pixelRatio: game?.renderer?.getPixelRatio?.() ?? null,
        },
        surface: {
          meshRenderOrder: surface?.mesh?.renderOrder ?? null,
          gridRenderOrder: surface?.gridMesh?.renderOrder ?? null,
          gridDepthTest: gridMat?.depthTest ?? null,
          gridDepthWrite: gridMat?.depthWrite ?? null,
          gridOpacity: gridMat?.opacity ?? null,
        },
        player: { centerWorld, centerScreen },
      };
    };

    const setMode = mode === 'mp'
      ? (isolationMode) => window.__gameDebug?.setGridPlayerLayeringIsolation?.(isolationMode)
      : setSpMode;
    const getState = mode === 'mp'
      ? () => window.__gameDebug?.getGridPlayerLayeringState?.()
      : getSpState;

    const capture = async (isolationMode) => {
      const state = setMode(isolationMode);
      if (mode === 'sp') await waitFrames();
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const context = copy.getContext('2d', { willReadFrequently: true });
      if (!context) return { ok: false, reason: 'no 2d context', state };
      context.drawImage(canvas, 0, 0);
      return {
        ok: true,
        state: getState() ?? state,
        dataUrl: copy.toDataURL('image/png'),
        image: context.getImageData(0, 0, copy.width, copy.height),
      };
    };

    const background = await capture('background');
    const player = await capture('player');
    const grid = await capture('grid');
    const layered = await capture('layered');
    setMode('restore');
    await waitFrames();
    if (![background, player, grid, layered].every((entry) => entry.ok)) {
      return { ok: false, reason: 'capture failed', captures: { background, player, grid, layered } };
    }

    const state = layered.state;
    const rect = canvas.getBoundingClientRect();
    const screen = state?.player?.centerScreen;
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    const centerX = Number.isFinite(screen?.x)
      ? Math.round((screen.x - rect.left) * scaleX)
      : Math.round(canvas.width / 2);
    const centerY = Number.isFinite(screen?.y)
      ? Math.round((screen.y - rect.top) * scaleY)
      : Math.round(canvas.height / 2);
    const cropSize = 120;
    const cropX = Math.max(0, Math.min(canvas.width - cropSize, centerX - cropSize / 2));
    const cropY = Math.max(0, Math.min(canvas.height - cropSize, centerY - cropSize / 2));

    const metrics = {
      crop: { x: cropX, y: cropY, width: cropSize, height: cropSize, centerX, centerY },
      playerPixels: 0,
      gridPixels: 0,
      overlapPixels: 0,
      gridAffectsPlayerPixels: 0,
      preservedPlayerPixels: 0,
      maxLayerDelta: 0,
      maxGridDelta: 0,
      maxPlayerDelta: 0,
    };
    const bg = background.image.data;
    const pl = player.image.data;
    const gr = grid.image.data;
    const la = layered.image.data;
    const width = canvas.width;
    for (let y = cropY; y < cropY + cropSize; y++) {
      for (let x = cropX; x < cropX + cropSize; x++) {
        const i = (y * width + x) * 4;
        const playerDelta = Math.max(
          Math.abs(pl[i] - bg[i]),
          Math.abs(pl[i + 1] - bg[i + 1]),
          Math.abs(pl[i + 2] - bg[i + 2]),
        );
        const gridDelta = Math.max(
          Math.abs(gr[i] - bg[i]),
          Math.abs(gr[i + 1] - bg[i + 1]),
          Math.abs(gr[i + 2] - bg[i + 2]),
        );
        metrics.maxPlayerDelta = Math.max(metrics.maxPlayerDelta, playerDelta);
        metrics.maxGridDelta = Math.max(metrics.maxGridDelta, gridDelta);
        if (playerDelta > 12) metrics.playerPixels++;
        if (gridDelta > 12) metrics.gridPixels++;
        if (playerDelta <= 12 || gridDelta <= 12) continue;
        metrics.overlapPixels++;
        const layerDelta = Math.max(
          Math.abs(la[i] - pl[i]),
          Math.abs(la[i + 1] - pl[i + 1]),
          Math.abs(la[i + 2] - pl[i + 2]),
        );
        metrics.maxLayerDelta = Math.max(metrics.maxLayerDelta, layerDelta);
        if (layerDelta > 10) metrics.gridAffectsPlayerPixels++;
        else metrics.preservedPlayerPixels++;
      }
    }
    const overlap = Math.max(1, metrics.overlapPixels);
    const gridAffectsPlayerRatio = metrics.gridAffectsPlayerPixels / overlap;
    const reproduced = metrics.overlapPixels >= 8
      && metrics.gridAffectsPlayerPixels >= 4
      && gridAffectsPlayerRatio >= 0.18
      && metrics.maxLayerDelta >= 18;
    const fixed = metrics.overlapPixels >= 8
      && metrics.gridAffectsPlayerPixels <= Math.max(3, Math.floor(metrics.overlapPixels * 0.10));
    return {
      ok: true,
      proofMode: mode,
      reproduced,
      fixed,
      metrics: { ...metrics, gridAffectsPlayerRatio },
      states: {
        initial: getState(),
        background: background.state,
        player: player.state,
        grid: grid.state,
        layered: state,
      },
      dataUrls: {
        background: background.dataUrl,
        player: player.dataUrl,
        grid: grid.dataUrl,
        layered: layered.dataUrl,
      },
    };
  }, proofMode);

  const prefix = `${proofMode}-${SURFACE}`;
  if (result?.dataUrls) {
    result.screenshots = Object.fromEntries(Object.entries(result.dataUrls)
      .map(([name, dataUrl]) => [name, writePng(`${prefix}-${name}`, dataUrl)]));
    delete result.dataUrls;
  }
  return result;
}

function makeMarkdown(report) {
  const lines = [
    `# MP Pixelated Grid Layering ${report.phase}`,
    '',
    `- verdict: ${report.verdict}`,
    `- command: ${report.command}`,
    `- proof boundary: ${report.proofBoundary}`,
    `- report: ${relative(ROOT, JSON_PATH)}`,
    `- screenshot dir: ${relative(ROOT, ARTIFACT_DIR)}`,
    '',
    '## MP Result',
    '',
    `- reproduced: ${report.mp?.reproduced ?? false}`,
    `- fixed: ${report.mp?.fixed ?? false}`,
    `- grid depthTest: ${report.mp?.states?.layered?.surface?.gridDepthTest}`,
    `- overlap pixels: ${report.mp?.metrics?.overlapPixels}`,
    `- grid-affects-player pixels: ${report.mp?.metrics?.gridAffectsPlayerPixels}`,
    `- max layer delta: ${report.mp?.metrics?.maxLayerDelta}`,
  ];
  if (report.spControl) {
    lines.push(
      '',
      '## SP Adjacent Control',
      '',
      `- fixed: ${report.spControl.fixed}`,
      `- grid depthTest: ${report.spControl.states?.layered?.surface?.gridDepthTest}`,
      `- overlap pixels: ${report.spControl.metrics?.overlapPixels}`,
      `- grid-affects-player pixels: ${report.spControl.metrics?.gridAffectsPlayerPixels}`,
      `- max layer delta: ${report.spControl.metrics?.maxLayerDelta}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');

  const owned = [];
  const logs = [];
  let browser;
  let report;
  try {
    owned.push(startProcess(
      'npm',
      ['exec', '--', 'tsx', 'server/index.ts'],
      { PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0' },
      logs,
    ));
    owned.push(startProcess(
      'npm',
      ['exec', '--', 'vite', '--host', '127.0.0.1', '--port', String(DEV_PORT)],
      {},
      logs,
    ));
    const [serverReady, viteReady] = await Promise.all([
      waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`),
      waitForHttp(`http://127.0.0.1:${DEV_PORT}`),
    ]);
    if (!serverReady || !viteReady) {
      throw new Error(`Readiness failed: server=${serverReady} vite=${viteReady}`);
    }

    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: [
        '--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--window-size=960,720',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });

    const mpPage = await createPage(browser, 'mp');
    await runMpSetup(mpPage);
    const mp = await captureLayering(mpPage, 'mp');
    const mpErrors = criticalPageErrors(mpPage.__errors);
    const mpConsoleTail = mpPage.__consoleTail.slice(-50);
    await mpPage.close().catch(() => {});

    let spControl = null;
    let spErrors = [];
    let spConsoleTail = [];
    if (INCLUDE_SP_CONTROL) {
      const spPage = await createPage(browser, 'sp-control');
      await runSpSetup(spPage);
      spControl = await captureLayering(spPage, 'sp');
      spErrors = criticalPageErrors(spPage.__errors);
      spConsoleTail = spPage.__consoleTail.slice(-50);
      await spPage.close().catch(() => {});
    }

    const serverErrors = criticalServerErrors(logs);
    const pageErrors = [...mpErrors, ...spErrors];
    let verdict;
    if (PHASE === 'baseline') {
      verdict = mp?.reproduced ? 'REPRODUCED' : 'NO_REPRO';
    } else {
      verdict = mp?.fixed && (!INCLUDE_SP_CONTROL || spControl?.fixed) ? 'PASS' : 'FAIL';
    }
    if (!mp?.ok || pageErrors.length > 0 || serverErrors.length > 0) verdict = 'ERROR';

    report = {
      verdict,
      phase: PHASE,
      runId: RUN_ID,
      command: `node tests/visual/mp-pixelated-grid-layering-proof.mjs --phase=${PHASE} --port=${DEV_PORT} --server-port=${SERVER_PORT}${INCLUDE_SP_CONTROL ? ' --sp-control=true' : ''}`,
      proofBoundary: 'Linux headless Chrome, SwiftShader WebGL2 backend forced by ?renderer=webgl, loopback Colyseus MP plus optional SP adjacent control; no Windows/WebGPU/physical-LAN claim.',
      surface: SURFACE,
      visualMode: 'pixelated',
      chrome,
      devPort: DEV_PORT,
      serverPort: SERVER_PORT,
      mp,
      spControl,
      pageErrors,
      serverErrors,
      consoleTail: { mp: mpConsoleTail, sp: spConsoleTail },
      serverEvidence: logs
        .filter((line) => /Game started|client joined|room|Renderer selection/i.test(line))
        .slice(-80)
        .map(sanitizeEvidenceLine),
      artifacts: {
        json: relative(ROOT, JSON_PATH),
        markdown: relative(ROOT, MD_PATH),
        screenshots: relative(ROOT, ARTIFACT_DIR),
      },
    };
  } catch (error) {
    report = {
      verdict: 'ERROR',
      phase: PHASE,
      runId: RUN_ID,
      error: error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error),
      serverErrors: criticalServerErrors(logs),
      serverLogTail: logs.slice(-120).map(sanitizeEvidenceLine),
      artifacts: {
        json: relative(ROOT, JSON_PATH),
        markdown: relative(ROOT, MD_PATH),
        screenshots: relative(ROOT, ARTIFACT_DIR),
      },
    };
  } finally {
    await browser?.close().catch(() => {});
    for (const child of owned.reverse()) await stopProcessTree(child);
    writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(MD_PATH, makeMarkdown(report));
    console.log(JSON.stringify({ verdict: report.verdict, report: relative(ROOT, JSON_PATH) }, null, 2));
  }

  if (PHASE === 'baseline') {
    if (!['REPRODUCED', 'NO_REPRO'].includes(report.verdict)) process.exitCode = 1;
  } else if (report.verdict !== 'PASS') {
    process.exitCode = 1;
  }
}

await main();
