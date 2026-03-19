#!/usr/bin/env node
/**
 * prove-visibility-or-find-bug.mjs — Comprehensive enemy visibility test suite.
 *
 * Runs 8 scenarios against the REAL game (main.ts → GameLoop.ts path via quickStart),
 * combining ICB API checks with pixel-level screen projection to detect invisible enemies.
 * Takes screenshots every 3 seconds and produces an HTML report.
 *
 * Usage:
 *   node tests/visual/prove-visibility-or-find-bug.mjs
 *   node tests/visual/prove-visibility-or-find-bug.mjs --port=3032
 *   node tests/visual/prove-visibility-or-find-bug.mjs --scenario=1    # single scenario
 *   node tests/visual/prove-visibility-or-find-bug.mjs --quick          # reduced wave targets
 *
 * Requires: dev server already running at port 3032 (or --port=N)
 *
 * Exit codes:
 *   0 = PASS — no invisible enemies found across all scenarios
 *   1 = FAIL — invisible enemies detected (ICB < 0.10 or pixel check miss)
 */

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = process.argv.find(a => a.startsWith('--port='))?.split('=')[1] || '3032';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const QUICK_MODE = process.argv.includes('--quick');
const SINGLE_SCENARIO = parseInt(process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1] || '0');

const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/visibility-proof');
const REPORTS_DIR = resolve(PROJECT_ROOT, 'reports');

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';

const REAL_BROWSER = process.argv.includes('--real-browser');
const LAUNCH_ARGS = REAL_BROWSER
  ? ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900',
     '--enable-features=Vulkan,UseSkiaRenderer', '--enable-webgpu']
  : ['--enable-webgl', '--use-gl=swiftshader', '--use-angle=swiftshader',
     '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-setuid-sandbox',
     '--disable-dev-shm-usage', '--window-size=800,600'];

const VIEWPORT = REAL_BROWSER ? { width: 1280, height: 900 } : { width: 800, height: 600 };

// Thresholds
const ICB_THRESHOLD = 0.10;        // below this = invisible bug
const MATRIX_SCALE_MIN = 0.001;    // below this = zero-scale invisible
const SAMPLE_RADIUS = 14;          // pixel sampling radius around enemy
const BG_LUMINANCE_THRESHOLD = 8;  // pixels dimmer than this = background
const VISIBILITY_RATIO_THRESHOLD = 0.08; // min bright-pixel ratio to count as visible

// Timing
const SCREENSHOT_INTERVAL_MS = 3000;
const PIXEL_CHECK_EVERY_N_TICKS = 5; // check pixels every 15s (every 5 ticks)
const SPAWN_WARNING_BUFFER_MS = 2000; // wait after wave transition for warnings to clear

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Scenarios configuration
// ---------------------------------------------------------------------------

const SCENARIOS = [
  {
    id: 1,
    name: 'SP Torus KotH — Wave 5 Survival',
    surface: 'torus',
    gameMode: 'king',
    targetWave: QUICK_MODE ? 3 : 5,
    dodge: true,
    maxMs: QUICK_MODE ? 120000 : 180000,
    backSideCheck: true,
    desc: 'KotH on torus, dodge to wave 5, check front and back sides',
  },
  {
    id: 2,
    name: 'SP Sphere Waves — Wave 5 Survival',
    surface: 'sphere',
    gameMode: 'waves',
    targetWave: QUICK_MODE ? 3 : 5,
    dodge: true,
    maxMs: QUICK_MODE ? 120000 : 180000,
    backSideCheck: true,
    desc: 'Waves on sphere, dodge to wave 5',
  },
  {
    id: 3,
    name: 'SP Cube-Ring KotH — Wave 4 Survival',
    surface: 'cube-ring',
    gameMode: 'king',
    targetWave: QUICK_MODE ? 2 : 4,
    dodge: true,
    maxMs: QUICK_MODE ? 90000 : 150000,
    backSideCheck: false,
    desc: 'KotH on cube-ring, dodge to wave 4',
  },
  {
    id: 4,
    name: 'SP Sphere-Tunnel Waves — Wave 4 Survival',
    surface: 'sphere-tunnel',
    gameMode: 'waves',
    targetWave: QUICK_MODE ? 2 : 4,
    dodge: true,
    maxMs: QUICK_MODE ? 90000 : 150000,
    backSideCheck: false,
    desc: 'Waves on sphere-tunnel (historically worst for visibility), dodge to wave 4',
  },
  {
    id: 5,
    name: 'High Enemy Count Stress — Torus Wave 6',
    surface: 'torus',
    gameMode: 'waves',
    targetWave: QUICK_MODE ? 4 : 6,
    dodge: true,
    maxMs: QUICK_MODE ? 150000 : 200000,
    stressMode: true,
    backSideCheck: false,
    desc: 'Stress test: survive to wave 6, pause and count all enemies at peak',
  },
  {
    id: 6,
    name: 'WebGL2 Baseline Comparison — Torus Wave 3',
    surface: 'torus',
    gameMode: 'king',
    targetWave: 3,
    dodge: true,
    maxMs: 120000,
    rendererParam: 'webgl2',
    backSideCheck: false,
    desc: 'WebGL2 explicit baseline. Note: WebGPU cannot be tested in headless SwiftShader.',
  },
  {
    id: 7,
    name: 'Rapid Re-check After Death — No Dodge',
    surface: 'torus',
    gameMode: 'waves',
    targetWave: 0, // just let player die
    dodge: false,
    maxMs: 90000,
    deathCheck: true,
    backSideCheck: false,
    desc: 'No dodge — let player die, check all enemy visibility immediately after respawn',
  },
  {
    id: 8,
    name: 'Time-Lapse 3-Minute ICB Tracking',
    surface: 'torus',
    gameMode: 'king',
    targetWave: 0, // just time-based
    dodge: true,
    maxMs: 180000,
    timeLapseMode: true,
    backSideCheck: false,
    desc: 'Track every enemy ICB every 3s for 3 minutes. Detect enemies that go invisible mid-game.',
  },
];

// ---------------------------------------------------------------------------
// In-browser dodge logic (from verify-koth-deep-waves.mjs)
// ---------------------------------------------------------------------------

