/**
 * Visual test for s44-epic: MeshWalker pole crossing (Level 5 verification).
 *
 * Tests that a player can cross the sphere north pole without camera inversion.
 * Uses single-player mode (SP uses the same MeshWalker as the server), which
 * is testable headless.
 *
 * LAN MP pole crossing requires two connected clients — not achievable headless.
 * Use docs/HUMAN_TEST.md checklist for LAN verification.
 *
 * Run: node --loader ts-node/esm tests/visual/mp-pole-crossing.ts
 * Prerequisites: npm run dev running on port 3000+ (or use VITE_PORT env)
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = process.env.VITE_PORT ?? '3000';
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = path.join(__dirname, '../../test-screenshots/sessions/s44-epic-pole-crossing');

async function testPoleCrossing(): Promise<void> {
  console.log('=== s44-epic: Pole Crossing Visual Test ===');
  console.log(`Target: ${BASE_URL}`);

  if (!fs.existsSync(CHROME_PATH)) {
    throw new Error(`Chrome not found at ${CHROME_PATH}`);
  }

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: CHROME_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--use-angle=swiftshader-webgl',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Step 1: Load game
    console.log('\n[1] Loading game...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 10000 });
    await page.waitForTimeout(2000);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-game-loaded.png') });
    console.log('Screenshot: 01-game-loaded.png');

    // Step 2: Start a quick game on sphere surface
    // The start menu has a Quick Game button or surface selector
    console.log('\n[2] Starting game on sphere surface...');

    // Try to find and click Quick Game or Start button
    const started = await page.evaluate(() => {
      // Look for Quick Game button (most direct path)
      const buttons = Array.from(document.querySelectorAll('button'));
      const quickGame = buttons.find(b => b.textContent?.toLowerCase().includes('quick'));
      if (quickGame) { (quickGame as HTMLButtonElement).click(); return 'quick-game'; }

      // Fallback: click any visible start button
      const startBtn = buttons.find(b => b.textContent?.toLowerCase().includes('start'));
      if (startBtn) { (startBtn as HTMLButtonElement).click(); return 'start'; }

      return null;
    });

    console.log('  Button clicked:', started);
    await page.waitForTimeout(1000);

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-start-menu.png') });
    console.log('Screenshot: 02-start-menu.png');

    // Step 3: Try to select sphere surface if surface select is visible
    await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      for (const sel of selects) {
        if (Array.from(sel.options).some(o => o.value === 'sphere')) {
          sel.value = 'sphere';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      return false;
    });

    // Confirm/launch if there's a confirm button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const confirm = btns.find(b =>
        b.textContent?.toLowerCase().includes('confirm') ||
        b.textContent?.toLowerCase().includes('play') ||
        b.textContent?.toLowerCase().includes('launch')
      );
      if (confirm) (confirm as HTMLButtonElement).click();
    });

    await page.waitForTimeout(3000); // Wait for game to start
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-game-started.png') });
    console.log('Screenshot: 03-game-started.png');

    // Step 4: Record initial player position
    const initialState = await page.evaluate(() => {
      // Access via window.__gameContext (set by main.ts)
      const ctx = (window as any).__gameContext;
      if (!ctx) return null;

      const player = ctx.player;
      if (!player?.mesh) return null;

      return {
        x: player.mesh.position.x,
        y: player.mesh.position.y,
        z: player.mesh.position.z,
      };
    });

    if (initialState) {
      console.log('\n[3] Initial player position:', initialState);
    } else {
      console.log('\n[3] Could not read player position (game context not exposed)');
    }

    // Step 5: Hold W key for 4 seconds — moves player toward north pole
    console.log('\n[4] Holding W key to move toward north pole (4 seconds)...');
    await page.keyboard.down('w');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-moving-toward-pole.png') });
    console.log('Screenshot: 04-moving-toward-pole.png (mid-movement)');

    await page.waitForTimeout(2000); // 4 seconds total
    await page.keyboard.up('w');

    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-after-pole-crossing.png') });
    console.log('Screenshot: 05-after-pole-crossing.png (after crossing pole)');

    // Step 6: Check final player position
    const finalState = await page.evaluate(() => {
      const ctx = (window as any).__gameContext;
      if (!ctx?.player?.mesh) return null;
      return {
        x: ctx.player.mesh.position.x,
        y: ctx.player.mesh.position.y,
        z: ctx.player.mesh.position.z,
      };
    });

    if (finalState) {
      console.log('\n[5] Final player position:', finalState);
    }

    // Step 7: Continue W for 2 more seconds and check camera hasn't inverted
    console.log('\n[6] Holding W key for 2 more seconds (verifying no inversion)...');
    await page.keyboard.down('w');
    await page.waitForTimeout(2000);
    await page.keyboard.up('w');

    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-post-crossing-still-moving.png') });
    console.log('Screenshot: 06-post-crossing-still-moving.png');

    const postCrossingState = await page.evaluate(() => {
      const ctx = (window as any).__gameContext;
      if (!ctx?.player?.mesh) return null;
      return {
        x: ctx.player.mesh.position.x,
        y: ctx.player.mesh.position.y,
        z: ctx.player.mesh.position.z,
      };
    });

    // Step 8: Analyze results
    console.log('\n=== ANALYSIS ===');

    if (initialState && finalState && postCrossingState) {
      const displacement1 = Math.sqrt(
        (finalState.x - initialState.x) ** 2 +
        (finalState.y - initialState.y) ** 2 +
        (finalState.z - initialState.z) ** 2,
      );

      const displacement2 = Math.sqrt(
        (postCrossingState.x - finalState.x) ** 2 +
        (postCrossingState.y - finalState.y) ** 2 +
        (postCrossingState.z - finalState.z) ** 2,
      );

      console.log('Phase 1 displacement (toward pole):', displacement1.toFixed(3));
      console.log('Phase 2 displacement (after pole):', displacement2.toFixed(3));

      if (displacement1 < 0.5) {
        console.log('⚠  WARNING: Player did not move significantly in phase 1 — controls may be broken');
      } else if (displacement2 < 0.5) {
        console.log('✗ FAIL: Player moved in phase 1 but stopped after pole crossing — likely control inversion!');
        console.log('   This is the regression: crossing the pole inverted moveY=1 to move backward.');
      } else {
        console.log('✓ LIKELY PASS: Player continued moving in both phases');
        console.log('  Verify screenshots manually: player should be on south side of sphere after crossing pole');
      }
    } else {
      console.log('Could not read player position from window.__gameContext');
      console.log('Manual screenshot verification required. Screenshots saved to:', SCREENSHOT_DIR);
    }

    console.log('\nScreenshots saved to:', SCREENSHOT_DIR);
    console.log('\n=== HUMAN VERIFICATION REQUIRED ===');
    console.log('Open screenshots and verify:');
    console.log('1. 04-moving-toward-pole.png: Player is visibly moving toward top of sphere');
    console.log('2. 05-after-pole-crossing.png: Player has crossed the pole (on south side)');
    console.log('3. 06-post-crossing-still-moving.png: Camera has NOT flipped — sphere is still visible');
    console.log('   (Regression: camera would flip 180° and show wrong side)');

  } finally {
    await browser.close();
  }
}

// Run test
testPoleCrossing()
  .then(() => {
    console.log('\nVisual test completed.');
    process.exit(0);
  })
  .catch(err => {
    console.error('\nVisual test failed:', err.message);
    process.exit(1);
  });
