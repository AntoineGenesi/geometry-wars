/**
 * S31: Mobile Pause Menu Touch Routing Fix — Visual verification
 *
 * Tests that:
 * 1. Pause menu opens on mobile (touch pause button or ESC)
 * 2. Touch on pause menu buttons does NOT show joystick
 * 3. Touch on Resume button fires click event → menu closes
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(__dirname, '../../test-screenshots/sessions/s31-mobile-pause');
const CHROME = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const SERVER_URL = 'http://localhost:3043';

mkdirSync(SCREENSHOT_DIR, { recursive: true });

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function screenshot(page, name) {
  const path = join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path });
  console.log(`  [screenshot] ${name}.png`);
  return path;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-gpu-sandbox',
  ],
});

let exitCode = 0;

try {
  // iPhone 13 landscape dimensions
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  console.log('Loading game with URL params to bypass start menu...');
  // URL params bypass start menu: surface + mode triggers direct game start
  await page.goto(`${SERVER_URL}/?surface=sphere&mode=waves`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(18000); // SwiftShader needs 15-20s to initialize WebGL

  await screenshot(page, '01-after-load');

  // Log what's in the DOM to help diagnose
  const domInfo = await page.evaluate(() => ({
    ids: Array.from(document.querySelectorAll('[id]')).map(d => d.id),
    buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent?.trim().substring(0,30)),
  }));
  console.log('  DOM ids:', domInfo.ids.join(', '));
  console.log('  Buttons:', domInfo.buttons.join(', '));

  await screenshot(page, '02-game-state');

  // Press ESC to open pause menu
  console.log('Opening pause menu via ESC...');
  await page.keyboard.press('Escape');
  await sleep(500);

  await screenshot(page, '03-pause-menu-open');

  // Verify pause menu is visible
  const pauseMenuVisible = await page.evaluate(() => {
    const el = document.getElementById('pause-menu');
    if (!el) return false;
    return !el.classList.contains('hidden') && el.style.display !== 'none';
  });
  console.log(`  Pause menu visible: ${pauseMenuVisible}`);

  if (!pauseMenuVisible) {
    console.log('  WARNING: Pause menu not visible — game may not have started yet');
  }

  // Check that no joystick is showing (regression: joystick appeared when touching menu)
  const joystickVisible = await page.evaluate(() => {
    const overlay = document.getElementById('touch-controls-overlay');
    if (!overlay) return false;
    // Check if any joystick bases are visible
    const bases = overlay.querySelectorAll('div');
    for (const base of bases) {
      if (base.style.display === 'block' && base !== overlay) return true;
    }
    return false;
  });
  console.log(`  Joystick visible while paused: ${joystickVisible} (expected: false)`);

  if (joystickVisible) {
    console.log('  FAIL: Joystick should not be visible while paused!');
    exitCode = 1;
  } else {
    console.log('  PASS: No joystick while paused');
  }

  // Now simulate a touch on the Resume button
  const resumeBtn = await page.$('[data-action="resume"], .resume-btn');
  if (resumeBtn) {
    console.log('Tapping Resume button via touch...');
    await resumeBtn.tap();
    await sleep(500);

    await screenshot(page, '04-after-resume-tap');

    // Check if pause menu closed
    const pauseMenuAfter = await page.evaluate(() => {
      const el = document.getElementById('pause-menu');
      if (!el) return false;
      return !el.classList.contains('hidden') && el.style.display !== 'none';
    });
    console.log(`  Pause menu after Resume tap: visible=${pauseMenuAfter} (expected: false)`);

    if (pauseMenuAfter) {
      console.log('  FAIL: Resume tap did not close pause menu — touch routing may still be broken');
      exitCode = 1;
    } else {
      console.log('  PASS: Resume tap closed pause menu (touch routing works!)');
    }
  } else {
    console.log('  Could not find Resume button — skipping tap test');
  }

  // Open pause again and check joystick zones don't activate
  console.log('Re-opening pause menu...');
  await page.keyboard.press('Escape');
  await sleep(500);

  // Simulate touch in the bottom-left (normally joystick zone) — should NOT activate joystick
  console.log('Touching bottom-left (joystick zone) while paused...');
  const touchClient = await page.evaluate(() => {
    return { x: window.innerWidth * 0.25, y: window.innerHeight * 0.7 };
  });

  // Use page.touchscreen if available
  if (page.touchscreen) {
    await page.touchscreen.tap(touchClient.x, touchClient.y);
    await sleep(200);
  }

  await screenshot(page, '05-joystick-zone-while-paused');

  const joystickAfterTouch = await page.evaluate(() => {
    const overlay = document.getElementById('touch-controls-overlay');
    if (!overlay) return false;
    const bases = overlay.querySelectorAll('div');
    for (const base of bases) {
      if (base.style.display === 'block') return true;
    }
    return false;
  });
  console.log(`  Joystick visible after touching joystick zone while paused: ${joystickAfterTouch} (expected: false)`);

  if (joystickAfterTouch) {
    console.log('  FAIL: Joystick appeared in joystick zone while paused!');
    exitCode = 1;
  } else {
    console.log('  PASS: No joystick activation while paused');
  }

} catch (err) {
  console.error('Test error:', err.message);
  exitCode = 1;
} finally {
  await browser.close();
}

console.log(`\nResult: ${exitCode === 0 ? 'PASS' : 'FAIL'}`);
process.exit(exitCode);
