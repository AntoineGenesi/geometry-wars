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
  
  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push(msg.text()));
  
  await page.goto('http://localhost:3047', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);
  
  // Start quick game
  await page.evaluate(() => { document.querySelector('[data-mode="quick"]')?.click(); });
  await sleep(1500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, .btn'));
    btns.find(b => /start/i.test(b.textContent || ''))?.click();
  });
  await sleep(7000);
  
  // Inject debugging into window
  await page.evaluate(() => {
    window.addEventListener('keydown', e => console.log('KEYDOWN:', e.key, e.code));
  });
  
  await page.keyboard.down('ShiftLeft');
  await sleep(300);
  
  const result = await page.evaluate(() => ({
    boostText: document.getElementById('boost-display')?.textContent,
    classes: document.getElementById('boost-display')?.className,
  }));
  console.log('After ShiftLeft down:', JSON.stringify(result));
  
  await page.keyboard.up('ShiftLeft');
  await sleep(200);
  
  // Check logs
  const keyLogs = consoleLogs.filter(l => l.includes('KEYDOWN'));
  console.log('Key events received:', keyLogs);
  
  await browser.close();
})().catch(console.error);
