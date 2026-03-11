/**
 * Tests for Game.setVisualMode() — pixelated vs modern bloom resolution toggle.
 *
 * Regression test: setVisualMode updates bloomResolutionScale and resizes
 * the EffectComposer/BloomPass render targets accordingly.
 *
 * This test FAILS if setVisualMode is removed or stops resizing the composer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../core/Game';

// ---------------------------------------------------------------------------
// DOM shims (same pattern as BloomResolution.test.ts)
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
    resolution: { set: (w: number, h: number) => void; width?: number; height?: number };
    strength: number = 1.0;
    threshold: number = 0.3;
    radius: number = 0.5;
    constructor(res: any, s: number, r: number, t: number) {
      this.resolution = { set: (w: number, h: number) => { this.resolution.width = w; this.resolution.height = h; } };
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
      this.domElement = {
        style: {},
        width: 1920,
        height: 1080,
        addEventListener: _noopEvent,
        removeEventListener: _noopEvent,
      };
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
      if (target) { target.width = 1920; target.height = 1080; return target; }
      return { width: 1920, height: 1080 };
    }
    dispose() {}
    render(_scene: any, _camera: any) {}
    getContext() {
      return { canvas: { width: 1920, height: 1080 }, getExtension: () => null, getParameter: () => 16 };
    }
  }

  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Game.setVisualMode', () => {
  beforeEach(() => {
    composerSetSizeCalls.length = 0;
    globalThis.window.innerWidth = 1920;
    globalThis.window.innerHeight = 1080;
  });

  it('defaults to pixelated (bloomResolutionScale = 0.5)', () => {
    const game = new Game({ bloom: { strength: 1.0 } });
    expect(game.bloomResolutionScale).toBe(0.5);
    game.stop();
  });

  it('setVisualMode("modern") sets bloomResolutionScale to 1.0', () => {
    const game = new Game({ bloom: { strength: 1.0 } });
    game.setVisualMode('modern');
    expect(game.bloomResolutionScale).toBe(1.0);
    game.stop();
  });

  it('setVisualMode("pixelated") sets bloomResolutionScale to 0.5', () => {
    const game = new Game({ bloom: { strength: 1.0 } });
    game.setVisualMode('modern');
    game.setVisualMode('pixelated');
    expect(game.bloomResolutionScale).toBe(0.5);
    game.stop();
  });

  it('setVisualMode("modern") resizes composer to full resolution', () => {
    const game = new Game({ bloom: { strength: 1.0 } });
    composerSetSizeCalls.length = 0; // clear construction calls

    game.setVisualMode('modern');

    expect(composerSetSizeCalls.length).toBeGreaterThan(0);
    const call = composerSetSizeCalls[composerSetSizeCalls.length - 1];
    expect(call[0]).toBe(1920); // full width
    expect(call[1]).toBe(1080); // full height

    game.stop();
  });

  it('setVisualMode("pixelated") resizes composer to half resolution', () => {
    const game = new Game({ bloom: { strength: 1.0 } });
    // First switch to modern so we have a clean state
    game.setVisualMode('modern');
    composerSetSizeCalls.length = 0;

    game.setVisualMode('pixelated');

    expect(composerSetSizeCalls.length).toBeGreaterThan(0);
    const call = composerSetSizeCalls[composerSetSizeCalls.length - 1];
    expect(call[0]).toBe(960);  // half of 1920
    expect(call[1]).toBe(540);  // half of 1080

    game.stop();
  });

  it('toggles between modes correctly', () => {
    const game = new Game({ bloom: { strength: 1.0 } });

    game.setVisualMode('modern');
    expect(game.bloomResolutionScale).toBe(1.0);

    game.setVisualMode('pixelated');
    expect(game.bloomResolutionScale).toBe(0.5);

    game.setVisualMode('modern');
    expect(game.bloomResolutionScale).toBe(1.0);

    game.stop();
  });
});

// ---------------------------------------------------------------------------
// WebGPU path tests — setVisualMode must adjust pixel ratio (not composer)
// Regression: before fix, setVisualMode was a no-op on WebGPU (composer = null)
// ---------------------------------------------------------------------------

describe('Game.setVisualMode — WebGPU path', () => {
  beforeEach(() => {
    composerSetSizeCalls.length = 0;
    globalThis.window.innerWidth = 1920;
    globalThis.window.innerHeight = 1080;
  });

  function makeWebGPUGame(): Game {
    // Inject _isWebGPU=true so Game skips EffectComposer and uses WebGPU path
    return new Game({ bloom: { strength: 1.0 }, _isWebGPU: true });
  }

  it('setVisualMode("pixelated") sets pixelRatio to 0.5 on WebGPU', () => {
    const game = makeWebGPUGame();
    const renderer = game.renderer as any;
    game.setVisualMode('pixelated');
    expect(renderer.getPixelRatio()).toBe(0.5);
    game.stop();
  });

  it('setVisualMode("modern") restores base pixelRatio on WebGPU', () => {
    const game = makeWebGPUGame();
    const renderer = game.renderer as any;
    const baseRatio = renderer.getPixelRatio();
    game.setVisualMode('pixelated');
    game.setVisualMode('modern');
    expect(renderer.getPixelRatio()).toBe(baseRatio);
    game.stop();
  });

  it('does NOT resize composer on WebGPU (composer is null)', () => {
    const game = makeWebGPUGame();
    composerSetSizeCalls.length = 0;
    game.setVisualMode('pixelated');
    game.setVisualMode('modern');
    expect(composerSetSizeCalls.length).toBe(0);
    game.stop();
  });

  it('sets bloomResolutionScale correctly on WebGPU', () => {
    const game = makeWebGPUGame();
    game.setVisualMode('modern');
    expect(game.bloomResolutionScale).toBe(1.0);
    game.setVisualMode('pixelated');
    expect(game.bloomResolutionScale).toBe(0.5);
    game.stop();
  });
});
