/**
 * Regression tests for torus UV parameterization in _worldPosToApproxUV (s44o-04b + s44p-04).
 *
 * s44o-04b bug: Server used sphere parameterization (u=azimuthal/longitude, v=polar) for ALL surfaces.
 * For torus, the sphere u maps to torus v (ring angle) and sphere v maps to torus u (tube angle).
 * This swapped-axis caused torusChordDist to receive wrong UV, producing ghost kills and
 * bullets spawning at wrong torus positions.
 *
 * s44p-04 bug: The s44o-04b fix introduced Math.atan2(wy, outward) in the torus branch, but
 * TorusSurface stores y = -r*sin(theta) (not +r*sin(theta)) due to geometry.rotateX(π/2).
 * The +wy sign returns the mirror-image tube angle → bullets spawn on wrong side of tube.
 * Fix: use Math.atan2(-wy, outward) to recover the correct tube angle.
 *
 * These tests validate the math in isolation (no Colyseus required).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the exact torus UV inversion from GameRoom._worldPosToApproxUV (corrected)
// ---------------------------------------------------------------------------

// s44q-04: MUST match GameRoom's constants (8,3) which match client createStandardSurfaceConfig.
const TORUS_MAJOR_R = 8;
const TORUS_MINOR_R = 3;

/**
 * Corrected worldToUV matching GameRoom._worldPosToApproxUV after s44p-04 fix.
 * Uses Math.atan2(-wy, outward) to account for TorusSurface y = -r*sin(theta).
 */
function torusWorldToUV(wx: number, wy: number, wz: number): { u: number; v: number } {
  const R = TORUS_MAJOR_R;
  // v = ring angle (phi) from xz-plane angle
  const phi = Math.atan2(wz, wx);
  const v = ((phi / (2 * Math.PI)) + 1) % 1;
  // Tube center lies at (R*cos(phi), 0, R*sin(phi))
  // outward component from tube center in xz-plane = r*cos(theta)
  const outward = wx * Math.cos(phi) + wz * Math.sin(phi) - R;
  // u = tube angle: atan2(-y, outward_from_tube) / 2π
  // NEGATED wy because TorusSurface stores y = -r*sin(theta) (geometry.rotateX(π/2) orientation)
  const theta = Math.atan2(-wy, outward);
  const u = ((theta / (2 * Math.PI)) + 1) % 1;
  return { u, v };
}

/**
 * Torus getPoint: mirrors TorusSurface.getPointLocal exactly.
 * IMPORTANT: y = -r*sin(theta) (negative sign — matches geometry.rotateX(π/2) mesh orientation).
 */
function torusGetPoint(u: number, v: number): { x: number; y: number; z: number } {
  const R = TORUS_MAJOR_R;
  const r = TORUS_MINOR_R;
  const theta = u * 2 * Math.PI; // tube/minor angle
  const phi = v * 2 * Math.PI;   // ring/major angle
  return {
    x: (R + r * Math.cos(theta)) * Math.cos(phi),
    y: -r * Math.sin(theta),  // NEGATIVE: matches TorusSurface geometry.rotateX(π/2)
    z: (R + r * Math.cos(theta)) * Math.sin(phi),
  };
}

// ---------------------------------------------------------------------------
// Tests: torus UV round-trip accuracy (with corrected formulas)
// ---------------------------------------------------------------------------

