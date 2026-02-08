/**
 * Automated benchmark runner using Puppeteer headless Chrome.
 *
 * Usage:
 *   node scripts/run-benchmark.mjs
 *
 * Requires:
 *   - Vite dev server running on port 3000 (or pass PORT env)
 *   - puppeteer installed
 */

import puppeteer from 'puppeteer';

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}/?mode=benchmark`;
const TIMEOUT_MS = 300_000; // 5 minutes max

async function main() {
  console.log(`[Benchmark] Launching headless Chrome...`);
  console.log(`[Benchmark] URL: ${URL}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,720',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Collect console logs
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('benchmark') || text.includes('Benchmark') || text.includes('[Main]')) {
      console.log(`[Browser] ${text}`);
    }
  });

  page.on('pageerror', err => {
    console.error(`[Browser Error] ${err.message}`);
  });

  console.log(`[Benchmark] Navigating to benchmark...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Wait a moment for Vite HMR to settle and the game to initialize
  await new Promise(r => setTimeout(r, 5000));

  // Wait for benchmark to finish
  console.log(`[Benchmark] Waiting for benchmark to complete (timeout: ${TIMEOUT_MS / 1000}s)...`);

  const startTime = Date.now();
  let results = null;

  while (Date.now() - startTime < TIMEOUT_MS) {
    const done = await page.evaluate(() => (window).__benchmarkDone);
    if (done) {
      results = await page.evaluate(() => (window).__benchmarkResults);
      break;
    }
    await new Promise(r => setTimeout(r, 2000));
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[Benchmark] Waiting... (${elapsed}s elapsed)`);
  }

  await browser.close();

  if (!results) {
    console.error('[Benchmark] TIMEOUT - benchmark did not complete');
    process.exit(1);
  }

  console.log('\n===== BENCHMARK RESULTS =====\n');
  console.log('| Entity Count | Avg FPS | Min FPS | Max FPS | Std Dev |');
  console.log('|-------------|---------|---------|---------|---------|');
  for (const r of results) {
    const ec = String(r.entityCount).padStart(11);
    const af = String(r.avgFps).padStart(7);
    const mf = String(r.minFps).padStart(7);
    const xf = String(r.maxFps).padStart(7);
    const sd = String(r.stdDev).padStart(7);
    console.log(`|${ec} |${af} |${mf} |${xf} |${sd} |`);
  }
  console.log('');

  // Output JSON
  console.log(JSON.stringify(results, null, 2));

  return results;
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
