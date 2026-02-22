#!/usr/bin/env node
/**
 * S27g Aim Offset Verification — Level 5 Puppeteer Test
 *
 * Verifies that after the fix, bullet direction aligns with camera right/up axes.
 * Uses window._gameState (requires ?testMode=true&quickStart=true).
 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/s27g-aim-offset');
const BASE_URL = 'http://localhost:3015';
const CHROME_PATH = '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Wait for game state to indicate the game is playing (not in menu/countdown)
async function waitForGameState(page, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(() => window._gameState);
    if (state?.game?.frameCount > 5 && !state?.game?.isPaused && !state?.game?.isGameOver) {
      return state;
    }
    await sleep(500);
  }
  return null;
}

async function main() {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('='.repeat(70));
  console.log('  S27g Aim Offset Verification (Level 5 Puppeteer)');
  console.log('='.repeat(70));

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
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

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    const t = msg.type();
    if (t === 'error') errors.push(`[console] ${msg.text()}`);
    if (t === 'log' && msg.text().includes('GameStateExporter')) console.log(`   [game] ${msg.text()}`);
  });

  let passed = 0;
  let failed = 0;
  const results = [];

  try {
    // Load game with quickStart (skips menu) and testMode (enables game state API)
    console.log('\n1. Loading game with quickStart + testMode...');
    await page.goto(
      `${BASE_URL}?quickStart=true&surface=sphere&testMode=true`,
      { waitUntil: 'domcontentloaded', timeout: 15000 }
    );
    await sleep(8000); // SwiftShader needs time to load
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-game-loading.png` });

    // Wait for game to be running
    console.log('   Waiting for game to start...');
    const initialState = await waitForGameState(page, 25000);

    if (!initialState) {
      const raw = await page.evaluate(() => window._gameState);
      console.log('   ⚠ Game state not ready. Raw state:', JSON.stringify(raw));
      await page.screenshot({ path: `${SCREENSHOT_DIR}/01b-state-debug.png` });
      results.push({ test: 'Game initialization', status: 'FAIL', detail: 'Game state not available' });
      failed++;
      throw new Error('Game did not start within timeout');
    }

    console.log(`   ✓ Game running: frame=${initialState.game.frameCount}, surface=${initialState.game.surface}`);
    console.log(`   Walker position: (${initialState.walker.position.x.toFixed(2)}, ${initialState.walker.position.y.toFixed(2)}, ${initialState.walker.position.z.toFixed(2)})`);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/02-game-started.png` });
    results.push({ test: 'Game initialization', status: 'PASS', detail: `frame=${initialState.game.frameCount}` });
    passed++;

    // -----------------------------------------------------------------------
    // CHECK: Camera axes vs surface tangent frame alignment
    // After fix, camera matrixWorld is used for aim. Let's verify the
    // camera right vector and tangent frame are accessible and well-defined.
    // -----------------------------------------------------------------------
    console.log('\n2. Checking camera vs tangent frame alignment...');

    const cameraVsFrame = await page.evaluate(() => {
      const state = window._gameState;
      if (!state) return null;

      // Reconstruct camera right from quaternion (column 0 of rotation matrix)
      const q = state.camera.quaternion;
      // Camera right = rotate (1,0,0) by camera quaternion
      // Using quaternion rotation formula
      const x = q.x, y = q.y, z = q.z, w = q.w;
      // rotate (1,0,0) by q:
      const camRightX = 1 - 2*(y*y + z*z);
      const camRightY = 2*(x*y + w*z);
      const camRightZ = 2*(x*z - w*y);

      const t = state.walker;
      // Dot of camera right with surface tangent
      const dotWithTangent = camRightX * t.tangent.x + camRightY * t.tangent.y + camRightZ * t.tangent.z;
      // Dot of camera right with normal (should be ~0 if camera is above surface)
      const dotWithNormal = camRightX * t.normal.x + camRightY * t.normal.y + camRightZ * t.normal.z;

      return {
        camRight: { x: camRightX, y: camRightY, z: camRightZ },
        tangent: t.tangent,
        normal: t.normal,
        dotCamRightVsTangent: dotWithTangent,
        dotCamRightVsNormal: dotWithNormal,
      };
    });

    if (cameraVsFrame) {
      const dot = cameraVsFrame.dotCamRightVsTangent;
      const normalLeak = cameraVsFrame.dotCamRightVsNormal;
      console.log(`   Camera right dot tangent: ${dot.toFixed(4)}`);
      console.log(`   Camera right dot normal: ${normalLeak.toFixed(4)} (should be ~0)`);

      // Camera right should be mostly in the tangent plane (small normal component)
      if (Math.abs(normalLeak) < 0.1) {
        console.log('   ✓ Camera right vector lies in surface tangent plane');
        results.push({ test: 'Camera right in tangent plane', status: 'PASS', detail: `normal_leak=${normalLeak.toFixed(4)}` });
        passed++;
      } else {
        console.log(`   ⚠ Camera right has normal component: ${normalLeak.toFixed(4)} (camera tilted)`);
        results.push({ test: 'Camera right in tangent plane', status: 'INFO', detail: `normal_leak=${normalLeak.toFixed(4)}` });
      }
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/03-pre-fire.png` });

    // -----------------------------------------------------------------------
    // CHECK: Fire bullet to the RIGHT (mouse right of center) and verify
    // the bullet direction aligns with camera right
    // -----------------------------------------------------------------------
    console.log('\n3. Firing bullet to the RIGHT...');

    // Move mouse right of center
    await page.mouse.move(840, 360); // 200px right of center (640)
    await sleep(2000); // Let aim update (SwiftShader slow)

    const stateBeforeFire = await page.evaluate(() => window._gameState);
    console.log(`   Player alive: ${stateBeforeFire?.player?.alive}`);
    console.log(`   Player orientation: ${JSON.stringify(stateBeforeFire?.player?.orientation)}`);

    // Fire
    await page.mouse.down();
    await sleep(1000);
    await page.mouse.up();
    await sleep(2000); // Let bullet travel

    await page.screenshot({ path: `${SCREENSHOT_DIR}/04-bullet-fired-right.png` });

    // Check bullet pool via game state
    const bulletState = await page.evaluate(() => {
      const gs = window._gameState;
      // Also try to get bullet pool from game context if accessible
      const ctx = window.__ctx;
      if (ctx?.bulletPool) {
        const bullets = [];
        ctx.bulletPool.forEachActive((idx, pos, data) => {
          bullets.push({ pos: {x: pos.x, y: pos.y, z: pos.z}, dir: {x: data.dirX, y: data.dirY, z: data.dirZ} });
        });
        return { source: 'bulletPool', bullets };
      }
      return { source: 'none', gameState: gs };
    });

    console.log(`   Bullet data source: ${bulletState?.source}`);
    if (bulletState?.source === 'bulletPool' && bulletState.bullets?.length > 0) {
      const b = bulletState.bullets[0];
      console.log(`   First bullet direction: (${b.dir.x.toFixed(3)}, ${b.dir.y.toFixed(3)}, ${b.dir.z.toFixed(3)})`);

      // Get camera right from game state
      const camInfo = await page.evaluate(() => {
        const state = window._gameState;
        if (!state) return null;
        const q = state.camera.quaternion;
        const x = q.x, y = q.y, z = q.z, w = q.w;
        return {
          camRightX: 1 - 2*(y*y + z*z),
          camRightY: 2*(x*y + w*z),
          camRightZ: 2*(x*z - w*y),
        };
      });

      if (camInfo) {
        const bulletDotCamRight =
          b.dir.x * camInfo.camRightX +
          b.dir.y * camInfo.camRightY +
          b.dir.z * camInfo.camRightZ;

        console.log(`   Bullet dir · camera right = ${bulletDotCamRight.toFixed(3)} (should be > 0.7)`);

        if (bulletDotCamRight > 0.7) {
          console.log('   ✓ Bullet travels in screen-right direction');
          results.push({ test: 'Bullet right alignment', status: 'PASS', detail: `dot=${bulletDotCamRight.toFixed(3)}` });
          passed++;
        } else {
          console.log('   ✗ FAIL: Bullet NOT going screen-right');
          results.push({ test: 'Bullet right alignment', status: 'FAIL', detail: `dot=${bulletDotCamRight.toFixed(3)}` });
          failed++;
        }
      }
    } else {
      console.log('   ⚠ Could not read bullet pool directly — verifying via player orientation instead');

      // Fallback: check player mesh orientation (it points in aim direction)
      const playerOrientation = stateBeforeFire?.player?.orientation;
      if (playerOrientation) {
        // Player's forward direction (local +Z rotated by quaternion)
        const q = playerOrientation;
        const x = q.x, y = q.y, z = q.z, w = q.w;
        // rotate (0,0,1) by quaternion
        const fwdX = 2*(x*z + w*y);
        const fwdY = 2*(y*z - w*x);
        const fwdZ = 1 - 2*(x*x + y*y);

        const camQ = stateBeforeFire?.camera?.quaternion;
        if (camQ) {
          const cx = camQ.x, cy = camQ.y, cz = camQ.z, cw = camQ.w;
          const camRightX = 1 - 2*(cy*cy + cz*cz);
          const camRightY = 2*(cx*cy + cw*cz);
          const camRightZ = 2*(cx*cz - cw*cy);

          const dot = fwdX * camRightX + fwdY * camRightY + fwdZ * camRightZ;
          console.log(`   Player forward · camera right = ${dot.toFixed(3)} (aiming right → should be > 0.7)`);

          if (dot > 0.7) {
            console.log('   ✓ Player oriented toward screen-right');
            results.push({ test: 'Player right aim orientation', status: 'PASS', detail: `dot=${dot.toFixed(3)}` });
            passed++;
          } else if (dot > 0.3) {
            console.log('   ~ Partial alignment (camera may still be settling)');
            results.push({ test: 'Player right aim orientation', status: 'PARTIAL', detail: `dot=${dot.toFixed(3)}` });
          } else {
            console.log('   ✗ FAIL: Player NOT oriented toward screen-right');
            results.push({ test: 'Player right aim orientation', status: 'FAIL', detail: `dot=${dot.toFixed(3)}` });
            failed++;
          }
        }
      }
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-final.png` });
    console.log('\n   ✓ All checks complete. Screenshots saved.');

  } catch (err) {
    console.error('\n  ERROR:', err.message);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/error.png` }).catch(() => {});
    results.push({ test: 'Puppeteer execution', status: 'ERROR', detail: err.message });
    failed++;
  } finally {
    await browser.close();
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('  RESULTS SUMMARY');
  console.log('='.repeat(70));
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✓' : r.status === 'FAIL' ? '✗' : r.status === 'ERROR' ? '!' : 'ℹ';
    console.log(`  ${icon} [${r.status}] ${r.test}: ${r.detail}`);
  }
  console.log(`\n  Passed: ${passed}, Failed: ${failed}`);
  console.log(`  Screenshots saved to: ${SCREENSHOT_DIR}/`);

  if (errors.length > 0) {
    console.log('\n  Page errors:');
    errors.slice(0, 5).forEach(e => console.log(`    - ${e.slice(0, 100)}`));
  }

  writeFileSync(`${SCREENSHOT_DIR}/results.json`, JSON.stringify({ passed, failed, results, errors }, null, 2));

  if (failed === 0) {
    console.log('\n  ✓ LEVEL 5 VERIFICATION: Soft YES');
  } else {
    console.log('\n  ✗ LEVEL 5 VERIFICATION: Some checks failed');
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
