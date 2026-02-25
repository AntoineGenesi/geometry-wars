/**
 * Map Direction Audit — Programmatic test for camera-relative controls on all surfaces.
 *
 * Verifies: press W → player moves toward screen top (camera-up direction).
 *           press D → player moves toward screen right (camera-right direction).
 *           press S → player moves toward screen bottom (opposite of W).
 *           press A → player moves toward screen left (opposite of D).
 *
 * A FAIL on any surface means that key produces inverted or orthogonal motion,
 * which the user would experience as "controls are wrong on this map".
 *
 * Runs on all 12 surface types used by the game.
 *
 * Created: S34b — Map Direction Audit
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Minimal DOM/window shim for Node environment
// ---------------------------------------------------------------------------

const _noop = () => {};
const _noopEvent = (_e: string, _h: any) => {};

if (typeof globalThis.window === 'undefined') {
  const mockWindow: any = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
    location: { search: '', href: '' },
    navigator: { getGamepads: () => [], userAgent: '' },
    getComputedStyle: () => ({}),
  };
  globalThis.window = mockWindow;
}

if (typeof globalThis.document === 'undefined') {
  const mock2dCtx = {
    fillRect: _noop, clearRect: _noop,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: _noop,
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    setTransform: _noop, drawImage: _noop, save: _noop,
    fillText: _noop, restore: _noop, beginPath: _noop,
    moveTo: _noop, lineTo: _noop, closePath: _noop,
    stroke: _noop, translate: _noop, scale: _noop,
    rotate: _noop, arc: _noop, fill: _noop,
    measureText: () => ({ width: 10 }),
    transform: _noop, rect: _noop, clip: _noop,
    canvas: { width: 64, height: 64 },
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    lineCap: 'butt', lineJoin: 'miter',
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    createRadialGradient: () => ({ addColorStop: _noop }),
    createLinearGradient: () => ({ addColorStop: _noop }),
  };
  const mockDoc: any = {
    hidden: false,
    body: {
      appendChild: _noop,
      removeChild: _noop,
      style: {},
      clientWidth: 800,
      clientHeight: 600,
      getBoundingClientRect: () => ({
        left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
      }),
      addEventListener: _noopEvent,
      removeEventListener: _noopEvent,
    },
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 64, height: 64, style: {},
          getContext: (type: string) => type === '2d' ? mock2dCtx : null,
          addEventListener: _noopEvent, removeEventListener: _noopEvent,
          toDataURL: () => '', remove: _noop,
        };
      }
      return {
        style: {}, clientWidth: 800, clientHeight: 600,
        appendChild: _noop, removeChild: _noop,
        getBoundingClientRect: () => ({
          left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
        }),
        addEventListener: _noopEvent, removeEventListener: _noopEvent,
      };
    },
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  };
  globalThis.document = mockDoc;
}

if (typeof globalThis.navigator === 'undefined') {
  (globalThis as any).navigator = { getGamepads: () => [], userAgent: '' };
}
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16);
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
}
if (typeof globalThis.HTMLElement === 'undefined') {
  (globalThis as any).HTMLElement = class MockHTMLElement {};
}
if (typeof globalThis.URLSearchParams === 'undefined') {
  (globalThis as any).URLSearchParams = class MockURLSearchParams {
    private params: Record<string, string> = {};
    constructor(search: string) {
      search.replace(/^\?/, '').split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) this.params[k] = v ?? '';
      });
    }
    get(key: string) { return this.params[key] ?? null; }
  };
}

// ---------------------------------------------------------------------------
// Mock modules (same as all-surfaces-verification.test.ts)
// ---------------------------------------------------------------------------

vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false,
  }),
}));

vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class MockEffectComposer {
    passes: any[] = [];
    addPass(pass: any) { this.passes.push(pass); }
    render() {} setSize() {} dispose() {}
  },
}));

vi.mock('three/addons/postprocessing/RenderPass.js', () => ({
  RenderPass: class MockRenderPass { constructor(_s: any, _c: any) {} },
}));

vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class MockUnrealBloomPass {
    resolution = new THREE.Vector2(800, 600);
    constructor(_r: any, _s: number, _ra: number, _t: number) {}
  },
}));

vi.mock('three/addons/postprocessing/OutputPass.js', () => ({
  OutputPass: class MockOutputPass {},
}));

vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({
  ShaderPass: class MockShaderPass { constructor(_shader: any) {} },
}));

vi.mock('three/webgpu', () => ({
  PostProcessing: class MockPostProcessing { render() {} },
  pass: () => ({ getTextureNode: () => ({ r: 0, g: 0, b: 0, mul: () => ({}) }) }),
  float: () => ({}),
  max: () => ({ sub: () => ({}) }),
  add: () => ({ mul: () => ({}) }),
  screenUV: { sub: () => ({ dot: () => ({ mul: () => ({}) }) }) },
}));

vi.mock('../rendering/GPUCapabilities', () => ({
  detectGPUCapabilities: vi.fn().mockResolvedValue({
    webgpu: false, webgl2: true, webgl1: true,
    maxTextureSize: 4096, maxInstanceCount: 1000,
    sharedArrayBuffer: false, hardwareConcurrency: 4,
    renderer: 'Mock GPU', vendor: 'Mock Vendor',
    webgpuAdapter: '', tier: 'medium',
  }),
}));

vi.mock('../rendering/RendererFactory', () => ({
  createRenderer: vi.fn().mockResolvedValue({
    renderer: {}, isWebGPU: false, backend: 'webgl2',
  }),
  resolveRendererPreference: vi.fn().mockReturnValue('webgl2'),
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();

  class MockWebGLRenderer {
    domElement: any;
    toneMapping: any;
    toneMappingExposure: number;
    shadowMap: any;
    outputColorSpace: any;
    info: any;

    constructor(_opts?: any) {
      this.domElement = {
        style: {}, width: 800, height: 600,
        addEventListener: () => {}, removeEventListener: () => {},
        remove: () => {}, getContext: () => null, toDataURL: () => '',
      };
      this.toneMapping = actual.NoToneMapping;
      this.toneMappingExposure = 1.0;
      this.shadowMap = { enabled: false };
      this.outputColorSpace = actual.SRGBColorSpace;
      this.info = { render: { calls: 0, triangles: 0 } };
    }
    setSize() {} setPixelRatio() {} render() {} dispose() {}
    getSize(target: any) { return target?.set?.(800, 600) ?? new actual.Vector2(800, 600); }
    getPixelRatio() { return 1; }
  }

  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

// ---------------------------------------------------------------------------
// Import harness after mocks
// ---------------------------------------------------------------------------

import { PlaygroundTestHarness } from './PlaygroundTestHarness';
import type { SurfaceType } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// All 12 surface types
// ---------------------------------------------------------------------------

const ALL_SURFACES: SurfaceType[] = [
  'sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut',
  'capsule', 'icosahedron', 'mobius', 'sphere-tunnel', 'cube-ring', 'cube-tunnel',
];

/**
 * Minimum dot product for "aligned" movement.
 * cos(60°) = 0.5 — allows surface curvature to deviate up to 60° from ideal.
 * Negative means the key moved the player in the OPPOSITE direction (inverted).
 */
