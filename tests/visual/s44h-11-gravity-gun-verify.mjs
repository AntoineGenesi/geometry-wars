/**
 * Visual verification for s44h-11: Gravity Gun Visual Enhancement
 *
 * Verifies that the gravity gun shows:
 *   1. Purple implosion burst on explosion (gravityExplosion)
 *   2. Pull-trail streaks from enemies toward gun (gravityPullTrail)
 *   3. Surface suction distortion as projectile travels (onGravityGunMove)
 *
 * Run: node tests/visual/s44h-11-gravity-gun-verify.mjs [PORT]
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = process.argv[2] || 3041;
const BASE_URL = `http://localhost:${PORT}`;

const SESSION_DIR = path.join(__dirname, '../../test-screenshots/sessions/s44h-11-gravity-gun');
fs.mkdirSync(SESSION_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  console.log(`Launching browser (SwiftShader WebGL) on port ${PORT}...`);
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--use-gl=swiftshader',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1280,720',
      '--disable-dev-shm-usage',
      '--disable-frame-rate-limit',
      '--disable-gpu-vsync',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

  const logs = [];
  const errors = [];
  page.on('console', msg => {
    const text = msg.text();
    logs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') errors.push(text);
  });
  page.on('pageerror', err => errors.push('PageError: ' + err.message));

  const url = `${BASE_URL}/?quickStart=true`;
  console.log(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Remove loading screen immediately (quickStart bypasses StartMenu which normally dismisses it)
  await sleep(1500);
  await page.evaluate(() => {
    document.querySelectorAll('#loading-screen, .loading-screen').forEach(el => el.remove());
  });

  // Poll for game to be ready, then immediately patch invincibility
  console.log('Polling for game to be ready (patch invincibility ASAP)...');
  let patched = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(500);
    const result = await page.evaluate(() => {
      // Remove loading screen every poll (it may re-appear or not yet be in DOM)
      document.querySelectorAll('#loading-screen, .loading-screen').forEach(el => el.remove());

      const g = window.__gameDebug;
      if (!g) return { ready: false };
      const ctx = g.ctx || g;
      const player = ctx.player || g.player;
      if (!player) return { ready: false };

      // Patch invincibility immediately
      try {
        Object.defineProperty(player, 'isInvincible', {
          get: () => true,
          set: () => {},
          configurable: true,
        });
      } catch (_) {}

      return { ready: true, alive: !player.isDead, invincible: player.isInvincible };
    });

    if (result.ready) {
      patched = true;
      console.log(`Game ready at attempt ${attempt}: ${JSON.stringify(result)}`);
      break;
    }
  }

  if (!patched) {
    console.warn('WARNING: Could not patch invincibility — game may not have initialized');
  }

  // Now wait for SwiftShader to render the 3D scene (player is invincible, safe to wait)
  console.log('Waiting 20s for SwiftShader to render...');
  await sleep(20000);

  const setupResult = { loadingScreenRemoved: true };

  // Screenshot 1: Game should be visible now (no loading screen)
  const shot1 = path.join(SESSION_DIR, '01-game-loaded.png');
  await page.screenshot({ path: shot1 });
  console.log(`Screenshot 1 (game loaded): ${shot1}`);

  // Patch invincibility and equip gravity gun
  const gameState = await page.evaluate(() => {
    const g = window.__gameDebug;
    if (!g) return { error: 'no __gameDebug' };

    const ctx = g.ctx || g;
    let playerAlive = false;
    let invincible = false;
    let weaponEquipped = false;

    // Patch player invincibility
    const player = ctx.player || g.player;
    if (player) {
      try {
        Object.defineProperty(player, 'isInvincible', {
          get: () => true,
          set: () => {},
          configurable: true,
        });
        invincible = true;
        playerAlive = !player.isDead;
      } catch (e) {
        // May already be defined
        invincible = false;
      }
    }

    // Equip gravity gun with lots of ammo
    const wm = ctx.weaponManager;
    if (wm && wm.equipWeapon) {
      try {
        wm.equipWeapon('gravity_gun', 999);
        weaponEquipped = true;
      } catch (e) {
        // Try alternate approaches
        const state = wm.getState ? wm.getState() : null;
        return { error: 'equipWeapon failed: ' + e.message, state };
      }
    }

    return {
      playerAlive,
      invincible,
      weaponEquipped,
      playerPos: player ? { x: player.mesh?.position?.x?.toFixed(2), y: player.mesh?.position?.y?.toFixed(2) } : null,
      activeWeapon: wm ? (wm.currentWeapon || wm.activeWeapon || wm.equippedWeapon) : null,
    };
  });
  console.log('Game state:', JSON.stringify(gameState));

  // Screenshot 2: State after equipping gravity gun
  const shot2 = path.join(SESSION_DIR, '02-gravity-gun-equipped.png');
  await page.screenshot({ path: shot2 });
  console.log(`Screenshot 2 (gravity gun equipped): ${shot2}`);

  // Fire gravity gun — move mouse to aim and click repeatedly
  console.log('Firing gravity gun...');
  await page.mouse.move(800, 400);  // Aim toward where enemies might be
  await sleep(500);

  // Fire 5 shots
  for (let i = 0; i < 5; i++) {
    await page.mouse.click(800 + i * 20, 350 + i * 10);
    await sleep(600);  // gravity gun fires at 1/s, wait between shots
  }

  await sleep(2000);

  // Screenshot 3: After firing — should show purple implosion effect
  const shot3 = path.join(SESSION_DIR, '03-after-firing.png');
  await page.screenshot({ path: shot3 });
  console.log(`Screenshot 3 (after firing): ${shot3}`);

  // Fire more, move mouse across screen to spread shots
  await page.mouse.move(400, 360);
  await page.mouse.click(400, 360);
  await sleep(700);
  await page.mouse.move(900, 300);
  await page.mouse.click(900, 300);
  await sleep(700);
  await page.mouse.move(640, 200);
  await page.mouse.click(640, 200);
  await sleep(700);

  // Wait for effects to play out
  await sleep(3000);

  // Screenshot 4: After more shots — should see purple particles / surface distortion
  const shot4 = path.join(SESSION_DIR, '04-effects-visible.png');
  await page.screenshot({ path: shot4 });
  console.log(`Screenshot 4 (effects visible): ${shot4}`);

  // Read final game state to verify particles fired
  const finalState = await page.evaluate(() => {
    const g = window.__gameDebug;
    if (!g) return { error: 'no debug' };
    const ctx = g.ctx || g;

    // Check weapon ammo (should be reduced from 999)
    const wm = ctx.weaponManager;
    let ammoLeft = null;
    if (wm) {
      const state = wm.getState ? wm.getState() : null;
      ammoLeft = state;
    }

    // Check particle system
    const ps = ctx.particles || ctx.particleSystem;
    let particleCount = null;
    if (ps && ps.activeCount !== undefined) particleCount = ps.activeCount;
    if (ps && ps.count !== undefined) particleCount = ps.count;

    return {
      ammoState: ammoLeft,
      particleCount,
      playerAlive: ctx.player ? !ctx.player.isDead : null,
    };
  });
  console.log('Final state:', JSON.stringify(finalState));

  if (errors.length > 0) {
    console.log('\nConsole errors (first 5):');
    errors.slice(0, 5).forEach(e => console.log('  ', e));
  }

  await browser.close();

  console.log('\n=== LEVEL 5 VERIFICATION RESULTS ===');
  console.log(`Screenshots saved to: ${SESSION_DIR}`);
  console.log('');
  console.log('Visual checks (inspect screenshots):');
  console.log('  shot1: Game canvas visible (no loading screen overlay)');
  console.log('  shot2: Gravity gun equipped (check HUD for weapon icon)');
  console.log('  shot3: Purple implosion burst visible after first shots');
  console.log('  shot4: Purple particles/trails visible (gravity pull effect)');
  console.log('');
  console.log('Game state summary:');
  console.log('  Player alive:', gameState?.playerAlive);
  console.log('  Invincible:', gameState?.invincible);
  console.log('  Weapon equipped:', gameState?.weaponEquipped);
}

run().catch(e => {
  console.error('Test error:', e.message, e.stack);
  process.exit(1);
});
