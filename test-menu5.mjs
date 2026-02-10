import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.setCacheEnabled(false);
await page.goto('http://localhost:3000?v=' + Date.now(), { waitUntil: 'networkidle0', timeout: 15000 });
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: '/tmp/menu-v6-main.png' });

// Click QUICK GAME
await page.evaluate(() => { document.querySelector('[data-mode="single"]')?.dispatchEvent(new MouseEvent('click', {bubbles:true})); });
await new Promise(r => setTimeout(r, 1500));
await page.screenshot({ path: '/tmp/menu-v6-surface.png' });

// Click BACK
await page.evaluate(() => { document.querySelector('#surface-back')?.dispatchEvent(new MouseEvent('click', {bubbles:true})); });
await new Promise(r => setTimeout(r, 1000));
await page.screenshot({ path: '/tmp/menu-v6-back.png' });

await browser.close();
