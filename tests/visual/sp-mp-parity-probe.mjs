#!/usr/bin/env node
/**
 * Focused real-path SP/MP camera, aim, movement, and portal parity probe.
 *
 * SP path: index.html -> src/main.ts quickStart -> src/core/GameLoop.ts
 * MP path: index.html -> src/main.ts network mode -> src/network-main.ts + server/rooms/GameRoom.ts
 */

import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

function commandPath(command) {
  try {
    return execSync(`command -v ${command}`, { encoding: 'utf8' }).trim().split('\n')[0] || null;
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

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  commandPath('google-chrome'),
  commandPath('chromium'),
  commandPath('chromium-browser'),
  ...findCachedPuppeteerChrome(),
  '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
].filter(Boolean);

const CHROME_PATH = CHROME_CANDIDATES.find((path) => existsSync(path)) || CHROME_CANDIDATES[0];
const NVM_PATH = process.env.NVM_BIN || dirname(process.execPath) || '/home/antoine/.nvm/versions/node/v20.19.5/bin';
const DEV_PORT = Number(getArg('port', '3000'));
const COLYSEUS_PORT = Number(getArg('colyseus-port', '2567'));
const BASE_URL = `http://localhost:${DEV_PORT}`;
const RENDERER_ARG = getArg('renderer', 'webgl');
const SP_DURATION = Number(getArg('sp-duration', getArg('duration', '14')));
const MP_DURATION = Number(getArg('mp-duration', '42'));
const SAMPLE_MS = Number(getArg('sample-ms', '750'));
const PORTAL_RETRY = !hasFlag('no-portal-retry');
const SURFACES = (getArg('surfaces', 'cube-tunnel,peanut') || 'cube-tunnel,peanut')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_DIR = resolve(PROJECT_ROOT, 'reports');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/sp-mp-parity', timestamp);
mkdirSync(REPORT_DIR, { recursive: true });
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const REPORT_PATH = resolve(REPORT_DIR, `sp-mp-parity-probe-${timestamp}.json`);
const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=960,540',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function vec(v) {
  if (!v) return null;
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}

function dist(a, b) {
  if (!a || !b) return null;
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dy = (a.y ?? 0) - (b.y ?? 0);
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function dot(a, b) {
  if (!a || !b) return null;
  return (a.x ?? 0) * (b.x ?? 0) + (a.y ?? 0) * (b.y ?? 0) + (a.z ?? 0) * (b.z ?? 0);
}

function quatAngle(a, b) {
  if (!a || !b) return null;
  const d = Math.abs((a.x ?? 0) * (b.x ?? 0) + (a.y ?? 0) * (b.y ?? 0) + (a.z ?? 0) * (b.z ?? 0) + (a.w ?? 1) * (b.w ?? 1));
  return 2 * Math.acos(Math.min(1, Math.max(-1, d)));
}

function angleBetween(a, b) {
  const d = dot(a, b);
  if (d === null) return null;
  const la = Math.sqrt(dot(a, a) ?? 0);
  const lb = Math.sqrt(dot(b, b) ?? 0);
  if (la < 1e-6 || lb < 1e-6) return null;
  return Math.acos(Math.min(1, Math.max(-1, d / (la * lb))));
}

function stats(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  const variance = nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / nums.length;
  return { count: nums.length, min, max, mean, stddev: Math.sqrt(variance) };
}

function portListeners(port) {
  try {
    const output = execSync(`ss -tlnp 2>/dev/null | rg ':${port}\\b' || true`, { encoding: 'utf8', cwd: PROJECT_ROOT });
    return output.trim();
  } catch {
    return '';
  }
}

function assertPortFree(port, label) {
  const listeners = portListeners(port);
  if (listeners) {
    throw new Error(`${label} port ${port} is already in use:\n${listeners}`);
  }
}

async function waitForServer(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // not ready
    }
    await sleep(500);
  }
  return false;
}

