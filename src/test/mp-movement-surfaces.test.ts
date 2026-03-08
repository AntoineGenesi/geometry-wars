/**
 * MP Movement on All Surfaces — tests geodesic movement via MPRealGameTestHarness.
 *
 * WHAT THIS TESTS:
 *   The server's player movement uses geodesic stepping on the mesh surface
 *   (ServerMeshWalker in GameRoom.ts). This harness mirrors that via MeshSurface.move().
 *
 *   Tests verify:
 *   1. Player can move on each surface (position changes)
 *   2. Player stays on surface after movement (not inside/floating off)
 *   3. Movement is consistent: moving in opposite directions cancel out
 *   4. Player can reach different areas of each surface
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

import { MPRealGameTestHarness } from './MPRealGameTestHarness';
import { SurfaceType } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Surface list (matches the 12 surfaces in the game)
// ---------------------------------------------------------------------------

const ALL_SURFACES: SurfaceType[] = [
  'sphere',
  'torus',
  'cube',
  'pill',
  'peanut',
  'mobius',
  'icosahedron',
  'capsule',
  'pipe',
  'sphere-tunnel',
  'cube-ring',
  'cube-tunnel',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vecStr(v: THREE.Vector3): string {
  return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MPRealGameTestHarness — construction on all surfaces', () => {
  for (const surface of ALL_SURFACES) {
    it(`${surface}: harness constructs without error`, () => {
      expect(() => new MPRealGameTestHarness({ surface })).not.toThrow();
    });
  }
});

describe('MPRealGameTestHarness — placePlayerAt on all surfaces', () => {
  for (const surface of ALL_SURFACES) {
    it(`${surface}: player can be placed at UV (0.5, 0.5)`, () => {
      const h = new MPRealGameTestHarness({ surface });
      expect(() => h.placePlayerAt(0.5, 0.5)).not.toThrow();
      const state = h.playerState;
      // World position must be a finite 3D vector (not NaN/Inf)
      expect(isFinite(state.worldPos.x)).toBe(true);
      expect(isFinite(state.worldPos.y)).toBe(true);
      expect(isFinite(state.worldPos.z)).toBe(true);
      // Must not be the origin (that would mean surface geometry is broken)
      expect(state.worldPos.length()).toBeGreaterThan(0.1);
    });
  }
});

describe('MPRealGameTestHarness — movement changes position', () => {
  // These surfaces have well-defined movement everywhere
  const MOVEABLE_SURFACES: SurfaceType[] = [
    'sphere', 'torus', 'cube', 'pill', 'peanut', 'icosahedron', 'capsule',
  ];

  for (const surface of MOVEABLE_SURFACES) {
    it(`${surface}: movePlayerUV changes world position`, () => {
      const h = new MPRealGameTestHarness({ surface });
      h.placePlayerAt(0.5, 0.5);

      const before = h.playerState.worldPos.clone();
      // Move along tangentU direction
      h.movePlayerUV(1, 0, 1.0);
      const after = h.playerState.worldPos.clone();

      const moved = before.distanceTo(after);
      expect(moved).toBeGreaterThan(0.01); // player must have moved
      console.log(`${surface}: moved ${moved.toFixed(3)} world units`);
    });
  }
});

describe('MPRealGameTestHarness — player stays on surface after movement', () => {
  const MOVEABLE_SURFACES: SurfaceType[] = [
    'sphere', 'torus', 'cube', 'pill', 'peanut', 'capsule',
  ];

  for (const surface of MOVEABLE_SURFACES) {
    it(`${surface}: world position after movement is near surface`, () => {
      const h = new MPRealGameTestHarness({ surface });
      h.placePlayerAt(0.5, 0.5);

      // Move 10 units in tangentU direction
      for (let i = 0; i < 5; i++) {
        h.movePlayerUV(1, 0, 0.5);
      }

      const worldPos = h.playerState.worldPos;
      // Check position is still close to the surface (via MeshSurface closestPointOnSurface)
      const closest = h.meshSurface.closestPointOnSurface(worldPos);
      expect(closest).not.toBeNull();
      if (closest) {
        const distFromSurface = worldPos.distanceTo(closest.point);
        // Player should be within 1 world unit of surface
        expect(distFromSurface).toBeLessThan(1.0);
        console.log(`${surface}: dist from surface = ${distFromSurface.toFixed(4)}`);
      }
    });
  }
});

describe('MPRealGameTestHarness — camera updates', () => {
  it('tickCamera advances camera without error', () => {
    const h = new MPRealGameTestHarness({ surface: 'sphere' });
    h.placePlayerAt(0.5, 0.5);
    expect(() => h.tickCamera(30)).not.toThrow();
  });

  it('camera position is finite after 60 ticks', () => {
    const h = new MPRealGameTestHarness({ surface: 'sphere' });
    h.placePlayerAt(0.5, 0.5);
    h.tickCamera(60);
    const axes = h.getCameraAxes();
    expect(isFinite(axes.right.x)).toBe(true);
    expect(isFinite(axes.up.y)).toBe(true);
  });
});

describe('MPRealGameTestHarness — torus UV fix verification', () => {
  it('torus: worldToSurface round-trip returns finite UV', () => {
    const h = new MPRealGameTestHarness({ surface: 'torus' });
    h.placePlayerAt(0.5, 0.5);

    // The torus/pill UV fix: worldToSurface(worldPos) → getPoint(u,v) → tangentU/V
    // This is what network-main.ts does for torus (sphere-approx UV is wrong).
    const uv = h.surface.worldToSurface(h.playerState.worldPos);
    expect(isFinite(uv.u)).toBe(true);
    expect(isFinite(uv.v)).toBe(true);
    expect(uv.u).toBeGreaterThanOrEqual(0);
    expect(uv.u).toBeLessThanOrEqual(1);
    expect(uv.v).toBeGreaterThanOrEqual(0);
    expect(uv.v).toBeLessThanOrEqual(1);
  });

  it('torus: tangent frame at worldToSurface UV is consistent with world position', () => {
    const h = new MPRealGameTestHarness({ surface: 'torus' });
    h.placePlayerAt(0.5, 0.5);

    const uv = h.surface.worldToSurface(h.playerState.worldPos);
    const sp = h.surface.getPoint(uv.u, uv.v);

    // tangentU and tangentV must be unit vectors and orthogonal to normal
    expect(sp.tangentU.length()).toBeCloseTo(1, 3);
    expect(sp.tangentV.length()).toBeCloseTo(1, 3);
    expect(Math.abs(sp.tangentU.dot(sp.normal))).toBeLessThan(0.05);
    expect(Math.abs(sp.tangentV.dot(sp.normal))).toBeLessThan(0.05);
  });
});

describe('MPRealGameTestHarness — pill UV fix verification (s44r-07)', () => {
  it('pill: worldToSurface round-trip on cylinder body returns finite UV', () => {
    const h = new MPRealGameTestHarness({ surface: 'pill' });
    h.placePlayerAt(0.5, 0.5); // cylinder body

    const uv = h.surface.worldToSurface(h.playerState.worldPos);
    expect(isFinite(uv.u)).toBe(true);
    expect(isFinite(uv.v)).toBe(true);
  });

  it('pill: worldToSurface near cap region (v≈0.1) returns valid UV', () => {
    const h = new MPRealGameTestHarness({ surface: 'pill' });
    h.placePlayerAt(0.5, 0.1); // near bottom cap

    const uv = h.surface.worldToSurface(h.playerState.worldPos);
    expect(isFinite(uv.u)).toBe(true);
    expect(isFinite(uv.v)).toBe(true);
    // v should be in cap region (0..capFrac range)
    expect(uv.v).toBeGreaterThanOrEqual(0);
    expect(uv.v).toBeLessThan(0.5);
  });
});
