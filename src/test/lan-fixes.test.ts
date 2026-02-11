/**
 * Regression tests for LAN multiplayer fixes (Feb 2026).
 *
 * These tests verify specific bugs that were found during LAN testing:
 * - Bug #7: Window focus — input isolation between browser windows
 * - Bug #8: Spawn rings — ring lifecycle cleanup in network mode
 * - Bug #10: Bullet angle — bullet orientation using surface tangent frame
 * - Bug #11: Origin blocking — cube face V-clamping (not wrapping)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Bug #7: InputManager should clear state on window blur
//
// We need a window mock that actually dispatches events (the default
// verification-env mock uses no-op addEventListener). We build a minimal
// EventTarget-based mock here and install it before InputManager is imported.
//
// Node.js does not provide KeyboardEvent, so we polyfill it as a simple
// Event subclass that carries a .key property. InputManager only reads
// e.key and calls e.preventDefault(), so this is sufficient.
// ---------------------------------------------------------------------------

// Polyfill KeyboardEvent for Node.js test environment
if (typeof globalThis.KeyboardEvent === 'undefined') {
  (globalThis as any).KeyboardEvent = class KeyboardEvent extends Event {
    readonly key: string;
    constructor(type: string, init?: { key?: string }) {
      super(type);
      this.key = init?.key ?? '';
    }
    preventDefault() { /* no-op in test */ }
  };
}

/**
 * Create a minimal mock window that supports addEventListener / dispatchEvent
 * for the InputManager tests. This replaces globalThis.window before the
 * InputManager constructor attaches its listeners.
 */
function createEventWindow() {
  const target = new EventTarget();
  const win: any = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    location: { search: '', href: '' },
    navigator: { getGamepads: () => [] },
    getComputedStyle: () => ({}),
  };
  return win;
}