function spawnLogged(command, commandArgs, envExtra = {}) {
  const env = {
    ...process.env,
    ...envExtra,
    PATH: `${NVM_PATH}:/usr/bin:/bin`,
  };
  const proc = spawn(command, commandArgs, {
    cwd: PROJECT_ROOT,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.__output = '';
  const collect = (data) => {
    proc.__output += data.toString();
    if (proc.__output.length > 8000) proc.__output = proc.__output.slice(-8000);
  };
  proc.stdout.on('data', collect);
  proc.stderr.on('data', collect);
  return proc;
}

async function stopProcessTree(proc, label) {
  if (!proc || proc.exitCode !== null) return;
  const waitForClose = (timeoutMs) => new Promise((resolveWait) => {
    const timer = setTimeout(() => resolveWait(false), timeoutMs);
    proc.once('close', () => {
      clearTimeout(timer);
      resolveWait(true);
    });
  });
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try { proc.kill('SIGTERM'); } catch { /* already closed */ }
  }
  if (await waitForClose(2500)) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try { proc.kill('SIGKILL'); } catch { /* already closed */ }
  }
  if (!await waitForClose(1500)) {
    console.warn(`  WARN: ${label} process tree did not report close after SIGKILL`);
  }
}

async function startVite() {
  assertPortFree(DEV_PORT, 'Vite');
  const proc = spawnLogged(`${NVM_PATH}/npx`, ['vite', '--host', '127.0.0.1', '--port', String(DEV_PORT), '--strictPort']);
  const ready = await waitForServer(BASE_URL, 30000);
  if (!ready) {
    proc.kill('SIGTERM');
    throw new Error(`Vite did not start on ${BASE_URL}. Output:\n${proc.__output}`);
  }
  return proc;
}

async function startColyseus() {
  assertPortFree(COLYSEUS_PORT, 'Colyseus');
  const proc = spawnLogged(`${NVM_PATH}/npx`, ['tsx', 'server/index.ts'], {
    PORT: String(COLYSEUS_PORT),
    SHUTDOWN_TIMEOUT: '0',
  });
  const ready = await waitForServer(`http://localhost:${COLYSEUS_PORT}/health`, 30000);
  if (!ready) {
    proc.kill('SIGTERM');
    throw new Error(`Colyseus did not start on ${COLYSEUS_PORT}. Output:\n${proc.__output}`);
  }
  return proc;
}

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  const errors = [];
  const logs = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
  });
  page.__errors = errors;
  page.__logs = logs;
  return page;
}

function relevantPageErrors(errors) {
  return (errors ?? [])
    .map((error) => String(error ?? '').trim())
    .filter(Boolean);
}

async function screenshot(page, name) {
  const path = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path }).catch(() => {});
  return path;
}

async function waitForCondition(fn, timeoutMs = 15000, pollMs = 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return true;
    await sleep(pollMs);
  }
  return false;
}

async function getDebug(page, method) {
  return page.evaluate((name) => {
    const debug = window.__gameDebug;
    if (!debug || typeof debug[name] !== 'function') return null;
    return debug[name]();
  }, method);
}

async function clickStartGame(page) {
  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const button of buttons) {
      const text = (button.textContent || '').trim();
      if ((text.includes('START GAME') || text.includes('PLAY AGAIN')) &&
          (button.offsetParent !== null || getComputedStyle(button).display !== 'none')) {
        button.click();
        return true;
      }
    }
    return false;
  });
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const button of buttons) {
      const text = (button.textContent || '').trim();
      if (['X', 'x', 'CLOSE', 'SKIP', 'RESUME'].includes(text) || text === '\u00d7') {
        if (button.offsetParent !== null || getComputedStyle(button).display !== 'none') button.click();
      }
    }
  }).catch(() => {});
}

async function getSpSample(page) {
  return page.evaluate(() => {
    const api = window.__TEST_API;
    const parity = api && typeof api.getParityFrame === 'function' ? api.getParityFrame() : null;
    return {
      kind: 'sp',
      parity,
      telemetry: window.__GAME_TELEMETRY || null,
      now: performance.now(),
    };
  });
}

