#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEV_PORT = Number(process.env.DEV_PORT || 3008);
const SERVER_PORT = Number(process.env.SERVER_PORT || 2570);
const PHASE = process.argv.find((arg) => arg.startsWith('--phase='))?.split('=')[1] || 'post-fix';
const RUN_TWO_BROWSER = PHASE !== 'baseline';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(ROOT, 'test-screenshots/mp-chevron-aim-proof', `${PHASE}-${runId}`);
const jsonPath = resolve(ROOT, 'reports', `mp-chevron-aim-${PHASE}-${runId}.json`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const directions = [
  { name: 'right', x: 0.78, y: 0.50 },
  { name: 'up', x: 0.50, y: 0.22 },
  { name: 'down', x: 0.50, y: 0.78 },
  { name: 'diagonal-up-right', x: 0.75, y: 0.25 },
];

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

async function waitForPage(page, predicate, timeoutMs = 30000, argument = undefined) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await page.evaluate(predicate, argument).catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  return null;
}

function startProcess(args, env, logs) {
  const child = spawn(process.execPath, args, {
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
    // The process already exited.
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

function angularErrorDegrees(a, b) {
  const left = Array.isArray(a) ? a : [a?.x, a?.y, a?.z];
  const right = Array.isArray(b) ? b : [b?.x, b?.y, b?.z];
  if (![...left, ...right].every(Number.isFinite)) return null;
  const dot = Math.max(-1, Math.min(1,
    left[0] * right[0] + left[1] * right[1] + left[2] * right[2]));
  return Math.acos(dot) * 180 / Math.PI;
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

async function createPage(browser, label) {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 720 });
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
  return page;
}

async function navigateToRoom(page, surface, name, creator) {
  const params = new URLSearchParams({
    mode: 'network',
    surface,
    server: `ws://127.0.0.1:${SERVER_PORT}`,
    debug: 'true',
    testMode: 'true',
    godMode: 'true',
    name,
    gameMode: 'waves',
    renderer: 'webgl',
  });
  if (creator) params.set('creator', '1');
  await page.goto(`http://127.0.0.1:${DEV_PORT}?${params.toString()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  const connected = await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
  if (!connected) throw new Error(`${name} did not connect on ${surface}`);
}

async function startProofGame(page, surface) {
  const started = await waitForPage(
    page,
    (requestedSurface) => window.__gameDebug?.startChevronAimProofGame?.(requestedSurface) || false,
    30000,
    surface,
  );
  if (!started) throw new Error(`Could not start multiplayer Waves on ${surface}`);
}

async function waitForPlaying(page, surface) {
  const state = await waitForPage(page, (expectedSurface) => {
    const proof = window.__gameDebug?.getChevronAimProofState?.();
    return proof?.roomPhase === 'playing' && proof?.surface === expectedSurface ? proof : null;
  }, 30000, surface);
  if (!state) throw new Error(`${page.__proofLabel} did not enter ${surface} Waves gameplay`);
  return state;
}

async function resumeProofGame(page) {
  await page.bringToFront();
  await page.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());
  await page.evaluate(() => {
    const resumeButton = Array.from(document.querySelectorAll('button')).find((button) => {
      const label = (button.textContent || '').trim();
      return label.includes('RESUME')
        && (button.offsetParent !== null || getComputedStyle(button).display !== 'none');
    });
    resumeButton?.click();
  });
  await waitForPage(page, () => {
    const proof = window.__gameDebug?.getChevronAimProofState?.();
    const visibleResume = Array.from(document.querySelectorAll('button')).some((button) => {
      const label = (button.textContent || '').trim();
      return label.includes('RESUME')
        && (button.offsetParent !== null || getComputedStyle(button).display !== 'none');
    });
    return proof && !proof.isPaused && !visibleResume ? proof : null;
  }, 5000);
}

async function getAimState(page) {
  return page.evaluate(() => window.__gameDebug?.getChevronAimProofState?.() || null);
}

async function sampleCanvasPixels(page, points) {
  return page.evaluate((samplePoints) => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return { ok: false, reason: 'no canvas' };
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) return { ok: false, reason: 'no 2d context' };
    context.drawImage(canvas, 0, 0);
    const scaleX = copy.width / Math.max(1, canvas.getBoundingClientRect().width);
    const scaleY = copy.height / Math.max(1, canvas.getBoundingClientRect().height);
    const samples = samplePoints.map(({ name, screen }) => {
      if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
        return { name, valid: false, maxChannel: 0, brightPixels: 0 };
      }
      const centerX = Math.round((screen.x - canvas.getBoundingClientRect().left) * scaleX);
      const centerY = Math.round((screen.y - canvas.getBoundingClientRect().top) * scaleY);
      let maxChannel = 0;
      let brightPixels = 0;
      let count = 0;
      for (let y = -10; y <= 10; y += 2) {
        for (let x = -10; x <= 10; x += 2) {
          const px = Math.max(0, Math.min(copy.width - 1, centerX + x));
          const py = Math.max(0, Math.min(copy.height - 1, centerY + y));
          const data = context.getImageData(px, py, 1, 1).data;
          const channel = Math.max(data[0], data[1], data[2]);
          maxChannel = Math.max(maxChannel, channel);
          if (channel >= 45) brightPixels++;
          count++;
        }
      }
      return { name, valid: true, centerX, centerY, maxChannel, brightPixels, count };
    });
    let nonDark = 0;
    let gridCount = 0;
    for (let gy = 0; gy < 16; gy++) {
      for (let gx = 0; gx < 16; gx++) {
        const x = Math.min(copy.width - 1, Math.round((gx + 0.5) * copy.width / 16));
        const y = Math.min(copy.height - 1, Math.round((gy + 0.5) * copy.height / 16));
        const data = context.getImageData(x, y, 1, 1).data;
        if (Math.max(data[0], data[1], data[2]) >= 25) nonDark++;
        gridCount++;
      }
    }
    return { ok: true, canvasWidth: copy.width, canvasHeight: copy.height, nonDark, gridCount, samples };
  }, points);
}

function buildMeasurement({ surface, direction, observer, player, bullet, state, pixels, screenshot, settleMs }) {
  const aimWorld = player.mouseOrReplicatedWorldAim;
  const chevronForward = player.chevronForward;
  const bulletWorld = bullet.worldDir;
  return {
    surface,
    direction,
    observer,
    observedPlayerId: player.id,
    aimSource: player.aimSource,
    aimAngle: player.aimAngle,
    settleMs,
    spawnFrame: bullet.frame,
    spawnTime: bullet.time,
    sampleFrame: state.frame,
    sampleTime: state.time,
    mouseOrReplicatedWorldAim: aimWorld,
    serverReturnedBulletUvDirection: bullet.uvDir,
    serverReturnedBulletWorldDirection: bulletWorld,
    chevronForward,
    chevronUp: player.chevronUp,
    surfaceNormal: player.surfaceNormal,
    tangentU: player.tangentU,
    tangentV: player.tangentV,
    angularErrorsDegrees: {
      chevronToMouseOrReplicatedAim: angularErrorDegrees(chevronForward, aimWorld),
      chevronToServerBullet: angularErrorDegrees(chevronForward, bulletWorld),
      serverBulletToMouseOrReplicatedAim: angularErrorDegrees(bulletWorld, aimWorld),
    },
    chevronUpToSurfaceNormalDot: player.chevronUpToNormalDot,
    meshVisible: player.meshVisible,
    visibleChildCount: player.visibleChildCount,
    projectedNose: player.noseScreen,
    projectedTail: player.tailScreen,
    projectedBulletOrigin: bullet.originScreen,
    projectedBulletDirectionEnd: bullet.directionEndScreen,
    pixelEvidence: pixels,
    screenshot,
    backend: state.backend,
    isWebGPU: state.isWebGPU,
    roomPhase: state.roomPhase,
  };
}

async function aimAndShoot(page, surface, direction, observer = 'local', observedPlayerId = null) {
  await resumeProofGame(page);
  const viewport = page.viewport();
  await page.mouse.move(viewport.width * direction.x, viewport.height * direction.y);
  const settleMs = 1600;
  await sleep(settleMs);
  const before = await getAimState(page);
  if (!before) throw new Error(`No aim state before ${surface}/${direction.name}`);
  const ownerId = observedPlayerId || before.localPlayerId;
  const fired = await page.evaluate(() => window.__gameDebug?.fireChevronAimProofShot?.() || false);
  if (!fired) throw new Error(`Could not request proof shot for ${surface}/${direction.name}`);
  const shot = await waitForPage(page, ({ minimumFrame, expectedOwner }) => {
    const proof = window.__gameDebug?.getChevronAimProofState?.();
    if (!proof) return null;
    const bullets = proof.recentServerBulletSpawns
      .filter((spawn) => spawn.ownerId === expectedOwner && spawn.frame >= minimumFrame);
    if (bullets.length === 0) return null;
    return { state: proof, bullet: bullets[bullets.length - 1] };
  }, 7000, { minimumFrame: before.frame, expectedOwner: ownerId });
  if (!shot) throw new Error(`No server-returned bullet for ${surface}/${direction.name}/${ownerId}`);

  const player = shot.state.players.find((candidate) => candidate.id === ownerId);
  if (!player) throw new Error(`Observer did not expose player ${ownerId}`);
  const screenshot = relative(ROOT, resolve(artifactDir, `${surface}-${observer}-${direction.name}.png`));
  await page.screenshot({ path: resolve(ROOT, screenshot) });
  const pixels = await sampleCanvasPixels(page, [
    { name: 'chevron-nose', screen: player.noseScreen },
    { name: 'chevron-tail', screen: player.tailScreen },
    { name: 'bullet-origin', screen: shot.bullet.originScreen },
    { name: 'bullet-direction-end', screen: shot.bullet.directionEndScreen },
  ]);
  return buildMeasurement({
    surface,
    direction: direction.name,
    observer,
    player,
    bullet: shot.bullet,
    state: shot.state,
    pixels,
    screenshot,
    settleMs,
  });
}

async function runSoloSurface(browser, surface) {
  const measurements = [];
  const pageErrors = [];
  const consoleTail = [];
  for (const direction of directions) {
    const page = await createPage(browser, `solo-${surface}-${direction.name}`);
    try {
      await navigateToRoom(page, surface, `AimProof-${surface}-${direction.name}`, true);
      await startProofGame(page, surface);
      await waitForPlaying(page, surface);
      await resumeProofGame(page);
      measurements.push(await aimAndShoot(page, surface, direction));
      pageErrors.push(...criticalPageErrors(page.__errors));
      consoleTail.push(...page.__consoleTail.slice(-20));
    } finally {
      await page.close().catch(() => {});
      await sleep(650);
    }
  }
  return { surface, measurements, pageErrors, consoleTail: consoleTail.slice(-50) };
}

async function runTwoBrowserControl(browser) {
  const host = await createPage(browser, 'cube-host');
  const join = await createPage(browser, 'cube-join');
  try {
    await navigateToRoom(host, 'cube', 'AimHost', true);
    await navigateToRoom(join, 'cube', 'AimJoin', false);
    await resumeProofGame(host);
    const hostSeesTwo = await waitForPage(
      host,
      () => window.__gameDebug?.getPlayerCount?.() >= 2,
      20000,
    );
    await resumeProofGame(join);
    const joinSeesTwo = await waitForPage(
      join,
      () => window.__gameDebug?.getPlayerCount?.() >= 2,
      20000,
    );
    const bothSeeTwo = hostSeesTwo && joinSeesTwo;
    if (!bothSeeTwo) throw new Error('Host/join did not both observe two players');
    await startProofGame(host, 'cube');
    await resumeProofGame(host);
    await waitForPlaying(host, 'cube');
    await resumeProofGame(join);
    await waitForPlaying(join, 'cube');
    await resumeProofGame(host);
    await resumeProofGame(join);
    const hostState = await getAimState(host);
    const hostId = hostState.localPlayerId;
    const direction = directions.find((candidate) => candidate.name === 'diagonal-up-right');
    await resumeProofGame(host);
    await host.mouse.move(host.viewport().width * direction.x, host.viewport().height * direction.y);
    await sleep(1800);
    const joinBefore = await getAimState(join);
    const fired = await host.evaluate(() => window.__gameDebug?.fireChevronAimProofShot?.() || false);
    if (!fired) throw new Error('Host could not request remote-control proof shot');
    await resumeProofGame(join);
    const observed = await waitForPage(join, ({ ownerId, minimumFrame }) => {
      const proof = window.__gameDebug?.getChevronAimProofState?.();
      if (!proof) return null;
      const remotePlayer = proof.players.find((player) => player.id === ownerId && !player.isLocal);
      const bullets = proof.recentServerBulletSpawns
        .filter((spawn) => spawn.ownerId === ownerId && spawn.frame >= minimumFrame);
      if (!remotePlayer || bullets.length === 0) return null;
      return { state: proof, player: remotePlayer, bullet: bullets[bullets.length - 1] };
    }, 8000, { ownerId: hostId, minimumFrame: joinBefore.frame });
    if (!observed) throw new Error('Joiner did not observe host aim and server bullet');
    const screenshot = relative(ROOT, resolve(artifactDir, 'cube-join-observes-host-diagonal.png'));
    await join.screenshot({ path: resolve(ROOT, screenshot) });
    const pixels = await sampleCanvasPixels(join, [
      { name: 'remote-chevron-nose', screen: observed.player.noseScreen },
      { name: 'remote-chevron-tail', screen: observed.player.tailScreen },
      { name: 'remote-bullet-origin', screen: observed.bullet.originScreen },
      { name: 'remote-bullet-direction-end', screen: observed.bullet.directionEndScreen },
    ]);
    return {
      measurement: buildMeasurement({
        surface: 'cube',
        direction: direction.name,
        observer: 'join-observes-host',
        player: observed.player,
        bullet: observed.bullet,
        state: observed.state,
        pixels,
        screenshot,
        settleMs: 1800,
      }),
      hostPlayerCount: await host.evaluate(() => window.__gameDebug?.getPlayerCount?.()),
      joinPlayerCount: await join.evaluate(() => window.__gameDebug?.getPlayerCount?.()),
      pageErrors: {
        host: criticalPageErrors(host.__errors),
        join: criticalPageErrors(join.__errors),
      },
      screenshots: {
        host: relative(ROOT, resolve(artifactDir, 'cube-host-control.png')),
        join: screenshot,
      },
    };
  } finally {
    await host.screenshot({ path: resolve(artifactDir, 'cube-host-control.png') }).catch(() => {});
    await host.close().catch(() => {});
    await join.close().catch(() => {});
  }
}

function measurementPass(measurement) {
  const errors = measurement.angularErrorsDegrees;
  return Object.values(errors).every(Number.isFinite)
    && errors.chevronToMouseOrReplicatedAim <= 5
    && errors.chevronToServerBullet <= 5
    && errors.serverBulletToMouseOrReplicatedAim <= 5
    && measurement.chevronUpToSurfaceNormalDot >= 0.99
    && measurement.meshVisible
    && measurement.visibleChildCount > 0
    && measurement.projectedNose?.inView
    && measurement.projectedTail?.inView
    && measurement.pixelEvidence?.ok
    && measurement.pixelEvidence.nonDark > 0;
}

async function main() {
  if (!['baseline', 'post-fix'].includes(PHASE)) {
    throw new Error(`Unsupported --phase=${PHASE}; use baseline or post-fix`);
  }
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');

  const serverLogs = [];
  const owned = [];
  let browser;
  let report;
  try {
    owned.push(startProcess(
      ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
      { PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0' },
      serverLogs,
    ));
    owned.push(startProcess(
      ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(DEV_PORT)],
      {},
      serverLogs,
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

    const surfaces = PHASE === 'baseline' ? ['cube'] : ['cube', 'sphere'];
    const solo = [];
    for (const surface of surfaces) {
      solo.push(await runSoloSurface(browser, surface));
    }
    const twoBrowserControl = RUN_TWO_BROWSER ? await runTwoBrowserControl(browser) : null;
    const measurements = solo.flatMap((entry) => entry.measurements);
    if (twoBrowserControl) measurements.push(twoBrowserControl.measurement);
    const allPageErrors = [
      ...solo.flatMap((entry) => entry.pageErrors),
      ...(twoBrowserControl
        ? [...twoBrowserControl.pageErrors.host, ...twoBrowserControl.pageErrors.join]
        : []),
    ];
    const serverErrors = criticalServerErrors(serverLogs);
    const baselineMismatch = measurements.some((measurement) =>
      measurement.direction !== 'right'
      && measurement.angularErrorsDegrees.chevronToMouseOrReplicatedAim > 20
      && Number.isFinite(measurement.angularErrorsDegrees.serverBulletToMouseOrReplicatedAim)
      && measurement.angularErrorsDegrees.serverBulletToMouseOrReplicatedAim <= 5);
    const postPass = measurements.length === 9
      && measurements.every(measurementPass)
      && allPageErrors.length === 0
      && serverErrors.length === 0;
    const verdict = PHASE === 'baseline'
      ? (baselineMismatch ? 'BASELINE_MISMATCH_REPRODUCED' : 'BASELINE_NOT_REPRODUCED')
      : (postPass ? 'PASS' : 'FAIL');
    report = {
      verdict,
      phase: PHASE,
      runId,
      command: `node tests/visual/mp-chevron-aim-proof.mjs --phase=${PHASE}`,
      proofBoundary: 'Linux headless Chrome, SwiftShader WebGL2, loopback Colyseus; no Windows/WebGPU/physical-LAN feel claim.',
      rendererRequest: 'webgl',
      chrome,
      devPort: DEV_PORT,
      serverPort: SERVER_PORT,
      thresholds: {
        angularErrorDegreesMax: 5,
        chevronUpToSurfaceNormalDotMin: 0.99,
      },
      baselineMismatch,
      solo,
      twoBrowserControl,
      measurements,
      pageErrors: allPageErrors,
      serverErrors,
      serverEvidence: serverLogs
        .filter((line) => /Game started|client joined|room/i.test(line))
        .slice(-80)
        .map(sanitizeEvidenceLine),
      screenshots: readdirSync(artifactDir).map((name) => relative(ROOT, resolve(artifactDir, name))),
    };
  } catch (error) {
    report = {
      verdict: 'ERROR',
      phase: PHASE,
      runId,
      error: error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error),
      serverErrors: criticalServerErrors(serverLogs),
      serverLogTail: serverLogs.slice(-100),
      screenshots: existsSync(artifactDir)
        ? readdirSync(artifactDir).map((name) => relative(ROOT, resolve(artifactDir, name)))
        : [],
    };
  } finally {
    await browser?.close().catch(() => {});
    for (const child of owned.reverse()) await stopProcessTree(child);
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ verdict: report.verdict, report: relative(ROOT, jsonPath) }, null, 2));
  }
  if (!['PASS', 'BASELINE_MISMATCH_REPRODUCED'].includes(report.verdict)) process.exitCode = 1;
}

await main();