async function dodgeEnemies(page) {
  return page.evaluate(() => {
    if (!window.__TEST_API) return null;
    const api = window.__TEST_API;
    const playerPos = api.getPlayerPosition();
    if (!playerPos) return null;
    const enemies = api.getEnemies().filter(e => e.alive && !e.isMaterializing);
    if (enemies.length === 0) return { moved: false };

    let repelU = 0, repelV = 0;
    const DODGE_RADIUS = 0.15;
    let count = 0;

    for (const enemy of enemies) {
      const du = playerPos.u - enemy.u;
      const dv = playerPos.v - enemy.v;
      // Wrap UV distance
      const wdu = Math.abs(du) > 0.5 ? du - Math.sign(du) : du;
      const wdv = Math.abs(dv) > 0.5 ? dv - Math.sign(dv) : dv;
      const dist = Math.sqrt(wdu * wdu + wdv * wdv);
      if (dist < DODGE_RADIUS && dist > 0.001) {
        const w = (DODGE_RADIUS - dist) / DODGE_RADIUS;
        repelU += (wdu / dist) * w;
        repelV += (wdv / dist) * w;
        count++;
      }
    }

    if (count === 0) return { moved: false };

    const len = Math.sqrt(repelU * repelU + repelV * repelV);
    if (len > 0.001) {
      const MOVE_SPEED = 0.05;
      const newU = Math.max(0.02, Math.min(0.98, playerPos.u + (repelU / len) * MOVE_SPEED));
      const newV = Math.max(0.02, Math.min(0.98, playerPos.v + (repelV / len) * MOVE_SPEED));
      api.setPlayerPosition(newU, newV);
      return { moved: true, newU, newV };
    }
    return { moved: false };
  });
}

// ---------------------------------------------------------------------------
// ICB-based visibility check (API-level)
// ---------------------------------------------------------------------------

async function checkEnemyVisibility(page) {
  return page.evaluate((icbThreshold, matScaleMin) => {
    const api = window.__TEST_API;
    if (!api) return null;
    const enemies = api.getEnemies();
    const player = api.getPlayerPosition();
    const wave = typeof api.getWave === 'function' ? api.getWave() : -1;
    const gameState = api.getGameState();

    const alive = enemies.filter(e => e.alive);
    const notMat = alive.filter(e => !e.isMaterializing);
    const stuck = alive.filter(e => e.isMaterializing);
    const invisible = notMat.filter(e => e.instanceColorBrightness < icbThreshold);
    const zeroScale = notMat.filter(e => (e.instanceMatrixScale || 0) < matScaleMin);

    const icbValues = notMat.map(e => e.instanceColorBrightness);
    return {
      wave,
      gameTime: gameState?.gameTime ?? 0,
      isGameOver: gameState?.isGameOver ?? false,
      lives: gameState?.lives ?? 0,
      totalEnemies: enemies.length,
      aliveCount: alive.length,
      notMaterializingCount: notMat.length,
      stuckMaterializingCount: stuck.length,
      invisibleCount: invisible.length,
      zeroScaleCount: zeroScale.length,
      minICB: icbValues.length ? Math.min(...icbValues) : 1.0,
      avgICB: icbValues.length ? icbValues.reduce((s, v) => s + v, 0) / icbValues.length : 1.0,
      playerU: player?.u ?? 0.5,
      playerV: player?.v ?? 0.5,
      invisibleSample: invisible.slice(0, 5).map(e => ({
        type: e.type, u: +e.u.toFixed(3), v: +e.v.toFixed(3),
        icb: +e.instanceColorBrightness.toFixed(4), batch: e.renderBatch,
      })),
      stuckSample: stuck.slice(0, 5).map(e => ({
        type: e.type, u: +e.u.toFixed(3), v: +e.v.toFixed(3),
      })),
      allEnemies: alive.map(e => ({
        id: e.id, type: e.type, u: +e.u.toFixed(3), v: +e.v.toFixed(3),
        icb: +e.instanceColorBrightness.toFixed(4),
        isMat: e.isMaterializing,
        matScale: e.instanceMatrixScale ?? 1,
      })),
    };
  }, ICB_THRESHOLD, MATRIX_SCALE_MIN);
}

// ---------------------------------------------------------------------------
// World-to-screen projection (from verify-enemies-visual.mjs)
// ---------------------------------------------------------------------------

async function setupThreeJs(page) {
  const threeAvailable = await page.evaluate(() => typeof window.THREE !== 'undefined');
  if (!threeAvailable) {
    await page.evaluate(() => {
      const api = window.__TEST_API;
      if (api?.ctx?.game?.camera?.position?.constructor) {
        window.THREE = { Vector3: api.ctx.game.camera.position.constructor };
      }
    });
  }
  return page.evaluate(() => typeof window.THREE !== 'undefined');
}

async function getEnemyScreenPositions(page) {
  return page.evaluate((vw, vh) => {
    const api = window.__TEST_API;
    if (!api) return null;
    const enemies = api.getEnemies().filter(e => e.alive);
    if (enemies.length === 0) return [];
    const cam = api.ctx?.game?.camera;
    if (!cam) return null;
    cam.updateMatrixWorld(true);
    const THREE = window.THREE;
    if (!THREE) return null;
    const results = [];
    for (const e of enemies) {
      if (!e.worldPos) continue;
      const v = new THREE.Vector3(e.worldPos.x, e.worldPos.y, e.worldPos.z);
      v.project(cam);
      const screenX = Math.round((v.x * 0.5 + 0.5) * vw);
      const screenY = Math.round((-v.y * 0.5 + 0.5) * vh);
      results.push({
        id: e.id, type: e.type, screenX, screenY,
        behindCamera: v.z > 1,
        icb: e.instanceColorBrightness,
        u: e.u, v: e.v,
        inBounds: screenX >= 0 && screenX < vw && screenY >= 0 && screenY < vh,
      });
    }
    return results;
  }, VIEWPORT.width, VIEWPORT.height);
}

// ---------------------------------------------------------------------------
// Pixel extraction (from verify-enemies-visual.mjs)
// ---------------------------------------------------------------------------

