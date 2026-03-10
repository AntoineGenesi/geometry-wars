/**
 * Regression test for s44r8-02: MP hit detection broken on all maps.
 *
 * Root cause: Player-enemy collision used player.surfaceU/V (derived from sphere
 * approximation in _worldPosToApproxUV) as input to chord distance functions for
 * non-spherical surfaces (cube, sphere-tunnel, cube-tunnel, peanut, cube-ring).
 * The sphere-approx UV is wrong for these surfaces → wrong player 3D position →
 * wrong chord distance → false deaths ("player dying from enemies far away").
 *
 * Fix (s44r8-02): Use player.wx/wy/wz (exact world position from ServerMeshWalker)
 * + convert enemy UV to world position via surfaceUVToWorld3D().
 * playerEnemyDist3D() implements this approach.
 *
 * This test demonstrates:
 * 1. surfaceUVToWorld3D() accurately converts UV to 3D world position for all surfaces
 * 2. playerEnemyDist3D() gives correct distances when player is at their actual world pos
 * 3. The bug: feeding sphere-approx UV to cubeChordDist gives wrong distances
 * 4. Close entities (< ENEMY_HIT_WORLD=0.4) register as collision; far entities don't
 *
 * Run from main project dir (vitest can't run in worktrees):
 *   cd "/home/antoine/claude code experiments/Geometry Wars"
 *   npx vitest run server/rooms/GameRoom.mp-hit-detection-all-maps.test.ts
 */

import { describe, it, expect } from 'vitest';
import { surfaceUVToWorld3D, playerEnemyDist3D } from './GameRoom';

const ENEMY_HIT_WORLD = 0.4;   // player(0.1) + enemy(0.3)
const scaleFactor = 1.0;       // MEDIUM map
const sphereR = 10 * scaleFactor;

// ---------------------------------------------------------------------------
// surfaceUVToWorld3D — verify forward mapping produces expected 3D positions
// ---------------------------------------------------------------------------

