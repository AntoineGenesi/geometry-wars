import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { WavesMode, KingMode, SniperMode, RainbowMode, ClaustrophobiaMode, createGameMode } from '../core/modes';
import type { GameModeContext } from '../core/modes';

// Mock dependencies - must match actual Player/Enemy/Surface APIs
function createMockPlayer() {
  return {
    score: 0,
    lives: 3,
    bombs: 3,
    surfaceU: 0.5,
    surfaceV: 0.5,
    mesh: {
      position: new THREE.Vector3(0, 0, 0),
    },
    die: vi.fn(),
  } as any;
}

function createMockEnemy(u = 0.5, v = 0.5, health = 10, scoreValue = 100) {
  return {
    surfacePosition: { u, v },
    health,
    scoreValue,
    takeDamage: vi.fn(),
  } as any;
}

const mockSurface = {
  wrapsU: true,
  wrapsV: true,
  getPoint: (u: number, v: number) => ({
    position: new THREE.Vector3(Math.cos(u * Math.PI * 2), Math.sin(v * Math.PI * 2), 0),
    normal: new THREE.Vector3(0, 0, 1),
    tangentU: new THREE.Vector3(1, 0, 0),
    tangentV: new THREE.Vector3(0, 1, 0),
  }),
  mesh: {
    geometry: {
      boundingSphere: { radius: 10 },
      computeBoundingSphere: vi.fn(),
    },
  },
  group: {
    scale: { x: 1.0 },
    add: vi.fn(),
    remove: vi.fn(),
  },
} as any;

const mockEnemySpawner = {
  getEnemies: () => [] as any[],
  getActiveCount: () => 0,
  spawnWave: vi.fn(),
} as any;

const mockWeaponManager = {} as any;
const mockBuffManager = {} as any;
const mockGame = {} as any;

function createMockContext(): GameModeContext {
  return {
    player: createMockPlayer(),
    enemySpawner: mockEnemySpawner,
    surface: mockSurface,
    weaponManager: mockWeaponManager,
    buffManager: mockBuffManager,
    game: mockGame,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
  };
}

describe('WavesMode', () => {
  let mode: WavesMode;
  let context: GameModeContext;

  beforeEach(() => {
    mode = new WavesMode();
    context = createMockContext();
  });

  it('should have correct metadata', () => {
    expect(mode.name).toBe('Waves');
    expect(mode.description).toContain('endless');
    expect(mode.icon).toBeTruthy();
  });

  it('should not modify score multiplier', () => {
    const multiplier = mode.onEnemyKilled(createMockEnemy(), context);
    expect(multiplier).toBe(1.0);
  });

  it('should return player score', () => {
    context.player.score = 1000;
    expect(mode.getScore(context)).toBe(1000);
  });

  it('should detect game over when lives <= 0', () => {
    context.player.lives = 1;
    expect(mode.isGameOver(context)).toBe(false);
    context.player.lives = 0;
    expect(mode.isGameOver(context)).toBe(true);
  });

  it('should not provide HUD overlay', () => {
    expect(mode.getHUDOverlay(context)).toBeNull();
  });
});

