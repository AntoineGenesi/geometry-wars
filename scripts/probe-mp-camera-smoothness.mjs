#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
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
  const choppinessSamples = samples
    .map((sample) => sample?.choppiness)
    .filter((choppiness) => choppiness && typeof choppiness === 'object');
  const values = (name) => renderSamples
    .map((target) => Number(target[name]))
    .filter((value) => Number.isFinite(value));
  const choppyValues = (name) => choppinessSamples
    .map((choppiness) => Number(choppiness[name]))
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
  const choppyStat = (name) => statFrom(choppyValues(name));
  const last = samples[samples.length - 1] || null;
  const lastTarget = renderSamples[renderSamples.length - 1] || null;
  const lastChoppiness = choppinessSamples[choppinessSamples.length - 1] || null;
  return {
    sampleCount: samples.length,
    renderTargetSampleCount: renderSamples.length,
    choppinessSampleCount: choppinessSamples.length,
    fps: statFrom(samples.map((sample) => sample?.fps).filter(Number.isFinite)),
    targetDelta: stat('targetDelta'),
    cameraDelta: stat('cameraDelta'),
    distanceToPlayer: stat('distanceToPlayer'),
    targetToPlayer: stat('targetToPlayer'),
    serverSampleAgeMs: stat('serverSampleAgeMs'),
    serverSampleIntervalMs: stat('serverSampleIntervalMs'),
    serverSampleDelta: stat('serverSampleDelta'),
    choppiness: {
      frameDtP95: choppyStat('frameDtP95'),
      frameDtP99: choppyStat('frameDtP99'),
      longFrameCountOver33ms: choppyStat('longFrameCountOver33ms'),
      longFrameCountOver50ms: choppyStat('longFrameCountOver50ms'),
      patchIntervalP95: choppyStat('patchIntervalP95'),
      patchIntervalMax: choppyStat('patchIntervalMax'),
      convertStateMsP95: choppyStat('convertStateMsP95'),
      onStateChangeMsP95: choppyStat('onStateChangeMsP95'),
      sampleAgeP95: choppyStat('serverSampleAgeMsP95'),
      sampleAgeMax: choppyStat('serverSampleAgeMsMax'),
      inputSendCount: choppyStat('inputSendCount'),
      lastInputAgeMs: choppyStat('lastInputAgeMs'),
      latest: lastChoppiness,
      causalBuckets: summarizeChoppinessBuckets(lastChoppiness),
    },
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

function summarizeChoppinessBuckets(choppiness) {
  if (!choppiness) {
    return {
      available: false,
      frame: 'no-client-window-yet',
      patch: 'no-client-window-yet',
      stateHandler: 'no-client-window-yet',
      sampleAge: 'no-client-window-yet',
      input: 'no-client-window-yet',
    };
  }
  const frameDtP95 = Number(choppiness.frameDtP95);
  const longFrames33 = Number(choppiness.longFrameCountOver33ms);
  const patchP95 = Number(choppiness.patchIntervalP95);
  const patchMax = Number(choppiness.patchIntervalMax);
  const convertP95 = Number(choppiness.convertStateMsP95);
  const onStateP95 = Number(choppiness.onStateChangeMsP95);
  const sampleAgeP95 = Number(choppiness.serverSampleAgeMsP95);
  const sampleAgeMax = Number(choppiness.serverSampleAgeMsMax);
  const inputSendCount = Number(choppiness.inputSendCount);
  const lastInputAgeMs = Number(choppiness.lastInputAgeMs);
  return {
    available: true,
    frame: Number.isFinite(frameDtP95) && (frameDtP95 > 33 || longFrames33 > 0) ? 'watch' : 'ok',
    patch: Number.isFinite(patchP95) && (patchP95 > 25 || patchMax > 40) ? 'watch' : 'ok',
    stateHandler: Number.isFinite(onStateP95) && (onStateP95 > 8 || convertP95 > 3) ? 'watch' : 'ok',
    sampleAge: Number.isFinite(sampleAgeP95) && (sampleAgeP95 > 35 || sampleAgeMax > 80) ? 'watch' : 'ok',
    input: (Number.isFinite(inputSendCount) && inputSendCount === 0)
      || (Number.isFinite(lastInputAgeMs) && lastInputAgeMs > 150)
      ? 'watch'
      : 'ok',
  };
}

function extractMetricsLogPath(output) {
  const matches = [...String(output || '').matchAll(/Metrics log:\s+(.+mp-perf-[^\s]+\.jsonl)/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim();
}

function readMetricsRows(logPath) {
  if (!logPath || !existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((row) => row && row._type === 'metrics');
}

function summarizeServerMetrics(rows) {
  const metric = (name) => statFrom(rows.map((row) => Number(row[name])).filter(Number.isFinite));
  const latest = rows[rows.length - 1] || null;
  return {
    rowCount: rows.length,
    tickMsP95: metric('tickMsP95'),
    tickMsMax: metric('tickMsMax'),
    movementMsP95: metric('tickMovementMsP95'),
    bulletsMsP95: metric('tickBulletsMsP95'),
    enemiesMsP95: metric('tickEnemiesMsP95'),
    collisionsMsP95: metric('tickCollisionsMsP95'),
    pickupsMsP95: metric('tickPickupsMsP95'),
    wavesMsP95: metric('tickWavesMsP95'),
    otherMsP95: metric('tickOtherMsP95'),
    latest,
    causalBucket: latest && Number(latest.tickMsP95) > 16 ? 'watch' : rows.length > 0 ? 'ok' : 'no-server-log-window',
  };
}

function isNonCriticalProbeError(error) {
  return error.includes('favicon')
    || error.includes('AudioContext')
    || error.includes('user gesture')
    || error.includes('/health net::ERR_CONNECTION_REFUSED');
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
    const colyseusOutput = servers.colyseus.output();
    const viteOutput = servers.vite.output();
    const metricsLogPath = extractMetricsLogPath(colyseusOutput);
    const metricsRows = readMetricsRows(metricsLogPath);
    const serverMetricsSummary = summarizeServerMetrics(metricsRows);
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
      metricsLogPath,
      serverMetricsSummary,
      sampleTail: samples.slice(-8).map((sample) => ({
        time: sample.time,
        frame: sample.frame,
        fps: sample.fps,
        choppiness: sample.choppiness ?? null,
        player: sample.player,
        camera: sample.camera,
        surface: sample.surface,
        gameMode: sample.gameMode,
        pvpMode: sample.pvpMode,
        pvpEnabled: sample.pvpEnabled,
      })),
      screenshotPath,
      errors,
      criticalErrors: errors.filter((error) => !isNonCriticalProbeError(error)),
      consoleTail: consoleLogs.slice(-80),
      serverOutputTail: {
        colyseus: colyseusOutput.slice(-1200),
        vite: viteOutput.slice(-1200),
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
