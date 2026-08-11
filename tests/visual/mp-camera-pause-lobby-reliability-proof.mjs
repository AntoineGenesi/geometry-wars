#!/usr/bin/env node
/**
 * Real-path MP proof for camera smoothness, pause/unpause recovery, and lobby
 * pause/QR UI reliability.
 *
 * Usage:
 *   CHROME_PATH=/usr/bin/google-chrome node tests/visual/mp-camera-pause-lobby-reliability-proof.mjs --phase=baseline --port=3038 --server-port=2580 --surface=sphere --mode=waves --duration=12 --include-sp-control=true
 *   CHROME_PATH=/usr/bin/google-chrome node tests/visual/mp-camera-pause-lobby-reliability-proof.mjs --phase=post-fix --port=3038 --server-port=2580 --surface=sphere --mode=waves --duration=12 --include-sp-control=true
 */
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PHASE = getArg('phase') || 'baseline';
const DEV_PORT = Number(getArg('port') || process.env.DEV_PORT || 3038);
const SERVER_PORT = Number(getArg('server-port') || process.env.SERVER_PORT || 2580);
const SURFACE = getArg('surface') || 'sphere';
const MODE = getArg('mode') || 'waves';
const DURATION_SECONDS = Number(getArg('duration') || 12);
const INCLUDE_SP_CONTROL = getArg('include-sp-control') === 'true';
const INCLUDE_REMATCH = getArg('include-rematch') === 'true';
const SKIP_PAUSE_PROBE = getArg('skip-pause-probe') === 'true';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = resolve(ROOT, 'test-screenshots/mp-camera-pause-lobby-reliability-proof', `${PHASE}-${RUN_ID}`);
const JSON_PATH = resolve(ROOT, 'reports', `mp-camera-pause-lobby-reliability-${PHASE}-${RUN_ID}.json`);
const MD_PATH = resolve(ROOT, 'reports', `mp-camera-pause-lobby-reliability-${PHASE}-${RUN_ID}.md`);
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
    env: { ...process.env, ...env },
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

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // Retry.
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

function criticalPageErrors(errors) {
  return errors.filter((message) =>
    !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated/i.test(message));
}

function criticalServerErrors(logs) {
  return logs.filter((line) => /\b(fatal|uncaught|unhandled|exception|error:)\b/i.test(line));
}

function sanitizeEvidenceLine(line) {
  return line.replaceAll(ROOT, '<project-root>');
}

async function createPage(browser, label, viewport = { width: 960, height: 720 }, mobile = false) {
  const page = await browser.newPage();
  await page.setViewport({ ...viewport, isMobile: mobile, hasTouch: mobile });
  page.__proofLabel = label;
  page.__errors = [];
  page.__consoleTail = [];
  page.on('pageerror', (error) => page.__errors.push(error.message));
  page.on('console', (message) => {
    const line = `[${message.type()}] ${message.text()}`;
    page.__consoleTail.push(line);
    if (page.__consoleTail.length > 180) page.__consoleTail.shift();
    if (message.type() === 'error') page.__errors.push(message.text());
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('gw3d-music-muted', 'true');
    localStorage.setItem('gw3d-visual-mode', 'modern');
  });
  return page;
}

async function navigateMp(page, name, creator) {
  const params = new URLSearchParams({
    mode: 'network',
    surface: SURFACE,
    server: `ws://127.0.0.1:${SERVER_PORT}`,
    debug: 'true',
    testMode: 'true',
    godMode: 'true',
    name,
    gameMode: MODE,
    renderer: 'webgl',
    music: 'false',
  });
  if (creator) params.set('creator', '1');
  await page.goto(`http://127.0.0.1:${DEV_PORT}?${params.toString()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  const connected = await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
  if (!connected) throw new Error(`${name} did not connect to MP room`);
}

async function startMpGame(hostPage) {
  const started = await waitForPage(hostPage, (surface) => {
    const api = window.__gameDebug;
    if (!api?.startChevronAimProofGame) return false;
    if (surface !== 'sphere' && surface !== 'cube') {
      return api.startBlackHoleProofGame?.() || false;
    }
    return api.startChevronAimProofGame(surface);
  }, 30000, SURFACE);
  if (!started) throw new Error(`Could not start MP proof game on ${SURFACE}`);
  await waitForPage(hostPage, () => window.__gameDebug?.getChevronAimProofState?.()?.roomPhase === 'playing', 30000);
  await hostPage.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());
}

async function navigateSp(page) {
  await page.goto(
    `http://127.0.0.1:${DEV_PORT}/?testArena=true&surface=${encodeURIComponent(SURFACE)}&testMode=true&renderer=webgl&music=false&godMode=true`,
    { waitUntil: 'domcontentloaded', timeout: 30000 },
  );
  await page.waitForSelector('canvas', { timeout: 30000 });
  const ready = await waitForPage(page, () => Boolean(
    window.__TEST_API?.getGameState
      && window.__GAME_TELEMETRY?.player?.worldPos
      && window.__gameDebug?.ctx?.game,
  ), 30000);
  if (!ready) throw new Error('SP telemetry/debug context unavailable');
}

