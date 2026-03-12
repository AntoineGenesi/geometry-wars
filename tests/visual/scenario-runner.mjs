#!/usr/bin/env node
/**
 * scenario-runner.mjs — Puppeteer-based scenario test runner.
 *
 * Loads scenario JSON from tests/visual/scenarios/*.json, launches the game
 * via Puppeteer (testMode=true), feeds scenarios to window.__SCENARIO_ENGINE,
 * collects results and screenshots, generates an HTML report.
 *
 * CODE PATH: Uses REAL game path: ?quickStart=true → src/main.ts → GameLoop.ts
 *            NOT PlaygroundTestHarness / GameInstance (vitest demos only).
 *
 * Usage:
 *   node tests/visual/scenario-runner.mjs                           # Run all
 *   node tests/visual/scenario-runner.mjs --surface=sphere          # Single surface
 *   node tests/visual/scenario-runner.mjs --scenario=tesla_continuous_damage
 *   node tests/visual/scenario-runner.mjs --report                  # HTML report only
 *   node tests/visual/scenario-runner.mjs --list                    # List all scenarios
 */

import puppeteer from 'puppeteer';
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SCENARIOS_DIR = resolve(__dirname, 'scenarios');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/scenario-runner');
const REPORT_DIR = resolve(PROJECT_ROOT, 'reports');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=640,360',
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
];

// Max ms to wait for a scenario to complete
const SCENARIO_TIMEOUT_MS = 30_000;
// ms to wait for game to initialize
const GAME_INIT_WAIT_MS = 4_000;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const argMap = {};
for (const arg of args) {
  const m = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
  if (m) argMap[m[1]] = m[2] ?? true;
}

const filterSurface = argMap['surface'] ?? null;
const filterScenario = argMap['scenario'] ?? null;
const reportOnly = argMap['report'] === true;
const listOnly = argMap['list'] === true;

// ---------------------------------------------------------------------------
// Scenario loading
// ---------------------------------------------------------------------------

function loadScenarios() {
  const scenarios = [];
  if (!existsSync(SCENARIOS_DIR)) return scenarios;
  for (const f of readdirSync(SCENARIOS_DIR)) {
    if (extname(f) !== '.json') continue;
    try {
      const raw = readFileSync(resolve(SCENARIOS_DIR, f), 'utf-8');
      const def = JSON.parse(raw);
      // Support both single scenario object and array
      if (Array.isArray(def)) scenarios.push(...def);
      else scenarios.push(def);
    } catch (e) {
      console.error(`[scenario-runner] Failed to load ${f}: ${e.message}`);
    }
  }
  return scenarios;
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') pageErrors.push(msg.text());
  });
  return { page, pageErrors };
}

async function navigateToGame(page, surface, extraParams = {}) {
  const params = new URLSearchParams({
    quickStart: 'true',
    surface,
    testMode: 'true',
    debug: 'true',
    ...extraParams,
  });
  const url = `${BASE_URL}?${params}`;
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 15_000 });
  await sleep(GAME_INIT_WAIT_MS);
}

async function waitForTestAPI(page, timeoutMs = 8_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => !!(window.__TEST_API && window.__SCENARIO_ENGINE));
    if (ready) return true;
    await sleep(200);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Run a single scenario
// ---------------------------------------------------------------------------

async function runScenario(page, scenario, surface) {
  console.log(`  [scenario] Running: ${scenario.name} on ${surface}`);

  // Clear prior events in API
  await page.evaluate(() => {
    if (window.__TEST_API) window.__TEST_API.clearEvents();
    if (window.__STATE_RECORDER) window.__STATE_RECORDER.clear();
  });

  // Feed scenario into game process
  const rawScenario = JSON.parse(JSON.stringify(scenario)); // strip any non-serializable

  let result;
  try {
    result = await Promise.race([
      page.evaluate(async (sc) => {
        // Run via TestHarnessAPI.runScenario() which delegates to ScenarioEngine
        return await window.__TEST_API.runScenario(sc);
      }, rawScenario),
      sleep(SCENARIO_TIMEOUT_MS).then(() => ({
        scenarioName: scenario.name,
        passed: false,
        totalSteps: 0,
        stepResults: [],
        startFrame: 0, endFrame: 0, startTime: 0, endTime: 0,
        summary: `TIMEOUT: scenario did not complete within ${SCENARIO_TIMEOUT_MS}ms`,
      })),
    ]);
  } catch (e) {
    result = {
      scenarioName: scenario.name,
      passed: false,
      totalSteps: 0,
      stepResults: [],
      startFrame: 0, endFrame: 0, startTime: 0, endTime: 0,
      summary: `ERROR: ${e.message}`,
    };
  }

  // Take a screenshot
  let screenshotPath = null;
  try {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const safeName = `${scenario.name.replace(/[^a-z0-9_-]/gi, '_')}_${surface}`;
    screenshotPath = resolve(SCREENSHOT_DIR, `${safeName}.png`);
    await page.screenshot({ path: screenshotPath });
  } catch { /* screenshot is best-effort */ }

  return { result, screenshotPath };
}

// ---------------------------------------------------------------------------
// Run all scenarios on a surface
// ---------------------------------------------------------------------------