describe('KingMode', () => {
  let mode: KingMode;
  let context: GameModeContext;

  beforeEach(() => {
    mode = new KingMode();
    context = createMockContext();
    mode.onStart(context);
  });

  it('should have correct metadata', () => {
    expect(mode.name).toBe('King');
    expect(mode.description).toContain('safe zone');
    expect(mode.icon).toBe('\u{1F451}');
  });

  it('should return ZONE TIME as score label', () => {
    expect(mode.getScoreLabel?.()).toBe('ZONE TIME');
  });

  it('should create zone visual on start', () => {
    // Zone overlay is added to surface.group (not scene), so it rotates with the surface
    expect(mockSurface.group.add).toHaveBeenCalled();
  });

  it('should give bonus multiplier when player is in zone', () => {
    // Force player to match zone center (zone is random, so set internal state)
    const zoneU = (mode as any).zoneU;
    const zoneV = (mode as any).zoneV;
    context.player.surfaceU = zoneU;
    context.player.surfaceV = zoneV;
    mode.onFixedUpdate(0.016, context);

    const multiplier = mode.onEnemyKilled(createMockEnemy(), context);
    expect(multiplier).toBeGreaterThan(1.0);
  });

  it('should give normal multiplier when player is outside zone', () => {
    // Force player far from zone
    const zoneU = (mode as any).zoneU;
    const zoneV = (mode as any).zoneV;
    // Place player at opposite corner
    context.player.surfaceU = (zoneU + 0.5) % 1.0;
    context.player.surfaceV = (zoneV + 0.5) % 1.0;
    mode.onFixedUpdate(0.016, context);

    const multiplier = mode.onEnemyKilled(createMockEnemy(), context);
    expect(multiplier).toBe(1.0);
  });

  it('should provide HUD overlay with zone status', () => {
    mode.onFixedUpdate(0.016, context);
    const hud = mode.getHUDOverlay(context);
    expect(hud).not.toBeNull();
  });

  it('should move zone after timer expires', () => {
    const initialU = (mode as any).zoneU;
    const initialV = (mode as any).zoneV;

    // Advance timer past zone duration (15s)
    for (let i = 0; i < 20; i++) {
      mode.onFixedUpdate(1.0, context);
    }

    const newU = (mode as any).zoneU;
    const newV = (mode as any).zoneV;
    // Zone should have moved (extremely unlikely to be same random spot)
    expect(newU !== initialU || newV !== initialV).toBe(true);
  });

  it('should clean up zone visual on dispose', () => {
    // Zone overlay is removed from surface.group on dispose
    mode.dispose(context);
    expect(mockSurface.group.remove).toHaveBeenCalled();
  });

  // ---- New scoring overhaul tests ----

  it('getScore returns centiseconds of zone time (0 at start)', () => {
    expect(mode.getScore(context)).toBe(0);
  });

  it('accumulates zone time when player is in zone', () => {
    // Position player at zone center
    const zoneU = (mode as any).zoneU;
    const zoneV = (mode as any).zoneV;
    context.player.surfaceU = zoneU;
    context.player.surfaceV = zoneV;

    // Simulate 5 seconds of updates
    for (let i = 0; i < 5; i++) {
      mode.onFixedUpdate(1.0, context);
    }

    // Zone time should be ~5 seconds = 500 centiseconds
    expect(mode.getScore(context)).toBeGreaterThan(400);
    expect(mode.getScore(context)).toBeLessThanOrEqual(500);
  });

  it('does NOT accumulate zone time when player is outside zone', () => {
    // Place player far from zone center
    const zoneU = (mode as any).zoneU;
    const zoneV = (mode as any).zoneV;
    context.player.surfaceU = (zoneU + 0.5) % 1.0;
    context.player.surfaceV = (zoneV + 0.5) % 1.0;

    for (let i = 0; i < 5; i++) {
      mode.onFixedUpdate(1.0, context);
    }

    expect(mode.getScore(context)).toBe(0);
  });

  it('tracks kill points separately from zone time', () => {
    // Place player in zone
    const zoneU = (mode as any).zoneU;
    const zoneV = (mode as any).zoneV;
    context.player.surfaceU = zoneU;
    context.player.surfaceV = zoneV;
    mode.onFixedUpdate(0.016, context); // enter zone

    // Kill two enemies
    mode.onEnemyKilled(createMockEnemy(0.5, 0.5, 10, 100), context);
    mode.onEnemyKilled(createMockEnemy(0.5, 0.5, 10, 200), context);

    const killPoints = (mode as any).killPoints;
    expect(killPoints).toBe(300);
  });

  it('zone shrinks over time', () => {
    const initialRadius = (mode as any).zoneRadiusUV;
    // Simulate 60 seconds
    for (let i = 0; i < 60; i++) {
      mode.onFixedUpdate(1.0, context);
    }
    const newRadius = (mode as any).zoneRadiusUV;
    expect(newRadius).toBeLessThan(initialRadius);
  });

  it('zone does not shrink below minimum', () => {
    const minRadius = (mode as any).zoneMinRadiusUV;
    // Simulate a very long game (1000 seconds)
    for (let i = 0; i < 200; i++) {
      mode.onFixedUpdate(5.0, context);
    }
    const finalRadius = (mode as any).zoneRadiusUV;
    expect(finalRadius).toBeGreaterThanOrEqual(minRadius);
  });

  it('fires pre-planned wave when zone shrinks to threshold', () => {
    // Reset spawnWave spy
    mockEnemySpawner.spawnWave.mockClear?.() ?? vi.clearAllMocks();
    const spawnWaveSpy = vi.spyOn(mockEnemySpawner, 'spawnWave');

    // Set zone radius just above the first threshold (0.09)
    (mode as any).zoneRadiusUV = 0.091;

    // One update with enough time to push it below 0.09
    mode.onFixedUpdate(10.0, context);

    // Should have triggered spawnWave
    expect(spawnWaveSpy).toHaveBeenCalled();
  });

  it('REGRESSION: zone center world position scales with map size (small=0.75, large=1.5)', () => {
    // surface.getPoint() returns local-space (unscaled) coords.
    // The zone center world position must multiply by surface.group.scale.x so the
    // shader zone circle matches the actual visible surface regardless of map size.
    // Zone center is stored in _zoneCenterWorld (passed as shader uniform uZoneCenter).

    // Use a surface that always returns a fixed predictable world position.
    const fixedLocalPos = new THREE.Vector3(10, 0, 0);
    const scaledSurface = {
      wrapsU: false,
      wrapsV: false,
      getPoint: (_u: number, _v: number) => ({
        position: fixedLocalPos.clone(),
        normal: new THREE.Vector3(0, 1, 0),
        tangentU: new THREE.Vector3(1, 0, 0),
        tangentV: new THREE.Vector3(0, 0, 1),
      }),
      mesh: {
        geometry: {
          boundingSphere: { radius: 10 },
          computeBoundingSphere: vi.fn(),
        },
      },
      group: { scale: { x: 0.75 }, add: vi.fn(), remove: vi.fn() }, // SMALL map
    } as any;

    const smallCtx: GameModeContext = {
      ...createMockContext(),
      surface: scaledSurface,
    };

    const smallMode = new KingMode();
    smallMode.onStart(smallCtx);
    smallMode.onFixedUpdate(0.016, smallCtx);

    // Zone center must be 10 * 0.75 = 7.5 (scaled), not 10 (local-space)
    const smallCenter = (smallMode as any)._zoneCenterWorld as THREE.Vector3;
    expect(smallCenter.x).toBeCloseTo(7.5, 4);

    // Now verify LARGE map (scale 1.5)
    const largeSurface = {
      ...scaledSurface,
      group: { scale: { x: 1.5 }, add: vi.fn(), remove: vi.fn() },
    };
    const largeCtx: GameModeContext = { ...smallCtx, surface: largeSurface };
    const largeMode = new KingMode();
    largeMode.onStart(largeCtx);
    largeMode.onFixedUpdate(0.016, largeCtx);
    const largeCenter = (largeMode as any)._zoneCenterWorld as THREE.Vector3;
    expect(largeCenter.x).toBeCloseTo(15.0, 4);
  });

  it('REGRESSION s44j-07: spawnWave called with skipWarning=false in SP mode (rings clean up normally)', () => {
    // In SP, enemySpawner.update() IS called, so warning rings are cleaned up.
    // spawnWave must be called with false (default) so rings appear as intended.
    const spawnWaveSpy = vi.spyOn(mockEnemySpawner, 'spawnWave');
    spawnWaveSpy.mockClear();

    const spCtx: GameModeContext = { ...createMockContext(), isNetworkMode: false };
    const spMode = new KingMode();
    spMode.onStart(spCtx);

    // Advance past first wave timer (8s)
    for (let i = 0; i < 9; i++) {
      spMode.onFixedUpdate(1.0, spCtx);
    }

    expect(spawnWaveSpy).toHaveBeenCalled();
    // In SP mode, all spawnWave calls should use skipWarning=false
    for (const call of spawnWaveSpy.mock.calls) {
      expect(call[1]).toBeFalsy(); // skipSpawnWarning should be false/undefined
    }

    spMode.dispose(spCtx);
  });

  it('REGRESSION s44j-07: spawnWave called with skipWarning=true in MP mode (rings never accumulate)', () => {
    // Root cause: In MP, enemySpawner.update() is NOT called (server-authoritative).
    // Without this fix, KingMode called spawnWave with skipSpawnWarning=false, creating
    // red ring indicators that were never cleaned up, piling up on screen indefinitely.
    const networkSpawner = {
      getEnemies: () => [] as any[],
      getActiveCount: () => 0,
      spawnWave: vi.fn(),
    } as any;
    const spawnWaveSpy = vi.spyOn(networkSpawner, 'spawnWave');

    const networkCtx: GameModeContext = {
      ...createMockContext(),
      enemySpawner: networkSpawner,
      isNetworkMode: true,
    };
    const networkMode = new KingMode();
    networkMode.onStart(networkCtx);

    // Advance past first wave timer (8s) to trigger timed waves
    for (let i = 0; i < 9; i++) {
      networkMode.onFixedUpdate(1.0, networkCtx);
    }

    expect(spawnWaveSpy).toHaveBeenCalled();
    // In MP mode, ALL spawnWave calls must pass skipSpawnWarning=true
    for (const call of spawnWaveSpy.mock.calls) {
      expect(call[1]).toBe(true);
    }

    networkMode.dispose(networkCtx);
  });

  it('REGRESSION s44j-07: shrink threshold waves also use skipWarning in MP mode', () => {
    // Shrink events use triggerShrinkWave() — must also respect the network mode flag.
    const networkSpawner = {
      getEnemies: () => [] as any[],
      getActiveCount: () => 0,
      spawnWave: vi.fn(),
    } as any;
    const spawnWaveSpy = vi.spyOn(networkSpawner, 'spawnWave');

    const networkCtx: GameModeContext = {
      ...createMockContext(),
      enemySpawner: networkSpawner,
      isNetworkMode: true,
    };
    const networkMode = new KingMode();
    networkMode.onStart(networkCtx);

    // Force zone to just above the lowest threshold (0.05) and let it shrink past
    (networkMode as any).zoneRadiusUV = 0.051;
    networkMode.onFixedUpdate(10.0, networkCtx);

    // All spawnWave calls — including shrink waves — must use skipSpawnWarning=true
    for (const call of spawnWaveSpy.mock.calls) {
      expect(call[1]).toBe(true);
    }

    networkMode.dispose(networkCtx);
  });

  it('HUD overlay shows zone time and kill points', () => {
    // Place player in zone for 2 seconds
    const zoneU = (mode as any).zoneU;
    const zoneV = (mode as any).zoneV;
    context.player.surfaceU = zoneU;
    context.player.surfaceV = zoneV;

    for (let i = 0; i < 2; i++) {
      mode.onFixedUpdate(1.0, context);
    }

    mode.onEnemyKilled(createMockEnemy(0.5, 0.5, 10, 500), context);

    const hud = mode.getHUDOverlay(context);
    expect(hud).not.toBeNull();
    // Primary shows zone time
    expect(hud!.primary).toBeDefined();
    // Secondary shows kill points
    expect(hud!.secondary).toBeDefined();
    expect(hud!.secondary).toContain('500');
  });
});

