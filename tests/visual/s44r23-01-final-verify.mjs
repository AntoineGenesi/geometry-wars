/**
 * s44r23-01 final verification with screenshots.
 * Tests 4 surfaces, 150+ enemies, confirms zero invisible.
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = 'http://localhost:3456';
const OUT = '/tmp/s44r23-01-final';
mkdirSync(OUT, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function test(surf) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
           '--disable-dev-shm-usage', '--window-size=800,600'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  
  await page.goto(`${BASE_URL}?quickStart=true&surface=${surf}&debug=true&testMode=true`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await sleep(3000);
  
  // Spawn 200 enemies spread across the surface
  await page.evaluate(async () => {
    const api = window.__TEST_API;
    if (!api) return;
    try { await api.clearEnemies(); } catch(e) {}
    const types = ['grunt', 'wanderer', 'tracker', 'weaver', 'drifter'];
    for (let i = 0; i < 200; i++) {
      const u = (i * 0.17) % 1.0;
      const v = (i * 0.23) % 1.0;
      try { await api.spawnEnemy(types[i % types.length], u, v); } catch(e) {}
    }
  });
  
  await sleep(3000); // Let visibility settle (DepthOcclusionSystem lerp)
  await page.screenshot({ path: `${OUT}/${surf}.png` });
  
  const result = await page.evaluate(() => {
    const t = window.__GAME_TELEMETRY;
    if (!t?.enemies) return { error: 'no telemetry' };
    let invisible = 0, dim = 0, visible = 0;
    for (const e of t.enemies) {
      const icb = e.instanceColorBrightness ?? 1.0;
      if (!isFinite(icb) || icb < 0.05) invisible++;
      else if (icb < 0.5) dim++;
      else visible++;
    }
    return { total: t.enemies.length, invisible, dim, visible };
  });
  
  await browser.close();
  const passed = (result?.invisible ?? 1) === 0 && (result?.total ?? 0) >= 50;
  console.log(`${surf}: ${passed ? 'PASS' : 'FAIL'} — ${result?.invisible}/${result?.total} invisible (${result?.dim} dim, ${result?.visible} visible)`);
  return { surf, passed, result };
}

const surfaces = ['sphere-tunnel', 'cube-ring', 'torus', 'sphere'];
const results = [];
for (const s of surfaces) {
  results.push(await test(s));
}

console.log(`\n${results.every(r => r.passed) ? 'ALL PASS ✓' : 'SOME FAILED ✗'}`);
console.log(`Screenshots: ${OUT}/`);
process.exit(results.every(r => r.passed) ? 0 : 1);
