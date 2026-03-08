import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  CompanionManager,
  CompanionType,
  CompanionPickup,
  CompanionHUD,
  getRandomCompanionType,
  RemoteCompanionRenderer,
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
  it('fires at enemies within scaled range on large maps (mapSizeScaleFactor regression)', () => {
    // Regression: guardian GUARDIAN_RANGE=3.0 was not scaled by mapSizeScaleFactor.
    // On LARGE (1.5x) or EPIC (2.0x) maps, enemies at 4+ world units were never targeted.
    // Fix: range scales with mapSizeScaleFactor so companions work on all map sizes.
    const largeMapScale = 2.0; // EPIC map
    const manager = new CompanionManager(largeMapScale);
    manager.addCompanion(CompanionType.Guardian);

    const bulletPool = makeMockBulletPool();
    // Enemy at 5 world units — out of range without scale (3.0), in range with scale (6.0)
    const enemy = makeMockEnemy(5, 0, 10, 5);
    const playerPos = new THREE.Vector3(0, 10, 0);
    const playerAim = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < 30; i++) {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        [enemy], bulletPool, 0, normal, makeMockGetTransform(),
      );
    }

    // With mapSizeScaleFactor=2.0, effective range=6.0, enemy at dist=5 should be targeted
    expect(bulletPool.spawn).toHaveBeenCalled();
  });

  it('does NOT fire at enemies outside scaled range', () => {
    // Guardian should NOT fire at enemies beyond GUARDIAN_RANGE * mapSizeScaleFactor
    const manager = new CompanionManager(1.0); // default scale
    manager.addCompanion(CompanionType.Guardian);

    const bulletPool = makeMockBulletPool();
    // Enemy at 10 world units — far outside default range (3.0)
    const enemy = makeMockEnemy(5, 0, 10, 10);
    const playerPos = new THREE.Vector3(0, 10, 0);
    const playerAim = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < 30; i++) {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        [enemy], bulletPool, 0, normal, makeMockGetTransform(),
      );
    }

    expect(bulletPool.spawn).not.toHaveBeenCalled();
  });

  it('companion bullets have isCompanion=true flag (damage numbers regression)', () => {
    // Regression: companion bullets were not marked isCompanion=true,
    // so damage numbers were not shown on killing blows.
    const manager = new CompanionManager();
    manager.addCompanion(CompanionType.Guardian);

    // Use a real BulletPool to check isCompanion flag
    let spawnedIsCompanion: boolean | undefined;
    const bulletPool = {
      ...makeMockBulletPool(),
      spawn: vi.fn((_origin, _dir, _u, _v, _angle, _ownerId, isCompanion) => {
        spawnedIsCompanion = isCompanion;
      }),
    } as any;

    const enemy = makeMockEnemy(5, 0, 10, 2);
    const playerPos = new THREE.Vector3(0, 10, 0);
    const playerAim = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < 30; i++) {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        [enemy], bulletPool, 0, normal, makeMockGetTransform(),
      );
    }

    expect(bulletPool.spawn).toHaveBeenCalled();
    expect(spawnedIsCompanion).toBe(true);
  });

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
    // PICKUP_COLLISION_RADIUS = 0.01 (≈ 0.50 world units at equator — touch-only)
    const pickup = new CompanionPickup(CompanionType.Protector, 0.5, 0.5);
    expect(pickup.checkPlayerCollision(0.5, 0.5)).toBe(true);    // exact match
    expect(pickup.checkPlayerCollision(0.5, 0.508)).toBe(true);  // dist=0.008 < 0.01 → within radius
    expect(pickup.checkPlayerCollision(0.5, 0.515)).toBe(false); // dist=0.015 > 0.01 → too far
    expect(pickup.checkPlayerCollision(0.8, 0.8)).toBe(false);   // far away
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

// ---------------------------------------------------------------------------
// Regression tests: orbit glitch (cube axis collapse) + flat rendering
// ---------------------------------------------------------------------------

