#!/usr/bin/env node
/**
 * Real SP Standard conflict cleanup proof.
 *
 * CODE PATH: index.html -> src/main.ts -> ?testArena=true -> GameLoop ->
 * Player.weaponFireHandler -> WeaponManager.fireStandard.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || 3037);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/standard-conflict-cleanup-proof', RUN_ID);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/standard-conflict-cleanup-proof-${RUN_ID}.json`);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME_PATH = CHROME_CANDIDATES.find(path => existsSync(path)) || CHROME_CANDIDATES[0];

const scenarios = [
  {
    name: 'standard-scatter-plus-rapid-fire',
    activeNodes: [
      'standard_a_1', 'standard_a_2', 'standard_a_3', 'standard_a_4',
      'standard_al_5', 'standard_al_6', 'standard_al_7',
      'standard_ar_5', 'standard_ar_6', 'standard_ar_7',
    ],
    expectedBulletDelta: 21,
    expectedProjectileDeltaMin: 1,
  },
  {
    name: 'standard-seeking-plus-devastation',
    activeNodes: [
      'standard_b_1', 'standard_b_2', 'standard_b_3', 'standard_b_4',
      'standard_bl_5',
      'standard_br_5',
    ],
    expectedBulletDelta: 4,
    expectedProjectileDeltaMin: 4,
  },
];

function wait(ms) {
  return new Promise(resolveWait => setTimeout(resolveWait, ms));
}

function findUp(relativePath, startDir = PROJECT_ROOT) {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // keep waiting
    }
    await wait(300);
  }
  return false;
}

async function waitForTestApi(page) {
  await page.waitForFunction(() => {
    const api = window.__TEST_API;
    return Boolean(
      api
      && typeof api.setPlayerPosition === 'function'
      && typeof api.forceEquipWeapon === 'function'
      && typeof api.activateNodes === 'function'
      && typeof api.getActiveNodes === 'function'
      && typeof api.fireWeapon === 'function'
      && typeof api.getWeaponRuntimeSnapshot === 'function',
    );
  }, { timeout: 30_000 });
}

function criticalErrors(errors) {
  return errors.filter((entry) => {
    const text = String(entry.text || entry.message || entry);
    return !text.includes('favicon')
      && !text.includes('AudioContext')
      && !text.includes('SharedArrayBuffer')
      && !text.includes('WebGPU')
      && !text.includes('404')
      && !text.includes('PerformanceExporter')
      && !text.includes('net::ERR_CONNECTION_REFUSED');
  });
}

async function runScenario(page, scenario) {
  await page.goto(`${BASE_URL}/?testArena=true&renderer=webgl2`, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await waitForTestApi(page);
  await wait(1200);

  const setup = await page.evaluate((activeNodes) => {
    const api = window.__TEST_API;
    api.clearEnemies();
    api.clearEvents();
    api.clearWeaponEffects();
    api.setPlayerPosition(0.5, 0.58);
    api.forceEquipWeapon('standard', -1);
    api.activateNodes(activeNodes);
    return {
      currentWeapon: api.getCurrentWeapon(),
      activeNodes: api.getActiveNodes(),
      before: api.getWeaponRuntimeSnapshot(),
    };
  }, scenario.activeNodes);

  const fire = await page.evaluate(() => window.__TEST_API.fireWeapon());
  await wait(180);
  const screenshot = resolve(SCREENSHOT_DIR, `${scenario.name}.png`);
  await page.screenshot({ path: screenshot });

  const bulletDelta = fire.runtimeAfter.bulletCount - fire.runtimeBefore.bulletCount;
  const projectileDelta = fire.runtimeAfter.projectileCount - fire.runtimeBefore.projectileCount;
  const activeNodeCheck = scenario.activeNodes.every(nodeId => setup.activeNodes.includes(nodeId));
  const checks = {
    selectedStandard: setup.currentWeapon === 'standard' && fire.selectedWeapon === 'standard',
    allNodesActive: activeNodeCheck,
    firedSignal: fire.firedSignal && fire.firedIndicators.includes('standard_bullet_active'),
    bulletDelta: bulletDelta === scenario.expectedBulletDelta,
    projectileDelta: projectileDelta >= scenario.expectedProjectileDeltaMin,
  };

  return {
    ...scenario,
    passed: Object.values(checks).every(Boolean),
    checks,
    setup,
    fire,
    bulletDelta,
    projectileDelta,
    screenshots: [screenshot],
  };
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(dirname(REPORT_PATH), { recursive: true });

  if (!existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}`);
  }

  const env = {
    ...process.env,
    PATH: `${process.env.HOME}/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin`,
  };
  const viteBin = findUp('node_modules/vite/bin/vite.js');
  const serverCommand = viteBin ? process.execPath : 'npm';
  const serverArgs = viteBin
    ? [viteBin, '--host', '127.0.0.1', '--port', String(PORT)]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT)];
  const server = spawn(serverCommand, serverArgs, {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
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

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  page.on('pageerror', (error) => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      errors.push({ type: message.type(), text: message.text() });
    }
  });

  const results = [];
  let fatalError = null;

  try {
    if (!await waitForHttp(BASE_URL)) {
      throw new Error(`Vite server did not respond at ${BASE_URL}\n${serverOutput}`);
    }

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.evaluate(() => {
      localStorage.removeItem('masteryOverlayShown');
      localStorage.removeItem('weaponMastery');
    });

    for (const scenario of scenarios) {
      results.push(await runScenario(page, scenario));
      await wait(350);
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }

  const filteredErrors = criticalErrors(errors);
  const report = {
    generatedAt: new Date().toISOString(),
    codePath: 'index.html -> src/main.ts -> ?testArena=true -> GameLoop -> WeaponManager.fireStandard',
    baseUrl: BASE_URL,
    screenshotDir: SCREENSHOT_DIR,
    serverOutput,
    scenarios: results,
    errors,
    criticalErrors: filteredErrors,
    fatalError,
  };
  report.passed = !fatalError
    && filteredErrors.length === 0
    && results.length === scenarios.length
    && results.every(result => result.passed);

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Report: ${REPORT_PATH}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${JSON.stringify(result.checks)}`);
  }
  if (fatalError) console.error(fatalError);
  if (filteredErrors.length > 0) {
    console.error(`Critical page errors: ${filteredErrors.map((entry) => entry.text || entry.message).join(' | ')}`);
  }

  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