async function keyDown(page, key) {
  await page.bringToFront();
  await page.keyboard.down(key);
}

async function keyUp(page, key) {
  await page.bringToFront();
  await page.keyboard.up(key);
}

function vectorDistance(a, b) {
  if (!a || !b) return null;
  const ax = Array.isArray(a) ? a[0] : a.x;
  const ay = Array.isArray(a) ? a[1] : a.y;
  const az = Array.isArray(a) ? a[2] : a.z;
  const bx = Array.isArray(b) ? b[0] : b.x;
  const by = Array.isArray(b) ? b[1] : b.y;
  const bz = Array.isArray(b) ? b[2] : b.z;
  if (![ax, ay, az, bx, by, bz].every(Number.isFinite)) return null;
  return Math.hypot(ax - bx, ay - by, az - bz);
}

function summarizeSamples(samples) {
  const deltas = [];
  const playerDeltas = [];
  const cameraDeltas = [];
  const renderTargetDeltas = [];
  const targetToPlayer = [];
  let previous = null;
  for (const sample of samples) {
    if (previous) {
      const dt = Math.max(1, sample.wallMs - previous.wallMs) / 1000;
      const pDelta = vectorDistance(sample.playerWorld, previous.playerWorld);
      const cDelta = vectorDistance(sample.cameraPosition, previous.cameraPosition);
      if (pDelta !== null) playerDeltas.push(pDelta / dt);
      if (cDelta !== null) cameraDeltas.push(cDelta / dt);
      if (pDelta !== null && cDelta !== null) deltas.push(Math.abs(cDelta - pDelta) / dt);
    }
    if (Number.isFinite(sample.renderTarget?.targetDelta)) renderTargetDeltas.push(sample.renderTarget.targetDelta);
    if (Number.isFinite(sample.renderTarget?.targetToPlayer)) targetToPlayer.push(sample.renderTarget.targetToPlayer);
    previous = sample;
  }
  return {
    count: samples.length,
    playerTravel: totalTravel(samples.map((sample) => sample.playerWorld)),
    cameraTravel: totalTravel(samples.map((sample) => sample.cameraPosition)),
    playerSpeed: stats(playerDeltas),
    cameraSpeed: stats(cameraDeltas),
    cameraVsPlayerDeltaSpeed: stats(deltas),
    renderTargetDelta: stats(renderTargetDeltas),
    targetToPlayer: stats(targetToPlayer),
    pausedSamples: samples.filter((sample) => sample.isPaused).length,
    roomPhases: Array.from(new Set(samples.map((sample) => sample.roomPhase).filter(Boolean))),
  };
}

function totalTravel(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const delta = vectorDistance(points[i], points[i - 1]);
    if (delta !== null) total += delta;
  }
  return total;
}

function stats(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) return { count: 0, min: null, max: null, avg: null, p95: null };
  const sum = finite.reduce((a, b) => a + b, 0);
  return {
    count: finite.length,
    min: finite[0],
    max: finite[finite.length - 1],
    avg: sum / finite.length,
    p95: finite[Math.min(finite.length - 1, Math.floor(finite.length * 0.95))],
  };
}

