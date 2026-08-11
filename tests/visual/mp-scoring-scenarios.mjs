#!/usr/bin/env node
/**
 * mp-scoring-scenarios.mjs — Rigorous MP scoring proof for scoped MP modes (s44r17-03).
 *
 * Tests per-player scoring isolation and mode-appropriate scoring logic.
 * Requires a Vite dev server running at BASE_URL.
 * Starts its own Colyseus server for each scenario.
 *
 * What we test:
 *   1. Waves: each player's score is independent (different kill counts → different scores)
 *   2. KOTH: only player in zone gets zoneTime; other player stays at 0
 *   3. PvP: kills attributed to the shooter (kills field increases for killer only)
 *   4. PvPvE: enemy kills → score field; PvP kills → kills field (both tracked)
 * Rainbow is intentionally out of this narrowed proof loop.
 *
 * Usage:
 *   node tests/visual/mp-scoring-scenarios.mjs
 *   node tests/visual/mp-scoring-scenarios.mjs --mode=koth
 *   node tests/visual/mp-scoring-scenarios.mjs --mode=pvp
 *   node tests/visual/mp-scoring-scenarios.mjs --surface=sphere
 *   node tests/visual/mp-scoring-scenarios.mjs --report   # generate HTML report
 */

import puppeteer from 'puppeteer-core';
import { spawn, execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const COLYSEUS_PORT = 2567;
const NVM_PATH = process.env.NVM_BIN
  || dirname(process.execPath)
  || '/home/antoine/.nvm/versions/node/v20.19.5/bin';

const args = process.argv.slice(2);
function getArg(name) {
  for (const a of args) {
    if (a.startsWith(`--${name}=`)) return a.split('=')[1];
  }
  return null;
}

const MODE_FILTER = getArg('mode');
const SURFACE = getArg('surface') || 'sphere';
const GENERATE_REPORT = args.includes('--report');

const BASE_URL = `http://localhost:${parseInt(getArg('port') || '3000', 10)}`;
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/mp-scoring');
const now = new Date();
const dateStr = now.toISOString().substring(0, 10);
const REPORT_PATH = resolve(PROJECT_ROOT, `reports/mp-scoring-report-${dateStr}.html`);

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=640,360',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Server management
// ---------------------------------------------------------------------------

function killPortProcesses(ports) {
  for (const port of ports) {
    try {
      const result = execSync(`ss -tlnp 2>/dev/null | grep ':${port}\\b'`, { encoding: 'utf-8' });
      if (result.trim()) {
        const pidMatches = [...result.matchAll(/pid=(\d+)/g)];
        for (const match of pidMatches) {
          try { execSync(`kill -15 ${match[1]} 2>/dev/null`); } catch { /* dead */ }
        }
        try { execSync('sleep 1'); } catch { /* ignore */ }
        for (const match of [...result.matchAll(/pid=(\d+)/g)]) {
          try { execSync(`kill -9 ${match[1]} 2>/dev/null`); } catch { /* dead */ }
        }
      }
    } catch { /* no process */ }
  }
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (resp.ok) return true;
    } catch { /* not ready */ }
    await sleep(500);
  }
  return false;
}

function startColyseusServer() {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PATH: `${NVM_PATH}:/usr/bin:/bin`,
      PORT: String(COLYSEUS_PORT),
      SHUTDOWN_TIMEOUT: '0',
      GEOMETRY_WARS_MP_PROOF_CONTROLS: '1',
    };
    const proc = spawn(`${NVM_PATH}/npx`, ['tsx', 'server/index.ts'], {
      cwd: PROJECT_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });

    let started = false;
    let output = '';
    const onData = (data) => {
      const text = data.toString();
      output += text;
      if (!started && (text.includes('MULTIPLAYER SERVER') || text.includes(`localhost:${COLYSEUS_PORT}`))) {
        started = true;
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => { if (!started) reject(new Error(`Colyseus failed: ${err.message}`)); });
    proc.on('exit', (code) => { if (!started) reject(new Error(`Colyseus exited ${code}. Output: ${output.slice(0, 400)}`)); });
    setTimeout(() => {
      if (!started) { proc.kill(); reject(new Error(`Colyseus timeout. Output: ${output.slice(0, 400)}`)); }
    }, 20000);
  });
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });
}

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  const errors = [];
  const logs = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.__errors = errors;
  page.__logs = logs;
  return page;
}

