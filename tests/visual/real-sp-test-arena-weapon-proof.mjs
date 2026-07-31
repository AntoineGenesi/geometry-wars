#!/usr/bin/env node
/**
 * Real SP test-arena weapon proof.
 *
 * CODE PATH: index.html -> src/main.ts -> ?testArena=true -> GameLoop ->
 * WeaponManager / CollisionSystem / TestHarnessAPI.
 *
 * This is not a WeaponPlayground or GameInstance proof.
 */
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const screenshotDir = resolve(PROJECT_ROOT, 'test-screenshots/real-sp-test-arena-weapon-proof', timestamp);
const reportPath = resolve(PROJECT_ROOT, `reports/real-sp-test-arena-weapon-proof-${timestamp}.json`);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const scenarios = [
  {
    name: 'standard-projectile',
    family: 'Standard/projectile',
    weapon: 'standard',
    enemyType: 'virus',
    player: { u: 0.5, v: 0.58 },
    enemy: { u: 0.5, v: 0.47 },
    waitMs: 2200,
    selectedEvidence: (fire) => fire.firedIndicators.includes('standard_bullet_active')
      || fire.firedIndicators.includes('bullet_count_increased'),
    presenceSummary: (fire) => ({
      bulletCountAfterFire: fire.runtimeAfter.bulletCount,
      latestBullet: fire.runtimeAfter.bullets.at(-1) ?? null,
    }),
  },
  {
    name: 'laser-beam',
    family: 'Laser/beam',
    weapon: 'laser_beam',
    enemyType: 'virus',
    player: { u: 0.5, v: 0.58 },
    enemy: { u: 0.5, v: 0.47 },
    waitMs: 1000,
    selectedEvidence: (fire) => fire.firedIndicators.includes('selected_effect_active:laser'),
    presenceSummary: (fire) => ({
      effectsAfterFire: fire.runtimeAfter.effects.filter((effect) => effect.type === 'laser'),
    }),
  },
  {
    name: 'homing-missile',
    family: 'Homing/projectile',
    weapon: 'homing',
    enemyType: 'virus',
    player: { u: 0.5, v: 0.58 },
    enemy: { u: 0.5, v: 0.43 },
    waitMs: 1800,
    selectedEvidence: (fire) => fire.firedIndicators.includes('selected_projectile_active:homing'),
    presenceSummary: (fire) => ({
      projectilesAfterFire: fire.runtimeAfter.projectiles.filter((projectile) => projectile.type === 'homing'),
    }),
  },
  {
    name: 'black-hole-special',
    family: 'Black Hole/utility',
    weapon: 'black_hole',
    enemyType: 'virus',
    player: { u: 0.5, v: 0.62 },
    enemy: { u: 0.5, v: 0.47 },
    preFireWaitMs: 3600,
    waitMs: 1400,
    selectedEvidence: (fire) => fire.firedIndicators.includes('selected_effect_active:blackhole'),
    presenceSummary: (fire) => ({
      effectsAfterFire: fire.runtimeAfter.effects.filter((effect) => effect.type === 'blackhole'),
    }),
  },
];

