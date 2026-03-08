/**
 * Surface Coverage — Phase 2: Seamed Surfaces
 *
 * Tests torus, cube, cube-ring, cube-tunnel, icosahedron.
 * Focus: UV seam traversal and hit detection asymmetries.
 *
 * 10 describe blocks: 5 surfaces × 2 (movement + hit detection).
 *
 * VERIFICATION LEVEL: Level 3 (programmatic — MP surface geometry code path).
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

import './verification-env';

// ---------- vi.mock boilerplate (copied from mp-movement-surfaces.test.ts) ----------
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
import { MapSize } from '../core/MapSize';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Move N steps in one UV direction, return per-step displacements. */
function collectStepDisplacements(
  h: MPRealGameTestHarness,
  moveX: number, moveY: number,
  steps: number,
  speedScale = 0.5,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const prev = h.playerState.worldPos.clone();
    h.movePlayerUV(moveX, moveY, speedScale);
    out.push(prev.distanceTo(h.playerState.worldPos));
  }
  return out;
}

/** 4 positions × 4 cardinal directions × 5 steps — all steps must displace > 0.001. */
function runMovementGridWalk(h: MPRealGameTestHarness, positions: [number, number][]): void {
  const dirs: [number, number, string][] = [
    [1, 0, '+U'], [-1, 0, '-U'], [0, 1, '+V'], [0, -1, '-V'],
  ];
  for (const [u, v] of positions) {
    h.placePlayerAt(u, v);
    h.tickCamera(30);
    for (const [mx, my, label] of dirs) {
      h.placePlayerAt(u, v);
      const disps = collectStepDisplacements(h, mx, my, 5);
      for (const d of disps) {
        expect(d, `${label} at (${u},${v})`).toBeGreaterThan(0.001);
      }
    }
  }
}

/** Assert player is within 0.5 world units of the mesh surface. */
function assertOnSurface(h: MPRealGameTestHarness, label: string): void {
  const closest = h.meshSurface.closestPointOnSurface(h.playerState.worldPos);
  expect(closest, `${label}: closestPoint null`).not.toBeNull();
  if (closest) {
    const dist = h.playerState.worldPos.distanceTo(closest.point);
    expect(dist, `${label}: dist from surface`).toBeLessThan(0.5);
  }
}

// ---------------------------------------------------------------------------
// TORUS — Movement
// ---------------------------------------------------------------------------