describe('torus _worldPosToApproxUV — accurate parametric inversion (s44o-04b + s44p-04 fix)', () => {

  it('outer edge at ring angle 0 → u=0, v=0', () => {
    // Outer edge (u=0): tube angle=0, sin(0)=0 → y=0, max outward
    // Ring angle 0 (v=0): along +x axis
    const { x, y, z } = torusGetPoint(0, 0); // (R+r, 0, 0) = (11, 0, 0)
    expect(y).toBeCloseTo(0, 4); // y=0 at outer edge (sinTheta=0)
    const uv = torusWorldToUV(x, y, z);
    expect(uv.u).toBeCloseTo(0, 4); // outer tube edge
    expect(uv.v).toBeCloseTo(0, 4); // ring angle 0
  });

  it('inner edge at ring angle 0 → u=0.5, v=0', () => {
    // Inner edge (u=0.5): tube angle=π, sin(π)=0 → y=0, minimum outward
    const { x, y, z } = torusGetPoint(0.5, 0); // (R-r, 0, 0) = (5, 0, 0)
    expect(y).toBeCloseTo(0, 4); // y=0 at inner edge (sinTheta=0)
    const uv = torusWorldToUV(x, y, z);
    expect(uv.u).toBeCloseTo(0.5, 4); // inner tube edge
    expect(uv.v).toBeCloseTo(0, 4);   // ring angle 0
  });

  it('top of tube at ring angle 0 → u=0.25, v=0 [KEY: y=-r, not +r]', () => {
    // Top of tube (u=0.25): tube angle=π/2, cos(π/2)=0, sin(π/2)=1
    // TorusSurface: y = -r*sin(π/2) = -r = -3 (NEGATIVE — matches rotateX(π/2))
    const { x, y, z } = torusGetPoint(0.25, 0); // (R, -r, 0) = (8, -3, 0)
    expect(x).toBeCloseTo(TORUS_MAJOR_R, 4); // x = R (tube center in xz plane)
    expect(y).toBeCloseTo(-TORUS_MINOR_R, 4); // y = -r (top of tube is BELOW in world coords)
    expect(z).toBeCloseTo(0, 4);
    const uv = torusWorldToUV(x, y, z);
    expect(uv.u).toBeCloseTo(0.25, 4); // top of tube
    expect(uv.v).toBeCloseTo(0, 4);    // ring angle 0
  });

  it('bottom of tube at ring angle 0 → u=0.75, v=0 [KEY: y=+r, not -r]', () => {
    // Bottom of tube (u=0.75): tube angle=3π/2, cos(3π/2)=0, sin(3π/2)=-1
    // TorusSurface: y = -r*sin(3π/2) = -r*(-1) = +r = +3 (POSITIVE)
    const { x, y, z } = torusGetPoint(0.75, 0); // (R, +r, 0) = (8, +3, 0)
    expect(x).toBeCloseTo(TORUS_MAJOR_R, 4); // x = R
    expect(y).toBeCloseTo(+TORUS_MINOR_R, 4); // y = +r (bottom of tube is ABOVE in world coords)
    expect(z).toBeCloseTo(0, 4);
    const uv = torusWorldToUV(x, y, z);
    expect(uv.u).toBeCloseTo(0.75, 4); // bottom of tube
    expect(uv.v).toBeCloseTo(0, 4);    // ring angle 0
  });

  it('outer edge at ring angle 0.25 (along +z axis) → u=0, v=0.25', () => {
    const { x, y, z } = torusGetPoint(0, 0.25); // (0, 0, R+r) = (0, 0, 11)
    const uv = torusWorldToUV(x, y, z);
    expect(uv.u).toBeCloseTo(0, 4);    // outer tube edge
    expect(uv.v).toBeCloseTo(0.25, 4); // ring angle 0.25 (90°)
  });

  it('outer edge at ring angle 0.5 (along -x axis) → u=0, v=0.5', () => {
    const { x, y, z } = torusGetPoint(0, 0.5); // (-(R+r), 0, 0) = (-11, 0, 0)
    const uv = torusWorldToUV(x, y, z);
    expect(uv.u).toBeCloseTo(0, 4);   // outer tube edge
    expect(uv.v).toBeCloseTo(0.5, 4); // ring angle 0.5 (180°)
  });

  it('round-trip: getPoint → worldToUV matches original UV', () => {
    // Sample several UV coordinates, convert to world (using TorusSurface formula),
    // then back to UV using the corrected formula.
    const testCases = [
      { u: 0.0,  v: 0.0  },
      { u: 0.25, v: 0.0  },
      { u: 0.5,  v: 0.0  },
      { u: 0.75, v: 0.0  },
      { u: 0.0,  v: 0.25 },
      { u: 0.0,  v: 0.5  },
      { u: 0.0,  v: 0.75 },
      { u: 0.3,  v: 0.7  },
      { u: 0.1,  v: 0.9  },
    ];

    for (const { u, v } of testCases) {
      const { x, y, z } = torusGetPoint(u, v);
      const recovered = torusWorldToUV(x, y, z);
      // Account for UV wrap-around at u=0/1 boundary
      const uErr = Math.min(Math.abs(recovered.u - u), 1 - Math.abs(recovered.u - u));
      expect(uErr).toBeLessThan(0.001);
      expect(recovered.v).toBeCloseTo(v, 3);
    }
  });

  it('OLD sphere parameterization would give swapped axes for torus outer edge at ring angle 0', () => {
    // World pos at outer edge (u=0), ring angle 0 (v=0): (R+r, 0, 0) = (11, 0, 0)
    const wx = TORUS_MAJOR_R + TORUS_MINOR_R, wy = 0, wz = 0;

    // OLD sphere parameterization:
    const r = Math.sqrt(wx * wx + wy * wy + wz * wz); // R+r
    const sphereV = Math.acos(Math.max(-1, Math.min(1, wy / r))) / Math.PI; // 0.5 (equator)
    const sphereU = ((Math.atan2(wz, wx) / (2 * Math.PI)) + 1) % 1; // 0 (along +x)

    // sphere gave: u=0, v=0.5 — but torus should be u=0, v=0
    // v is WRONG (0.5 instead of 0)
    expect(sphereU).toBeCloseTo(0, 4);
    expect(sphereV).toBeCloseTo(0.5, 4); // WRONG: sphere v=0.5 instead of torus v=0

    // NEW torus parameterization gives correct result:
    const correct = torusWorldToUV(wx, wy, wz);
    expect(correct.u).toBeCloseTo(0, 4); // correct: tube angle 0 = outer edge
    expect(correct.v).toBeCloseTo(0, 4); // correct: ring angle 0
  });

  it('s44p-04: OLD s44o-04b fix had +wy bug — top of tube returned wrong u', () => {
    // TorusSurface top of tube: u=0.25, y = -r = -3 (negative y)
    // OLD (s44o-04b): Math.atan2(+wy, outward) = atan2(-3, 0) = -π/2 → u = 0.75 (WRONG: bottom)
    // NEW (s44p-04): Math.atan2(-wy, outward) = atan2(+3, 0) = +π/2 → u = 0.25 (CORRECT: top)
    const wx = TORUS_MAJOR_R; // 8 (tube center x at ring 0)
    const wy = -TORUS_MINOR_R; // -3 (TorusSurface top-of-tube y is NEGATIVE)
    const wz = 0;

    // Old formula (bug): uses +wy
    const phi = Math.atan2(wz, wx);
    const outward = wx * Math.cos(phi) + wz * Math.sin(phi) - TORUS_MAJOR_R;
    const thetaOld = Math.atan2(wy, outward);   // atan2(-3, 0) = -π/2
    const uOld = ((thetaOld / (2 * Math.PI)) + 1) % 1; // → 0.75 (bottom of tube, WRONG)

    // New formula (fix): uses -wy
    const thetaNew = Math.atan2(-wy, outward);  // atan2(+3, 0) = +π/2
    const uNew = ((thetaNew / (2 * Math.PI)) + 1) % 1; // → 0.25 (top of tube, CORRECT)

    expect(uOld).toBeCloseTo(0.75, 4); // OLD BUG: maps top-of-tube world pos to bottom-of-tube UV
    expect(uNew).toBeCloseTo(0.25, 4); // NEW FIX: correctly recovers u=0.25 (top of tube)
  });

  it('torusChordDist with correct UV gives near-zero distance for same point', () => {
    // Verify that with correct UV, two representations of the same world point give ~0 distance.
    const u = 0.1, v = 0.3;
    const { x, y, z } = torusGetPoint(u, v);
    const recovered = torusWorldToUV(x, y, z);

    // torusChordDist math (inlined for test isolation):
    // Note: dy uses r*sin(theta) which is equivalent to -y (since y = -r*sin(theta)).
    // The sign cancels in |dy|^2, so chord distance is correct regardless of sign convention.
    const R = TORUS_MAJOR_R;
    const r = TORUS_MINOR_R;
    const theta1 = u * 2 * Math.PI, phi1 = v * 2 * Math.PI;
    const theta2 = recovered.u * 2 * Math.PI, phi2 = recovered.v * 2 * Math.PI;
    const dx = (R + r * Math.cos(theta1)) * Math.cos(phi1) - (R + r * Math.cos(theta2)) * Math.cos(phi2);
    const dy = r * Math.sin(theta1) - r * Math.sin(theta2); // sign ok — only used as dy^2
    const dz = (R + r * Math.cos(theta1)) * Math.sin(phi1) - (R + r * Math.cos(theta2)) * Math.sin(phi2);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    expect(dist).toBeLessThan(0.001); // same point = ~0 chord distance
  });

  it('ghost kill scenario: bullet at top of tube should NOT hit enemy at bottom of tube', () => {
    // With the s44p-04 fix, a player at the top of the tube (u≈0.25) should have their
    // server surfaceU set to 0.25, NOT 0.75 (bottom of tube).
    // This ensures torusChordDist(bullet.u, ..., enemy.u, ...) uses the correct UV,
    // preventing ghost kills where the server thinks a bullet is at the bottom of the tube
    // but the client renders it at the top.

    const BULLET_HIT_WORLD = 0.4; // server threshold
    const R = TORUS_MAJOR_R;
    const r = TORUS_MINOR_R;

    // Player is at top of tube (u=0.25), shooting a bullet.
    // After fix: bullet has u=0.25.
    // Enemy is at bottom of tube (u=0.75) — same ring angle.
    // True chord distance = 2*r = 6 world units (diameter of tube cross-section).
    const bulletU = 0.25, bulletV = 0;
    const enemyU = 0.75, enemyV = 0;

    // Compute actual chord distance between bullet and enemy positions
    const bt1 = bulletU * 2 * Math.PI, bp1 = bulletV * 2 * Math.PI;
    const et1 = enemyU * 2 * Math.PI, ep1 = enemyV * 2 * Math.PI;
    const dx = (R + r * Math.cos(bt1)) * Math.cos(bp1) - (R + r * Math.cos(et1)) * Math.cos(ep1);
    const dy = r * Math.sin(bt1) - r * Math.sin(et1);
    const dz = (R + r * Math.cos(bt1)) * Math.sin(bp1) - (R + r * Math.cos(et1)) * Math.sin(ep1);
    const trueDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // True distance between top and bottom of tube = 2*r = 4 world units
    expect(trueDist).toBeCloseTo(2 * r, 1); // ~4 world units

    // With correct bullet UV (u=0.25), no ghost kill (4 >> 0.4)
    expect(trueDist).toBeGreaterThan(BULLET_HIT_WORLD * 3); // way beyond threshold

    // With OLD buggy UV (u=0.75 due to +wy), bullet and enemy appear at same position:
    const buggyBulletU = 0.75; // what the old code returned for top-of-tube player
    const bt2 = buggyBulletU * 2 * Math.PI;
    const dx2 = (R + r * Math.cos(bt2)) * Math.cos(bp1) - (R + r * Math.cos(et1)) * Math.cos(ep1);
    const dy2 = r * Math.sin(bt2) - r * Math.sin(et1);
    const dz2 = (R + r * Math.cos(bt2)) * Math.sin(bp1) - (R + r * Math.cos(et1)) * Math.sin(ep1);
    const buggyDist = Math.sqrt(dx2 * dx2 + dy2 * dy2 + dz2 * dz2);

    // OLD: bullet and enemy appear at same UV → distance ≈ 0 → GHOST KILL
    expect(buggyDist).toBeLessThan(0.001);   // same position = false hit!
    expect(buggyDist).toBeLessThan(BULLET_HIT_WORLD); // would register as a hit
  });
});
