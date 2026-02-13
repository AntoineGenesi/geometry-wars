#!/usr/bin/env node
/**
 * S15 Iteration 7 — Lateral Smoothness & Diagonal Displacement Test
 *
 * Verifies fixes for:
 * 1. Lateral jerk (pressing D should move smoothly without periodic stops/jumps)
 * 2. Diagonal glitch (pressing W+D should move diagonally, not get stuck)
 */
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 3025;
const URL = `http://localhost:${PORT}/?quickStart=true&surface=sphere`;
const SCREENSHOT_DIR = path.join(process.cwd(), 'tests/visual/screenshots');

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

async function run() {
  console.log('=== S15 Iteration 7 Test: Lateral Smoothness & Diagonal Displacement ===\n');

  // Ensure screenshot directory exists
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

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

  console.log('1. Loading game...');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log('2. Waiting for game init (20s)...');
  await sleep(20000);

  // Screenshot: initial state
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 's15-iter7-00-init.png') });
  console.log('   Screenshot: s15-iter7-00-init.png');

  // Make player invincible
  console.log('3. Making player invincible...');
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
    console.log('[TEST] Player made invincible');
  });

  await sleep(5000);

  // Verify player state
  const state = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg) return null;
    const p = dbg.player;
    const cam = dbg.game.camera;
    return {
      alive: p.alive,
      lives: p.lives,
      px: p.mesh.position.x, py: p.mesh.position.y, pz: p.mesh.position.z,
      cx: cam.position.x, cy: cam.position.y, cz: cam.position.z,
      qx: cam.quaternion.x, qy: cam.quaternion.y, qz: cam.quaternion.z, qw: cam.quaternion.w,
    };
  });

  if (!state || !state.alive) {
    console.log('FATAL: Player not alive:', JSON.stringify(state));
    await browser.close();
    return;
  }

  console.log(`   Player: (${state.px.toFixed(2)}, ${state.py.toFixed(2)}, ${state.pz.toFixed(2)}) alive=${state.alive}`);
  console.log(`   Camera: (${state.cx.toFixed(2)}, ${state.cy.toFixed(2)}, ${state.cz.toFixed(2)})`);

  const { right, up } = getCameraAxes(state.qx, state.qy, state.qz, state.qw);
  console.log(`   Cam right: (${right.x.toFixed(3)}, ${right.y.toFixed(3)}, ${right.z.toFixed(3)})`);
  console.log(`   Cam up:    (${up.x.toFixed(3)}, ${up.y.toFixed(3)}, ${up.z.toFixed(3)})`);

  // ========================================
  // TEST 1: Lateral Smoothness (D key)
  // ========================================
  console.log('\n=== TEST 1: LATERAL SMOOTHNESS (D key) ===\n');
  console.log('Pressing D for 3 seconds, sampling position every 500ms...');

  // Read initial camera quaternion
  const camQuat = await page.evaluate(() => {
    const cam = window.__gameDebug.game.camera;
    return { qx: cam.quaternion.x, qy: cam.quaternion.y, qz: cam.quaternion.z, qw: cam.quaternion.w };
  });
  const camAxes = getCameraAxes(camQuat.qx, camQuat.qy, camQuat.qz, camQuat.qw);

  // Screenshot before
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 's15-iter7-01-lateral-before.png') });
  console.log('   Screenshot: s15-iter7-01-lateral-before.png');

  // Start pressing D
  await page.keyboard.down('d');

  const lateralSamples = [];
  const sampleCount = 7; // 0ms, 500ms, 1000ms, 1500ms, 2000ms, 2500ms, 3000ms

  for (let i = 0; i < sampleCount; i++) {
    const pos = await page.evaluate(() => {
      const p = window.__gameDebug.player;
      return { x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z, alive: p.alive };
    });
    lateralSamples.push({ t: i * 500, ...pos });
    if (i < sampleCount - 1) {
      await sleep(500);
    }
  }

  await page.keyboard.up('d');
  await sleep(200);

  // Screenshot after
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 's15-iter7-02-lateral-after.png') });
  console.log('   Screenshot: s15-iter7-02-lateral-after.png');

  // Analyze lateral smoothness
  console.log('\nLateral samples:');
  const lateralDisplacements = [];
  for (let i = 1; i < lateralSamples.length; i++) {
    const prev = lateralSamples[i-1];
    const curr = lateralSamples[i];
    const disp = { x: curr.x - prev.x, y: curr.y - prev.y, z: curr.z - prev.z };
    const screenRight = dot(disp, camAxes.right);
    const screenUp = dot(disp, camAxes.up);
    const total = vlen(disp);

    lateralDisplacements.push({ screenRight, screenUp, total });
    console.log(`  ${prev.t}ms → ${curr.t}ms: screen-right=${screenRight.toFixed(3)}, screen-up=${screenUp.toFixed(3)}, |d|=${total.toFixed(3)}`);
  }

  // Check lateral smoothness criteria
  const lateralChecks = [];

  // 1. Each interval should have positive screen-right displacement
  let allPositive = true;
  for (let i = 0; i < lateralDisplacements.length; i++) {
    if (lateralDisplacements[i].screenRight <= 0) {
      allPositive = false;
      console.log(`   ⚠ Interval ${i} has non-positive screen-right: ${lateralDisplacements[i].screenRight.toFixed(3)}`);
    }
  }
  lateralChecks.push({ name: 'All intervals positive screen-right', pass: allPositive });

  // 2. No interval should have displacement < 0.3x or > 3x the average (no periodic jerk)
  const avgDisplacement = lateralDisplacements.reduce((sum, d) => sum + d.total, 0) / lateralDisplacements.length;
  let noJerk = true;
  for (let i = 0; i < lateralDisplacements.length; i++) {
    const ratio = lateralDisplacements[i].total / avgDisplacement;
    if (ratio < 0.3 || ratio > 3.0) {
      noJerk = false;
      console.log(`   ⚠ Interval ${i} has irregular displacement: ${lateralDisplacements[i].total.toFixed(3)} (ratio=${ratio.toFixed(2)}x avg)`);
    }
  }
  lateralChecks.push({ name: 'No periodic jerk (0.3x < ratio < 3x)', pass: noJerk });

  // 3. Total displacement should be significant (> 2 units)
  const lateralTotal = vlen({
    x: lateralSamples[lateralSamples.length-1].x - lateralSamples[0].x,
    y: lateralSamples[lateralSamples.length-1].y - lateralSamples[0].y,
    z: lateralSamples[lateralSamples.length-1].z - lateralSamples[0].z,
  });
  const significantDisp = lateralTotal > 2.0;
  lateralChecks.push({ name: `Total displacement > 2 units (actual=${lateralTotal.toFixed(2)})`, pass: significantDisp });

  console.log('\nLateral Smoothness Results:');
  const lateralPass = lateralChecks.every(c => c.pass);
  for (const check of lateralChecks) {
    console.log(`  ${check.pass ? 'PASS' : 'FAIL'} — ${check.name}`);
  }
  console.log(`\n  LATERAL TEST: ${lateralPass ? 'PASS' : 'FAIL'}`);

  // ========================================
  // TEST 2: Diagonal Displacement (W+D)
  // ========================================
  console.log('\n=== TEST 2: DIAGONAL DISPLACEMENT (W+D keys) ===\n');
  console.log('Pressing W+D simultaneously for 3 seconds...');

  // Read camera quaternion again (in case it changed)
  const camQuat2 = await page.evaluate(() => {
    const cam = window.__gameDebug.game.camera;
    return { qx: cam.quaternion.x, qy: cam.quaternion.y, qz: cam.quaternion.z, qw: cam.quaternion.w };
  });
  const camAxes2 = getCameraAxes(camQuat2.qx, camQuat2.qy, camQuat2.qz, camQuat2.qw);

  // Screenshot before
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 's15-iter7-03-diagonal-before.png') });
  console.log('   Screenshot: s15-iter7-03-diagonal-before.png');

  // Read position before
  const beforeDiag = await page.evaluate(() => {
    const p = window.__gameDebug.player;
    return { x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z, alive: p.alive };
  });

  // Press W+D simultaneously
  await page.keyboard.down('w');
  await page.keyboard.down('d');
  await sleep(3000);
  await page.keyboard.up('w');
  await page.keyboard.up('d');
  await sleep(200);

  // Screenshot after
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 's15-iter7-04-diagonal-after.png') });
  console.log('   Screenshot: s15-iter7-04-diagonal-after.png');

  // Read position after
  const afterDiag = await page.evaluate(() => {
    const p = window.__gameDebug.player;
    return { x: p.mesh.position.x, y: p.mesh.position.y, z: p.mesh.position.z, alive: p.alive };
  });

  // Analyze diagonal displacement
  const diagDisp = { x: afterDiag.x - beforeDiag.x, y: afterDiag.y - beforeDiag.y, z: afterDiag.z - beforeDiag.z };
  const diagScreenRight = dot(diagDisp, camAxes2.right);
  const diagScreenUp = dot(diagDisp, camAxes2.up);
  const diagTotal = vlen(diagDisp);

  console.log(`\nDiagonal displacement:`);
  console.log(`  World: (${diagDisp.x.toFixed(3)}, ${diagDisp.y.toFixed(3)}, ${diagDisp.z.toFixed(3)})`);
  console.log(`  Screen: right=${diagScreenRight.toFixed(3)}, up=${diagScreenUp.toFixed(3)}`);
  console.log(`  Total: ${diagTotal.toFixed(3)}`);

  // Check diagonal criteria
  const diagChecks = [];

  // 1. Total displacement > 2 units
  const diagSignificant = diagTotal > 2.0;
  diagChecks.push({ name: `Total displacement > 2 units (actual=${diagTotal.toFixed(2)})`, pass: diagSignificant });

  // 2. Both screen-right and screen-up should be positive
  const rightPositive = diagScreenRight > 0;
  const upPositive = diagScreenUp > 0;
  diagChecks.push({ name: `Screen-right positive (${diagScreenRight.toFixed(3)} > 0)`, pass: rightPositive });
  diagChecks.push({ name: `Screen-up positive (${diagScreenUp.toFixed(3)} > 0)`, pass: upPositive });

  // 3. Movement should be genuinely diagonal (both components significant)
  const minComponent = Math.min(Math.abs(diagScreenRight), Math.abs(diagScreenUp));
  const maxComponent = Math.max(Math.abs(diagScreenRight), Math.abs(diagScreenUp));
  const isDiagonal = minComponent > 0.2 * maxComponent; // Min should be at least 20% of max
  diagChecks.push({ name: `Genuinely diagonal (min/max=${(minComponent/maxComponent).toFixed(2)})`, pass: isDiagonal });

  console.log('\nDiagonal Displacement Results:');
  const diagPass = diagChecks.every(c => c.pass);
  for (const check of diagChecks) {
    console.log(`  ${check.pass ? 'PASS' : 'FAIL'} — ${check.name}`);
  }
  console.log(`\n  DIAGONAL TEST: ${diagPass ? 'PASS' : 'FAIL'}`);

  // ========================================
  // FINAL SUMMARY
  // ========================================
  console.log('\n=== FINAL SUMMARY ===');
  console.log(`  Lateral Smoothness:      ${lateralPass ? 'PASS' : 'FAIL'}`);
  console.log(`  Diagonal Displacement:   ${diagPass ? 'PASS' : 'FAIL'}`);
  console.log(`\n${lateralPass && diagPass ? 'ALL TESTS PASSED ✓' : 'SOME TESTS FAILED ✗'}`);
  console.log('\nScreenshots saved to tests/visual/screenshots/');

  await browser.close();
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