describe('surface-coverage-seamed: torus movement', () => {
  it('grid-walk: 4 positions × 4 cardinal directions × 5 steps → displacement > 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    runMovementGridWalk(h, [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75], [0.1, 0.9]]);
  });

  it('player stays on surface after 5 steps in +U', () => {
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.5, 0.5);
    for (let i = 0; i < 5; i++) h.movePlayerUV(1, 0, 0.5);
    assertOnSurface(h, 'torus +U');
  });

  it('u-seam traversal (u=0.02 → -U × 10 steps): no teleport > 2.0 world units', () => {
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.02, 0.5);
    const teleports: number[] = [];
    for (let i = 0; i < 10; i++) {
      const prev = h.playerState.worldPos.clone();
      h.movePlayerUV(-1, 0, 0.5);
      const d = prev.distanceTo(h.playerState.worldPos);
      if (d > 2.0) teleports.push(d);
    }
    expect(teleports.length, `u-seam teleports: ${teleports}`).toBe(0);
  });

  it('v-seam traversal (v=0.02 → -V × 10 steps): no teleport > 2.0 world units', () => {
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.5, 0.02);
    const teleports: number[] = [];
    for (let i = 0; i < 10; i++) {
      const prev = h.playerState.worldPos.clone();
      h.movePlayerUV(0, -1, 0.5);
      const d = prev.distanceTo(h.playerState.worldPos);
      if (d > 2.0) teleports.push(d);
    }
    expect(teleports.length, `v-seam teleports: ${teleports}`).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TORUS — Hit Detection
// ---------------------------------------------------------------------------

describe('surface-coverage-seamed: torus hit detection', () => {
  // Torus chord params (MEDIUM): R=3.0, r=1.0 (from _torusChordDist formula).
  // Inner ring (v=0.5): effective radius R-r=2 → small chord for same UV delta.
  // Outer ring (v=0.0): effective radius R+r=4 → larger chord.
  // uvDelta=0.03 in u gives chord≈0.376 at inner, ≈0.752 at outer.
  // uvDelta=0.01 in u gives chord≈0.126 at inner, ≈0.251 at outer (both < 0.5).

  it('same-position → dist ≈ 0, hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.5, 0.5, 0.5, 0.5);
    expect(r.worldDist).toBeCloseTo(0, 3);
    expect(r.hit).toBe(true);
  });

  it('near-enemy (uvDelta=0.03 → chord≈0.376) → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.5, 0.5, 0.53, 0.5);
    expect(r.worldDist).toBeLessThan(ENEMY_HIT_WORLD);
    expect(r.hit).toBe(true);
  });

  it('far enemy (diametrically opposite) → dist > 2.0, no hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    // (0,0) → [4,0,0], (0.5,0.5) → [-2,0,0]; chord = 6.0
    const r = h.checkHit(0.0, 0.0, 0.5, 0.5);
    expect(r.worldDist).toBeGreaterThan(2.0);
    expect(r.hit).toBe(false);
  });

  it('symmetry: dist(A,B) == dist(B,A) within 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    const d1 = h.worldDist(0.3, 0.4, 0.7, 0.6);
    const d2 = h.worldDist(0.7, 0.6, 0.3, 0.4);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });

  it('inner-tube (v=0.5): near-hit at uvDelta=0.01 → dist < ENEMY_HIT_WORLD', () => {
    // Inner ring radius = R-r = 2; chord ≈ 0.126 for du=0.01
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    const d = h.worldDist(0.5, 0.5, 0.51, 0.5);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(ENEMY_HIT_WORLD);
  });

  it('outer-tube (v=0.0): near-hit at uvDelta=0.01 → dist < ENEMY_HIT_WORLD', () => {
    // Outer ring radius = R+r = 4; chord ≈ 0.251 for du=0.01
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    const d = h.worldDist(0.0, 0.0, 0.01, 0.0);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(ENEMY_HIT_WORLD);
  });

  it('outer-tube chord > inner-tube chord for same UV delta (asymmetry)', () => {
    // Outer ring has larger radius, so same UV delta → larger chord distance
    const h = new MPRealGameTestHarness({ surface: 'torus', mapSize: MapSize.MEDIUM });
    const innerDist = h.worldDist(0.5, 0.5, 0.51, 0.5); // inner ring (v=0.5)
    const outerDist = h.worldDist(0.0, 0.0, 0.01, 0.0);  // outer ring (v=0.0)
    expect(outerDist).toBeGreaterThan(innerDist);
  });
});

// ---------------------------------------------------------------------------
// CUBE — Movement
// ---------------------------------------------------------------------------

describe('surface-coverage-seamed: cube movement', () => {
  it('grid-walk: 4 positions × 4 cardinal directions × 5 steps → displacement > 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube', mapSize: MapSize.MEDIUM });
    runMovementGridWalk(h, [[0.2, 0.2], [0.5, 0.3], [0.7, 0.7], [0.3, 0.8]]);
  });

  it('player stays on surface after 5 steps in +U', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.5, 0.5);
    for (let i = 0; i < 5; i++) h.movePlayerUV(1, 0, 0.5);
    assertOnSurface(h, 'cube +U');
  });

  it('face-boundary crossing (u=0.49, +U × 10 steps): no position jump > 3.0 units', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.49, 0.5);
    const teleports: number[] = [];
    for (let i = 0; i < 10; i++) {
      const prev = h.playerState.worldPos.clone();
      h.movePlayerUV(1, 0, 0.5);
      const d = prev.distanceTo(h.playerState.worldPos);
      if (d > 3.0) teleports.push(d);
    }
    expect(teleports.length, `cube face-boundary teleports: ${teleports}`).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CUBE — Hit Detection
// ---------------------------------------------------------------------------

