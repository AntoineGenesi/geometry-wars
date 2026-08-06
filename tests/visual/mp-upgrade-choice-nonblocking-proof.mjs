#!/usr/bin/env node
import puppeteer from 'puppeteer-core';
import { execFileSync, spawn } from 'child_process';
import { dirname, relative, resolve } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const DEV_PORT = Number(getArg('port', process.env.DEV_PORT || '3036'));
const SERVER_PORT = Number(getArg('server-port', process.env.SERVER_PORT || '2578'));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const reportJsonPath = resolve(ROOT, 'reports', `mp-upgrade-choice-nonblocking-${runId}.json`);
const reportMdPath = resolve(ROOT, 'reports', `mp-upgrade-choice-nonblocking-${runId}.md`);
const screenshotPath = resolve(ROOT, 'test-screenshots/mp-upgrade-choice-nonblocking', `${runId}.png`);
const sharedParentRoot = resolve(ROOT, '../../..');
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
  capture(child.stdout, 'proc');
  capture(child.stderr, 'proc-error');
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

function sanitize(line) {
  return line.replaceAll(ROOT, '<project-root>');
}

async function captureChoiceState(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById('build-choice-screen');
    const panel = overlay?.querySelector('.bcs-panel');
    const cardCount = overlay?.querySelectorAll('.bcs-card').length ?? 0;
    const rectFor = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      };
    };
    const centerElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    const bottomElement = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 48);
    const visibleResumeText = Array.from(document.querySelectorAll('button, [role="button"], div'))
      .some((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0
          && rect.height > 0
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && /RESUME/i.test(el.textContent || '');
      });
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      overlayExists: Boolean(overlay),
      hidden: overlay?.classList.contains('hidden') ?? true,
      compactClass: overlay?.classList.contains('bcs-mp-mode') ?? false,
      overlayRect: rectFor(overlay),
      panelRect: rectFor(panel),
      cardCount,
      centerElementId: centerElement?.id || null,
      bottomElementId: bottomElement?.id || null,
      bottomElementClass: bottomElement?.className || null,
      visibleResumeText,
      proofState: window.__gameDebug?.getUpgradeProofState?.() ?? null,
    };
  });
}