async function getMpSample(page) {
  return page.evaluate(() => ({
    kind: 'mp',
    telemetry: window.__GAME_TELEMETRY || null,
    debug: {
      connected: window.__gameDebug?.isConnected?.() ?? null,
      waveText: window.__gameDebug?.getWaveText?.() ?? null,
      playerCount: window.__gameDebug?.getPlayerCount?.() ?? null,
    },
    now: performance.now(),
  }));
}

async function collectCanvasStats(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { ok: false, reason: 'no_canvas' };
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const ctx = tmp.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, reason: 'no_2d_context' };
    ctx.drawImage(canvas, 0, 0);
    let samples = 0;
    let nonDark = 0;
    let lumaTotal = 0;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const px = Math.min(canvas.width - 1, Math.round(((x + 0.5) / 20) * canvas.width));
        const py = Math.min(canvas.height - 1, Math.round(((y + 0.5) / 20) * canvas.height));
        const d = ctx.getImageData(px, py, 1, 1).data;
        const luma = d[0] * 0.2126 + d[1] * 0.7152 + d[2] * 0.0722;
        if (luma > 18 || d[0] > 35 || d[1] > 35 || d[2] > 35) nonDark++;
        lumaTotal += luma;
        samples++;
      }
    }
    return {
      ok: true,
      width: canvas.width,
      height: canvas.height,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      nonDarkRate: samples ? nonDark / samples : 0,
      meanLuma: samples ? lumaTotal / samples : 0,
    };
  }).catch((err) => ({ ok: false, reason: err.message }));
}

async function driveInput(page, step, mode) {
  const keys = mode === 'cube-tunnel' ? ['w', 'd', 'w', 'a'] : ['w', 'd', 's', 'a'];
  const key = keys[step % keys.length];
  const x = 480 + Math.cos(step * 0.8) * 190;
  const y = 270 + Math.sin(step * 0.6) * 145;
  await page.evaluate(({ x: clientX, y: clientY }) => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX, clientY, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX, clientY, bubbles: true }));
  }, { x, y });
  await page.keyboard.down(key);
  await sleep(Math.max(250, Math.floor(SAMPLE_MS * 0.65)));
  await page.keyboard.up(key).catch(() => {});
  return { key, aimScreen: { x, y } };
}

function normalizeSample(sample) {
  const parity = sample?.parity;
  const telemetry = sample?.telemetry;
  if (sample?.kind === 'sp') {
    return {
      time: parity?.time ?? telemetry?.time ?? null,
      frame: parity?.frame ?? telemetry?.frame ?? null,
      renderer: parity?.renderer ?? null,
      player: parity?.player ?? telemetry?.player ?? null,
      camera: parity?.camera ?? null,
      aim: parity?.aim ?? null,
      movement: parity?.movement ?? null,
      portals: parity?.portals ?? null,
      raw: sample,
    };
  }
  return {
    time: telemetry?.time ?? null,
    frame: telemetry?.frame ?? null,
    renderer: telemetry?.renderer ?? null,
    player: {
      ...(telemetry?.player ?? {}),
      normal: telemetry?.camera?.serverNormal,
      tangent: telemetry?.camera?.serverTangent,
      bitangent: telemetry?.camera?.serverBitangent,
      worldPos: telemetry?.player?.worldPos,
    },
    camera: telemetry?.camera ? {
      ...telemetry.camera,
      outsideSurfaceDot: dot(
        {
          x: (telemetry.camera.position?.x ?? 0) - (telemetry.player?.worldPos?.x ?? 0),
          y: (telemetry.camera.position?.y ?? 0) - (telemetry.player?.worldPos?.y ?? 0),
          z: (telemetry.camera.position?.z ?? 0) - (telemetry.player?.worldPos?.z ?? 0),
        },
        telemetry.camera.serverNormal,
      ),
    } : null,
    aim: telemetry?.aim ? {
      ...telemetry.aim,
      latestBullet: telemetry?.bullets?.recentSpawns?.slice(-1)[0] ?? telemetry?.bullets?.active?.slice(-1)[0] ?? null,
      bulletCount: telemetry?.bullets?.count ?? 0,
    } : null,
    movement: {
      input: telemetry?.aim?.lastSentInput
        ? { moveX: telemetry.aim.lastSentInput.moveX, moveY: telemetry.aim.lastSentInput.moveY }
        : null,
      serverSampleAgeMs: telemetry?.camera?.renderTarget?.serverSampleAgeMs ?? null,
      snapCount: telemetry?.camera?.renderTarget?.snapCount ?? null,
      resetCount: telemetry?.camera?.renderTarget?.resetCount ?? null,
    },
    portals: telemetry?.portals ?? null,
    raw: sample,
  };
}

