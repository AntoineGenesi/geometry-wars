import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = 'http://localhost:3456';
const SCREENSHOT_DIR = '/tmp/s44r23-01-screenshots';
mkdirSync(SCREENSHOT_DIR, { recursive: true });

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testSurface(surfaceName) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
           '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
           '--disable-dev-shm-usage', '--window-size=640,480'],
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 480 });
  
  await page.goto(`${BASE_URL}?quickStart=true&surface=${surfaceName}&debug=true&testMode=true`, {
    waitUntil: 'domcontentloaded', timeout: 30000,
  });
  await page.waitForSelector('canvas', { timeout: 15000 });
  await sleep(4000);
  
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${surfaceName}-wave-early.png` });
  console.log(`[${surfaceName}] Early screenshot taken`);
  
  let earlyTelemetry = null;
  try {
    earlyTelemetry = await page.evaluate(() => {
      const telemetry = window.__GAME_TELEMETRY;
      if (!telemetry) return { error: 'no telemetry' };
      let invisible = 0, dim = 0, visible = 0;
      for (const e of (telemetry.enemies || [])) {
        const icb = e.instanceColorBrightness ?? 1.0;
        if (icb < 0.05) invisible++;
        else if (icb < 0.5) dim++;
        else visible++;
      }
      return { enemyCount: telemetry.enemies?.length, invisible, dim, visible };
    });
  } catch(e) { earlyTelemetry = { error: e.message }; }
  console.log(`[${surfaceName}] Early:`, JSON.stringify(earlyTelemetry));
  
  // Wait longer to get to wave 5+
  await sleep(30000);
  
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${surfaceName}-wave-late.png` });
  console.log(`[${surfaceName}] Late screenshot taken`);
  
  let lateTelemetry = null;
  try {
    lateTelemetry = await page.evaluate(() => {
      const telemetry = window.__GAME_TELEMETRY;
      if (!telemetry) return { error: 'no telemetry' };
      let invisible = 0, dim = 0, visible = 0;
      const sample = [];
      for (const e of (telemetry.enemies || [])) {
        const icb = e.instanceColorBrightness ?? 1.0;
        if (icb < 0.05) invisible++;
        else if (icb < 0.5) dim++;
        else visible++;
        if (sample.length < 5) sample.push(icb?.toFixed(3));
      }
      return { enemyCount: telemetry.enemies?.length, invisible, dim, visible, sample };
    });
  } catch(e) { lateTelemetry = { error: e.message }; }
  console.log(`[${surfaceName}] Late:`, JSON.stringify(lateTelemetry));
  
  const passed = (lateTelemetry?.invisible ?? 0) === 0 && (lateTelemetry?.enemyCount ?? 0) > 0;
  console.log(`[${surfaceName}] ${passed ? 'PASS' : 'FAIL'}`);
  
  await browser.close();
  return { surface: surfaceName, passed, lateTelemetry };
}

const results = [];
for (const surface of ['sphere-tunnel', 'cube-ring']) {
  console.log(`\n=== Testing ${surface} ===`);
  try {
    const r = await testSurface(surface);
    results.push(r);
  } catch(e) {
    console.error(`[${surface}] ERROR:`, e.message);
    results.push({ surface, passed: false, error: e.message });
  }
}

console.log('\n=== SUMMARY ===');
for (const r of results) {
  const inv = r.lateTelemetry?.invisible ?? '?';
  const total = r.lateTelemetry?.enemyCount ?? '?';
  console.log(`${r.surface}: ${r.passed ? 'PASS' : 'FAIL'} — ${inv}/${total} invisible`);
}
const allPass = results.every(r => r.passed);
process.exit(allPass ? 0 : 1);