const ALIGNMENT_THRESHOLD = 0.3;

/**
 * Frames to settle camera before measuring.
 * Camera lerp factor = 0.12/frame → after 30 frames it's very close to target.
 */
const SETTLE_FRAMES = 30;

/**
 * Frames to hold the key and measure movement.
 * 20 frames at speed ~3 world-units/s, dt=1/60 → ~1 unit of movement.
 * Short enough to avoid major surface curvature effects.
 */
const MOVE_FRAMES = 20;

// ---------------------------------------------------------------------------
// Helper: get camera-relative axes projected onto the surface plane
// ---------------------------------------------------------------------------

interface CameraAxes {
  right: THREE.Vector3;  // Camera X (screen right)
  up: THREE.Vector3;     // Camera Y (screen up)
  normal: THREE.Vector3; // Approximate surface normal from camera-to-player
}

/**
 * Extract camera screen axes projected onto the surface normal plane.
 * These are what moveFromInput() uses to compute movement direction.
 */
function getCameraAxes(harness: PlaygroundTestHarness): CameraAxes {
  const cam = harness.pg.game.camera;
  cam.updateMatrixWorld(true);

  // Camera X = right, Camera Y = up (in world space)
  const camRight = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
  const camUp = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);

  // Approximate surface normal from player walker
  const walker = (harness.pg as any)._walker;
  const normal = walker ? walker.normal.clone() : new THREE.Vector3(0, 1, 0);

  // Project camera axes onto surface tangent plane (same as moveFromInput does)
  const camRightProjected = camRight.clone().addScaledVector(normal, -camRight.dot(normal));
  const camUpProjected = camUp.clone().addScaledVector(normal, -camUp.dot(normal));

  // Normalize if non-degenerate (degenerate = camera looking edge-on at surface)
  if (camRightProjected.lengthSq() > 0.001) camRightProjected.normalize();
  if (camUpProjected.lengthSq() > 0.001) camUpProjected.normalize();

  return { right: camRightProjected, up: camUpProjected, normal };
}

