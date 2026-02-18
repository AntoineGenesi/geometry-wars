#!/usr/bin/env node
/**
 * Geometry Wars 3D — Performance Benchmark
 *
 * Runs the in-game benchmark (?mode=benchmark) via Puppeteer with SwiftShader
 * and writes structured JSON results.
 *
 * Usage:
 *   node tests/perf/perf-benchmark.mjs
 *   node tests/perf/perf-benchmark.mjs --output tests/perf/results/before-bloom.json
 *
 * SwiftShader runs at ~7 fps headless. The benchmark collects wall-clock data
 * over enough time to produce statistically meaningful samples.
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const outputArgIdx = args.indexOf('--output');
const outputFile = outputArgIdx >= 0
  ? resolve(PROJECT_ROOT, args[outputArgIdx + 1])
  : resolve(__dirname, 'results/baseline.json');

// The entity tier we report as the primary benchmark result
const TARGET_ENTITY_COUNT = 200;

// ---------------------------------------------------------------------------
// Puppeteer config (same as existing visual tests)
// ---------------------------------------------------------------------------

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const PUPPETEER_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=1280,720',
];

// ---------------------------------------------------------------------------
// Dev server management
// ---------------------------------------------------------------------------

const ASSIGNED_PORT = 3043;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function checkPort(port) {
  try {
    const out = execSync(`ss -tlnp 2>/dev/null | grep ':${port} '`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

let devServerProc = null;
let devServerPort = null;

async function ensureDevServer() {
  // Prefer port 3000 (likely already running during development)
  if (checkPort(3000)) {
    devServerPort = 3000;
    console.log('  Dev server found on port 3000');
    return `http://localhost:3000`;
  }
  if (checkPort(ASSIGNED_PORT)) {
    devServerPort = ASSIGNED_PORT;
    console.log(`  Dev server found on port ${ASSIGNED_PORT}`);
    return `http://localhost:${ASSIGNED_PORT}`;
  }

  // Start dev server on assigned port
  devServerPort = ASSIGNED_PORT;
  console.log(`  Starting dev server on port ${ASSIGNED_PORT}...`);

  const nodeDir = '/home/antoine/.nvm/versions/node/v20.19.5/bin';
  const env = {
    ...process.env,
    PATH: `${nodeDir}:/usr/bin:/bin`,
    VITE_PORT: String(ASSIGNED_PORT),
  };

  devServerProc = spawn('node', [`${nodeDir}/vite`], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Wait for server ready signal
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Dev server startup timed out (30s)')),
      30000,
    );

    const checkReady = data => {
      const text = data.toString();
      if (text.includes('Local:') || text.includes('ready in') || text.includes('localhost')) {
        clearTimeout(timeout);
        resolve();
      }
    };

    devServerProc.stdout.on('data', checkReady);
    devServerProc.stderr.on('data', checkReady);
    devServerProc.on('error', err => { clearTimeout(timeout); reject(err); });
  });

  // Extra stabilization time
  await sleep(2000);
  console.log(`  Dev server ready at http://localhost:${ASSIGNED_PORT}`);
  return `http://localhost:${ASSIGNED_PORT}`;
}

function stopDevServer() {
  if (devServerProc) {
    devServerProc.kill('SIGTERM');
    devServerProc = null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('');
  console.log('='.repeat(50));
  console.log('  Geometry Wars 3D — Performance Benchmark');
  console.log('='.repeat(50));
  console.log(`  Target entity count : ${TARGET_ENTITY_COUNT}`);
  console.log(`  Output file         : ${outputFile}`);
  console.log('');

  // Ensure output directory exists
  mkdirSync(dirname(outputFile), { recursive: true });

  let serverBaseUrl;
  try {
    serverBaseUrl = await ensureDevServer();
  } catch (err) {
    console.error(`  ERROR: Could not start dev server: ${err.message}`);
    process.exit(1);
  }

  const benchmarkUrl = `${serverBaseUrl}?mode=benchmark`;
  console.log(`  Benchmark URL: ${benchmarkUrl}`);
  console.log('');

  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: PUPPETEER_ARGS,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Capture page errors
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(err.message));

    // Load the benchmark page
    console.log('  Loading benchmark page...');
    await page.goto(benchmarkUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Poll until benchmark completes (SwiftShader ~7fps → lots of wall-clock time)
    console.log('  Running benchmark (SwiftShader ~7fps, expect 60–180s)...');
    const POLL_MS = 3000;
    const MAX_WAIT_MS = 240000; // 4 minutes
    let elapsed = 0;
    let done = false;

    while (elapsed < MAX_WAIT_MS) {
      await sleep(POLL_MS);
      elapsed += POLL_MS;

      done = await page.evaluate(() => !!(window).__benchmarkDone).catch(() => false);
      if (done) break;

      // Show progress by reading the benchmark overlay text
      const progress = await page.evaluate(() => {
        const divs = document.querySelectorAll('div');
        for (const d of divs) {
          const text = d.innerText || '';
          if (text.includes('Measuring') || text.includes('enemies')) {
            const lines = text.trim().split('\n');
            return lines.slice(-2).join(' | ');
          }
        }
        return 'initializing...';
      }).catch(() => 'running...');

      process.stdout.write(`\r  ${Math.round(elapsed / 1000)}s elapsed: ${progress.substring(0, 70)}  `);
    }
    console.log('');

    if (!done) {
      throw new Error(`Benchmark timed out after ${MAX_WAIT_MS / 1000}s`);
    }

    console.log('  Benchmark complete — extracting results...');

    // Read results from window
    const allResults = await page.evaluate(() => window.__benchmarkResults);

    if (!allResults || !Array.isArray(allResults) || allResults.length === 0) {
      throw new Error('No benchmark results in window.__benchmarkResults');
    }

    // Find the TARGET_ENTITY_COUNT tier (200 entities)
    let targetResult = allResults.find(r => r.entityCount === TARGET_ENTITY_COUNT);
    if (!targetResult) {
      // Fallback: use the tier closest to target
      targetResult = allResults.reduce((prev, curr) =>
        Math.abs(curr.entityCount - TARGET_ENTITY_COUNT) < Math.abs(prev.entityCount - TARGET_ENTITY_COUNT)
          ? curr : prev,
      );
      console.warn(`  WARNING: No exact ${TARGET_ENTITY_COUNT}-entity tier. Using closest: ${targetResult.entityCount}`);
    }

    // Build output JSON (includes all required fields from the task)
    const output = {
      timestamp: new Date().toISOString(),
      entityCount: targetResult.entityCount,
      avgFps: targetResult.avgFps,
      minFps: targetResult.minFps,
      p95FrameTimeMs: targetResult.p95FrameTimeMs ?? 0,
      drawCalls: targetResult.drawCalls ?? 0,
      triangles: targetResult.triangles ?? 0,
      geometries: targetResult.geometries ?? 0,
      // Extra diagnostics
      maxFps: targetResult.maxFps,
      stdDev: targetResult.stdDev,
      frameCount: targetResult.frameCount,
      // All tiers for reference
      allTiers: allResults,
    };

    // Write JSON
    writeFileSync(outputFile, JSON.stringify(output, null, 2));

    // Print human-readable summary
    console.log('');
    console.log('  === Performance Benchmark ===');
    console.log(`  Entity count: ${output.entityCount}`);
    console.log(`  Avg FPS:  ${output.avgFps}`);
    console.log(`  Min FPS:  ${output.minFps}`);
    console.log(`  P95 frame: ${output.p95FrameTimeMs}ms`);
    console.log(`  Draw calls: ${output.drawCalls}`);
    console.log(`  Triangles:  ${output.triangles}`);
    console.log(`  Geometries: ${output.geometries}`);
    console.log('  =============================');
    console.log('');
    console.log(`  Results written to: ${outputFile}`);

    // Report critical console errors (not audio/net noise)
    const critical = consoleErrors.filter(e =>
      !e.includes('AudioContext') &&
      !e.includes('favicon') &&
      !e.includes('SharedArrayBuffer') &&
      !e.includes('net::ERR') &&
      !e.includes('chrome-extension'),
    );
    if (critical.length > 0) {
      console.warn(`\n  Console errors (${critical.length}):`);
      critical.slice(0, 5).forEach(e => console.warn(`    - ${e.substring(0, 100)}`));
    }

    process.exit(0);

  } catch (err) {
    console.error(`\n  ERROR: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopDevServer();
    // Verify server is stopped
    if (devServerPort && devServerPort !== 3000 && checkPort(devServerPort)) {
      try {
        execSync(`fuser -k ${devServerPort}/tcp 2>/dev/null || true`);
      } catch {
        // best effort
      }
    }
  }
}

main();
