import puppeteer from 'puppeteer';

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });

  try {
    // Mobile viewport (iPhone 12)
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    
    await mobilePage.goto('http://localhost:3009/?quickStart=true&surface=sphere', {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });
    // Wait for the game to fully render (loading screen disappears)
    await new Promise(r => setTimeout(r, 8000));
    await mobilePage.screenshot({ path: '/tmp/mobile-zoom-sp.png' });
    console.log('Mobile screenshot saved');
    
    // Desktop viewport for comparison  
    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1280, height: 800, isMobile: false });
    await desktopPage.goto('http://localhost:3009/?quickStart=true&surface=sphere', {
      waitUntil: 'networkidle2',
      timeout: 25000,
    });
    await new Promise(r => setTimeout(r, 8000));
    await desktopPage.screenshot({ path: '/tmp/desktop-zoom-sp.png' });
    console.log('Desktop screenshot saved');
    
  } finally {
    await browser.close();
  }
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
