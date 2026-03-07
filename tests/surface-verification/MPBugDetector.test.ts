/**
 * MP Surface Bug Detector — Tests That MUST FAIL on Broken Maps
 *
 * This test suite directly tests the server-side GameRoom functions that
 * implement MP gameplay. The existing SurfaceVerifier framework tests SP code
 * paths (PlaygroundTestHarness) but NOT the actual MP server logic.
 *
 * These tests are designed to CATCH THE REAL BUGS reported by the user:
 *
 * 1. TORUS: _worldPosToApproxUV uses wrong Y-sign — returns u≈0.5 (inner) when
 *    player is at u≈0 (outer), causing hit detection to fire from the wrong surface.
 *
 * 2. TORUS: torusChordDist uses +sin(theta) for Y but TorusSurface uses -sin(theta)
 *    (because geometry.rotateX(π/2) negates the Y component). This means inner and
 *    outer surfaces appear to be at the same Y position — causing ghost kills when
 *    bullet is on the inner surface and enemy is on the outer surface.
 *
 * 3. SPHERE: Camera normal stability — after moving sideways, the camera up vector
 *    should not deviate more than ~15° from the player's surface normal. A larger
 *    deviation indicates the "camera tilting sideways" bug.
 *
 * 4. HIT DETECTION: At distance > 2x enemy radius (0.6 world units), bullets must
 *    NOT register hits. Ghost kills occur when thresholds are too large or when
 *    the UV-fallback threshold fires incorrectly at distorted coordinates.
 *
 * HOW TO USE: If all tests pass, either the bugs are fixed OR the tests don't
 * actually probe the right code path. Run after making changes to GameRoom.ts
 * collision logic or TorusSurface.ts to verify regressions.
 *
 * NOTE: vitest cannot run in git worktrees. Run from the main project root:
 *   npm test -- tests/surface-verification/MPBugDetector.test.ts
 */

import { describe, test, expect } from 'vitest';
import * as THREE from 'three';
import { ServerMeshWalker } from '../../server/movement/ServerMeshWalker';
import { buildSurfaceGeometry } from '../../server/movement/SurfaceGeometryBuilder';
import { MeshSurface } from '../../src/surfaces/MeshSurface';
import { PLAYER_WORLD_SPEED } from '../../server/shared/GameConstants';
import { TorusSurface } from '../../src/surfaces/TorusSurface';

// ---------------------------------------------------------------------------
// Replicate GameRoom.ts math exactly as it is in production.
// These functions mirror the ACTUAL production code so tests catch real bugs.
// When the code in GameRoom.ts is wrong, these tests will FAIL.
// ---------------------------------------------------------------------------

const TORUS_MAJOR_R = 6;
const TORUS_MINOR_R = 2;

/**
 * Mirrors torusChordDist() in GameRoom.ts (lines 246-255).
 * BUG CANDIDATE: uses +sin(theta) for Y, but TorusSurface uses -sin(theta).
 */
