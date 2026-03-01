/**
 * Regression test: S43-06 — Peanut movement speed uniform across all surface regions.
 *
 * BUG REPORT: "whenever you go onto one of the big bits, like the big curved bits,
 * your guy moves slower."
 *
 * INVESTIGATION FINDINGS:
 * - Linear world-space speed IS constant (±0.6% average) — confirmed by direct measurement.
 * - No curvature-dependent speed modifier exists in MeshWalker, MeshSurface, or FaceWalker.
 * - moveGeodesic correctly scales distance by inverse surface scale (getMaxScaleOnAxis).
 * - FaceWalker.walk() computes worldDistPerT correctly per face using geometry.
 *
 * ROOT CAUSE OF PERCEPTION:
 * The peanut has extreme radius variation: bulge r≈16.78, waist r≈7.20 (ratio 2.33x).
 * At constant linear speed (6 m/s), angular traversal speed varies 2.33x:
 *   - bulge: 0.358 rad/s (large circumference, covers less per second)
 *   - waist: 0.833 rad/s (small circumference, covers more per second)
 * This makes the bulge FEEL slower even though linear speed is identical.
 * This is expected behavior — the peanut geometry has genuinely different scales.
 *
 * REGRESSION GUARD: All walker.move() measurements must stay within 10% of target speed.
 * If this test fails, a curvature-dependent speed modifier was accidentally introduced.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PeanutSurface } from '../surfaces/PeanutSurface';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';

const PLAYER_SPEED = 6.0; // PLAYER_MOVE_SPEED * EPIC_SCALE = 3.0 * 2.0
const EPIC_SCALE = 2.0;
const DT = 1 / 60;
const TOLERANCE = 0.10; // 10% tolerance on average speed across regions

/**
 * Measure average world-space speed at a given peanut surface location.
 * Uses walker.move() with the walker's bitangent direction (bypasses camera).
 * Runs 20 frames and returns the average speed.
 */
function measureAverageSpeedAt(phi_rad: number): number {
  const peanut = new PeanutSurface();
  const scene = new THREE.Scene();
  scene.add(peanut.group);
  peanut.group.scale.setScalar(EPIC_SCALE);
  peanut.mesh.updateMatrixWorld(true);

  const meshSurface = new MeshSurface(peanut.mesh);
  const startPoint = peanut.getPoint(0, phi_rad / Math.PI);
  const walker = new MeshWalker(meshSurface, startPoint.position, PLAYER_SPEED);

  // Warm up 5 frames to stabilize tangent frame
  for (let i = 0; i < 5; i++) {
    walker.move(walker.bitangent.clone(), DT);
  }

  // Measure 20 frames
  let totalDist = 0;
  const prevPos = walker.position.clone();
  for (let i = 0; i < 20; i++) {
    walker.move(walker.bitangent.clone(), DT);
    totalDist += walker.position.distanceTo(prevPos);
    prevPos.copy(walker.position);
  }

  return totalDist / (20 * DT);
}

describe('S43-06: Peanut speed uniform across all surface regions', () => {
  it('speed on bulge (phi=17°) is within 10% of target', () => {
    const avgSpeed = measureAverageSpeedAt(0.3); // phi≈17°, upper bulge
    expect(avgSpeed).toBeGreaterThan(PLAYER_SPEED * (1 - TOLERANCE));
    expect(avgSpeed).toBeLessThan(PLAYER_SPEED * (1 + TOLERANCE));
  });

  it('speed at mid-bulge (phi=34°) is within 10% of target', () => {
    const avgSpeed = measureAverageSpeedAt(0.6); // phi≈34°, mid bulge
    expect(avgSpeed).toBeGreaterThan(PLAYER_SPEED * (1 - TOLERANCE));
    expect(avgSpeed).toBeLessThan(PLAYER_SPEED * (1 + TOLERANCE));
  });

  it('speed at lower bulge (phi=52°) is within 10% of target', () => {
    const avgSpeed = measureAverageSpeedAt(0.9); // phi≈52°, lower bulge
    expect(avgSpeed).toBeGreaterThan(PLAYER_SPEED * (1 - TOLERANCE));
    expect(avgSpeed).toBeLessThan(PLAYER_SPEED * (1 + TOLERANCE));
  });

  it('speed at waist/equator (phi=90°) is within 10% of target', () => {
    const avgSpeed = measureAverageSpeedAt(Math.PI / 2); // phi=90°, waist
    expect(avgSpeed).toBeGreaterThan(PLAYER_SPEED * (1 - TOLERANCE));
    expect(avgSpeed).toBeLessThan(PLAYER_SPEED * (1 + TOLERANCE));
  });

  it('speed variation between bulge and waist is less than 10% of target', () => {
    // All regions should have similar average speeds — no curvature-dependent scaling.
    const testPhis = [0.3, 0.6, 0.9, Math.PI / 2, Math.PI - 0.9, Math.PI - 0.3];
    const speeds = testPhis.map(phi => measureAverageSpeedAt(phi));

    const minSpeed = Math.min(...speeds);
    const maxSpeed = Math.max(...speeds);
    const variation = maxSpeed - minSpeed;

    // All averages within 10% of target and within 10% of each other
    for (const speed of speeds) {
      expect(speed).toBeGreaterThan(PLAYER_SPEED * (1 - TOLERANCE));
      expect(speed).toBeLessThan(PLAYER_SPEED * (1 + TOLERANCE));
    }

    // Variation between min and max is within 10% of target speed
    expect(variation).toBeLessThan(PLAYER_SPEED * TOLERANCE);
  });
});
