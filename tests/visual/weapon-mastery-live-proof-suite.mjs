#!/usr/bin/env node
/**
 * Reusable weapon mastery live proof suite.
 *
 * This runner intentionally reuses the strongest existing live-path harnesses
 * instead of duplicating browser/server orchestration in another one-off file.
 */
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const REPORT_PATH = resolve(ROOT, 'reports', `weapon-mastery-live-proof-suite-${RUN_ID}.json`);
const DEFAULT_TIMEOUT_MS = Number(process.env.SUITE_STEP_TIMEOUT_MS || 180_000);

const proofSteps = [
  {
    id: 'sp-retained-mastery-runtime',
    command: ['node', 'tests/visual/weapon-mastery-sp-live-proof.mjs'],
    env: { SP_DEV_PORT: process.env.SP_MASTERY_DEV_PORT || '3050' },
    claim: 'SP real src/main.ts testArena can activate representative retained Standard, Spread, and Black Hole mastery nodes and observe weapon/effect deltas with screenshots.',
  },
  {
    id: 'mp-supported-upgrade-parity',
    command: ['node', 'tests/visual/weapon-mastery-mp-live-proof.mjs'],
    env: {
      MP_DEV_PORT: process.env.MP_PARITY_DEV_PORT || '3051',
      MP_SERVER_PORT: process.env.MP_PARITY_SERVER_PORT || '2571',
    },
    claim: 'MP real server/network authority accepts supported Standard/Spread mastery nodes and observes server-synced projectile deltas.',
  },
  {
    id: 'mastery-screen-visual',
    command: ['node', 'tests/visual/weapon-mastery-screen-proof.mjs'],
    env: { PORT: process.env.MASTERY_SCREEN_PORT || '3052' },
    claim: 'Actual Vite-served WeaponMasteryScreen renders branch/capstone/premium UI in wide and narrow screenshots with no overflow.',
  },
];

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

function sanitize(text) {
  return stripAnsi(text)
    .replaceAll(ROOT, '<project-root>')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .slice(-220);
}

function extractArtifactPaths(lines) {
  const joined = lines.join('\n');
  const paths = [];
  for (const pattern of [
    /Report:\s+([^\n]+)/g,
    /Screenshots:\s+([^\n]+)/g,
    /"jsonPath":\s*"([^"]+)"/g,
    /"htmlPath":\s*"([^"]+)"/g,
  ]) {
    for (const match of joined.matchAll(pattern)) {
      paths.push(match[1].replaceAll(ROOT, '<project-root>'));
    }
  }
  return [...new Set(paths)];
}

async function runStep(step) {
  const startedAt = new Date().toISOString();
  const output = [];
  let timedOut = false;

  const child = spawn(step.command[0], step.command.slice(1), {
    cwd: ROOT,
    env: {
      ...process.env,
      ...step.env,
      PATH: `${process.env.HOME}/.nvm/versions/node/v20.19.5/bin:${process.env.PATH || ''}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', data => output.push(data.toString()));
  child.stderr.on('data', data => output.push(data.toString()));

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, DEFAULT_TIMEOUT_MS);

  const exitCode = await new Promise(resolveExit => {
    child.on('close', code => resolveExit(code ?? -1));
    child.on('error', () => resolveExit(-1));
  });
  clearTimeout(timeout);
  if (timedOut) {
    await sleep(500);
    try { child.kill('SIGKILL'); } catch { /* already stopped */ }
  }

  const lines = sanitize(output.join(''));
  return {
    id: step.id,
    command: step.command.join(' '),
    env: step.env,
    claim: step.claim,
    startedAt,
    finishedAt: new Date().toISOString(),
    exitCode,
    timedOut,
    passed: exitCode === 0 && !timedOut,
    artifacts: extractArtifactPaths(lines),
    outputTail: lines,
  };
}

async function main() {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });

  const selectedIds = new Set(
    (process.env.WEAPON_MASTERY_PROOF_STEPS || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean),
  );
  const steps = selectedIds.size > 0
    ? proofSteps.filter(step => selectedIds.has(step.id))
    : proofSteps;

  if (steps.length === 0) {
    throw new Error(`No proof steps matched WEAPON_MASTERY_PROOF_STEPS=${process.env.WEAPON_MASTERY_PROOF_STEPS}`);
  }

  const results = [];
  for (const step of steps) {
    console.log(`[weapon-mastery-live-proof-suite] start ${step.id}`);
    const result = await runStep(step);
    results.push(result);
    console.log(`[weapon-mastery-live-proof-suite] ${result.passed ? 'PASS' : 'FAIL'} ${step.id}`);
    if (!result.passed && process.env.WEAPON_MASTERY_PROOF_CONTINUE_ON_FAIL !== '1') break;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    suiteBoundary: 'Reusable orchestration over existing live/headless proof harnesses. SP proves representative retained Standard, Spread, and Black Hole mastery node activation through src/main.ts testArena; MP proves current server-authoritative Standard/Spread support through src/network-main.ts and server/rooms/GameRoom.ts; UI proves actual WeaponMasteryScreen pixels. This does not prove every retained node, Windows BAT, WebGPU, LAN two-client feel, or human balance.',
    selectedSteps: steps.map(step => step.id),
    results,
  };
  report.passed = results.length === steps.length && results.every(result => result.passed);

  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${REPORT_PATH}`);
  console.log(`Result: ${report.passed ? 'PASS' : 'FAIL'}`);
  process.exit(report.passed ? 0 : 1);
}

if (!existsSync(resolve(ROOT, 'package.json'))) {
  console.error(`Could not locate project root at ${ROOT}`);
  process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
