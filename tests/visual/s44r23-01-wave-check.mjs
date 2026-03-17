import puppeteer from 'puppeteer';
import { mkdirSync } from 'fs';

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = 'http://localhost:3456';
mkdirSync('/tmp/s44r23-01-screenshots', { recursive: true });

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

await page.goto(`${BASE_URL}?quickStart=true&surface=sphere-tunnel&debug=true&testMode=true`, {
  waitUntil: 'domcontentloaded', timeout: 30000,
});
await page.waitForSelector('canvas', { timeout: 15000 });
await sleep(3000);

// Check game state every 5 seconds for 60 seconds
for (let i = 0; i < 12; i++) {
  await sleep(5000);
  const state = await page.evaluate(() => {
    const t = window.__GAME_TELEMETRY;
    const api = window.__TEST_API;
    let gs = null;
    try { gs = api?.getGameState?.(); } catch(e) {}
    if (!t) return { error: 'no telemetry' };
    
    let invisible = 0, dim = 0, visible = 0;
    for (const e of (t.enemies || [])) {
      const icb = e.instanceColorBrightness ?? 1.0;
      if (icb < 0.05) invisible++;
      else if (icb < 0.5) dim++;
      else visible++;
    }
    return {
      wave: gs?.wave ?? t.wave,
      enemyCount: t.enemies?.length ?? 0,
      invisible, dim, visible,
    };
  });
  console.log(`t=${(i+1)*5}s:`, JSON.stringify(state));
}

await page.screenshot({ path: '/tmp/s44r23-01-screenshots/sphere-tunnel-60s.png' });
await browser.close();
console.log('Done');
