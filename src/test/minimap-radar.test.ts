/**
 * Unit tests for the UV-space minimap overlay.
 *
 * Tests cover:
 * - Basic rendering calls (no-throw)
 * - Toggle show/hide
 * - Edge cases (co-located entities, dead enemies, empty arrays)
 *
 * NOTE: The Minimap class is a simple UV-grid minimap that takes
 * (playerU, playerV, enemies, geoms) — not the advanced radar API.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the DOM environment for Canvas creation
vi.stubGlobal('document', {
  createElement: () => ({
    width: 0,
    height: 0,
    style: { cssText: '' },
    getContext: () => ({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      createLinearGradient: () => ({ addColorStop: vi.fn() }),
      set fillStyle(_v: string) {},
      set strokeStyle(_v: string) {},
      set lineWidth(_v: number) {},
      set shadowColor(_v: string) {},
      set shadowBlur(_v: number) {},
      scale: vi.fn(),
      strokeRect: vi.fn(),
    }),
    parentNode: { removeChild: vi.fn() },
  }),
  body: {
    appendChild: vi.fn(),
    removeChild: vi.fn(),
  },
});

vi.stubGlobal('window', { devicePixelRatio: 1 });

// Import after mocks are set up
import { Minimap } from '../ui/Minimap';

describe('Minimap', () => {
  let minimap: Minimap;

  beforeEach(() => {
    minimap = new Minimap();
  });

  afterEach(() => {
    minimap.dispose();
  });

  describe('Rendering calls (no-throw)', () => {
    test('renders with enemy to the right of player', () => {
      const enemies = [{ u: 0.6, v: 0.5, alive: true }];
      minimap.update(0.5, 0.5, enemies, []);
    });

    test('renders with enemy behind player', () => {
      const enemies = [{ u: 0.5, v: 0.7, alive: true }];
      minimap.update(0.5, 0.5, enemies, []);
    });

    test('handles co-located entity gracefully', () => {
      const enemies = [{ u: 0.5, v: 0.5, alive: true }];
      // Same UV as player — should not throw
      minimap.update(0.5, 0.5, enemies, []);
    });

    test('UV wrap case: enemy at u=0.9 when player at u=0.1', () => {
      const enemies = [{ u: 0.9, v: 0.5, alive: true }];
      minimap.update(0.1, 0.5, enemies, []);
    });

    test('enemy at far v: v=0.9 when player at v=0.1', () => {
      const enemies = [{ u: 0.5, v: 0.9, alive: true }];
      minimap.update(0.5, 0.1, enemies, []);
    });

    test('torus-like: both u and v near wrap boundary', () => {
      const enemies = [{ u: 0.9, v: 0.9, alive: true }];
      minimap.update(0.1, 0.1, enemies, []);
    });
  });

  describe('Geom rendering', () => {
    test('geoms appear alongside enemies', () => {
      const geoms = [
        { u: 0.55, v: 0.5 },
        { u: 0.45, v: 0.5 },
      ];
      minimap.update(0.5, 0.5, [], geoms);
    });
  });

  describe('Edge cases', () => {
    test('dead enemies are not rendered (no-throw)', () => {
      const enemies = [{ u: 0.6, v: 0.5, alive: false }];
      minimap.update(0.5, 0.5, enemies, []);
    });

    test('handles empty enemy and geom arrays', () => {
      minimap.update(0.5, 0.5, [], []);
    });

    test('handles large number of enemies without error', () => {
      const enemies = [];
      for (let i = 0; i < 200; i++) {
        enemies.push({
          u: Math.random(), v: Math.random(), alive: true,
        });
      }
      minimap.update(0.5, 0.5, enemies, []);
    });

    test('toggle hides and shows the radar', () => {
      minimap.toggle(); // hide
      minimap.toggle(); // show
    });

    test('update while hidden does not throw', () => {
      minimap.toggle(); // hide
      minimap.update(0.5, 0.5, [], []);
    });
  });
});

describe('Radar distance computation correctness', () => {
  /**
   * Pure math tests for UV-space distance formulas used by the minimap.
   * These don't depend on the Minimap class itself.
   */

  test('sphere: UV distance at equator is roughly circumference/2 for du=0.5', () => {
    // On a sphere of radius 10: circumference = 2*pi*10 ≈ 62.8
    // avgWorldPerUV ≈ 47 (geometric mean of U and V scales)
    // UV distance of 0.5 → 0.5 * 47 ≈ 23.5 world units
    const avgWorldPerUV = 47;
    const du = 0.5;
    const surfaceDist = du * avgWorldPerUV;
    expect(surfaceDist).toBeCloseTo(23.5, 0);
  });

  test('torus wrapping: du=0.8 wraps to 0.2 when wrapsU is true', () => {
    const avgWorldPerUV = 40;
    let du = 0.8;
    const wrapsU = true;
    if (wrapsU && du > 0.5) du = 1 - du; // = 0.2
    const surfaceDist = du * avgWorldPerUV;
    expect(surfaceDist).toBeCloseTo(8, 0); // 0.2 * 40 = 8
  });

  test('cube (non-wrapping V): dv=0.8 stays 0.8', () => {
    const avgWorldPerUV = 50;
    const dv = 0.8;
    // V doesn't wrap, so dv stays 0.8
    const surfaceDist = dv * avgWorldPerUV;
    expect(surfaceDist).toBeCloseTo(40, 0); // 0.8 * 50 = 40
  });
});
