#!/usr/bin/env node
/**
 * verify-enemies-visual.mjs — PIXEL-LEVEL enemy visibility verification.
 *
 * Unlike verify-enemies-all-surfaces.mjs (which only checks instanceColorBrightness),
 * this test takes SCREENSHOTS and analyzes actual pixel colors where enemies should be.
 * If the pixel at an enemy's screen position matches the background, the enemy is
 * INVISIBLE regardless of what the game state says.
 *
 * Architecture:
 *   1. Launch Puppeteer with SwiftShader (headless Chrome)
 *   2. Navigate to game with ?testMode=true&quickStart=true&surface=X
 *   3. Wait for enemies to spawn (via TestHarnessAPI)
 *   4. Project enemy world positions to screen coordinates (via camera matrix)
 *   5. Take screenshot, extract pixel colors at enemy screen positions
 *   6. Compare pixels against background samples → if match, enemy is INVISIBLE
 *   7. Save screenshots + per-enemy annotations as artifacts
 *
 * Usage:
 *   node tests/visual/verify-enemies-visual.mjs                        # sphere only
 *   node tests/visual/verify-enemies-visual.mjs --surface=torus        # specific surface
 *   node tests/visual/verify-enemies-visual.mjs --all                  # all 13 surfaces
 *   node tests/visual/verify-enemies-visual.mjs --deep                 # multi-wave (5 checkpoints)
 *
 * Outputs:
 *   - tests/visual/screenshots/visual-*.png
 *   - Console summary with PASS/FAIL per surface
 *   - Exit code 0 = all pass, 1 = failures found
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SCREENSHOT_DIR = resolve(__dirname, 'screenshots');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3040';

// All 12 valid SP surfaces (from SurfaceFactory.getAvailableSurfaces())
// Note: 'mobius-bevel' was removed — it's not a valid surface type
const ALL_SURFACES = [
  'sphere', 'torus', 'cube', 'cube-ring', 'pill',
  'peanut', 'mobius', 'sphere-tunnel', 'cube-tunnel',
  'pipe', 'capsule', 'icosahedron',
];

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=800,600',
];

const VIEWPORT = { width: 800, height: 600 };

// How many pixels around each enemy position to sample (radius)
// Enemies are ring-shaped meshes — center pixel is often EMPTY (hole of the ring).
// Must sample a wide enough area to catch the ring itself.
const SAMPLE_RADIUS = 14;

// Background luminance threshold — pixels dimmer than this are "background"
// SwiftShader renders everything dimmer than real GPU. Far-side enemies are
// legitimately dimmed by depth occlusion. The threshold must be low enough
// to detect dim-but-present enemies.
const BG_LUMINANCE_THRESHOLD = 8;

// Minimum distinct-from-background ratio to consider an enemy "visible"
// Ring-shaped enemies: only the ring pixels are bright, center is empty.
// Even a single bright pixel near the enemy position means it's rendered.
const VISIBILITY_RATIO_THRESHOLD = 0.08;

// Checkpoint times (ms after game start)
const STANDARD_CHECKPOINTS = [6000, 15000];
const DEEP_CHECKPOINTS = [6000, 15000, 30000, 50000, 70000];

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// World-to-screen projection (runs inside page.evaluate)
// ---------------------------------------------------------------------------

/**
 * Projects enemy world positions to screen coordinates using the game camera.
 * Returns array of { id, type, screenX, screenY, behindCamera, worldPos, icb }
 */
async function getEnemyScreenPositions(page) {
  return page.evaluate((vw, vh) => {
    const api = window.__TEST_API;
    if (!api) return null;

    const enemies = api.getEnemies().filter(e => e.alive);
    if (enemies.length === 0) return [];

    // Get camera from the game
    const cam = api.ctx?.game?.camera;
    if (!cam) return null;

    // Force camera matrix update
    cam.updateMatrixWorld(true);

    // Use Three.js Vector3.project() to get NDC coordinates
    const THREE = window.THREE;
    if (!THREE) return null;

    const results = [];
    for (const e of enemies) {
      const v = new THREE.Vector3(e.worldPos.x, e.worldPos.y, e.worldPos.z);
      v.project(cam);

      // NDC to screen coords
      const screenX = Math.round((v.x * 0.5 + 0.5) * vw);
      const screenY = Math.round((-v.y * 0.5 + 0.5) * vh);
      const behindCamera = v.z > 1; // behind camera if z > 1 in NDC

      results.push({
        id: e.id,
        type: e.type,
        screenX,
        screenY,
        behindCamera,
        worldPos: e.worldPos,
        icb: e.instanceColorBrightness,
        u: e.u,
        v: e.v,
        inBounds: screenX >= 0 && screenX < vw && screenY >= 0 && screenY < vh,
      });
    }
    return results;
  }, VIEWPORT.width, VIEWPORT.height);
}

