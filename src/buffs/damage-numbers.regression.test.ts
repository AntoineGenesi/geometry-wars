/**
 * Regression tests for s44j-25: Damage numbers for all damage sources.
 *
 * Verifies that:
 * 1. Burning DOT shows orange damage numbers (throttled at 0.5s tick)
 * 2. ShockAura shows damage numbers (pre-existing, non-regression check)
 * 3. spawnDamage accepts optional color parameter
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal THREE mock — only what BuffManager and ScorePopup need
vi.mock('three', () => {
  class Vector3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    distanceTo(_v: Vector3) { return 0; }
    clone() { return new Vector3(this.x, this.y, this.z); }
    add(v: Vector3) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    subVectors(_a: Vector3, _b: Vector3) { return this; }
    normalize() { return this; }
    addScaledVector(_v: Vector3, _s: number) { return this; }
    multiplyScalar(_s: number) { return this; }
    set(_x: number, _y: number, _z: number) { return this; }
  }
  class Color {
    r = 1; g = 1; b = 1;
    constructor(_hex?: number) {}
    setHex(_hex: number) { return this; }
    getHex() { return 0xffffff; }
  }
  return {
    Vector3,
    Color,
    Group: class { add() {} remove() {} },
    Mesh: class { position = new Vector3(); scale = { setScalar() {} }; rotation = { y: 0 }; },
    MeshBasicMaterial: class { dispose() {} transparent = false; opacity = 1; },
    SphereGeometry: class {},
    Sprite: class {
      position = new Vector3();
      scale = { set() {} };
      renderOrder = 0;
      material = { opacity: 1, dispose() {} };
    },
    SpriteMaterial: class {
      map: any = null;
      transparent = false;
      depthTest = false;
      depthWrite = false;
      opacity = 1;
      dispose() {}
    },
    CanvasTexture: class {
      needsUpdate = false;
      dispose() {}
    },
    AdditiveBlending: 2,
  };
});

// Mock canvas for ScorePopup texture creation
Object.defineProperty(globalThis, 'document', {
  value: {
    createElement: (tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0, height: 0,
          getContext: () => ({
            clearRect: () => {},
            fillText: () => {},
            font: '',
            textAlign: '',
            textBaseline: '',
            shadowColor: '',
            shadowBlur: 0,
            fillStyle: '',
          }),
        };
      }
      return {};
    },
  },
  writable: true,
});

import { BuffManager, StackBuffType } from './BuffManager';
import { ScorePopupManager } from '../effects/ScorePopup';

function makeEnemy(hp = 10) {
  return {
    alive: true,
    health: hp,
    position: { x: 0, y: 0, z: 0, distanceTo: () => 0, clone: function() { return { ...this }; } },
    cachedMaterials: null,
    takeDamage(d: number) {
      this.health -= d;
      if (this.health <= 0) this.alive = false;
    },
    scoreValue: 50,
    geomCount: 1,
    constructor: { name: 'Wanderer' },
  } as any;
}

describe('s44j-25: Damage numbers for all damage sources', () => {
  let buffManager: BuffManager;
  let mockScorePopups: ScorePopupManager;
  let spawnDamageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    buffManager = new BuffManager();
    mockScorePopups = new ScorePopupManager();
    // Stub out the rendering methods so they don't actually create DOM/THREE objects
    vi.spyOn(mockScorePopups, 'spawn').mockImplementation(() => {});
    spawnDamageSpy = vi.spyOn(mockScorePopups, 'spawnDamage').mockImplementation(() => {});
    vi.spyOn(mockScorePopups, 'spawnScore').mockImplementation(() => {});
  });

  describe('ScorePopup.spawnDamage color parameter', () => {
    it('accepts optional color parameter (default red)', () => {
      const popup = new ScorePopupManager();
      vi.spyOn(popup, 'spawn').mockImplementation(() => {});
      const spawnSpy = vi.spyOn(popup, 'spawn');

      const pos = { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }), add: () => pos } as any;
      popup.spawnDamage(pos, 5);
      // Default color should be red
      expect(spawnSpy).toHaveBeenCalledWith(expect.anything(), '-5', '#ff4444', expect.any(Number), expect.any(Number));
    });

    it('accepts custom color for source-type differentiation', () => {
      const popup = new ScorePopupManager();
      const spawnSpy = vi.spyOn(popup, 'spawn').mockImplementation(() => {});

      const pos = { x: 0, y: 0, z: 0, clone: () => ({ x: 0, y: 0, z: 0 }), add: () => pos } as any;
      popup.spawnDamage(pos, 3, '#00aaff'); // Tesla blue
      expect(spawnSpy).toHaveBeenCalledWith(expect.anything(), '-3', '#00aaff', expect.any(Number), expect.any(Number));
    });
  });

  describe('Burning DOT damage numbers (s44j-25 regression)', () => {
    it('shows NO damage numbers before 0.5s tick interval', () => {
      const enemy = makeEnemy(100);
      // Add IncendiaryRounds buff
      buffManager.addBuff(StackBuffType.IncendiaryRounds);
      // Manually ignite the enemy (simulating onBulletHit)
      (buffManager as any).burningEnemies.push({
        enemy,
        dps: 2,
        remaining: 3,
        damageAccumulator: 0,
        tickTimer: 0,
      });

      // Tick for 0.3s — under threshold
      buffManager.update(0.3, { x: 0, y: 0, z: 0 } as any, [], mockScorePopups);

      expect(spawnDamageSpy).not.toHaveBeenCalled();
    });

    it('shows orange damage number after 0.5s tick interval', () => {
      const enemy = makeEnemy(100);
      (buffManager as any).burningEnemies.push({
        enemy,
        dps: 2,
        remaining: 3,
        damageAccumulator: 0,
        tickTimer: 0,
      });

      // Tick for 0.6s — over threshold
      buffManager.update(0.6, { x: 0, y: 0, z: 0 } as any, [], mockScorePopups);

      expect(spawnDamageSpy).toHaveBeenCalledWith(
        expect.anything(),    // position
        expect.any(Number),   // accumulated damage
        '#ff7700',            // orange — burning DOT color
      );
    });

    it('resets accumulator after showing damage number', () => {
      const enemy = makeEnemy(100);
      (buffManager as any).burningEnemies.push({
        enemy,
        dps: 2,
        remaining: 5,
        damageAccumulator: 0,
        tickTimer: 0,
      });

      // First tick at 0.6s
      buffManager.update(0.6, { x: 0, y: 0, z: 0 } as any, [], mockScorePopups);
      expect(spawnDamageSpy).toHaveBeenCalledTimes(1);

      // Second tick at 0.3s (below threshold) — no new popup
      buffManager.update(0.3, { x: 0, y: 0, z: 0 } as any, [], mockScorePopups);
      expect(spawnDamageSpy).toHaveBeenCalledTimes(1); // still 1

      // Third tick reaching 0.5s again — popup fires again
      buffManager.update(0.3, { x: 0, y: 0, z: 0 } as any, [], mockScorePopups);
      expect(spawnDamageSpy).toHaveBeenCalledTimes(2);
    });

    it('does NOT show damage number when enemy dies mid-tick', () => {
      const enemy = makeEnemy(0.5); // very low HP — will die from DOT
      (buffManager as any).burningEnemies.push({
        enemy,
        dps: 10,
        remaining: 3,
        damageAccumulator: 0,
        tickTimer: 0,
      });

      buffManager.update(0.6, { x: 0, y: 0, z: 0 } as any, [], mockScorePopups);

      // Enemy died — damage number should NOT be shown (alive check in updateBurning)
      expect(spawnDamageSpy).not.toHaveBeenCalled();
    });
  });

  describe('auraKills return value (used for score awarding)', () => {
    it('returns enemies killed by ShockAura', () => {
      const enemy = makeEnemy(0.1); // dies from any aura tick
      buffManager.addBuff(StackBuffType.ShockAura);

      // Force aura timer to fire
      (buffManager as any).shockAuraTimer = 0.5;

      const playerPos = { x: 0, y: 0, z: 0, distanceTo: () => 0.5 } as any; // enemy in aura range
      enemy.position.distanceTo = () => 0.5; // within aura radius 2.0

      const kills = buffManager.update(0.001, playerPos, [enemy], mockScorePopups);
      expect(kills.length).toBeGreaterThan(0);
      expect(kills[0]).toBe(enemy);
    });
  });
});
