#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PHASE = getArg('phase') || 'proof';
const PORT = Number(getArg('port') || process.env.PORT || process.env.SP_DEV_PORT || 3062);
const SERVER_PORT = Number(getArg('server-port') || process.env.SERVER_PORT || 2572);
const RUN_MP = getArg('mp') !== 'false';
const MP_MODES = (getArg('mp-modes') || 'waves,pvp,pvpve').split(',').filter(Boolean);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const ARTIFACT_DIR = resolve(ROOT, 'test-screenshots/player-clearance-sp-death-hud-proof', `${PHASE}-${RUN_ID}`);
const JSON_PATH = resolve(ROOT, 'reports', `player-clearance-sp-death-hud-${PHASE}-${RUN_ID}.json`);
const MD_PATH = resolve(ROOT, 'reports', `player-clearance-sp-death-hud-${PHASE}-${RUN_ID}.md`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function getArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
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
    // Fall through to system Chrome candidates.
  }
  return [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    commandPath('google-chrome'),
    commandPath('chromium'),
    commandPath('chromium-browser'),
    ...cached,
  ].filter(Boolean).find((candidate) => existsSync(candidate));
}

function findUp(relativePath, startDir = ROOT) {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      // Retry until timeout.
    }
    await sleep(300);
  }
  return false;
}

function startProcess(command, args, env, logs) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  const capture = (stream, source) => stream.on('data', (data) => {
    for (const line of data.toString().split('\n')) {
      if (!line.trim()) continue;
      logs.push(`[${source}] ${line}`);
      if (logs.length > 400) logs.shift();
    }
  });
  capture(child.stdout, 'server');
  capture(child.stderr, 'server-error');
  return child;
}

async function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGTERM');
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already stopped.
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  await sleep(300);
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Graceful shutdown completed.
  }
}

async function newPage(browser, label) {
  const page = await browser.newPage();
  page.__label = label;
  page.__errors = [];
  page.__consoleTail = [];
  await page.setViewport({ width: 960, height: 720 });
  page.on('pageerror', (err) => page.__errors.push(err.message));
  page.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`;
    page.__consoleTail.push(line);
    if (page.__consoleTail.length > 120) page.__consoleTail.shift();
    if (msg.type() === 'error') page.__errors.push(msg.text());
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('gw3d-music-muted', 'true');
    localStorage.setItem('gw3d-visual-mode', 'modern');
  });
  return page;
}

async function waitForPage(page, predicate, timeoutMs = 30000, arg = undefined) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await page.evaluate(predicate, arg).catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  return null;
}

async function waitFrames(page, count = 8) {
  for (let i = 0; i < count; i++) {
    await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame(true))));
  }
}

function criticalErrors(errors) {
  return errors.filter((entry) => {
    const text = String(entry || '');
    return /Uncaught|TypeError|ReferenceError|SyntaxError|Failed to load|ERR_|fatal/i.test(text)
      && !/AudioContext|user gesture|favicon|WebGPU|No WebGPU adapter|404/i.test(text);
  });
}

async function screenshot(page, name) {
  const path = resolve(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path });
  return relative(ROOT, path);
}

async function openSp(page, surface) {
  await page.goto(
    `http://127.0.0.1:${PORT}/?quickStart=true&surface=${encodeURIComponent(surface)}&testMode=true&debug=true&renderer=webgl2&music=false`,
    { waitUntil: 'domcontentloaded', timeout: 30000 },
  );
  const ready = await waitForPage(
    page,
    () => Boolean(window.__TEST_API?.ctx?.playerWalker && window.__GAME_TELEMETRY && window._gameState),
    45000,
  );
  if (!ready) throw new Error(`SP ${surface} did not expose test APIs`);
  await page.evaluate(() => {
    window.__TEST_API.clearEnemies();
    const style = document.createElement('style');
    style.textContent = '#debug-overlay,#profiling-overlay,.debug-overlay,.profiling-overlay{display:none!important}';
    document.head.appendChild(style);
  });
  await waitFrames(page, 12);
}