async function sampleMp(page) {
  return page.evaluate(() => {
    const telemetry = window.__GAME_TELEMETRY;
    const proof = window.__gameDebug?.getChevronAimProofState?.() ?? null;
    const pauseMenu = document.getElementById('pause-menu');
    const pauseMenuVisible = Boolean(pauseMenu && !pauseMenu.classList.contains('hidden'));
    const visibleText = Array.from(document.querySelectorAll('body *'))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      })
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' | ')
      .slice(0, 2000);
    return {
      wallMs: performance.now(),
      frame: telemetry?.frame ?? proof?.frame ?? null,
      time: telemetry?.time ?? proof?.time ?? null,
      isPaused: telemetry?.isPaused ?? proof?.isPaused ?? null,
      roomPhase: telemetry?.network?.roomPhase ?? proof?.roomPhase ?? null,
      localPlayerId: telemetry?.network?.localPlayerId ?? proof?.localPlayerId ?? null,
      playerWorld: telemetry?.player?.worldPos ?? null,
      playerAlive: telemetry?.player?.alive ?? null,
      cameraPosition: telemetry?.camera?.position
        ? [telemetry.camera.position.x, telemetry.camera.position.y, telemetry.camera.position.z]
        : proof?.camera?.position ?? null,
      cameraDistanceToPlayer: telemetry?.camera?.distanceToPlayer ?? telemetry?.player?.distanceToCamera ?? null,
      renderTarget: telemetry?.camera?.renderTarget ?? null,
      input: proof?.lastSentInput ?? null,
      pauseBoundary: window.__gameDebug?.getPauseBoundaryProofState?.() ?? null,
      pauseMenuVisible,
      allowAllPlayersPause: telemetry?.allowAllPlayersPause ?? null,
      visiblePausedText: /\bPAUSED\b/i.test(visibleText),
      visibleText,
    };
  });
}

async function sampleSp(page) {
  return page.evaluate(() => {
    const telemetry = window.__GAME_TELEMETRY;
    const ctx = window.__gameDebug?.ctx;
    const camera = ctx?.game?.camera;
    return {
      wallMs: performance.now(),
      frame: telemetry?.frame ?? null,
      time: telemetry?.time ?? null,
      isPaused: false,
      roomPhase: 'sp',
      playerWorld: telemetry?.player?.worldPos ?? null,
      playerAlive: telemetry?.player?.alive ?? null,
      cameraPosition: camera
        ? [camera.position.x, camera.position.y, camera.position.z]
        : null,
      cameraDistanceToPlayer: telemetry?.player?.worldPos && camera
        ? Math.hypot(
            camera.position.x - telemetry.player.worldPos.x,
            camera.position.y - telemetry.player.worldPos.y,
            camera.position.z - telemetry.player.worldPos.z,
          )
        : null,
      renderTarget: null,
    };
  });
}

async function collectMovement(page, sampler, label, durationSeconds) {
  const samples = [];
  await keyDown(page, 'd');
  const started = Date.now();
  while (Date.now() - started < durationSeconds * 1000) {
    samples.push(await sampler(page));
    await sleep(100);
  }
  await keyUp(page, 'd');
  await sleep(250);
  samples.push(await sampler(page));
  return { label, samples, summary: summarizeSamples(samples) };
}

