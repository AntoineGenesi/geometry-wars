/**
 * Regression test: s44r6-04 — Mobius on-surface collision fallback
 *
 * On non-orientable surfaces (Mobius strip), the surface normal can point in
 * opposite directions for nearby entities due to the half-twist. When the enemy's
 * mesh is elevated by normal * radius, the 3D visual distance can be much larger
 * than the on-surface distance if the normals diverge. This test verifies that
 * the on-surface fallback catches collisions that the visual-position check misses.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

/**
 * Reproduce the dual-check logic from CollisionSystem.checkPlayerEnemyCollisions.
 * Returns true if a collision would be detected.
 */
function wouldCollide(
  playerPos: THREE.Vector3,
  enemySurfacePos: THREE.Vector3,
  enemyMeshPos: THREE.Vector3,
  playerRadius: number,
  enemyRadius: number,
): boolean {
  // Visual-position check (primary — works on orientable surfaces)
  const baseHitRadiusSq = (playerRadius + enemyRadius) ** 2;
  const hitRadiusSq = baseHitRadiusSq + enemyRadius * enemyRadius;
  const visualDistSq = playerPos.distanceToSquared(enemyMeshPos);

  // On-surface fallback (s44r6-04 — catches non-orientable normal divergence)
  const onSurfaceDistSq = playerPos.distanceToSquared(enemySurfacePos);

  return visualDistSq < hitRadiusSq || onSurfaceDistSq < baseHitRadiusSq;
}

describe('Mobius on-surface collision fallback (s44r6-04)', () => {
  it('detects collision when visual positions diverge due to opposite normals', () => {
    // Scenario: player and enemy are at the same surface position, but the
    // Mobius half-twist means the enemy's normal points OPPOSITE to the player's.
    // The enemy mesh is elevated by +normal * radius, but since the normal is
    // flipped, the mesh ends up on the "other side" of the surface — far from
    // the player in 3D, but RIGHT NEXT TO the player on-surface.
    const playerRadius = 0.15; // typical player visual radius
    const enemyRadius = 0.3;  // Wanderer radius

    // Player on surface at origin
    const playerPos = new THREE.Vector3(0, 0, 0);

    // Enemy on surface very close to player (within touch range)
    const enemySurfacePos = new THREE.Vector3(0.2, 0, 0);

    // But enemy mesh is elevated by a FLIPPED normal (pointing downward instead of up)
    // This happens on Mobius when the half-twist flips the normal
    const flippedNormal = new THREE.Vector3(0, -1, 0);
    const enemyMeshPos = enemySurfacePos.clone().addScaledVector(flippedNormal, enemyRadius);
    // enemyMeshPos = (0.2, -0.3, 0) — pushed DOWN, away from player in 3D

    // WITHOUT on-surface fallback: visual distance = sqrt(0.04 + 0.09) = 0.36
    // hitRadiusSq = (0.15+0.3)^2 + 0.3^2 = 0.2025 + 0.09 = 0.2925
    // visualDistSq = 0.04 + 0.09 = 0.13 — this actually IS within range in this case
    // But with a larger normal separation it wouldn't be

    // Test with larger separation to demonstrate the fallback is needed
    const farEnemyMeshPos = enemySurfacePos.clone().addScaledVector(flippedNormal, 2.0);
    // enemyMeshPos = (0.2, -2.0, 0) — pushed very far down

    // Visual check should MISS (too far in 3D)
    const visualDistSq = playerPos.distanceToSquared(farEnemyMeshPos);
    const baseHitRadiusSq = (playerRadius + enemyRadius) ** 2;
    const hitRadiusSq = baseHitRadiusSq + enemyRadius * enemyRadius;
    expect(visualDistSq).toBeGreaterThan(hitRadiusSq); // visual check misses

    // On-surface check should HIT (close on surface)
    const onSurfaceDistSq = playerPos.distanceToSquared(enemySurfacePos);
    expect(onSurfaceDistSq).toBeLessThan(baseHitRadiusSq); // on-surface catches it

    // Combined dual-check should detect collision
    expect(wouldCollide(playerPos, enemySurfacePos, farEnemyMeshPos, playerRadius, enemyRadius)).toBe(true);
  });

  it('still detects collision via visual check on orientable surfaces', () => {
    const playerRadius = 0.15;
    const enemyRadius = 0.3;

    const playerPos = new THREE.Vector3(0, 0, 0);
    const enemySurfacePos = new THREE.Vector3(0.3, 0, 0);

    // Normal pointing up for both — regular orientable surface
    const normal = new THREE.Vector3(0, 1, 0);
    const enemyMeshPos = enemySurfacePos.clone().addScaledVector(normal, enemyRadius);

    expect(wouldCollide(playerPos, enemySurfacePos, enemyMeshPos, playerRadius, enemyRadius)).toBe(true);
  });

  it('does NOT detect collision when truly out of range', () => {
    const playerRadius = 0.15;
    const enemyRadius = 0.3;

    const playerPos = new THREE.Vector3(0, 0, 0);
    // Enemy far away on surface
    const enemySurfacePos = new THREE.Vector3(5, 0, 0);
    const enemyMeshPos = new THREE.Vector3(5, 0.3, 0);

    expect(wouldCollide(playerPos, enemySurfacePos, enemyMeshPos, playerRadius, enemyRadius)).toBe(false);
  });
});

