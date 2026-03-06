import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--disable-gpu', '--disable-software-rasterizer', '--no-sandbox']
  });
  
  const page = await browser.newPage();
  
  // Check at half-screen
  await page.setViewport({ width: 480, height: 1080 });
  await page.goto('http://localhost:3044/', { waitUntil: 'networkidle2' });
  
  // Wait for menu to appear
  await page.waitForSelector('#start-menu', { timeout: 10000 }).catch(() => {});
  
  // Wait a bit more
  await new Promise(r => setTimeout(r, 1000));
  
  // Click on QUICK GAME
  const allBtns = await page.$$('#start-menu .oval-btn');
  if (allBtns.length > 1) {
    await allBtns[1].click();
    await new Promise(r => setTimeout(r, 500));
    
    // Get the HTML of the surface section
    const html = await page.evaluate(() => {
      const surfaceSection = document.querySelector('#start-menu .surface-section');
      if (surfaceSection) {
        // Get the inner HTML and the styles of buttons
        const buttons = surfaceSection.querySelectorAll('button');
        let info = [];
        buttons.forEach(btn => {
          const style = window.getComputedStyle(btn);
          info.push({
            id: btn.id,
            text: btn.textContent.substring(0, 40).trim(),
            classes: btn.className,
            display: style.display,
            width: style.width,
            marginTop: style.marginTop,
            marginBottom: style.marginBottom,
            position: style.position,
            zIndex: style.zIndex
          });
        });
        return info;
      }
      return [];
    });
    
    console.log('Button styles in surface-section:');
    console.log(JSON.stringify(html, null, 2));
  }
  
  await browser.close();
})();
