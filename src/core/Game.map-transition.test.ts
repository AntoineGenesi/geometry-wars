/**
 * Regression test for cross-map entity contamination bug (s44r5-05).
 *
 * Root cause: When transitioning between maps (SP level complete), `game.stop()`
 * was called but NOT `game.dispose()`. The old WebGL canvas was left in the DOM.
 * CSS `canvas { height: 100% }` with `body { height: 100%; overflow: hidden }`
 * caused the old canvas to fill the viewport while the new canvas was pushed
 * below the viewport (hidden by overflow). The user saw the frozen old frame
 * (e.g., pill map entities) instead of the new map.
 *
 * Fix: call `game.dispose()` on level transition, which calls
 * `this.renderer.domElement.remove()` to remove the old canvas from the DOM.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Game } from './Game';

// Track DOM children for the mock body
const bodyChildren: any[] = [];

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
      appendChild: (child: any) => { bodyChildren.push(child); },
      removeChild: (child: any) => {
        const idx = bodyChildren.indexOf(child);
        if (idx !== -1) bodyChildren.splice(idx, 1);
      },
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
        appendChild: (child: any) => { el._children = el._children || []; el._children.push(child); },
        removeChild: (child: any) => {
          el._children = (el._children || []).filter((c: any) => c !== child);
        },
        remove: function() {
          const parent = (globalThis.document as any).body;
          const idx = bodyChildren.indexOf(this);
          if (idx !== -1) bodyChildren.splice(idx, 1);
        },
        addEventListener: _noopEvent,
        removeEventListener: _noopEvent,
        getContext: vi.fn(() => ({
          canvas: { width: 800, height: 600 },
          getExtension: vi.fn(() => null),
          getParameter: vi.fn(() => 16),
          enable: vi.fn(),
          disable: vi.fn(),
          clearColor: vi.fn(),
          clear: vi.fn(),
          scissor: vi.fn(),
          viewport: vi.fn(),
          bindFramebuffer: vi.fn(),
          blendEquation: vi.fn(),
          blendFuncSeparate: vi.fn(),
          getShaderPrecisionFormat: vi.fn(() => ({ precision: 1, rangeMin: 1, rangeMax: 1 })),
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

// Mock post-processing
vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class MockEffectComposer {
    passes: any[] = [];
    addPass(_pass: any) {}
    render() {}
    setSize() {}
    dispose() {}
  },
}));
vi.mock('three/addons/postprocessing/RenderPass.js', () => ({ RenderPass: class {} }));
vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class {
    strength = 1.0;
    threshold = 0.3;
    radius = 0.5;
    resolution = { set: vi.fn() };
  },
}));
vi.mock('three/addons/postprocessing/OutputPass.js', () => ({ OutputPass: class {} }));
vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({ ShaderPass: class {} }));
vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({ play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false }),
}));

// Mock WebGLRenderer - track its domElement and simulate remove()
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();

  class MockWebGLRenderer {
    domElement: any;
    toneMapping: any = 0;
    toneMappingExposure: number = 1;
    shadowMap: any = { enabled: false };
    outputColorSpace: any = '';
    info: any = { render: { frame: 0, calls: 0 } };
    capabilities: any = { isWebGL2: true };
    private _pixelRatio: number = 1;

    constructor(_opts?: any) {
      // Create a mock canvas element with remove() that removes from bodyChildren
      const el: any = {
        tagName: 'CANVAS',
        style: {},
        addEventListener: _noopEvent,
        removeEventListener: _noopEvent,
        remove: function() {
          const idx = bodyChildren.indexOf(this);
          if (idx !== -1) bodyChildren.splice(idx, 1);
        },
      };
      // Append to body when created (simulating Three.js behavior)
      bodyChildren.push(el);
      this.domElement = el;
    }

    setPixelRatio(ratio: number) { this._pixelRatio = ratio; }
    getPixelRatio() { return this._pixelRatio; }
    setSize(_w: number, _h: number) {}
    getSize(target?: any) {
      if (target) { target.width = 800; target.height = 600; return target; }
      return { width: 800, height: 600 };
    }
    dispose() {}
    render(_scene: any, _camera: any) {}
    getContext() {
      return { canvas: { width: 800, height: 600 }, getExtension: () => null, getParameter: () => 16 };
    }
  }

  return { ...actual, WebGLRenderer: MockWebGLRenderer };
});

describe('Game map transition — canvas cleanup (s44r5-05 regression)', () => {
  beforeEach(() => {
    // Clear bodyChildren before each test
    bodyChildren.length = 0;
  });

  afterEach(() => {
    bodyChildren.length = 0;
  });

  it('BUG: game.stop() leaves old canvas in DOM (causes contamination)', () => {
    // First game (e.g., pill map)
    const game1 = new Game();
    expect(bodyChildren.length).toBe(1); // canvas1 in DOM

    // Level complete — OLD (buggy) behavior: only stop(), not dispose()
    game1.stop();

    // Second game (e.g., mobius map)
    const game2 = new Game();
    // BUG: both canvases in DOM — old one is visible, new one is hidden by CSS overflow:hidden
    expect(bodyChildren.length).toBe(2);

    game2.stop();
  });

  it('FIX: game.dispose() removes old canvas from DOM before new game starts', () => {
    // First game (e.g., pill map)
    const game1 = new Game();
    expect(bodyChildren.length).toBe(1); // canvas1 in DOM

    // Level complete — NEW (fixed) behavior: dispose() removes canvas from DOM
    game1.dispose();
    expect(bodyChildren.length).toBe(0); // canvas1 removed

    // Second game (e.g., mobius map)
    const game2 = new Game();
    // FIX: only new canvas in DOM — no contamination
    expect(bodyChildren.length).toBe(1);

    game2.dispose();
    expect(bodyChildren.length).toBe(0);
  });
});
