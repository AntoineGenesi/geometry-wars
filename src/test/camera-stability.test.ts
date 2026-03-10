/**
 * Camera Stability Test
 *
 * BUG: Constant repeating lag/delay effect during movement. Visible as periodic
 * shifts in the player trail, suggesting camera.up vector instability when crossing
 * triangle edges on the mesh.
 *
 * This test measures camera.up stability during straight-line movement.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Mock setup (same pattern as movement-direction-drift.test.ts)
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
          putImageData: _noop, createImageData: () => ({ data: new Uint8ClampedArray(4) }),
          setTransform: _noop, drawImage: _noop, save: _noop, fillText: _noop,
          restore: _noop, beginPath: _noop, moveTo: _noop, lineTo: _noop,
          closePath: _noop, stroke: _noop, translate: _noop, scale: _noop,
          rotate: _noop, arc: _noop, fill: _noop,
          measureText: () => ({ width: 10 }),
          transform: _noop, rect: _noop, clip: _noop,
          canvas: { width: 64, height: 64 },
          fillStyle: '', strokeStyle: '', lineWidth: 1,
          createRadialGradient: () => ({ addColorStop: _noop }),
          createLinearGradient: () => ({ addColorStop: _noop }),
        };
        return {
          width: 64, height: 64, style: {},
          getContext: (type: string) => type === '2d' ? mock2dCtx : null,
          addEventListener: _noopEvent, removeEventListener: _noopEvent,
        };
      }
      return {
        appendChild: _noop, removeChild: _noop, style: {},
        addEventListener: _noopEvent, removeEventListener: _noopEvent,
      };
    },
    addEventListener: _noopEvent, removeEventListener: _noopEvent,
  };
  globalThis.document = mockDoc;
}

// Three.js WebGL mocks
import { vi } from 'vitest';

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three');
  class MockWebGLRenderer {
    domElement = (() => {
      const el = globalThis.document?.createElement('canvas') || { style: {} };
      (el as any).remove = _noop;
      return el;
    })();
    dispose = _noop;
    render = _noop;
    setSize = _noop;
    setPixelRatio = _noop;
    clear = _noop;
    getContext = () => ({ getExtension: () => null });
    capabilities = { isWebGL2: false, maxTextures: 16 };
    info = { render: { frame: 0, calls: 0, triangles: 0 } };
  }
  return { ...actual, WebGLRenderer: MockWebGLRenderer as any };
});

vi.mock('three/examples/jsm/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class {
    passes: any[] = [];
    addPass = _noop; removePass = _noop; render = _noop;
    setSize = _noop; dispose = _noop;
  },
}));

vi.mock('three/examples/jsm/postprocessing/RenderPass.js', () => ({
  RenderPass: class { enabled = true; },
}));

vi.mock('three/examples/jsm/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class {
    enabled = true; strength = 1; radius = 0; threshold = 0;
  },
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { RealGameTestHarness } from './RealGameTestHarness';

describe('Camera Stability — Bug Reproduction', () => {
  afterEach(() => {
    // Cleanup after each test
  });

  it('SHOULD FAIL: camera.up should remain stable during straight-line movement on sphere', () => {
    const h = new RealGameTestHarness({ surface: 'sphere', seed: 22222 });
    h.tick(10); // settle

    // Record camera.up vectors over 300 frames of movement
    h.pressKey('d'); // hold right

    const upVectors: THREE.Vector3[] = [];
    const frameAngles: number[] = []; // angle between consecutive camera.up vectors

    let prevUp = h.game.camera.up.clone().normalize();

    for (let i = 0; i < 300; i++) {
      h.tick(1);
      const currentUp = h.game.camera.up.clone().normalize();
      upVectors.push(currentUp.clone());

      // Measure angle between this frame's up and previous frame's up
      const angle = Math.acos(Math.max(-1, Math.min(1, currentUp.dot(prevUp))));
      frameAngles.push(angle);

      prevUp.copy(currentUp);
    }

    h.releaseKey('d');

    // ASSERTIONS (should FAIL if camera.up is jittering)

    // 1. No single frame should have a large camera.up rotation
    // On a smooth surface like sphere, camera.up should change gradually as the
    // player moves along the surface. Large jumps indicate jitter.
    const maxAngle = Math.max(...frameAngles);
    const maxAngleDegrees = maxAngle * (180 / Math.PI);

    // Expect no single-frame rotation > 5 degrees (0.087 radians)
    expect(maxAngleDegrees).toBeLessThan(5);

    // 2. Average per-frame rotation should be very small
    const avgAngle = frameAngles.reduce((a, b) => a + b, 0) / frameAngles.length;
    const avgAngleDegrees = avgAngle * (180 / Math.PI);

    expect(avgAngleDegrees).toBeLessThan(1); // Average < 1 degree per frame

    // 3. Count "jitter frames" — frames with >3° rotation
    const jitterThreshold = 3 * (Math.PI / 180); // 3 degrees
    const jitterFrames = frameAngles.filter(a => a > jitterThreshold).length;

    // Should have very few jitter frames (< 5% of total)
    expect(jitterFrames).toBeLessThan(15); // <5% of 300 frames

    // 4. Cumulative drift should be reasonable (camera follows player smoothly)
    // The total drift is the angle from initial up to final up
    const initialUp = upVectors[0];
    const finalUp = upVectors[upVectors.length - 1];
    const totalDrift = Math.acos(Math.max(-1, Math.min(1, initialUp.dot(finalUp))));
    const totalDriftDegrees = totalDrift * (180 / Math.PI);

    // Total drift should be smooth, not excessive (< 30 degrees for 5 seconds)
    expect(totalDriftDegrees).toBeLessThan(30);

    h.dispose();
  });

  it('SHOULD FAIL: camera.up should not oscillate during diagonal movement', () => {
    const h = new RealGameTestHarness({ surface: 'sphere', seed: 33333 });
    h.tick(10);

    // Diagonal movement (W+D) is particularly prone to triggering oscillation
    // if the camera.up lerp fights with tangent frame changes
    h.pressKey('w');
    h.pressKey('d');

    const upVectors: THREE.Vector3[] = [];
    let prevUp = h.game.camera.up.clone().normalize();

    for (let i = 0; i < 120; i++) {
      h.tick(1);
      const currentUp = h.game.camera.up.clone().normalize();
      upVectors.push(currentUp.clone());
      prevUp.copy(currentUp);
    }

    h.releaseKey('w');
    h.releaseKey('d');

    // Detect oscillation: camera.up should not flip back and forth
    // Count direction reversals (dot product sign changes)
    let signFlips = 0;
    for (let i = 2; i < upVectors.length; i++) {
      const delta1 = new THREE.Vector3().subVectors(upVectors[i], upVectors[i - 1]);
      const delta2 = new THREE.Vector3().subVectors(upVectors[i - 1], upVectors[i - 2]);
      if (delta1.dot(delta2) < 0) {
        signFlips++;
      }
    }

    // Should have very few sign flips (<5 for 120 frames)
    expect(signFlips).toBeLessThan(5);

    h.dispose();
  });

  it('SHOULD FAIL: camera.up stability during forward movement on torus', () => {
    // Torus has more complex curvature than sphere, making it a good test case
    const h = new RealGameTestHarness({ surface: 'torus', seed: 44444 });
    h.tick(10);

    h.pressKey('w');

    const frameAngles: number[] = [];
    let prevUp = h.game.camera.up.clone().normalize();

    for (let i = 0; i < 200; i++) {
      h.tick(1);
      const currentUp = h.game.camera.up.clone().normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, currentUp.dot(prevUp))));
      frameAngles.push(angle);
      prevUp.copy(currentUp);
    }

    h.releaseKey('w');

    const maxAngle = Math.max(...frameAngles);
    const maxAngleDegrees = maxAngle * (180 / Math.PI);

    // On torus, allow slightly more rotation per frame due to curvature
    // but still no large jumps
    expect(maxAngleDegrees).toBeLessThan(8);

    // Count jitter frames
    const jitterThreshold = 5 * (Math.PI / 180);
    const jitterFrames = frameAngles.filter(a => a > jitterThreshold).length;

    expect(jitterFrames).toBeLessThan(20); // <10% of 200 frames

    h.dispose();
  });

  it('SHOULD FAIL: camera quaternion should also be stable (alternative measurement)', () => {
    // Test camera quaternion stability as an alternative metric
    const h = new RealGameTestHarness({ surface: 'sphere', seed: 55555 });
    h.tick(10);

    h.pressKey('a'); // hold left

    const quatAngles: number[] = [];
    let prevQuat = h.game.camera.quaternion.clone();

    for (let i = 0; i < 200; i++) {
      h.tick(1);
      const currentQuat = h.game.camera.quaternion.clone();
      const angle = prevQuat.angleTo(currentQuat);
      quatAngles.push(angle);
      prevQuat.copy(currentQuat);
    }

    h.releaseKey('a');

    const maxQuatAngle = Math.max(...quatAngles);
    const maxQuatAngleDegrees = maxQuatAngle * (180 / Math.PI);

    // Camera quaternion shouldn't have large per-frame rotations
    expect(maxQuatAngleDegrees).toBeLessThan(10);

    const avgQuatAngle = quatAngles.reduce((a, b) => a + b, 0) / quatAngles.length;
    const avgQuatAngleDegrees = avgQuatAngle * (180 / Math.PI);

    expect(avgQuatAngleDegrees).toBeLessThan(2);

    h.dispose();
  });

  it('SHOULD FAIL: no periodic jitter pattern during extended movement', () => {
    // User reported "constant repeating lag/delay effect" — this suggests
    // a periodic jitter pattern, not just random noise
    const h = new RealGameTestHarness({ surface: 'sphere', seed: 66666 });
    h.tick(10);

    h.pressKey('d');

    const frameAngles: number[] = [];
    let prevUp = h.game.camera.up.clone().normalize();

    for (let i = 0; i < 360; i++) { // 6 seconds
      h.tick(1);
      const currentUp = h.game.camera.up.clone().normalize();
      const angle = Math.acos(Math.max(-1, Math.min(1, currentUp.dot(prevUp))));
      frameAngles.push(angle);
      prevUp.copy(currentUp);
    }

    h.releaseKey('d');

    // Detect periodic spikes: count how many frames exceed threshold
    const spikeThreshold = 3 * (Math.PI / 180); // 3 degrees
    const spikes: number[] = [];
    for (let i = 0; i < frameAngles.length; i++) {
      if (frameAngles[i] > spikeThreshold) {
        spikes.push(i);
      }
    }

    // If there are regular periodic spikes, they'll be evenly spaced
    // Calculate spacing between consecutive spikes
    const spacings: number[] = [];
    for (let i = 1; i < spikes.length; i++) {
      spacings.push(spikes[i] - spikes[i - 1]);
    }

    // Check if spacings are suspiciously regular (variance < mean)
    if (spacings.length > 3) {
      const meanSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
      const variance = spacings.reduce((acc, s) => acc + Math.pow(s - meanSpacing, 2), 0) / spacings.length;
      const stdDev = Math.sqrt(variance);

      // Regular periodic jitter would have low variance (stdDev << mean)
      // Random jitter would have high variance (stdDev ≈ mean)
      // We want to detect and FAIL on periodic jitter
      if (stdDev < meanSpacing * 0.3) {
        // This indicates periodic jitter!
        expect(spikes.length).toBeLessThan(10); // Should have very few spikes total
      }
    }

    // Overall: total spike count should be low
    expect(spikes.length).toBeLessThan(18); // <5% of 360 frames

    h.dispose();
  });
});
