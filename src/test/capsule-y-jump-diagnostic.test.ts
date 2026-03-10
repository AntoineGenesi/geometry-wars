/**
 * Focused diagnostic: Y-coordinate jumps during W+D on capsule.
 *
 * The V oscillation test revealed the player's Y coordinate jumps by ~1 unit
 * when crossing face boundaries during diagonal movement on the capsule.
 * This test measures the exact jump magnitude and checks:
 * 1. Whether it's the geodesic walk or the BVH fallback causing it
 * 2. Whether the same jumps happen on sphere
 * 3. Whether the jumps correlate with face boundary crossings
 */

import { vi, describe, test, expect, afterEach } from 'vitest';
import '../test/verification-env';

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

import * as THREE from 'three';
import { RealGameTestHarness } from './RealGameTestHarness';

describe('Capsule Y-jump diagnostic', () => {
  let harness: RealGameTestHarness;

  afterEach(() => {
    if (harness) harness.dispose();
  });

  test('Y JUMPS: Detect position jumps during W+D on pill', () => {
    harness = new RealGameTestHarness('pill');
    harness.tick(10);

    const walker = harness.playerWalker;

    harness.pressKey('w');
    harness.pressKey('d');

    let prevPos = harness.getPlayerWorldPos().clone();
    let prevFace = walker.faceIndex;
    const jumps: { frame: number; dy: number; prevY: number; newY: number; faceBefore: number; faceAfter: number }[] = [];

    for (let i = 0; i < 120; i++) {
      harness.tick(1);
      const pos = harness.getPlayerWorldPos();
      const currentFace = walker.faceIndex;
      const dy = pos.y - prevPos.y;
      const dist = prevPos.distanceTo(pos);

      // Detect significant Y jumps (more than 2x the expected per-frame movement)
      // Expected per-frame Y movement: speed * dt * sin(45deg) = 3.0 * (1/60) * 0.707 = 0.035
      if (Math.abs(dy) > 0.1 || dist > 0.15) {
        jumps.push({
          frame: i,
          dy,
          prevY: prevPos.y,
          newY: pos.y,
          faceBefore: prevFace,
          faceAfter: currentFace,
        });
      }

      prevPos = pos.clone();
      prevFace = currentFace;
    }

    harness.releaseKey('w');
    harness.releaseKey('d');

    console.log(`\n=== Position jumps during W+D on pill (120 frames) ===`);
    console.log(`Total jumps detected: ${jumps.length}`);
    for (const j of jumps) {
      const faceChanged = j.faceBefore !== j.faceAfter ? 'FACE CHANGE' : 'same face';
      console.log(`  Frame ${j.frame}: dy=${j.dy.toFixed(4)}, Y: ${j.prevY.toFixed(4)} -> ${j.newY.toFixed(4)} (face: ${j.faceBefore}->${j.faceAfter} ${faceChanged})`);
    }

    if (jumps.length > 0) {
      const avgJump = jumps.reduce((s, j) => s + Math.abs(j.dy), 0) / jumps.length;
      console.log(`\nAverage jump magnitude: ${avgJump.toFixed(4)}`);
      console.log(`This represents ${(avgJump / 0.035 * 100).toFixed(0)}% of expected per-frame movement`);
    }
  });

  test('Y JUMPS: Same test on SPHERE for comparison', () => {
    harness = new RealGameTestHarness('sphere');
    harness.tick(10);

    const walker = harness.playerWalker;

    harness.pressKey('w');
    harness.pressKey('d');

    let prevPos = harness.getPlayerWorldPos().clone();
    let prevFace = walker.faceIndex;
    const jumps: { frame: number; dist: number; faceBefore: number; faceAfter: number }[] = [];

    for (let i = 0; i < 120; i++) {
      harness.tick(1);
      const pos = harness.getPlayerWorldPos();
      const currentFace = walker.faceIndex;
      const dist = prevPos.distanceTo(pos);

      if (dist > 0.15) {
        jumps.push({
          frame: i,
          dist,
          faceBefore: prevFace,
          faceAfter: currentFace,
        });
      }

      prevPos = pos.clone();
      prevFace = currentFace;
    }

    harness.releaseKey('w');
    harness.releaseKey('d');

    console.log(`\n=== Position jumps during W+D on SPHERE (120 frames) ===`);
    console.log(`Total jumps detected: ${jumps.length}`);
    for (const j of jumps) {
      const faceChanged = j.faceBefore !== j.faceAfter ? 'FACE CHANGE' : 'same face';
      console.log(`  Frame ${j.frame}: dist=${j.dist.toFixed(4)} (face: ${j.faceBefore}->${j.faceAfter} ${faceChanged})`);
    }
  });

  test('FACE CROSSINGS: Count face boundary crossings during W+D on pill vs sphere', () => {
    // PILL
    harness = new RealGameTestHarness('pill');
    harness.tick(10);
    let walker = harness.playerWalker;

    harness.pressKey('w');
    harness.pressKey('d');

    let pillFaceCrossings = 0;
    let prevFace = walker.faceIndex;
    for (let i = 0; i < 120; i++) {
      harness.tick(1);
      if (walker.faceIndex !== prevFace) {
        pillFaceCrossings++;
        prevFace = walker.faceIndex;
      }
    }
    harness.releaseKey('w');
    harness.releaseKey('d');
    harness.dispose();

    // SPHERE
    harness = new RealGameTestHarness('sphere');
    harness.tick(10);
    walker = harness.playerWalker;

    harness.pressKey('w');
    harness.pressKey('d');

    let sphereFaceCrossings = 0;
    prevFace = walker.faceIndex;
    for (let i = 0; i < 120; i++) {
      harness.tick(1);
      if (walker.faceIndex !== prevFace) {
        sphereFaceCrossings++;
        prevFace = walker.faceIndex;
      }
    }
    harness.releaseKey('w');
    harness.releaseKey('d');

    console.log(`\nFace crossings in 120 frames of W+D:`);
    console.log(`  Pill: ${pillFaceCrossings}`);
    console.log(`  Sphere: ${sphereFaceCrossings}`);
  });

  test('BVH FALLBACK: Check if geodesic walk triggers BVH fallback on pill during W+D', () => {
    harness = new RealGameTestHarness('pill');
    harness.tick(10);

    const walker = harness.playerWalker as any;

    // Monkey-patch the walker's _fallbackMove to count calls
    let fallbackCount = 0;
    const origFallback = walker._fallbackMove.bind(walker);
    walker._fallbackMove = function(...args: any[]) {
      fallbackCount++;
      return origFallback(...args);
    };

    harness.pressKey('w');
    harness.pressKey('d');

    for (let i = 0; i < 120; i++) {
      harness.tick(1);
    }

    harness.releaseKey('w');
    harness.releaseKey('d');

    console.log(`\nBVH fallback calls during 120 frames of W+D on pill: ${fallbackCount}`);
    console.log(`Fallback rate: ${(fallbackCount / 120 * 100).toFixed(1)}%`);
  });
});
