/**
 * s44r23-01 verification: spawn 200 enemies, check no invisible front-side enemies.
 * Specifically tests that enemies with clear line-of-sight (front-side) don't go invisible
 * after s44r22-01 lowered the dimming floor to 0.08.
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = 'http://localhost:3456';
mkdirSync('/tmp/s44r23-01-screenshots', { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testSurface(surfaceName) {
  console.log(`\n[${surfaceName}] Starting test...`);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
           '--disable-dev-shm-usage', '--window-size=640,480'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480 });
  
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(`${BASE_URL}?quickStart=true&surface=${surfaceName}&debug=true&testMode=true`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await sleep(4000); // Wait for game to start

  // Clear existing enemies and spawn 200 at spread UV positions
  const spawnResult = await page.evaluate(async () => {
    const api = window.__TEST_API;
    if (!api) return { error: 'no TEST API' };
    
    try {
      await api.clearEnemies();
    } catch(e) {}
    
    const types = ['grunt', 'wanderer', 'tracker', 'weaver', 'drifter'];
    const spawned = [];
    
    // Spawn 200 enemies spread across the surface (various UV positions)
    for (let i = 0; i < 200; i++) {
      const u = (i % 20) / 20.0;  // 0.0 to 0.95
      const v = Math.floor(i / 20) / 10.0;  // 0.0 to 0.9
      const type = types[i % types.length];
      try {
        await api.spawnEnemy(type, u, v);
        spawned.push({ u, v, type });
      } catch(e) {
        // Try without UV
        try {
          await api.spawnEnemy(type);
        } catch(e2) {}
      }
    }
    
    return { attemptedSpawn: 200, spawned: spawned.length };
  });
  console.log(`[${surfaceName}] Spawn attempt:`, JSON.stringify(spawnResult));
  
  // Wait for visibility to settle (DepthOcclusionSystem lerps)
  await sleep(3000);
  
  // Check enemy telemetry
  const telemetry = await page.evaluate(() => {
    const t = window.__GAME_TELEMETRY;
    if (!t || !t.enemies) return { error: 'no telemetry' };
    
    let invisible = 0, dim = 0, visible = 0, dimSamples = [];
    for (const e of t.enemies) {
      const icb = e.instanceColorBrightness ?? 1.0;
      if (!isFinite(icb) || icb < 0.05) {
        invisible++;
        dimSamples.push({ icb: icb?.toFixed(3) ?? 'NaN', u: e.surfaceU?.toFixed(2), v: e.surfaceV?.toFixed(2) });
      } else if (icb < 0.5) {
        dim++;
      } else {
        visible++;
      }
    }
    return {
      total: t.enemies.length,
      invisible,
      dim,
      visible,
      invisibleSamples: dimSamples.slice(0, 5),
    };
  });
  console.log(`[${surfaceName}] Telemetry:`, JSON.stringify(telemetry));
  
  await page.screenshot({ path: `/tmp/s44r23-01-screenshots/${surfaceName}-200enemies.png` });
  
  const passed = (telemetry?.invisible ?? 1) === 0 && (telemetry?.total ?? 0) > 0;
  console.log(`[${surfaceName}] ${passed ? '✓ PASS' : '✗ FAIL'} — ${telemetry?.invisible}/${telemetry?.total} invisible`);
  
  await browser.close();
  return { surface: surfaceName, passed, telemetry };
}

const surfaces = ['sphere-tunnel', 'cube-ring', 'torus', 'sphere'];
const results = [];
for (const s of surfaces) {
  try {
    results.push(await testSurface(s));
  } catch(e) {
    console.error(`[${s}] ERROR:`, e.message);
    results.push({ surface: s, passed: false, error: e.message });
  }
}

console.log('\n=== FINAL RESULTS ===');
for (const r of results) {
  const inv = r.telemetry?.invisible ?? '?';
  const total = r.telemetry?.total ?? '?';
  console.log(`${r.surface}: ${r.passed ? 'PASS' : 'FAIL'} — ${inv}/${total} invisible enemies`);
}
const allPass = results.every(r => r.passed);
console.log(`\nOverall: ${allPass ? 'ALL PASS' : 'SOME FAILED'}`);
process.exit(allPass ? 0 : 1);
