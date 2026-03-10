/**
 * s44r6c-03: Pill enemies spawning below player + ghost deaths
 *
 * Root causes:
 * 1. Server used sphere-approximation UV for player positions on pill, causing
 *    enemies to spawn at visually wrong positions relative to the player.
 * 2. applyUVBounds didn't recognize 'pill' as a sphere-like surface (missing
 *    from the capsule/sphere/peanut list), so enemies used generic V clamping.
 * 3. Enemy spawn V-cap (0.48) was exempted for PvP/PvPvE modes — user confirmed
 *    the restriction should apply to ALL modes on pill.
 *
 * These tests verify the pill UV recovery matches PillSurface.worldToSurface().
 */
import { describe, it, expect } from 'vitest';
import { PillSurface } from '../surfaces/PillSurface';

// Must match server PILL_* constants (GameRoom.ts lines 351-356)
const PILL_RADIUS = 10;
const PILL_HEIGHT = 20;
const PILL_HALF_HEIGHT = PILL_HEIGHT / 2;
const PILL_CAP_ARC = (Math.PI / 2) * PILL_RADIUS;
const PILL_TOTAL_V_LEN = PILL_HEIGHT + 2 * PILL_CAP_ARC;
const PILL_CAP_FRAC = PILL_CAP_ARC / PILL_TOTAL_V_LEN;

/**
 * Server-side pill UV recovery (mirrors _pillWorldToUV in GameRoom.ts).
 * Extracted here so we can test it against PillSurface.worldToSurface().
 */
function pillWorldToUV(wx: number, wy: number, wz: number): { u: number; v: number } {
  const sx = wx;
  const sy = wy;
  const sz = wz;

  let theta = Math.atan2(sz, sx);
  if (theta < 0) theta += Math.PI * 2;
  const u = theta / (Math.PI * 2);

  const r = PILL_RADIUS;
  const halfH = PILL_HALF_HEIGHT;
  const cf = PILL_CAP_FRAC;

  if (sy < -halfH) {
    const phi = Math.atan2(
      Math.sqrt(sx * sx + sz * sz),
      sy + halfH,
    );
    const localT = Math.max(0, Math.min(1, (Math.PI - phi) / (Math.PI / 2)));
    return { u, v: localT * cf };
  } else if (sy > halfH) {
    const phi = Math.atan2(
      Math.sqrt(sx * sx + sz * sz),
      sy - halfH,
    );
    const localT = Math.max(0, Math.min(1, 1 - phi / (Math.PI / 2)));
    return { u, v: (1 - cf) + localT * cf };
  } else {
    const localT = (sy + halfH) / PILL_HEIGHT;
    const bodyRange = 1 - 2 * cf;
    return { u, v: cf + Math.max(0, Math.min(1, localT)) * bodyRange };
  }
}

/**
 * Old sphere-approximation UV (what the server used to do for pill).
 */
function sphereApproxUV(wx: number, wy: number, wz: number): { u: number; v: number } {
  const r = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (r < 0.001) return { u: 0.5, v: 0.5 };
  const v = Math.acos(Math.max(-1, Math.min(1, wy / r))) / Math.PI;
  const u = ((Math.atan2(wz, wx) / (2 * Math.PI)) + 1) % 1;
  return { u, v };
}

describe('s44r6c-03: Pill enemy position — server UV recovery', () => {
  const pill = new PillSurface({ radius: PILL_RADIUS, height: PILL_HEIGHT });

  it('pill UV recovery matches PillSurface.worldToSurface on body section', () => {
    // Sample points on the cylindrical body
    const testUVs = [
      { u: 0.0, v: 0.3 },
      { u: 0.25, v: 0.4 },
      { u: 0.5, v: 0.5 },
      { u: 0.75, v: 0.6 },
      { u: 0.1, v: 0.45 },
    ];

    for (const { u, v } of testUVs) {
      const sp = pill.getPoint(u, v);
      const recovered = pillWorldToUV(sp.position.x, sp.position.y, sp.position.z);
      const clientRecovered = pill.worldToSurface(sp.position);

      // Server recovery should match client recovery
      expect(recovered.u).toBeCloseTo(clientRecovered.u, 2);
      expect(recovered.v).toBeCloseTo(clientRecovered.v, 2);
    }
  });

  it('pill UV recovery matches PillSurface.worldToSurface on caps', () => {
    const testUVs = [
      { u: 0.0, v: 0.05 },   // Bottom cap
      { u: 0.25, v: 0.15 },  // Bottom cap near body
      { u: 0.5, v: 0.85 },   // Top cap near body
      { u: 0.75, v: 0.95 },  // Top cap
    ];

    for (const { u, v } of testUVs) {
      const sp = pill.getPoint(u, v);
      const recovered = pillWorldToUV(sp.position.x, sp.position.y, sp.position.z);
      const clientRecovered = pill.worldToSurface(sp.position);

      expect(recovered.u).toBeCloseTo(clientRecovered.u, 2);
      expect(recovered.v).toBeCloseTo(clientRecovered.v, 2);
    }
  });

  it('sphere-approximation UV diverges significantly from pill UV on body', () => {
    // This test proves why the sphere approximation was wrong:
    // at body positions, sphere UV and pill UV diverge
    const bodyUV = { u: 0.25, v: 0.35 }; // body section
    const sp = pill.getPoint(bodyUV.u, bodyUV.v);

    const sphereUV = sphereApproxUV(sp.position.x, sp.position.y, sp.position.z);
    const pillUV = pillWorldToUV(sp.position.x, sp.position.y, sp.position.z);

    // The sphere-approximation V should differ from the correct pill V
    const pillVError = Math.abs(pillUV.v - bodyUV.v);
    const sphereVError = Math.abs(sphereUV.v - bodyUV.v);

    // Pill UV recovery should be much more accurate than sphere approximation
    expect(pillVError).toBeLessThan(0.01); // pill recovery is accurate
    expect(sphereVError).toBeGreaterThan(pillVError * 2); // sphere approx is significantly worse
  });

  it('round-trip: getPoint → pillWorldToUV recovers original UV', () => {
    // Test round-trip accuracy across the full pill surface
    const errors: { u: number; v: number; errU: number; errV: number }[] = [];

    for (let ui = 0; ui < 8; ui++) {
      for (let vi = 1; vi < 19; vi++) {
        const u = ui / 8;
        const v = vi / 20;
        const sp = pill.getPoint(u, v);
        const recovered = pillWorldToUV(sp.position.x, sp.position.y, sp.position.z);

        const errU = Math.abs(recovered.u - u);
        const errV = Math.abs(recovered.v - v);
        if (errU > 0.02 || errV > 0.02) {
          errors.push({ u, v, errU, errV });
        }
      }
    }

    expect(errors, `UV round-trip errors > 0.02: ${JSON.stringify(errors)}`).toHaveLength(0);
  });

  it('enemies restricted to v ≤ 0.48 stay on visually-correct side of pill', () => {
    // v=0.48 should be on the outer (bottom-half) body section
    // v=0.5 is approximately the middle of the body
    // v > 0.5 goes to upper body + top cap = visually "above"
    const vMax = 0.48;
    const sp = pill.getPoint(0.25, vMax);

    // Position should be on the body section (between caps)
    const cf = PILL_CAP_FRAC;
    expect(vMax).toBeGreaterThan(cf);
    expect(vMax).toBeLessThan(1 - cf);

    // Normal should point outward (positive radial direction)
    const radial = Math.sqrt(sp.position.x ** 2 + sp.position.z ** 2);
    expect(radial).toBeGreaterThan(PILL_RADIUS * 0.99); // Should be at the surface
  });
});
