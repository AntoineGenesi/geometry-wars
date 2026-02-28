import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    page.setViewport({ width: 1200, height: 800 });

    // Navigate to the game
    console.log('Loading http://localhost:3036...');
    await page.goto('http://localhost:3036', { waitUntil: 'networkidle2', timeout: 15000 });
    
    // Wait for the menu to load
    console.log('Waiting for menu...');
    await page.waitForSelector('#start-menu', { timeout: 5000 });
    
    // Click on LAN button to show LAN section
    console.log('Clicking LAN button...');
    const lanBtn = await page.$('[data-mode="lan"]');
    if (lanBtn) {
      await lanBtn.click();
      await page.waitForTimeout(800);
    }

    // Take a screenshot of the menu
    console.log('Taking screenshot...');
    await page.screenshot({ path: '/tmp/lobby-layout.png', fullPage: false });
    
    // Check if elements exist
    const hasLobbyEntry = await page.$('.lan-lobby-entry');
    const hasLobbyInfo = await page.$('.lan-lobby-info');
    const hasQR = await page.$('.lan-lobby-qr-container');
    
    console.log('\n=== Layout check results ===');
    console.log('- .lan-lobby-entry found:', !!hasLobbyEntry);
    console.log('- .lan-lobby-info found:', !!hasLobbyInfo);
    console.log('- .lan-lobby-qr-container found:', !!hasQR);
    
    // Check CSS styles on entry
    if (hasLobbyEntry) {
      const styles = await page.evaluate(() => {
        const el = document.querySelector('.lan-lobby-entry');
        const cs = window.getComputedStyle(el);
        return {
          display: cs.display,
          flexDirection: cs.flexDirection,
          gap: cs.gap,
          alignItems: cs.alignItems
        };
      });
      console.log('\n=== Computed styles on .lan-lobby-entry ===');
      console.log('- display:', styles.display);
      console.log('- flex-direction:', styles.flexDirection);
      console.log('- gap:', styles.gap);
      console.log('- align-items:', styles.alignItems);
    }
    
    console.log('\nScreenshot saved to /tmp/lobby-layout.png');
    
  } catch (error) {
    console.error('Test error:', error.message);
  } finally {
    await browser.close();
  }
})();
