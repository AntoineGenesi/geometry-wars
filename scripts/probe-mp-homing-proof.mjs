#!/usr/bin/env node
/**
 * Bounded MP homing live-path proof.
 *
 * Starts a real Vite + Colyseus network game, stages one deterministic homing
 * target through opt-in proof controls, fires through the normal input path,
 * and samples server bullet direction, client geodesic trajectory, and hit
 * telemetry from src/network-main.ts.
 */
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORT = Number(getArg('port') || process.env.DEV_PORT || 3011);
const SERVER_PORT = Number(getArg('server-port') || process.env.SERVER_PORT || 2571);
const SURFACE = getArg('surface') || 'sphere';
const TARGET_DISTANCE = Number(getArg('target-distance') || 2.2);
const TARGET_ANGLE = Number(getArg('target-angle') || 1.05);
const ENEMY_HEALTH = Number(getArg('enemy-health') || 6);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = resolve(ROOT, 'test-screenshots/mp-homing-proof', RUN_ID);
const REPORT_PATH = resolve(ROOT, 'reports', `mp-homing-proof-${RUN_ID}.json`);
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
      if (logs.length > 500) logs.shift();
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
      // Retry within the bounded window.
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

function angleBetween(a, b) {
  if (!a || !b) return null;
  const ax = Array.isArray(a) ? a[0] : a.x;
  const ay = Array.isArray(a) ? a[1] : a.y;
  const az = Array.isArray(a) ? a[2] : (a.z ?? 0);
  const bx = Array.isArray(b) ? b[0] : b.x;
  const by = Array.isArray(b) ? b[1] : b.y;
  const bz = Array.isArray(b) ? b[2] : (b.z ?? 0);
  if (![ax, ay, az, bx, by, bz].every(Number.isFinite)) return null;
  const dot = ax * bx + ay * by + az * bz;
  const la = Math.hypot(ax, ay, az);
  const lb = Math.hypot(bx, by, bz);
  if (la < 1e-6 || lb < 1e-6) return null;
  return Math.acos(Math.max(-1, Math.min(1, dot / (la * lb))));
}

function maxDirectionChange(vectors) {
  let max = 0;
  for (let i = 1; i < vectors.length; i++) {
    const angle = angleBetween(vectors[0], vectors[i]);
    if (Number.isFinite(angle)) max = Math.max(max, angle);
  }
  return max;
}

function criticalPageErrors(errors) {
  return errors.filter((message) =>
    !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated/i.test(message));
}

function criticalServerErrors(logs) {
  return logs.filter((line) => /\b(fatal|uncaught|unhandled|exception|error:)\b/i.test(line));
}

function sanitizeLine(line) {
  return line.replaceAll(ROOT, '<project-root>');
}

function analyzeSamples(samples) {
  const homingSnapshots = samples
    .flatMap((sample) => (sample.bullets || []).map((bullet) => ({ sample, bullet })))
    .filter(({ bullet }) => bullet.weaponType === 'homing');
  const bulletId = homingSnapshots[0]?.bullet.id ?? null;
  const sameBullet = homingSnapshots.filter(({ bullet }) => bullet.id === bulletId);
  const serverDirs = sameBullet.map(({ bullet }) => bullet.serverDir).filter(Boolean);
  const clientDirs = sameBullet.map(({ bullet }) => bullet.clientGeo?.dirWorld).filter(Boolean);
  const distances = sameBullet
    .map(({ bullet }) => bullet.distanceToTarget)
    .filter((value) => Number.isFinite(value));
  const trajectorySamples = samples
    .flatMap((sample) => sample.recentClientBulletTrajectorySamples || [])
    .find((entry) => entry.bulletId === bulletId)?.samples || [];
  const trajectoryDirs = trajectorySamples.map((sample) => sample.dirWorld).filter(Boolean);
  const setup = samples.find((sample) => sample.setup?.ok)?.setup || null;
  const targetEnemyId = setup?.enemyId ?? null;
  const hitReports = samples.flatMap((sample) => sample.recentClientBulletHitReports || []);
  const homingHit = hitReports.find((hit) =>
    hit.weaponType === 'homing' && (!targetEnemyId || hit.enemyId === targetEnemyId));
  const final = samples[samples.length - 1] || {};
  const finalEnemy = (final.serverEnemies || []).find((enemy) => enemy.id === targetEnemyId);
  const owner = final.owner || {};

  return {
    bulletId,
    targetEnemyId,
    homingSnapshotCount: sameBullet.length,
    serverDirectionChangeRad: maxDirectionChange(serverDirs),
    clientDirectionChangeRad: maxDirectionChange(clientDirs),
    trajectoryDirectionChangeRad: maxDirectionChange(trajectoryDirs),
    firstDistanceToTarget: distances[0] ?? null,
    minDistanceToTarget: distances.length ? Math.min(...distances) : null,
    finalDistanceToTarget: distances[distances.length - 1] ?? null,
    hitReport: homingHit || null,
    enemyRemoved: Boolean(targetEnemyId) && !finalEnemy,
    finalEnemy: finalEnemy || null,
    ownerEnemyKills: owner.enemyKills ?? 0,
  };
}