describe('surface-coverage-seamed: cube hit detection', () => {
  // Cube uses sphere great-circle approximation (sphereR=10 for MEDIUM).
  // At equator (v=0.5): dist ≈ sphereR × 2π × du.
  // uvDelta=0.007 → dist ≈ 0.44 < 0.5 for near-hit.
  // Use loose tolerances — not exact geometry.

  it('same-position → dist ≈ 0, hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.5, 0.5, 0.5, 0.5);
    expect(r.worldDist).toBeCloseTo(0, 3);
    expect(r.hit).toBe(true);
  });

  it('near-enemy (uvDelta=0.007 → dist≈0.44) → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.5, 0.5, 0.507, 0.5);
    expect(r.worldDist).toBeGreaterThan(0);
    expect(r.hit).toBe(true);
  });

  it('far enemy → dist > 2.0, no hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.1, 0.1, 0.9, 0.9);
    expect(r.worldDist).toBeGreaterThan(2.0);
    expect(r.hit).toBe(false);
  });

  it('symmetry: dist(A,B) == dist(B,A) within 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube', mapSize: MapSize.MEDIUM });
    const d1 = h.worldDist(0.3, 0.4, 0.7, 0.6);
    const d2 = h.worldDist(0.7, 0.6, 0.3, 0.4);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------
// CUBE-RING — Movement
// ---------------------------------------------------------------------------

describe('surface-coverage-seamed: cube-ring movement', () => {
  it('grid-walk: 4 positions × 4 cardinal directions × 5 steps → displacement > 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-ring', mapSize: MapSize.MEDIUM });
    runMovementGridWalk(h, [[0.25, 0.5], [0.5, 0.5], [0.75, 0.5], [0.1, 0.5]]);
  });

  it('player stays on surface after 5 steps in +U', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-ring', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.5, 0.5);
    for (let i = 0; i < 5; i++) h.movePlayerUV(1, 0, 0.5);
    assertOnSurface(h, 'cube-ring +U');
  });

  it('face-boundary crossing (u=0.49, +U × 10 steps): no teleport > 3.0 units', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-ring', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.49, 0.5);
    const teleports: number[] = [];
    for (let i = 0; i < 10; i++) {
      const prev = h.playerState.worldPos.clone();
      h.movePlayerUV(1, 0, 0.5);
      const d = prev.distanceTo(h.playerState.worldPos);
      if (d > 3.0) teleports.push(d);
    }
    expect(teleports.length, `cube-ring face-boundary teleports: ${teleports}`).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CUBE-RING — Hit Detection
// ---------------------------------------------------------------------------

describe('surface-coverage-seamed: cube-ring hit detection', () => {
  it('same-position → dist ≈ 0, hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-ring', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.5, 0.5, 0.5, 0.5);
    expect(r.worldDist).toBeCloseTo(0, 3);
    expect(r.hit).toBe(true);
  });

  it('near-enemy (uvDelta=0.007) → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-ring', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.5, 0.5, 0.507, 0.5);
    expect(r.worldDist).toBeGreaterThan(0);
    expect(r.hit).toBe(true);
  });

  it('far enemy → positive distance, no hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-ring', mapSize: MapSize.MEDIUM });
    // u=0.1 vs u=0.6 at equatorial v=0.5: sphere dist ≈ 10 × 2π × 0.5 = 31.4
    const r = h.checkHit(0.1, 0.5, 0.6, 0.5);
    expect(r.worldDist).toBeGreaterThan(0);
    expect(r.hit).toBe(false);
  });

  it('symmetry: dist(A,B) == dist(B,A) within 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-ring', mapSize: MapSize.MEDIUM });
    const d1 = h.worldDist(0.2, 0.5, 0.8, 0.5);
    const d2 = h.worldDist(0.8, 0.5, 0.2, 0.5);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------
// CUBE-TUNNEL — Movement
// ---------------------------------------------------------------------------

