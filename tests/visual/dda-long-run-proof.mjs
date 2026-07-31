#!/usr/bin/env node
/**
 * Deterministic SP DDA/difficulty proof for the real path:
 * index.html -> src/main.ts -> src/core/GameLoop.ts.
 *
 * Profiles:
 * - dominance: fixed high-power player profile that drives wave/dominance difficulty.
 * - tier-disable: fixed struggling-player profile at Nightmare tier to verify assistance
 *   DDA is disabled separately from dominance/wave difficulty.
 */

import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
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

const PORT = Number(getArg('port', '3039'));
const BASE_URL = getArg('base-url', `http://127.0.0.1:${PORT}`);
const PROFILE = getArg('profile', 'dominance');
const SURFACES = (getArg('surfaces', getArg('surface', 'cube,sphere')) || 'cube,sphere')
  .split(',')
  .map((surface) => surface.trim())
  .filter(Boolean);
const DURATION_SEC = Number(getArg('duration', PROFILE === 'tier-disable' ? '22' : '40'));
const SAMPLE_MS = Number(getArg('sample-ms', '1000'));
const SEED = Number(getArg('seed', '424242'));
const RENDERER = getArg('renderer', 'webgl2');
const NO_SERVER = hasFlag('no-server');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

const REPORT_DIR = resolve(PROJECT_ROOT, 'reports');
mkdirSync(REPORT_DIR, { recursive: true });
const JSON_REPORT_PATH = resolve(REPORT_DIR, `dda-long-run-proof-${PROFILE}-${timestamp}.json`);
const MD_REPORT_PATH = resolve(REPORT_DIR, `dda-long-run-proof-${PROFILE}-${timestamp}.md`);

const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  commandPath('google-chrome'),
  commandPath('chromium'),
  commandPath('chromium-browser'),
  ...findCachedPuppeteerChrome(),
  '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
].filter(Boolean);
const CHROME_PATH = chromeCandidates.find((path) => existsSync(path)) || chromeCandidates[0];
const NVM_PATH = process.env.NVM_BIN || dirname(process.execPath) || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

const LAUNCH_ARGS = [
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
];

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function portListeners(port) {
  try {
    return execSync(`ss -tlnp 2>/dev/null | rg ':${port}\\b' || true`, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function assertPortFree(port) {
  const listeners = portListeners(port);
  if (listeners) {
    throw new Error(`Port ${port} is already in use:\n${listeners}`);
  }
}

function spawnLogged(command, commandArgs) {
  const proc = spawn(command, commandArgs, {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PATH: `${NVM_PATH}:/usr/bin:/bin`,
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.__output = '';
  const collect = (data) => {
    proc.__output += data.toString();
    if (proc.__output.length > 12000) proc.__output = proc.__output.slice(-12000);
  };
  proc.stdout.on('data', collect);
  proc.stderr.on('data', collect);
  return proc;
}

async function stopProcessTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  const waitForClose = (timeoutMs) => new Promise((resolveWait) => {
    const timer = setTimeout(() => resolveWait(false), timeoutMs);
    proc.once('close', () => {
      clearTimeout(timer);
      resolveWait(true);
    });
  });
  try {
    process.kill(-proc.pid, 'SIGTERM');
  } catch {
    try { proc.kill('SIGTERM'); } catch { /* already closed */ }
  }
  if (await waitForClose(2500)) return;
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try { proc.kill('SIGKILL'); } catch { /* already closed */ }
  }
  await waitForClose(1500);
}

async function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // not ready
    }
    await sleep(500);
  }
  return false;
}

async function waitForTestApi(page) {
  await page.waitForFunction(
    () => Boolean(window.__TEST_API?.getDDAState && window.__GAME_TELEMETRY),
    { timeout: 45000 },
  );
}

async function applyProfileTick(page, profile) {
  return page.evaluate((profileName) => {
    const api = window.__TEST_API;
    const ctx = api?.ctx;
    if (!api || !ctx) return { ok: false, reason: 'missing api ctx' };

    if (profileName === 'tier-disable') {
      if (!window.__DDA_PROOF_TIER_DISABLE) {
        window.__DDA_PROOF_TIER_DISABLE = true;
        window.__DDA_PROOF_ORIGINAL_DIFFICULTY_INPUT = ctx.waveScheduler.getDifficultyInput;
        ctx.waveScheduler.getDifficultyInput = () => ({
          score: 100_000_000,
          elapsedTime: 0,
          combo: 0,
          totalKills: 4000,
          playerLevel: 9,
          buffPower: 8,
          playerCount: 1,
          companionCount: ctx.companionManager?.count ?? 0,
        });
        globalThis.__GOD_MODE = true;
        ctx.player.lives = 1;
      }
      ctx.ddaTracker.recordDeath();
      ctx.ddaTracker.recordCloseCall();
      return { ok: true, profile: profileName, injected: 'nightmare_tier_struggle' };
    }

    if (!window.__DDA_PROOF_DOMINANCE) {
      window.__DDA_PROOF_DOMINANCE = true;
      globalThis.__GOD_MODE = true;
      ctx.player.lives = 3;
    }
    ctx.player.addScore(40_000);
    for (let i = 0; i < 4; i++) {
      ctx.playerLevel.addKill();
      ctx.ddaTracker.recordKill(1_000);
    }
    return { ok: true, profile: profileName, injected: 'dominant_player_power' };
  }, profile);
}

