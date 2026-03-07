/**
 * Verify the regression tests for PeanutSurface worldToSurface (s44o-05d)
 * Runs the test logic directly via tsx (since vitest can't run in worktrees)
 */

import { PeanutSurface } from '../../src/surfaces/PeanutSurface';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

console.log('=== PeanutSurface worldToSurface regression tests (s44o-05d) ===\n');

const surface = new PeanutSurface();

// Test 1: Position error < 0.1 world units
console.log('Test 1: worldToSurface recovers accurate world position');
const testPoints = [
  { u: 0.063, v: 0.583 },
  { u: 0.25, v: 0.5 },
  { u: 0.5, v: 0.3 },
  { u: 0.25, v: 0.25 },
  { u: 0.75, v: 0.75 },
  { u: 0.0, v: 0.5 },
  { u: 0.5, v: 0.7 },
];

for (const p of testPoints) {
  const worldPt = surface.getPoint(p.u, p.v);
  const recovered = surface.worldToSurface(worldPt.position);
  const reWorldPt = surface.getPoint(recovered.u, recovered.v);
  const posError = worldPt.position.distanceTo(reWorldPt.position);
  assert(posError < 0.1, `getPoint(${p.u},${p.v}) roundtrip posError=${posError.toFixed(4)} < 0.1`);
}

// Test 2: V error < 0.01 for interior points
console.log('\nTest 2: worldToSurface V error < 0.01 for interior points');
const interiorPoints = [
  { u: 0.25, v: 0.5 },
  { u: 0.5, v: 0.3 },
  { u: 0.5, v: 0.7 },
  { u: 0.75, v: 0.5 },
];

for (const p of interiorPoints) {
  const worldPt = surface.getPoint(p.u, p.v);
  const recovered = surface.worldToSurface(worldPt.position);
  const vError = Math.abs(recovered.v - p.v);
  assert(vError < 0.01, `getPoint(${p.u},${p.v}) vError=${vError.toFixed(4)} < 0.01`);
}

// OLD behavior test (document what the bug was)
console.log('\n=== What the bug looked like (before fix) ===');
console.log('   Point getPoint(0.063, 0.583) would return:');
console.log('   worldToSurface → v=0.680 (off by 0.097, posErr=1.7 world units)');
console.log('   (Due to wrong scale: estimatedScale = totalDist / maxProfileR)');
console.log('   With fix: v=0.580 (off by 0.003 = scan resolution only)');

console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('❌ REGRESSION TESTS FAILED');
  process.exit(1);
} else {
  console.log('✅ All regression tests passed');
}