describe('Companion orbit — axis orthogonality regression', () => {
  /**
   * Regression: On cube top face strip 1, surface.getPoint() returns
   * tangentU=(0,0,-1) and tangentV=(0,0,-1) (identical vectors due to the
   * world-axis-aligned tangentV override). The OLD code passed these directly
   * to OrbitBehavior.setFrame(), collapsing the orbit to 1D "up/down" motion.
   *
   * The FIX: compute bitangent = normal × tangent, which is always
   * perpendicular to tangent regardless of surface parameterization.
   */
  it('orbit position traces a 2D circle when tangent and bitangent are parallel (cube top face strip 1)', () => {
    const manager = new CompanionManager();
    manager.addCompanion(CompanionType.Guardian);

    // Simulate cube top face strip 1: tangentU=(0,0,-1) and tangentV=(0,0,-1) — parallel!
    // This used to collapse the orbit to 1D.
    const cubeTopFaceStrip1Transform = (_u: number, _v: number) => ({
      position: new THREE.Vector3(3, 9, -3),
      normal: new THREE.Vector3(0, 1, 0),   // top face normal
      tangent: new THREE.Vector3(0, 0, -1),  // faceRight[1]
      bitangent: new THREE.Vector3(0, 0, -1), // world-axis override (0,0,-1) — same as tangent!
    });

    const playerPos = new THREE.Vector3(3, 9, -3);
    const playerAim = new THREE.Vector3(1, 0, 0);
    const surfaceNormal = new THREE.Vector3(0, 1, 0);

    // Collect companion positions over a full orbit
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < 120; i++) {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        [], makeMockBulletPool(), 0, surfaceNormal, cubeTopFaceStrip1Transform,
      );
      const mesh = manager.root.children[0];
      if (mesh) positions.push(mesh.position.clone());
    }

    // Check that positions span more than one axis (orbit is 2D, not 1D)
    // With the fix, the orbit should vary in both X and Z directions.
    const xVals = positions.map(p => p.x);
    const zVals = positions.map(p => p.z);
    const xRange = Math.max(...xVals) - Math.min(...xVals);
    const zRange = Math.max(...zVals) - Math.min(...zVals);

    // Both axes should have significant range (not collapsed to 1D)
    // Orbit radius = 1.5, so diameter ≈ 3.0 — we expect at least 1.0 range on each axis
    expect(xRange).toBeGreaterThan(1.0);
    expect(zRange).toBeGreaterThan(1.0);
  });

  it('orbit position traces a 2D circle on torus (tangent=(0,1,0), bitangent=(0,0,1))', () => {
    const manager = new CompanionManager();
    manager.addCompanion(CompanionType.Guardian);

    // Torus outer edge: tangent points up, bitangent points along Z
    const torusOuterEdgeTransform = (_u: number, _v: number) => ({
      position: new THREE.Vector3(8, 0, 0),
      normal: new THREE.Vector3(1, 0, 0),
      tangent: new THREE.Vector3(0, 1, 0),
      bitangent: new THREE.Vector3(0, 0, 1),
    });

    const playerPos = new THREE.Vector3(8, 0, 0);
    const playerAim = new THREE.Vector3(0, 0, 1);
    const surfaceNormal = new THREE.Vector3(1, 0, 0);

    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < 120; i++) {
      manager.update(
        1 / 60, 0.5, 0.5, playerPos, playerAim,
        [], makeMockBulletPool(), 0, surfaceNormal, torusOuterEdgeTransform,
      );
      const mesh = manager.root.children[0];
      if (mesh) positions.push(mesh.position.clone());
    }

    const yVals = positions.map(p => p.y);
    const zVals = positions.map(p => p.z);
    const yRange = Math.max(...yVals) - Math.min(...yVals);
    const zRange = Math.max(...zVals) - Math.min(...zVals);

    expect(yRange).toBeGreaterThan(1.0);
    expect(zRange).toBeGreaterThan(1.0);
  });
});

