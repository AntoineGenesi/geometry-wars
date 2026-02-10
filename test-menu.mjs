import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox']
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
await page.setCacheEnabled(false);
console.log('Navigating to http://localhost:3000...');
await page.goto('http://localhost:3000?v=' + Date.now(), { waitUntil: 'load', timeout: 30000 });
console.log('Page loaded, waiting 3s...');
await new Promise(r => setTimeout(r, 3000));
console.log('Taking main menu screenshot...');
await page.screenshot({ path: '/tmp/menu-v5-main.png' });
console.log('Main menu screenshot saved');

// Also click QUICK GAME and screenshot
console.log('Clicking QUICK GAME button...');
await page.evaluate(() => {
  const btn = document.querySelector('[data-mode="single"]');
  if (btn) btn.click();
});
await new Promise(r => setTimeout(r, 1500));
console.log('Taking surface selection screenshot...');
await page.screenshot({ path: '/tmp/menu-v5-surface.png' });
console.log('Surface selection screenshot saved');

await browser.close();
console.log('Done');
