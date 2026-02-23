import puppeteer from 'puppeteer';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
    args: ['--no-sandbox','--disable-setuid-sandbox','--enable-webgl','--use-gl=swiftshader','--enable-unsafe-swiftshader','--window-size=1280,720'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  
  const consoleLogs = [];
  page.on('console', msg => consoleLogs.push({ type: msg.type(), text: msg.text() }));
  
  await page.goto('http://localhost:3047/?testMode=true', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);
  
  await page.evaluate(() => { document.querySelector('[data-mode="quick"]')?.click(); });
  await sleep(1500);
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, .btn'));
    btns.find(b => /start/i.test(b.textContent || ''))?.click();
  });
  await sleep(7000);
  
  // Check game state via testMode exporter
  const gs = await page.evaluate(() => window._gameState);
  console.log('Game state:', JSON.stringify(gs, null, 2));
  
  // Check if player.boostActive is available by checking player directly
  const playerState = await page.evaluate(() => {
    if (window._gameState) {
      return {
        alive: window._gameState.playerAlive,
        isPaused: window._gameState.isPaused,
        isGameOver: window._gameState.isGameOver,
      };
    }
    return null;
  });
  console.log('Player state:', JSON.stringify(playerState));
  
  // Try pressing Shift while checking immediately
  await page.keyboard.down('ShiftLeft');
  await sleep(100); // Give game a frame to process
  
  const boostEl = await page.evaluate(() => {
    const el = document.getElementById('boost-display');
    return { text: el?.textContent, classes: el?.className };
  });
  console.log('After Shift down (100ms):', JSON.stringify(boostEl));
  
  await sleep(500);
  const boostEl2 = await page.evaluate(() => {
    const el = document.getElementById('boost-display');
    return { text: el?.textContent, classes: el?.className };
  });
  console.log('After Shift down (600ms):', JSON.stringify(boostEl2));
  
  await page.keyboard.up('ShiftLeft');
  await sleep(300);
  
  const boostEl3 = await page.evaluate(() => {
    const el = document.getElementById('boost-display');
    return { text: el?.textContent, classes: el?.className };
  });
  console.log('After Shift up (300ms):', JSON.stringify(boostEl3));
  
  // Check for errors
  const errors = consoleLogs.filter(l => l.type === 'error').map(l => l.text);
  if (errors.length > 0) console.log('Errors:', errors.slice(0, 3));
  
  await browser.close();
})().catch(console.error);