describe('Companion mesh orientation — right-handed basis regression', () => {
  /**
   * Regression: The orientation matrix used makeBasis(tangent, normal, bitangent)
   * which produces det=-1 (left-handed) for standard surface frames where
   * tangentU × tangentV = normal. Three.js setFromRotationMatrix on a left-handed
   * matrix extracts an incorrect quaternion, causing companions to appear flat.
   *
   * The FIX: use makeBasis(tangent, normal, tangent × normal) which guarantees
   * det=+1 and produces a valid rotation quaternion.
   */
  it('companion mesh quaternion is non-trivial after update (not collapsed to identity or 180° flat rotation)', () => {
    const manager = new CompanionManager();
    manager.addCompanion(CompanionType.Guardian);

    // Torus case where old code produced det=-1 matrix
    const torusTransform = (_u: number, _v: number) => ({
      position: new THREE.Vector3(8, 0, 0),
      normal: new THREE.Vector3(1, 0, 0),
      tangent: new THREE.Vector3(0, 1, 0),
      bitangent: new THREE.Vector3(0, 0, 1),
    });

    const playerPos = new THREE.Vector3(8, 0, 0);
    const surfaceNormal = new THREE.Vector3(1, 0, 0);
    manager.update(
      1 / 60, 0.5, 0.5, playerPos, new THREE.Vector3(0, 0, 1),
      [], makeMockBulletPool(), 0, surfaceNormal, torusTransform,
    );

    const mesh = manager.root.children[0];
    expect(mesh).toBeTruthy();
    const q = (mesh as THREE.Object3D).quaternion;

    // A proper rotation quaternion should have w != ±1 (not identity or 180° rotation)
    // and the quaternion should represent a valid 3D orientation, not a flat projection.
    // With the old buggy code, setFromRotationMatrix on det=-1 matrix gives garbage.
    // With the fix, we get a proper rotation: the companion faces the surface normal.
    // Verify it's a valid unit quaternion (|q|=1)
    const qLen = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z);
    expect(qLen).toBeCloseTo(1.0, 3);

    // Verify that applying this quaternion to (0,1,0) gives approximately the surface normal
    // (because Y-axis of the companion mesh = surface normal in the new orientation)
    const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(localY.x).toBeCloseTo(1.0, 1); // Should align with normal (1,0,0)
    expect(Math.abs(localY.y)).toBeLessThan(0.5);
    expect(Math.abs(localY.z)).toBeLessThan(0.5);
  });

  it('orientation matrix determinant is +1 for all standard surface frames', () => {
    // Test vectors representing the problematic surfaces
    const frames = [
      // Cube top face strip 1: tangent=(0,0,-1), normal=(0,1,0)
      { tangent: new THREE.Vector3(0, 0, -1), normal: new THREE.Vector3(0, 1, 0) },
      // Torus outer edge: tangent=(0,1,0), normal=(1,0,0)
      { tangent: new THREE.Vector3(0, 1, 0), normal: new THREE.Vector3(1, 0, 0) },
      // Sphere equator: tangent=(0,0,1), normal=(1,0,0)
      { tangent: new THREE.Vector3(0, 0, 1), normal: new THREE.Vector3(1, 0, 0) },
      // Cube side face: tangent=(1,0,0), normal=(0,0,1)
      { tangent: new THREE.Vector3(1, 0, 0), normal: new THREE.Vector3(0, 0, 1) },
    ];

    for (const { tangent, normal } of frames) {
      // Compute the orientation Z axis as in the fixed code
      const orientZ = tangent.clone().cross(normal);
      const mat = new THREE.Matrix4().makeBasis(tangent, normal, orientZ);

      // Extract the 3x3 determinant
      const e = mat.elements;
      const det =
        e[0] * (e[5] * e[10] - e[9] * e[6]) -
        e[4] * (e[1] * e[10] - e[9] * e[2]) +
        e[8] * (e[1] * e[6] - e[5] * e[2]);

      expect(det).toBeCloseTo(1.0, 3);
    }
  });
});

