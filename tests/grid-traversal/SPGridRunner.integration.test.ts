/**
 * SPGridRunner Integration Test
 *
 * Runs all 13 surfaces at density 8 (CI-safe speed) and asserts:
 * - Known-good surfaces have 0 stuck points
 * - Fragile surfaces are logged but not failed
 *
 * Results are written to reports/grid-traversal-sp-latest.json.
 *
 * Full density=15 run: npm run test:grid-traversal:full (Phase 4, s44m-05d)
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Minimal DOM/window shim for Node environment
// (Same pattern as SurfaceGridWalker.test.ts and all-surfaces-verification.test.ts)
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
// Mock modules (same as SurfaceGridWalker.test.ts)
// ---------------------------------------------------------------------------

vi.mock('../../src/audio/SoundEngine', () => ({
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

vi.mock('../../src/rendering/GPUCapabilities', () => ({
  detectGPUCapabilities: vi.fn().mockResolvedValue({
    webgpu: false, webgl2: true, webgl1: true,
    maxTextureSize: 4096, maxInstanceCount: 1000,
    sharedArrayBuffer: false, hardwareConcurrency: 4,
    renderer: 'Mock GPU', vendor: 'Mock Vendor',
    webgpuAdapter: '', tier: 'medium',
  }),
}));

vi.mock('../../src/rendering/RendererFactory', () => ({
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
// Import under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { runSPGrid, writeGridReport, ALL_SURFACES } from './SPGridRunner';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Surfaces with known geometry fragility — flag but do not fail. */
const KNOWN_FRAGILE = ['peanut', 'pill', 'cube-tunnel', 'mobius', 'mobius-bevel'];

/** Surfaces that must always report 0 stuck points at density 8. */
const KNOWN_GOOD = ALL_SURFACES.filter(s => !KNOWN_FRAGILE.includes(s));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SPGridRunner — All 13 surfaces at density 8', () => {
  it(
    'runs all surfaces and writes JSON report',
    () => {
      const report = runSPGrid(8, 60);

      // Write JSON for Phase 3 report generator
      writeGridReport(report);

      // Verify report structure
      expect(report.runDate).toBeTruthy();
      expect(report.gridDensity).toBe(8);
      expect(report.surfaces).toHaveLength(13);
      expect(typeof report.totalStuck).toBe('number');
      expect(typeof report.totalPoints).toBe('number');
      expect(report.durationMs).toBeGreaterThan(0);

      // Log summary
      console.log(
        `[SPGridRunner] ${report.totalPoints} points, ${report.totalStuck} stuck, ` +
          `worst: ${report.worstSurface ?? 'none'}, ${report.durationMs}ms`,
      );
      for (const r of report.surfaces) {
        const tag = KNOWN_FRAGILE.includes(r.surface) ? '[fragile]' : '[stable]';
        console.log(`  ${tag} ${r.surface}: ${r.stuckCount}/${r.points.length} stuck`);
      }

      // Assert known-good surfaces have 0 stuck
      const failures: string[] = [];
      for (const result of report.surfaces) {
        if (KNOWN_FRAGILE.includes(result.surface)) {
          console.log(`[fragile] ${result.surface}: ${result.stuckCount} stuck points`);
        } else {
          if (result.stuckCount > 0) {
            const stuckUVs = result.points
              .filter(p => p.stuck)
              .map(p => `u=${p.u.toFixed(3)},v=${p.v.toFixed(3)} (${p.stuckReason})`)
              .join('; ');
            failures.push(`${result.surface}: ${result.stuckCount} stuck — ${stuckUVs}`);
          }
        }
      }

      if (failures.length > 0) {
        throw new Error(
          `Regression detected on known-good surfaces:\n${failures.map(f => `  - ${f}`).join('\n')}`,
        );
      }

      // Verify known-good list was tested
      for (const surface of KNOWN_GOOD) {
        const found = report.surfaces.find(r => r.surface === surface);
        expect(found, `Surface '${surface}' should be in the report`).toBeDefined();
      }
    },
    60000,
  );
});
