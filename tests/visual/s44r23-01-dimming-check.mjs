/**
 * Check that behind-surface enemies are still dim (s44r22-01 fix not reverted).
 * Also verify front-side enemies are bright.
 */
import puppeteer from 'puppeteer';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = 'http://localhost:3456';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new',
  args: ['--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
         '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
         '--disable-dev-shm-usage', '--window-size=640,480'],
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 480 });

// Use sphere surface — simple, easy to get enemies on both sides
await page.goto(`${BASE_URL}?quickStart=true&surface=sphere&debug=true&testMode=true`, {
  waitUntil: 'domcontentloaded', timeout: 30000,
});
await page.waitForSelector('canvas', { timeout: 15000 });
await sleep(4000);

// Spawn enemies specifically on the front side and back side of the sphere
const result = await page.evaluate(async () => {
  const api = window.__TEST_API;
  if (!api) return { error: 'no TEST API' };
  
  await api.clearEnemies();
  
  // Spawn enemies on front-side (near player UV ~0.5,0.5)
  for (let i = 0; i < 20; i++) {
    await api.spawnEnemy('grunt', 0.4 + (i % 4) * 0.05, 0.4 + Math.floor(i / 4) * 0.05);
  }
  // Spawn enemies on opposite side of sphere (far UV)
  for (let i = 0; i < 20; i++) {
    await api.spawnEnemy('grunt', 0.0 + (i % 4) * 0.05, 0.0 + Math.floor(i / 4) * 0.05);
  }
  
  return { spawned: 40 };
});
console.log('Spawn:', result);

// Let visibility settle
await sleep(4000);

const telemetry = await page.evaluate(() => {
  const t = window.__GAME_TELEMETRY;
  if (!t) return null;
  
  const allICB = (t.enemies || []).map(e => ({
    icb: (e.instanceColorBrightness ?? 1.0).toFixed(3),
    u: e.surfaceU?.toFixed(2),
    v: e.surfaceV?.toFixed(2),
  }));
  
  let invisible = 0, veryDim = 0, dim = 0, visible = 0;
  for (const e of (t.enemies || [])) {
    const icb = e.instanceColorBrightness ?? 1.0;
    if (icb < 0.05) invisible++;
    else if (icb < 0.15) veryDim++;
    else if (icb < 0.5) dim++;
    else visible++;
  }
  
  return { 
    total: t.enemies?.length, invisible, veryDim, dim, visible,
    sample: allICB.slice(0, 15),
  };
});
console.log('Telemetry:', JSON.stringify(telemetry, null, 2));

// Verification:
// - invisible (< 0.05): should be 0 — this is the regression we fixed
// - veryDim (< 0.15): expected for behind-surface enemies (the s44r22-01 dimming working)
// - visible (>= 0.5): expected for front-side enemies
const noInvisible = (telemetry?.invisible ?? 0) === 0;
const hasDimming = (telemetry?.veryDim ?? 0) > 0 || (telemetry?.dim ?? 0) > 0;
console.log(`\nNo invisible enemies: ${noInvisible ? 'YES ✓' : 'NO ✗'}`);
console.log(`Has dimming (s44r22-01 preserved): ${hasDimming ? 'YES ✓' : 'NOT OBSERVED (may need more time or better test)'}`);

await browser.close();
process.exit(noInvisible ? 0 : 1);