async function sampleState(page) {
  return page.evaluate(() => {
    const api = window.__TEST_API;
    const dda = api.getDDAState();
    return {
      dda,
      telemetry: window.__GAME_TELEMETRY ?? null,
      performanceProfile: typeof api.getPerformanceProfile === 'function'
        ? api.getPerformanceProfile()
        : null,
      url: window.location.href,
      userAgent: navigator.userAgent,
    };
  });
}

function summarize(samples, profile) {
  const ddaSamples = samples.map((sample) => sample.dda).filter(Boolean);
  const final = ddaSamples.at(-1) ?? null;
  const highTierSamples = ddaSamples.filter(
    (sample) => sample.difficulty.level >= sample.difficulty.assistanceDisableOnTier,
  );
  const assistanceLeakSamples = highTierSamples.filter(
    (sample) => sample.dda.assistanceLevelSmooth > 0.25,
  );
  const highTierStrongSamples = highTierSamples.filter(
    (sample) => sample.player.score >= 800_000 && sample.player.totalKills >= 80,
  );
  const highTierDominanceDropSamples = highTierStrongSamples.filter(
    (sample) => sample.dda.dominanceHpMultiplier <= 1.01,
  );
  const maxDifficulty = Math.max(0, ...ddaSamples.map((sample) => sample.difficulty.level));
  const maxWave = Math.max(0, ...ddaSamples.map((sample) => sample.wave.current));
  const maxDominance = Math.max(0, ...ddaSamples.map((sample) => sample.dda.dominanceHpMultiplier));
  const highTierMaxDominance = Math.max(0, ...highTierStrongSamples.map((sample) => sample.dda.dominanceHpMultiplier));
  const highTierMinDominance = highTierStrongSamples.length > 0
    ? Math.min(...highTierStrongSamples.map((sample) => sample.dda.dominanceHpMultiplier))
    : 0;
  const maxEnemyHealth = Math.max(0, ...ddaSamples.map((sample) => sample.enemies.maxHealth));
  const maxEnemyTier = Math.max(0, ...ddaSamples.map((sample) => sample.enemies.maxTier));
  const maxEnemyCount = Math.max(0, ...ddaSamples.map((sample) => sample.spawner.activeEnemyCount));
  const minFixedFps = Math.min(...ddaSamples.map((sample) => sample.renderer.fixedFps).filter(Number.isFinite));

  let passed;
  let reason;
  if (profile === 'tier-disable') {
    passed = highTierSamples.length >= 3 && assistanceLeakSamples.length === 0;
    reason = passed
      ? `Nightmare-tier samples=${highTierSamples.length}; assistance leak samples=0`
      : `Nightmare-tier samples=${highTierSamples.length}; assistance leak samples=${assistanceLeakSamples.length}`;
  } else {
    passed = maxDifficulty >= 1.0
      && highTierStrongSamples.length >= 3
      && highTierDominanceDropSamples.length === 0
      && highTierMinDominance > 1.01
      && maxEnemyHealth > 2
      && maxEnemyCount > 0;
    reason = passed
      ? `Difficulty ${maxDifficulty.toFixed(2)}, high-tier dominance ${highTierMinDominance.toFixed(2)}-${highTierMaxDominance.toFixed(2)}x, max enemy HP ${maxEnemyHealth}`
      : `Insufficient high-tier dominance evidence: difficulty=${maxDifficulty.toFixed(2)}, highTierStrongSamples=${highTierStrongSamples.length}, highTierDominanceDrops=${highTierDominanceDropSamples.length}, highTierMinDominance=${highTierMinDominance.toFixed(2)}, maxEnemyHealth=${maxEnemyHealth}, enemies=${maxEnemyCount}`;
  }

  return {
    passed,
    reason,
    sampleCount: ddaSamples.length,
    final,
    maxDifficulty,
    maxWave,
    maxDominance,
    highTierMaxDominance,
    highTierMinDominance,
    maxEnemyHealth,
    maxEnemyTier,
    maxEnemyCount,
    minFixedFps: Number.isFinite(minFixedFps) ? minFixedFps : null,
    highTierSamples: highTierSamples.length,
    highTierStrongSamples: highTierStrongSamples.length,
    assistanceLeakSamples: assistanceLeakSamples.length,
    highTierDominanceDropSamples: highTierDominanceDropSamples.length,
  };
}

