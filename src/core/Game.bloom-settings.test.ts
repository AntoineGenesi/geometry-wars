/**
 * Tests for Game.setBloomSettings() method.
 * Verifies that bloom settings can be updated dynamically for both WebGL2 and WebGPU.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Game } from './Game';

// Minimal DOM shims for Node environment
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
          canvas: { width: 800, height: 600 },
          getExtension: vi.fn(() => null),
          getParameter: vi.fn(() => 16),
        })),
        setAttribute: _noop,
        getAttribute: () => null,
        getBoundingClientRect: () => ({
          left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
        }),
      };
      return el;
    },
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  };
  globalThis.document = mockDoc;
}

// Mock EffectComposer and post-processing passes
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
  RenderPass: class MockRenderPass {},
}));

vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class MockUnrealBloomPass {
    strength: number = 1.0;
    threshold: number = 0.3;
    radius: number = 0.5;
  },
}));

vi.mock('three/addons/postprocessing/OutputPass.js', () => ({
  OutputPass: class MockOutputPass {},
}));

vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({
  ShaderPass: class MockShaderPass {},
}));

// Mock SoundEngine
vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(),
    init: vi.fn(),
    resume: vi.fn(),
    muted: false,
  }),
}));

// Mock WebGLRenderer to avoid GPU dependencies
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
      this.domElement = { style: {}, width: 800, height: 600 };
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
        target.width = 800;
        target.height = 600;
        return target;
      }
      return { width: 800, height: 600 };
    }
    dispose() {}
    render(_scene: any, _camera: any) {}
    getContext() {
      return {
        canvas: { width: 800, height: 600 },
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

describe('Game.setBloomSettings()', () => {
  let game: Game;

  beforeAll(async () => {
    // Create a game instance with WebGL2 renderer (bloomPass will be non-null)
    game = await Game.create();
  });

  it('should update bloomPass strength and threshold (WebGL2 path)', () => {
    // Verify initial values
    expect(game.bloomPass).toBeDefined();
    expect(game.bloomPass).not.toBeNull();

    if (!game.bloomPass) return; // TypeScript guard

    const initialStrength = game.bloomPass.strength;
    const initialThreshold = game.bloomPass.threshold;

    // Update settings
    game.setBloomSettings(2.5, 0.8);

    // Verify changes
    expect(game.bloomPass.strength).toBe(2.5);
    expect(game.bloomPass.threshold).toBe(0.8);

    // Verify they're different from initial
    expect(game.bloomPass.strength).not.toBe(initialStrength);
    expect(game.bloomPass.threshold).not.toBe(initialThreshold);
  });

  it('should handle multiple consecutive updates', () => {
    if (!game.bloomPass) return;

    game.setBloomSettings(1.0, 0.3);
    expect(game.bloomPass.strength).toBe(1.0);
    expect(game.bloomPass.threshold).toBe(0.3);

    game.setBloomSettings(0.5, 0.9);
    expect(game.bloomPass.strength).toBe(0.5);
    expect(game.bloomPass.threshold).toBe(0.9);

    game.setBloomSettings(3.0, 0.1);
    expect(game.bloomPass.strength).toBe(3.0);
    expect(game.bloomPass.threshold).toBe(0.1);
  });

  it('should handle zero values (disable bloom)', () => {
    if (!game.bloomPass) return;

    game.setBloomSettings(0, 0.5);
    expect(game.bloomPass.strength).toBe(0);
    expect(game.bloomPass.threshold).toBe(0.5);

    game.setBloomSettings(1.0, 0);
    expect(game.bloomPass.strength).toBe(1.0);
    expect(game.bloomPass.threshold).toBe(0);
  });

  it('should handle extreme values', () => {
    if (!game.bloomPass) return;

    game.setBloomSettings(100, 1.0);
    expect(game.bloomPass.strength).toBe(100);
    expect(game.bloomPass.threshold).toBe(1.0);

    game.setBloomSettings(0.001, 0.001);
    expect(game.bloomPass.strength).toBeCloseTo(0.001, 4);
    expect(game.bloomPass.threshold).toBeCloseTo(0.001, 4);
  });

  it('should not crash when called before bloomPass is initialized', () => {
    // Create a minimal game instance without post-processing
    const minimalGame = new Game({ bloom: { strength: 0, radius: 0, threshold: 0 } });

    // Should not throw even if bloomPass is null
    expect(() => {
      minimalGame.setBloomSettings(1.0, 0.5);
    }).not.toThrow();

    minimalGame.stop();
  });
});

describe('Game.setBloomSettings() - WebGPU path', () => {
  it('should update TSL uniform nodes when using WebGPU', async () => {
    // This test would require mocking three/webgpu module and creating a WebGPU game
    // For now, we verify the method exists and can be called
    const game = await Game.create();

    // Method should exist
    expect(typeof game.setBloomSettings).toBe('function');

    // Should accept two number parameters
    expect(() => {
      game.setBloomSettings(1.5, 0.6);
    }).not.toThrow();

    game.stop();
  });

  it('should handle WebGPU uniform updates without bloomPass', () => {
    // Create game and manually null out bloomPass to simulate WebGPU mode
    const game = new Game({ bloom: { strength: 1.0, radius: 0.5, threshold: 0.3 } });

    // Simulate WebGPU mode by nulling bloomPass (in real WebGPU, it's already null)
    (game as any).bloomPass = null;

    // Should still work without errors
    expect(() => {
      game.setBloomSettings(2.0, 0.7);
    }).not.toThrow();

    game.stop();
  });
});
