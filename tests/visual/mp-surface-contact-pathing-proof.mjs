#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const DEV_PORT = Number(getArg('port', process.env.DEV_PORT || '3034'));
const SERVER_PORT = Number(getArg('server-port', process.env.SERVER_PORT || '2576'));
const SURFACE = getArg('surface', 'sphere');
const MODE = getArg('mode', 'waves');
const KIND = getArg('kind', 'pathing');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const reportJsonPath = resolve(ROOT, 'reports', `mp-surface-contact-pathing-proof-${SURFACE}-${MODE}-${KIND}-${runId}.json`);
const reportMdPath = resolve(ROOT, 'reports', `mp-surface-contact-pathing-proof-${SURFACE}-${MODE}-${KIND}-${runId}.md`);
const screenshotPath = resolve(ROOT, 'test-screenshots/mp-surface-contact-pathing-proof', `${SURFACE}-${MODE}-${KIND}-${runId}.png`);
const sharedParentRoot = resolve(ROOT, '../../..');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function getArg(name, fallback = '') {
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
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

function startProcess(nodeArgs, env, logs) {
  const child = spawn(process.execPath, nodeArgs, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const capture = (stream, source) => stream.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      if (!line.trim()) continue;
      logs.push(`[${source}] ${line}`);
      if (logs.length > 700) logs.shift();
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

function vec3(value) {
  if (Array.isArray(value)) return { x: value[0], y: value[1], z: value[2] };
  return value ?? null;
}

function dist(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function localPlayer(proof) {
  return proof?.players?.find((player) => player.id === proof.localPlayerId || player.isLocal) ?? null;
}

function proofEnemy(proof, enemyId) {
  return proof?.proofEnemies?.find((enemy) => !enemyId || enemy.id === enemyId) ?? null;
}

function criticalErrors(errors) {
  return errors.filter((message) =>
    !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated/i.test(message));
}

function sanitize(line) {
  return line.replaceAll(ROOT, '<project-root>');
}

function summarizeSample(sample, enemyId) {
  const player = localPlayer(sample.proof);
  const enemy = proofEnemy(sample.proof, enemyId);
  const playerWorld = vec3(player?.serverWorld);
  const enemyWorld = vec3(enemy?.serverWorld ?? enemy?.world);
  const renderedWorld = vec3(enemy?.world);
  return {
    label: sample.label,
    frame: sample.proof?.frame,
    time: sample.proof?.time,
    player: player ? {
      id: player.id,
      health: player.health,
      maxHealth: player.maxHealth,
      lives: player.lives,
      alive: player.alive,
      serverWorld: player.serverWorld,
      serverUV: player.serverUV,
    } : null,
    enemy: enemy ? {
      id: enemy.id,
      type: enemy.type,
      health: enemy.health,
      alive: enemy.alive,
      serverWorld: enemy.serverWorld,
      renderedWorld: enemy.world,
      serverUV: enemy.serverUV,
      renderDelta: dist(enemyWorld, renderedWorld),
      distanceToPlayer: dist(playerWorld, enemyWorld),
      screen: enemy.screen,
    } : null,
  };
}

function compactTimeline(samples) {
  return samples.map((sample) => ({
    label: sample.label,
    time: sample.time,
    playerHealth: sample.player?.health ?? null,
    playerLives: sample.player?.lives ?? null,
    playerAlive: sample.player?.alive ?? null,
    enemyDistanceToPlayer: sample.enemy?.distanceToPlayer ?? null,
    enemyServerUV: sample.enemy?.serverUV ?? null,
    enemyRenderDelta: sample.enemy?.renderDelta ?? null,
  }));
}

async function main() {
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  mkdirSync(dirname(screenshotPath), { recursive: true });
  const chrome = findChrome();
  const tsxCli = projectToolPath('node_modules/tsx/dist/cli.mjs');
  const viteCli = projectToolPath('node_modules/vite/bin/vite.js');
  if (!chrome || !tsxCli || !viteCli) throw new Error(`Missing tool path: chrome=${chrome} tsx=${tsxCli} vite=${viteCli}`);

  const logs = [];
  const children = [];
  let browser;
  let report;

  try {
    children.push(startProcess([tsxCli, 'server/index.ts'], {
      PORT: String(SERVER_PORT),
      SHUTDOWN_TIMEOUT: '0',
      GEOMETRY_WARS_MP_PROOF_CONTROLS: '1',
    }, logs));
    children.push(startProcess([viteCli, '--host', '127.0.0.1', '--port', String(DEV_PORT)], {}, logs));
    const [serverReady, viteReady] = await Promise.all([
      waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`),
      waitForHttp(`http://127.0.0.1:${DEV_PORT}`),
    ]);
    if (!serverReady || !viteReady) throw new Error(`readiness failed: server=${serverReady} vite=${viteReady}`);

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
    page.__errors = [];
    page.__consoleTail = [];
    page.on('pageerror', (error) => page.__errors.push(error.message));
    page.on('console', (message) => {
      const line = `[${message.type()}] ${message.text()}`;
      page.__consoleTail.push(line);
      if (page.__consoleTail.length > 220) page.__consoleTail.shift();
      if (message.type() === 'error') page.__errors.push(message.text());
    });

    const params = new URLSearchParams({
      mode: 'network',
      surface: SURFACE,
      server: `ws://127.0.0.1:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      name: `SurfaceProof-${SURFACE}-${KIND}`,
      gameMode: MODE,
      renderer: 'webgl',
      creator: '1',
    });
    await page.goto(`http://127.0.0.1:${DEV_PORT}?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const connected = await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
    if (!connected) throw new Error('proof browser did not connect to loopback MP server');

    const started = await waitForPage(page, ({ surface, mode }) =>
      window.__gameDebug?.startSurfaceContactPathingProofGame?.(surface, mode) || false,
    30000, { surface: SURFACE, mode: MODE });
    if (!started) throw new Error(`could not start ${SURFACE}/${MODE} ${KIND} proof game`);
    await waitForPage(page, ({ surface, mode }) => {
      const proof = window.__gameDebug?.getChevronAimProofState?.();
      return proof?.roomPhase === 'playing' && proof?.surface === surface && proof?.gameMode === mode ? proof : null;
    }, 30000, { surface: SURFACE, mode: MODE });
    await page.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());

    const setupOptions = KIND === 'contact'
      ? { kind: 'contact', playerU: 0.18, playerV: 0.29, contactDistance: 0.35, enemyType: 'grunt' }
      : { kind: 'pathing', playerU: 0, playerV: 0.08, enemyU: 0.5, enemyV: 0.08, enemyType: 'grunt' };
    const setupRequested = await page.evaluate((options) =>
      window.__gameDebug?.setupSurfaceContactPathingProof?.(options) || false,
    setupOptions);
    if (!setupRequested) throw new Error('client rejected surface contact/pathing proof setup request');

    const setupProof = await waitForPage(page, () => {
      const proof = window.__gameDebug?.getChevronAimProofState?.();
      return proof?.surfaceContactPathingProofSetup?.ok ? proof : null;
    }, 10000);
    if (!setupProof) throw new Error('surface contact/pathing proof setup did not complete');

    const setup = setupProof.surfaceContactPathingProofSetup;
    const samples = [];
    samples.push({ label: 'setup', proof: setupProof });
    const sampleCount = KIND === 'contact' ? 8 : 18;
    for (let i = 0; i < sampleCount; i++) {
      await sleep(KIND === 'contact' ? 180 : 220);
      samples.push({
        label: `sample-${i}`,
        proof: await page.evaluate(() => window.__gameDebug?.getChevronAimProofState?.() ?? null),
      });
    }
    await page.screenshot({ path: screenshotPath }).catch(() => {});

    const summarized = samples.map((sample) => summarizeSample(sample, setup.enemyId));
    const first = summarized.find((sample) => sample.enemy?.distanceToPlayer != null);
    const last = [...summarized].reverse().find((sample) => sample.enemy?.distanceToPlayer != null);
    const maxRenderDelta = Math.max(...summarized.map((sample) => sample.enemy?.renderDelta ?? 0));
    const localFinal = last?.player ?? null;
    const pathDistanceChange = first && last
      ? first.enemy.distanceToPlayer - last.enemy.distanceToPlayer
      : null;
    const contactDistance = first?.enemy?.distanceToPlayer ?? last?.enemy?.distanceToPlayer ?? null;
    const contactPass = KIND === 'contact'
      && localFinal?.health === 75
      && localFinal?.lives === 3
      && localFinal?.alive === true
      && (contactDistance ?? Infinity) < 0.45;
    const pathingPass = KIND === 'pathing'
      && Number.isFinite(pathDistanceChange)
      && pathDistanceChange > 0.15
      && maxRenderDelta < 0.75;
    const noCriticalErrors = criticalErrors(page.__errors).length === 0;
    const verdict = (KIND === 'contact' ? contactPass : pathingPass) && noCriticalErrors ? 'PASS' : 'FAIL';

    report = {
      verdict,
      runId,
      command: `GEOMETRY_WARS_MP_PROOF_CONTROLS=1 DEV_PORT=${DEV_PORT} SERVER_PORT=${SERVER_PORT} node tests/visual/mp-surface-contact-pathing-proof.mjs --surface=${SURFACE} --mode=${MODE} --kind=${KIND}`,
      proofBoundary: 'One headless browser in a real loopback Colyseus room through src/network-main.ts and server/rooms/GameRoom.ts. Opt-in test-mode setup clears normal waves and creates one authoritative server enemy/player scene; server world positions and health/life state are sampled from the live replicated MP state.',
      surface: SURFACE,
      mode: MODE,
      kind: KIND,
      devPort: DEV_PORT,
      serverPort: SERVER_PORT,
      setup,
      pathDistanceChange,
      startDistance: first?.enemy?.distanceToPlayer ?? null,
      finalDistance: last?.enemy?.distanceToPlayer ?? null,
      finalPlayer: localFinal,
      maxRenderDelta,
      sampleSummary: {
        count: summarized.length,
        first: first ?? null,
        last: last ?? null,
        timeline: compactTimeline(summarized),
      },
      screenshot: relative(ROOT, screenshotPath),
      pageErrors: criticalErrors(page.__errors),
      consoleTail: page.__consoleTail.slice(-100),
      serverEvidence: logs
        .filter((line) => /Surface contact|Game started|client joined|room|player_hit/i.test(line))
        .slice(-120)
        .map(sanitize),
    };
  } catch (error) {
    report = {
      verdict: 'ERROR',
      runId,
      surface: SURFACE,
      mode: MODE,
      kind: KIND,
      error: error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error),
      serverLogTail: logs.slice(-140).map(sanitize),
    };
  } finally {
    await browser?.close().catch(() => {});
    for (const child of children.reverse()) await stopProcessTree(child);
    writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
    const md = [
      `# MP Surface Contact/Pathing Proof - ${SURFACE} ${MODE} ${KIND}`,
      '',
      `- verdict: ${report.verdict}`,
      `- startDistance: ${report.startDistance ?? 'n/a'}`,
      `- finalDistance: ${report.finalDistance ?? 'n/a'}`,
      `- pathDistanceChange: ${report.pathDistanceChange ?? 'n/a'}`,
      `- finalPlayerHealth: ${report.finalPlayer?.health ?? 'n/a'}`,
      `- finalPlayerLives: ${report.finalPlayer?.lives ?? 'n/a'}`,
      `- maxRenderDelta: ${report.maxRenderDelta ?? 'n/a'}`,
      `- screenshot: ${report.screenshot ?? 'n/a'}`,
      `- json: ${relative(ROOT, reportJsonPath)}`,
      '',
      report.proofBoundary ?? '',
      '',
    ].join('\n');
    writeFileSync(reportMdPath, md);
    console.log(JSON.stringify({
      verdict: report.verdict,
      surface: SURFACE,
      mode: MODE,
      kind: KIND,
      startDistance: report.startDistance ?? null,
      finalDistance: report.finalDistance ?? null,
      pathDistanceChange: report.pathDistanceChange ?? null,
      finalPlayer: report.finalPlayer ?? null,
      report: relative(ROOT, reportJsonPath),
      markdown: relative(ROOT, reportMdPath),
      screenshot: report.screenshot ?? null,
    }, null, 2));
  }

  if (report.verdict !== 'PASS') process.exitCode = 1;
}

await main();
