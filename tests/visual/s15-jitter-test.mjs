#!/usr/bin/env node
/**
 * S15 Jitter Test — Check for jerky/oscillating movement on W key.
 * Samples position every second during continuous W press.
 */
import puppeteer from 'puppeteer-core';

const PORT = process.env.PORT || 3025;
const URL = `http://localhost:${PORT}/?quickStart=true&surface=sphere`;

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
  console.log('=== S15 Jitter Test (W key) ===\n');

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
  await sleep(20000);

  // Make invincible
  await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (dbg?.player) {
      dbg.player.lives = 99;
      dbg.player.takeDamage = () => {};
      dbg.player.die = () => {};
      if (!dbg.player.alive) { dbg.player.alive = true; dbg.player.health = 1; }
    }
  });
  await sleep(5000);

  // Install per-frame tracking inside the game loop
  const installed = await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg?.game) return false;

    window.__framePositions = [];
    window.__frameTracking = false;

    const orig = dbg.game.onFixedUpdate;
    dbg.game.onFixedUpdate = function(dt) {
      const result = orig.call(this, dt);
      if (window.__frameTracking && dbg.player?.alive) {
        const p = dbg.player.mesh.position;
        const cam = dbg.game.camera;
        window.__framePositions.push({
          px: p.x, py: p.y, pz: p.z,
          qx: cam.quaternion.x, qy: cam.quaternion.y, qz: cam.quaternion.z, qw: cam.quaternion.w,
        });
      }
      return result;
    };
    return true;
  });
  console.log('2. Frame tracking installed:', installed);

  // Start tracking
  await page.evaluate(() => { window.__frameTracking = true; window.__framePositions = []; });

  // Press W for 5 seconds
  console.log('3. Pressing W for 5 seconds...');
  await page.keyboard.down('w');
  await sleep(5000);
  await page.keyboard.up('w');

  // Stop tracking
  await page.evaluate(() => { window.__frameTracking = false; });
  await sleep(200);

  // Read all frame data
  const frames = await page.evaluate(() => window.__framePositions);
  console.log(`   Captured ${frames.length} frame positions\n`);

  if (frames.length < 10) {
    console.log('ERROR: Not enough frames captured');
    await browser.close();
    return;
  }

  // Analyze per-frame displacement
  console.log('=== PER-FRAME ANALYSIS ===');
  const screenUpComponents = [];
  const screenRightComponents = [];
  const frameMagnitudes = [];

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i-1];
    const curr = frames[i];
    const disp = { x: curr.px - prev.px, y: curr.py - prev.py, z: curr.pz - prev.pz };
    const mag = vlen(disp);

    if (mag < 1e-6) continue; // Skip zero-displacement frames

    const { right, up } = getCameraAxes(prev.qx, prev.qy, prev.qz, prev.qw);
    const sr = dot(disp, right);
    const su = dot(disp, up);

    screenUpComponents.push(su);
    screenRightComponents.push(sr);
    frameMagnitudes.push(mag);
  }

  console.log(`  Active frames (non-zero displacement): ${frameMagnitudes.length}`);

  // Jitter analysis
  const positiveUp = screenUpComponents.filter(v => v > 0).length;
  const negativeUp = screenUpComponents.filter(v => v < 0).length;
  const zeroUp = screenUpComponents.filter(v => v === 0).length;
  console.log(`  Screen-up: ${positiveUp} positive, ${negativeUp} negative, ${zeroUp} zero`);

  // Sign flips (oscillation indicator)
  let signFlips = 0;
  for (let i = 1; i < screenUpComponents.length; i++) {
    if (Math.sign(screenUpComponents[i]) !== Math.sign(screenUpComponents[i-1])) {
      signFlips++;
    }
  }
  console.log(`  Sign flips: ${signFlips} / ${screenUpComponents.length - 1} = ${(signFlips / (screenUpComponents.length - 1) * 100).toFixed(1)}%`);

  // Average magnitude per frame
  const avgMag = frameMagnitudes.reduce((a,b) => a+b, 0) / frameMagnitudes.length;
  const maxMag = Math.max(...frameMagnitudes);
  const minMag = Math.min(...frameMagnitudes);
  console.log(`  Magnitude: avg=${avgMag.toFixed(4)} min=${minMag.toFixed(4)} max=${maxMag.toFixed(4)}`);

  // Consistency: coefficient of variation
  const magStd = Math.sqrt(frameMagnitudes.reduce((s, v) => s + (v - avgMag) ** 2, 0) / frameMagnitudes.length);
  const cv = magStd / avgMag;
  console.log(`  Magnitude CV: ${cv.toFixed(3)} (lower = more consistent, <0.3 = good)`);

  // Show first 20 frames
  console.log('\n  First 20 frame screen-up components:');
  for (let i = 0; i < Math.min(20, screenUpComponents.length); i++) {
    const bar = screenUpComponents[i] > 0 ? '+'.repeat(Math.min(40, Math.round(screenUpComponents[i] * 200))) : '-'.repeat(Math.min(40, Math.round(-screenUpComponents[i] * 200)));
    console.log(`    ${i.toString().padStart(3)}: ${screenUpComponents[i].toFixed(5)} ${bar}`);
  }

  // Verdict
  console.log('\n=== VERDICT ===');
  const upPct = positiveUp / (positiveUp + negativeUp + zeroUp) * 100;
  const flipPct = signFlips / Math.max(1, screenUpComponents.length - 1) * 100;

  const upPass = upPct > 70;
  const flipPass = flipPct < 20;
  const cvPass = cv < 0.5;

  console.log(`  W moves UP: ${upPct.toFixed(0)}% of frames (${upPass ? 'PASS' : 'FAIL'}: need >70%)`);
  console.log(`  Sign flips: ${flipPct.toFixed(0)}% (${flipPass ? 'PASS' : 'FAIL'}: need <20%)`);
  console.log(`  Magnitude consistency: CV=${cv.toFixed(2)} (${cvPass ? 'PASS' : 'FAIL'}: need <0.5)`);
  console.log(`  Overall: ${upPass && flipPass && cvPass ? 'PASS — No jitter detected' : 'FAIL — Jitter detected'}`);

  // Also do D key jitter test
  console.log('\n\n=== D Key Jitter Test ===');
  await page.evaluate(() => { window.__frameTracking = true; window.__framePositions = []; });
  await page.keyboard.down('d');
  await sleep(5000);
  await page.keyboard.up('d');
  await page.evaluate(() => { window.__frameTracking = false; });
  await sleep(200);

  const dFrames = await page.evaluate(() => window.__framePositions);
  console.log(`  Captured ${dFrames.length} frames`);

  const dScreenRight = [];
  for (let i = 1; i < dFrames.length; i++) {
    const prev = dFrames[i-1];
    const curr = dFrames[i];
    const disp = { x: curr.px - prev.px, y: curr.py - prev.py, z: curr.pz - prev.pz };
    if (vlen(disp) < 1e-6) continue;
    const { right } = getCameraAxes(prev.qx, prev.qy, prev.qz, prev.qw);
    dScreenRight.push(dot(disp, right));
  }

  const dPosR = dScreenRight.filter(v => v > 0).length;
  const dNegR = dScreenRight.filter(v => v < 0).length;
  let dFlips = 0;
  for (let i = 1; i < dScreenRight.length; i++) {
    if (Math.sign(dScreenRight[i]) !== Math.sign(dScreenRight[i-1])) dFlips++;
  }
  const dPct = dPosR / Math.max(1, dPosR + dNegR) * 100;
  const dFlipPct = dFlips / Math.max(1, dScreenRight.length - 1) * 100;

  console.log(`  D moves RIGHT: ${dPct.toFixed(0)}% of frames (${dPct > 70 ? 'PASS' : 'FAIL'})`);
  console.log(`  Sign flips: ${dFlipPct.toFixed(0)}% (${dFlipPct < 20 ? 'PASS' : 'FAIL'})`);

  await browser.close();
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