describe('surface-coverage-seamed: cube-tunnel movement', () => {
  it('grid-walk: 4 positions × 4 cardinal directions × 5 steps → displacement > 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-tunnel', mapSize: MapSize.MEDIUM });
    runMovementGridWalk(h, [[0.5, 0.25], [0.5, 0.5], [0.5, 0.75], [0.25, 0.5]]);
  });

  it('player stays on surface after 5 steps in +U', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-tunnel', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.5, 0.5);
    for (let i = 0; i < 5; i++) h.movePlayerUV(1, 0, 0.5);
    assertOnSurface(h, 'cube-tunnel +U');
  });

  it('interior tunnel region (u~0.5): 10 continuous steps — movement never stops', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-tunnel', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.5, 0.5);
    const disps = collectStepDisplacements(h, 1, 0, 10, 0.3);
    const stoppedAt = disps.findIndex(d => d <= 0.001);
    expect(stoppedAt, `movement stopped at step ${stoppedAt}: ${disps}`).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// CUBE-TUNNEL — Hit Detection
// ---------------------------------------------------------------------------

describe('surface-coverage-seamed: cube-tunnel hit detection', () => {
  it('same-position → dist ≈ 0, hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-tunnel', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.5, 0.5, 0.5, 0.5);
    expect(r.worldDist).toBeCloseTo(0, 3);
    expect(r.hit).toBe(true);
  });

  it('near-enemy (uvDelta=0.007) → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-tunnel', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.5, 0.5, 0.507, 0.5);
    expect(r.worldDist).toBeGreaterThan(0);
    expect(r.hit).toBe(true);
  });

  it('far enemy → dist > 2.0, no hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-tunnel', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.1, 0.1, 0.9, 0.9);
    expect(r.worldDist).toBeGreaterThan(2.0);
    expect(r.hit).toBe(false);
  });

  it('symmetry: dist(A,B) == dist(B,A) within 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube-tunnel', mapSize: MapSize.MEDIUM });
    const d1 = h.worldDist(0.3, 0.4, 0.7, 0.6);
    const d2 = h.worldDist(0.7, 0.6, 0.3, 0.4);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------
// ICOSAHEDRON — Movement
// ---------------------------------------------------------------------------

describe('surface-coverage-seamed: icosahedron movement', () => {
  it('grid-walk: 4 positions × 4 cardinal directions × 5 steps → displacement > 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'icosahedron', mapSize: MapSize.MEDIUM });
    runMovementGridWalk(h, [[0.15, 0.5], [0.35, 0.5], [0.65, 0.5], [0.85, 0.5]]);
  });

  it('player stays on surface after 5 steps in +U', () => {
    const h = new MPRealGameTestHarness({ surface: 'icosahedron', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.5, 0.5);
    for (let i = 0; i < 5; i++) h.movePlayerUV(1, 0, 0.5);
    assertOnSurface(h, 'icosahedron +U');
  });

  it('cross-face traversal (u=0.1 → +U × 15 steps): no teleport > 3.0 units', () => {
    const h = new MPRealGameTestHarness({ surface: 'icosahedron', mapSize: MapSize.MEDIUM });
    h.placePlayerAt(0.1, 0.5);
    const teleports: number[] = [];
    for (let i = 0; i < 15; i++) {
      const prev = h.playerState.worldPos.clone();
      h.movePlayerUV(1, 0, 0.5);
      const d = prev.distanceTo(h.playerState.worldPos);
      if (d > 3.0) teleports.push(d);
    }
    expect(teleports.length, `icosahedron cross-face teleports: ${teleports}`).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ICOSAHEDRON — Hit Detection
// ---------------------------------------------------------------------------

describe('surface-coverage-seamed: icosahedron hit detection', () => {
  it('same-position → dist ≈ 0, hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'icosahedron', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.5, 0.5, 0.5, 0.5);
    expect(r.worldDist).toBeCloseTo(0, 3);
    expect(r.hit).toBe(true);
  });

  it('near-enemy (uvDelta=0.007 → dist≈0.44) → hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'icosahedron', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.5, 0.5, 0.507, 0.5);
    expect(r.worldDist).toBeGreaterThan(0);
    expect(r.hit).toBe(true);
  });

  it('far enemy → dist > 2.0, no hit', () => {
    const h = new MPRealGameTestHarness({ surface: 'icosahedron', mapSize: MapSize.MEDIUM });
    const r = h.checkHit(0.1, 0.1, 0.9, 0.9);
    expect(r.worldDist).toBeGreaterThan(2.0);
    expect(r.hit).toBe(false);
  });

  it('symmetry: dist(A,B) == dist(B,A) within 0.001', () => {
    const h = new MPRealGameTestHarness({ surface: 'icosahedron', mapSize: MapSize.MEDIUM });
    const d1 = h.worldDist(0.3, 0.4, 0.7, 0.6);
    const d2 = h.worldDist(0.7, 0.6, 0.3, 0.4);
    expect(Math.abs(d1 - d2)).toBeLessThan(0.001);
  });
});