async function navigateMP(page, surface, label, opts = {}) {
  await page.evaluateOnNewDocument(() => { localStorage.clear(); });
  let url = `${BASE_URL}?mode=network&surface=${surface}&server=${encodeURIComponent(`ws://localhost:${COLYSEUS_PORT}`)}&debug=true&testMode=true&name=${label}`;
  if (opts && opts.gameMode) url += `&gameMode=${opts.gameMode}`;
  if (opts && (opts.gameMode === 'pvp' || opts.gameMode === 'pvpve')) url += `&pvpMode=${opts.gameMode}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(12000); // Extra time for SwiftShader WebGL init + network connection
}

async function getDebug(page, method) {
  return page.evaluate((m) => {
    const debug = window.__gameDebug;
    if (!debug || typeof debug[m] !== 'function') return null;
    return debug[m]();
  }, method);
}

async function getTelemetry(page) {
  return page.evaluate(() => window.__GAME_TELEMETRY || null);
}

async function waitForCondition(fn, timeoutMs = 20000, pollMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(pollMs);
  }
  return false;
}

async function clickStartGame(page) {
  return page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const t = (btn.textContent || '').trim();
      if (t.includes('START GAME') || t.includes('PLAY AGAIN')) {
        if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') {
          btn.click();
          return true;
        }
      }
    }
    return false;
  });
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    const btns = document.querySelectorAll('button');
    for (const btn of btns) {
      const t = (btn.textContent || '').trim();
      if (t === '×' || t === 'X' || t === 'CLOSE' || t === 'SKIP' || t === 'RESUME') {
        if (btn.offsetParent !== null || getComputedStyle(btn).display !== 'none') btn.click();
      }
    }
    const overlays = document.querySelectorAll('[style*="z-index"]');
    for (const el of overlays) {
      const style = getComputedStyle(el);
      const z = parseInt(style.zIndex, 10);
      if (z >= 100 && style.position === 'fixed' &&
          (el.textContent?.includes('MASTERY') || el.textContent?.includes('VOTING'))) {
        el.remove();
      }
    }
  });
}

async function waitForGame(hostPage, joinPage, surface, gameMode) {
  // Wait for connection (both clients must be connected)
  const connected = await waitForCondition(async () => {
    const h = await getDebug(hostPage, 'isConnected');
    const j = await getDebug(joinPage, 'isConnected');
    return h && j;
  }, 35000);
  if (!connected) {
    // Debug: log what we got
    const h = await getDebug(hostPage, 'isConnected');
    const j = await getDebug(joinPage, 'isConnected');
    const hWave = await getDebug(hostPage, 'getWaveText');
    console.log(`    [debug] Connection timeout: host=${h}, join=${j}, hostText="${hWave}"`);
    return false;
  }

  // Wait for both players to see each other
  await waitForCondition(async () => {
    const hc = await getDebug(hostPage, 'getPlayerCount');
    const jc = await getDebug(joinPage, 'getPlayerCount');
    return hc >= 2 && jc >= 2;
  }, 20000);

  let started = await hostPage.evaluate((s, m) => {
    const debug = window.__gameDebug;
    if (!debug || typeof debug.startMpScoringProofGame !== 'function') return false;
    return debug.startMpScoringProofGame(s, m);
  }, surface, gameMode);
  if (!started) {
    // Legacy fallback for older branches; the strengthened assertions below
    // still fail if the requested mode does not actually start.
    for (let i = 0; i < 8 && !started; i++) {
      await dismissOverlays(hostPage);
      await dismissOverlays(joinPage);
      started = await clickStartGame(hostPage);
      if (!started) await sleep(2000);
    }
  }

  return await waitForCondition(async () => {
    const tel = await getTelemetry(hostPage);
    if (!tel) return false;
    const expectedPvpMode = gameMode === 'pvp' || gameMode === 'pvpve' ? gameMode : '';
    const expectedPvpEnabled = gameMode === 'pvp' || gameMode === 'pvpve';
    return tel.gameMode === gameMode
      && (tel.pvpMode ?? '') === expectedPvpMode
      && (tel.pvpEnabled ?? false) === expectedPvpEnabled;
  }, 20000);
}

async function screenshot(page, name) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path }).catch(() => {});
  return path;
}

// ---------------------------------------------------------------------------
// Scoring scenario runners
// ---------------------------------------------------------------------------

async function runServerScoringProof(hostPage, scenario) {
  const requested = await hostPage.evaluate((m) => {
    const debug = window.__gameDebug;
    if (!debug || typeof debug.runMpScoringProof !== 'function') return false;
    return debug.runMpScoringProof(m);
  }, scenario);
  if (!requested) {
    return {
      ok: false,
      scenario,
      reason: 'debug_api_unavailable',
      mode: {
        gameMode: 'unknown',
        pvpMode: '',
        pvpEnabled: false,
        expectedGameMode: scenario,
        expectedPvpMode: scenario === 'pvp' || scenario === 'pvpve' ? scenario : '',
        expectedPvpEnabled: scenario === 'pvp' || scenario === 'pvpve',
        modeMatches: false,
      },
    };
  }

  let latest = null;
  await waitForCondition(async () => {
    latest = await getDebug(hostPage, 'getMpScoringProofState');
    return latest?.result?.scenario === scenario;
  }, 10000, 250);
  return latest?.result ?? {
    ok: false,
    scenario,
    reason: 'proof_result_timeout',
    mode: {
      gameMode: latest?.gameMode ?? 'unknown',
      pvpMode: latest?.pvpMode ?? '',
      pvpEnabled: latest?.pvpEnabled ?? false,
      expectedGameMode: scenario,
      expectedPvpMode: scenario === 'pvp' || scenario === 'pvpve' ? scenario : '',
      expectedPvpEnabled: scenario === 'pvp' || scenario === 'pvpve',
      modeMatches: false,
    },
  };
}

function proofDetails(result, extra = {}) {
  return {
    ok: result.ok,
    reason: result.reason ?? '',
    gameMode: result.mode?.gameMode ?? 'unknown',
    pvpMode: result.mode?.pvpMode ?? '',
    pvpEnabled: result.mode?.pvpEnabled ?? false,
    modeMatches: result.mode?.modeMatches ?? false,
    actorDelta: JSON.stringify(result.actor?.delta ?? {}),
    otherDelta: JSON.stringify(result.other?.delta ?? {}),
    ...extra,
  };
}

/**
 * Waves mode: two players, let them play, verify they have DIFFERENT scores
 * (per-player isolation — not shared/pooled).
 */
async function runWavesScoreIsolation(hostPage, joinPage, surface) {
  console.log(`  [waves] Starting score isolation test on ${surface}...`);
  const result = await runServerScoringProof(hostPage, 'waves');
  const actorDelta = result.actor?.delta ?? {};
  const otherDelta = result.other?.delta ?? {};
  const scoringDelta = actorDelta.score > 0 && actorDelta.enemyKills > 0;
  const otherUnchanged = (otherDelta.score ?? 0) === 0
    && (otherDelta.enemyKills ?? 0) === 0
    && (otherDelta.kills ?? 0) === 0;

  return {
    passed: result.ok && result.mode?.modeMatches && scoringDelta && otherUnchanged,
    details: proofDetails(result, { scoringDelta, otherUnchanged }),
  };
}

/**
 * KOTH mode: host player waits, join player (if in zone) gets zoneTime.
 * Verifies that zoneTime is tracked per-player in telemetry.
 */
async function runKothZoneTimeIsolation(hostPage, joinPage, surface) {
  console.log(`  [koth] Starting zone time isolation test on ${surface}...`);
  const result = await runServerScoringProof(hostPage, 'king');
  const actorDelta = result.actor?.delta ?? {};
  const otherDelta = result.other?.delta ?? {};
  const zoneDelta = actorDelta.zoneTime > 0;
  const otherUnchanged = (otherDelta.zoneTime ?? 0) === 0;

  return {
    passed: result.ok && result.mode?.modeMatches && zoneDelta && otherUnchanged,
    details: proofDetails(result, { zoneDelta, otherUnchanged }),
  };
}

/**
 * PvP mode: verify that kills field is exposed in telemetry per-player.
 * In headless we can't guarantee Player A kills Player B,
 * so we verify structural correctness: kills field is tracked per-player.
 */
async function runPvpKillAttribution(hostPage, joinPage, surface) {
  console.log(`  [pvp] Starting kill attribution test on ${surface}...`);
  const result = await runServerScoringProof(hostPage, 'pvp');
  const actorDelta = result.actor?.delta ?? {};
  const otherDelta = result.other?.delta ?? {};
  const pvpCredit = actorDelta.kills > 0 && actorDelta.totalDamageDealt > 0;
  const victimNoCredit = (otherDelta.kills ?? 0) === 0
    && (otherDelta.totalDamageDealt ?? 0) === 0
    && (actorDelta.score ?? 0) === 0
    && (actorDelta.enemyKills ?? 0) === 0;

  return {
    passed: result.ok && result.mode?.modeMatches && pvpCredit && victimNoCredit,
    details: proofDetails(result, { pvpCredit, victimNoCredit }),
  };
}

/**
 * PvPvE mode: verify both score (enemy kills) and kills (PvP) are tracked.
 */
async function runPvpveScoring(hostPage, joinPage, surface) {
  console.log(`  [pvpve] Starting PvPvE scoring test on ${surface}...`);
  const result = await runServerScoringProof(hostPage, 'pvpve');
  const actorDelta = result.actor?.delta ?? {};
  const otherDelta = result.other?.delta ?? {};
  const enemyScoring = actorDelta.score > 0 && actorDelta.enemyKills > 0;
  const pvpScoring = actorDelta.kills > 0 && actorDelta.totalDamageDealt > 0;
  const separateFields = enemyScoring && pvpScoring;
  const otherUnchanged = (otherDelta.score ?? 0) === 0
    && (otherDelta.enemyKills ?? 0) === 0
    && (otherDelta.kills ?? 0) === 0;

  return {
    passed: result.ok && result.mode?.modeMatches && separateFields && otherUnchanged,
    details: proofDetails(result, { enemyScoring, pvpScoring, separateFields, otherUnchanged }),
  };
}

/**
 * Rainbow mode: scoring same as Waves (SP-side color multiplier only).
 */
async function runRainbowScoring(hostPage, joinPage, surface) {
  console.log(`  [rainbow] Starting rainbow scoring test on ${surface}...`);

  const samples = { host: [], join: [] };
  for (let i = 0; i < 12; i++) {
    const h = await getTelemetry(hostPage);
    const j = await getTelemetry(joinPage);
    if (h) samples.host.push(h);
    if (j) samples.join.push(j);
    await sleep(1000);
  }

  const hostLast = samples.host[samples.host.length - 1];
  const joinLast = samples.join[samples.join.length - 1];

  const gameMode = hostLast?.gameMode ?? 'unknown';
  const hostScore = hostLast?.player?.score ?? 0;
  const joinScore = joinLast?.player?.score ?? 0;

  const scoreFieldExposed = typeof hostLast?.player?.score === 'number'
    && typeof joinLast?.player?.score === 'number';

  return {
    passed: scoreFieldExposed,
    details: {
      gameMode,
      hostScore,
      joinScore,
      scoreFieldExposed,
      note: 'Rainbow uses score field (same as Waves). SP color multiplier not applied in MP.',
    },
  };
}

// ---------------------------------------------------------------------------
// Run a single scenario session (connects 2 clients, runs scenario, disconnects)
// ---------------------------------------------------------------------------

async function runScenario(scenarioName, scenarioFn, surface, gameModeOverride) {
  console.log(`\n=== Scenario: ${scenarioName} (${surface}) ===`);
  // Use 2 separate browsers (like mp-verify.mjs) — SwiftShader is per-process
  let hostBrowser = null;
  let joinBrowser = null;

  try {
    console.log('  Launching browsers (sequential to reduce CPU spike)...');
    hostBrowser = await launchBrowser();
    await sleep(1000);
    joinBrowser = await launchBrowser();

    const hostPage = await createPage(hostBrowser);
    const joinPage = await createPage(joinBrowser);

    // Navigate both clients
    const opts = gameModeOverride ? { gameMode: gameModeOverride } : {};
    console.log('  Navigating Host...');
    await navigateMP(hostPage, surface, 'Host', opts);
    console.log('  Navigating Join...');
    await navigateMP(joinPage, surface, 'Join', opts);

    // Wait for game to start
    const gameStarted = await waitForGame(hostPage, joinPage, surface, gameModeOverride || 'waves');
    if (!gameStarted) {
      console.log('  [FAIL] Game did not start within timeout');
      return {
        name: scenarioName, surface, passed: false,
        details: { error: 'Game start timeout' },
      };
    }

    console.log('  Game started, running scenario...');
    await sleep(3000); // Let game settle

    const result = await scenarioFn(hostPage, joinPage, surface);
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${scenarioName}`);
    console.log(`    Details: ${JSON.stringify(result.details, null, 2).replace(/\n/g, '\n    ')}`);

    await screenshot(hostPage, `${scenarioName}-${surface}-host`);
    await screenshot(joinPage, `${scenarioName}-${surface}-join`);

    return { name: scenarioName, surface, ...result };
  } catch (err) {
    console.error(`  [ERROR] ${scenarioName}: ${err.message}`);
    return { name: scenarioName, surface, passed: false, details: { error: err.message } };
  } finally {
    if (hostBrowser) await hostBrowser.close().catch(() => {});
    if (joinBrowser) await joinBrowser.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('MP Scoring Scenarios (s44r17-03)');
  console.log('==================================');
  console.log(`Surface: ${SURFACE}`);
  console.log(`Mode filter: ${MODE_FILTER || 'all'}`);
  console.log(`Base URL: ${BASE_URL}`);

  // Kill stale server processes
  killPortProcesses([COLYSEUS_PORT]);
  await sleep(1000);

  let colyseusServer = null;
  try {
    console.log('\nStarting Colyseus server...');
    colyseusServer = await startColyseusServer();
    // Wait for HTTP health endpoint to be ready before connecting clients
    const serverReady = await waitForServer(`http://localhost:${COLYSEUS_PORT}/health`, 15000);
    if (!serverReady) {
      console.warn('  [WARN] Colyseus health endpoint not ready — proceeding anyway');
    } else {
      console.log('  Colyseus health endpoint ready');
    }
    console.log('  Colyseus running on port ' + COLYSEUS_PORT);

    const allResults = [];

    // Define scenarios: [filter-key, display-name, fn, gameMode-override]
    const scenarios = [
      ['waves', 'waves_score_isolation', runWavesScoreIsolation, null],
      ['koth', 'koth_zone_time_isolation', runKothZoneTimeIsolation, 'king'],
      ['pvp', 'pvp_kill_attribution', runPvpKillAttribution, 'pvp'],
      ['pvpve', 'pvpve_scoring_fields', runPvpveScoring, 'pvpve'],
    ];

    for (const [modeKey, name, fn, modeOverride] of scenarios) {
      if (MODE_FILTER && MODE_FILTER !== modeKey) continue;

      const result = await runScenario(name, fn, SURFACE, modeOverride);
      allResults.push(result);

      // Small delay between scenarios to avoid port conflicts
      await sleep(2000);
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    let passed = 0;
    let failed = 0;
    for (const r of allResults) {
      const status = r.passed ? 'PASS' : 'FAIL';
      console.log(`  [${status}] ${r.name} (${r.surface})`);
      if (r.passed) passed++;
      else failed++;
    }
    console.log(`\nTotal: ${passed}/${allResults.length} passed`);

    if (GENERATE_REPORT || allResults.length > 0) {
      generateHtmlReport(allResults);
      console.log(`\nReport: ${REPORT_PATH}`);
    }

    process.exitCode = failed > 0 ? 1 : 0;

  } catch (err) {
    console.error('Fatal error:', err);
    process.exitCode = 1;
  } finally {
    if (colyseusServer) {
      colyseusServer.kill('SIGTERM');
      await sleep(1000);
    }
    killPortProcesses([COLYSEUS_PORT]);
  }
}

// ---------------------------------------------------------------------------
// HTML report generation
// ---------------------------------------------------------------------------

function generateHtmlReport(results) {
  const passCount = results.filter(r => r.passed).length;
  const totalCount = results.length;
  const now = new Date().toLocaleString();

  const rows = results.map(r => {
    const status = r.passed ? 'PASS' : 'FAIL';
    const color = r.passed ? '#22aa44' : '#cc3333';
    const detailsStr = r.details
      ? Object.entries(r.details).map(([k, v]) => `<b>${k}:</b> ${v}`).join('<br>')
      : '';
    return `<tr>
      <td style="color:${color};font-weight:bold">[${status}]</td>
      <td>${r.name}</td>
      <td>${r.surface}</td>
      <td style="font-size:0.85em;color:#aaa">${detailsStr}</td>
    </tr>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html>
<head>
<title>MP Scoring Scenarios Report — ${now}</title>
<style>
  body { background:#111; color:#eee; font-family:monospace; padding:20px; }
  h1 { color:#4af; }
  h2 { color:#888; font-size:1em; }
  table { border-collapse:collapse; width:100%; }
  th { text-align:left; padding:8px; background:#222; color:#888; }
  td { padding:6px 10px; border-bottom:1px solid #333; vertical-align:top; }
  .summary { margin:20px 0; padding:15px; background:#1a1a2e; border-radius:8px; }
  .pass { color:#22aa44; }
  .fail { color:#cc3333; }
</style>
</head>
<body>
<h1>MP Scoring Scenarios — s44r17-03</h1>
<h2>Generated: ${now}</h2>
<div class="summary">
  <span class="pass">✓ ${passCount} PASSED</span>&nbsp;&nbsp;
  <span class="fail">✗ ${totalCount - passCount} FAILED</span>&nbsp;&nbsp;
  Total: ${totalCount}
</div>
<table>
  <tr><th>Status</th><th>Scenario</th><th>Surface</th><th>Details</th></tr>
  ${rows}
</table>

<h2 style="margin-top:30px">Mode Coverage</h2>
<table>
  <tr><th>Mode</th><th>Primary Score Field</th><th>Notes</th></tr>
  <tr><td>Waves</td><td>player.score</td><td>Kill points × multiplier, per-player</td></tr>
  <tr><td>King (KOTH)</td><td>player.zoneTime</td><td>Seconds in zone, per-player. Kill score also tracked.</td></tr>
  <tr><td>PvP</td><td>player.kills</td><td>Fractional kills (damage/maxHealth), attributed to shooter</td></tr>
  <tr><td>PvPvE</td><td>player.kills + player.score</td><td>PvP kills → kills field; enemy kills → score field</td></tr>
</table>
</body>
</html>`;

  mkdirSync(resolve(PROJECT_ROOT, 'reports'), { recursive: true });
  writeFileSync(REPORT_PATH, html);
}

main().catch(console.error);
