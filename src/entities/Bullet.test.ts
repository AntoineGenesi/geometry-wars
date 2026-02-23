/**
 * Regression tests for BulletPool.lifetimeMultiplier — bullet range scaling by map size.
 *
 * Verifies that bullets expire after BULLET_LIFETIME * lifetimeMultiplier seconds,
 * so larger maps (lifetimeMultiplier > 1) grant proportionally longer bullet range.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { BulletPool } from './Bullet';

// Mirror the constant from Bullet.ts (we test against its effect, not its raw value)
const BULLET_LIFETIME_SECONDS = 6;

// Helpers

function spawnBullet(pool: BulletPool): void {
  const origin = new THREE.Vector3(0, 1, 0);
  const direction = new THREE.Vector3(0, 0, 1);
  pool.spawn(origin, direction, 0.5, 0.5, 0);
}

describe('BulletPool — lifetimeMultiplier', () => {
  let pool: BulletPool;

  beforeEach(() => {
    pool = new BulletPool();
  });

  it('defaults to 1.0 (MEDIUM map baseline)', () => {
    expect(pool.lifetimeMultiplier).toBe(1.0);
  });

  it('bullet is alive just before lifetime expires (default multiplier)', () => {
    spawnBullet(pool);
    // Advance to just under the default lifetime
    pool.update(BULLET_LIFETIME_SECONDS - 0.1);
    expect(pool.activeCount).toBe(1);
  });

  it('bullet expires after BULLET_LIFETIME seconds (default multiplier)', () => {
    spawnBullet(pool);
    // Advance past default lifetime
    pool.update(BULLET_LIFETIME_SECONDS + 0.1);
    expect(pool.activeCount).toBe(0);
  });

  it('bullet survives longer with lifetimeMultiplier = 1.5 (LARGE map)', () => {
    pool.lifetimeMultiplier = 1.5;
    spawnBullet(pool);
    // At default lifetime the bullet should still be alive
    pool.update(BULLET_LIFETIME_SECONDS + 0.1);
    expect(pool.activeCount).toBe(1);
    // But expires after the scaled lifetime
    pool.update(BULLET_LIFETIME_SECONDS * 1.5 - BULLET_LIFETIME_SECONDS - 0.1 + 0.5);
    expect(pool.activeCount).toBe(0);
  });

  it('bullet survives longer with lifetimeMultiplier = 2.0 (EPIC map)', () => {
    pool.lifetimeMultiplier = 2.0;
    spawnBullet(pool);
    // Should still be alive at 1x lifetime
    pool.update(BULLET_LIFETIME_SECONDS + 0.1);
    expect(pool.activeCount).toBe(1);
    // Advance to beyond 2x lifetime — should be gone
    pool.update(BULLET_LIFETIME_SECONDS + 0.5); // total: 6.1 + 6.5 = 12.6s > 12s
    expect(pool.activeCount).toBe(0);
  });

  it('bullet expires earlier with lifetimeMultiplier = 0.75 (SMALL map)', () => {
    pool.lifetimeMultiplier = 0.75;
    spawnBullet(pool);
    // At 0.75x the effective lifetime is 4.5s — bullet should be gone before default 6s
    pool.update(BULLET_LIFETIME_SECONDS * 0.75 + 0.1); // 4.6s
    expect(pool.activeCount).toBe(0);
  });

  it('bullet survives just before SMALL map lifetime (0.75x)', () => {
    pool.lifetimeMultiplier = 0.75;
    spawnBullet(pool);
    pool.update(BULLET_LIFETIME_SECONDS * 0.75 - 0.1); // 4.4s
    expect(pool.activeCount).toBe(1);
  });
});
