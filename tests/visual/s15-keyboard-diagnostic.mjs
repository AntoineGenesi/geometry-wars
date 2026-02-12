#!/usr/bin/env node
/**
 * Minimal keyboard diagnostic: verify Puppeteer keydowns reach the game
 */
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || 3025;
const URL = `http://localhost:${PORT}/?quickStart=true&surface=sphere`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath: '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome',
    headless: 'new',
    args: [
      '--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--window-size=1280,720',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  page.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[DIAG]') || text.startsWith('[Geometry Wars]') || text.startsWith('[GameDebugAPI]')) {
      console.log(text);
    }
  });

  console.log('1. Navigating...');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Inject a keyboard event listener IMMEDIATELY
  await page.evaluate(() => {
    window.__diagKeyEvents = [];
    window.addEventListener('keydown', (e) => {
      window.__diagKeyEvents.push({ type: 'down', key: e.key, code: e.code, ts: Date.now() });
      console.log(`[DIAG] keydown: key=${e.key} code=${e.code}`);
    });
    window.addEventListener('keyup', (e) => {
      window.__diagKeyEvents.push({ type: 'up', key: e.key, code: e.code, ts: Date.now() });
      console.log(`[DIAG] keyup: key=${e.key} code=${e.code}`);
    });
    console.log('[DIAG] Keyboard diagnostic listeners installed');
  });

  console.log('2. Waiting for game (25s for SwiftShader)...');
  await sleep(25000);

  // Check game state
  const gameInfo = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return { hasDebug: false };
    return {
      hasDebug: true,
      playerAlive: dbg.player?.alive,
      playerX: dbg.player?.mesh?.position?.x,
      playerY: dbg.player?.mesh?.position?.y,
      playerZ: dbg.player?.mesh?.position?.z,
      hasGame: !!dbg.game,
      hasCam: !!dbg.game?.camera,
    };
  });
  console.log('3. Game info:', JSON.stringify(gameInfo));

  // Check game phase
  const phase = await page.evaluate(() => {
    // Try to access game mode phase
    try {
      const dbg = window.__gameDebug;
      if (!dbg) return 'no-debug';
      // The game context might be accessible through gameLoop
      return 'debug-available';
    } catch (e) {
      return 'error: ' + e.message;
    }
  });
  console.log('4. Phase info:', phase);

  // Bring page to focus
  await page.bringToFront();

  // Click on the canvas to ensure focus
  console.log('5. Clicking canvas for focus...');
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.focus();
      canvas.click();
      console.log('[DIAG] Canvas focused and clicked');
    } else {
      console.log('[DIAG] No canvas found');
    }
  });
  await sleep(500);

  // Now try pressing keys
  console.log('6. Pressing D key...');
  await page.keyboard.down('d');
  await sleep(2000);

  // Check if key event was received
  const events = await page.evaluate(() => window.__diagKeyEvents);
  console.log(`7. Key events received: ${events.length}`);
  for (const e of events) {
    console.log(`   ${e.type}: key=${e.key} code=${e.code}`);
  }

  await page.keyboard.up('d');
  await sleep(500);

  // Check player position after D press
  const afterD = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return null;
    return {
      x: dbg.player?.mesh?.position?.x,
      y: dbg.player?.mesh?.position?.y,
      z: dbg.player?.mesh?.position?.z,
    };
  });
  console.log('8. Player position after D:', JSON.stringify(afterD));

  // Also check InputManager state directly
  const inputState = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return null;
    // Try to access input manager
    try {
      // The minimal API doesn't expose input, but maybe via player
      return { note: 'input state not directly accessible from minimal API' };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('9. Input access:', JSON.stringify(inputState));

  // Try KeyboardEvent dispatch directly
  console.log('10. Trying direct KeyboardEvent dispatch...');
  await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'd',
      code: 'KeyD',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    console.log('[DIAG] Manually dispatched keydown for d');
  });
  await sleep(2000);

  const afterManual = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return null;
    return {
      x: dbg.player?.mesh?.position?.x,
      y: dbg.player?.mesh?.position?.y,
      z: dbg.player?.mesh?.position?.z,
      keyEvents: window.__diagKeyEvents.length,
    };
  });
  console.log('11. After manual dispatch:', JSON.stringify(afterManual));

  // Now dispatch keyup
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'd', code: 'KeyD', bubbles: true }));
  });

  // Wait and check game mode/countdown
  console.log('12. Checking game state more deeply...');
  const deepState = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return { error: 'no debug' };

    // Check if game is running
    return {
      playerAlive: dbg.player?.alive,
      playerLives: dbg.player?.lives,
      gameRunning: dbg.game?._running,
      // Check if there's a countdown overlay visible
      countdownOverlay: document.getElementById('countdown-overlay')?.style?.display,
      gameOverScreen: document.getElementById('game-over-screen')?.style?.display,
      // Check document focus
      hasFocus: document.hasFocus(),
      activeElement: document.activeElement?.tagName,
    };
  });
  console.log('    Deep state:', JSON.stringify(deepState, null, 2));

  // Take final screenshot
  const { join } = await import('path');
  const { dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __filename2 = fileURLToPath(import.meta.url);
  const __dirname2 = dirname(__filename2);
  const screenshotDir = join(__dirname2, 'screenshots');
  const fs = await import('fs');
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
  await page.screenshot({ path: join(screenshotDir, 's15-keyboard-diagnostic.png') });
  console.log('13. Screenshot saved');

  await browser.close();
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
