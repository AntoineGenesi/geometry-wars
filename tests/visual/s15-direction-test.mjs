#!/usr/bin/env node
/**
 * S15 Direction Test — Precise screen-space measurement of WASD movement.
 * Makes player invincible so enemies don't interfere.
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
  console.log('=== S15 WASD Direction Test ===\n');

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

  // Make player invincible by monkey-patching takeDamage
  console.log('3. Making player invincible...');
  await page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg || !dbg.player) return;
    dbg.player.lives = 99;
    // Override takeDamage to do nothing
    dbg.player.takeDamage = () => {};
    // Also override die
    dbg.player.die = () => {};
    // Ensure alive
    if (!dbg.player.alive) {
      dbg.player.alive = true;
      dbg.player.health = 1;
    }
    console.log('[TEST] Player made invincible');
  });

  // Wait a bit more for game to settle
  await sleep(5000);

  // Read state
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

  // Test each direction
  const tests = [
    { key: 'd', label: 'D', expected: 'RIGHT' },
    { key: 'a', label: 'A', expected: 'LEFT' },
    { key: 'w', label: 'W', expected: 'UP' },
    { key: 's', label: 'S', expected: 'DOWN' },
  ];

  const results = [];
  console.log('\n=== DIRECTION MEASUREMENTS ===\n');

  for (const test of tests) {
    // Read camera and position JUST before pressing (single evaluate)
    const before = await page.evaluate(() => {
      const dbg = window.__gameDebug;
      const p = dbg.player;
      const cam = dbg.game.camera;
      return {
        px: p.mesh.position.x, py: p.mesh.position.y, pz: p.mesh.position.z,
        qx: cam.quaternion.x, qy: cam.quaternion.y, qz: cam.quaternion.z, qw: cam.quaternion.w,
        alive: p.alive,
      };
    });

    if (!before.alive) {
      console.log(`  ${test.label}: SKIP (player dead)`);
      continue;
    }

    // Press key — NO evaluate during hold!
    await page.keyboard.down(test.key);
    await sleep(3000); // 3 seconds = ~180 game frames
    await page.keyboard.up(test.key);
    await sleep(200);

    // Read position after
    const after = await page.evaluate(() => {
      const dbg = window.__gameDebug;
      const p = dbg.player;
      return {
        px: p.mesh.position.x, py: p.mesh.position.y, pz: p.mesh.position.z,
        alive: p.alive,
      };
    });

    const disp = {
      x: after.px - before.px,
      y: after.py - before.py,
      z: after.pz - before.pz,
    };
    const { right: camR, up: camU } = getCameraAxes(before.qx, before.qy, before.qz, before.qw);
    const sr = dot(disp, camR);
    const su = dot(disp, camU);
    const total = vlen(disp);

    const dir = total < 0.05 ? 'NONE' :
      Math.abs(sr) > Math.abs(su) ? (sr > 0 ? 'RIGHT' : 'LEFT') : (su > 0 ? 'UP' : 'DOWN');
    const pass = dir === test.expected;
    const angle = total > 0.05 ? Math.atan2(su, sr) * 180 / Math.PI : NaN;

    console.log(`  ${test.label} key (expect ${test.expected}):`);
    console.log(`    Displacement: (${disp.x.toFixed(3)}, ${disp.y.toFixed(3)}, ${disp.z.toFixed(3)}) len=${total.toFixed(3)}`);
    console.log(`    Screen R=${sr.toFixed(3)} U=${su.toFixed(3)} → ${dir} (angle=${isNaN(angle)?'N/A':angle.toFixed(1)}°)`);
    console.log(`    ${pass ? 'PASS' : 'FAIL'}`);
    console.log('');

    results.push({ key: test.key, label: test.label, expected: test.expected, actual: dir, pass, sr, su, total, angle });

    // Brief pause between tests
    await sleep(500);
  }

  // Summary
  console.log('=== SUMMARY ===');
  let allPass = true;
  for (const r of results) {
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${r.label}: ${r.actual} (expect ${r.expected}) | R=${r.sr.toFixed(2)} U=${r.su.toFixed(2)} |d|=${r.total.toFixed(2)} angle=${isNaN(r.angle)?'N/A':r.angle.toFixed(0)}°`);
    if (!r.pass) allPass = false;
  }

  console.log(`\n${allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);

  await browser.close();
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
