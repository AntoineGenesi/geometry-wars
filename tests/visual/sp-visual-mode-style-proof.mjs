#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { createHash } from 'crypto';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const DEV_PORT = Number(getArg('port', process.env.DEV_PORT || '3035'));
const SURFACE = getArg('surface', 'torus');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const reportJsonPath = resolve(ROOT, 'reports', `sp-visual-mode-style-proof-${SURFACE}-${runId}.json`);
const reportMdPath = resolve(ROOT, 'reports', `sp-visual-mode-style-proof-${SURFACE}-${runId}.md`);
const screenshotDir = resolve(ROOT, 'test-screenshots/sp-visual-mode-style-proof', `${SURFACE}-${runId}`);
const sharedParentRoot = resolve(ROOT, '../../..');
const modes = ['modern', 'pixelated', 'crt', 'desktop-defender'];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function getArg(name, fallback = '') {
  for (const arg of args) {
    if (arg.startsWith(`--${name}=`)) return arg.slice(name.length + 3);
  }
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function commandPath(command) {
  try {
    return execFileSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function findChrome() {
  const cacheRoot = resolve(process.env.HOME || '/home/antoine', '.cache/puppeteer/chrome');
  let cached = [];
  try {
    cached = readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('linux-'))
      .map((entry) => resolve(cacheRoot, entry.name, 'chrome-linux64/chrome'))
      .sort()
      .reverse();
  } catch {
    // System Chrome remains a valid fallback.
  }
  return [
    process.env.CHROME_PATH,
    commandPath('google-chrome'),
    commandPath('chromium'),
    ...cached,
  ].filter(Boolean).find((candidate) => existsSync(candidate));
}

function projectToolPath(relativeToolPath) {
  return [ROOT, sharedParentRoot]
    .map((root) => resolve(root, relativeToolPath))
    .find((candidate) => existsSync(candidate));
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // Retry.
    }
    await sleep(350);
  }
  return false;
}

async function waitForPage(page, predicate, timeoutMs = 30000, argument = undefined) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await page.evaluate(predicate, argument).catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  return null;
}

function startProcess(nodeArgs, env, logs) {
  const child = spawn(process.execPath, nodeArgs, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const capture = (stream, source) => stream.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      if (!line.trim()) continue;
      logs.push(`[${source}] ${line}`);
      if (logs.length > 500) logs.shift();
    }
  });
  capture(child.stdout, 'vite');
  capture(child.stderr, 'vite-error');
  return child;
}

async function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already exited.
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  await sleep(400);
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Graceful shutdown completed.
  }
}

function criticalErrors(errors) {
  return errors.filter((message) =>
    !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated/i.test(message));
}

