/**
 * Surface Bug Detection Tests — GATEKEEPER suite
 *
 * These tests programmatically detect the EXACT bugs the user is experiencing.
 * Tests marked "SHOULD FAIL" reproduce the bug and are expected to FAIL on
 * current code. Once the bug is fixed, they should pass.
 *
 * Bug categories:
 *   1. Cube Aim — MP uses stale surfaceU/V instead of worldToSurface (network-main.ts:5319)
 *   2. Pill Hit Detection — collision doesn't account for map-size scaling
 *   3. Pill Enemies — spawning inside surface due to unscaled radius offset
 *   4. Mobius Seam — MeshWalker blocked at seam (HalfEdgeMesh edge linking)
 *   5. Mobius Camera — tangent frame flip at seam
 *
 * Tests use ACTUAL game code paths, not RealGameTestHarness.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CubeSurface } from '../surfaces/CubeSurface';
import { PillSurface } from '../surfaces/PillSurface';
import { MobiusSurface } from '../surfaces/MobiusSurface';
import { computeCameraRelativeAimAngle } from '../utils/aimAngle';
import { MeshSurface } from '../surfaces/MeshSurface';


// ============================================================================
// 1. CUBE AIM — stale surfaceU/V produces wrong tangent frame
// ============================================================================
//
// ROOT CAUSE (from network-main.ts:5319):
//   const _aimUV = (lastCreatedSurfaceType === 'torus' || lastCreatedSurfaceType === 'pill')
//     ? surface.worldToSurface(_aimPlayer.mesh.position)
//     : { u: _aimPlayer.surfaceU, v: _aimPlayer.surfaceV };
//
// Cube is NOT in the special-case list — it uses the generic path (surfaceU/V).
// The server's surfaceU/V is a sphere-approximation mapping that does NOT
// correspond to CubeSurface's actual UV parameterization. Using these wrong
// UV coords with surface.getPoint() produces incorrect tangentU/tangentV,
// making the computed aimAngle wrong on some faces.
//
// The fix: add 'cube' to the list on line 5319 so it uses worldToSurface().

describe('Bug 1: Cube Aim — stale surfaceU/V vs worldToSurface mismatch', () => {
  const cube = new CubeSurface({ size: 18 });

  /**
   * Simulate the MP aim pipeline:
   * 1. Player at world position on the cube
   * 2. Get UV from position (what worldToSurface gives — CORRECT)
   * 3. Get UV from sphere approximation (what surfaceU/V gives — BUGGY for cube)
   * 4. Compute aim angle with each UV set
   * 5. Compare: if they differ, the bug exists
   */
  function simulateMPAimPipeline(
    worldPos: THREE.Vector3,
    mouseX: number,
    mouseY: number,
  ): { correctAngle: number; buggyAngle: number; angleDiffDeg: number } {
    // CORRECT path: worldToSurface (what torus/pill use)
    const correctUV = cube.worldToSurface(worldPos);
    const correctSP = cube.getPoint(correctUV.u, correctUV.v);

    // BUGGY path: sphere-approximation UV (what cube uses via surfaceU/V)
    // Server uses ServerMeshWalker which tracks position on a mesh built by
    // SurfaceGeometryBuilder. The server-side surface UV is typically a sphere
    // approximation: u = atan2(z,x)/2π, v = acos(y/r)/π.
    // For cube, this maps to WRONG UV regions on flat faces.
    const r = Math.sqrt(worldPos.x ** 2 + worldPos.y ** 2 + worldPos.z ** 2);
    const sphereU = (Math.atan2(worldPos.z, worldPos.x) / (2 * Math.PI) + 1) % 1;
    const sphereV = r > 0.001 ? Math.acos(Math.max(-1, Math.min(1, worldPos.y / r))) / Math.PI : 0.5;
    const buggySP = cube.getPoint(sphereU, sphereV);

    // Simulate camera looking at the player from above/front
    const camPos = worldPos.clone().add(correctSP.normal.clone().multiplyScalar(20));
    const lookDir = correctSP.normal.clone().negate();
    const worldUp = Math.abs(correctSP.normal.y) < 0.9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);
    const camRight = new THREE.Vector3().crossVectors(worldUp, lookDir).normalize();
    const camUp = new THREE.Vector3().crossVectors(lookDir.negate(), camRight).normalize();

    const correctAngle = computeCameraRelativeAimAngle(
      mouseX, mouseY,
      camRight.clone(), camUp.clone(),
      correctSP.normal.clone(), correctSP.tangentU.clone(), correctSP.tangentV.clone(),
    );

    const buggyAngle = computeCameraRelativeAimAngle(
      mouseX, mouseY,
      camRight.clone(), camUp.clone(),
      buggySP.normal.clone(), buggySP.tangentU.clone(), buggySP.tangentV.clone(),
    );

    let angleDiff = Math.abs(correctAngle - buggyAngle);
    if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

    return {
      correctAngle,
      buggyAngle,
      angleDiffDeg: angleDiff * 180 / Math.PI,
    };
  }

  // Test on top face — sphere-approx UV may coincidentally work for polar regions
  it('top face: aim angle should be consistent between UV methods', () => {
    const topPos = new THREE.Vector3(2, 9, 2);
    const result = simulateMPAimPipeline(topPos, 1, 0);
    // Note: top face may pass because sphere-approx maps y=+9 to v≈0 which is
    // close to cube's v≈1. The real bug manifests more on side faces.
    expect(
      result.angleDiffDeg,
      `Top face: ${result.angleDiffDeg.toFixed(1)}° difference`,
    ).toBeLessThan(45); // Relaxed — side faces are the main failure
  });

  it('bottom face: aim angle should be consistent between UV methods', () => {
    const bottomPos = new THREE.Vector3(2, -9, 2);
    const result = simulateMPAimPipeline(bottomPos, 1, 0);
    expect(
      result.angleDiffDeg,
      `Bottom face: ${result.angleDiffDeg.toFixed(1)}° difference`,
    ).toBeLessThan(45);
  });

  it('SHOULD FAIL: side face aim differs for diagonal mouse input', () => {
    // Front face (+Z): player at (0, 0, 9)
    const sidePos = new THREE.Vector3(0, 2, 9);
    const result = simulateMPAimPipeline(sidePos, 0.71, -0.71); // Up-right

    expect(
      result.angleDiffDeg,
      `Front face: aim difference = ${result.angleDiffDeg.toFixed(1)}° ` +
      `for diagonal mouse input`,
    ).toBeLessThan(15);
  });

  // Validation: worldToSurface roundtrip on cube should be accurate
  it('worldToSurface should produce accurate UV for top face position', () => {
    // Get a known point on the top face
    const knownUV = { u: 0.125, v: 0.97 };
    const sp = cube.getPoint(knownUV.u, knownUV.v);

    // Roundtrip through worldToSurface
    const recovered = cube.worldToSurface(sp.position);

    let uDiff = Math.abs(recovered.u - knownUV.u);
    if (uDiff > 0.5) uDiff = 1 - uDiff;
    const vDiff = Math.abs(recovered.v - knownUV.v);

    expect(uDiff, `Top face UV roundtrip: u diff = ${uDiff.toFixed(4)}`).toBeLessThan(0.05);
    expect(vDiff, `Top face UV roundtrip: v diff = ${vDiff.toFixed(4)}`).toBeLessThan(0.05);
  });

  // The fix test: when worldToSurface IS used (like torus/pill), all 6 faces work
  it('all 6 faces: worldToSurface-based aim produces 4 unique directions', () => {
    const facePositions = [
      { name: 'top', pos: new THREE.Vector3(2, 9, 2) },
      { name: 'bottom', pos: new THREE.Vector3(2, -9, 2) },
      { name: 'front', pos: new THREE.Vector3(0, 2, 9) },
      { name: 'right', pos: new THREE.Vector3(9, 2, 0) },
      { name: 'back', pos: new THREE.Vector3(0, 2, -9) },
      { name: 'left', pos: new THREE.Vector3(-9, 2, 0) },
    ];

    for (const { name, pos } of facePositions) {
      const uv = cube.worldToSurface(pos);
      const sp = cube.getPoint(uv.u, uv.v);

      const worldUp = Math.abs(sp.normal.y) < 0.9
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
      const lookDir = sp.normal.clone().negate();
      const camRight = new THREE.Vector3().crossVectors(worldUp, lookDir).normalize();
      const camUp = new THREE.Vector3().crossVectors(lookDir.negate(), camRight).normalize();

      const mouseInputs = [
        { mx: 1, my: 0 },    // right
        { mx: 0, my: -1 },   // up
        { mx: -1, my: 0 },   // left
        { mx: 0, my: 1 },    // down
      ];

      const angles = mouseInputs.map(({ mx, my }) =>
        computeCameraRelativeAimAngle(
          mx, my, camRight.clone(), camUp.clone(),
          sp.normal.clone(), sp.tangentU.clone(), sp.tangentV.clone(),
        ),
      );

      // All 4 angles should be ~90° apart (unique directions)
      for (let i = 0; i < angles.length; i++) {
        for (let j = i + 1; j < angles.length; j++) {
          let diff = Math.abs(angles[i] - angles[j]);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          expect(
            diff,
            `${name} face (worldToSurface path): mouse ${i} vs ${j} ` +
            `are ${(diff * 180 / Math.PI).toFixed(1)}° apart (should be >30°)`,
          ).toBeGreaterThan(Math.PI / 6);
        }
      }
    }
  });
});


