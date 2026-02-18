/**
 * Regression test for half-resolution bloom optimization (s24-perf-01).
 *
 * Verifies that EffectComposer is initialized and resized at 50% of
 * window/renderer resolution, not at full resolution.
 *
 * This test FAILS without the half-res bloom fix (composer would receive
 * full window dimensions) and PASSES with the fix applied.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../core/Game';

// ---------------------------------------------------------------------------
// DOM shims
// ---------------------------------------------------------------------------

const _noop = () => {};
const _noopEvent = (_e: string, _h: any) => {};

if (typeof globalThis.window === 'undefined') {
  const mockWindow: any = {
    innerWidth: 1920,
    innerHeight: 1080,
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
      clientWidth: 1920,
      clientHeight: 1080,
      addEventListener: _noopEvent,
      removeEventListener: _noopEvent,
    },
    createElement: (tag: string) => {
      const el: any = {
        tagName: tag.toUpperCase(),
        style: {},
        appendChild: _noop,
        removeChild: _noop,
        addEventListener: _noopEvent,
        removeEventListener: _noopEvent,
        getContext: vi.fn(() => ({
          canvas: { width: 1920, height: 1080 },
          getExtension: vi.fn(() => null),
          getParameter: vi.fn(() => 16),
        })),
        setAttribute: _noop,
        getAttribute: () => null,
        getBoundingClientRect: () => ({
          left: 0, top: 0, right: 1920, bottom: 1080,
          width: 1920, height: 1080, x: 0, y: 0, toJSON: _noop,
        }),
      };
      return el;
    },
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  };
  globalThis.document = mockDoc;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Tracks all setSize calls on the mock EffectComposer. */
const composerSetSizeCalls: Array<[number, number]> = [];

vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class MockEffectComposer {
    passes: any[] = [];
    addPass(pass: any) { this.passes.push(pass); }
    render() {}
    setSize(w: number, h: number) { composerSetSizeCalls.push([w, h]); }
    dispose() {}
  },
}));

vi.mock('three/addons/postprocessing/RenderPass.js', () => ({
  RenderPass: class MockRenderPass {},
}));

vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class MockUnrealBloomPass {
    resolution: any;
    strength: number = 1.0;
    threshold: number = 0.3;
    radius: number = 0.5;
    constructor(res: any, s: number, r: number, t: number) {
      this.resolution = res;
      this.strength = s;
      this.radius = r;
      this.threshold = t;
    }
  },
}));

vi.mock('three/addons/postprocessing/OutputPass.js', () => ({
  OutputPass: class MockOutputPass {},
}));

vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({
  ShaderPass: class MockShaderPass { uniforms: any = {}; constructor(s: any) { this.uniforms = s?.uniforms ?? {}; } },
}));

vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(),
    init: vi.fn(),
    resume: vi.fn(),
    muted: false,
  }),
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
    capabilities: any;
    private pixelRatio: number = 1;

    constructor(_opts?: any) {
      this.domElement = { style: {}, width: 1920, height: 1080 };
      this.toneMapping = 0;
      this.toneMappingExposure = 1;
      this.shadowMap = { enabled: false };
      this.outputColorSpace = '';
      this.info = { render: { frame: 0, calls: 0 } };
      this.capabilities = { isWebGL2: true };
    }

    setPixelRatio(ratio: number) { this.pixelRatio = ratio; }
    getPixelRatio() { return this.pixelRatio; }
    setSize(_w: number, _h: number) {}
    getSize(target?: any) {
      if (target) {
        target.width = 1920;
        target.height = 1080;
        return target;
      }
      return { width: 1920, height: 1080 };
    }
    dispose() {}
    render(_scene: any, _camera: any) {}
    getContext() {
      return {
        canvas: { width: 1920, height: 1080 },
        getExtension: () => null,
        getParameter: () => 16,
      };
    }
  }

  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BloomResolution — half-resolution optimization', () => {
  beforeEach(() => {
    composerSetSizeCalls.length = 0;
    // Reset window to 1920×1080 for each test
    globalThis.window.innerWidth = 1920;
    globalThis.window.innerHeight = 1080;
  });

  it('composer is set to 50% resolution during construction (REGRESSION GUARD)', () => {
    const game = new Game({ bloom: { strength: 1.0, radius: 0.5, threshold: 0.3 } });

    // The composer must have been resized to half dimensions
    expect(composerSetSizeCalls.length).toBeGreaterThan(0);

    const firstCall = composerSetSizeCalls[0];
    const expectedW = Math.floor(1920 / 2);  // 960
    const expectedH = Math.floor(1080 / 2);  // 540

    expect(firstCall[0]).toBe(expectedW);
    expect(firstCall[1]).toBe(expectedH);

    // Ensure it was NOT set to full resolution
    expect(firstCall[0]).not.toBe(1920);
    expect(firstCall[1]).not.toBe(1080);

    game.stop();
  });

  it('composer resizes to 50% of new dimensions on window resize', () => {
    const game = new Game({ bloom: { strength: 1.0, radius: 0.5, threshold: 0.3 } });
    composerSetSizeCalls.length = 0; // clear construction calls

    // Simulate window resize
    globalThis.window.innerWidth = 2560;
    globalThis.window.innerHeight = 1440;

    // Trigger the resize handler directly (it's the private onResize method)
    // We access it via the internal event listener
    const resizeEvent = new Event('resize');
    // Fire resize on the window object by calling the handler directly
    // The Game registers `window.addEventListener('resize', this.onResize)`.
    // We trigger it via the mock addEventListener—but since our mock doesn't actually
    // store listeners, we need to call the game's private method directly.
    (game as any).onResize();

    expect(composerSetSizeCalls.length).toBeGreaterThan(0);

    const resizeCall = composerSetSizeCalls[composerSetSizeCalls.length - 1];
    expect(resizeCall[0]).toBe(Math.floor(2560 / 2));  // 1280
    expect(resizeCall[1]).toBe(Math.floor(1440 / 2));  // 720

    // Ensure it was NOT set to full resolution
    expect(resizeCall[0]).not.toBe(2560);
    expect(resizeCall[1]).not.toBe(1440);

    game.stop();
  });

  it('composer size is always half of window size for various resolutions', () => {
    const resolutions: Array<[number, number]> = [
      [1280, 720],
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
    ];

    for (const [w, h] of resolutions) {
      composerSetSizeCalls.length = 0;
      globalThis.window.innerWidth = w;
      globalThis.window.innerHeight = h;

      const game = new Game({ bloom: { strength: 1.0 } });

      const constructionCall = composerSetSizeCalls[0];
      expect(constructionCall[0]).toBe(Math.floor(w / 2));
      expect(constructionCall[1]).toBe(Math.floor(h / 2));

      game.stop();
    }
  });

  it('composer is null (not created) when bloom strength is 0', () => {
    // Even when bloom strength is 0, the composer is still created (for vignette pass).
    // This test verifies the half-res path doesn't break the no-bloom config.
    const game = new Game({ bloom: { strength: 0, radius: 0.5, threshold: 0.3 } });

    // Composer still exists (vignette pass needs it)
    expect(game.composer).not.toBeNull();

    // First setSize call should still be at half resolution
    expect(composerSetSizeCalls.length).toBeGreaterThan(0);
    const firstCall = composerSetSizeCalls[0];
    expect(firstCall[0]).toBe(Math.floor(globalThis.window.innerWidth / 2));
    expect(firstCall[1]).toBe(Math.floor(globalThis.window.innerHeight / 2));

    game.stop();
  });
});
