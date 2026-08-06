#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execSync, spawn } from 'child_process';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_PORT = Number(process.env.DEV_PORT || 3008);
const SERVER_PORT = Number(process.env.SERVER_PORT || 2570);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const artifactDir = resolve(ROOT, 'test-screenshots/mp-weapon-upgrade-parity', runId);
const jsonPath = resolve(ROOT, 'reports', `mp-weapon-upgrade-parity-cube-waves-${runId}.json`);
const htmlPath = resolve(ROOT, 'reports', `mp-weapon-upgrade-parity-cube-waves-${runId}.html`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

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
    // Fall through to system Chrome.
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
      // Retry within the bounded window.
    }
    await sleep(400);
  }
  return false;
}

async function waitForPage(page, predicate, timeoutMs = 30000, argument = undefined) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await page.evaluate(predicate, argument).catch(() => null);
    if (value) return value;
    await sleep(200);
  }
  return null;
}

function startProcess(args, env, logs) {
  const resolvedArgs = [...args];
  if (resolvedArgs[0]?.startsWith('node_modules/')) {
    resolvedArgs[0] = findUp(resolvedArgs[0]) || resolvedArgs[0];
  }
  const child = spawn(process.execPath, resolvedArgs, {
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
  capture(child.stdout, 'stdout');
  capture(child.stderr, 'stderr');
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
  await sleep(500);
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Process group exited after SIGTERM.
  }
}

async function getProofState(page) {
  return page.evaluate(() => window.__gameDebug?.getUpgradeProofState?.() || null);
}

async function setupWeapon(page, weaponType, killCount) {
  const sent = await page.evaluate(
    ({ weapon, kills }) => window.__gameDebug?.setupUpgradeProof?.(weapon, kills) || false,
    { weapon: weaponType, kills: killCount },
  );
  if (!sent) throw new Error(`Could not send ${weaponType} proof setup`);
  const ready = await waitForPage(
    page,
    (weapon) => window.__gameDebug?.getUpgradeProofState?.()?.currentWeapon === weapon,
    10000,
    weaponType,
  );
  if (!ready) throw new Error(`Server did not select ${weaponType}`);
  await waitForPage(
    page,
    () => Object.values(window.__gameDebug?.getUpgradeProofState?.()?.bulletCounts || {})
      .reduce((sum, value) => sum + value, 0) === 0,
    5000,
  );
}

async function activateNode(page, weaponType, nodeId, unlockedNodeIds) {
  const sent = await page.evaluate(
    ({ weapon, node, unlocked }) => window.__gameDebug?.requestUpgradeProofActivation?.(weapon, node, unlocked) || false,
    { weapon: weaponType, node: nodeId, unlocked: unlockedNodeIds },
  );
  if (!sent) throw new Error(`Could not request ${nodeId}`);
  const state = await waitForPage(page, ({ weapon, node }) => {
    const proof = window.__gameDebug?.getUpgradeProofState?.();
    if (proof?.lastActivationResult?.weaponType !== weapon
        || proof.lastActivationResult.nodeId !== node) return null;
    return proof;
  }, 10000, { weapon: weaponType, node: nodeId });
  if (!state) throw new Error(`No activation result for ${nodeId}`);
  await waitForPage(
    page,
    ({ weapon, node }) => window.__gameDebug?.getUpgradeProofState?.()
      ?.schemaActiveUpgradeNodes?.includes(`${weapon}:${node}`),
    10000,
    { weapon: weaponType, node: nodeId },
  );
  return getProofState(page);
}

async function sampleShot(page, weaponType, screenshotName) {
  const fired = await page.evaluate(() => window.__gameDebug?.fireUpgradeProofShot?.() || false);
  if (!fired) throw new Error(`Could not fire ${weaponType} proof shot`);

  let maxCount = 0;
  let sample = null;
  const started = Date.now();
  while (Date.now() - started < 1400) {
    const state = await getProofState(page);
    const count = Number(state?.bulletCounts?.[weaponType] || 0);
    if (count > maxCount) {
      maxCount = count;
      sample = state;
    }
    if (maxCount > 0 && Date.now() - started > 250) break;
    await sleep(35);
  }
  await page.screenshot({ path: resolve(artifactDir, screenshotName) });
  return { maxServerSyncedProjectileCount: maxCount, stateAtMax: sample };
}

function criticalPageErrors(errors) {
  return errors.filter((message) =>
    !/AudioContext|user gesture|favicon|404|Failed to load resource|SharedArrayBuffer|crossOriginIsolated/i.test(message));
}

function criticalServerErrors(logs) {
  return logs.filter((line) => /\b(fatal|uncaught|unhandled|exception|error:)\b/i.test(line));
}

function sanitizeEvidenceLine(line) {
  return line
    .replace(/player=[^ ]+/g, 'player=<session>')
    .replace(/session(?:Id|:)?[= ]+[^ ,)]+/gi, 'session=<session>')
    .replace(new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '<project-root>');
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function writeHtml(report) {
  const rows = (report.checks || []).map((check) => `
    <tr><td>${htmlEscape(check.name)}</td><td class="${check.pass ? 'pass' : 'fail'}">${check.pass ? 'PASS' : 'FAIL'}</td><td>${htmlEscape(check.detail)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>MP weapon upgrade parity proof</title>
<style>body{font:14px system-ui;background:#0a0d14;color:#e6edf3;margin:24px}table{border-collapse:collapse;width:100%;max-width:1100px}th,td{border:1px solid #30363d;padding:8px;text-align:left}th{background:#161b22}.pass{color:#3fb950}.fail{color:#f85149}code,pre{background:#161b22}pre{padding:12px;white-space:pre-wrap;max-width:1100px}</style></head>
<body><h1>MP weapon upgrade parity: ${report.verdict}</h1><p>${htmlEscape(report.proofBoundary)}</p>
<table><thead><tr><th>Check</th><th>Result</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>
<h2>Observed behavior</h2><pre>${htmlEscape(JSON.stringify(report.observations || null, null, 2))}</pre>
<h2>Failure</h2><pre>${htmlEscape(report.error || '')}</pre>
<h2>Artifacts</h2><pre>${htmlEscape(JSON.stringify(report.screenshots || [], null, 2))}</pre></body></html>`;
}

async function main() {
  mkdirSync(artifactDir, { recursive: true });
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('No Chrome executable found');

  const serverLogs = [];
  const pageErrors = [];
  const consoleTail = [];
  const owned = [];
  let browser;
  let report;
  try {
    owned.push(startProcess(
      ['node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
      { PORT: String(SERVER_PORT), SHUTDOWN_TIMEOUT: '0', GEOMETRY_WARS_MP_PROOF_CONTROLS: '1' },
      serverLogs,
    ));
    owned.push(startProcess(
      ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(DEV_PORT)],
      {},
      serverLogs,
    ));
    const [serverReady, viteReady] = await Promise.all([
      waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`),
      waitForHttp(`http://127.0.0.1:${DEV_PORT}`),
    ]);
    if (!serverReady || !viteReady) throw new Error(`Readiness failed: server=${serverReady} vite=${viteReady}`);

    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: true,
      args: [
        '--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--window-size=960,720',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 720 });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      const line = `[${message.type()}] ${message.text()}`;
      consoleTail.push(line);
      if (consoleTail.length > 160) consoleTail.shift();
      if (message.type() === 'error') pageErrors.push(message.text());
    });

    const params = new URLSearchParams({
      mode: 'network', surface: 'cube', server: `ws://127.0.0.1:${SERVER_PORT}`,
      debug: 'true', testMode: 'true', godMode: 'true', creator: '1',
      name: 'UpgradeParityCV', gameMode: 'waves', renderer: 'webgl',
    });
    const url = `http://127.0.0.1:${DEV_PORT}?${params.toString()}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const connected = await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
    if (!connected) throw new Error('Solo MP client did not connect');

    const started = await waitForPage(page, () => {
      const button = Array.from(document.querySelectorAll('button')).find((candidate) => {
        const label = (candidate.textContent || '').trim();
        return label.includes('START GAME')
          && (candidate.offsetParent !== null || getComputedStyle(candidate).display !== 'none');
      });
      if (!button) return false;
      button.click();
      return true;
    }, 30000);
    if (!started) throw new Error('Could not start solo MP Waves game');
    const playing = await waitForPage(page, () => {
      const telemetry = window.__GAME_TELEMETRY;
      return telemetry?.network?.roomPhase === 'playing'
        && telemetry?.surface?.type === 'cube'
        && telemetry?.gameMode === 'waves';
    }, 30000);
    if (!playing) throw new Error('MP room did not enter cube Waves gameplay');

    await setupWeapon(page, 'standard', 25);
    const standardBaseline = await sampleShot(page, 'standard', 'standard-baseline.png');
    const standardPrerequisite = await activateNode(
      page, 'standard', 'standard_a_1', ['standard_a_1', 'standard_a_2', 'spread_a_1'],
    );
    const standardActivation = await activateNode(
      page, 'standard', 'standard_a_2', ['standard_a_1', 'standard_a_2', 'spread_a_1'],
    );
    await setupWeapon(page, 'standard', 25);
    const standardUpgraded = await sampleShot(page, 'standard', 'standard-upgraded.png');

    await setupWeapon(page, 'spread', 10);
    const spreadBaseline = await sampleShot(page, 'spread', 'spread-baseline.png');
    const spreadActivation = await activateNode(
      page, 'spread', 'spread_a_1', ['standard_a_1', 'standard_a_2', 'spread_a_1'],
    );
    await setupWeapon(page, 'spread', 10);
    const spreadUpgraded = await sampleShot(page, 'spread', 'spread-upgraded.png');
    const finalState = await getProofState(page);
    const telemetry = await page.evaluate(() => window.__GAME_TELEMETRY || null);
    const screenshots = readdirSync(artifactDir).map((name) => relative(ROOT, resolve(artifactDir, name)));
    const browserCritical = criticalPageErrors(pageErrors);
    const serverCritical = criticalServerErrors(serverLogs);
    const serverEvidence = serverLogs
      .filter((line) => /Game started|Upgrade proof setup|upgrade activation accepted/.test(line))
      .map(sanitizeEvidenceLine);
    const consoleEvidence = consoleTail
      .filter((line) => /Created WebGL2 renderer|roomPhase: lobby.*playing|Server accepted upgrade activation/.test(line))
      .map(sanitizeEvidenceLine);

    const observations = {
      standard: {
        baselineProjectiles: standardBaseline.maxServerSyncedProjectileCount,
        prerequisiteActivation: standardPrerequisite.lastActivationResult,
        targetActivation: standardActivation.lastActivationResult,
        upgradedProjectiles: standardUpgraded.maxServerSyncedProjectileCount,
      },
      spread: {
        baselineProjectiles: spreadBaseline.maxServerSyncedProjectileCount,
        targetActivation: spreadActivation.lastActivationResult,
        upgradedProjectiles: spreadUpgraded.maxServerSyncedProjectileCount,
      },
      finalState,
    };
    const checks = [
      { name: 'Real MP client connected', pass: Boolean(connected), detail: url },
      { name: 'Cube Waves room entered playing state', pass: Boolean(playing), detail: JSON.stringify({ connected: telemetry?.network?.connected, playerCount: telemetry?.network?.playerCount, isHost: telemetry?.network?.isHost, roomPhase: telemetry?.network?.roomPhase }) },
      { name: 'Standard baseline projectile count', pass: standardBaseline.maxServerSyncedProjectileCount === 1, detail: `observed ${standardBaseline.maxServerSyncedProjectileCount}, expected 1` },
      { name: 'Standard node activation accepted', pass: standardActivation.lastActivationResult?.accepted === true, detail: JSON.stringify(standardActivation.lastActivationResult) },
      { name: 'Standard node visible in server schema and client tracker', pass: finalState.schemaActiveUpgradeNodes.includes('standard:standard_a_2') && finalState.trackerActiveUpgradeNodes.standard.includes('standard_a_2'), detail: JSON.stringify(finalState) },
      { name: 'Standard upgraded projectile count changed', pass: standardUpgraded.maxServerSyncedProjectileCount === 3 && standardUpgraded.maxServerSyncedProjectileCount > standardBaseline.maxServerSyncedProjectileCount, detail: `${standardBaseline.maxServerSyncedProjectileCount} -> ${standardUpgraded.maxServerSyncedProjectileCount}` },
      { name: 'Spread baseline projectile count', pass: spreadBaseline.maxServerSyncedProjectileCount === 5, detail: `observed ${spreadBaseline.maxServerSyncedProjectileCount}, expected 5` },
      { name: 'Spread node activation accepted', pass: spreadActivation.lastActivationResult?.accepted === true, detail: JSON.stringify(spreadActivation.lastActivationResult) },
      { name: 'Spread node visible in server schema and client tracker', pass: finalState.schemaActiveUpgradeNodes.includes('spread:spread_a_1') && finalState.trackerActiveUpgradeNodes.spread.includes('spread_a_1'), detail: JSON.stringify(finalState) },
      { name: 'Spread upgraded projectile count changed', pass: spreadUpgraded.maxServerSyncedProjectileCount === 6 && spreadUpgraded.maxServerSyncedProjectileCount > spreadBaseline.maxServerSyncedProjectileCount, detail: `${spreadBaseline.maxServerSyncedProjectileCount} -> ${spreadUpgraded.maxServerSyncedProjectileCount}` },
      { name: 'No critical browser errors', pass: browserCritical.length === 0, detail: JSON.stringify(browserCritical) },
      { name: 'No critical server errors', pass: serverCritical.length === 0, detail: JSON.stringify(serverCritical) },
    ];
    const passed = checks.every((check) => check.pass);
    report = {
      verdict: passed ? 'PASS' : 'FAIL', runId, url, renderer: telemetry?.renderer || null,
      surface: telemetry?.surface || null, mode: telemetry?.gameMode || null,
      observations, checks, pageErrors, browserCritical, serverCritical,
      consoleEvidence, serverEvidence, screenshots,
      proofBoundary: 'One headless browser in a real cube Waves room through src/network-main.ts and server/rooms/GameRoom.ts. Deterministic host-only proof setup is enabled only by GEOMETRY_WARS_MP_PROOF_CONTROLS=1; activation uses the production activate_upgrade path and firing uses production input/tryShoot/projectile schema paths. This does not prove all mastery nodes, two-client LAN, Windows BAT, WebGPU, or human gameplay feel.',
    };
  } catch (error) {
    report = {
      verdict: 'FAIL', runId, error: error instanceof Error ? error.stack || error.message : String(error),
      pageErrors,
      consoleEvidence: consoleTail.slice(-40).map(sanitizeEvidenceLine),
      serverEvidence: serverLogs.slice(-80).map(sanitizeEvidenceLine),
      proofBoundary: 'The bounded live probe failed before satisfying its claim.',
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
    await Promise.all(owned.map(stopProcessTree));
  }

  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(htmlPath, writeHtml(report));
  console.log(JSON.stringify({ verdict: report.verdict, jsonPath, htmlPath, observations: report.observations, error: report.error }, null, 2));
  return report.verdict === 'PASS';
}

main().then((passed) => process.exit(passed ? 0 : 1));