function summarizeCase(samples) {
  const norm = samples.map(normalizeSample).filter((sample) => sample.time !== null || sample.frame !== null);
  const distances = norm.map((sample) => sample.camera?.distanceToPlayer);
  const outsideDots = norm.map((sample) => sample.camera?.outsideSurfaceDot);
  const qAngles = [];
  const upAngles = [];
  const movementDistances = [];
  const faceIndexes = [];
  const portalDeltas = [];
  const portalTriggerDists = [];
  const portalVisualDists = [];
  const bulletOriginDists = [];
  const bulletAimDots = [];
  const shootingSamples = [];
  const bulletCounts = [];
  const teleportCandidates = [];
  let portalActiveSamples = 0;
  let bulletSamples = 0;

  for (let i = 0; i < norm.length; i++) {
    const current = norm[i];
    const previous = norm[i - 1];
    if (previous) {
      const qAngle = quatAngle(previous.camera?.quaternion, current.camera?.quaternion);
      if (qAngle !== null) qAngles.push(qAngle);
      const upAngle = angleBetween(previous.camera?.up, current.camera?.up);
      if (upAngle !== null) upAngles.push(upAngle);
      const moveDist = dist(previous.player?.worldPos, current.player?.worldPos);
      if (moveDist !== null) movementDistances.push(moveDist);
      if (moveDist !== null && moveDist > 3.5 && current.portals?.active) {
        teleportCandidates.push({
          fromTime: previous.time,
          toTime: current.time,
          moveDist,
          snapCount: current.movement?.snapCount ?? null,
          resetCount: current.movement?.resetCount ?? null,
        });
      }
    }
    if (current.player && Number.isFinite(current.player.faceIndex)) faceIndexes.push(current.player.faceIndex);
    const latestBullet = current.aim?.latestBullet;
    if (current.aim?.lastSentInput && typeof current.aim.lastSentInput.shooting === 'boolean') {
      shootingSamples.push(current.aim.lastSentInput.shooting ? 1 : 0);
    } else if (current.aim?.input && typeof current.aim.input.shooting === 'boolean') {
      shootingSamples.push(current.aim.input.shooting ? 1 : 0);
    }
    if (Number.isFinite(current.aim?.bulletCount)) bulletCounts.push(current.aim.bulletCount);
    if (latestBullet) {
      bulletSamples++;
      if (Number.isFinite(latestBullet.distToPlayer)) bulletOriginDists.push(latestBullet.distToPlayer);
      const bulletDir = latestBullet.worldDir ?? latestBullet;
      const projectedUp = current.camera?.projectedUp ?? current.camera?.matrixUp ?? current.camera?.up;
      const aimDot = dot(vec(bulletDir), vec(projectedUp));
      if (aimDot !== null) bulletAimDots.push(aimDot);
    }
    const portals = current.portals;
    if (portals?.active) {
      portalActiveSamples++;
      for (const portal of portals.visualWorld ?? []) {
        if (Number.isFinite(portal.visualTriggerDelta)) portalDeltas.push(portal.visualTriggerDelta);
        if (Number.isFinite(portal.playerTriggerWorldDist)) portalTriggerDists.push(portal.playerTriggerWorldDist);
        if (Number.isFinite(portal.playerWorldDist)) portalVisualDists.push(portal.playerWorldDist);
      }
    }
  }

  const uniqueFaces = [...new Set(faceIndexes)];
  return {
    sampleCount: norm.length,
    renderer: norm.find((sample) => sample.renderer)?.renderer ?? null,
    timeRange: {
      start: norm[0]?.time ?? null,
      end: norm[norm.length - 1]?.time ?? null,
    },
    camera: {
      distanceToPlayer: stats(distances),
      outsideSurfaceDot: stats(outsideDots),
      quaternionAngularDeltaRad: stats(qAngles),
      upAngularDeltaRad: stats(upAngles),
      minOutsideSurfaceDot: stats(outsideDots)?.min ?? null,
      insideSurfaceSuspect: (stats(outsideDots)?.min ?? 1) < 0.05,
    },
    movement: {
      movedDistanceTotal: movementDistances.reduce((sum, value) => sum + value, 0),
      perSampleDistance: stats(movementDistances),
      uniqueFaceCount: uniqueFaces.length,
      faceIndexes: uniqueFaces.slice(0, 20),
      transitionObserved: uniqueFaces.length > 1 || movementDistances.some((value) => value > 0.5),
      teleportCandidates,
    },
    aim: {
      bulletSamples,
      shootingSamples: shootingSamples.length,
      shootingTrueSamples: shootingSamples.filter((value) => value === 1).length,
      bulletCount: stats(bulletCounts),
      bulletOriginDistance: stats(bulletOriginDists),
      bulletProjectedUpDot: stats(bulletAimDots),
      latestBullet: norm.slice().reverse().find((sample) => sample.aim?.latestBullet)?.aim?.latestBullet ?? null,
    },
    portals: {
      activeSamples: portalActiveSamples,
      visualTriggerDelta: stats(portalDeltas),
      playerTriggerWorldDist: stats(portalTriggerDists),
      playerVisualWorldDist: stats(portalVisualDists),
      maxVisualTriggerDelta: stats(portalDeltas)?.max ?? null,
      alignmentSuspect: (stats(portalDeltas)?.max ?? 0) > 0.35,
    },
  };
}