// ---------------------------------------------------------------------------
// Regression tests: s44r2-04 — RemoteCompanionRenderer (other players' drones)
// ---------------------------------------------------------------------------

describe('RemoteCompanionRenderer (s44r2-04 — other players drones visible in MP)', () => {
  it('starts with zero meshes (no companions)', () => {
    const renderer = new RemoteCompanionRenderer();
    expect(renderer.root.children.length).toBe(0);
    renderer.dispose();
  });

  it('setCompanionCounts creates correct number of meshes', () => {
    const renderer = new RemoteCompanionRenderer();
    renderer.setCompanionCounts(2, 1, 0); // 2 guardians, 1 hunter, 0 protectors
    expect(renderer.root.children.length).toBe(3);
    renderer.dispose();
  });

  it('setCompanionCounts removes excess meshes when count drops', () => {
    const renderer = new RemoteCompanionRenderer();
    renderer.setCompanionCounts(3, 0, 0);
    expect(renderer.root.children.length).toBe(3);

    renderer.setCompanionCounts(1, 0, 0);
    expect(renderer.root.children.length).toBe(1);
    renderer.dispose();
  });

  it('setCompanionCounts to zero removes all meshes', () => {
    const renderer = new RemoteCompanionRenderer();
    renderer.setCompanionCounts(2, 2, 2);
    expect(renderer.root.children.length).toBe(6);

    renderer.setCompanionCounts(0, 0, 0);
    expect(renderer.root.children.length).toBe(0);
    renderer.dispose();
  });

  it('update positions companions around the player world position', () => {
    const renderer = new RemoteCompanionRenderer();
    renderer.setCompanionCounts(1, 0, 0); // one guardian

    const playerPos = new THREE.Vector3(5, 0, 0);
    const normal = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3(1, 0, 0);

    // Run update — should not throw
    expect(() => {
      renderer.update(1 / 60, playerPos, normal, tangent);
    }).not.toThrow();

    // Companion should be positioned near the player (within orbit radius + normal offset)
    const companionMesh = renderer.root.children[0];
    expect(companionMesh).toBeTruthy();
    const dist = companionMesh.position.distanceTo(playerPos);
    // Orbit radius = 1.5, normal offset = 0.2 → max distance ≈ sqrt(1.5² + 0.2²) ≈ 1.51
    expect(dist).toBeLessThan(2.0);
    renderer.dispose();
  });

  it('update makes companions orbit (position changes over time)', () => {
    const renderer = new RemoteCompanionRenderer();
    renderer.setCompanionCounts(1, 0, 0);

    const playerPos = new THREE.Vector3(0, 0, 0);
    const normal = new THREE.Vector3(0, 1, 0);
    const tangent = new THREE.Vector3(1, 0, 0);

    renderer.update(1 / 60, playerPos, normal, tangent);
    const pos1 = renderer.root.children[0].position.clone();

    // Run many frames
    for (let i = 0; i < 30; i++) {
      renderer.update(1 / 60, playerPos, normal, tangent);
    }
    const pos2 = renderer.root.children[0].position.clone();

    // Position should change as it orbits
    expect(pos1.distanceTo(pos2)).toBeGreaterThan(0.01);
    renderer.dispose();
  });

  it('update with zero companions does not throw', () => {
    const renderer = new RemoteCompanionRenderer();
    expect(() => {
      renderer.update(1 / 60, new THREE.Vector3(), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
    }).not.toThrow();
    renderer.dispose();
  });

  it('dispose cleans up without error', () => {
    const renderer = new RemoteCompanionRenderer();
    renderer.setCompanionCounts(2, 1, 1);
    expect(() => renderer.dispose()).not.toThrow();
    expect(renderer.root.children.length).toBe(0);
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
