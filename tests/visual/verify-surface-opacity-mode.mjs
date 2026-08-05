#!/usr/bin/env node
/**
 * Live SP proof for the surface visibility mode setting.
 *
 * Verifies the real single-player path:
 * - default/legacy graphics settings make surfaces opaque;
 * - opaque mode uses a depth-writing surface and does not hard-hide reachable
 *   enemies through resolver thresholds;
 * - explicit see-through mode keeps far-side enemies dim/readable.
 */

import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3033';
const CHROME_PATH = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
const REPORTS_DIR = resolve(__dirname, '../../reports');
const surfaceArg = process.argv.find((arg) => arg.startsWith('--surface='))?.split('=')[1];
const surfacesArg = process.argv.find((arg) => arg.startsWith('--surfaces='))?.split('=')[1];
const surfaces = (surfacesArg || surfaceArg || 'cube')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
const runDate = new Date().toISOString().replace(/[:.]/g, '-');

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function configureStorage(page, mode) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.evaluate((selectedMode) => {
    localStorage.removeItem('masteryOverlayShown');
    localStorage.removeItem('weaponMastery');
    if (selectedMode === 'default') {
      localStorage.removeItem('gw3d-graphics-settings');
    } else {
      localStorage.setItem('gw3d-graphics-settings', JSON.stringify({
        surfaceOpaque: selectedMode === 'opaque',
        surfaceOpacity: 0.05,
        surfaceVisibilityPreferenceVersion: 2,
      }));
    }
  }, mode);
}

async function runMode(page, surface, mode) {
  await configureStorage(page, mode);
  const url = `${BASE_URL}?quickStart=true&surface=${surface}&renderer=webgl&debug=true&testMode=true`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await sleep(3000);

  const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
  if (!apiReady) throw new Error('__TEST_API unavailable in testMode');

  const ids = await page.evaluate(() => {
    const api = window.__TEST_API;
    api.clearEnemies();
    api.setPlayerPosition(0.125, 0.5);
    const roles = [
      { role: 'same-face-near', u: 0.125, v: 0.62 },
      { role: 'same-face-high', u: 0.125, v: 0.8 },
      { role: 'adjacent-right', u: 0.375, v: 0.5 },
      { role: 'adjacent-left', u: 0.875, v: 0.5 },
      { role: 'top-face', u: 0.125, v: 0.95 },
      { role: 'bottom-face', u: 0.125, v: 0.05 },
      { role: 'opposite-face', u: 0.625, v: 0.5 },
    ];
    const spawned = roles.map((entry) => ({
      ...entry,
      id: api.spawnEnemy('grunt', entry.u, entry.v),
    }));
    const spawnedIds = new Set(spawned.map((entry) => entry.id));
    for (const enemy of api.ctx.enemySpawner.getEnemies()) {
      if (!spawnedIds.has(enemy.__testId)) continue;
      enemy.update = () => {};
      if (enemy.walker) enemy.walker.speed = 0;
    }
    return spawned;
  });
  await sleep(2000);

  const summary = await page.evaluate(({ spawnedRoles, selectedMode }) => {
    const api = window.__TEST_API;
    const ctx = api.ctx;
    const material = ctx.surface.mesh.material;
    const occlusionFadeEnabled = material?._uniforms?.uOcclusionEnabled?.value ?? null;
    const enemies = api.getEnemies();
    const rawEnemies = ctx.enemySpawner.getEnemies().map((enemy) => ({
      id: enemy.__testId,
      className: enemy.__surfaceVisibility?.className ?? null,
      visibility: enemy.__surfaceVisibility?.visibility ?? null,
      occluded: enemy.__surfaceVisibility?.occluded ?? null,
    }));
    const spawned = spawnedRoles.map(({ role, id, u, v }) => ({
      role,
      id,
      u,
      v,
      enemy: enemies.find((candidate) => candidate.id === id) ?? null,
      raw: rawEnemies.find((candidate) => candidate.id === id) ?? null,
    }));

    return {
      mode: selectedMode,
      backend: ctx.game.backend,
      isWebGPU: ctx.game.isWebGPU,
      surfaceOpacity: material.opacity,
      surfaceTransparent: material.transparent,
      surfaceDepthWrite: material.depthWrite,
      occlusionFadeEnabled,
      spawned,
    };
  }, { spawnedRoles: ids, selectedMode: mode });
  const screenshotPath = resolve(REPORTS_DIR, `surface-opacity-mode-${surface}-${mode}-${runDate}.png`);
  await page.screenshot({ path: screenshotPath });
  return { ...summary, screenshotPath };
}