describe('SniperMode', () => {
  let mode: SniperMode;
  let context: GameModeContext;

  beforeEach(() => {
    mode = new SniperMode();
    context = createMockContext();
    mode.onStart(context);
  });

  it('should have correct metadata', () => {
    expect(mode.name).toBe('Sniper');
    expect(mode.description).toContain('Limited ammo');
    expect(mode.icon).toBe('\u{1F3AF}');
  });

  it('should start with initial ammo', () => {
    expect(mode.getAmmo()).toBeGreaterThan(0);
  });

  it('should disable bombs on start', () => {
    expect(context.player.bombs).toBe(0);
  });

  it('should spawn ammo pickups on kill', () => {
    const enemy = createMockEnemy(0.5, 0.5);
    const initialPickupCount = (mode as any).ammoPickups.length;
    mode.onEnemyKilled(enemy, context);
    const newPickupCount = (mode as any).ammoPickups.length;
    expect(newPickupCount).toBeGreaterThan(initialPickupCount);
  });

  it('should consume ammo when firing', () => {
    const initialAmmo = mode.getAmmo();
    const success = mode.consumeAmmo(5);
    expect(success).toBe(true);
    expect(mode.getAmmo()).toBe(initialAmmo - 5);
  });

  it('should not consume more ammo than available', () => {
    const ammo = mode.getAmmo();
    const success = mode.consumeAmmo(ammo + 10);
    expect(success).toBe(false);
    expect(mode.getAmmo()).toBe(ammo);
  });

  it('should provide HUD overlay with ammo count', () => {
    const hud = mode.getHUDOverlay(context);
    expect(hud).not.toBeNull();
    expect(hud?.primary).toContain('AMMO');
  });

  it('should detect game over when out of ammo and pickups', () => {
    mode.consumeAmmo(mode.getAmmo());
    context.player.lives = 1;
    expect(mode.isGameOver(context)).toBe(true);
  });

  it('should clean up ammo pickups on dispose', () => {
    const enemy = createMockEnemy(0.5, 0.5);
    mode.onEnemyKilled(enemy, context);
    mode.dispose(context);
    expect((mode as any).ammoPickups.length).toBe(0);
  });
});

