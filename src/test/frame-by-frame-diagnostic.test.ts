/**
 * Frame-by-Frame Diagnostic Test
 *
 * Purpose: Capture detailed per-frame data for movement analysis WITHOUT visual testing.
 * This allows workers to diagnose movement bugs programmatically using RealGameTestHarness.
 *
 * What This Captures:
 * - Player world position (x, y, z)
 * - Player orientation (quaternion -> euler angles)
 * - Tangent frame (tangent, bitangent, normal)
 * - Input state (moveX, moveY, aimX, aimY)
 * - Calculated orientation vectors (playerRight, playerForward)
 * - Frame-to-frame deltas (position change, orientation change)
 *
 * How to Use:
 * 1. Run test: npm test -- --run src/test/frame-by-frame-diagnostic.test.ts
 * 2. Check output JSON files in test-data/diagnostics/
 * 3. Analyze patterns: jitter = position oscillation, snaps = large orientation deltas
 *
 * See: docs/testing/frame-by-frame-diagnostics.md for full methodology
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// DOM/Mock setup (standard for headless tests)
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

// Mocks (standard setup)
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

import { RealGameTestHarness } from './RealGameTestHarness';

// Output directory
const OUTPUT_DIR = join(process.cwd(), 'test-data', 'diagnostics');
mkdirSync(OUTPUT_DIR, { recursive: true });

interface FrameData {
  frame: number;
  time: number;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  eulerAngles: { x: number; y: number; z: number }; // in radians
  tangentFrame: {
    tangent: { x: number; y: number; z: number };
    bitangent: { x: number; y: number; z: number };
    normal: { x: number; y: number; z: number };
  };
  input: {
    moveX: number;
    moveY: number;
    aimX: number;
    aimY: number;
  };
  deltas: {
    positionChange: number; // distance moved since last frame
    orientationChange: number; // quaternion angle difference (radians)
  };
}

interface DiagnosticReport {
  testName: string;
  surface: string;
  direction: string;
  totalFrames: number;
  totalTime: number;
  frames: FrameData[];
  analysis: {
    totalDistance: number;
    avgSpeed: number;
    maxOrientationDelta: number;
    avgOrientationDelta: number;
    largeOrientationJumps: number; // frames with > 90° rotation
    jitterDetected: boolean;
    stuckFrames: number; // frames with < 0.001 movement
    orientationInstability: string; // "stable" | "moderate" | "severe"
  };
}

function captureFrameData(harness: RealGameTestHarness, frameNumber: number, time: number, prevQuat?: THREE.Quaternion, prevPos?: THREE.Vector3): FrameData {
  const player = harness.player;
  const pos = harness.getPlayerWorldPos();
  const quat = player.mesh.quaternion.clone();
  const euler = new THREE.Euler().setFromQuaternion(quat);

  // Get tangent frame
  const frame = harness.playerWalker.getTangentFrame();

  // Calculate deltas
  const positionChange = prevPos ? pos.distanceTo(prevPos) : 0;
  const orientationChange = prevQuat ? prevQuat.angleTo(quat) : 0;

  return {
    frame: frameNumber,
    time,
    position: { x: pos.x, y: pos.y, z: pos.z },
    quaternion: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
    eulerAngles: { x: euler.x, y: euler.y, z: euler.z },
    tangentFrame: {
      tangent: { x: frame.tangent.x, y: frame.tangent.y, z: frame.tangent.z },
      bitangent: { x: frame.bitangent.x, y: frame.bitangent.y, z: frame.bitangent.z },
      normal: { x: frame.normal.x, y: frame.normal.y, z: frame.normal.z },
    },
    input: {
      moveX: 0, // Will be set by test
      moveY: 0,
      aimX: 0,
      aimY: 0,
    },
    deltas: {
      positionChange,
      orientationChange,
    },
  };
}

function analyzeFrames(frames: FrameData[]): DiagnosticReport['analysis'] {
  const firstPos = new THREE.Vector3(frames[0].position.x, frames[0].position.y, frames[0].position.z);
  const lastPos = new THREE.Vector3(frames[frames.length - 1].position.x, frames[frames.length - 1].position.y, frames[frames.length - 1].position.z);
  const totalDistance = firstPos.distanceTo(lastPos);
  const totalTime = frames[frames.length - 1].time - frames[0].time;
  const avgSpeed = totalDistance / totalTime;

  const orientationDeltas = frames.map(f => f.deltas.orientationChange);
  const maxOrientationDelta = Math.max(...orientationDeltas);
  const avgOrientationDelta = orientationDeltas.reduce((a, b) => a + b, 0) / orientationDeltas.length;
  const largeOrientationJumps = orientationDeltas.filter(d => d > Math.PI / 2).length;

  const positionDeltas = frames.map(f => f.deltas.positionChange);
  const stuckFrames = positionDeltas.filter(d => d < 0.001).length;

  // Jitter detection: position oscillates back and forth
  let jitterDetected = false;
  for (let i = 2; i < frames.length; i++) {
    const curr = new THREE.Vector3(frames[i].position.x, frames[i].position.y, frames[i].position.z);
    const prev = new THREE.Vector3(frames[i - 1].position.x, frames[i - 1].position.y, frames[i - 1].position.z);
    const prevPrev = new THREE.Vector3(frames[i - 2].position.x, frames[i - 2].position.y, frames[i - 2].position.z);

    const dir1 = new THREE.Vector3().subVectors(prev, prevPrev).normalize();
    const dir2 = new THREE.Vector3().subVectors(curr, prev).normalize();

    if (dir1.lengthSq() > 0 && dir2.lengthSq() > 0) {
      const dot = dir1.dot(dir2);
      if (dot < -0.5) { // Opposite directions
        jitterDetected = true;
        break;
      }
    }
  }

  const orientationInstability =
    largeOrientationJumps > frames.length * 0.5 ? 'severe' :
    largeOrientationJumps > frames.length * 0.1 ? 'moderate' :
    'stable';

  return {
    totalDistance,
    avgSpeed,
    maxOrientationDelta,
    avgOrientationDelta,
    largeOrientationJumps,
    jitterDetected,
    stuckFrames,
    orientationInstability,
  };
}

describe('Frame-by-Frame Movement Diagnostics', () => {
  let harness: RealGameTestHarness;

  afterEach(() => {
    if (harness) {
      harness.dispose();
    }
  });

  it('captures forward movement (W key) - 120 frames', () => {
    harness = new RealGameTestHarness('sphere');
    harness.tick(10); // Settle

    const frames: FrameData[] = [];
    let prevQuat: THREE.Quaternion | undefined;
    let prevPos: THREE.Vector3 | undefined;
    let time = 0;
    const dt = 1 / 60; // 60 FPS

    // Capture initial frame
    const initialFrame = captureFrameData(harness, 0, time, prevQuat, prevPos);
    frames.push(initialFrame);
    prevQuat = harness.player.mesh.quaternion.clone();
    prevPos = harness.getPlayerWorldPos().clone();

    // Press W and capture 120 frames
    harness.pressKey('w');
    for (let i = 1; i <= 120; i++) {
      harness.tick(1);
      time += dt;

      const frame = captureFrameData(harness, i, time, prevQuat, prevPos);
      frame.input.moveY = -1; // W key
      frames.push(frame);

      prevQuat = harness.player.mesh.quaternion.clone();
      prevPos = harness.getPlayerWorldPos().clone();
    }
    harness.releaseKey('w');

    const report: DiagnosticReport = {
      testName: 'forward-movement-w-key',
      surface: 'sphere',
      direction: 'forward (W)',
      totalFrames: frames.length,
      totalTime: time,
      frames,
      analysis: analyzeFrames(frames),
    };

    // Save report
    const filename = `s15-forward-movement-${Date.now()}.json`;
    writeFileSync(join(OUTPUT_DIR, filename), JSON.stringify(report, null, 2));
    console.log(`\n📊 Diagnostic report saved: test-data/diagnostics/${filename}`);
    console.log(`📈 Analysis:`);
    console.log(`   Total distance: ${report.analysis.totalDistance.toFixed(4)}`);
    console.log(`   Avg speed: ${report.analysis.avgSpeed.toFixed(4)}`);
    console.log(`   Max orientation delta: ${(report.analysis.maxOrientationDelta * 180 / Math.PI).toFixed(2)}°`);
    console.log(`   Avg orientation delta: ${(report.analysis.avgOrientationDelta * 180 / Math.PI).toFixed(2)}°`);
    console.log(`   Large jumps (>90°): ${report.analysis.largeOrientationJumps}/${frames.length} (${(report.analysis.largeOrientationJumps / frames.length * 100).toFixed(1)}%)`);
    console.log(`   Stuck frames: ${report.analysis.stuckFrames}`);
    console.log(`   Jitter detected: ${report.analysis.jitterDetected}`);
    console.log(`   Orientation stability: ${report.analysis.orientationInstability}`);

    // Assertions
    expect(report.analysis.totalDistance, 'Should move forward').toBeGreaterThan(0.1);
    // Don't assert orientation yet - we're gathering data first
  });

  it('captures backward movement (S key) - 120 frames', () => {
    harness = new RealGameTestHarness('sphere');
    harness.tick(10);

    const frames: FrameData[] = [];
    let prevQuat: THREE.Quaternion | undefined;
    let prevPos: THREE.Vector3 | undefined;
    let time = 0;
    const dt = 1 / 60;

    const initialFrame = captureFrameData(harness, 0, time, prevQuat, prevPos);
    frames.push(initialFrame);
    prevQuat = harness.player.mesh.quaternion.clone();
    prevPos = harness.getPlayerWorldPos().clone();

    harness.pressKey('s');
    for (let i = 1; i <= 120; i++) {
      harness.tick(1);
      time += dt;

      const frame = captureFrameData(harness, i, time, prevQuat, prevPos);
      frame.input.moveY = 1; // S key
      frames.push(frame);

      prevQuat = harness.player.mesh.quaternion.clone();
      prevPos = harness.getPlayerWorldPos().clone();
    }
    harness.releaseKey('s');

    const report: DiagnosticReport = {
      testName: 'backward-movement-s-key',
      surface: 'sphere',
      direction: 'backward (S)',
      totalFrames: frames.length,
      totalTime: time,
      frames,
      analysis: analyzeFrames(frames),
    };

    const filename = `s15-backward-movement-${Date.now()}.json`;
    writeFileSync(join(OUTPUT_DIR, filename), JSON.stringify(report, null, 2));
    console.log(`\n📊 Diagnostic report saved: test-data/diagnostics/${filename}`);
    console.log(`📈 Analysis:`);
    console.log(`   Total distance: ${report.analysis.totalDistance.toFixed(4)}`);
    console.log(`   Max orientation delta: ${(report.analysis.maxOrientationDelta * 180 / Math.PI).toFixed(2)}°`);
    console.log(`   Large jumps (>90°): ${report.analysis.largeOrientationJumps}/${frames.length}`);
    console.log(`   Orientation stability: ${report.analysis.orientationInstability}`);

    expect(report.analysis.totalDistance, 'Should move backward').toBeGreaterThan(0.1);
  });

  it('captures left movement (A key) - 120 frames for comparison', () => {
    harness = new RealGameTestHarness('sphere');
    harness.tick(10);

    const frames: FrameData[] = [];
    let prevQuat: THREE.Quaternion | undefined;
    let prevPos: THREE.Vector3 | undefined;
    let time = 0;
    const dt = 1 / 60;

    const initialFrame = captureFrameData(harness, 0, time, prevQuat, prevPos);
    frames.push(initialFrame);
    prevQuat = harness.player.mesh.quaternion.clone();
    prevPos = harness.getPlayerWorldPos().clone();

    harness.pressKey('a');
    for (let i = 1; i <= 120; i++) {
      harness.tick(1);
      time += dt;

      const frame = captureFrameData(harness, i, time, prevQuat, prevPos);
      frame.input.moveX = -1; // A key
      frames.push(frame);

      prevQuat = harness.player.mesh.quaternion.clone();
      prevPos = harness.getPlayerWorldPos().clone();
    }
    harness.releaseKey('a');

    const report: DiagnosticReport = {
      testName: 'left-movement-a-key',
      surface: 'sphere',
      direction: 'left (A)',
      totalFrames: frames.length,
      totalTime: time,
      frames,
      analysis: analyzeFrames(frames),
    };

    const filename = `s15-left-movement-${Date.now()}.json`;
    writeFileSync(join(OUTPUT_DIR, filename), JSON.stringify(report, null, 2));
    console.log(`\n📊 Diagnostic report saved: test-data/diagnostics/${filename}`);
    console.log(`📈 Analysis (LEFT - this should work correctly):`);
    console.log(`   Total distance: ${report.analysis.totalDistance.toFixed(4)}`);
    console.log(`   Max orientation delta: ${(report.analysis.maxOrientationDelta * 180 / Math.PI).toFixed(2)}°`);
    console.log(`   Large jumps (>90°): ${report.analysis.largeOrientationJumps}/${frames.length}`);
    console.log(`   Orientation stability: ${report.analysis.orientationInstability}`);

    expect(report.analysis.totalDistance, 'Should move left').toBeGreaterThan(0.1);
  });
});
