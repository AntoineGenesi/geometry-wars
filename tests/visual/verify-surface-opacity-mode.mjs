#!/usr/bin/env node
/**
 * Live SP proof for the surface visibility mode setting.
 *
 * Verifies the real single-player path:
 * - default/legacy graphics settings make surfaces opaque;
 * - far-side enemies are intentionally hidden in opaque mode;
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
const surface = process.argv.find((arg) => arg.startsWith('--surface='))?.split('=')[1] || 'cube';
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

async function runMode(page, mode) {
  await configureStorage(page, mode);
  const url = `${BASE_URL}?quickStart=true&surface=${surface}&debug=true&testMode=true`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await sleep(3000);

  const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
  if (!apiReady) throw new Error('__TEST_API unavailable in testMode');

  const ids = await page.evaluate(() => {
    const api = window.__TEST_API;
    api.clearEnemies();
    api.setPlayerPosition(0.125, 0.5);
    return {
      firstId: api.spawnEnemy('grunt', 0.125, 0.62),
      secondId: api.spawnEnemy('grunt', 0.625, 0.5),
    };
  });
  await sleep(2000);

  return page.evaluate(({ firstId, secondId, selectedMode }) => {
    const api = window.__TEST_API;
    const ctx = api.ctx;
    const material = ctx.surface.mesh.material;
    const enemies = api.getEnemies();
    const rawEnemies = ctx.enemySpawner.getEnemies().map((enemy) => ({
      id: enemy.__testId,
      className: enemy.__surfaceVisibility?.className ?? null,
      visibility: enemy.__surfaceVisibility?.visibility ?? null,
      occluded: enemy.__surfaceVisibility?.occluded ?? null,
    }));
    const spawnedIds = [firstId, secondId];
    const spawned = spawnedIds.map((id) => ({
      id,
      enemy: enemies.find((candidate) => candidate.id === id) ?? null,
      raw: rawEnemies.find((candidate) => candidate.id === id) ?? null,
    }));

    return {
      mode: selectedMode,
      backend: ctx.game.backend,
      isWebGPU: ctx.game.isWebGPU,
      surfaceOpacity: material.opacity,
      surfaceTransparent: material.transparent,
      spawned,
    };
  }, { ...ids, selectedMode: mode });
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
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });

  try {
    const defaultMode = await runMode(page, 'default');
    const seeThroughMode = await runMode(page, 'see-through');
    const criticalPageErrors = pageErrors.filter((error) => !/Failed to load resource: the server responded with a status of 404/.test(error));
    const checks = {
      defaultSurfaceOpaque: defaultMode.surfaceOpacity === 1,
      defaultDirectEnemyVisible: defaultMode.spawned.some(({ enemy, raw }) => (
        raw?.className === 'direct'
        && (enemy?.opacity ?? 0) > 0
        && (enemy?.instanceColorBrightness ?? 0) > 0.3
      )),
      defaultOccludedEnemyHidden: defaultMode.spawned.some(({ enemy, raw }) => (
        raw?.className === 'opaque-hidden'
        && (enemy?.opacity ?? 1) === 0
      )),
      seeThroughSurfaceReadable: seeThroughMode.surfaceOpacity === 0.05,
      seeThroughNoOpaqueHidden: seeThroughMode.spawned.every(({ raw }) => raw?.className !== 'opaque-hidden'),
      seeThroughOccludedEnemyDimReadable: seeThroughMode.spawned.some(({ enemy, raw }) => (
        raw?.className !== 'direct'
        && (enemy?.opacity ?? 0) > 0
        && (enemy?.instanceColorBrightness ?? 0) >= 0.3
      )),
      noCriticalPageErrors: criticalPageErrors.length === 0,
    };
    const passed = Object.values(checks).every(Boolean);
    const report = {
      passed,
      checks,
      surface,
      defaultMode,
      seeThroughMode,
      pageErrors,
      criticalPageErrors,
      timestamp: new Date().toISOString(),
    };
    const reportPath = resolve(REPORTS_DIR, `surface-opacity-mode-${surface}-${runDate}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`${passed ? 'PASS' : 'FAIL'} ${surface}`);
    console.log(`Report: ${reportPath}`);
    if (!passed) {
      console.log(JSON.stringify({ checks, defaultMode, seeThroughMode, criticalPageErrors }, null, 2));
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
