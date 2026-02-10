/**
 * Verification Environment — DOM/window shims for headless game testing.
 *
 * This file sets up the minimal browser environment needed to instantiate
 * PlaygroundGame in Node/vitest. It's designed to be used as a vitest
 * setupFile OR imported directly at the top of a test file.
 *
 * WHAT THIS PROVIDES:
 * - globalThis.window (innerWidth, innerHeight, devicePixelRatio, etc.)
 * - globalThis.document (createElement, body, addEventListener)
 * - globalThis.navigator (getGamepads)
 * - globalThis.requestAnimationFrame / cancelAnimationFrame
 * - globalThis.HTMLElement
 * - globalThis.URLSearchParams
 * - Canvas 2D context mock (for texture generation)
 *
 * WHAT THIS DOES NOT PROVIDE (must be in each test file via vi.mock):
 * - Three.js WebGLRenderer mock (vi.mock('three', ...))
 * - SoundEngine mock
 * - EffectComposer / postprocessing mocks
 * - GPUCapabilities mock
 * - RendererFactory mock
 *
 * WHY: vitest hoists vi.mock() to the test file's top level. They cannot
 * be shared via imports. But DOM shims CAN be shared.
 */

const _noop = () => {};
const _noopEvent = (_e: string, _h: any) => {};

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

if (typeof globalThis.document === 'undefined') {
  const mock2dCtx = {
    fillRect: _noop, clearRect: _noop,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: _noop,
    createImageData: () => ({ data: new Uint8ClampedArray(4) }),
    setTransform: _noop, drawImage: _noop, save: _noop, fillText: _noop,
    restore: _noop, beginPath: _noop, moveTo: _noop, lineTo: _noop,
    closePath: _noop, stroke: _noop, translate: _noop, scale: _noop,
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
      appendChild: _noop, removeChild: _noop,
      style: {}, clientWidth: 800, clientHeight: 600,
      getBoundingClientRect: () => ({
        left: 0, top: 0, right: 800, bottom: 600,
        width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
      }),
      addEventListener: _noopEvent, removeEventListener: _noopEvent,
    },
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 64, height: 64, style: {},
          getContext: (type: string) => type === '2d' ? { ...mock2dCtx } : null,
          addEventListener: _noopEvent, removeEventListener: _noopEvent,
          toDataURL: () => '', remove: _noop,
        };
      }
      return {
        style: {}, clientWidth: 800, clientHeight: 600,
        appendChild: _noop, removeChild: _noop,
        getBoundingClientRect: () => ({
          left: 0, top: 0, right: 800, bottom: 600,
          width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
        }),
        addEventListener: _noopEvent, removeEventListener: _noopEvent,
      };
    },
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  };
  globalThis.document = mockDoc;
}

// ---------------------------------------------------------------------------
// Other browser globals
// ---------------------------------------------------------------------------

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
      search.replace(/^\?/, '').split('&').forEach((pair: string) => {
        const [k, v] = pair.split('=');
        if (k) this.params[k] = v ?? '';
      });
    }
    get(key: string) { return this.params[key] ?? null; }
  };
}
