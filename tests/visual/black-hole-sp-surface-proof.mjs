#!/usr/bin/env node
/** Real SP Black Hole proof through index.html -> main.ts -> GameLoop. */
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
const surface = process.argv.find((arg) => arg.startsWith('--surface='))?.split('=')[1] ?? 'cube';
if (!['cube', 'sphere'].includes(surface)) throw new Error(`Unsupported proof surface: ${surface}`);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const artifactRoot = resolve(PROJECT_ROOT, 'reports/black-hole-sp-surface-proof');
const screenshotDir = resolve(PROJECT_ROOT, 'test-screenshots/black-hole-sp-surface-proof', `${surface}-${timestamp}`);
const reportPath = resolve(artifactRoot, `${surface}-${timestamp}.json`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianPairwise(enemies) {
  const values = [];
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      values.push(distance(enemies[i].worldPos, enemies[j].worldPos));
    }
  }
  return median(values);
}

function meaningfulErrors(entries) {
  return entries.filter((entry) => {
    const text = String(entry.text || entry.message || entry);
    return !text.includes('favicon')
      && !text.includes('AudioContext')
      && !text.includes('SharedArrayBuffer')
      && !text.includes('WebGPU')
      && !text.includes('404')
      && !text.includes('PerformanceExporter')
      && !text.includes('ERR_CONNECTION_REFUSED');
  });
}

async function getTracked(page, ids) {
  return page.evaluate((trackedIds) => {
    const enemies = window.__TEST_API.getEnemies();
    return trackedIds.map((id) => enemies.find((enemy) => enemy.id === id) ?? null).filter(Boolean);
  }, ids);
}

async function waitForEffect(page, predicate, timeout = 10000) {
  await page.waitForFunction(predicate, { timeout });
  return page.evaluate(() => window.__TEST_API.getWeaponRuntimeSnapshot());
}

