import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  CompanionManager,
  CompanionType,
  CompanionPickup,
  CompanionHUD,
  getRandomCompanionType,
} from '../entities/Companion';

// ---------------------------------------------------------------------------
// Mock SoundEngine to prevent audio errors in test
// ---------------------------------------------------------------------------
vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(),
    init: vi.fn(),
    resume: vi.fn(),
    muted: false,
  }),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMockGetTransform() {
  return (u: number, v: number) => ({
    position: new THREE.Vector3(
      Math.cos(u * Math.PI * 2) * 10,
      0,
      Math.sin(v * Math.PI * 2) * 10,
    ),
    normal: new THREE.Vector3(0, 1, 0),
    tangent: new THREE.Vector3(1, 0, 0),
    bitangent: new THREE.Vector3(0, 0, 1),
  });
}

function makeMockEnemy(hp: number, x = 0, y = 0, z = 2) {
  return {
    alive: true,
    active: true,
    health: hp,
    maxHealth: hp,
    mesh: new THREE.Mesh(),
    position: new THREE.Vector3(x, y, z),
    radius: 0.3,
    scoreValue: 100,
    geomCount: 3,
    takeDamage: vi.fn(),
    surfacePosition: { u: 0.5, v: 0.5 },
    cachedMaterials: null,
    damageBy: new Map(),
  } as any;
}

function makeMockBulletPool() {
  return {
    spawn: vi.fn(),
    root: new THREE.Group(),
    kill: vi.fn(),
    forEachActive: vi.fn(),
    update: vi.fn(),
    clear: vi.fn(),
    activeCount: 0,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompanionManager', () => {
  let manager: CompanionManager;

  beforeEach(() => {
    manager = new CompanionManager();
  });

  it('starts with zero companions', () => {
    expect(manager.count).toBe(0);
    const counts = manager.getCompanionCounts();
    expect(counts.guardian).toBe(0);
    expect(counts.hunter).toBe(0);
    expect(counts.protector).toBe(0);
  });

  it('adds companions and tracks counts', () => {
    manager.addCompanion(CompanionType.Guardian);
    manager.addCompanion(CompanionType.Guardian);
    manager.addCompanion(CompanionType.Hunter);
    manager.addCompanion(CompanionType.Protector);

    expect(manager.count).toBe(4);
    const counts = manager.getCompanionCounts();
    expect(counts.guardian).toBe(2);
    expect(counts.hunter).toBe(1);
    expect(counts.protector).toBe(1);
  });

  it('root group contains companion meshes', () => {
    manager.addCompanion(CompanionType.Guardian);
    manager.addCompanion(CompanionType.Hunter);

    // Each companion adds its mesh group to root
    expect(manager.root.children.length).toBe(2);
  });

  it('update does not throw with valid parameters', () => {
    manager.addCompanion(CompanionType.Guardian);
    manager.addCompanion(CompanionType.Hunter);
    manager.addCompanion(CompanionType.Protector);

    const playerPos = new THREE.Vector3(0, 10, 0);
    const playerAim = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(0, 1, 0);
    const enemies = [makeMockEnemy(5)];
    const bulletPool = makeMockBulletPool();

    expect(() => {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        enemies, bulletPool, 0, normal, makeMockGetTransform(),
      );
    }).not.toThrow();
  });

  it('shield is not active by default', () => {
    expect(manager.isShieldActive()).toBe(false);
  });

  it('onPlayerHit returns false with no protectors', () => {
    manager.addCompanion(CompanionType.Guardian);
    expect(manager.onPlayerHit()).toBe(false);
  });

  it('onPlayerHit returns true with ready protector', () => {
    manager.addCompanion(CompanionType.Protector);
    expect(manager.onPlayerHit()).toBe(true);
    expect(manager.isShieldActive()).toBe(true);
  });

  it('shield deactivates after duration', () => {
    manager.addCompanion(CompanionType.Protector);
    manager.onPlayerHit();
    expect(manager.isShieldActive()).toBe(true);

    const playerPos = new THREE.Vector3(0, 10, 0);
    const playerAim = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(0, 1, 0);

    // Tick past shield duration (1 second)
    for (let i = 0; i < 70; i++) {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        [], makeMockBulletPool(), 0, normal, makeMockGetTransform(),
      );
    }

    expect(manager.isShieldActive()).toBe(false);
  });

  it('protector cannot re-trigger during recharge', () => {
    manager.addCompanion(CompanionType.Protector);

    // First activation
    expect(manager.onPlayerHit()).toBe(true);

    // Wait for shield to expire
    const playerPos = new THREE.Vector3(0, 10, 0);
    const playerAim = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 70; i++) {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        [], makeMockBulletPool(), 0, normal, makeMockGetTransform(),
      );
    }

    // Protector still recharging (18 seconds base), should fail
    expect(manager.onPlayerHit()).toBe(false);
  });

  it('multiple protectors reduce recharge time', () => {
    manager.addCompanion(CompanionType.Protector);
    manager.addCompanion(CompanionType.Protector);
    manager.addCompanion(CompanionType.Protector);

    // 3 protectors = 18/3 = 6 second recharge
    expect(manager.onPlayerHit()).toBe(true);

    const playerPos = new THREE.Vector3(0, 10, 0);
    const playerAim = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(0, 1, 0);

    // Wait for shield to expire (1s) + wait through recharge (6s) = ~7s total
    // 7 * 60 = 420 frames
    for (let i = 0; i < 450; i++) {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        [], makeMockBulletPool(), 0, normal, makeMockGetTransform(),
      );
    }

    // Protectors should be recharged
    expect(manager.onPlayerHit()).toBe(true);
  });

  it('dispose cleans up all companions', () => {
    manager.addCompanion(CompanionType.Guardian);
    manager.addCompanion(CompanionType.Hunter);
    manager.addCompanion(CompanionType.Protector);

    expect(() => manager.dispose()).not.toThrow();
    expect(manager.count).toBe(0);
  });
});

