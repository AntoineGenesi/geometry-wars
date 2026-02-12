#!/usr/bin/env node
/**
 * Deep diagnostic: check exactly WHY keyboard input doesn't produce movement.
 */
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || 3025;
const URL = `http://localhost:${PORT}/?quickStart=true&surface=sphere&debug=true`;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function run() {
  console.log('=== DEEP MOVEMENT DIAGNOSTIC ===');
  console.log(`URL: ${URL}\n`);

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
    if (text.startsWith('[DIAG]') || text.startsWith('[HOOK]')) {
      console.log(text);
    }
  });

  console.log('1. Loading game with debug=true...');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);

  // Inject diagnostic hooks into the game EARLY
  console.log('2. Injecting diagnostic hooks...');
  await page.evaluate(() => {
    // Track if keysDown has our key
    window.__diagData = {
      keydownCount: 0,
      keyupCount: 0,
      keysDownSnapshot: null,
      inputStateSnapshots: [],
      gameModePhase: null,
      isPaused: null,
      isGameOver: null,
      isLevelComplete: null,
      playerAlive: null,
      moveFromInputCallCount: 0,
    };

    // Track keyboard events at window level
    window.addEventListener('keydown', (e) => {
      window.__diagData.keydownCount++;
      console.log(`[DIAG] keydown: ${e.key} (total: ${window.__diagData.keydownCount})`);
    });
  });

  // Wait for game to fully initialize
  console.log('3. Waiting 20s for game + countdown...');
  await sleep(20000);

  // Set lives and ensure alive
  await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (dbg && dbg.player) {
      dbg.player.lives = 99;
      if (!dbg.player.alive) {
        dbg.player.respawn(0.5, 0.5);
      }
    }
  });
  await sleep(3000);

  // Snapshot game state DEEPLY
  console.log('4. Deep state snapshot:');
  const deepState = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return { error: 'no __gameDebug' };

    const result = {
      hasGame: !!dbg.game,
      hasPlayer: !!dbg.player,
      playerAlive: dbg.player?.alive,
      playerLives: dbg.player?.lives,
      playerPosition: dbg.player?.mesh?.position ? {
        x: dbg.player.mesh.position.x,
        y: dbg.player.mesh.position.y,
        z: dbg.player.mesh.position.z,
      } : null,
      // Check game running state
      gameIsRunning: dbg.game?._animationFrameId !== undefined && dbg.game?._animationFrameId !== null,
      gameAnimFrameId: dbg.game?._animationFrameId,
      // Check document focus
      hasFocus: document.hasFocus(),
      activeElement: document.activeElement?.tagName,
      // Check for UI overlays that might be capturing input
      countdownVisible: (() => {
        const el = document.getElementById('countdown-overlay');
        if (!el) return 'element-not-found';
        return el.style.display || 'default';
      })(),
      gameOverVisible: (() => {
        const el = document.getElementById('game-over-screen');
        if (!el) return 'element-not-found';
        return el.style.display || 'default';
      })(),
      pauseVisible: (() => {
        const el = document.getElementById('pause-overlay');
        if (!el) return 'element-not-found';
        return el.style.display || 'default';
      })(),
      // Check canvas
      hasCanvas: !!document.querySelector('canvas'),
      // Check for pointer lock
      pointerLockElement: document.pointerLockElement?.tagName || null,
    };
    return result;
  });
  console.log(JSON.stringify(deepState, null, 2));

  // Now inject a HOOK into the game loop itself
  console.log('\n5. Hooking into game internals...');
  const hookResult = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return 'no-debug';

    // Try to access the game's internal loop mechanism
    const game = dbg.game;

    // Check if onFixedUpdate is set
    const hasFixedUpdate = typeof game.onFixedUpdate === 'function';
    const hasRender = typeof game.onRender === 'function';

    // Monkey-patch the game's onFixedUpdate to add diagnostics
    if (hasFixedUpdate) {
      const origFixed = game.onFixedUpdate.bind(game);
      let callCount = 0;
      game.onFixedUpdate = function(dt) {
        callCount++;
        if (callCount % 100 === 1) {
          console.log(`[HOOK] fixedUpdate #${callCount} dt=${dt.toFixed(4)}`);
        }
        return origFixed(dt);
      };
      window.__diagFixedUpdateCount = () => callCount;
      return { hooked: true, hadFixedUpdate: true, hadRender: hasRender };
    }

    return { hooked: false, hadFixedUpdate: hasFixedUpdate, hadRender: hasRender };
  });
  console.log('   Hook result:', JSON.stringify(hookResult));

  // Wait a second and check if fixedUpdate is being called
  await sleep(3000);
  const fixedCount = await page.evaluate(() => {
    return window.__diagFixedUpdateCount ? window.__diagFixedUpdateCount() : -1;
  });
  console.log(`   fixedUpdate calls in 3s: ${fixedCount}`);

  // Now press D and check WHAT happens in the input pipeline
  console.log('\n6. Testing D key with input pipeline inspection...');

  // First, check the InputManager state BEFORE pressing
  const beforeInput = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return null;

    // Try to access input directly if available on debug API
    // The minimal API doesn't have it, but the full debug API might
    const fullApi = dbg.getInputState ? dbg.getInputState() : null;

    return {
      fullApiAvailable: !!fullApi,
      fullApiState: fullApi,
    };
  });
  console.log('   Input before:', JSON.stringify(beforeInput));

  // Press D
  await page.keyboard.down('KeyD');
  await sleep(500);

  // Check input state WHILE key is held
  const duringInput = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return null;

    const fullApi = dbg.getInputState ? dbg.getInputState() : null;

    return {
      fullApiState: fullApi,
      keydownTotal: window.__diagData.keydownCount,
    };
  });
  console.log('   Input during D:', JSON.stringify(duringInput));

  await page.keyboard.up('KeyD');
  await sleep(500);

  // Check player position
  const afterPos = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg || !dbg.player) return null;
    const p = dbg.player.mesh.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  console.log('   Player position after D:', JSON.stringify(afterPos));

  // Try pressing with lowercase key name
  console.log('\n7. Testing lowercase "d" key...');
  await page.keyboard.down('d');
  await sleep(500);

  const duringLower = await page.evaluate(() => {
    return {
      keydownTotal: window.__diagData.keydownCount,
    };
  });
  console.log('   Key events after lowercase d:', JSON.stringify(duringLower));

  await page.keyboard.up('d');
  await sleep(500);

  // Final: check game clock
  console.log('\n8. Checking game clock...');
  const clockState = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg || !dbg.game) return null;

    const game = dbg.game;
    const clock = game.clock;
    if (!clock) return { hasClock: false };

    return {
      hasClock: true,
      // Try to read clock properties
      clockKeys: Object.keys(clock).filter(k => !k.startsWith('_')),
    };
  });
  console.log('   Clock:', JSON.stringify(clockState));

  // Check fixedUpdate count now
  const fixedCount2 = await page.evaluate(() => {
    return window.__diagFixedUpdateCount ? window.__diagFixedUpdateCount() : -1;
  });
  console.log(`   fixedUpdate total calls: ${fixedCount2}`);

  await browser.close();
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