async function main() {
  mkdirSync(resolve(ROOT, 'reports'), { recursive: true });
  mkdirSync(dirname(screenshotPath), { recursive: true });
  const chrome = findChrome();
  const tsxCli = projectToolPath('node_modules/tsx/dist/cli.mjs');
  const viteCli = projectToolPath('node_modules/vite/bin/vite.js');
  if (!chrome || !tsxCli || !viteCli) throw new Error(`Missing tool path: chrome=${chrome} tsx=${tsxCli} vite=${viteCli}`);

  const logs = [];
  const children = [];
  let browser;
  let report;

  try {
    children.push(startProcess([tsxCli, 'server/index.ts'], {
      PORT: String(SERVER_PORT),
      SHUTDOWN_TIMEOUT: '0',
      GEOMETRY_WARS_MP_PROOF_CONTROLS: '1',
    }, logs));
    children.push(startProcess([viteCli, '--host', '127.0.0.1', '--port', String(DEV_PORT)], {}, logs));
    const [serverReady, viteReady] = await Promise.all([
      waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`),
      waitForHttp(`http://127.0.0.1:${DEV_PORT}`),
    ]);
    if (!serverReady || !viteReady) throw new Error(`readiness failed: server=${serverReady} vite=${viteReady}`);

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
    page.__errors = [];
    page.__consoleTail = [];
    page.on('pageerror', (error) => page.__errors.push(error.message));
    page.on('console', (message) => {
      const line = `[${message.type()}] ${message.text()}`;
      page.__consoleTail.push(line);
      if (page.__consoleTail.length > 160) page.__consoleTail.shift();
      if (message.type() === 'error') page.__errors.push(message.text());
    });

    const params = new URLSearchParams({
      mode: 'network',
      surface: 'cube',
      server: `ws://127.0.0.1:${SERVER_PORT}`,
      debug: 'true',
      testMode: 'true',
      godMode: 'true',
      name: 'UpgradeChoiceProof',
      gameMode: 'waves',
      renderer: 'webgl',
      creator: '1',
    });
    await page.goto(`http://127.0.0.1:${DEV_PORT}?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const connected = await waitForPage(page, () => Boolean(window.__gameDebug?.isConnected?.()), 45000);
    if (!connected) throw new Error('proof browser did not connect to loopback MP server');

    const started = await waitForPage(page, () => window.__gameDebug?.startChevronAimProofGame?.('cube') || false, 30000);
    if (!started) throw new Error('could not start cube MP proof game');
    await waitForPage(page, () => window.__gameDebug?.getChevronAimProofState?.()?.roomPhase === 'playing', 30000);
    await page.evaluate(() => window.__gameDebug?.resumeChevronAimProofGame?.());
    const resumeHidden = await waitForPage(page, () => {
      return !Array.from(document.querySelectorAll('button'))
        .some((button) => {
          const rect = button.getBoundingClientRect();
          const style = window.getComputedStyle(button);
          return rect.width > 0
            && rect.height > 0
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && /RESUME/i.test(button.textContent || '');
        });
    }, 8000);
    if (!resumeHidden) throw new Error('start resume control stayed visible before build choice proof');

    const triggerResult = await page.evaluate(() =>
      window.__gameDebug?.triggerBuildChoiceProof?.('standard', ['standard_a_1', 'standard_b_1']) || false);
    if (!triggerResult) throw new Error('build choice proof trigger failed');
    const visible = await waitForPage(page, () => {
      const overlay = document.getElementById('build-choice-screen');
      return overlay && !overlay.classList.contains('hidden');
    }, 5000);
    if (!visible) throw new Error('build choice screen did not appear');

    const during = await captureChoiceState(page);
    await page.screenshot({ path: screenshotPath }).catch(() => {});
    await sleep(6500);
    const afterDismiss = await captureChoiceState(page);

    const panel = during.panelRect;
    const viewport = during.viewport;
    const compactLayoutPass = during.compactClass
      && panel
      && panel.top > viewport.height * 0.45
      && panel.height < viewport.height * 0.45
      && during.centerElementId !== 'build-choice-screen';
    const nonPausedPass = during.proofState?.isPaused === false;
    const noPauseMenuPass = during.visibleResumeText === false;
    const autoDismissPass = afterDismiss.hidden === true
      && afterDismiss.proofState?.buildChoice?.active === false
      && afterDismiss.proofState?.buildChoice?.pending === null
      && afterDismiss.proofState?.lastActivationResult === null;
    const noCriticalErrors = criticalErrors(page.__errors).length === 0;
    const verdict = compactLayoutPass && nonPausedPass && noPauseMenuPass && autoDismissPass && noCriticalErrors ? 'PASS' : 'FAIL';

    report = {
      verdict,
      runId,
      command: 'node tests/visual/mp-upgrade-choice-nonblocking-proof.mjs',
      proofBoundary: 'One headless browser in a real loopback Colyseus Waves room through src/network-main.ts. Test-mode debug API unlocks a node, records kills through MatchUpgradeTracker.recordKill(), and observes the real BuildChoiceScreen mode used by MP.',
      devPort: DEV_PORT,
      serverPort: SERVER_PORT,
      compactLayoutPass,
      nonPausedPass,
      noPauseMenuPass,
      autoDismissPass,
      during,
      afterDismiss,
      screenshot: relative(ROOT, screenshotPath),
      pageErrors: criticalErrors(page.__errors),
      consoleTail: page.__consoleTail.slice(-80),
      serverEvidence: logs
        .filter((line) => /Game started|client joined|room|upgrade/i.test(line))
        .slice(-100)
        .map(sanitize),
    };
  } catch (error) {
    report = {
      verdict: 'ERROR',
      runId,
      error: error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error),
      serverLogTail: logs.slice(-120).map(sanitize),
    };
  } finally {
    await browser?.close().catch(() => {});
    for (const child of children.reverse()) await stopProcessTree(child);
    writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
    const md = [
      '# MP Upgrade Choice Nonblocking Proof',
      '',
      `- verdict: ${report.verdict}`,
      `- compactLayoutPass: ${report.compactLayoutPass ?? 'n/a'}`,
      `- nonPausedPass: ${report.nonPausedPass ?? 'n/a'}`,
      `- noPauseMenuPass: ${report.noPauseMenuPass ?? 'n/a'}`,
      `- autoDismissPass: ${report.autoDismissPass ?? 'n/a'}`,
      `- screenshot: ${report.screenshot ?? 'n/a'}`,
      `- json: ${relative(ROOT, reportJsonPath)}`,
      '',
      report.proofBoundary ?? '',
      '',
    ].join('\n');
    writeFileSync(reportMdPath, md);
    console.log(JSON.stringify({
      verdict: report.verdict,
      compactLayoutPass: report.compactLayoutPass ?? null,
      nonPausedPass: report.nonPausedPass ?? null,
      noPauseMenuPass: report.noPauseMenuPass ?? null,
      autoDismissPass: report.autoDismissPass ?? null,
      report: relative(ROOT, reportJsonPath),
      markdown: relative(ROOT, reportMdPath),
      screenshot: report.screenshot ?? null,
    }, null, 2));
  }

  if (report.verdict !== 'PASS') process.exitCode = 1;
}

await main();
