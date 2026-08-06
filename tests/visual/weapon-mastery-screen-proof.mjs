#!/usr/bin/env node
/**
 * WeaponMasteryScreen visual proof.
 *
 * CODE PATH: Vite-served app -> /src/ui/WeaponMasteryScreen.ts ->
 * real WeaponMasteryScreen DOM/CSS. This is UI proof for the upgrade-tree
 * overlay, not gameplay/runtime proof.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PORT = Number(process.env.PORT || 3043);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/weapon-mastery-screen-proof', RUN_ID);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/weapon-mastery-screen-proof-${RUN_ID}.json`);
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/mnt/d/WSL-Caches/home-antoine/.cache/puppeteer/chrome/linux-145.0.7632.46/chrome-linux64/chrome',
  '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);
const CHROME_PATH = CHROME_CANDIDATES.find(path => existsSync(path)) || CHROME_CANDIDATES[0];

const viewports = [
  { name: 'wide', width: 1360, height: 900 },
  { name: 'narrow', width: 390, height: 844 },
];

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

async function openMasteryScreen(page, viewport) {
  await page.setViewport({ width: viewport.width, height: viewport.height });
  await page.goto(`${BASE_URL}/?renderer=webgl2`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await wait(500);

  const injected = await page.evaluate(async () => {
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 1,
      weapons: {
        standard: { xp: 680, gamesPlayed: 4 },
        spread: { xp: 420, gamesPlayed: 3 },
        black_hole: { xp: 260, gamesPlayed: 2 },
      },
    }));

    document.querySelectorAll('#weapon-mastery-screen, #wms-tooltip').forEach(el => el.remove());
    const [{ WeaponMasteryScreen }, { MasteryStore }, { MasteryPointStore }] = await Promise.all([
      import('/src/ui/WeaponMasteryScreen.ts'),
      import('/src/systems/MasteryStore.ts'),
      import('/src/systems/MasteryPointStore.ts'),
    ]);

    const pointStore = new MasteryPointStore({ debugPointMode: true });
    const screen = new WeaponMasteryScreen();
    screen.setPointStore(pointStore);
    screen.show(MasteryStore.load());
    window.__weaponMasteryProofScreen = screen;
    return {
      screenVisible: !document.getElementById('weapon-mastery-screen')?.classList.contains('hidden'),
      cards: document.querySelectorAll('.wms-card').length,
      branchPurposeGrids: document.querySelectorAll('.wms-branch-purpose-grid').length,
      capstoneNodes: document.querySelectorAll('.wms-node--capstone').length,
      premiumNodes: document.querySelectorAll('.wms-node--premium').length,
    };
  });

  await page.waitForSelector('#weapon-mastery-screen:not(.hidden)', { timeout: 10_000 });
  await wait(300);

  const screenshot = resolve(SCREENSHOT_DIR, `${viewport.name}-${viewport.width}x${viewport.height}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });

  const layout = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.wms-card'));
    const overflowingCards = cards.filter(card => card.scrollWidth > card.clientWidth + 1).length;
    const purposeRows = Array.from(document.querySelectorAll('.wms-branch-purpose-grid'));
    const purposeOverflow = purposeRows.filter(row => row.scrollWidth > row.clientWidth + 1).length;
    const firstCard = cards[0]?.getBoundingClientRect();
    return {
      cards: cards.length,
      overflowingCards,
      purposeRows: purposeRows.length,
      purposeOverflow,
      firstCard: firstCard ? {
        width: firstCard.width,
        height: firstCard.height,
        top: firstCard.top,
        bottom: firstCard.bottom,
      } : null,
      visibleText: document.body.innerText.includes('WEAPON MASTERY')
        && document.body.innerText.includes('wide fan clear')
        && document.body.innerText.includes('premium fire-rate pressure'),
    };
  });

  return {
    viewport,
    screenshot,
    injected,
    layout,
    passed: injected.screenVisible
      && injected.cards === 10
      && injected.branchPurposeGrids === 10
      && injected.capstoneNodes > 0
      && injected.premiumNodes > 0
      && layout.overflowingCards === 0
      && layout.purposeOverflow === 0
      && layout.visibleText,
  };
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(dirname(REPORT_PATH), { recursive: true });

  if (!existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}`);
  }

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
      '--window-size=1360,900',
    ],
  });

  const page = await browser.newPage();
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
    for (const viewport of viewports) {
      results.push(await openMasteryScreen(page, viewport));
    }
  } catch (error) {
    fatalError = error instanceof Error ? error.stack || error.message : String(error);
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }

  const filteredErrors = criticalErrors(errors);
  const report = {
    generatedAt: new Date().toISOString(),
    codePath: 'Vite app -> /src/ui/WeaponMasteryScreen.ts -> WeaponMasteryScreen.show()',
    baseUrl: BASE_URL,
    screenshotDir: SCREENSHOT_DIR,
    results,
    errors,
    criticalErrors: filteredErrors,
    fatalError,
    serverOutput: serverOutput.slice(-5000),
  };
  report.passed = !fatalError
    && filteredErrors.length === 0
    && results.length === viewports.length
    && results.every(result => result.passed);

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${REPORT_PATH}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`Result: ${report.passed ? 'PASS' : 'FAIL'}`);
  process.exit(report.passed ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
