/**
 * Gun Direction Accuracy Test
 *
 * BUG: Gun doesn't fire where the mouse is pointing. User reported:
 * "If mouse is left of player, gun points right" — suggesting the aim
 * direction is mirrored or inverted.
 *
 * This test verifies that bullets fire in the correct screen-space direction
 * matching the aim input.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Mock setup (same pattern as other test files)
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

import { PlaygroundTestHarness } from './PlaygroundTestHarness';

describe('Gun Direction Accuracy — Bug Reproduction', () => {
  afterEach(() => {
    // Cleanup after each test
  });

  it('SHOULD FAIL: aiming right (mouse right of center) should produce rightward bullet', () => {
    const h = new PlaygroundTestHarness({
      surface: 'sphere',
      seed: 77777,
      weapon: null, // Use standard weapon
    });
    h.tick(10); // settle

    // Get player screen position
    const playerScreen = h.getPlayerScreenPos();

    // Set mouse to the RIGHT of player (screen-space right)
    const mouseX = playerScreen.x + 150; // 150 pixels to the right
    const mouseY = playerScreen.y; // same vertical position
    h.setMousePosition(mouseX, mouseY);
    h.tick(5); // let aim update

    // Fire a bullet
    h.setMouseDown(true);
    h.tick(1);
    h.setMouseDown(false);
    h.tick(5); // let bullet spawn and travel

    // Get bullet position
    const bullets = h.getBulletScreenPositions();

    // ASSERTIONS (should FAIL if gun direction is mirrored)
    expect(bullets.length).toBeGreaterThan(0); // At least one bullet fired

    if (bullets.length > 0) {
      const bullet = bullets[0];

      // Bullet should be to the RIGHT of player (positive X displacement)
      const bulletDx = bullet.x - playerScreen.x;
      expect(bulletDx).toBeGreaterThan(0); // Should be positive (rightward)

      // Bullet should not be significantly to the LEFT
      expect(bulletDx).not.toBeLessThan(-10); // Allow small numerical error but not full mirroring
    }

    h.dispose();
  });

  it('SHOULD FAIL: aiming left (mouse left of center) should produce leftward bullet', () => {
    const h = new PlaygroundTestHarness({
      surface: 'sphere',
      seed: 88888,
      weapon: null, // Use standard weapon
    });
    h.tick(10);

    const playerScreen = h.getPlayerScreenPos();

    // Set mouse to the LEFT of player
    const mouseX = playerScreen.x - 150;
    const mouseY = playerScreen.y;
    h.setMousePosition(mouseX, mouseY);
    h.tick(5);

    h.setMouseDown(true);
    h.tick(1);
    h.setMouseDown(false);
    h.tick(5);

    const bullets = h.getBulletScreenPositions();

    expect(bullets.length).toBeGreaterThan(0);

    if (bullets.length > 0) {
      const bullet = bullets[0];
      const bulletDx = bullet.x - playerScreen.x;

      // Bullet should be to the LEFT of player (negative X displacement)
      expect(bulletDx).toBeLessThan(0);

      // Should not be significantly to the RIGHT (no mirroring)
      expect(bulletDx).not.toBeGreaterThan(10);
    }

    h.dispose();
  });

  it('SHOULD FAIL: aiming up (mouse above center) should produce upward bullet', () => {
    const h = new PlaygroundTestHarness({
      surface: 'sphere',
      seed: 99999,
      weapon: null, // Use standard weapon
    });
    h.tick(10);

    const playerScreen = h.getPlayerScreenPos();

    // Set mouse ABOVE player (screen-space up = negative Y in screen coords)
    const mouseX = playerScreen.x;
    const mouseY = playerScreen.y - 150; // 150 pixels up
    h.setMousePosition(mouseX, mouseY);
    h.tick(5);

    h.setMouseDown(true);
    h.tick(1);
    h.setMouseDown(false);
    h.tick(5);

    const bullets = h.getBulletScreenPositions();

    expect(bullets.length).toBeGreaterThan(0);

    if (bullets.length > 0) {
      const bullet = bullets[0];
      const bulletDy = bullet.y - playerScreen.y;

      // Bullet should be ABOVE player (negative Y displacement in screen coords)
      expect(bulletDy).toBeLessThan(0);

      // Should not be significantly BELOW (no inversion)
      expect(bulletDy).not.toBeGreaterThan(10);
    }

    h.dispose();
  });

  it('SHOULD FAIL: aiming down (mouse below center) should produce downward bullet', () => {
    const h = new PlaygroundTestHarness({
      surface: 'sphere',
      seed: 12121,
      weapon: null, // Use standard weapon
    });
    h.tick(10);

    const playerScreen = h.getPlayerScreenPos();

    // Set mouse BELOW player (screen-space down = positive Y)
    const mouseX = playerScreen.x;
    const mouseY = playerScreen.y + 150;
    h.setMousePosition(mouseX, mouseY);
    h.tick(5);

    h.setMouseDown(true);
    h.tick(1);
    h.setMouseDown(false);
    h.tick(5);

    const bullets = h.getBulletScreenPositions();

    expect(bullets.length).toBeGreaterThan(0);

    if (bullets.length > 0) {
      const bullet = bullets[0];
      const bulletDy = bullet.y - playerScreen.y;

      // Bullet should be BELOW player (positive Y displacement)
      expect(bulletDy).toBeGreaterThan(0);

      // Should not be significantly ABOVE
      expect(bulletDy).not.toBeLessThan(-10);
    }

    h.dispose();
  });

  it('SHOULD FAIL: diagonal aim (up-right) should produce up-right bullet', () => {
    const h = new PlaygroundTestHarness({
      surface: 'sphere',
      seed: 23232,
      weapon: null, // Use standard weapon
    });
    h.tick(10);

    const playerScreen = h.getPlayerScreenPos();

    // Aim diagonally up-right
    const mouseX = playerScreen.x + 100;
    const mouseY = playerScreen.y - 100;
    h.setMousePosition(mouseX, mouseY);
    h.tick(5);

    h.setMouseDown(true);
    h.tick(1);
    h.setMouseDown(false);
    h.tick(5);

    const bullets = h.getBulletScreenPositions();

    expect(bullets.length).toBeGreaterThan(0);

    if (bullets.length > 0) {
      const bullet = bullets[0];
      const bulletDx = bullet.x - playerScreen.x;
      const bulletDy = bullet.y - playerScreen.y;

      // Both components should match the aim direction
      expect(bulletDx).toBeGreaterThan(0); // rightward
      expect(bulletDy).toBeLessThan(0); // upward (negative Y in screen)

      // Angle should be roughly 45 degrees (similar magnitudes)
      const ratio = Math.abs(bulletDy / bulletDx);
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2.0);
    }

    h.dispose();
  });

  it('SHOULD FAIL: aim direction vector should match input direction', () => {
    // More direct test: use getAimScreenDirection() to verify the aim vector itself
    const h = new PlaygroundTestHarness({
      surface: 'sphere',
      seed: 34343,
      weapon: null, // Use standard weapon
    });
    h.tick(10);

    const playerScreen = h.getPlayerScreenPos();

    // Test RIGHT aim
    h.setMousePosition(playerScreen.x + 200, playerScreen.y);
    h.tick(5);
    let aimDir = h.getAimScreenDirection();
    expect(aimDir.x).toBeGreaterThan(0.7); // Should be strongly rightward (normalized)
    expect(Math.abs(aimDir.y)).toBeLessThan(0.3); // Minimal vertical component

    // Test LEFT aim
    h.setMousePosition(playerScreen.x - 200, playerScreen.y);
    h.tick(5);
    aimDir = h.getAimScreenDirection();
    expect(aimDir.x).toBeLessThan(-0.7); // Should be strongly leftward
    expect(Math.abs(aimDir.y)).toBeLessThan(0.3);

    // Test UP aim
    h.setMousePosition(playerScreen.x, playerScreen.y - 200);
    h.tick(5);
    aimDir = h.getAimScreenDirection();
    expect(Math.abs(aimDir.x)).toBeLessThan(0.3);
    expect(aimDir.y).toBeLessThan(-0.7); // Should be strongly upward (negative Y)

    // Test DOWN aim
    h.setMousePosition(playerScreen.x, playerScreen.y + 200);
    h.tick(5);
    aimDir = h.getAimScreenDirection();
    expect(Math.abs(aimDir.x)).toBeLessThan(0.3);
    expect(aimDir.y).toBeGreaterThan(0.7); // Should be strongly downward (positive Y)

    h.dispose();
  });

  it('SHOULD FAIL: bullet world velocity should align with aim direction', () => {
    // Test using world-space vectors instead of screen-space
    const h = new PlaygroundTestHarness({
      surface: 'sphere',
      seed: 45454,
      weapon: null, // Use standard weapon
    });
    h.tick(10);

    // Aim to the right in screen space
    const playerScreen = h.getPlayerScreenPos();
    h.setMousePosition(playerScreen.x + 150, playerScreen.y);
    h.tick(5);

    // Get the aim direction that should be used
    const aimDir = h.getAimScreenDirection();

    // Fire
    h.setMouseDown(true);
    h.tick(1);
    h.setMouseDown(false);

    const bulletsBefore = h.getBulletWorldPositions();
    h.tick(10); // let bullet travel
    const bulletsAfter = h.getBulletWorldPositions();

    if (bulletsBefore.length > 0 && bulletsAfter.length > 0) {
      // Calculate bullet velocity in world space
      const bulletBefore = bulletsBefore[0];
      const bulletAfter = bulletsAfter[0];
      const bulletWorldVel = new THREE.Vector3().subVectors(bulletAfter, bulletBefore);

      // Project bullet velocity to screen space for comparison
      const cam = h.pg.game.camera;
      const bulletBeforeScreen = h.getPlayerScreenPos(); // This is wrong, should project bullet

      // Actually, let's verify using the player aim direction
      // The bullet should be traveling in roughly the same direction as the aim
      const playerWorldPos = h.getPlayerWorldPos();

      // Get camera right vector (screen-space X axis)
      const camQuat = cam.getWorldQuaternion(new THREE.Quaternion());
      const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camQuat);

      // Bullet velocity projected onto camera right should be positive (moving right)
      const velDotRight = bulletWorldVel.dot(camRight);
      expect(velDotRight).toBeGreaterThan(0); // Should be moving in the "right" direction
    }

    h.dispose();
  });

  it('SHOULD FAIL: aim direction consistency during movement', () => {
    // Verify that aim direction remains correct even while moving
    const h = new PlaygroundTestHarness({
      surface: 'sphere',
      seed: 56565,
      weapon: null, // Use standard weapon
    });
    h.tick(10);

    // Move right while aiming up
    h.pressKey('d');
    const playerScreen = h.getPlayerScreenPos();
    h.setMousePosition(playerScreen.x, playerScreen.y - 150); // aim up

    h.tick(30); // move for 30 frames

    const aimDir = h.getAimScreenDirection();

    // Should still be aiming UP (negative Y) despite moving right
    expect(aimDir.y).toBeLessThan(-0.5);
    expect(Math.abs(aimDir.x)).toBeLessThan(0.5); // Minimal horizontal component

    h.releaseKey('d');
    h.dispose();
  });
});
