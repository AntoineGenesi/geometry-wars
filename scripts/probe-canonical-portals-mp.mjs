#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORT = Number(process.env.DEV_PORT || 3006);
const SERVER_PORT = Number(process.env.SERVER_PORT || 2568);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(ROOT, 'test-screenshots/canonical-portals-mp', runId);
const reportPath = resolve(ROOT, 'reports', `canonical-portals-mp-cube-tunnel-pvpve-${runId}.json`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function commandPath(command) {
  try {
    return execSync(`command -v ${command}`, { encoding: 'utf8' }).trim().split('\n')[0] || null;
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
    // Fall through to system Chrome candidates.
  }
  return [
    process.env.CHROME_PATH,
    commandPath('google-chrome'),
    commandPath('chromium'),
    ...cached,
  ].filter(Boolean).find((candidate) => existsSync(candidate));
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // Keep polling until the bounded timeout.
    }
    await sleep(400);
  }
  return false;
}

async function waitForPage(page, predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await page.evaluate(predicate).catch(() => null);
    if (result) return result;
    await sleep(500);
  }
  return null;
}

function startProcess(args, env) {
  const processHandle = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  processHandle.stdout.on('data', (data) => process.stdout.write(data));
  processHandle.stderr.on('data', (data) => process.stderr.write(data));
  return processHandle;
}

