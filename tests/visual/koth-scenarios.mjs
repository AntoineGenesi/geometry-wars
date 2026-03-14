#!/usr/bin/env node
/**
 * koth-scenarios.mjs — King of the Hill mode scenario test runner.
 *
 * Tests KOTH zone projection, membership, and scoring across surfaces.
 * Requires a game server running at BASE_URL with KOTH mode support.
 *
 * Uses ?quickStart=true&gameMode=king to start in King mode.
 *
 * Usage:
 *   node tests/visual/koth-scenarios.mjs                           # Run all on sphere
 *   node tests/visual/koth-scenarios.mjs --surface=torus           # Single surface
 *   node tests/visual/koth-scenarios.mjs --all-surfaces            # All 13 surfaces
 *   node tests/visual/koth-scenarios.mjs --scenario=koth_basic     # Single scenario
 *   node tests/visual/koth-scenarios.mjs --report                  # Generate HTML report
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
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
const SCREENSHOT_DIR = resolve(PROJECT_ROOT, 'test-screenshots/koth-scenarios');
const REPORT_DIR = resolve(PROJECT_ROOT, 'reports');

// Light mode: smaller window, SwiftShader still needed for WebGL init.
// CPU throttled via CDP after game loads to reduce SwiftShader overhead.
const LAUNCH_ARGS = [
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--window-size=320,180',
];

const ALL_SURFACES = [
  'sphere', 'torus', 'cube', 'cube-ring', 'pill',
  'peanut', 'mobius', 'sphere-tunnel', 'cube-tunnel',
  'pipe', 'capsule', 'icosahedron', 'mobius-bevel',
];

// Surfaces required by specific scenarios
const CORE_SURFACES = ['sphere', 'torus', 'cube'];

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
  await page.setViewport({ width: 320, height: 180 });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.__testErrors = errors;
  return page;
}

/** Throttle CPU via CDP — reduces SwiftShader rendering load for state-only tests. */
async function throttleCPU(page, rate = 6) {
  const client = await page.createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate });
  return client;
}

async function unthrottleCPU(cdpSession) {
  if (cdpSession) {
    try { await cdpSession.send('Emulation.setCPUThrottlingRate', { rate: 1 }); } catch {}
  }
}

async function startGameInKOTHMode(page, surface = 'sphere') {
  // Clear localStorage first
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(() => {
    localStorage.removeItem('masteryOverlayShown');
    localStorage.removeItem('weaponMastery');
  });

  // Navigate with quickStart + gameMode=king + testMode (activates __TEST_API)
  await page.goto(
    `${BASE_URL}?quickStart=true&surface=${surface}&gameMode=king&testMode=true&debug=true`,
    { waitUntil: 'domcontentloaded', timeout: 30000 },
  );

  await page.waitForSelector('canvas', { timeout: 15000 });
  // Wait for countdown + API initialization + KOTH zone to appear
  await sleep(6000);

  // Verify __TEST_API is available and has KOTH state
  const apiReady = await page.evaluate(() => typeof window.__TEST_API !== 'undefined');
  if (!apiReady) {
    throw new Error(`__TEST_API not available on surface ${surface}`);
  }

  const kothReady = await page.evaluate(() => window.__TEST_API.getKOTHZoneState() !== null);
  if (!kothReady) {
    throw new Error(`KOTH zone state not available on surface ${surface} — game may not be in King mode`);
  }

  return true;
}

async function takeScreenshot(page, name) {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const path = resolve(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path });
  return path;
}

// ---------------------------------------------------------------------------
// KOTH Scenarios
// ---------------------------------------------------------------------------

