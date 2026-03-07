/**
 * Regression tests for torus UV parameterization in _worldPosToApproxUV (s44o-04b).
 *
 * Bug: Server used sphere parameterization (u=azimuthal/longitude, v=polar) for ALL surfaces.
 * For torus, the sphere u maps to torus v (ring angle) and sphere v maps to torus u (tube angle).
 * This swapped-axis caused torusChordDist to receive wrong UV, producing ghost kills and
 * bullets spawning at wrong torus positions.
 *
 * Fix: _worldPosToApproxUV now handles torus specially using accurate torus parametric inversion.
 * These tests validate the math in isolation (no Colyseus required).
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the exact torus UV inversion from GameRoom._worldPosToApproxUV
// ---------------------------------------------------------------------------

const TORUS_MAJOR_R = 6;
const TORUS_MINOR_R = 2;

function torusWorldToUV(wx: number, wy: number, wz: number): { u: number; v: number } {
  const R = TORUS_MAJOR_R;
  // v = ring angle (phi) from xz-plane angle
  const phi = Math.atan2(wz, wx);
  const v = ((phi / (2 * Math.PI)) + 1) % 1;
  // Tube center lies at (R*cos(phi), 0, R*sin(phi))
  // outward component from tube center in xz-plane = r*cos(theta)
  const outward = wx * Math.cos(phi) + wz * Math.sin(phi) - R;
  // u = tube angle: atan2(y, outward_from_tube) / 2π
  const theta = Math.atan2(wy, outward);
  const u = ((theta / (2 * Math.PI)) + 1) % 1;
  return { u, v };
}

/** Torus getPoint: same as TorusSurface.getPointLocal */
function torusGetPoint(u: number, v: number): { x: number; y: number; z: number } {
  const R = TORUS_MAJOR_R;
  const r = TORUS_MINOR_R;
  const theta = u * 2 * Math.PI; // tube/minor angle
  const phi = v * 2 * Math.PI;   // ring/major angle
  return {
    x: (R + r * Math.cos(theta)) * Math.cos(phi),
    y: r * Math.sin(theta),
    z: (R + r * Math.cos(theta)) * Math.sin(phi),
  };
}

// ---------------------------------------------------------------------------
// Tests: torus UV round-trip accuracy
// ---------------------------------------------------------------------------

describe('torus _worldPosToApproxUV — accurate parametric inversion (s44o-04b fix)', () => {

  it('outer edge at ring angle 0 → u=0, v=0', () => {
    // Outer edge (u=0): tube angle=0, max outward from ring
    // Ring angle 0 (v=0): along +x axis
    const wx = TORUS_MAJOR_R + TORUS_MINOR_R; // 8
    const wy = 0;
    const wz = 0;
    const uv = torusWorldToUV(wx, wy, wz);
    expect(uv.u).toBeCloseTo(0, 4); // outer tube edge
    expect(uv.v).toBeCloseTo(0, 4); // ring angle 0
  });

  it('inner edge at ring angle 0 → u=0.5, v=0', () => {
    // Inner edge (u=0.5): tube angle=π, minimum outward
    const wx = TORUS_MAJOR_R - TORUS_MINOR_R; // 4
    const wy = 0;
    const wz = 0;
    const uv = torusWorldToUV(wx, wy, wz);
    expect(uv.u).toBeCloseTo(0.5, 4); // inner tube edge
    expect(uv.v).toBeCloseTo(0, 4);   // ring angle 0
  });

  it('top of tube at ring angle 0 → u=0.25, v=0', () => {
    // Top of tube (u=0.25): tube angle=π/2, y=+r
    const wx = TORUS_MAJOR_R; // 6
    const wy = TORUS_MINOR_R; // 2
    const wz = 0;
    const uv = torusWorldToUV(wx, wy, wz);
    expect(uv.u).toBeCloseTo(0.25, 4); // top of tube
    expect(uv.v).toBeCloseTo(0, 4);    // ring angle 0
  });

  it('outer edge at ring angle 0.25 (along +z axis) → u=0, v=0.25', () => {
    const wx = 0;
    const wy = 0;
    const wz = TORUS_MAJOR_R + TORUS_MINOR_R; // 8
    const uv = torusWorldToUV(wx, wy, wz);
    expect(uv.u).toBeCloseTo(0, 4);    // outer tube edge
    expect(uv.v).toBeCloseTo(0.25, 4); // ring angle 0.25 (90°)
  });

  it('outer edge at ring angle 0.5 (along -x axis) → u=0, v=0.5', () => {
    const wx = -(TORUS_MAJOR_R + TORUS_MINOR_R); // -8
    const wy = 0;
    const wz = 0;
    const uv = torusWorldToUV(wx, wy, wz);
    expect(uv.u).toBeCloseTo(0, 4);   // outer tube edge
    expect(uv.v).toBeCloseTo(0.5, 4); // ring angle 0.5 (180°)
  });

  it('round-trip: getPoint → worldToUV matches original UV', () => {
    // Sample several UV coordinates, convert to world, then back to UV
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
      expect(recovered.u).toBeCloseTo(u, 3);
      expect(recovered.v).toBeCloseTo(v, 3);
    }
  });

  it('OLD sphere parameterization would give swapped axes for torus outer edge at ring angle 0', () => {
    // World pos at outer edge (u=0), ring angle 0 (v=0): (8, 0, 0)
    const wx = 8, wy = 0, wz = 0;

    // OLD sphere parameterization:
    const r = Math.sqrt(wx * wx + wy * wy + wz * wz); // 8
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

  it('torusChordDist with correct UV gives near-zero distance for same point', () => {
    // Verify that with correct UV, two representations of the same world point give ~0 distance.
    const u = 0.1, v = 0.3;
    const { x, y, z } = torusGetPoint(u, v);
    const recovered = torusWorldToUV(x, y, z);

    // torusChordDist math (inlined for test isolation):
    const R = TORUS_MAJOR_R;
    const r = TORUS_MINOR_R;
    const theta1 = u * 2 * Math.PI, phi1 = v * 2 * Math.PI;
    const theta2 = recovered.u * 2 * Math.PI, phi2 = recovered.v * 2 * Math.PI;
    const dx = (R + r * Math.cos(theta1)) * Math.cos(phi1) - (R + r * Math.cos(theta2)) * Math.cos(phi2);
    const dy = r * Math.sin(theta1) - r * Math.sin(theta2);
    const dz = (R + r * Math.cos(theta1)) * Math.sin(phi1) - (R + r * Math.cos(theta2)) * Math.sin(phi2);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    expect(dist).toBeLessThan(0.001); // same point = ~0 chord distance
  });
});