function evaluateChecks(surface, defaultMode, seeThroughMode, pageErrors) {
  const criticalPageErrors = pageErrors.filter((error) => !/Failed to load resource: the server responded with a status of 404/.test(error));
  const defaultSpawnedVisible = defaultMode.spawned.every(({ enemy, raw }) => (
    raw?.className !== 'opaque-hidden'
    && raw?.visibility === 1
    && (enemy?.opacity ?? 0) > 0
    && (enemy?.instanceColorBrightness ?? 0) > 0.3
    && (enemy?.instanceMatrixScale ?? 0) > 0
  ));
  const seeThroughDimReadable = seeThroughMode.spawned.some(({ enemy, raw }) => (
    raw?.className !== 'direct'
    && raw?.className !== 'opaque-hidden'
    && (enemy?.opacity ?? 0) > 0
    && (enemy?.instanceColorBrightness ?? 0) >= 0.3
    && (enemy?.instanceMatrixScale ?? 0) > 0
  ));

  const checks = {
    defaultSurfaceOpaque: defaultMode.surfaceOpacity === 1,
    defaultSurfaceDepthWrites: defaultMode.occlusionFadeEnabled === true
      ? defaultMode.surfaceDepthWrite === false
      : defaultMode.surfaceDepthWrite === true,
    defaultSurfaceTransparencyMatchesCorridorFade: defaultMode.occlusionFadeEnabled === true
      ? defaultMode.surfaceTransparent === true
      : defaultMode.surfaceTransparent === false,
    defaultNoResolverHardHidden: defaultMode.spawned.every(({ raw }) => raw?.className !== 'opaque-hidden'),
    defaultSpawnedVisible,
    seeThroughSurfaceReadable: seeThroughMode.surfaceOpacity === 0.05,
    seeThroughSurfaceTransparent: seeThroughMode.surfaceTransparent === true,
    seeThroughSurfaceDoesNotDepthWrite: seeThroughMode.surfaceDepthWrite === false,
    seeThroughNoOpaqueHidden: seeThroughMode.spawned.every(({ raw }) => raw?.className !== 'opaque-hidden'),
    seeThroughOccludedEnemyDimReadable: seeThroughDimReadable,
    noCriticalPageErrors: criticalPageErrors.length === 0,
  };
  return {
    passed: Object.values(checks).every(Boolean),
    checks,
    surface,
    defaultMode,
    seeThroughMode,
    pageErrors,
    criticalPageErrors,
    timestamp: new Date().toISOString(),
  };
}

async function main() {
  mkdirSync(REPORTS_DIR, { recursive: true });
  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-web-security',
      '--window-size=800,600',
    ],
    timeout: 30000,
  };
  if (CHROME_PATH && existsSync(CHROME_PATH)) {
    launchOptions.executablePath = CHROME_PATH;
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  const allReports = [];

  try {
    for (const surface of surfaces) {
      const pageErrors = [];
      const onPageError = (error) => pageErrors.push(error.message);
      const onConsole = (message) => {
        if (message.type() === 'error') pageErrors.push(message.text());
      };
      page.on('pageerror', onPageError);
      page.on('console', onConsole);
      const defaultMode = await runMode(page, surface, 'default');
      const seeThroughMode = await runMode(page, surface, 'see-through');
      page.off('pageerror', onPageError);
      page.off('console', onConsole);

      const report = evaluateChecks(surface, defaultMode, seeThroughMode, pageErrors);
      allReports.push(report);
      console.log(`${report.passed ? 'PASS' : 'FAIL'} ${surface}`);
      if (!report.passed) {
        console.log(JSON.stringify({
          surface,
          checks: report.checks,
          defaultMode,
          seeThroughMode,
          criticalPageErrors: report.criticalPageErrors,
        }, null, 2));
      }
    }

    const passed = allReports.every((report) => report.passed);
    const reportPath = resolve(REPORTS_DIR, `surface-opacity-mode-${surfaces.join('_')}-${runDate}.json`);
    writeFileSync(reportPath, JSON.stringify({
      passed,
      surfaces,
      reports: allReports,
      timestamp: new Date().toISOString(),
    }, null, 2));
    console.log(`Report: ${reportPath}`);
    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
