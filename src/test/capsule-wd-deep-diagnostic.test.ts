/**
 * Deep diagnostic test: W+D on capsule surface.
 *
 * The user reports that W+D on the pill map causes the player to "loop in place".
 * The basic test (120 frames) passes because the player does move.
 * But what if the movement forms a CIRCLE, returning to the start position?
 *
 * This test runs W+D for much longer (10+ seconds) and checks:
 * 1. Does the tangent frame rotate during movement?
 * 2. Does the player follow a circular path?
 * 3. Does the player return to the starting position?
 * 4. Is this capsule-specific or does it happen on other surfaces?
 * 5. Does W-only or D-only have the same issue?
 * 6. Does the camera orientation oscillate or drift?
 */

import { vi, describe, test, expect, afterEach } from 'vitest';
import '../test/verification-env';

// --- Required mocks (must be in each test file — vitest hoists) ---
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
import { PlaygroundTestHarness } from './PlaygroundTestHarness';
import type { SurfaceType } from '../surfaces/SurfaceFactory';

describe('Capsule W+D deep diagnostic', () => {
  let harness: PlaygroundTestHarness;

  afterEach(() => {
    if (harness) harness.dispose();
  });

  test('DIAGNOSTIC: W+D on capsule - track tangent frame rotation and path curvature over 10 seconds', () => {
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10); // settle

    const startPos = harness.getPlayerWorldPos().clone();
    const startUV = harness.getPlayerSurfaceUV();

    console.log(`Start position: ${startPos.x.toFixed(4)}, ${startPos.y.toFixed(4)}, ${startPos.z.toFixed(4)}`);
    console.log(`Start UV: u=${startUV.u.toFixed(4)}, v=${startUV.v.toFixed(4)}`);

    // Press W+D
    harness.pressKey('w');
    harness.pressKey('d');

    // Track positions and tangent frame over 600 frames (10 seconds)
    const positions: THREE.Vector3[] = [];
    const uvs: { u: number; v: number }[] = [];

    // Access the walker's tangent frame through the PlaygroundGame
    const pg = harness.pg;

    for (let i = 0; i < 600; i++) {
      harness.tick(1);

      if (i % 10 === 0) {
        const pos = harness.getPlayerWorldPos();
        const uv = harness.getPlayerSurfaceUV();
        positions.push(pos.clone());
        uvs.push({ u: uv.u, v: uv.v });
      }
    }

    harness.releaseKey('w');
    harness.releaseKey('d');

    const endPos = harness.getPlayerWorldPos();
    const endUV = harness.getPlayerSurfaceUV();

    console.log(`\nEnd position: ${endPos.x.toFixed(4)}, ${endPos.y.toFixed(4)}, ${endPos.z.toFixed(4)}`);
    console.log(`End UV: u=${endUV.u.toFixed(4)}, v=${endUV.v.toFixed(4)}`);
    console.log(`\nStart-to-end distance: ${startPos.distanceTo(endPos).toFixed(4)}`);

    // Track maximum distance from start (did they go far?)
    let maxDistFromStart = 0;
    let maxDistFrame = 0;
    for (let i = 0; i < positions.length; i++) {
      const dist = startPos.distanceTo(positions[i]);
      if (dist > maxDistFromStart) {
        maxDistFromStart = dist;
        maxDistFrame = i * 10;
      }
    }
    console.log(`Max distance from start: ${maxDistFromStart.toFixed(4)} at frame ${maxDistFrame}`);

    // Check if the path forms a loop: does the player return close to start?
    // On a capsule with radius 4, circumference ~ 25 units
    // Speed 3 units/sec, diagonal speed ~2.12 units/sec
    // In 10 seconds, travel ~ 21 units = close to circumference
    // If tangent frame rotates, player goes in a circle

    const returnDistance = startPos.distanceTo(endPos);
    const loopDetected = returnDistance < maxDistFromStart * 0.3 && maxDistFromStart > 2;

    console.log(`\nLoop analysis:`);
    console.log(`  Max distance from start: ${maxDistFromStart.toFixed(4)}`);
    console.log(`  Return distance: ${returnDistance.toFixed(4)}`);
    console.log(`  Ratio (return/max): ${(returnDistance / maxDistFromStart).toFixed(4)}`);
    console.log(`  Loop detected: ${loopDetected}`);

    // Analyze path curvature - compute direction changes between samples
    let totalAngleChange = 0;
    let segmentCount = 0;
    for (let i = 2; i < positions.length; i++) {
      const dir1 = positions[i - 1].clone().sub(positions[i - 2]);
      const dir2 = positions[i].clone().sub(positions[i - 1]);
      if (dir1.length() > 0.001 && dir2.length() > 0.001) {
        dir1.normalize();
        dir2.normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, dir1.dot(dir2))));
        totalAngleChange += angle;
        segmentCount++;
      }
    }

    const avgAngleChange = segmentCount > 0 ? totalAngleChange / segmentCount : 0;
    const totalAngleDeg = (totalAngleChange * 180) / Math.PI;
    console.log(`\nPath curvature analysis:`);
    console.log(`  Total angle change: ${totalAngleDeg.toFixed(1)} degrees`);
    console.log(`  Average angle per sample: ${(avgAngleChange * 180 / Math.PI).toFixed(3)} degrees`);
    console.log(`  Full circles: ${(totalAngleDeg / 360).toFixed(2)}`);

    // Print first 15 and last 5 sampled positions
    console.log('\nFirst 15 sampled positions (every 10 frames):');
    for (let i = 0; i < Math.min(15, positions.length); i++) {
      const p = positions[i];
      const uv = uvs[i];
      console.log(`  [${i * 10}] pos=(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}) uv=(${uv.u.toFixed(4)}, ${uv.v.toFixed(4)})`);
    }
    console.log('\nLast 5 sampled positions:');
    for (let i = Math.max(0, positions.length - 5); i < positions.length; i++) {
      const p = positions[i];
      const uv = uvs[i];
      console.log(`  [${i * 10}] pos=(${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}) uv=(${uv.u.toFixed(4)}, ${uv.v.toFixed(4)})`);
    }

    // The actual assertion: player should have moved significantly AND not returned to start
    expect(maxDistFromStart).toBeGreaterThan(2); // moved more than 2 units at some point
  });

  test('DIAGNOSTIC: Compare W+D path on capsule vs sphere (10 sec each)', () => {
    // Capsule
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10);
    const capsuleStart = harness.getPlayerWorldPos().clone();
    harness.pressKey('w');
    harness.pressKey('d');

    let capsuleMaxDist = 0;
    const capsulePositions: THREE.Vector3[] = [];
    for (let i = 0; i < 600; i++) {
      harness.tick(1);
      if (i % 10 === 0) {
        const p = harness.getPlayerWorldPos();
        capsulePositions.push(p.clone());
        capsuleMaxDist = Math.max(capsuleMaxDist, capsuleStart.distanceTo(p));
      }
    }
    harness.releaseKey('w');
    harness.releaseKey('d');
    const capsuleEnd = harness.getPlayerWorldPos();
    const capsuleReturn = capsuleStart.distanceTo(capsuleEnd);
    harness.dispose();

    // Sphere
    harness = new PlaygroundTestHarness('sphere');
    harness.tick(10);
    const sphereStart = harness.getPlayerWorldPos().clone();
    harness.pressKey('w');
    harness.pressKey('d');

    let sphereMaxDist = 0;
    const spherePositions: THREE.Vector3[] = [];
    for (let i = 0; i < 600; i++) {
      harness.tick(1);
      if (i % 10 === 0) {
        const p = harness.getPlayerWorldPos();
        spherePositions.push(p.clone());
        sphereMaxDist = Math.max(sphereMaxDist, sphereStart.distanceTo(p));
      }
    }
    harness.releaseKey('w');
    harness.releaseKey('d');
    const sphereEnd = harness.getPlayerWorldPos();
    const sphereReturn = sphereStart.distanceTo(sphereEnd);

    console.log('\n=== Capsule vs Sphere W+D comparison (10 sec) ===');
    console.log(`Capsule: maxDist=${capsuleMaxDist.toFixed(3)}, returnDist=${capsuleReturn.toFixed(3)}, ratio=${(capsuleReturn / capsuleMaxDist).toFixed(3)}`);
    console.log(`Sphere:  maxDist=${sphereMaxDist.toFixed(3)}, returnDist=${sphereReturn.toFixed(3)}, ratio=${(sphereReturn / sphereMaxDist).toFixed(3)}`);

    const capsuleLoops = capsuleReturn < capsuleMaxDist * 0.3 && capsuleMaxDist > 2;
    const sphereLoops = sphereReturn < sphereMaxDist * 0.3 && sphereMaxDist > 2;
    console.log(`Capsule loops: ${capsuleLoops}`);
    console.log(`Sphere loops: ${sphereLoops}`);
  });

  test('DIAGNOSTIC: W+D on capsule at different starting positions (caps vs cylinder)', () => {
    // Test at 3 different V positions to see if caps vs cylinder matters
    const vPositions = [
      { name: 'bottom_cap', v: 0.1 },
      { name: 'cylinder_mid', v: 0.5 },
      { name: 'top_cap', v: 0.9 },
    ];

    for (const { name, v } of vPositions) {
      harness = new PlaygroundTestHarness('pill');
      harness.tick(10);

      // Walk to the desired V position first
      // We can't directly set UV, so we'll just test from default and note the V
      // Actually, let's use walkUntilUV to get to the right position
      if (v < 0.4) {
        // Walk backward to reach lower V
        harness.pressKey('s');
        for (let i = 0; i < 300; i++) {
          harness.tick(1);
          const uv = harness.getPlayerSurfaceUV();
          if (uv.v <= v + 0.05) break;
        }
        harness.releaseKey('s');
      } else if (v > 0.6) {
        // Walk forward to reach higher V
        harness.pressKey('w');
        for (let i = 0; i < 300; i++) {
          harness.tick(1);
          const uv = harness.getPlayerSurfaceUV();
          if (uv.v >= v - 0.05) break;
        }
        harness.releaseKey('w');
      }

      harness.tick(10); // settle
      const startUV = harness.getPlayerSurfaceUV();
      const startPos = harness.getPlayerWorldPos().clone();

      console.log(`\n--- ${name} (actual UV: u=${startUV.u.toFixed(4)}, v=${startUV.v.toFixed(4)}) ---`);

      // Now press W+D
      harness.pressKey('w');
      harness.pressKey('d');

      let maxDist = 0;
      for (let i = 0; i < 300; i++) { // 5 seconds
        harness.tick(1);
        if (i % 10 === 0) {
          maxDist = Math.max(maxDist, startPos.distanceTo(harness.getPlayerWorldPos()));
        }
      }

      harness.releaseKey('w');
      harness.releaseKey('d');
      const endPos = harness.getPlayerWorldPos();
      const returnDist = startPos.distanceTo(endPos);
      const endUV = harness.getPlayerSurfaceUV();

      console.log(`  Start: (${startPos.x.toFixed(3)}, ${startPos.y.toFixed(3)}, ${startPos.z.toFixed(3)})`);
      console.log(`  End:   (${endPos.x.toFixed(3)}, ${endPos.y.toFixed(3)}, ${endPos.z.toFixed(3)})`);
      console.log(`  End UV: u=${endUV.u.toFixed(4)}, v=${endUV.v.toFixed(4)}`);
      console.log(`  MaxDist: ${maxDist.toFixed(3)}, ReturnDist: ${returnDist.toFixed(3)}, Ratio: ${(returnDist / Math.max(maxDist, 0.001)).toFixed(3)}`);

      harness.dispose();
      harness = null as any;
    }
  });

  test('DIAGNOSTIC: Check if U wraps during W+D on capsule (azimuthal looping)', () => {
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10);

    const startUV = harness.getPlayerSurfaceUV();
    console.log(`\nStart UV: u=${startUV.u.toFixed(4)}, v=${startUV.v.toFixed(4)}`);

    harness.pressKey('w');
    harness.pressKey('d');

    const uValues: number[] = [];
    const vValues: number[] = [];

    for (let i = 0; i < 600; i++) {
      harness.tick(1);
      if (i % 5 === 0) {
        const uv = harness.getPlayerSurfaceUV();
        uValues.push(uv.u);
        vValues.push(uv.v);
      }
    }

    harness.releaseKey('w');
    harness.releaseKey('d');

    // Check for U wrapping (azimuthal looping)
    let uWraps = 0;
    for (let i = 1; i < uValues.length; i++) {
      if (Math.abs(uValues[i] - uValues[i - 1]) > 0.4) {
        uWraps++;
      }
    }

    // Check V range
    const minV = Math.min(...vValues);
    const maxV = Math.max(...vValues);
    const vRange = maxV - minV;

    console.log(`U wraps (azimuthal loops): ${uWraps}`);
    console.log(`V range: ${minV.toFixed(4)} to ${maxV.toFixed(4)} (span: ${vRange.toFixed(4)})`);
    console.log(`U range: ${Math.min(...uValues).toFixed(4)} to ${Math.max(...uValues).toFixed(4)}`);

    // If U wraps but V stays confined, the player is going around the capsule
    // but not making progress along it — this would look like "looping in place"
    if (uWraps >= 1 && vRange < 0.3) {
      console.log('\n*** BUG CONFIRMED: Player is looping azimuthally around the capsule ***');
      console.log('*** The tangent frame rotation causes W+D to become purely azimuthal movement ***');
    }

    // Print U values to see the wrap pattern
    console.log('\nFirst 20 U values (every 5 frames):');
    for (let i = 0; i < Math.min(20, uValues.length); i++) {
      console.log(`  [${i * 5}] u=${uValues[i].toFixed(4)} v=${vValues[i].toFixed(4)}`);
    }
  });

  test('DIAGNOSTIC: D-only vs W-only vs W+D on capsule to isolate tangent frame drift', () => {
    // Test D-only
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10);
    const dStart = harness.getPlayerWorldPos().clone();
    const dStartUV = harness.getPlayerSurfaceUV();
    harness.pressKey('d');
    for (let i = 0; i < 300; i++) harness.tick(1);
    harness.releaseKey('d');
    const dEnd = harness.getPlayerWorldPos();
    const dEndUV = harness.getPlayerSurfaceUV();
    console.log(`\nD-only: start=(${dStart.x.toFixed(3)}, ${dStart.y.toFixed(3)}, ${dStart.z.toFixed(3)}) UV=(${dStartUV.u.toFixed(4)},${dStartUV.v.toFixed(4)})`);
    console.log(`        end=(${dEnd.x.toFixed(3)}, ${dEnd.y.toFixed(3)}, ${dEnd.z.toFixed(3)}) UV=(${dEndUV.u.toFixed(4)},${dEndUV.v.toFixed(4)})`);
    console.log(`        dist=${dStart.distanceTo(dEnd).toFixed(3)}, U change=${(dEndUV.u - dStartUV.u).toFixed(4)}, V change=${(dEndUV.v - dStartUV.v).toFixed(4)}`);
    harness.dispose();

    // Test W-only
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10);
    const wStart = harness.getPlayerWorldPos().clone();
    const wStartUV = harness.getPlayerSurfaceUV();
    harness.pressKey('w');
    for (let i = 0; i < 300; i++) harness.tick(1);
    harness.releaseKey('w');
    const wEnd = harness.getPlayerWorldPos();
    const wEndUV = harness.getPlayerSurfaceUV();
    console.log(`\nW-only: start=(${wStart.x.toFixed(3)}, ${wStart.y.toFixed(3)}, ${wStart.z.toFixed(3)}) UV=(${wStartUV.u.toFixed(4)},${wStartUV.v.toFixed(4)})`);
    console.log(`        end=(${wEnd.x.toFixed(3)}, ${wEnd.y.toFixed(3)}, ${wEnd.z.toFixed(3)}) UV=(${wEndUV.u.toFixed(4)},${wEndUV.v.toFixed(4)})`);
    console.log(`        dist=${wStart.distanceTo(wEnd).toFixed(3)}, U change=${(wEndUV.u - wStartUV.u).toFixed(4)}, V change=${(wEndUV.v - wStartUV.v).toFixed(4)}`);
    harness.dispose();

    // Test W+D
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10);
    const wdStart = harness.getPlayerWorldPos().clone();
    const wdStartUV = harness.getPlayerSurfaceUV();
    harness.pressKey('w');
    harness.pressKey('d');
    for (let i = 0; i < 300; i++) harness.tick(1);
    harness.releaseKey('w');
    harness.releaseKey('d');
    const wdEnd = harness.getPlayerWorldPos();
    const wdEndUV = harness.getPlayerSurfaceUV();
    console.log(`\nW+D:    start=(${wdStart.x.toFixed(3)}, ${wdStart.y.toFixed(3)}, ${wdStart.z.toFixed(3)}) UV=(${wdStartUV.u.toFixed(4)},${wdStartUV.v.toFixed(4)})`);
    console.log(`        end=(${wdEnd.x.toFixed(3)}, ${wdEnd.y.toFixed(3)}, ${wdEnd.z.toFixed(3)}) UV=(${wdEndUV.u.toFixed(4)},${wdEndUV.v.toFixed(4)})`);
    console.log(`        dist=${wdStart.distanceTo(wdEnd).toFixed(3)}, U change=${(wdEndUV.u - wdStartUV.u).toFixed(4)}, V change=${(wdEndUV.v - wdStartUV.v).toFixed(4)}`);

    // If W+D has much more U change than expected, the tangent frame is drifting
    // Expected: W changes V (forward on capsule), D changes U (around capsule)
    // W+D should change both. But if the tangent frame rotates during movement,
    // the "W" component starts contributing to U as well.
  });
});
