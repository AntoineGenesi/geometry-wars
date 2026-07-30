#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const args = process.argv.slice(2);

function getArg(name, fallback = '') {
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function commandPath(command) {
  try {
    return execSync(`command -v ${command}`, { encoding: 'utf8' }).trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

function findCachedPuppeteerChrome() {
  const cacheRoot = resolve(process.env.HOME || '/home/antoine', '.cache/puppeteer/chrome');
  try {
    return readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('linux-'))
      .map((entry) => resolve(cacheRoot, entry.name, 'chrome-linux64/chrome'))
      .filter((path) => existsSync(path))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

const SURFACE = getArg('surface', 'sphere-tunnel');
const MODE = getArg('mode', 'pvpve');
const PORT = Number(getArg('port', '3000'));
const SERVER_PORT = Number(getArg('server-port', '2567'));
const DURATION_SECS = Number(getArg('duration', '16'));
const LABEL = getArg('label', `${SURFACE}-${MODE}`);
const NVM_PATH = process.env.NVM_BIN || dirname(process.execPath) || '/home/antoine/.nvm/versions/node/v20.19.5/bin';
const CHROME_PATH = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  commandPath('google-chrome'),
  commandPath('chromium'),
  commandPath('chromium-browser'),
  ...findCachedPuppeteerChrome(),
].filter(Boolean).find((path) => existsSync(path));

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function killPortProcesses(ports) {
  for (const port of ports) {
    try {
      const result = execSync(`ss -tlnp 2>/dev/null | grep ':${port}\\b'`, { encoding: 'utf8' });
      for (const match of result.matchAll(/pid=(\d+)/g)) {
        try { process.kill(Number(match[1]), 'SIGTERM'); } catch { /* already gone */ }
      }
    } catch { /* port free */ }
  }
}

function startProcess(command, procArgs, env, readyMatchers, timeoutMs) {
  return new Promise((resolveStart, rejectStart) => {
    const proc = spawn(command, procArgs, {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let ready = false;
    const timer = setTimeout(() => {
      if (ready) return;
      proc.kill('SIGTERM');
      rejectStart(new Error(`Timeout starting ${command}. Output:\n${output.slice(-1200)}`));
    }, timeoutMs);
    const onData = (data) => {
      const text = data.toString();
      output += text;
      if (!ready && readyMatchers.some((matcher) => text.includes(matcher) || output.includes(matcher))) {
        ready = true;
        clearTimeout(timer);
        resolveStart({ proc, output: () => output });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => {
      if (!ready) {
        clearTimeout(timer);
        rejectStart(err);
      }
    });
    proc.on('exit', (code) => {
      if (!ready) {
        clearTimeout(timer);
        rejectStart(new Error(`${command} exited ${code}. Output:\n${output.slice(-1200)}`));
      }
    });
  });
}

async function startServers() {
  killPortProcesses([PORT, SERVER_PORT]);
  await sleep(1000);
  const env = {
    ...process.env,
    PATH: `${NVM_PATH}:/usr/bin:/bin`,
    PORT: String(SERVER_PORT),
    SHUTDOWN_TIMEOUT: '0',
  };
  const colyseus = await startProcess(`${NVM_PATH}/npx`, ['tsx', 'server/index.ts'], env, ['MULTIPLAYER SERVER', `localhost:${SERVER_PORT}`], 20000);
  const vite = await startProcess(`${NVM_PATH}/npx`, ['vite', '--host', '127.0.0.1', '--port', String(PORT)], env, [`localhost:${PORT}`, `127.0.0.1:${PORT}`], 20000);
  return { colyseus, vite };
}

async function clickStartGame(page) {
  return page.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      const text = (btn.textContent || '').trim();
      if (text.includes('START GAME') && (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
}

async function telemetry(page) {
  return page.evaluate(() => window.__GAME_TELEMETRY || null);
}

async function waitForTelemetry(page, predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const tel = await telemetry(page);
    if (tel && predicate(tel)) return tel;
    await sleep(500);
  }
  return null;
}

function summarize(samples) {
  const renderSamples = samples
    .map((sample) => sample?.camera?.renderTarget)
    .filter((target) => target && target.valid);
  const values = (name) => renderSamples
    .map((target) => Number(target[name]))
    .filter((value) => Number.isFinite(value));
  const stat = (name) => {
    const list = values(name);
    if (list.length === 0) return { count: 0, min: null, max: null, avg: null };
    return {
      count: list.length,
      min: Math.min(...list),
      max: Math.max(...list),
      avg: list.reduce((sum, value) => sum + value, 0) / list.length,
    };
  };
  const last = samples[samples.length - 1] || null;
  const lastTarget = renderSamples[renderSamples.length - 1] || null;
  return {
    sampleCount: samples.length,
    renderTargetSampleCount: renderSamples.length,
    fps: statFrom(samples.map((sample) => sample?.fps).filter(Number.isFinite)),
    targetDelta: stat('targetDelta'),
    cameraDelta: stat('cameraDelta'),
    distanceToPlayer: stat('distanceToPlayer'),
    targetToPlayer: stat('targetToPlayer'),
    serverSampleAgeMs: stat('serverSampleAgeMs'),
    serverSampleIntervalMs: stat('serverSampleIntervalMs'),
    serverSampleDelta: stat('serverSampleDelta'),
    last: last ? {
      time: last.time,
      frame: last.frame,
      waveNumber: last.waveNumber,
      surface: last.surface,
      renderer: last.renderer,
      gameMode: last.gameMode,
      pvpMode: last.pvpMode,
      pvpEnabled: last.pvpEnabled,
      player: last.player,
      camera: last.camera,
    } : null,
    counts: lastTarget ? {
      sampleCount: lastTarget.sampleCount,
      snapCount: lastTarget.snapCount,
      resetCount: lastTarget.resetCount,
    } : null,
  };
}

function statFrom(list) {
  if (list.length === 0) return { count: 0, min: null, max: null, avg: null };
  return {
    count: list.length,
    min: Math.min(...list),
    max: Math.max(...list),
    avg: list.reduce((sum, value) => sum + value, 0) / list.length,
  };
}

async function runProbe() {
  if (!CHROME_PATH) throw new Error('No Chrome executable found');
  const startedAt = new Date().toISOString();
  const timestamp = startedAt.replace(/[:.]/g, '-');
  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });
  mkdirSync(resolve(PROJECT_ROOT, 'test-screenshots/mp-camera-smoothness'), { recursive: true });

  const servers = await startServers();
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=960,540',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 540 });
  const consoleLogs = [];
  const errors = [];
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('requestfailed', (req) => errors.push(`requestfailed ${req.url()} ${req.failure()?.errorText || ''}`));

  try {
    await page.evaluateOnNewDocument(() => localStorage.clear());
    const params = new URLSearchParams({
      mode: 'network',
      surface: SURFACE,
      server: `ws://localhost:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      godMode: 'true',
      name: 'Worker L',
      gameMode: MODE,
      pvpMode: MODE === 'pvp' || MODE === 'pvpve' ? MODE : '',
    });
    const url = `http://localhost:${PORT}?${params.toString()}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForTelemetry(page, (tel) => tel.network?.connected && tel.network?.isHost, 20000);
    const startClicked = await clickStartGame(page);
    const started = await waitForTelemetry(page, (tel) =>
      tel.network?.connected && tel.network?.playerCount === 1 && tel.gameMode === MODE && tel.isPaused === false,
    20000);
    if (!started) throw new Error(`Game did not start. startClicked=${startClicked}`);

    await page.mouse.move(650, 270);
    await page.mouse.down({ button: 'left' }).catch(() => {});
    const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
    const samples = [];
    for (let i = 0; i < DURATION_SECS * 4; i++) {
      const code = keys[i % keys.length];
      await page.keyboard.down(code);
      await sleep(180);
      await page.keyboard.up(code);
      await sleep(70);
      const tel = await telemetry(page);
      if (tel) samples.push(tel);
    }
    await page.mouse.up({ button: 'left' }).catch(() => {});

    const screenshotPath = resolve(PROJECT_ROOT, `test-screenshots/mp-camera-smoothness/${LABEL}-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    const report = {
      label: LABEL,
      startedAt,
      url,
      surface: SURFACE,
      mode: MODE,
      durationSecs: DURATION_SECS,
      chromePath: CHROME_PATH,
      oneBrowserProcess: true,
      onePage: true,
      startClicked,
      summary: summarize(samples),
      sampleTail: samples.slice(-8).map((sample) => ({
        time: sample.time,
        frame: sample.frame,
        fps: sample.fps,
        player: sample.player,
        camera: sample.camera,
        surface: sample.surface,
        gameMode: sample.gameMode,
        pvpMode: sample.pvpMode,
        pvpEnabled: sample.pvpEnabled,
      })),
      screenshotPath,
      errors,
      criticalErrors: errors.filter((error) =>
        !error.includes('favicon') && !error.includes('AudioContext') && !error.includes('user gesture')),
      consoleTail: consoleLogs.slice(-80),
      serverOutputTail: {
        colyseus: servers.colyseus.output().slice(-1200),
        vite: servers.vite.output().slice(-1200),
      },
    };
    const reportPath = resolve(PROJECT_ROOT, `reports/mp-camera-smoothness-${LABEL}-${timestamp}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      reportPath,
      screenshotPath,
      criticalErrors: report.criticalErrors.length,
      summary: report.summary,
    }, null, 2));
  } finally {
    await browser.close().catch(() => {});
    servers.vite.proc.kill('SIGTERM');
    servers.colyseus.proc.kill('SIGTERM');
    await sleep(500);
    killPortProcesses([PORT, SERVER_PORT]);
  }
}

runProbe().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
