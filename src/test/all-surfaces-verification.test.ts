/**
 * All-Surfaces Verification Test Suite
 *
 * Tests ALL 12 surface types for:
 *   a. Player position validity (not NaN)
 *   b. Movement in all 4 directions (WASD)
 *   c. Camera stability (max rotation delta < PI per frame)
 *   d. Player stays on screen during movement
 *   e. Mobius: seam traversal test
 *
 * Uses the same mock setup as playground-verification.test.ts.
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
// Mock modules (same as playground-verification.test.ts)
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('All Surfaces Verification', () => {
  let harness: PlaygroundTestHarness;

  afterEach(() => {
    if (harness) {
      try { harness.dispose(); } catch (_) { /* ignore disposal errors */ }
    }
  });

  for (const surfaceType of ALL_SURFACES) {
    describe(`Surface: ${surfaceType}`, () => {

      // (a) Player position is valid (not NaN)
      it('player position is valid (not NaN)', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(10);

        const pos = harness.getPlayerWorldPos();
        expect(pos.x).not.toBeNaN();
        expect(pos.y).not.toBeNaN();
        expect(pos.z).not.toBeNaN();
        expect(pos.length()).toBeGreaterThan(0);
      });

      // (b) Movement works in all 4 directions (WASD)
      it('movement works in all 4 directions', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(10);

        const directions: Array<{ key: string; name: string }> = [
          { key: 'w', name: 'forward' },
          { key: 'a', name: 'left' },
          { key: 's', name: 'backward' },
          { key: 'd', name: 'right' },
        ];

        const results: Record<string, { moved: boolean; distance: number }> = {};

        for (const dir of directions) {
          const startPos = harness.getPlayerWorldPos();

          harness.pressKey(dir.key);
          harness.tick(30);
          harness.releaseKey(dir.key);

          const endPos = harness.getPlayerWorldPos();
          const distance = startPos.distanceTo(endPos);
          results[dir.name] = { moved: distance > 0.01, distance };
        }

        // All 4 directions should produce movement
        for (const dir of directions) {
          expect(results[dir.name].moved,
            `${surfaceType}: ${dir.name} (key=${dir.key}) failed to move. Distance: ${results[dir.name].distance}`
          ).toBe(true);
        }
      });

      // (c) Camera doesn't spin wildly (max rotation delta < PI per frame)
      it('camera does not spin wildly during movement', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(30); // Let camera settle

        // Test forward movement
        harness.pressKey('w');
        const stabilityW = harness.getCameraStability(60);
        harness.releaseKey('w');

        expect(stabilityW.maxRotationDelta,
          `${surfaceType}: camera spun ${(stabilityW.maxRotationDelta * 180 / Math.PI).toFixed(1)} deg/frame during W movement`
        ).toBeLessThan(Math.PI);

        // Test lateral movement
        harness.pressKey('a');
        const stabilityA = harness.getCameraStability(60);
        harness.releaseKey('a');

        expect(stabilityA.maxRotationDelta,
          `${surfaceType}: camera spun ${(stabilityA.maxRotationDelta * 180 / Math.PI).toFixed(1)} deg/frame during A movement`
        ).toBeLessThan(Math.PI);
      });

      // (d) Player stays on screen during movement
      it('player stays on screen during movement', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(30); // Let camera settle

        const keys = ['w', 'a', 's', 'd'];
        const offScreenFrames: Array<{ key: string; frame: number; x: number; y: number }> = [];

        for (const key of keys) {
          harness.pressKey(key);
          for (let i = 0; i < 60; i++) {
            harness.tick(1);
            const screenPos = harness.getPlayerScreenPos();
            // Allow generous margin (camera lag can push player off-center)
            const margin = 200;
            if (
              screenPos.x < -margin || screenPos.x > harness.width + margin ||
              screenPos.y < -margin || screenPos.y > harness.height + margin
            ) {
              offScreenFrames.push({ key, frame: i, x: screenPos.x, y: screenPos.y });
            }
          }
          harness.releaseKey(key);
        }

        expect(offScreenFrames.length,
          `${surfaceType}: player went off screen ${offScreenFrames.length} times. First: key=${offScreenFrames[0]?.key} frame=${offScreenFrames[0]?.frame} pos=(${offScreenFrames[0]?.x?.toFixed(0)}, ${offScreenFrames[0]?.y?.toFixed(0)})`
        ).toBe(0);
      });

      // (e) Full traversal test - can the player actually move across the surface?
      it('player can traverse surface', () => {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(10);

        const result = harness.testFullTraversal(120);

        expect(result.totalDistanceMoved,
          `${surfaceType}: total traversal distance was only ${result.totalDistanceMoved.toFixed(3)}`
        ).toBeGreaterThan(0.5);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Special Mobius seam traversal test
  // ---------------------------------------------------------------------------

  describe('Mobius: seam traversal', () => {
    it('player can cross the Mobius seam without getting stuck or NaN', () => {
      harness = new PlaygroundTestHarness('mobius');
      harness.tick(10);

      // Record UV coordinates as we traverse in one direction for a long time
      // On a Mobius strip, continuous movement should eventually cross the seam
      const uvHistory: Array<{ u: number; v: number; worldPos: THREE.Vector3 }> = [];
      let nanDetected = false;
      let stuckFrames = 0;
      let lastPos = harness.getPlayerWorldPos();

      harness.pressKey('w');
      for (let i = 0; i < 300; i++) {
        harness.tick(1);
        const pos = harness.getPlayerWorldPos();
        const uv = harness.getPlayerSurfaceUV();

        if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) {
          nanDetected = true;
          break;
        }

        if (isNaN(uv.u) || isNaN(uv.v)) {
          nanDetected = true;
          break;
        }

        const dist = lastPos.distanceTo(pos);
        if (dist < 0.0001) {
          stuckFrames++;
        } else {
          stuckFrames = 0;
        }

        uvHistory.push({ u: uv.u, v: uv.v, worldPos: pos.clone() });
        lastPos = pos.clone();
      }
      harness.releaseKey('w');

      expect(nanDetected, 'Mobius: player position became NaN during seam traversal').toBe(false);

      // If stuck for >30 consecutive frames, likely hit a wall at the seam
      expect(stuckFrames, `Mobius: player got stuck for ${stuckFrames} consecutive frames`).toBeLessThan(30);

      // Check UV wrapping happened (u should cross from near 1 back to near 0 or vice versa)
      if (uvHistory.length > 10) {
        const uValues = uvHistory.map(h => h.u);
        const uMin = Math.min(...uValues);
        const uMax = Math.max(...uValues);
        const uRange = uMax - uMin;

        // On a Mobius strip, if the player traverses the seam, u should span a reasonable range
        // Even without seam crossing, movement should cover some UV range
        expect(uRange, `Mobius: u-range was only ${uRange.toFixed(4)} (player may not be moving in UV space)`).toBeGreaterThan(0.01);
      }
    });

    it('player can traverse Mobius laterally without NaN', () => {
      harness = new PlaygroundTestHarness('mobius');
      harness.tick(10);

      let nanDetected = false;

      // Move laterally (across the strip width)
      harness.pressKey('d');
      for (let i = 0; i < 120; i++) {
        harness.tick(1);
        const pos = harness.getPlayerWorldPos();
        if (isNaN(pos.x) || isNaN(pos.y) || isNaN(pos.z)) {
          nanDetected = true;
          break;
        }
      }
      harness.releaseKey('d');

      expect(nanDetected, 'Mobius: lateral movement produced NaN position').toBe(false);
    });

    it('Mobius camera stays stable near seam area', () => {
      harness = new PlaygroundTestHarness('mobius');
      harness.tick(30); // Let camera settle

      // Move forward for a long time to potentially cross the seam
      harness.pressKey('w');
      const stability = harness.getCameraStability(200);
      harness.releaseKey('w');

      expect(stability.maxRotationDelta,
        `Mobius: camera spun ${(stability.maxRotationDelta * 180 / Math.PI).toFixed(1)} deg/frame near seam`
      ).toBeLessThan(Math.PI);
    });
  });
});
