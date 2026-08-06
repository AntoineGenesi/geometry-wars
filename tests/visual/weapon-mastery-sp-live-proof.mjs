#!/usr/bin/env node
/**
 * Reusable SP weapon mastery runtime proof.
 *
 * CODE PATH: index.html -> src/main.ts -> ?testArena=true -> GameLoop ->
 * TestHarnessAPI -> WeaponManager.
 */
import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { screenshotPixelStats } from './screenshot-pixel-stats.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || process.env.SP_DEV_PORT || 3048);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/weapon-mastery-sp-live-proof', RUN_ID);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/weapon-mastery-sp-live-proof-${RUN_ID}.json`);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/mnt/d/WSL-Caches/home-antoine/.cache/puppeteer/chrome/linux-145.0.7632.46/chrome-linux64/chrome',
  '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);
const CHROME_PATH = CHROME_CANDIDATES.find(path => existsSync(path)) || CHROME_CANDIDATES[0];

const scenarios = [
  {
    name: 'standard-nova-fan',
    weapon: 'standard',
    activeNodes: [
      'standard_a_1',
      'standard_a_2',
      'standard_a_3',
      'standard_a_4',
      'standard_al_5',
      'standard_al_6',
    ],
    expected: { bulletDelta: 9, projectileDeltaMin: 0, blackHoleEffectsMin: 0 },
  },
  {
    name: 'spread-pellet-storm',
    weapon: 'spread',
    activeNodes: [
      'spread_a_1',
      'spread_a_2',
      'spread_a_3',
      'spread_al_4',
      'spread_al_5',
    ],
    expected: { bulletDelta: 1, projectileDeltaMin: 10, blackHoleEffectsMin: 0 },
  },
  {
    name: 'black-hole-multi-void',
    weapon: 'black_hole',
    activeNodes: [
      'black_hole_a_1',
      'black_hole_a_2',
      'black_hole_a_3',
      'black_hole_al_4',
    ],
    enemy: { type: 'virus', u: 0.5, v: 0.47, health: 220 },
    player: { u: 0.5, v: 0.62 },
    preFireWaitMs: 3600,
    impactWaitMs: 1100,
    clearBaselineBullets: true,
    expected: { bulletDelta: 0, projectileDeltaMin: 4, blackHoleEffectsMin: 1 },
  },
];

const selectedNames = new Set(
  (process.argv.find(arg => arg.startsWith('--scenarios='))?.split('=')[1] || '')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean),
);
const selectedScenarios = selectedNames.size > 0
  ? scenarios.filter(scenario => selectedNames.has(scenario.name))
  : scenarios;

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
      && typeof api.activateNodes === 'function'
      && typeof api.clearEnemies === 'function'
      && typeof api.clearEvents === 'function'
      && typeof api.clearWeaponEffects === 'function'
      && typeof api.forceEquipWeapon === 'function'
      && typeof api.fireWeapon === 'function'
      && typeof api.getActiveNodes === 'function'
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

async function sampleCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return { ok: false, reason: 'no canvas' };
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d', { willReadFrequently: true });
    if (!context) return { ok: false, reason: 'no 2d context' };
    context.drawImage(canvas, 0, 0);
    let nonDark = 0;
    let samples = 0;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const px = Math.min(copy.width - 1, Math.round((x + 0.5) * copy.width / 16));
        const py = Math.min(copy.height - 1, Math.round((y + 0.5) * copy.height / 16));
        const data = context.getImageData(px, py, 1, 1).data;
        if (Math.max(data[0], data[1], data[2]) >= 25) nonDark++;
        samples++;
      }
    }
    return { ok: true, nonDark, samples, width: copy.width, height: copy.height };
  });
}

function screenshotRetained(path) {
  return existsSync(path) && statSync(path).size > 0;
}

async function openTestArena(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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
}

async function runScenario(page, scenario) {
  await openTestArena(page);

  const setup = await page.evaluate((input) => {
    const api = window.__TEST_API;
    api.clearEnemies();
    api.clearEvents();
    api.clearWeaponEffects();
    api.setPlayerPosition(input.player?.u ?? 0.5, input.player?.v ?? 0.58);
    api.forceEquipWeapon(input.weapon, input.weapon === 'standard' ? -1 : 999);
    api.activateNodes(input.activeNodes);
    let enemyId = null;
    if (input.enemy) {
      enemyId = api.spawnEnemy(input.enemy.type, input.enemy.u, input.enemy.v);
      api.configureEnemy?.(enemyId, { health: input.enemy.health, speed: 0 });
      api.moveEnemyTo(enemyId, input.enemy.u, input.enemy.v, 0);
    }
    return {
      enemyId,
      currentWeapon: api.getCurrentWeapon(),
      activeNodes: api.getActiveNodes(),
      before: api.getWeaponRuntimeSnapshot(),
    };
  }, scenario);

  if (scenario.preFireWaitMs) await wait(scenario.preFireWaitMs);
  const fire = await page.evaluate((input) => (
    window.__TEST_API.fireWeapon(input.enemyId ?? undefined, {
      clearBaselineBullets: input.clearBaselineBullets,
    })
  ), { enemyId: setup.enemyId, clearBaselineBullets: scenario.clearBaselineBullets === true });

  await wait(180);
  const afterFireScreenshot = resolve(SCREENSHOT_DIR, `${scenario.name}-after-fire.png`);
  await page.screenshot({ path: afterFireScreenshot });
  const afterFireCanvas = await sampleCanvas(page);

  let afterImpact = null;
  let afterImpactScreenshot = null;
  let afterImpactCanvas = null;
  if (scenario.impactWaitMs) {
    await wait(scenario.impactWaitMs);
    afterImpact = await page.evaluate((enemyId) => {
      const api = window.__TEST_API;
      return {
        enemy: enemyId ? api.getEnemies().find(candidate => candidate.id === enemyId) ?? null : null,
        runtime: api.getWeaponRuntimeSnapshot(),
        damageEvents: api.getRecentDamageEvents(),
        deathEvents: api.getRecentDeaths(),
      };
    }, setup.enemyId);
    afterImpactScreenshot = resolve(SCREENSHOT_DIR, `${scenario.name}-after-impact.png`);
    await page.screenshot({ path: afterImpactScreenshot });
    afterImpactCanvas = await sampleCanvas(page);
  }

  const bulletDelta = fire.runtimeAfter.bulletCount - fire.runtimeBefore.bulletCount;
  const projectileDelta = fire.runtimeAfter.projectileCount - fire.runtimeBefore.projectileCount;
  const blackHoleEffects = (afterImpact?.runtime?.effects ?? fire.runtimeAfter.effects)
    .filter(effect => effect.type === 'blackhole');
  const activeNodesPresent = scenario.activeNodes.every(nodeId => setup.activeNodes.includes(nodeId));
  const screenshots = [afterFireScreenshot, afterImpactScreenshot].filter(Boolean);
  const screenshotStats = screenshots.map(path => screenshotPixelStats(path));
  const runtimeVisible = bulletDelta > 0 || projectileDelta >= scenario.expected.projectileDeltaMin
    || blackHoleEffects.length >= scenario.expected.blackHoleEffectsMin;
  const checks = {
    selectedWeapon: setup.currentWeapon === scenario.weapon && fire.selectedWeapon === scenario.weapon,
    activeNodes: activeNodesPresent,
    firedSignal: fire.firedSignal,
    bulletDelta: bulletDelta === scenario.expected.bulletDelta,
    projectileDelta: projectileDelta >= scenario.expected.projectileDeltaMin,
    blackHoleEffectPhase: blackHoleEffects.length >= scenario.expected.blackHoleEffectsMin
      && (scenario.expected.blackHoleEffectsMin === 0
        || blackHoleEffects.some(effect => effect.visualChildCount > 0 || effect.radius > 0)),
    runtimeVisible,
    screenshotsRetained: screenshots.every(screenshotRetained),
    screenshotsNonblank: screenshotStats.every(stats => stats.nonblank),
  };

  return {
    name: scenario.name,
    weapon: scenario.weapon,
    activeNodes: scenario.activeNodes,
    passed: Object.values(checks).every(Boolean),
    checks,
    metrics: {
      bulletDelta,
      projectileDelta,
      blackHoleEffectCount: blackHoleEffects.length,
      blackHoleVisualChildren: blackHoleEffects.map(effect => effect.visualChildCount),
      afterFireCanvas,
      afterImpactCanvas,
      screenshotStats,
    },
    setup,
    fire,
    afterImpact,
    screenshots,
  };
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(dirname(REPORT_PATH), { recursive: true });

  if (selectedScenarios.length === 0) {
    throw new Error(`No scenarios selected. Available: ${scenarios.map(scenario => scenario.name).join(', ')}`);
  }
  if (!existsSync(CHROME_PATH)) throw new Error(`Chrome not found at ${CHROME_PATH}`);

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

  const errors = [];
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
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', error => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', message => {
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
    for (const scenario of selectedScenarios) {
      results.push(await runScenario(page, scenario));
      await wait(350);
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await browser.close().catch(() => {});
    server.kill('SIGTERM');
  }

  const filteredErrors = criticalErrors(errors);
  const report = {
    generatedAt: new Date().toISOString(),
    command: 'node tests/visual/weapon-mastery-sp-live-proof.mjs',
    codePath: 'index.html -> src/main.ts -> ?testArena=true -> GameLoop -> TestHarnessAPI -> WeaponManager',
    proofBoundary: 'Linux headless Chrome WebGL2/SwiftShader SP test-arena proof. Representative retained Standard, Spread, and Black Hole nodes only; no all-node, Windows, WebGPU, organic progression, or human-feel claim.',
    baseUrl: BASE_URL,
    screenshotDir: SCREENSHOT_DIR,
    selectedScenarios: selectedScenarios.map(scenario => scenario.name),
    scenarios: results,
    errors,
    criticalErrors: filteredErrors,
    fatalError,
    serverOutput: serverOutput.slice(-5000),
  };
  report.passed = !fatalError
    && filteredErrors.length === 0
    && results.length === selectedScenarios.length
    && results.every(result => result.passed);

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${REPORT_PATH}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  for (const result of results) {
    console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}: ${JSON.stringify(result.checks)}`);
  }
  if (fatalError) console.error(fatalError);
  if (filteredErrors.length > 0) {
    console.error(`Critical page errors: ${filteredErrors.map(entry => entry.text || entry.message).join(' | ')}`);
  }
  process.exit(report.passed ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