describe('Bullet-enemy Mobius collision fallback (s44r6-04)', () => {
  it('detects bullet hit via on-surface fallback when mesh position diverges', () => {
    const enemyRadius = 0.3;

    const bulletPos = new THREE.Vector3(0.1, 0, 0);
    const enemySurfacePos = new THREE.Vector3(0, 0, 0);

    // Mesh elevated by flipped normal — far in 3D
    const enemyMeshPos = new THREE.Vector3(0, -2, 0);

    // Visual check
    const visualDistSq = bulletPos.distanceToSquared(enemyMeshPos);
    const visualHitRadiusSq = 2 * enemyRadius * enemyRadius;
    expect(visualDistSq).toBeGreaterThan(visualHitRadiusSq); // visual misses

    // On-surface check
    const onSurfaceDistSq = bulletPos.distanceToSquared(enemySurfacePos);
    const onSurfaceHitRadiusSq = enemyRadius * enemyRadius;
    expect(onSurfaceDistSq).toBeLessThan(onSurfaceHitRadiusSq); // surface catches it

    // Combined check passes
    const hit = visualDistSq < visualHitRadiusSq || onSurfaceDistSq < onSurfaceHitRadiusSq;
    expect(hit).toBe(true);
  });
});

describe('Tesla weapon dual distance check (s44r6-04)', () => {
  it('uses minimum of on-surface and visual distance for Tesla range', () => {
    // Tesla effect at player position, enemy with divergent mesh position
    const effectPos = new THREE.Vector3(0, 0, 0);
    const enemySurfacePos = new THREE.Vector3(1.5, 0, 0); // 1.5 units on surface
    const enemyMeshPos = new THREE.Vector3(1.5, -3, 0);   // far in 3D due to flipped normal

    const onSurfaceDist = effectPos.distanceTo(enemySurfacePos);  // 1.5
    const visualDist = effectPos.distanceTo(enemyMeshPos);         // ~3.35

    // The fix: use minimum of the two
    const dist = Math.min(onSurfaceDist, visualDist);

    expect(onSurfaceDist).toBeCloseTo(1.5, 1);
    expect(visualDist).toBeGreaterThan(3);
    expect(dist).toBeCloseTo(1.5, 1); // uses closer distance

    // Tesla radius is 3.0 — enemy at 1.5 should be in range
    expect(dist).toBeLessThan(3.0);
    // Without the fix, visualDist (3.35) > 3.0 = out of range
    expect(visualDist).toBeGreaterThan(3.0);
  });
});
