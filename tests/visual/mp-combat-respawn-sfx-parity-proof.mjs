#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { delimiter, dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEV_PORT = Number(process.env.DEV_PORT || 3008);
const SERVER_PORT = Number(process.env.SERVER_PORT || 2570);
const MODES = (process.argv.find((arg) => arg.startsWith('--modes='))?.split('=')[1] || 'waves,pvpve,king')
  .split(',')
  .map((mode) => mode.trim())
  .filter(Boolean);
const SURFACE = process.argv.find((arg) => arg.startsWith('--surface='))?.split('=')[1] || 'cube';
const RENDERER = process.argv.find((arg) => arg.startsWith('--renderer='))?.split('=')[1] || 'webgl2';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(ROOT, 'test-screenshots/mp-combat-respawn-sfx-parity', runId);
const reportPath = resolve(ROOT, 'reports', `mp-combat-respawn-sfx-parity-proof-${runId}.json`);
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
    // Fall through.
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

function sanitizeEvidenceLine(line) {
  return String(line)
    .replaceAll(ROOT, '<project-root>')
    .replace(/session[:= ]+[A-Za-z0-9_-]+/gi, 'session=<session>')
    .replace(/sessionId[:= ]+[A-Za-z0-9_-]+/gi, 'sessionId=<session>')
    .replace(/\(session: [A-Za-z0-9_-]+\)/g, '(session: <session>)')
    .replace(/player=[A-Za-z0-9_-]+/g, 'player=<session>')
    .replace(/PLAYER LEFT: session [A-Za-z0-9_-]+/g, 'PLAYER LEFT: session <session>')
    .replace(/\/[A-Za-z0-9_-]{9}\/[A-Za-z0-9_-]{9}\?sessionId=[A-Za-z0-9_-]+/g, '/<room>/<process>?sessionId=<session>')
    .replace(/path: \/[^,\s]+/g, 'path: <ws-path>')
    .replace(/logs\/mp-perf-[A-Za-z0-9_-]+-\d{4}-\d{2}-\d{2}\.jsonl/g, 'logs/mp-perf-<id>.jsonl')
    .replace(/joined \([A-Za-z0-9_-]{8,}\)/g, 'joined (<player-id>)')
    .replace(/player [A-Za-z0-9_-]{8,}:/g, 'player <player-id>:')
    .replace(/Host god mode activated for [A-Za-z0-9_-]{8,}/g, 'Host god mode activated for <player-id>')
    .replace(/\b[A-Za-z0-9_-]{8,} used cached startup config\b/g, '<session> used cached startup config');
}

function sanitizeProofState(state) {
  if (!state || typeof state !== 'object') return state;
  return {
    ...state,
    localPlayerId: state.localPlayerId ? '<local-player>' : state.localPlayerId,
  };
}

async function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already stopped.
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
      // Retry.
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
    await sleep(75);
  }
  return null;
}

