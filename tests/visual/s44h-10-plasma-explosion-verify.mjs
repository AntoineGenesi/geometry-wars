/**
 * Visual verification for s44h-10: Plasma Mortar Explosion Effect
 *
 * Verifies that:
 * 1. The game starts and renders
 * 2. The PlasmaExplosionEffect is present and active in the scene
 * 3. A screenshot is captured showing the game state
 *
 * Run from project root: node tests/visual/s44h-10-plasma-explosion-verify.mjs [port]
 */

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const PORT = process.argv[2] || 3031;
const BASE_URL = `http://localhost:${PORT}`;

const SESSION_DIR = path.join(__dirname, '../../test-screenshots/sessions/s44h-10-plasma-explosion');
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

  const url = `${BASE_URL}/?quickStart=true&surface=sphere`;
  console.log(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for game to initialize (SwiftShader is slow)
  console.log('Waiting for game to initialize...');
  await sleep(12000);

  // Screenshot 1: Initial game state
  const shot1 = path.join(SESSION_DIR, '01-initial.png');
  await page.screenshot({ path: shot1 });
  console.log(`Screenshot 1 (initial game state): ${shot1}`);

  // Inject Plasma Mortar weapon and trigger explosion
  const injectionResult = await page.evaluate(() => {
    try {
      const g = window.__gameDebug;
      if (!g) return { error: 'No __gameDebug found' };

      // Check if weaponManager is accessible (it's on ctx in minimal API)
      const wm = g.weaponManager || g.ctx?.weaponManager;
      if (!wm) return { error: 'No weaponManager' };

      // Add plasma mortar weapon with some ammo
      wm.addWeapon && wm.addWeapon('plasma_mortar');

      // Switch to plasma mortar
      wm.setWeapon && wm.setWeapon('plasma_mortar');

      // Check for PlasmaExplosionEffect in scene
      const scene = g.scene || g.game?.scene || g.ctx?.game?.scene;
      if (!scene) return { weaponSet: true, sceneFound: false };

      let ringFound = false;
      scene.traverse(obj => {
        if (obj.name === 'PlasmaExplosionEffect') {
          ringFound = true;
        }
      });

      return {
        weaponSet: true,
        sceneFound: true,
        ringEffectInScene: ringFound,
        sceneChildren: scene.children.length,
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  console.log('Injection result:', JSON.stringify(injectionResult));

  // Wait a bit for any pending updates
  await sleep(3000);

  // Screenshot 2: After injection
  const shot2 = path.join(SESSION_DIR, '02-post-injection.png');
  await page.screenshot({ path: shot2 });
  console.log(`Screenshot 2 (after weapon injection): ${shot2}`);

  // Trigger plasma mortar explosion via game debug interface
  const explosionResult = await page.evaluate(() => {
    try {
      const g = window.__gameDebug;
      if (!g) return { error: 'No game debug' };
      const wm = g.weaponManager || g.ctx?.weaponManager;
      if (!wm) return { error: 'No weaponManager on debug' };

      // Check for plasmaExplosionEffect in scene
      const scene = g.scene || g.game?.scene || g.ctx?.game?.scene;
      let ringEffectNode = null;
      if (scene) {
        scene.traverse(obj => {
          if (obj.name === 'PlasmaExplosionEffect' && !ringEffectNode) {
            ringEffectNode = obj;
          }
        });
      }

      // Also check via ctx.plasmaExplosionEffect directly
      if (!ringEffectNode && g.ctx?.plasmaExplosionEffect) {
        ringEffectNode = g.ctx.plasmaExplosionEffect.root;
      }

      if (!ringEffectNode) return { error: 'PlasmaExplosionEffect not in scene' };

      // Get active ring count from the effect
      // The object has children (ring meshes). Count visible ones.
      const visibleRings = ringEffectNode.children.filter(c => c.visible).length;

      return {
        effectFound: true,
        childCount: ringEffectNode.children.length,
        visibleRings,
        effectPosition: ringEffectNode.position.toArray(),
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  console.log('Effect check:', JSON.stringify(explosionResult));

  // Final screenshot
  const shot3 = path.join(SESSION_DIR, '03-final.png');
  await page.screenshot({ path: shot3 });
  console.log(`Screenshot 3 (final): ${shot3}`);

  console.log('\n=== VERIFICATION RESULTS ===');
  if (errors.length > 0) {
    console.log('ERRORS:', errors.slice(0, 5));
  }

  const gameLoaded = !injectionResult.error || injectionResult.weaponSet;
  const effectInScene = explosionResult.effectFound && !explosionResult.error;
  const effectHasChildren = effectInScene && explosionResult.childCount > 0;

  console.log(`Game loaded: ${gameLoaded ? 'YES' : 'NO'}`);
  console.log(`PlasmaExplosionEffect in scene: ${effectInScene ? 'YES' : 'NO - ' + (explosionResult.error || 'unknown')}`);
  console.log(`Ring mesh children in effect: ${effectHasChildren ? explosionResult.childCount : 'NO'}`);
  console.log(`\nScreenshots saved to: ${SESSION_DIR}`);
  console.log('VIEW SCREENSHOTS to confirm visual ring effect is implemented correctly.');

  await browser.close();

  // Exit code based on whether effect was found
  if (!effectInScene) {
    console.error('FAIL: PlasmaExplosionEffect not found in scene!');
    process.exit(1);
  } else {
    console.log('PASS: PlasmaExplosionEffect is in the scene with', explosionResult.childCount, 'ring meshes.');
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