async function pauseUnpauseProbe(host, joiner) {
  await host.bringToFront();
  await host.keyboard.press('Escape');
  const paused = await waitForPage(joiner, () => window.__GAME_TELEMETRY?.isPaused === true, 8000);
  await sleep(700);
  const duringPause = {
    host: await sampleMp(host),
    joiner: await sampleMp(joiner),
  };
  const pausedScreenshot = {
    host: relative(ROOT, resolve(ARTIFACT_DIR, 'host-paused.png')),
    joiner: relative(ROOT, resolve(ARTIFACT_DIR, 'joiner-paused.png')),
  };
  await host.screenshot({ path: resolve(ROOT, pausedScreenshot.host) }).catch(() => {});
  await joiner.screenshot({ path: resolve(ROOT, pausedScreenshot.joiner) }).catch(() => {});

  await host.bringToFront();
  await host.keyboard.press('Escape');
  const unpaused = await waitForPage(joiner, () => window.__GAME_TELEMETRY?.isPaused === false, 8000);
  await sleep(600);
  const afterUnpauseBeforeMove = {
    host: await sampleMp(host),
    joiner: await sampleMp(joiner),
  };
  const beforePos = afterUnpauseBeforeMove.joiner.playerWorld;
  await keyDown(joiner, 'd');
  await sleep(2200);
  await keyUp(joiner, 'd');
  await sleep(300);
  const afterJoinerMove = await sampleMp(joiner);
  const joinerPostResumeTravel = vectorDistance(beforePos, afterJoinerMove.playerWorld) ?? 0;
  const unpausedScreenshot = {
    host: relative(ROOT, resolve(ARTIFACT_DIR, 'host-after-unpause.png')),
    joiner: relative(ROOT, resolve(ARTIFACT_DIR, 'joiner-after-unpause.png')),
  };
  await host.screenshot({ path: resolve(ROOT, unpausedScreenshot.host) }).catch(() => {});
  await joiner.screenshot({ path: resolve(ROOT, unpausedScreenshot.joiner) }).catch(() => {});

  return {
    pausedObserved: Boolean(paused),
    unpausedObserved: Boolean(unpaused),
    duringPause,
    afterUnpauseBeforeMove,
    afterJoinerMove,
    joinerPostResumeTravel,
    screenshots: { paused: pausedScreenshot, unpaused: unpausedScreenshot },
    pass: Boolean(paused)
      && Boolean(unpaused)
      && duringPause.host.isPaused === true
      && duringPause.joiner.isPaused === true
      && afterUnpauseBeforeMove.host.isPaused === false
      && afterUnpauseBeforeMove.joiner.isPaused === false
      && afterUnpauseBeforeMove.joiner.pauseMenuVisible === false
      && afterUnpauseBeforeMove.joiner.visiblePausedText === false
      && joinerPostResumeTravel > 0.05,
  };
}

async function rematchPauseBoundaryProbe(host, joiner) {
  const before = {
    host: await sampleMp(host),
    joiner: await sampleMp(joiner),
  };

  const exitSent = await host.evaluate(() => window.__gameDebug?.forceExitToVotingProofGame?.() ?? false);
  await joiner.bringToFront();
  const joinerVoting = await waitForPage(joiner, () => window.__gameDebug?.getChevronAimProofState?.()?.roomPhase === 'voting', 45000);
  await host.bringToFront();
  const hostVoting = await waitForPage(host, () => window.__gameDebug?.getChevronAimProofState?.()?.roomPhase === 'voting', 10000);
  await sleep(600);

  await joiner.bringToFront();
  const staleInjected = await joiner.evaluate(() => window.__gameDebug?.forceOpenPauseBoundaryProofMenu?.() ?? false);
  const injected = await sampleMp(joiner);
  const injectedScreenshot = relative(ROOT, resolve(ARTIFACT_DIR, 'joiner-rematch-stale-menu-injected.png'));
  await joiner.screenshot({ path: resolve(ROOT, injectedScreenshot) }).catch(() => {});

  await host.bringToFront();
  const launchSent = await host.evaluate((surface) => window.__gameDebug?.startChevronAimProofGame?.(surface) ?? false, SURFACE);
  const hostPlaying = await waitForPage(host, () => window.__gameDebug?.getChevronAimProofState?.()?.roomPhase === 'playing', 30000);
  await joiner.bringToFront();
  const joinerPlaying = await waitForPage(joiner, () => window.__gameDebug?.getChevronAimProofState?.()?.roomPhase === 'playing', 30000);
  await joiner.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());
  await sleep(900);

  const afterStart = {
    host: await sampleMp(host),
    joiner: await sampleMp(joiner),
  };
  const beforePos = afterStart.joiner.playerWorld;
  await keyDown(joiner, 'd');
  await sleep(1800);
  await keyUp(joiner, 'd');
  await sleep(300);
  const afterMove = await sampleMp(joiner);
  const joinerTravel = vectorDistance(beforePos, afterMove.playerWorld) ?? 0;
  const afterScreenshot = relative(ROOT, resolve(ARTIFACT_DIR, 'joiner-rematch-after-start.png'));
  await joiner.screenshot({ path: resolve(ROOT, afterScreenshot) }).catch(() => {});

  return {
    exitSent,
    hostVoting: Boolean(hostVoting),
    joinerVoting: Boolean(joinerVoting),
    staleInjected,
    launchSent,
    hostPlaying: Boolean(hostPlaying),
    joinerPlaying: Boolean(joinerPlaying),
    before,
    injected,
    afterStart,
    afterMove,
    joinerTravel,
    screenshots: { injected: injectedScreenshot, afterStart: afterScreenshot },
    pass: exitSent
      && Boolean(joinerVoting)
      && staleInjected
      && injected.pauseMenuVisible === true
      && injected.pauseBoundary?.localMenuOpen === true
      && injected.pauseBoundary?.touchGamePaused === true
      && launchSent
      && Boolean(hostPlaying)
      && Boolean(joinerPlaying)
      && afterStart.joiner.roomPhase === 'playing'
      && afterStart.joiner.isPaused === false
      && afterStart.joiner.pauseMenuVisible === false
      && afterStart.joiner.pauseBoundary?.localMenuOpen === false
      && afterStart.joiner.pauseBoundary?.isInLookMode === false
      && afterStart.joiner.pauseBoundary?.touchGamePaused === false
      && afterStart.joiner.visiblePausedText === false
  };
}

