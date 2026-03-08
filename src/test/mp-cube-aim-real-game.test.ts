/**
 * MP Cube Aim Test — validates s44r4-01 fix via MPRealGameTestHarness.
 *
 * REGRESSION HISTORY:
 *   s44r3-03: Cube aim broken in MP — shooting locked to 1-2 directions on cube
 *   faces. s44r3-03 was marked VERIFIED using SP tests but was STILL BROKEN
 *   in MP. This test uses the MP harness (computeCameraRelativeAimAngle with
 *   camera-relative correction) so it tests the actual MP code path.
 *
 * WHAT THIS TESTS:
 *   On any cube face, aiming in 4 compass directions must produce 4 UNIQUE,
 *   roughly-antiparallel bullet directions. The pre-fix bug produced locked
 *   directions (all 8 aim inputs mapped to ~1-2 world directions on top/bottom).
 *
 * VERIFICATION LEVEL: Level 3 (programmatic — MP code path via harness).
 */
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// -- DOM shims before any game code imports --
import './verification-env';

// Mock UIHelpers static initializer (reads DOM at module load)
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

// -- Import harness after mocks --
import { MPRealGameTestHarness } from './MPRealGameTestHarness';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Snap camera to a face center and let it settle.
 * Returns the surface normal at the player's position.
 */
function teleportAndSettle(harness: MPRealGameTestHarness, u: number, v: number): THREE.Vector3 {
  harness.placePlayerAt(u, v);
  // Settle camera: 90 frames = 1.5s at 60fps (camera LERP_FACTOR=0.12 → ~20 frames to converge)
  harness.tickCamera(90);
  return harness.playerState.worldPos.clone().normalize(); // rough normal from sphere approx
}

/**
 * Compute bullet direction for a given screen-space aim (aimX, aimY normalised -1..1).
 * Mirrors what network-main.ts does each onFixedUpdate tick.
 */
function shootDir(harness: MPRealGameTestHarness, aimX: number, aimY: number): THREE.Vector3 {
  harness.setMouse(aimX, aimY);
  const bullet = harness.shoot();
  return bullet.worldDir.clone();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MP cube aim — computeCameraRelativeAimAngle (MP code path)', () => {
  it('Sphere control: 4 compass aims produce 4 unique bullet directions', () => {
    const h = new MPRealGameTestHarness({ surface: 'sphere' });
    teleportAndSettle(h, 0.5, 0.5);

    const dirs = [
      shootDir(h, 1, 0),    // right
      shootDir(h, 0, -1),   // up
      shootDir(h, -1, 0),   // left
      shootDir(h, 0, 1),    // down
    ];

    // All 4 must be unique
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        expect(dirs[i].dot(dirs[j])).toBeLessThan(0.99);
      }
    }
    // Opposite pairs must be antiparallel
    expect(dirs[0].dot(dirs[2])).toBeLessThan(-0.7); // right vs left
    expect(dirs[1].dot(dirs[3])).toBeLessThan(-0.7); // up vs down
  });

  it('Cube front face: 4 compass aims produce 4 unique bullet directions', () => {
    // Front face center: UV around (0.5, 0.25) in typical cube parameterisation
    // Use world position near (0, 0, 9) on the front face
    const h = new MPRealGameTestHarness({ surface: 'cube' });
    teleportAndSettle(h, 0.5, 0.25);

    const dirs = [
      shootDir(h, 1, 0),
      shootDir(h, 0, -1),
      shootDir(h, -1, 0),
      shootDir(h, 0, 1),
    ];

    // REGRESSION GUARD: must NOT be locked (all identical)
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        const dot = dirs[i].dot(dirs[j]);
        expect(dot).toBeLessThan(0.95); // unique directions
      }
    }
    expect(dirs[0].dot(dirs[2])).toBeLessThan(-0.5); // right vs left
    expect(dirs[1].dot(dirs[3])).toBeLessThan(-0.5); // up vs down
  });

  it('Cube top face: 4 compass aims produce 4 unique bullet directions (s44r3-03 regression)', () => {
    // Top face — this was the failing case: locked aim on top/bottom in MP
    const h = new MPRealGameTestHarness({ surface: 'cube' });
    teleportAndSettle(h, 0.5, 0.95); // Top of cube

    const dirs = [
      shootDir(h, 1, 0),
      shootDir(h, 0, -1),
      shootDir(h, -1, 0),
      shootDir(h, 0, 1),
    ];

    // Critical check: no two directions should be nearly identical (locked aim bug)
    for (let i = 0; i < dirs.length; i++) {
      for (let j = i + 1; j < dirs.length; j++) {
        const dot = dirs[i].dot(dirs[j]);
        // If dot ≈ 1.0, aim is locked — that's the bug
        expect(dot).toBeLessThan(0.95);
      }
    }
    // Opposite pairs must be antiparallel
    expect(dirs[0].dot(dirs[2])).toBeLessThan(-0.4);
    expect(dirs[1].dot(dirs[3])).toBeLessThan(-0.4);
  });

  it('computeCameraRelativeAimAngle: degenerate guard fires on near-vertical normal', () => {
    // When the surface normal is nearly parallel to camRight or camUp,
    // the degenerate guard in computeCameraRelativeAimAngle kicks in.
    // This should NOT crash and should produce a valid aim angle.
    const h = new MPRealGameTestHarness({ surface: 'cube' });
    teleportAndSettle(h, 0.5, 0.95); // top face has nearly +Y normal

    h.setMouse(1, 0);
    const angle = h.computeAimAngle();
    expect(isFinite(angle)).toBe(true);
    expect(angle).not.toBeNaN();
  });

  it('Aim angle is consistent: same mouse input → same bullet direction', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube' });
    teleportAndSettle(h, 0.5, 0.5);

    h.setMouse(0.7, -0.3);
    const dir1 = h.shoot().worldDir.clone();
    const dir2 = h.shoot().worldDir.clone();

    // Same input same frame → same output (deterministic)
    expect(dir1.dot(dir2)).toBeGreaterThan(0.999);
  });

  it('computeAimAngle produces different angles for different mouse positions', () => {
    // Fundamental correctness check: different mouse inputs → different aim angles.
    // This confirms computeCameraRelativeAimAngle is not a passthrough constant.
    const h = new MPRealGameTestHarness({ surface: 'sphere' });
    h.placePlayerAt(0.5, 0.5);
    h.tickCamera(60);

    h.setMouse(1, 0);
    const angleRight = h.computeAimAngle();

    h.setMouse(-1, 0);
    const angleLeft = h.computeAimAngle();

    h.setMouse(0, -1);
    const angleUp = h.computeAimAngle();

    h.setMouse(0, 1);
    const angleDown = h.computeAimAngle();

    // All four angles must be distinct (function responds to mouse input)
    expect(Math.abs(angleRight - angleLeft)).toBeGreaterThan(0.1);
    expect(Math.abs(angleUp - angleDown)).toBeGreaterThan(0.1);
    expect(Math.abs(angleRight - angleUp)).toBeGreaterThan(0.1);

    // All must be finite
    expect(isFinite(angleRight)).toBe(true);
    expect(isFinite(angleLeft)).toBe(true);
    expect(isFinite(angleUp)).toBe(true);
    expect(isFinite(angleDown)).toBe(true);
  });
});

