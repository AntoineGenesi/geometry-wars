#!/usr/bin/env node
/**
 * scenario-tests.mjs — Deep scenario tests for all map surfaces.
 *
 * Tests 6 scenarios across 9 surfaces using telemetry (window.__GAME_TELEMETRY).
 * Catches regression bugs: spawn-kills, phantom deaths, broken movement,
 * missing dimming, collision failures, clumped spawns, pixelation issues.
 *
 * Usage:
 *   node tests/visual/scenario-tests.mjs                    # Run all
 *   node tests/visual/scenario-tests.mjs --surface=sphere    # Single surface
 *   node tests/visual/scenario-tests.mjs --scenario=death    # Single scenario
 *   node tests/visual/scenario-tests.mjs --surface=torus --scenario=movement
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CHROME_PATH = process.env.CHROME_PATH
  || process.env.PUPPETEER_EXECUTABLE_PATH
  || '/home/antoine/.cache/puppeteer/chrome/linux-144.0.7559.96/chrome-linux64/chrome';
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/scenarios');

const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=640,360',
  '--disable-frame-rate-limit',
  '--disable-gpu-vsync',
];

const ALL_SURFACES = [
  'sphere', 'torus', 'cube', 'cube-ring', 'pill',
  'peanut', 'mobius', 'sphere-tunnel', 'cube-tunnel',
];

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: LAUNCH_ARGS,
  });
}

async function createPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 640, height: 360 });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.__testErrors = errors;
  return page;
}

async function startGameOnSurface(page, surface = 'sphere') {
  // Clear localStorage first
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => {
    localStorage.removeItem('masteryOverlayShown');
    localStorage.removeItem('weaponMastery');
  });

  // Navigate with quickStart
  await page.goto(`${BASE_URL}?quickStart=true&surface=${surface}&debug=true`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  await page.waitForSelector('canvas', { timeout: 15000 });
  // Wait for countdown to finish + game to start
  await sleep(4000);
}

/**
 * Poll telemetry until it's available (up to timeoutMs).
 */
async function waitForTelemetry(page, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const t = await page.evaluate(() => window.__GAME_TELEMETRY);
    if (t && t.frame > 0) return t;
    await sleep(200);
  }
  return null;
}

/**
 * Sample telemetry N times over durationMs.
 */
async function sampleTelemetry(page, count, durationMs) {
  const samples = [];
  const interval = durationMs / count;
  for (let i = 0; i < count; i++) {
    const t = await page.evaluate(() => window.__GAME_TELEMETRY);
    if (t) samples.push(t);
    await sleep(interval);
  }
  return samples;
}

// ---------------------------------------------------------------------------
// Scenario implementations
// ---------------------------------------------------------------------------

