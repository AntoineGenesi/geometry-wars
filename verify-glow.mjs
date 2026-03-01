import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
    args: ['--use-gl=swiftshader', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1024 });
    
    console.log('Loading http://localhost:3049...');
    await page.goto('http://localhost:3049', { waitUntil: 'networkidle2', timeout: 15000 });
    
    console.log('Page loaded, waiting for render...');
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 2000)));
    
    console.log('Taking screenshot');
    await page.screenshot({ path: '/tmp/glow-verify.png' });
    console.log('Screenshot saved to /tmp/glow-verify.png');
    
    // Check CSS is loaded
    const cssLoaded = await page.evaluate(() => {
      const elem = document.querySelector('.wms-node--locked');
      if (elem) {
        const styles = window.getComputedStyle(elem);
        return {
          boxShadow: styles.boxShadow,
          display: styles.display
        };
      }
      return null;
    });
    
    console.log('Computed styles for locked node:', cssLoaded);
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await browser.close();
  }
})();