function normalize(vec) {
  const len = Math.hypot(vec.x, vec.y, vec.z);
  if (len < 0.0001) return { x: 0, y: 0, z: 0 };
  return { x: vec.x / len, y: vec.y / len, z: vec.z / len };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
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

async function waitForTestApi(page) {
  await page.waitForFunction(() => {
    const api = window.__TEST_API;
    return Boolean(
      api
      && typeof api.setPlayerPosition === 'function'
      && typeof api.fireWeapon === 'function'
      && typeof api.getWeaponRuntimeSnapshot === 'function',
    );
  }, { timeout: 30000 });
}

async function runScenario(page, scenario) {
  if (scenario.preFireWaitMs) await sleep(scenario.preFireWaitMs);

  const setup = await page.evaluate((input) => {
    const api = window.__TEST_API;
    api.clearEnemies();
    api.clearEvents();
    api.setPlayerPosition(input.player.u, input.player.v);
    api.forceEquipWeapon(input.weapon, 999);
    const enemyId = api.spawnEnemy(input.enemyType, input.enemy.u, input.enemy.v);
    api.moveEnemyTo(enemyId, input.enemy.u, input.enemy.v, 0);
    return {
      enemyId,
      currentWeapon: api.getCurrentWeapon(),
      gameState: api.getGameState(),
      enemyBefore: api.getEnemies().find((enemy) => enemy.id === enemyId) ?? null,
      runtimeBefore: api.getWeaponRuntimeSnapshot(),
    };
  }, scenario);

  await sleep(250);

  const fire = await page.evaluate((enemyId) => window.__TEST_API.fireWeapon(enemyId), setup.enemyId);
  const immediateScreenshot = resolve(screenshotDir, `${scenario.name}-after-fire.png`);
  await sleep(180);
  await page.screenshot({ path: immediateScreenshot });
  await sleep(Math.max(0, scenario.waitMs - 180));

  const after = await page.evaluate((enemyId) => {
    const api = window.__TEST_API;
    return {
      enemyAfter: api.getEnemies().find((enemy) => enemy.id === enemyId) ?? null,
      runtimeAfterWait: api.getWeaponRuntimeSnapshot(),
      gameState: api.getGameState(),
      damageEvents: api.getRecentDamageEvents(),
      deathEvents: api.getRecentDeaths(),
    };
  }, setup.enemyId);

  const targetBefore = fire.targetBefore ?? setup.enemyBefore;
  const targetAfter = after.enemyAfter;
  const expectedDirection = targetBefore
    ? normalize({
      x: targetBefore.worldPos.x - fire.origin.x,
      y: targetBefore.worldPos.y - fire.origin.y,
      z: targetBefore.worldPos.z - fire.origin.z,
    })
    : { x: 0, y: 0, z: 0 };
  const aimDot = dot(normalize(fire.direction), expectedDirection);
  const targetKilled = Boolean(targetBefore && (!targetAfter || targetAfter.alive === false));
  const healthDelta = targetBefore && targetAfter
    ? targetBefore.health - targetAfter.health
    : targetKilled && targetBefore
      ? targetBefore.health
      : 0;
  const selectedEvidencePresent = scenario.selectedEvidence(fire);

  const checks = {
    selectedWeapon: setup.currentWeapon === scenario.weapon && fire.selectedWeapon === scenario.weapon,
    firedSignal: fire.firedSignal,
    aimDirection: Number.isFinite(aimDot) && aimDot > 0.94,
    projectileOrEffectPresence: selectedEvidencePresent,
    healthDeltaOrKill: healthDelta > 0 || targetKilled,
  };

  return {
    name: scenario.name,
    family: scenario.family,
    weapon: scenario.weapon,
    passed: Object.values(checks).every(Boolean),
    checks,
    setup,
    fire,
    after,
    aimDot,
    healthDelta,
    targetKilled,
    selectedPresence: scenario.presenceSummary(fire),
    screenshots: [immediateScreenshot],
  };
}

async function main() {
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });

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

  const scenarioResults = [];
  let fatalError = null;

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => {
      localStorage.removeItem('masteryOverlayShown');
      localStorage.removeItem('weaponMastery');
    });

    const url = `${BASE_URL}/?testArena=true&renderer=webgl2`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await waitForTestApi(page);
    await sleep(1200);
    await page.screenshot({ path: resolve(screenshotDir, '00-test-arena-ready.png') });

    for (const scenario of scenarios) {
      scenarioResults.push(await runScenario(page, scenario));
      await sleep(450);
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await browser.close();
  }

  const filteredErrors = criticalErrors(errors);
  const report = {
    generatedAt: new Date().toISOString(),
    codePath: 'index.html -> src/main.ts -> ?testArena=true -> GameLoop -> WeaponManager / CollisionSystem / TestHarnessAPI',
    baseUrl: BASE_URL,
    screenshotDir,
    scenarios: scenarioResults,
    errors,
    criticalErrors: filteredErrors,
    fatalError,
  };
  report.passed = !fatalError
    && filteredErrors.length === 0
    && scenarioResults.length === scenarios.length
    && scenarioResults.every((result) => result.passed);

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Report: ${reportPath}`);
  console.log(`Screenshots: ${screenshotDir}`);
  for (const result of scenarioResults) {
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
