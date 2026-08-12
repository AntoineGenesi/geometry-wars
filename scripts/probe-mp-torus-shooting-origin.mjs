#!/usr/bin/env node
/**
 * Focused MP torus shooting-origin proof.
 *
 * Starts real Vite + Colyseus, connects one desktop host and one
 * mobile-emulated joined client, starts a torus network game, fires from each
 * page through browser input, and asserts owner, origin distance, world
 * direction, and trajectory telemetry from src/network-main.ts + GameRoom.ts.
 */
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORT = Number(getArg('port') || process.env.DEV_PORT || 3046);
const SERVER_PORT = Number(getArg('server-port') || process.env.SERVER_PORT || 2576);
const SURFACE = getArg('surface') || 'torus';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = resolve(ROOT, 'test-screenshots/mp-torus-shooting-origin', RUN_ID);
const REPORT_PATH = resolve(ROOT, 'reports', `mp-torus-shooting-origin-${RUN_ID}.json`);
const NODE_BIN = dirname(process.execPath);
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

function startProcess(command, args, env, logs) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, PATH: `${NODE_BIN}:/usr/bin:/bin`, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const capture = (stream, source) => stream.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      if (!line.trim()) continue;
      logs.push(`[${source}] ${line}`);
      if (logs.length > 600) logs.shift();
    }
  });
  capture(child.stdout, 'proc');
  capture(child.stderr, 'proc-error');
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
  await sleep(500);
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Process group exited after SIGTERM.
  }
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // Retry within bounded window.
    }
    await sleep(350);
  }
  return false;
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

