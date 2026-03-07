/**
 * Investigate peanut surface UV roundtrip bug
 */

import { PeanutSurface } from '../../src/surfaces/PeanutSurface';

const s = new PeanutSurface();

console.log('=== Peanut UV Roundtrip Investigation ===\n');

// Test the UV roundtrip at specific points
const testPoints = [
  {u: 0.063, v: 0.583},
  {u: 0.25, v: 0.5},
  {u: 0.5, v: 0.583},
  {u: 0.25, v: 0.25},
  {u: 0.75, v: 0.75},
  {u: 0.5, v: 0.3},
  {u: 0.0, v: 0.5},
  {u: 0.1, v: 0.4},
];

for (const p of testPoints) {
  const world = s.getPoint(p.u, p.v);
  const recovered = s.worldToSurface(world.position);
  const reWorld = s.getPoint(recovered.u, recovered.v);
  const posErr = world.position.distanceTo(reWorld.position);
  const vErr = Math.abs(recovered.v - p.v);
  const uErr = Math.abs(recovered.u - p.u);
  console.log(`  in=(${p.u.toFixed(3)},${p.v.toFixed(3)}) → out=(${recovered.u.toFixed(3)},${recovered.v.toFixed(3)}) | uErr=${uErr.toFixed(4)} vErr=${vErr.toFixed(4)} posErr=${posErr.toFixed(4)}`);
}

console.log('\n=== Speed near poles (U direction) ===\n');
const stepDu = 0.002;
for (const v of [0.03, 0.05, 0.08, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.92, 0.95, 0.97]) {
  const r1 = s.moveOnSurface(0.5, v, stepDu, 0);
  const d = s.getPoint(0.5, v).position.distanceTo(s.getPoint(r1.u, r1.v).position);
  console.log(`  v=${v.toFixed(2)}: U-step dist=${d.toFixed(4)}`);
}

console.log('\n=== Speed near poles (V direction) ===\n');
const stepDv = 0.002;
for (const v of [0.03, 0.05, 0.08, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.92, 0.95, 0.97]) {
  const r1 = s.moveOnSurface(0.5, v, 0, stepDv);
  const d = s.getPoint(0.5, v).position.distanceTo(s.getPoint(r1.u, r1.v).position);
  console.log(`  v=${v.toFixed(2)}: V-step dist=${d.toFixed(4)}`);
}