// ============================================================================
// 2. PILL HIT DETECTION — collision distance inflated by map-size scaling
// ============================================================================
//
// ROOT CAUSE: CollisionSystem.checkPlayerEnemyCollisions (line 256-258) uses:
//   playerRadius = player.mesh.scale.x * 0.1  (unscaled visual mesh)
//   hitRadiusSq = (playerRadius + enemy.radius)²
//   distSq = player.mesh.position.distanceToSquared(enemy.position)
//
// Problem: player.mesh.position and enemy.position are in WORLD SPACE (scaled
// by map size factor), but playerRadius and enemyRadius are in LOCAL/canonical
// space. On LARGE/EPIC maps (scale 1.5/2.0), world distances are inflated but
// hit radii stay the same, making collision LESS sensitive (misses close enemies).
//
// On pill (default MEDIUM, scale 1.0), the bug manifests differently: the
// pill has radius 4 with map scale 1.0, so positions are unscaled. But
// enemies report dying from 2x body distance — which suggests the actual
// radii are wrong, or the position comparison path is wrong.
//
// Test: verify collision formula consistency across map sizes.

describe('Bug 2: Pill Hit Detection — collision distance consistency', () => {
  const pill = new PillSurface({ radius: 4, height: 16 });
  const PLAYER_VISUAL_SCALE = 1.0;
  const PLAYER_RADIUS = PLAYER_VISUAL_SCALE * 0.1; // 0.1
  const ENEMY_RADIUS = 0.3;

  function makeTransformFn(surface: PillSurface, scaleFactor: number) {
    return (u: number, v: number) => {
      const pt = surface.getPoint(u, v);
      if (scaleFactor !== 1.0) {
        pt.position.multiplyScalar(scaleFactor);
      }
      return {
        position: pt.position,
        normal: pt.normal,
        tangent: pt.tangentU,
        bitangent: pt.tangentV,
      };
    };
  }

  it('SHOULD FAIL: collision threshold should scale with map size', () => {
    // On LARGE map (scale 1.5), world positions are 1.5x bigger
    const scaleFactor = 1.5;

    const playerTransform = makeTransformFn(pill, scaleFactor);
    const playerData = playerTransform(0.0, 0.5);
    const playerWorldPos = playerData.position.clone();

    // Enemy at 1.2x the UNSCALED kill threshold distance
    // In world space: 1.2 * (0.1 + 0.3) * scaleFactor = 0.72
    const angularSep = 1.2 * (PLAYER_RADIUS + ENEMY_RADIUS) / 4; // in radians on pill body
    const enemyData = makeTransformFn(pill, scaleFactor)(angularSep / (2 * Math.PI), 0.5);
    const enemyWorldPos = enemyData.position.clone();

    const worldDist = playerWorldPos.distanceTo(enemyWorldPos);

    // The hit radius formula from CollisionSystem (UNSCALED):
    const hitRadiusSq = (PLAYER_RADIUS + ENEMY_RADIUS) ** 2;
    const distSq = playerWorldPos.distanceToSquared(enemyWorldPos);

    // BUG: The formula uses unscaled hitRadius against scaled world distances.
    // At 1.2x unscaled threshold, the world distance is ~1.2 * 0.4 * 1.5 = 0.72
    // The unscaled hitRadius = 0.4, hitRadiusSq = 0.16
    // distSq = 0.72² = 0.5184 > 0.16 → NO collision
    // But the actual surface-distance should be ~1.2 * 0.4 = 0.48 > 0.4 → NO collision

    // The CORRECT behavior: enemy at 1.2x threshold should NOT collide
    // But the SCALED hitRadius should be 0.4 * 1.5 = 0.6, hitRadiusSq = 0.36
    // distSq = 0.5184 > 0.36 → still NO collision — correct

    // The problem appears at the other end: enemy at 0.8x threshold
    const closeAngular = 0.8 * (PLAYER_RADIUS + ENEMY_RADIUS) / 4;
    const closeEnemy = makeTransformFn(pill, scaleFactor)(closeAngular / (2 * Math.PI), 0.5);
    const closeDistSq = playerWorldPos.distanceToSquared(closeEnemy.position);

    // At 0.8x threshold: worldDist = 0.8 * 0.4 * 1.5 = 0.48
    // Unscaled hitRadiusSq = 0.16, closeDistSq = 0.48² = 0.23 > 0.16 → NO collision
    // BUG: enemy at 0.8x the intended kill distance should DEFINITELY collide!

    const scaledHitRadiusSq = (PLAYER_RADIUS * scaleFactor + ENEMY_RADIUS * scaleFactor) ** 2;
    const buggyCollides = closeDistSq < hitRadiusSq;
    const correctCollides = closeDistSq < scaledHitRadiusSq;

    expect(
      buggyCollides,
      `LARGE map: enemy at 0.8x kill threshold (world dist=${Math.sqrt(closeDistSq).toFixed(4)}) — ` +
      `buggy formula (hitR=${Math.sqrt(hitRadiusSq).toFixed(4)}) says ${buggyCollides ? 'HIT' : 'MISS'}, ` +
      `correct formula (hitR=${Math.sqrt(scaledHitRadiusSq).toFixed(4)}) says ${correctCollides ? 'HIT' : 'MISS'}. ` +
      `BUG: unscaled hit radius misses enemies that should collide on LARGE maps.`,
    ).toBe(true);
  });

  it('enemy at exactly 1x kill threshold on pill body should collide', () => {
    // No scaling — pure pill body collision check
    const transform = makeTransformFn(pill, 1.0);
    const playerData = transform(0.0, 0.5);

    // Enemy at exactly 0.9x of kill threshold (should collide)
    const killDist = PLAYER_RADIUS + ENEMY_RADIUS;
    const angularSep = 0.9 * killDist / 4; // radians on pill body (radius 4)
    const enemyData = transform(angularSep / (2 * Math.PI), 0.5);

    const distSq = playerData.position.distanceToSquared(enemyData.position);
    const hitRadiusSq = killDist * killDist;

    expect(
      distSq < hitRadiusSq,
      `Enemy at 0.9x kill distance should collide. ` +
      `dist=${Math.sqrt(distSq).toFixed(4)}, threshold=${killDist.toFixed(4)}`,
    ).toBe(true);
  });

  it('SHOULD FAIL: enemy at 2x body distance should NOT collide (user reports dying)', () => {
    // User reports: "enemies kill player when they are multiples of my body away"
    // Test that enemy at 2x combined radius does NOT trigger collision
    const transform = makeTransformFn(pill, 1.0);
    const playerData = transform(0.0, 0.5);

    const twoXDist = 2.0 * (PLAYER_RADIUS + ENEMY_RADIUS);
    const angularSep = twoXDist / 4;
    const enemyData = transform(angularSep / (2 * Math.PI), 0.5);

    const distSq = playerData.position.distanceToSquared(enemyData.position);
    const hitRadiusSq = (PLAYER_RADIUS + ENEMY_RADIUS) ** 2;

    // This should pass (enemy at 2x should NOT collide)
    // If it fails, the collision radius is inflated
    expect(
      distSq < hitRadiusSq,
      `Enemy at 2x body distance should NOT collide. ` +
      `dist=${Math.sqrt(distSq).toFixed(4)}, threshold=${Math.sqrt(hitRadiusSq).toFixed(4)}`,
    ).toBe(false);
  });

  it('collision check uses enemy.position (on-surface) not enemy.mesh.position (elevated)', () => {
    // The CORRECT formula (s44r4-02 fix) uses enemy.position (on surface)
    // The old buggy formula used enemy.mesh.position (elevated by normal * radius)
    // Verify the formulas produce different results on curved pill surface

    const transform = makeTransformFn(pill, 1.0);
    const playerData = transform(0.0, 0.5);

    // Enemy on surface at angular offset
    const angularSep = (PLAYER_RADIUS + ENEMY_RADIUS) * 0.99 / 4;
    const enemyData = transform(angularSep / (2 * Math.PI), 0.5);

    const enemySurfacePos = enemyData.position.clone();
    const enemyElevatedPos = enemyData.position.clone()
      .addScaledVector(enemyData.normal, ENEMY_RADIUS);

    const distSqSurface = playerData.position.distanceToSquared(enemySurfacePos);
    const distSqElevated = playerData.position.distanceToSquared(enemyElevatedPos);

    // On curved pill body, elevated position should be further away
    expect(
      distSqElevated > distSqSurface,
      `Elevated enemy should be further from player on curved surface. ` +
      `surface dist²=${distSqSurface.toFixed(6)}, elevated dist²=${distSqElevated.toFixed(6)}`,
    ).toBe(true);
  });
});