async function extractPixelsAtPositions(page, positions) {
  return page.evaluate((posArr, sampleR, vw, vh) => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return null;
    try {
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx = tmp.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0);
      const scaleX = canvas.width / vw;
      const scaleY = canvas.height / vh;
      const results = [];
      for (const pos of posArr) {
        const cx = Math.round(pos.screenX * scaleX);
        const cy = Math.round(pos.screenY * scaleY);
        const innerSamples = [];
        for (let dx = -sampleR; dx <= sampleR; dx += 2) {
          for (let dy = -sampleR; dy <= sampleR; dy += 2) {
            const px = cx + dx, py = cy + dy;
            if (px < 0 || px >= tmp.width || py < 0 || py >= tmp.height) continue;
            const d = ctx.getImageData(px, py, 1, 1).data;
            const lum = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
            innerSamples.push({ r: d[0], g: d[1], b: d[2], lum });
          }
        }
        const outerR = sampleR * 3;
        const outerSamples = [];
        for (let dx = -outerR; dx <= outerR; dx += 6) {
          for (let dy = -outerR; dy <= outerR; dy += 6) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < sampleR * 2 || dist > outerR) continue;
            const px = cx + dx, py = cy + dy;
            if (px < 0 || px >= tmp.width || py < 0 || py >= tmp.height) continue;
            const d = ctx.getImageData(px, py, 1, 1).data;
            const lum = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
            outerSamples.push({ lum });
          }
        }
        const innerMaxLum = innerSamples.length ? Math.max(...innerSamples.map(p => p.lum)) : 0;
        const innerAvgLum = innerSamples.length ? innerSamples.reduce((s, p) => s + p.lum, 0) / innerSamples.length : 0;
        const outerAvgLum = outerSamples.length ? outerSamples.reduce((s, p) => s + p.lum, 0) / outerSamples.length : 0;
        results.push({
          id: pos.id, type: pos.type, screenX: pos.screenX, screenY: pos.screenY,
          samples: innerSamples, outerSamples,
          avgLum: innerAvgLum, outerAvgLum, maxLum: innerMaxLum,
          lumContrast: innerMaxLum - outerAvgLum,
          brightSampleCount: innerSamples.filter(p => p.lum > 8).length,
          totalSamples: innerSamples.length,
        });
      }
      const bgPositions = [[10,10],[vw-10,10],[10,vh-10],[vw-10,vh-10],[vw/2,10],[vw/2,vh-10],[10,vh/2],[vw-10,vh/2]];
      const bgSamples = bgPositions.map(([bx,by]) => {
        const px = Math.round(bx*scaleX), py = Math.round(by*scaleY);
        if (px<0||px>=tmp.width||py<0||py>=tmp.height) return {lum:0};
        const d = ctx.getImageData(px,py,1,1).data;
        return { lum: 0.299*d[0] + 0.587*d[1] + 0.114*d[2] };
      });
      return { positions: results, bgSamples };
    } catch (err) {
      return { error: err.message };
    }
  }, positions, SAMPLE_RADIUS, VIEWPORT.width, VIEWPORT.height);
}

// ---------------------------------------------------------------------------
// Visibility analysis (from verify-enemies-visual.mjs)
// ---------------------------------------------------------------------------

function analyzeVisibility(pixelData) {
  if (!pixelData || pixelData.error) {
    return { error: pixelData?.error || 'no pixel data', enemies: [] };
  }
  const bgLums = pixelData.bgSamples.map(s => s.lum);
  const avgBgLum = bgLums.length ? bgLums.reduce((a, b) => a + b, 0) / bgLums.length : 5;

  const enemies = pixelData.positions.map(ep => {
    const lumContrast = ep.lumContrast || (ep.maxLum - ep.outerAvgLum);
    const visibleByContrast = lumContrast > 3;
    const brightSamples = ep.samples.filter(s => s.lum > Math.max(BG_LUMINANCE_THRESHOLD, avgBgLum + 3));
    const brightRatio = ep.totalSamples > 0 ? brightSamples.length / ep.totalSamples : 0;
    const visibleByBrightness = brightRatio >= VISIBILITY_RATIO_THRESHOLD;
    const colorfulSamples = ep.samples.filter(s => {
      const max = Math.max(s.r, s.g, s.b), min = Math.min(s.r, s.g, s.b);
      return max > 12 && (max - min) > 5;
    });
    const colorRatio = ep.totalSamples > 0 ? colorfulSamples.length / ep.totalSamples : 0;
    const visibleByColor = colorRatio >= VISIBILITY_RATIO_THRESHOLD;
    const visibleByMaxLum = ep.maxLum > avgBgLum + 8;
    const visible = visibleByContrast || visibleByBrightness || visibleByColor || visibleByMaxLum;
    return {
      id: ep.id, type: ep.type, screenX: ep.screenX, screenY: ep.screenY,
      avgLum: ep.avgLum, maxLum: ep.maxLum, outerAvgLum: ep.outerAvgLum,
      lumContrast, brightRatio, colorRatio, visible,
      detectionMethod: visible
        ? (visibleByContrast ? 'contrast' : visibleByBrightness ? 'brightness'
          : visibleByColor ? 'color' : 'maxLum') : 'NONE',
    };
  });
  return {
    avgBgLum, enemies,
    totalChecked: enemies.length,
    visibleCount: enemies.filter(e => e.visible).length,
    invisibleCount: enemies.filter(e => !e.visible).length,
  };
}

// ---------------------------------------------------------------------------
// Wait for TestHarnessAPI
// ---------------------------------------------------------------------------

