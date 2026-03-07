/**
 * All-Surfaces Size Variant Tests — s44r-08
 *
 * Tests all 12 surface types at 3 size variants (small=7.5, medium=10, large=15).
 * Checks that movement works at each size and player position is valid.
 *
 * This supplements all-surfaces-verification.test.ts which tests the default (medium) size.
 *
 * NOTE: vitest cannot run in git worktrees. Run from the main project root:
 *   npm test -- src/test/all-surfaces-size-variants.test.ts
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
    innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    addEventListener: _noopEvent, removeEventListener: _noopEvent,
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
      appendChild: _noop, removeChild: _noop, style: {},
      clientWidth: 800, clientHeight: 600,
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop }),
      addEventListener: _noopEvent, removeEventListener: _noopEvent,
    },
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        const mock2dCtx = {
          fillRect: _noop, clearRect: _noop,
          getImageData: () => ({ data: new Uint8ClampedArray(4) }),
          putImageData: _noop, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
          setTransform: _noop, drawImage: _noop, save: _noop,
          fillText: _noop, restore: _noop, beginPath: _noop,
          moveTo: _noop, lineTo: _noop, closePath: _noop,
          stroke: _noop, translate: _noop, scale: _noop,
          rotate: _noop, arc: _noop, fill: _noop,
          measureText: () => ({ width: 10 }), transform: _noop, rect: _noop, clip: _noop,
          canvas: { width: 64, height: 64 }, fillStyle: '', strokeStyle: '',
          lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
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
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop }),
        addEventListener: _noopEvent, removeEventListener: _noopEvent,
      };
    },
    addEventListener: _noopEvent, removeEventListener: _noopEvent,
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
// Mock modules
// ---------------------------------------------------------------------------

vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({ play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false }),
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
  createRenderer: vi.fn().mockResolvedValue({ renderer: {}, isWebGPU: false, backend: 'webgl2' }),
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
// Imports (AFTER mocks)
// ---------------------------------------------------------------------------

import { PlaygroundTestHarness } from './PlaygroundTestHarness';
import type { SurfaceType } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Test configuration
// ---------------------------------------------------------------------------

const ALL_SURFACES: SurfaceType[] = [
  'sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut',
  'capsule', 'icosahedron', 'mobius', 'sphere-tunnel', 'cube-ring', 'cube-tunnel',
];

/** Scale variants: SMALL=7.5, MEDIUM=10 (default), LARGE=15. */
const SIZE_VARIANTS: Array<{ label: string; surfaceScale: number }> = [
  { label: 'SMALL (7.5)', surfaceScale: 7.5 },
  { label: 'LARGE (15)', surfaceScale: 15 },
];

// ---------------------------------------------------------------------------
// Size variant tests
// ---------------------------------------------------------------------------

describe('All Surfaces Size Variants', () => {
  let harness: PlaygroundTestHarness;

  afterEach(() => {
    if (harness) {
      try { harness.dispose(); } catch (_) { /* ignore */ }
    }
  });

  for (const size of SIZE_VARIANTS) {
    describe(`Size: ${size.label}`, () => {
      for (const surfaceType of ALL_SURFACES) {
        describe(`${surfaceType}`, () => {

          it('player position is valid at this size', () => {
            harness = new PlaygroundTestHarness({
              surface: surfaceType,
              surfaceScale: size.surfaceScale,
              width: 400,
              height: 300,
              enemyCount: 0,
            });
            harness.tick(10);

            const pos = harness.getPlayerWorldPos();
            expect(pos.x, `${surfaceType} @ ${size.label}: x is NaN`).not.toBeNaN();
            expect(pos.y, `${surfaceType} @ ${size.label}: y is NaN`).not.toBeNaN();
            expect(pos.z, `${surfaceType} @ ${size.label}: z is NaN`).not.toBeNaN();
            expect(pos.length(), `${surfaceType} @ ${size.label}: player at origin`).toBeGreaterThan(0);
          });

          it('forward movement works at this size', () => {
            harness = new PlaygroundTestHarness({
              surface: surfaceType,
              surfaceScale: size.surfaceScale,
              width: 400,
              height: 300,
              enemyCount: 0,
            });
            harness.tick(10);

            const startPos = harness.getPlayerWorldPos();
            harness.pressKey('w');
            harness.tick(30);
            harness.releaseKey('w');
            const endPos = harness.getPlayerWorldPos();

            const distance = startPos.distanceTo(endPos);
            expect(distance, `${surfaceType} @ ${size.label}: player did not move forward (dist=${distance.toFixed(3)})`).toBeGreaterThan(0.01);
          });

        });
      }
    });
  }
});
