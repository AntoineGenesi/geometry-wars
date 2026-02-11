/**
 * Regression test: Capsule (pill) surface A+D simultaneous press glitch.
 *
 * Bug: On the pill/capsule map, pressing A+D simultaneously causes the player
 * to glitch/loop in the same spot instead of standing still or moving smoothly.
 *
 * Root cause: When A+D cancel to zero moveX but the player has some residual
 * drift or the tangent frame produces near-zero vectors, the worldToSurface
 * conversion on the capsule can oscillate, or the walker position can jitter.
 *
 * This test verifies that:
 * 1. A+D simultaneous = player stands still (no oscillation)
 * 2. Rapid A/D alternation = smooth movement (no stuck/loop)
 * 3. All surfaces handle A+D without glitching (regression check)
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

import { PlaygroundTestHarness } from './PlaygroundTestHarness';
import type { SurfaceType } from '../surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Measure position variance over N frames. High variance = oscillation/jitter.
 * Returns max displacement from the mean position.
 */
function measureOscillation(harness: PlaygroundTestHarness, frames: number): {
  maxDisplacement: number;
  positions: Array<{ x: number; y: number; z: number }>;
} {
  const positions: Array<{ x: number; y: number; z: number }> = [];

  for (let i = 0; i < frames; i++) {
    harness.tick(1);
    const pos = harness.getPlayerWorldPos();
    positions.push({ x: pos.x, y: pos.y, z: pos.z });
  }

  // Compute mean position
  const mean = { x: 0, y: 0, z: 0 };
  for (const p of positions) {
    mean.x += p.x;
    mean.y += p.y;
    mean.z += p.z;
  }
  mean.x /= positions.length;
  mean.y /= positions.length;
  mean.z /= positions.length;

  // Compute max displacement from mean
  let maxDisplacement = 0;
  for (const p of positions) {
    const dx = p.x - mean.x;
    const dy = p.y - mean.y;
    const dz = p.z - mean.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    maxDisplacement = Math.max(maxDisplacement, dist);
  }

  return { maxDisplacement, positions };
}

/**
 * Check UV stability: no large jumps between consecutive frames.
 */
