#!/usr/bin/env node
/**
 * Weapon Wiki playground modal-route proof.
 *
 * CODE PATH: StartMenu -> WeaponWiki -> TRY IT -> WeaponPlayground ->
 * GameInstance.
 *
 * This is demo/diagnostic proof only. It is not real SP/MP gameplay proof.
 */
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { inflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const screenshotDir = resolve(PROJECT_ROOT, 'test-screenshots/weapon-wiki-playground-proof', timestamp);
const reportPath = resolve(PROJECT_ROOT, `reports/weapon-wiki-playground-proof-${timestamp}.json`);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const scenarios = [
  { name: 'standard-projectile', weapon: 'standard', displayName: 'Blaster', warmupMs: 450, holdMs: 800 },
  { name: 'laser-beam', weapon: 'laser_beam', displayName: 'Laser Beam', warmupMs: 1300, holdMs: 950 },
  { name: 'homing-missile', weapon: 'homing', displayName: 'Homing Missiles', warmupMs: 1300, holdMs: 1000 },
  { name: 'black-hole-special', weapon: 'black_hole', displayName: 'Black Hole', warmupMs: 2200, holdMs: 1100 },
];

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

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function analyzePng(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    return { nonblank: false, reason: 'not-png' };
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (bitDepth !== 8 || ![2, 6].includes(colorType) || width <= 0 || height <= 0) {
    return { nonblank: false, reason: `unsupported-png-${bitDepth}-${colorType}`, width, height };
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const rows = [];
  let inputOffset = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset++];
    const row = Buffer.alloc(stride);
    const prev = rows[y - 1] ?? Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const raw = inflated[inputOffset++];
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] ?? 0;
      const upLeft = x >= channels ? prev[x - channels] ?? 0 : 0;
      if (filter === 0) row[x] = raw;
      else if (filter === 1) row[x] = (raw + left) & 0xff;
      else if (filter === 2) row[x] = (raw + up) & 0xff;
      else if (filter === 3) row[x] = (raw + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) row[x] = (raw + paethPredictor(left, up, upLeft)) & 0xff;
      else return { nonblank: false, reason: `unsupported-filter-${filter}`, width, height };
    }
    rows.push(row);
  }

  const colors = new Set();
  let nonZeroSamples = 0;
  let sampled = 0;
  for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 40))) {
    const row = rows[y];
    for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 40))) {
      const i = x * channels;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      colors.add(`${r},${g},${b}`);
      if (r || g || b) nonZeroSamples++;
      sampled++;
    }
  }

  return {
    nonblank: colors.size > 12 && nonZeroSamples > sampled * 0.05,
    width,
    height,
    sampled,
    nonZeroSamples,
    distinctColors: colors.size,
  };
}