async function runSpCase(browser, surface) {
  const page = await createPage(browser);
  const caseId = `sp-${surface}-waves`;
  const screenshots = [];
  const samples = [];
  const inputTrace = [];
  try {
    await page.evaluateOnNewDocument(() => { localStorage.clear(); });
    const params = new URLSearchParams({
      quickStart: 'true',
      surface,
      gameMode: 'waves',
      debug: 'true',
      testMode: 'true',
      godMode: 'true',
    });
    if (RENDERER_ARG) params.set('renderer', RENDERER_ARG);
    await page.goto(`${BASE_URL}?${params.toString()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const ready = await waitForCondition(async () => {
      const sample = await getSpSample(page);
      return sample?.parity && !sample.parity.error && sample.parity.frame > 0;
    }, 30000, 500);
    screenshots.push(await screenshot(page, `${caseId}-start`));
    if (!ready) throw new Error('SP TestHarnessAPI parity frame did not become ready');

    const steps = Math.max(1, Math.ceil((SP_DURATION * 1000) / SAMPLE_MS));
    for (let i = 0; i < steps; i++) {
      inputTrace.push(await driveInput(page, i, surface));
      samples.push(await getSpSample(page));
      if (i === Math.floor(steps / 2)) screenshots.push(await screenshot(page, `${caseId}-mid`));
      await sleep(Math.max(50, SAMPLE_MS - Math.floor(SAMPLE_MS * 0.65)));
    }
    await page.mouse.up({ button: 'left' }).catch(() => {});
    screenshots.push(await screenshot(page, `${caseId}-end`));
    const canvas = await collectCanvasStats(page);
    const pageErrors = relevantPageErrors(page.__errors);
    return {
      id: caseId,
      path: 'src/main.ts -> src/core/GameLoop.ts',
      mode: 'waves',
      surface,
      status: pageErrors.length > 0 ? 'FAIL' : 'PASS',
      error: pageErrors.length > 0 ? `Relevant page errors: ${pageErrors.slice(0, 3).join(' | ')}` : undefined,
      durationSeconds: SP_DURATION,
      samples,
      summary: summarizeCase(samples),
      screenshots,
      inputTrace,
      canvas,
      errors: pageErrors,
      consoleTail: page.__logs.slice(-80),
    };
  } catch (err) {
    screenshots.push(await screenshot(page, `${caseId}-error`).catch(() => null));
    return {
      id: caseId,
      path: 'src/main.ts -> src/core/GameLoop.ts',
      mode: 'waves',
      surface,
      status: 'FAIL',
      error: err instanceof Error ? err.message : String(err),
      samples,
      summary: summarizeCase(samples),
      screenshots: screenshots.filter(Boolean),
      errors: page.__errors,
      consoleTail: page.__logs.slice(-120),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function runMpCase(browser, surface, mode = 'pvpve', durationSeconds = MP_DURATION, labelSuffix = '') {
  const page = await createPage(browser);
  const caseId = `mp-${surface}-${mode}${labelSuffix}`;
  const screenshots = [];
  const samples = [];
  const inputTrace = [];
  try {
    await page.evaluateOnNewDocument(() => { localStorage.clear(); });
    const params = new URLSearchParams({
      mode: 'network',
      surface,
      server: `ws://localhost:${COLYSEUS_PORT}`,
      debug: 'true',
      testMode: 'true',
      name: 'WorkerAJ',
      creator: '1',
      gameMode: mode,
      pvpMode: mode === 'pvpve' || mode === 'pvp' ? mode : 'pvpve',
      godMode: 'true',
    });
    if (RENDERER_ARG) params.set('renderer', RENDERER_ARG);
    await page.goto(`${BASE_URL}?${params.toString()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const connected = await waitForCondition(async () => Boolean(await getDebug(page, 'isConnected')), 30000, 500);
    screenshots.push(await screenshot(page, `${caseId}-lobby`));
    if (!connected) throw new Error('MP client did not connect to Colyseus');

    let startClicked = false;
    for (let attempt = 0; attempt < 8 && !startClicked; attempt++) {
      await dismissOverlays(page);
      startClicked = await clickStartGame(page);
      if (!startClicked) await sleep(1500);
    }
    const gameStarted = await waitForCondition(async () => {
      const t = (await getMpSample(page))?.telemetry;
      return t && t.frame > 0 && t.network?.connected && t.gameMode === mode;
    }, 30000, 750);
    if (!gameStarted) {
      const last = await getMpSample(page);
      throw new Error(`MP game did not start in mode=${mode}; startClicked=${startClicked}; lastMode=${last?.telemetry?.gameMode ?? 'none'}`);
    }
    screenshots.push(await screenshot(page, `${caseId}-start`));

    const steps = Math.max(1, Math.ceil((durationSeconds * 1000) / SAMPLE_MS));
    for (let i = 0; i < steps; i++) {
      if (i % 8 === 0) {
        await dismissOverlays(page);
        const waveText = await getDebug(page, 'getWaveText');
        if (typeof waveText === 'string' && (waveText.includes('VOTING') || waveText.includes('GAME OVER') || waveText.includes('Waiting'))) {
          await clickStartGame(page).catch(() => {});
        }
      }
      inputTrace.push(await driveInput(page, i, surface));
      const sample = await getMpSample(page);
      samples.push(sample);
      if (i === Math.floor(steps / 2)) screenshots.push(await screenshot(page, `${caseId}-mid`));
      const portalsActive = sample?.telemetry?.portals?.active;
      if (portalsActive && !screenshots.some((path) => path.includes(`${caseId}-portal`))) {
        screenshots.push(await screenshot(page, `${caseId}-portal`));
      }
      await sleep(Math.max(50, SAMPLE_MS - Math.floor(SAMPLE_MS * 0.65)));
    }
    await page.mouse.up({ button: 'left' }).catch(() => {});
    screenshots.push(await screenshot(page, `${caseId}-end`));
    const canvas = await collectCanvasStats(page);
    const pageErrors = relevantPageErrors(page.__errors);
    return {
      id: caseId,
      path: 'src/main.ts -> src/network-main.ts + server/rooms/GameRoom.ts',
      mode,
      surface,
      status: pageErrors.length > 0 ? 'FAIL' : 'PASS',
      error: pageErrors.length > 0 ? `Relevant page errors: ${pageErrors.slice(0, 3).join(' | ')}` : undefined,
      durationSeconds,
      samples,
      summary: summarizeCase(samples),
      screenshots,
      inputTrace,
      canvas,
      errors: pageErrors,
      consoleTail: page.__logs.slice(-100),
    };
  } catch (err) {
    screenshots.push(await screenshot(page, `${caseId}-error`).catch(() => null));
    return {
      id: caseId,
      path: 'src/main.ts -> src/network-main.ts + server/rooms/GameRoom.ts',
      mode,
      surface,
      status: 'FAIL',
      error: err instanceof Error ? err.message : String(err),
      samples,
      summary: summarizeCase(samples),
      screenshots: screenshots.filter(Boolean),
      errors: page.__errors,
      consoleTail: page.__logs.slice(-150),
    };
  } finally {
    await page.close().catch(() => {});
  }
}

function classify(results) {
  const failures = [];
  const suspects = [];
  for (const result of results) {
    const pageErrors = relevantPageErrors(result.errors);
    if (result.status !== 'PASS' || pageErrors.length > 0) {
      failures.push({
        id: result.id,
        error: result.error ?? (pageErrors.length > 0 ? `Relevant page errors: ${pageErrors.slice(0, 3).join(' | ')}` : null),
        pageErrors,
      });
    }
    if (pageErrors.length > 0) {
      suspects.push({ id: result.id, kind: 'page_error', count: pageErrors.length, sample: pageErrors.slice(0, 3) });
    }
    if (result.summary?.camera?.insideSurfaceSuspect) {
      suspects.push({ id: result.id, kind: 'camera_inside_surface', minOutsideSurfaceDot: result.summary.camera.minOutsideSurfaceDot });
    }
    if (result.summary?.portals?.alignmentSuspect) {
      suspects.push({ id: result.id, kind: 'portal_visual_trigger_alignment', maxVisualTriggerDelta: result.summary.portals.maxVisualTriggerDelta });
    }
    const bulletOriginMax = result.summary?.aim?.bulletOriginDistance?.max;
    if (Number.isFinite(bulletOriginMax) && bulletOriginMax > 2.5) {
      suspects.push({ id: result.id, kind: 'bullet_origin_far_from_player', maxDist: bulletOriginMax });
    }
    if (result.id.startsWith('mp-')
        && (result.summary?.aim?.shootingTrueSamples ?? 0) >= Math.max(3, Math.floor((result.summary?.aim?.shootingSamples ?? 0) * 0.5))
        && (result.summary?.aim?.bulletCount?.max ?? 0) === 0) {
      suspects.push({
        id: result.id,
        kind: 'mp_projectile_missing_while_shooting',
        shootingTrueSamples: result.summary?.aim?.shootingTrueSamples ?? 0,
        bulletCountMax: result.summary?.aim?.bulletCount?.max ?? 0,
      });
    }
  }
  return {
    outcome: failures.length > 0
      ? 'PROBE_FAILURE'
      : suspects.length > 0
        ? 'DEFECT_REPRODUCED'
        : 'NO_REPRO_BOUNDED',
    failures,
    suspects,
    claimBoundary: 'Linux WSL2 headless Chromium/SwiftShader/WebGL proof only; no Windows hardware WebGPU or two-device LAN feel coverage.',
  };
}

async function main() {
  if (!existsSync(CHROME_PATH)) throw new Error(`Chrome not found. Tried: ${CHROME_CANDIDATES.join(', ')}`);
  console.log('SP/MP parity probe');
  console.log(`  surfaces=${SURFACES.join(', ')} renderer=${RENDERER_ARG} spDuration=${SP_DURATION}s mpDuration=${MP_DURATION}s`);
  console.log(`  Vite=${BASE_URL} Colyseus=${COLYSEUS_PORT}`);
  console.log(`  report=${REPORT_PATH}`);
  console.log(`  screenshots=${SCREENSHOT_DIR}`);

  const initialPorts = {
    vite: portListeners(DEV_PORT),
    colyseus: portListeners(COLYSEUS_PORT),
  };
  if (initialPorts.vite || initialPorts.colyseus) {
    throw new Error(`Required ports are not free before probe.\n3000: ${initialPorts.vite}\n2567: ${initialPorts.colyseus}`);
  }

  let viteProc = null;
  let colyseusProc = null;
  let browser = null;
  const results = [];
  try {
    viteProc = await startVite();
    console.log('  Vite ready');
    colyseusProc = await startColyseus();
    console.log('  Colyseus ready');
    browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', args: LAUNCH_ARGS });

    for (const surface of SURFACES) {
      console.log(`  SP ${surface} waves`);
      results.push(await runSpCase(browser, surface));
      console.log(`    ${results[results.length - 1].status}`);
      console.log(`  MP ${surface} pvpve`);
      results.push(await runMpCase(browser, surface, 'pvpve', MP_DURATION));
      console.log(`    ${results[results.length - 1].status}`);
    }

    const primaryMpPortalSamples = results
      .filter((result) => result.id.startsWith('mp-'))
      .reduce((sum, result) => sum + (result.summary?.portals?.activeSamples ?? 0), 0);
    if (PORTAL_RETRY && primaryMpPortalSamples === 0) {
      console.log('  MP portal retry cube-ring king');
      results.push(await runMpCase(browser, 'cube-ring', 'king', Math.max(MP_DURATION, 42), '-portal-retry'));
      console.log(`    ${results[results.length - 1].status}`);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      worker: 'Worker AJ',
      task: 'tasks/codex-2026-07-31-sp-mp-camera-aim-portal-parity-pass.md',
      paths: {
        sp: 'src/main.ts -> src/core/GameLoop.ts',
        mp: 'src/main.ts -> src/network-main.ts + server/rooms/GameRoom.ts',
      },
      environment: {
        node: process.version,
        chromePath: CHROME_PATH,
        baseUrl: BASE_URL,
        colyseusPort: COLYSEUS_PORT,
        rendererArg: RENDERER_ARG,
        launchArgs: LAUNCH_ARGS,
        initialPorts,
      },
      requiredSurfaceSet: [
        'cube-tunnel SP waves',
        'cube-tunnel MP pvpve',
        'peanut SP waves',
        'peanut MP pvpve',
      ],
      proofBudget: 'target_plus_adjacent_control',
      results,
      classification: classify(results),
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`  wrote ${REPORT_PATH}`);
    console.log(`  outcome=${report.classification.outcome}`);
    if (report.classification.suspects.length > 0) {
      console.log(`  suspects=${JSON.stringify(report.classification.suspects)}`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopProcessTree(colyseusProc, 'Colyseus');
    await stopProcessTree(viteProc, 'Vite');
  }
}

main().catch((err) => {
  const failure = {
    generatedAt: new Date().toISOString(),
    worker: 'Worker AJ',
    task: 'tasks/codex-2026-07-31-sp-mp-camera-aim-portal-parity-pass.md',
    classification: {
      outcome: 'PROBE_FAILURE',
      failures: [{ id: 'probe-runner', error: err instanceof Error ? err.message : String(err) }],
      suspects: [],
    },
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(err);
  process.exit(1);
});
