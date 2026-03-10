/**
 * Movement Direction Drift Test
 *
 * BUG: Holding a single direction key (e.g., right/D) on a sphere causes
 * the player to curve and eventually reverse direction instead of moving
 * in a straight line (great circle).
 *
 * This test simulates the exact user complaint: "Hold right → player curves back."
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Mock setup (same pattern as existing tests)
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

describe('Movement Direction Drift — Bug Reproduction', () => {
  afterEach(() => {
    // Cleanup after each test
  });

  it('SHOULD FAIL: holding right (D) for 300 frames should produce straight-line movement', () => {
    // Create harness on sphere
    const h = new RealGameTestHarness({ surface: 'sphere', seed: 12345 });
    h.tick(10); // settle

    // Record initial position and determine the "right" direction
    const startPos = h.getPlayerWorldPos();

    // Get camera state to determine screen-right direction
    const cam = h.game.camera;
    const camWorldQuat = cam.getWorldQuaternion(new THREE.Quaternion());
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camWorldQuat);

    // Initial direction vector (normalize for comparison)
    const initialDir = screenRight.clone().normalize();

    // Hold right key for 300 frames (5 seconds at 60 FPS)
    h.pressKey('d');

    const positions: THREE.Vector3[] = [startPos.clone()];
    const directions: THREE.Vector3[] = [];

    for (let i = 0; i < 300; i++) {
      h.tick(1);
      const pos = h.getPlayerWorldPos();
      positions.push(pos.clone());

      // Calculate direction from previous to current position
      if (i > 0) {
        const dir = new THREE.Vector3().subVectors(positions[i + 1], positions[i]);
        if (dir.lengthSq() > 0.0001) {
          directions.push(dir.normalize());
        }
      }
    }

    h.releaseKey('d');

    // Measure direction consistency
    // On a sphere, holding "right" should follow a great circle, which appears
    // as a straight line from the player's perspective. The angle between the
    // initial direction and current direction should NOT grow significantly.

    // Sample directions at regular intervals
    const sampleIndices = [30, 60, 120, 180, 240, 299]; // 0.5s, 1s, 2s, 3s, 4s, 5s
    const angleDrifts: number[] = [];

    for (const idx of sampleIndices) {
      if (idx < directions.length) {
        const currentDir = directions[idx];
        const angle = Math.acos(Math.max(-1, Math.min(1, currentDir.dot(initialDir))));
        angleDrifts.push(angle);
      }
    }

    // Calculate final displacement from start
    const finalPos = h.getPlayerWorldPos();
    const totalDisplacement = startPos.distanceTo(finalPos);

    // Check if player returned to starting area (sign of reversal)
    const finalDist = startPos.distanceTo(finalPos);
    const maxExpectedDist = 300 * (3.0 / 60); // 300 frames * speed * dt ≈ 15 units

    // ASSERTIONS (these should FAIL on current code with the bug)

    // 1. Final angle drift should stay within reasonable bounds (±15° = ±0.26 rad)
    const finalAngleDrift = angleDrifts[angleDrifts.length - 1] || 0;
    expect(finalAngleDrift).toBeLessThan(0.26); // 15 degrees in radians

    // 2. Player should NOT return to starting area
    expect(finalDist).toBeGreaterThan(5); // Should have moved significantly away

    // 3. Total displacement should be significant (no getting stuck)
    expect(totalDisplacement).toBeGreaterThan(10);

    // 4. Direction should not reverse (dot product with initial should stay positive)
    const finalDir = directions[directions.length - 1];
    if (finalDir) {
      const dotWithInitial = finalDir.dot(initialDir);
      expect(dotWithInitial).toBeGreaterThan(0.5); // Should still be going roughly "right"
    }

    h.dispose();
  });

  it('SHOULD FAIL: holding forward (W) for 300 frames should produce straight-line movement', () => {
    const h = new RealGameTestHarness({ surface: 'sphere', seed: 54321 });
    h.tick(10);

    const startPos = h.getPlayerWorldPos();
    const cam = h.game.camera;
    const camWorldQuat = cam.getWorldQuaternion(new THREE.Quaternion());
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camWorldQuat);
    const initialDir = screenUp.clone().normalize();

    h.pressKey('w');

    const directions: THREE.Vector3[] = [];
    let prevPos = startPos.clone();

    for (let i = 0; i < 300; i++) {
      h.tick(1);
      const pos = h.getPlayerWorldPos();
      const dir = new THREE.Vector3().subVectors(pos, prevPos);
      if (dir.lengthSq() > 0.0001) {
        directions.push(dir.normalize());
      }
      prevPos.copy(pos);
    }

    h.releaseKey('w');

    const finalPos = h.getPlayerWorldPos();
    const finalDist = startPos.distanceTo(finalPos);

    // Check angle drift at end
    if (directions.length > 10) {
      const finalDir = directions[directions.length - 1];
      const angle = Math.acos(Math.max(-1, Math.min(1, finalDir.dot(initialDir))));

      expect(angle).toBeLessThan(0.26); // 15 degrees
    }

    expect(finalDist).toBeGreaterThan(5);

    h.dispose();
  });

  it('SHOULD FAIL: diagonal movement (W+D) should not cause oscillation or stuck behavior', () => {
    const h = new RealGameTestHarness({ surface: 'sphere', seed: 99999 });
    h.tick(10);

    const startPos = h.getPlayerWorldPos();

    // Hold both W and D (diagonal)
    h.pressKey('w');
    h.pressKey('d');

    const displacements: number[] = [];
    let prevPos = startPos.clone();

    for (let i = 0; i < 120; i++) {
      h.tick(1);
      const pos = h.getPlayerWorldPos();
      const dist = prevPos.distanceTo(pos);
      displacements.push(dist);
      prevPos.copy(pos);
    }

    h.releaseKey('w');
    h.releaseKey('d');

    const finalPos = h.getPlayerWorldPos();
    const totalDist = startPos.distanceTo(finalPos);

    // Check for oscillation: large variance in per-frame displacement
    const avgDisp = displacements.reduce((a, b) => a + b, 0) / displacements.length;
    const variance = displacements.reduce((acc, d) => acc + Math.pow(d - avgDisp, 2), 0) / displacements.length;
    const stdDev = Math.sqrt(variance);

    // ASSERTIONS (should FAIL if diagonal causes stuck/oscillation)
    expect(totalDist).toBeGreaterThan(4); // Should move significantly
    expect(stdDev).toBeLessThan(avgDisp * 2); // Displacement shouldn't vary wildly

    h.dispose();
  });

  it('SHOULD FAIL: movement on torus should also maintain straight-line direction', () => {
    // Test on a different surface to ensure the bug isn't sphere-specific
    const h = new RealGameTestHarness({ surface: 'torus', seed: 11111 });
    h.tick(10);

    const startPos = h.getPlayerWorldPos();
    const cam = h.game.camera;
    const camWorldQuat = cam.getWorldQuaternion(new THREE.Quaternion());
    const screenRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camWorldQuat);
    const initialDir = screenRight.clone().normalize();

    h.pressKey('d');

    const directions: THREE.Vector3[] = [];
    let prevPos = startPos.clone();

    for (let i = 0; i < 200; i++) {
      h.tick(1);
      const pos = h.getPlayerWorldPos();
      const dir = new THREE.Vector3().subVectors(pos, prevPos);
      if (dir.lengthSq() > 0.0001) {
        directions.push(dir.normalize());
      }
      prevPos.copy(pos);
    }

    h.releaseKey('d');

    const finalPos = h.getPlayerWorldPos();

    // Check angle consistency
    if (directions.length > 10) {
      const midDir = directions[Math.floor(directions.length / 2)];
      const finalDir = directions[directions.length - 1];
      const angleMid = Math.acos(Math.max(-1, Math.min(1, midDir.dot(initialDir))));
      const angleFinal = Math.acos(Math.max(-1, Math.min(1, finalDir.dot(initialDir))));

      // On a torus, the direction might legitimately change due to curvature,
      // but it shouldn't reverse or drift excessively
      expect(angleMid).toBeLessThan(Math.PI / 3); // 60 degrees
      expect(angleFinal).toBeLessThan(Math.PI / 3);
    }

    const totalDist = startPos.distanceTo(finalPos);
    expect(totalDist).toBeGreaterThan(3);

    h.dispose();
  });
});