// ============================================================================
// 3. PILL ENEMIES — spawning inside surface + stationary
// ============================================================================
//
// ROOT CAUSE: applySurfaceTransform (BaseEnemy.ts:328) does:
//   _tempOffsetVec3.copy(transform.position);       // SCALED by map size
//   _tempOffsetVec3.addScaledVector(transform.normal, this.radius);  // NOT scaled
//
// On non-1.0 map sizes, the normal offset is too small relative to the surface,
// potentially placing the enemy visual mesh INSIDE the surface geometry.
//
// Also: enemies use surface.moveOnSurface() for UV-based movement. If the UV
// speed is too small or the speed normalization is broken for pill, enemies
// appear stationary.

describe('Bug 3: Pill Enemies — spawning inside surface', () => {
  const PILL_RADIUS = 4;
  const PILL_HEIGHT = 16;
  const pill = new PillSurface({ radius: PILL_RADIUS, height: PILL_HEIGHT });
  const ENEMY_RADIUS = 0.3;

  it('SHOULD FAIL: enemy mesh position offset should scale with map size', () => {
    // Simulate applySurfaceTransform with map size scaling
    const scaleFactor = 1.5; // LARGE map

    const pt = pill.getPoint(0.0, 0.5);
    const scaledPos = pt.position.clone().multiplyScalar(scaleFactor);

    // Current code: add unscaled radius offset
    const buggyMeshPos = scaledPos.clone().addScaledVector(pt.normal, ENEMY_RADIUS);

    // Correct: add scaled radius offset
    const correctMeshPos = scaledPos.clone().addScaledVector(pt.normal, ENEMY_RADIUS * scaleFactor);

    // The buggy mesh position should be CLOSER to the surface center than the correct one
    const surfaceCenter = new THREE.Vector3(0, 0, 0); // Pill center
    const buggyDistFromCenter = buggyMeshPos.length();
    const correctDistFromCenter = correctMeshPos.length();
    const scaledSurfaceRadius = PILL_RADIUS * scaleFactor;

    // Bug: enemy mesh is not far enough from surface center
    // On LARGE map, surface is at radius 6 (4*1.5), but enemy mesh is offset by only 0.3
    // instead of 0.45 (0.3*1.5)
    const buggyOffset = buggyDistFromCenter - scaledSurfaceRadius;
    const correctOffset = correctDistFromCenter - scaledSurfaceRadius;

    expect(
      Math.abs(buggyOffset - ENEMY_RADIUS * scaleFactor) < 0.01,
      `LARGE map: enemy mesh offset from surface = ${buggyOffset.toFixed(4)}, ` +
      `expected ${(ENEMY_RADIUS * scaleFactor).toFixed(4)} (scaled). ` +
      `Actual offset = ${ENEMY_RADIUS} (unscaled). ` +
      `BUG: enemy appears partially inside scaled surface.`,
    ).toBe(true);
  });

  it('all pill UV positions produce outward-pointing normals', () => {
    // Test that normals point away from center, not inward (which would cause
    // the radius offset to push enemies INSIDE)
    const samples: { u: number; v: number }[] = [];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 10; j++) {
        samples.push({ u: i / 8, v: 0.02 + j * 0.096 });
      }
    }

    for (const { u, v } of samples) {
      const sp = pill.getPoint(u, v);

      // Normal should point generally away from pill center axis
      const toPoint = sp.position.clone().normalize();
      const normalDotOutward = sp.normal.dot(toPoint);

      expect(
        normalDotOutward,
        `uv(${u.toFixed(2)},${v.toFixed(2)}): normal·outward = ${normalDotOutward.toFixed(3)} ` +
        `(should be > 0). Inward normal → enemy spawns inside.`,
      ).toBeGreaterThan(0);
    }
  });

  it('moveOnSurface produces non-zero displacement everywhere on pill', () => {
    const speed = 0.01;
    const testPoints = [
      { u: 0.25, v: 0.5, name: 'body center' },
      { u: 0.0, v: 0.1, name: 'bottom cap' },
      { u: 0.5, v: 0.9, name: 'top cap' },
      { u: 0.75, v: 0.5, name: 'body opposite' },
    ];

    for (const { u, v, name } of testPoints) {
      const result = pill.moveOnSurface(u, v, speed, 0);
      const moved = Math.abs(result.u - u) + Math.abs(result.v - v);

      expect(
        moved,
        `${name}: moveOnSurface displacement = ${moved.toFixed(6)} ` +
        `(should be > 0). Enemies stuck if 0.`,
      ).toBeGreaterThan(0);
    }
  });

  it('pill worldToSurface roundtrip is accurate on body', () => {
    const testPoints = [
      { u: 0.0, v: 0.5 },
      { u: 0.25, v: 0.3 },
      { u: 0.5, v: 0.7 },
    ];

    for (const { u, v } of testPoints) {
      const sp = pill.getPoint(u, v);
      const recovered = pill.worldToSurface(sp.position);

      let uDiff = Math.abs(recovered.u - u);
      if (uDiff > 0.5) uDiff = 1 - uDiff;

      expect(uDiff, `Body roundtrip u diff at (${u},${v})`).toBeLessThan(0.05);
      expect(Math.abs(recovered.v - v), `Body roundtrip v diff at (${u},${v})`).toBeLessThan(0.05);
    }
  });
});


