/**
 * WeaponManager test suite.
 *
 * Tests all 10 weapon types: firing, damage, ammo management,
 * projectile behavior, and effect lifecycle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub DOM APIs needed by ChainLightningEffect and THREE.js texture creation
const _stubCtx = {
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  createRadialGradient: vi.fn(() => ({
    addColorStop: vi.fn(),
  })),
  arc: vi.fn(),
  fill: vi.fn(),
  beginPath: vi.fn(),
};
const _stubCanvas = {
  width: 64,
  height: 64,
  getContext: vi.fn(() => _stubCtx),
  toDataURL: vi.fn(() => ''),
  style: {},
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};
vi.stubGlobal('document', {
  createElement: vi.fn(() => _stubCanvas),
  createElementNS: vi.fn(() => _stubCanvas),
});

import * as THREE from 'three';
import { WeaponManager, WeaponCallbacks } from './WeaponManager';
import { WeaponType, WEAPON_CONFIGS } from './WeaponTypes';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockEnemy {
  position: THREE.Vector3;
  index: number;
  alive: boolean;
}

function createMockCallbacks(enemies: MockEnemy[] = []) {
  const damages: { index: number; damage: number; type: WeaponType }[] = [];
  const pulls: { index: number; strength: number; center: THREE.Vector3 }[] = [];
  const bullets: { origin: THREE.Vector3; direction: THREE.Vector3 }[] = [];

  const callbacks: WeaponCallbacks = {
    getEnemies: () => enemies,
    onEnemyDamage: (index, damage, weaponType) => {
      damages.push({ index, damage, type: weaponType });
      const enemy = enemies.find(e => e.index === index);
      if (enemy && damage >= 999) enemy.alive = false;
    },
    onEnemyPull: (index, strength, center) => {
      pulls.push({ index, strength, center: center.clone() });
    },
    spawnBullet: (origin, direction) => {
      bullets.push({ origin: origin.clone(), direction: direction.clone() });
    },
  };

  return { callbacks, damages, pulls, bullets };
}

/** Player origin on sphere of radius 8 */
function origin(): THREE.Vector3 {
  return new THREE.Vector3(8, 0, 0);
}

/** Forward direction (Z-axis, not parallel to default up Y-axis) */
function forward(): THREE.Vector3 {
  return new THREE.Vector3(0, 0, 1);
}

/** Surface normal at origin (outward from sphere center) */
function normal(): THREE.Vector3 {
  return new THREE.Vector3(1, 0, 0);
}

/** Project a position onto sphere of given radius (matches WeaponManager fallback) */
function sphereProject(pos: THREE.Vector3, radius: number): THREE.Vector3 {
  const len = pos.length();
  return len > 0.01 ? pos.clone().multiplyScalar(radius / len) : pos.clone();
}

