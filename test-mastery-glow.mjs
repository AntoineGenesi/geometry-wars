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
    console.log('Navigating to http://localhost:3049...');
    await page.goto('http://localhost:3049', { waitUntil: 'networkidle2', timeout: 15000 });
    
    // Wait for the page to load
    await page.waitForTimeout(3000);
    
    // Take a screenshot of the initial state
    await page.screenshot({ path: '/tmp/mastery-glow-loaded.png' });
    console.log('Screenshot saved to /tmp/mastery-glow-loaded.png');
    
  } catch (err) {
    console.error('Test error:', err.message);
  } finally {
    await browser.close();
  }
})();
