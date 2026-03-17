import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = 'http://localhost:3456';
mkdirSync('/tmp/s44r23-01-screenshots', { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testSurface(surfaceName) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
           '--disable-dev-shm-usage', '--window-size=800,600'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });

  await page.goto(`${BASE_URL}?quickStart=true&surface=${surfaceName}&debug=true&testMode=true`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await sleep(3000);

  // Try to spawn 200 enemies via the TestHarnessAPI ctx
  const spawnResult = await page.evaluate(() => {
    try {
      const api = window.__TEST_API;
      if (!api || !api.ctx) return { error: 'no ctx' };
      const ctx = api.ctx;
      if (!ctx.enemySpawner) return { error: 'no enemySpawner' };
      
      // Spawn many enemies
      const types = ['grunt', 'wanderer', 'tracker', 'weaver'];
      let spawned = 0;
      for (let i = 0; i < 200; i++) {
        try {
          const type = types[i % types.length];
          ctx.enemySpawner.spawnEnemy(type);
          spawned++;
        } catch(e) { /* skip */ }
      }
      return { spawned, totalEnemies: ctx.enemySpawner.getEnemies().length };
    } catch(e) {
      return { error: e.message };
    }
  });
  console.log(`[${surfaceName}] Spawn result:`, JSON.stringify(spawnResult));
  
  // Wait for a couple frames to apply visibility
  await sleep(2000);
  
  // Check telemetry
  const state = await page.evaluate(() => {
    const t = window.__GAME_TELEMETRY;
    if (!t) return { error: 'no telemetry' };
    let invisible = 0, dim = 0, visible = 0;
    const samples = [];
    for (const e of (t.enemies || [])) {
      const icb = e.instanceColorBrightness ?? 1.0;
      if (icb < 0.05) invisible++;
      else if (icb < 0.5) dim++;
      else visible++;
      if (samples.length < 5) samples.push(icb?.toFixed(3));
    }
    return { count: t.enemies?.length, invisible, dim, visible, samples };
  });
  console.log(`[${surfaceName}] State after spawn:`, JSON.stringify(state));
  
  await page.screenshot({ path: `/tmp/s44r23-01-screenshots/${surfaceName}-stress-${Date.now()}.png` });
  
  const passed = (state?.invisible ?? 0) === 0;
  console.log(`[${surfaceName}] ${passed ? 'PASS' : 'FAIL'}`);
  
  await browser.close();
  return { surface: surfaceName, passed, state };
}

console.log('Testing with 200 enemies stress-spawn...\n');
const results = [];
for (const surface of ['sphere-tunnel', 'cube-ring', 'torus']) {
  console.log(`=== ${surface} ===`);
  try {
    results.push(await testSurface(surface));
  } catch(e) {
    console.error(`ERROR:`, e.message);
    results.push({ surface, passed: false, error: e.message });
  }
}

console.log('\n=== SUMMARY ===');
for (const r of results) {
  const inv = r.state?.invisible ?? '?';
  const total = r.state?.count ?? '?';
  console.log(`${r.surface}: ${r.passed ? 'PASS' : 'FAIL'} — ${inv}/${total} invisible`);
}
const allPass = results.every(r => r.passed);
process.exit(allPass ? 0 : 1);