async function collectClearance(page, surface, label, shotName) {
  await waitFrames(page, 8);
  const sample = await page.evaluate(() => {
    const state = window._gameState;
    const tel = window.__GAME_TELEMETRY;
    const ctx = window.__TEST_API?.ctx;
    const player = ctx?.player;
    const walker = ctx?.playerWalker;
    const normal = walker?.normal;
    const mesh = player?.mesh;
    const Vector3 = mesh?.position?.constructor ?? walker?.position?.constructor;
    const dom = {
      spHealthDisplay: window.getComputedStyle(document.querySelector('#sp-health-hud') || document.body).display,
      spHealthExists: Boolean(document.querySelector('#sp-health-hud')),
    };
    let normalClearance = null;
    let minProjectedClearance = null;
    let boxCenterClearance = null;
    if (mesh && walker && normal) {
      const offset = mesh.position.clone().sub(walker.position);
      normalClearance = offset.dot(normal);
      boxCenterClearance = normalClearance;
      const projectedVertices = [];
      mesh.updateMatrixWorld(true);
      mesh.traverse((child) => {
        const attr = child.geometry?.attributes?.position;
        if (!attr || !child.localToWorld || !Vector3) return;
        const sampleStride = Math.max(1, Math.floor(attr.count / 300));
        for (let i = 0; i < attr.count; i += sampleStride) {
          const point = new Vector3(attr.getX(i), attr.getY(i), attr.getZ(i));
          child.localToWorld(point);
          projectedVertices.push(point.sub(walker.position).dot(normal));
        }
      });
      minProjectedClearance = projectedVertices.length > 0 ? Math.min(...projectedVertices) : null;
    }
    return {
      surface: state?.game?.surface ?? tel?.surface?.type ?? 'unknown',
      playerMesh: state?.player?.position,
      walker: state?.walker?.position,
      walkerNormal: state?.walker?.normal,
      normalClearance,
      minProjectedClearance,
      boxCenterClearance,
      telemetryPlayer: tel?.player ?? null,
      dom,
    };
  });
  const image = await screenshot(page, shotName);
  return { label, surface, sample, screenshot: image, criticalErrors: criticalErrors(page.__errors) };
}

async function runSpClearance(browser, surface) {
  const page = await newPage(browser, `sp-${surface}`);
  try {
    await openSp(page, surface);
    const initial = await collectClearance(page, surface, 'initial', `${surface}-clearance-initial`);
    await page.evaluate(() => window.__TEST_API.setPlayerPosition(0.62, 0.52));
    await waitFrames(page, 16);
    const moved = await collectClearance(page, surface, 'moved', `${surface}-clearance-moved`);
    return { surface, initial, moved, consoleTail: page.__consoleTail };
  } finally {
    await page.close().catch(() => {});
  }
}

async function runSpDeath(browser) {
  const page = await newPage(browser, 'sp-death-cube');
  try {
    await openSp(page, 'cube');
    const before = await page.evaluate(() => ({
      state: window.__TEST_API.getGameState(),
      spHealth: {
        exists: Boolean(document.querySelector('#sp-health-hud')),
        display: window.getComputedStyle(document.querySelector('#sp-health-hud') || document.body).display,
      },
    }));
    await page.evaluate(() => {
      const ctx = window.__TEST_API.ctx;
      ctx.player.lives = 1;
      ctx.player.health = 0;
      ctx.player.isInvincible = false;
      ctx.player.invincibilityTimer = 0;
      ctx.player.die();
    });
    const gameOver = await waitForPage(
      page,
      () => window.__TEST_API.getGameState().isGameOver
        ? {
            gameState: window.__TEST_API.getGameState(),
            telemetry: window.__GAME_TELEMETRY,
            bodyText: document.body.innerText.slice(0, 1200),
            hasGameOverContainer: Boolean(document.querySelector('.game-over-screen, #game-over-screen')),
            spHealth: {
              exists: Boolean(document.querySelector('#sp-health-hud')),
              display: window.getComputedStyle(document.querySelector('#sp-health-hud') || document.body).display,
            },
          }
        : null,
      10000,
    );
    await sleep(1300);
    const afterDelay = await page.evaluate(() => ({
      gameState: window.__TEST_API.getGameState(),
      telemetry: window.__GAME_TELEMETRY,
      bodyText: document.body.innerText.slice(0, 1600),
      gameOverLikeText: /GAME OVER|ENTER NAME|CONTINUE|SCORE|ANALYTICS/i.test(document.body.innerText),
      hasGameOverContainer: Boolean(document.querySelector('.game-over-screen, #game-over-screen')),
      canvasDisplay: window.getComputedStyle(document.querySelector('canvas') || document.body).display,
      spHealth: {
        exists: Boolean(document.querySelector('#sp-health-hud')),
        display: window.getComputedStyle(document.querySelector('#sp-health-hud') || document.body).display,
      },
    }));
    const shot = await screenshot(page, 'cube-sp-final-death-flow');
    return { before, gameOver, afterDelay, screenshot: shot, criticalErrors: criticalErrors(page.__errors), consoleTail: page.__consoleTail };
  } finally {
    await page.close().catch(() => {});
  }
}

