/**
 * Surface Coverage — Phase 1: Smooth Surfaces (sphere, sphere-tunnel, capsule, pill, peanut)
 *
 * Tests movement grid-walk AND hit detection for the 5 smooth/rotationally-symmetric surfaces.
 * Uses MPRealGameTestHarness (tests the MP server code path algorithms).
 *
 * VERIFICATION LEVEL: Level 3 (programmatic — MP surface geometry code path)
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

import { MPRealGameTestHarness, ENEMY_HIT_WORLD, BULLET_HIT_WORLD } from './MPRealGameTestHarness';
import { SurfaceType } from '../surfaces/SurfaceFactory';
import { MapSize } from '../core/MapSize';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const GRID_U = [0.1, 0.35, 0.65, 0.9];
const GRID_V_SMOOTH = [0.1, 0.35, 0.65, 0.9];   // sphere, sphere-tunnel — poles degenerate but rare
const GRID_V_CAPPED = [0.05, 0.35, 0.65, 0.95]; // pill, capsule, peanut — skip pole singularities

// Cardinal UV directions: +U, -U, +V, -V
const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 5 test positions spread across the surface
const HIT_TEST_UV: Array<[number, number]> = [
  [0.5, 0.5], [0.2, 0.35], [0.7, 0.35], [0.25, 0.65], [0.75, 0.65],
];

// Far-away reference point (opposite side of surface from center):
// (0.5, 0.5) vs (0.0, 0.5) gives >10 wu on all smooth surfaces — well beyond ENEMY_HIT_WORLD (0.5)
const FAR_U = 0.0, FAR_V = 0.5;

// ---------------------------------------------------------------------------
// Movement grid-walk tests (per surface)
// ---------------------------------------------------------------------------

function testMovementGridWalk(surface: SurfaceType, gridV: number[]): void {
  describe(`${surface} — movement grid-walk`, () => {
    it('4×4 grid: no stuck positions (all non-degenerate positions allow movement)', () => {
      const h = new MPRealGameTestHarness({ surface, mapSize: MapSize.MEDIUM });
      const stuckPositions: string[] = [];

      for (const u of GRID_U) {
        for (const v of gridV) {
          h.placePlayerAt(u, v);
          let movedInAnyDir = false;

          for (const [dx, dy] of DIRS) {
            h.placePlayerAt(u, v); // reset before each direction
            let prevPos = h.playerState.worldPos.clone();
            let dirMoved = false;

            for (let step = 0; step < 5; step++) {
              h.movePlayerUV(dx, dy, 0.5);
              const newPos = h.playerState.worldPos;
              if (newPos.distanceTo(prevPos) > 0.001) {
                dirMoved = true;
              }
              prevPos = newPos.clone();
            }

            if (dirMoved) {
              movedInAnyDir = true;
              break;
            }
          }

          if (!movedInAnyDir) {
            stuckPositions.push(`u=${u.toFixed(2)},v=${v.toFixed(2)}`);
          }
        }
      }

      expect(stuckPositions, `Player stuck at: ${stuckPositions.join(', ')}`).toHaveLength(0);
    });

    it('seam (u≈0): no teleportation across boundary (max step < 2 wu)', () => {
      const h = new MPRealGameTestHarness({ surface, mapSize: MapSize.MEDIUM });
      const midV = gridV[Math.floor(gridV.length / 2)];
      h.placePlayerAt(0.02, midV); // near u=0 seam

      let prevPos = h.playerState.worldPos.clone();
      for (let step = 0; step < 10; step++) {
        h.movePlayerUV(1, 0, 0.5);
        const newPos = h.playerState.worldPos;
        const stepDist = newPos.distanceTo(prevPos);
        expect(stepDist, `Teleport at step ${step}: ${stepDist.toFixed(3)} wu`).toBeLessThan(2.0);
        prevPos = newPos.clone();
      }
    });

    it('player stays on surface after movement (dist from mesh < 0.5 wu)', () => {
      const h = new MPRealGameTestHarness({ surface, mapSize: MapSize.MEDIUM });
      h.placePlayerAt(0.5, gridV[1]);

      for (let i = 0; i < 5; i++) {
        h.movePlayerUV(1, 0, 0.5);
      }

      const worldPos = h.playerState.worldPos;
      const closest = h.meshSurface.closestPointOnSurface(worldPos);
      expect(closest).not.toBeNull();
      if (closest) {
        expect(worldPos.distanceTo(closest.point)).toBeLessThan(0.5);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Hit detection tests (per surface)
// ---------------------------------------------------------------------------

function testHitDetection(surface: SurfaceType, gridV: number[]): void {
  describe(`${surface} — hit detection`, () => {
    it('same UV → distance 0 and hit registered (all 5 test positions)', () => {
      const h = new MPRealGameTestHarness({ surface, mapSize: MapSize.MEDIUM });
      for (const [u, v] of HIT_TEST_UV) {
        const result = h.checkHit(u, v, u, v);
        expect(result.worldDist, `Same-point dist at (${u},${v})`).toBeCloseTo(0, 4);
        expect(result.hit, `Same-point hit at (${u},${v})`).toBe(true);
      }
    });

    it('far UV (opposite side) → no hit', () => {
      const h = new MPRealGameTestHarness({ surface, mapSize: MapSize.MEDIUM });
      const result = h.checkHit(0.5, 0.5, FAR_U, FAR_V);
      expect(result.hit).toBe(false);
      expect(result.worldDist).toBeGreaterThan(ENEMY_HIT_WORLD);
    });

    it('distance symmetry: worldDist(A,B) ≈ worldDist(B,A)', () => {
      const h = new MPRealGameTestHarness({ surface, mapSize: MapSize.MEDIUM });
      for (const [u, v] of HIT_TEST_UV) {
        const u2 = (u + 0.2) % 1.0;
        const v2 = Math.max(gridV[0], Math.min(gridV[gridV.length - 1], v + 0.1));
        const d1 = h.worldDist(u, v, u2, v2);
        const d2 = h.worldDist(u2, v2, u, v);
        expect(Math.abs(d1 - d2), `Symmetry at (${u},${v})↔(${u2},${v2})`).toBeLessThan(0.001);
      }
    });

    it('distance monotone: closer UV → smaller worldDist', () => {
      const h = new MPRealGameTestHarness({ surface, mapSize: MapSize.MEDIUM });
      const midV = gridV[Math.floor(gridV.length / 2)];
      const dNear = h.worldDist(0.5, midV, 0.52, midV);
      const dFar  = h.worldDist(0.5, midV, 0.7,  midV);
      expect(dNear).toBeLessThan(dFar);
    });

    it('bullet threshold: same-point dist < BULLET_HIT_WORLD', () => {
      const h = new MPRealGameTestHarness({ surface, mapSize: MapSize.MEDIUM });
      expect(h.worldDist(0.5, 0.5, 0.5, 0.5)).toBeLessThan(BULLET_HIT_WORLD);
    });
  });
}

// ---------------------------------------------------------------------------
// Register all 5 smooth surfaces (10 describe blocks total)
// ---------------------------------------------------------------------------

testMovementGridWalk('sphere',        GRID_V_SMOOTH);
testHitDetection(   'sphere',        GRID_V_SMOOTH);

testMovementGridWalk('sphere-tunnel', GRID_V_SMOOTH);
testHitDetection(   'sphere-tunnel', GRID_V_SMOOTH);

testMovementGridWalk('capsule',       GRID_V_CAPPED);
testHitDetection(   'capsule',       GRID_V_CAPPED);

testMovementGridWalk('pill',          GRID_V_CAPPED);
testHitDetection(   'pill',          GRID_V_CAPPED);

testMovementGridWalk('peanut',        GRID_V_CAPPED);
testHitDetection(   'peanut',        GRID_V_CAPPED);