// ---------------------------------------------------------------------------
// Pixel extraction from canvas
// ---------------------------------------------------------------------------

/**
 * Extracts pixel data from the game canvas at specified screen positions.
 * Returns: { positions: [{x,y,r,g,b,a,lum}], bgSamples: [{r,g,b,lum}] }
 */
async function extractPixelsAtPositions(page, positions) {
  return page.evaluate((posArr, sampleR, vw, vh) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;

    try {
      // Draw game canvas to a 2D canvas for pixel reading
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx = tmp.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0);

      // Scale factor: canvas pixels vs viewport
      const scaleX = canvas.width / vw;
      const scaleY = canvas.height / vh;

      const results = [];

      for (const pos of posArr) {
        const cx = Math.round(pos.screenX * scaleX);
        const cy = Math.round(pos.screenY * scaleY);

        // INNER samples: pixels near the enemy center (the enemy itself)
        const innerSamples = [];
        for (let dx = -sampleR; dx <= sampleR; dx += 2) {
          for (let dy = -sampleR; dy <= sampleR; dy += 2) {
            const px = cx + dx;
            const py = cy + dy;
            if (px < 0 || px >= tmp.width || py < 0 || py >= tmp.height) continue;
            const data = ctx.getImageData(px, py, 1, 1).data;
            const lum = 0.299 * data[0] + 0.587 * data[1] + 0.114 * data[2];
            innerSamples.push({ r: data[0], g: data[1], b: data[2], a: data[3], lum });
          }
        }

        // OUTER ring samples: pixels further away (local background reference)
        // Compare inner vs outer to detect if there's ANYTHING rendered at enemy pos
        const outerR = sampleR * 3;
        const outerSamples = [];
        for (let dx = -outerR; dx <= outerR; dx += 6) {
          for (let dy = -outerR; dy <= outerR; dy += 6) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            // Only sample the outer ring (between sampleR*2 and outerR)
            if (dist < sampleR * 2 || dist > outerR) continue;
            const px = cx + dx;
            const py = cy + dy;
            if (px < 0 || px >= tmp.width || py < 0 || py >= tmp.height) continue;
            const data = ctx.getImageData(px, py, 1, 1).data;
            const lum = 0.299 * data[0] + 0.587 * data[1] + 0.114 * data[2];
            outerSamples.push({ r: data[0], g: data[1], b: data[2], a: data[3], lum });
          }
        }

        // Center pixel
        let centerR = 0, centerG = 0, centerB = 0, centerLum = 0;
        if (cx >= 0 && cx < tmp.width && cy >= 0 && cy < tmp.height) {
          const d = ctx.getImageData(cx, cy, 1, 1).data;
          centerR = d[0]; centerG = d[1]; centerB = d[2];
          centerLum = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
        }

        const innerAvgLum = innerSamples.length > 0
          ? innerSamples.reduce((s, p) => s + p.lum, 0) / innerSamples.length : 0;
        const outerAvgLum = outerSamples.length > 0
          ? outerSamples.reduce((s, p) => s + p.lum, 0) / outerSamples.length : 0;
        const innerMaxLum = innerSamples.length > 0
          ? Math.max(...innerSamples.map(p => p.lum)) : 0;

        results.push({
          id: pos.id,
          type: pos.type,
          screenX: pos.screenX,
          screenY: pos.screenY,
          centerPixel: { r: centerR, g: centerG, b: centerB, lum: centerLum },
          samples: innerSamples,
          outerSamples,
          avgLum: innerAvgLum,
          outerAvgLum,
          maxLum: innerMaxLum,
          // Key metric: luminance contrast between enemy region and surrounding area
          lumContrast: innerMaxLum - outerAvgLum,
          brightSampleCount: innerSamples.reduce((c, p) => c + (p.lum > 8 ? 1 : 0), 0),
          totalSamples: innerSamples.length,
        });
      }

      // Global background samples: corners and edges
      const bgPositions = [
        [10, 10], [vw - 10, 10], [10, vh - 10], [vw - 10, vh - 10],
        [vw / 2, 10], [vw / 2, vh - 10], [10, vh / 2], [vw - 10, vh / 2],
      ];
      const bgSamples = [];
      for (const [bx, by] of bgPositions) {
        const px = Math.round(bx * scaleX);
        const py = Math.round(by * scaleY);
        if (px >= 0 && px < tmp.width && py >= 0 && py < tmp.height) {
          const d = ctx.getImageData(px, py, 1, 1).data;
          bgSamples.push({
            r: d[0], g: d[1], b: d[2],
            lum: 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2],
          });
        }
      }

      return { positions: results, bgSamples };
    } catch (err) {
      return { error: err.message };
    }
  }, positions, SAMPLE_RADIUS, VIEWPORT.width, VIEWPORT.height);
}

