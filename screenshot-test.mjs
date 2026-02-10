import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
    ]
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });

  console.log('Navigating to http://localhost:3000...');
  await page.goto('http://localhost:3000?v=' + Date.now(), { waitUntil: 'load', timeout: 60000 });

  console.log('Waiting 3 seconds...');
  await page.waitForTimeout(3000);

  console.log('Taking screenshot 1: main menu...');
  await page.screenshot({ path: '/tmp/menu-v6-main.png' });

  console.log('Clicking QUICK GAME...');
  await page.click('[data-mode="single"]');
  await page.waitForTimeout(1500);

  console.log('Taking screenshot 2: surface select...');
  await page.screenshot({ path: '/tmp/menu-v6-surface.png' });

  console.log('Clicking BACK...');
  await page.click('#surface-back');
  await page.waitForTimeout(1000);

  console.log('Taking screenshot 3: back to main...');
  await page.screenshot({ path: '/tmp/menu-v6-back.png' });

  await browser.close();
  console.log('Done!');
})();
