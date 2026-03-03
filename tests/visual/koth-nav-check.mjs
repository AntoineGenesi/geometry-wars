import puppeteer from 'puppeteer';
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

await page.goto('http://localhost:3099/', { waitUntil: 'domcontentloaded', timeout: 20000 });
await sleep(3000);

// Click Quick Game
await page.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const btn = btns.find(b => b.textContent?.includes('QUICK GAME'));
  if (btn) btn.click();
});
await sleep(1500);

// Get all clickable elements and their text
const elements = await page.evaluate(() => {
  const all = Array.from(document.querySelectorAll('button, [data-mode-type], [data-surface], li, .mode-item, .game-mode-btn'));
  return all.map(el => ({
    tag: el.tagName,
    text: el.textContent?.trim().substring(0, 60),
    dataMode: el.getAttribute?.('data-mode-type'),
    dataSurface: el.getAttribute?.('data-surface'),
    id: el.id,
    className: el.className?.substring(0, 40),
  }));
});

console.log('Clickable elements after Quick Game:', JSON.stringify(elements.slice(0, 20), null, 2));

await page.screenshot({ path: '/tmp/nav-after-qg.png' });

await browser.close();