// ---------------------------------------------------------------------------
// Visibility analysis
// ---------------------------------------------------------------------------

function analyzeVisibility(pixelData, bgThreshold) {
  if (!pixelData || pixelData.error) {
    return { error: pixelData?.error || 'no pixel data', enemies: [] };
  }

  // Compute global background luminance from corner/edge samples
  const bgLums = pixelData.bgSamples.map(s => s.lum);
  const avgBgLum = bgLums.length > 0
    ? bgLums.reduce((a, b) => a + b, 0) / bgLums.length
    : 5;

  const enemies = pixelData.positions.map(ep => {
    // METHOD 1: Local contrast — is the enemy brighter than its surrounding area?
    // This is the primary detection method. It works even for dim far-side enemies
    // because the enemy will still be slightly brighter than the space around it.
    const lumContrast = ep.lumContrast || (ep.maxLum - ep.outerAvgLum);
    const visibleByContrast = lumContrast > 3; // 3+ lum units above local bg = visible

    // METHOD 2: Absolute brightness — any pixel significantly above global bg
    const brightSamples = ep.samples.filter(s => s.lum > Math.max(bgThreshold, avgBgLum + 3));
    const brightRatio = ep.totalSamples > 0 ? brightSamples.length / ep.totalSamples : 0;
    const visibleByBrightness = brightRatio >= VISIBILITY_RATIO_THRESHOLD;

    // METHOD 3: Color saturation — enemies have distinct hues (red, cyan, pink)
    // even when dim. Background is neutral dark blue/black.
    const colorfulSamples = ep.samples.filter(s => {
      const maxChannel = Math.max(s.r, s.g, s.b);
      const minChannel = Math.min(s.r, s.g, s.b);
      // Lower thresholds: even dim enemies have some color
      return maxChannel > 12 && (maxChannel - minChannel) > 5;
    });
    const colorRatio = ep.totalSamples > 0 ? colorfulSamples.length / ep.totalSamples : 0;
    const visibleByColor = colorRatio >= VISIBILITY_RATIO_THRESHOLD;

    // METHOD 4: Max luminance — if ANY pixel in the sample area is notably bright
    const visibleByMaxLum = ep.maxLum > avgBgLum + 8;

    // Enemy is visible if ANY method detects it
    const visible = visibleByContrast || visibleByBrightness || visibleByColor || visibleByMaxLum;

    return {
      id: ep.id,
      type: ep.type,
      screenX: ep.screenX,
      screenY: ep.screenY,
      centerPixel: ep.centerPixel,
      avgLum: ep.avgLum,
      maxLum: ep.maxLum,
      outerAvgLum: ep.outerAvgLum,
      lumContrast,
      brightRatio,
      colorRatio,
      visible,
      detectionMethod: visible
        ? (visibleByContrast ? 'contrast' : visibleByBrightness ? 'brightness'
          : visibleByColor ? 'color' : 'maxLum')
        : 'NONE',
      reason: visible
        ? `detected via ${visibleByContrast ? 'contrast' : visibleByBrightness ? 'brightness' : visibleByColor ? 'color' : 'maxLum'}`
        : `invisible: contrast=${lumContrast.toFixed(1)}, bright=${brightRatio.toFixed(2)}, color=${colorRatio.toFixed(2)}, maxLum=${ep.maxLum.toFixed(1)}`,
    };
  });

  return {
    avgBgLum,
    enemies,
    totalChecked: enemies.length,
    visibleCount: enemies.filter(e => e.visible).length,
    invisibleCount: enemies.filter(e => !e.visible).length,
  };
}

// ---------------------------------------------------------------------------
// Test a single surface
// ---------------------------------------------------------------------------

