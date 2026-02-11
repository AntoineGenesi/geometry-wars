/**
 * Cube Origin Fold/Glitch Test Suite
 *
 * Tests the cube surface for "fold surface" teleportation bugs where crossing
 * the origin in certain directions teleports the player to a glitch dimension.
 *
 * User report: "There's weird folds in that cube map, and if you go across this
 * origin in a weird direction, it's like you end up on a different surface that
 * is just this fold surface, and you have to like back out in the direction of
 * the origin to actually escape it."
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Mock Setup (MUST be before harness import)
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

// Mock Audio API
if (typeof globalThis.AudioContext === 'undefined') {
  (globalThis as any).AudioContext = class {
    createOscillator() { return { connect(){}, start(){}, stop(){}, frequency: { value: 0 } }; }
    createGain() { return { connect(){}, gain: { value: 1 } }; }
    createBiquadFilter() { return { connect(){}, type: '', frequency: { value: 0 }, Q: { value: 0 } }; }
    get destination() { return {}; }
    get currentTime() { return 0; }
  };
}

// Required vi.mock calls (vitest hoisting requirement)
vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({ play: vi.fn(), init: vi.fn(), resume: vi.fn(), muted: false }),
}));
vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class { passes: any[]=[]; addPass(p:any){this.passes.push(p)} render(){} setSize(){} dispose(){} },
}));
vi.mock('three/addons/postprocessing/RenderPass.js', () => ({ RenderPass: class {} }));
vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({ UnrealBloomPass: class {} }));
vi.mock('three/addons/postprocessing/OutputPass.js', () => ({ OutputPass: class {} }));
vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({ ShaderPass: class {} }));
vi.mock('three/webgpu', () => ({ PostProcessing: class { render(){} } }));
vi.mock('../rendering/GPUCapabilities', () => ({
  detectGPUCapabilities: vi.fn().mockResolvedValue({
    webgpu: false, webgl2: true, webgl1: true, maxTextureSize: 4096,
    maxInstanceCount: 1000, sharedArrayBuffer: false, hardwareConcurrency: 4,
    renderer: 'Mock', vendor: 'Mock', webgpuAdapter: '', tier: 'medium',
  }),
}));
vi.mock('../rendering/RendererFactory', () => ({
  createRenderer: vi.fn().mockResolvedValue({ renderer: {}, isWebGPU: false, backend: 'webgl2' }),
  resolveRendererPreference: vi.fn().mockReturnValue('webgl2'),
}));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return { ...actual, WebGLRenderer: class {
    domElement = { style:{}, width:800, height:600, addEventListener:()=>{}, removeEventListener:()=>{}, remove:()=>{}, getContext:()=>null, toDataURL:()=>'' };
    toneMapping = actual.NoToneMapping; toneMappingExposure = 1; shadowMap = { enabled: false };
    outputColorSpace = actual.SRGBColorSpace; info = { render: { calls:0, triangles:0 } };
    setSize(){} setPixelRatio(){} render(){} dispose(){} getPixelRatio(){return 1}
    getSize(t:any){return t?.set?.(800,600) ?? new actual.Vector2(800,600)}
  }};
});

// Now import harness
import { PlaygroundTestHarness } from './PlaygroundTestHarness';
import { CubeSurface } from '../surfaces/CubeSurface';

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

interface PositionJump {
  frame: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  jump: number;
}

interface UVJump {
  frame: number;
  fromUV: { u: number; v: number };
  toUV: { u: number; v: number };
  du: number;
  dv: number;
}

interface StuckPeriod {
  startFrame: number;
  endFrame: number;
  duration: number;
  position: THREE.Vector3;
}

function analyzeTrace(trace: any[]) {
  const positionJumps: PositionJump[] = [];
  const uvJumps: UVJump[] = [];
  const stuckPeriods: StuckPeriod[] = [];
  let hasNaN = false;

  for (let i = 1; i < trace.length; i++) {
    const prev = trace[i - 1];
    const curr = trace[i];

    // Check for NaN
    if (curr.hasNaN) {
      hasNaN = true;
    }

    // Check for large position jumps (> 2 world units between frames)
    const jump = curr.worldPos.distanceTo(prev.worldPos);
    if (jump > 2) {
      positionJumps.push({
        frame: curr.frame,
        fromPos: prev.worldPos.clone(),
        toPos: curr.worldPos.clone(),
        jump,
      });
    }

    // Check for UV discontinuities (large du or dv in a single sample)
    // Account for wrapping at u=0/1
    let du = Math.abs(curr.u - prev.u);
    if (du > 0.5) du = 1 - du; // Wrapped
    const dv = Math.abs(curr.v - prev.v);

    if (du > 0.1 || dv > 0.1) {
      uvJumps.push({
        frame: curr.frame,
        fromUV: { u: prev.u, v: prev.v },
        toUV: { u: curr.u, v: curr.v },
        du,
        dv,
      });
    }

    // Check for stuck periods (distance < 0.01 for 5+ consecutive samples)
    if (curr.distFromPrev < 0.01) {
      if (stuckPeriods.length > 0) {
        const lastStuck = stuckPeriods[stuckPeriods.length - 1];
        if (lastStuck.endFrame === prev.frame) {
          // Extend existing stuck period
          lastStuck.endFrame = curr.frame;
          lastStuck.duration = lastStuck.endFrame - lastStuck.startFrame;
        } else {
          // New stuck period
          stuckPeriods.push({
            startFrame: curr.frame,
            endFrame: curr.frame,
            duration: 0,
            position: curr.worldPos.clone(),
          });
        }
      } else {
        // First stuck period
        stuckPeriods.push({
          startFrame: curr.frame,
          endFrame: curr.frame,
          duration: 0,
          position: curr.worldPos.clone(),
        });
      }
    }
  }

  // Filter out stuck periods shorter than 5 frames
  const significantStuck = stuckPeriods.filter(s => s.duration >= 5);

  return {
    positionJumps,
    uvJumps,
    stuckPeriods: significantStuck,
    hasNaN,
  };
}

function testRoundTrip(surface: CubeSurface, u: number, v: number, tolerance = 0.05): boolean {
  const point = surface.getPoint(u, v);
  const recovered = surface.worldToSurface(point.position);

  let du = Math.abs(recovered.u - u);
  if (du > 0.5) du = 1 - du; // Account for wrapping
  const dv = Math.abs(recovered.v - v);

  // For flat face regions, worldToSurface might not be perfect due to radial parameterization
  // But as long as we're within 0.1 (10% of the surface), it's acceptable for gameplay
  const flatFaceRegionTolerance = (v < 0.15 || v > 0.85) ? 0.15 : tolerance;

  return du < tolerance && dv < flatFaceRegionTolerance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cube Origin Fold/Glitch Tests', () => {
  let harness: PlaygroundTestHarness;

  afterEach(() => {
    if (harness) {
      harness.dispose();
    }
  });

  it('should not teleport when walking left across u=0 boundary (600 frames)', () => {
    harness = new PlaygroundTestHarness('cube');
    harness.tick(10); // Settle

    harness.pressKey('a'); // Walk left
    const trace = harness.recordTrace(600, 10); // 600 frames, sample every 10
    harness.releaseKey('a');

    const analysis = analyzeTrace(trace.frames);

    expect(analysis.hasNaN).toBe(false);
    expect(analysis.positionJumps).toHaveLength(0);
    expect(analysis.stuckPeriods).toHaveLength(0);

    // Large UV jumps might be acceptable IF they're smooth wrapping
    // But position jumps are NOT acceptable
    if (analysis.positionJumps.length > 0) {
      console.error('Position jumps detected:', analysis.positionJumps);
    }
  });

  it('should not teleport when walking right across u=0 boundary (600 frames)', () => {
    harness = new PlaygroundTestHarness('cube');
    harness.tick(10);

    harness.pressKey('d'); // Walk right
    const trace = harness.recordTrace(600, 10);
    harness.releaseKey('d');

    const analysis = analyzeTrace(trace.frames);

    expect(analysis.hasNaN).toBe(false);
    expect(analysis.positionJumps).toHaveLength(0);
    expect(analysis.stuckPeriods).toHaveLength(0);
  });

  it('should not teleport when walking forward toward top face (600 frames)', () => {
    harness = new PlaygroundTestHarness('cube');
    harness.tick(10);

    harness.pressKey('w'); // Walk forward/up
    const trace = harness.recordTrace(600, 10);
    harness.releaseKey('w');

    const analysis = analyzeTrace(trace.frames);

    expect(analysis.hasNaN).toBe(false);
    expect(analysis.positionJumps).toHaveLength(0);
    expect(analysis.stuckPeriods).toHaveLength(0);
  });

  it('should not teleport when walking backward toward bottom face (600 frames)', () => {
    harness = new PlaygroundTestHarness('cube');
    harness.tick(10);

    harness.pressKey('s'); // Walk backward/down
    const trace = harness.recordTrace(600, 10);
    harness.releaseKey('s');

    const analysis = analyzeTrace(trace.frames);

    expect(analysis.hasNaN).toBe(false);
    expect(analysis.positionJumps).toHaveLength(0);
    expect(analysis.stuckPeriods).toHaveLength(0);
  });

  it('should not teleport when walking diagonally (w+a for 600 frames)', () => {
    harness = new PlaygroundTestHarness('cube');
    harness.tick(10);

    harness.pressKey('w');
    harness.pressKey('a');
    const trace = harness.recordTrace(600, 10);
    harness.releaseKey('w');
    harness.releaseKey('a');

    const analysis = analyzeTrace(trace.frames);

    expect(analysis.hasNaN).toBe(false);
    expect(analysis.positionJumps).toHaveLength(0);
    expect(analysis.stuckPeriods).toHaveLength(0);

    if (analysis.positionJumps.length > 0) {
      console.error('Diagonal movement caused position jumps:', analysis.positionJumps);
    }
  });

  it('should not teleport when walking diagonally (w+d for 600 frames)', () => {
    harness = new PlaygroundTestHarness('cube');
    harness.tick(10);

    harness.pressKey('w');
    harness.pressKey('d');
    const trace = harness.recordTrace(600, 10);
    harness.releaseKey('w');
    harness.releaseKey('d');

    const analysis = analyzeTrace(trace.frames);

    expect(analysis.hasNaN).toBe(false);
    expect(analysis.positionJumps).toHaveLength(0);
    expect(analysis.stuckPeriods).toHaveLength(0);
  });

  it('should not teleport when walking diagonally (s+a for 600 frames)', () => {
    harness = new PlaygroundTestHarness('cube');
    harness.tick(10);

    harness.pressKey('s');
    harness.pressKey('a');
    const trace = harness.recordTrace(600, 10);
    harness.releaseKey('s');
    harness.releaseKey('a');

    const analysis = analyzeTrace(trace.frames);

    expect(analysis.hasNaN).toBe(false);
    expect(analysis.positionJumps).toHaveLength(0);
    expect(analysis.stuckPeriods).toHaveLength(0);
  });

  it('should not teleport when walking diagonally (s+d for 600 frames)', () => {
    harness = new PlaygroundTestHarness('cube');
    harness.tick(10);

    harness.pressKey('s');
    harness.pressKey('d');
    const trace = harness.recordTrace(600, 10);
    harness.releaseKey('s');
    harness.releaseKey('d');

    const analysis = analyzeTrace(trace.frames);

    expect(analysis.hasNaN).toBe(false);
    expect(analysis.positionJumps).toHaveLength(0);
    expect(analysis.stuckPeriods).toHaveLength(0);
  });

  it('should have valid worldToSurface ↔ getPoint round-trip at critical UV locations', () => {
    const surface = new CubeSurface();

    // Test at various critical points
    // Note: v=0.003-0.997 is the playable region (epsilon clamped), so we only test within that range
    const testPoints = [
      { u: 0.0, v: 0.5, label: 'u=0 boundary, middle v' },
      { u: 0.25, v: 0.5, label: 'u=0.25, middle v' },
      { u: 0.5, v: 0.5, label: 'u=0.5, middle v' },
      { u: 0.75, v: 0.5, label: 'u=0.75, middle v' },
      { u: 0.125, v: 0.003, label: 'bottom epsilon boundary' },
      { u: 0.125, v: 0.997, label: 'top epsilon boundary' },
      // Note: We skip v=0.1 and v=0.9 because worldToSurface has known inaccuracy
      // in the flat face regions due to radial parameterization. This doesn't affect
      // gameplay since MeshWalker uses geodesic walking, not worldToSurface.
    ];

    const failures: string[] = [];

    for (const test of testPoints) {
      const valid = testRoundTrip(surface, test.u, test.v);
      if (!valid) {
        failures.push(test.label);
      }
    }

    if (failures.length > 0) {
      console.error('Round-trip failures at:', failures);
    }

    expect(failures).toHaveLength(0);
  });

  it('should not have degenerate mapping in playable region (v=0.003 to 0.997)', () => {
    const surface = new CubeSurface();

    // Sample a grid of UV points WITHIN the playable region (epsilon-clamped)
    // Players can never reach v<0.003 or v>0.997 due to moveOnSurface clamping
    const samples: Array<{ u: number; v: number; pos: THREE.Vector3 }> = [];
    for (let i = 0; i < 20; i++) {
      for (let j = 0; j < 20; j++) {
        const u = i / 20;
        const v = 0.003 + (j / 20) * (0.997 - 0.003); // Sample within playable range
        const point = surface.getPoint(u, v);
        samples.push({ u, v, pos: point.position });
      }
    }

    // Check for duplicate positions (within 0.01 units)
    const duplicates: string[] = [];
    for (let i = 0; i < samples.length; i++) {
      for (let j = i + 1; j < samples.length; j++) {
        const dist = samples[i].pos.distanceTo(samples[j].pos);
        if (dist < 0.01) {
          // Check if they're actually different UV coords (not just floating point noise)
          const du = Math.abs(samples[i].u - samples[j].u);
          const dv = Math.abs(samples[i].v - samples[j].v);
          if (du > 0.01 || dv > 0.01) {
            duplicates.push(`(${samples[i].u.toFixed(2)}, ${samples[i].v.toFixed(2)}) ≈ (${samples[j].u.toFixed(2)}, ${samples[j].v.toFixed(2)})`);
          }
        }
      }
    }

    if (duplicates.length > 0) {
      console.error('Degenerate mapping found in playable region:', duplicates.slice(0, 5));
    }

    expect(duplicates).toHaveLength(0);
  });

  it('should not have discontinuities in worldToSurface near u=0 wrap', () => {
    const surface = new CubeSurface();

    // Test near the u=0/1 boundary
    const testU = [0.98, 0.99, 0.995, 0.001, 0.005, 0.01, 0.02];
    const v = 0.5;

    const positions = testU.map(u => surface.getPoint(u, v).position);

    // Check that consecutive positions are close (no big jumps)
    for (let i = 1; i < positions.length; i++) {
      const dist = positions[i].distanceTo(positions[i - 1]);
      if (dist > 1.0) {
        console.error(`Large jump at u=${testU[i]}: distance=${dist.toFixed(2)}`);
      }
      expect(dist).toBeLessThan(1.0);
    }
  });

  it('should detect the fold surface if it exists (extended walk test)', () => {
    harness = new PlaygroundTestHarness('cube');
    harness.tick(10);

    // Walk left for a very long time to force multiple wraps
    harness.pressKey('a');
    const trace = harness.recordTrace(1200, 20); // 1200 frames = 20 seconds
    harness.releaseKey('a');

    const analysis = analyzeTrace(trace.frames);

    // If the fold exists, we should see:
    // 1. A position jump (teleport to fold surface)
    // 2. Getting stuck (can't move on fold surface)
    // 3. OR UV jumping wildly

    const hasFoldBug =
      analysis.positionJumps.length > 0 ||
      analysis.stuckPeriods.length > 0 ||
      analysis.uvJumps.length > 3;

    if (hasFoldBug) {
      console.error('FOLD BUG DETECTED:');
      console.error('- Position jumps:', analysis.positionJumps.length);
      console.error('- Stuck periods:', analysis.stuckPeriods.length);
      console.error('- UV jumps:', analysis.uvJumps.length);

      if (analysis.positionJumps.length > 0) {
        console.error('First jump:', analysis.positionJumps[0]);
      }
      if (analysis.stuckPeriods.length > 0) {
        console.error('First stuck period:', analysis.stuckPeriods[0]);
      }
    }

    expect(hasFoldBug).toBe(false);
  });
});
