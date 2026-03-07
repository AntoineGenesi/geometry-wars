/**
 * SurfaceVerifier Tests
 *
 * Verifies the two core test suites:
 * 1. Speed consistency — detects slow regions (peanut poles, torus distortion)
 * 2. Bullet origin — detects bullets spawning far from player (torus offset bug)
 *
 * Uses the same DOM/WebGL/Three.js mock setup as SurfaceGridWalker.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
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
// Mock modules
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

import { SurfaceVerifier } from './SurfaceVerifier';

// ---------------------------------------------------------------------------
// Speed Consistency Tests
// ---------------------------------------------------------------------------

describe('SurfaceVerifier.runSpeedTest', () => {
  it('returns correct surface and gridDensity', () => {
    const result = SurfaceVerifier.runSpeedTest('sphere', 3, 10);

    expect(result.surface).toBe('sphere');
    expect(result.gridDensity).toBe(3);
    expect(result.moveTicks).toBe(10);
  });

  it('produces points for sphere at density=3', () => {
    const result = SurfaceVerifier.runSpeedTest('sphere', 3, 10);

    expect(result.points.length).toBeGreaterThan(0);
    expect(result.points.length).toBeLessThanOrEqual(9); // 3x3 max
  });

  it('each SpeedTestPoint has required fields', () => {
    const result = SurfaceVerifier.runSpeedTest('sphere', 3, 10);

    for (const point of result.points) {
      expect(typeof point.u).toBe('number');
      expect(typeof point.v).toBe('number');
      expect(point.worldPos).toBeInstanceOf(THREE.Vector3);
      expect(typeof point.distanceMoved).toBe('number');
      expect(typeof point.speedRatio).toBe('number');
      expect(['pass', 'slow', 'fast', 'teleport-failed']).toContain(point.status);
    }
  });

  it('slowCount + fastCount + passCount <= points.length', () => {
    const result = SurfaceVerifier.runSpeedTest('sphere', 3, 10);

    const classified = result.slowCount + result.fastCount + result.passCount;
    // teleport-failed points are NOT in the above counts — so <= is correct
    expect(classified).toBeLessThanOrEqual(result.points.length);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sphere movement is mostly passing (no major slowdown)', () => {
    // Sphere is the reference surface — should have uniform speed everywhere
    const result = SurfaceVerifier.runSpeedTest('sphere', 4, 20);

    // Allow a few slow points due to teleport noise, but mostly passing
    const passRate = result.passCount / result.points.length;
    expect(passRate).toBeGreaterThan(0.7);
  }, 60_000);

  it('averageDistance is positive for a surface with movement', () => {
    const result = SurfaceVerifier.runSpeedTest('sphere', 3, 15);

    // Average distance should be > 0 for any surface where movement is possible
    expect(result.averageDistance).toBeGreaterThan(0);
  });

  it('density parameter controls number of output points', () => {
    const small = SurfaceVerifier.runSpeedTest('torus', 2, 5);
    const larger = SurfaceVerifier.runSpeedTest('torus', 4, 5);

    expect(larger.points.length).toBeGreaterThan(small.points.length);
  });
});

// ---------------------------------------------------------------------------
// Bullet Origin Tests
// ---------------------------------------------------------------------------

describe('SurfaceVerifier.runBulletOriginTest', () => {
  it('returns correct surface and gridDensity', () => {
    const result = SurfaceVerifier.runBulletOriginTest('sphere', 2);

    expect(result.surface).toBe('sphere');
    expect(result.gridDensity).toBe(2);
  });

  it('produces points for sphere at density=2', () => {
    const result = SurfaceVerifier.runBulletOriginTest('sphere', 2);

    expect(result.points.length).toBeGreaterThan(0);
  });

  it('each BulletTestPoint has required fields', () => {
    const result = SurfaceVerifier.runBulletOriginTest('sphere', 2);

    for (const point of result.points) {
      expect(typeof point.u).toBe('number');
      expect(typeof point.v).toBe('number');
      expect(point.playerWorldPos).toBeInstanceOf(THREE.Vector3);
      expect(['pass', 'warning', 'error', 'no-bullet', 'teleport-failed']).toContain(point.status);

      // bulletWorldPos is null only for no-bullet or teleport-failed
      if (point.status === 'pass' || point.status === 'warning' || point.status === 'error') {
        expect(point.bulletWorldPos).toBeInstanceOf(THREE.Vector3);
        expect(typeof point.offsetDistance).toBe('number');
        expect(point.offsetDistance).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('counts add up correctly', () => {
    const result = SurfaceVerifier.runBulletOriginTest('sphere', 2);

    const total = result.errorCount + result.warningCount + result.passCount + result.noBulletCount;
    // teleport-failed not counted in the above — so total <= points.length
    expect(total).toBeLessThanOrEqual(result.points.length);
  });

  it('sphere bullet origin is reasonable (errors should be low)', () => {
    // On sphere, bullets should spawn close to player
    const result = SurfaceVerifier.runBulletOriginTest('sphere', 3);

    // Sphere should have minimal bullet offset errors
    // (some points may get no-bullet due to fire cooldown, that's acceptable)
    const nonFailPoints = result.points.filter(
      p => p.status !== 'no-bullet' && p.status !== 'teleport-failed'
    );

    if (nonFailPoints.length > 0) {
      const errorRate = result.errorCount / nonFailPoints.length;
      expect(errorRate).toBeLessThan(0.5); // Less than 50% error rate on sphere
    }
  }, 60_000);

  it('density parameter controls number of test points', () => {
    const small = SurfaceVerifier.runBulletOriginTest('torus', 2);
    const larger = SurfaceVerifier.runBulletOriginTest('torus', 4);

    expect(larger.points.length).toBeGreaterThan(small.points.length);
  });

  it('offsetDistance is null for no-bullet points', () => {
    const result = SurfaceVerifier.runBulletOriginTest('sphere', 2);

    for (const point of result.points) {
      if (point.status === 'no-bullet' || point.status === 'teleport-failed') {
        expect(point.offsetDistance).toBeNull();
      }
    }
  });
});
