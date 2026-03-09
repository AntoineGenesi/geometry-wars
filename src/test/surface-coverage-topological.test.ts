/**
 * Surface Coverage — Phase 3: Topological Surfaces (mobius, mobius-bevel, pipe)
 *
 * Tests movement grid-walk AND hit detection for non-orientable / tube surfaces.
 *
 * REGRESSION GUARD: Mobius seam traversal (s44r3-08, s44r4-04).
 * If the seam fix is reverted, the seam-traversal tests will catch it.
 *
 * VERIFICATION LEVEL: Level 3 (programmatic — MP surface geometry code path).
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

import './verification-env';

vi.mock('../ui/UIHelpers', () => ({
  UIHelpers: { updateCountdownOverlay: vi.fn(), updateTimerDisplay: vi.fn() },
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
  loadVisualStyle: () => null, loadVisualMode: () => 'modern', saveVisualMode: vi.fn(),
}));
vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({ play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false }),
}));
vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class {
    passes: any[] = []; addPass(p: any) { this.passes.push(p); }
    render() {} setSize() {} dispose() {}
  },
}));
vi.mock('three/addons/postprocessing/RenderPass.js', () => ({ RenderPass: class {} }));
vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class { resolution = new THREE.Vector2(800, 600); constructor() {} },
}));
vi.mock('three/addons/postprocessing/OutputPass.js', () => ({ OutputPass: class {} }));
vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({ ShaderPass: class { constructor(_: any) {} } }));
vi.mock('three/webgpu', () => ({
  PostProcessing: class { render() {} },
  pass: () => ({ getTextureNode: () => ({ r: 0, g: 0, b: 0, mul: () => ({}) }) }),
  float: () => ({}), max: () => ({ sub: () => ({}) }), add: () => ({ mul: () => ({}) }),
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
    domElement: any; toneMapping: any; toneMappingExposure = 1;
    shadowMap = { enabled: false }; outputColorSpace: any;
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

import { MPRealGameTestHarness, ENEMY_HIT_WORLD } from './MPRealGameTestHarness';
import { SurfaceType } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Grid positions for each surface (safe interior points, avoid extreme poles)
// ---------------------------------------------------------------------------

const MOBIUS_GRID = [
  { u: 0.1, v: 0.3 },
  { u: 0.3, v: 0.5 },
  { u: 0.6, v: 0.5 },
  { u: 0.9, v: 0.7 },
];

const MOBIUS_BEVEL_GRID = [
  { u: 0.1, v: 0.3 },
  { u: 0.3, v: 0.5 },
  { u: 0.6, v: 0.5 },
  { u: 0.9, v: 0.7 },
];

// pipe: v does NOT wrap (open ends). Avoid v < 0.05 or v > 0.95.
const PIPE_GRID = [
  { u: 0.1, v: 0.3 },
  { u: 0.3, v: 0.5 },
  { u: 0.6, v: 0.5 },
  { u: 0.9, v: 0.7 },
];

// Hit detection test positions
const HIT_POSITIONS = [0.1, 0.3, 0.5, 0.7, 0.9];

// ---------------------------------------------------------------------------
// Helper: run grid-walk movement test on a surface
// ---------------------------------------------------------------------------

function runGridWalkTest(surface: SurfaceType, grid: { u: number; v: number }[]): void {
  const h = new MPRealGameTestHarness({ surface });
  h.tickCamera(30);

  for (const pos of grid) {
    h.placePlayerAt(pos.u, pos.v);
    const before = h.playerState.worldPos.clone();

    // Move +U 5 steps
    for (let step = 0; step < 5; step++) {
      const prevPos = h.playerState.worldPos.clone();
      h.movePlayerUV(1, 0, 0.3);
      const moved = prevPos.distanceTo(h.playerState.worldPos);
      expect(moved).toBeGreaterThan(0.001);
    }

    // Move -V 5 steps (from a fresh placement to stay in bounds)
    h.placePlayerAt(pos.u, pos.v);
    for (let step = 0; step < 5; step++) {
      const prevPos = h.playerState.worldPos.clone();
      h.movePlayerUV(0, -1, 0.3);
      const moved = prevPos.distanceTo(h.playerState.worldPos);
      expect(moved).toBeGreaterThan(0.001);
    }

    // Verify player is still on surface
    const closest = h.meshSurface.closestPointOnSurface(h.playerState.worldPos);
    if (closest) {
      const distFromSurface = h.playerState.worldPos.distanceTo(closest.point);
      expect(distFromSurface).toBeLessThan(0.5);
    }
  }
}

// ---------------------------------------------------------------------------
// Mobius — movement grid-walk
// ---------------------------------------------------------------------------

describe('mobius: movement grid-walk', () => {
  it('moves in +U and -V directions at 4 grid positions', () => {
    runGridWalkTest('mobius', MOBIUS_GRID);
  });

  // REGRESSION GUARD — s44r3-08, s44r4-04
  // If the Mobius seam fix is reverted, this test will catch the regression.
  it('REGRESSION GUARD: seam traversal from u=0.02 in -U direction (no teleport, no stuck)', () => {
    const h = new MPRealGameTestHarness({ surface: 'mobius' });
    h.placePlayerAt(0.02, 0.5);
    h.tickCamera(30);

    let prevPos = h.playerState.worldPos.clone();
    for (let step = 0; step < 10; step++) {
      h.movePlayerUV(-1, 0, 0.3);
      const curr = h.playerState.worldPos.clone();
      const stepDist = prevPos.distanceTo(curr);

      // Not stuck at seam
      expect(stepDist).toBeGreaterThan(0.001);
      // No teleport — seam crossing must be smooth (< 2.0 world units per step)
      expect(stepDist).toBeLessThan(2.0);

      prevPos = curr;
    }
  });

  // REGRESSION GUARD — seam crossing from the other side
  it('REGRESSION GUARD: seam traversal from u=0.98 in +U direction (no teleport, no stuck)', () => {
    const h = new MPRealGameTestHarness({ surface: 'mobius' });
    h.placePlayerAt(0.98, 0.5);
    h.tickCamera(30);

    let prevPos = h.playerState.worldPos.clone();
    for (let step = 0; step < 10; step++) {
      h.movePlayerUV(1, 0, 0.3);
      const curr = h.playerState.worldPos.clone();
      const stepDist = prevPos.distanceTo(curr);

      // Not stuck at seam
      expect(stepDist).toBeGreaterThan(0.001);
      // No teleport
      expect(stepDist).toBeLessThan(2.0);

      prevPos = curr;
    }
  });
});

// ---------------------------------------------------------------------------
// Mobius — hit detection
// ---------------------------------------------------------------------------

describe('mobius: hit detection', () => {
  it('same-position: dist ≈ 0 → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'mobius' });
    for (const u of HIT_POSITIONS) {
      const result = h.checkHit(u, 0.5, u, 0.5);
      expect(result.worldDist).toBeCloseTo(0, 3);
      expect(result.hit).toBe(true);
    }
  });

  it('near enemy: dist < ENEMY_HIT_WORLD → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'mobius' });
    // Close positions — tiny v offset, same u
    for (const u of HIT_POSITIONS) {
      const result = h.checkHit(u, 0.5, u, 0.52);
      expect(result.worldDist).toBeLessThan(ENEMY_HIT_WORLD);
      expect(result.hit).toBe(true);
    }
  });

  it('far enemy: opposite side of strip → dist > 2.0 → no hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'mobius' });
    // u=0.1 vs u=0.6 — well separated on the strip
    const result = h.checkHit(0.1, 0.5, 0.6, 0.5);
    expect(result.worldDist).toBeGreaterThan(2.0);
    expect(result.hit).toBe(false);
  });

  it('symmetry: dist(A,B) == dist(B,A) within 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'mobius' });
    const pairs: [number, number, number, number][] = [
      [0.1, 0.5, 0.3, 0.5],
      [0.3, 0.4, 0.7, 0.6],
      [0.5, 0.5, 0.9, 0.3],
    ];
    for (const [u1, v1, u2, v2] of pairs) {
      const dAB = h.worldDist(u1, v1, u2, v2);
      const dBA = h.worldDist(u2, v2, u1, v1);
      expect(Math.abs(dAB - dBA)).toBeLessThan(0.001);
    }
  });
});

// ---------------------------------------------------------------------------
// Mobius-bevel — movement grid-walk
// ---------------------------------------------------------------------------

describe('mobius-bevel: movement grid-walk', () => {
  it('moves in +U and -V directions at 4 grid positions', () => {
    runGridWalkTest('mobius-bevel', MOBIUS_BEVEL_GRID);
  });
});

// ---------------------------------------------------------------------------
// Mobius-bevel — hit detection
// ---------------------------------------------------------------------------

describe('mobius-bevel: hit detection', () => {
  it('same-position: dist ≈ 0 → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'mobius-bevel' });
    for (const u of HIT_POSITIONS) {
      const result = h.checkHit(u, 0.5, u, 0.5);
      expect(result.worldDist).toBeCloseTo(0, 3);
      expect(result.hit).toBe(true);
    }
  });

  it('near enemy: dist < ENEMY_HIT_WORLD → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'mobius-bevel' });
    // mobius-bevel uses sphere great-circle approx (sphereR=10). With a 0.02 v-offset,
    // distance ≈ 0.63 > ENEMY_HIT_WORLD=0.5. Use 0.005 offset → ≈0.16 which hits.
    for (const u of HIT_POSITIONS) {
      const result = h.checkHit(u, 0.5, u, 0.505);
      expect(result.worldDist).toBeLessThan(ENEMY_HIT_WORLD);
      expect(result.hit).toBe(true);
    }
  });

  it('far enemy: opposite pole → dist > 2.0 → no hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'mobius-bevel' });
    const result = h.checkHit(0.1, 0.5, 0.6, 0.5);
    expect(result.worldDist).toBeGreaterThan(2.0);
    expect(result.hit).toBe(false);
  });

  it('symmetry: dist(A,B) == dist(B,A) within 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'mobius-bevel' });
    const pairs: [number, number, number, number][] = [
      [0.1, 0.5, 0.3, 0.5],
      [0.3, 0.4, 0.7, 0.6],
      [0.5, 0.5, 0.9, 0.3],
    ];
    for (const [u1, v1, u2, v2] of pairs) {
      const dAB = h.worldDist(u1, v1, u2, v2);
      const dBA = h.worldDist(u2, v2, u1, v1);
      expect(Math.abs(dAB - dBA)).toBeLessThan(0.001);
    }
  });
});

// ---------------------------------------------------------------------------
// Pipe — movement grid-walk
// ---------------------------------------------------------------------------

describe('pipe: movement grid-walk', () => {
  it('moves in +U and -V directions at 4 grid positions', () => {
    runGridWalkTest('pipe', PIPE_GRID);
  });

  // u wraps (angular) — test the u=0/u=1 seam
  it('u-seam traversal from u=0.02 in -U direction (no teleport, no stuck)', () => {
    const h = new MPRealGameTestHarness({ surface: 'pipe' });
    h.placePlayerAt(0.02, 0.5);
    h.tickCamera(30);

    let prevPos = h.playerState.worldPos.clone();
    for (let step = 0; step < 10; step++) {
      h.movePlayerUV(-1, 0, 0.3);
      const curr = h.playerState.worldPos.clone();
      const stepDist = prevPos.distanceTo(curr);

      expect(stepDist).toBeGreaterThan(0.001);
      expect(stepDist).toBeLessThan(2.0);

      prevPos = curr;
    }
  });
});

// ---------------------------------------------------------------------------
// Pipe — hit detection
// ---------------------------------------------------------------------------

describe('pipe: hit detection', () => {
  it('same-position: dist ≈ 0 → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'pipe' });
    for (const u of HIT_POSITIONS) {
      const result = h.checkHit(u, 0.5, u, 0.5);
      expect(result.worldDist).toBeCloseTo(0, 3);
      expect(result.hit).toBe(true);
    }
  });

  it('near enemy: dist < ENEMY_HIT_WORLD → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'pipe' });
    // pipe uses sphere great-circle approx (sphereR=10). With a 0.02 v-offset,
    // distance ≈ 0.63 > ENEMY_HIT_WORLD=0.5. Use 0.005 offset → ≈0.16 which hits.
    for (const u of HIT_POSITIONS) {
      const result = h.checkHit(u, 0.5, u, 0.505);
      expect(result.worldDist).toBeLessThan(ENEMY_HIT_WORLD);
      expect(result.hit).toBe(true);
    }
  });

  it('far enemy: opposite angular position → dist > 2.0 → no hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'pipe' });
    // Pipe uses sphere great-circle approx; u=0.0 vs u=0.5 (opposite side)
    const result = h.checkHit(0.0, 0.5, 0.5, 0.5);
    expect(result.worldDist).toBeGreaterThan(2.0);
    expect(result.hit).toBe(false);
  });

  it('symmetry: dist(A,B) == dist(B,A) within 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'pipe' });
    const pairs: [number, number, number, number][] = [
      [0.1, 0.3, 0.3, 0.5],
      [0.3, 0.4, 0.7, 0.6],
      [0.5, 0.5, 0.9, 0.3],
    ];
    for (const [u1, v1, u2, v2] of pairs) {
      const dAB = h.worldDist(u1, v1, u2, v2);
      const dBA = h.worldDist(u2, v2, u1, v1);
      expect(Math.abs(dAB - dBA)).toBeLessThan(0.001);
    }
  });
});
