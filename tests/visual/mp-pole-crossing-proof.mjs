#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const DEV_PORT = Number(getArg('port', process.env.DEV_PORT || '3032'));
const SERVER_PORT = Number(getArg('server-port', process.env.SERVER_PORT || '2574'));
const SURFACE = getArg('surface', 'peanut');
const START_U = Number(getArg('start-u', '0'));
const START_V = Number(getArg('start-v', '0.02'));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const reportJsonPath = resolve(ROOT, 'reports', `mp-pole-crossing-proof-${SURFACE}-${runId}.json`);
const reportMdPath = resolve(ROOT, 'reports', `mp-pole-crossing-proof-${SURFACE}-${runId}.md`);
const screenshotPath = resolve(ROOT, 'test-screenshots/mp-pole-crossing-proof', `${SURFACE}-${runId}.png`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const sharedParentRoot = resolve(ROOT, '../../..');

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

function vec3(value) {
  if (Array.isArray(value)) return { x: value[0], y: value[1], z: value[2] };
  return value ?? null;
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function length(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v) {
  const len = length(v);
  return len > 0.000001 ? { x: v.x / len, y: v.y / len, z: v.z / len } : null;
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function stableUpFromNormal(normal) {
  const ref = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
  const right = normalize(cross(ref, normal));
  return right ? normalize(cross(normal, right)) : null;
}

function localPlayer(proof) {
  return proof?.players?.find((player) => player.id === proof.localPlayerId || player.isLocal) ?? null;
}

function criticalErrors(errors) {
  return errors.filter((message) =>
    !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated/i.test(message));
}

function sanitize(line) {
  return line.replaceAll(ROOT, '<project-root>');
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
      if (page.__consoleTail.length > 200) page.__consoleTail.shift();
      if (message.type() === 'error') page.__errors.push(message.text());
    });

    const params = new URLSearchParams({
      mode: 'network',
      surface: SURFACE,
      server: `ws://127.0.0.1:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      godMode: 'true',
      name: `PoleProof-${SURFACE}`,
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

    const started = await waitForPage(page, (surface) => window.__gameDebug?.startPoleCrossingProofGame?.(surface) || false, 30000, SURFACE);
    if (!started) throw new Error(`could not start ${SURFACE} pole-crossing proof game`);
    await waitForPage(page, (surface) => {
      const proof = window.__gameDebug?.getChevronAimProofState?.();
      return proof?.roomPhase === 'playing' && proof?.surface === surface ? proof : null;
    }, 30000, SURFACE);
    await page.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());

    const setupRequested = await page.evaluate(({ startU, startV }) =>
      window.__gameDebug?.setupPoleCrossingProof?.(startU, startV) || false,
    { startU: START_U, startV: START_V });
    if (!setupRequested) throw new Error('client rejected pole-crossing setup request');

    const beforeProof = await waitForPage(page, () => {
      const proof = window.__gameDebug?.getChevronAimProofState?.();
      return proof?.poleCrossingProofSetup?.ok ? proof : null;
    }, 10000);
    const beforePlayer = localPlayer(beforeProof);
    if (!beforePlayer?.serverWorld || !beforePlayer?.serverNormal) {
      throw new Error('missing local player server world/normal in proof state');
    }
    const startWorld = vec3(beforePlayer.serverWorld);
    const startNormal = normalize(vec3(beforePlayer.serverNormal));
    const intended = stableUpFromNormal(startNormal);
    if (!intended) throw new Error('could not compute intended stable-up direction');

    const samples = [];
    samples.push({ label: 'before', proof: beforeProof, telemetry: await page.evaluate(() => window.__GAME_TELEMETRY ?? null) });
    await page.evaluate(() => window.__gameDebug?.sendPoleCrossingProofInput?.(0, 1, 1400));
    for (let i = 0; i < 10; i++) {
      await sleep(120);
      samples.push({
        label: `move-${i}`,
        proof: await page.evaluate(() => window.__gameDebug?.getChevronAimProofState?.() ?? null),
        telemetry: await page.evaluate(() => window.__GAME_TELEMETRY ?? null),
      });
    }
    await page.evaluate(() => window.__gameDebug?.sendPoleCrossingProofInput?.(0, 0));
    await sleep(300);
    await page.screenshot({ path: screenshotPath }).catch(() => {});

    const movementSamples = samples
      .map((sample) => {
        const player = localPlayer(sample.proof);
        const world = vec3(player?.serverWorld);
        const rendered = player?.position ? vec3(player.position) : null;
        return {
          label: sample.label,
          frame: sample.proof?.frame,
          time: sample.proof?.time,
          serverWorld: world,
          serverNormal: vec3(player?.serverNormal),
          serverTangent: vec3(player?.serverTangent),
          serverBitangent: vec3(player?.serverBitangent),
          serverFaceIndex: player?.serverFaceIndex ?? null,
          serverUV: player?.serverUV ?? null,
          renderedWorld: rendered,
          renderDelta: world && rendered ? length(subtract(rendered, world)) : null,
          camera: sample.proof?.camera ?? null,
          telemetryCamera: sample.telemetry?.camera ?? null,
          lastSentInput: sample.telemetry?.aim?.lastSentInput ?? null,
        };
      })
      .filter((sample) => sample.serverWorld);

    const firstMoved = movementSamples
      .slice(1)
      .map((sample) => ({ sample, delta: subtract(sample.serverWorld, startWorld) }))
      .find((entry) => length(entry.delta) > 0.05);
    const lastMoved = [...movementSamples]
      .reverse()
      .map((sample) => ({ sample, delta: subtract(sample.serverWorld, startWorld) }))
      .find((entry) => length(entry.delta) > 0.25);
    const firstMovementDirection = firstMoved ? normalize(firstMoved.delta) : null;
    const netMovementDirection = lastMoved ? normalize(lastMoved.delta) : null;
    const firstDirectionDot = firstMovementDirection ? dot(firstMovementDirection, intended) : null;
    const directionDot = netMovementDirection ? dot(netMovementDirection, intended) : null;
    const netDistance = lastMoved ? length(lastMoved.delta) : 0;
    const maxRenderDelta = Math.max(...movementSamples.map((sample) => sample.renderDelta ?? 0));
    const cameraResetCount = Math.max(...movementSamples.map((sample) => sample.telemetryCamera?.renderTarget?.resetCount ?? 0));
    const cameraSnapCount = Math.max(...movementSamples.map((sample) => sample.telemetryCamera?.renderTarget?.snapCount ?? 0));

    const movementPass = Number.isFinite(directionDot) && directionDot > 0.35 && netDistance > 0.25;
    const renderPass = Number.isFinite(maxRenderDelta) && maxRenderDelta < 0.6;
    const noCriticalErrors = criticalErrors(page.__errors).length === 0;
    const verdict = movementPass && renderPass && noCriticalErrors ? 'PASS' : 'FAIL';

    report = {
      verdict,
      runId,
      command: `GEOMETRY_WARS_MP_PROOF_CONTROLS=1 node tests/visual/mp-pole-crossing-proof.mjs --surface=${SURFACE}`,
      proofBoundary: 'One headless browser in a real loopback Colyseus Waves room through src/network-main.ts and server/rooms/GameRoom.ts. Test-mode debug API stages the host near the selected surface pole and sends real NetworkClient input messages with fixed camera axes.',
      surface: SURFACE,
      devPort: DEV_PORT,
      serverPort: SERVER_PORT,
      setup: beforeProof.poleCrossingProofSetup,
      startWorld,
      startNormal,
      intendedStableUp: intended,
      firstMovedSample: firstMoved?.sample?.label ?? null,
      netMovedSample: lastMoved?.sample?.label ?? null,
      firstDirectionDot,
      directionDot,
      netDistance,
      movementPass,
      renderPass,
      maxRenderDelta,
      cameraResetCount,
      cameraSnapCount,
      samples: movementSamples,
      screenshot: relative(ROOT, screenshotPath),
      pageErrors: criticalErrors(page.__errors),
      consoleTail: page.__consoleTail.slice(-80),
      serverEvidence: logs
        .filter((line) => /Pole crossing proof|Game started|client joined|room/i.test(line))
        .slice(-100)
        .map(sanitize),
    };
  } catch (error) {
    report = {
      verdict: 'ERROR',
      runId,
      surface: SURFACE,
      error: error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error),
      serverLogTail: logs.slice(-120).map(sanitize),
    };
  } finally {
    await browser?.close().catch(() => {});
    for (const child of children.reverse()) await stopProcessTree(child);
    writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
    const md = [
      `# MP Pole Crossing Proof - ${SURFACE}`,
      '',
      `- verdict: ${report.verdict}`,
      `- directionDot: ${report.directionDot ?? 'n/a'}`,
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
      directionDot: report.directionDot ?? null,
      maxRenderDelta: report.maxRenderDelta ?? null,
      report: relative(ROOT, reportJsonPath),
      markdown: relative(ROOT, reportMdPath),
      screenshot: report.screenshot ?? null,
    }, null, 2));
  }

  if (report.verdict !== 'PASS') process.exitCode = 1;
}

await main();
