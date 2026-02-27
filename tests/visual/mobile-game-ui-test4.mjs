/**
 * Mobile UI test v4 — simplified, uses domcontentloaded, mobile URL param
 */
import puppeteer from 'puppeteer';
import fs from 'fs';

const CHROME = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const OUT_DIR = '/mnt/c/Users/User/Documents/claude code experiments/Geometry Wars/.claude/worktrees/s38b-06-mobile-ui-completely-broken/test-screenshots/mobile-ui';
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--disable-web-security',
    '--window-size=844,390',
  ],
  headless: true,
});

const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390 });

const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', e => consoleErrors.push(e.message));

// Use domcontentloaded to avoid waiting for all network resources
await page.goto('http://localhost:3044/?quickStart=true&surface=sphere&mobile=true', {
  waitUntil: 'domcontentloaded',
  timeout: 60000
});
console.log('DOM loaded');

// Wait for canvas to appear
let canvasFound = false;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000));
  canvasFound = await page.evaluate(() => !!document.querySelector('canvas'));
  if (canvasFound) { console.log(`Canvas found after ${i+1}s`); break; }
  if (i % 5 === 4) console.log(`Still waiting... (${i+1}s)`);
}

if (!canvasFound) {
  console.log('ERROR: Canvas never appeared after 20s');
  await page.screenshot({ path: `${OUT_DIR}/error-state.png` });
  console.log('Errors:', consoleErrors.slice(0, 5));
  await browser.close();
  process.exit(1);
}

// Wait for game to load (touch controls initialized)
await new Promise(r => setTimeout(r, 8000));
console.log('Game should be running');

await page.screenshot({ path: `${OUT_DIR}/10-game-running.png` });
console.log('Screenshot 10 saved');

// Check controls
const controls = await page.evaluate(() => {
  const overlay = document.getElementById('touch-controls-overlay');
  const pauseBtn = document.getElementById('touch-pause-btn');
  const canvas = document.querySelector('canvas');
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x|0, y: b.y|0, w: b.width|0, h: b.height|0 }; };
  return {
    w: window.innerWidth, h: window.innerHeight,
    overlayFound: !!overlay,
    overlayDisplay: overlay?.style.display,
    overlayRect: r(overlay),
    overlayChildCount: overlay?.childElementCount,
    pauseBtnFound: !!pauseBtn,
    pauseBtnRect: r(pauseBtn),
    pauseBtnStyle: pauseBtn ? { top: pauseBtn.style.top, right: pauseBtn.style.right, display: pauseBtn.style.display } : null,
    canvasRect: r(canvas),
  };
});
console.log('Controls:', JSON.stringify(controls, null, 2));

// Touch bottom-left (left joystick zone)
const lx = 844 * 0.2 | 0, ly = 390 * 0.8 | 0;
await page.evaluate((x, y) => {
  const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
  window.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
}, lx, ly);
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: `${OUT_DIR}/11-left-joystick.png` });

const joystickState = await page.evaluate(() => {
  const overlay = document.getElementById('touch-controls-overlay');
  if (!overlay) return [];
  return Array.from(overlay.children).map(el => ({
    display: el.style.display, left: el.style.left, top: el.style.top
  }));
});
console.log(`Left touch at (${lx},${ly}) → joystick state:`, JSON.stringify(joystickState));

// End touch
await page.evaluate((x, y) => {
  const t = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
  window.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t], bubbles: true, cancelable: true }));
}, lx, ly);
await new Promise(r => setTimeout(r, 200));

// Touch bottom-right (right joystick zone)
const rx = 844 * 0.8 | 0, ry = 390 * 0.8 | 0;
await page.evaluate((x, y) => {
  const t = new Touch({ identifier: 2, target: document.body, clientX: x, clientY: y });
  window.dispatchEvent(new TouchEvent('touchstart', { touches: [t], changedTouches: [t], bubbles: true, cancelable: true }));
}, rx, ry);
await new Promise(r => setTimeout(r, 300));
await page.screenshot({ path: `${OUT_DIR}/12-right-joystick.png` });

const joystickState2 = await page.evaluate(() => {
  const overlay = document.getElementById('touch-controls-overlay');
  if (!overlay) return [];
  return Array.from(overlay.children).map(el => ({
    display: el.style.display, left: el.style.left, top: el.style.top
  }));
});
console.log(`Right touch at (${rx},${ry}) → joystick state:`, JSON.stringify(joystickState2));

if (consoleErrors.length) console.log('Console errors:', consoleErrors.slice(0, 5));
await browser.close();
console.log('\nDone. Screenshots in:', OUT_DIR);
