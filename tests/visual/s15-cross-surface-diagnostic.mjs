#!/usr/bin/env node
/**
 * S15 Cross-Surface Movement Diagnostic
 *
 * Tests player movement on ALL playable surfaces to identify which ones exhibit:
 * - Lateral jerk/wobble (screen-up motion during left-right movement)
 * - Forward jerk/wobble (screen-right motion during forward movement)
 * - Diagonal zigzag (overshooting/oscillating trajectory)
 * - Pole/origin sensitivity (worse jitter near UV boundaries)
 *
 * Surfaces tested: sphere, cube, pill, torus, capsule, peanut, pipe, icosahedron
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const PORT = process.env.PORT || 3025;
const BASE_URL = `http://localhost:${PORT}/?quickStart=true`;

const SURFACES = [
  'sphere',
  'cube',
  'pill',
  'torus',
  'capsule',
  'peanut',
  'pipe',
  'icosahedron',
];

// Thresholds for pass/fail
const THRESHOLDS = {
  wobble_ratio: 0.15,      // Max ratio of perpendicular component (screen-up for lateral, screen-right for forward)
  consistency_cv: 0.5,     // Max coefficient of variation for movement magnitude
  zigzag_angle: 45,        // Max angle deviation for zigzag detection (degrees)
  zigzag_freq: 0.3,        // Max frequency of large angle changes (30% of intervals)
  min_displacement: 2.0,   // Min total displacement for diagonal (units)
};

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function getCameraAxes(qx, qy, qz, qw) {
  return {
    right: {
      x: 1 - 2*(qy*qy + qz*qz),
      y: 2*(qx*qy + qz*qw),
      z: 2*(qx*qz - qy*qw),
    },
    up: {
      x: 2*(qx*qy - qz*qw),
      y: 1 - 2*(qx*qx + qz*qz),
      z: 2*(qy*qz + qx*qw),
    },
  };
}

function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
function vlen(v) { return Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); }
function vsub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }

function computeCV(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

async function testSurface(page, surface) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`=== SURFACE: ${surface} ===`);
  console.log('='.repeat(60));

  const url = `${BASE_URL}&surface=${surface}`;

  // Navigate to surface
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  console.log(`  Loading ${surface}...`);
  await sleep(20000); // Wait for game init

  // Make player invincible
  await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg || !dbg.player) return;
    dbg.player.lives = 99;
    dbg.player.takeDamage = () => {};
    dbg.player.die = () => {};
    if (!dbg.player.alive) {
      dbg.player.alive = true;
      dbg.player.health = 1;
    }
  });

  await sleep(2000);

  // Check player alive
  const alive = await page.evaluate(() => window.__gameDebug?.player?.alive);
  if (!alive) {
    console.log(`  SKIP: Player not alive on ${surface}`);
    return null;
  }

  const results = {
    surface,
    lateral: await testLateral(page),
    forward: await testForward(page),
    diagonal: await testDiagonal(page),
    pole: await testNearPole(page, surface),
  };

  // Take screenshot
  const screenshotPath = `tests/visual/screenshots/s15-cross-${surface}.png`;
  await page.screenshot({ path: screenshotPath });
  console.log(`  Screenshot saved: ${screenshotPath}`);

  return results;
}

async function sampleMovement(page, key, durationMs = 3000, sampleIntervalMs = 200) {
  const samples = [];
  const numSamples = Math.floor(durationMs / sampleIntervalMs);

  // Get initial state
  const initial = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    const p = dbg.player;
    const cam = dbg.game.camera;
    return {
      px: p.mesh.position.x,
      py: p.mesh.position.y,
      pz: p.mesh.position.z,
      qx: cam.quaternion.x,
      qy: cam.quaternion.y,
      qz: cam.quaternion.z,
      qw: cam.quaternion.w,
    };
  });
  samples.push(initial);

  // Start movement
  await page.keyboard.down(key);

  // Sample at intervals
  for (let i = 0; i < numSamples; i++) {
    await sleep(sampleIntervalMs);
    const sample = await page.evaluate(() => {
      const dbg = window.__gameDebug;
      const p = dbg.player;
      const cam = dbg.game.camera;
      return {
        px: p.mesh.position.x,
        py: p.mesh.position.y,
        pz: p.mesh.position.z,
        qx: cam.quaternion.x,
        qy: cam.quaternion.y,
        qz: cam.quaternion.z,
        qw: cam.quaternion.w,
      };
    });
    samples.push(sample);
  }

  await page.keyboard.up(key);
  await sleep(200);

  return samples;
}

async function testLateral(page) {
  console.log('\n  Test A: Lateral Movement (D key, 3s)');

  const samples = await sampleMovement(page, 'd', 3000, 200);

  // Compute screen-space displacements
  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];

    const disp = vsub(
      { x: curr.px, y: curr.py, z: curr.pz },
      { x: prev.px, y: prev.py, z: prev.pz }
    );

    // Use camera from start of interval
    const { right, up } = getCameraAxes(prev.qx, prev.qy, prev.qz, prev.qw);
    const sr = dot(disp, right);
    const su = dot(disp, up);
    const mag = vlen(disp);

    intervals.push({ sr, su, mag });
  }

  // Analysis
  const rightComponents = intervals.map(i => i.sr);
  const upComponents = intervals.map(i => Math.abs(i.su));
  const magnitudes = intervals.filter(i => i.mag > 0.01).map(i => i.mag);

  const directionConsistent = rightComponents.every(r => r > 0);
  const wobbleRatios = intervals.map(i => i.mag > 0.01 ? Math.abs(i.su / i.sr) : 0);
  const avgWobbleRatio = wobbleRatios.reduce((a, b) => a + b, 0) / wobbleRatios.length;
  const cv = computeCV(magnitudes);

  const directionPass = directionConsistent;
  const wobblePass = avgWobbleRatio < THRESHOLDS.wobble_ratio;
  const consistencyPass = cv < THRESHOLDS.consistency_cv;

  console.log(`    Direction consistent (all R>0): ${directionPass ? 'PASS' : 'FAIL'} (${rightComponents.filter(r => r > 0).length}/${rightComponents.length})`);
  console.log(`    Wobble (avg |up/right|): ${wobblePass ? 'PASS' : 'FAIL'} (${avgWobbleRatio.toFixed(3)} < ${THRESHOLDS.wobble_ratio})`);
  console.log(`    Consistency (CV): ${consistencyPass ? 'PASS' : 'FAIL'} (${cv.toFixed(3)} < ${THRESHOLDS.consistency_cv})`);

  return {
    directionPass,
    wobblePass,
    consistencyPass,
    avgWobbleRatio,
    cv,
    intervals,
  };
}

async function testForward(page) {
  console.log('\n  Test B: Forward Movement (W key, 3s)');

  const samples = await sampleMovement(page, 'w', 3000, 200);

  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];

    const disp = vsub(
      { x: curr.px, y: curr.py, z: curr.pz },
      { x: prev.px, y: prev.py, z: prev.pz }
    );

    const { right, up } = getCameraAxes(prev.qx, prev.qy, prev.qz, prev.qw);
    const sr = dot(disp, right);
    const su = dot(disp, up);
    const mag = vlen(disp);

    intervals.push({ sr, su, mag });
  }

  const upComponents = intervals.map(i => i.su);
  const rightComponents = intervals.map(i => Math.abs(i.sr));
  const magnitudes = intervals.filter(i => i.mag > 0.01).map(i => i.mag);

  const directionConsistent = upComponents.every(u => u > 0);
  const wobbleRatios = intervals.map(i => i.mag > 0.01 ? Math.abs(i.sr / i.su) : 0);
  const avgWobbleRatio = wobbleRatios.reduce((a, b) => a + b, 0) / wobbleRatios.length;
  const cv = computeCV(magnitudes);

  const directionPass = directionConsistent;
  const wobblePass = avgWobbleRatio < THRESHOLDS.wobble_ratio;
  const consistencyPass = cv < THRESHOLDS.consistency_cv;

  console.log(`    Direction consistent (all U>0): ${directionPass ? 'PASS' : 'FAIL'} (${upComponents.filter(u => u > 0).length}/${upComponents.length})`);
  console.log(`    Wobble (avg |right/up|): ${wobblePass ? 'PASS' : 'FAIL'} (${avgWobbleRatio.toFixed(3)} < ${THRESHOLDS.wobble_ratio})`);
  console.log(`    Consistency (CV): ${consistencyPass ? 'PASS' : 'FAIL'} (${cv.toFixed(3)} < ${THRESHOLDS.consistency_cv})`);

  return {
    directionPass,
    wobblePass,
    consistencyPass,
    avgWobbleRatio,
    cv,
    intervals,
  };
}

async function testDiagonal(page) {
  console.log('\n  Test C: Diagonal Movement (W+D keys, 3s)');

  // Sample with both keys pressed
  const samples = [];
  const initial = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    const p = dbg.player;
    const cam = dbg.game.camera;
    return {
      px: p.mesh.position.x,
      py: p.mesh.position.y,
      pz: p.mesh.position.z,
      qx: cam.quaternion.x,
      qy: cam.quaternion.y,
      qz: cam.quaternion.z,
      qw: cam.quaternion.w,
    };
  });
  samples.push(initial);

  // Press both keys
  await page.keyboard.down('w');
  await page.keyboard.down('d');

  for (let i = 0; i < 15; i++) {
    await sleep(200);
    const sample = await page.evaluate(() => {
      const dbg = window.__gameDebug;
      const p = dbg.player;
      const cam = dbg.game.camera;
      return {
        px: p.mesh.position.x,
        py: p.mesh.position.y,
        pz: p.mesh.position.z,
        qx: cam.quaternion.x,
        qy: cam.quaternion.y,
        qz: cam.quaternion.z,
        qw: cam.quaternion.w,
      };
    });
    samples.push(sample);
  }

  await page.keyboard.up('d');
  await page.keyboard.up('w');
  await sleep(200);

  // Total displacement
  const first = samples[0];
  const last = samples[samples.length - 1];
  const totalDisp = vsub(
    { x: last.px, y: last.py, z: last.pz },
    { x: first.px, y: first.py, z: first.pz }
  );
  const totalMag = vlen(totalDisp);

  // Screen-space components
  const { right, up } = getCameraAxes(first.qx, first.qy, first.qz, first.qw);
  const totalSR = dot(totalDisp, right);
  const totalSU = dot(totalDisp, up);

  // Zigzag detection: compute angles between consecutive displacement vectors
  const displacements = [];
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const disp = vsub(
      { x: curr.px, y: curr.py, z: curr.pz },
      { x: prev.px, y: prev.py, z: prev.pz }
    );
    displacements.push(disp);
  }

  let largeAngleCount = 0;
  const angles = [];
  for (let i = 1; i < displacements.length; i++) {
    const d1 = displacements[i - 1];
    const d2 = displacements[i];
    const mag1 = vlen(d1);
    const mag2 = vlen(d2);

    if (mag1 > 0.01 && mag2 > 0.01) {
      const dotProd = dot(d1, d2);
      const cosAngle = dotProd / (mag1 * mag2);
      const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180 / Math.PI;
      angles.push(angle);

      if (angle > THRESHOLDS.zigzag_angle) {
        largeAngleCount++;
      }
    }
  }

  const zigzagFreq = angles.length > 0 ? largeAngleCount / angles.length : 0;

  const displacementPass = totalMag > THRESHOLDS.min_displacement;
  const directionPass = totalSR > 0 && totalSU > 0;
  const zigzagPass = zigzagFreq < THRESHOLDS.zigzag_freq;

  console.log(`    Total displacement: ${displacementPass ? 'PASS' : 'FAIL'} (${totalMag.toFixed(2)} > ${THRESHOLDS.min_displacement})`);
  console.log(`    Direction (SR>0, SU>0): ${directionPass ? 'PASS' : 'FAIL'} (SR=${totalSR.toFixed(2)}, SU=${totalSU.toFixed(2)})`);
  console.log(`    Zigzag (freq < ${THRESHOLDS.zigzag_freq}): ${zigzagPass ? 'PASS' : 'FAIL'} (${zigzagFreq.toFixed(2)}, ${largeAngleCount}/${angles.length} large angles)`);

  return {
    displacementPass,
    directionPass,
    zigzagPass,
    totalMag,
    totalSR,
    totalSU,
    zigzagFreq,
    angles,
  };
}

async function testNearPole(page, surface) {
  // Only test surfaces that have poles/singularities
  const surfacesWithPoles = ['sphere', 'pill', 'capsule', 'peanut'];
  if (!surfacesWithPoles.includes(surface)) {
    console.log('\n  Test D: Near-pole test skipped (not applicable)');
    return { applicable: false };
  }

  console.log('\n  Test D: Movement Near Pole');

  // Get surface radius - use default 10 for all surfaces
  // (accessing geometry parameters is unreliable across different surface types)
  const surfaceInfo = { radius: 10 };

  // Teleport to near pole
  const targetY = surfaceInfo.radius * 0.9; // 90% of radius height
  await page.evaluate((targetY) => {
    const dbg = window.__gameDebug;
    const p = dbg.player;
    p.mesh.position.set(0, targetY, 0.5); // Slightly offset from exact pole
  }, targetY);

  await sleep(500);

  // Test lateral movement at pole
  const poleSamples = await sampleMovement(page, 'd', 2000, 200);

  const poleIntervals = [];
  for (let i = 1; i < poleSamples.length; i++) {
    const prev = poleSamples[i - 1];
    const curr = poleSamples[i];

    const disp = vsub(
      { x: curr.px, y: curr.py, z: curr.pz },
      { x: prev.px, y: prev.py, z: prev.pz }
    );

    const { right, up } = getCameraAxes(prev.qx, prev.qy, prev.qz, prev.qw);
    const sr = dot(disp, right);
    const su = dot(disp, up);
    const mag = vlen(disp);

    poleIntervals.push({ sr, su, mag });
  }

  const poleWobbleRatios = poleIntervals.map(i => i.mag > 0.01 ? Math.abs(i.su / i.sr) : 0);
  const poleAvgWobble = poleWobbleRatios.reduce((a, b) => a + b, 0) / poleWobbleRatios.length;

  // Compare to equator test (from lateral test)
  // We can't easily get equator data here, so just report pole data
  console.log(`    Pole wobble ratio: ${poleAvgWobble.toFixed(3)}`);
  console.log(`    (Compare to equator wobble from Test A)`);

  return {
    applicable: true,
    poleAvgWobble,
    poleIntervals,
  };
}

function printResults(allResults) {
  console.log('\n\n');
  console.log('='.repeat(80));
  console.log('=== CROSS-SURFACE DIAGNOSTIC SUMMARY ===');
  console.log('='.repeat(80));

  const summaryTable = [];

  for (const result of allResults) {
    if (!result) continue;

    const { surface, lateral, forward, diagonal, pole } = result;

    const lateralStatus = lateral.directionPass && lateral.wobblePass && lateral.consistencyPass ? 'PASS' : 'FAIL';
    const forwardStatus = forward.directionPass && forward.wobblePass && forward.consistencyPass ? 'PASS' : 'FAIL';
    const diagonalStatus = diagonal.displacementPass && diagonal.directionPass && diagonal.zigzagPass ? 'PASS' : 'FAIL';
    const poleStatus = pole.applicable ? (pole.poleAvgWobble / lateral.avgWobbleRatio).toFixed(2) + 'x' : 'N/A';

    summaryTable.push({
      surface,
      lateral: lateralStatus,
      lateralWobble: lateral.avgWobbleRatio.toFixed(3),
      forward: forwardStatus,
      forwardWobble: forward.avgWobbleRatio.toFixed(3),
      diagonal: diagonalStatus,
      diagonalZigzag: diagonal.zigzagFreq.toFixed(2),
      pole: poleStatus,
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`${surface.toUpperCase()}`);
    console.log('='.repeat(60));
    console.log(`  Lateral (D):    ${lateralStatus.padEnd(4)} | wobble=${lateral.avgWobbleRatio.toFixed(3)} cv=${lateral.cv.toFixed(3)}`);
    console.log(`  Forward (W):    ${forwardStatus.padEnd(4)} | wobble=${forward.avgWobbleRatio.toFixed(3)} cv=${forward.cv.toFixed(3)}`);
    console.log(`  Diagonal (W+D): ${diagonalStatus.padEnd(4)} | zigzag=${diagonal.zigzagFreq.toFixed(2)} dist=${diagonal.totalMag.toFixed(2)}`);
    console.log(`  Near-pole:      ${poleStatus.padEnd(4)} | ${pole.applicable ? 'pole_wobble=' + pole.poleAvgWobble.toFixed(3) : 'not applicable'}`);
  }

  // Summary table
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(80));
  console.log('Surface      | Lateral | Wobble | Forward | Wobble | Diagonal | Zigzag | Pole');
  console.log('-------------|---------|--------|---------|--------|----------|--------|------');

  for (const row of summaryTable) {
    const line = `${row.surface.padEnd(12)} | ${row.lateral.padEnd(7)} | ${row.lateralWobble.padEnd(6)} | ${row.forward.padEnd(7)} | ${row.forwardWobble.padEnd(6)} | ${row.diagonal.padEnd(8)} | ${row.diagonalZigzag.padEnd(6)} | ${row.pole}`;
    console.log(line);
  }

  // Analysis
  console.log('\n' + '='.repeat(80));
  console.log('ANALYSIS');
  console.log('='.repeat(80));

  const failedSurfaces = summaryTable.filter(r =>
    r.lateral === 'FAIL' || r.forward === 'FAIL' || r.diagonal === 'FAIL'
  );

  if (failedSurfaces.length === 0) {
    console.log('\n✓ ALL SURFACES PASSED ALL TESTS');
  } else {
    console.log(`\n✗ ${failedSurfaces.length}/${summaryTable.length} surfaces have issues:\n`);
    for (const row of failedSurfaces) {
      const issues = [];
      if (row.lateral === 'FAIL') issues.push(`lateral wobble=${row.lateralWobble}`);
      if (row.forward === 'FAIL') issues.push(`forward wobble=${row.forwardWobble}`);
      if (row.diagonal === 'FAIL') issues.push(`diagonal zigzag=${row.diagonalZigzag}`);
      console.log(`  ${row.surface}: ${issues.join(', ')}`);
    }
  }

  // Patterns
  console.log('\nPATTERNS:');
  const curvedSurfaces = ['sphere', 'pill', 'capsule', 'peanut', 'torus', 'pipe'];
  const flatFacedSurfaces = ['cube', 'icosahedron'];

  const curvedFailed = summaryTable.filter(r =>
    curvedSurfaces.includes(r.surface) &&
    (r.lateral === 'FAIL' || r.forward === 'FAIL' || r.diagonal === 'FAIL')
  );
  const flatFailed = summaryTable.filter(r =>
    flatFacedSurfaces.includes(r.surface) &&
    (r.lateral === 'FAIL' || r.forward === 'FAIL' || r.diagonal === 'FAIL')
  );

  console.log(`  - Curved surfaces: ${curvedFailed.length}/${curvedSurfaces.length} failed`);
  console.log(`  - Flat-faced surfaces: ${flatFailed.length}/${flatFacedSurfaces.length} failed`);

  // Wobble severity ranking
  console.log('\nWOBBLE SEVERITY RANKING (worst first):');
  const byWobble = [...summaryTable].sort((a, b) =>
    parseFloat(b.lateralWobble) - parseFloat(a.lateralWobble)
  );
  for (let i = 0; i < Math.min(5, byWobble.length); i++) {
    const r = byWobble[i];
    console.log(`  ${i+1}. ${r.surface}: lateral=${r.lateralWobble}, forward=${r.forwardWobble}`);
  }
}

async function run() {
  console.log('='.repeat(80));
  console.log('S15 CROSS-SURFACE MOVEMENT DIAGNOSTIC');
  console.log('='.repeat(80));
  console.log(`Testing ${SURFACES.length} surfaces: ${SURFACES.join(', ')}`);
  console.log(`\nThresholds:`);
  console.log(`  - Wobble ratio: < ${THRESHOLDS.wobble_ratio}`);
  console.log(`  - Consistency CV: < ${THRESHOLDS.consistency_cv}`);
  console.log(`  - Zigzag angle: > ${THRESHOLDS.zigzag_angle}°`);
  console.log(`  - Zigzag frequency: < ${THRESHOLDS.zigzag_freq}`);
  console.log(`  - Min diagonal displacement: > ${THRESHOLDS.min_displacement}`);
  console.log('='.repeat(80));

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

  // Create screenshots directory if needed
  if (!fs.existsSync('tests/visual/screenshots')) {
    fs.mkdirSync('tests/visual/screenshots', { recursive: true });
  }

  const allResults = [];

  for (const surface of SURFACES) {
    try {
      const result = await testSurface(page, surface);
      allResults.push(result);

      // Brief pause between surfaces
      await sleep(1000);
    } catch (err) {
      console.error(`ERROR testing ${surface}:`, err.message);
      allResults.push(null);
    }
  }

  await browser.close();

  printResults(allResults.filter(r => r !== null));
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