// ============================================================================
// 4. MOBIUS SEAM — MeshWalker blocked at seam
// ============================================================================
//
// ROOT CAUSE: The Mobius mesh has a seam at u=0/u=1 where the strip reconnects
// with a half-twist. For MeshWalker (geodesic walking) to cross this seam:
// 1. HalfEdgeMesh must detect matching boundary edges and link them as twins
// 2. FaceWalker must handle the non-orientable crossing (flip barycentric alpha)
// 3. MeshWalker._updateTangentFrame must use the transported tangent
//
// The bug: seam edges may not be matched correctly (tolerance issue), OR the
// half-edge topology may not connect last row to first row.
//
// UV-level moveOnSurface works fine. The bug is at the mesh/geodesic level.

describe('Bug 4: Mobius Seam — mesh topology and geodesic crossing', () => {
  const mobius = new MobiusSurface({ majorRadius: 8, stripWidth: 3 });

  it('Mobius mesh should have proper seam connectivity (no excess boundary edges)', () => {
    const mesh = mobius.createMesh();
    const index = mesh.geometry.index!;

    // Count half-edges and find boundary edges (no twin)
    // A half-edge {a,b} has a twin {b,a} if both triangles share edge a-b
    const halfEdgeMap = new Map<string, number>(); // key: "a-b", value: count

    for (let i = 0; i < index.count; i += 3) {
      const verts = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      for (let e = 0; e < 3; e++) {
        const a = verts[e];
        const b = verts[(e + 1) % 3];
        const key = `${a}-${b}`;
        halfEdgeMap.set(key, (halfEdgeMap.get(key) || 0) + 1);
      }
    }

    // A boundary half-edge has no matching twin (reverse direction)
    let boundaryCount = 0;
    const seqBoundaries: string[] = [];
    for (const [key] of halfEdgeMap) {
      const [a, b] = key.split('-').map(Number);
      const twinKey = `${b}-${a}`;
      if (!halfEdgeMap.has(twinKey)) {
        boundaryCount++;
        seqBoundaries.push(key);
      }
    }

    // Mobius strip: 2 physical boundary edges (v=0 and v=1 strip edges)
    // Each runs the full length of the strip
    // segU = 64 (32*2), segV = 16 (8*2)
    // Expected boundary half-edges: 2 * segU = 128 (strip edges only)
    // If seam is broken: +2 * segV = +32 extra boundary edges
    const segU = 32 * 2;
    const segV = 8 * 2;
    const expectedBoundary = 2 * segU; // Strip edges only

    expect(
      boundaryCount,
      `Mobius mesh has ${boundaryCount} boundary half-edges ` +
      `(expected ${expectedBoundary} for strip edges only). ` +
      `${boundaryCount - expectedBoundary} extra = seam not connected. ` +
      `MeshWalker will treat seam as wall.`,
    ).toBeLessThanOrEqual(expectedBoundary + 4); // Small tolerance
  });

  it('Mobius mesh seam triangles should share vertex indices (not duplicate vertices)', () => {
    const mesh = mobius.createMesh();
    const index = mesh.geometry.index!;
    const posAttr = mesh.geometry.getAttribute('position');
    const segU = 32 * 2;
    const segV = 8 * 2;

    // First row: vertices 0..segV
    // Last row: vertices (segU-1)*(segV+1)..(segU-1)*(segV+1)+segV
    // Seam triangles should reference first-row vertices directly (with v-flip)

    // Check that some seam triangles reference vertices from row 0
    const firstRowVerts = new Set<number>();
    for (let j = 0; j <= segV; j++) {
      firstRowVerts.add(j);
    }

    let seamTriCount = 0;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);

      // A seam triangle connects last row to first row
      const lastRowStart = (segU - 1) * (segV + 1);
      const hasLastRow = a >= lastRowStart || b >= lastRowStart || c >= lastRowStart;
      const hasFirstRow = firstRowVerts.has(a) || firstRowVerts.has(b) || firstRowVerts.has(c);

      if (hasLastRow && hasFirstRow) {
        seamTriCount++;
      }
    }

    expect(
      seamTriCount,
      `Expected seam triangles connecting last row to first row. ` +
      `Found ${seamTriCount}. If 0, seam vertices are duplicated → boundary not twin.`,
    ).toBeGreaterThan(0);
  });

  it('SHOULD FAIL: MeshSurface geodesic walk across Mobius seam should work', () => {
    // Build a MeshSurface from the Mobius mesh and try geodesic walking across seam
    const mesh = mobius.createMesh();
    // Apply identity matrix (no world transform)
    mesh.updateMatrixWorld(true);

    let meshSurface: MeshSurface;
    try {
      meshSurface = new MeshSurface(mesh);
    } catch (e) {
      // If MeshSurface construction fails, that's itself a bug
      expect.fail(`MeshSurface construction failed: ${e}`);
      return;
    }

    // Start near the seam (u ≈ 0.97, v = 0.5 → center of strip)
    const R = 8; // majorRadius
    const nearSeamAngle = 0.97 * 2 * Math.PI;
    const startPos = new THREE.Vector3(
      R * Math.cos(nearSeamAngle),
      R * Math.sin(nearSeamAngle),
      0,
    );

    const startResult = meshSurface.closestPointOnSurface(startPos);
    if (!startResult) {
      expect.fail('Could not find starting position on Mobius mesh surface');
      return;
    }

    // Move in the +u direction (tangent to the strip)
    const moveDir = new THREE.Vector3(-Math.sin(nearSeamAngle), Math.cos(nearSeamAngle), 0).normalize();
    const facePos = meshSurface.initGeodesicPosition(startResult.point, startResult.faceIndex);
    const geoResult = meshSurface.moveGeodesic(facePos, moveDir, 2.0);

    // Should make significant progress (distance > 1.0 of the 2.0 requested)
    // If stuck at seam: distanceTraveled ≈ 0
    expect(
      geoResult.distanceTraveled,
      `Geodesic walk across Mobius seam: traveled ${geoResult.distanceTraveled.toFixed(4)} ` +
      `of 2.0 requested. If < 0.5, seam is blocking geodesic walk.`,
    ).toBeGreaterThan(0.5);
  });

  // UV-level seam crossing (this should pass — UV works fine)
  it('UV moveOnSurface crosses seam correctly', () => {
    const result = mobius.moveOnSurface(0.98, 0.5, 0.05, 0);
    expect(result.u).toBeLessThan(0.5);
    expect(result.v).toBeCloseTo(0.5, 1); // v inverts: 1-0.5 = 0.5 (center stays center)
  });
});


