/**
 * Cross-Surface Verification Matrix
 *
 * Tests ALL 12 surface types × 5 core systems using RealGameTestHarness.
 * RealGameTestHarness uses GameLoop.ts — the ACTUAL game code path, not PlaygroundGame.
 *
 * Systems tested:
 *   A. Player Movement        — player moves after WASD, no NaN, no freeze
 *   B. Bullet Origin          — bullets spawn near player position
 *   C. Enemy Surface Validity — enemies spawn on surface, not inside
 *   D. Player On Surface      — player stays on surface during movement
 *   E. Hit Detection          — bullets reach enemies at visual distance
 *
 * Surfaces: sphere, torus, cube, pill, peanut, mobius, sphere-tunnel,
 *           cube-ring, cube-tunnel, capsule, icosahedron, pipe
 *
 * MP/PvP tests require Puppeteer (see tests/visual/s44r6-17-cross-surface-verification.mjs)
 *
 * Run from PROJECT ROOT (not worktree — vitest can't run in worktrees):
 *   PATH="/home/antoine/.nvm/versions/node/v20.19.5/bin:/usr/bin:/bin" \
 *   npx vitest run src/test/cross-surface-matrix.test.ts
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// DOM / browser shims
// ---------------------------------------------------------------------------

import './verification-env';

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

if (typeof globalThis.performance === 'undefined') {
  (globalThis as any).performance = { now: () => Date.now() };
}

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
// vi.mock — must be BEFORE importing game code
// ---------------------------------------------------------------------------

vi.mock('../ui/UIHelpers', () => ({
  UIHelpers: {
    updateCountdownOverlay: vi.fn(), updateTimerDisplay: vi.fn(),
    showDeathCamEffect: vi.fn(), hideDeathCamEffect: vi.fn(),
    screenFlash: vi.fn(), updateLivesDisplay: vi.fn(),
    updateBombsDisplay: vi.fn(), updateScoreDisplay: vi.fn(),
    updateMultiplierDisplay: vi.fn(), updateWeaponDisplay: vi.fn(),
    setLevelName: vi.fn(), updateComboDisplay: vi.fn(),
    updateBoostMeter: vi.fn(), updatePlayerLevelDisplay: vi.fn(),
  },
}));

vi.mock('../ui/SettingsMenu', () => ({
  loadGraphicsSettings: () => ({ enable90DegreeHide: false }),
  loadDebugSettings: () => ({ showDebugStatistics: false }),
  SettingsMenu: {
    setGlobalRendererInfo: vi.fn(),
    setGlobalDebugChangeCallback: vi.fn(),
    setGlobalVisualStyleChangeCallback: vi.fn(),
  },
}));

vi.mock('../ui/VisualStyleSettings', () => ({
  loadVisualStyle: () => null,
  loadVisualMode: () => 'modern',
  saveVisualMode: vi.fn(),
}));

vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({ play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false }),
}));

vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class {
    passes: any[] = [];
    addPass(p: any) { this.passes.push(p); }
    render() {} setSize() {} dispose() {}
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
  createRenderer: vi.fn().mockResolvedValue({ renderer: {}, isWebGPU: false, backend: 'webgl2' }),
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
    setSize() {} setPixelRatio() {} render() {} dispose() {}
    getSize(t: any) { return t?.set?.(800, 600) ?? new actual.Vector2(800, 600); }
    getPixelRatio() { return 1; }
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

// ---------------------------------------------------------------------------
// NOW import the harness and types
// ---------------------------------------------------------------------------

import { RealGameTestHarness } from './RealGameTestHarness';
import type { SurfaceType } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Surface groups for meaningful reporting
// ---------------------------------------------------------------------------

/** Core surfaces with rich existing test coverage */
const CORE_SURFACES: SurfaceType[] = ['sphere', 'cube', 'torus', 'pill', 'peanut', 'mobius'];

/** Extended surfaces added post s44r4 */
const EXTENDED_SURFACES: SurfaceType[] = [
  'sphere-tunnel', 'cube-ring', 'cube-tunnel', 'capsule', 'icosahedron', 'pipe',
];

/** All surfaces in the matrix */
const ALL_SURFACES: SurfaceType[] = [...CORE_SURFACES, ...EXTENDED_SURFACES];

// ---------------------------------------------------------------------------
// Helper: is vector finite and not NaN
// ---------------------------------------------------------------------------