async function main() {
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(artifactRoot, { recursive: true });

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

  let result = null;
  let fatalError = null;
  try {
    await page.goto(`${BASE_URL}/?testArena=true&surface=${surface}&renderer=webgl2`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForFunction(() => Boolean(
      window.__TEST_API
      && typeof window.__TEST_API.configureEnemy === 'function'
      && typeof window.__TEST_API.projectWorldPoint === 'function'
      && typeof window.__TEST_API.clearWeaponEffects === 'function'
    ), { timeout: 30000 });
    await page.waitForFunction(() => window.__TEST_API.getGameState().gameTime > 3.6, { timeout: 15000 });

    const setup = await page.evaluate(() => {
      const api = window.__TEST_API;
      api.clearEnemies();
      api.clearEvents();
      api.clearWeaponEffects();
      api.setPlayerPosition(0.5, 0.66);
      api.forceEquipWeapon('black_hole', 20);
      const aimId = api.spawnEnemy('virus', 0.5, 0.52);
      api.configureEnemy(aimId, { health: 100, speed: 0 });
      const player = api.getPlayerPosition();
      const aim = api.getEnemies().find((enemy) => enemy.id === aimId);
      const delta = {
        x: aim.worldPos.x - player.worldPos.x,
        y: aim.worldPos.y - player.worldPos.y,
        z: aim.worldPos.z - player.worldPos.z,
      };
      const length = Math.hypot(delta.x, delta.y, delta.z);
      const predicted = api.projectWorldPoint({
        x: player.worldPos.x + delta.x / length * 4,
        y: player.worldPos.y + delta.y / length * 4,
        z: player.worldPos.z + delta.z / length * 4,
      });
      const offsets = [[-0.045, -0.035], [0.045, -0.035], [-0.045, 0.035], [0.045, 0.035]];
      const trackedIds = offsets.map(([du, dv]) => {
        const id = api.spawnEnemy('virus', predicted.u + du, predicted.v + dv);
        api.configureEnemy(id, { health: 100, speed: 0 });
        return id;
      });
      return { aimId, trackedIds, predicted };
    });

    await sleep(350);
    const controlStart = await getTracked(page, setup.trackedIds);
    await sleep(1000);
    const controlEnd = await getTracked(page, setup.trackedIds);
    const controlMedianStart = medianPairwise(controlStart);
    const controlMedianEnd = medianPairwise(controlEnd);

    const fire = await page.evaluate(
      (aimId) => window.__TEST_API.fireWeapon(aimId, { clearBaselineBullets: true }),
      setup.aimId,
    );
    const formation = fire.runtimeAfter;
    await page.screenshot({ path: resolve(screenshotDir, '01-formation.png') });
    const center = formation.effects.find((effect) => effect.type === 'blackhole').position;
    const beforePull = await getTracked(page, setup.trackedIds);

    const sustain = await waitForEffect(page, () => {
      const effect = window.__TEST_API.getWeaponRuntimeSnapshot().effects.find((item) => item.type === 'blackhole');
      return effect?.phase === 'sustain' && effect.elapsed >= 1.5;
    });
    const sustainEnemies = await getTracked(page, setup.trackedIds);
    await page.screenshot({ path: resolve(screenshotDir, '02-sustain.png') });

    const collapse = await waitForEffect(page, () => {
      const effect = window.__TEST_API.getWeaponRuntimeSnapshot().effects.find((item) => item.type === 'blackhole');
      return effect?.phase === 'collapse';
    });
    const collapseEnemies = await getTracked(page, setup.trackedIds);
    await page.screenshot({ path: resolve(screenshotDir, '03-collapse.png') });

    await page.waitForFunction(() => window.__TEST_API.getWeaponRuntimeSnapshot().effectCount === 0, { timeout: 10000 });
    await sleep(600);
    const postExpiry = await page.evaluate(() => ({
      runtime: window.__TEST_API.getWeaponRuntimeSnapshot(),
      enemies: window.__TEST_API.getEnemies(),
      damageEvents: window.__TEST_API.getRecentDamageEvents(),
    }));
    await page.screenshot({ path: resolve(screenshotDir, '04-post-expiry.png') });

    await sleep(500);
    const clearFire = await page.evaluate(
      (aimId) => window.__TEST_API.fireWeapon(aimId, { clearBaselineBullets: true }),
      setup.aimId,
    );
    await waitForEffect(page, () => window.__TEST_API.getWeaponRuntimeSnapshot().effectCount > 0);
    const preClear = await page.evaluate(() => ({
      runtime: window.__TEST_API.getWeaponRuntimeSnapshot(),
      enemies: window.__TEST_API.getEnemies(),
      damageCount: window.__TEST_API.getRecentDamageEvents().length,
    }));
    await page.evaluate(() => window.__TEST_API.clearWeaponEffects());
    const immediateClear = await page.evaluate(() => ({
      runtime: window.__TEST_API.getWeaponRuntimeSnapshot(),
      enemies: window.__TEST_API.getEnemies(),
      damageCount: window.__TEST_API.getRecentDamageEvents().length,
    }));
    await sleep(700);
    const postClear = await page.evaluate(() => ({
      runtime: window.__TEST_API.getWeaponRuntimeSnapshot(),
      enemies: window.__TEST_API.getEnemies(),
      damageCount: window.__TEST_API.getRecentDamageEvents().length,
    }));

    const distancesBefore = beforePull.map((enemy) => distance(enemy.worldPos, center));
    const distancesSustain = sustainEnemies.map((enemy) => distance(enemy.worldPos, center));
    const approachDeltas = distancesBefore.map((value, index) => value - distancesSustain[index]);
    const approachedCount = approachDeltas.filter((value) => value > 0.15).length;
    const medianBefore = medianPairwise(beforePull);
    const medianSustain = medianPairwise(sustainEnemies);
    const controlReduction = controlMedianStart - controlMedianEnd;
    const firedReduction = medianBefore - medianSustain;
    const trackedAfter = postExpiry.enemies.filter((enemy) => setup.trackedIds.includes(enemy.id));
    const totalHealthLoss = trackedAfter.reduce((sum, enemy) => sum + (100 - enemy.health), 0);
    const trackedDamageEvents = postExpiry.damageEvents.filter((event) => setup.trackedIds.includes(event.targetId));
    const blackHoleDamageEvents = trackedDamageEvents.filter((event) => event.weaponType === 'black_hole');
    const nonBlackHoleDamageEvents = trackedDamageEvents.filter((event) => event.weaponType !== 'black_hole');
    const blackHoleAttributedDamage = blackHoleDamageEvents.reduce(
      (sum, event) => sum + Number(event.damage ?? 0),
      0,
    );
    const clearPositionDelta = Math.max(...setup.trackedIds.map((id) => {
      const before = immediateClear.enemies.find((enemy) => enemy.id === id);
      const after = postClear.enemies.find((enemy) => enemy.id === id);
      return before && after ? distance(before.worldPos, after.worldPos) : Infinity;
    }));

    const checks = {
      realSurface: formation.currentWeapon === 'black_hole',
      selectedBlackHoleEffect: fire.firedSignal
        && formation.effects.some((effect) => effect.type === 'blackhole'),
      standardBulletsClearedBeforeFieldTick: fire.baselineBulletsCleared
        && fire.baselineBulletCountBeforeClear > 0
        && formation.bulletCount === 0,
      phaseFormation: formation.effects.some((effect) => effect.phase === 'formation'),
      phaseSustain: sustain.effects.some((effect) => effect.phase === 'sustain'),
      phaseCollapse: collapse.effects.some((effect) => effect.phase === 'collapse'),
      readableVisualContract: formation.blackHoleMeshCount >= 7 && sustain.blackHoleMeshCount >= 7,
      threeOfFourApproach: approachedCount >= 3,
      clusteringBeatsControl: firedReduction > controlReduction + 0.25,
      attributedDamage: totalHealthLoss > 0 && blackHoleDamageEvents.length > 0,
      noStandardIntersectionConfound: nonBlackHoleDamageEvents.length === 0
        && Math.abs(totalHealthLoss - blackHoleAttributedDamage) < 0.05,
      naturalExpiryClean: postExpiry.runtime.effectCount === 0
        && postExpiry.runtime.blackHoleMeshCount === 0
        && postExpiry.runtime.visualRootChildren === 0,
      clearClean: clearFire.firedSignal
        && immediateClear.runtime.effectCount === 0
        && immediateClear.runtime.blackHoleMeshCount === 0
        && immediateClear.runtime.visualRootChildren === 0,
      noPostClearDamageOrPull: postClear.damageCount === immediateClear.damageCount && clearPositionDelta < 0.05,
    };

    result = {
      surface,
      setup,
      checks,
      passed: Object.values(checks).every(Boolean),
      metrics: {
        controlMedianStart,
        controlMedianEnd,
        controlReduction,
        medianBefore,
        medianSustain,
        firedReduction,
        distancesBefore,
        distancesSustain,
        approachDeltas,
        approachedCount,
        totalHealthLoss,
        blackHoleDamageEventCount: blackHoleDamageEvents.length,
        blackHoleAttributedDamage,
        nonBlackHoleDamageEventCount: nonBlackHoleDamageEvents.length,
        baselineBulletCountBeforeClear: fire.baselineBulletCountBeforeClear,
        clearPositionDelta,
      },
      runtime: { formation, sustain, collapse, postExpiry: postExpiry.runtime, immediateClear: immediateClear.runtime, postClear: postClear.runtime },
      screenshots: [
        resolve(screenshotDir, '01-formation.png'),
        resolve(screenshotDir, '02-sustain.png'),
        resolve(screenshotDir, '03-collapse.png'),
        resolve(screenshotDir, '04-post-expiry.png'),
      ],
    };
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await browser.close();
  }

  const criticalErrors = meaningfulErrors(errors);
  const report = {
    generatedAt: new Date().toISOString(),
    codePath: 'index.html -> src/main.ts -> GameLoop -> WeaponManager -> BaseEnemy.applySurfacePull',
    url: `${BASE_URL}/?testArena=true&surface=${surface}&renderer=webgl2`,
    result,
    errors,
    criticalErrors,
    fatalError,
  };
  report.passed = Boolean(result?.passed) && !fatalError && criticalErrors.length === 0;
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${reportPath}`);
  console.log(`Screenshots: ${screenshotDir}`);
  if (result) console.log(JSON.stringify({ checks: result.checks, metrics: result.metrics }, null, 2));
  if (fatalError) console.error(fatalError);
  if (criticalErrors.length) console.error(JSON.stringify(criticalErrors, null, 2));
  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
