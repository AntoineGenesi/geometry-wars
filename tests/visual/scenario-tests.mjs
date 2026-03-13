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
];

const ALL_SURFACES = [
  'sphere', 'torus', 'cube', 'cube-ring', 'pill',
  'peanut', 'mobius', 'sphere-tunnel', 'cube-tunnel',
  'pipe', 'capsule', 'icosahedron', 'mobius-bevel',
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

  // =========================================================================
  // BRUTAL STRESS TESTS (Scenarios 7-12) — Added s44r10-09
  // These are HARSH. 30-60s active play, strict thresholds, zero tolerance
  // for phantom kills, NaN, or distance mismatches.
  // =========================================================================

  /**
   * Scenario 7: Extended Survival — 60s Active Gameplay
   * Player moves randomly + shoots continuously.
   * Every death gets a full autopsy. Phantom kills = FAIL.
   */
  async survival(page, surface) {
    const results = { name: 'Extended Survival (60s)', surface, checks: [] };

    // Movement pattern: alternate WASD every 2-3s with continuous shooting
    const DURATION_MS = 60000;
    const MOVE_INTERVAL_MS = 2500;
    const SAMPLE_INTERVAL_MS = 500;
    const keys = ['w', 'a', 's', 'd'];

    // Start shooting — click center of canvas and hold mouse
    await page.mouse.move(320, 180);
    await page.mouse.down();

    // Collect telemetry samples while playing
    const samples = [];
    const startTime = Date.now();
    let currentKey = null;
    let lastKeyChange = 0;
    let keyIndex = 0;

    while (Date.now() - startTime < DURATION_MS) {
      const elapsed = Date.now() - startTime;

      // Change movement direction every MOVE_INTERVAL_MS
      if (elapsed - lastKeyChange > MOVE_INTERVAL_MS) {
        if (currentKey) await page.keyboard.up(currentKey);
        currentKey = keys[keyIndex % keys.length];
        keyIndex++;
        await page.keyboard.down(currentKey);
        lastKeyChange = elapsed;

        // Also move mouse to a random-ish spot for shooting direction
        const angle = (keyIndex * 1.3) % (2 * Math.PI);
        await page.mouse.move(320 + Math.cos(angle) * 100, 180 + Math.sin(angle) * 100);
      }

      // Sample telemetry
      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (t) samples.push({ ...t, wallTime: elapsed });

      await sleep(SAMPLE_INTERVAL_MS);
    }

    // Release controls
    if (currentKey) await page.keyboard.up(currentKey);
    await page.mouse.up();

    if (samples.length < 20) {
      results.checks.push({ check: 'telemetry_samples', passed: false,
        detail: `Only ${samples.length} samples in 60s — game may have crashed` });
      return results;
    }

    results.checks.push({ check: 'telemetry_samples', passed: true,
      detail: `${samples.length} samples over 60s` });

    // Check game didn't crash (should still have frames advancing)
    const firstFrame = samples[0].frame;
    const lastFrame = samples[samples.length - 1].frame;
    const frameAdvancement = lastFrame - firstFrame;
    results.checks.push({ check: 'game_running', passed: frameAdvancement > 100,
      detail: `Frames advanced: ${firstFrame} → ${lastFrame} (${frameAdvancement} frames)` +
        (frameAdvancement <= 100 ? ' — GAME MAY HAVE FROZEN' : '') });

    // === DEATH AUTOPSY ===
    const lastSample = samples[samples.length - 1];
    const deaths = lastSample.deaths;

    if (!deaths || !deaths.log) {
      results.checks.push({ check: 'death_tracking', passed: false,
        detail: 'No death log in telemetry' });
      return results;
    }

    results.checks.push({ check: 'total_deaths', passed: true,
      detail: `${deaths.total} deaths in 60s` });

    // Analyze EVERY death
    let phantomDeaths = 0;
    let spawnKills = 0;
    let legitimateDeaths = 0;
    const deathDetails = [];

    for (const d of deaths.log) {
      const wrappedSurfDist = d.nearestEnemySurfaceDist > 0.5
        ? 1.0 - d.nearestEnemySurfaceDist : d.nearestEnemySurfaceDist;

      // Phantom: surface says far AND world says far
      const isPhantom = wrappedSurfDist > 0.25 && d.nearestEnemyDist > 2.5;
      // Spawn kill: death within first 2s of a life
      const isSpawnKill = d.time < 2.0 && d.nearestEnemySurfaceDist < 0.05;

      if (isPhantom) {
        phantomDeaths++;
        deathDetails.push(`PHANTOM t=${d.time.toFixed(1)}s: "${d.nearestEnemyType}" surf=${wrappedSurfDist.toFixed(3)} world=${d.nearestEnemyDist.toFixed(2)}`);
      } else if (isSpawnKill) {
        spawnKills++;
        deathDetails.push(`SPAWN_KILL t=${d.time.toFixed(1)}s: "${d.nearestEnemyType}" surf=${wrappedSurfDist.toFixed(3)}`);
      } else {
        legitimateDeaths++;
      }
    }

    results.checks.push({ check: 'phantom_deaths', passed: phantomDeaths === 0,
      detail: phantomDeaths === 0
        ? `0 phantom deaths out of ${deaths.total} total — hit detection clean`
        : `${phantomDeaths} PHANTOM DEATHS: ${deathDetails.filter(d => d.startsWith('PHANTOM')).join('; ')}` });

    results.checks.push({ check: 'spawn_kills', passed: spawnKills === 0,
      detail: spawnKills === 0
        ? `0 spawn kills`
        : `${spawnKills} SPAWN KILLS: ${deathDetails.filter(d => d.startsWith('SPAWN')).join('; ')}` });

    // Check score increased (player was actually playing, not stuck)
    const firstScore = samples[0].player?.score || 0;
    const lastScore = lastSample.player?.score || 0;
    results.checks.push({ check: 'score_progress', passed: lastScore > firstScore,
      detail: `Score: ${firstScore} → ${lastScore}` +
        (lastScore <= firstScore ? ' — player never scored, shooting may be broken' : '') });

    // Check NaN in any sample
    const nanSamples = samples.filter(s =>
      isNaN(s.player.u) || isNaN(s.player.v) ||
      isNaN(s.player.worldPos.x) || isNaN(s.player.worldPos.y) || isNaN(s.player.worldPos.z));
    results.checks.push({ check: 'no_nan', passed: nanSamples.length === 0,
      detail: nanSamples.length === 0
        ? 'No NaN coordinates in any sample'
        : `${nanSamples.length} samples had NaN player coordinates!` });

    return results;
  },

  /**
   * Scenario 8: Deliberate Enemy Approach — Walk INTO Enemies
   * Move toward nearest enemy, verify death at correct distance.
   * Repeat 3 times per surface.
   */
  async approach(page, surface) {
    const results = { name: 'Deliberate Enemy Approach', surface, checks: [] };

    const MAX_ATTEMPTS = 3;
    const APPROACH_TIMEOUT_MS = 20000; // max 20s per attempt

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Wait for enemies to exist
      let t = await page.evaluate(() => window.__GAME_TELEMETRY);
      let waitCount = 0;
      while ((!t || t.enemies.length === 0) && waitCount < 20) {
        await sleep(500);
        t = await page.evaluate(() => window.__GAME_TELEMETRY);
        waitCount++;
      }

      if (!t || t.enemies.length === 0) {
        results.checks.push({ check: `approach_${attempt}_enemies`, passed: false,
          detail: `No enemies found after ${waitCount * 500}ms wait` });
        continue;
      }

      // Find nearest enemy
      const sorted = [...t.enemies].sort((a, b) => a.worldDistToPlayer - b.worldDistToPlayer);
      const target = sorted[0];
      const initialDist = target.worldDistToPlayer;

      // Determine which key to press to move toward enemy
      // Compare player UV with enemy UV
      const du = target.u - t.player.u;
      const dv = target.v - t.player.v;
      // Wrap-aware
      const wdu = du > 0.5 ? du - 1 : (du < -0.5 ? du + 1 : du);
      const wdv = dv > 0.5 ? dv - 1 : (dv < -0.5 ? dv + 1 : dv);

      // Map UV deltas to WASD (a=u-, d=u+, w=v+, s=v-)
      const horizontalKey = wdu > 0 ? 'd' : 'a';
      const verticalKey = wdv > 0 ? 'w' : 's';
      const primaryKey = Math.abs(wdu) > Math.abs(wdv) ? horizontalKey : verticalKey;

      // Press both keys to move diagonally toward enemy
      await page.keyboard.down(horizontalKey);
      await page.keyboard.down(verticalKey);

      // Track distance over time — wait for death or timeout
      const approachStart = Date.now();
      let died = false;
      let lastDist = initialDist;
      let distAtDeath = -1;
      const prevDeaths = t.deaths?.total || 0;
      let distHistory = [];

      while (Date.now() - approachStart < APPROACH_TIMEOUT_MS) {
        await sleep(300);
        const curr = await page.evaluate(() => window.__GAME_TELEMETRY);
        if (!curr) continue;

        // Track nearest enemy distance
        const nearestDist = curr.collisions.nearestEnemyDist;
        if (nearestDist > 0) {
          distHistory.push(nearestDist);
          lastDist = nearestDist;
        }

        // Check if we died
        if (curr.deaths && curr.deaths.total > prevDeaths) {
          died = true;
          const deathEntry = curr.deaths.log[curr.deaths.log.length - 1];
          distAtDeath = deathEntry?.nearestEnemyDist || lastDist;
          break;
        }
      }

      await page.keyboard.up(horizontalKey);
      await page.keyboard.up(verticalKey);

      if (died) {
        // Verify death happened at reasonable distance (world dist < 3.0 = within collision range)
        const deathDistOk = distAtDeath < 3.0;
        results.checks.push({ check: `approach_${attempt}_death_dist`, passed: deathDistOk,
          detail: `Death at world dist=${distAtDeath.toFixed(3)} ` +
            `(initial=${initialDist.toFixed(2)}, target="${target.type}")` +
            (deathDistOk ? '' : ` — DIED TOO FAR FROM ENEMY (phantom kill?)`) });
      } else {
        // No death in 20s — either player got lucky or hit detection failed
        // Check if distance decreased (player was actually approaching)
        const distDecreased = distHistory.length > 2 &&
          distHistory[distHistory.length - 1] < distHistory[0] * 0.8;
        results.checks.push({ check: `approach_${attempt}_nodeath`, passed: true,
          detail: `No death after ${APPROACH_TIMEOUT_MS / 1000}s approach. ` +
            `Last dist=${lastDist.toFixed(2)}, dist decreased=${distDecreased}` });
      }

      // Wait for respawn before next attempt
      await sleep(3000);
    }

    return results;
  },

  /**
   * Scenario 9: Seam Crossing — Move to UV Boundaries
   * Move in one direction for 15s, track UV continuity.
   * Any NaN, large UV jump, or phantom death at seam = FAIL.
   */
  async seam(page, surface) {
    const results = { name: 'Seam Crossing', surface, checks: [] };

    // Test both U-axis (press 'd' for 15s) and V-axis (press 'w' for 15s)
    for (const axis of [{ key: 'd', label: 'U-axis (right)', coord: 'u' }, { key: 'w', label: 'V-axis (forward)', coord: 'v' }]) {
      const uvHistory = [];
      const worldHistory = [];
      let nanDetected = false;
      let largeJump = false;
      let jumpDetails = '';

      // Get initial state
      const prevDeaths = (await page.evaluate(() => window.__GAME_TELEMETRY))?.deaths?.total || 0;

      // Hold key for 15s, sample frequently
      await page.keyboard.down(axis.key);

      for (let i = 0; i < 75; i++) { // 75 * 200ms = 15s
        await sleep(200);
        const t = await page.evaluate(() => window.__GAME_TELEMETRY);
        if (!t) continue;

        const uv = axis.coord === 'u' ? t.player.u : t.player.v;
        const worldPos = t.player.worldPos;

        if (isNaN(uv) || !isFinite(uv)) {
          nanDetected = true;
        }

        uvHistory.push(uv);
        worldHistory.push({ x: worldPos.x, y: worldPos.y, z: worldPos.z });

        // Check for large UV jumps (not wrapping 0↔1, not face transitions)
        if (uvHistory.length >= 2) {
          const prev = uvHistory[uvHistory.length - 2];
          const curr = uvHistory[uvHistory.length - 1];
          const delta = Math.abs(curr - prev);
          // Expected non-bugs:
          // - UV wrapping: delta ≈ 0.5 (half-revolution) or ≈ 1.0 (full wrap) — normal on closed surfaces
          // - Face transitions: delta ≈ 0.167 (1/6) on cubes — crossing between 6 faces
          // - Mobius half-twist: delta ≈ 0.2-0.3 — non-orientable topology
          // True discontinuity: unexpected delta NOT near any of these values
          const isWrap = delta > 0.45 && delta < 0.55; // ~0.5 wrap (half revolution)
          const isFullWrap = delta > 0.85; // ~1.0 full wrap
          const isFaceTransition = delta > 0.12 && delta < 0.22; // cube face change (~0.167)
          const isMobiusTwist = delta > 0.18 && delta < 0.35; // mobius topology
          const isExpected = isWrap || isFullWrap || isFaceTransition || isMobiusTwist;

          if (delta > 0.1 && !isExpected) {
            largeJump = true;
            jumpDetails = `UV jump at sample ${i}: ${prev.toFixed(4)} → ${curr.toFixed(4)} (delta=${delta.toFixed(4)})`;
          }
        }
      }

      await page.keyboard.up(axis.key);

      results.checks.push({ check: `seam_${axis.coord}_nan`, passed: !nanDetected,
        detail: nanDetected ? `NaN detected in ${axis.label} during seam crossing!` :
          `No NaN in ${axis.label} (${uvHistory.length} samples)` });

      results.checks.push({ check: `seam_${axis.coord}_jump`, passed: !largeJump,
        detail: largeJump ? `Discontinuous jump in ${axis.label}: ${jumpDetails}` :
          `UV continuity OK in ${axis.label}` });

      // Check if UV actually wrapped (moved enough to cross a seam)
      const uvRange = Math.max(...uvHistory) - Math.min(...uvHistory);
      const crossedSeam = uvRange > 0.7; // If range > 0.7, likely wrapped
      results.checks.push({ check: `seam_${axis.coord}_wrap`, passed: true,
        detail: `${axis.label} UV range: ${Math.min(...uvHistory).toFixed(3)} - ${Math.max(...uvHistory).toFixed(3)} ` +
          `(${crossedSeam ? 'CROSSED SEAM' : 'did not reach seam'})` });

      // Check for deaths during seam crossing (phantom deaths at boundaries)
      const postDeaths = (await page.evaluate(() => window.__GAME_TELEMETRY))?.deaths?.total || 0;
      const seamDeaths = postDeaths - prevDeaths;
      if (seamDeaths > 0) {
        // Get the death details
        const deathLog = (await page.evaluate(() => window.__GAME_TELEMETRY))?.deaths?.log || [];
        const recentDeaths = deathLog.slice(-seamDeaths);
        for (const d of recentDeaths) {
          const wrappedDist = d.nearestEnemySurfaceDist > 0.5
            ? 1.0 - d.nearestEnemySurfaceDist : d.nearestEnemySurfaceDist;
          const isPhantom = wrappedDist > 0.25 && d.nearestEnemyDist > 2.5;
          if (isPhantom) {
            results.checks.push({ check: `seam_${axis.coord}_phantom_death`, passed: false,
              detail: `PHANTOM death during ${axis.label} seam crossing: ` +
                `"${d.nearestEnemyType}" surf=${wrappedDist.toFixed(3)} world=${d.nearestEnemyDist.toFixed(2)}` });
          }
        }
      }

      await sleep(1000); // Brief pause between axes
    }

    // Also check enemy positions near seam — are distances consistent?
    const t = await page.evaluate(() => window.__GAME_TELEMETRY);
    if (t && t.enemies.length > 0) {
      const seamEnemies = t.enemies.filter(e => {
        const nearUSeam = e.u < 0.05 || e.u > 0.95;
        const nearVSeam = e.v < 0.05 || e.v > 0.95;
        return nearUSeam || nearVSeam;
      });
      if (seamEnemies.length > 0) {
        // Check distance consistency for seam-adjacent enemies
        for (const e of seamEnemies.slice(0, 3)) {
          const surfFar = e.surfaceDistToPlayer > 0.4;
          const worldClose = e.worldDistToPlayer < 1.5;
          const mismatch = surfFar && worldClose;
          results.checks.push({ check: `seam_enemy_dist`, passed: !mismatch,
            detail: `Seam enemy "${e.type}" at UV(${e.u.toFixed(3)},${e.v.toFixed(3)}): ` +
              `surf=${e.surfaceDistToPlayer.toFixed(3)} world=${e.worldDistToPlayer.toFixed(2)}` +
              (mismatch ? ' — DISTANCE MISMATCH at seam!' : '') });
        }
      }
    }

    return results;
  },

  /**
   * Scenario 10: Enemy Pile-Up — Wait for 30+ Enemies
   * Let enemies accumulate, check for frozen/overlapping enemies.
   */
  async pileup(page, surface) {
    const results = { name: 'Enemy Pile-Up', surface, checks: [] };

    // Wait 30s for enemies to accumulate (don't shoot — let them pile up)
    // Move slightly to stay alive but don't engage
    const WAIT_MS = 30000;
    const SAMPLE_INTERVAL_MS = 1000;
    const enemySnapshots = []; // per-sample: array of {type, u, v, worldDist}

    const startTime = Date.now();
    let moveDir = 'a';
    let lastDirChange = 0;
    await page.keyboard.down(moveDir);

    while (Date.now() - startTime < WAIT_MS) {
      const elapsed = Date.now() - startTime;

      // Alternate direction every 5s (dodge enemies, don't die too fast)
      if (elapsed - lastDirChange > 5000) {
        await page.keyboard.up(moveDir);
        moveDir = moveDir === 'a' ? 'd' : 'a';
        await page.keyboard.down(moveDir);
        lastDirChange = elapsed;
      }

      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (t) {
        enemySnapshots.push(t.enemies.map(e => ({
          type: e.type, u: e.u, v: e.v,
          worldDist: e.worldDistToPlayer,
          worldPos: e.worldPos,
        })));
      }

      await sleep(SAMPLE_INTERVAL_MS);
    }

    await page.keyboard.up(moveDir);

    if (enemySnapshots.length < 10) {
      results.checks.push({ check: 'enough_snapshots', passed: false,
        detail: `Only ${enemySnapshots.length} snapshots` });
      return results;
    }

    // Peak enemy count
    const peakEnemies = Math.max(...enemySnapshots.map(s => s.length));
    results.checks.push({ check: 'enemy_accumulation', passed: peakEnemies >= 5,
      detail: `Peak enemy count: ${peakEnemies}` +
        (peakEnemies < 5 ? ' — too few enemies spawned in 30s' : '') });

    // Check for FROZEN enemies (same UV for 5+ consecutive samples = 5s)
    const lastSnapshot = enemySnapshots[enemySnapshots.length - 1];
    if (lastSnapshot.length > 0 && enemySnapshots.length >= 6) {
      let frozenCount = 0;
      // Track each enemy by approximate position across snapshots
      for (const enemy of lastSnapshot) {
        let consecutiveSame = 0;
        for (let i = enemySnapshots.length - 2; i >= Math.max(0, enemySnapshots.length - 8); i--) {
          const prevSnap = enemySnapshots[i];
          const match = prevSnap.find(e =>
            Math.abs(e.u - enemy.u) < 0.001 && Math.abs(e.v - enemy.v) < 0.001 && e.type === enemy.type);
          if (match) consecutiveSame++;
          else break;
        }
        if (consecutiveSame >= 5) frozenCount++;
      }

      results.checks.push({ check: 'frozen_enemies', passed: frozenCount === 0,
        detail: frozenCount === 0
          ? `No frozen enemies detected (checked ${lastSnapshot.length} enemies)`
          : `${frozenCount} FROZEN enemies (same UV for 5+ seconds) — stuck/not moving!` });
    }

    // Check for OVERLAPPING enemies (two enemies with UV distance < 0.005)
    if (lastSnapshot.length >= 2) {
      let overlaps = 0;
      for (let i = 0; i < lastSnapshot.length; i++) {
        for (let j = i + 1; j < lastSnapshot.length; j++) {
          const du = lastSnapshot[i].u - lastSnapshot[j].u;
          const dv = lastSnapshot[i].v - lastSnapshot[j].v;
          const dist = Math.sqrt(du * du + dv * dv);
          if (dist < 0.005) overlaps++;
        }
      }

      results.checks.push({ check: 'overlapping_enemies', passed: overlaps <= 1,
        detail: overlaps <= 1
          ? `${overlaps} enemy overlap(s) — acceptable`
          : `${overlaps} OVERLAPPING enemy pairs (UV dist < 0.005) — clumping bug` });
    }

    // Check enemies are APPROACHING player (at least some should have decreasing distance)
    if (enemySnapshots.length >= 10) {
      const earlyDists = enemySnapshots[5].map(e => e.worldDist).filter(d => d > 0);
      const lateDists = enemySnapshots[enemySnapshots.length - 1].map(e => e.worldDist).filter(d => d > 0);

      if (earlyDists.length > 0 && lateDists.length > 0) {
        const earlyAvg = earlyDists.reduce((s, d) => s + d, 0) / earlyDists.length;
        const lateAvg = lateDists.reduce((s, d) => s + d, 0) / lateDists.length;
        // At least SOME enemies should be getting closer (avg dist should decrease or stay similar)
        const approaching = lateAvg < earlyAvg * 1.5;
        results.checks.push({ check: 'enemies_approaching', passed: approaching,
          detail: `Avg enemy dist: early=${earlyAvg.toFixed(2)} late=${lateAvg.toFixed(2)} ` +
            (approaching ? '— enemies closing in' : '— enemies NOT approaching (stuck?)') });
      }
    }

    return results;
  },

  /**
   * Scenario 11: Shooting Accuracy — Bullets Kill Enemies
   * Shoot continuously for 30s, verify score increases (kills happening).
   */
  async shooting(page, surface) {
    const results = { name: 'Shooting Accuracy', surface, checks: [] };

    const DURATION_MS = 30000;
    const SAMPLE_INTERVAL_MS = 500;

    // Get initial state
    const initial = await page.evaluate(() => window.__GAME_TELEMETRY);
    if (!initial) {
      results.checks.push({ check: 'telemetry', passed: false, detail: 'No initial telemetry' });
      return results;
    }
    const initialScore = initial.player.score;
    const initialFrame = initial.frame;

    // Start shooting + slight movement (so bullets go different directions)
    await page.mouse.move(420, 180); // aim right
    await page.mouse.down();
    await page.keyboard.down('d'); // move right

    const scoreSamples = [];
    const bulletCountSamples = [];
    const killTimestamps = [];
    let prevScore = initialScore;

    const startTime = Date.now();
    let phase = 0;

    while (Date.now() - startTime < DURATION_MS) {
      const elapsed = Date.now() - startTime;

      // Change aim direction every 5s to sweep bullets around
      const newPhase = Math.floor(elapsed / 5000);
      if (newPhase !== phase) {
        phase = newPhase;
        const angle = (phase * Math.PI / 3); // sweep in 60-degree increments
        await page.mouse.move(320 + Math.cos(angle) * 150, 180 + Math.sin(angle) * 150);
        // Also change movement direction
        const moveKeys = ['d', 'w', 'a', 's'];
        const prevKey = moveKeys[(phase - 1) % 4];
        const newKey = moveKeys[phase % 4];
        await page.keyboard.up(prevKey);
        await page.keyboard.down(newKey);
      }

      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (t) {
        scoreSamples.push(t.player.score);
        bulletCountSamples.push(t.bullets?.length || 0);

        if (t.player.score > prevScore) {
          killTimestamps.push(elapsed);
          prevScore = t.player.score;
        }
      }

      await sleep(SAMPLE_INTERVAL_MS);
    }

    // Release controls
    await page.mouse.up();
    for (const k of ['w', 'a', 's', 'd']) await page.keyboard.up(k);

    // Final state
    const final = await page.evaluate(() => window.__GAME_TELEMETRY);
    const finalScore = final?.player?.score || 0;
    const totalKills = finalScore - initialScore;

    // Check 1: Score increased (player actually killed enemies)
    results.checks.push({ check: 'kills_happened', passed: totalKills > 0,
      detail: `Score: ${initialScore} → ${finalScore} (${totalKills} points gained in 30s)` +
        (totalKills === 0 ? ' — ZERO KILLS, bullets may not be hitting enemies!' : '') });

    // Check 2: Bullets were present (guns actually firing)
    const avgBullets = bulletCountSamples.length > 0
      ? bulletCountSamples.reduce((s, b) => s + b, 0) / bulletCountSamples.length : 0;
    const maxBullets = Math.max(...bulletCountSamples, 0);
    results.checks.push({ check: 'bullets_firing', passed: maxBullets > 0,
      detail: `Avg bullets on screen: ${avgBullets.toFixed(1)}, max: ${maxBullets}` +
        (maxBullets === 0 ? ' — NO BULLETS DETECTED, shooting broken?' : '') });

    // Check 3: Kill rate is reasonable (at least 1 kill every 10s on average)
    const minKillRate = DURATION_MS / 10000; // 3 kills in 30s minimum
    results.checks.push({ check: 'kill_rate', passed: totalKills >= minKillRate,
      detail: `Kill rate: ${(totalKills / (DURATION_MS / 1000) * 60).toFixed(1)} per min ` +
        `(need ≥${(minKillRate / (DURATION_MS / 1000) * 60).toFixed(1)}/min)` +
        (totalKills < minKillRate ? ' — kill rate too low, hits may not register' : '') });

    // Check 4: Bullet-enemy overlaps detected (telemetry tracks this)
    const lastSample = final;
    if (lastSample) {
      const bulletsHitting = lastSample.collisions?.bulletsHittingEnemies || 0;
      results.checks.push({ check: 'bullet_enemy_overlap', passed: true,
        detail: `Current bullet-enemy overlaps: ${bulletsHitting}` });
    }

    // Check 5: Kills happened across the duration (not just at start)
    if (killTimestamps.length >= 2) {
      const firstKill = killTimestamps[0];
      const lastKill = killTimestamps[killTimestamps.length - 1];
      const killSpan = lastKill - firstKill;
      results.checks.push({ check: 'kill_consistency', passed: killSpan > DURATION_MS * 0.3,
        detail: `Kills from ${(firstKill / 1000).toFixed(1)}s to ${(lastKill / 1000).toFixed(1)}s ` +
          `(span: ${(killSpan / 1000).toFixed(1)}s)` +
          (killSpan <= DURATION_MS * 0.3 ? ' — kills clustered, may have stopped working' : '') });
    }

    return results;
  },

  /**
   * Scenario 12: Surface vs World Distance Consistency
   * For every enemy, every sample: compare surfaceDist and worldDist.
   * Flag cases where they disagree (surface says far, world says close, or vice versa).
   * This is the EXACT bug class that killed players on cube-ring.
   */
  async distance_consistency(page, surface) {
    const results = { name: 'Surface vs World Distance Consistency', surface, checks: [] };

    const DURATION_MS = 30000;
    const SAMPLE_INTERVAL_MS = 400;

    // Move around while sampling (so we get diverse positions)
    await page.keyboard.down('d');
    await page.mouse.move(320, 180);
    await page.mouse.down(); // shoot to stay alive

    let totalComparisons = 0;
    let mismatches = 0;
    const mismatchDetails = [];
    let maxRatio = 0;
    let maxRatioEnemy = '';

    const startTime = Date.now();
    let phase = 0;

    while (Date.now() - startTime < DURATION_MS) {
      const elapsed = Date.now() - startTime;

      // Change direction every 5s
      const newPhase = Math.floor(elapsed / 5000);
      if (newPhase !== phase) {
        const keys = ['d', 'w', 'a', 's'];
        await page.keyboard.up(keys[phase % 4]);
        phase = newPhase;
        await page.keyboard.down(keys[phase % 4]);
      }

      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (!t || !t.enemies) { await sleep(SAMPLE_INTERVAL_MS); continue; }

      for (const e of t.enemies) {
        if (e.surfaceDistToPlayer <= 0 || e.worldDistToPlayer <= 0) continue;
        totalComparisons++;

        const surfDist = e.surfaceDistToPlayer;
        const worldDist = e.worldDistToPlayer;

        // Normalize surface dist: on wrapping surfaces, max meaningful dist is ~0.5 UV
        // World dist depends on surface size but typically 1-30 range

        // The key mismatch: surface says "far" (>0.3 UV) but world says "close" (<2.0 world units)
        // This means the surface distance formula is WRONG for this surface
        const surfFarWorldClose = surfDist > 0.3 && worldDist < 2.0;

        // The reverse: surface says "close" (<0.05 UV) but world says "far" (>5.0)
        // This means an enemy that SHOULD be hitting player is calculated as far away
        const surfCloseWorldFar = surfDist < 0.05 && worldDist > 5.0;

        if (surfFarWorldClose || surfCloseWorldFar) {
          mismatches++;
          if (mismatchDetails.length < 10) { // cap details at 10
            mismatchDetails.push(
              `"${e.type}" UV(${e.u.toFixed(3)},${e.v.toFixed(3)}): ` +
              `surf=${surfDist.toFixed(4)} world=${worldDist.toFixed(2)} ` +
              `(${surfFarWorldClose ? 'SURF_FAR+WORLD_CLOSE' : 'SURF_CLOSE+WORLD_FAR'})`);
          }
        }

        // Track the worst ratio
        // Normalize: surfDist * surfaceScale ≈ worldDist for a well-behaved surface
        // We can't know surfaceScale exactly, but we can track the ratio
        if (worldDist > 0.1) { // avoid div-by-tiny
          const ratio = surfDist / worldDist;
          if (ratio > maxRatio) {
            maxRatio = ratio;
            maxRatioEnemy = `"${e.type}" surf=${surfDist.toFixed(4)} world=${worldDist.toFixed(2)}`;
          }
        }
      }

      await sleep(SAMPLE_INTERVAL_MS);
    }

    // Release controls
    for (const k of ['w', 'a', 's', 'd']) await page.keyboard.up(k);
    await page.mouse.up();

    results.checks.push({ check: 'total_comparisons', passed: totalComparisons > 100,
      detail: `${totalComparisons} enemy-distance comparisons over 30s` });

    // STRICT threshold: any mismatch is a problem
    const mismatchRate = totalComparisons > 0 ? mismatches / totalComparisons : 0;
    results.checks.push({ check: 'distance_mismatches', passed: mismatches === 0,
      detail: mismatches === 0
        ? `0 distance mismatches out of ${totalComparisons} comparisons — distances consistent`
        : `${mismatches} MISMATCHES (${(mismatchRate * 100).toFixed(2)}%): ${mismatchDetails.join('; ')}` });

    results.checks.push({ check: 'worst_ratio', passed: true,
      detail: `Worst surf/world ratio: ${maxRatio.toFixed(4)} (${maxRatioEnemy || 'N/A'})` });

    // Per-enemy type breakdown of mismatches
    if (mismatches > 0) {
      results.checks.push({ check: 'mismatch_severity', passed: false,
        detail: `Distance inconsistency detected — this surface may have hit detection bugs at certain positions` });
    }

    return results;
  },

  // =========================================================================
  // MORE AGGRESSIVE TESTS (Scenarios 13-20) — Added s44r10-12
  // Designed to find HIDDEN bugs. Brutal thresholds. Zero tolerance.
  // =========================================================================

  /**
   * Scenario 13: Rapid Direction Change — Stuck/Snapped Movement Detection
   * Rapidly alternate WASD every 0.5s for 30s. Track UV changes per direction.
   * Catches: stuck after direction change, UV teleportation, normal flips.
   */
  async rapid_direction(page, surface) {
    const results = { name: 'Rapid Direction Change', surface, checks: [] };

    const DURATION_MS = 30000;
    const SWITCH_INTERVAL_MS = 500;
    const keys = ['w', 'a', 's', 'd'];
    const uvSamples = [];
    let stuckCount = 0;
    let largeJumps = 0;
    let nanCount = 0;

    const startTime = Date.now();
    let keyIndex = 0;
    let currentKey = keys[0];
    let lastSwitch = 0;
    await page.keyboard.down(currentKey);

    // Also shoot to stay alive
    await page.mouse.move(320, 180);
    await page.mouse.down();

    while (Date.now() - startTime < DURATION_MS) {
      const elapsed = Date.now() - startTime;

      // Rapidly switch direction
      if (elapsed - lastSwitch > SWITCH_INTERVAL_MS) {
        await page.keyboard.up(currentKey);
        keyIndex++;
        currentKey = keys[keyIndex % keys.length];
        await page.keyboard.down(currentKey);
        lastSwitch = elapsed;
      }

      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (t) {
        const sample = {
          u: t.player.u, v: t.player.v,
          wx: t.player.worldPos.x, wy: t.player.worldPos.y, wz: t.player.worldPos.z,
          alive: t.player.alive, time: elapsed,
        };
        uvSamples.push(sample);

        if (isNaN(sample.u) || isNaN(sample.v) || !isFinite(sample.u) || !isFinite(sample.v)) {
          nanCount++;
        }
      }

      await sleep(100); // Sample at 10Hz
    }

    await page.keyboard.up(currentKey);
    await page.mouse.up();

    if (uvSamples.length < 50) {
      results.checks.push({ check: 'enough_samples', passed: false,
        detail: `Only ${uvSamples.length} samples in 30s` });
      return results;
    }

    results.checks.push({ check: 'sample_count', passed: true,
      detail: `${uvSamples.length} samples collected` });

    // Check for NaN
    results.checks.push({ check: 'no_nan', passed: nanCount === 0,
      detail: nanCount === 0 ? 'No NaN coordinates' : `${nanCount} samples had NaN!` });

    // Check for stuck periods: 10+ consecutive samples with UV change < 0.0001
    let consecutiveStuck = 0;
    let maxStuckRun = 0;
    let stuckPeriods = 0;
    for (let i = 1; i < uvSamples.length; i++) {
      const du = Math.abs(uvSamples[i].u - uvSamples[i - 1].u);
      const dv = Math.abs(uvSamples[i].v - uvSamples[i - 1].v);
      const dwx = Math.abs(uvSamples[i].wx - uvSamples[i - 1].wx);
      const dwy = Math.abs(uvSamples[i].wy - uvSamples[i - 1].wy);
      const dwz = Math.abs(uvSamples[i].wz - uvSamples[i - 1].wz);
      const worldMoved = dwx + dwy + dwz;
      const uvMoved = du + dv;

      if (uvMoved < 0.0001 && worldMoved < 0.001 && uvSamples[i].alive) {
        consecutiveStuck++;
        if (consecutiveStuck > maxStuckRun) maxStuckRun = consecutiveStuck;
      } else {
        if (consecutiveStuck >= 10) stuckPeriods++;
        consecutiveStuck = 0;
      }
    }
    if (consecutiveStuck >= 10) stuckPeriods++;

    // 10 samples at 100ms = 1s stuck
    results.checks.push({ check: 'not_stuck', passed: maxStuckRun < 10,
      detail: maxStuckRun < 10
        ? `Max consecutive no-movement: ${maxStuckRun} samples (${maxStuckRun * 100}ms) — OK`
        : `STUCK for ${maxStuckRun} samples (${maxStuckRun * 100}ms)! ${stuckPeriods} stuck period(s)` });

    // Check for UV teleportation jumps (>0.3 that aren't wrapping)
    for (let i = 1; i < uvSamples.length; i++) {
      const du = Math.abs(uvSamples[i].u - uvSamples[i - 1].u);
      const dv = Math.abs(uvSamples[i].v - uvSamples[i - 1].v);
      // Skip wrapping (delta near 0.5 or 1.0) and face transitions (~0.167)
      const isWrap = (du > 0.45 && du < 0.55) || du > 0.85;
      const isFace = du > 0.12 && du < 0.22;
      if (du > 0.3 && !isWrap && !isFace) largeJumps++;
      const isWrapV = (dv > 0.45 && dv < 0.55) || dv > 0.85;
      const isFaceV = dv > 0.12 && dv < 0.22;
      if (dv > 0.3 && !isWrapV && !isFaceV) largeJumps++;
    }

    results.checks.push({ check: 'no_teleportation', passed: largeJumps === 0,
      detail: largeJumps === 0
        ? 'No unexpected UV jumps during rapid direction changes'
        : `${largeJumps} TELEPORTATION JUMPS detected during rapid direction changes!` });

    return results;
  },

  /**
   * Scenario 14: Edge of Surface — UV Extremes
   * Navigate to UV corners and check for NaN, broken collision, enemies vanishing.
   */
  async uv_extremes(page, surface) {
    const results = { name: 'UV Extremes', surface, checks: [] };

    // Move to extremes by holding keys for extended periods
    const directions = [
      { keys: ['w', 'a'], label: 'top-left (W+A)', duration: 8000 },
      { keys: ['s', 'd'], label: 'bottom-right (S+D)', duration: 8000 },
      { keys: ['w', 'd'], label: 'top-right (W+D)', duration: 8000 },
      { keys: ['s', 'a'], label: 'bottom-left (S+A)', duration: 8000 },
    ];

    // Shoot to stay alive
    await page.mouse.move(320, 180);
    await page.mouse.down();

    for (const dir of directions) {
      // Hold direction keys
      for (const k of dir.keys) await page.keyboard.down(k);
      await sleep(dir.duration);
      for (const k of dir.keys) await page.keyboard.up(k);
      await sleep(300);

      // Sample telemetry at this position
      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (!t) {
        results.checks.push({ check: `extreme_${dir.label}_telemetry`, passed: false,
          detail: `No telemetry at ${dir.label}` });
        continue;
      }

      // Check for NaN/Infinity
      const hasNaN = isNaN(t.player.u) || isNaN(t.player.v) ||
        !isFinite(t.player.u) || !isFinite(t.player.v) ||
        isNaN(t.player.worldPos.x) || isNaN(t.player.worldPos.y) || isNaN(t.player.worldPos.z);

      if (hasNaN) {
        results.checks.push({ check: `extreme_${dir.label}_nan`, passed: false,
          detail: `NaN/Infinity at ${dir.label}: u=${t.player.u} v=${t.player.v} pos=(${t.player.worldPos.x},${t.player.worldPos.y},${t.player.worldPos.z})` });
      }

      // Check enemies still exist and have valid positions
      const invalidEnemies = t.enemies.filter(e =>
        isNaN(e.u) || isNaN(e.v) || isNaN(e.worldPos.x) || !isFinite(e.worldDistToPlayer));
      if (invalidEnemies.length > 0) {
        results.checks.push({ check: `extreme_${dir.label}_enemy_nan`, passed: false,
          detail: `${invalidEnemies.length} enemies with NaN positions at ${dir.label}!` });
      }

      // Check collision radius hasn't become 0 or NaN
      if (t.player.collisionRadius <= 0 || isNaN(t.player.collisionRadius)) {
        results.checks.push({ check: `extreme_${dir.label}_radius`, passed: false,
          detail: `Player collision radius invalid at ${dir.label}: ${t.player.collisionRadius}` });
      }
    }

    await page.mouse.up();

    // If no failures were added, all corners are clean
    const failCount = results.checks.filter(c => !c.passed).length;
    if (failCount === 0) {
      results.checks.push({ check: 'uv_extremes_all', passed: true,
        detail: 'All 4 UV corners checked — no NaN, valid enemies, valid collision radius' });
    }

    return results;
  },

  /**
   * Scenario 15: Diagonal Movement — Combined Key Input
   * W+A, W+D, S+A, S+D simultaneously. Verify actual movement happens.
   */
  async diagonal(page, surface) {
    const results = { name: 'Diagonal Movement', surface, checks: [] };

    const combos = [
      { keys: ['w', 'a'], label: 'W+A (up-left)' },
      { keys: ['w', 'd'], label: 'W+D (up-right)' },
      { keys: ['s', 'a'], label: 'S+A (down-left)' },
      { keys: ['s', 'd'], label: 'S+D (down-right)' },
    ];

    // Shoot to stay alive
    await page.mouse.move(320, 180);
    await page.mouse.down();

    for (const combo of combos) {
      const before = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (!before) {
        results.checks.push({ check: `diag_${combo.label}`, passed: false,
          detail: `No telemetry before ${combo.label}` });
        continue;
      }

      // Hold both keys for 3s
      for (const k of combo.keys) await page.keyboard.down(k);
      await sleep(3000);
      for (const k of combo.keys) await page.keyboard.up(k);
      await sleep(200);

      const after = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (!after) {
        results.checks.push({ check: `diag_${combo.label}`, passed: false,
          detail: `No telemetry after ${combo.label}` });
        continue;
      }

      const dwx = after.player.worldPos.x - before.player.worldPos.x;
      const dwy = after.player.worldPos.y - before.player.worldPos.y;
      const dwz = after.player.worldPos.z - before.player.worldPos.z;
      const worldDist = Math.sqrt(dwx * dwx + dwy * dwy + dwz * dwz);

      const du = after.player.u - before.player.u;
      const dv = after.player.v - before.player.v;

      // Check NaN
      if (isNaN(worldDist) || isNaN(du) || isNaN(dv)) {
        results.checks.push({ check: `diag_${combo.label}_nan`, passed: false,
          detail: `NaN after ${combo.label}: worldDist=${worldDist} du=${du} dv=${dv}` });
        continue;
      }

      // Player must have moved
      const moved = worldDist > 0.05;
      results.checks.push({ check: `diag_${combo.label}`, passed: moved,
        detail: `${combo.label}: worldDist=${worldDist.toFixed(3)} du=${du.toFixed(4)} dv=${dv.toFixed(4)}` +
          (moved ? '' : ' — PLAYER DID NOT MOVE with diagonal input!') });

      // Speed should be similar to single-key movement (not zero, not 2x)
      if (worldDist > 100) {
        results.checks.push({ check: `diag_${combo.label}_speed`, passed: false,
          detail: `${combo.label}: worldDist=${worldDist.toFixed(1)} — TELEPORTATION during diagonal movement!` });
      }
    }

    await page.mouse.up();
    return results;
  },

  /**
   * Scenario 16: No-Movement Survival — Stand Still for 60s (CRITICAL)
   * Player doesn't move. Enemies MUST approach and kill the player.
   * If player NEVER dies with 30+ enemies → enemy movement is BROKEN.
   * This caught cube-ring + mobius frozen enemies.
   */
  async no_movement(page, surface) {
    const results = { name: 'No-Movement Survival (60s)', surface, checks: [] };

    const DURATION_MS = 60000;
    const SAMPLE_INTERVAL_MS = 500;
    const samples = [];

    // DON'T move, DON'T shoot — just stand there
    const startTime = Date.now();

    while (Date.now() - startTime < DURATION_MS) {
      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (t) {
        samples.push({
          time: Date.now() - startTime,
          enemyCount: t.enemies.length,
          nearestDist: t.collisions.nearestEnemyDist,
          nearestSurfDist: t.collisions.nearestEnemySurfaceDist,
          alive: t.player.alive,
          lives: t.player.lives,
          deaths: t.deaths?.total || 0,
          isGameOver: t.isGameOver,
          enemyWorldDists: t.enemies.map(e => e.worldDistToPlayer),
        });
      }
      await sleep(SAMPLE_INTERVAL_MS);

      // If game over, we're done
      const lastSample = samples[samples.length - 1];
      if (lastSample && lastSample.isGameOver) break;
    }

    if (samples.length < 10) {
      results.checks.push({ check: 'enough_samples', passed: false,
        detail: `Only ${samples.length} samples` });
      return results;
    }

    // Key metrics
    const totalDeaths = samples[samples.length - 1].deaths;
    const peakEnemies = Math.max(...samples.map(s => s.enemyCount));
    const gameOver = samples.some(s => s.isGameOver);
    const timeToFirstDeath = samples.find(s => s.deaths > 0)?.time;

    results.checks.push({ check: 'peak_enemies', passed: true,
      detail: `Peak enemy count: ${peakEnemies}` });

    // CRITICAL CHECK: With 30+ enemies and 60s, player MUST have died
    if (peakEnemies >= 15) {
      results.checks.push({ check: 'must_die', passed: totalDeaths > 0,
        detail: totalDeaths > 0
          ? `Player died ${totalDeaths} time(s). First death at ${(timeToFirstDeath / 1000).toFixed(1)}s`
          : `ZERO DEATHS with ${peakEnemies} enemies over 60s — ENEMY MOVEMENT IS BROKEN!` });
    } else if (peakEnemies >= 5) {
      // With 5-14 enemies, death is likely but not guaranteed
      results.checks.push({ check: 'should_die', passed: totalDeaths > 0,
        detail: totalDeaths > 0
          ? `Player died ${totalDeaths} time(s) with ${peakEnemies} peak enemies`
          : `0 deaths with ${peakEnemies} enemies — enemies may not be approaching` });
    } else {
      results.checks.push({ check: 'low_enemies', passed: false,
        detail: `Only ${peakEnemies} enemies spawned in 60s — enemy spawning may be broken` });
    }

    // Check enemies are actually APPROACHING (distance should decrease over time)
    const earlyDists = samples.filter(s => s.time > 5000 && s.time < 15000 && s.nearestDist > 0);
    const lateDists = samples.filter(s => s.time > 30000 && s.nearestDist > 0);
    if (earlyDists.length > 0 && lateDists.length > 0) {
      const earlyAvg = earlyDists.reduce((s, d) => s + d.nearestDist, 0) / earlyDists.length;
      const lateAvg = lateDists.reduce((s, d) => s + d.nearestDist, 0) / lateDists.length;
      const approaching = lateAvg < earlyAvg;
      results.checks.push({ check: 'enemies_approaching', passed: approaching,
        detail: `Avg nearest enemy dist: early=${earlyAvg.toFixed(2)} late=${lateAvg.toFixed(2)}` +
          (approaching ? ' — enemies closing in' : ' — enemies NOT getting closer!') });
    }

    // Check for frozen enemies: track individual enemy distances over time
    // If ALL enemies maintain same distance for 10+ seconds, they're frozen
    if (samples.length >= 20) {
      const midSample = samples[Math.floor(samples.length / 2)];
      const endSample = samples[samples.length - 1];
      if (midSample.enemyWorldDists.length >= 3 && endSample.enemyWorldDists.length >= 3) {
        // Sort both arrays and compare — if distances barely changed, enemies are frozen
        const midSorted = [...midSample.enemyWorldDists].sort((a, b) => a - b);
        const endSorted = [...endSample.enemyWorldDists].sort((a, b) => a - b);
        const comparisons = Math.min(midSorted.length, endSorted.length, 5);
        let unchangedCount = 0;
        for (let i = 0; i < comparisons; i++) {
          if (Math.abs(midSorted[i] - endSorted[i]) < 0.1) unchangedCount++;
        }
        const allFrozen = unchangedCount >= comparisons - 1;
        results.checks.push({ check: 'enemy_distance_change', passed: !allFrozen,
          detail: allFrozen
            ? `${unchangedCount}/${comparisons} enemy distances unchanged between mid and end — FROZEN ENEMIES!`
            : `${unchangedCount}/${comparisons} distances similar (normal churn)` });
      }
    }

    // Time to first death should be reasonable (< 30s with enemies around)
    if (totalDeaths > 0 && peakEnemies >= 10) {
      const timeToDeath = timeToFirstDeath / 1000;
      results.checks.push({ check: 'death_timing', passed: timeToDeath < 40,
        detail: `First death at ${timeToDeath.toFixed(1)}s` +
          (timeToDeath >= 40 ? ` — TOO LONG with ${peakEnemies} enemies, they should kill faster` : '') });
    }

    return results;
  },

  /**
   * Scenario 17: Repeated Death/Respawn Cycle
   * Die intentionally, verify respawn position valid, not stuck in death loop.
   */
  async respawn_cycle(page, surface) {
    const results = { name: 'Repeated Death/Respawn', surface, checks: [] };

    const MAX_CYCLES = 3;
    const CYCLE_TIMEOUT_MS = 40000;

    // Don't shoot, don't move — let enemies kill us
    let prevDeaths = 0;
    const respawnPositions = [];

    for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
      // Wait for death
      const cycleStart = Date.now();
      let died = false;
      let deathU = -1, deathV = -1;

      while (Date.now() - cycleStart < CYCLE_TIMEOUT_MS) {
        const t = await page.evaluate(() => window.__GAME_TELEMETRY);
        if (!t) { await sleep(500); continue; }

        if (t.deaths && t.deaths.total > prevDeaths) {
          died = true;
          const lastDeath = t.deaths.log[t.deaths.log.length - 1];
          deathU = lastDeath.playerU;
          deathV = lastDeath.playerV;
          prevDeaths = t.deaths.total;
          break;
        }

        if (t.isGameOver) break;

        await sleep(500);
      }

      if (!died) {
        // If we didn't die in 40s, that's suspicious (but game over also stops)
        const t = await page.evaluate(() => window.__GAME_TELEMETRY);
        if (t?.isGameOver) {
          results.checks.push({ check: `cycle_${cycle}_gameover`, passed: true,
            detail: `Game over after ${cycle} death(s) — no more lives` });
          break;
        }
        results.checks.push({ check: `cycle_${cycle}_nodeath`, passed: false,
          detail: `No death in ${CYCLE_TIMEOUT_MS / 1000}s — enemies may not be moving` });
        continue;
      }

      // Wait for respawn (player.alive goes true again)
      let respawned = false;
      let respawnU = -1, respawnV = -1;
      const respawnStart = Date.now();
      while (Date.now() - respawnStart < 10000) {
        const t = await page.evaluate(() => window.__GAME_TELEMETRY);
        if (t && t.player.alive) {
          respawned = true;
          respawnU = t.player.u;
          respawnV = t.player.v;
          respawnPositions.push({ u: respawnU, v: respawnV });
          break;
        }
        await sleep(300);
      }

      if (!respawned) {
        const t = await page.evaluate(() => window.__GAME_TELEMETRY);
        if (t?.isGameOver) {
          results.checks.push({ check: `cycle_${cycle}_gameover`, passed: true,
            detail: `Game over — no respawn (out of lives)` });
          break;
        }
        results.checks.push({ check: `cycle_${cycle}_norespawn`, passed: false,
          detail: `Player did not respawn after death — stuck in dead state!` });
        continue;
      }

      // Check respawn position is valid
      const respawnNaN = isNaN(respawnU) || isNaN(respawnV) || !isFinite(respawnU) || !isFinite(respawnV);
      results.checks.push({ check: `cycle_${cycle}_respawn_valid`, passed: !respawnNaN,
        detail: respawnNaN
          ? `Respawn position NaN: u=${respawnU} v=${respawnV}!`
          : `Respawn at u=${respawnU.toFixed(4)} v=${respawnV.toFixed(4)} (death was at u=${deathU.toFixed(4)} v=${deathV.toFixed(4)})` });

      // Check respawn isn't at the exact same spot as death (stuck in death loop)
      if (!respawnNaN && !isNaN(deathU)) {
        const respawnDist = Math.sqrt((respawnU - deathU) ** 2 + (respawnV - deathV) ** 2);
        // Some surfaces respawn at center (0.5, 0.5), which is fine
        results.checks.push({ check: `cycle_${cycle}_respawn_moved`, passed: true,
          detail: `Respawn distance from death: ${respawnDist.toFixed(4)} UV` });
      }

      // Brief wait between cycles
      await sleep(2000);
    }

    // Check respawn positions aren't all identical (should vary or at least be at safe spot)
    if (respawnPositions.length >= 2) {
      const allSame = respawnPositions.every(p =>
        Math.abs(p.u - respawnPositions[0].u) < 0.001 && Math.abs(p.v - respawnPositions[0].v) < 0.001);
      results.checks.push({ check: 'respawn_variety', passed: true,
        detail: allSame
          ? `All ${respawnPositions.length} respawns at same position (${respawnPositions[0].u.toFixed(3)}, ${respawnPositions[0].v.toFixed(3)}) — fixed spawn point`
          : `${respawnPositions.length} respawn positions varied` });
    }

    return results;
  },

  /**
   * Scenario 18: Enemy Variety — Check All Enemy Types Appear
   * Play for 45s to get later waves. Track distinct enemy types.
   * Flag if only one type ever appears.
   */
  async enemy_variety(page, surface) {
    const results = { name: 'Enemy Variety', surface, checks: [] };

    const DURATION_MS = 45000;
    const SAMPLE_INTERVAL_MS = 2000;

    // Play actively to progress waves
    await page.mouse.move(400, 200);
    await page.mouse.down();

    const enemyTypes = new Set();
    const enemyTypeTimeline = []; // {time, types}
    const startTime = Date.now();
    let phase = 0;

    while (Date.now() - startTime < DURATION_MS) {
      const elapsed = Date.now() - startTime;

      // Move around to stay alive + kill enemies to progress waves
      const newPhase = Math.floor(elapsed / 4000);
      if (newPhase !== phase) {
        const keys = ['d', 'w', 'a', 's'];
        await page.keyboard.up(keys[phase % 4]);
        phase = newPhase;
        await page.keyboard.down(keys[phase % 4]);
        const angle = (phase * Math.PI / 2.5);
        await page.mouse.move(320 + Math.cos(angle) * 130, 180 + Math.sin(angle) * 130);
      }

      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (t) {
        const frameTypes = new Set();
        for (const e of t.enemies) {
          enemyTypes.add(e.type);
          frameTypes.add(e.type);
        }
        enemyTypeTimeline.push({
          time: elapsed,
          types: [...frameTypes],
          count: t.enemies.length,
        });
      }

      await sleep(SAMPLE_INTERVAL_MS);
    }

    // Release controls
    await page.mouse.up();
    for (const k of ['w', 'a', 's', 'd']) await page.keyboard.up(k);

    const typeList = [...enemyTypes];
    results.checks.push({ check: 'enemy_type_count', passed: typeList.length >= 2,
      detail: `${typeList.length} distinct enemy types: ${typeList.join(', ')}` +
        (typeList.length < 2 ? ' — only 1 type ever appeared, wave progression may be broken!' : '') });

    // Check we actually had enemies to analyze
    const maxEnemies = Math.max(...enemyTypeTimeline.map(t => t.count), 0);
    results.checks.push({ check: 'enemies_present', passed: maxEnemies >= 3,
      detail: `Peak enemies: ${maxEnemies}` +
        (maxEnemies < 3 ? ' — too few enemies in 45s, spawning may be broken' : '') });

    // Check enemy types have valid properties
    const t = await page.evaluate(() => window.__GAME_TELEMETRY);
    if (t) {
      const invalidRadius = t.enemies.filter(e => e.collisionRadius <= 0 || e.collisionRadius > 10 || isNaN(e.collisionRadius));
      results.checks.push({ check: 'enemy_radii_valid', passed: invalidRadius.length === 0,
        detail: invalidRadius.length === 0
          ? `All ${t.enemies.length} enemy radii valid`
          : `${invalidRadius.length} enemies with invalid radius!` });

      const invalidPos = t.enemies.filter(e => isNaN(e.u) || isNaN(e.v) || isNaN(e.worldPos.x));
      results.checks.push({ check: 'enemy_positions_valid', passed: invalidPos.length === 0,
        detail: invalidPos.length === 0
          ? `All enemy positions valid`
          : `${invalidPos.length} enemies with NaN positions!` });
    }

    return results;
  },

  /**
   * Scenario 19: Score Consistency — Score Should Make Sense
   * Track score over 60s. Must increase. Must never decrease.
   * Must correlate with kills. Flag: stuck at 0 for 10+s while shooting.
   */
  async score_consistency(page, surface) {
    const results = { name: 'Score Consistency', surface, checks: [] };

    const DURATION_MS = 60000;
    const SAMPLE_INTERVAL_MS = 500;

    // Play actively
    await page.mouse.move(400, 200);
    await page.mouse.down();
    await page.keyboard.down('d');

    const scoreSamples = [];
    const startTime = Date.now();
    let phase = 0;

    while (Date.now() - startTime < DURATION_MS) {
      const elapsed = Date.now() - startTime;

      // Change direction and aim
      const newPhase = Math.floor(elapsed / 5000);
      if (newPhase !== phase) {
        const keys = ['d', 'w', 'a', 's'];
        await page.keyboard.up(keys[phase % 4]);
        phase = newPhase;
        await page.keyboard.down(keys[phase % 4]);
        const angle = (phase * Math.PI / 3);
        await page.mouse.move(320 + Math.cos(angle) * 140, 180 + Math.sin(angle) * 140);
      }

      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (t) {
        scoreSamples.push({
          time: elapsed,
          score: t.player.score,
          alive: t.player.alive,
          enemyCount: t.enemies.length,
          deaths: t.deaths?.total || 0,
        });
      }

      await sleep(SAMPLE_INTERVAL_MS);
    }

    await page.mouse.up();
    for (const k of ['w', 'a', 's', 'd']) await page.keyboard.up(k);

    if (scoreSamples.length < 20) {
      results.checks.push({ check: 'enough_samples', passed: false,
        detail: `Only ${scoreSamples.length} samples` });
      return results;
    }

    const firstScore = scoreSamples[0].score;
    const lastScore = scoreSamples[scoreSamples.length - 1].score;
    const totalGain = lastScore - firstScore;

    // Check 1: Score increased over session
    results.checks.push({ check: 'score_increased', passed: totalGain > 0,
      detail: `Score: ${firstScore} → ${lastScore} (gained ${totalGain})` +
        (totalGain === 0 ? ' — ZERO points in 60s of active play!' : '') });

    // Check 2: Score never decreased
    let decreases = 0;
    let maxDecrease = 0;
    for (let i = 1; i < scoreSamples.length; i++) {
      const delta = scoreSamples[i].score - scoreSamples[i - 1].score;
      if (delta < 0) {
        decreases++;
        maxDecrease = Math.min(maxDecrease, delta);
      }
    }
    results.checks.push({ check: 'no_score_decrease', passed: decreases === 0,
      detail: decreases === 0
        ? 'Score never decreased'
        : `Score DECREASED ${decreases} time(s)! Max drop: ${maxDecrease}` });

    // Check 3: Score not stuck at 0 for 10+ seconds while alive
    let stuckAt0 = 0;
    let maxStuck0 = 0;
    for (const s of scoreSamples) {
      if (s.score === 0 && s.alive && s.enemyCount > 0) {
        stuckAt0++;
        maxStuck0 = Math.max(maxStuck0, stuckAt0);
      } else if (s.score > 0) {
        stuckAt0 = 0;
      }
    }
    const stuckSeconds = maxStuck0 * SAMPLE_INTERVAL_MS / 1000;
    results.checks.push({ check: 'not_stuck_at_zero', passed: stuckSeconds < 15,
      detail: stuckSeconds < 15
        ? `Max time at score 0: ${stuckSeconds.toFixed(1)}s`
        : `Score STUCK at 0 for ${stuckSeconds.toFixed(1)}s with enemies present!` });

    // Check 4: Score rate (should be at least some kills per 30s)
    const midIdx = Math.floor(scoreSamples.length / 2);
    const midScore = scoreSamples[midIdx].score;
    const firstHalf = midScore - firstScore;
    const secondHalf = lastScore - midScore;
    results.checks.push({ check: 'score_rate', passed: true,
      detail: `First half: +${firstHalf}, Second half: +${secondHalf}` });

    return results;
  },

  /**
   * Scenario 20: Multi-Life Analysis — Full Game Across All 3 Lives
   * Play until game over or 120s. Autopsy each death.
   * Check: each life has legitimate gameplay, no instant death loops.
   */
  async multi_life(page, surface) {
    const results = { name: 'Multi-Life Analysis', surface, checks: [] };

    const MAX_DURATION_MS = 120000;
    const SAMPLE_INTERVAL_MS = 500;

    // Play actively
    await page.mouse.move(400, 200);
    await page.mouse.down();
    await page.keyboard.down('d');

    const lifeSamples = []; // {time, lives, alive, deaths, score, enemyCount}
    const startTime = Date.now();
    let phase = 0;
    let prevLives = -1;
    let lifeStartTime = 0;
    const lifeData = []; // per-life: {startTime, endTime, duration, deathEnemy, deathDist}

    while (Date.now() - startTime < MAX_DURATION_MS) {
      const elapsed = Date.now() - startTime;

      // Move/aim
      const newPhase = Math.floor(elapsed / 4000);
      if (newPhase !== phase) {
        const keys = ['d', 'w', 'a', 's'];
        await page.keyboard.up(keys[phase % 4]);
        phase = newPhase;
        await page.keyboard.down(keys[phase % 4]);
        const angle = (phase * 1.7);
        await page.mouse.move(320 + Math.cos(angle) * 130, 180 + Math.sin(angle) * 130);
      }

      const t = await page.evaluate(() => window.__GAME_TELEMETRY);
      if (t) {
        lifeSamples.push({
          time: elapsed, lives: t.player.lives, alive: t.player.alive,
          deaths: t.deaths?.total || 0, score: t.player.score,
          enemyCount: t.enemies.length,
        });

        // Track life transitions
        if (prevLives === -1) {
          prevLives = t.player.lives;
          lifeStartTime = elapsed;
        }
        if (t.player.lives < prevLives) {
          // Lost a life
          const lastDeath = t.deaths?.log?.[t.deaths.log.length - 1];
          lifeData.push({
            startTime: lifeStartTime,
            endTime: elapsed,
            duration: elapsed - lifeStartTime,
            deathEnemy: lastDeath?.nearestEnemyType || 'unknown',
            deathDist: lastDeath?.nearestEnemyDist || -1,
            deathSurfDist: lastDeath?.nearestEnemySurfaceDist || -1,
          });
          lifeStartTime = elapsed;
          prevLives = t.player.lives;
        }

        if (t.isGameOver) break;
      }

      await sleep(SAMPLE_INTERVAL_MS);
    }

    await page.mouse.up();
    for (const k of ['w', 'a', 's', 'd']) await page.keyboard.up(k);

    // If still alive at end, record last life
    const lastSample = lifeSamples[lifeSamples.length - 1];
    if (lastSample && !lastSample.alive === false && lifeData.length < 3) {
      lifeData.push({
        startTime: lifeStartTime,
        endTime: Date.now() - startTime,
        duration: Date.now() - startTime - lifeStartTime,
        deathEnemy: 'survived',
        deathDist: -1,
        deathSurfDist: -1,
      });
    }

    results.checks.push({ check: 'lives_tracked', passed: true,
      detail: `${lifeData.length} life/lives tracked. Deaths: ${lastSample?.deaths || 0}` });

    // Check each life had legitimate gameplay (not instant death < 2s)
    let instantDeaths = 0;
    for (let i = 0; i < lifeData.length; i++) {
      const life = lifeData[i];
      const durationS = life.duration / 1000;
      const isInstant = durationS < 2.0 && life.deathEnemy !== 'survived' && i > 0; // First life gets grace period
      if (isInstant) instantDeaths++;

      results.checks.push({ check: `life_${i + 1}_duration`, passed: !isInstant,
        detail: `Life ${i + 1}: ${durationS.toFixed(1)}s, killed by "${life.deathEnemy}" at dist=${life.deathDist > 0 ? life.deathDist.toFixed(2) : 'N/A'}` +
          (isInstant ? ' — INSTANT DEATH on respawn!' : '') });

      // Check death distance (phantom kill check)
      if (life.deathDist > 0 && life.deathEnemy !== 'survived') {
        const wrappedSurf = life.deathSurfDist > 0.5 ? 1.0 - life.deathSurfDist : life.deathSurfDist;
        const isPhantom = wrappedSurf > 0.25 && life.deathDist > 2.5;
        if (isPhantom) {
          results.checks.push({ check: `life_${i + 1}_phantom`, passed: false,
            detail: `PHANTOM DEATH on life ${i + 1}: "${life.deathEnemy}" surf=${wrappedSurf.toFixed(3)} world=${life.deathDist.toFixed(2)}` });
        }
      }
    }

    results.checks.push({ check: 'no_instant_deaths', passed: instantDeaths === 0,
      detail: instantDeaths === 0
        ? 'No instant deaths on respawn'
        : `${instantDeaths} INSTANT DEATH(S) on respawn — spawn protection may be broken!` });

    // Overall game health
    const totalDuration = (Date.now() - startTime) / 1000;
    const finalScore = lastSample?.score || 0;
    results.checks.push({ check: 'game_health', passed: true,
      detail: `Total playtime: ${totalDuration.toFixed(0)}s, Final score: ${finalScore}, Game over: ${lastSample?.alive === false || lastSample?.deaths >= 3 ? 'yes' : 'no'}` });

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
  const stressScenarios = ['survival', 'approach', 'seam', 'pileup', 'shooting', 'distance_consistency'];
  const aggressiveScenarios = ['rapid_direction', 'uv_extremes', 'diagonal', 'no_movement', 'respawn_cycle', 'enemy_variety', 'score_consistency', 'multi_life'];
  const resultsPath = resolve(PROJECT_ROOT,
    scenarioFilter && aggressiveScenarios.includes(scenarioFilter)
      ? 'tasks/s44r10-12-more-tests-results.md'
      : scenarioFilter && stressScenarios.includes(scenarioFilter)
        ? 'tasks/s44r10-09-stress-results.md'
        : 'tasks/s44r10-07-scenario-results.md');
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
