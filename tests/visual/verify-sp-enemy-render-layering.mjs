#!/usr/bin/env node
/**
 * Targeted SP proof for enemy body/trail render layering.
 *
 * Checks the real single-player path (`src/main.ts -> GameLoop.ts`):
 * - enemy body instance batches render before the surface grid overlay;
 * - fast-enemy GlowTrail lines render before the grid and use depth testing;
 * - materializing fast enemies do not create detached trails before their body appears;
 * - spawned enemies have valid render slots and non-zero visible body state.
 */

import puppeteer from 'puppeteer';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3033';
const CHROME_PATH = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
const REPORTS_DIR = resolve(__dirname, '../../reports');
const SCREENSHOT_DIR = resolve(__dirname, '../../test-screenshots/sp-enemy-render-layering');
const args = process.argv.slice(2);
const surface = args.find((arg) => arg.startsWith('--surface='))?.split('=')[1] || 'sphere-tunnel';
const runDate = new Date().toISOString().replace(/[:.]/g, '-');

const LAUNCH_ARGS = [
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
];

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const repoRelative = (path) => path.replace(resolve(__dirname, '../..') + '/', '');

function collectLayerInfoInPage() {
  const api = window.__TEST_API;
  const ctx = api?.ctx;
  const scene = ctx?.game?.scene;
  if (!api || !ctx || !scene) {
    return { apiReady: false };
  }

  const materialList = (object) => {
    const material = object.material;
    if (!material) return [];
    return Array.isArray(material) ? material : [material];
  };
  const firstMaterial = (object) => materialList(object)[0] || null;
  const gridOrder = ctx.surface.gridMesh.renderOrder;
  const surfaceOrder = ctx.surface.mesh.renderOrder;
  const bodyBatches = [];
  const trailRoots = [];
  const trailLines = [];

  scene.traverse((object) => {
    if (object.name?.startsWith('instanced-') || object.name === 'lod-medium' || object.name === 'lod-low') {
      const material = firstMaterial(object);
      bodyBatches.push({
        name: object.name,
        count: object.count ?? null,
        renderOrder: object.renderOrder,
        depthTest: material?.depthTest ?? null,
        depthWrite: material?.depthWrite ?? null,
        transparent: material?.transparent ?? null,
      });
    }
    if (object.name === 'sp-enemy-glow-trail') {
      trailRoots.push({ childCount: object.children.length });
    }
    if (object.parent?.name === 'sp-enemy-glow-trail') {
      const material = firstMaterial(object);
      trailLines.push({
        type: object.type,
        renderOrder: object.renderOrder,
        depthTest: material?.depthTest ?? null,
        depthWrite: material?.depthWrite ?? null,
        transparent: material?.transparent ?? null,
      });
    }
  });

  const enemies = api.getEnemies();
  const activeNonMaterializing = enemies.filter((enemy) => enemy.alive && !enemy.isMaterializing);
  const badEnemyRenderState = activeNonMaterializing.filter((enemy) => (
    enemy.renderSlotFound === false
    || enemy.renderSlotDrawn === false
    || enemy.instanceMatrixScale <= 0.001
    || enemy.instanceColorBrightness < 0.10
  ));

  return {
    apiReady: true,
    backend: ctx.game.backend,
    isWebGPU: ctx.game.isWebGPU,
    surfaceType: String(ctx.surfaceType),
    surfaceOrder,
    gridOrder,
    bodyBatches,
    trailRoots,
    trailLines,
    enemyCount: enemies.length,
    activeNonMaterializingCount: activeNonMaterializing.length,
    badEnemyRenderState,
  };
}