async function runScenariosOnSurface(browser, scenarios, surface) {
  const { page, pageErrors } = await createPage(browser);
  const surfaceResults = [];

  try {
    await navigateToGame(page, surface);
    const apiReady = await waitForTestAPI(page);
    if (!apiReady) {
      console.warn(`  [scenario-runner] TestHarnessAPI not ready on ${surface} — skipping`);
      page.close().catch(() => {});
      return scenarios.map(sc => ({
        scenario: sc, surface,
        result: { scenarioName: sc.name, passed: false, totalSteps: 0, stepResults: [], startFrame: 0, endFrame: 0, startTime: 0, endTime: 0, summary: 'API not ready' },
        screenshotPath: null,
        pageErrors: [...pageErrors],
      }));
    }

    for (const scenario of scenarios) {
      const { result, screenshotPath } = await runScenario(page, scenario, surface);
      const status = result.passed ? '✓ PASS' : '✗ FAIL';
      console.log(`    ${status}  ${scenario.name}: ${result.summary}`);
      surfaceResults.push({ scenario, surface, result, screenshotPath, pageErrors: [...pageErrors] });
      pageErrors.length = 0; // reset for next scenario
    }
  } finally {
    page.close().catch(() => {});
  }

  return surfaceResults;
}

// ---------------------------------------------------------------------------
// HTML report generation
// ---------------------------------------------------------------------------

function generateHtmlReport(allResults, timestamp) {
  const passed = allResults.filter(r => r.result.passed).length;
  const failed = allResults.filter(r => !r.result.passed).length;

  const rows = allResults.map(r => {
    const status = r.result.passed ? 'pass' : 'fail';
    const screenshotCell = r.screenshotPath
      ? `<a href="${r.screenshotPath}" target="_blank">screenshot</a>` : '—';
    const stepList = r.result.stepResults.map(s => {
      const st = s.assertionPassed === null ? '○' : s.assertionPassed ? '✓' : '✗';
      return `<li class="${s.assertionPassed === false ? 'fail' : ''}">${st} [${s.frame}] ${s.label}${s.assertionError ? ' — ' + s.assertionError : ''}</li>`;
    }).join('');
    return `
      <tr class="${status}">
        <td>${r.scenario.name}</td>
        <td>${r.surface}</td>
        <td class="status">${r.result.passed ? 'PASS' : 'FAIL'}</td>
        <td>${r.result.summary}</td>
        <td>${screenshotCell}</td>
        <td><ul>${stepList}</ul></td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Scenario Runner Report — ${timestamp}</title>
<style>
  body { font-family: monospace; background: #111; color: #ccc; padding: 20px; }
  h1 { color: #fff; }
  .summary { margin: 10px 0; font-size: 1.2em; }
  .pass { color: #4f4; } .fail { color: #f44; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #333; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #222; color: #fff; }
  tr.pass td { background: #0a1a0a; }
  tr.fail td { background: #1a0a0a; }
  .status { font-weight: bold; }
  td.status.pass { color: #4f4; } td.status.fail { color: #f44; }
  ul { margin: 0; padding-left: 18px; }
  li.fail { color: #f88; }
</style>
</head><body>
<h1>Scenario Runner Report</h1>
<p>${timestamp}</p>
<div class="summary">
  <span class="pass">✓ ${passed} passed</span> &nbsp;
  <span class="fail">✗ ${failed} failed</span> &nbsp;
  / ${allResults.length} total
</div>
<table>
  <tr><th>Scenario</th><th>Surface</th><th>Status</th><th>Summary</th><th>Screenshot</th><th>Steps</th></tr>
  ${rows}
</table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const allScenarios = loadScenarios();

  if (listOnly) {
    for (const sc of allScenarios) console.log(`  ${sc.name}: ${sc.description}`);
    return;
  }

  const scenarios = allScenarios.filter(sc => !filterScenario || sc.name === filterScenario);
  const surfaces = filterSurface ? [filterSurface] : ['sphere'];

  if (scenarios.length === 0) {
    console.error('[scenario-runner] No scenarios found. Check tests/visual/scenarios/*.json');
    process.exit(1);
  }

  console.log(`[scenario-runner] Running ${scenarios.length} scenario(s) on ${surfaces.length} surface(s)`);

  const browser = await launchBrowser();
  const allResults = [];

  try {
    for (const surface of surfaces) {
      console.log(`\n[scenario-runner] Surface: ${surface}`);
      const surfaceResults = await runScenariosOnSurface(browser, scenarios, surface);
      allResults.push(...surfaceResults);
    }
  } finally {
    await browser.close();
  }

  // Summary
  const passed = allResults.filter(r => r.result.passed).length;
  const failed = allResults.length - passed;
  console.log(`\n[scenario-runner] Done: ${passed} passed, ${failed} failed`);

  // HTML report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportHtml = generateHtmlReport(allResults, new Date().toISOString());
  mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = resolve(REPORT_DIR, `scenario-runner-${timestamp}.html`);
  writeFileSync(reportPath, reportHtml, 'utf-8');
  console.log(`[scenario-runner] Report: ${reportPath}`);

  // Results JSON
  const resultsPath = resolve(REPORT_DIR, `scenario-runner-latest.json`);
  writeFileSync(resultsPath, JSON.stringify(allResults.map(r => ({
    scenario: r.scenario.name, surface: r.surface,
    passed: r.result.passed, summary: r.result.summary,
  })), null, 2), 'utf-8');

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