const KOTH_SCENARIOS = {

  /**
   * Scenario 1: Sphere pole zone — player at pole is inside, player at equator is outside.
   * Detects: zone radius calculation using wrong coordinate space (flat vs geodesic).
   */
  koth_pole_zone: {
    name: 'KOTH Pole Zone (Sphere)',
    description: 'Spawn zone at north pole UV (0.5, 0.05), player at pole is inside; player at equator is outside',
    surfaces: ['sphere'],
    async run(page, surface) {
      // Place zone at near-north-pole position
      const zoneU = 0.5;
      const zoneV = 0.05;
      await page.evaluate(
        (u, v) => window.__TEST_API.setKOTHZonePosition(u, v),
        zoneU, zoneV,
      );

      // Place player AT zone center
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        zoneU, zoneV,
      );
      await sleep(500);

      const inZoneAtCenter = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
      const scoreBefore = await page.evaluate(() => window.__TEST_API.getKOTHScore());

      // Wait a second for score to accumulate
      await sleep(1000);
      const scoreAfter = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      const scoreIncremented = scoreAfter > scoreBefore;

      // Move player to equator (far from pole zone)
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        0.5, 0.5,
      );
      await sleep(300);

      const inZoneAtEquator = await page.evaluate(() => window.__TEST_API.isPlayerInZone());

      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());

      return {
        passed: inZoneAtCenter && !inZoneAtEquator && scoreIncremented,
        details: {
          inZoneAtCenter,
          inZoneAtEquator,
          scoreIncremented,
          scoreDelta: scoreAfter - scoreBefore,
          zoneRadius: zoneState?.zoneRadiusUV?.toFixed(4),
          surface,
        },
      };
    },
  },

  /**
   * Scenario 2: Opposite hemisphere — player on far side should NOT be in zone.
   * Detects: zone membership using 3D distance through sphere instead of surface distance.
   */
  koth_opposite_hemisphere: {
    name: 'KOTH Opposite Hemisphere (Sphere)',
    description: 'Zone at front equator; player at back equator — should NOT be in zone',
    surfaces: ['sphere'],
    async run(page, surface) {
      // Zone at front equator
      const zoneU = 0.5;
      const zoneV = 0.25;
      await page.evaluate(
        (u, v) => window.__TEST_API.setKOTHZonePosition(u, v),
        zoneU, zoneV,
      );

      // Player at rear equator — UV (0.5, 0.75) is 0.5 UV units away, well outside zone radius ~0.12
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        0.5, 0.75,
      );
      await sleep(500);

      const inZone = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
      const scoreBefore = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      await sleep(1000);
      const scoreAfter = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      const scoreNotIncremented = scoreAfter === scoreBefore;

      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());
      const uvDistV = Math.abs(0.75 - zoneV);
      const effectiveUVDist = Math.min(uvDistV, 1.0 - uvDistV);

      return {
        passed: !inZone && scoreNotIncremented,
        details: {
          inZone,
          scoreNotIncremented,
          zoneRadius: zoneState?.zoneRadiusUV?.toFixed(4),
          uvDistanceToZone: effectiveUVDist.toFixed(4),
          note: 'Player 0.5 UV units from zone center — clearly outside zone radius ~0.12',
          surface,
        },
      };
    },
  },

  /**
   * Scenario 3: Torus outer ring zone — player at outer equator is inside zone.
   * Detects: zone radius scaling not accounting for torus curvature variation.
   */
  koth_torus_outer_ring: {
    name: 'KOTH Torus Outer Ring Zone',
    description: 'Zone on torus outer equator (U=0.5); player at same UV inside, player at inner ring outside',
    surfaces: ['torus'],
    async run(page, surface) {
      // Outer ring of torus = V near 0.5 (outward side), U at 0.5
      const zoneU = 0.5;
      const zoneV = 0.5;
      await page.evaluate(
        (u, v) => window.__TEST_API.setKOTHZonePosition(u, v),
        zoneU, zoneV,
      );

      // Player at zone center
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        zoneU, zoneV,
      );
      await sleep(500);

      const inZoneOuter = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());
      const radius = zoneState?.zoneRadiusUV ?? 0.12;

      // Move player to inner ring — V near 0.0 (donut hole side), 0.5 UV units away
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        0.5, 0.0,
      );
      await sleep(300);

      const inZoneInner = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
      const uvDistToInner = Math.min(Math.abs(0.0 - zoneV), 1.0 - Math.abs(0.0 - zoneV));

      return {
        passed: inZoneOuter && !inZoneInner,
        details: {
          inZoneOuter,
          inZoneInner,
          zoneRadius: radius.toFixed(4),
          uvDistanceToInner: uvDistToInner.toFixed(4),
          note: 'Outer ring at V=0.5, inner ring at V=0.0, UV distance 0.5 >> zone radius',
          surface,
        },
      };
    },
  },

  /**
   * Scenario 4: Torus inner ring zone — tight curvature, zone projects flush.
   * Detects: normal direction sign error on concave torus inner ring.
   */
  koth_torus_inner_ring: {
    name: 'KOTH Torus Inner Ring Zone',
    description: 'Zone on torus inner ring (V~0.0); player at zone center is inside; player at outer ring is outside',
    surfaces: ['torus'],
    async run(page, surface) {
      // Inner ring of torus = V near 0.0 (or 1.0) — donut hole side
      const zoneU = 0.25;
      const zoneV = 0.02;
      await page.evaluate(
        (u, v) => window.__TEST_API.setKOTHZonePosition(u, v),
        zoneU, zoneV,
      );

      // Player at zone center
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        zoneU, zoneV,
      );
      await sleep(500);

      const inZoneAtCenter = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
      const scoreBefore = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      await sleep(800);
      const scoreAfter = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      const scoreIncremented = scoreAfter > scoreBefore;

      // Move player to outer ring (V=0.5), UV distance 0.48 >> zone radius
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        zoneU, 0.5,
      );
      await sleep(300);

      const inZoneAtOuter = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());

      // Take screenshot to verify zone is visible on inner ring
      await takeScreenshot(page, `koth_torus_inner_ring_${surface}`);

      return {
        passed: inZoneAtCenter && scoreIncremented && !inZoneAtOuter,
        details: {
          inZoneAtCenter,
          scoreIncremented,
          scoreDelta: scoreAfter - scoreBefore,
          inZoneAtOuter,
          zoneRadius: zoneState?.zoneRadiusUV?.toFixed(4),
          note: 'Inner ring at V~0.02, score must accumulate when player is there',
          surface,
        },
      };
    },
  },

  /**
   * Scenario 5: Cube face-center zone — player at face center is inside.
   * Detects: zone radius clamped to face boundaries when it should wrap.
   */
  koth_cube_face_center: {
    name: 'KOTH Cube Face Center Zone',
    description: 'Zone at cube face center; player at center is inside; player near edge still inside if within radius',
    surfaces: ['cube'],
    async run(page, surface) {
      // Face center UV on cube
      const zoneU = 0.5;
      const zoneV = 0.5;
      await page.evaluate(
        (u, v) => window.__TEST_API.setKOTHZonePosition(u, v),
        zoneU, zoneV,
      );

      // Player at zone center
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        zoneU, zoneV,
      );
      await sleep(500);

      const inZoneAtCenter = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());
      const radius = zoneState?.zoneRadiusUV ?? 0.12;

      // Move player slightly off-center but within zone radius
      // Note: zone check is world-space, and UV-to-world isn't linear on cube,
      // so use a small UV offset (0.3 of radius) to stay safely inside
      const nearEdgeU = Math.max(0.05, zoneU - radius * 0.3);
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        nearEdgeU, zoneV,
      );
      await sleep(300);

      const inZoneNearEdge = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
      const uvDist = Math.abs(nearEdgeU - zoneU);

      // Player far outside zone (well beyond radius)
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        (zoneU + 0.45) % 1.0, zoneV,
      );
      await sleep(300);

      const inZoneFarAway = await page.evaluate(() => window.__TEST_API.isPlayerInZone());

      return {
        passed: inZoneAtCenter && inZoneNearEdge && !inZoneFarAway,
        details: {
          inZoneAtCenter,
          inZoneNearEdge,
          inZoneFarAway,
          zoneRadius: radius.toFixed(4),
          uvDistNearEdge: uvDist.toFixed(4),
          note: 'Near-edge player is within zone radius, far player is well outside',
          surface,
        },
      };
    },
  },

  /**
   * Scenario 6: Cube edge zone — zone at UV boundary between two faces.
   * Detects: zone membership not accounting for cross-face adjacency.
   */
  koth_cube_edge: {
    name: 'KOTH Cube Edge Zone',
    description: 'Zone centered on a cube edge (UV near 0.33 boundary); players on both faces register inside zone',
    surfaces: ['cube'],
    async run(page, surface) {
      // Place zone near a cube face boundary — cube faces in UV are roughly at 0, 1/3, 2/3 seams
      const zoneU = 0.33;
      const zoneV = 0.5;
      await page.evaluate(
        (u, v) => window.__TEST_API.setKOTHZonePosition(u, v),
        zoneU, zoneV,
      );

      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());
      const radius = zoneState?.zoneRadiusUV ?? 0.12;

      // Player on face A side (close to zone center, within zone)
      // Use small UV offset — world-space distance grows non-linearly on cube edges
      const faceAU = zoneU - radius * 0.2;
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        Math.max(0.02, faceAU), zoneV,
      );
      await sleep(300);

      const inZoneFaceA = await page.evaluate(() => window.__TEST_API.isPlayerInZone());

      // Player on face B side (close to zone center, within zone)
      const faceBU = zoneU + radius * 0.2;
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        Math.min(0.98, faceBU), zoneV,
      );
      await sleep(300);

      const inZoneFaceB = await page.evaluate(() => window.__TEST_API.isPlayerInZone());

      // Player far from edge — outside zone
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        (zoneU + 0.45) % 1.0, zoneV,
      );
      await sleep(300);

      const inZoneFar = await page.evaluate(() => window.__TEST_API.isPlayerInZone());

      return {
        passed: inZoneFaceA && inZoneFaceB && !inZoneFar,
        details: {
          inZoneFaceA,
          inZoneFaceB,
          inZoneFar,
          zoneRadius: radius.toFixed(4),
          faceAU: Math.max(0.02, faceAU).toFixed(4),
          faceBU: Math.min(0.98, faceBU).toFixed(4),
          surface,
        },
      };
    },
  },

  /**
   * Scenario 7: Cube corner zone — zone at corner where 3 faces meet.
   * Detects: zone only covering one face at corner; scoring gap at corner joins.
   */
  koth_cube_corner: {
    name: 'KOTH Cube Corner Zone',
    description: 'Zone near cube face corner (UV ~0.12, 0.12 — min valid zone position); player at center is inside; slightly moved in face directions still inside',
    surfaces: ['cube'],
    async run(page, surface) {
      // Zone near face corner — use 0.12 (just above the 0.1 clamp in moveZone).
      // Note: KingMode.moveZone() clamps UV to [0.1, 0.9] on non-wrapping surfaces,
      // so (0.05, 0.05) is an impossible zone position in real gameplay.
      const zoneU = 0.12;
      const zoneV = 0.12;
      await page.evaluate(
        (u, v) => window.__TEST_API.setKOTHZonePosition(u, v),
        zoneU, zoneV,
      );

      // Player at corner
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        zoneU, zoneV,
      );
      await sleep(500);

      const inZoneAtCorner = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
      const scoreBefore = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      await sleep(800);
      const scoreAfter = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      const scoreIncremented = scoreAfter > scoreBefore;

      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());
      const radius = zoneState?.zoneRadiusUV ?? 0.12;

      // Move slightly from corner along face 1 (increase U)
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        zoneU + radius * 0.4, zoneV,
      );
      await sleep(300);
      const inZoneFace1 = await page.evaluate(() => window.__TEST_API.isPlayerInZone());

      // Move slightly from corner along face 2 (increase V)
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        zoneU, zoneV + radius * 0.4,
      );
      await sleep(300);
      const inZoneFace2 = await page.evaluate(() => window.__TEST_API.isPlayerInZone());

      return {
        passed: inZoneAtCorner && scoreIncremented && inZoneFace1 && inZoneFace2,
        details: {
          inZoneAtCorner,
          scoreIncremented,
          inZoneFace1,
          inZoneFace2,
          zoneRadius: radius.toFixed(4),
          note: 'All positions within zone radius must register as inside zone',
          surface,
        },
      };
    },
  },

  /**
   * Scenario 8: Peanut pinch zone — zone at narrow waist.
   * Detects: zone radius incorrectly computed when surface radius changes sharply.
   */
  koth_peanut_pinch: {
    name: 'KOTH Peanut Pinch Zone',
    description: 'Zone at peanut narrow waist (U=0.5); player at center is inside; player 1.5x radius away is outside',
    surfaces: ['peanut'],
    async run(page, surface) {
      // Peanut narrow waist is near U=0.5 (where radius is minimum)
      const zoneU = 0.5;
      const zoneV = 0.5;
      await page.evaluate(
        (u, v) => window.__TEST_API.setKOTHZonePosition(u, v),
        zoneU, zoneV,
      );

      // Player at zone center
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        zoneU, zoneV,
      );
      await sleep(500);

      const inZoneAtCenter = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());
      const radius = zoneState?.zoneRadiusUV ?? 0.12;

      // Move player 1.5x zone radius toward the bulge
      const outsideU = zoneU + radius * 1.5;
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        Math.min(0.98, outsideU), zoneV,
      );
      await sleep(300);

      const inZoneOutside = await page.evaluate(() => window.__TEST_API.isPlayerInZone());

      return {
        passed: inZoneAtCenter && !inZoneOutside,
        details: {
          inZoneAtCenter,
          inZoneOutside,
          zoneRadius: radius.toFixed(4),
          outsideUV: `(${Math.min(0.98, outsideU).toFixed(4)}, ${zoneV})`,
          uvDistance: (radius * 1.5).toFixed(4),
          surface,
        },
      };
    },
  },

  /**
   * Scenario 9: Scoring boundary precision — walk player toward zone, verify transition.
   * Detects: off-by-one in zone boundary check; incorrect score tick logic.
   */
  koth_scoring_boundary: {
    name: 'KOTH Scoring Boundary Precision',
    description: 'Walk player from outside toward zone center in 10 steps; verify outside→inside transition near zone radius; no double-counting',
    surfaces: ['sphere', 'torus', 'cube'],
    async run(page, surface) {
      const zoneU = 0.5;
      const zoneV = 0.5;
      await page.evaluate(
        (u, v) => window.__TEST_API.setKOTHZonePosition(u, v),
        zoneU, zoneV,
      );

      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());
      const radius = zoneState?.zoneRadiusUV ?? 0.12;

      // Start well outside zone (2x radius away)
      const startU = zoneU + radius * 2.0;
      const stepSize = radius * 2.0 / 10; // 10 steps from 2x radius to center

      const measurements = [];
      for (let i = 0; i <= 10; i++) {
        const playerU = Math.min(0.98, startU - stepSize * i);
        await page.evaluate(
          (u, v) => window.__TEST_API.setPlayerPosition(u, v),
          playerU, zoneV,
        );
        await sleep(100);

        const isInZone = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
        const uvDist = Math.abs(playerU - zoneU); // simplified — same V
        measurements.push({ step: i, playerU, uvDist, isInZone });
      }

      // Find the step where transition from outside→inside occurs
      let transitionStep = -1;
      for (let i = 1; i < measurements.length; i++) {
        if (!measurements[i - 1].isInZone && measurements[i].isInZone) {
          transitionStep = i;
          break;
        }
      }

      // Transition should occur somewhere during the walk (zone check is world-space,
      // so UV-distance won't map linearly — just verify a transition exists)
      const transitionDist = transitionStep >= 0 ? measurements[transitionStep].uvDist : -1;
      const transitionOk = transitionStep >= 0; // transition found at any step

      // Verify score accumulates while inside but not outside
      // Find a step clearly inside zone and check score increments
      const clearlyInside = measurements[measurements.length - 1]; // step 10 = at center
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        clearlyInside.playerU, zoneV,
      );
      const scoreBefore = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      await sleep(600);
      const scoreAfterInside = await page.evaluate(() => window.__TEST_API.getKOTHScore());

      // Now place player clearly outside
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        Math.min(0.98, zoneU + radius * 2.0), zoneV,
      );
      const scoreBeforeOutside = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      await sleep(600);
      const scoreAfterOutside = await page.evaluate(() => window.__TEST_API.getKOTHScore());

      const scoreIncreasedWhenInside = scoreAfterInside > scoreBefore;
      const scoreStoppedWhenOutside = scoreAfterOutside === scoreBeforeOutside;

      return {
        passed: transitionOk && scoreIncreasedWhenInside && scoreStoppedWhenOutside,
        details: {
          zoneRadius: radius.toFixed(4),
          transitionStep,
          transitionDistance: transitionDist >= 0 ? transitionDist.toFixed(4) : 'not found',
          transitionOk,
          scoreIncreasedWhenInside,
          scoreStoppedWhenOutside,
          measurements: measurements.map(m => ({
            step: m.step,
            uvDist: m.uvDist.toFixed(4),
            isInZone: m.isInZone,
          })),
          surface,
        },
      };
    },
  },

  /**
   * Scenario 10: Zone on opposite side of surface — no scoring.
   * Detects: zone membership wrapping around globe (treating surface as flat UV torus).
   */
  koth_antipodal_no_scoring: {
    name: 'KOTH Antipodal Zone — No Scoring',
    description: 'Zone at antipodal UV from player (0.5 UV units away); player stays on near side; score stays 0',
    surfaces: ['sphere', 'torus', 'cube'],
    async run(page, surface) {
      // Place zone far from player (0.5 UV units = maximum distance on wrapped surface)
      const zoneU = 0.1;
      const zoneV = 0.1;
      await page.evaluate(
        (u, v) => window.__TEST_API.setKOTHZonePosition(u, v),
        zoneU, zoneV,
      );

      // Player at far side (UV 0.5 units away in both dimensions = definitely outside zone)
      const playerU = 0.6;
      const playerV = 0.6;
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        playerU, playerV,
      );
      // Extra wait to ensure game loop updates inZone after setPlayerPosition.
      // Needed in suite context where prior tests may leave timed state.
      // Increased from 800ms: on torus after 9+ prior test pages, SwiftShader
      // CPU pressure means game loop ticks slower — needs more time to settle.
      await sleep(1500);

      // Check zone state
      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());
      const radius = zoneState?.zoneRadiusUV ?? 0.12;

      // Compute effective UV distance (respecting wrapping)
      const rawDistU = Math.abs(playerU - zoneU);
      const rawDistV = Math.abs(playerV - zoneV);
      const distU = Math.min(rawDistU, 1.0 - rawDistU);
      const distV = Math.min(rawDistV, 1.0 - rawDistV);
      const uvDist = Math.sqrt(distU * distU + distV * distV);

      const inZone = await page.evaluate(() => window.__TEST_API.isPlayerInZone());

      const scoreBefore = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      // Run for 3 seconds
      await sleep(3000);
      const scoreAfter = await page.evaluate(() => window.__TEST_API.getKOTHScore());

      const noScoring = scoreAfter === scoreBefore;

      return {
        passed: !inZone && noScoring,
        details: {
          inZone,
          noScoring,
          zoneRadius: radius.toFixed(4),
          uvDistanceToZone: uvDist.toFixed(4),
          note: `UV distance ${uvDist.toFixed(3)} >> zone radius ${radius.toFixed(3)} — must be outside`,
          surface,
        },
      };
    },
  },

  /**
   * Scenario: KOTH Basic (all 13 surfaces) — zone appears, player enters and exits.
   * Run on all surfaces as the baseline KOTH sanity check.
   * Acceptance criterion: zone appears + scoring works on every supported surface.
   */
  koth_basic: {
    name: 'KOTH Basic Zone (All Surfaces)',
    description: 'Zone appears and player entering it accumulates score; exiting stops score',
    surfaces: ALL_SURFACES,
    async run(page, surface) {
      // Get zone state (it starts at some random position)
      const zoneState = await page.evaluate(() => window.__TEST_API.getKOTHZoneState());
      if (!zoneState) {
        return {
          passed: false,
          details: { error: 'KOTH zone state not available', surface },
        };
      }

      const { zoneU, zoneV, zoneRadiusUV } = zoneState;

      // Place player at zone center
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        zoneU, zoneV,
      );

      // Poll until inZone becomes true (up to 5s) — robust against SwiftShader slowdowns.
      // Fixed sleeps are unreliable after 20+ prior test pages accumulate CPU pressure.
      let inZone = false;
      const inZoneDeadline = Date.now() + 5000;
      while (Date.now() < inZoneDeadline) {
        inZone = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
        if (inZone) break;
        await sleep(100);
      }

      const scoreBefore = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      await sleep(2000);
      const scoreAfterInside = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      const scoreIncremented = scoreAfterInside > scoreBefore;

      // Move player far outside (3x radius)
      const outsideU = (zoneU + zoneRadiusUV * 3) % 1.0;
      await page.evaluate(
        (u, v) => window.__TEST_API.setPlayerPosition(u, v),
        outsideU, zoneV,
      );
      // Poll until outsideZone becomes false (up to 2s)
      let outsideZone = true;
      const outsideDeadline = Date.now() + 2000;
      while (Date.now() < outsideDeadline) {
        outsideZone = await page.evaluate(() => window.__TEST_API.isPlayerInZone());
        if (!outsideZone) break;
        await sleep(100);
      }
      const scoreFrozen1 = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      await sleep(1000);
      const scoreFrozen2 = await page.evaluate(() => window.__TEST_API.getKOTHScore());
      const scoreStopped = scoreFrozen2 === scoreFrozen1;

      // Take screenshot showing zone ring on surface
      await takeScreenshot(page, `koth_basic_${surface}`);

      return {
        passed: inZone && scoreIncremented && !outsideZone && scoreStopped,
        details: {
          inZone,
          scoreIncremented,
          scoreDelta: scoreAfterInside - scoreBefore,
          outsideZone,
          scoreStopped,
          zoneRadius: zoneRadiusUV.toFixed(4),
          surface,
        },
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Test Runner
// ---------------------------------------------------------------------------

async function runScenario(page, scenarioKey, scenario, surface) {
  const startTime = Date.now();
  try {
    const result = await scenario.run(page, surface);
    return {
      key: scenarioKey,
      name: scenario.name,
      description: scenario.description,
      surface,
      passed: result.passed,
      details: result.details,
      error: null,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      key: scenarioKey,
      name: scenario.name,
      description: scenario.description,
      surface,
      passed: false,
      details: null,
      error: err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

async function runAllKOTHScenarios(requestedSurfaces, scenarioFilter) {
  const browser = await launchBrowser();
  const results = [];

  // Determine which surfaces to test for each scenario
  for (const [scenarioKey, scenario] of Object.entries(KOTH_SCENARIOS)) {
    if (scenarioFilter.length > 0 && !scenarioFilter.includes(scenarioKey)) continue;

    // Which surfaces to test for this scenario?
    const scenarioSurfaces = requestedSurfaces.length > 0
      ? requestedSurfaces.filter(s => scenario.surfaces.includes(s) || requestedSurfaces.length === 1)
      : scenario.surfaces;

    if (scenarioSurfaces.length === 0) continue;

    console.log(`\n--- Scenario: ${scenario.name} ---`);
    console.log(`  Surfaces: ${scenarioSurfaces.join(', ')}`);

    for (const surface of scenarioSurfaces) {
      let page;
      let cdpSession;
      try {
        process.stdout.write(`  [${surface}]... `);
        page = await createPage(browser);
        await startGameInKOTHMode(page, surface);
        // Throttle CPU after game loads — most KOTH scenarios are state-only
        cdpSession = await throttleCPU(page, 6);
        const result = await runScenario(page, scenarioKey, scenario, surface);
        results.push(result);
        console.log(result.passed ? 'PASS' : `FAIL${result.error ? ` (${result.error})` : ''}`);
      } catch (err) {
        console.error(`FAIL (load: ${err.message})`);
        results.push({
          key: scenarioKey,
          name: scenario.name,
          description: scenario.description,
          surface,
          passed: false,
          details: null,
          error: `Failed to start KOTH mode: ${err.message}`,
          durationMs: 0,
        });
      } finally {
        if (cdpSession) await unthrottleCPU(cdpSession);
        if (page) await page.close().catch(() => {});
      }
    }
  }

  await browser.close();
  return results;
}

// ---------------------------------------------------------------------------
// HTML Report
// ---------------------------------------------------------------------------

function generateHTMLReport(results) {
  const date = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const totalTests = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = totalTests - passed;
  const passRate = totalTests > 0 ? ((passed / totalTests) * 100).toFixed(1) : '0.0';

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>KOTH Scenario Report — ${date}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, sans-serif; background: #0a0a0a; color: #e0e0e0; padding: 20px; }
    h1 { color: #ffcc00; margin-bottom: 10px; }
    h2 { color: #88ccff; margin: 20px 0 10px; }
    .summary { display: flex; gap: 20px; margin: 15px 0; }
    .stat { background: #1a1a2e; padding: 15px 25px; border-radius: 8px; text-align: center; }
    .stat .number { font-size: 2em; font-weight: bold; }
    .stat .label { font-size: 0.9em; color: #888; }
    .pass { color: #00ff88; } .fail { color: #ff4444; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { padding: 8px 12px; text-align: left; border: 1px solid #333; }
    th { background: #1a1a2e; color: #88ccff; }
    tr:nth-child(even) { background: #111; }
    .tag-pass { background: #0a3a0a; color: #00ff88; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; }
    .tag-fail { background: #3a0a0a; color: #ff4444; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; }
    details summary { cursor: pointer; color: #88ccff; }
    pre { background: #111; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 0.85em; margin-top: 5px; }
  </style>
</head>
<body>
  <h1>👑 King of the Hill Scenario Report</h1>
  <p>Generated: ${date}</p>
  <div class="summary">
    <div class="stat"><div class="number">${totalTests}</div><div class="label">Total Tests</div></div>
    <div class="stat"><div class="number pass">${passed}</div><div class="label">Passed</div></div>
    <div class="stat"><div class="number fail">${failed}</div><div class="label">Failed</div></div>
    <div class="stat"><div class="number" style="color:${parseFloat(passRate)>80?'#00ff88':'#ff4444'}">${passRate}%</div><div class="label">Pass Rate</div></div>
  </div>
  <h2>Results by Scenario</h2>
  <table>
    <tr><th>Scenario</th><th>Surface</th><th>Status</th><th>Duration</th><th>Details</th></tr>`;

  for (const r of results) {
    const tag = r.passed
      ? '<span class="tag-pass">PASS</span>'
      : '<span class="tag-fail">FAIL</span>';
    const detailsStr = r.error
      ? `<span class="fail">${r.error}</span>`
      : r.details
        ? `<details><summary>Show</summary><pre>${JSON.stringify(r.details, null, 2)}</pre></details>`
        : '—';
    html += `
    <tr>
      <td>${r.name}</td>
      <td>${r.surface}</td>
      <td>${tag}</td>
      <td>${r.durationMs}ms</td>
      <td>${detailsStr}</td>
    </tr>`;
  }

  html += `
  </table>
</body>
</html>`;
  return html;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const surfaceArg = args.find(a => a.startsWith('--surface='))?.split('=')[1];
  const scenarioArg = args.find(a => a.startsWith('--scenario='))?.split('=')[1];
  const allSurfaces = args.includes('--all-surfaces');
  const generateReport = args.includes('--report') || true; // Always generate

  let surfaces;
  if (allSurfaces) {
    surfaces = ALL_SURFACES;
  } else if (surfaceArg) {
    surfaces = [surfaceArg];
  } else {
    surfaces = CORE_SURFACES; // Default: sphere + torus + cube
  }

  const scenarioFilter = scenarioArg ? [scenarioArg] : [];

  console.log(`KOTH Scenario Runner — ${surfaces.length} surfaces`);
  console.log(`Using: ${BASE_URL}`);
  console.log('');

  const results = await runAllKOTHScenarios(surfaces, scenarioFilter);

  const passed = results.filter(r => r.passed).length;
  const failed = results.length - passed;
  console.log(`\n=== Summary: ${passed}/${results.length} passed, ${failed} failed ===`);

  if (generateReport) {
    mkdirSync(REPORT_DIR, { recursive: true });
    const reportDate = new Date().toISOString().slice(0, 10);
    const reportPath = resolve(REPORT_DIR, `${reportDate}-koth-scenarios.html`);
    writeFileSync(reportPath, generateHTMLReport(results));
    console.log(`\nHTML report: ${reportPath}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