async function waitForTestApi(page) {
  const maxAttempts = REAL_BROWSER ? 30 : 8;
  const firstWait = REAL_BROWSER ? 8000 : 4000;
  const retryWait = REAL_BROWSER ? 3000 : 2000;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await sleep(attempt === 0 ? firstWait : retryWait);
    const ready = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
    if (ready) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Wait for wave with dodge
// ---------------------------------------------------------------------------

async function waitForWave(page, targetWave, maxMs, scenarioName, dodgeEnabled) {
  if (targetWave <= 0) return 0; // no-op for time-based scenarios

  const startTime = Date.now();
  let currentWave = 0;
  let dodgeTimer = null;
  let deaths = 0;

  if (dodgeEnabled) {
    dodgeTimer = setInterval(async () => {
      try { await dodgeEnemies(page); } catch {}
    }, 250);
  }

  try {
    while (Date.now() - startTime < maxMs) {
      await sleep(500);
      const info = await page.evaluate(() => {
        const api = window.__TEST_API;
        if (!api) return null;
        const wave = typeof api.getWave === 'function' ? api.getWave() : -1;
        const gs = api.getGameState();
        return { wave, isGameOver: gs?.isGameOver, lives: gs?.lives, gameTime: gs?.gameTime };
      });
      if (!info) break;

      currentWave = info.wave >= 0 ? info.wave : Math.floor((info.gameTime || 0) / 15) + 1;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      process.stdout.write(`\r  ${scenarioName}: wave=${currentWave}, t=${elapsed}s, lives=${info.lives ?? '?'}    `);

      if (info.isGameOver) {
        deaths++;
        process.stdout.write('\n  [GAME OVER — died]\n');
        break;
      }
      if (currentWave >= targetWave) break;
    }
  } finally {
    if (dodgeTimer) clearInterval(dodgeTimer);
  }
  process.stdout.write('\n');
  return currentWave;
}

// ---------------------------------------------------------------------------
// Capture a single 3s checkpoint (ICB + optional pixel)
// ---------------------------------------------------------------------------

async function captureCheckpoint(page, label, scenarioId, tickNum, pixelCheckEnabled) {
  let state = await checkEnemyVisibility(page);
  if (!state) return { error: 'No TEST_API', label, tickNum };

  // If stuck materializing enemies found, distinguish PERSISTENT bugs from TRANSIENT
  // spawn-window occupants using entity IDs.
  //
  // In high-spawn-rate modes (KotH), there are ALWAYS 10-20 enemies in their 0.8s
  // materialization window at any given time — "stuck" count never reaches 0 via polling.
  // The real bug (RC14-style) is enemies whose isMaterializing NEVER clears (same entity
  // ID still stuck after > SPAWN_WARNING_DURATION has passed).
  //
  // Algorithm:
  //   1. Record IDs of currently-stuck enemies
  //   2. Wait SPAWN_WARNING_BUFFER_MS (2s > 0.8s SPAWN_WARNING_DURATION)
  //   3. Recheck — any of the ORIGINAL enemy IDs still stuck? That's the real bug count.
  //   4. Newly-stuck IDs in the recheck are freshly-spawned transients → not bugs.
  if (state.stuckMaterializingCount > 0) {
    const firstStuckIds = new Set(
      (state.allEnemies || []).filter(e => e.isMat).map(e => e.id)
    );
    await sleep(SPAWN_WARNING_BUFFER_MS);
    const recheckState = await checkEnemyVisibility(page);
    if (recheckState) {
      // Count how many of the ORIGINAL stuck enemies are STILL stuck (persistent)
      const persistentStuck = (recheckState.allEnemies || []).filter(e => e.isMat && firstStuckIds.has(e.id));
      // Overwrite stuckMaterializingCount with only the persistent count
      state = { ...recheckState, stuckMaterializingCount: persistentStuck.length };
    }
  }

  const screenshotPath = resolve(SCREENSHOT_DIR, `s${scenarioId}-tick${tickNum}-${label}.png`);
  await page.screenshot({ path: screenshotPath });

  const checkpoint = {
    label, tickNum, screenshotPath,
    wave: state.wave, gameTime: state.gameTime,
    aliveCount: state.aliveCount, notMaterializingCount: state.notMaterializingCount,
    stuckMaterializingCount: state.stuckMaterializingCount,
    invisibleCount: state.invisibleCount, zeroScaleCount: state.zeroScaleCount,
    minICB: state.minICB, avgICB: state.avgICB,
    isGameOver: state.isGameOver, lives: state.lives,
    invisibleSample: state.invisibleSample,
    stuckSample: state.stuckSample,
    allEnemies: state.allEnemies, // for time-lapse tracking
    pixelCheck: null,
    discrepancy: 'NOT_CHECKED',
  };

  // ICB bug detection
  const icbBug = state.invisibleCount > 0 || state.stuckMaterializingCount > 0;

  // Pixel check (expensive — every N ticks only)
  if (pixelCheckEnabled && !icbBug) {
    try {
      const screenPos = await getEnemyScreenPositions(page);
      if (screenPos && screenPos.length > 0) {
        const onScreen = screenPos.filter(e => e.inBounds && !e.behindCamera);
        if (onScreen.length > 0) {
          const pixelData = await extractPixelsAtPositions(page, onScreen);
          const analysis = analyzeVisibility(pixelData);
          if (!analysis.error) {
            checkpoint.pixelCheck = {
              onScreenCount: onScreen.length,
              visibleCount: analysis.visibleCount,
              invisibleCount: analysis.invisibleCount,
              avgBgLum: analysis.avgBgLum,
              invisibleSample: analysis.enemies.filter(e => !e.visible).slice(0, 3).map(e => ({
                type: e.type, screenX: e.screenX, screenY: e.screenY,
                maxLum: e.maxLum?.toFixed(1), lumContrast: e.lumContrast?.toFixed(1),
              })),
            };
            // ICB_PASS_PIXEL_FAIL = most critical discrepancy
            if (state.invisibleCount === 0 && analysis.invisibleCount > 0) {
              checkpoint.discrepancy = 'ICB_PASS_PIXEL_FAIL';
            } else if (state.invisibleCount > 0 && analysis.invisibleCount === 0) {
              checkpoint.discrepancy = 'ICB_FAIL_PIXEL_PASS';
            } else {
              checkpoint.discrepancy = 'CONSISTENT';
            }
          }
        }
      }
    } catch {}
  } else if (!pixelCheckEnabled) {
    checkpoint.discrepancy = 'SKIPPED';
  }

  // Determine if this checkpoint is a bug
  checkpoint.isBug = icbBug ||
    (checkpoint.pixelCheck && checkpoint.pixelCheck.invisibleCount > 0);

  return checkpoint;
}

// ---------------------------------------------------------------------------
// Run a single scenario
// ---------------------------------------------------------------------------

async function runScenario(scenario) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scenario ${scenario.id}/8: ${scenario.name}`);
  console.log(`  Surface: ${scenario.surface}, Mode: ${scenario.gameMode || 'waves'}`);
  console.log(`  Target wave: ${scenario.targetWave}, Dodge: ${scenario.dodge}, MaxMs: ${scenario.maxMs}`);
  console.log(`  ${scenario.desc}`);

  const result = {
    id: scenario.id,
    name: scenario.name,
    surface: scenario.surface,
    gameMode: scenario.gameMode,
    passed: true,
    checkpoints: [],
    timeLapse: [],
    error: null,
    bugsFound: [],
    reachedWave: 0,
    notes: [],
  };

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: REAL_BROWSER ? false : 'new',
    args: LAUNCH_ARGS,
    timeout: REAL_BROWSER ? 60000 : 30000,
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);

    // Clear mastery overlay
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: REAL_BROWSER ? 60000 : 15000 });
    await page.evaluate(() => {
      try { localStorage.removeItem('masteryOverlayShown'); } catch {}
      try { localStorage.removeItem('weaponMastery'); } catch {}
    });

    // Build URL
    const params = new URLSearchParams({ quickStart: 'true', surface: scenario.surface, testMode: 'true', debug: 'true' });
    if (scenario.gameMode && scenario.gameMode !== 'waves') params.set('gameMode', scenario.gameMode);
    if (scenario.rendererParam) params.set('renderer', scenario.rendererParam);
    const url = `${BASE_URL}?${params.toString()}`;
    console.log(`  URL: ${url}`);

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: REAL_BROWSER ? 90000 : 30000 });
    await page.waitForSelector('canvas', { timeout: REAL_BROWSER ? 60000 : 15000 });

    // Wait for TestHarnessAPI
    const apiReady = await waitForTestApi(page);
    if (!apiReady) {
      result.passed = false;
      result.error = 'TestHarnessAPI not available after 18s';
      return result;
    }
    console.log(`  TestHarnessAPI ready.`);

    // Setup THREE.js for pixel projection
    const threeReady = await setupThreeJs(page);
    console.log(`  THREE.js projection: ${threeReady ? 'available' : 'unavailable (pixel checks skipped)'}`);
    if (!threeReady) result.notes.push('THREE.js not available — pixel checks disabled');

    // -----------------------------------------------------------------------
    // Scenario 7: Death/respawn check (no dodge, let player die)
    // -----------------------------------------------------------------------
    if (scenario.deathCheck) {
      console.log(`\n  Waiting for player death (no dodge)...`);
      const deathStart = Date.now();
      let died = false;
      // Initialize with actual current lives so we detect the first death correctly
      let livesBeforeDeath = (await page.evaluate(() => {
        return window.__TEST_API?.getGameState()?.lives ?? 3;
      })) ?? 3;

      while (Date.now() - deathStart < scenario.maxMs) {
        await sleep(1000);
        const info = await page.evaluate(() => {
          const api = window.__TEST_API;
          if (!api) return null;
          const gs = api.getGameState();
          return { isGameOver: gs?.isGameOver, lives: gs?.lives, gameTime: gs?.gameTime };
        });
        if (!info) break;
        process.stdout.write(`\r  t=${Math.round((Date.now()-deathStart)/1000)}s lives=${info.lives ?? '?'}    `);

        if (!died && info.lives !== undefined && info.lives < livesBeforeDeath) {
          died = true;
          process.stdout.write('\n  [Player died! Waiting 2s for respawn...]\n');
          livesBeforeDeath = info.lives;
          await sleep(SPAWN_WARNING_BUFFER_MS);

          // Check immediately after respawn
          const cp = await captureCheckpoint(page, 'post-respawn', scenario.id, 0, threeReady);
          result.checkpoints.push(cp);
          if (cp.isBug) {
            result.passed = false;
            result.bugsFound.push({ checkpoint: 'post-respawn', ...cp });
          }
          printCheckpoint(cp);
          break;
        } else if (info.isGameOver) {
          process.stdout.write('\n  [Game over — player out of lives]\n');
          break;
        }
        livesBeforeDeath = info.lives ?? livesBeforeDeath;
      }
      if (!died) result.notes.push('Player never died during the scenario — respawn check inconclusive');
      return result;
    }

    // -----------------------------------------------------------------------
    // Scenario 8: Time-lapse ICB tracking
    // -----------------------------------------------------------------------
    if (scenario.timeLapseMode) {
      console.log(`\n  Time-lapse mode: recording enemy ICB every 3s for 3 minutes...`);
      let dodgeTimer = null;
      if (scenario.dodge) {
        dodgeTimer = setInterval(async () => {
          try { await dodgeEnemies(page); } catch {}
        }, 250);
      }

      const startTime = Date.now();
      const enemyHistory = new Map(); // id -> [{tick, icb}]
      let tickNum = 0;

      while (Date.now() - startTime < scenario.maxMs) {
        await sleep(SCREENSHOT_INTERVAL_MS);
        tickNum++;
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        process.stdout.write(`\r  t=${elapsed}s tick=${tickNum}    `);

        const state = await checkEnemyVisibility(page);
        if (!state || state.isGameOver) break;

        // Track per-enemy ICB history
        for (const e of (state.allEnemies || [])) {
          if (!enemyHistory.has(e.id)) enemyHistory.set(e.id, []);
          enemyHistory.get(e.id).push({ tick: tickNum, t: elapsed, icb: e.icb, isMat: e.isMat });
        }

        result.timeLapse.push({
          tick: tickNum, t: elapsed, wave: state.wave,
          aliveCount: state.aliveCount, invisibleCount: state.invisibleCount, minICB: state.minICB,
        });

        if (state.invisibleCount > 0) {
          result.passed = false;
          result.bugsFound.push({ checkpoint: `tick${tickNum}-t${elapsed}s`, ...state });
          console.log(`\n  BUG at t=${elapsed}s: ${state.invisibleCount} invisible (minICB=${state.minICB.toFixed(3)})`);
        }
      }
      if (dodgeTimer) clearInterval(dodgeTimer);
      process.stdout.write('\n');

      // Analyze time-lapse: find enemies that went invisible after being visible
      let droppedToInvisible = 0;
      let neverVisible = 0;
      for (const [id, history] of enemyHistory) {
        const everVisible = history.some(h => !h.isMat && h.icb >= ICB_THRESHOLD);
        const everInvisible = history.some(h => !h.isMat && h.icb < ICB_THRESHOLD);
        if (everVisible && everInvisible) droppedToInvisible++;
        if (!everVisible && history.length > 3) neverVisible++; // spawned but never visible
      }
      result.notes.push(`Time-lapse: ${enemyHistory.size} unique enemies tracked over ${result.timeLapse.length} ticks`);
      result.notes.push(`  ${droppedToInvisible} enemies dropped from visible → invisible mid-game`);
      result.notes.push(`  ${neverVisible} enemies never became visible after spawning`);
      console.log(`  Time-lapse complete: ${enemyHistory.size} enemies, ${droppedToInvisible} dropped, ${neverVisible} neverVisible`);
      return result;
    }

    // -----------------------------------------------------------------------
    // Normal scenario: wave-based with periodic screenshots
    // -----------------------------------------------------------------------

    // Baseline check at wave 1
    console.log(`\n  Baseline check (waiting for wave 1)...`);
    await waitForWave(page, 1, 30000, 'baseline', scenario.dodge);
    await sleep(SPAWN_WARNING_BUFFER_MS);

    const baselineCp = await captureCheckpoint(page, 'baseline-wave1', scenario.id, 0, threeReady);
    result.checkpoints.push(baselineCp);
    if (baselineCp.isBug) { result.passed = false; result.bugsFound.push(baselineCp); }
    printCheckpoint(baselineCp);

    // Wait for target wave with periodic screenshots
    if (scenario.targetWave > 1) {
      console.log(`\n  Dodging to wave ${scenario.targetWave}...`);

      let dodgeTimer = null;
      if (scenario.dodge) {
        dodgeTimer = setInterval(async () => {
          try { await dodgeEnemies(page); } catch {}
        }, 250);
      }

      const waveStart = Date.now();
      let tickNum = 1;
      let reachedTarget = false;

      try {
        while (Date.now() - waveStart < scenario.maxMs) {
          await sleep(SCREENSHOT_INTERVAL_MS);
          tickNum++;

          const info = await page.evaluate(() => {
            const api = window.__TEST_API;
            if (!api) return null;
            const wave = typeof api.getWave === 'function' ? api.getWave() : -1;
            const gs = api.getGameState();
            return { wave, isGameOver: gs?.isGameOver, lives: gs?.lives, gameTime: gs?.gameTime };
          });
          if (!info) break;

          const currentWave = info.wave >= 0 ? info.wave : Math.floor((info.gameTime || 0) / 15) + 1;
          const elapsed = Math.round((Date.now() - waveStart) / 1000);
          process.stdout.write(`\r  wave=${currentWave}, t=${elapsed}s, lives=${info.lives ?? '?'}    `);

          // Periodic check at each 3s tick
          const doPixelCheck = threeReady && (tickNum % PIXEL_CHECK_EVERY_N_TICKS === 0);
          const cp = await captureCheckpoint(page, `wave${currentWave}-t${elapsed}`, scenario.id, tickNum, doPixelCheck);
          result.checkpoints.push(cp);
          if (cp.isBug) {
            result.passed = false;
            result.bugsFound.push(cp);
            process.stdout.write(`\n  BUG: wave=${currentWave} invisible=${cp.invisibleCount} stuck=${cp.stuckMaterializingCount}\n`);
          }
          result.reachedWave = Math.max(result.reachedWave, currentWave);

          if (info.isGameOver) {
            process.stdout.write('\n  [GAME OVER]\n');
            break;
          }
          if (currentWave >= scenario.targetWave && !reachedTarget) {
            reachedTarget = true;
            process.stdout.write(`\n  Reached wave ${currentWave}!\n`);
            // Extra 2 ticks at target wave
            await sleep(SCREENSHOT_INTERVAL_MS);
            tickNum++;
            const finalCp = await captureCheckpoint(page, `wave${currentWave}-final`, scenario.id, tickNum, threeReady);
            result.checkpoints.push(finalCp);
            if (finalCp.isBug) { result.passed = false; result.bugsFound.push(finalCp); }
            printCheckpoint(finalCp);
            break;
          }
        }
      } finally {
        if (dodgeTimer) clearInterval(dodgeTimer);
        process.stdout.write('\n');
      }

      // Stress mode: pause at peak for full audit
      if (scenario.stressMode && result.reachedWave >= scenario.targetWave) {
        console.log(`  Stress pause audit at wave ${result.reachedWave}...`);
        // Wait for all spawn warnings to expire BEFORE pausing — otherwise
        // paused enemies stay isMaterializing=true forever (no dt advances).
        await sleep(SPAWN_WARNING_BUFFER_MS);
        await page.evaluate(() => { try { window.__TEST_API.pauseGame(); } catch {} });
        await sleep(500);
        const stressCp = await captureCheckpoint(page, 'stress-pause', scenario.id, 99, threeReady);
        result.checkpoints.push(stressCp);
        if (stressCp.isBug) { result.passed = false; result.bugsFound.push(stressCp); }
        printCheckpoint(stressCp);
        await page.evaluate(() => { try { window.__TEST_API.resumeGame(); } catch {} });
      }
    }

    // Back-side check (teleport player to opposite UV)
    if (scenario.backSideCheck && result.reachedWave >= scenario.targetWave) {
      console.log(`  Back-side check (teleporting player to u+0.5)...`);
      await page.evaluate(() => {
        const api = window.__TEST_API;
        const pos = api.getPlayerPosition();
        api.setPlayerPosition(((pos?.u || 0.5) + 0.5) % 1.0, pos?.v || 0.5);
      });
      await sleep(SPAWN_WARNING_BUFFER_MS);
      const backCp = await captureCheckpoint(page, 'backside', scenario.id, 98, threeReady);
      result.checkpoints.push(backCp);
      if (backCp.isBug) { result.passed = false; result.bugsFound.push(backCp); }
      printCheckpoint(backCp);
    }

  } catch (err) {
    result.passed = false;
    result.error = err.message;
    console.error(`\n  ERROR in scenario ${scenario.id}: ${err.message}`);
  } finally {
    await browser.close();
  }

  const status = result.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`\nScenario ${scenario.id} result: ${status} (${result.checkpoints.length} checkpoints, ${result.bugsFound.length} bugs)`);
  return result;
}

// ---------------------------------------------------------------------------
// Print a checkpoint summary
// ---------------------------------------------------------------------------

function printCheckpoint(cp) {
  if (cp.error) {
    console.log(`  [ERROR] ${cp.label}: ${cp.error}`);
    return;
  }
  const status = cp.isBug ? '\x1b[31mFAIL\x1b[0m' : '\x1b[32mPASS\x1b[0m';
  const pixelStr = cp.pixelCheck
    ? ` | pixel: ${cp.pixelCheck.visibleCount}v/${cp.pixelCheck.invisibleCount}inv [${cp.discrepancy}]`
    : '';
  console.log(`  ${status} ${cp.label}: wave=${cp.wave} alive=${cp.aliveCount} invisible=${cp.invisibleCount} stuck=${cp.stuckMaterializingCount} minICB=${cp.minICB?.toFixed(3)}${pixelStr}`);
  if (cp.invisibleSample?.length > 0) {
    for (const e of cp.invisibleSample) {
      console.log(`         invisible: ${e.type} u=${e.u} v=${e.v} icb=${e.icb}`);
    }
  }
  if (cp.pixelCheck?.invisibleSample?.length > 0) {
    for (const e of cp.pixelCheck.invisibleSample) {
      console.log(`         pixel-miss: ${e.type} at (${e.screenX},${e.screenY}) maxLum=${e.maxLum}`);
    }
  }
}

// ---------------------------------------------------------------------------
// HTML report generation
// ---------------------------------------------------------------------------

function generateHtmlReport(results, runDate) {
  const allPassed = results.every(r => r.passed);
  const failedCount = results.filter(r => !r.passed).length;
  const totalBugs = results.reduce((s, r) => s + r.bugsFound.length, 0);

  const statusBadge = passed =>
    passed ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>';

  const discrepancyBadge = d => {
    if (d === 'ICB_PASS_PIXEL_FAIL') return '<span class="warn">ICB_PASS_PIXEL_FAIL ⚠</span>';
    if (d === 'ICB_FAIL_PIXEL_PASS') return '<span class="dim">ICB_FAIL_PIXEL_PASS</span>';
    if (d === 'CONSISTENT') return '<span class="ok">consistent</span>';
    return `<span class="dim">${d}</span>`;
  };

  const cpRows = (r) => r.checkpoints.map(cp => {
    const rowStyle = cp.isBug ? 'background:#3b1a1a' : '';
    const relPath = cp.screenshotPath ? cp.screenshotPath.replace(PROJECT_ROOT + '/', '') : '';
    const pixelCell = cp.pixelCheck
      ? `${cp.pixelCheck.visibleCount}v / ${cp.pixelCheck.invisibleCount}inv ${discrepancyBadge(cp.discrepancy)}`
      : `<span class="dim">${cp.discrepancy || 'n/a'}</span>`;
    return `<tr style="${rowStyle}">
      <td>${cp.label}</td>
      <td>${statusBadge(!cp.isBug)}</td>
      <td>${cp.wave ?? '?'}</td>
      <td>${cp.aliveCount ?? 0}</td>
      <td class="${cp.invisibleCount > 0 ? 'fail' : ''}">${cp.invisibleCount ?? 0}</td>
      <td class="${cp.stuckMaterializingCount > 0 ? 'warn' : ''}">${cp.stuckMaterializingCount ?? 0}</td>
      <td>${cp.minICB?.toFixed(3) ?? '?'}</td>
      <td>${pixelCell}</td>
      <td>${relPath ? `<a href="${relPath}" target="_blank">📷</a>` : '-'}</td>
    </tr>`;
  }).join('\n');

  const tlRows = (r) => {
    if (!r.timeLapse?.length) return '<tr><td colspan="5">No time-lapse data</td></tr>';
    return r.timeLapse.map(tl =>
      `<tr style="${tl.invisibleCount > 0 ? 'background:#3b1a1a' : ''}">
        <td>${tl.tick}</td><td>${tl.t}s</td><td>${tl.wave}</td>
        <td>${tl.aliveCount}</td>
        <td class="${tl.invisibleCount > 0 ? 'fail' : ''}">${tl.invisibleCount}</td>
      </tr>`
    ).join('\n');
  };

  const scenarioSections = results.map(r => `
    <div class="scenario-block" style="border-color:${r.passed ? '#22c55e' : '#ef4444'}">
      <h3>${statusBadge(r.passed)} Scenario ${r.id}: ${r.name}</h3>
      <p style="color:#94a3b8">${r.desc || ''}</p>
      ${r.error ? `<p class="fail">ERROR: ${r.error}</p>` : ''}
      ${r.notes.length ? `<ul>${r.notes.map(n => `<li style="color:#94a3b8;font-size:12px">${n}</li>`).join('')}</ul>` : ''}
      ${r.checkpoints.length > 0 ? `
        <table>
          <tr><th>Checkpoint</th><th>Status</th><th>Wave</th><th>Alive</th>
              <th>Invisible</th><th>Stuck-Mat</th><th>MinICB</th><th>Pixel Check</th><th>Shot</th></tr>
          ${cpRows(r)}
        </table>` : ''}
      ${r.timeLapse?.length > 0 ? `
        <h4>Time-Lapse ICB Tracking</h4>
        <table>
          <tr><th>Tick</th><th>Time</th><th>Wave</th><th>Alive</th><th>Invisible</th></tr>
          ${tlRows(r)}
        </table>` : ''}
      ${r.bugsFound.length > 0 ? `
        <div style="background:#2d0a0a;padding:12px;border-radius:6px;margin-top:8px">
          <b class="fail">Bugs found: ${r.bugsFound.length}</b>
          <pre style="font-size:11px;color:#fca5a5">${JSON.stringify(r.bugsFound.map(b => ({
            checkpoint: b.label || b.checkpoint,
            invisible: b.invisibleCount, stuck: b.stuckMaterializingCount,
            minICB: b.minICB?.toFixed(3), sample: b.invisibleSample?.slice(0,2),
          })), null, 2)}</pre>
        </div>` : ''}
    </div>`).join('\n');

  const summaryRows = results.map(r => `
    <tr style="${r.passed ? '' : 'background:#3b1a1a'}">
      <td>${r.id}</td>
      <td>${statusBadge(r.passed)}</td>
      <td>${r.name}</td>
      <td>${r.surface}</td>
      <td>${r.reachedWave || (r.timeLapse?.length ? 'timelapse' : '?')}</td>
      <td class="${r.bugsFound.length > 0 ? 'fail' : 'ok'}">${r.bugsFound.length}</td>
    </tr>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Visibility Proof — ${runDate}</title>
  <style>
    body { background:#0f172a; color:#e2e8f0; font-family:monospace; padding:24px; max-width:1400px; margin:0 auto; }
    h1 { color:#f8fafc; font-size:24px; }
    h2 { color:#94a3b8; border-bottom:1px solid #334155; padding-bottom:8px; margin-top:32px; }
    h3 { color:#cbd5e1; font-size:16px; margin-bottom:8px; }
    h4 { color:#94a3b8; font-size:13px; margin:12px 0 4px; }
    .verdict-box { border-radius:8px; padding:20px; margin:16px 0; font-size:18px; font-weight:bold;
                   border:3px solid ${allPassed ? '#22c55e' : '#ef4444'};
                   background:${allPassed ? '#052e16' : '#3b0a0a'}; }
    .scenario-block { background:#1e293b; border-radius:8px; padding:16px; margin:16px 0;
                      border:2px solid #334155; }
    table { border-collapse:collapse; width:100%; margin:8px 0; font-size:12px; }
    th { background:#1e293b; color:#94a3b8; padding:6px 10px; text-align:left; white-space:nowrap; }
    td { padding:4px 10px; border-bottom:1px solid #1e293b; vertical-align:top; }
    .pass { color:#22c55e; font-weight:bold; }
    .fail { color:#ef4444; font-weight:bold; }
    .warn { color:#f59e0b; font-weight:bold; }
    .ok   { color:#22c55e; }
    .dim  { color:#64748b; }
    a { color:#60a5fa; }
    pre { overflow:auto; max-height:200px; background:#0f172a; padding:8px; border-radius:4px; }
    .note-box { background:#1e293b; border-radius:6px; padding:12px; margin:8px 0; font-size:12px; color:#94a3b8; }
  </style>
</head>
<body>
  <h1>Enemy Visibility — Comprehensive Proof</h1>
  <p style="color:#64748b">Generated: ${new Date().toISOString()} | ${runDate}</p>

  <div class="verdict-box">
    ${allPassed
      ? '✓ NO VISIBILITY BUG FOUND — All scenarios passed'
      : `✗ VISIBILITY BUG EXISTS — ${failedCount} scenario(s) failed, ${totalBugs} bug instance(s)`}
  </div>

  <div class="note-box">
    <b>Notes:</b><br>
    • Tests run through real game path: main.ts → GameLoop.ts (not PlaygroundGame)<br>
    • ICB threshold: ${ICB_THRESHOLD} (below = invisible bug)<br>
    • Pixel check every ${PIXEL_CHECK_EVERY_N_TICKS * SCREENSHOT_INTERVAL_MS / 1000}s — detects ICB_PASS_PIXEL_FAIL discrepancies<br>
    • WebGPU unavailable in headless SwiftShader — Scenario 6 uses WebGL2 baseline comparison<br>
    • Renderer: SwiftShader (software OpenGL, not user's real GPU)
  </div>

  <h2>Scenario Summary</h2>
  <table>
    <tr><th>#</th><th>Result</th><th>Name</th><th>Surface</th><th>Max Wave</th><th>Bugs</th></tr>
    ${summaryRows}
  </table>

  <h2>Scenario Details</h2>
  ${scenarioSections}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const runDate = new Date().toISOString().split('T')[0];

  console.log(`\n${'='.repeat(60)}`);
  console.log(`PROVE-VISIBILITY-OR-FIND-BUG — Comprehensive Test Suite`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Server: ${BASE_URL}`);
  console.log(`Quick mode: ${QUICK_MODE}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);

  // Verify server is accessible
  try {
    const http = (await import('http'));
    await new Promise((resolve, reject) => {
      const req = http.default.get(BASE_URL, res => resolve(res)).on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    console.log(`Server at ${BASE_URL}: reachable`);
  } catch {
    console.error(`\nERROR: Dev server not running at ${BASE_URL}`);
    console.error(`Start it with: PATH=/home/antoine/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin npx vite --port ${PORT}`);
    process.exit(2);
  }

  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  mkdirSync(REPORTS_DIR, { recursive: true });

  // Select scenarios to run
  const scenariosToRun = SINGLE_SCENARIO > 0
    ? SCENARIOS.filter(s => s.id === SINGLE_SCENARIO)
    : SCENARIOS;

  if (scenariosToRun.length === 0) {
    console.error(`No scenario found with id=${SINGLE_SCENARIO}`);
    process.exit(1);
  }

  console.log(`Running ${scenariosToRun.length} scenario(s)...\n`);

  const results = [];
  for (const scenario of scenariosToRun) {
    const result = await runScenario(scenario);
    results.push(result);
  }

  // Final summary
  const allPassed = results.every(r => r.passed);
  const totalBugs = results.reduce((s, r) => s + r.bugsFound.length, 0);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`FINAL VERDICT: ${allPassed ? '\x1b[32mNO BUG FOUND\x1b[0m' : '\x1b[31mVISIBILITY BUG EXISTS\x1b[0m'}`);
  console.log(`  ${results.filter(r => r.passed).length}/${results.length} scenarios passed`);
  console.log(`  ${totalBugs} bug instances found`);

  for (const r of results) {
    const status = r.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    const bugs = r.bugsFound.length > 0 ? ` — ${r.bugsFound.length} bugs` : '';
    console.log(`  ${status} [${r.id}] ${r.name}${bugs}`);
    if (!r.passed && r.bugsFound.length > 0) {
      for (const b of r.bugsFound.slice(0, 2)) {
        const inv = b.invisibleCount || 0;
        const stuck = b.stuckMaterializingCount || 0;
        console.log(`       @ ${b.label || b.checkpoint}: invisible=${inv} stuck=${stuck} minICB=${b.minICB?.toFixed(3) ?? '?'}`);
        if (b.invisibleSample) {
          for (const e of b.invisibleSample.slice(0, 2)) {
            console.log(`         Enemy: ${e.type} u=${e.u} v=${e.v} icb=${e.icb}`);
          }
        }
      }
    }
  }

  // Write HTML report
  const reportPath = resolve(REPORTS_DIR, `visibility-proof-${runDate}.html`);
  const html = generateHtmlReport(results, runDate);
  writeFileSync(reportPath, html);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Screenshots: ${SCREENSHOT_DIR}/`);

  // Write JSON summary
  const jsonPath = resolve(REPORTS_DIR, `visibility-proof-${runDate}.json`);
  writeFileSync(jsonPath, JSON.stringify({
    runDate, passed: allPassed, totalBugs, results: results.map(r => ({
      id: r.id, name: r.name, surface: r.surface, passed: r.passed,
      bugsFound: r.bugsFound.length, reachedWave: r.reachedWave,
      checkpointCount: r.checkpoints.length, error: r.error,
    })),
  }, null, 2));
  console.log(`JSON: ${jsonPath}`);

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('\nFatal error:', err.message || err);
  process.exit(1);
});
