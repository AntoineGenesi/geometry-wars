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

const errors = [];
page.on('pageerror', err => errors.push(err.message));
page.on('console', msg => { if (msg.type() === 'log') console.log('[PAGE]', msg.text()); });

await page.goto(`${BASE_URL}?quickStart=true&surface=sphere-tunnel&debug=true&testMode=true`, {
  waitUntil: 'domcontentloaded', timeout: 30000,
});
await page.waitForSelector('canvas', { timeout: 15000 });
await sleep(3000);

// Check what the API exposes
const apiState = await page.evaluate(() => {
  const api = window.__TEST_API;
  if (!api) return 'NO TEST API';
  const methods = Object.keys(api);
  const gs = (() => { try { return api.getGameState?.(); } catch(e) { return { error: e.message }; } })();
  return { methods, gameState: gs };
});
console.log('API state:', JSON.stringify(apiState, null, 2));

await browser.close();