async function createPage(browser, label, mobile, evidence) {
  const page = await browser.newPage();
  if (mobile) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  } else {
    await page.setViewport({ width: 960, height: 720, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
  }
  page.on('pageerror', (error) => evidence.pageErrors.push(`[${label}] ${error.message}`));
  page.on('console', (message) => {
    const line = `[${label}:${message.type()}] ${message.text()}`;
    evidence.consoleTail.push(line);
    if (evidence.consoleTail.length > 220) evidence.consoleTail.shift();
    if (message.type() === 'error') evidence.pageErrors.push(line);
  });
  return page;
}

async function navigateNetwork(page, name, creator) {
  const params = new URLSearchParams({
    mode: 'network',
    surface: SURFACE,
    server: `ws://127.0.0.1:${SERVER_PORT}`,
    debug: 'true',
    testMode: 'true',
    godMode: 'true',
    name,
    gameMode: 'waves',
    renderer: 'webgl',
    music: 'false',
  });
  if (creator) params.set('creator', '1');
  await page.goto(`http://127.0.0.1:${DEV_PORT}?${params.toString()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
}

function vectorLength(v) {
  if (!v) return 0;
  return Math.hypot(v.x ?? v[0] ?? 0, v.y ?? v[1] ?? 0, v.z ?? v[2] ?? 0);
}

function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a.x ?? 0) - (b.x ?? 0), (a.y ?? 0) - (b.y ?? 0), (a.z ?? 0) - (b.z ?? 0));
}

function trajectoryDistance(samples) {
  if (!samples || samples.length < 2) return 0;
  return distance(samples[0].world, samples[samples.length - 1].world);
}

function criticalPageErrors(errors) {
  return errors.filter((message) =>
    !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated|WebGPU|No available adapters/i.test(message));
}

function criticalServerErrors(logs) {
  return logs.filter((line) => /\b(fatal|uncaught|unhandled|exception|error:)\b/i.test(line));
}

function sanitizeLine(line) {
  return line.replaceAll(ROOT, '<project-root>');
}

async function telemetry(page) {
  return page.evaluate(() => window.__GAME_TELEMETRY || null);
}

async function debugState(page) {
  return page.evaluate(() => window.__gameDebug?.getChevronAimProofState?.() || null);
}

async function knownSpawnIds(page) {
  const t = await telemetry(page);
  return new Set((t?.bullets?.recentSpawns || []).map((spawn) => spawn.id));
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    window.focus();
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const text = (btn.textContent || '').trim();
      if (text === 'RESUME' || text === 'X' || text === 'x' || text === 'CLOSE' || text === 'SKIP') {
        if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') btn.click();
      }
    }
  }).catch(() => {});
}

async function startDesktopShot(page) {
  await page.evaluate(() => {
    window.focus();
    const x = Math.floor(window.innerWidth * 0.72);
    const y = Math.floor(window.innerHeight * 0.34);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: x, clientY: y, bubbles: true }));
  });
}

async function stopDesktopShot(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
  }).catch(() => {});
}

async function startMobileTouchShot(page) {
  await page.evaluate(() => {
    window.focus();
    const target = document.body;
    const sx = Math.floor(window.innerWidth * 0.72);
    const sy = Math.floor(window.innerHeight * 0.68);
    const mx = Math.floor(window.innerWidth * 0.86);
    const my = Math.floor(window.innerHeight * 0.60);
    const makeTouch = (x, y) => typeof Touch === 'function'
      ? new Touch({ identifier: 42, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y })
      : { identifier: 42, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y };
    const dispatchTouch = (type, touch, touches) => {
      const event = typeof TouchEvent === 'function'
        ? new TouchEvent(type, {
          touches,
          targetTouches: touches,
          changedTouches: [touch],
          bubbles: true,
          cancelable: true,
        })
        : new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      Object.defineProperty(event, 'targetTouches', { value: touches });
      Object.defineProperty(event, 'changedTouches', { value: [touch] });
      window.dispatchEvent(event);
    };
    const startTouch = makeTouch(sx, sy);
    const moveTouch = makeTouch(mx, my);
    dispatchTouch('touchstart', startTouch, [startTouch]);
    dispatchTouch('touchmove', moveTouch, [moveTouch]);
  });
}

async function stopMobileTouchShot(page) {
  await page.evaluate(() => {
    const target = document.body;
    const x = Math.floor(window.innerWidth * 0.78);
    const y = Math.floor(window.innerHeight * 0.68);
    const touch = typeof Touch === 'function'
      ? new Touch({ identifier: 42, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y })
      : { identifier: 42, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y };
    const event = typeof TouchEvent === 'function'
      ? new TouchEvent('touchend', {
        touches: [],
        targetTouches: [],
        changedTouches: [touch],
        bubbles: true,
        cancelable: true,
      })
      : new Event('touchend', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: [] });
    Object.defineProperty(event, 'targetTouches', { value: [] });
    Object.defineProperty(event, 'changedTouches', { value: [touch] });
    window.dispatchEvent(event);
  }).catch(() => {});
}

async function collectShot({ shooterPage, observerPages, ownerId, beforeIds, start, stop, label }) {
  await shooterPage.bringToFront().catch(() => {});
  await dismissOverlays(shooterPage);
  await start(shooterPage);
  const startedAt = Date.now();
  const samples = [];
  let ownerSpawns = [];
  while (Date.now() - startedAt < 5000) {
    for (const [pageLabel, page] of Object.entries(observerPages)) {
      const t = await telemetry(page);
      const d = await debugState(page);
      samples.push({ wallMs: Date.now() - startedAt, pageLabel, telemetry: t, debug: d });
      const newSpawns = (t?.bullets?.recentSpawns || [])
        .filter((spawn) => spawn.ownerId === ownerId && !beforeIds[pageLabel].has(spawn.id));
      if (newSpawns.length) ownerSpawns = ownerSpawns.concat(newSpawns.map((spawn) => ({ ...spawn, observedOn: pageLabel })));
    }
    if (ownerSpawns.length >= 2) break;
    await sleep(120);
  }
  await stop(shooterPage);
  await sleep(350);

  const debugSamples = {};
  for (const [pageLabel, page] of Object.entries(observerPages)) {
    debugSamples[pageLabel] = await debugState(page);
  }

  const uniqueSpawns = Array.from(new Map(ownerSpawns.map((spawn) => [`${spawn.observedOn}:${spawn.id}`, spawn])).values());
  const trajectories = [];
  for (const spawn of uniqueSpawns) {
    for (const [pageLabel, state] of Object.entries(debugSamples)) {
      const match = (state?.recentClientBulletTrajectorySamples || []).find((entry) => entry.bulletId === spawn.id);
      if (match) {
        trajectories.push({
          observedOn: pageLabel,
          bulletId: spawn.id,
          sampleCount: match.samples.length,
          travelDistance: trajectoryDistance(match.samples),
          first: match.samples[0] || null,
          last: match.samples[match.samples.length - 1] || null,
        });
      }
    }
  }

  const maxDist = uniqueSpawns.length
    ? Math.max(...uniqueSpawns.map((spawn) => spawn.distToPlayer ?? Infinity))
    : Infinity;
  const minDirLen = uniqueSpawns.length
    ? Math.min(...uniqueSpawns.map((spawn) => vectorLength(spawn.worldDir)))
    : 0;
  const maxTrajectoryTravel = trajectories.length
    ? Math.max(...trajectories.map((traj) => traj.travelDistance))
    : 0;

  return {
    label,
    ownerId,
    spawnCount: uniqueSpawns.length,
    maxDistToPlayer: maxDist,
    minWorldDirLength: minDirLen,
    maxTrajectoryTravel,
    spawns: uniqueSpawns,
    trajectories,
    sampleCount: samples.length,
  };
}

function checksForResults(results, pageErrors, serverLogs) {
  const checks = [];
  for (const result of results) {
    checks.push({
      name: `${result.label} owner bullet observed`,
      pass: result.spawnCount >= 1,
      detail: `${result.spawnCount} spawns for owner ${result.ownerId}`,
    });
    checks.push({
      name: `${result.label} bullet origin near owner`,
      pass: Number.isFinite(result.maxDistToPlayer) && result.maxDistToPlayer <= 1.5,
      detail: `maxDistToPlayer=${Number.isFinite(result.maxDistToPlayer) ? result.maxDistToPlayer.toFixed(3) : 'none'}`,
    });
    checks.push({
      name: `${result.label} world direction finite`,
      pass: result.minWorldDirLength > 0.9 && result.minWorldDirLength < 1.1,
      detail: `minWorldDirLength=${result.minWorldDirLength.toFixed(3)}`,
    });
    checks.push({
      name: `${result.label} client trajectory moved`,
      pass: result.maxTrajectoryTravel > 0.1,
      detail: `maxTrajectoryTravel=${result.maxTrajectoryTravel.toFixed(3)}`,
    });
  }
  const browserCritical = criticalPageErrors(pageErrors);
  const serverCritical = criticalServerErrors(serverLogs);
  checks.push({
    name: 'No critical browser errors',
    pass: browserCritical.length === 0,
    detail: JSON.stringify(browserCritical),
  });
  checks.push({
    name: 'No critical server errors',
    pass: serverCritical.length === 0,
    detail: JSON.stringify(serverCritical),
  });
  return checks;
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');

  const serverLogs = [];
  const evidence = { pageErrors: [], consoleTail: [] };
  const owned = [];
  let browser;
  let report;

  try {
    owned.push(startProcess(
      commandPath('npx') || resolve(NODE_BIN, 'npx'),
      ['tsx', 'server/index.ts'],
      { PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0' },
      serverLogs,
    ));
    owned.push(startProcess(
      commandPath('npx') || resolve(NODE_BIN, 'npx'),
      ['vite', '--host', '127.0.0.1', '--port', String(DEV_PORT), '--strictPort'],
      {},
      serverLogs,
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
        '--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      ],
    });

    const hostPage = await createPage(browser, 'host', false, evidence);
    const joinPage = await createPage(browser, 'join-mobile', true, evidence);

    await navigateNetwork(hostPage, 'HostDesktopProof', true);
    await waitForPage(hostPage, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
    await navigateNetwork(joinPage, 'JoinMobileProof', false);
    await waitForPage(joinPage, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
    await waitForPage(hostPage, () => window.__gameDebug?.getPlayerCount?.() === 2, 30000);
    await waitForPage(joinPage, () => window.__gameDebug?.getPlayerCount?.() === 2, 30000);

    const started = await waitForPage(
      hostPage,
      (surface) => window.__gameDebug?.startMpScoringProofGame?.(surface, 'waves'),
      30000,
      SURFACE,
    );
    if (!started) throw new Error(`Could not start MP proof game on ${SURFACE}`);
    await waitForPage(hostPage, () => window.__GAME_TELEMETRY?.network?.roomPhase === 'playing', 30000);
    await waitForPage(joinPage, () => window.__GAME_TELEMETRY?.network?.roomPhase === 'playing', 30000);
    await hostPage.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());
    await joinPage.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());
    await sleep(1000);
    await dismissOverlays(hostPage);
    await dismissOverlays(joinPage);

    await hostPage.screenshot({ path: resolve(ARTIFACT_DIR, '01-start-host.png') });
    await joinPage.screenshot({ path: resolve(ARTIFACT_DIR, '01-start-join-mobile.png') });

    const hostId = await hostPage.evaluate(() => window.__GAME_TELEMETRY?.network?.localPlayerId || '');
    const joinId = await joinPage.evaluate(() => window.__GAME_TELEMETRY?.network?.localPlayerId || '');
    if (!hostId || !joinId || hostId === joinId) {
      throw new Error(`Invalid player ids: host=${hostId} join=${joinId}`);
    }

    const observerPages = { host: hostPage, join: joinPage };
    const hostBefore = { host: await knownSpawnIds(hostPage), join: await knownSpawnIds(joinPage) };
    const hostShot = await collectShot({
      shooterPage: hostPage,
      observerPages,
      ownerId: hostId,
      beforeIds: hostBefore,
      start: startDesktopShot,
      stop: stopDesktopShot,
      label: 'host-desktop',
    });
    await hostPage.screenshot({ path: resolve(ARTIFACT_DIR, '02-after-host-shot.png') });
    await sleep(800);

    const joinBefore = { host: await knownSpawnIds(hostPage), join: await knownSpawnIds(joinPage) };
    const joinShot = await collectShot({
      shooterPage: joinPage,
      observerPages,
      ownerId: joinId,
      beforeIds: joinBefore,
      start: startMobileTouchShot,
      stop: stopMobileTouchShot,
      label: 'join-mobile-emulated',
    });
    await joinPage.screenshot({ path: resolve(ARTIFACT_DIR, '03-after-join-shot.png') });

    const results = [hostShot, joinShot];
    const checks = checksForResults(results, evidence.pageErrors, serverLogs);
    const passed = checks.every((check) => check.pass);
    report = {
      verdict: passed ? 'PASS' : 'FAIL',
      runId: RUN_ID,
      surface: SURFACE,
      url: `http://127.0.0.1:${DEV_PORT}`,
      hostId,
      joinId,
      results,
      checks,
      pageErrors: evidence.pageErrors,
      consoleEvidence: evidence.consoleTail.slice(-120).map(sanitizeLine),
      serverEvidence: serverLogs
        .filter((line) => /Game started|Player joined|bullet|error|warn/i.test(line))
        .map(sanitizeLine),
      screenshots: readdirSync(ARTIFACT_DIR).map((name) => relative(ROOT, resolve(ARTIFACT_DIR, name))),
      proofBoundary: 'Two headless Chromium pages: desktop host and mobile-emulated joined client, both connected through real network-main.ts to a real Colyseus GameRoom.ts. Game start uses testMode debug helper; shooting uses browser mouse/touch input, then normal network input, GameRoom.tryShoot/spawnBullet, synced bullet state, and network-main client geodesic rendering telemetry. This is loopback/headless, not physical phone LAN or Windows WebGPU proof.',
    };
  } catch (error) {
    report = {
      verdict: 'FAIL',
      runId: RUN_ID,
      surface: SURFACE,
      error: error instanceof Error ? error.stack || error.message : String(error),
      pageErrors: evidence.pageErrors,
      consoleEvidence: evidence.consoleTail.slice(-120).map(sanitizeLine),
      serverEvidence: serverLogs.slice(-160).map(sanitizeLine),
      proofBoundary: 'The bounded MP torus shooting-origin probe failed before satisfying its claim.',
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await Promise.all(owned.map(stopProcessTree));
  }

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    verdict: report.verdict,
    reportPath: REPORT_PATH,
    results: report.results,
    checks: report.checks,
    error: report.error,
  }, null, 2));
  return report.verdict === 'PASS';
}

main().then((passed) => process.exit(passed ? 0 : 1));