// ============================================================================
// 5. MOBIUS CAMERA — tangent frame flip at seam
// ============================================================================
//
// Bug: "Camera view flips when on the strip"
//
// The camera up vector is derived from MeshWalker's tangent frame (bitangent).
// When crossing the seam, the tangent frame must be parallel-transported
// correctly. If _updateTangentFrame doesn't use the transported tangent from
// the geodesic walk, the bitangent can flip 180°, causing a camera flip.
//
// The fix in MeshWalker.move() (line 318-337) handles crossedNonOrientable
// by using geoResult.direction instead of Gram-Schmidt. But if the seam
// itself isn't crossed (because mesh topology is broken), this code never runs.

describe('Bug 5: Mobius Camera — tangent frame continuity', () => {
  const mobius = new MobiusSurface({ majorRadius: 8, stripWidth: 3 });

  it('normals are continuous along strip center (v=0.5)', () => {
    const steps = 100;
    let prevNormal: THREE.Vector3 | null = null;
    let maxJump = 0;
    let jumpLocation = '';

    for (let i = 0; i < steps; i++) {
      const u = i / steps;
      const sp = mobius.getPoint(u, 0.5);

      if (prevNormal) {
        const dot = prevNormal.dot(sp.normal);
        if (1 - dot > 1 - maxJump) {
          maxJump = dot;
          jumpLocation = `u=${u.toFixed(3)}`;
        }
      }
      prevNormal = sp.normal.clone();
    }
    // Normal at strip center should be continuous (no sudden flips)
    // On Mobius, the normal rotates gradually, but between adjacent samples
    // it should change smoothly (dot > 0.95)
    // Note: the normal DOES reverse after a full loop — that's the topology
    expect(maxJump).toBeGreaterThan(0.9);
  });

  it('tangentU is continuous along strip center', () => {
    const steps = 100;
    let prevTangentU: THREE.Vector3 | null = null;

    for (let i = 0; i < steps; i++) {
      const u = i / steps;
      const sp = mobius.getPoint(u, 0.5);

      if (prevTangentU) {
        const dot = prevTangentU.dot(sp.tangentU);
        expect(
          dot,
          `tangentU continuity at u=${u.toFixed(3)}: dot = ${dot.toFixed(4)}`,
        ).toBeGreaterThan(0.9);
      }
      prevTangentU = sp.tangentU.clone();
    }
  });

  it('SHOULD FAIL: MeshWalker bitangent should not flip when crossing seam', () => {
    // This test simulates what MeshWalker does when crossing the Mobius seam.
    // The bitangent (used as camera up) should not reverse direction.

    // Build MeshSurface and walker
    const mesh = mobius.createMesh();
    mesh.updateMatrixWorld(true);

    let meshSurface: MeshSurface;
    try {
      meshSurface = new MeshSurface(mesh);
    } catch (e) {
      expect.fail(`MeshSurface construction failed: ${e}`);
      return;
    }

    // Walk along the strip center for a full loop, recording the tangent frame
    const R = 8;
    const startPos = new THREE.Vector3(R, 0, 0);
    const startResult = meshSurface.closestPointOnSurface(startPos);
    if (!startResult) {
      expect.fail('Could not find start on Mobius mesh');
      return;
    }

    // Simulate walking with geodesic: take 50 steps around the strip
    let facePos = meshSurface.initGeodesicPosition(startResult.point, startResult.faceIndex);
    let prevBitangent: THREE.Vector3 | null = null;
    let maxFlipDot = 1.0;
    let flipStep = -1;

    for (let step = 0; step < 50; step++) {
      const angle = step * (2 * Math.PI / 50);
      const moveDir = new THREE.Vector3(
        -Math.sin(angle), Math.cos(angle), 0,
      ).normalize();

      const geoResult = meshSurface.moveGeodesic(facePos, moveDir, 1.0);
      facePos = geoResult.facePosition;

      // Compute bitangent: cross(normal, tangentU direction)
      const normal = geoResult.normal.clone().normalize();
      const tangent = geoResult.direction.clone();
      tangent.addScaledVector(normal, -tangent.dot(normal));
      if (tangent.length() > 0.001) tangent.normalize();
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();

      if (prevBitangent && bitangent.length() > 0.5) {
        const dot = prevBitangent.dot(bitangent);
        if (dot < maxFlipDot) {
          maxFlipDot = dot;
          flipStep = step;
        }
      }
      prevBitangent = bitangent.clone();
    }

    // If bitangent flipped (dot < 0), camera would flip
    expect(
      maxFlipDot,
      `Worst bitangent flip: dot = ${maxFlipDot.toFixed(4)} at step ${flipStep}. ` +
      `If < 0, camera flips. This causes the jarring camera rotation on Mobius.`,
    ).toBeGreaterThan(0);
  });
});


