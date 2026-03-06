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
  
  // Wait a bit more for content to load
  await new Promise(r => setTimeout(r, 1000));
  
  // Click on QUICK GAME button (the second oval button)
  const quickGameBtn = await page.$('button');
  const allBtns = await page.$$('#start-menu .oval-btn');
  console.log(`Found ${allBtns.length} oval buttons`);
  
  // Click QUICK GAME button (should be index 1)
  if (allBtns.length > 1) {
    await allBtns[1].click();
    console.log('Clicked QUICK GAME button');
    
    // Wait for surface section to appear
    await new Promise(r => setTimeout(r, 500));
    
    // Check what's now visible
    const info = await page.evaluate(() => {
      const startBtn = document.querySelector('#surface-start-btn');
      const livesDisplay = document.getElementById('lives-display');
      const surfaceSection = document.querySelector('#start-menu .surface-section');
      
      let data = {
        surfaceSectionVisible: surfaceSection ? window.getComputedStyle(surfaceSection).display !== 'none' : 'N/A',
        startBtn: null,
        livesDisplay: null,
        allMenuElements: []
      };
      
      if (startBtn && startBtn.offsetParent !== null) {
        const rect = startBtn.getBoundingClientRect();
        data.startBtn = { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
      }
      
      if (livesDisplay && livesDisplay.offsetParent !== null) {
        const rect = livesDisplay.getBoundingClientRect();
        data.livesDisplay = { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
      }
      
      // Find all buttons visible on the menu
      const allButtons = document.querySelectorAll('#start-menu button');
      allButtons.forEach(btn => {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const text = btn.textContent.substring(0, 30).trim();
          data.allMenuElements.push({
            id: btn.id,
            text: text,
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom)
          });
        }
      });
      
      return data;
    });
    
    console.log('After clicking QUICK GAME:', JSON.stringify(info, null, 2));
    
    // Save screenshot
    await page.screenshot({ path: '/tmp/half-screen-quick-game.png' });
    console.log('Screenshot saved to /tmp/half-screen-quick-game.png');
  }
  
  await browser.close();
})();
