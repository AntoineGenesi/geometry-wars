/**
 * s44r2-13 Regression: Bullet Damage Persistence — Bullet should survive hits when damage budget remains.
 *
 * Symptom: Bullets were killed immediately on any hit, even when bullet damage
 * was far greater than enemy health. A Piercing bullet (damage=3) should pass
 * through three 1-HP enemies, not die on the first one.
 *
 * Fix: BulletData now tracks `remainingDamage`. On each hit, consumed =
 * min(remainingDamage, enemy.health). Bullet is only killed when remainingDamage <= 0.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';

// CollisionSystem references window for a debug flag — shim it for Node test env
beforeAll(() => {
  if (typeof globalThis.window === 'undefined') {
    (globalThis as any).window = { __debugFreeze: false };
  }
});

// CollisionSystem calls getSoundEngine().play() on enemy death — stub it
vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({ play: vi.fn() }),
}));

import { BulletPool } from '../entities/Bullet';
import { CollisionSystem } from '../core/CollisionSystem';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';

// ---------------------------------------------------------------------------
// Minimal enemy mock — satisfies all duck-typed checks in CollisionSystem
// ---------------------------------------------------------------------------
class MockEnemy {
  alive = true;
  active = true;
  isMaterializing = false;
  isInstanced = false;
  isGhostForPlayer = false;
  health: number;
  maxHealth: number;
  scoreValue = 10;
  geomCount = 0;
  radius = 0.5;
  position: THREE.Vector3;
  surfacePosition = { u: 0, v: 0 };
  damageBy = new Map<number, number>();
  cachedMaterials: null = null;
  mesh: null = null;

  constructor(health: number, x = 0, y = 0, z = 0) {
    this.health = health;
    this.maxHealth = health;
    this.position = new THREE.Vector3(x, y, z);
  }

  takeDamage(amount: number) {
    this.health -= amount;
    if (this.health <= 0) this.alive = false;
  }
}

function makeMockEnemy(health: number, x = 0, y = 0, z = 0): BaseEnemy {
  return new MockEnemy(health, x, y, z) as unknown as BaseEnemy;
}

// ---------------------------------------------------------------------------
// Minimal stubs for dependencies not under test
// ---------------------------------------------------------------------------
const particles = {
  bulletImpact: vi.fn(),
  enemyDeath: vi.fn(),
  aoeDeath: vi.fn(),
} as any;

const scoreManager = {
  awardKill: vi.fn(),
  getScorePowerMultiplier: () => 1,
} as any;

const surface = {
  applyForce: vi.fn(),
} as any;

const screenShake = {
  shake: vi.fn(),
} as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function spawnBulletAtOrigin(pool: BulletPool): number {
  // Find next slot before spawn
  const slotBefore = pool.findInactiveSlot();
  pool.spawn(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
    0,
    0,
    0,
    0,   // ownerId
    false,
  );
  return slotBefore;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('s44r2-13 — Bullet damage persistence', () => {
  it('REGRESSION: bullet with high damage survives killing a low-HP enemy', () => {
    const bulletPool = new BulletPool();
    const collision = new CollisionSystem();

    const idx = spawnBulletAtOrigin(bulletPool);
    expect(idx).toBeGreaterThanOrEqual(0);

    // Single 1-HP enemy at bullet origin (within hit radius 0.5)
    const enemy = makeMockEnemy(1, 0, 0, 0);

    // bulletDamage = 3 (Piercing-tier), enemy has 1 HP
    // Expected: enemy dies, bullet SURVIVES with 2 remaining damage
    collision.checkBulletEnemyCollisions(
      bulletPool,
      [enemy],
      particles,
      scoreManager,
      surface,
      screenShake,
      undefined, // onEnemyKilled
      undefined, // scorePopups
      3,         // bulletDamage
    );

    expect(enemy.alive).toBe(false); // enemy is dead
    // REGRESSION: this was failing before — bullet was always killed on first hit
    expect(bulletPool.getBulletData(idx).alive).toBe(true); // bullet SURVIVES
    expect(bulletPool.getBulletData(idx).remainingDamage).toBeCloseTo(2, 5); // 3 - 1 = 2 remaining
  });

  it('bullet with exactly enough damage dies after killing the enemy', () => {
    const bulletPool = new BulletPool();
    const collision = new CollisionSystem();

    const idx = spawnBulletAtOrigin(bulletPool);
    const enemy = makeMockEnemy(1, 0, 0, 0);

    // bulletDamage = 1, enemy has 1 HP — budget exactly consumed
    collision.checkBulletEnemyCollisions(
      bulletPool,
      [enemy],
      particles,
      scoreManager,
      surface,
      screenShake,
      undefined,
      undefined,
      1,
    );

    expect(enemy.alive).toBe(false); // enemy dead
    expect(bulletPool.getBulletData(idx).alive).toBe(false); // bullet also dead (budget = 0)
  });

  it('low-damage bullet (blaster) dies after partial damage hit', () => {
    const bulletPool = new BulletPool();
    const collision = new CollisionSystem();

    const idx = spawnBulletAtOrigin(bulletPool);
    const enemy = makeMockEnemy(1, 0, 0, 0); // 1 HP enemy

    // blaster: damage = 0.25 (not enough to kill)
    collision.checkBulletEnemyCollisions(
      bulletPool,
      [enemy],
      particles,
      scoreManager,
      surface,
      screenShake,
      undefined,
      undefined,
      0.25,
    );

    // Enemy should survive (only took 0.25 of 1 HP)
    expect(enemy.alive).toBe(true);
    expect(enemy.health).toBeCloseTo(0.75, 5);
    // Bullet should die (budget = 0.25, consumed = 0.25, remaining = 0)
    expect(bulletPool.getBulletData(idx).alive).toBe(false);
  });

  it('high-damage bullet can pierce through 3 enemies consecutively', () => {
    const bulletPool = new BulletPool();
    const collision = new CollisionSystem();

    const idx = spawnBulletAtOrigin(bulletPool);

    // Three 1-HP enemies all at bullet origin (clustered)
    const enemies = [
      makeMockEnemy(1, 0, 0, 0),
      makeMockEnemy(1, 0.01, 0, 0), // slightly offset but within radius 0.5
      makeMockEnemy(1, 0.02, 0, 0),
    ];

    // bulletDamage = 3 → should kill all 3 and then die (3 - 1 - 1 - 1 = 0)
    collision.checkBulletEnemyCollisions(
      bulletPool,
      enemies,
      particles,
      scoreManager,
      surface,
      screenShake,
      undefined,
      undefined,
      3,
    );

    const allDead = enemies.every(e => !e.alive);
    expect(allDead).toBe(true); // all enemies dead
    expect(bulletPool.getBulletData(idx).alive).toBe(false); // bullet spent
  });

  it('bullet with remainingDamage field initialized to -1 on spawn', () => {
    const bulletPool = new BulletPool();
    const idx = spawnBulletAtOrigin(bulletPool);
    // Before any collision, remainingDamage should be -1 (uninitialized)
    expect(bulletPool.getBulletData(idx).remainingDamage).toBe(-1);
  });
});
