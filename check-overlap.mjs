import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--disable-gpu', '--disable-software-rasterizer', '--no-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Check at half-screen (50% width, simulating split-screen)
  await page.setViewport({ width: 480, height: 1080 });
  await page.goto('http://localhost:3044/', { waitUntil: 'networkidle2' });
  
  // Wait for menu to appear
  await page.waitForSelector('#start-menu', { timeout: 10000 }).catch(() => {});
  
  // Check button positions
  const buttons = await page.evaluate(() => {
    const startBtn = document.querySelector('#surface-start-btn');
    const livesDisplay = document.getElementById('lives-display');
    
    let info = {
      startBtn: null,
      livesDisplay: null
    };
    
    if (startBtn) {
      const rect = startBtn.getBoundingClientRect();
      info.startBtn = { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
    }
    
    if (livesDisplay) {
      const rect = livesDisplay.getBoundingClientRect();
      info.livesDisplay = { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
    }
    
    return info;
  });
  
  console.log('Button positions at 480x1080 (half-screen):');
  console.log(JSON.stringify(buttons, null, 2));
  
  // Save a screenshot
  await page.screenshot({ path: '/tmp/half-screen.png' });
  console.log('Screenshot saved to /tmp/half-screen.png');
  
  await browser.close();
})();
