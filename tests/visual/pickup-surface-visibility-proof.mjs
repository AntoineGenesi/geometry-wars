#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execSync, spawn } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { delimiter, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEV_PORT = Number(process.env.PICKUP_PROOF_PORT || 3041);
const SERVER_PORT = Number(process.env.PICKUP_PROOF_SERVER_PORT || 2571);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = resolve(ROOT, 'test-screenshots/pickup-surface-visibility-proof', RUN_ID);
const REPORT_PATH = resolve(ROOT, `reports/pickup-surface-visibility-proof-${RUN_ID}.json`);
const MARKDOWN_PATH = resolve(ROOT, `reports/pickup-surface-visibility-proof-${RUN_ID}.md`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function commandPath(command) {
  try {
    return execSync(`command -v ${command}`, { encoding: 'utf8' }).trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

function findCachedChrome() {
  const cacheRoot = resolve(process.env.HOME || '/home/antoine', '.cache/puppeteer/chrome');
  try {
    return readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('linux-'))
      .map((entry) => resolve(cacheRoot, entry.name, 'chrome-linux64/chrome'))
      .filter((path) => existsSync(path))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

function startProcess(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
      PATH: [dirname(process.execPath), process.env.PATH || ''].join(delimiter),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (data) => process.stdout.write(data));
  child.stderr.on('data', (data) => process.stderr.write(data));
  return child;
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // Retry until the bounded timeout.
    }
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPage(page, predicate, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await page.evaluate(predicate).catch(() => false)) return;
    await sleep(300);
  }
  throw new Error('Timed out waiting for page proof API');
}

async function waitFrames(page, frameCount = 4) {
  await page.evaluate((count) => new Promise((resolveFrames) => {
    let remaining = count;
    const tick = () => {
      remaining--;
      if (remaining <= 0) resolveFrames(true);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), frameCount);
}

async function waitForPickupPoses(page, mode, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await page.evaluate((proofMode) => {
      const api = proofMode === 'sp' ? window.__TEST_API : window.__gameDebug;
      const samples = api?.getPickupVisualProofSamples?.() || [];
      return samples.length > 0 && samples.every((sample) =>
        sample.attachedToScene
          && sample.pose?.revision > 0
          && sample.pose.matchesRequestedFrame
      );
    }, mode).catch(() => false);
    if (ready) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${mode.toUpperCase()} pickup surface pose updates`);
}

async function writeCanvasPng(page, path) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    return canvas instanceof HTMLCanvasElement ? canvas.toDataURL('image/png') : '';
  });
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('Canvas PNG capture failed; refusing page screenshot as body proof');
  }
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
}

async function installBackgroundBaseline(page, mode) {
  await page.evaluate((proofMode) => {
    const api = proofMode === 'sp' ? window.__TEST_API : window.__gameDebug;
    api.setPickupVisualProofIsolation('__background__');
  }, mode);
  await waitFrames(page, 6);
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0);
    window.__pickupProofBaseline = context.getImageData(0, 0, copy.width, copy.height).data;
    return { width: copy.width, height: copy.height };
  });
}

async function collectIsolatedSample(page, mode, scenarioName, pickup) {
  const isolation = await page.evaluate(({ proofMode, pickupId }) => {
    const api = proofMode === 'sp' ? window.__TEST_API : window.__gameDebug;
    return api.setPickupVisualProofIsolation(pickupId);
  }, { proofMode: mode, pickupId: pickup.id });
  await waitFrames(page, 6);

  const sample = await page.evaluate(({ proofMode, pickupId }) => {
    const api = proofMode === 'sp' ? window.__TEST_API : window.__gameDebug;
    return api.getPickupVisualProofSamples().find((candidate) => candidate.id === pickupId) || null;
  }, { proofMode: mode, pickupId: pickup.id });

  const pixels = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const context = copy.getContext('2d', { willReadFrequently: true });
    context.drawImage(canvas, 0, 0);
    const current = context.getImageData(0, 0, copy.width, copy.height).data;
    const baseline = window.__pickupProofBaseline;
    let bodyPixels = 0;
    let strongPixels = 0;
    let maxDelta = 0;
    let minX = copy.width;
    let minY = copy.height;
    let maxX = -1;
    let maxY = -1;
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < current.length; i += 4) {
      const delta = Math.max(
        Math.abs(current[i] - baseline[i]),
        Math.abs(current[i + 1] - baseline[i + 1]),
        Math.abs(current[i + 2] - baseline[i + 2]),
      );
      maxDelta = Math.max(maxDelta, delta);
      if (delta < 14) continue;
      const pixelIndex = i / 4;
      const x = pixelIndex % copy.width;
      const y = Math.floor(pixelIndex / copy.width);
      bodyPixels++;
      if (delta >= 40) strongPixels++;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
    }
    const width = bodyPixels > 0 ? maxX - minX + 1 : 0;
    const height = bodyPixels > 0 ? maxY - minY + 1 : 0;
    const aspectRatio = Math.min(width, height) > 0
      ? Math.max(width, height) / Math.min(width, height)
      : Number.POSITIVE_INFINITY;
    return {
      canvas: { width: copy.width, height: copy.height },
      bodyPixels,
      strongPixels,
      maxDelta,
      bounds: { minX, minY, maxX, maxY, width, height },
      aspectRatio,
      centroid: bodyPixels > 0 ? { x: sumX / bodyPixels, y: sumY / bodyPixels } : null,
      nonLineFootprint: bodyPixels >= 20 && width >= 8 && height >= 8 && aspectRatio <= 3.5,
    };
  });

  const screenshot = resolve(SCREENSHOT_DIR, `${scenarioName}-${pickup.type}.png`);
  await writeCanvasPng(page, screenshot);
  const expectedShape = sample && sample.body.meshCount > 0
    && sample.body.size.every((axis) => Number.isFinite(axis) && axis > 0.005);
  const iconCoreContract = sample && (
    pickup.type === 'weapon' || pickup.type === 'stack-buff'
      ? sample.body.hasCore && sample.body.hasIcon
      : pickup.type === 'buff' || pickup.type === 'companion'
        ? sample.body.hasCore
        : sample.body.meshCount >= 2
  );
  const expectedCentroid = sample ? {
    x: (sample.projected.x + 1) * pixels.canvas.width / 2,
    y: (1 - sample.projected.y) * pixels.canvas.height / 2,
  } : null;
  const centroidError = expectedCentroid && pixels.centroid
    ? Math.hypot(pixels.centroid.x - expectedCentroid.x, pixels.centroid.y - expectedCentroid.y)
    : Number.POSITIVE_INFINITY;
  const projectedOriginInBodyBounds = Boolean(
    expectedCentroid
      && pixels.bodyPixels > 0
      && expectedCentroid.x >= pixels.bounds.minX - 4
      && expectedCentroid.x <= pixels.bounds.maxX + 4
      && expectedCentroid.y >= pixels.bounds.minY - 4
      && expectedCentroid.y <= pixels.bounds.maxY + 4
  );
  const passed = Boolean(
    isolation?.isolated
      && sample?.matrixFinite
      && Number.isFinite(sample.determinant)
      && sample.determinant > 0
      && sample.matrixScale.every((axis) => Number.isFinite(axis) && axis > 0.005)
      && sample.attachedToScene
      && sample.pose.revision > 0
      && sample.pose.matchesRequestedFrame
      && sample.projected.inView
      && sample.visibilityClass
      && typeof sample.bodyVisibility === 'number'
      && sample.bodyVisibility > 0
      && sample.indicatorVisible === false
      && expectedShape
      && iconCoreContract
      && pixels.nonLineFootprint
      && pixels.strongPixels >= 3
      && projectedOriginInBodyBounds
  );

  return {
    ...pickup,
    passed,
    isolation,
    sample,
    pixels,
    expectedCentroid,
    centroidError,
    projectedOriginInBodyBounds,
    screenshot,
  };
}

async function runScenario(page, { mode, surface, name, url }) {
  const pageErrors = [];
  const consoleErrors = [];
  const onPageError = (error) => pageErrors.push(error.message);
  const onConsole = (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  if (mode === 'sp') {
    await waitForPage(page, () => Boolean(window.__TEST_API?.spawnPickupVisualProofSet));
    await page.evaluate(() => {
      window.__TEST_API.setPlayerPosition(0.125, 0.5);
      window.__TEST_API.spawnPickupVisualProofSet(0.125, 0.54);
    });
  } else {
    await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()));
    for (let attempt = 0; attempt < 10; attempt++) {
      const clicked = await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll('button')).find((candidate) => {
          const text = (candidate.textContent || '').trim();
          const visible = candidate.offsetParent !== null || getComputedStyle(candidate).display !== 'none';
          return visible && (text.includes('START GAME') || text.includes('PLAY AGAIN'));
        });
        if (!button) return false;
        button.click();
        return true;
      });
      if (clicked) break;
      await sleep(700);
    }
    await waitForPage(page, () => Boolean(
      window.__gameDebug?.spawnPickupVisualProofSet
        && window.__GAME_TELEMETRY?.waveNumber >= 1
    ), 30000);
    await page.evaluate(() => window.__gameDebug.spawnPickupVisualProofSet());
  }

  await waitForPickupPoses(page, mode);
  await waitFrames(page, 8);
  const pickups = await page.evaluate((proofMode) => {
    const api = proofMode === 'sp' ? window.__TEST_API : window.__gameDebug;
    return api.getPickupVisualProofSamples().map(({ id, type }) => ({ id, type }));
  }, mode);

  const composedScreenshot = resolve(SCREENSHOT_DIR, `${name}-composed.png`);
  await page.screenshot({ path: composedScreenshot });
  const baseline = await installBackgroundBaseline(page, mode);
  const samples = [];
  for (const pickup of pickups) {
    samples.push(await collectIsolatedSample(page, mode, name, pickup));
  }
  await page.evaluate((proofMode) => {
    const api = proofMode === 'sp' ? window.__TEST_API : window.__gameDebug;
    api.setPickupVisualProofIsolation(null);
  }, mode);

  page.off('pageerror', onPageError);
  page.off('console', onConsole);
  const criticalErrors = [...pageErrors, ...consoleErrors].filter((message) =>
    !/AudioContext|favicon|No available adapters|WebGPU|Failed to load resource|WebSocket/i.test(message));
  return {
    name,
    mode,
    surface,
    path: mode === 'sp'
      ? 'index.html -> src/main.ts -> src/core/GameLoop.ts -> src/core/RenderLoop.ts'
      : 'index.html?mode=network -> src/network-main.ts -> Colyseus GameRoom',
    url,
    baseline,
    pickupCount: pickups.length,
    passed: samples.length > 0 && samples.every((sample) => sample.passed) && criticalErrors.length === 0,
    samples,
    composedScreenshot,
    pageErrors,
    consoleErrors,
    criticalErrors,
  };
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const ownedProcesses = [];
  let browser;
  let profileDir;
  try {
    ownedProcesses.push(startProcess([
      'node_modules/vite/bin/vite.js',
      '--host', '127.0.0.1',
      '--port', String(DEV_PORT),
    ]));
    await waitForHttp(`http://127.0.0.1:${DEV_PORT}`);

    const chrome = [
      process.env.CHROME_PATH,
      commandPath('google-chrome'),
      commandPath('chromium'),
      ...findCachedChrome(),
    ].filter(Boolean).find((candidate) => existsSync(candidate));
    if (!chrome) throw new Error('No Chrome executable found');
    profileDir = mkdtempSync(resolve(tmpdir(), 'gw-pickup-proof-'));
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      userDataDir: profileDir,
      args: [
        '--enable-webgl',
        '--use-gl=swiftshader',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=960,720',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 720 });

    const common = 'quickStart=true&seed=424242&debug=true&testMode=true&renderer=webgl2&music=false&godMode=true';
    const scenarios = [];
    scenarios.push(await runScenario(page, {
      mode: 'sp',
      surface: 'cube',
      name: 'sp-cube',
      url: `http://127.0.0.1:${DEV_PORT}/?${common}&surface=cube`,
    }));
    scenarios.push(await runScenario(page, {
      mode: 'sp',
      surface: 'torus',
      name: 'sp-torus',
      url: `http://127.0.0.1:${DEV_PORT}/?${common}&surface=torus`,
    }));

    ownedProcesses.push(startProcess(
      ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
      { PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0' },
    ));
    await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`);
    const mpParams = new URLSearchParams({
      mode: 'network',
      surface: 'cube',
      server: `ws://127.0.0.1:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      renderer: 'webgl',
      godMode: 'true',
      name: 'PickupProofSolo',
      creator: '1',
      gameMode: 'pvpve',
      pvpMode: 'pvpve',
    });
    scenarios.push(await runScenario(page, {
      mode: 'mp',
      surface: 'cube',
      name: 'solo-mp-cube',
      url: `http://127.0.0.1:${DEV_PORT}/?${mpParams.toString()}`,
    }));

    const report = {
      kind: 'pickup-surface-orientation-visibility-proof',
      runId: RUN_ID,
      renderer: 'Linux headless Chrome WebGL2/SwiftShader',
      browser: { executablePath: chrome, viewport: { width: 960, height: 720 } },
      ports: { vite: DEV_PORT, colyseus: SERVER_PORT },
      bodyProofExclusions: [
        'spawn indicators hidden by proof controller',
        'surface/grid/player/enemies/particles/under-effects hidden at scene roots',
        'canvas-only PNG and baseline-difference metrics; HUD/minimap DOM excluded',
      ],
      claimBoundary: 'Deterministic Linux WebGL2 SP and solo-MP proof; not Windows hardware WebGPU or two-client LAN proof.',
      passed: scenarios.every((scenario) => scenario.passed),
      scenarios,
    };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    const markdown = [
      '# Pickup Surface Orientation And Visibility Proof',
      '',
      `- Run: \`${RUN_ID}\``,
      `- Result: **${report.passed ? 'PASS' : 'FAIL'}**`,
      `- Renderer: ${report.renderer}`,
      `- Claim boundary: ${report.claimBoundary}`,
      '',
      '| Scenario | Pickups | Passed |',
      '| --- | ---: | --- |',
      ...scenarios.map((scenario) => `| ${scenario.name} | ${scenario.pickupCount} | ${scenario.passed ? 'PASS' : 'FAIL'} |`),
      '',
      `JSON report: \`${REPORT_PATH}\``,
      `Screenshots: \`${SCREENSHOT_DIR}\``,
    ].join('\n');
    writeFileSync(MARKDOWN_PATH, markdown);
    console.log(JSON.stringify({
      passed: report.passed,
      reportPath: REPORT_PATH,
      markdownPath: MARKDOWN_PATH,
      screenshotDir: SCREENSHOT_DIR,
      scenarios: scenarios.map((scenario) => ({
        name: scenario.name,
        passed: scenario.passed,
        pickupCount: scenario.pickupCount,
        failures: scenario.samples.filter((sample) => !sample.passed).map((sample) => ({
          id: sample.id,
          pixels: sample.pixels,
          sample: sample.sample,
        })),
        criticalErrors: scenario.criticalErrors,
      })),
    }, null, 2));
    if (!report.passed) process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    for (const child of ownedProcesses.reverse()) child.kill('SIGTERM');
    if (profileDir) rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