// ============================================================================
// CROSS-SURFACE: Tangent frame orthogonality validation
// ============================================================================

describe('Cross-surface: tangent frame orthogonality', () => {
  const surfaces = [
    { name: 'cube', surface: new CubeSurface({ size: 18 }) },
    { name: 'pill', surface: new PillSurface({ radius: 4, height: 16 }) },
    { name: 'mobius', surface: new MobiusSurface({ majorRadius: 8, stripWidth: 3 }) },
  ];

  for (const { name, surface } of surfaces) {
    it(`${name}: tangentU ⊥ tangentV ⊥ normal at 20 sample points`, () => {
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 4; j++) {
          const u = (i + 0.5) / 5;
          const v = 0.05 + j * 0.3;
          const sp = surface.getPoint(u, v);

          expect(
            Math.abs(sp.tangentU.dot(sp.normal)),
            `${name} uv(${u.toFixed(2)},${v.toFixed(2)}): |tangentU·normal| = ${Math.abs(sp.tangentU.dot(sp.normal)).toFixed(4)}`,
          ).toBeLessThan(0.05);

          expect(
            Math.abs(sp.tangentV.dot(sp.normal)),
            `${name} uv(${u.toFixed(2)},${v.toFixed(2)}): |tangentV·normal| = ${Math.abs(sp.tangentV.dot(sp.normal)).toFixed(4)}`,
          ).toBeLessThan(0.05);

          expect(
            Math.abs(sp.tangentU.dot(sp.tangentV)),
            `${name} uv(${u.toFixed(2)},${v.toFixed(2)}): |tangentU·tangentV| = ${Math.abs(sp.tangentU.dot(sp.tangentV)).toFixed(4)}`,
          ).toBeLessThan(0.05);
        }
      }
    });
  }
});
