/**
 * S15 Player Movement Diagnostic Test
 *
 * Purpose: Investigate two reported bugs:
 * 1. Side keys (A/D) change camera angle but not movement direction
 * 2. Game crashes after ~1 second of movement
 *
 * This test will:
 * - Start the game in visual styles mode (simple, fast startup)
 * - Press WASD keys and capture screenshots
 * - Capture console errors to identify crash source
 * - Take screenshots at 0.5s intervals to see when crash occurs
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const PORT = 3023;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = 'tests/visual/screenshots';

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDiagnostic() {
  console.log('🔍 Starting S15 movement diagnostic...');

  const browser = await puppeteer.launch({
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
    headless: 'new',
    args: [
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,720',
    ],
  });

  try {
    const page = await browser.newPage();

    // Capture console logs and errors
    const consoleLogs = [];
    const consoleErrors = [];

    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      console.log(`[CONSOLE] ${text}`);
    });

    page.on('pageerror', error => {
      const text = error.message;
      consoleErrors.push(text);
      console.error(`[ERROR] ${text}`);
    });

    // Navigate to start menu
    console.log(`📡 Navigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(5000); // Wait for Three.js initialization

    // Take screenshot of start menu
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 's15-diagnostic-01-start-menu.png'),
      fullPage: false
    });
    console.log('📸 Screenshot 1: Start menu');

    // Click "Visual Styles" to enter a simple playground
    console.log('🎮 Starting Visual Styles...');
    await page.evaluate(() => {
      // Find and click the Visual Styles button
      const buttons = Array.from(document.querySelectorAll('button'));
      const visualStylesBtn = buttons.find(btn => btn.textContent.includes('Visual Styles'));
      if (visualStylesBtn) {
        visualStylesBtn.click();
      } else {
        console.error('Visual Styles button not found');
      }
    });

    await sleep(3000); // Wait for game to start

    // Take screenshot after game start
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 's15-diagnostic-02-game-started.png'),
      fullPage: false
    });
    console.log('📸 Screenshot 2: Game started');

    // Test 1: Press W (forward) for 1 second and observe
    console.log('⌨️  Test 1: Pressing W (forward)...');
    await page.keyboard.down('w');
    await sleep(500);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 's15-diagnostic-03-forward-0.5s.png'),
      fullPage: false
    });
    await sleep(500);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 's15-diagnostic-04-forward-1.0s.png'),
      fullPage: false
    });
    await page.keyboard.up('w');
    await sleep(200);
    console.log('📸 Screenshots 3-4: Forward movement at 0.5s and 1.0s');

    // Test 2: Press D (right) for 1 second and observe
    console.log('⌨️  Test 2: Pressing D (right)...');
    await page.keyboard.down('d');
    await sleep(500);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 's15-diagnostic-05-right-0.5s.png'),
      fullPage: false
    });
    await sleep(500);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 's15-diagnostic-06-right-1.0s.png'),
      fullPage: false
    });
    await page.keyboard.up('d');
    await sleep(200);
    console.log('📸 Screenshots 5-6: Right movement at 0.5s and 1.0s');

    // Test 3: Press all WASD keys in sequence to detect crash
    console.log('⌨️  Test 3: Testing all movement keys...');

    // Forward
    await page.keyboard.down('w');
    await sleep(300);
    await page.keyboard.up('w');
    await sleep(100);

    // Backward
    await page.keyboard.down('s');
    await sleep(300);
    await page.keyboard.up('s');
    await sleep(100);

    // Left
    await page.keyboard.down('a');
    await sleep(300);
    await page.keyboard.up('a');
    await sleep(100);

    // Right
    await page.keyboard.down('d');
    await sleep(300);
    await page.keyboard.up('d');
    await sleep(100);

    // Final screenshot
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 's15-diagnostic-07-all-keys-tested.png'),
      fullPage: false
    });
    console.log('📸 Screenshot 7: After all keys tested');

    // Test 4: Continuous movement for 2+ seconds to trigger crash
    console.log('⌨️  Test 4: Continuous movement to detect crash...');
    await page.keyboard.down('w');

    for (let i = 0; i < 5; i++) {
      await sleep(500);
      const screenshotPath = path.join(SCREENSHOT_DIR, `s15-diagnostic-08-continuous-${i*0.5}s.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`📸 Screenshot 8.${i}: Continuous movement at ${i*0.5}s`);

      // Check if page is still responsive
      const isAlive = await page.evaluate(() => {
        return typeof window !== 'undefined' && !window.crashed;
      }).catch(() => false);

      if (!isAlive) {
        console.error('❌ Page became unresponsive - crash detected!');
        break;
      }
    }

    await page.keyboard.up('w');

    // Final state
    await sleep(500);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 's15-diagnostic-09-final-state.png'),
      fullPage: false
    });
    console.log('📸 Screenshot 9: Final state');

    // Report results
    console.log('\n📊 DIAGNOSTIC RESULTS:');
    console.log(`Console logs: ${consoleLogs.length}`);
    console.log(`Console errors: ${consoleErrors.length}`);

    if (consoleErrors.length > 0) {
      console.log('\n❌ ERRORS DETECTED:');
      consoleErrors.forEach((err, i) => {
        console.log(`${i + 1}. ${err}`);
      });
    } else {
      console.log('\n✅ No console errors detected');
    }

    // Save diagnostic report
    const report = {
      timestamp: new Date().toISOString(),
      consoleErrors,
      consoleLogs: consoleLogs.slice(-50), // Last 50 logs
      testCompleted: true
    };

    fs.writeFileSync(
      path.join(SCREENSHOT_DIR, 's15-diagnostic-report.json'),
      JSON.stringify(report, null, 2)
    );
    console.log('\n📝 Diagnostic report saved to s15-diagnostic-report.json');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// Run the diagnostic
runDiagnostic().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