function screenshotHash(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function captureMode(browser, baseUrl, mode, errors) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (error) => errors.push(`[${mode}] pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      errors.push(`[${mode}] ${message.type()}: ${message.text()}`);
    }
  });
  await page.evaluateOnNewDocument((visualMode) => {
    localStorage.setItem('gw3d-visual-mode', visualMode);
    localStorage.removeItem('gw3d-visual-style');
  }, mode);
  const url = `${baseUrl}/?testArena=true&testMode=true&renderer=webgl2&surface=${encodeURIComponent(SURFACE)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await waitForPage(page, () => {
    const api = window.__TEST_API;
    return Boolean(api && typeof api.getGameState === 'function' && api.getGameState().enemies > 0);
  }, 30000);
  await sleep(1200);

  const beforeToggle = await page.evaluate(() => {
    const debug = window.__gameDebug;
    const ctx = debug?.ctx;
    const game = debug?.game;
    const surface = ctx?.surface;
    const gridMat = surface?.gridMesh?.material;
    const surfaceMat = surface?.mesh?.material;
    const telemetry = window.__GAME_TELEMETRY;
    const enemies = telemetry?.enemies ?? [];
    return {
      mode: localStorage.getItem('gw3d-visual-mode'),
      savedStyle: localStorage.getItem('gw3d-visual-style'),
      gameState: window.__TEST_API?.getGameState?.() ?? null,
      sceneBackground: game?.scene?.background?.getHex?.() ?? null,
      bloom: {
        strength: game?.bloomPass?.strength ?? null,
        threshold: game?.bloomPass?.threshold ?? null,
        radius: game?.bloomPass?.radius ?? null,
        resolutionScale: game?.bloomResolutionScale ?? null,
      },
      surface: {
        visible: surface?.mesh?.visible ?? null,
        color: surfaceMat?.color?.getHex?.() ?? null,
        opacity: surfaceMat?.opacity ?? null,
        transparent: surfaceMat?.transparent ?? null,
        depthWrite: surfaceMat?.depthWrite ?? null,
      },
      grid: {
        color: gridMat?.color?.getHex?.() ?? null,
        opacity: gridMat?.opacity ?? null,
        transparent: gridMat?.transparent ?? null,
      },
      telemetry: {
        enemyCount: enemies.length,
        aliveEnemies: enemies.filter((enemy) => enemy.isAlive !== false).length,
        visibleCandidates: enemies.filter((enemy) =>
          enemy.isAlive !== false && !enemy.materializing && (enemy.opacity ?? 0) > 0.03).length,
      },
    };
  });

  const fireProbe = await page.evaluate(() => {
    const api = window.__TEST_API;
    api?.forceEquipWeapon?.('standard', 999);
    return api?.fireWeapon?.() ?? null;
  });
  const bulletProofProbe = await page.evaluate(() => {
    const ctx = window.__gameDebug?.ctx;
    const manager = ctx?.bulletInstanceManager;
    const camera = ctx?.game?.camera;
    const target = ctx?.player?.mesh?.position;
    if (!manager || !camera || !target) return { added: false, reason: 'missing renderer context' };

    const Vector3 = camera.position.constructor;
    const forward = target.clone().sub(camera.position).normalize();
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    const up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    const center = camera.position.clone().add(forward.multiplyScalar(5));
    const direction = up.clone();
    const ids = [];
    const offsets = [-0.42, 0, 0.42];
    for (let i = 0; i < offsets.length; i += 1) {
      const standardId = `proof-standard-${i}`;
      const spreadId = `proof-spread-${i}`;
      manager.addBullet(standardId, 'standard', center.clone().add(right.clone().multiplyScalar(offsets[i])).add(up.clone().multiplyScalar(0.24)), direction);
      manager.addBullet(spreadId, 'spread', center.clone().add(right.clone().multiplyScalar(offsets[i])).add(up.clone().multiplyScalar(-0.24)), direction);
      ids.push(standardId, spreadId);
    }
    manager.update();
    return {
      added: true,
      ids,
      activeCount: manager.activeCount,
      stats: manager.getStats?.() ?? null,
    };
  });
  await sleep(300);

  const bulletPixelProbe = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { canvasPresent: false, warmBulletPixels: 0, pinkBulletPixels: 0, activeBullets: null };
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx2d = copy.getContext('2d', { willReadFrequently: true });
    if (!ctx2d) return { canvasPresent: true, warmBulletPixels: 0, pinkBulletPixels: 0, activeBullets: null };
    ctx2d.drawImage(canvas, 0, 0);
    const data = ctx2d.getImageData(0, 0, copy.width, copy.height).data;
    let warmBulletPixels = 0;
    let pinkBulletPixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r > 210 && g > 145 && b < 150) warmBulletPixels += 1;
      if (r > 210 && g < 150 && b > 120) pinkBulletPixels += 1;
    }
    return {
      canvasPresent: true,
      warmBulletPixels,
      pinkBulletPixels,
      activeBullets: window.__gameDebug?.ctx?.bulletPool?.activeCount ?? null,
    };
  });

  const gameplayScreenshotPath = resolve(screenshotDir, `${mode}-gameplay.png`);
  await page.screenshot({ path: gameplayScreenshotPath });
  const gameplayHash = screenshotHash(gameplayScreenshotPath);

  await page.keyboard.press('Escape');
  await waitForPage(page, () => !document.querySelector('#pause-menu.hidden'), 10000);
  await page.addStyleTag({
    content: '#test-arena-hud, #debug-overlay, #profiling-overlay, .debug-overlay, .profiling-overlay { display: none !important; }',
  });
  const pauseCommands = await page.evaluate(() => Array.from(document.querySelectorAll('#pause-menu .pause-btn'))
    .map((button) => ({
      action: button.getAttribute('data-action'),
      text: button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    })));
  const pauseScreenshotPath = resolve(screenshotDir, `${mode}-pause.png`);
  await page.screenshot({ path: pauseScreenshotPath });
  const pauseHash = screenshotHash(pauseScreenshotPath);

  const nextMode = {
    modern: 'pixelated',
    pixelated: 'crt',
    crt: 'desktop-defender',
    'desktop-defender': 'modern',
  }[mode];
  const pauseStyleToggleProbe = await page.evaluate(async (expectedNextMode) => {
    const button = document.querySelector('#pause-menu [data-action="visual-mode"]');
    if (!button) return { buttonPresent: false };
    const beforeText = button.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    button.click();
    await new Promise((resolveDone) => setTimeout(resolveDone, 250));
    return {
      buttonPresent: true,
      beforeText,
      afterText: button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      storedMode: localStorage.getItem('gw3d-visual-mode'),
      expectedNextMode,
    };
  }, nextMode);
  await page.close();

  return {
    mode,
    screenshots: {
      gameplay: relative(ROOT, gameplayScreenshotPath),
      pause: relative(ROOT, pauseScreenshotPath),
    },
    screenshotSha256: {
      gameplay: gameplayHash,
      pause: pauseHash,
    },
    pauseCommands,
    pauseStyleToggleProbe,
    fireProbe,
    bulletProofProbe,
    bulletPixelProbe,
    state: beforeToggle,
    checks: {
      modePersisted: beforeToggle.mode === mode,
      noExplicitSavedStyle: beforeToggle.savedStyle === null,
      enemiesPresent: (beforeToggle.telemetry?.enemyCount ?? 0) > 0,
      visibleEnemyCandidates: (beforeToggle.telemetry?.visibleCandidates ?? 0) > 0,
      settingsCommandPresent: pauseCommands.some((command) => command.action === 'settings'),
      quickStyleCommandPresent: pauseCommands.some((command) =>
        command.action === 'visual-mode'
        && /STYLE:/i.test(command.text)),
      noPauseMapStylesGalleryCommand: !pauseCommands.some((command) =>
        command.action === 'open-styles-gallery'
        || /visual styles/i.test(command.text)
        || /map styles/i.test(command.text)),
      quickStyleToggleLive: pauseStyleToggleProbe.buttonPresent === true
        && pauseStyleToggleProbe.storedMode === nextMode
        && /STYLE:/i.test(pauseStyleToggleProbe.afterText ?? ''),
      bulletFired: fireProbe?.firedSignal === true,
      proofBulletsAdded: bulletProofProbe?.added === true,
      warmBulletPixelsPresent: (bulletPixelProbe?.warmBulletPixels ?? 0) > 8,
      pinkBulletPixelsPresent: (bulletPixelProbe?.pinkBulletPixels ?? 0) > 8,
    },
  };
}