describe('MP bullet direction reconstruction (network-main.ts onStateChange path)', () => {
  it('dirX=1, dirY=0 → bullet along tangentU', () => {
    const h = new MPRealGameTestHarness({ surface: 'sphere' });
    h.placePlayerAt(0.5, 0.5);

    const bullet = h.reconstructBullet(0.5, 0.5, 1, 0);
    const { tangentU } = h.getSurfaceTangentFrame();

    // Bullet should be nearly parallel to tangentU
    const dot = bullet.worldDir.dot(tangentU);
    expect(Math.abs(dot)).toBeGreaterThan(0.95);
  });

  it('dirX=0, dirY=1 → bullet along tangentV', () => {
    const h = new MPRealGameTestHarness({ surface: 'sphere' });
    h.placePlayerAt(0.5, 0.5);

    const bullet = h.reconstructBullet(0.5, 0.5, 0, 1);
    const { tangentV } = h.getSurfaceTangentFrame();

    const dot = bullet.worldDir.dot(tangentV);
    expect(Math.abs(dot)).toBeGreaterThan(0.95);
  });

  it('Opposite dirX values produce opposite world directions', () => {
    const h = new MPRealGameTestHarness({ surface: 'sphere' });
    h.placePlayerAt(0.5, 0.5);

    const b1 = h.reconstructBullet(0.5, 0.5, 1, 0);
    const b2 = h.reconstructBullet(0.5, 0.5, -1, 0);

    expect(b1.worldDir.dot(b2.worldDir)).toBeLessThan(-0.95);
  });

  it('Bullet world direction is always normalised', () => {
    const h = new MPRealGameTestHarness({ surface: 'cube' });
    h.placePlayerAt(0.5, 0.5);

    for (const [dx, dy] of [[1, 0], [0, 1], [0.707, 0.707], [-1, 0.5]]) {
      const bullet = h.reconstructBullet(0.5, 0.5, dx, dy);
      expect(bullet.worldDir.length()).toBeCloseTo(1.0, 3);
    }
  });

  it('Full MP shot pipeline: aim angle → server bullet → world direction', () => {
    const h = new MPRealGameTestHarness({ surface: 'sphere' });
    h.placePlayerAt(0.5, 0.5);
    h.tickCamera(60); // settle camera

    // Aim right
    h.setMouse(1, 0);
    const bulletRight = h.shoot();

    // Aim left
    h.setMouse(-1, 0);
    const bulletLeft = h.shoot();

    // They should be roughly antiparallel
    expect(bulletRight.worldDir.dot(bulletLeft.worldDir)).toBeLessThan(-0.7);
  });
});