async function main() {
  mkdirSync(REPORTS_DIR, { recursive: true });
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const launchOptions = {
    headless: 'new',
    args: LAUNCH_ARGS,
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
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => {
      try {
        localStorage.removeItem('masteryOverlayShown');
        localStorage.removeItem('weaponMastery');
        localStorage.setItem('gw3d-graphics-settings', JSON.stringify({
          surfaceOpaque: false,
          surfaceOpacity: 0.05,
          surfaceVisibilityPreferenceVersion: 2,
        }));
      } catch (_) {}
    });

    const url = `${BASE_URL}?quickStart=true&surface=${surface}&debug=true&testMode=true`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });
    await sleep(3000);

    const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (!apiReady) throw new Error('__TEST_API unavailable in testMode');

    await page.evaluate(() => window.__TEST_API.clearEnemies());
    await sleep(500);

    await page.evaluate(() => {
      const ctx = window.__TEST_API.ctx;
      ctx.enemySpawner.spawn('mayfly', 0.48, 0.48, 0, false);
    });
    await sleep(250);
    const materializingLayerInfo = await page.evaluate(collectLayerInfoInPage);
    const materializingScreenshot = resolve(SCREENSHOT_DIR, `${surface}-materializing-${runDate}.png`);
    await page.screenshot({ path: materializingScreenshot, fullPage: false });

    await sleep(1100);
    const afterMaterializeLayerInfo = await page.evaluate(collectLayerInfoInPage);

    await page.evaluate(() => window.__TEST_API.clearEnemies());
    await sleep(500);
    for (let group = 0; group < 3; group++) {
      await page.evaluate((groupIndex) => {
        const ctx = window.__TEST_API.ctx;
        const enemyTypes = ['mayfly', 'rocket', 'duck', 'grunt', 'phaser'];
        for (let i = 0; i < 10; i++) {
          const u = ((i + 0.5) / 10 + groupIndex * 0.07) % 1;
          const v = 0.22 + groupIndex * 0.22;
          ctx.enemySpawner.spawn(enemyTypes[i % enemyTypes.length], u, v, 0, false);
        }
      }, group);
      await sleep(950);
    }
    await sleep(900);
    const naturalWarningGroupInfo = await page.evaluate(collectLayerInfoInPage);
    const naturalWarningScreenshot = resolve(SCREENSHOT_DIR, `${surface}-natural-warning-groups-${runDate}.png`);
    await page.screenshot({ path: naturalWarningScreenshot, fullPage: false });

    await page.evaluate(() => window.__TEST_API.clearEnemies());
    await sleep(500);
    await page.evaluate(() => {
      const api = window.__TEST_API;
      const enemyTypes = ['mayfly', 'rocket', 'duck', 'grunt', 'phaser'];
      const cols = 10;
      const rows = 7;
      for (let i = 0; i < cols * rows; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const u = (col + 0.5) / cols;
        const v = (row + 0.5) / rows;
        api.spawnEnemy(enemyTypes[i % enemyTypes.length], u, v);
      }
    });
    await sleep(3500);
    const gridLayerInfo = await page.evaluate(collectLayerInfoInPage);
    const gridScreenshot = resolve(SCREENSHOT_DIR, `${surface}-grid-${runDate}.png`);
    await page.screenshot({ path: gridScreenshot, fullPage: false });

    const bodyBatchViolations = gridLayerInfo.bodyBatches.filter((batch) => (
      batch.renderOrder >= gridLayerInfo.gridOrder
      || batch.depthTest !== true
      || batch.depthWrite !== true
    ));
    const trailLayerViolations = gridLayerInfo.trailLines.filter((line) => (
      line.renderOrder >= gridLayerInfo.gridOrder
      || line.depthTest !== true
      || line.depthWrite !== false
    ));

    const criticalPageErrors = pageErrors.filter((error) => !/Failed to load resource: the server responded with a status of 404/.test(error));
    const checks = {
      materializingFastEnemyHasNoTrail: materializingLayerInfo.trailRoots.length === 0,
      fastEnemyTrailReturnsAfterMaterialization: afterMaterializeLayerInfo.trailRoots.length > 0,
      naturalThirdWarningGroupHasNoBadRenderState: naturalWarningGroupInfo.badEnemyRenderState.length === 0,
      naturalWarningGroupsSampled: naturalWarningGroupInfo.activeNonMaterializingCount >= 25,
      bodyBatchesBeforeGrid: bodyBatchViolations.length === 0,
      trailLinesBeforeGridAndDepthTested: trailLayerViolations.length === 0,
      noBadEnemyRenderState: gridLayerInfo.badEnemyRenderState.length === 0,
      enoughEnemiesSampled: gridLayerInfo.activeNonMaterializingCount >= 60,
      noCriticalPageErrors: criticalPageErrors.length === 0,
    };
    const passed = Object.values(checks).every(Boolean);

    const report = {
      passed,
      checks,
      surface,
      url,
      screenshots: {
        materializing: repoRelative(materializingScreenshot),
        naturalWarningGroups: repoRelative(naturalWarningScreenshot),
        grid: repoRelative(gridScreenshot),
      },
      materializingLayerInfo,
      afterMaterializeLayerInfo,
      naturalWarningGroupInfo,
      gridLayerInfo,
      bodyBatchViolations,
      trailLayerViolations,
      pageErrors,
      criticalPageErrors,
      timestamp: new Date().toISOString(),
    };

    const reportPath = resolve(REPORTS_DIR, `sp-enemy-render-layering-${surface}-${runDate}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(`${passed ? 'PASS' : 'FAIL'} ${surface}`);
    console.log(`Report: ${reportPath}`);
    console.log(`Screenshots: ${materializingScreenshot}, ${gridScreenshot}`);
    if (!passed) {
      console.log(JSON.stringify({ checks, bodyBatchViolations, trailLayerViolations, badEnemyRenderState: gridLayerInfo.badEnemyRenderState, pageErrors }, null, 2));
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
