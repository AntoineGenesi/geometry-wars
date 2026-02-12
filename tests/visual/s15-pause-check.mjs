#!/usr/bin/env node
/**
 * Check if game is paused in headless Puppeteer due to visibility/focus issues
 */
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || 3025;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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
    if (text.startsWith('[DIAG]')) console.log(text);
  });

  // Use quickStart WITHOUT debug=true first
  const url = `http://localhost:${PORT}/?quickStart=true&surface=sphere`;
  console.log('Loading:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Inject early hooks to track blur/focus/visibility
  await page.evaluate(() => {
    window.__diagEvents = [];
    window.addEventListener('blur', () => {
      window.__diagEvents.push({ ts: Date.now(), type: 'blur' });
      console.log('[DIAG] window blur');
    });
    window.addEventListener('focus', () => {
      window.__diagEvents.push({ ts: Date.now(), type: 'focus' });
      console.log('[DIAG] window focus');
    });
    document.addEventListener('visibilitychange', () => {
      window.__diagEvents.push({ ts: Date.now(), type: 'visibilitychange', hidden: document.hidden });
      console.log(`[DIAG] visibilitychange: hidden=${document.hidden}`);
    });
  });

  console.log('Waiting 10s...');
  await sleep(10000);

  // Check basic state
  const state1 = await page.evaluate(() => ({
    hidden: document.hidden,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    events: window.__diagEvents,
  }));
  console.log('State after 10s:', JSON.stringify(state1, null, 2));

  // Set lives high
  await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (dbg && dbg.player) dbg.player.lives = 99;
  });

  console.log('Waiting 15s more...');
  await sleep(15000);

  // Now check if game loop is processing movement
  const state2 = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return { error: 'no debug' };
    return {
      alive: dbg.player?.alive,
      lives: dbg.player?.lives,
      px: dbg.player?.mesh?.position?.x,
      hidden: document.hidden,
      hasFocus: document.hasFocus(),
    };
  });
  console.log('State after 25s:', JSON.stringify(state2));

  // Inject a counter inside the MOVEMENT code path
  console.log('\nInjecting movement tracker...');
  const injected = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg || !dbg.game) return false;

    // Track how many times the game loop's fixed update runs
    window.__moveCallCount = 0;
    window.__moveSkipReason = [];

    const origFixed = dbg.game.onFixedUpdate;
    if (!origFixed) return false;

    // We need to wrap it more carefully. The onFixedUpdate is a callback
    // that receives dt. Let's see if it's been set.
    const origFn = dbg.game.onFixedUpdate;
    dbg.game.onFixedUpdate = function(dt) {
      window.__moveCallCount++;
      return origFn.call(this, dt);
    };

    return true;
  });
  console.log('Injected:', injected);

  await sleep(3000);

  const moveCount1 = await page.evaluate(() => window.__moveCallCount);
  console.log(`Move calls in 3s: ${moveCount1}`);

  // Now press D for 3 seconds WITHOUT any evaluate in between
  console.log('\nPressing D for 3s (no evaluate during)...');
  const beforePos = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    return dbg?.player?.mesh?.position ? {
      x: dbg.player.mesh.position.x,
      y: dbg.player.mesh.position.y,
      z: dbg.player.mesh.position.z,
      alive: dbg.player.alive,
    } : null;
  });
  console.log('Before:', JSON.stringify(beforePos));

  await page.keyboard.down('d');
  // DON'T call evaluate during this time — just wait
  await sleep(3000);
  await page.keyboard.up('d');
  await sleep(200);

  const afterPos = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    return dbg?.player?.mesh?.position ? {
      x: dbg.player.mesh.position.x,
      y: dbg.player.mesh.position.y,
      z: dbg.player.mesh.position.z,
      alive: dbg.player.alive,
      moveCount: window.__moveCallCount,
    } : null;
  });
  console.log('After:', JSON.stringify(afterPos));

  if (beforePos && afterPos) {
    const dx = afterPos.x - beforePos.x;
    const dy = afterPos.y - beforePos.y;
    const dz = afterPos.z - beforePos.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    console.log(`Displacement: (${dx.toFixed(3)}, ${dy.toFixed(3)}, ${dz.toFixed(3)}) len=${dist.toFixed(3)}`);
  }

  // Try with evaluate DURING key press (does it clear keysDown?)
  console.log('\nNow testing with evaluate DURING key press...');
  const before2 = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    return {
      x: dbg?.player?.mesh?.position?.x,
      y: dbg?.player?.mesh?.position?.y,
      z: dbg?.player?.mesh?.position?.z,
    };
  });
  console.log('Before:', JSON.stringify(before2));

  await page.keyboard.down('d');
  await sleep(500);

  // This evaluate might cause blur/focus issues
  const mid = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    return {
      x: dbg?.player?.mesh?.position?.x,
      y: dbg?.player?.mesh?.position?.y,
      z: dbg?.player?.mesh?.position?.z,
      hasFocus: document.hasFocus(),
    };
  });
  console.log('Mid (after 0.5s + evaluate):', JSON.stringify(mid));

  await sleep(2500);
  await page.keyboard.up('d');
  await sleep(200);

  const after2 = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    return {
      x: dbg?.player?.mesh?.position?.x,
      y: dbg?.player?.mesh?.position?.y,
      z: dbg?.player?.mesh?.position?.z,
    };
  });
  console.log('After:', JSON.stringify(after2));

  if (before2 && after2) {
    const dx = after2.x - before2.x;
    const dy = after2.y - before2.y;
    const dz = after2.z - before2.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    console.log(`Displacement: (${dx.toFixed(3)}, ${dy.toFixed(3)}, ${dz.toFixed(3)}) len=${dist.toFixed(3)}`);
  }

  await browser.close();
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