async function inspectPauseMenuAndQr(host) {
  await host.bringToFront();
  await host.keyboard.press('Escape');
  await waitForPage(host, () => {
    const menu = document.getElementById('pause-menu');
    return menu && !menu.classList.contains('hidden');
  }, 8000);
  await sleep(700);
  const screenshot = relative(ROOT, resolve(ARTIFACT_DIR, 'host-pause-menu-ui.png'));
  await host.screenshot({ path: resolve(ROOT, screenshot) }).catch(() => {});
  const state = await host.evaluate(() => {
    const menu = document.getElementById('pause-menu');
    const toggle = menu?.querySelector('.allow-pause-toggle');
    const checkbox = menu?.querySelector('.allow-pause-checkbox');
    const qrSection = menu?.querySelector('.pause-qr-section');
    const joinTitle = Array.from(menu?.querySelectorAll('.stats-section-title') ?? [])
      .find((el) => /JOIN THIS GAME/i.test(el.textContent || ''));
    const qrText = qrSection?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    };
    return {
      toggleVisible: Boolean(toggle && !toggle.classList.contains('hidden')),
      checked: Boolean(checkbox?.checked),
      toggleRect: rect(toggle),
      joinRect: rect(joinTitle),
      qrText,
      qrMentionsLan: /same (Wi-?Fi|WiFi|network|LAN)|same Wi/i.test(qrText),
      menuText: menu?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 2000) ?? '',
    };
  });
  await host.keyboard.press('Escape');
  await waitForPage(host, () => window.__GAME_TELEMETRY?.isPaused === false, 8000);
  return {
    ...state,
    screenshot,
    placementPass: Boolean(state.toggleRect && state.joinRect && state.toggleRect.top < state.joinRect.top),
    pass: state.toggleVisible && state.checked && state.qrMentionsLan
      && Boolean(state.toggleRect && state.joinRect && state.toggleRect.top < state.joinRect.top),
  };
}

function classifyCamera(mp, sp) {
  if (!mp?.summary) return { verdict: 'NO_MP_DATA' };
  const mpJerk = mp.summary.cameraVsPlayerDeltaSpeed.p95 ?? null;
  const spJerk = sp?.summary?.cameraVsPlayerDeltaSpeed?.p95 ?? null;
  const mpTargetDelta = mp.summary.renderTargetDelta.p95 ?? null;
  const movementObserved = (mp.summary.playerTravel ?? 0) > 0.05;
  if (!movementObserved) return { verdict: 'NO_MOVEMENT', mpJerk, spJerk, mpTargetDelta };
  if (!Number.isFinite(spJerk)) return { verdict: 'MP_ONLY_MEASURED', mpJerk, spJerk, mpTargetDelta };
  const ratio = spJerk > 0 ? mpJerk / spJerk : null;
  return {
    verdict: Number.isFinite(ratio) && ratio > 1.8 ? 'MP_JERK_REPRODUCED' : 'CURRENT_NO_REPRO',
    mpJerk,
    spJerk,
    ratio,
    mpTargetDelta,
  };
}

