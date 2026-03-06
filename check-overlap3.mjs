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
  
  // Check what's visible
  const panelInfo = await page.evaluate(() => {
    const mainPanel = document.querySelector('#start-menu .main-panel');
    const surfaceSection = document.querySelector('#start-menu .surface-section');
    const allSubpanels = document.querySelectorAll('#start-menu .sub-panel');
    
    let info = {
      mainPanelHidden: mainPanel ? window.getComputedStyle(mainPanel).display === 'none' : 'N/A',
      surfaceSectionHidden: surfaceSection ? window.getComputedStyle(surfaceSection).display === 'none' : 'N/A',
      visibleSubpanels: []
    };
    
    allSubpanels.forEach(panel => {
      const style = window.getComputedStyle(panel);
      if (style.display !== 'none') {
        info.visibleSubpanels.push({
          id: panel.id,
          class: panel.className,
          display: style.display
        });
      }
    });
    
    return info;
  });
  
  console.log('Panel visibility:', JSON.stringify(panelInfo, null, 2));
  
  // Try to click on a button to navigate to surface section
  const buttons = await page.evaluate(() => {
    const allButtons = document.querySelectorAll('#start-menu button');
    let buttons = [];
    allButtons.forEach((btn, idx) => {
      const text = btn.textContent.substring(0, 30);
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        buttons.push({
          idx,
          id: btn.id,
          text: text,
          visible: true,
          rect: { left: Math.round(rect.left), top: Math.round(rect.top), right: Math.round(rect.right), bottom: Math.round(rect.bottom) }
        });
      }
    });
    return buttons.slice(0, 10);
  });
  
  console.log('Visible buttons:', JSON.stringify(buttons, null, 2));
  
  // Save screenshot
  await page.screenshot({ path: '/tmp/half-screen-initial.png' });
  console.log('Screenshot saved to /tmp/half-screen-initial.png');
  
  await browser.close();
})();
