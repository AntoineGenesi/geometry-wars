/**
 * Debug test: Check tangent frame orientation on capsule surface.
 *
 * The deep diagnostic revealed that on the capsule:
 * - D-only (which maps to tangent) moves the player along V (axial direction)
 * - W-only (which maps to bitangent) moves the player along U (azimuthal direction)
 *
 * This is backwards from user expectation! The user expects:
 * - W = forward along the capsule axis (V direction)
 * - D = right around the capsule (U direction)
 *
 * But MeshWalker uses:
 * - D = tangent direction (should be "screen right")
 * - W = bitangent direction (should be "screen up/forward")
 *
 * On the capsule at the default start position (u=0.5, v=0.5, on the cylinder body),
 * tangent might be axial and bitangent azimuthal, or vice versa. This matters because
 * the camera uses the same tangent frame for its "up" direction.
 *
 * The REAL issue: The V oscillation during W+D movement suggests the tangent frame
 * is rotating as the player moves, causing the "forward" direction to change. Combined
 * with the camera lerp, this could create visible oscillation/looping on screen.
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

describe('Capsule tangent frame debug', () => {
  let harness: RealGameTestHarness;

  afterEach(() => {
    if (harness) harness.dispose();
  });

  test('TANGENT FRAME: Print initial tangent/bitangent/normal at capsule start position', () => {
    harness = new RealGameTestHarness('pill');
    harness.tick(10);

    // Access the walker's tangent frame
    const walker = harness.playerWalker;
    const frame = walker.getTangentFrame();

    console.log('\n=== Capsule tangent frame at start position (u=0.5, v=0.5) ===');
    console.log(`Position: (${walker.position.x.toFixed(4)}, ${walker.position.y.toFixed(4)}, ${walker.position.z.toFixed(4)})`);
    console.log(`Normal:   (${frame.normal.x.toFixed(4)}, ${frame.normal.y.toFixed(4)}, ${frame.normal.z.toFixed(4)})`);
    console.log(`Tangent:  (${frame.tangent.x.toFixed(4)}, ${frame.tangent.y.toFixed(4)}, ${frame.tangent.z.toFixed(4)})`);
    console.log(`Bitang:   (${frame.bitangent.x.toFixed(4)}, ${frame.bitangent.y.toFixed(4)}, ${frame.bitangent.z.toFixed(4)})`);

    // Check which direction each basis vector points
    // On a capsule at (u=0.5, v=0.5), the surface is a cylinder at y=0
    // Position should be at radius from the axis (which is the Y axis for CapsuleGeometry)
    // Normal should point radially outward (in the XZ plane)
    // Tangent should be one of: axial (Y direction) or azimuthal (around the circumference)
    // Bitangent should be the other

    console.log('\nDirection analysis:');
    console.log(`Normal dot Y-axis: ${frame.normal.dot(new THREE.Vector3(0, 1, 0)).toFixed(4)} (0 = horizontal, 1 = vertical)`);
    console.log(`Tangent dot Y-axis: ${frame.tangent.dot(new THREE.Vector3(0, 1, 0)).toFixed(4)}`);
    console.log(`Bitang dot Y-axis: ${frame.bitangent.dot(new THREE.Vector3(0, 1, 0)).toFixed(4)}`);

    // MeshWalker.moveFromInput maps:
    //   D/A = tangent direction (inputX)
    //   W/S = bitangent direction (inputY after negation)
    // So if tangent points along Y-axis, D/A moves the player axially
    // And if bitangent points azimuthally, W/S moves the player around the capsule

    console.log('\nScreen-to-surface mapping:');
    console.log(`D key (positive tangent): moves player in direction (${frame.tangent.x.toFixed(3)}, ${frame.tangent.y.toFixed(3)}, ${frame.tangent.z.toFixed(3)})`);
    console.log(`W key (positive bitangent): moves player in direction (${frame.bitangent.x.toFixed(3)}, ${frame.bitangent.y.toFixed(3)}, ${frame.bitangent.z.toFixed(3)})`);

    // Camera setup in GameInstance:
    // camera.up = frame.bitangent  (screen up = bitangent)
    // camera.position = player + normal * distance  (looks from above along normal)
    // camera.lookAt(player)
    //
    // So:
    //   Screen up = bitangent
    //   Screen right = tangent
    //   W key = positive bitangent = screen up = forward on screen

    console.log('\nCamera orientation:');
    const cam = harness.game.camera;
    console.log(`Camera position: (${cam.position.x.toFixed(3)}, ${cam.position.y.toFixed(3)}, ${cam.position.z.toFixed(3)})`);
    console.log(`Camera up: (${cam.up.x.toFixed(3)}, ${cam.up.y.toFixed(3)}, ${cam.up.z.toFixed(3)})`);
  });

  test('TANGENT FRAME DRIFT: Track tangent/bitangent rotation during W+D on capsule', () => {
    harness = new RealGameTestHarness('pill');
    harness.tick(10);

    const walker = harness.playerWalker;

    // Record initial tangent frame
    const initialFrame = walker.getTangentFrame();
    const initialTangent = initialFrame.tangent.clone();
    const initialBitangent = initialFrame.bitangent.clone();

    console.log('\n=== Tangent frame drift during W+D on capsule ===');
    console.log(`Initial tangent:  (${initialTangent.x.toFixed(4)}, ${initialTangent.y.toFixed(4)}, ${initialTangent.z.toFixed(4)})`);
    console.log(`Initial bitangent: (${initialBitangent.x.toFixed(4)}, ${initialBitangent.y.toFixed(4)}, ${initialBitangent.z.toFixed(4)})`);

    harness.pressKey('w');
    harness.pressKey('d');

    // Track the angle between current and initial tangent frame over time
    const tangentAngles: number[] = [];
    const bitangentAngles: number[] = [];

    for (let i = 0; i < 300; i++) {
      harness.tick(1);

      if (i % 10 === 0) {
        const frame = walker.getTangentFrame();
        // Angle between current tangent and initial tangent
        const tangentAngle = Math.acos(Math.max(-1, Math.min(1, frame.tangent.dot(initialTangent))));
        const bitangentAngle = Math.acos(Math.max(-1, Math.min(1, frame.bitangent.dot(initialBitangent))));
        tangentAngles.push(tangentAngle * 180 / Math.PI);
        bitangentAngles.push(bitangentAngle * 180 / Math.PI);
      }
    }

    harness.releaseKey('w');
    harness.releaseKey('d');

    console.log('\nTangent rotation from initial (degrees) every 10 frames:');
    for (let i = 0; i < tangentAngles.length; i++) {
      console.log(`  [${i * 10}] tangent: ${tangentAngles[i].toFixed(1)}deg, bitangent: ${bitangentAngles[i].toFixed(1)}deg`);
    }

    const maxTangentDrift = Math.max(...tangentAngles);
    const maxBitangentDrift = Math.max(...bitangentAngles);
    console.log(`\nMax tangent drift: ${maxTangentDrift.toFixed(1)}deg`);
    console.log(`Max bitangent drift: ${maxBitangentDrift.toFixed(1)}deg`);

    // If tangent frame drifts more than ~30 degrees, the movement direction
    // has significantly changed from what the user intended
    // This could explain "looping" -- the player starts moving forward+right
    // but after some time, "forward" has rotated so much that they're going
    // in a circle
  });

  test('TANGENT FRAME DRIFT: Same test on SPHERE for comparison', () => {
    harness = new RealGameTestHarness('sphere');
    harness.tick(10);

    const walker = harness.playerWalker;

    const initialFrame = walker.getTangentFrame();
    const initialTangent = initialFrame.tangent.clone();
    const initialBitangent = initialFrame.bitangent.clone();

    console.log('\n=== Tangent frame drift during W+D on SPHERE ===');
    console.log(`Initial tangent:  (${initialTangent.x.toFixed(4)}, ${initialTangent.y.toFixed(4)}, ${initialTangent.z.toFixed(4)})`);
    console.log(`Initial bitangent: (${initialBitangent.x.toFixed(4)}, ${initialBitangent.y.toFixed(4)}, ${initialBitangent.z.toFixed(4)})`);

    harness.pressKey('w');
    harness.pressKey('d');

    const tangentAngles: number[] = [];
    const bitangentAngles: number[] = [];

    for (let i = 0; i < 300; i++) {
      harness.tick(1);
      if (i % 10 === 0) {
        const frame = walker.getTangentFrame();
        const tangentAngle = Math.acos(Math.max(-1, Math.min(1, frame.tangent.dot(initialTangent))));
        const bitangentAngle = Math.acos(Math.max(-1, Math.min(1, frame.bitangent.dot(initialBitangent))));
        tangentAngles.push(tangentAngle * 180 / Math.PI);
        bitangentAngles.push(bitangentAngle * 180 / Math.PI);
      }
    }

    harness.releaseKey('w');
    harness.releaseKey('d');

    console.log('\nTangent rotation from initial (degrees) every 10 frames:');
    for (let i = 0; i < tangentAngles.length; i++) {
      console.log(`  [${i * 10}] tangent: ${tangentAngles[i].toFixed(1)}deg, bitangent: ${bitangentAngles[i].toFixed(1)}deg`);
    }

    const maxTangentDrift = Math.max(...tangentAngles);
    const maxBitangentDrift = Math.max(...bitangentAngles);
    console.log(`\nMax tangent drift: ${maxTangentDrift.toFixed(1)}deg`);
    console.log(`Max bitangent drift: ${maxBitangentDrift.toFixed(1)}deg`);
  });

  test('V OSCILLATION: Track V value frame-by-frame during W+D on capsule', () => {
    harness = new RealGameTestHarness('pill');
    harness.tick(10);

    harness.pressKey('w');
    harness.pressKey('d');

    const vValues: number[] = [];
    const yValues: number[] = [];

    for (let i = 0; i < 120; i++) {
      harness.tick(1);
      const uv = harness.getPlayerSurfaceUV();
      const pos = harness.getPlayerWorldPos();
      vValues.push(uv.v);
      yValues.push(pos.y);
    }

    harness.releaseKey('w');
    harness.releaseKey('d');

    console.log('\n=== V value frame-by-frame during W+D (first 60 frames) ===');
    for (let i = 0; i < 60; i++) {
      const vDir = i > 0 ? (vValues[i] > vValues[i - 1] ? '+' : '-') : ' ';
      console.log(`  [${i.toString().padStart(3)}] v=${vValues[i].toFixed(5)} y=${yValues[i].toFixed(4)} ${vDir}`);
    }

    // Count direction changes in V (oscillation)
    let dirChanges = 0;
    for (let i = 2; i < vValues.length; i++) {
      const prevDir = vValues[i - 1] - vValues[i - 2];
      const currDir = vValues[i] - vValues[i - 1];
      if (prevDir * currDir < 0) dirChanges++;
    }

    console.log(`\nV direction changes in 120 frames: ${dirChanges}`);
    console.log(`V oscillation frequency: ${(dirChanges / 120 * 60).toFixed(1)} Hz`);

    // The V oscillation IS the "looping in place" the user sees.
    // The player moves azimuthally (U changes) but the V bounces back and forth,
    // making the player appear to oscillate along the capsule axis while circling.
    // This creates the visual effect of "going nowhere" or "looping".
  });
});
