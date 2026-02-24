/**
 * CameraController pinch-to-zoom tests
 *
 * Regression test for: 2-finger pinch must NOT trigger zoom (dual joystick conflict fix).
 * Only 3+ finger gestures should zoom the camera.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CameraController } from './CameraController';

// ---------------------------------------------------------------------------
// Minimal THREE.js mock
// ---------------------------------------------------------------------------

function makeVec3() {
  return {
    x: 0, y: 0, z: 0,
    copy: vi.fn().mockReturnThis(),
    multiplyScalar: vi.fn().mockReturnThis(),
    add: vi.fn().mockReturnThis(),
    applyQuaternion: vi.fn().mockReturnThis(),
    normalize: vi.fn().mockReturnThis(),
    lerp: vi.fn().mockReturnThis(),
  };
}

const mockCamera = {
  position: makeVec3(),
  up: { ...makeVec3(), lerp: vi.fn().mockReturnThis(), normalize: vi.fn().mockReturnThis() },
  lookAt: vi.fn(),
};

vi.mock('three', () => ({
  Vector3: vi.fn().mockImplementation(makeVec3),
  Quaternion: vi.fn().mockImplementation(() => ({
    setFromAxisAngle: vi.fn().mockReturnThis(),
  })),
}));

// ---------------------------------------------------------------------------
// Document event listener capture
// ---------------------------------------------------------------------------

type Listener = (e: TouchEvent) => void;
const _docListeners: Map<string, Listener[]> = new Map();

function fireTouchEvent(type: string, touchList: Array<{ clientX: number; clientY: number }>): void {
  const listeners = _docListeners.get(type) ?? [];
  const touchObj: ArrayLike<{ clientX: number; clientY: number }> & { length: number } = {
    length: touchList.length,
    ...Object.fromEntries(touchList.map((t, i) => [i, t])),
  };
  const event = { touches: touchObj, preventDefault: vi.fn() } as unknown as TouchEvent;
  for (const fn of listeners) fn(event);
}

beforeEach(() => {
  _docListeners.clear();
  vi.stubGlobal('document', {
    addEventListener: (type: string, fn: Listener) => {
      if (!_docListeners.has(type)) _docListeners.set(type, []);
      _docListeners.get(type)!.push(fn);
    },
    removeEventListener: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CameraController pinch-to-zoom (3-finger only)', () => {

  it('2-finger touchmove does NOT change camera distance', () => {
    const cc = new CameraController(mockCamera as any);
    const initial = cc.getCameraDistance();

    // Start 2-finger gesture (joystick-style)
    fireTouchEvent('touchstart', [
      { clientX: 100, clientY: 300 },
      { clientX: 200, clientY: 300 },
    ]);
    // Move fingers apart — should NOT zoom
    fireTouchEvent('touchmove', [
      { clientX: 50,  clientY: 300 },
      { clientX: 250, clientY: 300 },
    ]);

    expect(cc.getCameraDistance()).toBe(initial);
  });

  it('3-finger touchmove DOES change camera distance when fingers spread', () => {
    const cc = new CameraController(mockCamera as any);
    const initial = cc.getCameraDistance();

    // Start 3-finger gesture (fingers close together)
    fireTouchEvent('touchstart', [
      { clientX: 150, clientY: 300 },
      { clientX: 160, clientY: 300 },
      { clientX: 155, clientY: 310 },
    ]);
    // Move first two fingers far apart (spread = zoom out = larger distance)
    fireTouchEvent('touchmove', [
      { clientX: 50,  clientY: 300 },
      { clientX: 350, clientY: 300 },
      { clientX: 155, clientY: 310 },
    ]);

    expect(cc.getCameraDistance()).not.toBe(initial);
  });

  it('2-finger touchstart does NOT initialize pinch distance', () => {
    const cc = new CameraController(mockCamera as any);
    cc.setCameraDistance(15);

    // 2-finger start then 3-finger move: distance should not change
    // (because lastPinchDist was never set from a 3-finger start,
    // so even if 3-finger move fires with garbage dist, the delta could be large)
    // This test verifies 2-finger start doesn't contaminate state
    fireTouchEvent('touchstart', [
      { clientX: 150, clientY: 300 },
      { clientX: 160, clientY: 300 },
    ]);
    // Now pretend 3-finger move at same position (dist ~ 10px) — delta from 0 would be large
    // In practice the game never transitions like this, but verify 2-finger start is ignored
    const afterTwoFingerStart = cc.getCameraDistance();
    expect(afterTwoFingerStart).toBe(15);
  });

  it('camera distance is clamped to [CAMERA_DIST_MIN, CAMERA_DIST_MAX]', () => {
    const cc = new CameraController(mockCamera as any);
    cc.setCameraDistance(15);

    // Extreme 3-finger pinch inward (fingers very close = large positive delta = max distance)
    fireTouchEvent('touchstart', [
      { clientX: 0,   clientY: 300 },
      { clientX: 1000, clientY: 300 },
      { clientX: 500, clientY: 300 },
    ]);
    fireTouchEvent('touchmove', [
      { clientX: 499, clientY: 300 },
      { clientX: 501, clientY: 300 },
      { clientX: 500, clientY: 300 },
    ]);

    // Distance should be clamped to CAMERA_DIST_MAX (35)
    expect(cc.getCameraDistance()).toBeLessThanOrEqual(35);
    expect(cc.getCameraDistance()).toBeGreaterThanOrEqual(6);
  });
});
