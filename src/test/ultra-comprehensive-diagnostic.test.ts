/**
 * Ultra-Comprehensive Diagnostic Test
 *
 * Goes BEYOND frame-by-frame to capture:
 * - Intermediate calculation steps
 * - Cross product verification
 * - Orthonormality checks
 * - Continuity dot products
 * - Before/after state changes
 *
 * This is the MOST DETAILED diagnostic possible without visual rendering.
 */

import { describe, it, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Standard DOM/mock setup (same as other tests)
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
      getBoundingClientRect: () => ({
        left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
      }),
      addEventListener: _noopEvent, removeEventListener: _noopEvent,
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

const OUTPUT_DIR = join(process.cwd(), 'test-data', 'diagnostics');
mkdirSync(OUTPUT_DIR, { recursive: true });

interface UltraFrameData {
  frame: number;
  // Tangent frame BEFORE and AFTER tick
  tangentFrameBefore: {
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
    normal: THREE.Vector3;
  };
  tangentFrameAfter: {
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
    normal: THREE.Vector3;
  };
  // Verification: is tangent frame orthonormal?
  tangentFrameQuality: {
    tangentLength: number;
    bitangentLength: number;
    normalLength: number;
    tangentDotBitangent: number; // should be ~0
    tangentDotNormal: number; // should be ~0
    bitangentDotNormal: number; // should be ~0
    crossProductCheck: number; // bitangent · (normal × tangent) should be ~1
    handedness: 'right' | 'left' | 'degenerate';
  };
  // Aim direction calculation
  aimDirection: THREE.Vector3;
  aimDirectionSource: 'mouse' | 'default-bitangent';
  // Orientation calculation
  playerRight: THREE.Vector3;
  playerForward: THREE.Vector3;
  playerNormal: THREE.Vector3;
  // Verify orientation basis
  orientationQuality: {
    rightLength: number;
    forwardLength: number;
    normalLength: number;
    rightDotForward: number;
    rightDotNormal: number;
    forwardDotNormal: number;
    handedness: 'right' | 'left' | 'degenerate';
  };
  // Cross product verification
  crossProductVerification: {
    // playerRight should equal playerNormal × aimDirection
    expectedPlayerRight: THREE.Vector3;
    actualPlayerRight: THREE.Vector3;
    difference: number;
    // playerForward should equal playerRight × playerNormal
    expectedPlayerForward: THREE.Vector3;
    actualPlayerForward: THREE.Vector3;
    forwardDifference: number;
  };
  // Did tangent/bitangent swap?
  tangentBitangentSwapped: boolean;
  tangentFlipped: boolean;
  bitangentFlipped: boolean;
}

describe('Ultra-Comprehensive Diagnostic', () => {
  let harness: PlaygroundTestHarness;

  afterEach(() => {
    if (harness) {
      harness.dispose();
    }
  });

  it('captures first 10 frames of forward movement with full detail', () => {
    harness = new PlaygroundTestHarness('sphere');
    harness.tick(10); // Settle

    const frames: UltraFrameData[] = [];

    harness.pressKey('w');
    for (let i = 0; i < 10; i++) {
      const walker = (harness.pg as any)._walker;

      // Capture BEFORE tick
      const frameBefore = walker.getTangentFrame();
      const tangentBefore = frameBefore.tangent.clone();
      const bitangentBefore = frameBefore.bitangent.clone();
      const normalBefore = frameBefore.normal.clone();

      // Tick the game
      harness.tick(1);

      // Capture AFTER tick
      const frameAfter = walker.getTangentFrame();
      const tangentAfter = frameAfter.tangent.clone();
      const bitangentAfter = frameAfter.bitangent.clone();
      const normalAfter = frameAfter.normal.clone();

      // Get aim direction (from PlaygroundGame logic)
      const aimDirection = bitangentAfter.clone(); // Default aim (no mouse)

      // Calculate player orientation (from PlaygroundGame logic)
      const playerNormal = normalAfter.clone();
      const playerRight = new THREE.Vector3().crossVectors(playerNormal, aimDirection).normalize();
      const playerForward = new THREE.Vector3().crossVectors(playerRight, playerNormal).normalize();

      // Verify tangent frame quality
      const tQuality = {
        tangentLength: tangentAfter.length(),
        bitangentLength: bitangentAfter.length(),
        normalLength: normalAfter.length(),
        tangentDotBitangent: tangentAfter.dot(bitangentAfter),
        tangentDotNormal: tangentAfter.dot(normalAfter),
        bitangentDotNormal: bitangentAfter.dot(normalAfter),
        crossProductCheck: bitangentAfter.dot(new THREE.Vector3().crossVectors(normalAfter, tangentAfter)),
        handedness: (new THREE.Vector3().crossVectors(tangentAfter, bitangentAfter).dot(normalAfter) > 0.5 ? 'right' : 'left') as 'right' | 'left',
      };

      // Verify orientation basis quality
      const oQuality = {
        rightLength: playerRight.length(),
        forwardLength: playerForward.length(),
        normalLength: playerNormal.length(),
        rightDotForward: playerRight.dot(playerForward),
        rightDotNormal: playerRight.dot(playerNormal),
        forwardDotNormal: playerForward.dot(playerNormal),
        handedness: (new THREE.Vector3().crossVectors(playerRight, playerForward).dot(playerNormal) > 0.5 ? 'right' : 'left') as 'right' | 'left',
      };

      // Cross product verification
      const expectedPlayerRight = new THREE.Vector3().crossVectors(playerNormal, aimDirection).normalize();
      const expectedPlayerForward = new THREE.Vector3().crossVectors(playerRight, playerNormal).normalize();

      const crossProductVerification = {
        expectedPlayerRight: expectedPlayerRight.clone(),
        actualPlayerRight: playerRight.clone(),
        difference: expectedPlayerRight.distanceTo(playerRight),
        expectedPlayerForward: expectedPlayerForward.clone(),
        actualPlayerForward: playerForward.clone(),
        forwardDifference: expectedPlayerForward.distanceTo(playerForward),
      };

      // Check if tangent/bitangent swapped or flipped
      const tangentDotPrevBitangent = tangentAfter.dot(bitangentBefore);
      const bitangentDotPrevTangent = bitangentAfter.dot(tangentBefore);
      const tangentDotPrevTangent = tangentAfter.dot(tangentBefore);
      const bitangentDotPrevBitangent = bitangentAfter.dot(bitangentBefore);

      const tangentBitangentSwapped = Math.abs(tangentDotPrevBitangent) > 0.9 && Math.abs(bitangentDotPrevTangent) > 0.9;
      const tangentFlipped = tangentDotPrevTangent < -0.9;
      const bitangentFlipped = bitangentDotPrevBitangent < -0.9;

      frames.push({
        frame: i,
        tangentFrameBefore: {
          tangent: tangentBefore,
          bitangent: bitangentBefore,
          normal: normalBefore,
        },
        tangentFrameAfter: {
          tangent: tangentAfter,
          bitangent: bitangentAfter,
          normal: normalAfter,
        },
        tangentFrameQuality: tQuality,
        aimDirection: aimDirection.clone(),
        aimDirectionSource: 'default-bitangent',
        playerRight: playerRight.clone(),
        playerForward: playerForward.clone(),
        playerNormal: playerNormal.clone(),
        orientationQuality: oQuality,
        crossProductVerification,
        tangentBitangentSwapped,
        tangentFlipped,
        bitangentFlipped,
      });
    }
    harness.releaseKey('w');

    // Save ultra-detailed report
    const filename = `s15-ultra-diagnostic-${Date.now()}.json`;
    writeFileSync(join(OUTPUT_DIR, filename), JSON.stringify(frames, null, 2));

    console.log(`\n🔬 Ultra-diagnostic report saved: test-data/diagnostics/${filename}`);
    console.log(`\n📊 Frame Analysis:`);
    frames.forEach((f, idx) => {
      console.log(`\nFrame ${idx}:`);
      console.log(`  Tangent/Bitangent swapped: ${f.tangentBitangentSwapped}`);
      console.log(`  Tangent flipped: ${f.tangentFlipped}`);
      console.log(`  Bitangent flipped: ${f.bitangentFlipped}`);
      console.log(`  Frame handedness: ${f.tangentFrameQuality.handedness}`);
      console.log(`  Orientation handedness: ${f.orientationQuality.handedness}`);
      console.log(`  Cross product check: ${f.tangentFrameQuality.crossProductCheck.toFixed(4)} (should be ~1.0)`);
    });
  });
});