async function runSurface(browser, surface) {
  const page = await browser.newPage();
  const consoleMessages = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleMessages.push(text);
    if (consoleMessages.length > 80) consoleMessages.shift();
  });
  page.on('pageerror', (err) => {
    consoleMessages.push(`[pageerror] ${err.message}`);
  });

  await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
  const params = new URLSearchParams({
    quickStart: 'true',
    surface,
    seed: String(SEED),
    debug: 'true',
    testMode: 'true',
    renderer: RENDERER,
    music: 'false',
  });
  const url = `${BASE_URL}/?${params.toString()}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForTestApi(page);

  const samples = [];
  const profileEvents = [];
  const started = Date.now();
  while (Date.now() - started < DURATION_SEC * 1000) {
    profileEvents.push(await applyProfileTick(page, PROFILE));
    samples.push(await sampleState(page));
    await sleep(SAMPLE_MS);
  }
  samples.push(await sampleState(page));
  const summary = summarize(samples, PROFILE);
  await page.close();

  return {
    surface,
    profile: PROFILE,
    seed: SEED,
    durationSec: DURATION_SEC,
    sampleMs: SAMPLE_MS,
    renderer: RENDERER,
    path: 'index.html -> src/main.ts -> src/core/GameLoop.ts',
    summary,
    profileEvents: profileEvents.slice(-10),
    samples,
    consoleMessages,
  };
}

function writeReports(report) {
  writeFileSync(JSON_REPORT_PATH, JSON.stringify(report));
  const lines = [
    `# DDA Long Run Proof - ${PROFILE}`,
    '',
    `Generated: ${report.generatedAt}`,
    `Command: \`${report.command}\``,
    `Path: \`index.html -> src/main.ts -> src/core/GameLoop.ts\``,
    `Renderer: \`${RENDERER}\``,
    `Claim boundary: ${report.claimBoundary}`,
    '',
    '## Results',
    '',
  ];
  for (const result of report.results) {
    const s = result.summary;
    lines.push(
      `- ${result.surface}: ${s.passed ? 'PASS' : 'FAIL'} - ${s.reason}; wave=${s.maxWave}, maxDifficulty=${s.maxDifficulty.toFixed(2)}, maxDominance=${s.maxDominance.toFixed(2)}x, highTierMinDominance=${s.highTierMinDominance.toFixed(2)}x, maxEnemyCount=${s.maxEnemyCount}, maxEnemyHealth=${s.maxEnemyHealth}`,
    );
  }
  lines.push('', `JSON artifact: \`${JSON_REPORT_PATH}\``);
  writeFileSync(MD_REPORT_PATH, `${lines.join('\n')}\n`);
}

async function main() {
  if (!CHROME_PATH || !existsSync(CHROME_PATH)) {
    throw new Error(`No Chrome executable found. Tried: ${chromeCandidates.join(', ')}`);
  }

  let server = null;
  if (!NO_SERVER) {
    assertPortFree(PORT);
    server = spawnLogged('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT)]);
    const ready = await waitForServer(BASE_URL);
    if (!ready) {
      throw new Error(`Vite server did not become ready at ${BASE_URL}\n${server.__output}`);
    }
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
    defaultViewport: { width: 960, height: 540, deviceScaleFactor: 1 },
  });

  try {
    const results = [];
    for (const surface of SURFACES) {
      console.log(`[dda-proof] ${PROFILE} on ${surface}`);
      results.push(await runSurface(browser, surface));
      const summary = results.at(-1).summary;
      console.log(`  ${summary.passed ? 'PASS' : 'FAIL'} ${summary.reason}`);
    }

    const report = {
      generatedAt: new Date().toISOString(),
      command: `node tests/visual/dda-long-run-proof.mjs ${args.join(' ')}`.trim(),
      profile: PROFILE,
      surfaces: SURFACES,
      seed: SEED,
      durationSec: DURATION_SEC,
      sampleMs: SAMPLE_MS,
      renderer: RENDERER,
      browser: { executablePath: CHROME_PATH, launchArgs: LAUNCH_ARGS },
      claimBoundary: PROFILE === 'tier-disable'
        ? 'Scripted struggle profile verifies assistance DDA disable wiring at Nightmare tier; it is not a human balance claim.'
        : 'Scripted dominance profile drives real SP wave/dominance systems with injected score/kills; it proves wiring/response, not organic human balance.',
      results,
      artifacts: {
        json: JSON_REPORT_PATH,
        markdown: MD_REPORT_PATH,
      },
    };
    writeReports(report);
    console.log(`[dda-proof] JSON ${JSON_REPORT_PATH}`);
    console.log(`[dda-proof] MD   ${MD_REPORT_PATH}`);

    if (results.some((result) => !result.summary.passed)) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close().catch(() => {});
    await stopProcessTree(server);
  }
}

main().catch((err) => {
  console.error(`[dda-proof] ERROR: ${err.stack || err.message || String(err)}`);
  process.exitCode = 1;
});