async function stopProcessTree(processHandle) {
  if (!processHandle?.pid) return;
  try {
    if (process.platform === 'win32') processHandle.kill('SIGTERM');
    else process.kill(-processHandle.pid, 'SIGTERM');
  } catch {
    // The process may already have exited.
  }
  processHandle.stdout?.destroy();
  processHandle.stderr?.destroy();
  await sleep(1000);
  try {
    if (process.platform === 'win32') processHandle.kill('SIGKILL');
    else process.kill(-processHandle.pid, 'SIGKILL');
  } catch {
    // The process group exited after SIGTERM.
  }
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');

  const owned = [];
  let browser;
  const server = startProcess(
    ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
    {
      PORT: String(SERVER_PORT),
      SHUTDOWN_TIMEOUT: '0',
      GEOMETRY_WARS_MP_PROOF_CONTROLS: '1',
      GEOMETRY_WARS_PORTAL_PROOF_DELAY_MS: '1000',
    },
  );
  owned.push(server);
  const vite = startProcess(
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(DEV_PORT)],
    {},
  );
  owned.push(vite);

  const pageErrors = [];
  const consoleTail = [];
  try {
    const [serverReady, viteReady] = await Promise.all([
      waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`),
      waitForHttp(`http://127.0.0.1:${DEV_PORT}`),
    ]);
    if (!serverReady || !viteReady) {
      throw new Error(`Server readiness failed: server=${serverReady} vite=${viteReady}`);
    }

    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
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
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      const text = `[${message.type()}] ${message.text()}`;
      consoleTail.push(text);
      if (consoleTail.length > 120) consoleTail.shift();
      if (message.type() === 'error') pageErrors.push(message.text());
      if (message.type() === 'error' || message.text().includes('[Portals]')) {
        console.log(`[browser] ${text}`);
      }
    });

    const params = new URLSearchParams({
      mode: 'network',
      surface: 'cube-tunnel',
      server: `ws://127.0.0.1:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      godMode: 'true',
      creator: '1',
      name: 'PortalCF',
      gameMode: 'pvpve',
      pvpMode: 'pvpve',
      renderer: 'webgl',
    });
    const url = `http://127.0.0.1:${DEV_PORT}?${params.toString()}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const connected = await waitForPage(
      page,
      () => Boolean(window.__gameDebug?.isConnected?.()),
      30000,
    );
    if (!connected) throw new Error('Solo MP client did not connect');

    const startedByButton = await waitForPage(page, () => {
      const button = Array.from(document.querySelectorAll('button')).find((candidate) => {
        const text = (candidate.textContent || '').trim();
        const visible = candidate.offsetParent !== null
          || getComputedStyle(candidate).display !== 'none';
        return text.includes('START GAME') && visible;
      });
      if (!button) return '';
      button.click();
      return button.textContent || 'START GAME';
    }, 30000);
    if (!startedByButton) {
      const lobbyDiagnostic = await page.evaluate(() => ({
        bodyText: document.body.innerText.slice(0, 1200),
        buttons: Array.from(document.querySelectorAll('button')).map((button) => ({
          text: (button.textContent || '').trim(),
          display: getComputedStyle(button).display,
          visible: button.offsetParent !== null,
        })),
      }));
      console.error(JSON.stringify({ lobbyDiagnostic, pageErrors, consoleTail }, null, 2));
      throw new Error('Could not start solo MP game');
    }

    const playing = await waitForPage(
      page,
      () => window.__GAME_TELEMETRY?.network?.roomPhase === 'playing'
        && window.__GAME_TELEMETRY?.surface?.type === 'cube-tunnel',
      30000,
    );
    if (!playing) throw new Error('MP room did not enter cube-tunnel gameplay');

    const portalTelemetry = await waitForPage(page, () => {
      const telemetry = window.__GAME_TELEMETRY;
      const portals = telemetry?.portals;
      if (!portals?.active || portals.visualWorld?.length !== 2) return null;
      return {
        frame: telemetry.frame,
        gameTime: telemetry.time,
        waveNumber: telemetry.waveNumber,
        renderer: telemetry.renderer,
        surface: telemetry.surface,
        network: telemetry.network,
        portals,
      };
    }, 15000);
    if (!portalTelemetry) {
      console.error(JSON.stringify({ pageErrors, consoleTail }, null, 2));
      throw new Error('Canonical portals did not become active within 15s');
    }

    await sleep(1000);
    const finalTelemetry = await page.evaluate(() => ({
      frame: window.__GAME_TELEMETRY?.frame,
      gameTime: window.__GAME_TELEMETRY?.time,
      waveNumber: window.__GAME_TELEMETRY?.waveNumber,
      renderer: window.__GAME_TELEMETRY?.renderer,
      surface: window.__GAME_TELEMETRY?.surface,
      network: window.__GAME_TELEMETRY?.network,
      portals: window.__GAME_TELEMETRY?.portals,
      modeLabel: document.querySelector('#game-mode-indicator')?.textContent || '',
    }));
    const screenshot = resolve(artifactDir, 'cube-tunnel-pvpve-portals.png');
    await page.screenshot({ path: screenshot });

    const portalChecks = finalTelemetry.portals.visualWorld.map((portal) => ({
      id: portal.id,
      canonicalFace: Number.isInteger(portal.faceIndex) && portal.faceIndex >= 0,
      canonicalBarycentric: portal.bary
        && Math.abs(portal.bary.u + portal.bary.v + portal.bary.w - 1) < 1e-4,
      serverFrameFinite: portal.serverFrameFinite === true,
      visualQuaternionFinite: portal.visualQuaternionFinite === true,
      serverCenterPresent: portal.serverTriggerWorld !== null,
      visualServerCenterDelta: portal.visualTriggerDelta,
      aligned: portal.visualTriggerDelta >= 0 && portal.visualTriggerDelta < 1e-5,
    }));
    const criticalErrors = pageErrors.filter((message) =>
      !/AudioContext|favicon|404|Failed to load resource/.test(message)
    );
    const passed = finalTelemetry.surface?.type === 'cube-tunnel'
      && /PvPvE/i.test(finalTelemetry.modeLabel)
      && finalTelemetry.network?.roomPhase === 'playing'
      && finalTelemetry.renderer?.backend === 'webgl2'
      && portalChecks.length === 2
      && portalChecks.every((check) => check.canonicalFace
        && check.canonicalBarycentric
        && check.serverFrameFinite
        && check.visualQuaternionFinite
        && check.serverCenterPresent
        && check.aligned)
      && criticalErrors.length === 0;

    const report = {
      verdict: passed ? 'PASS' : 'FAIL',
      runId,
      url,
      ports: { vite: DEV_PORT, colyseus: SERVER_PORT },
      startedByButton,
      portalTelemetry,
      finalTelemetry,
      portalChecks,
      screenshot,
      pageErrors,
      criticalErrors,
      consoleTail,
      proofBoundary: 'One headless browser on the real network-main.ts + Colyseus PvPvE cube-tunnel path. This proves canonical portal message reception and client visual/server trigger center alignment after the timed live spawn. Exact negative trigger and one-teleport/no-bounce behavior are covered by focused GameRoom tests because the browser probe does not add a test-only server teleport control.',
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ verdict: report.verdict, reportPath, screenshot, portalChecks }, null, 2));
    if (!passed) process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    for (const processHandle of owned.reverse()) {
      await stopProcessTree(processHandle);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
