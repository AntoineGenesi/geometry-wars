#!/usr/bin/env node
/**
 * S15 Movement Precision Diagnostic
 *
 * Measures EXACT player position changes during WASD key presses.
 * Keeps player alive by setting high lives count.
 */
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const screenshotDir = join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

const PORT = process.env.PORT || 3025;
const URL = `http://localhost:${PORT}/?quickStart=true&surface=sphere`;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function readGameState(page) {
  return page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg || !dbg.player || !dbg.game) return null;
    const cam = dbg.game.camera;
    const pos = dbg.player.mesh.position;
    return {
      alive: dbg.player.alive,
      lives: dbg.player.lives,
      px: pos.x, py: pos.y, pz: pos.z,
      cx: cam.position.x, cy: cam.position.y, cz: cam.position.z,
      qx: cam.quaternion.x, qy: cam.quaternion.y, qz: cam.quaternion.z, qw: cam.quaternion.w,
    };
  });
}

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
function len(v) { return Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); }

async function ensureAlive(page) {
  return page.evaluate(() => {
    const dbg = window.__gameDebug;
    if (!dbg || !dbg.player) return false;
    // Set high lives and respawn if dead
    dbg.player.lives = 99;
    if (!dbg.player.alive) {
      dbg.player.respawn(0.5, 0.5);
      // Also reset walker position to surface center
      if (dbg.playerWalker) {
        // Walker might not be on minimal API, skip if not available
      }
    }
    return dbg.player.alive;
  });
}

async function testKey(page, key, label, holdMs = 5000) {
  // Ensure player alive
  await ensureAlive(page);
  await sleep(500);

  const before = await readGameState(page);
  if (!before) { console.log(`  [${label}] SKIP: no state`); return null; }
  if (!before.alive) { console.log(`  [${label}] SKIP: player dead`); return null; }

  await page.keyboard.down(key);
  await sleep(holdMs);
  await page.keyboard.up(key);
  await sleep(300);

  const after = await readGameState(page);
  if (!after) { console.log(`  [${label}] SKIP: state lost`); return null; }

  const disp = { x: after.px - before.px, y: after.py - before.py, z: after.pz - before.pz };
  const { right, up } = getCameraAxes(before.qx, before.qy, before.qz, before.qw);
  const sr = dot(disp, right);
  const su = dot(disp, up);
  const total = len(disp);

  console.log(`  [${label}] Key '${key}' ${holdMs}ms | alive=${before.alive} lives=${before.lives}`);
  console.log(`    Before: (${before.px.toFixed(3)}, ${before.py.toFixed(3)}, ${before.pz.toFixed(3)})`);
  console.log(`    After:  (${after.px.toFixed(3)}, ${after.py.toFixed(3)}, ${after.pz.toFixed(3)})`);
  console.log(`    Displacement: (${disp.x.toFixed(3)}, ${disp.y.toFixed(3)}, ${disp.z.toFixed(3)}) len=${total.toFixed(3)}`);
  console.log(`    Screen-right: ${sr.toFixed(3)} | Screen-up: ${su.toFixed(3)}`);
  console.log(`    Camera right: (${right.x.toFixed(3)}, ${right.y.toFixed(3)}, ${right.z.toFixed(3)})`);
  console.log(`    Camera up:    (${up.x.toFixed(3)}, ${up.y.toFixed(3)}, ${up.z.toFixed(3)})`);

  if (total < 0.01) {
    console.log(`    >> NO MOVEMENT`);
  } else {
    const angle = Math.atan2(su, sr) * 180 / Math.PI;
    console.log(`    >> Screen angle: ${angle.toFixed(1)}° (0=R, 90=U, ±180=L, -90=D)`);
  }

  return { key, label, disp, total, sr, su, right, up };
}