function measureUVOscillation(harness: PlaygroundTestHarness, frames: number): {
  maxUJump: number;
  maxVJump: number;
  uvs: Array<{ u: number; v: number }>;
} {
  const uvs: Array<{ u: number; v: number }> = [];
  let maxUJump = 0;
  let maxVJump = 0;

  for (let i = 0; i < frames; i++) {
    harness.tick(1);
    const uv = harness.getPlayerSurfaceUV();
    if (uvs.length > 0) {
      const prev = uvs[uvs.length - 1];
      const uJump = Math.abs(uv.u - prev.u);
      const vJump = Math.abs(uv.v - prev.v);
      // Ignore wrapping (jumps > 0.5 are likely seam crossings)
      if (uJump < 0.5) maxUJump = Math.max(maxUJump, uJump);
      if (vJump < 0.5) maxVJump = Math.max(maxVJump, vJump);
    }
    uvs.push({ u: uv.u, v: uv.v });
  }

  return { maxUJump, maxVJump, uvs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Pill map A+D simultaneous press', () => {
  let harness: PlaygroundTestHarness;

  afterEach(() => {
    if (harness) harness.dispose();
  });

  test('A+D simultaneously on pill = player stands still (no oscillation)', () => {
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10); // settle

    // Press A and D simultaneously
    harness.pressKey('a');
    harness.pressKey('d');

    // Measure oscillation over 120 frames (2 seconds)
    const result = measureOscillation(harness, 120);

    harness.releaseKey('a');
    harness.releaseKey('d');

    // Player should not move more than a tiny amount (< 0.01 world units)
    // If the bug exists, we'd see significant oscillation
    expect(result.maxDisplacement).toBeLessThan(0.01);
  });

  test('A+D simultaneously on capsule = player stands still (no oscillation)', () => {
    harness = new PlaygroundTestHarness('capsule');
    harness.tick(10); // settle

    // Press A and D simultaneously
    harness.pressKey('a');
    harness.pressKey('d');

    // Measure oscillation over 120 frames (2 seconds)
    const result = measureOscillation(harness, 120);

    harness.releaseKey('a');
    harness.releaseKey('d');

    expect(result.maxDisplacement).toBeLessThan(0.01);
  });

  test('A+D simultaneously on pill = UV stays stable', () => {
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10); // settle

    harness.pressKey('a');
    harness.pressKey('d');

    const result = measureUVOscillation(harness, 120);

    harness.releaseKey('a');
    harness.releaseKey('d');

    // UV should not jump around
    expect(result.maxUJump).toBeLessThan(0.01);
    expect(result.maxVJump).toBeLessThan(0.01);
  });

  test('W+D simultaneously on pill = player moves diagonally (NOT loops in place)', () => {
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10); // settle

    const startPos = harness.getPlayerWorldPos().clone();

    // Press W and D simultaneously (diagonal movement)
    harness.pressKey('w');
    harness.pressKey('d');

    // Run for 120 frames (2 seconds)
    const positions: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i < 120; i++) {
      harness.tick(1);
      const pos = harness.getPlayerWorldPos();
      positions.push({ x: pos.x, y: pos.y, z: pos.z });
    }

    harness.releaseKey('w');
    harness.releaseKey('d');

    const endPos = harness.getPlayerWorldPos();

    // Player MUST have moved significantly (diagonal movement)
    const totalDistance = startPos.distanceTo(endPos);

    // Check for looping: if player loops, they'll be near start position
    // despite moving for 2 seconds. At speed 3.0, 2 seconds = ~6 world units
    if (totalDistance < 1.0) {
      console.log('W+D LOOP DETECTED on pill! Positions:');
      for (let i = 0; i < Math.min(20, positions.length); i++) {
        const p = positions[i];
        console.log(`  [${i}] x=${p.x.toFixed(4)} y=${p.y.toFixed(4)} z=${p.z.toFixed(4)}`);
      }
      console.log(`  Start: ${startPos.x.toFixed(4)}, ${startPos.y.toFixed(4)}, ${startPos.z.toFixed(4)}`);
      console.log(`  End: ${endPos.x.toFixed(4)}, ${endPos.y.toFixed(4)}, ${endPos.z.toFixed(4)}`);
      console.log(`  Total distance: ${totalDistance.toFixed(4)}`);
    }

    // Also check for oscillation (visiting same positions repeatedly)
    let repeatCount = 0;
    for (let i = 2; i < positions.length; i++) {
      const curr = positions[i];
      const twoBack = positions[i - 2];
      const dx = curr.x - twoBack.x;
      const dy = curr.y - twoBack.y;
      const dz = curr.z - twoBack.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 0.005) repeatCount++;
    }
    const repeatRatio = repeatCount / (positions.length - 2);

    if (repeatRatio > 0.3) {
      console.log(`W+D oscillation detected! Repeat ratio: ${repeatRatio.toFixed(2)}`);
    }

    // Player should move at least 1 world unit in 2 seconds of diagonal movement
    expect(totalDistance).toBeGreaterThan(1.0);
    // Should not be oscillating (looping)
    expect(repeatRatio).toBeLessThan(0.5);
  });

  test('W+A simultaneously on pill = player moves diagonally', () => {
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10);

    const startPos = harness.getPlayerWorldPos().clone();

    harness.pressKey('w');
    harness.pressKey('a');
    harness.tick(120);
    harness.releaseKey('w');
    harness.releaseKey('a');

    const endPos = harness.getPlayerWorldPos();
    const totalDistance = startPos.distanceTo(endPos);

    if (totalDistance < 1.0) {
      console.log(`W+A LOOP DETECTED on pill! Distance: ${totalDistance.toFixed(4)}`);
    }

    expect(totalDistance).toBeGreaterThan(1.0);
  });

  test('W+S simultaneously on pill = player stands still', () => {
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10);

    harness.pressKey('w');
    harness.pressKey('s');

    const result = measureOscillation(harness, 120);

    harness.releaseKey('w');
    harness.releaseKey('s');

    expect(result.maxDisplacement).toBeLessThan(0.01);
  });

  test('rapid A/D alternation on pill = correct oscillation physics', () => {
    // NOTE: Rapidly alternating A/D every 2 frames IS expected to oscillate.
    // At speed 3.0, each direction covers 0.1 units in 2 frames, so the player
    // oscillates between 2 positions ~0.1 apart. This is correct physics, not a bug.
    // The user's "looping in place" bug was about W+D diagonal, not rapid A/D.
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10);

    const startPos = harness.getPlayerWorldPos().clone();

    for (let i = 0; i < 60; i++) {
      if (i % 2 === 0) {
        harness.releaseKey('d');
        harness.pressKey('a');
      } else {
        harness.releaseKey('a');
        harness.pressKey('d');
      }
      harness.tick(2);
    }

    harness.releaseAllKeys();

    const endPos = harness.getPlayerWorldPos();

    // Player should stay near the start position (oscillation keeps them close)
    // but position must be valid (no NaN, no teleport)
    expect(isNaN(endPos.x)).toBe(false);
    expect(isNaN(endPos.y)).toBe(false);
    expect(isNaN(endPos.z)).toBe(false);
    expect(startPos.distanceTo(endPos)).toBeLessThan(1.0);
  });

  test('after A+D release, single direction movement works normally on pill', () => {
    harness = new PlaygroundTestHarness('pill');
    harness.tick(10);

    // Press A+D
    harness.pressKey('a');
    harness.pressKey('d');
    harness.tick(30);
    harness.releaseKey('a');
    harness.releaseKey('d');

    // Now move in a single direction
    const startPos = harness.getPlayerWorldPos();
    harness.pressKey('d');
    harness.tick(60);
    harness.releaseKey('d');
    const endPos = harness.getPlayerWorldPos();

    // Player should have moved significantly
    expect(startPos.distanceTo(endPos)).toBeGreaterThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// Cross-surface regression check: A+D on ALL surfaces
// ---------------------------------------------------------------------------

describe('A+D simultaneous on all surfaces (regression check)', () => {
  const surfaces: SurfaceType[] = [
    'sphere', 'torus', 'cube', 'capsule', 'pill',
    'peanut', 'pipe', 'icosahedron', 'mobius', 'sphere-tunnel',
  ];

  for (const surfaceType of surfaces) {
    test(`A+D on ${surfaceType} = no oscillation`, () => {
      let harness: PlaygroundTestHarness | null = null;
      try {
        harness = new PlaygroundTestHarness(surfaceType);
        harness.tick(10);

        harness.pressKey('a');
        harness.pressKey('d');

        const result = measureOscillation(harness, 60);

        harness.releaseKey('a');
        harness.releaseKey('d');

        // No surface should oscillate when A+D cancel out
        expect(result.maxDisplacement).toBeLessThan(0.05);
      } finally {
        if (harness) harness.dispose();
      }
    });
  }
});