describe('surfaceUVToWorld3D — torus', () => {
  const TORUS_R = 8, TORUS_r = 3;

  it('outer equator at ring angle 0 → (11, 0, 0)', () => {
    const [x, y, z] = surfaceUVToWorld3D('torus', 0, 0, scaleFactor, sphereR);
    expect(x).toBeCloseTo(TORUS_R + TORUS_r, 4); // 11
    expect(y).toBeCloseTo(0, 4);
    expect(z).toBeCloseTo(0, 4);
  });

  it('inner equator at ring angle 0 → (5, 0, 0)', () => {
    const [x, y, z] = surfaceUVToWorld3D('torus', 0.5, 0, scaleFactor, sphereR);
    expect(x).toBeCloseTo(TORUS_R - TORUS_r, 4); // 5
    expect(y).toBeCloseTo(0, 4);
    expect(z).toBeCloseTo(0, 4);
  });

  it('outer equator at ring angle 0.5 → (-11, 0, 0)', () => {
    const [x, y, z] = surfaceUVToWorld3D('torus', 0, 0.5, scaleFactor, sphereR);
    expect(x).toBeCloseTo(-(TORUS_R + TORUS_r), 4); // -11
    expect(y).toBeCloseTo(0, 4);
    expect(z).toBeCloseTo(0, 4);
  });

  it('same point: distance to itself is zero', () => {
    const [x, y, z] = surfaceUVToWorld3D('torus', 0.3, 0.7, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('torus', x, y, z, 0.3, 0.7, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('scaleFactor=1.5 scales distances linearly', () => {
    const [x1, y1, z1] = surfaceUVToWorld3D('torus', 0, 0, 1.0, 10);
    const [x15, y15, z15] = surfaceUVToWorld3D('torus', 0, 0, 1.5, 15);
    expect(x15 / x1).toBeCloseTo(1.5, 3);
  });
});

describe('surfaceUVToWorld3D — sphere', () => {
  it('v=0.5 (equator) u=0 → (sphereR, 0, 0) approximately', () => {
    const [x, y, z] = surfaceUVToWorld3D('sphere', 0, 0.5, scaleFactor, sphereR);
    expect(x).toBeCloseTo(sphereR, 3);
    expect(y).toBeCloseTo(0, 3);
    expect(z).toBeCloseTo(0, 3);
  });

  it('v=0 (north pole) → (0, sphereR, 0)', () => {
    const [x, y, z] = surfaceUVToWorld3D('sphere', 0.5, 0, scaleFactor, sphereR);
    expect(x).toBeCloseTo(0, 3);
    expect(y).toBeCloseTo(sphereR, 3);
    expect(z).toBeCloseTo(0, 3);
  });
});

describe('surfaceUVToWorld3D — peanut', () => {
  const B = 6, W = 0.4;

  it('north pole (v=0) → at (0, B*(1+W), 0) = (0, 8.4, 0)', () => {
    // At phi=0: r = B*(1+W*cos(0)) = B*(1+W) = 8.4
    // Point: r*sin(0) = 0, r*cos(0) = 8.4, → (0, 8.4, 0)
    const [x, y, z] = surfaceUVToWorld3D('peanut', 0, 0, scaleFactor, sphereR);
    expect(x).toBeCloseTo(0, 3);
    expect(y).toBeCloseTo(B * (1 + W), 2); // 8.4
    expect(z).toBeCloseTo(0, 3);
  });

  it('equator (v=0.5) radius = B*(1-W) = 3.6', () => {
    // At phi=PI/2: r = B*(1+W*cos(PI)) = B*(1-W) = 3.6
    // Point at u=0: (r*sin(PI/2)*cos(0), r*cos(PI/2), r*sin(PI/2)*sin(0)) = (3.6, 0, 0)
    const [x, y, z] = surfaceUVToWorld3D('peanut', 0, 0.5, scaleFactor, sphereR);
    expect(x).toBeCloseTo(B * (1 - W), 2); // 3.6
    expect(y).toBeCloseTo(0, 3);
    expect(z).toBeCloseTo(0, 3);
  });
});

describe('surfaceUVToWorld3D — pill', () => {
  const PILL_RADIUS = 10, PILL_HEIGHT = 20, PILL_HALF_HEIGHT = 10;

  it('cylinder body at u=0, v=0.5 (equator) → (PILL_RADIUS, 0, 0)', () => {
    const [x, y, z] = surfaceUVToWorld3D('pill', 0, 0.5, scaleFactor, sphereR);
    // Cylinder equator at v=0.5: y≈0, x=PILL_RADIUS
    expect(x).toBeCloseTo(PILL_RADIUS, 1);
    expect(z).toBeCloseTo(0, 3);
  });
});

describe('surfaceUVToWorld3D — cube-ring', () => {
  const R = 4, H = 1.0;

  it('outer face at u=0, v≈0.125 (center of outer face) → (R+H, ~0, 0)', () => {
    // Outer face: v in [0, 0.25) → pr = H, phi=0 → x = (R+H)*cos(0) = 5
    const [x, y, z] = surfaceUVToWorld3D('cube-ring', 0, 0.125, scaleFactor, sphereR);
    expect(x).toBeCloseTo(R + H, 2); // 5
    expect(z).toBeCloseTo(0, 3);
  });

  it('inner face at u=0, v=0.625 → (R-H, 0, 0) = (3, 0, 0)', () => {
    // Inner face: v in [0.5, 0.75) → pr = -H → x = (R - H) = 3
    const [x, y, z] = surfaceUVToWorld3D('cube-ring', 0, 0.625, scaleFactor, sphereR);
    expect(x).toBeCloseTo(R - H, 2); // 3
    expect(z).toBeCloseTo(0, 3);
  });
});

// ---------------------------------------------------------------------------
// playerEnemyDist3D — core collision accuracy test
// ---------------------------------------------------------------------------

describe('playerEnemyDist3D — torus', () => {
  it('player and enemy at SAME UV: distance = 0', () => {
    const u = 0.3, v = 0.4;
    const [wx, wy, wz] = surfaceUVToWorld3D('torus', u, v, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('torus', wx, wy, wz, u, v, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('player at outer edge (u=0, v=0), enemy at inner edge (u=0.5, v=0): ~6 world units apart', () => {
    // Outer edge: (11, 0, 0). Inner edge: (5, 0, 0). Chord = 6.
    const [wx, wy, wz] = surfaceUVToWorld3D('torus', 0, 0, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('torus', wx, wy, wz, 0.5, 0, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(6, 1);
    expect(dist).toBeGreaterThan(ENEMY_HIT_WORLD); // no false collision
  });

  it('enemy at same tube position but opposite ring side (v=0.5): 22 world units apart (no kill)', () => {
    // Player at (11, 0, 0), enemy at v=0.5 ring angle = π: (-11, 0, 0)
    const [wx, wy, wz] = surfaceUVToWorld3D('torus', 0, 0, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('torus', wx, wy, wz, 0, 0.5, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(22, 0); // 2*(8+3) = 22
    expect(dist).toBeGreaterThan(ENEMY_HIT_WORLD);
  });

  it('enemy within 0.4 world units triggers hit threshold', () => {
    // On the outer tube ring (v=0), move 0.3 world units in U direction.
    // 0.3 / (2π * 3) ≈ 0.016 UV separation → chord ≈ 0.3
    const [wx, wy, wz] = surfaceUVToWorld3D('torus', 0, 0, scaleFactor, sphereR);
    const duUV = 0.015; // should give ~0.28 world units → within ENEMY_HIT_WORLD
    const dist = playerEnemyDist3D('torus', wx, wy, wz, duUV, 0, scaleFactor, sphereR);
    expect(dist).toBeLessThan(ENEMY_HIT_WORLD);
  });
});

describe('playerEnemyDist3D — cube', () => {
  it('player and enemy at SAME UV: distance = 0', () => {
    const u = 0.25, v = 0.4;
    const [wx, wy, wz] = surfaceUVToWorld3D('cube', u, v, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('cube', wx, wy, wz, u, v, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('player and enemy on opposite faces: large distance (no kill)', () => {
    // On cube with size=10: player on +Z face (u≈0, v≈0.5), enemy on -Z face
    const [wx, wy, wz] = surfaceUVToWorld3D('cube', 0.0, 0.5, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('cube', wx, wy, wz, 0.5, 0.5, scaleFactor, sphereR);
    // Should be several world units apart
    expect(dist).toBeGreaterThan(ENEMY_HIT_WORLD);
  });

  it('player and enemy close together on same face: within threshold', () => {
    // Small UV separation on same face → small world distance
    const u1 = 0.25, v1 = 0.5;
    const u2 = 0.25, v2 = 0.502; // tiny V separation
    const [wx, wy, wz] = surfaceUVToWorld3D('cube', u1, v1, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('cube', wx, wy, wz, u2, v2, scaleFactor, sphereR);
    expect(dist).toBeLessThan(1.0); // close together
  });
});

describe('playerEnemyDist3D — sphere-tunnel', () => {
  it('player and enemy at SAME UV: distance = 0', () => {
    const u = 0.3, v = 0.3;
    const [wx, wy, wz] = surfaceUVToWorld3D('sphere-tunnel', u, v, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('sphere-tunnel', wx, wy, wz, u, v, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('player on outer sphere (v=0.29) vs enemy at tunnel entry (v=0.002, u=0.5): large distance (no false kill)', () => {
    // Player on outer sphere, enemy at tunnel edge opposite side
    const [wx, wy, wz] = surfaceUVToWorld3D('sphere-tunnel', 0.0, 0.29, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('sphere-tunnel', wx, wy, wz, 0.5, 0.002, scaleFactor, sphereR);
    expect(dist).toBeGreaterThan(ENEMY_HIT_WORLD); // should NOT trigger kill
  });

  it('BUG FIX PROOF: old sphere-approx UV fed to sphereTunnelChordDist gives wrong (too-small) distance', () => {
    // Near tunnel entry (v≈0.002), sphere approximation gives latitude ≈ 0 (north pole)
    // → ALL u values map to same UV (0, ~0.001) in sphere space
    // → sphereTunnelChordDist(sphere_approx_uv, enemy_uv) ≈ 0 → false kill!
    //
    // Demonstrate: player at (u=0.0, v=0.002 sphere-tunnel), enemy at (u=0.5, v=0.002)
    // Sphere-approx gives player UV ≈ (0.0, 0.001) [near north pole in sphere lat/lon]
    // surfaceUVToWorld3D('sphere-tunnel', 0.0, 0.001) vs enemy at (0.5, 0.002) via sphereTunnelChordDist
    // = near-zero distance → triggers ENEMY_HIT_WORLD=0.4 → FALSE KILL
    //
    // FIX: playerEnemyDist3D uses player.wx/wy/wz (actual world pos on sphere-tunnel outer sphere)
    // vs enemy UV → 3D pos at tunnel entry → large actual distance
    const [wx, wy, wz] = surfaceUVToWorld3D('sphere-tunnel', 0.0, 0.002, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('sphere-tunnel', wx, wy, wz, 0.5, 0.002, scaleFactor, sphereR);
    expect(dist).toBeGreaterThan(4.0); // actual chord ≈ 6+ world units (tunnel ring diameter)
    expect(dist).toBeGreaterThan(ENEMY_HIT_WORLD); // no false kill
  });
});

describe('playerEnemyDist3D — peanut', () => {
  it('player and enemy at SAME UV: distance = 0', () => {
    const u = 0.2, v = 0.3;
    const [wx, wy, wz] = surfaceUVToWorld3D('peanut', u, v, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('peanut', wx, wy, wz, u, v, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('north pole vs south pole: distance ≈ 2 * maxRadius = 16.8 (far apart, no kill)', () => {
    // North pole (v=0): y = 8.4. South pole (v=1): y = -8.4. Chord = 16.8.
    const [wx, wy, wz] = surfaceUVToWorld3D('peanut', 0, 0, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('peanut', wx, wy, wz, 0, 1.0, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(16.8, 0);
    expect(dist).toBeGreaterThan(ENEMY_HIT_WORLD);
  });
});

describe('playerEnemyDist3D — cube-ring', () => {
  it('player and enemy at SAME UV: distance = 0', () => {
    const u = 0.1, v = 0.3;
    const [wx, wy, wz] = surfaceUVToWorld3D('cube-ring', u, v, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('cube-ring', wx, wy, wz, u, v, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('outer face vs inner face: distance ≈ 2*H = 2 (small but > 0.4, no kill)', () => {
    // Outer face pr=H=1, inner face pr=-H=-1: both at u=0, y=0
    // Distance = 2*H*2 = 4? Actually chord between (R+H, 0, 0) and (R-H, 0, 0) = 2*H = 2.
    const [wx, wy, wz] = surfaceUVToWorld3D('cube-ring', 0, 0.125, scaleFactor, sphereR); // outer face center
    const dist = playerEnemyDist3D('cube-ring', wx, wy, wz, 0, 0.625, scaleFactor, sphereR); // inner face center
    expect(dist).toBeCloseTo(2, 0); // 2 world units
    expect(dist).toBeGreaterThan(ENEMY_HIT_WORLD);
  });
});

describe('playerEnemyDist3D — mobius', () => {
  it('player and enemy at SAME UV: distance = 0', () => {
    const u = 0.2, v = 0.5;
    const [wx, wy, wz] = surfaceUVToWorld3D('mobius', u, v, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('mobius', wx, wy, wz, u, v, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(0, 5);
  });
});

describe('playerEnemyDist3D — pill', () => {
  it('player and enemy at SAME UV: distance = 0', () => {
    const u = 0.0, v = 0.5;
    const [wx, wy, wz] = surfaceUVToWorld3D('pill', u, v, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('pill', wx, wy, wz, u, v, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('opposite sides of cylinder (u=0 vs u=0.5): 2*radius = 20 world units (no kill)', () => {
    const PILL_RADIUS = 10;
    const [wx, wy, wz] = surfaceUVToWorld3D('pill', 0, 0.5, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('pill', wx, wy, wz, 0.5, 0.5, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(2 * PILL_RADIUS, 0); // 20
    expect(dist).toBeGreaterThan(ENEMY_HIT_WORLD);
  });
});

describe('playerEnemyDist3D — cube-tunnel', () => {
  it('player and enemy at SAME UV: distance = 0', () => {
    const u = 0.3, v = 0.2;
    const [wx, wy, wz] = surfaceUVToWorld3D('cube-tunnel', u, v, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('cube-tunnel', wx, wy, wz, u, v, scaleFactor, sphereR);
    expect(dist).toBeCloseTo(0, 5);
  });

  it('player and enemy on different faces: large distance (no kill)', () => {
    const [wx, wy, wz] = surfaceUVToWorld3D('cube-tunnel', 0.0, 0.25, scaleFactor, sphereR);
    const dist = playerEnemyDist3D('cube-tunnel', wx, wy, wz, 0.5, 0.25, scaleFactor, sphereR);
    expect(dist).toBeGreaterThan(ENEMY_HIT_WORLD);
  });
});

describe('playerEnemyDist3D — scaleFactor scaling', () => {
  it('LARGE map (scaleFactor=1.5): torus distances scale proportionally', () => {
    const sf = 1.5;
    const sR = 10 * sf;
    const [wx1, wy1, wz1] = surfaceUVToWorld3D('torus', 0, 0, sf, sR);
    const dist1 = playerEnemyDist3D('torus', wx1, wy1, wz1, 0.5, 0, sf, sR);
    // At sf=1: chord = 6. At sf=1.5: chord should be 6*1.5 = 9
    expect(dist1).toBeCloseTo(9, 0);
  });

  it('MEDIUM vs LARGE: same UV positions scale by scaleFactor', () => {
    const d1 = (() => {
      const [wx, wy, wz] = surfaceUVToWorld3D('torus', 0.1, 0.3, 1.0, 10);
      return playerEnemyDist3D('torus', wx, wy, wz, 0.2, 0.4, 1.0, 10);
    })();
    const d15 = (() => {
      const [wx, wy, wz] = surfaceUVToWorld3D('torus', 0.1, 0.3, 1.5, 15);
      return playerEnemyDist3D('torus', wx, wy, wz, 0.2, 0.4, 1.5, 15);
    })();
    expect(d15 / d1).toBeCloseTo(1.5, 1);
  });
});
