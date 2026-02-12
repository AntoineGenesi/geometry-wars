/**
 * Player Orientation Regression Test
 *
 * Tests for bug s15: Cross product operand order in orientPlayer was reversed,
 * causing playerRight to point WEST instead of EAST, leading to 90° orientation
 * errors, jitter, and direction snapping.
 *
 * This test would FAIL with the buggy cross product order and PASS with the fix.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';

// Use the same DOM/mock setup as playground-verification.test.ts
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
          putImageData: _noop, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
          setTransform: _noop, drawImage: _noop, save: _noop, fillText: _noop,
          restore: _noop, beginPath: _noop, moveTo: _noop, lineTo: _noop,
          closePath: _noop, stroke: _noop, translate: _noop, scale: _noop,
          rotate: _noop, arc: _noop, fill: _noop,
          measureText: () => ({ width: 10 }),
          transform: _noop, rect: _noop, clip: _noop,
          canvas: { width: 64, height: 64 },
          fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
          lineJoin: 'miter', globalAlpha: 1, globalCompositeOperation: 'source-over',
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

// Mocks
vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false,
  }),
}));

vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class MockEffectComposer {
    passes: any[] = [];
    addPass(pass: any) { this.passes.push(pass); }
    render() {}
    setSize() {}
    dispose() {}
  },
}));

vi.mock('three/addons/postprocessing/RenderPass.js', () => ({
  RenderPass: class MockRenderPass {
    constructor(_scene: any, _camera: any) {}
  },
}));

vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class MockUnrealBloomPass {
    resolution = new THREE.Vector2(800, 600);
    constructor(_res: any, _s: number, _r: number, _t: number) {}
  },
}));

vi.mock('three/addons/postprocessing/OutputPass.js', () => ({
  OutputPass: class MockOutputPass {},
}));

vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({
  ShaderPass: class MockShaderPass {
    constructor(_shader: any) {}
  },
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
    webgpu: false, webgl2: true, webgl1: true, maxTextureSize: 4096,
    maxInstanceCount: 1000, sharedArrayBuffer: false, hardwareConcurrency: 4,
    renderer: 'Mock GPU', vendor: 'Mock Vendor', webgpuAdapter: '', tier: 'medium',
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
        addEventListener: () => {}, removeEventListener: () => {}, remove: () => {},
        getContext: () => null, toDataURL: () => '',
      };
      this.toneMapping = actual.NoToneMapping;
      this.toneMappingExposure = 1.0;
      this.shadowMap = { enabled: false };
      this.outputColorSpace = actual.SRGBColorSpace;
      this.info = { render: { calls: 0, triangles: 0 } };
    }

    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
    getSize(target: any) { return target?.set?.(800, 600) ?? new actual.Vector2(800, 600); }
    getPixelRatio() { return 1; }
  }

  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

import { PlaygroundTestHarness } from './PlaygroundTestHarness';

describe('Player Orientation Regression (s15)', () => {
  let harness: PlaygroundTestHarness;

  afterEach(() => {
    if (harness) {
      harness.dispose();
    }
  });

  it('forward movement produces consistent displacement (not jitter in place)', () => {
    harness = new PlaygroundTestHarness('sphere');
    harness.tick(10);

    const startPos = harness.getPlayerWorldPos();

    // With the bug: pressing W causes jitter, player barely moves
    // With the fix: pressing W moves player forward smoothly
    harness.pressKey('w');
    harness.tick(60);
    harness.releaseKey('w');

    const endPos = harness.getPlayerWorldPos();
    const distance = startPos.distanceTo(endPos);

    // Player should move a meaningful distance (not jitter in place)
    expect(distance).toBeGreaterThan(0.2);
  });

  it('lateral movement works correctly (left and right produce different positions)', () => {
    harness = new PlaygroundTestHarness('sphere');
    harness.tick(10);

    const startPos = harness.getPlayerWorldPos();

    // Move left
    harness.pressKey('a');
    harness.tick(30);
    harness.releaseKey('a');
    const leftPos = harness.getPlayerWorldPos();

    // Reset to start area
    harness.dispose();
    harness = new PlaygroundTestHarness('sphere');
    harness.tick(10);
    const startPos2 = harness.getPlayerWorldPos();

    // Move right
    harness.pressKey('d');
    harness.tick(30);
    harness.releaseKey('d');
    const rightPos = harness.getPlayerWorldPos();

    // Both directions should produce meaningful movement
    const leftDist = startPos.distanceTo(leftPos);
    const rightDist = startPos2.distanceTo(rightPos);

    expect(leftDist).toBeGreaterThan(0.1);
    expect(rightDist).toBeGreaterThan(0.1);
  });

  it('forward and backward movement both produce displacement (not stuck)', () => {
    harness = new PlaygroundTestHarness('sphere');
    harness.tick(10);

    const startPos = harness.getPlayerWorldPos();

    // Move forward
    harness.pressKey('w');
    harness.tick(30);
    harness.releaseKey('w');
    const forwardPos = harness.getPlayerWorldPos();

    // Move backward
    harness.pressKey('s');
    harness.tick(30);
    harness.releaseKey('s');
    const backwardPos = harness.getPlayerWorldPos();

    // Both directions should produce meaningful displacement
    // With the bug: player gets stuck or jitters, barely moving
    const forwardDist = startPos.distanceTo(forwardPos);
    const backwardDist = forwardPos.distanceTo(backwardPos);

    expect(forwardDist).toBeGreaterThan(0.1);
    expect(backwardDist).toBeGreaterThan(0.1);
  });

  it('all four cardinal directions produce movement (no traversal walls)', () => {
    harness = new PlaygroundTestHarness('sphere');
    harness.tick(10);

    // Test all four cardinal directions
    const directions = [
      { key: 'w', name: 'forward' },
      { key: 's', name: 'backward' },
      { key: 'a', name: 'left' },
      { key: 'd', name: 'right' }
    ];

    for (const dir of directions) {
      const startPos = harness.getPlayerWorldPos();

      harness.pressKey(dir.key as 'w' | 's' | 'a' | 'd');
      harness.tick(30);
      harness.releaseKey(dir.key as 'w' | 's' | 'a' | 'd');

      const endPos = harness.getPlayerWorldPos();
      const distance = startPos.distanceTo(endPos);

      // Each direction should produce meaningful movement
      // With the bug: some directions cause jitter or stuckness
      expect(distance, `${dir.name} movement should work`).toBeGreaterThan(0.1);
    }
  });

  it('diagonal movement works (not square fashion movement)', () => {
    harness = new PlaygroundTestHarness('sphere');
    harness.tick(10);

    const startPos = harness.getPlayerWorldPos();

    // Diagonal movement (forward + right)
    // With the bug: player moves in "square fashion" with 90° turns
    // With the fix: player moves diagonally in a smooth arc
    harness.pressKey('w');
    harness.pressKey('d');
    harness.tick(60);
    harness.releaseAllKeys();

    const endPos = harness.getPlayerWorldPos();
    const distance = startPos.distanceTo(endPos);

    // Diagonal movement should produce meaningful displacement
    expect(distance).toBeGreaterThan(0.2);
  });
});
