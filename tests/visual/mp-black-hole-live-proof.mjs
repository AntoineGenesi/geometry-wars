#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { delimiter, dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEV_PORT = Number(process.env.DEV_PORT || 3008);
const SERVER_PORT = Number(process.env.SERVER_PORT || 2570);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(ROOT, 'test-screenshots/mp-black-hole-live-proof', runId);
const reportPath = resolve(ROOT, 'reports', `mp-black-hole-vortex-cube-waves-${runId}.json`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function commandPath(command) {
  try {
    return execFileSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function findUp(relativePath, startDir = ROOT) {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
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

function startProcess(args, env, logs) {
  const resolvedArgs = [...args];
  if (resolvedArgs[0]?.startsWith('node_modules/')) {
    resolvedArgs[0] = findUp(resolvedArgs[0]) || resolvedArgs[0];
  }
  const child = spawn(process.execPath, resolvedArgs, {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
      PATH: [dirname(process.execPath), process.env.PATH || ''].join(delimiter),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const capture = (stream, source) => stream.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      if (!line.trim()) continue;
      logs.push(`[${source}] ${line.replaceAll(ROOT, '<project-root>')}`);
      if (logs.length > 500) logs.shift();
    }
  });
  capture(child.stdout, 'process');
  capture(child.stderr, 'process-error');
  return child;
}

async function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Process already stopped.
  }
  await sleep(300);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Graceful stop completed.
  }
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
    await sleep(250);
  }
  return false;
}

async function waitForPage(page, predicate, timeoutMs = 30000, arg = undefined) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await page.evaluate(predicate, arg).catch(() => null);
    if (value) return value;
    await sleep(50);
  }
  return null;
}

async function sampleProofStates(page, durationMs = 1500, intervalMs = 100) {
  const samples = [];
  const started = Date.now();
  while (Date.now() - started < durationMs) {
    const state = await page.evaluate(() => window.__gameDebug?.getBlackHoleProofState?.() || null).catch(() => null);
    if (state) samples.push({ t: Date.now() - started, state });
    await sleep(intervalMs);
  }
  return samples;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(a) {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len > 0.000001 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
}

function summarizeTrajectory({ baseline, boltFlight, formation, flightSamples }) {
  const aimVector = normalize(baseline.owner?.aimVector ?? [0, 0, 0]);
  const origin = baseline.owner?.world ?? [0, 0, 0];
  const bolt = boltFlight.bolts?.[0] ?? null;
  const sampledBoltStates = [
    { t: 0, state: boltFlight },
    ...flightSamples,
  ].filter(sample => sample.state?.bolts?.length === 1 && sample.state?.fields?.length === 0);
  const forwardDistances = sampledBoltStates.map(sample =>
    dot(subtract(sample.state.bolts[0].center, origin), aimVector));
  const directionDots = sampledBoltStates.map(sample =>
    dot(normalize(sample.state.bolts[0].direction), aimVector));
  const preFieldEnemyMovement = sampledBoltStates.map(sample => ({
    t: sample.t,
    movedCount: sample.state.enemies.filter((enemy, index) =>
      distance(enemy.world, baseline.enemies[index]?.world ?? enemy.world) > 0.01).length,
  }));

  return {
    aimAngle: baseline.owner?.aimAngle ?? null,
    aimVector,
    origin,
    boltDirection: bolt?.direction ?? null,
    boltDirectionDotAim: bolt ? dot(normalize(bolt.direction), aimVector) : null,
    sampledBoltCountBeforeField: sampledBoltStates.length,
    directionDots,
    minDirectionDot: directionDots.length ? Math.min(...directionDots) : null,
    forwardDistances,
    maxForwardTravel: forwardDistances.length ? Math.max(...forwardDistances) : null,
    fieldConversionPoint: formation.fields?.[0]?.center ?? null,
    fieldConversionForwardDistance: formation.fields?.[0]
      ? dot(subtract(formation.fields[0].center, origin), aimVector)
      : null,
    preFieldEnemyMovement,
    movedBeforeField: preFieldEnemyMovement.some(sample => sample.movedCount > 0),
    retainedSamples: sampledBoltStates.map(sample => ({
      t: sample.t,
      bolt: sample.state.bolts[0],
      enemyWorld: sample.state.enemies.map(enemy => enemy.world),
    })),
  };
}

function pairwiseMedian(enemies) {
  const distances = [];
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      distances.push(distance(enemies[i].world, enemies[j].world));
    }
  }
  return median(distances);
}