async function runMpHudMode(browser, mode) {
  const page = await newPage(browser, `mp-${mode}`);
  try {
    const params = new URLSearchParams({
      mode: 'network',
      surface: 'sphere',
      server: `ws://127.0.0.1:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      godMode: 'true',
      name: `Hud${mode}`,
      gameMode: mode,
      renderer: 'webgl2',
      music: 'false',
      creator: '1',
    });
    await page.goto(`http://127.0.0.1:${PORT}/?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const connected = await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
    if (!connected) throw new Error(`MP ${mode} did not connect`);
    const started = await waitForPage(
      page,
      (selectedMode) => window.__gameDebug?.startChevronAimProofGame?.('sphere', selectedMode) || false,
      30000,
      mode,
    );
    if (!started) throw new Error(`MP ${mode} did not start proof game`);
    const ready = await waitForPage(
      page,
      (selectedMode) => {
        const t = window.__GAME_TELEMETRY;
        const hud = Array.from(document.querySelectorAll('div'))
          .find((el) => el.textContent?.trim() === 'HP' && getComputedStyle(el.parentElement).position === 'fixed')
          ?.parentElement;
        if (!t?.network?.connected && !t?.pvpEnabled && selectedMode !== 'waves') return null;
        return {
          telemetry: t,
          hud: hud
            ? {
                display: getComputedStyle(hud).display,
                text: hud.innerText,
                rect: (() => {
                  const r = hud.getBoundingClientRect();
                  return { x: r.x, y: r.y, width: r.width, height: r.height };
                })(),
              }
            : null,
        };
      },
      45000,
      mode,
    );
    await waitFrames(page, 8);
    const final = await page.evaluate(() => {
      const hud = Array.from(document.querySelectorAll('div'))
        .find((el) => el.textContent?.trim() === 'HP' && getComputedStyle(el.parentElement).position === 'fixed')
        ?.parentElement;
      return {
        telemetry: window.__GAME_TELEMETRY,
        hud: hud
          ? {
              display: getComputedStyle(hud).display,
              text: hud.innerText,
              rect: (() => {
                const r = hud.getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height };
              })(),
            }
          : null,
      };
    });
    const shot = await screenshot(page, `mp-${mode}-health-hud`);
    return { mode, ready, final, screenshot: shot, criticalErrors: criticalErrors(page.__errors), consoleTail: page.__consoleTail };
  } finally {
    await page.close().catch(() => {});
  }
}

async function run() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const logs = [];
  const viteBin = findUp('node_modules/vite/bin/vite.js');
  if (!existsSync(viteBin)) throw new Error('Missing Vite binary; do not run npm install while workers are active.');
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Could not find Chrome/Chromium for Puppeteer');

  const devServer = startProcess(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(PORT)], {}, logs);
  let mpServer = null;
  const result = {
    phase: PHASE,
    runId: RUN_ID,
    ports: { dev: PORT, server: RUN_MP ? SERVER_PORT : null },
    chromePath,
    artifacts: { screenshotsDir: relative(ROOT, ARTIFACT_DIR), json: relative(ROOT, JSON_PATH), markdown: relative(ROOT, MD_PATH) },
    guard: 'WARN mitigated by one browser run, Linux-worktree artifacts, no broad sweep',
    sp: {},
    mp: {},
    logsTail: logs,
  };

  try {
    if (!await waitForHttp(`http://127.0.0.1:${PORT}/`, 30000)) {
      throw new Error(`Vite did not become ready on ${PORT}`);
    }
    if (RUN_MP) {
      mpServer = startProcess('npx', ['tsx', 'server/index.ts'], { PORT: String(SERVER_PORT) }, logs);
      await sleep(1500);
    }

    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    });
    try {
      result.sp.sphere = await runSpClearance(browser, 'sphere');
      result.sp.cube = await runSpClearance(browser, 'cube');
      result.sp.deathFlowCube = await runSpDeath(browser);
      if (RUN_MP) {
        for (const mode of MP_MODES) {
          result.mp[mode] = await runMpHudMode(browser, mode);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } finally {
    result.logsTail = logs.slice(-120);
    await stopProcessTree(devServer);
    await stopProcessTree(mpServer);
  }

  const summary = summarize(result);
  result.summary = summary;
  writeFileSync(JSON_PATH, JSON.stringify(result, null, 2));
  writeFileSync(MD_PATH, markdown(result, summary));
  console.log(JSON.stringify({ ok: true, summary, artifacts: result.artifacts }, null, 2));
}

function summarize(result) {
  const clearance = {};
  for (const surface of ['sphere', 'cube']) {
    const entry = result.sp[surface];
    clearance[surface] = {
      initialNormalClearance: entry?.initial?.sample?.normalClearance ?? null,
      movedNormalClearance: entry?.moved?.sample?.normalClearance ?? null,
      initialMinProjectedClearance: entry?.initial?.sample?.minProjectedClearance ?? null,
      movedMinProjectedClearance: entry?.moved?.sample?.minProjectedClearance ?? null,
    };
  }
  const death = result.sp.deathFlowCube?.afterDelay ?? null;
  const mp = {};
  for (const mode of ['waves', 'pvp', 'pvpve']) {
    const final = result.mp[mode]?.final;
    mp[mode] = {
      pvpEnabled: final?.telemetry?.pvpEnabled ?? null,
      gameMode: final?.telemetry?.gameMode ?? null,
      hudDisplay: final?.hud?.display ?? null,
      hudFound: Boolean(final?.hud),
    };
  }
  return {
    clearance,
    spHealthDisplay: result.sp.deathFlowCube?.before?.spHealth?.display ?? null,
    deathFlow: {
      reachedGameOverState: Boolean(result.sp.deathFlowCube?.gameOver),
      gameOverLikeTextAfterDelay: Boolean(death?.gameOverLikeText),
      isGameOverAfterDelay: Boolean(death?.gameState?.isGameOver),
      spHealthDisplayAfterDeath: death?.spHealth?.display ?? null,
    },
    mp,
  };
}

function markdown(result, summary) {
  return [
    `# Player Clearance / Death / HUD Proof (${result.phase})`,
    '',
    `Run: ${result.runId}`,
    '',
    '## Summary',
    '',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '',
    '## Screenshots',
    '',
    ...Object.values(result.sp).flatMap((entry) => {
      if (!entry || Array.isArray(entry)) return [];
      const shots = [];
      for (const key of ['initial', 'moved']) {
        if (entry[key]?.screenshot) shots.push(`- ${entry[key].screenshot}`);
      }
      if (entry.screenshot) shots.push(`- ${entry.screenshot}`);
      return shots;
    }),
    ...Object.values(result.mp).flatMap((entry) => entry?.screenshot ? [`- ${entry.screenshot}`] : []),
    '',
    '## Claim Boundary',
    '',
    '- SP paths use `src/main.ts` quick-start with `testMode=true` and `debug=true`.',
    '- MP HUD proof uses a single local Colyseus host client per mode and reads client/server telemetry.',
    '- Screenshots are local worktree artifacts; JSON/Markdown reports are committed evidence.',
    '',
  ].join('\n');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