function checksForAnalysis(analysis, pageErrors, serverLogs) {
  const browserCritical = criticalPageErrors(pageErrors);
  const serverCritical = criticalServerErrors(serverLogs);
  return [
    { name: 'Homing setup accepted', pass: Boolean(analysis.targetEnemyId), detail: analysis.targetEnemyId || 'none' },
    { name: 'Homing bullet observed', pass: analysis.homingSnapshotCount >= 3, detail: `${analysis.homingSnapshotCount} samples for ${analysis.bulletId || 'none'}` },
    { name: 'Server homing direction changed', pass: analysis.serverDirectionChangeRad > 0.12, detail: `${analysis.serverDirectionChangeRad.toFixed(3)} rad` },
    { name: 'Client-visible homing direction changed', pass: Math.max(analysis.clientDirectionChangeRad, analysis.trajectoryDirectionChangeRad) > 0.12, detail: `current=${analysis.clientDirectionChangeRad.toFixed(3)} trajectory=${analysis.trajectoryDirectionChangeRad.toFixed(3)} rad` },
    { name: 'Homing bullet approached target', pass: analysis.minDistanceToTarget !== null && analysis.firstDistanceToTarget !== null && analysis.minDistanceToTarget < analysis.firstDistanceToTarget - 0.25, detail: `${analysis.firstDistanceToTarget} -> ${analysis.minDistanceToTarget}` },
    { name: 'Homing hit report emitted', pass: Boolean(analysis.hitReport), detail: JSON.stringify(analysis.hitReport) },
    { name: 'Staged enemy damaged or removed', pass: analysis.enemyRemoved || (analysis.finalEnemy?.health ?? ENEMY_HEALTH) < ENEMY_HEALTH, detail: JSON.stringify({ enemyRemoved: analysis.enemyRemoved, finalEnemy: analysis.finalEnemy, ownerEnemyKills: analysis.ownerEnemyKills }) },
    { name: 'No critical browser errors', pass: browserCritical.length === 0, detail: JSON.stringify(browserCritical) },
    { name: 'No critical server errors', pass: serverCritical.length === 0, detail: JSON.stringify(serverCritical) },
  ];
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');

  const serverLogs = [];
  const pageErrors = [];
  const consoleTail = [];
  const owned = [];
  let browser;
  let report;
  try {
    owned.push(startProcess(
      commandPath('npx') || resolve(NODE_BIN, 'npx'),
      ['tsx', 'server/index.ts'],
      { PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0', GEOMETRY_WARS_MP_PROOF_CONTROLS: '1' },
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
        '--disable-dev-shm-usage', '--window-size=960,720',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 720 });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      const line = `[${message.type()}] ${message.text()}`;
      consoleTail.push(line);
      if (consoleTail.length > 160) consoleTail.shift();
      if (message.type() === 'error') pageErrors.push(message.text());
    });

    const params = new URLSearchParams({
      mode: 'network',
      surface: SURFACE,
      server: `ws://127.0.0.1:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      godMode: 'true',
      creator: '1',
      name: 'HomingProof',
      gameMode: 'waves',
      renderer: 'webgl',
      music: 'false',
    });
    const url = `http://127.0.0.1:${DEV_PORT}?${params.toString()}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const connected = await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
    if (!connected) throw new Error('Solo MP client did not connect');

    const started = await waitForPage(page, (surface) => window.__gameDebug?.startChevronAimProofGame?.(surface), 30000, SURFACE);
    if (!started) throw new Error(`Could not start MP homing proof game on ${SURFACE}`);
    await waitForPage(page, () => window.__GAME_TELEMETRY?.network?.roomPhase === 'playing', 30000);
    await page.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());

    const setupSent = await page.evaluate(
      ({ targetDistance, targetAngle, enemyHealth }) => window.__gameDebug?.setupHomingProof?.({ targetDistance, targetAngle, enemyHealth }) || false,
      { targetDistance: TARGET_DISTANCE, targetAngle: TARGET_ANGLE, enemyHealth: ENEMY_HEALTH },
    );
    if (!setupSent) throw new Error('Could not send homing proof setup');
    const setupReady = await waitForPage(page, () => {
      const state = window.__gameDebug?.getHomingProofState?.();
      return state?.setup?.ok && state.serverEnemies?.some((enemy) => enemy.id === state.setup.enemyId);
    }, 15000);
    if (!setupReady) throw new Error('Homing proof setup was not reflected in client state');
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'setup.png') });

    const fired = await page.evaluate(() => window.__gameDebug?.fireHomingProofShot?.() || false);
    if (!fired) throw new Error('Could not fire homing proof shot');

    const samples = [];
    const startedAt = Date.now();
    while (Date.now() - startedAt < 6000) {
      const state = await page.evaluate(() => window.__gameDebug?.getHomingProofState?.() || null);
      if (state) samples.push({ wallMs: Date.now() - startedAt, ...state });
      const analysis = analyzeSamples(samples);
      if (analysis.hitReport && analysis.enemyRemoved && analysis.homingSnapshotCount >= 3) break;
      await sleep(100);
    }
    await page.screenshot({ path: resolve(ARTIFACT_DIR, 'after-shot.png') });

    const analysis = analyzeSamples(samples);
    const checks = checksForAnalysis(analysis, pageErrors, serverLogs);
    const passed = checks.every((check) => check.pass);
    report = {
      verdict: passed ? 'PASS' : 'FAIL',
      runId: RUN_ID,
      url,
      surface: SURFACE,
      targetDistance: TARGET_DISTANCE,
      targetAngle: TARGET_ANGLE,
      enemyHealth: ENEMY_HEALTH,
      analysis,
      checks,
      sampleCount: samples.length,
      firstSample: samples[0] || null,
      finalSample: samples[samples.length - 1] || null,
      pageErrors,
      consoleEvidence: consoleTail.slice(-80).map(sanitizeLine),
      serverEvidence: serverLogs
        .filter((line) => /Game started|Homing proof setup|bullet_hit|homing/.test(line))
        .map(sanitizeLine),
      screenshots: readdirSync(ARTIFACT_DIR).map((name) => relative(ROOT, resolve(ARTIFACT_DIR, name))),
      proofBoundary: 'One headless browser in a real MP Waves room through src/network-main.ts and server/rooms/GameRoom.ts. Proof controls are opt-in via GEOMETRY_WARS_MP_PROOF_CONTROLS=1 and only stage the deterministic scene; firing uses normal input/tryShoot/synced bullet/render/hit-report paths. This does not prove two-client LAN, Windows BAT, WebGPU, mobile hardware, or unsupported homing mastery nodes.',
    };
  } catch (error) {
    report = {
      verdict: 'FAIL',
      runId: RUN_ID,
      error: error instanceof Error ? error.stack || error.message : String(error),
      pageErrors,
      consoleEvidence: consoleTail.slice(-80).map(sanitizeLine),
      serverEvidence: serverLogs.slice(-120).map(sanitizeLine),
      proofBoundary: 'The bounded live MP homing probe failed before satisfying its claim.',
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await Promise.all(owned.map(stopProcessTree));
  }

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    verdict: report.verdict,
    reportPath: REPORT_PATH,
    analysis: report.analysis,
    error: report.error,
  }, null, 2));
  return report.verdict === 'PASS';
}

main().then((passed) => process.exit(passed ? 0 : 1));
