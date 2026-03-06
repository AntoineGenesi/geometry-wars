import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--disable-gpu', '--disable-software-rasterizer', '--no-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Check at full screen first
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('http://localhost:3044/', { waitUntil: 'networkidle2' });
  
  // Wait for menu to appear
  await page.waitForSelector('#start-menu', { timeout: 10000 }).catch(() => {});
  
  // Get all visible elements
  const elements = await page.evaluate(() => {
    const startBtn = document.querySelector('#surface-start-btn');
    const livesDisplay = document.getElementById('lives-display');
    const menuOverlay = document.querySelector('#start-menu .menu-overlay');
    const subPanel = document.querySelector('#start-menu .sub-panel');
    
    let info = {
      startBtn: null,
      livesDisplay: null,
      menuOverlay: null,
      subPanel: null,
      allButtonsInMenu: []
    };
    
    if (startBtn) {
      const rect = startBtn.getBoundingClientRect();
      info.startBtn = { display: window.getComputedStyle(startBtn).display, left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
    }
    
    if (livesDisplay) {
      const rect = livesDisplay.getBoundingClientRect();
      info.livesDisplay = { display: window.getComputedStyle(livesDisplay).display, left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height) };
    }
    
    if (menuOverlay) {
      const rect = menuOverlay.getBoundingClientRect();
      info.menuOverlay = { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) };
    }
    
    if (subPanel) {
      const rect = subPanel.getBoundingClientRect();
      info.subPanel = { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom), width: Math.round(rect.width), height: Math.round(rect.height), display: window.getComputedStyle(subPanel).display };
    }
    
    // Find all buttons with "lives" text
    const allButtons = document.querySelectorAll('button');
    allButtons.forEach(btn => {
      if (btn.textContent && btn.textContent.toLowerCase().includes('lives')) {
        const rect = btn.getBoundingClientRect();
        info.allButtonsInMenu.push({
          id: btn.id,
          class: btn.className,
          text: btn.textContent.substring(0, 50),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom)
        });
      }
    });
    
    return info;
  });
  
  console.log('Elements at 1920x1080:');
  console.log(JSON.stringify(elements, null, 2));
  
  // Save a screenshot
  await page.screenshot({ path: '/tmp/full-screen.png' });
  console.log('Screenshot saved to /tmp/full-screen.png');
  
  await browser.close();
})();
