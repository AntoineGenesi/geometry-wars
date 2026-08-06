#!/usr/bin/env node
/**
 * Reusable MP weapon mastery runtime proof wrapper.
 *
 * CODE PATH: this wrapper -> scripts/probe-mp-weapon-upgrade-parity.mjs ->
 * src/network-main.ts + server/rooms/GameRoom.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, relative, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { screenshotPixelStats } from './screenshot-pixel-stats.mjs';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/weapon-mastery-mp-live-proof-${RUN_ID}.json`);
const RAW_SCRIPT = resolve(PROJECT_ROOT, 'scripts/probe-mp-weapon-upgrade-parity.mjs');
const DEV_PORT = String(process.env.DEV_PORT || process.env.MP_DEV_PORT || 3050);
const SERVER_PORT = String(process.env.SERVER_PORT || process.env.MP_SERVER_PORT || 2572);

function runProbe() {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [RAW_SCRIPT], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        DEV_PORT,
        SERVER_PORT,
        PATH: `${process.env.HOME}/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('close', code => resolveRun({ code, stdout, stderr }));
  });
}

function parseProbeStdout(stdout) {
  const first = stdout.indexOf('{');
  const last = stdout.lastIndexOf('}');
  if (first < 0 || last <= first) return null;
  try {
    return JSON.parse(stdout.slice(first, last + 1));
  } catch {
    return null;
  }
}

function readRawReport(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function summarizeChecks(rawReport) {
  return (rawReport?.checks || []).map(check => ({
    name: check.name,
    pass: check.pass,
    detail: check.detail,
  }));
}

function safeScreenshotStats(path) {
  const absolutePath = isAbsolute(path) ? path : resolve(PROJECT_ROOT, path);
  try {
    return screenshotPixelStats(absolutePath);
  } catch (error) {
    return {
      path: absolutePath,
      nonblank: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  const child = await runProbe();
  const parsed = parseProbeStdout(child.stdout);
  const rawJsonPath = parsed?.jsonPath || null;
  const rawHtmlPath = parsed?.htmlPath || null;
  const rawReport = readRawReport(rawJsonPath);
  const rawScreenshots = rawReport?.screenshots || [];
  const screenshotStats = rawScreenshots.map(path => safeScreenshotStats(path));
  const screenshots = rawScreenshots.map(path =>
    path.startsWith(PROJECT_ROOT) ? relative(PROJECT_ROOT, path) : path);
  const checks = summarizeChecks(rawReport);
  const screenshotChecks = {
    screenshotCount: screenshotStats.length,
    screenshotsNonblank: screenshotStats.length > 0 && screenshotStats.every(stats => stats.nonblank),
  };
  const passed = child.code === 0
    && rawReport?.verdict === 'PASS'
    && screenshotChecks.screenshotsNonblank;

  const report = {
    generatedAt: new Date().toISOString(),
    command: 'node tests/visual/weapon-mastery-mp-live-proof.mjs',
    delegatedCommand: 'node scripts/probe-mp-weapon-upgrade-parity.mjs',
    codePath: 'src/network-main.ts + server/rooms/GameRoom.ts via scripts/probe-mp-weapon-upgrade-parity.mjs',
    proofBoundary: 'One headless browser in a real local MP cube Waves room. Proves current MP-supported Standard/Spread retained-node activation and projectile-pattern changes through server authority. Does not expand or claim unsupported retained nodes, Black Hole mastery modifiers, two-client LAN, Windows, WebGPU, or human gameplay feel.',
    devPort: DEV_PORT,
    serverPort: SERVER_PORT,
    childExitCode: child.code,
    passed,
    rawArtifacts: {
      json: rawJsonPath,
      html: rawHtmlPath,
      screenshots,
    },
    rawVerdict: rawReport?.verdict ?? null,
    checks,
    screenshotChecks,
    screenshotStats,
    observations: rawReport?.observations ?? null,
    childStdout: child.stdout.slice(-5000),
    childStderr: child.stderr.slice(-5000),
  };

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${REPORT_PATH}`);
  if (rawJsonPath) console.log(`Raw probe JSON: ${rawJsonPath}`);
  if (rawHtmlPath) console.log(`Raw probe HTML: ${rawHtmlPath}`);
  for (const screenshot of rawScreenshots) console.log(`Raw screenshot: ${screenshot}`);
  console.log(`Result: ${passed ? 'PASS' : 'FAIL'}`);
  process.exit(passed ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
