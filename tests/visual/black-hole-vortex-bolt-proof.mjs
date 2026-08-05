#!/usr/bin/env node
/**
 * Real SP Black Hole vortex bolt proof.
 *
 * CODE PATH: index.html -> src/main.ts -> ?testArena=true -> GameLoop ->
 * WeaponManager / TestHarnessAPI.
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
const screenshotDir = resolve(PROJECT_ROOT, 'test-screenshots/black-hole-vortex-bolt', timestamp);
const reportPath = resolve(PROJECT_ROOT, `reports/black-hole-vortex-bolt-proof-${timestamp}.json`);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

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
      && typeof api.forceEquipWeapon === 'function'
      && typeof api.fireWeapon === 'function'
      && typeof api.getWeaponRuntimeSnapshot === 'function',
    );
  }, { timeout: 30000 });
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

  let fatalError = null;
  let proof = null;

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate(() => {
      localStorage.removeItem('masteryOverlayShown');
      localStorage.removeItem('weaponMastery');
    });

    await page.goto(`${BASE_URL}/?testArena=true&renderer=webgl2`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForSelector('canvas', { timeout: 30000 });
    await waitForTestApi(page);
    await sleep(1200);
    await page.screenshot({ path: resolve(screenshotDir, '00-ready.png') });

    const setup = await page.evaluate(() => {
      const api = window.__TEST_API;
      api.clearEnemies();
      api.clearEvents();
      api.clearWeaponEffects();
      api.setPlayerPosition(0.5, 0.62);
      api.forceEquipWeapon('black_hole', 999);
      const enemyId = api.spawnEnemy('virus', 0.5, 0.47);
      api.configureEnemy?.(enemyId, { health: 200, speed: 0 });
      api.moveEnemyTo(enemyId, 0.5, 0.47, 0);
      return {
        enemyId,
        currentWeapon: api.getCurrentWeapon(),
        enemyBefore: api.getEnemies().find((enemy) => enemy.id === enemyId) ?? null,
        runtimeBefore: api.getWeaponRuntimeSnapshot(),
      };
    });

    await sleep(3600);
    const fire = await page.evaluate((enemyId) => (
      window.__TEST_API.fireWeapon(enemyId, { clearBaselineBullets: true })
    ), setup.enemyId);
    await sleep(80);
    const projectileFrame = await page.evaluate(() => window.__TEST_API.getWeaponRuntimeSnapshot());
    await page.screenshot({ path: resolve(screenshotDir, '01-projectile-before-impact.png') });

    await sleep(900);
    const impactFrame = await page.evaluate((enemyId) => {
      const api = window.__TEST_API;
      return {
        enemyAfter: api.getEnemies().find((enemy) => enemy.id === enemyId) ?? null,
        runtimeAfterImpact: api.getWeaponRuntimeSnapshot(),
        damageEvents: api.getRecentDamageEvents(),
        deathEvents: api.getRecentDeaths(),
      };
    }, setup.enemyId);
    await page.screenshot({ path: resolve(screenshotDir, '02-blackhole-after-impact.png') });

    const fireBlackHoleProjectiles = fire.runtimeAfter.projectiles
      .filter((projectile) => projectile.type === 'black_hole');
    const fireBlackHoleEffects = fire.runtimeAfter.effects
      .filter((effect) => effect.type === 'blackhole');
    const laterBlackHoleEffects = impactFrame.runtimeAfterImpact.effects
      .filter((effect) => effect.type === 'blackhole');

    const checks = {
      selectedWeapon: setup.currentWeapon === 'black_hole' && fire.selectedWeapon === 'black_hole',
      firedProjectileSignal: fire.firedIndicators.includes('selected_projectile_active:black_hole'),
      projectileBeforeImpact: fireBlackHoleProjectiles.length >= 1 || projectileFrame.projectiles.some((p) => p.type === 'black_hole'),
      noImmediateField: fireBlackHoleEffects.length === 0,
      fieldAfterImpact: laterBlackHoleEffects.length >= 1,
      noCriticalPageErrors: criticalErrors(errors).length === 0,
    };

    proof = {
      name: 'black-hole-vortex-bolt',
      codePath: 'index.html -> src/main.ts -> ?testArena=true -> GameLoop -> WeaponManager / TestHarnessAPI',
      passed: Object.values(checks).every(Boolean),
      checks,
      setup,
      fire,
      projectileFrame,
      impactFrame,
      screenshots: [
        resolve(screenshotDir, '00-ready.png'),
        resolve(screenshotDir, '01-projectile-before-impact.png'),
        resolve(screenshotDir, '02-blackhole-after-impact.png'),
      ],
    };
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await browser.close();
  }

  const filteredErrors = criticalErrors(errors);
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    screenshotDir,
    proof,
    errors,
    criticalErrors: filteredErrors,
    fatalError,
  };
  report.passed = !fatalError && filteredErrors.length === 0 && proof?.passed === true;

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`Report: ${reportPath}`);
  console.log(`Screenshots: ${screenshotDir}`);
  if (proof) console.log(`${proof.passed ? 'PASS' : 'FAIL'} ${proof.name}: ${JSON.stringify(proof.checks)}`);
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
