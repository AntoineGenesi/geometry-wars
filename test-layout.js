const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    page.setViewport({ width: 1200, height: 800 });

    // Navigate to the game
    await page.goto('http://localhost:3036', { waitUntil: 'networkidle2', timeout: 15000 });
    
    // Wait for the menu to load
    await page.waitForSelector('#start-menu', { timeout: 5000 });
    
    // Click on LAN button to show LAN section
    const lanBtn = await page.$('[data-mode="lan"]');
    if (lanBtn) {
      await lanBtn.click();
      await page.waitForTimeout(800);
    }

    // Take a screenshot of the menu
    await page.screenshot({ path: '/tmp/lobby-layout.png', fullPage: false });
    
    // Check if elements exist
    const hasLobbyEntry = await page.$('.lan-lobby-entry');
    const hasLobbyInfo = await page.$('.lan-lobby-info');
    const hasQR = await page.$('.lan-lobby-qr-container');
    
    console.log('Layout check results:');
    console.log('- .lan-lobby-entry found:', !!hasLobbyEntry);
    console.log('- .lan-lobby-info found:', !!hasLobbyInfo);
    console.log('- .lan-lobby-qr-container found:', !!hasQR);
    
    // Check CSS styles on entry
    if (hasLobbyEntry) {
      const display = await page.evaluate(() => {
        const el = document.querySelector('.lan-lobby-entry');
        return window.getComputedStyle(el).display;
      });
      const flexDir = await page.evaluate(() => {
        const el = document.querySelector('.lan-lobby-entry');
        return window.getComputedStyle(el).flexDirection;
      });
      const gap = await page.evaluate(() => {
        const el = document.querySelector('.lan-lobby-entry');
        return window.getComputedStyle(el).gap;
      });
      console.log('- .lan-lobby-entry display:', display);
      console.log('- .lan-lobby-entry flex-direction:', flexDir);
      console.log('- .lan-lobby-entry gap:', gap);
    }
    
    console.log('\nScreenshot saved to /tmp/lobby-layout.png');
    
  } catch (error) {
    console.error('Test error:', error.message);
  } finally {
    await browser.close();
  }
})();