function makeMarkdown(report) {
  return [
    `# MP Camera Pause Lobby Reliability ${report.phase}`,
    '',
    `- verdict: ${report.verdict}`,
    `- camera verdict: ${report.cameraComparison?.verdict ?? 'n/a'}`,
    `- pause recovery pass: ${report.pauseProbe?.pass ?? 'n/a'}`,
    `- rematch pause boundary pass: ${report.rematchPauseProbe?.pass ?? 'n/a'}`,
    `- host pause/QR UI pass: ${report.pauseMenuAndQr?.pass ?? 'n/a'}`,
    `- proof boundary: ${report.proofBoundary}`,
    `- json: ${relative(ROOT, JSON_PATH)}`,
    `- screenshots: ${relative(ROOT, ARTIFACT_DIR)}`,
    '',
    '## Camera',
    '',
    `- MP player travel: ${report.mpMovement?.summary?.playerTravel ?? 'n/a'}`,
    `- MP p95 camera/player delta speed: ${report.cameraComparison?.mpJerk ?? 'n/a'}`,
    `- SP p95 camera/player delta speed: ${report.cameraComparison?.spJerk ?? 'n/a'}`,
    `- MP/SP ratio: ${report.cameraComparison?.ratio ?? 'n/a'}`,
    '',
    '## Pause',
    '',
    `- paused observed: ${report.pauseProbe?.pausedObserved ?? 'n/a'}`,
    `- unpaused observed: ${report.pauseProbe?.unpausedObserved ?? 'n/a'}`,
    `- joiner post-resume travel: ${report.pauseProbe?.joinerPostResumeTravel ?? 'n/a'}`,
    `- joiner pause menu visible after unpause: ${report.pauseProbe?.afterUnpauseBeforeMove?.joiner?.pauseMenuVisible ?? 'n/a'}`,
    `- joiner paused text after unpause: ${report.pauseProbe?.afterUnpauseBeforeMove?.joiner?.visiblePausedText ?? 'n/a'}`,
    '',
    '## Rematch Pause Boundary',
    '',
    `- stale menu injected: ${report.rematchPauseProbe?.staleInjected ?? 'n/a'}`,
    `- next match playing: ${report.rematchPauseProbe?.joinerPlaying ?? 'n/a'}`,
    `- joiner pause menu visible after next start: ${report.rematchPauseProbe?.afterStart?.joiner?.pauseMenuVisible ?? 'n/a'}`,
    `- joiner local menu open after next start: ${report.rematchPauseProbe?.afterStart?.joiner?.pauseBoundary?.localMenuOpen ?? 'n/a'}`,
    `- joiner touch gamePaused after next start: ${report.rematchPauseProbe?.afterStart?.joiner?.pauseBoundary?.touchGamePaused ?? 'n/a'}`,
    '',
    '## UI',
    '',
    `- allow toggle visible: ${report.pauseMenuAndQr?.toggleVisible ?? 'n/a'}`,
    `- allow toggle checked: ${report.pauseMenuAndQr?.checked ?? 'n/a'}`,
    `- toggle above join area: ${report.pauseMenuAndQr?.placementPass ?? 'n/a'}`,
    `- QR mentions same Wi-Fi/LAN: ${report.pauseMenuAndQr?.qrMentionsLan ?? 'n/a'}`,
    '',
  ].join('\n');
}

