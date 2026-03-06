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
  const allBtns = await page.$$('#start-menu .oval-btn');
  if (allBtns.length > 1) {
    await allBtns[1].click();
    console.log('Clicked QUICK GAME button');
    
    // Wait for surface section to appear
    await new Promise(r => setTimeout(r, 500));
    
    // Scroll down in the surface section to see the START button
    const scrolled = await page.evaluate(() => {
      const surfaceSection = document.querySelector('#start-menu .surface-section .scrollable-content');
      if (surfaceSection) {
        surfaceSection.scrollTop = surfaceSection.scrollHeight;
        return surfaceSection.scrollHeight;
      }
      return 0;
    });
    
    console.log('Scrolled to bottom, scroll height:', scrolled);
    
    // Wait a bit
    await new Promise(r => setTimeout(r, 300));
    
    // Take screenshot
    await page.screenshot({ path: '/tmp/half-screen-scrolled.png' });
    console.log('Screenshot saved to /tmp/half-screen-scrolled.png');
  }
  
  await browser.close();
})();