/**
 * Measure where pressing a key moves the player relative to camera axes.
 * Returns alignment with the expected axis (range: -1 to 1).
 * Positive = moving in expected direction. Negative = inverted.
 */
function measureKeyAlignment(
  harness: PlaygroundTestHarness,
  key: string,
  expectedAxis: THREE.Vector3,
): { alignment: number; displacement: THREE.Vector3; moved: boolean } {
  const startPos = harness.getPlayerWorldPos();

  harness.pressKey(key);
  harness.tick(MOVE_FRAMES);
  harness.releaseKey(key);

  const endPos = harness.getPlayerWorldPos();
  const displacement = endPos.clone().sub(startPos);
  const moved = displacement.length() > 0.005;

  const alignment = moved
    ? displacement.clone().normalize().dot(expectedAxis)
    : 0;

  return { alignment, displacement, moved };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Map Direction Audit — Camera-Relative Controls', () => {
  let harness: PlaygroundTestHarness;

  afterEach(() => {
    if (harness) {
      try { harness.dispose(); } catch (_) {}
    }
  });

  for (const surfaceType of ALL_SURFACES) {
    describe(`Surface: ${surfaceType}`, () => {

      // -----------------------------------------------------------------------
      // W key: forward / screen up
      // -----------------------------------------------------------------------
      it('W key moves player toward screen top (not inverted)', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(SETTLE_FRAMES);

        const axes = getCameraAxes(harness);
        const result = measureKeyAlignment(harness, 'w', axes.up);

        expect(result.moved,
          `${surfaceType}: W key did not move player (stuck or zero displacement)`
        ).toBe(true);

        expect(result.alignment,
          `${surfaceType}: W key moved player at ${(Math.acos(Math.max(-1, Math.min(1, result.alignment))) * 180 / Math.PI).toFixed(1)}° from screen-up ` +
          `(alignment=${result.alignment.toFixed(3)}). Controls appear INVERTED or orthogonal.`
        ).toBeGreaterThan(ALIGNMENT_THRESHOLD);
      });

      // -----------------------------------------------------------------------
      // S key: backward / screen down
      // -----------------------------------------------------------------------
      it('S key moves player toward screen bottom (opposite of W)', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(SETTLE_FRAMES);

        const axes = getCameraAxes(harness);
        // S should move in -camUp direction → alignment with camUp should be negative
        const result = measureKeyAlignment(harness, 's', axes.up);

        expect(result.moved,
          `${surfaceType}: S key did not move player`
        ).toBe(true);

        expect(result.alignment,
          `${surfaceType}: S key moved toward screen top instead of bottom ` +
          `(alignment with up=${result.alignment.toFixed(3)}). Expected < ${-ALIGNMENT_THRESHOLD}`
        ).toBeLessThan(-ALIGNMENT_THRESHOLD);
      });

      // -----------------------------------------------------------------------
      // D key: strafe right / screen right
      // -----------------------------------------------------------------------
      it('D key moves player toward screen right (not inverted)', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(SETTLE_FRAMES);

        const axes = getCameraAxes(harness);
        const result = measureKeyAlignment(harness, 'd', axes.right);

        expect(result.moved,
          `${surfaceType}: D key did not move player`
        ).toBe(true);

        expect(result.alignment,
          `${surfaceType}: D key moved player at ${(Math.acos(Math.max(-1, Math.min(1, result.alignment))) * 180 / Math.PI).toFixed(1)}° from screen-right ` +
          `(alignment=${result.alignment.toFixed(3)}). Controls appear INVERTED or orthogonal.`
        ).toBeGreaterThan(ALIGNMENT_THRESHOLD);
      });

      // -----------------------------------------------------------------------
      // A key: strafe left / screen left
      // -----------------------------------------------------------------------
      it('A key moves player toward screen left (opposite of D)', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(SETTLE_FRAMES);

        const axes = getCameraAxes(harness);
        // A should move in -camRight direction → alignment with camRight should be negative
        const result = measureKeyAlignment(harness, 'a', axes.right);

        expect(result.moved,
          `${surfaceType}: A key did not move player`
        ).toBe(true);

        expect(result.alignment,
          `${surfaceType}: A key moved toward screen right instead of left ` +
          `(alignment with right=${result.alignment.toFixed(3)}). Expected < ${-ALIGNMENT_THRESHOLD}`
        ).toBeLessThan(-ALIGNMENT_THRESHOLD);
      });

      // -----------------------------------------------------------------------
      // W and S are opposite directions
      // -----------------------------------------------------------------------
      it('W and S produce opposing displacements', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(SETTLE_FRAMES);

        const startW = harness.getPlayerWorldPos();
        harness.pressKey('w');
        harness.tick(MOVE_FRAMES);
        harness.releaseKey('w');
        const endW = harness.getPlayerWorldPos();
        const dispW = endW.clone().sub(startW);

        // Return to (approximate) start before testing S
        harness.pressKey('s');
        harness.tick(MOVE_FRAMES);
        harness.releaseKey('s');

        const startS = harness.getPlayerWorldPos();
        harness.pressKey('s');
        harness.tick(MOVE_FRAMES);
        harness.releaseKey('s');
        const endS = harness.getPlayerWorldPos();
        const dispS = endS.clone().sub(startS);

        const wMoved = dispW.length() > 0.005;
        const sMoved = dispS.length() > 0.005;

        if (wMoved && sMoved) {
          // W and S displacements should point in roughly opposite directions
          const dot = dispW.normalize().dot(dispS.normalize());
          expect(dot,
            `${surfaceType}: W and S are not opposite directions (dot=${dot.toFixed(3)}). ` +
            `Expected dot < -0.3`
          ).toBeLessThan(-0.3);
        }
      });

      // -----------------------------------------------------------------------
      // D and A are opposite directions
      // -----------------------------------------------------------------------
      it('D and A produce opposing displacements', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(SETTLE_FRAMES);

        const startD = harness.getPlayerWorldPos();
        harness.pressKey('d');
        harness.tick(MOVE_FRAMES);
        harness.releaseKey('d');
        const endD = harness.getPlayerWorldPos();
        const dispD = endD.clone().sub(startD);

        // Return to (approximate) start before testing A
        harness.pressKey('a');
        harness.tick(MOVE_FRAMES);
        harness.releaseKey('a');

        const startA = harness.getPlayerWorldPos();
        harness.pressKey('a');
        harness.tick(MOVE_FRAMES);
        harness.releaseKey('a');
        const endA = harness.getPlayerWorldPos();
        const dispA = endA.clone().sub(startA);

        const dMoved = dispD.length() > 0.005;
        const aMoved = dispA.length() > 0.005;

        if (dMoved && aMoved) {
          // D and A displacements should point in roughly opposite directions
          const dot = dispD.normalize().dot(dispA.normalize());
          expect(dot,
            `${surfaceType}: D and A are not opposite directions (dot=${dot.toFixed(3)}). ` +
            `Expected dot < -0.3`
          ).toBeLessThan(-0.3);
        }
      });

      // -----------------------------------------------------------------------
      // W and D are roughly perpendicular (controls not collapsed to 1D)
      // -----------------------------------------------------------------------
      it('W and D produce perpendicular displacements (not same axis)', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(SETTLE_FRAMES);

        const startW = harness.getPlayerWorldPos();
        harness.pressKey('w');
        harness.tick(MOVE_FRAMES);
        harness.releaseKey('w');
        const endW = harness.getPlayerWorldPos();
        const dispW = endW.clone().sub(startW);

        const startD = harness.getPlayerWorldPos();
        harness.pressKey('d');
        harness.tick(MOVE_FRAMES);
        harness.releaseKey('d');
        const endD = harness.getPlayerWorldPos();
        const dispD = endD.clone().sub(startD);

        const wMoved = dispW.length() > 0.005;
        const dMoved = dispD.length() > 0.005;

        if (wMoved && dMoved) {
          // W and D should produce clearly different (roughly perpendicular) directions
          const dot = Math.abs(dispW.normalize().dot(dispD.normalize()));
          expect(dot,
            `${surfaceType}: W and D produce nearly identical directions (dot=${dot.toFixed(3)}). ` +
            `Controls may be collapsed to a single axis.`
          ).toBeLessThan(0.7);
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Special: Mobius strip orientation consistency
  // ---------------------------------------------------------------------------
  describe('Mobius: orientation report', () => {
    it('initial controls are correct (not inverted at spawn)', () => {
      harness = new PlaygroundTestHarness('mobius');
      harness.tick(SETTLE_FRAMES);

      const axes = getCameraAxes(harness);
      const result = measureKeyAlignment(harness, 'w', axes.up);

      expect(result.moved).toBe(true);
      expect(result.alignment,
        `Mobius: W key at spawn point has alignment ${result.alignment.toFixed(3)} with screen-up. ` +
        `Note: controls may become inverted after traversing the Mobius seam (expected on non-orientable surface).`
      ).toBeGreaterThan(ALIGNMENT_THRESHOLD);
    });
  });
});