describe('RainbowMode', () => {
  let mode: RainbowMode;
  let context: GameModeContext;

  beforeEach(() => {
    mode = new RainbowMode();
    context = createMockContext();
    mode.onStart(context);
  });

  it('should have correct metadata', () => {
    expect(mode.name).toBe('Rainbow');
    expect(mode.description).toContain('color');
    expect(mode.icon).toBe('\u{1F308}');
  });

  it('should give bonus multiplier for matching color kill', () => {
    const enemy = createMockEnemy();
    // Register enemy with onFixedUpdate
    mockEnemySpawner.getEnemies = () => [enemy];
    mode.onFixedUpdate(0.016, context);

    // Manually set enemy to current color for deterministic test
    const currentColorIndex = (mode as any).currentColorIndex;
    (mode as any).enemyColors.set(enemy, currentColorIndex);

    const multiplier = mode.onEnemyKilled(enemy, context);
    expect(multiplier).toBe(3.0);

    // Restore
    mockEnemySpawner.getEnemies = () => [];
  });

  it('should give penalty multiplier for wrong color kill', () => {
    const enemy = createMockEnemy();
    // Register enemy with onFixedUpdate
    mockEnemySpawner.getEnemies = () => [enemy];
    mode.onFixedUpdate(0.016, context);

    // Set enemy to a DIFFERENT color
    const currentColorIndex = (mode as any).currentColorIndex;
    const wrongColorIndex = (currentColorIndex + 1) % (mode as any).colors.length;
    (mode as any).enemyColors.set(enemy, wrongColorIndex);

    const multiplier = mode.onEnemyKilled(enemy, context);
    expect(multiplier).toBe(0.5);

    // Restore
    mockEnemySpawner.getEnemies = () => [];
  });

  it('should return 1.0 for unregistered enemy', () => {
    const enemy = createMockEnemy();
    const multiplier = mode.onEnemyKilled(enemy, context);
    expect(multiplier).toBe(1.0);
  });

  it('should cycle colors over time', () => {
    const initialColorIndex = (mode as any).currentColorIndex;

    // Advance timer past color duration (5s)
    for (let i = 0; i < 10; i++) {
      mode.onFixedUpdate(1.0, context);
    }

    const newColorIndex = (mode as any).currentColorIndex;
    expect(newColorIndex).not.toBe(initialColorIndex);
  });

  it('should provide HUD overlay with current color', () => {
    const hud = mode.getHUDOverlay(context);
    expect(hud).not.toBeNull();
    expect(hud?.primary).toContain('COLOR');
  });

  it('should assign colors to new enemies in onFixedUpdate', () => {
    const enemy = createMockEnemy();
    mockEnemySpawner.getEnemies = () => [enemy];
    mode.onFixedUpdate(0.016, context);

    expect((mode as any).enemyColors.has(enemy)).toBe(true);

    // Restore
    mockEnemySpawner.getEnemies = () => [];
  });
});

