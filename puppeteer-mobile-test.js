const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto('http://localhost:3034', { waitUntil: 'networkidle0', timeout: 15000 });
  await page.waitForSelector('#start-menu', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 2000));
  
  const ss1 = await page.screenshot({ encoding: 'base64' });
  fs.writeFileSync('/tmp/mobile-main-menu.png', Buffer.from(ss1, 'base64'));
  console.log('Main menu screenshot saved');

  // Click Quick Game
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.oval-btn');
    for (const btn of btns) {
      if (btn.textContent.includes('QUICK') || btn.textContent.includes('Quick')) {
        btn.click(); break;
      }
    }
  });
  await new Promise(r => setTimeout(r, 400));
  const ss2 = await page.screenshot({ encoding: 'base64' });
  fs.writeFileSync('/tmp/mobile-quick-game.png', Buffer.from(ss2, 'base64'));
  console.log('Quick game screenshot saved');

  // Back + LAN
  await page.evaluate(() => {
    const back = document.querySelector('.back-btn'); 
    if (back) back.click();
  });
  await new Promise(r => setTimeout(r, 200));
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.oval-btn');
    for (const btn of btns) {
      if (btn.textContent.includes('LAN') || btn.textContent.includes('LOCAL')) {
        btn.click(); break;
      }
    }
  });
  await new Promise(r => setTimeout(r, 400));
  const ss3 = await page.screenshot({ encoding: 'base64' });
  fs.writeFileSync('/tmp/mobile-lan.png', Buffer.from(ss3, 'base64'));
  console.log('LAN screenshot saved');

  await browser.close();
  console.log('Done!');
})().catch(e => { console.error(e); process.exit(1); });
