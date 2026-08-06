#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const DEV_PORT = Number(getArg('port', process.env.DEV_PORT || '3035'));
const SURFACE = getArg('surface', 'torus');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const reportJsonPath = resolve(ROOT, 'reports', `sp-visual-mode-style-proof-${SURFACE}-${runId}.json`);
const reportMdPath = resolve(ROOT, 'reports', `sp-visual-mode-style-proof-${SURFACE}-${runId}.md`);
const screenshotDir = resolve(ROOT, 'test-screenshots/sp-visual-mode-style-proof', `${SURFACE}-${runId}`);
const sharedParentRoot = resolve(ROOT, '../../..');
const modes = ['modern', 'pixelated', 'crt', 'desktop-defender'];
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
      if (logs.length > 500) logs.shift();
    }
  });
  capture(child.stdout, 'vite');
  capture(child.stderr, 'vite-error');
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

function criticalErrors(errors) {
  return errors.filter((message) =>
    !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated/i.test(message));
}

function screenshotHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function captureMode(browser, baseUrl, mode, errors) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (error) => errors.push(`[${mode}] pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      errors.push(`[${mode}] ${message.type()}: ${message.text()}`);
    }
  });
  await page.evaluateOnNewDocument((visualMode) => {
    localStorage.setItem('gw3d-visual-mode', visualMode);
    localStorage.removeItem('gw3d-visual-style');
  }, mode);
  const url = `${baseUrl}/?testArena=true&testMode=true&renderer=webgl2&surface=${encodeURIComponent(SURFACE)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await waitForPage(page, () => {
    const api = window.__TEST_API;
    return Boolean(api && typeof api.getGameState === 'function' && api.getGameState().enemies > 0);
  }, 30000);
  await sleep(1200);

  const beforeToggle = await page.evaluate(() => {
    const debug = window.__gameDebug;
    const ctx = debug?.ctx;
    const game = debug?.game;
    const surface = ctx?.surface;
    const gridMat = surface?.gridMesh?.material;
    const surfaceMat = surface?.mesh?.material;
    const telemetry = window.__GAME_TELEMETRY;
    const enemies = telemetry?.enemies ?? [];
    return {
      mode: localStorage.getItem('gw3d-visual-mode'),
      savedStyle: localStorage.getItem('gw3d-visual-style'),
      gameState: window.__TEST_API?.getGameState?.() ?? null,
      sceneBackground: game?.scene?.background?.getHex?.() ?? null,
      bloom: {
        strength: game?.bloomPass?.strength ?? null,
        threshold: game?.bloomPass?.threshold ?? null,
        radius: game?.bloomPass?.radius ?? null,
        resolutionScale: game?.bloomResolutionScale ?? null,
      },
      surface: {
        visible: surface?.mesh?.visible ?? null,
        color: surfaceMat?.color?.getHex?.() ?? null,
        opacity: surfaceMat?.opacity ?? null,
        transparent: surfaceMat?.transparent ?? null,
        depthWrite: surfaceMat?.depthWrite ?? null,
      },
      grid: {
        color: gridMat?.color?.getHex?.() ?? null,
        opacity: gridMat?.opacity ?? null,
        transparent: gridMat?.transparent ?? null,
      },
      telemetry: {
        enemyCount: enemies.length,
        aliveEnemies: enemies.filter((enemy) => enemy.isAlive !== false).length,
        visibleCandidates: enemies.filter((enemy) =>
          enemy.isAlive !== false && !enemy.materializing && (enemy.opacity ?? 0) > 0.03).length,
      },
    };
  });

  const gameplayScreenshotPath = resolve(screenshotDir, `${mode}-gameplay.png`);
  await page.screenshot({ path: gameplayScreenshotPath });
  const gameplayHash = screenshotHash(gameplayScreenshotPath);

  await page.keyboard.press('Escape');
  await waitForPage(page, () => {
    const label = document.querySelector('.visual-mode-label');
    return label?.textContent?.trim() || null;
  }, 10000);
  const pauseLabel = await page.evaluate(() =>
    document.querySelector('.visual-mode-label')?.textContent?.trim() ?? null);
  const pauseScreenshotPath = resolve(screenshotDir, `${mode}-pause.png`);
  await page.screenshot({ path: pauseScreenshotPath });
  const pauseHash = screenshotHash(pauseScreenshotPath);
  await page.close();

  return {
    mode,
    screenshots: {
      gameplay: relative(ROOT, gameplayScreenshotPath),
      pause: relative(ROOT, pauseScreenshotPath),
    },
    screenshotSha256: {
      gameplay: gameplayHash,
      pause: pauseHash,
    },
    pauseLabel,
    state: beforeToggle,
    checks: {
      modePersisted: beforeToggle.mode === mode,
      noExplicitSavedStyle: beforeToggle.savedStyle === null,
      enemiesPresent: (beforeToggle.telemetry?.enemyCount ?? 0) > 0,
      visibleEnemyCandidates: (beforeToggle.telemetry?.visibleCandidates ?? 0) > 0,
      pauseLabelPresent: typeof pauseLabel === 'string' && pauseLabel.length > 0,
    },
  };
}

async function main() {
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(dirname(reportJsonPath), { recursive: true });
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome/Chromium executable not found');

  const logs = [];
  const viteBin = projectToolPath('node_modules/vite/bin/vite.js');
  const server = startProcess(
    viteBin
      ? [viteBin, '--host', '127.0.0.1', '--port', String(DEV_PORT)]
      : [projectToolPath('node_modules/npm/bin/npm-cli.js') ?? 'npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(DEV_PORT)],
    { PATH: `${process.env.HOME}/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin` },
    logs,
  );

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,720',
    ],
  });

  const errors = [];
  const results = [];
  let fatalError = null;
  const baseUrl = `http://127.0.0.1:${DEV_PORT}`;
  try {
    const ready = await waitForHttp(baseUrl);
    if (!ready) throw new Error(`Vite did not become ready at ${baseUrl}\n${logs.join('\n')}`);
    for (const mode of modes) {
      results.push(await captureMode(browser, baseUrl, mode, errors));
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await browser.close().catch(() => {});
    await stopProcessTree(server);
  }

  const critical = criticalErrors(errors);
  const uniqueSurfaceColors = new Set(results.map((result) => result.state?.surface?.color).filter((value) => value !== null));
  const uniqueGridColors = new Set(results.map((result) => result.state?.grid?.color).filter((value) => value !== null));
  const uniqueGameplayScreenshots = new Set(results.map((result) => result.screenshotSha256?.gameplay));
  const uniquePauseScreenshots = new Set(results.map((result) => result.screenshotSha256?.pause));
  const report = {
    generatedAt: new Date().toISOString(),
    codePath: 'index.html -> src/main.ts -> ?testArena=true -> GameLoop + PauseMenu visual mode label',
    command: `node tests/visual/sp-visual-mode-style-proof.mjs --surface=${SURFACE} --port=${DEV_PORT}`,
    surface: SURFACE,
    modes,
    screenshots: results.flatMap((result) => [result.screenshots.gameplay, result.screenshots.pause]),
    results,
    summary: {
      uniqueSurfaceColors: uniqueSurfaceColors.size,
      uniqueGridColors: uniqueGridColors.size,
      uniqueGameplayScreenshots: uniqueGameplayScreenshots.size,
      uniquePauseScreenshots: uniquePauseScreenshots.size,
      criticalErrors: critical.length,
    },
    errors,
    criticalErrors: critical,
    fatalError,
    serverOutputTail: logs.slice(-120),
  };
  report.passed = !fatalError
    && critical.length === 0
    && results.length === modes.length
    && results.every((result) => Object.values(result.checks).every(Boolean))
    && uniqueSurfaceColors.size >= 3
    && uniqueGridColors.size >= 3
    && uniqueGameplayScreenshots.size === modes.length
    && uniquePauseScreenshots.size === modes.length;

  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(reportMdPath, [
    `# SP Visual Mode Style Proof - ${SURFACE}`,
    '',
    `verdict: ${report.passed ? 'PASS' : 'FAIL'}`,
    `report: ${relative(ROOT, reportJsonPath)}`,
    '',
    '## Screenshots',
    ...results.flatMap((result) => [
      `- ${result.mode} gameplay: ${result.screenshots.gameplay}`,
      `- ${result.mode} pause: ${result.screenshots.pause}`,
    ]),
    '',
    '## Summary',
    `- unique surface colors: ${report.summary.uniqueSurfaceColors}`,
    `- unique grid colors: ${report.summary.uniqueGridColors}`,
    `- unique gameplay screenshots: ${report.summary.uniqueGameplayScreenshots}`,
    `- unique pause screenshots: ${report.summary.uniquePauseScreenshots}`,
    `- critical errors: ${report.summary.criticalErrors}`,
    '',
  ].join('\n'));

  console.log(`Report: ${reportJsonPath}`);
  console.log(`Screenshots: ${screenshotDir}`);
  for (const result of results) {
    console.log(`${Object.values(result.checks).every(Boolean) ? 'PASS' : 'FAIL'} ${result.mode}: ${JSON.stringify(result.checks)}`);
  }
  if (fatalError) console.error(fatalError);
  if (critical.length > 0) console.error(`Critical page errors: ${critical.join(' | ')}`);
  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