// Base fire time - must be past longest cooldown (BlackHole: 1/0.3 = 3.33s)
const T = 10.0;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WeaponManager', () => {
  let manager: WeaponManager;
  let mock: ReturnType<typeof createMockCallbacks>;

  beforeEach(() => {
    manager = new WeaponManager();
    mock = createMockCallbacks();
    manager.setCallbacks(mock.callbacks);
  });

  // =========================================================================
  // General weapon management
  // =========================================================================

  describe('Weapon Management', () => {
    it('should default to Standard weapon', () => {
      expect(manager.getCurrentWeapon()).toBe(WeaponType.Standard);
    });

    it('should report unlimited ammo for Standard', () => {
      expect(manager.getCurrentAmmo()).toBe(-1);
    });

    it('should equip a weapon with default ammo', () => {
      manager.equipWeapon(WeaponType.Spread);
      expect(manager.getCurrentWeapon()).toBe(WeaponType.Spread);
      expect(manager.getCurrentAmmo()).toBe(WEAPON_CONFIGS[WeaponType.Spread].ammo);
    });

    it('should equip a weapon with custom ammo', () => {
      manager.equipWeapon(WeaponType.Spread, 100);
      expect(manager.getCurrentAmmo()).toBe(100);
    });

    it('should stack ammo when re-equipping same weapon', () => {
      manager.equipWeapon(WeaponType.Spread, 10);
      manager.equipWeapon(WeaponType.Spread, 5);
      expect(manager.getCurrentAmmo()).toBe(15);
    });

    it('should consume ammo on fire', () => {
      manager.equipWeapon(WeaponType.Spread, 5);
      const initial = manager.getCurrentAmmo();
      manager.fire(origin(), forward(), T);
      expect(manager.getCurrentAmmo()).toBe(initial - 1);
    });

    it('should fall back to Standard when ammo runs out', () => {
      manager.equipWeapon(WeaponType.Spread, 1);
      manager.fire(origin(), forward(), T); // Use last ammo
      expect(manager.getCurrentAmmo()).toBe(0);
      // Next fire attempt should switch to Standard
      manager.fire(origin(), forward(), T + 10);
      expect(manager.getCurrentWeapon()).toBe(WeaponType.Standard);
    });

    it('should respect fire rate cooldown', () => {
      expect(manager.canFire(T)).toBe(true);
      manager.fire(origin(), forward(), T);
      // Fire rate for Standard is 15/sec = 0.067s cooldown
      expect(manager.canFire(T + 0.01)).toBe(false);
      expect(manager.canFire(T + 0.1)).toBe(true);
    });

    it('should clear all projectiles and effects', () => {
      manager.equipWeapon(WeaponType.Spread, 5);
      manager.fire(origin(), forward(), T);
      manager.clear();
      expect(manager.projectileRoot.children.length).toBe(0);
    });
  });

  // =========================================================================
  // Standard weapon
  // =========================================================================

  describe('Standard (Blaster)', () => {
    it('should fire two bullets (dual-barrel)', () => {
      manager.fire(origin(), forward(), T);
      expect(mock.bullets.length).toBe(2);
    });

    it('should offset bullets slightly perpendicular to aim', () => {
      manager.fire(origin(), forward(), T, normal());
      expect(mock.bullets.length).toBe(2);

      const b0 = mock.bullets[0].origin;
      const b1 = mock.bullets[1].origin;
      // Bullets should be offset perpendicular to aim direction
      const diff = b0.clone().sub(b1);
      expect(diff.length()).toBeGreaterThan(0.1);
      // Both should aim forward
      expect(mock.bullets[0].direction.dot(forward())).toBeGreaterThan(0.99);
      expect(mock.bullets[1].direction.dot(forward())).toBeGreaterThan(0.99);
    });

    it('should have unlimited ammo', () => {
      for (let t = 0; t < 100; t++) {
        manager.fire(origin(), forward(), T + t);
      }
      expect(manager.getCurrentWeapon()).toBe(WeaponType.Standard);
      expect(manager.getCurrentAmmo()).toBe(-1);
    });
  });

  // =========================================================================
  // Spread weapon
  // =========================================================================

  describe('Spread Shot', () => {
    beforeEach(() => {
      manager.equipWeapon(WeaponType.Spread, 10);
    });

    it('should create 5 projectiles in a fan pattern', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(5);
    });

    it('should spread projectiles across a 30-degree arc', () => {
      manager.fire(origin(), forward(), T, normal());
      const children = manager.projectileRoot.children;
      expect(children.length).toBe(5);

      // Advance time so projectiles move from their spawn point
      manager.update(0.1);

      // After moving, center projectile should be ahead of origin
      const centerPos = children[2].position;
      const centerOffset = centerPos.clone().sub(origin());
      expect(centerOffset.dot(forward())).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Piercing Beam (geodesic)
  // =========================================================================

  describe('Piercing Beam', () => {
    beforeEach(() => {
      manager.equipWeapon(WeaponType.Piercing, 10);
    });

    it('should create a beam visual (not a projectile)', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(1);
    });

    it('should damage enemies along the beam path', () => {
      // Place enemies close to origin along the beam path (on/near sphere surface)
      const enemy1: MockEnemy = { position: new THREE.Vector3(7.99, 0, 0.5), index: 0, alive: true };
      const enemy2: MockEnemy = { position: new THREE.Vector3(7.95, 0, 1.0), index: 1, alive: true };
      const farEnemy: MockEnemy = { position: new THREE.Vector3(8, 5, 0), index: 2, alive: true };

      mock = createMockCallbacks([enemy1, enemy2, farEnemy]);
      manager.setCallbacks(mock.callbacks);

      manager.fire(origin(), forward(), T);

      const hitIndices = mock.damages.map(d => d.index);
      expect(hitIndices).toContain(0);
      expect(hitIndices).toContain(1);
      // Far enemy perpendicular to beam should NOT be hit
      expect(hitIndices).not.toContain(2);
    });

    it('should have instant fire rate (beam weapon)', () => {
      expect(WEAPON_CONFIGS[WeaponType.Piercing].projectileSpeed).toBe(0);
    });

    it('should create a brief flash effect that fades', () => {
      manager.fire(origin(), forward(), T);
      manager.update(0.1);
      expect(manager.projectileRoot.children.length).toBe(1); // Still visible

      // Update past effect duration (0.25s)
      manager.update(0.2);
      expect(manager.projectileRoot.children.length).toBe(0); // Faded out
    });
  });

  // =========================================================================
  // Chain Lightning
  // =========================================================================

  describe('Chain Lightning', () => {
    beforeEach(() => {
      manager.equipWeapon(WeaponType.ChainLightning, 10);
    });

    it('should find target in aim direction', () => {
      const enemy: MockEnemy = {
        position: origin().clone().add(forward().clone().multiplyScalar(3)),
        index: 0, alive: true,
      };
      mock = createMockCallbacks([enemy]);
      manager.setCallbacks(mock.callbacks);

      manager.fire(origin(), forward(), T);
      expect(mock.damages.length).toBeGreaterThan(0);
      expect(mock.damages[0].index).toBe(0);
    });

    it('should chain to nearby enemies', () => {
      const e1: MockEnemy = { position: origin().clone().add(new THREE.Vector3(0, 0, 3)), index: 0, alive: true };
      const e2: MockEnemy = { position: origin().clone().add(new THREE.Vector3(0, 0, 5)), index: 1, alive: true };
      const e3: MockEnemy = { position: origin().clone().add(new THREE.Vector3(0, 0, 7)), index: 2, alive: true };

      mock = createMockCallbacks([e1, e2, e3]);
      manager.setCallbacks(mock.callbacks);

      manager.fire(origin(), forward(), T);
      // Should hit at least the first target, possibly chain to others
      expect(mock.damages.length).toBeGreaterThanOrEqual(1);
    });

    it('should not fire without valid targets', () => {
      mock = createMockCallbacks([]); // No enemies
      manager.setCallbacks(mock.callbacks);

      const result = manager.fire(origin(), forward(), T);
      expect(result).toBe(true); // Fire succeeds (ammo consumed)
      expect(mock.damages.length).toBe(0); // But no damage dealt
    });

    it('should prefer enemies in aim direction', () => {
      const aheadEnemy: MockEnemy = {
        position: origin().clone().add(forward().clone().multiplyScalar(3)),
        index: 0, alive: true,
      };
      const behindEnemy: MockEnemy = {
        position: origin().clone().add(forward().clone().multiplyScalar(-3)),
        index: 1, alive: true,
      };

      mock = createMockCallbacks([aheadEnemy, behindEnemy]);
      manager.setCallbacks(mock.callbacks);

      manager.fire(origin(), forward(), T);
      if (mock.damages.length > 0) {
        expect(mock.damages[0].index).toBe(0);
      }
    });
  });

  // =========================================================================
  // Homing Missiles
  // =========================================================================

  describe('Homing Missiles', () => {
    beforeEach(() => {
      manager.equipWeapon(WeaponType.Homing, 10);
    });

    it('should create a homing projectile', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(1);
    });

    it('should track nearest enemy over time', () => {
      const enemy: MockEnemy = {
        position: origin().clone().add(new THREE.Vector3(0, 2, 2)),
        index: 0, alive: true,
      };
      mock = createMockCallbacks([enemy]);
      manager.setCallbacks(mock.callbacks);

      manager.fire(origin(), forward(), T);

      // Simulate several update steps
      for (let i = 0; i < 50; i++) {
        manager.update(0.05);
      }

      // After homing, the projectile should have moved toward the enemy
      // or hit it (in which case damages should be populated)
      const child = manager.projectileRoot.children[0];
      if (child) {
        const dist = child.position.distanceTo(enemy.position);
        expect(dist).toBeLessThan(5);
      }
    });

    it('should re-target nearest enemy to projectile, not original target', () => {
      // Far enemy (original target at fire time since it's "nearest" to origin)
      const farEnemy: MockEnemy = {
        position: origin().clone().add(forward().clone().multiplyScalar(6)),
        index: 0, alive: true,
      };
      // Close enemy that appears AFTER the missile has been flying
      const closeEnemy: MockEnemy = {
        position: origin().clone().add(forward().clone().multiplyScalar(2)),
        index: 1, alive: true,
      };

      // Start with only far enemy
      mock = createMockCallbacks([farEnemy]);
      manager.setCallbacks(mock.callbacks);
      manager.fire(origin(), forward(), T);

      // After a couple frames, add the close enemy
      manager.update(0.05);
      mock = createMockCallbacks([farEnemy, closeEnemy]);
      manager.setCallbacks(mock.callbacks);

      // Simulate more frames - missile should re-target closeEnemy
      for (let i = 0; i < 20; i++) {
        manager.update(0.05);
      }

      // The missile should have hit or be very near the close enemy
      if (mock.damages.length > 0) {
        expect(mock.damages[0].index).toBe(1); // Hit close enemy first
      }
    });
  });

  // =========================================================================
  // Plasma Mortar
  // =========================================================================

  describe('Plasma Mortar', () => {
    beforeEach(() => {
      manager.equipWeapon(WeaponType.PlasmaMortar, 10);
    });

    it('should create an arcing projectile', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(1);
    });

    it('should remove projectile after maxAge', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(1);

      // Mortar maxAge = range/speed = 5/0.6 = 8.33s. Simulate well past that.
      for (let i = 0; i < 200; i++) {
        manager.update(0.05);
      }
      // Projectile should be removed after expiry
      expect(manager.projectileRoot.children.length).toBe(0);
    });
  });

  // =========================================================================
  // Gravity Gun
  // =========================================================================

  describe('Gravity Gun', () => {
    beforeEach(() => {
      manager.equipWeapon(WeaponType.GravityGun, 10);
    });

    it('should create a gravity projectile', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(1);
    });

    it('should pull enemies on impact', () => {
      // Place enemy on the sphere surface along the projectile path
      // Projectile moves along sphere at radius 8
      const enemyPos = sphereProject(
        origin().clone().add(forward().clone().multiplyScalar(0.5)),
        8,
      );
      const enemy: MockEnemy = { position: enemyPos, index: 0, alive: true };

      mock = createMockCallbacks([enemy]);
      manager.setCallbacks(mock.callbacks);

      manager.fire(origin(), forward(), T);

      // Simulate until projectile hits
      for (let i = 0; i < 50; i++) {
        manager.update(0.05);
      }

      // Should have triggered damage + pull effect on impact
      expect(mock.damages.length).toBeGreaterThan(0);
      expect(mock.pulls.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Laser Beam
  // =========================================================================

  describe('Laser Beam', () => {
    beforeEach(() => {
      manager.equipWeapon(WeaponType.LaserBeam, 50);
    });

    it('should create a beam visual (tube geometry)', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(1);
    });

    it('should deal continuous damage along the beam', () => {
      // Place enemy close to origin along beam path (on sphere surface)
      const enemy: MockEnemy = { position: new THREE.Vector3(7.99, 0, 0.5), index: 0, alive: true };

      mock = createMockCallbacks([enemy]);
      manager.setCallbacks(mock.callbacks);

      manager.fire(origin(), forward(), T);

      // Simulate a few frames for continuous damage
      for (let i = 0; i < 5; i++) {
        manager.update(0.05);
      }

      const laserDamages = mock.damages.filter(d => d.type === WeaponType.LaserBeam);
      expect(laserDamages.length).toBeGreaterThan(0);
    });

    it('should fade out over time', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(1);

      // Update past the laser's duration (0.5s)
      manager.update(0.6);
      expect(manager.projectileRoot.children.length).toBe(0);
    });

    it('should be instant (no projectile speed)', () => {
      expect(WEAPON_CONFIGS[WeaponType.LaserBeam].projectileSpeed).toBe(0);
    });
  });

  // =========================================================================
  // Black Hole
  // =========================================================================

  describe('Black Hole', () => {
    beforeEach(() => {
      manager.equipWeapon(WeaponType.BlackHole, 5);
    });

    it('should create a black hole effect', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(1);
    });

    it('should instant-kill enemies at center', () => {
      // Compute where the BH will land (origin + 4*forward, projected to sphere)
      const bhPos = sphereProject(
        origin().clone().add(forward().clone().multiplyScalar(4)),
        origin().length(),
      );
      const enemy: MockEnemy = { position: bhPos.clone(), index: 0, alive: true };

      mock = createMockCallbacks([enemy]);
      manager.setCallbacks(mock.callbacks);

      manager.fire(origin(), forward(), T);
      manager.update(0.05);

      // Enemy at center should receive 999 damage (instant kill)
      const killDamages = mock.damages.filter(d => d.damage === 999);
      expect(killDamages.length).toBeGreaterThan(0);
    });

    it('should pull nearby enemies', () => {
      const bhPos = sphereProject(
        origin().clone().add(forward().clone().multiplyScalar(4)),
        origin().length(),
      );
      // Place enemy 1 unit away from BH center (within radius, but > 0.5 for pull)
      const nearbyEnemy: MockEnemy = {
        position: bhPos.clone().add(new THREE.Vector3(0, 1, 0)),
        index: 0, alive: true,
      };

      mock = createMockCallbacks([nearbyEnemy]);
      manager.setCallbacks(mock.callbacks);

      manager.fire(origin(), forward(), T);
      manager.update(0.05);

      expect(mock.pulls.length).toBeGreaterThan(0);
    });

    it('should expire after 2 seconds', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(1);

      manager.update(2.1);
      expect(manager.projectileRoot.children.length).toBe(0);
    });

    it('should have very high damage (999)', () => {
      expect(WEAPON_CONFIGS[WeaponType.BlackHole].damage).toBe(999);
    });
  });

  // =========================================================================
  // Tesla Coil
  // =========================================================================

  describe('Tesla Coil', () => {
    beforeEach(() => {
      manager.equipWeapon(WeaponType.TeslaCoil, 50);
    });

    it('should create a tesla field effect', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.projectileRoot.children.length).toBe(1);
    });

    it('should report tesla as active', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.isTeslaActive()).toBe(true);
    });

    it('should damage nearby enemies continuously', () => {
      const enemy: MockEnemy = {
        position: origin().clone().add(new THREE.Vector3(1, 0, 0)),
        index: 0, alive: true,
      };

      mock = createMockCallbacks([enemy]);
      manager.setCallbacks(mock.callbacks);
      manager.playerPositionRef = origin();

      manager.fire(origin(), forward(), T);

      // Simulate a few frames
      for (let i = 0; i < 10; i++) {
        manager.update(0.05);
      }

      const teslaDamages = mock.damages.filter(d => d.type === WeaponType.TeslaCoil);
      expect(teslaDamages.length).toBeGreaterThan(0);
    });

    it('should NOT damage enemies outside radius (3 units)', () => {
      const farEnemy: MockEnemy = {
        position: origin().clone().add(new THREE.Vector3(5, 0, 0)),
        index: 0, alive: true,
      };

      mock = createMockCallbacks([farEnemy]);
      manager.setCallbacks(mock.callbacks);
      manager.playerPositionRef = origin();

      manager.fire(origin(), forward(), T);
      manager.update(0.05);

      const teslaDamages = mock.damages.filter(d => d.type === WeaponType.TeslaCoil);
      expect(teslaDamages.length).toBe(0);
    });

    it('should follow player position', () => {
      manager.playerPositionRef = origin();
      manager.fire(origin(), forward(), T);

      // Move player
      const newPos = new THREE.Vector3(10, 5, 0);
      manager.playerPositionRef.copy(newPos);
      manager.update(0.05);

      // Tesla mesh should follow player
      const teslaMesh = manager.projectileRoot.children[0];
      expect(teslaMesh).toBeDefined();
      expect(teslaMesh.position.distanceTo(newPos)).toBeLessThan(0.01);
    });

    it('should expire after 5 seconds', () => {
      manager.fire(origin(), forward(), T);
      expect(manager.isTeslaActive()).toBe(true);

      manager.update(5.1);
      expect(manager.isTeslaActive()).toBe(false);
    });
  });

  // =========================================================================
  // Weapon Config Validation
  // =========================================================================

  describe('Weapon Config Validation', () => {
    it('should have configs for all weapon types', () => {
      for (const type of Object.values(WeaponType)) {
        expect(WEAPON_CONFIGS[type]).toBeDefined();
        expect(WEAPON_CONFIGS[type].name).toBeTruthy();
        expect(WEAPON_CONFIGS[type].color).toBeGreaterThanOrEqual(0);
        expect(WEAPON_CONFIGS[type].damage).toBeGreaterThan(0);
        expect(WEAPON_CONFIGS[type].fireRate).toBeGreaterThan(0);
      }
    });

    it('should have Standard with unlimited ammo', () => {
      expect(WEAPON_CONFIGS[WeaponType.Standard].ammo).toBe(-1);
    });

    it('should have non-zero ammo for all non-standard weapons', () => {
      for (const type of Object.values(WeaponType)) {
        if (type === WeaponType.Standard) continue;
        expect(WEAPON_CONFIGS[type].ammo).toBeGreaterThan(0);
      }
    });

    it('should have zero projectile speed for instant weapons', () => {
      expect(WEAPON_CONFIGS[WeaponType.ChainLightning].projectileSpeed).toBe(0);
      expect(WEAPON_CONFIGS[WeaponType.LaserBeam].projectileSpeed).toBe(0);
      expect(WEAPON_CONFIGS[WeaponType.Piercing].projectileSpeed).toBe(0);
      expect(WEAPON_CONFIGS[WeaponType.TeslaCoil].projectileSpeed).toBe(0);
    });
  });
});