async function main() {
  if (!['baseline', 'post-fix'].includes(PHASE)) {
    throw new Error(`Unsupported --phase=${PHASE}; use baseline or post-fix`);
  }
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');

  const logs = [];
  const children = [];
  let browser;
  let report;
  try {
    children.push(startProcess(
      'npm',
      ['exec', '--', 'tsx', 'server/index.ts'],
      { PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0' },
      logs,
    ));
    children.push(startProcess(
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

    const host = await createPage(browser, 'host');
    const joiner = await createPage(browser, 'joiner', { width: 430, height: 760 }, true);
    await navigateMp(host, 'HostProof', true);
    await navigateMp(joiner, 'JoinProof', false);
    await waitForPage(host, () => window.__gameDebug?.getPlayerCount?.() >= 2, 20000);
    await waitForPage(joiner, () => window.__gameDebug?.getPlayerCount?.() >= 2, 20000);
    await startMpGame(host);
    await waitForPage(joiner, () => window.__gameDebug?.getChevronAimProofState?.()?.roomPhase === 'playing', 30000);
    await joiner.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());

    const mpMovement = await collectMovement(host, sampleMp, 'mp-host', DURATION_SECONDS);
    let spMovement = null;
    let spErrors = [];
    let spConsoleTail = [];
    if (INCLUDE_SP_CONTROL) {
      const sp = await createPage(browser, 'sp-control');
      await navigateSp(sp);
      spMovement = await collectMovement(sp, sampleSp, 'sp-control', Math.min(DURATION_SECONDS, 8));
      spErrors = criticalPageErrors(sp.__errors);
      spConsoleTail = sp.__consoleTail.slice(-80);
      await sp.screenshot({ path: resolve(ARTIFACT_DIR, 'sp-control-after-movement.png') }).catch(() => {});
      await sp.close().catch(() => {});
    }

    const pauseProbe = SKIP_PAUSE_PROBE ? null : await pauseUnpauseProbe(host, joiner);
    const rematchPauseProbe = INCLUDE_REMATCH ? await rematchPauseBoundaryProbe(host, joiner) : null;
    const pauseMenuAndQr = await inspectPauseMenuAndQr(host);
    const cameraComparison = classifyCamera(mpMovement, spMovement);
    const pageErrors = [
      ...criticalPageErrors(host.__errors),
      ...criticalPageErrors(joiner.__errors),
      ...spErrors,
    ];
    const serverErrors = criticalServerErrors(logs);
    const uiExpectedPass = PHASE === 'post-fix';
    const pauseExpectedPass = PHASE === 'post-fix';
    let verdict = 'PASS';
    if (pageErrors.length || serverErrors.length) verdict = 'ERROR';
    else if (PHASE === 'baseline') verdict = 'BASELINE_RECORDED';
    else if ((pauseExpectedPass && !SKIP_PAUSE_PROBE && !pauseProbe?.pass) || (INCLUDE_REMATCH && !rematchPauseProbe?.pass) || (uiExpectedPass && !pauseMenuAndQr.pass)) verdict = 'FAIL';

    report = {
      verdict,
      phase: PHASE,
      runId: RUN_ID,
      command: `CHROME_PATH=${chrome} node tests/visual/mp-camera-pause-lobby-reliability-proof.mjs --phase=${PHASE} --port=${DEV_PORT} --server-port=${SERVER_PORT} --surface=${SURFACE} --mode=${MODE} --duration=${DURATION_SECONDS} --include-sp-control=${INCLUDE_SP_CONTROL} --include-rematch=${INCLUDE_REMATCH} --skip-pause-probe=${SKIP_PAUSE_PROBE}`,
      proofBoundary: 'Linux headless Chrome with SwiftShader WebGL2, one real Vite server, one real Colyseus server, host + joiner pages in one Chrome process. No WebGPU, Windows browser, or physical LAN comfort claim.',
      surface: SURFACE,
      mode: MODE,
      devPort: DEV_PORT,
      serverPort: SERVER_PORT,
      mpMovement,
      spMovement,
      cameraComparison,
      pauseProbe,
      rematchPauseProbe,
      pauseMenuAndQr,
      pageErrors,
      serverErrors,
      consoleTail: {
        host: host.__consoleTail.slice(-80),
        joiner: joiner.__consoleTail.slice(-80),
        sp: spConsoleTail,
      },
      serverEvidence: logs
        .filter((line) => /Game started|client joined|room|paused|resumed|allowAllPlayersPause/i.test(line))
        .slice(-120)
        .map(sanitizeEvidenceLine),
      artifacts: {
        json: relative(ROOT, JSON_PATH),
        markdown: relative(ROOT, MD_PATH),
        screenshots: relative(ROOT, ARTIFACT_DIR),
      },
    };
    await host.close().catch(() => {});
    await joiner.close().catch(() => {});
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
    for (const child of children.reverse()) await stopProcessTree(child);
    writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(MD_PATH, makeMarkdown(report));
    console.log(JSON.stringify({
      verdict: report.verdict,
      camera: report.cameraComparison?.verdict ?? null,
      pausePass: report.pauseProbe?.pass ?? null,
      rematchPass: report.rematchPauseProbe?.pass ?? null,
      uiPass: report.pauseMenuAndQr?.pass ?? null,
      report: relative(ROOT, JSON_PATH),
      markdown: relative(ROOT, MD_PATH),
      screenshots: relative(ROOT, ARTIFACT_DIR),
    }, null, 2));
  }

  if (PHASE === 'baseline') {
    if (!['BASELINE_RECORDED'].includes(report.verdict)) process.exitCode = 1;
  } else if (report.verdict !== 'PASS') {
    process.exitCode = 1;
  }
}

await main();
