import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import puppeteer from 'puppeteer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const VITE_BIN = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js');
const DEV_PORT = Number(process.env.DEV_PORT || 3051);
const BASE_URL = process.env.BASE_URL || `http://127.0.0.1:${DEV_PORT}`;
const REPORT_DIR = resolve(ROOT, 'reports');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_PATH = resolve(REPORT_DIR, `sp-enemy-pressure-proof-${RUN_ID}.json`);
const SCREENSHOT_PATH = resolve(REPORT_DIR, `sp-enemy-pressure-proof-${RUN_ID}.png`);
const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined)
  || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined)
  || (existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function waitForHttp(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return true;
    } catch {
      // keep polling
    }
    await sleep(250);
  }
  return false;
}

function spawnVite() {
  const child = spawn(
    'node',
    [VITE_BIN, '--host', '127.0.0.1', '--port', String(DEV_PORT)],
    {
      cwd: ROOT,
      env: { ...process.env, PATH: `${process.env.HOME}/.nvm/versions/node/v20.19.5/bin:${process.env.PATH}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.__output = '';
  child.stdout.on('data', (chunk) => { child.__output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { child.__output += chunk.toString(); });
  return child;
}

async function waitForApi(page) {
  await page.waitForFunction(
    () => window.__TEST_API && window.__GAME_TELEMETRY,
    { timeout: 30000 },
  );
}

async function getEnemy(page, id) {
  return page.evaluate((enemyId) => window.__TEST_API.getEnemies().find((enemy) => enemy.id === enemyId) ?? null, id);
}

async function sampleEnemy(page, id, durationMs = 1200, intervalMs = 100) {
  const samples = [];
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    const sample = await getEnemy(page, id);
    if (sample) samples.push({ t: Date.now() - start, ...sample });
    await sleep(intervalMs);
  }
  return samples;
}

async function runAggroCase(page, type, u, v, speedLimit) {
  await page.evaluate(() => {
    window.__TEST_API.clearEnemies();
    window.__TEST_API.setPlayerPosition(0.5, 0.5);
  });
  await sleep(300);

  const id = await page.evaluate((enemyType, spawnU, spawnV) => {
    const enemyId = window.__TEST_API.spawnEnemy(enemyType, spawnU, spawnV);
    window.__TEST_API.configureEnemy(enemyId, { health: 2 });
    return enemyId;
  }, type, u, v);

  await sleep(500);
  const preAggro = await sampleEnemy(page, id, 500, 100);
  const damageApplied = await page.evaluate((enemyId) => window.__TEST_API.damageEnemy(enemyId, 1, 0), id);
  const aggro = await sampleEnemy(page, id, 1400, 100);
  const after = await getEnemy(page, id);
  const maxCommandedSpeed = Math.max(0, ...aggro.map((sample) => Number(sample.commandedWorldSpeed ?? 0)));
  const maxActualSpeed = Math.max(0, ...aggro.map((sample) => Number(sample.actualWorldSpeed ?? 0)));

  return {
    id,
    type,
    damageApplied,
    after,
    checks: {
      damageApplied,
      aggroUsed: aggro.some((sample) => sample.damageAggroActive === true),
      speedBounded: maxCommandedSpeed <= speedLimit && maxActualSpeed <= speedLimit + 0.3,
      damageReducedHealth: Boolean(damageApplied && after && after.health === 1),
    },
    metrics: {
      speedLimit,
      maxCommandedSpeed,
      maxActualSpeed,
      preAggroCount: preAggro.length,
      aggroSampleCount: aggro.length,
    },
    samples: { preAggro, aggro },
  };
}

async function runProof(page) {
  await page.goto(
    `${BASE_URL}/?quickStart=true&surface=sphere&renderer=webgl&debug=true&testMode=true&godMode=true&seed=424242`,
    { waitUntil: 'domcontentloaded', timeout: 30000 },
  );
  await waitForApi(page);
  const gruntAggro = await runAggroCase(page, 'grunt', 0.62, 0.5, 1.9);
  const approachGlowAggro = await runAggroCase(page, 'approach_glow', 0.62, 0.5, 1.9);

  await page.evaluate(() => {
    window.__TEST_API.clearEnemies();
    window.__TEST_API.setPlayerPosition(0.5, 0.5);
  });
  await sleep(300);

  const killId = await page.evaluate(() => {
    const id = window.__TEST_API.spawnEnemy('grunt', 0.515, 0.5);
    window.__TEST_API.configureEnemy(id, { health: 2, speed: 0 });
    window.__TEST_API.forceEquipWeapon('standard', 999);
    return id;
  });

  const killSamples = [];
  for (let i = 0; i < 12; i++) {
    const before = await getEnemy(page, killId);
    await page.evaluate((id) => window.__TEST_API.fireWeapon(id), killId);
    await sleep(180);
    const after = await getEnemy(page, killId);
    killSamples.push({ shot: i + 1, before, after });
    if (!after || !after.alive) break;
  }
  const killAfter = await getEnemy(page, killId);

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });

  const killedByWeaponPath = !killAfter || killAfter.alive === false;

  return {
    url: page.url(),
    aggroIds: {
      grunt: gruntAggro.id,
      approachGlow: approachGlowAggro.id,
    },
    killId,
    checks: {
      gruntDamageApplied: gruntAggro.checks.damageApplied,
      gruntAggroUsed: gruntAggro.checks.aggroUsed,
      gruntAggroSpeedBounded: gruntAggro.checks.speedBounded,
      gruntDamageReducedHealth: gruntAggro.checks.damageReducedHealth,
      approachGlowDamageApplied: approachGlowAggro.checks.damageApplied,
      approachGlowAggroUsed: approachGlowAggro.checks.aggroUsed,
      approachGlowAggroSpeedBounded: approachGlowAggro.checks.speedBounded,
      approachGlowDamageReducedHealth: approachGlowAggro.checks.damageReducedHealth,
      killedByWeaponPath,
    },
    metrics: {
      gruntAggro: gruntAggro.metrics,
      approachGlowAggro: approachGlowAggro.metrics,
      killShotCount: killSamples.length,
    },
    samples: {
      gruntAggro,
      approachGlowAggro,
      kill: killSamples,
      killAfter,
    },
    artifacts: {
      reportPath: REPORT_PATH,
      screenshotPath: SCREENSHOT_PATH,
    },
  };
}

let vite = null;
let browser = null;

try {
  mkdirSync(REPORT_DIR, { recursive: true });
  if (!(await waitForHttp(BASE_URL, 1000))) {
    vite = spawnVite();
    const ready = await waitForHttp(BASE_URL, 30000);
    if (!ready) {
      throw new Error(`Vite did not become ready at ${BASE_URL}\n${vite.__output}`);
    }
  }

  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  page.on('console', (msg) => {
    const text = msg.text();
    if (/error|warn|TestHarnessAPI|GameTelemetryExporter|MapSize/i.test(text)) {
      console.log(`[browser:${msg.type()}] ${text}`);
    }
  });
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  const report = await runProof(page);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    passed: Object.values(report.checks).every(Boolean),
    checks: report.checks,
    metrics: report.metrics,
    artifacts: report.artifacts,
  }, null, 2));

  if (!Object.values(report.checks).every(Boolean)) {
    process.exitCode = 1;
  }
} finally {
  if (browser) await browser.close();
  if (vite) vite.kill('SIGTERM');
}
