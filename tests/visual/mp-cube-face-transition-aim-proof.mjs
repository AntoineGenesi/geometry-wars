#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEV_PORT = Number(process.env.DEV_PORT || 3011);
const SERVER_PORT = Number(process.env.SERVER_PORT || 2573);
const TARGET_DISTANCE = Number(process.env.PROOF_TARGET_DISTANCE || 2.4);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(ROOT, 'test-screenshots/mp-cube-face-transition-aim-proof', runId);
const jsonPath = resolve(ROOT, 'reports', `mp-cube-face-transition-aim-proof-${runId}.json`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sharedParentRoot = resolve(ROOT, '../../..');

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

function projectToolPath(relativeToolPath) {
  return [ROOT, sharedParentRoot]
    .map((root) => resolve(root, relativeToolPath))
    .find((candidate) => existsSync(candidate));
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

async function waitForLog(logs, predicate, timeoutMs = 2500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = logs.find(predicate);
    if (match) return match;
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

function dot(a, b) {
  const left = Array.isArray(a) ? a : [a?.x, a?.y, a?.z];
  const right = Array.isArray(b) ? b : [b?.x, b?.y, b?.z];
  if (![...left, ...right].every(Number.isFinite)) return null;
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function angularErrorDegrees(a, b) {
  const d = dot(a, b);
  if (!Number.isFinite(d)) return null;
  return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
}

function distance(a, b) {
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

function trajectoryMetrics(samples, bulletWorldDir) {
  if (!Array.isArray(samples) || samples.length < 2) {
    return { sampleCount: samples?.length ?? 0, traveledDistance: 0, reversals: 0, initialAngularError: null };
  }
  let traveledDistance = 0;
  let reversals = 0;
  let previousStep = null;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1].world;
    const cur = samples[i].world;
    const step = [cur.x - prev.x, cur.y - prev.y, cur.z - prev.z];
    const stepLen = Math.hypot(...step);
    traveledDistance += stepLen;
    if (previousStep) {
      const turnDot = dot(
        step.map((value) => value / Math.max(0.000001, stepLen)),
        previousStep,
      );
      if (Number.isFinite(turnDot) && turnDot < -0.25) reversals++;
    }
    if (stepLen > 0.000001) previousStep = step.map((value) => value / stepLen);
  }
  const first = samples[0].world;
  const second = samples[1].world;
  const firstStep = [second.x - first.x, second.y - first.y, second.z - first.z];
  const firstStepLen = Math.hypot(...firstStep);
  const firstStepDir = firstStepLen > 0.000001 ? firstStep.map((value) => value / firstStepLen) : null;
  return {
    sampleCount: samples.length,
    traveledDistance,
    reversals,
    initialAngularError: firstStepDir ? angularErrorDegrees(firstStepDir, bulletWorldDir) : null,
  };
}

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 720 });
  page.__errors = [];
  page.__consoleTail = [];
  page.on('pageerror', (error) => page.__errors.push(error.message));
  page.on('console', (message) => {
    const line = `[${message.type()}] ${message.text()}`;
    page.__consoleTail.push(line);
    if (page.__consoleTail.length > 200) page.__consoleTail.shift();
    if (message.type() === 'error') page.__errors.push(message.text());
  });
  return page;
}