async function openWeaponWiki(page) {
  await page.goto(`${BASE_URL}/?renderer=webgl2`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('#weapon-info-btn', { visible: true, timeout: 30000 });
  await page.click('#weapon-info-btn');
  await page.waitForSelector('#weapon-wiki:not(.hidden)', { timeout: 10000 });
}

async function readMountSnapshot(page) {
  return page.evaluate(() => {
    const mount = document.querySelector('[data-playground-mount]');
    if (!mount) return null;
    const raw = mount.dataset.playgroundSnapshot ?? null;
    return {
      visible: mount.classList.contains('visible'),
      activeWeapon: mount.dataset.playgroundActiveWeapon ?? null,
      focused: mount.dataset.playgroundFocused ?? null,
      paused: mount.dataset.playgroundPaused ?? null,
      snapshot: raw ? JSON.parse(raw) : null,
    };
  });
}

async function sampleCanvas(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('[data-playground-mount] canvas');
    if (!canvas) return { mounted: false, nonblank: false, reason: 'missing-canvas' };

    const rect = canvas.getBoundingClientRect();
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
      return {
        mounted: true,
        nonblank: rect.width > 0 && rect.height > 0,
        reason: 'no-readable-webgl-context',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    }

    gl.finish();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixel = new Uint8Array(4);
    let nonZeroSamples = 0;
    const colors = new Set();
    for (let y = 1; y <= 12; y++) {
      for (let x = 1; x <= 16; x++) {
        const px = Math.max(0, Math.min(width - 1, Math.floor((x / 17) * width)));
        const py = Math.max(0, Math.min(height - 1, Math.floor((y / 13) * height)));
        gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const key = `${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3]}`;
        colors.add(key);
        if (pixel[0] || pixel[1] || pixel[2]) nonZeroSamples++;
      }
    }

    return {
      mounted: true,
      nonblank: nonZeroSamples > 8 && colors.size > 2,
      nonZeroSamples,
      distinctColors: colors.size,
      drawingBuffer: { width, height },
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
}

async function captureCanvasClip(page, path) {
  const rect = await page.evaluate(() => {
    const canvas = document.querySelector('[data-playground-mount] canvas');
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (!rect) return { mounted: false, nonblank: false, reason: 'missing-canvas' };

  const buffer = await page.screenshot({
    path,
    clip: {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: Math.max(1, Math.min(rect.width, 1280 - Math.max(0, rect.x))),
      height: Math.max(1, Math.min(rect.height, 900 - Math.max(0, rect.y))),
    },
  });
  return {
    mounted: true,
    rect,
    path,
    png: analyzePng(Buffer.from(buffer)),
  };
}

async function clickWeaponCard(page, weapon) {
  const selector = `.weapon-card[data-weapon-type="${weapon}"]`;
  await page.waitForSelector(selector, { visible: true, timeout: 10000 });
  await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), selector);
  await sleep(100);
  await page.click(selector);
  await page.waitForSelector('.weapon-modal-overlay .weapon-modal', { visible: true, timeout: 10000 });
}

async function runScenario(page, scenario) {
  await clickWeaponCard(page, scenario.weapon);

  const modalOpened = await page.evaluate((weapon) => {
    const modal = document.querySelector('.weapon-modal-overlay .weapon-modal');
    const title = modal?.querySelector('.modal-weapon-name')?.textContent?.trim() ?? '';
    const tryButton = modal?.querySelector('[data-action="toggle-playground"]');
    return {
      modalPresent: Boolean(modal),
      title,
      tryButtonWeapon: tryButton?.getAttribute('data-weapon-type') ?? null,
      titleMatches: title.length > 0,
      tryButtonMatches: tryButton?.getAttribute('data-weapon-type') === weapon,
    };
  }, scenario.weapon);

  await page.click('[data-action="toggle-playground"]');
  await page.waitForSelector('[data-playground-mount].visible canvas', { visible: true, timeout: 20000 });
  await sleep(900);

  const mountedScreenshot = resolve(screenshotDir, `${scenario.name}-mounted.png`);
  await page.screenshot({ path: mountedScreenshot, fullPage: false });
  const canvasMounted = await sampleCanvas(page);
  const mountedCanvasClip = await captureCanvasClip(
    page,
    resolve(screenshotDir, `${scenario.name}-canvas-mounted.png`),
  );
  const beforeFocus = await readMountSnapshot(page);

  await page.evaluate(() => {
    document.querySelector('[data-playground-mount] canvas')?.scrollIntoView({ block: 'center' });
  });
  await sleep(250);

  const rect = await page.evaluate(() => {
    const canvas = document.querySelector('[data-playground-mount] canvas');
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const aim = { x: rect.x + rect.width * 0.84, y: rect.y + rect.height / 2 };

  await page.mouse.click(center.x, center.y);
  await sleep(scenario.warmupMs);
  const beforeFire = await readMountSnapshot(page);

  await page.mouse.move(aim.x, aim.y);
  await page.mouse.down({ button: 'left' });
  await sleep(scenario.holdMs);
  const duringFire = await readMountSnapshot(page);
  const fireScreenshot = resolve(screenshotDir, `${scenario.name}-after-fire.png`);
  await page.screenshot({ path: fireScreenshot, fullPage: false });
  const fireCanvasClip = await captureCanvasClip(
    page,
    resolve(screenshotDir, `${scenario.name}-canvas-after-fire.png`),
  );
  await page.mouse.up({ button: 'left' });
  await sleep(220);
  const afterFire = await readMountSnapshot(page);
  const canvasAfterFire = await sampleCanvas(page);

  const beforeGame = beforeFire?.snapshot?.game ?? null;
  const duringGame = duringFire?.snapshot?.game ?? null;
  const afterGame = afterFire?.snapshot?.game ?? null;
  const beforeBullets = beforeGame?.bulletCount ?? 0;
  const duringBullets = duringGame?.bulletCount ?? 0;
  const afterBullets = afterGame?.bulletCount ?? 0;
  const beforeVisuals = beforeGame?.weaponVisualObjectCount ?? 0;
  const duringVisuals = duringGame?.weaponVisualObjectCount ?? 0;
  const afterVisuals = afterGame?.weaponVisualObjectCount ?? 0;
  const beforeKills = beforeFire?.snapshot?.kills ?? 0;
  const afterKills = afterFire?.snapshot?.kills ?? 0;

  const isStandard = scenario.weapon === 'standard';
  const projectileOrEffectResponse = isStandard
    ? Math.max(duringBullets, afterBullets) > beforeBullets
    : Math.max(duringVisuals, afterVisuals) > beforeVisuals;
  const visibleResponse = projectileOrEffectResponse
    || afterKills > beforeKills
    || (canvasAfterFire.nonZeroSamples ?? 0) > (canvasMounted.nonZeroSamples ?? 0);

  await page.click('[data-action="modal-close"]');
  await page.waitForFunction(() => !document.querySelector('.weapon-modal-overlay'), { timeout: 10000 });

  const checks = {
    modalOpened: modalOpened.modalPresent && modalOpened.titleMatches,
    tryItClicked: modalOpened.tryButtonMatches,
    canvasMounted: canvasMounted.mounted,
    canvasNonblank: fireCanvasClip.png?.nonblank === true,
    selectedWeapon: beforeFocus?.activeWeapon === scenario.weapon
      && beforeFocus?.snapshot?.game?.currentWeapon === scenario.weapon,
    focusedAndStarted: duringFire?.focused === 'true' && duringGame?.started === true,
    firingInputInteraction: duringBullets > beforeBullets || duringVisuals > beforeVisuals || afterKills > beforeKills,
    projectileOrEffectOrVisibleResponse: visibleResponse,
  };

  return {
    name: scenario.name,
    weapon: scenario.weapon,
    displayName: scenario.displayName,
    passed: Object.values(checks).every(Boolean),
    checks,
    modalOpened,
    canvasMounted,
    canvasAfterFire,
    mountedCanvasClip,
    fireCanvasClip,
    snapshots: { beforeFocus, beforeFire, duringFire, afterFire },
    deltas: {
      bulletCount: Math.max(duringBullets, afterBullets) - beforeBullets,
      weaponVisualObjectCount: Math.max(duringVisuals, afterVisuals) - beforeVisuals,
      kills: afterKills - beforeKills,
    },
    screenshots: [mountedScreenshot, fireScreenshot, mountedCanvasClip.path, fireCanvasClip.path],
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
      '--window-size=1280,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

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
    await openWeaponWiki(page);
    await page.screenshot({ path: resolve(screenshotDir, '00-weapon-wiki-open.png'), fullPage: false });
    for (const scenario of scenarios) {
      scenarioResults.push(await runScenario(page, scenario));
      await sleep(350);
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await browser.close();
  }

  const filteredErrors = criticalErrors(errors);
  const report = {
    generatedAt: new Date().toISOString(),
    codePath: 'StartMenu -> WeaponWiki -> TRY IT -> WeaponPlayground -> GameInstance',
    claimBoundary: 'Weapon Wiki playground demo/diagnostic proof only. Real SP weapon behavior authority remains Child 1 ?testArena=true proof.',
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
