#!/usr/bin/env node
/**
 * Visual Features Test Script
 *
 * Tests all items from the "Visual Features" and "WebGPU" sections of HUMAN_TEST.md:
 * 1. Enemy opacity behind surfaces (6% opacity on far side)
 * 2. Enemy surface glow (colored glow on surface)
 * 3. Visual styles playground (Start menu -> Visual Styles -> click style -> playable demo)
 * 4. Visual playground collision radius (enemies shouldn't kill from far away)
 * 5. Visual playground scroll zoom (scroll wheel zooms in/out)
 * 6. Visual playground style switching (Gold Luxury -> BACK -> Sektori Cyan shows correct style)
 * 7. Console renderer type (WebGL2 vs WebGPU)
 * 8. Bloom effects visible (neon glow)
 * 9. Fallback URL param (?renderer=webgl)
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3000';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TASK_SLUG = process.argv[2] || 'visual-features';
const COMMIT_HASH = process.argv[3] || 'a722f6a';

// Timestamped session directory
const now = new Date();
const ts = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
const SESSION_NAME = `${ts}_${TASK_SLUG}`;
const SCREENSHOT_DIR = path.join(__dirname, '..', '..', 'test-screenshots', 'sessions', SESSION_NAME);
const ATTEMPT_DIR = path.join(SCREENSHOT_DIR, 'attempt-1');

function shot(name) {
  return path.join(ATTEMPT_DIR, name);
}

async function run() {
  fs.mkdirSync(ATTEMPT_DIR, { recursive: true });
  console.log(`Session: ${SESSION_NAME}`);
  console.log(`Screenshots: ${ATTEMPT_DIR}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,720',
    ],
  });

  const consoleMessages = [];
  const consoleErrors = [];
  let rendererType = 'unknown';

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', msg => {
    const text = msg.text();
    consoleMessages.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') consoleErrors.push(text);
    // Capture renderer type from console
    if (text.includes('[RendererFactory]') || text.includes('[GPUCapabilities]')) {
      consoleMessages.push(`[RENDERER] ${text}`);
    }
    if (text.includes('WebGPU') || text.includes('WebGL')) {
      if (text.includes('Created WebGPU')) rendererType = 'WebGPU';
      else if (text.includes('Created WebGL') || text.includes('WebGL2')) rendererType = 'WebGL2';
    }
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  let stepNum = 1;
  function step(name) {
    console.log(`\n${stepNum}. ${name}`);
    stepNum++;
  }

  try {
    // ===================================================================
    // PART 1: GAMEPLAY — Enemy opacity & glow
    // ===================================================================
    step('Loading game...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(6000); // Wait for menu to render + 3D background
    await page.screenshot({ path: shot('01-start-menu.png') });

    step('Clicking QUICK GAME...');
    await page.evaluate(() => {
      const btns = document.querySelectorAll('#start-menu .oval-btn');
      for (const b of btns) {
        if (b.textContent.includes('QUICK GAME')) { b.click(); return true; }
      }
      return false;
    });
    await sleep(2000);
    await page.screenshot({ path: shot('02-quick-game-panel.png') });

    step('Selecting Waves mode and Sphere surface...');
    await page.evaluate(() => {
      // Click Waves mode
      const waveBtn = document.querySelector('.mode-btn[data-mode-type="waves"]');
      if (waveBtn) waveBtn.click();
      // Click Sphere surface
      const surfBtns = document.querySelectorAll('#surface-section .surface-btn');
      for (const b of surfBtns) {
        if (b.dataset.surface === 'sphere') { b.click(); break; }
      }
    });
    await sleep(500);

    step('Clicking START...');
    await page.evaluate(() => {
      const btn = document.querySelector('#surface-start-btn');
      if (btn) {
        btn.scrollIntoView({ block: 'center' });
        btn.click();
      }
    });
    await sleep(3000);
    await page.screenshot({ path: shot('03-game-loading.png') });

    step('Waiting for enemies to spawn (15s for SwiftShader)...');
    await sleep(15000);
    await page.screenshot({ path: shot('04-gameplay-enemies-spawned.png') });

    step('Waiting more for far-side enemies to become visible/invisible (10s)...');
    await sleep(10000);
    await page.screenshot({ path: shot('05-gameplay-far-side-enemies.png') });

    // Try to capture bloom/glow
    step('Capturing bloom/glow screenshot...');
    await page.screenshot({ path: shot('06-gameplay-bloom-glow.png') });

    // ===================================================================
    // PART 2: VISUAL STYLES PLAYGROUND
    // ===================================================================
    step('Returning to start menu (ESC)...');
    // The game may or may not have ESC → back to menu. If not, reload.
    await page.keyboard.press('Escape');
    await sleep(3000);
    await page.screenshot({ path: shot('07-after-esc.png') });

    // Reload to get fresh start menu
    step('Reloading to get fresh start menu...');
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(6000);
    await page.screenshot({ path: shot('08-fresh-start-menu.png') });

    step('Clicking VISUAL STYLES button...');
    const vsClicked = await page.evaluate(() => {
      const btn = document.querySelector('#visual-styles-btn');
      if (btn) { btn.click(); return true; }
      return false;
    });
    console.log(`  Visual Styles button found: ${vsClicked}`);
    await sleep(5000); // Wait for Visual Playground to render (creates WebGL context + 38 cells)
    await page.screenshot({ path: shot('09-visual-styles-grid.png') });

    step('Clicking on first style thumbnail (Classic Neon)...');
    // Click on the first label in the grid
    await page.evaluate(() => {
      const label = document.querySelector('.vp-label[data-index="0"]');
      if (label) label.click();
    });
    await sleep(5000); // Wait for demo to load
    await page.screenshot({ path: shot('10-visual-demo-classic-neon.png') });

    step('Clicking on demo canvas to start playing...');
    await page.evaluate(() => {
      // The demo overlay has a canvas container. Click on it.
      const overlay = document.querySelector('.vp-demo-overlay');
      if (overlay) {
        const canvas = overlay.querySelector('canvas');
        if (canvas) {
          canvas.click();
        }
      }
    });
    await sleep(5000); // Wait for gameplay to start
    await page.screenshot({ path: shot('11-visual-demo-playing.png') });

    // Test scroll zoom
    step('Testing scroll zoom (zoom in)...');
    await page.evaluate(() => {
      const overlay = document.querySelector('.vp-demo-overlay');
      const canvas = overlay?.querySelector('canvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        // Dispatch wheel events for zoom in
        for (let i = 0; i < 5; i++) {
          canvas.dispatchEvent(new WheelEvent('wheel', {
            deltaY: -100,
            clientX: centerX,
            clientY: centerY,
            bubbles: true,
          }));
        }
      }
    });
    await sleep(2000);
    await page.screenshot({ path: shot('12-visual-demo-zoomed-in.png') });

    step('Testing scroll zoom (zoom out)...');
    await page.evaluate(() => {
      const overlay = document.querySelector('.vp-demo-overlay');
      const canvas = overlay?.querySelector('canvas');
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        // Dispatch wheel events for zoom out
        for (let i = 0; i < 10; i++) {
          canvas.dispatchEvent(new WheelEvent('wheel', {
            deltaY: 100,
            clientX: centerX,
            clientY: centerY,
            bubbles: true,
          }));
        }
      }
    });
    await sleep(2000);
    await page.screenshot({ path: shot('13-visual-demo-zoomed-out.png') });

    // ===================================================================
    // PART 3: STYLE SWITCHING TEST
    // ===================================================================
    step('Going BACK from demo...');
    await page.evaluate(() => {
      // Find and click the BACK button in the demo overlay
      const overlay = document.querySelector('.vp-demo-overlay');
      if (overlay) {
        const btns = overlay.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.trim() === 'BACK') { b.click(); return true; }
        }
      }
      return false;
    });
    await sleep(3000);
    await page.screenshot({ path: shot('14-back-to-styles-grid.png') });

    step('Opening Gold Luxury style (index 11)...');
    await page.evaluate(() => {
      const label = document.querySelector('.vp-label[data-index="11"]');
      if (label) label.click();
    });
    await sleep(5000);
    await page.screenshot({ path: shot('15-gold-luxury-demo.png') });

    step('Going BACK from Gold Luxury...');
    await page.evaluate(() => {
      const overlay = document.querySelector('.vp-demo-overlay');
      if (overlay) {
        const btns = overlay.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.trim() === 'BACK') { b.click(); return true; }
        }
      }
      return false;
    });
    await sleep(3000);
    await page.screenshot({ path: shot('16-back-from-gold-luxury.png') });

    step('Opening Sektori Cyan style (index 16)...');
    await page.evaluate(() => {
      const label = document.querySelector('.vp-label[data-index="16"]');
      if (label) label.click();
    });
    await sleep(5000);
    await page.screenshot({ path: shot('17-sektori-cyan-demo.png') });

    step('Clicking to play Sektori Cyan...');
    await page.evaluate(() => {
      const overlay = document.querySelector('.vp-demo-overlay');
      if (overlay) {
        const canvas = overlay.querySelector('canvas');
        if (canvas) canvas.click();
      }
    });
    await sleep(5000);
    await page.screenshot({ path: shot('18-sektori-cyan-playing.png') });

    step('Going BACK from Sektori Cyan...');
    await page.evaluate(() => {
      const overlay = document.querySelector('.vp-demo-overlay');
      if (overlay) {
        const btns = overlay.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.trim() === 'BACK') { b.click(); return true; }
        }
      }
      return false;
    });
    await sleep(3000);

    step('Opening a third style - Synthwave (index 8) for triple switch test...');
    await page.evaluate(() => {
      const label = document.querySelector('.vp-label[data-index="8"]');
      if (label) label.click();
    });
    await sleep(5000);
    await page.screenshot({ path: shot('19-synthwave-demo.png') });

    // ===================================================================
    // PART 4: WEBGPU / RENDERER CHECK
    // ===================================================================
    step('Closing Visual Styles and going back to menu for WebGPU check...');
    await page.evaluate(() => {
      // Close any demo overlay
      const demoOverlay = document.querySelector('.vp-demo-overlay');
      if (demoOverlay) {
        const btns = demoOverlay.querySelectorAll('button');
        for (const b of btns) {
          if (b.textContent.trim() === 'BACK') { b.click(); break; }
        }
      }
    });
    await sleep(1000);
    await page.evaluate(() => {
      // Close the visual playground
      const closeBtn = document.querySelector('.vp-close-btn');
      if (closeBtn) closeBtn.click();
    });
    await sleep(2000);

    // ===================================================================
    // PART 5: FALLBACK URL PARAM TEST
    // ===================================================================
    step('Testing ?renderer=webgl fallback URL param...');
    await page.goto(`${BASE_URL}?renderer=webgl`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(6000);
    await page.screenshot({ path: shot('20-webgl-fallback-menu.png') });

    // Check what renderer messages appeared
    const rendererMessages = consoleMessages.filter(m =>
      m.includes('Renderer') || m.includes('WebGPU') || m.includes('WebGL') ||
      m.includes('GPUCapabilities') || m.includes('renderer')
    );

    // ===================================================================
    // Write results
    // ===================================================================
    step('Writing RESULTS.md...');

    const resultsContent = `# Visual Test: visual-features
**Timestamp:** ${now.toISOString()}
**Commit:** ${COMMIT_HASH}
**Goal:** Verify all Visual Features + WebGPU items from HUMAN_TEST.md

## Attempt 1

### Script Description
Comprehensive test covering:
1. Gameplay with enemies on sphere (opacity/glow)
2. Visual Styles playground (grid, demo, zoom, style switching)
3. WebGPU/renderer detection
4. Fallback URL param

### Screenshots

| # | File | Description |
|---|------|-------------|
| 01 | 01-start-menu.png | Initial start menu with 3D background |
| 02 | 02-quick-game-panel.png | Quick Game mode/surface selection panel |
| 03 | 03-game-loading.png | Game loading/starting |
| 04 | 04-gameplay-enemies-spawned.png | Gameplay with enemies (check opacity on far side) |
| 05 | 05-gameplay-far-side-enemies.png | Later gameplay - more enemies for opacity check |
| 06 | 06-gameplay-bloom-glow.png | Bloom/glow effects check |
| 07 | 07-after-esc.png | After pressing ESC |
| 08 | 08-fresh-start-menu.png | Fresh reload - start menu |
| 09 | 09-visual-styles-grid.png | Visual Styles playground grid |
| 10 | 10-visual-demo-classic-neon.png | Classic Neon demo loaded |
| 11 | 11-visual-demo-playing.png | Classic Neon demo playing |
| 12 | 12-visual-demo-zoomed-in.png | After scroll zoom in |
| 13 | 13-visual-demo-zoomed-out.png | After scroll zoom out |
| 14 | 14-back-to-styles-grid.png | Back to styles grid from demo |
| 15 | 15-gold-luxury-demo.png | Gold Luxury demo |
| 16 | 16-back-from-gold-luxury.png | Back from Gold Luxury |
| 17 | 17-sektori-cyan-demo.png | Sektori Cyan demo |
| 18 | 18-sektori-cyan-playing.png | Sektori Cyan playing |
| 19 | 19-synthwave-demo.png | Synthwave demo (3rd style switch) |
| 20 | 20-webgl-fallback-menu.png | Menu with ?renderer=webgl param |

### Console Output (Renderer-related)
${rendererMessages.length > 0 ? rendererMessages.map(m => '- ' + m).join('\\n') : '- No renderer messages captured'}

### Detected Renderer: ${rendererType}

### Console Errors
${consoleErrors.length > 0 ? consoleErrors.map(e => '- ' + e).join('\\n') : '- None'}

### Analysis
[TO BE FILLED IN AFTER READING SCREENSHOTS]

### Test Item Results
| # | Test Item | Status | Notes |
|---|-----------|--------|-------|
| 1 | Enemy opacity behind surfaces | PENDING | Check screenshots 04-05 |
| 2 | Enemy surface glow | PENDING | Check screenshots 04-06 |
| 3 | Visual styles playground loads | PENDING | Check screenshot 09 |
| 4 | Visual playground collision radius | PENDING | Check screenshots 11, 18 (should survive > 5s) |
| 5 | Visual playground scroll zoom | PENDING | Compare 11 vs 12 vs 13 |
| 6 | Visual playground style switching | PENDING | Compare 15 vs 17 vs 19 |
| 7 | Console renderer type | ${rendererType} | SwiftShader = WebGL2 expected |
| 8 | Bloom effects visible | PENDING | Check screenshots 04-06 |
| 9 | Fallback URL param | PENDING | Check screenshot 20 |

## Conclusion
[TO BE FILLED IN AFTER VISUAL ANALYSIS]
`;

    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'RESULTS.md'), resultsContent);

    // Also save console log
    fs.writeFileSync(path.join(SCREENSHOT_DIR, 'console.log'), consoleMessages.join('\n'));

    console.log('\n=== Test Complete ===');
    console.log(`Screenshots: ${ATTEMPT_DIR}`);
    console.log(`Results: ${path.join(SCREENSHOT_DIR, 'RESULTS.md')}`);
    console.log(`Console errors: ${consoleErrors.length}`);
    console.log(`Renderer detected: ${rendererType}`);

  } catch (err) {
    console.error('Test failed:', err);
    await page.screenshot({ path: shot('ERROR-final-state.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
}

run().catch(console.error);
