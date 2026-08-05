#!/usr/bin/env node
/**
 * Real SP Standard mastery baseline proof.
 *
 * CODE PATH: index.html -> src/main.ts -> ?testArena=true -> GameLoop ->
 * Player.weaponFireHandler -> WeaponManager.fireStandard -> BulletPool.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || 3030);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/standard-weapon-mastery-baseline-proof', RUN_ID);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/standard-weapon-mastery-baseline-proof-${RUN_ID}.json`);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/mnt/d/WSL-Caches/home-antoine/.cache/puppeteer/chrome/linux-145.0.7632.46/chrome-linux64/chrome',
  '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);
const CHROME_PATH = CHROME_CANDIDATES.find(path => existsSync(path)) || CHROME_CANDIDATES[0];

const scenarios = [
  {
    name: 'standard-baseline-one-bolt',
    activeNodes: [],
    expectedBulletDelta: 1,
  },
  {
    name: 'standard-a1-dual-bolts',
    activeNodes: ['standard_a_1'],
    expectedBulletDelta: 2,
  },
  {
    name: 'standard-b1-focused-pair',
    activeNodes: ['standard_b_1'],
    expectedBulletDelta: 2,
  },
];

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

function wait(ms) {
  return new Promise(resolveWait => setTimeout(resolveWait, ms));
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

function directionSpread(bullets) {
  if (bullets.length < 2) return 0;
  const dirs = bullets.map(bullet => [bullet.dirX ?? 0, bullet.dirY ?? 0, bullet.dirZ ?? 0]);
  let maxDistance = 0;
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const dx = dirs[i][0] - dirs[j][0];
      const dy = dirs[i][1] - dirs[j][1];
      const dz = dirs[i][2] - dirs[j][2];
      maxDistance = Math.max(maxDistance, Math.hypot(dx, dy, dz));
    }
  }
  return maxDistance;
}

async function runScenario(page, scenario) {
  await page.goto(BASE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await page.evaluate(() => {
    localStorage.removeItem('masteryOverlayShown');
    localStorage.removeItem('weaponMastery');
  });
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
    if (activeNodes.length > 0) api.activateNodes(activeNodes);
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

  const after = await page.evaluate(() => window.__TEST_API.getWeaponRuntimeSnapshot());
  const bulletDelta = fire.runtimeAfter.bulletCount - fire.runtimeBefore.bulletCount;
  const newBullets = fire.runtimeAfter.bullets.slice(fire.runtimeBefore.bullets.length);
  const activeNodeCheck = scenario.activeNodes.every(nodeId => setup.activeNodes.includes(nodeId));
  const checks = {
    selectedStandard: setup.currentWeapon === 'standard' && fire.selectedWeapon === 'standard',
    activeNodes: activeNodeCheck,
    firedSignal: fire.firedSignal && fire.firedIndicators.includes('standard_bullet_active'),
    bulletDelta: bulletDelta === scenario.expectedBulletDelta,
    directionSpread: scenario.expectedBulletDelta === 1 || directionSpread(newBullets) > 0.0001,
  };

  return {
    ...scenario,
    passed: Object.values(checks).every(Boolean),
    checks,
    setup,
    fire,
    after,
    bulletDelta,
    newBullets,
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
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => {
    if (['error', 'warning'].includes(message.type())) {
      errors.push({ type: message.type(), text: message.text() });
    }
  });

  const scenarioResults = [];
  let fatalError = null;
  try {
    const ready = await waitForHttp(BASE_URL);
    if (!ready) throw new Error(`Vite did not become ready at ${BASE_URL}\n${serverOutput}`);
    for (const scenario of scenarios) {
      scenarioResults.push(await runScenario(page, scenario));
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
    codePath: 'index.html -> src/main.ts -> ?testArena=true -> GameLoop -> Player.weaponFireHandler -> WeaponManager.fireStandard -> BulletPool',
    baseUrl: BASE_URL,
    screenshotDir: SCREENSHOT_DIR,
    scenarios: scenarioResults,
    errors,
    criticalErrors: filteredErrors,
    fatalError,
    serverOutput: serverOutput.slice(-5000),
  };
  report.passed = !fatalError
    && filteredErrors.length === 0
    && scenarioResults.length === scenarios.length
    && scenarioResults.every(result => result.passed);

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Report: ${REPORT_PATH}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  for (const result of scenarioResults) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${JSON.stringify(result.checks)}`);
  }
  if (fatalError) console.error(fatalError);
  if (filteredErrors.length > 0) {
    console.error(`Critical page errors: ${filteredErrors.map(entry => entry.text || entry.message).join(' | ')}`);
  }

  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