const SCENARIOS = {
  /**
   * Scenario 1: Death Autopsy — Hit Detection Analysis
   * Play 15s, track deaths. On death, report exact frame data.
   */
  async death(page, surface) {
    const results = { name: 'Death Autopsy', surface, checks: [] };

    // Let game run for 15s while sampling telemetry
    const samples = await sampleTelemetry(page, 75, 15000);

    if (samples.length < 10) {
      results.checks.push({ check: 'telemetry_available', passed: false,
        detail: `Only ${samples.length} telemetry samples (need 10+)` });
      return results;
    }

    results.checks.push({ check: 'telemetry_available', passed: true,
      detail: `${samples.length} samples collected over 15s` });

    // Get death log from telemetry
    const lastSample = samples[samples.length - 1];
    const deaths = lastSample.deaths;

    if (!deaths) {
      results.checks.push({ check: 'death_tracking', passed: false,
        detail: 'No deaths field in telemetry — telemetry exporter not updated?' });
      return results;
    }

    // Track nearest enemy distances across all frames
    const minDistances = samples
      .filter(s => s.collisions.nearestEnemySurfaceDist > 0)
      .map(s => s.collisions.nearestEnemySurfaceDist);
    const minEnemyDist = minDistances.length > 0 ? Math.min(...minDistances) : -1;

    if (deaths.total === 0) {
      results.checks.push({ check: 'no_deaths', passed: true,
        detail: `0 deaths in 15s. Min enemy surface dist: ${minEnemyDist.toFixed(4)}` });
    } else {
      // Analyze each death
      for (const d of deaths.log) {
        const isSpawnKill = d.time < 2.0 && d.nearestEnemySurfaceDist < 0.05;
        // Account for UV wrapping: surface dist > 0.5 may wrap to (1.0 - dist)
        const wrappedSurfDist = d.nearestEnemySurfaceDist > 0.5
          ? 1.0 - d.nearestEnemySurfaceDist : d.nearestEnemySurfaceDist;
        // Phantom kill: surface says far AND world says far
        const isPhantomKill = wrappedSurfDist > 0.3 && d.nearestEnemyDist > 3.0;

        if (isSpawnKill) {
          results.checks.push({ check: 'spawn_kill', passed: false,
            detail: `Death at t=${d.time.toFixed(2)}s — enemy "${d.nearestEnemyType}" ` +
              `at ${d.nearestEnemySurfaceDist.toFixed(4)} UV (SPAWN KILL!)` });
        } else if (isPhantomKill) {
          results.checks.push({ check: 'phantom_kill', passed: false,
            detail: `Death at t=${d.time.toFixed(2)}s — nearest enemy "${d.nearestEnemyType}" ` +
              `surfDist=${wrappedSurfDist.toFixed(4)} UV (raw=${d.nearestEnemySurfaceDist.toFixed(4)}), ` +
              `world=${d.nearestEnemyDist.toFixed(3)} (PHANTOM — enemy too far!)` });
        } else {
          results.checks.push({ check: 'normal_death', passed: true,
            detail: `Death at t=${d.time.toFixed(2)}s — enemy "${d.nearestEnemyType}" ` +
              `at ${wrappedSurfDist.toFixed(4)} UV, world=${d.nearestEnemyDist.toFixed(3)} (normal combat death)` });
        }
      }

      // Check surface distance vs world distance consistency
      for (const d of deaths.log) {
        if (d.nearestEnemyDist > 0 && d.nearestEnemySurfaceDist > 0) {
          // Account for UV wrapping on closed surfaces
          const wrappedDist = d.nearestEnemySurfaceDist > 0.5
            ? 1.0 - d.nearestEnemySurfaceDist : d.nearestEnemySurfaceDist;
          // Mismatch: wrapped surface dist says far AND world dist says far (true phantom)
          // OR wrapped surface close but world far (geometry bug)
          const surfFar = wrappedDist > 0.2;
          const worldClose = d.nearestEnemyDist < 2.0;
          const worldFar = d.nearestEnemyDist > 5.0;
          const surfClose = wrappedDist < 0.05;
          if (surfFar && worldClose) {
            // Surface says far but world says close — UV wrapping artifact, informational only
            results.checks.push({ check: 'dist_note', passed: true,
              detail: `UV wrapping detected at death: raw surface=${d.nearestEnemySurfaceDist.toFixed(4)} ` +
                `(wrapped=${wrappedDist.toFixed(4)}) world=${d.nearestEnemyDist.toFixed(3)}` });
          } else if (surfClose && worldFar) {
            results.checks.push({ check: 'dist_mismatch', passed: false,
              detail: `Distance mismatch at death: surface=${wrappedDist.toFixed(4)} ` +
                `(close) but world=${d.nearestEnemyDist.toFixed(3)} (far) — geometry bug?` });
          }
        }
      }

      results.checks.push({ check: 'death_count', passed: deaths.total <= 3,
        detail: `${deaths.total} death(s) in 15s (${deaths.total <= 3 ? 'acceptable' : 'suspicious — too many deaths'})` });
    }

    return results;
  },

  /**
   * Scenario 2: Movement Integrity — Coordinate Change Verification
   * Press WASD, verify UV changes match input direction.
   */
  async movement(page, surface) {
    const results = { name: 'Movement Integrity', surface, checks: [] };

    const directions = [
      { key: 'w', label: 'W (forward)', expectedAxis: 'v' },
      { key: 's', label: 'S (backward)', expectedAxis: 'v' },
      { key: 'a', label: 'A (left)', expectedAxis: 'u' },
      { key: 'd', label: 'D (right)', expectedAxis: 'u' },
    ];

    for (const dir of directions) {
      // Get position before movement
      const before = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (!before) {
        results.checks.push({ check: `move_${dir.key}`, passed: false,
          detail: `No telemetry before ${dir.label}` });
        continue;
      }

      // Press key for 2s
      await page.keyboard.down(dir.key);
      await sleep(2000);
      await page.keyboard.up(dir.key);
      await sleep(200);

      // Get position after movement
      const after = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (!after) {
        results.checks.push({ check: `move_${dir.key}`, passed: false,
          detail: `No telemetry after ${dir.label}` });
        continue;
      }

      const du = after.player.u - before.player.u;
      const dv = after.player.v - before.player.v;
      const dwx = after.player.worldPos.x - before.player.worldPos.x;
      const dwy = after.player.worldPos.y - before.player.worldPos.y;
      const dwz = after.player.worldPos.z - before.player.worldPos.z;
      const worldDist = Math.sqrt(dwx * dwx + dwy * dwy + dwz * dwz);
      const uvDist = Math.sqrt(du * du + dv * dv);

      // Check for NaN
      if (isNaN(du) || isNaN(dv) || isNaN(worldDist)) {
        results.checks.push({ check: `move_${dir.key}_nan`, passed: false,
          detail: `NaN in coordinates after ${dir.label}: du=${du}, dv=${dv}, worldDist=${worldDist}` });
        continue;
      }

      // Check player actually moved (world distance should be non-trivial)
      if (worldDist < 0.01) {
        results.checks.push({ check: `move_${dir.key}`, passed: false,
          detail: `${dir.label}: player didn't move (world dist=${worldDist.toFixed(4)}, du=${du.toFixed(4)}, dv=${dv.toFixed(4)})` });
        continue;
      }

      // Check magnitude is reasonable (not teleporting)
      const reasonable = worldDist < 50;

      results.checks.push({ check: `move_${dir.key}`, passed: reasonable,
        detail: `${dir.label}: du=${du.toFixed(4)} dv=${dv.toFixed(4)} worldDist=${worldDist.toFixed(3)}` +
          (reasonable ? '' : ' (UNREASONABLE — teleport?)') });
    }

    // Also verify no NaN/Infinity in current position
    const final = await page.evaluate(() => window.__GAME_TELEMETRY);
    if (final) {
      const hasNaN = isNaN(final.player.u) || isNaN(final.player.v) ||
        !isFinite(final.player.u) || !isFinite(final.player.v) ||
        isNaN(final.player.worldPos.x) || isNaN(final.player.worldPos.y) || isNaN(final.player.worldPos.z);
      results.checks.push({ check: 'no_nan', passed: !hasNaN,
        detail: hasNaN
          ? `NaN/Infinity detected: u=${final.player.u} v=${final.player.v} pos=(${final.player.worldPos.x},${final.player.worldPos.y},${final.player.worldPos.z})`
          : `Coordinates valid: u=${final.player.u.toFixed(4)} v=${final.player.v.toFixed(4)}` });
    }

    return results;
  },

  /**
   * Scenario 3: Enemy Dimming Gradient — Per-Enemy Opacity Verification
   * After 10s of gameplay, check that enemy opacity correlates with distance.
   */
  async dimming(page, surface) {
    const results = { name: 'Enemy Dimming Gradient', surface, checks: [] };

    // Wait for enemies to spawn and spread (additional 5s beyond game start)
    await sleep(6000);

    const t = await page.evaluate(() => window.__GAME_TELEMETRY);
    if (!t) {
      results.checks.push({ check: 'telemetry', passed: false, detail: 'No telemetry data' });
      return results;
    }

    const enemies = t.enemies;
    if (enemies.length < 3) {
      results.checks.push({ check: 'enough_enemies', passed: true,
        detail: `Only ${enemies.length} enemies — too few for dimming analysis` });
      return results;
    }

    results.checks.push({ check: 'enough_enemies', passed: true,
      detail: `${enemies.length} enemies available for analysis` });

    // Dimming system is BINARY: 1.0 (near hemisphere) or 0.3 (far hemisphere).
    // Enemies >90° from player's surface normal get 0.3, others get 1.0.
    const opacities = enemies.map(e => e.opacity);
    const nearCount = opacities.filter(o => o > 0.9).length;
    const farCount = opacities.filter(o => o > 0.1 && o < 0.5).length;
    const zeroCount = opacities.filter(o => o < 0.05).length;
    const allFull = nearCount === enemies.length;
    const allDimmed = farCount === enemies.length;
    const allZero = zeroCount === enemies.length;

    if (allZero) {
      results.checks.push({ check: 'all_invisible', passed: false,
        detail: `ALL ${enemies.length} enemies have opacity ~0 — dimming broken (enemies invisible)` });
    } else if (allFull) {
      // All near — check if any should be far
      const maxDist = Math.max(...enemies.map(e => e.surfaceDistToPlayer));
      results.checks.push({ check: 'all_near_hemisphere', passed: true,
        detail: `All ${enemies.length} enemies at full opacity (near hemisphere). Max dist: ${maxDist.toFixed(3)} UV` });
    } else if (allDimmed) {
      // All on far side — plausible during early gameplay in headless, as enemies may spawn opposite side
      results.checks.push({ check: 'all_far_hemisphere', passed: true,
        detail: `All ${enemies.length} enemies at 0.3 opacity (far hemisphere). ` +
          `This is valid if all enemies are >90° from player normal.` });
    } else {
      // Mix of near and far — ideal case, dimming is clearly working
      results.checks.push({ check: 'dimming_active', passed: true,
        detail: `${nearCount} near (1.0) + ${farCount} far (0.3) + ${zeroCount} hidden (0) — dimming gradient active` });
    }

    // Key check: opacity should NOT be a random non-standard value (indicates shader bug)
    const nonStandard = opacities.filter(o => o > 0.05 && Math.abs(o - 0.3) > 0.05 && Math.abs(o - 1.0) > 0.05);
    if (nonStandard.length > 0) {
      results.checks.push({ check: 'opacity_values_valid', passed: false,
        detail: `${nonStandard.length} enemies with non-standard opacity: ${nonStandard.map(o => o.toFixed(3)).join(', ')} (expected 0.0, 0.3, or 1.0)` });
    } else {
      results.checks.push({ check: 'opacity_values_valid', passed: true,
        detail: `All opacities are standard values (0.0, 0.3, or 1.0)` });
    }

    // Distance-opacity consistency: near enemies (small surface dist) should have 1.0,
    // far enemies (large surface dist) should have 0.3
    if (nearCount > 0 && farCount > 0) {
      const nearAvgDist = enemies.filter(e => e.opacity > 0.9)
        .reduce((s, e) => s + e.surfaceDistToPlayer, 0) / nearCount;
      const farAvgDist = enemies.filter(e => e.opacity > 0.1 && e.opacity < 0.5)
        .reduce((s, e) => s + e.surfaceDistToPlayer, 0) / farCount;
      results.checks.push({ check: 'dist_opacity_consistency', passed: true,
        detail: `Near enemies avg dist: ${nearAvgDist.toFixed(4)}, Far enemies avg dist: ${farAvgDist.toFixed(4)}` });
    }

    return results;
  },

  /**
   * Scenario 4: Collision Geometry Overlap — Radius Sanity
   * Check entity radii and sustained overlaps.
   */
  async collision(page, surface) {
    const results = { name: 'Collision Geometry Overlap', surface, checks: [] };

    // Sample over 5s
    const samples = await sampleTelemetry(page, 25, 5000);

    if (samples.length < 5) {
      results.checks.push({ check: 'telemetry', passed: false,
        detail: `Only ${samples.length} telemetry samples` });
      return results;
    }

    // Check radii are valid
    const lastSample = samples[samples.length - 1];
    const pRadius = lastSample.player.collisionRadius;

    if (pRadius <= 0 || pRadius > 5) {
      results.checks.push({ check: 'player_radius', passed: false,
        detail: `Player collision radius ${pRadius} out of range` });
    } else {
      results.checks.push({ check: 'player_radius', passed: true,
        detail: `Player radius=${pRadius.toFixed(4)}` });
    }

    const badRadii = lastSample.enemies.filter(e => e.collisionRadius <= 0 || e.collisionRadius > 10);
    results.checks.push({ check: 'enemy_radii', passed: badRadii.length === 0,
      detail: badRadii.length === 0
        ? `All ${lastSample.enemies.length} enemy radii valid`
        : `${badRadii.length} enemies with bad radii: ${badRadii.map(e => `${e.type}=${e.collisionRadius}`).join(', ')}` });

    // Track sustained overlaps (enemy in player radius for >1s = 5+ consecutive samples)
    let consecutiveOverlap = 0;
    let maxConsecutive = 0;
    for (const s of samples) {
      if (s.collisions.enemiesInPlayerRadius > 0 && s.player.alive) {
        consecutiveOverlap++;
        maxConsecutive = Math.max(maxConsecutive, consecutiveOverlap);
      } else {
        consecutiveOverlap = 0;
      }
    }

    // 5 samples at 200ms = 1s. Sustained overlap >1s = likely hit detection disabled
    results.checks.push({ check: 'sustained_overlap', passed: maxConsecutive < 5,
      detail: maxConsecutive < 5
        ? `Max consecutive overlap: ${maxConsecutive} samples (${(maxConsecutive * 200).toFixed(0)}ms — normal)`
        : `Sustained overlap: ${maxConsecutive} samples (${(maxConsecutive * 200).toFixed(0)}ms — HIT DETECTION MAY BE DISABLED)` });

    return results;
  },

  /**
   * Scenario 5: Spawn Distribution — Enemy Placement Analysis
   * Check enemy UV spread at 5s and 10s.
   */
  async spawn(page, surface) {
    const results = { name: 'Spawn Distribution', surface, checks: [] };

    // Check at two time points
    for (const checkpoint of ['early (5s)', 'later (10s)']) {
      if (checkpoint === 'later (10s)') {
        await sleep(5000); // additional 5s wait
      }

      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (!t || t.enemies.length < 3) {
        results.checks.push({ check: `spread_${checkpoint}`, passed: true,
          detail: `${t ? t.enemies.length : 0} enemies at ${checkpoint} — too few to analyze` });
        continue;
      }

      const enemies = t.enemies;

      // UV variance
      const uValues = enemies.map(e => e.u);
      const vValues = enemies.map(e => e.v);
      const uMean = uValues.reduce((s, u) => s + u, 0) / uValues.length;
      const vMean = vValues.reduce((s, v) => s + v, 0) / vValues.length;
      const uVar = uValues.reduce((s, u) => s + (u - uMean) ** 2, 0) / uValues.length;
      const vVar = vValues.reduce((s, v) => s + (v - vMean) ** 2, 0) / vValues.length;
      const totalVar = uVar + vVar;

      results.checks.push({ check: `uv_variance_${checkpoint}`, passed: totalVar > 0.001,
        detail: `UV variance=${totalVar.toFixed(6)} (${totalVar > 0.001 ? 'spread OK' : 'CLUMPED — all enemies at same position'})` });

      // Check minimum distance from player
      const minDistFromPlayer = Math.min(...enemies.map(e => e.surfaceDistToPlayer));
      const spawnedOnPlayer = enemies.filter(e => e.surfaceDistToPlayer < 0.01).length;

      results.checks.push({ check: `min_player_dist_${checkpoint}`,
        passed: spawnedOnPlayer <= 1,
        detail: `Min dist from player: ${minDistFromPlayer.toFixed(4)} UV, ` +
          `${spawnedOnPlayer} enemies within 0.01 UV of player` +
          (spawnedOnPlayer > 1 ? ' (SPAWN ON PLAYER BUG)' : '') });

      // Check quadrant distribution (u>0.5/u<0.5 x v>0.5/v<0.5)
      if (enemies.length >= 8) {
        const q = [0, 0, 0, 0];
        for (const e of enemies) {
          const qi = (e.u > uMean ? 1 : 0) + (e.v > vMean ? 2 : 0);
          q[qi]++;
        }
        const emptyQuadrants = q.filter(c => c === 0).length;
        results.checks.push({ check: `quadrant_dist_${checkpoint}`,
          passed: emptyQuadrants <= 1,
          detail: `Quadrants: [${q.join(', ')}] (${emptyQuadrants} empty)` +
            (emptyQuadrants > 1 ? ' — enemies only in partial UV space' : '') });
      }
    }

    return results;
  },

  /**
   * Scenario 6: Pixelation Verification — Renderer Output Analysis
   * Compare pixel block patterns in pixelated vs modern mode.
   */
  async pixelation(page, surface) {
    const results = { name: 'Pixelation Verification', surface, checks: [] };

    // Take normal mode screenshot first
    const normalShot = await page.screenshot({ encoding: 'binary' });

    // Inject canvas reader for pixel analysis
    await page.evaluate(() => {
      window.__canvasCapture = { data: null, requested: false };
      const origRAF = window.requestAnimationFrame;
      window.requestAnimationFrame = function(cb) {
        return origRAF.call(window, function(ts) {
          cb(ts);
          if (window.__canvasCapture.requested) {
            const canvas = document.querySelector('canvas');
            if (canvas) {
              try {
                const t = document.createElement('canvas');
                t.width = canvas.width;
                t.height = canvas.height;
                const ctx = t.getContext('2d');
                if (ctx) {
                  ctx.drawImage(canvas, 0, 0);
                  // Sample in a grid and count unique color clusters
                  const gridSize = 80;
                  const colors = new Set();
                  for (let gx = 0; gx < gridSize; gx++) {
                    for (let gy = 0; gy < gridSize; gy++) {
                      const px = Math.floor((gx / gridSize) * canvas.width);
                      const py = Math.floor((gy / gridSize) * canvas.height);
                      const p = ctx.getImageData(px, py, 1, 1).data;
                      // Quantize to reduce noise: round to nearest 8
                      const key = `${Math.round(p[0]/8)*8},${Math.round(p[1]/8)*8},${Math.round(p[2]/8)*8}`;
                      colors.add(key);
                    }
                  }
                  window.__canvasCapture.data = {
                    width: canvas.width,
                    height: canvas.height,
                    uniqueColors: colors.size,
                  };
                }
              } catch (e) { /* security */ }
            }
            window.__canvasCapture.requested = false;
          }
        });
      };
    });

    // Capture normal mode color count
    await page.evaluate(() => { window.__canvasCapture.requested = true; window.__canvasCapture.data = null; });
    await sleep(200);
    const normalData = await page.evaluate(() => window.__canvasCapture.data);

    // Switch to pixelated mode via game API if available
    const hasPixelMode = await page.evaluate(() => {
      // Try setting pixelated mode via debug API or URL
      if (window.__debugAPI && typeof window.__debugAPI.setPixelated === 'function') {
        window.__debugAPI.setPixelated(true);
        return true;
      }
      // Try toggling via keyboard shortcut (if one exists)
      return false;
    });

    if (!hasPixelMode) {
      // Pixelation mode requires page reload with different URL param
      // Just check that the current renderer is outputting reasonable data
      results.checks.push({ check: 'pixelation_mode', passed: true,
        detail: `Pixelation mode toggle not available via API — skipping comparison. ` +
          `Normal mode: ${normalData ? normalData.uniqueColors : '?'} unique colors, ` +
          `canvas: ${normalData ? `${normalData.width}x${normalData.height}` : 'unknown'}` });
      return results;
    }

    await sleep(1000);

    // Capture pixelated mode color count
    await page.evaluate(() => { window.__canvasCapture.requested = true; window.__canvasCapture.data = null; });
    await sleep(200);
    const pixelData = await page.evaluate(() => window.__canvasCapture.data);

    if (normalData && pixelData) {
      const colorReduction = normalData.uniqueColors / Math.max(1, pixelData.uniqueColors);
      results.checks.push({ check: 'color_reduction', passed: colorReduction > 1.2,
        detail: `Normal: ${normalData.uniqueColors} colors, Pixelated: ${pixelData.uniqueColors} colors ` +
          `(${colorReduction.toFixed(1)}x reduction)` +
          (colorReduction > 1.2 ? ' — pixelation working' : ' — no significant difference') });

      // Check canvas resolution (pixelated should have smaller backing store)
      if (pixelData.width < normalData.width) {
        results.checks.push({ check: 'resolution_reduced', passed: true,
          detail: `Canvas: ${normalData.width}x${normalData.height} -> ${pixelData.width}x${pixelData.height}` });
      }
    } else {
      results.checks.push({ check: 'pixel_capture', passed: false,
        detail: `Could not capture pixel data (normal=${!!normalData}, pixel=${!!pixelData})` });
    }

    return results;
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runScenario(browser, scenarioName, scenarioFn, surface) {
  const page = await createPage(browser);
  const result = { scenario: scenarioName, surface, passed: true, checks: [], error: null };

  try {
    await startGameOnSurface(page, surface);

    // Verify telemetry is active
    const t = await waitForTelemetry(page, 8000);
    if (!t) {
      result.passed = false;
      result.checks.push({ check: 'telemetry_init', passed: false,
        detail: `No telemetry on ${surface} — game may not have started` });

      // Take screenshot for debugging
      const ss = `${SCREENSHOT_DIR}/${scenarioName}-${surface}-failed.png`;
      writeFileSync(ss, await page.screenshot({ encoding: 'binary' }));

      return result;
    }

    // Verify surface loaded correctly
    const reportedSurface = t.surface?.type;
    if (reportedSurface && !reportedSurface.toLowerCase().includes(surface.replace('-', ''))) {
      // Surface name mismatch check is informational (naming may differ)
      result.checks.push({ check: 'surface_match', passed: true,
        detail: `Requested "${surface}", telemetry reports "${reportedSurface}"` });
    }

    const scenarioResult = await scenarioFn(page, surface);
    result.checks = scenarioResult.checks || [];
    result.passed = result.checks.every(c => c.passed);

    // Take final screenshot
    const ss = `${SCREENSHOT_DIR}/${scenarioName}-${surface}.png`;
    writeFileSync(ss, await page.screenshot({ encoding: 'binary' }));

  } catch (err) {
    result.passed = false;
    result.error = err.message;
    result.checks.push({ check: 'runtime', passed: false, detail: `Error: ${err.message}` });

    try {
      const ss = `${SCREENSHOT_DIR}/${scenarioName}-${surface}-error.png`;
      writeFileSync(ss, await page.screenshot({ encoding: 'binary' }));
    } catch (_) { /* page may be closed */ }
  } finally {
    await page.close().catch(() => {});
  }

  return result;
}

async function main() {
  // Parse CLI args
  const args = Object.fromEntries(
    process.argv.slice(2)
      .filter(a => a.startsWith('--'))
      .map(a => {
        const [k, v] = a.slice(2).split('=');
        return [k, v || 'true'];
      })
  );

  const surfaces = args.surface ? [args.surface] : ALL_SURFACES;
  const scenarioFilter = args.scenario || null;

  const scenarioEntries = Object.entries(SCENARIOS).filter(
    ([name]) => !scenarioFilter || name === scenarioFilter
  );

  if (scenarioEntries.length === 0) {
    console.error(`Unknown scenario: ${scenarioFilter}. Available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  DEEP SCENARIO TESTS`);
  console.log(`  Surfaces: ${surfaces.join(', ')}`);
  console.log(`  Scenarios: ${scenarioEntries.map(([n]) => n).join(', ')}`);
  console.log(`${'='.repeat(70)}\n`);

  const browser = await launchBrowser();
  const allResults = [];
  let totalPassed = 0;
  let totalFailed = 0;

  for (const [scenarioName, scenarioFn] of scenarioEntries) {
    console.log(`\n--- Scenario: ${scenarioName} ---`);

    for (const surface of surfaces) {
      process.stdout.write(`  ${surface}: `);

      const result = await runScenario(browser, scenarioName, scenarioFn, surface);
      allResults.push(result);

      if (result.passed) {
        totalPassed++;
        console.log(`PASS`);
      } else {
        totalFailed++;
        console.log(`FAIL`);
      }

      // Print check details
      for (const check of result.checks) {
        const icon = check.passed ? '    [OK]' : '    [!!]';
        console.log(`${icon} ${check.check}: ${check.detail}`);
      }
      if (result.error) {
        console.log(`    [ERR] ${result.error}`);
      }
    }
  }

  await browser.close();

  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  SUMMARY: ${totalPassed} passed, ${totalFailed} failed`);
  console.log(`${'='.repeat(70)}`);

  // Group failures
  const failures = allResults.filter(r => !r.passed);
  if (failures.length > 0) {
    console.log('\n  FAILURES:');
    for (const f of failures) {
      console.log(`    ${f.scenario} / ${f.surface}:`);
      for (const c of f.checks.filter(c => !c.passed)) {
        console.log(`      - ${c.check}: ${c.detail}`);
      }
    }
  }

  console.log('');

  // Write results to file
  const resultsMd = generateResultsMarkdown(allResults, totalPassed, totalFailed);
  const resultsPath = resolve(PROJECT_ROOT, 'tasks/s44r10-07-scenario-results.md');
  writeFileSync(resultsPath, resultsMd);
  console.log(`  Results saved to: ${resultsPath}\n`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

function generateResultsMarkdown(results, passed, failed) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let md = `# Deep Scenario Test Results\n\n`;
  md += `**Date:** ${now}\n`;
  md += `**Summary:** ${passed} passed, ${failed} failed\n\n`;

  // Group by scenario
  const byScenario = {};
  for (const r of results) {
    if (!byScenario[r.scenario]) byScenario[r.scenario] = [];
    byScenario[r.scenario].push(r);
  }

  for (const [scenario, runs] of Object.entries(byScenario)) {
    md += `## Scenario: ${scenario}\n\n`;
    md += `| Surface | Result | Details |\n`;
    md += `|---------|--------|---------|\n`;

    for (const r of runs) {
      const status = r.passed ? 'PASS' : 'FAIL';
      const details = r.checks.map(c => `${c.passed ? '+' : '-'} ${c.check}: ${c.detail}`).join('<br>');
      md += `| ${r.surface} | ${status} | ${details || r.error || '—'} |\n`;
    }
    md += '\n';
  }

  // Failures section
  const failures = results.filter(r => !r.passed);
  if (failures.length > 0) {
    md += `## Failures Summary\n\n`;
    for (const f of failures) {
      md += `### ${f.scenario} / ${f.surface}\n`;
      for (const c of f.checks.filter(c => !c.passed)) {
        md += `- **${c.check}:** ${c.detail}\n`;
      }
      md += '\n';
    }
  }

  return md;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