async function testSurface(surface, checkpoints, runLabel) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
    timeout: 30000,
  });

  const results = { surface, passed: true, checkpoints: [], error: null };

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    // Clear localStorage
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => {
      try {
        localStorage.removeItem('masteryOverlayShown');
        localStorage.removeItem('weaponMastery');
      } catch {}
    });

    // Load game
    const url = `${BASE_URL}?quickStart=true&surface=${surface}&debug=true&testMode=true`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('canvas', { timeout: 15000 });

    // Wait for game to start and TestHarnessAPI to be ready
    // Some surfaces (mobius-bevel) take longer to initialize
    let apiReady = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(attempt === 0 ? 4000 : 2000);
      apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
      if (apiReady) break;
    }
    if (!apiReady) {
      results.passed = false;
      results.error = 'TestHarnessAPI not available after 18s';
      return results;
    }

    // Check if THREE is accessible (needed for projection)
    const threeAvailable = await page.evaluate(() => typeof window.THREE !== 'undefined');
    if (!threeAvailable) {
      // Expose THREE globally for projection
      await page.evaluate(() => {
        // THREE might be in module scope — try to get it from the camera's constructor
        const api = window.__TEST_API;
        if (api?.ctx?.game?.camera?.constructor) {
          // The camera's Vector3 is from Three.js
          window.THREE = {
            Vector3: api.ctx.game.camera.position.constructor,
          };
        }
      });
    }

    let elapsed = 4000;

    for (const targetMs of checkpoints) {
      const waitMore = targetMs - elapsed;
      if (waitMore > 0) await sleep(waitMore);
      elapsed = targetMs;

      // Check for game over (player died) — skip remaining checkpoints
      const isGameOver = await page.evaluate(() => {
        // Game over screen has "GAME OVER" text or score display
        const gameOverEl = document.querySelector('.game-over, #game-over');
        if (gameOverEl) return true;
        // Also check via TestHarnessAPI
        const api = window.__TEST_API;
        if (api) {
          const state = api.getGameState();
          if (state && state.lives !== undefined && state.lives <= 0) return true;
        }
        // Check if canvas is gone or covered by UI
        const canvas = document.querySelector('canvas');
        if (!canvas) return true;
        return false;
      });

      if (isGameOver) {
        results.checkpoints.push({
          t: targetMs,
          passed: true, // Game over is not a test failure
          reason: 'game over — player died before this checkpoint',
          aliveCount: 0,
          onScreenCount: 0,
          visibleCount: 0,
          invisibleCount: 0,
          invisibleEnemies: [],
          gameOver: true,
        });
        continue;
      }

      // Get enemy screen positions
      const screenPos = await getEnemyScreenPositions(page);
      if (!screenPos || screenPos.length === 0) {
        const cp = {
          t: targetMs,
          passed: false,
          reason: screenPos === null ? 'projection failed' : 'no enemies alive',
          aliveCount: 0,
          visibleCount: 0,
          invisibleCount: 0,
          invisibleEnemies: [],
        };
        results.checkpoints.push(cp);
        if (screenPos === null) results.passed = false;
        continue;
      }

      // Filter to on-screen, in-front-of-camera enemies
      const onScreen = screenPos.filter(e => e.inBounds && !e.behindCamera);

      // Take screenshot
      const screenshotName = `visual-${surface}-t${Math.round(targetMs / 1000)}s-${runLabel}`;
      const screenshotPath = resolve(SCREENSHOT_DIR, `${screenshotName}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });

      if (onScreen.length === 0) {
        results.checkpoints.push({
          t: targetMs,
          passed: true,
          reason: `${screenPos.length} enemies alive but none on screen (behind camera or offscreen)`,
          aliveCount: screenPos.length,
          visibleCount: 0,
          invisibleCount: 0,
          invisibleEnemies: [],
          screenshotPath,
        });
        continue;
      }

      // Extract pixels at enemy positions
      const pixelData = await extractPixelsAtPositions(page, onScreen);
      const analysis = analyzeVisibility(pixelData, BG_LUMINANCE_THRESHOLD);

      if (analysis.error) {
        results.checkpoints.push({
          t: targetMs,
          passed: false,
          reason: `pixel analysis error: ${analysis.error}`,
          aliveCount: screenPos.length,
          visibleCount: 0,
          invisibleCount: 0,
          invisibleEnemies: [],
          screenshotPath,
        });
        results.passed = false;
        continue;
      }

      const invisibleEnemies = analysis.enemies.filter(e => !e.visible);
      const checkPassed = invisibleEnemies.length === 0;

      // Also get ICB data for comparison
      const icbData = await page.evaluate(() => {
        const api = window.__TEST_API;
        if (!api) return {};
        const enemies = api.getEnemies().filter(e => e.alive);
        const icbBelow010 = enemies.filter(e => e.instanceColorBrightness < 0.10);
        return {
          totalAlive: enemies.length,
          icbInvisible: icbBelow010.length,
          minIcb: enemies.length > 0 ? Math.min(...enemies.map(e => e.instanceColorBrightness)) : -1,
        };
      });

      results.checkpoints.push({
        t: targetMs,
        passed: checkPassed,
        aliveCount: screenPos.length,
        onScreenCount: onScreen.length,
        visibleCount: analysis.visibleCount,
        invisibleCount: analysis.invisibleCount,
        avgBgLum: analysis.avgBgLum,
        dynamicThreshold: analysis.dynamicThreshold,
        // ICB comparison — detect cases where ICB says visible but pixels say invisible
        icbInvisible: icbData.icbInvisible || 0,
        icbMinBrightness: icbData.minIcb,
        discrepancy: icbData.icbInvisible === 0 && analysis.invisibleCount > 0
          ? 'ICB_PASS_PIXEL_FAIL' // This is the critical case!
          : analysis.invisibleCount === 0 && icbData.icbInvisible > 0
            ? 'ICB_FAIL_PIXEL_PASS'
            : 'CONSISTENT',
        invisibleEnemies: invisibleEnemies.slice(0, 5).map(e => ({
          id: e.id,
          type: e.type,
          screenX: e.screenX,
          screenY: e.screenY,
          centerPixel: e.centerPixel,
          avgLum: e.avgLum?.toFixed(1),
          brightRatio: e.brightRatio?.toFixed(2),
          colorRatio: e.colorRatio?.toFixed(2),
        })),
        screenshotPath,
      });

      if (!checkPassed) results.passed = false;
    }

    return results;
  } catch (err) {
    results.passed = false;
    results.error = err.message;
    return results;
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------

function printResults(allResults) {
  console.log('\n=== VISUAL ENEMY VERIFICATION RESULTS ===\n');

  let totalPass = 0;
  let totalFail = 0;

  for (const r of allResults) {
    const icon = r.passed ? 'PASS' : 'FAIL';
    const color = r.passed ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';

    console.log(`${color}  ${icon}${reset}  ${r.surface}`);

    if (r.error) {
      console.log(`        ERROR: ${r.error}`);
    }

    for (const cp of r.checkpoints) {
      const cpIcon = cp.passed ? '.' : 'F';
      const t = `t=${Math.round(cp.t / 1000)}s`;
      if (cp.gameOver) {
        console.log(`        ${cpIcon} ${t}: GAME OVER (player died)`);
        continue;
      }
      console.log(`        ${cpIcon} ${t}: alive=${cp.aliveCount}, onScreen=${cp.onScreenCount ?? '?'}, visible=${cp.visibleCount}, invisible=${cp.invisibleCount}`);

      if (cp.discrepancy === 'ICB_PASS_PIXEL_FAIL') {
        console.log(`        \x1b[33m  !! ICB says visible but PIXELS show invisible — this is the bug the old test missed\x1b[0m`);
      }

      if (cp.invisibleEnemies?.length > 0) {
        for (const e of cp.invisibleEnemies) {
          console.log(`          invisible: ${e.type} at (${e.screenX},${e.screenY}) centerLum=${e.centerPixel?.lum?.toFixed(1)} brightRatio=${e.brightRatio} colorRatio=${e.colorRatio}`);
        }
      }
    }

    if (r.passed) totalPass++;
    else totalFail++;
  }

  console.log(`\n=== SUMMARY: ${totalPass} passed, ${totalFail} failed ===`);
  return totalFail === 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const allSurfaces = args.includes('--all');
  const deepMode = args.includes('--deep');
  const singleSurface = args.find(a => a.startsWith('--surface='))?.split('=')[1];

  const surfaces = allSurfaces ? ALL_SURFACES : (singleSurface ? [singleSurface] : ['sphere']);
  const checkpoints = deepMode ? DEEP_CHECKPOINTS : STANDARD_CHECKPOINTS;

  mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log('=== Visual Enemy Verification Suite ===');
  console.log(`Surfaces: ${surfaces.join(', ')}`);
  console.log(`Checkpoints: ${checkpoints.map(t => `${t / 1000}s`).join(', ')}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
  console.log(`Server: ${BASE_URL}`);
  console.log('');
  console.log('This test verifies PIXEL-LEVEL visibility, not just game state (ICB).');
  console.log('It catches bugs where ICB reports enemies as visible but they render invisible.\n');

  const allResults = [];

  for (const surface of surfaces) {
    process.stdout.write(`  Testing ${surface}...`);
    try {
      const result = await testSurface(surface, checkpoints, 'run1');
      allResults.push(result);
      console.log(result.passed ? ' PASS' : ' FAIL');
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
      allResults.push({ surface, passed: false, error: err.message, checkpoints: [] });
    }
  }

  const allPassed = printResults(allResults);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