async function sampleCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return { ok: false, nonDark: 0, samples: 0 };
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) return { ok: false, nonDark: 0, samples: 0 };
    context.drawImage(canvas, 0, 0);
    let nonDark = 0;
    let samples = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const px = Math.min(copy.width - 1, Math.round((x + 0.5) * copy.width / 16));
        const py = Math.min(copy.height - 1, Math.round((y + 0.5) * copy.height / 16));
        const data = context.getImageData(px, py, 1, 1).data;
        if (Math.max(data[0], data[1], data[2]) >= 25) nonDark++;
        samples++;
      }
    }
    return { ok: true, nonDark, samples, width: copy.width, height: copy.height };
  });
}

async function capture(page, name, observedState = null) {
  const screenshotPath = resolve(artifactDir, `${name}.png`);
  const state = observedState
    ?? await page.evaluate(() => window.__gameDebug?.getBlackHoleProofState?.() || null);
  const canvas = await sampleCanvas(page);
  await page.screenshot({ path: screenshotPath });
  return {
    name,
    screenshot: relative(ROOT, screenshotPath),
    state,
    canvas,
  };
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');

  const logs = [];
  const owned = [];
  const pageErrors = [];
  const snapshots = [];
  let flightSamples = [];
  let lastProofState = null;
  let browser;
  let page;
  let report;
  try {
    owned.push(startProcess(
      ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
      {
        PORT: String(SERVER_PORT),
        SHUTDOWN_TIMEOUT: '0',
        GEOMETRY_WARS_MP_PROOF_CONTROLS: '1',
      },
      logs,
    ));
    owned.push(startProcess(
      ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(DEV_PORT)],
      {},
      logs,
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
        '--disable-dev-shm-usage', '--window-size=960,720',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 960, height: 720 });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    const params = new URLSearchParams({
      mode: 'network',
      surface: 'cube',
      server: `ws://127.0.0.1:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      godMode: 'true',
      creator: '1',
      name: 'BlackHoleProof',
      gameMode: 'waves',
      renderer: 'webgl',
    });
    await page.goto(`http://127.0.0.1:${DEV_PORT}?${params}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const connected = await waitForPage(page, () => window.__gameDebug?.isConnected?.() || false, 45000);
    if (!connected) throw new Error('Host browser did not connect');
    const started = await waitForPage(
      page,
      () => window.__gameDebug?.startBlackHoleProofGame?.() || false,
      10000,
    );
    if (!started) throw new Error('Could not start cube Waves proof game');
    const playing = await waitForPage(page, () => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      return state?.roomPhase === 'playing' && state?.surface === 'cube' ? state : null;
    }, 30000);
    if (!playing) throw new Error('Cube Waves did not enter playing state');

    await page.evaluate(() => window.__gameDebug?.resumeBlackHoleProofGame?.());
    const resumed = await waitForPage(page, () => !Array.from(document.querySelectorAll('button')).some((button) => {
      const label = (button.textContent || '').trim();
      return label.includes('RESUME')
        && button.offsetParent !== null
        && getComputedStyle(button).display !== 'none';
    }), 5000);
    if (!resumed) throw new Error('Pause overlay did not dismiss');
    await page.mouse.move(760, 360);
    await sleep(600);
    const setupSent = await page.evaluate(() => window.__gameDebug?.setupBlackHoleProof?.() || false);
    if (!setupSent) throw new Error('Could not request proof setup');
    const baseline = await waitForPage(page, () => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      return state?.enemies?.length === 4 && state?.owner?.weaponType === 'black_hole' ? state : null;
    }, 10000);
    if (!baseline) throw new Error('Proof enemies or Black Hole weapon did not synchronize');

    const fired = await page.evaluate(() => window.__gameDebug?.fireBlackHoleProof?.() || false);
    if (!fired) throw new Error('Could not fire Black Hole proof shot');

    const boltFlight = await waitForPage(page, () => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      return state?.bolts?.length === 1 && state?.fields?.length === 0 ? state : null;
    }, 5000);
    if (!boltFlight) throw new Error('No synchronized travelling bolt phase observed before field formation');
    snapshots.push(await capture(page, '00-bolt-flight', boltFlight));
    flightSamples = await sampleProofStates(page, 900, 80);

    const formation = await waitForPage(page, () => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      const field = state?.fields?.[0];
      return state?.bolts?.length === 0
        && state?.fields?.length === 1
        && field.phase === 'formation'
        && field.visual?.rootChildren > 0
        ? state
        : null;
    }, 5000);
    if (!formation) throw new Error('No synchronized formation phase observed');
    snapshots.push(await capture(page, '01-formation', formation));

    const sustain = await waitForPage(page, () => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      const field = state?.fields?.[0];
      return field?.phase === 'sustain' && field.age >= 1.1 ? state : null;
    }, 5000);
    if (!sustain) throw new Error('No synchronized sustain phase observed');
    snapshots.push(await capture(page, '02-sustain', sustain));

    const collapse = await waitForPage(page, () => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      const field = state?.fields?.[0];
      return field?.phase === 'collapse' && field.age >= 2.6 ? state : null;
    }, 5000);
    if (!collapse) throw new Error('No synchronized collapse phase observed');
    snapshots.push(await capture(page, '03-collapse', collapse));

    const cleanup = await waitForPage(page, () => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      return state?.fields?.length === 0 && state?.visualCount === 0 ? state : null;
    }, 5000);
    if (!cleanup) throw new Error('Field or client visual did not clean up');
    snapshots.push(await capture(page, '04-cleanup', cleanup));

    const fieldSnapshots = snapshots.filter((snapshot) => snapshot.state.fields?.length === 1);
    const activeSnapshots = fieldSnapshots.slice(0, 3).map((snapshot) => snapshot.state);
    const centers = activeSnapshots.map((state) => state.fields[0].center);
    const centerDrift = Math.max(...centers.map((center) => distance(center, centers[0])));
    const baselineDistances = baseline.enemies.map((enemy) => distance(enemy.world, centers[0]));
    const sustainDistances = sustain.enemies.map((enemy) => distance(enemy.world, centers[0]));
    const approachedCount = sustain.enemies.filter((enemy, index) =>
      distance(enemy.world, centers[0]) < baselineDistances[index] - 0.05).length;
    const initialSeparation = pairwiseMedian(baseline.enemies);
    const sustainSeparation = pairwiseMedian(sustain.enemies);
    const initialHealth = baseline.enemies.reduce((sum, enemy) => sum + enemy.health, 0);
    const sustainHealth = sustain.enemies.reduce((sum, enemy) => sum + enemy.health, 0);
    const phases = activeSnapshots.map((state) => state.fields[0].phase);
    const blackHoleBulletMaximum = Math.max(
      baseline.bulletCounts.black_hole || 0,
      ...snapshots.map((snapshot) => snapshot.state.bulletCounts.black_hole || 0),
    );
    const boltVisualObserved = Boolean(boltFlight.bolts?.[0]?.visual?.rootChildren > 0);
    const trajectory = summarizeTrajectory({ baseline, boltFlight, formation, flightSamples });
    const visiblePhases = activeSnapshots.every((state) =>
      state.fields[0].visual?.rootChildren > 0
      && state.fields[0].visual?.boundaryScale > 0);
    const criticalErrors = pageErrors.filter((message) =>
      !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer/i.test(message));
    const criticalServerErrors = logs.filter((line) => /\b(fatal|uncaught|unhandled|exception|error:)\b/i.test(line));
    const checks = {
      cubeWaves: cleanup.surface === 'cube' && cleanup.gameMode === 'waves',
      travellingBoltBeforeField: boltFlight.bolts.length === 1 && boltFlight.fields.length === 0,
      boltUsesOwnerAimDirection: (trajectory.boltDirectionDotAim ?? -1) >= 0.98
        && (trajectory.minDirectionDot ?? -1) >= 0.98,
      boltTravelsForwardBeforeField: (trajectory.maxForwardTravel ?? 0) > 0.05,
      boltVisualRendered: boltFlight.boltVisualCount === 1 && boltVisualObserved,
      fieldAfterBoltImpact: formation.bolts.length === 0 && formation.fields.length === 1,
      fieldConvertsInFront: (trajectory.fieldConversionForwardDistance ?? 0) > 0.05,
      oneServerField: activeSnapshots.every((state) => state.fields.length === 1),
      zeroBlackHoleBullets: blackHoleBulletMaximum === 0,
      stationaryCanonicalCenter: centerDrift <= 1e-6
        && activeSnapshots.every((state) => Math.abs(state.fields[0].barycentric.reduce((sum, value) => sum + value, 0) - 1) < 1e-4),
      clusteredEnemyMovement: approachedCount >= 3
        && sustainSeparation !== null && initialSeparation !== null
        && sustainSeparation < initialSeparation,
      serverTimedHealthLoss: sustainHealth < initialHealth,
      ownerKillAndScoreAttribution: cleanup.owner.enemyKills >= baseline.owner.enemyKills + 4
        && cleanup.owner.playerKills >= baseline.owner.playerKills + 4
        && cleanup.owner.score > baseline.owner.score,
      visiblePhaseChanges: JSON.stringify(phases) === JSON.stringify(['formation', 'sustain', 'collapse'])
        && visiblePhases,
      cleanup: cleanup.fields.length === 0 && cleanup.visualCount === 0 && cleanup.enemies.length === 0,
      canvasRendered: snapshots.every((snapshot) => snapshot.canvas.ok && snapshot.canvas.nonDark > 0),
      noCriticalErrors: criticalErrors.length === 0 && criticalServerErrors.length === 0,
    };
    report = {
      verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
      runId,
      command: 'node tests/visual/mp-black-hole-live-proof.mjs',
      proofBoundary: 'One Linux headless Chrome host, SwiftShader WebGL2, loopback Colyseus, cube Waves. No remote/joiner, Windows, WebGPU, physical-LAN, PvP pull, or final-balance claim.',
      checks,
      metrics: {
        centerDrift,
        baselineDistances,
        sustainDistances,
        approachedCount,
        initialMedianPairwiseSeparation: initialSeparation,
        sustainMedianPairwiseSeparation: sustainSeparation,
        initialHealth,
        sustainHealth,
        blackHoleBulletMaximum,
        boltFlight: {
          age: boltFlight.bolts?.[0]?.age ?? null,
          maxAge: boltFlight.bolts?.[0]?.maxAge ?? null,
          pullRadius: boltFlight.bolts?.[0]?.pullRadius ?? null,
          visualCount: boltFlight.boltVisualCount,
        },
        trajectory,
        phases,
        finalOwner: cleanup.owner,
      },
      snapshots,
      criticalErrors,
      criticalServerErrors,
      logTail: logs.slice(-80),
    };
  } catch (error) {
    lastProofState = await page?.evaluate(() => window.__gameDebug?.getBlackHoleProofState?.() || null).catch(() => null) ?? null;
    report = {
      verdict: 'ERROR',
      runId,
      command: 'node tests/visual/mp-black-hole-live-proof.mjs',
      error: error instanceof Error ? error.stack : String(error),
      lastProofState,
      flightSamples,
      snapshots,
      pageErrors,
      logTail: logs.slice(-100),
    };
  } finally {
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await browser?.close().catch(() => {});
    for (const child of owned.reverse()) await stopProcessTree(child);
  }

  console.log(JSON.stringify({ verdict: report.verdict, report: relative(ROOT, reportPath) }));
  if (report.verdict !== 'PASS') process.exitCode = 1;
}

await main();