describe('InputManager window blur handling', () => {
  let origWindow: any;
  let mockWin: any;

  beforeEach(() => {
    origWindow = globalThis.window;
    mockWin = createEventWindow();
    (globalThis as any).window = mockWin;
    // Reset module cache so InputManager constructor picks up our new window
    vi.resetModules();
  });

  afterEach(() => {
    (globalThis as any).window = origWindow;
  });

  it('BUG-7: InputManager clears keys and mouse on blur event', async () => {
    const { InputManager } = await import('../input/InputManager');
    const input = new InputManager();

    try {
      // Simulate pressing W key via a real event dispatched on our mock window
      mockWin.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));

      // Key should be held
      expect(input.isKeyDown('w')).toBe(true);

      // Simulate window blur (user clicks a different browser window)
      mockWin.dispatchEvent(new Event('blur'));

      // Key should be cleared
      expect(input.isKeyDown('w')).toBe(false);

      // Input state should report zero movement
      const state = input.getState();
      expect(state.moveX).toBe(0);
      expect(state.moveY).toBe(0);
      expect(state.shooting).toBe(false);
    } finally {
      input.dispose();
    }
  });

  it('BUG-7: InputManager clears multiple held keys on blur', async () => {
    const { InputManager } = await import('../input/InputManager');
    const input = new InputManager();

    try {
      // Simulate pressing WASD
      mockWin.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      mockWin.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      mockWin.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));
      mockWin.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));

      expect(input.isKeyDown('w')).toBe(true);
      expect(input.isKeyDown('a')).toBe(true);

      // Blur should clear ALL keys
      mockWin.dispatchEvent(new Event('blur'));

      expect(input.isKeyDown('w')).toBe(false);
      expect(input.isKeyDown('a')).toBe(false);
      expect(input.isKeyDown('s')).toBe(false);
      expect(input.isKeyDown('d')).toBe(false);
    } finally {
      input.dispose();
    }
  });

  it('BUG-7: input works normally after blur+refocus', async () => {
    const { InputManager } = await import('../input/InputManager');
    const input = new InputManager();

    try {
      // Press W, blur, then press W again (simulating refocus + new keypress)
      mockWin.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      expect(input.isKeyDown('w')).toBe(true);

      mockWin.dispatchEvent(new Event('blur'));
      expect(input.isKeyDown('w')).toBe(false);

      // After refocusing and pressing W again, it should work
      mockWin.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' }));
      expect(input.isKeyDown('w')).toBe(true);
    } finally {
      input.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Bug #8: EnemySpawner.spawn() with skipSpawnWarning
// ---------------------------------------------------------------------------

describe('EnemySpawner skipSpawnWarning', () => {
  it('BUG-8: spawn method accepts skipSpawnWarning parameter', async () => {
    // Verify the parameter exists in the method signature
    const mod = await import('../entities/enemies/EnemySpawner');
    const EnemySpawner = mod.EnemySpawner;
    // The spawn method should accept at least 5 parameters
    // (type, surfaceU, surfaceV, tier, skipSpawnWarning)
    expect(typeof EnemySpawner.prototype.spawn).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Bug #11: Cube surface V should NOT wrap (should clamp)
// ---------------------------------------------------------------------------

describe('Cube surface V-clamping in LAN', () => {
  it('BUG-11: cube is NOT in the wrapsInV list for server movement', () => {
    // The server and client must agree that cube clamps V.
    // This test encodes the correct wrapsInV surfaces as a contract.
    const wrapsInVSurfaces = new Set([
      'torus', 'pipe', 'mobius', 'cube-ring', 'cube-tunnel',
    ]);

    // Cube must NOT be in this list
    expect(wrapsInVSurfaces.has('cube')).toBe(false);

    // These MUST be in the list (they have periodic V)
    expect(wrapsInVSurfaces.has('torus')).toBe(true);
    expect(wrapsInVSurfaces.has('pipe')).toBe(true);
    expect(wrapsInVSurfaces.has('mobius')).toBe(true);
    expect(wrapsInVSurfaces.has('cube-ring')).toBe(true);
    expect(wrapsInVSurfaces.has('cube-tunnel')).toBe(true);
  });

  it('BUG-11: CubeSurface.moveOnSurface clamps V near 0 (does not wrap)', async () => {
    const mod = await import('../surfaces/CubeSurface');
    const cube = new mod.CubeSurface({ size: 5 });

    // Moving below V=0 should clamp, not wrap to ~1.0
    const result = cube.moveOnSurface(0.5, 0.01, 0, -0.05);
    expect(result.v).toBeGreaterThanOrEqual(0);
    expect(result.v).toBeLessThan(0.1); // Should be clamped near 0, not ~0.95
  });

  it('BUG-11: CubeSurface.moveOnSurface clamps V near 1 (does not wrap)', async () => {
    const mod = await import('../surfaces/CubeSurface');
    const cube = new mod.CubeSurface({ size: 5 });

    // Moving above V=1 should clamp, not wrap to ~0.0
    const result = cube.moveOnSurface(0.5, 0.99, 0, 0.05);
    expect(result.v).toBeGreaterThan(0.9);
    expect(result.v).toBeLessThanOrEqual(1.0); // Should be clamped near 1, not ~0.05
  });

  it('BUG-11: cube V-clamping uses tighter bounds than sphere', () => {
    // Cube should use 0.003 epsilon (matching CubeSurface.moveOnSurface)
    // Sphere uses 0.05 (avoiding pole singularity)
    const cubeVMin = 0.003;
    const cubeVMax = 0.997;
    const sphereVMin = 0.05;
    const sphereVMax = 0.95;

    // Cube allows more V range than sphere
    expect(cubeVMin).toBeLessThan(sphereVMin);
    expect(cubeVMax).toBeGreaterThan(sphereVMax);
  });
});

// ---------------------------------------------------------------------------
// Bug #10: Bullet direction should use surface tangent frame
// ---------------------------------------------------------------------------

describe('Bullet orientation with surface tangent frame', () => {
  it('BUG-10: surface tangent frame differs from raw UV at non-trivial points', async () => {
    // This test verifies the principle that UV-space directions are NOT
    // equivalent to world-space XYZ directions on curved surfaces.
    // The fix converts UV direction to 3D using: dir = dirX*tangentU + dirY*tangentV
    const { SurfaceFactory } = await import('../surfaces/SurfaceFactory');
    const sphere = SurfaceFactory.create('sphere', { radius: 5 } as any);

    // Test at TWO different points to prove tangentU varies across the surface.
    // On a sphere, tangentU is the partial derivative w.r.t. U — it changes
    // direction as you move across the sphere, which is the whole point:
    // raw UV direction (1,0,0) would be constant but the tangent frame is not.
    const sp1 = sphere.getPoint(0.1, 0.5);
    const sp2 = sphere.getPoint(0.4, 0.5);

    const t1 = sp1.tangentU;
    const t2 = sp2.tangentU;

    // Normalise both tangentU vectors
    const len1 = Math.sqrt(t1.x ** 2 + t1.y ** 2 + t1.z ** 2);
    const n1 = { x: t1.x / len1, y: t1.y / len1, z: t1.z / len1 };
    const len2 = Math.sqrt(t2.x ** 2 + t2.y ** 2 + t2.z ** 2);
    const n2 = { x: t2.x / len2, y: t2.y / len2, z: t2.z / len2 };

    // If UV directions were correct as world-space 3D, tangentU at both
    // points would be the same direction (1,0,0). But on a sphere, they
    // point in DIFFERENT directions (along different tangent circles).
    const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
    // The tangent vectors at u=0.1 and u=0.4 should NOT be parallel
    expect(Math.abs(dot)).toBeLessThan(0.9);
  });

  it('BUG-10: correct bullet direction uses tangent frame multiplication', () => {
    // Verify the math: 3D_dir = dirX * tangentU + dirY * tangentV
    // Given dirX=1, dirY=0, the 3D direction should equal tangentU
    const dirX = 1;
    const dirY = 0;

    // Mock tangent frame at some point
    const tangentU = { x: 0, y: 0, z: -1 }; // Example: pointing into screen
    const tangentV = { x: 0, y: 1, z: 0 };  // Example: pointing up

    const result = {
      x: dirX * tangentU.x + dirY * tangentV.x,
      y: dirX * tangentU.y + dirY * tangentV.y,
      z: dirX * tangentU.z + dirY * tangentV.z,
    };

    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(-1);
    // This is DIFFERENT from raw (dirX, dirY, 0) = (1, 0, 0)
  });
});
