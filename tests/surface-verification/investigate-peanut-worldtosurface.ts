/**
 * Investigate WHY peanut worldToSurface returns wrong V values
 */

import * as THREE from 'three';
import { PeanutSurface } from '../../src/surfaces/PeanutSurface';

const baseRadius = 6;
const waistDepth = 0.4;

function profileRadius(phi: number) {
  return baseRadius * (1 + waistDepth * Math.cos(2 * phi));
}

// Try to understand the search space at v=0.5 (phi=PI/2)
// worldPos from getPoint(u=0.5, v=0.5):
const s = new PeanutSurface();
const worldPt = s.getPoint(0.5, 0.5);
const worldPt2 = s.getPoint(0.063, 0.583);

console.log('=== Analyzing worldToSurface internals ===\n');
console.log(`getPoint(0.5, 0.5) = pos: (${worldPt.position.x.toFixed(3)}, ${worldPt.position.y.toFixed(3)}, ${worldPt.position.z.toFixed(3)})`);
console.log(`getPoint(0.063, 0.583) = pos: (${worldPt2.position.x.toFixed(3)}, ${worldPt2.position.y.toFixed(3)}, ${worldPt2.position.z.toFixed(3)})`);

// Manually replicate worldToSurface for point (0.063, 0.583)
const worldPos = worldPt2.position;
const xzDist = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z);
const totalDist = Math.sqrt(xzDist * xzDist + worldPos.y * worldPos.y);
const maxProfileR = baseRadius * (1 + waistDepth);
const estimatedScale = totalDist / maxProfileR;
const localXZ = xzDist / estimatedScale;
const localY = worldPos.y / estimatedScale;

console.log(`\nFor getPoint(0.063, 0.583) → worldPos=${JSON.stringify({x:worldPos.x.toFixed(3),y:worldPos.y.toFixed(3),z:worldPos.z.toFixed(3)})}`);
console.log(`  xzDist=${xzDist.toFixed(3)}, totalDist=${totalDist.toFixed(3)}`);
console.log(`  maxProfileR=${maxProfileR.toFixed(3)}, estimatedScale=${estimatedScale.toFixed(6)}`);
console.log(`  localXZ=${localXZ.toFixed(3)}, localY=${localY.toFixed(3)}`);

// Scan phi values
console.log('\nPhi scan (looking for minimum distance):');
const steps = 100;
let bestPhi = 0;
let bestDist = Infinity;
for (let i = 0; i <= steps; i++) {
  const phi = (i / steps) * Math.PI;
  const r = profileRadius(phi);
  const ringRadius = r * Math.sin(phi);
  const ringY = r * Math.cos(phi);
  const dist = Math.sqrt(
    (localXZ - ringRadius) * (localXZ - ringRadius) +
    (localY - ringY) * (localY - ringY)
  );
  if (dist < bestDist) {
    bestDist = dist;
    bestPhi = phi;
  }
  if (i % 10 === 0 || dist < 0.2) {
    console.log(`  phi=${phi.toFixed(4)} (v=${(phi/Math.PI).toFixed(3)}): r=${r.toFixed(3)}, ringXZ=${ringRadius.toFixed(3)}, ringY=${ringY.toFixed(3)}, dist=${dist.toFixed(4)} ${dist < bestDist + 0.001 ? '← best' : ''}`);
  }
}
console.log(`\n  Final: bestPhi=${bestPhi.toFixed(4)} (v=${(bestPhi/Math.PI).toFixed(3)}) | bestDist=${bestDist.toFixed(4)}`);
console.log(`  Expected: v=0.583 → phi=${(0.583 * Math.PI).toFixed(4)}`);

// The real phi should give us the actual point
const expectedPhi = 0.583 * Math.PI;
const r_expected = profileRadius(expectedPhi);
const ringRadius_expected = r_expected * Math.sin(expectedPhi);
const ringY_expected = r_expected * Math.cos(expectedPhi);
console.log(`\nExpected phi=${expectedPhi.toFixed(4)} (v=0.583):`);
console.log(`  r=${r_expected.toFixed(3)}, ringXZ=${ringRadius_expected.toFixed(3)}, ringY=${ringY_expected.toFixed(3)}`);
console.log(`  localXZ=${localXZ.toFixed(3)}, localY=${localY.toFixed(3)}`);
console.log(`  dist=${Math.sqrt((localXZ-ringRadius_expected)**2+(localY-ringY_expected)**2).toFixed(4)}`);

// Check the scale estimate issue — the bug might be in estimatedScale
console.log('\n=== Scale estimation bug investigation ===');
console.log(`Point is at v=0.583, NOT at maxProfileR`);
console.log(`  getPoint(u,v) produces a point at profile radius r(phi) = ${profileRadius(expectedPhi).toFixed(4)}`);
console.log(`  but worldToSurface estimates scale using maxProfileR = ${maxProfileR.toFixed(4)}`);
console.log(`  Actual world-space radius from origin: ${totalDist.toFixed(4)}`);
console.log(`  Actual local radius: r(phi)=${profileRadius(expectedPhi).toFixed(4)}`);
console.log(`  Scale ratio: ${(totalDist/profileRadius(expectedPhi)).toFixed(4)} (should be 1 for default surface)`);
