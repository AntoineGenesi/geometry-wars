import puppeteer from 'puppeteer';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
    args: ['--no-sandbox','--disable-setuid-sandbox','--enable-webgl','--use-gl=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,720'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  await page.goto('http://localhost:3047', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);
  
  await page.evaluate(() => { document.querySelector('[data-mode="quick"]')?.click(); });
  await sleep(1500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, .btn'));
    btns.find(b => /start/i.test(b.textContent || ''))?.click();
  });
  await sleep(7000);
  
  // Inject a global listener to intercept updateBoostDisplay calls
  await page.evaluate(() => {
    window.__boostCalls = [];
    // Intercept classList.add on boost element
    const el = document.getElementById('boost-display');
    if (el) {
      const origAdd = el.classList.add.bind(el.classList);
      el.classList.add = (...args) => {
        window.__boostCalls.push({ add: args });
        origAdd(...args);
      };
    }
  });
  
  // Press Shift and wait
  await page.keyboard.down('ShiftLeft');
  await sleep(500);
  await page.keyboard.up('ShiftLeft');
  await sleep(300);
  
  // Check intercepted calls  
  const debug = await page.evaluate(() => ({
    calls: window.__boostCalls,
    el: {
      text: document.getElementById('boost-display')?.textContent,
      classes: document.getElementById('boost-display')?.className,
    }
  }));
  console.log('classList.add calls intercepted:', debug.calls);
  console.log('Current element state:', debug.el);
  
  // Try calling UIHelpers directly from page
  const uiResult = await page.evaluate(() => {
    // Find if UIHelpers is accessible
    const updateBoostFn = window.__UIHelpers_updateBoost;
    return { hasUIHelpers: !!updateBoostFn };
  });
  console.log('UIHelpers accessible?', uiResult);
  
  await browser.close();
})().catch(console.error);
