/**
 * Real Game Verification Test Suite
 *
 * Tests the ACTUAL GameLoop.ts code path — the exact same code the user plays.
 * Unlike playground-verification.test.ts (which uses PlaygroundGame/GameInstance),
 * this suite instantiates GameLoop + GameContext identical to main.ts.
 *
 * Tests organized by bug-pattern category (from user testing feedback):
 * - Category A: Bullet origin & direction
 * - Category B: Hit detection & ghost kills
 * - Category C: Player position & surface integrity
 * - Category D: Rendering & visibility
 * - Category E: Entity surface info API
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// DOM / browser shims (must be before game code imports)
// ---------------------------------------------------------------------------

import '../test/verification-env';

// Extend document mock with getElementById and querySelector (required by UIHelpers static initializers)
if (globalThis.document && !(globalThis.document as any).getElementById) {
  const mockElement = {
    style: {}, textContent: '', innerText: '', innerHTML: '',
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    appendChild: () => {}, removeChild: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => {} }),
  };
  (globalThis.document as any).getElementById = () => ({ ...mockElement });
  (globalThis.document as any).querySelector = () => null;
  (globalThis.document as any).querySelectorAll = () => [];
}

// Add localStorage mock
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

// Add performance.now if missing
if (typeof globalThis.performance === 'undefined') {
  (globalThis as any).performance = { now: () => Date.now() };
}

// Add sessionStorage mock
if (typeof globalThis.sessionStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as any).sessionStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
}

// ---------------------------------------------------------------------------
// vi.mock — must be BEFORE importing game code (vitest hoists these)
// ---------------------------------------------------------------------------

// Mock UIHelpers (static DOM access in class initializer)
vi.mock('../ui/UIHelpers', () => ({
  UIHelpers: {
    updateCountdownOverlay: vi.fn(),
    updateTimerDisplay: vi.fn(),
    showDeathCamEffect: vi.fn(),
    hideDeathCamEffect: vi.fn(),
    screenFlash: vi.fn(),
    updateLivesDisplay: vi.fn(),
    updateBombsDisplay: vi.fn(),
    updateScoreDisplay: vi.fn(),
    updateMultiplierDisplay: vi.fn(),
    updateWeaponDisplay: vi.fn(),
    setLevelName: vi.fn(),
    updateComboDisplay: vi.fn(),
    updateBoostMeter: vi.fn(),
    updatePlayerLevelDisplay: vi.fn(),
  },
}));

// Mock SettingsMenu (loadGraphicsSettings uses localStorage)
vi.mock('../ui/SettingsMenu', () => ({
  loadGraphicsSettings: () => ({ enable90DegreeHide: false }),
  loadDebugSettings: () => ({ showDebugStatistics: false }),
  SettingsMenu: { setGlobalRendererInfo: vi.fn(), setGlobalDebugChangeCallback: vi.fn(), setGlobalVisualStyleChangeCallback: vi.fn() },
}));

// Mock VisualStyleSettings (uses localStorage)
vi.mock('../ui/VisualStyleSettings', () => ({
  loadVisualStyle: () => null,
  loadVisualMode: () => 'modern',
  saveVisualMode: vi.fn(),
}));

vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false,
  }),
}));

vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class {
    passes: any[] = [];
    addPass(p: any) { this.passes.push(p); }
    render() {}
    setSize() {}
    dispose() {}
  },
}));

vi.mock('three/addons/postprocessing/RenderPass.js', () => ({
  RenderPass: class { constructor(_s: any, _c: any) {} },
}));

vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class {
    resolution = new THREE.Vector2(800, 600);
    constructor(_r: any, _s: number, _ra: number, _t: number) {}
  },
}));

vi.mock('three/addons/postprocessing/OutputPass.js', () => ({
  OutputPass: class {},
}));

vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({
  ShaderPass: class { constructor(_s: any) {} },
}));

vi.mock('three/webgpu', () => ({
  PostProcessing: class { render() {} },
  pass: () => ({ getTextureNode: () => ({ r: 0, g: 0, b: 0, mul: () => ({}) }) }),
  float: () => ({}),
  max: () => ({ sub: () => ({}) }),
  add: () => ({ mul: () => ({}) }),
  screenUV: { sub: () => ({ dot: () => ({ mul: () => ({}) }) }) },
}));

vi.mock('../rendering/GPUCapabilities', () => ({
  detectGPUCapabilities: vi.fn().mockResolvedValue({
    webgpu: false, webgl2: true, webgl1: true, maxTextureSize: 4096,
    maxInstanceCount: 1000, sharedArrayBuffer: false, hardwareConcurrency: 4,
    renderer: 'Mock', vendor: 'Mock', webgpuAdapter: '', tier: 'medium',
  }),
}));

vi.mock('../rendering/RendererFactory', () => ({
  createRenderer: vi.fn().mockResolvedValue({
    renderer: {}, isWebGPU: false, backend: 'webgl2',
  }),
  resolveRendererPreference: vi.fn().mockReturnValue('webgl2'),
  installWebGPUDiagnostic: vi.fn(),
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class MockWebGLRenderer {
    domElement: any;
    toneMapping: any;
    toneMappingExposure = 1;
    shadowMap = { enabled: false };
    outputColorSpace: any;
    info = { render: { calls: 0, triangles: 0 } };
    constructor(_opts?: any) {
      this.domElement = {
        style: {}, width: 800, height: 600,
        addEventListener: () => {}, removeEventListener: () => {},
        remove: () => {}, getContext: () => null, toDataURL: () => '',
      };
      this.toneMapping = actual.NoToneMapping;
      this.outputColorSpace = actual.SRGBColorSpace;
    }
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
    getSize(t: any) { return t?.set?.(800, 600) ?? new actual.Vector2(800, 600); }
    getPixelRatio() { return 1; }
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

// ---------------------------------------------------------------------------
// NOW import the harness (after all mocks are set up)
// ---------------------------------------------------------------------------

import { RealGameTestHarness } from './RealGameTestHarness';
import type { SurfaceType } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Surfaces to sweep across
// ---------------------------------------------------------------------------

const ALL_SURFACES: SurfaceType[] = [
  'sphere', 'torus', 'cube', 'pill', 'peanut', 'mobius',
];

// ---------------------------------------------------------------------------
// Category A: Bullet Origin & Direction Tests
// ---------------------------------------------------------------------------

describe('Category A: Bullet Origin & Direction', () => {
  let h: RealGameTestHarness;

  afterEach(() => {
    // Cleanup (no servers to kill in headless tests)
  });

  for (const surface of ALL_SURFACES) {
    it(`bullets originate from player position on ${surface}`, () => {
      h = new RealGameTestHarness({ surface });
      h.tick(10); // settle

      // Move player first (ensures bullet isn't from spawn point)
      h.pressKey('w');
      h.tick(30);
      h.releaseAllKeys();
      h.tick(5);

      const playerPosBefore = h.getPlayerWorldPos();

      // Fire bullets
      h.setMousePosition(600, 300); // aim right
      h.setMouseDown(true);
      h.tick(10);
      h.setMouseDown(false);

      // Verify bullets originated near player
      const result = h.verifyBulletOrigins(2.0);
      expect(result.details.length).toBeGreaterThan(0);
      expect(result.passed).toBe(true);
      // Also check: bullet origin shouldn't be at surface center (0,0,0)
      for (const d of result.details) {
        expect(d.bulletPos.length()).toBeGreaterThan(1.0); // not at origin
      }
    });
  }

  it('bullets track current player position after movement', () => {
    h = new RealGameTestHarness({ surface: 'sphere' });
    h.tick(10);

    // Move to a new position
    h.pressKey('w');
    h.tick(60);
    h.releaseAllKeys();
    h.tick(5);

    h.clearBulletLog();
    const playerPosA = h.getPlayerWorldPos();

    // Fire
    h.setMouseDown(true);
    h.tick(5);
    h.setMouseDown(false);

    const bulletsA = h.getRecentBullets(5);
    expect(bulletsA.length).toBeGreaterThan(0);

    // Move to different position
    h.pressKey('d');
    h.tick(60);
    h.releaseAllKeys();
    h.tick(5);

    h.clearBulletLog();
    const playerPosB = h.getPlayerWorldPos();
    expect(playerPosB.distanceTo(playerPosA)).toBeGreaterThan(0.5);

    // Fire again
    h.setMouseDown(true);
    h.tick(5);
    h.setMouseDown(false);

    const bulletsB = h.getRecentBullets(5);
    expect(bulletsB.length).toBeGreaterThan(0);

    // Bullet B origins should be near player B, not player A
    for (const b of bulletsB) {
      expect(b.worldPos.distanceTo(playerPosB)).toBeLessThan(2.0);
      // should NOT be near old position
      expect(b.worldPos.distanceTo(playerPosA)).toBeGreaterThan(0.5);
    }
  });
});

// ---------------------------------------------------------------------------
// Category B: Hit Detection
// ---------------------------------------------------------------------------

describe('Category B: Hit Detection', () => {
  let h: RealGameTestHarness;

  it('bullet hits enemy at known position', () => {
    h = new RealGameTestHarness({ surface: 'sphere' });
    h.tick(10); // settle

    // Spawn enemy slightly ahead of player
    const playerUV = h.getPlayerSurfaceUV();
    const enemyU = playerUV.u;
    const enemyV = Math.min(1, playerUV.v + 0.15);
    h.spawnEnemy('grunt', enemyU, enemyV);
    h.tick(5); // let enemy initialize

    const enemiesBefore = h.getEnemies();
    expect(enemiesBefore.length).toBeGreaterThan(0);
    const initialEnemyCount = enemiesBefore.length;

    // Aim at enemy and fire
    // Enemy is roughly "forward" from player — aim up in screen space
    h.setMousePosition(400, 100); // aim upward
    h.setMouseDown(true);
    h.tick(120); // fire for 2 seconds
    h.setMouseDown(false);

    // At least expect some bullets were fired
    expect(h.bulletSpawnLog.length).toBeGreaterThan(0);
    // At least one enemy should have died from sustained fire
    const enemiesAfter = h.getEnemies();
    expect(enemiesAfter.length).toBeLessThan(initialEnemyCount);
  });

  it('no ghost kills — distant enemies survive', () => {
    h = new RealGameTestHarness({ surface: 'sphere' });
    h.tick(10);

    // Spawn enemy on opposite side of sphere
    h.spawnEnemy('grunt', 0.0, 0.5); // opposite from player at (0.5, 0.5)
    h.tick(5);

    const enemyBefore = h.getEnemies();
    expect(enemyBefore.length).toBeGreaterThan(0);
    const enemyHealthBefore = enemyBefore[0].health;

    // Fire in completely wrong direction
    h.setMousePosition(200, 300); // aim left (away from enemy)
    h.setMouseDown(true);
    h.tick(60);
    h.setMouseDown(false);
    h.tick(60); // let bullets travel and expire

    // Enemy on opposite side should still be alive at same health
    const enemyAfter = h.getEnemies();
    expect(enemyAfter.length).toBe(enemyBefore.length);
    expect(enemyAfter[0].health).toBe(enemyHealthBefore);
  });
});

// ---------------------------------------------------------------------------
// Category C: Player Position & Surface Integrity
// ---------------------------------------------------------------------------

describe('Category C: Player on Surface', () => {
  for (const surface of ALL_SURFACES) {
    it(`player stays on ${surface} surface during movement`, () => {
      const h = new RealGameTestHarness({ surface });
      h.tick(10);

      // Initial check
      const info0 = h.getPlayerSurfaceInfo();
      expect(info0.isOnSurface).toBe(true);
      expect(info0.isInsideSurface).toBe(false);

      // Move in all directions
      const directions = [
        { key: 'w', label: 'forward' },
        { key: 's', label: 'backward' },
        { key: 'a', label: 'left' },
        { key: 'd', label: 'right' },
      ];

      for (const dir of directions) {
        h.pressKey(dir.key);
        h.tick(30);
        h.releaseAllKeys();

        const info = h.getPlayerSurfaceInfo();
        expect(info.isOnSurface).toBe(true);
        expect(info.isInsideSurface).toBe(false);
        expect(info.distFromSurface).toBeLessThan(0.5);
      }
    });
  }

  it('player position moves when input is given', () => {
    const h = new RealGameTestHarness({ surface: 'sphere' });
    h.tick(10);
    const startPos = h.getPlayerWorldPos();

    h.pressKey('w');
    h.tick(60);
    h.releaseAllKeys();

    const endPos = h.getPlayerWorldPos();
    expect(endPos.distanceTo(startPos)).toBeGreaterThan(0.1);
  });

  it('player position stays fixed when no input', () => {
    const h = new RealGameTestHarness({ surface: 'sphere' });
    h.tick(10);
    const pos1 = h.getPlayerWorldPos();
    h.tick(60);
    const pos2 = h.getPlayerWorldPos();
    expect(pos2.distanceTo(pos1)).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------
// Category D: Entity Surface Info API
// ---------------------------------------------------------------------------

describe('Category D: EntitySurfaceInfo API', () => {
  it('returns correct info for player on sphere', () => {
    const h = new RealGameTestHarness({ surface: 'sphere' });
    h.tick(10);

    const info = h.getPlayerSurfaceInfo();
    expect(info.isOnSurface).toBe(true);
    expect(info.isInsideSurface).toBe(false);
    expect(info.distFromSurface).toBeLessThan(0.5);
    expect(info.surfaceRegion).toContain('sphere');
    expect(info.surfaceNormal.length()).toBeCloseTo(1.0, 1);
  });

  it('returns correct info for player on torus', () => {
    const h = new RealGameTestHarness({ surface: 'torus' });
    h.tick(10);

    const info = h.getPlayerSurfaceInfo();
    expect(info.isOnSurface).toBe(true);
    expect(info.surfaceRegion).toContain('torus');
  });

  it('detects enemies on surface', () => {
    const h = new RealGameTestHarness({ surface: 'sphere' });
    h.tick(10);

    h.spawnEnemy('grunt', 0.3, 0.3);
    h.tick(5);

    const enemyInfos = h.getEnemySurfaceInfos();
    expect(enemyInfos.length).toBeGreaterThan(0);
    for (const info of enemyInfos) {
      expect(info.isOnSurface).toBe(true);
    }
  });

  it('bullet surface info tracks bullets in flight', () => {
    const h = new RealGameTestHarness({ surface: 'sphere' });
    h.tick(10);

    h.setMousePosition(600, 300);
    h.setMouseDown(true);
    h.tick(5);
    h.setMouseDown(false);

    const bulletInfos = h.getBulletSurfaceInfos();
    expect(bulletInfos.length).toBeGreaterThan(0);
    for (const info of bulletInfos) {
      // Bullets should be near the surface
      expect(info.distFromSurface).toBeLessThan(2.0);
    }
  });
});

// ---------------------------------------------------------------------------
// Category E: All-Surface Sweep
// ---------------------------------------------------------------------------

describe('All-Surface Sweep', () => {
  interface SweepResult {
    surface: string;
    playerOnSurface: boolean;
    playerMoved: boolean;
    bulletsFired: boolean;
    bulletsFromPlayer: boolean;
    enemySpawnable: boolean;
  }

  const results: SweepResult[] = [];

  for (const surface of ALL_SURFACES) {
    it(`sweep test: ${surface}`, () => {
      const h = new RealGameTestHarness({ surface });
      h.tick(10); // settle

      // 1. Player on surface
      const playerInfo = h.getPlayerSurfaceInfo();
      const playerOnSurface = playerInfo.isOnSurface;

      // 2. Player can move
      const startPos = h.getPlayerWorldPos();
      h.pressKey('w');
      h.tick(30);
      h.releaseAllKeys();
      const endPos = h.getPlayerWorldPos();
      const playerMoved = endPos.distanceTo(startPos) > 0.05;

      // 3. Bullets can fire
      h.clearBulletLog();
      h.setMousePosition(600, 300);
      h.setMouseDown(true);
      h.tick(10);
      h.setMouseDown(false);
      const bulletsFired = h.bulletSpawnLog.length > 0;

      // 4. Bullets come from player
      const bulletResult = h.verifyBulletOrigins(2.0);
      const bulletsFromPlayer = bulletResult.passed;

      // 5. Enemies can spawn
      h.spawnEnemy('grunt', 0.3, 0.7);
      h.tick(5);
      const enemySpawnable = h.getEnemies().length > 0;

      const result: SweepResult = {
        surface,
        playerOnSurface,
        playerMoved,
        bulletsFired,
        bulletsFromPlayer,
        enemySpawnable,
      };
      results.push(result);

      // Assert all pass
      expect(playerOnSurface).toBe(true);
      expect(playerMoved).toBe(true);
      expect(bulletsFired).toBe(true);
      expect(bulletsFromPlayer).toBe(true);
      expect(enemySpawnable).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Bullet Origin Tracking: Verify spawn log records correctly
// ---------------------------------------------------------------------------

describe('Bullet Spawn Logging', () => {
  it('records bullet spawn with player position context', () => {
    const h = new RealGameTestHarness({ surface: 'sphere' });
    h.tick(10);

    h.setMouseDown(true);
    h.tick(5);
    h.setMouseDown(false);

    expect(h.bulletSpawnLog.length).toBeGreaterThan(0);
    const record = h.bulletSpawnLog[0];

    // Record should have all fields
    expect(record.worldPos).toBeInstanceOf(THREE.Vector3);
    expect(record.direction).toBeInstanceOf(THREE.Vector3);
    expect(record.playerWorldPos).toBeInstanceOf(THREE.Vector3);
    expect(record.surfaceUV).toBeDefined();
    expect(record.playerUV).toBeDefined();
    expect(record.frame).toBeGreaterThanOrEqual(0);

    // Direction should be normalized
    expect(record.direction.length()).toBeCloseTo(1.0, 1);
  });
});