async function openMpPage(browser, mode, pageErrors) {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 720 });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
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
    name: `CombatProof-${mode}`,
    gameMode: mode,
    renderer: RENDERER === 'webgl2' ? 'webgl' : RENDERER,
  });
  await page.goto(`http://127.0.0.1:${DEV_PORT}?${params}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  const connected = await waitForPage(page, () => window.__gameDebug?.isConnected?.() || false, 45000);
  if (!connected) throw new Error(`Host browser did not connect for ${mode}`);
  return page;
}

async function runAoeMode(browser, mode, pageErrors) {
  const page = await openMpPage(browser, mode, pageErrors);
  try {
    const started = await waitForPage(
      page,
      ({ surface, gameMode }) => window.__gameDebug?.startBlackHoleProofGame?.(surface, gameMode) || false,
      10000,
      { surface: SURFACE, gameMode: mode },
    );
    if (!started) throw new Error(`Could not start ${mode} Black Hole proof game`);
    const playing = await waitForPage(page, (gameMode) => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      return state?.roomPhase === 'playing' && state?.gameMode === gameMode ? state : null;
    }, 30000, mode);
    if (!playing) throw new Error(`${mode} did not enter playing state`);
    await page.evaluate(() => window.__gameDebug?.resumeBlackHoleProofGame?.());
    await sleep(250);
    const setupSent = await page.evaluate(() => window.__gameDebug?.setupBlackHoleProof?.() || false);
    if (!setupSent) throw new Error(`Could not setup ${mode} Black Hole proof`);
    const baseline = await waitForPage(page, () => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      return state?.enemies?.length === 4 && state?.owner?.weaponType === 'black_hole' ? state : null;
    }, 10000);
    if (!baseline) throw new Error(`${mode} proof enemies did not synchronize`);
    const fired = await page.evaluate(() => window.__gameDebug?.fireBlackHoleProof?.() || false);
    if (!fired) throw new Error(`Could not fire ${mode} Black Hole proof shot`);
    const sustain = await waitForPage(page, () => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      const field = state?.fields?.[0];
      return field?.phase === 'sustain' && field.age >= 1.1 ? state : null;
    }, 8000);
    if (!sustain) throw new Error(`${mode} no sustain phase observed`);
    const cleanup = await waitForPage(page, () => {
      const state = window.__gameDebug?.getBlackHoleProofState?.();
      return state?.fields?.length === 0 ? state : null;
    }, 8000);
    const initialHealth = baseline.enemies.reduce((sum, enemy) => sum + enemy.health, 0);
    const sustainHealth = sustain.enemies.reduce((sum, enemy) => sum + enemy.health, 0);
    const screenshotPath = resolve(artifactDir, `aoe-${mode}.png`);
    await page.screenshot({ path: screenshotPath });
    return {
      mode,
      initialHealth,
      sustainHealth,
      healthLost: initialHealth - sustainHealth,
      ownerEnemyKills: cleanup?.owner?.enemyKills ?? null,
      screenshot: relative(ROOT, screenshotPath),
      pass: sustainHealth < initialHealth,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function runSfxProof(browser, pageErrors) {
  const page = await openMpPage(browser, 'waves', pageErrors);
  try {
    const started = await waitForPage(
      page,
      () => window.__gameDebug?.startBlackHoleProofGame?.('cube', 'waves') || false,
      10000,
    );
    if (!started) throw new Error('Could not start SFX proof game');
    const playing = await waitForPage(page, () => {
      const state = window.__gameDebug?.getCombatSfxProofState?.();
      return state?.roomPhase === 'playing' && state?.gameMode === 'waves' ? state : null;
    }, 30000);
    if (!playing) throw new Error('SFX proof did not enter Waves playing state');
    await page.evaluate(() => window.__gameDebug?.resumeBlackHoleProofGame?.());
    await sleep(250);
    const before = await page.evaluate(() => window.__gameDebug?.getCombatSfxProofState?.() || null);
    const held = await page.evaluate(() => window.__gameDebug?.holdCombatSfxProofFire?.(1400) || false);
    if (!held) throw new Error('Could not hold fire for SFX proof');
    await sleep(1800);
    const after = await page.evaluate(() => window.__gameDebug?.getCombatSfxProofState?.() || null);
    const screenshotPath = resolve(artifactDir, 'sfx-held-fire.png');
    await page.screenshot({ path: screenshotPath });
    const delta = {
      localShotClusters: (after?.localShotClusters ?? 0) - (before?.localShotClusters ?? 0),
      localServerBulletSpawns: (after?.localServerBulletSpawns ?? 0) - (before?.localServerBulletSpawns ?? 0),
      localBlackHoleBoltSpawns: (after?.localBlackHoleBoltSpawns ?? 0) - (before?.localBlackHoleBoltSpawns ?? 0),
      shootSfxPlays: (after?.shootSfxPlays ?? 0) - (before?.shootSfxPlays ?? 0),
    };
    return {
      before: sanitizeProofState(before),
      after: sanitizeProofState(after),
      delta,
      screenshot: relative(ROOT, screenshotPath),
      pass: delta.localShotClusters > 0
        && delta.shootSfxPlays === delta.localShotClusters
        && delta.localServerBulletSpawns + delta.localBlackHoleBoltSpawns >= delta.localShotClusters,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');

  const logs = [];
  const owned = [];
  const pageErrors = [];
  let browser;
  let report;
  try {
    owned.push(startProcess(
      ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
      { PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0', GEOMETRY_WARS_MP_PROOF_CONTROLS: '1' },
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
    const aoe = [];
    for (const mode of MODES) {
      aoe.push(await runAoeMode(browser, mode, pageErrors));
    }
    const sfx = await runSfxProof(browser, pageErrors);
    const criticalErrors = pageErrors.filter((message) =>
      !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer/i.test(message));
    const criticalServerErrors = logs.filter((line) => /\b(fatal|uncaught|unhandled|exception|error:)\b/i.test(line));
    report = {
      verdict: aoe.every((entry) => entry.pass) && sfx.pass && criticalErrors.length === 0 && criticalServerErrors.length === 0
        ? 'PASS'
        : 'FAIL',
      runId,
      command: 'node tests/visual/mp-combat-respawn-sfx-parity-proof.mjs',
      surface: SURFACE,
      modes: MODES,
      renderer: RENDERER,
      checks: {
        aoeModesPassed: aoe.every((entry) => entry.pass),
        sfxCadencePassed: sfx.pass,
        noCriticalErrors: criticalErrors.length === 0 && criticalServerErrors.length === 0,
      },
      aoe,
      sfx,
      criticalErrors,
      criticalServerErrors,
      logTail: logs.slice(-80).map(sanitizeEvidenceLine),
      proofBoundary: 'One Linux headless Chrome host, SwiftShader WebGL2, loopback Colyseus through src/network-main.ts and server/rooms/GameRoom.ts. AoE proof uses server-authoritative Black Hole damage in requested modes. SFX proof compares local authoritative shot/effect clusters with client shoot SFX play counter. No two-client LAN, Windows, WebGPU, or human-feel claim.',
    };
  } catch (error) {
    report = {
      verdict: 'ERROR',
      runId,
      error: error instanceof Error ? error.stack : String(error),
      pageErrors,
      logTail: logs.slice(-100).map(sanitizeEvidenceLine),
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await Promise.all(owned.map(stopProcessTree));
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ verdict: report.verdict, reportPath, checks: report.checks, error: report.error }, null, 2));
  return report.verdict === 'PASS';
}

main().then((passed) => process.exit(passed ? 0 : 1));