describe('ClaustrophobiaMode', () => {
  let mode: ClaustrophobiaMode;
  let context: GameModeContext;

  beforeEach(() => {
    mode = new ClaustrophobiaMode();
    context = createMockContext();
    mode.onStart(context);
  });

  it('should have correct metadata', () => {
    expect(mode.name).toBe('Claustrophobia');
    expect(mode.description).toContain('shrink');
    expect(mode.icon).toBe('\u{1F534}');
  });

  it('should create boundary visual on start', () => {
    const childCount = context.scene.children.length;
    expect(childCount).toBeGreaterThan(0);
  });

  it('should shrink boundary over time', () => {
    const initialRadius = (mode as any).boundaryRadius;

    for (let i = 0; i < 100; i++) {
      mode.onFixedUpdate(1.0, context);
    }

    const newRadius = (mode as any).boundaryRadius;
    expect(newRadius).toBeLessThan(initialRadius);
  });

  it('should kill player outside boundary', () => {
    // Shrink boundary to tiny
    for (let i = 0; i < 170; i++) {
      mode.onFixedUpdate(1.0, context);
    }

    // Place player at edge
    context.player.surfaceU = 0.1;
    context.player.surfaceV = 0.1;
    mode.onFixedUpdate(0.016, context);

    expect(context.player.die).toHaveBeenCalled();
  });

  it('should kill enemies outside boundary', () => {
    // Shrink boundary significantly
    for (let i = 0; i < 170; i++) {
      mode.onFixedUpdate(1.0, context);
    }

    const enemy = createMockEnemy(0.1, 0.1, 100);
    mockEnemySpawner.getEnemies = () => [enemy];
    mode.onFixedUpdate(0.016, context);

    expect(enemy.takeDamage).toHaveBeenCalledWith(100);

    // Restore
    mockEnemySpawner.getEnemies = () => [];
  });

  it('should provide HUD overlay with play area percentage', () => {
    const hud = mode.getHUDOverlay(context);
    expect(hud).not.toBeNull();
    expect(hud?.primary).toContain('Play Area');
  });

  it('should clean up boundary visual on dispose', () => {
    const initialCount = context.scene.children.length;
    mode.dispose(context);
    expect(context.scene.children.length).toBeLessThan(initialCount);
  });

  it('REGRESSION: boundary ring vertices scale with map size (small=0.75, large=1.5)', () => {
    // surface.getPoint() returns local-space (unscaled) coords.
    // Boundary ring vertices must be multiplied by surface.group.scale.x
    // to sit on the actual visible surface regardless of map size.
    // Previously vertices were NOT scaled, so the ring appeared in the wrong
    // world-space position on SMALL/LARGE/EPIC maps.

    const fixedLocalPos = new THREE.Vector3(5, 0, 0);
    const scaledSurface = {
      wrapsU: false,
      wrapsV: false,
      getPoint: (_u: number, _v: number) => ({
        position: fixedLocalPos.clone(),
        normal: new THREE.Vector3(0, 0, 1),
        tangentU: new THREE.Vector3(1, 0, 0),
        tangentV: new THREE.Vector3(0, 1, 0),
      }),
      mesh: { geometry: { boundingSphere: null, computeBoundingSphere: vi.fn() } },
      group: { scale: { x: 0.75 } }, // SMALL map
    } as any;

    // SMALL map (scale 0.75) — ring vertices should be at 5 * 0.75 = 3.75
    const smallCtx: GameModeContext = { ...createMockContext(), surface: scaledSurface };
    const smallMode = new ClaustrophobiaMode();
    smallMode.onStart(smallCtx);
    const smallLine = (smallMode as any).boundaryMesh as THREE.Line;
    const smallPositions = smallLine.geometry.attributes.position;
    expect(smallPositions.getX(0)).toBeCloseTo(3.75, 4);

    // LARGE map (scale 1.5) — ring vertices should be at 5 * 1.5 = 7.5
    const largeSurface = { ...scaledSurface, group: { scale: { x: 1.5 } } };
    const largeCtx: GameModeContext = { ...smallCtx, surface: largeSurface };
    const largeMode = new ClaustrophobiaMode();
    largeMode.onStart(largeCtx);
    const largeLine = (largeMode as any).boundaryMesh as THREE.Line;
    const largePositions = largeLine.geometry.attributes.position;
    expect(largePositions.getX(0)).toBeCloseTo(7.5, 4);

    smallMode.dispose(smallCtx);
    largeMode.dispose(largeCtx);
  });
});

describe('createGameMode', () => {
  it('should create Waves mode', () => {
    expect(createGameMode('waves')).toBeInstanceOf(WavesMode);
  });

  it('should create King mode', () => {
    expect(createGameMode('king')).toBeInstanceOf(KingMode);
  });

  it('should create Sniper mode', () => {
    expect(createGameMode('sniper')).toBeInstanceOf(SniperMode);
  });

  it('should create Rainbow mode', () => {
    expect(createGameMode('rainbow')).toBeInstanceOf(RainbowMode);
  });

  it('should create Claustrophobia mode', () => {
    expect(createGameMode('claustrophobia')).toBeInstanceOf(ClaustrophobiaMode);
  });

  it('should default to Waves mode for unknown type', () => {
    expect(createGameMode('invalid' as any)).toBeInstanceOf(WavesMode);
  });
});
