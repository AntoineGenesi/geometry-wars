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
} as any;

const mockEnemySpawner = {
  getEnemies: () => [] as any[],
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
    const childCount = context.scene.children.length;
    expect(childCount).toBeGreaterThan(0);
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
    const initialCount = context.scene.children.length;
    mode.dispose(context);
    expect(context.scene.children.length).toBeLessThan(initialCount);
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