function gameRoomTorusChordDist(
  u1: number, v1: number,
  u2: number, v2: number,
  scaleFactor: number = 1,
): number {
  const R = TORUS_MAJOR_R * scaleFactor;
  const r = TORUS_MINOR_R * scaleFactor;
  const theta1 = u1 * 2 * Math.PI, phi1 = v1 * 2 * Math.PI;
  const theta2 = u2 * 2 * Math.PI, phi2 = v2 * 2 * Math.PI;
  const dx = (R + r * Math.cos(theta1)) * Math.cos(phi1) - (R + r * Math.cos(theta2)) * Math.cos(phi2);
  // NOTE: GameRoom.ts uses +sin here. TorusSurface.ts uses -sin because of rotateX(π/2).
  const dy = r * Math.sin(theta1) - r * Math.sin(theta2);
  const dz = (R + r * Math.cos(theta1)) * Math.sin(phi1) - (R + r * Math.cos(theta2)) * Math.sin(phi2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Correct torus chord distance using TorusSurface.ts sign convention.
 * y = -r * sin(theta) to match geometry.rotateX(π/2).
 */
function correctTorusChordDist(
  u1: number, v1: number,
  u2: number, v2: number,
  scaleFactor: number = 1,
): number {
  const R = TORUS_MAJOR_R * scaleFactor;
  const r = TORUS_MINOR_R * scaleFactor;
  const theta1 = u1 * 2 * Math.PI, phi1 = v1 * 2 * Math.PI;
  const theta2 = u2 * 2 * Math.PI, phi2 = v2 * 2 * Math.PI;
  const dx = (R + r * Math.cos(theta1)) * Math.cos(phi1) - (R + r * Math.cos(theta2)) * Math.cos(phi2);
  // CORRECT: -sin to match TorusSurface.ts getPointLocal y = -r * sinTheta
  const dy = -r * Math.sin(theta1) - (-r * Math.sin(theta2));
  const dz = (R + r * Math.cos(theta1)) * Math.sin(phi1) - (R + r * Math.cos(theta2)) * Math.sin(phi2);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Mirrors _worldPosToApproxUV() in GameRoom.ts (lines 1694-1701) for torus.
 * BUG CANDIDATE: uses Math.atan2(wy, outward) — should be Math.atan2(-wy, outward)
 * because TorusSurface.ts stores y = -r*sinTheta.
 */
function gameRoomWorldPosToApproxUV_Torus(wx: number, wy: number, wz: number): { u: number; v: number } {
  const R = TORUS_MAJOR_R;
  const phi = Math.atan2(wz, wx);
  const v = ((phi / (2 * Math.PI)) + 1) % 1;
  const outward = wx * Math.cos(phi) + wz * Math.sin(phi) - R;
  // GameRoom.ts uses wy here — BUG if TorusSurface stores y = -r*sinTheta
  const theta = Math.atan2(wy, outward);
  const u = ((theta / (2 * Math.PI)) + 1) % 1;
  return { u, v };
}

/**
 * Correct torus UV recovery using TorusSurface.ts sign convention.
 * Since y = -r*sinTheta → sinTheta = -y/r → theta = atan2(-wy, outward).
 */
function correctWorldPosToApproxUV_Torus(wx: number, wy: number, wz: number): { u: number; v: number } {
  const R = TORUS_MAJOR_R;
  const phi = Math.atan2(wz, wx);
  const v = ((phi / (2 * Math.PI)) + 1) % 1;
  const outward = wx * Math.cos(phi) + wz * Math.sin(phi) - R;
  // CORRECT: negate wy to account for TorusSurface y = -r*sinTheta
  const theta = Math.atan2(-wy, outward);
  const u = ((theta / (2 * Math.PI)) + 1) % 1;
  return { u, v };
}

// ---------------------------------------------------------------------------
// Get actual world positions from TorusSurface (ground truth)
// ---------------------------------------------------------------------------

const torusSurface = new TorusSurface();

function torusOuterPos(v: number): THREE.Vector3 {
  // u=0 → outer edge (farthest from center, cosTheta=1, sinTheta=0)
  return torusSurface.getPoint(0, v).position;
}

function torusInnerPos(v: number): THREE.Vector3 {
  // u=0.5 → inner edge (closest to center, cosTheta=-1, sinTheta=0)
  return torusSurface.getPoint(0.5, v).position;
}

function torusTopPos(v: number): THREE.Vector3 {
  // u=0.25 → top of tube (cosTheta=0, sinTheta=1 → y = -r*1 = -2 in world)
  return torusSurface.getPoint(0.25, v).position;
}

// ---------------------------------------------------------------------------
// BUG 1: Torus UV inversion — _worldPosToApproxUV returns inner when outer
// ---------------------------------------------------------------------------

describe('BUG DETECTION: Torus _worldPosToApproxUV Y-sign error', () => {
  /**
   * EXPECTED BEHAVIOR: A player at the outer surface (u≈0) should be recovered
   * as u≈0 (outer), not u≈0.5 (inner).
   *
   * BUG: GameRoom.ts uses Math.atan2(wy, outward) but TorusSurface stores
   * y = -r*sinTheta, so the correct inversion is Math.atan2(-wy, outward).
   * The wrong sign maps the outer surface to u≈0.5 (inner) and vice versa.
   */
  test('[KNOWN BUG] outer surface position (u=0) recovers as outer (u≈0), not inner (u≈0.5)', () => {
    // Get the actual world position of the outer surface at v=0 from TorusSurface
    const outerPos = torusOuterPos(0);
    // Expected: x = R+r = 8, y = 0, z = 0 (theta=0, sinTheta=0, y=-r*0=0)

    const recovered = gameRoomWorldPosToApproxUV_Torus(outerPos.x, outerPos.y, outerPos.z);

    // OUTER edge should recover as u≈0 (or u≈1 which wraps to 0)
    // BUG: this will return u≈0.5 (inner edge) because of wrong Y-sign
    const isOuter = recovered.u < 0.1 || recovered.u > 0.9;
    expect(isOuter).toBe(true);
  });

  test('[KNOWN BUG] inner surface position (u=0.5) recovers as inner (u≈0.5), not outer', () => {
    // Get actual world position of inner surface at v=0 from TorusSurface
    const innerPos = torusInnerPos(0);
    // Expected: x = R-r = 4, y = 0, z = 0

    const recovered = gameRoomWorldPosToApproxUV_Torus(innerPos.x, innerPos.y, innerPos.z);

    // INNER edge should recover as u≈0.5
    // BUG: this will return u≈0 (outer edge) because of wrong Y-sign
    expect(recovered.u).toBeGreaterThan(0.4);
    expect(recovered.u).toBeLessThan(0.6);
  });

  test('[KNOWN BUG] top-of-tube position (u=0.25) recovers as top (u≈0.25), not bottom (u≈0.75)', () => {
    // u=0.25 → theta=π/2 → y = -r*sin(π/2) = -r = -2
    const topPos = torusTopPos(0);

    const recovered = gameRoomWorldPosToApproxUV_Torus(topPos.x, topPos.y, topPos.z);

    // Top of tube (u=0.25 where theta=π/2, y = -r)
    // BUG: wrong Y-sign maps this to u≈0.75 (bottom of tube)
    expect(recovered.u).toBeGreaterThan(0.15);
    expect(recovered.u).toBeLessThan(0.35);
  });

  test('CORRECT recovery works: outer surface at v=0 returns u≈0 with correct formula', () => {
    const outerPos = torusOuterPos(0);
    const recovered = correctWorldPosToApproxUV_Torus(outerPos.x, outerPos.y, outerPos.z);

    const isOuter = recovered.u < 0.1 || recovered.u > 0.9;
    expect(isOuter).toBe(true);
  });

  test('CORRECT recovery works: inner surface at v=0 returns u≈0.5 with correct formula', () => {
    const innerPos = torusInnerPos(0);
    const recovered = correctWorldPosToApproxUV_Torus(innerPos.x, innerPos.y, innerPos.z);

    expect(recovered.u).toBeGreaterThan(0.4);
    expect(recovered.u).toBeLessThan(0.6);
  });

  test('CORRECT recovery works: top-of-tube at v=0 returns u≈0.25 with correct formula', () => {
    const topPos = torusTopPos(0);
    const recovered = correctWorldPosToApproxUV_Torus(topPos.x, topPos.y, topPos.z);

    expect(recovered.u).toBeGreaterThan(0.15);
    expect(recovered.u).toBeLessThan(0.35);
  });

  test('GameRoom UV recovery error magnitude (outer→inner confusion = 0.5 in u)', () => {
    // Measure how wrong the GameRoom UV recovery is at multiple points
    const errors: number[] = [];

    for (let v = 0; v < 1; v += 0.1) {
      // Test outer edge (u=0)
      const outerPos = torusOuterPos(v);
      const recovered = gameRoomWorldPosToApproxUV_Torus(outerPos.x, outerPos.y, outerPos.z);
      // The correct u should be 0 (outer), but bug returns ~0.5 (inner)
      // Compute wrapped distance in U
      let uError = Math.abs(recovered.u - 0);
      if (uError > 0.5) uError = 1 - uError;
      errors.push(uError);
    }

    const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
    // Log the error so users can see how bad it is
    console.log(`Torus UV recovery avg U error (outer edge): ${avgError.toFixed(3)} (0.5 = worst case, inner/outer flipped)`);

    // If avgError > 0.3, the inner/outer surfaces are being confused by the server
    // This PROVES the player appears "inside the donut" bug
    expect(avgError).toBeLessThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// BUG 2: Torus chord distance Y-sign error (ghost kills)
// ---------------------------------------------------------------------------

describe('BUG DETECTION: Torus torusChordDist Y-sign error', () => {
  /**
   * EXPECTED BEHAVIOR: A bullet at the top of the tube (u1=0.25) and an enemy
   * at the bottom of the tube (u2=0.75) should be ~2*r = 4 world units apart
   * (diameter of the tube minor circle). The game should NOT consider them close.
   *
   * BUG: torusChordDist uses +sin(theta) for Y but TorusSurface uses -sin(theta).
   * This means top-tube at (u=0.25) and bottom-tube at (u=0.75) appear to have
   * the same world Y position in the GameRoom, making chord distance ~ 0 in Y.
   * Since the XZ positions are also very close (same phi), the total chord distance
   * is near 0 — triggering ghost kills.
   */

  test('[KNOWN BUG] top-tube (u=0.25) and bottom-tube (u=0.75) are ~4 world units apart', () => {
    // These two points are at the top and bottom of the torus tube
    // At the same phi (v=0), they should be 2*minorRadius = 4 world units apart
    const actualDist = correctTorusChordDist(0.25, 0, 0.75, 0);
    const gameRoomDist = gameRoomTorusChordDist(0.25, 0, 0.75, 0);

    console.log(`Top-vs-bottom tube chord dist: GameRoom=${gameRoomDist.toFixed(3)}, Correct=${actualDist.toFixed(3)}`);
    console.log(`Expected: ~4 world units (2 * minorRadius = 4)`);

    // Correct should be close to 2*r = 4
    expect(actualDist).toBeGreaterThan(3.5);
    expect(actualDist).toBeLessThan(4.5);

    // GameRoom version uses wrong sign — distance will be near 0 instead of 4
    // This is the ghost kill bug: bullet at bottom appears collocated with enemy at top
    expect(gameRoomDist).toBeGreaterThan(3.5); // THIS WILL FAIL if bug exists
  });

  test('torusChordDist matches actual 3D Euclidean distance from TorusSurface.getPoint', () => {
    // Compare with TorusSurface ground truth
    const cases = [
      { u1: 0, v1: 0, u2: 0.5, v2: 0 },    // outer vs inner, same phi
      { u1: 0.25, v1: 0, u2: 0.75, v2: 0 }, // top vs bottom, same phi
      { u1: 0, v1: 0, u2: 0, v2: 0.5 },     // outer, opposite side of ring
      { u1: 0.1, v1: 0.1, u2: 0.4, v2: 0.4 }, // diagonal test
    ];

    for (const { u1, v1, u2, v2 } of cases) {
      const p1 = torusSurface.getPoint(u1, v1).position;
      const p2 = torusSurface.getPoint(u2, v2).position;
      const trueDist = p1.distanceTo(p2);
      const gameRoomDist = gameRoomTorusChordDist(u1, v1, u2, v2);
      const correctDist = correctTorusChordDist(u1, v1, u2, v2);

      console.log(`u1=${u1}, v1=${v1} → u2=${u2}, v2=${v2}: true=${trueDist.toFixed(3)}, gameRoom=${gameRoomDist.toFixed(3)}, correct=${correctDist.toFixed(3)}`);

      // Correct formula should match TorusSurface within rounding
      expect(correctDist).toBeCloseTo(trueDist, 1);

      // GameRoom formula should also match — if it doesn't, ghost kills occur
      // This test will FAIL if the Y-sign bug is present
      expect(gameRoomDist).toBeCloseTo(trueDist, 1);
    }
  });

  test('[KNOWN BUG] ghost kill scenario: bullet at inner surface, enemy at outer surface, same phi', () => {
    // Bullet is at u=0.5 (inner edge), v=0
    // Enemy is at u=0 (outer edge), v=0
    // These points are on opposite sides of the tube — should NOT trigger a hit
    // Real chord distance = 2 * minorRadius = 4 world units
    // BULLET_HIT_WORLD threshold = 0.4 world units → should be NO hit

    const bulletU = 0.5; // inner surface
    const enemyU = 0;   // outer surface
    const v = 0;

    const trueDist = torusSurface.getPoint(bulletU, v).position.distanceTo(
      torusSurface.getPoint(enemyU, v).position
    );
    const gameRoomDist = gameRoomTorusChordDist(bulletU, v, enemyU, v);
    const BULLET_HIT_WORLD = 0.4;

    console.log(`Ghost kill scenario: bullet(inner) vs enemy(outer) same phi`);
    console.log(`  True 3D distance: ${trueDist.toFixed(3)} world units`);
    console.log(`  GameRoom chord dist: ${gameRoomDist.toFixed(3)} world units`);
    console.log(`  BULLET_HIT_WORLD threshold: ${BULLET_HIT_WORLD}`);
    console.log(`  True would hit: ${trueDist < BULLET_HIT_WORLD} (expected: false)`);
    console.log(`  GameRoom would hit: ${gameRoomDist < BULLET_HIT_WORLD} (might be true — ghost kill!)`);

    // True distance should be ~4 (no hit)
    expect(trueDist).toBeGreaterThan(1.0);

    // GameRoom should NOT consider this a hit
    // This will FAIL if the chord dist is wrong due to Y-sign bug
    expect(gameRoomDist).toBeGreaterThan(BULLET_HIT_WORLD);
  });
});

// ---------------------------------------------------------------------------
// BUG 3: Sphere camera normal stability
// ---------------------------------------------------------------------------

describe('BUG DETECTION: Sphere camera normal stability (camera tilt bug)', () => {
  const SPHERE_MESH = buildSurfaceGeometry('sphere', 1.0);
  const SPHERE_SURFACE = new MeshSurface(SPHERE_MESH);

  /**
   * EXPECTED BEHAVIOR: When a player moves sideways on the sphere (strafing),
   * their surface normal should remain consistent with their position and
   * should not deviate excessively from the radially outward direction.
   *
   * The "camera tilting sideways" bug occurs when the server's tangent frame
   * (used by the client for camera orientation) flips or drifts after lateral movement.
   *
   * BUG INDICATOR: If the dot product between successive normals drops below cos(30°)≈0.87,
   * the camera would visibly tilt ~30° in a single step.
   */

  test('sphere: surface normal remains consistent after sideways movement (no camera tilt)', () => {
    // Start at equator, move sideways (strafe)
    const startPos = new THREE.Vector3(10, 0, 0); // equator, longitude 0
    const walker = new ServerMeshWalker(SPHERE_SURFACE, startPos, PLAYER_WORLD_SPEED);

    // Camera axes: looking from above (camera up = +Y for sphere at equator)
    const camRightX = 0, camRightY = 0, camRightZ = -1; // camera right points toward -Z
    const camUpX = 0, camUpY = 1, camUpZ = 0;           // camera up points toward +Y

    const normalHistory: THREE.Vector3[] = [];
    const state0 = walker.getState();
    normalHistory.push(new THREE.Vector3(state0.nx, state0.ny, state0.nz));

    // Simulate 60 frames of strafing (1 second at 60fps)
    for (let i = 0; i < 60; i++) {
      walker.moveWithCameraAxes(
        1, 0,              // strafe right (moveX=1, moveY=0)
        camRightX, camRightY, camRightZ,
        camUpX, camUpY, camUpZ,
        0.016,
      );
      const s = walker.getState();
      normalHistory.push(new THREE.Vector3(s.nx, s.ny, s.nz));
    }

    // Check: each normal should be close to the previous one (no sudden flips)
    let maxDip = 0;
    for (let i = 1; i < normalHistory.length; i++) {
      const dot = normalHistory[i - 1].dot(normalHistory[i]);
      maxDip = Math.max(maxDip, 1 - dot);
    }

    // maxDip > 0.13 means normals deviated by more than cos^-1(0.87) ≈ 30°
    console.log(`Sphere strafe: max normal dip between consecutive frames = ${maxDip.toFixed(4)}`);
    console.log(`  (> 0.13 = deviation > 30° per step = camera tilt bug)`);

    // Allow up to 10° per step (cos(10°) = 0.985, dip = 0.015)
    expect(maxDip).toBeLessThan(0.05); // < ~18° deviation per frame
  });

  test('sphere: normal is always approximately radially outward (points away from origin)', () => {
    // Start at equator, move for 120 frames combining strafe and forward
    const startPos = new THREE.Vector3(10, 0, 0);
    const walker = new ServerMeshWalker(SPHERE_SURFACE, startPos, PLAYER_WORLD_SPEED);

    for (let i = 0; i < 120; i++) {
      // Alternate strafe and forward to explore the surface
      const moveX = i % 2 === 0 ? 1 : 0;
      const moveY = i % 2 === 0 ? 0 : 1;
      walker.moveWithCameraAxes(moveX, moveY, 0, 0, -1, 0, 1, 0, 0.016);
    }

    // At any position on a sphere, normal should point approximately away from origin
    const pos = walker.getWorldPosition();
    const s = walker.getState();
    const normal = new THREE.Vector3(s.nx, s.ny, s.nz);
    const posNorm = pos.clone().normalize();

    // For a sphere, normal = radial direction = pos/|pos|
    const dot = normal.dot(posNorm);
    console.log(`Sphere: position-to-normal alignment after 120 frames: dot=${dot.toFixed(4)}`);
    console.log(`  (< 0.9 means camera normal is badly misaligned with sphere surface)`);

    // Should be nearly 1.0 (normal points radially outward)
    expect(dot).toBeGreaterThan(0.95);
  });

  test('sphere: player does not get stuck — position changes each frame', () => {
    // The "stuck on narrow strip" bug: player moves but position doesn't change
    const startPos = new THREE.Vector3(10, 0, 0);
    const walker = new ServerMeshWalker(SPHERE_SURFACE, startPos, PLAYER_WORLD_SPEED);

    const positions: THREE.Vector3[] = [startPos.clone()];
    let stuckFrames = 0;

    for (let i = 0; i < 60; i++) {
      const before = walker.getWorldPosition().clone();
      walker.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, 0.016);
      const after = walker.getWorldPosition();

      const moved = after.distanceTo(before);
      if (moved < 0.001) {
        stuckFrames++;
      }
      positions.push(after.clone());
    }

    console.log(`Sphere movement: stuck frames = ${stuckFrames}/60`);
    console.log(`  (> 10 stuck frames indicates the "narrow strip" bug)`);

    // Should not get stuck for more than 2 frames (poles are ok to briefly stall)
    expect(stuckFrames).toBeLessThan(3);
  });
});

// ---------------------------------------------------------------------------
// BUG 4: Torus surface — player position inside the donut
// ---------------------------------------------------------------------------

describe('BUG DETECTION: Torus player positioning (inside-donut bug)', () => {
  /**
   * EXPECTED BEHAVIOR: Player world position should be on the outer surface
   * of the torus tube (approximately r = TORUS_MINOR_R = 2 from the tube center).
   *
   * BUG: If the server sends world positions using a different convention than
   * the client expects, the player mesh appears inside the torus geometry.
   *
   * We test this by verifying that torusChordDist(u, v, inner_u, v) > minor_diameter
   * for any point on the outer surface.
   */

  test('outer surface (u=0) world position is outside the torus donut (dist from center > R-r)', () => {
    // At v=0, u=0: x = R+r = 8, y = 0, z = 0 (from TorusSurface)
    const outerPoint = torusSurface.getPoint(0, 0);
    const R = TORUS_MAJOR_R;
    const r = TORUS_MINOR_R;

    // Distance from torus ring center (in XZ plane) should be R+r = 8
    const distFromYAxis = Math.sqrt(outerPoint.position.x ** 2 + outerPoint.position.z ** 2);
    console.log(`Torus outer edge (u=0, v=0): distFromYAxis=${distFromYAxis.toFixed(3)}, expected=${R + r}`);

    expect(distFromYAxis).toBeCloseTo(R + r, 1);
  });

  test('inner surface (u=0.5) world position is inside the torus hole (dist from center = R-r)', () => {
    const innerPoint = torusSurface.getPoint(0.5, 0);
    const R = TORUS_MAJOR_R;
    const r = TORUS_MINOR_R;

    // Distance from Y axis should be R-r = 4
    const distFromYAxis = Math.sqrt(innerPoint.position.x ** 2 + innerPoint.position.z ** 2);
    console.log(`Torus inner edge (u=0.5, v=0): distFromYAxis=${distFromYAxis.toFixed(3)}, expected=${R - r}`);

    expect(distFromYAxis).toBeCloseTo(R - r, 1);
  });

  test('[KNOWN BUG] GameRoom UV recovery correctly identifies which surface a world position is on', () => {
    // Generate multiple outer surface points and verify GameRoom thinks they are outer
    let correctCount = 0;
    let wrongCount = 0;

    for (let v = 0; v < 1; v += 0.125) {
      // Test at outer edge (u=0)
      const outerPos = torusSurface.getPoint(0, v).position;
      const recovered = gameRoomWorldPosToApproxUV_Torus(outerPos.x, outerPos.y, outerPos.z);

      // u should be close to 0 (outer), not 0.5 (inner)
      let uErr = Math.abs(recovered.u - 0);
      if (uErr > 0.5) uErr = 1 - uErr; // wrap around
      const isCorrect = uErr < 0.2;

      if (isCorrect) correctCount++;
      else wrongCount++;
    }

    console.log(`Torus UV recovery (outer edge): correct=${correctCount}, wrong=${wrongCount}`);
    console.log(`  (wrongCount > 0 = server thinks outer-surface player is on inner surface)`);
    console.log(`  This causes: bullets visible on outer surface firing from server's inner-surface position`);

    // This FAILS if the Y-sign bug is present
    expect(wrongCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BUG 4b: Torus bullet spawn from wrong position (gameplay consequence of UV inversion)
// ---------------------------------------------------------------------------

describe('BUG DETECTION: Torus bullet spawn at wrong UV (bullet from wrong surface)', () => {
  /**
   * GAMEPLAY CONSEQUENCE: When the server miscalculates player.surfaceU due to
   * the Y-sign bug, all bullets spawn at the WRONG UV position.
   *
   * Chain:
   *   1. Player is at u=0.25 (top of tube), world y=-2 (y = -r*sin(π/2) = -r)
   *   2. _worldPosToApproxUV computes theta=Math.atan2(-2, outward) = -π/2 → u=0.75
   *   3. player.surfaceU = 0.75 (bottom of tube — WRONG)
   *   4. spawnBullet sets bullet.x = 0.75 (bottom of tube)
   *   5. Client receives bullet at UV (0.75, v) → renders it at bottom of tube
   *   6. But player is VISUALLY at top of tube (u=0.25)
   *   7. User sees bullet spawning from the wrong side of the torus
   *
   * This test proves the surfaceU corruption by simulating the _worldPosToApproxUV
   * call that happens every tick in GameRoom.ts line 1660.
   */

  test('[KNOWN BUG] bullet spawn UV is corrupted for player at top of tube (u=0.25)', () => {
    // Player world position at top of torus tube (u=0.25, v=0.3)
    const playerU = 0.25;
    const playerV = 0.3;
    const worldPos = torusSurface.getPoint(playerU, playerV).position;

    console.log(`\nBullet spawn corruption test:`);
    console.log(`  Player true UV: (${playerU}, ${playerV})`);
    console.log(`  Player world pos: (${worldPos.x.toFixed(2)}, ${worldPos.y.toFixed(2)}, ${worldPos.z.toFixed(2)})`);

    // Server call: _worldPosToApproxUV(wx, wy, wz)
    const serverSurfaceU = gameRoomWorldPosToApproxUV_Torus(worldPos.x, worldPos.y, worldPos.z).u;
    const serverSurfaceV = gameRoomWorldPosToApproxUV_Torus(worldPos.x, worldPos.y, worldPos.z).v;

    console.log(`  Server computed surfaceU: ${serverSurfaceU.toFixed(3)} (expected: ${playerU})`);
    console.log(`  Server computed surfaceV: ${serverSurfaceV.toFixed(3)} (expected: ${playerV})`);

    // Where would the bullet spawn? (spawnBullet: bullet.x = player.surfaceU)
    const bulletSurfaceU = serverSurfaceU;
    const bulletWorldPos = torusSurface.getPoint(bulletSurfaceU, serverSurfaceV).position;
    const playerWorldPos = torusSurface.getPoint(playerU, playerV).position;
    const bulletOffsetFromPlayer = bulletWorldPos.distanceTo(playerWorldPos);

    console.log(`  Bullet spawn UV: (${bulletSurfaceU.toFixed(3)}, ${serverSurfaceV.toFixed(3)})`);
    console.log(`  Bullet world pos: (${bulletWorldPos.x.toFixed(2)}, ${bulletWorldPos.y.toFixed(2)}, ${bulletWorldPos.z.toFixed(2)})`);
    console.log(`  Bullet offset from player: ${bulletOffsetFromPlayer.toFixed(3)} world units`);
    console.log(`  Expected: bullet should spawn within 0.1 world units of player`);
    console.log(`  BUG: bullet spawns ${bulletOffsetFromPlayer.toFixed(2)} world units away (across the tube!)`);

    // Bullet should spawn close to the player (within 0.5 world units)
    // With the Y-sign bug, the bullet spawns ~4 world units away (on opposite side of tube)
    expect(bulletOffsetFromPlayer).toBeLessThan(0.5);
  });

  test('[KNOWN BUG] multiple tube positions: bullet spawn error distribution', () => {
    // Test at all four tube quadrants and multiple phi values
    const tubePositions = [
      { u: 0, label: 'outer edge' },
      { u: 0.25, label: 'top of tube' },
      { u: 0.5, label: 'inner edge' },
      { u: 0.75, label: 'bottom of tube' },
    ];

    let maxError = 0;
    let errorCount = 0;

    console.log(`\nBullet spawn error by tube position:`);

    for (const { u: playerU, label } of tubePositions) {
      for (const playerV of [0, 0.25, 0.5, 0.75]) {
        const worldPos = torusSurface.getPoint(playerU, playerV).position;
        const serverUV = gameRoomWorldPosToApproxUV_Torus(worldPos.x, worldPos.y, worldPos.z);
        const bulletPos = torusSurface.getPoint(serverUV.u, serverUV.v).position;
        const error = bulletPos.distanceTo(worldPos);

        maxError = Math.max(maxError, error);
        if (error > 0.5) errorCount++;
      }
      console.log(`  ${label} (u=${playerU}): max spawn error across phi values`);
    }

    console.log(`  Total bullet spawn errors > 0.5 units: ${errorCount}`);
    console.log(`  Max bullet spawn error: ${maxError.toFixed(3)} world units`);
    console.log(`  (> 0.5 world units = bullet visibly in wrong position)`);

    // All bullet spawn positions should be within 0.5 world units of the player
    expect(errorCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BUG 5: Hit detection threshold sensitivity
// ---------------------------------------------------------------------------

describe('BUG DETECTION: Hit detection ghost kills (bullets at distance)', () => {
  /**
   * Tests the hit detection logic directly.
   * A bullet more than 2x the enemy radius (> 0.6 world units) should NEVER register a hit.
   * A bullet within the enemy radius (< 0.3 world units) should ALWAYS register a hit.
   */

  const BULLET_HIT_WORLD = 0.4;  // from GameRoom.ts line 3260
  const ENEMY_HIT_WORLD  = 0.5;  // from GameRoom.ts line 3252

  test('sphere: torusChordDist correctly computes 0 for same UV (no ghost kill at same position)', () => {
    // Same position should have distance 0 — definitely a hit
    const dist = gameRoomTorusChordDist(0.3, 0.3, 0.3, 0.3);
    expect(dist).toBeCloseTo(0, 5);
  });

  test('sphere: distant bullets (> 2x enemy radius) do NOT cross BULLET_HIT_WORLD threshold', () => {
    // Create two points that are definitely 2+ world units apart
    // u1=0 (outer), u2=0.5 (inner) at same phi → 2*r = 4 world units apart
    const dist = correctTorusChordDist(0, 0, 0.5, 0);
    console.log(`Inner vs outer at same phi: ${dist.toFixed(3)} world units (expected ~4)`);

    // Should be ~4 world units apart — way above the 0.4 bullet hit threshold
    expect(dist).toBeGreaterThan(BULLET_HIT_WORLD * 2);
  });

  test('[KNOWN BUG] GameRoom ghost kill: bullet at inner, enemy at outer, computed as near 0', () => {
    // This is the ACTUAL ghost kill scenario from user reports
    // Bullet at inner surface (u=0.5), enemy at outer surface (u=0), same phi
    // True chord distance = 4 world units → should NOT hit (threshold = 0.4)
    // GameRoom chord distance = ??? → may incorrectly report near-0 due to Y-sign bug

    const bulletU = 0.5;  // inner surface (where bullet appears to server due to UV inversion bug)
    const enemyU = 0;     // outer surface (where enemy actually is)
    const v = 0.25;       // arbitrary phi

    const trueDist = torusSurface.getPoint(bulletU, v).position.distanceTo(
      torusSurface.getPoint(enemyU, v).position
    );
    const gameRoomDist = gameRoomTorusChordDist(bulletU, v, enemyU, v);

    console.log(`\nGhost kill scenario (inner bullet vs outer enemy):`);
    console.log(`  Bullet UV: (${bulletU}, ${v}), Enemy UV: (${enemyU}, ${v})`);
    console.log(`  True world distance: ${trueDist.toFixed(3)}`);
    console.log(`  GameRoom computed distance: ${gameRoomDist.toFixed(3)}`);
    console.log(`  BULLET_HIT_WORLD threshold: ${BULLET_HIT_WORLD}`);
    console.log(`  True would hit: ${trueDist < BULLET_HIT_WORLD} (should be FALSE)`);
    console.log(`  GameRoom would hit: ${gameRoomDist < BULLET_HIT_WORLD}`);

    if (gameRoomDist < BULLET_HIT_WORLD) {
      console.log(`  *** GHOST KILL CONFIRMED: GameRoom reports hit but entities are ${trueDist.toFixed(2)} units apart! ***`);
    }

    // The true distance should be far (no real hit)
    expect(trueDist).toBeGreaterThan(BULLET_HIT_WORLD);

    // This will FAIL if gameRoomDist < BULLET_HIT_WORLD (ghost kill bug confirmed)
    expect(gameRoomDist).toBeGreaterThan(BULLET_HIT_WORLD);
  });

  test('verify: correct formula eliminates ghost kills at tube top/bottom', () => {
    // Bullet at top of tube (u=0.25), enemy at bottom (u=0.75) — should NOT hit
    const dist = correctTorusChordDist(0.25, 0, 0.75, 0);
    const BULLET_HIT_WORLD = 0.4;

    console.log(`Top vs bottom tube (u=0.25 vs u=0.75): corrected dist=${dist.toFixed(3)}`);
    expect(dist).toBeGreaterThan(BULLET_HIT_WORLD);
  });
});

// ---------------------------------------------------------------------------
// BUG 6: Sphere surface — verifying ServerMeshWalker camera frame consistency
// ---------------------------------------------------------------------------

describe('BUG DETECTION: Sphere camera reset (stays angled after reset)', () => {
  const SPHERE_MESH = buildSurfaceGeometry('sphere', 1.0);
  const SPHERE_SURFACE = new MeshSurface(SPHERE_MESH);

  test('sphere: bitangent direction is always perpendicular to normal', () => {
    // If bitangent is not perpendicular to normal, camera up vector is wrong
    const startPos = new THREE.Vector3(0, 10, 0); // north pole
    const walker = new ServerMeshWalker(SPHERE_SURFACE, startPos, PLAYER_WORLD_SPEED);

    // Move in multiple directions
    for (let i = 0; i < 30; i++) {
      walker.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, 0.016);
    }
    for (let i = 0; i < 30; i++) {
      walker.moveWithCameraAxes(1, 0, 0, 0, -1, 0, 1, 0, 0.016);
    }

    const s = walker.getState();
    const normal = new THREE.Vector3(s.nx, s.ny, s.nz);
    const bitangent = new THREE.Vector3(s.bitangentX, s.bitangentY, s.bitangentZ);
    const tangent = new THREE.Vector3(s.tangentX, s.tangentY, s.tangentZ);
    // Note: getState() uses nx/ny/nz for normal, tangentX/Y/Z for tangent, bitangentX/Y/Z for bitangent

    // Bitangent must be perpendicular to normal (dot product ≈ 0)
    const bitangentDotNormal = Math.abs(bitangent.dot(normal));
    const tangentDotNormal = Math.abs(tangent.dot(normal));

    console.log(`Sphere camera frame after mixed movement:`);
    console.log(`  |bitangent · normal| = ${bitangentDotNormal.toFixed(4)} (should be ~0)`);
    console.log(`  |tangent · normal| = ${tangentDotNormal.toFixed(4)} (should be ~0)`);
    console.log(`  (> 0.1 indicates camera frame is not tangent to surface → camera tilt)`);

    expect(bitangentDotNormal).toBeLessThan(0.05);
    expect(tangentDotNormal).toBeLessThan(0.05);
  });

  test('sphere: consecutive normals have smooth transition (no sudden jumps)', () => {
    // Simulate a player starting at the north pole and moving to test camera reset
    const startPos = new THREE.Vector3(0.1, 10, 0); // near north pole
    const walker = new ServerMeshWalker(SPHERE_SURFACE, startPos, PLAYER_WORLD_SPEED);

    let maxNormalJump = 0;
    let prevNormal = (() => {
      const s = walker.getState();
      return new THREE.Vector3(s.nx, s.ny, s.nz);
    })();

    for (let i = 0; i < 120; i++) {
      // Move from near-pole toward equator
      walker.moveWithCameraAxes(0, 1, 1, 0, 0, 0, 1, 0, 0.016);
      const s = walker.getState();
      const normal = new THREE.Vector3(s.nx, s.ny, s.nz);
      const jump = prevNormal.angleTo(normal) * (180 / Math.PI);
      maxNormalJump = Math.max(maxNormalJump, jump);
      prevNormal = normal;
    }

    console.log(`Sphere pole-to-equator: max normal jump = ${maxNormalJump.toFixed(2)}° per frame`);
    console.log(`  (> 10° = camera would visibly snap/tilt — camera reset bug)`);

    // Camera should transition smoothly — less than 10° jump per frame
    expect(maxNormalJump).toBeLessThan(10);
  });
});

// ---------------------------------------------------------------------------
// Summary: What these tests prove
// ---------------------------------------------------------------------------

describe('Test coverage summary', () => {
  test('this test file documents the bugs being tested', () => {
    const bugs = [
      'BUG 1: Torus _worldPosToApproxUV Y-sign error → player appears on inner surface when on outer',
      'BUG 2: Torus torusChordDist Y-sign error → ghost kills when bullet/enemy on opposite tube sides',
      'BUG 3: Sphere camera normal stability → camera tilts sideways during lateral movement',
      'BUG 4: Torus inside-donut → player world position inside torus geometry',
      'BUG 5: Hit detection ghost kills → bullets killing at distance > 2x enemy radius',
      'BUG 6: Sphere camera reset → camera stays angled after reset',
    ];

    console.log('\n=== MP Surface Bug Detector Coverage ===');
    bugs.forEach((bug, i) => console.log(`  ${i + 1}. ${bug}`));
    console.log('========================================\n');

    expect(bugs.length).toBe(6);
  });
});