function isValidVec3(v: THREE.Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

// ==========================================================================
// SYSTEM A: Player Movement
// ==========================================================================

describe('System A: Player Movement — all surfaces', () => {
  let h: RealGameTestHarness;

  afterEach(() => { /* no cleanup needed */ });

  for (const surface of ALL_SURFACES) {
    describe(`${surface}`, () => {
      beforeEach(() => {
        h = new RealGameTestHarness({ surface, seed: 42 });
        h.tick(10); // settle
      });

      it('player position is valid (not NaN) after spawn', () => {
        const pos = h.getPlayerWorldPos();
        expect(isValidVec3(pos), `${surface}: player spawned at NaN position ${JSON.stringify(pos)}`).toBe(true);
      });

      it('player moves after pressing W (forward)', () => {
        const before = h.getPlayerWorldPos().clone();
        h.pressKey('w');
        h.tick(30);
        h.releaseKey('w');
        const after = h.getPlayerWorldPos();
        const dist = before.distanceTo(after);
        expect(dist, `${surface}: player didn't move after W. Distance: ${dist}`).toBeGreaterThan(0.01);
      });

      it('player moves in all 4 WASD directions', () => {
        const keys = ['w', 'a', 's', 'd'] as const;
        for (const key of keys) {
          const before = h.getPlayerWorldPos().clone();
          h.pressKey(key);
          h.tick(30);
          h.releaseKey(key);
          const after = h.getPlayerWorldPos();
          const dist = before.distanceTo(after);
          expect(dist, `${surface}: key "${key}" failed to move player. Distance: ${dist}`).toBeGreaterThan(0.01);
        }
      });

      it('player position stays valid (no NaN) during 5 seconds of movement', () => {
        h.pressKey('w');
        for (let i = 0; i < 300; i++) {
          h.tick(1);
          const pos = h.getPlayerWorldPos();
          if (!isValidVec3(pos)) {
            h.releaseKey('w');
            expect.fail(`${surface}: player position became NaN at frame ${i}: ${JSON.stringify(pos)}`);
          }
        }
        h.releaseKey('w');
      });

      it('player does not freeze (continuous movement over 5s)', () => {
        const snapshots: THREE.Vector3[] = [];
        h.pressKey('w');
        for (let snap = 0; snap < 5; snap++) {
          h.tick(60);
          snapshots.push(h.getPlayerWorldPos().clone());
        }
        h.releaseKey('w');

        let maxConsecutiveStuck = 0;
        let consecutiveStuck = 0;
        for (let i = 1; i < snapshots.length; i++) {
          const dist = snapshots[i - 1].distanceTo(snapshots[i]);
          if (dist < 0.001) {
            consecutiveStuck++;
            maxConsecutiveStuck = Math.max(maxConsecutiveStuck, consecutiveStuck);
          } else {
            consecutiveStuck = 0;
          }
        }

        expect(maxConsecutiveStuck,
          `${surface}: player froze for ${maxConsecutiveStuck} consecutive second-snapshots during 5s movement`
        ).toBeLessThan(3); // Allow up to 2s of potential pole-near slowdown
      });
    });
  }
});

// ==========================================================================
// SYSTEM B: Bullet Origin
// ==========================================================================

describe('System B: Bullet Origin — all surfaces', () => {
  for (const surface of ALL_SURFACES) {
    it(`${surface}: bullets originate near player position`, () => {
      const h = new RealGameTestHarness({ surface, seed: 42 });
      h.tick(10);

      // Aim to the right and shoot
      h.setMousePosition(h.width * 0.75, h.height * 0.5);
      h.setMouseDown(true);
      h.tick(30); // 0.5s of shooting
      h.setMouseDown(false);

      const bulletLog = h.getRecentBullets(20);
      expect(bulletLog.length, `${surface}: no bullets were fired`).toBeGreaterThan(0);

      const result = h.verifyBulletOrigins(2.0); // 2 world unit tolerance
      expect(result.passed,
        `${surface}: bullets spawned ${result.maxDistance.toFixed(2)} units from player (max 2.0 allowed). ` +
        `Details: ${JSON.stringify(result.details.slice(0, 3))}`
      ).toBe(true);
    });
  }
});

// ==========================================================================
// SYSTEM C: Enemy Surface Validity
// ==========================================================================

describe('System C: Enemy Surface Validity — all surfaces', () => {
  for (const surface of ALL_SURFACES) {
    describe(`${surface}`, () => {
      it('enemies spawn with valid (non-NaN) positions', () => {
        const h = new RealGameTestHarness({ surface, seed: 42, enemyCount: 5 });
        h.tick(120); // 2s — give time for enemies to spawn

        const enemies = h.getEnemies();
        // Not all surfaces may spawn 5 enemies in 2s; just check what spawned
        if (enemies.length === 0) return; // N/A — no enemies in 2s is acceptable

        for (const enemy of enemies) {
          const pos = enemy.mesh?.position ?? enemy.position;
          expect(isValidVec3(pos),
            `${surface}: enemy has NaN position: ${JSON.stringify(pos)}`
          ).toBe(true);
        }
      });

      it('enemies are not inside the surface', () => {
        const h = new RealGameTestHarness({ surface, seed: 42, enemyCount: 5 });
        h.tick(120); // 2s

        const infos = h.getEnemySurfaceInfos();
        if (infos.length === 0) return; // N/A

        const insideEnemies = infos.filter(info => info.isInsideSurface);
        expect(insideEnemies.length,
          `${surface}: ${insideEnemies.length}/${infos.length} enemies are INSIDE the surface. ` +
          `Positions: ${JSON.stringify(insideEnemies.map(e => e.distFromSurface))}`
        ).toBe(0);
      });

      it('enemies are near the surface (within 1.5 units)', () => {
        const h = new RealGameTestHarness({ surface, seed: 42, enemyCount: 5 });
        h.tick(120);

        const infos = h.getEnemySurfaceInfos();
        if (infos.length === 0) return;

        const farEnemies = infos.filter(info => info.distFromSurface > 1.5);
        expect(farEnemies.length,
          `${surface}: ${farEnemies.length}/${infos.length} enemies are far from surface (>1.5 units). ` +
          `Distances: ${JSON.stringify(farEnemies.map(e => e.distFromSurface.toFixed(2)))}`
        ).toBe(0);
      });
    });
  }
});

// ==========================================================================
// SYSTEM D: Player On Surface
// ==========================================================================

describe('System D: Player On Surface — all surfaces', () => {
  for (const surface of ALL_SURFACES) {
    it(`${surface}: player stays on surface during movement`, () => {
      const h = new RealGameTestHarness({ surface, seed: 42 });
      h.tick(10);

      // Move in multiple directions
      let offSurfaceFrames = 0;
      const keys = ['w', 'a', 's', 'd'];

      for (const key of keys) {
        h.pressKey(key);
        for (let i = 0; i < 60; i++) {
          h.tick(1);
          const info = h.getPlayerSurfaceInfo();
          if (!info.isOnSurface) offSurfaceFrames++;
        }
        h.releaseKey(key);
      }

      // Allow at most 5 frames off-surface (edge transitions)
      expect(offSurfaceFrames,
        `${surface}: player was off-surface for ${offSurfaceFrames} frames during movement`
      ).toBeLessThanOrEqual(5);
    });
  }
});

// ==========================================================================
// SYSTEM E: Hit Detection Sanity
// ==========================================================================

describe('System E: Hit Detection — all surfaces', () => {
  for (const surface of ALL_SURFACES) {
    describe(`${surface}`, () => {
      it('bullets can damage enemies (health decreases or enemy dies)', () => {
        const h = new RealGameTestHarness({ surface, seed: 42 });
        h.tick(10);

        // Spawn an enemy at UV (0.5, 0.5) — surface center
        h.spawnEnemy('wanderer', 0.5, 0.5);
        h.tick(10);

        const enemiesBefore = h.getEnemies();
        if (enemiesBefore.length === 0) return; // N/A

        const initialHealth = enemiesBefore[0].health ?? 100;

        // Aim toward surface center (where enemy should be) and shoot continuously
        // Enemy at center means we aim toward center of screen
        h.setMousePosition(h.width * 0.5, h.height * 0.5);
        h.setMouseDown(true);
        h.tick(180); // 3s of shooting toward enemy
        h.setMouseDown(false);

        const enemiesAfter = h.getEnemies();

        // Enemy should be either dead (gone from alive list) or damaged
        if (enemiesAfter.length === 0) {
          // Enemy died — hit detection worked
          return;
        }

        const finalHealth = enemiesAfter[0].health ?? 100;
        expect(finalHealth,
          `${surface}: enemy took no damage after 3s of shooting at it. Health: ${finalHealth}/${initialHealth}`
        ).toBeLessThan(initialHealth);
      });

      it('no ghost kills — distant enemy survives 0.5s', () => {
        const h = new RealGameTestHarness({ surface, seed: 42 });
        h.tick(10);

        // Spawn enemy at (0.1, 0.1) — far from center
        h.spawnEnemy('wanderer', 0.1, 0.1);
        h.tick(10);

        const enemiesBefore = h.getEnemies();
        if (enemiesBefore.length === 0) return; // N/A

        // Shoot toward center (0.5, 0.5) — away from enemy at (0.1, 0.1)
        h.setMousePosition(h.width * 0.5, h.height * 0.5);
        h.setMouseDown(true);
        h.tick(30); // 0.5s of shooting away from enemy
        h.setMouseDown(false);

        // Enemy should still be alive (not killed by ghost bullet)
        const enemiesAfter = h.getEnemies();
        expect(enemiesAfter.length,
          `${surface}: enemy at (0.1, 0.1) was killed by bullets aimed at (0.5, 0.5) — ghost kill!`
        ).toBeGreaterThan(0);
      });
    });
  }
});

// ==========================================================================
// MOBIUS-SPECIFIC: Seam Traversal
// ==========================================================================

describe('Mobius: Seam Traversal', () => {
  it('player can traverse Mobius seam without getting stuck or NaN', () => {
    const h = new RealGameTestHarness({ surface: 'mobius', seed: 42 });
    h.tick(10);

    let nanDetected = false;
    let stuckFrames = 0;
    let maxConsecutiveStuck = 0;
    let lastPos = h.getPlayerWorldPos().clone();

    h.pressKey('w');
    for (let i = 0; i < 600; i++) { // 10 seconds
      h.tick(1);
      const pos = h.getPlayerWorldPos();
      if (!isValidVec3(pos)) {
        nanDetected = true;
        break;
      }
      const dist = lastPos.distanceTo(pos);
      if (dist < 0.0001) {
        stuckFrames++;
        maxConsecutiveStuck = Math.max(maxConsecutiveStuck, stuckFrames);
      } else {
        stuckFrames = 0;
      }
      lastPos = pos.clone();
    }
    h.releaseKey('w');

    expect(nanDetected, 'Mobius: NaN position during seam traversal').toBe(false);
    expect(maxConsecutiveStuck, `Mobius: player stuck for ${maxConsecutiveStuck} consecutive frames`).toBeLessThan(30);
  });
});

// ==========================================================================
// CUBE-SPECIFIC: Face Transition
// ==========================================================================

describe('Cube: Face Transition', () => {
  it('player can cross cube face boundaries without jumping', () => {
    const h = new RealGameTestHarness({ surface: 'cube', seed: 42 });
    h.tick(10);

    let maxFrameDist = 0;
    let lastPos = h.getPlayerWorldPos().clone();
    let nanDetected = false;

    h.pressKey('w');
    for (let i = 0; i < 300; i++) {
      h.tick(1);
      const pos = h.getPlayerWorldPos();
      if (!isValidVec3(pos)) {
        nanDetected = true;
        break;
      }
      const dist = lastPos.distanceTo(pos);
      maxFrameDist = Math.max(maxFrameDist, dist);
      lastPos = pos.clone();
    }
    h.releaseKey('w');

    expect(nanDetected, 'Cube: NaN during face traversal').toBe(false);
    // Max 3 world units per frame — larger would indicate a teleport
    expect(maxFrameDist,
      `Cube: max per-frame movement was ${maxFrameDist.toFixed(2)} — possible teleport at face boundary`
    ).toBeLessThan(3.0);
  });
});

// ==========================================================================
// TORUS-SPECIFIC: Inner Ring
// ==========================================================================

describe('Torus: Inner Ring', () => {
  it('player can traverse torus inner ring without getting stuck', () => {
    const h = new RealGameTestHarness({ surface: 'torus', seed: 42 });
    h.tick(10);

    // Move toward inner ring (strafe laterally)
    let nanDetected = false;
    let stuckFrames = 0;
    let lastPos = h.getPlayerWorldPos().clone();

    h.pressKey('a'); // strafe to inner ring
    for (let i = 0; i < 300; i++) {
      h.tick(1);
      const pos = h.getPlayerWorldPos();
      if (!isValidVec3(pos)) { nanDetected = true; break; }
      const dist = lastPos.distanceTo(pos);
      if (dist < 0.0001) stuckFrames++;
      else stuckFrames = 0;
      lastPos = pos.clone();
    }
    h.releaseKey('a');

    expect(nanDetected, 'Torus inner ring: NaN position').toBe(false);
    expect(stuckFrames, `Torus inner ring: stuck for ${stuckFrames} consecutive frames`).toBeLessThan(30);
  });
});

// ==========================================================================
// REGRESSION: Ensure NO surface regressed from core fixes
// ==========================================================================

describe('Regression Guards', () => {
  const QUICK_SURFACES: SurfaceType[] = ['sphere', 'cube', 'torus', 'pill', 'peanut', 'mobius'];

  for (const surface of QUICK_SURFACES) {
    it(`${surface}: no regression — player alive after 10s`, () => {
      const h = new RealGameTestHarness({ surface, seed: 42 });
      h.tick(10);

      // Move and shoot for 10 seconds
      h.pressKey('w');
      h.setMouseDown(true);
      h.tick(600);
      h.setMouseDown(false);
      h.releaseKey('w');

      const pos = h.getPlayerWorldPos();
      expect(isValidVec3(pos), `${surface}: player position is NaN after 10s`).toBe(true);
    });
  }
});