async function run() {
  console.log('=== S15 Movement Precision Diagnostic ===');
  console.log(`URL: ${URL}\n`);

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

  const errors = [];
  page.on('pageerror', err => { errors.push(err.message); });

  try {
    console.log('1. Loading game...');
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for game to start (SwiftShader is slow)
    console.log('2. Waiting 15s for game init...');
    await sleep(15000);

    // Set player lives high immediately
    await page.evaluate(() => {
      const check = () => {
        const dbg = window.__gameDebug;
        if (dbg && dbg.player) {
          dbg.player.lives = 99;
          console.log('[DIAG] Set player lives to 99');
          return true;
        }
        return false;
      };
      if (!check()) {
        // Retry every second
        const interval = setInterval(() => {
          if (check()) clearInterval(interval);
        }, 1000);
      }
    });

    console.log('3. Waiting 15s more for countdown + gameplay...');
    await sleep(15000);

    // Ensure alive
    const alive = await ensureAlive(page);
    console.log(`4. Player alive: ${alive}`);

    if (!alive) {
      console.log('   Trying harder: respawn + set lives...');
      await page.evaluate(() => {
        const dbg = window.__gameDebug;
        if (dbg && dbg.player) {
          dbg.player.lives = 99;
          dbg.player.alive = true;
          dbg.player.health = 1;
          // Manually set position if possible
          dbg.player.mesh.position.set(-10, 0, 0);
          console.log('[DIAG] Force-revived player');
        }
      });
      await sleep(2000);
    }

    const state = await readGameState(page);
    if (!state) {
      console.log('FATAL: No game state');
      await page.screenshot({ path: join(screenshotDir, 's15-precision-FAIL.png') });
      return;
    }
    console.log(`5. Player at (${state.px.toFixed(2)}, ${state.py.toFixed(2)}, ${state.pz.toFixed(2)}) alive=${state.alive} lives=${state.lives}`);
    console.log(`   Camera at (${state.cx.toFixed(2)}, ${state.cy.toFixed(2)}, ${state.cz.toFixed(2)})`);

    await page.screenshot({ path: join(screenshotDir, 's15-precision-01-before.png') });

    console.log('\n=== DIRECTION TESTS (expect D=right, A=left, W=up, S=down) ===\n');

    const results = [];
    results.push(await testKey(page, 'd', 'D→RIGHT', 5000));
    await page.screenshot({ path: join(screenshotDir, 's15-precision-02-afterD.png') });
    await sleep(500);

    results.push(await testKey(page, 'a', 'A→LEFT', 5000));
    await page.screenshot({ path: join(screenshotDir, 's15-precision-03-afterA.png') });
    await sleep(500);

    results.push(await testKey(page, 'w', 'W→UP', 5000));
    await page.screenshot({ path: join(screenshotDir, 's15-precision-04-afterW.png') });
    await sleep(500);

    results.push(await testKey(page, 's', 'S→DOWN', 5000));
    await page.screenshot({ path: join(screenshotDir, 's15-precision-05-afterS.png') });

    // Summary
    console.log('\n=== SUMMARY ===');
    for (const r of results) {
      if (!r) continue;
      const dir = r.total < 0.01 ? 'NONE' :
        Math.abs(r.sr) > Math.abs(r.su) ? (r.sr > 0 ? 'RIGHT' : 'LEFT') : (r.su > 0 ? 'UP' : 'DOWN');
      const expected = { d: 'RIGHT', a: 'LEFT', w: 'UP', s: 'DOWN' }[r.key];
      const pass = dir === expected;
      console.log(`  ${pass ? 'PASS' : 'FAIL'} | '${r.key}': ${dir} (expect ${expected}) | R=${r.sr.toFixed(2)} U=${r.su.toFixed(2)} |disp|=${r.total.toFixed(2)}`);
    }

    if (errors.length > 0) console.log(`\n  ${errors.length} page errors`);

    fs.writeFileSync(join(screenshotDir, 's15-precision-report.json'), JSON.stringify({ results, errors }, null, 2));
    console.log('\nReport saved.');

  } catch (err) {
    console.error('Error:', err);
    await page.screenshot({ path: join(screenshotDir, 's15-precision-error.png') }).catch(() => {});
  } finally {
    await browser.close();
  }
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
