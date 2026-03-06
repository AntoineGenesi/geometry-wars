import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--disable-gpu', '--disable-software-rasterizer', '--no-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Check at half-screen
  await page.setViewport({ width: 480, height: 1080 });
  
  // Clear cache and reload
  await page.goto('http://localhost:3044/?nocache=' + Date.now(), { waitUntil: 'networkidle2' });
  
  // Wait for menu to appear
  await page.waitForSelector('#start-menu', { timeout: 10000 }).catch(() => {});
  
  // Wait longer for content to load
  await new Promise(r => setTimeout(r, 2000));
  
  // Click on QUICK GAME button
  const allBtns = await page.$$('#start-menu .oval-btn');
  if (allBtns.length > 1) {
    await allBtns[1].click();
    console.log('Clicked QUICK GAME button');
    
    // Wait for surface section to appear
    await new Promise(r => setTimeout(r, 500));
    
    // Scroll down to see the buttons
    const scrolled = await page.evaluate(() => {
      const surfaceSection = document.querySelector('#start-menu .surface-section .scrollable-content');
      if (surfaceSection) {
        surfaceSection.scrollTop = surfaceSection.scrollHeight;
        return true;
      }
      return false;
    });
    
    if (scrolled) {
      console.log('Scrolled to bottom');
    }
    
    // Wait a bit
    await new Promise(r => setTimeout(r, 300));
    
    // Check button positions
    const info = await page.evaluate(() => {
      const startBtn = document.querySelector('#surface-start-btn');
      const backBtn = document.querySelector('#surface-back');
      const subPanel = document.querySelector('#start-menu .sub-panel');
      
      let data = {
        subPanelDisplay: subPanel ? window.getComputedStyle(subPanel).display : 'N/A',
        subPanelFlexDir: subPanel ? window.getComputedStyle(subPanel).flexDirection : 'N/A',
        startBtn: null,
        backBtn: null,
        spacing: 'N/A'
      };
      
      if (startBtn) {
        const rect = startBtn.getBoundingClientRect();
        data.startBtn = { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) };
      }
      
      if (backBtn) {
        const rect = backBtn.getBoundingClientRect();
        data.backBtn = { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) };
      }
      
      // Check spacing
      if (data.startBtn && data.backBtn) {
        const gap = data.backBtn.top - data.startBtn.bottom;
        data.spacing = gap >= 0 ? `${gap}px gap (no overlap)` : `${Math.abs(gap)}px overlap (BAD)`;
      }
      
      return data;
    });
    
    console.log('Button layout after fix (with cache bust):');
    console.log(JSON.stringify(info, null, 2));
    
    // Take screenshot
    await page.screenshot({ path: '/tmp/half-screen-fixed2.png' });
    console.log('Screenshot saved to /tmp/half-screen-fixed2.png');
  }
  
  await browser.close();
})();