async function captureMobilePause(browser, baseUrl, errors) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('pageerror', (error) => errors.push(`[pause-mobile] pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      errors.push(`[pause-mobile] ${message.type()}: ${message.text()}`);
    }
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('gw3d-visual-mode', 'modern');
    localStorage.removeItem('gw3d-visual-style');
  });
  await page.goto(`${baseUrl}/?testArena=true&testMode=true&renderer=webgl2&surface=${encodeURIComponent(SURFACE)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await waitForPage(page, () => Boolean(window.__TEST_API?.getGameState), 30000);
  await sleep(900);
  await page.keyboard.press('Escape');
  await waitForPage(page, () => !document.querySelector('#pause-menu.hidden'), 10000);
  await page.addStyleTag({
    content: '#test-arena-hud, #debug-overlay, #profiling-overlay, .debug-overlay, .profiling-overlay { display: none !important; }',
  });
  const commands = await page.evaluate(() => Array.from(document.querySelectorAll('#pause-menu .pause-btn'))
    .map((button) => ({
      action: button.getAttribute('data-action'),
      text: button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    })));
  const screenshotPath = resolve(screenshotDir, 'pause-mobile-modern.png');
  await page.screenshot({ path: screenshotPath });
  await page.close();
  return {
    screenshot: relative(ROOT, screenshotPath),
    commands,
    checks: {
      quickStyleCommandPresent: commands.some((command) =>
        command.action === 'visual-mode'
        && /STYLE:/i.test(command.text)),
      noPauseMapStylesGalleryCommand: !commands.some((command) =>
        command.action === 'open-styles-gallery'
        || /visual styles/i.test(command.text)
        || /map styles/i.test(command.text)),
      settingsCommandPresent: commands.some((command) => command.action === 'settings'),
    },
  };
}

async function openGraphicsSettings(page, baseUrl, viewport) {
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('gw3d-visual-mode', 'modern');
    localStorage.removeItem('gw3d-visual-style');
    localStorage.removeItem('gw3d-grid-brightness');
    localStorage.setItem('gw3d-graphics-settings', JSON.stringify({
      qualityPreset: 'custom',
      bloomEnabled: true,
      bloomStrength: 1,
      particleCount: 2000,
      trailEffects: true,
      maxEnemies: 500,
      resolutionScale: 1,
      surfaceOpaque: true,
      surfaceOpacity: 0.05,
      surfaceColor: 0x101826,
      enable90DegreeHide: false,
      surfaceVisibilityPreferenceVersion: 2,
    }));
  });
  await page.goto(`${baseUrl}/?testArena=true&testMode=true&renderer=webgl2&surface=${encodeURIComponent(SURFACE)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await waitForPage(page, () => Boolean(window.__TEST_API?.getGameState), 30000);
  await sleep(900);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-action="settings"]', { timeout: 10000 });
  await page.click('[data-action="settings"]');
  await page.waitForSelector('#settings-menu:not(.hidden)', { timeout: 10000 });
  await page.click('[data-tab="graphics"]');
  await page.waitForSelector('#visual-style-list .style-item', { timeout: 10000 });
  await page.addStyleTag({
    content: '#test-arena-hud, #debug-overlay, #profiling-overlay, .debug-overlay, .profiling-overlay { display: none !important; }',
  });
}

async function readSettingsMetrics(page) {
  return page.evaluate(() => {
    const list = document.querySelector('#visual-style-list');
    const item = list?.querySelector('.style-item');
    const commands = Array.from(document.querySelectorAll('#pause-menu .pause-btn'))
      .map((button) => ({
        action: button.getAttribute('data-action'),
        text: button.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      }));
    const styleItems = Array.from(document.querySelectorAll('#visual-style-list .style-item'));
    const sectionHeadings = Array.from(document.querySelectorAll('#settings-menu .section-heading'))
      .map((heading) => heading.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    return {
      styleList: list && item ? {
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
        itemHeight: item.getBoundingClientRect().height,
        visibleItems: list.clientHeight / item.getBoundingClientRect().height,
        itemCount: styleItems.length,
        independentlyScrollable: list.scrollHeight > list.clientHeight,
      } : null,
      sectionHeadings,
      pauseCommands: commands,
      graphicsControls: {
        qualityPreset: Boolean(document.querySelector('#quality-preset')),
        bloom: Boolean(document.querySelector('#toggle-bloom')),
        bloomStrength: Boolean(document.querySelector('#bloom-strength')),
        particleCount: Boolean(document.querySelector('#particle-count')),
        trailEffects: Boolean(document.querySelector('#toggle-trails')),
        gridBrightness: Boolean(document.querySelector('#grid-brightness')),
        gridDensity: document.querySelectorAll('[data-grid-density]').length,
        surfaceOpacity: Boolean(document.querySelector('#surface-opacity')),
        surfaceColorSwatches: document.querySelectorAll('[data-surface-color]').length,
        surfaceOpaque: Boolean(document.querySelector('#toggle-surface-opaque')),
        maxEnemies: Boolean(document.querySelector('#max-enemies')),
        resolutionScale: Boolean(document.querySelector('#resolution-scale')),
      },
    };
  });
}

async function runSettingsLiveProbe(browser, baseUrl, errors) {
  const desktopPage = await browser.newPage();
  desktopPage.on('pageerror', (error) => errors.push(`[settings-desktop] pageerror: ${error.message}`));
  desktopPage.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      errors.push(`[settings-desktop] ${message.type()}: ${message.text()}`);
    }
  });
  await openGraphicsSettings(desktopPage, baseUrl, { width: 1280, height: 720 });

  const desktopMetricsBefore = await readSettingsMetrics(desktopPage);
  const desktopSettingsScreenshot = resolve(screenshotDir, 'settings-desktop-graphics.png');
  await desktopPage.screenshot({ path: desktopSettingsScreenshot });

  const liveSequence = [];
  async function readLiveState(label) {
    await sleep(250);
    liveSequence.push(await desktopPage.evaluate((probeLabel) => {
      const ctx = window.__gameDebug?.ctx;
      const surface = ctx?.surface;
      const gridMat = surface?.gridMesh?.material;
      const surfaceMat = surface?.mesh?.material;
      const game = ctx?.game;
      const particles = ctx?.particles;
      const renderer = game?.renderer;
      const canvas = renderer?.domElement;
      return {
        label: probeLabel,
        bloomStrength: game?.bloomPass?.strength ?? null,
        bloomRadius: game?.bloomPass?.radius ?? null,
        bloomResolutionScale: game?.bloomResolutionScale ?? null,
        rendererPixelRatio: renderer?.getPixelRatio?.() ?? null,
        canvasWidth: canvas?.width ?? null,
        canvasClientWidth: canvas?.clientWidth ?? null,
        particleBudget: {
          maxParticlesPerFrame: particles?._maxEmitPerFrame ?? null,
          maxFragmentsPerFrame: particles?._maxFragmentsPerFrame ?? null,
        },
        trailEffects: {
          playerTrailVisible: ctx?.glowTrail?.root?.visible ?? null,
          enemyTrailCount: game?.scene?.children?.filter?.((child) => child.name === 'sp-enemy-glow-trail').length ?? null,
        },
        maxActiveEnemies: ctx?.enemySpawner?.getMaxActiveEnemies?.() ?? null,
        gridOpacity: gridMat?.opacity ?? null,
        stateBaseGridOpacity: ctx?.state?.baseGridOpacity ?? null,
        surfaceOpacity: surfaceMat?.opacity ?? null,
        surfaceColor: surfaceMat?.color?.getHex?.() ?? null,
        surfaceTransparent: surfaceMat?.transparent ?? null,
        surfaceDepthWrite: surfaceMat?.depthWrite ?? null,
        savedGridBrightness: Number(localStorage.getItem('gw3d-grid-brightness')),
        savedGraphics: JSON.parse(localStorage.getItem('gw3d-graphics-settings') || '{}'),
      };
    }, label));
  }

  await readLiveState('initial-solid');
  await desktopPage.click('#toggle-bloom');
  await readLiveState('bloom-off');
  await desktopPage.click('#toggle-bloom');
  await desktopPage.evaluate(() => {
    const slider = document.querySelector('#bloom-strength');
    slider.value = '1.6';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await readLiveState('bloom-strength-16');
  await desktopPage.evaluate(() => {
    const slider = document.querySelector('#particle-count');
    slider.value = '100';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await readLiveState('particle-count-100');
  await desktopPage.click('#toggle-trails');
  await readLiveState('trails-off');
  await desktopPage.evaluate(() => {
    const slider = document.querySelector('#max-enemies');
    slider.value = '50';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await readLiveState('max-enemies-50');
  await desktopPage.evaluate(() => {
    const slider = document.querySelector('#resolution-scale');
    slider.value = '0.5';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await readLiveState('resolution-scale-50');
  await desktopPage.evaluate(() => {
    const slider = document.querySelector('#grid-brightness');
    slider.value = '0.22';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await readLiveState('grid-brightness-22');
  await desktopPage.click('#toggle-surface-opaque');
  await readLiveState('see-through-toggle');
  await desktopPage.evaluate(() => {
    const slider = document.querySelector('#surface-opacity');
    slider.value = '0.35';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await readLiveState('surface-opacity-35');
  await desktopPage.click('[data-surface-color="11065584"]');
  await readLiveState('surface-color-ice-blue');
  await desktopPage.click('#toggle-surface-opaque');
  await readLiveState('solid-toggle');
  await desktopPage.select('#quality-preset', 'low');
  await readLiveState('quality-low');

  const desktopMetricsAfter = await readSettingsMetrics(desktopPage);

  await desktopPage.setViewport({ width: 390, height: 844 });
  await sleep(350);
  await desktopPage.evaluate(() => {
    document.querySelector('#settings-menu .tab-content')?.scrollTo(0, 0);
    document.querySelector('#settings-menu .settings-content')?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  });
  await sleep(100);
  const mobileMetrics = await readSettingsMetrics(desktopPage);
  const mobileSettingsScreenshot = resolve(screenshotDir, 'settings-mobile-graphics.png');
  await desktopPage.screenshot({ path: mobileSettingsScreenshot });
  await desktopPage.close();

  const state = Object.fromEntries(liveSequence.map((entry) => [entry.label, entry]));
  const hasMapStylesHeading = (metrics) => metrics.sectionHeadings
    ?.some((heading) => /^MAP STYLES$/i.test(heading)) === true;
  const hasOldVisualStyleHeading = (metrics) => metrics.sectionHeadings
    ?.some((heading) => /^VISUAL STYLE(S)?$/i.test(heading)) === true;
  return {
    screenshots: {
      desktopSettings: relative(ROOT, desktopSettingsScreenshot),
      mobileSettings: relative(ROOT, mobileSettingsScreenshot),
    },
    desktopMetricsBefore,
    desktopMetricsAfter,
    mobileMetrics,
    liveSequence,
    checks: {
      desktopStyleListScrollable: desktopMetricsBefore.styleList?.independentlyScrollable === true,
      desktopMapStylesHeading: hasMapStylesHeading(desktopMetricsBefore),
      desktopNoOldVisualStyleHeading: !hasOldVisualStyleHeading(desktopMetricsBefore),
      desktopControlsAvailable: Object.values(desktopMetricsBefore.graphicsControls).every((value) =>
        typeof value === 'number' ? value > 0 : value === true),
      mobileStyleListAboutTwoAndHalfItems: (mobileMetrics.styleList?.visibleItems ?? 0) >= 2.3
        && (mobileMetrics.styleList?.visibleItems ?? 0) <= 2.7,
      mobileStyleListScrollable: mobileMetrics.styleList?.independentlyScrollable === true,
      mobileMapStylesHeading: hasMapStylesHeading(mobileMetrics),
      mobileNoOldVisualStyleHeading: !hasOldVisualStyleHeading(mobileMetrics),
      bloomToggleLive: state['bloom-off']?.bloomStrength === 0,
      bloomStrengthLive: Math.abs((state['bloom-strength-16']?.bloomStrength ?? -1) - 1.6) < 0.08,
      particleCountLive: (state['particle-count-100']?.particleBudget?.maxParticlesPerFrame ?? 999) <= 6
        && (state['particle-count-100']?.particleBudget?.maxFragmentsPerFrame ?? 999) <= 2,
      trailEffectsLive: state['trails-off']?.trailEffects?.playerTrailVisible === false
        && state['trails-off']?.trailEffects?.enemyTrailCount === 0,
      maxEnemiesLive: (state['max-enemies-50']?.maxActiveEnemies ?? 999) <= 50,
      resolutionScaleLive: (state['resolution-scale-50']?.rendererPixelRatio ?? 999)
        < (state['initial-solid']?.rendererPixelRatio ?? 0) * 0.75
        && (state['resolution-scale-50']?.canvasWidth ?? 99999)
          < (state['initial-solid']?.canvasWidth ?? 0) * 0.75,
      qualityPresetLive: state['quality-low']?.savedGraphics?.qualityPreset === 'low'
        && state['quality-low']?.bloomStrength === 0
        && (state['quality-low']?.particleBudget?.maxParticlesPerFrame ?? 999) <= 25
        && state['quality-low']?.trailEffects?.playerTrailVisible === false
        && (state['quality-low']?.maxActiveEnemies ?? 999) <= 100
        && (state['quality-low']?.rendererPixelRatio ?? 999)
          <= (state['initial-solid']?.rendererPixelRatio ?? 1) * 0.75,
      gridBrightnessLive: Math.abs((state['grid-brightness-22']?.gridOpacity ?? -1) - 0.22) < 0.03
        && Math.abs((state['grid-brightness-22']?.stateBaseGridOpacity ?? -1) - 0.22) < 0.03,
      seeThroughModeLive: state['see-through-toggle']?.surfaceOpacity < 0.1
        && state['see-through-toggle']?.surfaceTransparent === true,
      surfaceOpacityLive: Math.abs((state['surface-opacity-35']?.surfaceOpacity ?? -1) - 0.35) < 0.03,
      surfaceColorLive: state['surface-color-ice-blue']?.surfaceColor === 0xa8d8f0,
      solidModeLive: state['solid-toggle']?.surfaceOpacity === 1
        && state['solid-toggle']?.surfaceDepthWrite === true,
    },
  };
}

async function main() {
  mkdirSync(screenshotDir, { recursive: true });
  mkdirSync(dirname(reportJsonPath), { recursive: true });
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome/Chromium executable not found');

  const logs = [];
  const viteBin = projectToolPath('node_modules/vite/bin/vite.js');
  const server = startProcess(
    viteBin
      ? [viteBin, '--host', '127.0.0.1', '--port', String(DEV_PORT)]
      : [projectToolPath('node_modules/npm/bin/npm-cli.js') ?? 'npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(DEV_PORT)],
    { PATH: `${process.env.HOME}/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin` },
    logs,
  );

  const browser = await puppeteer.launch({
    executablePath: chromePath,
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

  const errors = [];
  const results = [];
  let settingsLiveProbe = null;
  let mobilePauseProbe = null;
  let fatalError = null;
  const baseUrl = `http://127.0.0.1:${DEV_PORT}`;
  try {
    const ready = await waitForHttp(baseUrl);
    if (!ready) throw new Error(`Vite did not become ready at ${baseUrl}\n${logs.join('\n')}`);
    settingsLiveProbe = await runSettingsLiveProbe(browser, baseUrl, errors);
    mobilePauseProbe = await captureMobilePause(browser, baseUrl, errors);
    for (const mode of modes) {
      results.push(await captureMode(browser, baseUrl, mode, errors));
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await browser.close().catch(() => {});
    await stopProcessTree(server);
  }

  const critical = criticalErrors(errors);
  const uniqueSurfaceColors = new Set(results.map((result) => result.state?.surface?.color).filter((value) => value !== null));
  const uniqueGridColors = new Set(results.map((result) => result.state?.grid?.color).filter((value) => value !== null));
  const uniqueGameplayScreenshots = new Set(results.map((result) => result.screenshotSha256?.gameplay));
  const uniquePauseScreenshots = new Set(results.map((result) => result.screenshotSha256?.pause));
  const report = {
    generatedAt: new Date().toISOString(),
    codePath: 'index.html -> src/main.ts -> ?testArena=true -> GameLoop + PauseMenu Settings graphics tab',
    command: `node tests/visual/sp-visual-mode-style-proof.mjs --surface=${SURFACE} --port=${DEV_PORT}`,
    surface: SURFACE,
    modes,
    screenshots: [
      ...results.flatMap((result) => [result.screenshots.gameplay, result.screenshots.pause]),
      ...(settingsLiveProbe ? [
        settingsLiveProbe.screenshots.desktopSettings,
        settingsLiveProbe.screenshots.mobileSettings,
      ] : []),
      ...(mobilePauseProbe ? [mobilePauseProbe.screenshot] : []),
    ],
    results,
    settingsLiveProbe,
    mobilePauseProbe,
    summary: {
      uniqueSurfaceColors: uniqueSurfaceColors.size,
      uniqueGridColors: uniqueGridColors.size,
      uniqueGameplayScreenshots: uniqueGameplayScreenshots.size,
      uniquePauseScreenshots: uniquePauseScreenshots.size,
      criticalErrors: critical.length,
    },
    errors,
    criticalErrors: critical,
    fatalError,
    serverOutputTail: logs.slice(-120),
  };
  report.passed = !fatalError
    && critical.length === 0
    && results.length === modes.length
    && results.every((result) => Object.values(result.checks).every(Boolean))
    && settingsLiveProbe
    && Object.values(settingsLiveProbe.checks).every(Boolean)
    && mobilePauseProbe
    && Object.values(mobilePauseProbe.checks).every(Boolean)
    && uniqueSurfaceColors.size >= 3
    && uniqueGridColors.size >= 3
    && uniqueGameplayScreenshots.size === modes.length
    && uniquePauseScreenshots.size === modes.length;

  writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(reportMdPath, [
    `# SP Visual Mode Style Proof - ${SURFACE}`,
    '',
    `verdict: ${report.passed ? 'PASS' : 'FAIL'}`,
    `report: ${relative(ROOT, reportJsonPath)}`,
    '',
    '## Screenshots',
    ...results.flatMap((result) => [
      `- ${result.mode} gameplay: ${result.screenshots.gameplay}`,
      `- ${result.mode} pause: ${result.screenshots.pause}`,
    ]),
    ...(settingsLiveProbe ? [
      `- desktop Settings graphics: ${settingsLiveProbe.screenshots.desktopSettings}`,
      `- mobile Settings graphics: ${settingsLiveProbe.screenshots.mobileSettings}`,
    ] : []),
    ...(mobilePauseProbe ? [
      `- mobile Pause: ${mobilePauseProbe.screenshot}`,
    ] : []),
    '',
    '## Summary',
    `- unique surface colors: ${report.summary.uniqueSurfaceColors}`,
    `- unique grid colors: ${report.summary.uniqueGridColors}`,
    `- unique gameplay screenshots: ${report.summary.uniqueGameplayScreenshots}`,
    `- unique pause screenshots: ${report.summary.uniquePauseScreenshots}`,
    `- critical errors: ${report.summary.criticalErrors}`,
    `- Settings live checks: ${JSON.stringify(report.settingsLiveProbe?.checks ?? null)}`,
    `- Mobile pause checks: ${JSON.stringify(report.mobilePauseProbe?.checks ?? null)}`,
    '',
  ].join('\n'));

  console.log(`Report: ${reportJsonPath}`);
  console.log(`Screenshots: ${screenshotDir}`);
  for (const result of results) {
    console.log(`${Object.values(result.checks).every(Boolean) ? 'PASS' : 'FAIL'} ${result.mode}: ${JSON.stringify(result.checks)}`);
  }
  if (fatalError) console.error(fatalError);
  if (critical.length > 0) console.error(`Critical page errors: ${critical.join(' | ')}`);
  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