async function navigateToCubeRoom(page) {
  const params = new URLSearchParams({
    mode: 'network',
    surface: 'cube',
    server: `ws://127.0.0.1:${SERVER_PORT}`,
    debug: 'true',
    testMode: 'true',
    godMode: 'true',
    name: 'CubeTransitionAimProof',
    gameMode: 'waves',
    renderer: 'webgl',
    creator: '1',
  });
  await page.goto(`http://127.0.0.1:${DEV_PORT}?${params.toString()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  const connected = await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
  if (!connected) throw new Error('proof browser did not connect to loopback MP server');
}

async function startProofGame(page) {
  const started = await waitForPage(
    page,
    () => window.__gameDebug?.startChevronAimProofGame?.('cube') || false,
    30000,
  );
  if (!started) throw new Error('could not start cube Waves proof game');
}

async function resumeProofGame(page) {
  await page.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());
  await page.evaluate(() => {
    const resumeButton = Array.from(document.querySelectorAll('button')).find((button) => {
      const label = (button.textContent || '').trim();
      return label.includes('RESUME')
        && (button.offsetParent !== null || getComputedStyle(button).display !== 'none');
    });
    resumeButton?.click();
  });
}

async function getProofState(page) {
  return page.evaluate(() => window.__gameDebug?.getChevronAimProofState?.() || null);
}

async function waitForPlaying(page) {
  const state = await waitForPage(page, () => {
    const proof = window.__gameDebug?.getChevronAimProofState?.();
    return proof?.roomPhase === 'playing' && proof?.surface === 'cube' ? proof : null;
  }, 30000);
  if (!state) throw new Error('cube Waves proof game did not reach playing state');
  return state;
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');
  const tsxCli = projectToolPath('node_modules/tsx/dist/cli.mjs');
  const viteCli = projectToolPath('node_modules/vite/bin/vite.js');
  if (!tsxCli || !viteCli) {
    throw new Error(`Missing local tool paths: tsx=${tsxCli ?? 'missing'} vite=${viteCli ?? 'missing'}`);
  }

  const serverLogs = [];
  const owned = [];
  let browser;
  let report;

  try {
    owned.push(startProcess(
      [tsxCli, 'server/index.ts'],
      { PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0', GEOMETRY_WARS_MP_PROOF_CONTROLS: '1' },
      serverLogs,
    ));
    owned.push(startProcess(
      [viteCli, '--host', '127.0.0.1', '--port', String(DEV_PORT)],
      {},
      serverLogs,
    ));
    const [serverReady, viteReady] = await Promise.all([
      waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`),
      waitForHttp(`http://127.0.0.1:${DEV_PORT}`),
    ]);
    if (!serverReady || !viteReady) {
      throw new Error(`readiness failed: server=${serverReady} vite=${viteReady}`);
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

    const page = await createPage(browser);
    await navigateToCubeRoom(page);
    await startProofGame(page);
    await waitForPlaying(page);
    await resumeProofGame(page);
    const beforeSetupState = await getProofState(page);
    const beforePlayer = beforeSetupState.players.find((player) => player.id === beforeSetupState.localPlayerId);

    const requested = await page.evaluate((targetDistance) =>
      window.__gameDebug?.setupCubeFaceTransitionAimProof?.(targetDistance) || false,
      TARGET_DISTANCE,
    );
    if (!requested) throw new Error('client rejected cube face-transition proof setup request');

    const afterTransitionState = await waitForPage(page, (targetDistance) => {
      const proof = window.__gameDebug?.getChevronAimProofState?.();
      if (!proof?.cubeFaceTransitionAimProofSetup?.ok) return null;
      const local = proof.players.find((player) => player.id === proof.localPlayerId);
      const setup = proof.cubeFaceTransitionAimProofSetup;
      const target = proof.proofEnemies.find((enemy) => enemy.id === setup.targetEnemyId);
      const beforeNormal = setup.before?.normal;
      const afterNormal = setup.after?.normal;
      const normalDot = beforeNormal && afterNormal
        ? beforeNormal[0] * afterNormal[0] + beforeNormal[1] * afterNormal[1] + beforeNormal[2] * afterNormal[2]
        : 1;
      if (!local || !target || normalDot >= 0.75 || !Number.isFinite(setup.targetDistance)) {
        return null;
      }
      return proof;
    }, 10000, TARGET_DISTANCE);
    if (!afterTransitionState) {
      const state = await getProofState(page);
      throw new Error(`cube face-transition proof setup did not produce observable transition: ${JSON.stringify(state?.cubeFaceTransitionAimProofSetup ?? null)}`);
    }
    await sleep(700);

    const afterTransitionScreenshot = relative(ROOT, resolve(artifactDir, 'after-transition-before-shot.png'));
    await page.screenshot({ path: resolve(ROOT, afterTransitionScreenshot) });
    await resumeProofGame(page);
    const beforeShotState = await getProofState(page);
    const beforeShotPlayer = beforeShotState.players.find((player) => player.id === beforeShotState.localPlayerId);
    const targetEnemyId = beforeShotState.cubeFaceTransitionAimProofSetup.targetEnemyId;
    const fired = await page.evaluate(() => window.__gameDebug?.fireCubeFaceTransitionAimProofShot?.() || false);
    if (!fired) throw new Error('client rejected cube face-transition proof shot request');

    const shotState = await waitForPage(page, ({ minimumFrame, ownerId }) => {
      const proof = window.__gameDebug?.getChevronAimProofState?.();
      if (!proof) return null;
      const bullets = proof.recentServerBulletSpawns
        .filter((spawn) => spawn.ownerId === ownerId && spawn.frame >= minimumFrame);
      if (bullets.length === 0) return null;
      return { proof, bullet: bullets[bullets.length - 1] };
    }, 7000, { minimumFrame: beforeShotState.frame, ownerId: beforeShotState.localPlayerId });

    const postShotState = await waitForPage(page, ({ bulletId, targetEnemyId: targetId }) => {
      const proof = window.__gameDebug?.getChevronAimProofState?.();
      if (!proof) return null;
      const trajectory = proof.recentClientBulletTrajectorySamples
        .find((entry) => entry.bulletId === bulletId);
      const hitReport = proof.recentClientBulletHitReports
        .find((entry) => entry.bulletId === bulletId && entry.enemyId === targetId);
      const target = proof.proofEnemies.find((enemy) => enemy.id === targetId);
      if (!hitReport && target) return null;
      return { proof, trajectory, hitReport, target };
    }, 9000, { bulletId: shotState?.bullet.id, targetEnemyId });

    const postShotScreenshot = relative(ROOT, resolve(artifactDir, 'post-shot.png'));
    await page.screenshot({ path: resolve(ROOT, postShotScreenshot) });

    const fallbackPostShotProof = postShotState?.proof ?? await getProofState(page);
    const fallbackPostShotTrajectory = fallbackPostShotProof.recentClientBulletTrajectorySamples
      .find((entry) => entry.bulletId === shotState?.bullet.id);
    const fallbackPostShotHitReport = fallbackPostShotProof.recentClientBulletHitReports
      .find((entry) => entry.bulletId === shotState?.bullet.id && entry.enemyId === targetEnemyId);
    const fallbackPostShotTarget = fallbackPostShotProof.proofEnemies.find((enemy) => enemy.id === targetEnemyId);
    const shotProof = shotState?.proof ?? fallbackPostShotProof;
    const shotPlayer = shotProof.players.find((player) => player.id === shotProof.localPlayerId);
    const bullet = shotState?.bullet ?? null;
    const trajectory = (postShotState?.trajectory ?? fallbackPostShotTrajectory)?.samples ?? [];
    const trajectorySummary = trajectoryMetrics(trajectory, bullet?.worldDir);
    const setup = shotProof.cubeFaceTransitionAimProofSetup;
    const transitionNormalDot = dot(setup?.before?.normal, setup?.after?.normal);
    const angularErrors = {
      chevronToAim: angularErrorDegrees(shotPlayer?.chevronForward, shotPlayer?.mouseOrReplicatedWorldAim),
      serverBulletToAim: angularErrorDegrees(bullet?.worldDir, shotPlayer?.mouseOrReplicatedWorldAim),
      trajectoryInitialToServerBullet: trajectorySummary.initialAngularError,
    };
    const targetAfter = postShotState?.target ?? fallbackPostShotTarget ?? null;
    const hitReport = postShotState?.hitReport ?? fallbackPostShotHitReport ?? null;
    const serverAcceptedHitLine = hitReport
      ? await waitForLog(serverLogs, (line) =>
        line.includes('[GameRoom] bullet_hit:')
        && /\(hp=0(?:\.0+)?, remaining=0(?:\.0+)?\)/.test(line))
      : null;
    const hitReportClientPass = Boolean(
      hitReport
      && hitReport.ownerId === shotProof.localPlayerId
      && hitReport.enemyId === targetEnemyId
    );
    const targetSyncObserved = Boolean(
      !targetAfter || targetAfter.health <= 0 || targetAfter.alive === false
    );
    const serverAcceptedHit = Boolean(serverAcceptedHitLine);
    const cameraAimPass = Boolean(
      setup?.ok
      && Number.isFinite(transitionNormalDot)
      && transitionNormalDot < 0.75
      && Number.isFinite(angularErrors.chevronToAim)
      && angularErrors.chevronToAim <= 5
      && shotPlayer?.chevronUpToNormalDot >= 0.99
      && shotProof.camera?.right?.every(Number.isFinite)
      && shotProof.camera?.up?.every(Number.isFinite),
    );
    const spawnPass = Boolean(
      bullet
      && bullet.faceIndex >= 0
      && bullet.originUV
      && Number.isFinite(bullet.originUV.u)
      && Number.isFinite(bullet.originUV.v)
      && Number.isFinite(angularErrors.serverBulletToAim)
      && angularErrors.serverBulletToAim <= 5
      && bullet.distToPlayer <= 1.0,
    );
    const travelPass = Boolean(
      trajectorySummary.sampleCount >= 4
      && trajectorySummary.traveledDistance > 0.4
      && trajectorySummary.reversals === 0
      && Number.isFinite(trajectorySummary.initialAngularError)
      && trajectorySummary.initialAngularError <= 12,
    );
    const hitReportPass = Boolean(
      hitReportClientPass
      && (targetSyncObserved || serverAcceptedHit),
    );
    const hitReportSummary = {
      clientReport: hitReportClientPass,
      targetSyncObserved,
      serverAcceptedHit,
      serverAcceptedHitLine: serverAcceptedHitLine ? sanitizeEvidenceLine(serverAcceptedHitLine) : null,
    };

    let verdict = 'PASS';
    if (!cameraAimPass) verdict = 'FAIL_AIM';
    else if (!spawnPass) verdict = 'FAIL_SPAWN';
    else if (!travelPass) verdict = 'FAIL_TRAVEL';
    else if (!hitReportPass) verdict = 'FAIL_HIT_REPORT';

    report = {
      verdict,
      runId,
      command: 'GEOMETRY_WARS_MP_PROOF_CONTROLS=1 node tests/visual/mp-cube-face-transition-aim-proof.mjs',
      proofBoundary: 'One headless browser in a real loopback Colyseus cube Waves room through src/network-main.ts and server/rooms/GameRoom.ts. Server setup is opt-in via GEOMETRY_WARS_MP_PROOF_CONTROLS=1 and browser testMode; firing uses the production input/tryShoot/schema bullet path and client-authoritative bullet_hit path.',
      rendererRequest: 'webgl',
      chrome,
      devPort: DEV_PORT,
      serverPort: SERVER_PORT,
      targetDistance: TARGET_DISTANCE,
      setup,
      beforeSetup: {
        frame: beforeSetupState.frame,
        player: beforePlayer,
      },
      beforeShot: {
        frame: beforeShotState.frame,
        camera: beforeShotState.camera,
        player: beforeShotPlayer,
        proofEnemies: beforeShotState.proofEnemies,
      },
      shot: {
        frame: shotProof.frame,
        camera: shotProof.camera,
        player: shotPlayer,
        serverBullet: bullet,
      },
      trajectory,
      trajectorySummary,
      hitReport,
      hitReportSummary,
      targetAfter,
      angularErrors,
      segmentVerdicts: {
        cameraAim: cameraAimPass ? 'PASS' : 'FAIL_AIM',
        spawnTangent: spawnPass ? 'PASS' : 'FAIL_SPAWN',
        projectileTravel: travelPass ? 'PASS' : 'FAIL_TRAVEL',
        hitReport: hitReportPass ? 'PASS' : 'FAIL_HIT_REPORT',
      },
      screenshots: [afterTransitionScreenshot, postShotScreenshot],
      pageErrors: criticalPageErrors(page.__errors),
      consoleTail: page.__consoleTail.slice(-80),
      serverErrors: criticalServerErrors(serverLogs),
      serverEvidence: serverLogs
        .filter((line) => /Cube face-transition aim proof|bullet_hit|Game started|client joined|room/i.test(line))
        .slice(-100)
        .map(sanitizeEvidenceLine),
    };

    if (report.pageErrors.length > 0 || report.serverErrors.length > 0) {
      report.verdict = report.verdict === 'PASS' ? 'FAIL_TRAVEL' : report.verdict;
    }
  } catch (error) {
    report = {
      verdict: 'ERROR',
      runId,
      error: error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error),
      serverErrors: criticalServerErrors(serverLogs),
      serverLogTail: serverLogs.slice(-120).map(sanitizeEvidenceLine),
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

  if (report.verdict !== 'PASS') process.exitCode = 1;
}

await main();