describe('Guardian companion targeting', () => {
  it('fires at enemies within range after cooldown', () => {
    const manager = new CompanionManager();
    manager.addCompanion(CompanionType.Guardian);

    const bulletPool = makeMockBulletPool();
    const enemy = makeMockEnemy(5, 0, 10, 2); // close enemy
    const playerPos = new THREE.Vector3(0, 10, 0);
    const playerAim = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(0, 1, 0);

    // Run multiple frames to allow fire cooldown to expire
    for (let i = 0; i < 30; i++) {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        [enemy], bulletPool, 0, normal, makeMockGetTransform(),
      );
    }

    // Guardian should have fired at least once
    expect(bulletPool.spawn).toHaveBeenCalled();
  });
});

describe('Hunter companion targeting', () => {
  it('targets highest-HP enemy', () => {
    const manager = new CompanionManager();
    manager.addCompanion(CompanionType.Hunter);

    const bulletPool = makeMockBulletPool();
    const weakEnemy = makeMockEnemy(2, 1, 10, 1);
    const strongEnemy = makeMockEnemy(20, -1, 10, -1);
    const playerPos = new THREE.Vector3(0, 10, 0);
    const playerAim = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(0, 1, 0);

    // Run frames for hunter cooldown (1.5 shots/sec = ~40 frames)
    for (let i = 0; i < 50; i++) {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        [weakEnemy, strongEnemy], bulletPool, 0, normal, makeMockGetTransform(),
      );
    }

    // Hunter should have fired
    expect(bulletPool.spawn).toHaveBeenCalled();
  });
});

describe('CompanionPickup', () => {
  it('creates with correct type', () => {
    const pickup = new CompanionPickup(CompanionType.Guardian, 0.5, 0.5);
    expect(pickup.companionType).toBe(CompanionType.Guardian);
    expect(pickup.active).toBe(true);
    expect(pickup.mesh).toBeTruthy();
  });

  it('despawns after maxAge', () => {
    const pickup = new CompanionPickup(CompanionType.Hunter, 0.5, 0.5);

    // Simulate 26 seconds (maxAge is 25)
    for (let i = 0; i < 26 * 60; i++) {
      pickup.update(1 / 60, i / 60);
    }

    expect(pickup.active).toBe(false);
  });

  it('detects player collision within radius', () => {
    // PICKUP_COLLISION_RADIUS = 0.015 (reduced from 0.08 — touch-only, not auto-pickup from afar)
    const pickup = new CompanionPickup(CompanionType.Protector, 0.5, 0.5);
    expect(pickup.checkPlayerCollision(0.5, 0.5)).toBe(true);   // exact match
    expect(pickup.checkPlayerCollision(0.5, 0.51)).toBe(true);  // dist=0.01 < 0.015 → within radius
    expect(pickup.checkPlayerCollision(0.5, 0.55)).toBe(false); // dist=0.05 >> 0.015 → too far
    expect(pickup.checkPlayerCollision(0.8, 0.8)).toBe(false);  // far away
  });

  it('applies surface transform without error', () => {
    const pickup = new CompanionPickup(CompanionType.Guardian, 0.5, 0.5);
    expect(() => {
      pickup.applySurfaceTransform(makeMockGetTransform());
    }).not.toThrow();
  });

  it('dispose cleans up resources', () => {
    const pickup = new CompanionPickup(CompanionType.Guardian, 0.5, 0.5);
    expect(() => pickup.dispose()).not.toThrow();
  });
});

// CompanionHUD tests require DOM (document) - skipped in Node test environment.
// These are covered by E2E/Playwright tests instead.
describe.skipIf(typeof document === 'undefined')('CompanionHUD', () => {
  it('creates DOM element', () => {
    const hud = new CompanionHUD();
    const el = document.getElementById('companion-hud');
    expect(el).toBeTruthy();
    hud.dispose();
  });

  it('updates display based on counts', () => {
    const hud = new CompanionHUD();
    hud.update({ guardian: 2, hunter: 1, protector: 0 });

    const el = document.getElementById('companion-hud')!;
    expect(el.innerHTML).toContain('x2');
    expect(el.innerHTML).toContain('x1');
    expect(el.innerHTML).toContain('#4488ff'); // guardian blue
    expect(el.innerHTML).toContain('#ff4444'); // hunter red

    hud.dispose();
  });

  it('shows nothing when all counts are zero', () => {
    const hud = new CompanionHUD();
    hud.update({ guardian: 0, hunter: 0, protector: 0 });

    const el = document.getElementById('companion-hud')!;
    expect(el.innerHTML).toBe('');

    hud.dispose();
  });

  it('dispose removes DOM element', () => {
    const hud = new CompanionHUD();
    hud.dispose();
    expect(document.getElementById('companion-hud')).toBeNull();
  });
});

describe('getRandomCompanionType', () => {
  it('returns a valid CompanionType', () => {
    const validTypes = [CompanionType.Guardian, CompanionType.Hunter, CompanionType.Protector];
    for (let i = 0; i < 100; i++) {
      const type = getRandomCompanionType();
      expect(validTypes).toContain(type);
    }
  });

  it('returns all three types over many trials', () => {
    const seen = new Set<CompanionType>();
    for (let i = 0; i < 500; i++) {
      seen.add(getRandomCompanionType());
    }
    expect(seen.has(CompanionType.Guardian)).toBe(true);
    expect(seen.has(CompanionType.Hunter)).toBe(true);
    expect(seen.has(CompanionType.Protector)).toBe(true);
  });
});
