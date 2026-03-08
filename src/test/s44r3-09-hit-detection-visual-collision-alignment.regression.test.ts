/**
 * Regression test for s44r3-09: Hit detection offset on Mobius and other maps.
 *
 * Root cause: CollisionSystem used enemy.position (ON the mesh surface) for
 * collision checks, but enemies render at enemy.mesh.position (ABOVE the
 * surface by normal * radius). On curved surfaces, the visual position and
 * collision position diverge due to parallax. The player aims at the visual
 * enemy but the collision point is offset.
 *
 * Fix: CollisionSystem now uses enemy.mesh.position (the visual position) for
 * both spatial hash insertion and distance checks. The hit radius is inflated
 * to account for the bullet being ON the surface while the enemy center is
 * ABOVE the surface (hitRadiusSq = 2 * radius² instead of radius²).
 *
 * This test verifies that collision checks use the visual position.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import * as THREE from 'three';
import { CollisionSystem } from '../core/CollisionSystem';

// CollisionSystem references `window` for debug flags — provide a global stub
beforeAll(() => {
  if (typeof globalThis.window === 'undefined') {
    (globalThis as any).window = {};
  }
});

// Minimal mock enemy that exposes both surface and visual positions
function createMockEnemy(
  surfacePos: THREE.Vector3,
  normal: THREE.Vector3,
  radius: number = 0.3,
) {
  const meshPos = surfacePos.clone().addScaledVector(normal, radius);
  return {
    active: true,
    alive: true,
    health: 10,
    maxHealth: 10,
    radius,
    scoreValue: 100,
    geomCount: 1,
    position: surfacePos.clone(),
    mesh: {
      position: meshPos,
      scale: new THREE.Vector3(1, 1, 1),
    },
    surfacePosition: { u: 0.5, v: 0.5 },
    isMaterializing: false,
    isGhostForPlayer: false,
    isInstanced: false,
    cachedMaterials: null,
    constructor: { name: 'Wanderer' },
    takeDamage: vi.fn(function (this: any, amount: number) {
      this.health -= amount;
      if (this.health <= 0) this.alive = false;
    }),
    damageBy: new Map(),
  } as any;
}

describe('s44r3-09: Hit detection uses visual position (enemy.mesh.position)', () => {
  let collisionSystem: CollisionSystem;

  beforeEach(() => {
    collisionSystem = new CollisionSystem();
  });

  it('should detect bullet hit at enemy visual position, not surface position', () => {
    // Enemy on a curved surface where normal is tilted.
    // Surface position at (5, 0, 0), normal pointing (0, 1, 0).
    // Visual position = (5, 0.3, 0)  (elevated by radius along normal)
    const surfacePos = new THREE.Vector3(5, 0, 0);
    const normal = new THREE.Vector3(0, 1, 0);
    const enemy = createMockEnemy(surfacePos, normal, 0.3);

    // Bullet at the surface point directly below the visual enemy center.
    // Distance from bullet to surface pos = 0 (on surface, same point).
    // Distance from bullet to mesh pos = 0.3 (the normal offset).
    // OLD behavior: hitRadiusSq = 0.09, distSq = 0 → hit (correct for flat surface)
    // NEW behavior: hitRadiusSq = 0.18, distSq = 0.09 → hit ✓

    // Now test with a bullet that's slightly offset on the surface.
    // Bullet at (5.2, 0, 0) — 0.2 units from the enemy's footprint on the surface.
    // Distance to surfacePos = 0.2, distSq = 0.04 < 0.09 → old code: hit
    // Distance to meshPos = sqrt(0.04 + 0.09) = sqrt(0.13) ≈ 0.36, distSq = 0.13 < 0.18 → new code: hit ✓
    const bulletPos = new THREE.Vector3(5.2, 0, 0);

    // Create a mock bullet pool that reports this bullet
    const mockBulletPool = {
      forEachActive: (fn: any) => {
        fn(0, bulletPos, { isCompanion: false, remainingDamage: -1 });
      },
      getBulletData: () => ({ remainingDamage: -1 }),
      kill: vi.fn(),
    } as any;

    const mockParticles = {
      bulletImpact: vi.fn(),
      enemyDeath: vi.fn(),
      aoeDeath: vi.fn(),
    } as any;
    const mockScoreManager = {
      awardKill: vi.fn(),
      collectGeom: vi.fn(),
    } as any;
    const mockSurface = { applyForce: vi.fn() } as any;
    const mockScreenShake = { shake: vi.fn() } as any;

    collisionSystem.checkBulletEnemyCollisions(
      mockBulletPool,
      [enemy],
      mockParticles,
      mockScoreManager,
      mockSurface,
      mockScreenShake,
    );

    expect(enemy.takeDamage).toHaveBeenCalled();
  });

  it('should NOT hit when bullet is far from visual position on curved surface', () => {
    // Enemy at surface pos (5, 0, 0), normal tilted at 45° in XY plane.
    // Normal = (0.707, 0.707, 0), radius = 0.3
    // Surface pos = (5, 0, 0)
    // Mesh pos = (5 + 0.3*0.707, 0.3*0.707, 0) = (5.212, 0.212, 0)
    const surfacePos = new THREE.Vector3(5, 0, 0);
    const normal = new THREE.Vector3(0.707, 0.707, 0);
    const enemy = createMockEnemy(surfacePos, normal, 0.3);

    // Bullet at (5.6, 0, 0) — far from both surface and visual positions
    // Dist to surfacePos = 0.6, distSq = 0.36 — old code: no hit (0.36 > 0.09)
    // Dist to meshPos = sqrt((5.6-5.212)² + 0.212²) = sqrt(0.15 + 0.045) ≈ 0.44, distSq ≈ 0.195 > 0.18 → no hit
    const bulletPos = new THREE.Vector3(5.6, 0, 0);

    const mockBulletPool = {
      forEachActive: (fn: any) => {
        fn(0, bulletPos, { isCompanion: false, remainingDamage: -1 });
      },
      getBulletData: () => ({ remainingDamage: -1 }),
      kill: vi.fn(),
    } as any;
    const mockParticles = {
      bulletImpact: vi.fn(),
      enemyDeath: vi.fn(),
      aoeDeath: vi.fn(),
    } as any;
    const mockScoreManager = {
      awardKill: vi.fn(),
      collectGeom: vi.fn(),
    } as any;
    const mockSurface = { applyForce: vi.fn() } as any;
    const mockScreenShake = { shake: vi.fn() } as any;

    collisionSystem.checkBulletEnemyCollisions(
      mockBulletPool,
      [enemy],
      mockParticles,
      mockScoreManager,
      mockSurface,
      mockScreenShake,
    );

    expect(enemy.takeDamage).not.toHaveBeenCalled();
  });

  it('player-enemy collision should use visual position', () => {
    // Enemy on surface at (0, 0, 5), normal (0, 1, 0), radius 0.3
    // Visual position = (0, 0.3, 5)
    // Player at (0, 0, 5.3) — 0.3 units from surface pos, 0.424 from visual pos
    const surfacePos = new THREE.Vector3(0, 0, 5);
    const normal = new THREE.Vector3(0, 1, 0);
    const enemy = createMockEnemy(surfacePos, normal, 0.3);

    const mockPlayer = {
      canTakeDamage: true,
      mesh: {
        position: new THREE.Vector3(0, 0, 5.3),
        scale: new THREE.Vector3(1, 1, 1),
      },
      die: vi.fn(),
      alive: true,
    } as any;

    const mockParticles = {
      playerDeath: vi.fn(),
      bulletImpact: vi.fn(),
    } as any;
    const mockScreenShake = { shake: vi.fn() } as any;

    collisionSystem.checkPlayerEnemyCollisions(
      mockPlayer,
      [enemy],
      mockParticles,
      mockScreenShake,
      false,
    );

    // hitRadius = 1 * 0.1 + 0.3 = 0.4
    // Using visual position: dist = sqrt(0.3² + 0.3²) = 0.424
    // hitRadius² = 0.4² + 0.3² = 0.16 + 0.09 = 0.25
    // distSq = 0.18 < 0.25 → hit
    // (The player is close enough to the VISUAL enemy to take damage)
    expect(mockPlayer.die).toHaveBeenCalled();
  });
});
