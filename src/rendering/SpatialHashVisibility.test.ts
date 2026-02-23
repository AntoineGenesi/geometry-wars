/**
 * Unit tests for SpatialHashVisibility.
 *
 * Tests verify:
 * - Enemies near player get full visibility (1.0)
 * - Enemies far from player get dim opacity (dimOpacity)
 * - Smooth interpolation in the fade zone
 * - Lerp smoothing (no instant jumps)
 * - First-frame initialization (no flash from 1.0 for far enemies)
 * - clear() / dispose() resets state
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SpatialHashVisibility, DEFAULT_SPATIAL_VISIBILITY_CONFIG } from './SpatialHashVisibility';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';

// Minimal stub satisfying BaseEnemy's alive + position interface
function makeEnemy(x: number, y: number, z: number, alive = true): BaseEnemy {
  return {
    alive,
    position: new THREE.Vector3(x, y, z),
  } as unknown as BaseEnemy;
}

describe('SpatialHashVisibility', () => {
  let vis: SpatialHashVisibility;
  const playerAt = new THREE.Vector3(0, 0, 0);
  const DT = 1.0; // 1 second — forces full lerp in one step (lerpFactor = min(1, speed*1))

  beforeEach(() => {
    // Use short lerp-to-complete: lerpSpeed=20 * dt=1.0 → clamped to 1.0 → instant
    vis = new SpatialHashVisibility({
      cellSize: 5.0,
      nearCellRadius: 2.0,   // within 10 world units → full
      fadeCellRadius: 5.0,   // beyond 25 world units → dim
      dimOpacity: 0.1,
      lerpSpeed: 20.0,       // fast lerp for deterministic tests
    });
  });

  describe('opacity zones', () => {
    it('returns 1.0 for enemy at player position (cell distance 0)', () => {
      const enemy = makeEnemy(0, 0, 0);
      vis.update([enemy], playerAt, DT);
      expect(vis.getOpacity(enemy)).toBeCloseTo(1.0, 5);
    });

    it('returns 1.0 for enemy within nearCellRadius (cell dist < 2)', () => {
      // cellSize=5, nearCellRadius=2 → within 10 world units = near zone
      const enemy = makeEnemy(8, 0, 0); // 8 world units, cell index 1 away
      vis.update([enemy], playerAt, DT);
      expect(vis.getOpacity(enemy)).toBeCloseTo(1.0, 5);
    });

    it('returns dimOpacity for enemy beyond fadeCellRadius', () => {
      // fadeCellRadius=5 cells → beyond 25 world units
      const enemy = makeEnemy(40, 0, 0); // cell index 8 away (far)
      vis.update([enemy], playerAt, DT);
      expect(vis.getOpacity(enemy)).toBeCloseTo(0.1, 4);
    });

    it('returns value in (dimOpacity, 1.0) in the fade zone', () => {
      // Cell distance ~3 (between nearCellRadius=2 and fadeCellRadius=5)
      const enemy = makeEnemy(15, 0, 0); // ~3 cells from player
      vis.update([enemy], playerAt, DT);
      const opacity = vis.getOpacity(enemy);
      expect(opacity).toBeGreaterThan(0.1);
      expect(opacity).toBeLessThan(1.0);
    });

    it('opacity decreases as enemy moves farther from player', () => {
      const near = makeEnemy(5, 0, 0);   // 1 cell away
      const mid = makeEnemy(15, 0, 0);   // 3 cells away
      const far = makeEnemy(35, 0, 0);   // 7 cells away
      vis.update([near, mid, far], playerAt, DT);
      expect(vis.getOpacity(near)).toBeGreaterThan(vis.getOpacity(mid));
      expect(vis.getOpacity(mid)).toBeGreaterThan(vis.getOpacity(far));
    });
  });

  describe('first-frame initialization', () => {
    it('initializes far enemy to dimOpacity immediately (no flash)', () => {
      // On first frame, currentOpacity = targetOpacity, so no lerp-in from 1.0
      const farEnemy = makeEnemy(50, 0, 0); // deep in far zone
      // dt=0 ensures no lerp is applied, only initialization
      vis.update([farEnemy], playerAt, 0);
      expect(vis.getOpacity(farEnemy)).toBeCloseTo(0.1, 4);
    });

    it('returns 1.0 for untracked enemy (before first update)', () => {
      const enemy = makeEnemy(10, 0, 0);
      expect(vis.getOpacity(enemy)).toBe(1.0);
    });
  });

  describe('lerp smoothing', () => {
    it('lerps gradually toward target over time', () => {
      const farEnemy = makeEnemy(50, 0, 0); // far zone, target = dimOpacity
      // First update: initializes to dimOpacity (no flash)
      vis.update([farEnemy], playerAt, 0);
      const initial = vis.getOpacity(farEnemy);

      // Now simulate enemy starting near then moving far
      // Reset by creating fresh vis to test lerp
      const vis2 = new SpatialHashVisibility({
        cellSize: 5.0,
        nearCellRadius: 2.0,
        fadeCellRadius: 5.0,
        dimOpacity: 0.1,
        lerpSpeed: 4.0, // slow lerp
      });
      const enemy2 = makeEnemy(0, 0, 0); // start near
      vis2.update([enemy2], playerAt, 0.016); // initialize as near
      expect(vis2.getOpacity(enemy2)).toBeCloseTo(1.0, 4);

      // Move enemy far (simulate by updating with a different vis that
      // has the enemy registered as far)
      // We can't move the enemy easily without mutation, so test via multiple small dt steps
      // Instead, test that lerpSpeed controls the rate:
      const vis3 = new SpatialHashVisibility({
        cellSize: 5.0,
        nearCellRadius: 2.0,
        fadeCellRadius: 5.0,
        dimOpacity: 0.0,
        lerpSpeed: 2.0,
      });
      // Enemy starts far (will be initialized to 0.0)
      const farE = makeEnemy(50, 0, 0);
      vis3.update([farE], playerAt, 0); // init to 0.0
      // Now place enemy near (opacity should be 1.0 but currently 0.0)
      farE.position.set(0, 0, 0);
      vis3.update([farE], playerAt, 0.016); // small dt → partial lerp
      const afterOneFrame = vis3.getOpacity(farE);
      // Should be between 0 and 1 (lerping toward 1.0)
      expect(afterOneFrame).toBeGreaterThan(0.0);
      expect(afterOneFrame).toBeLessThan(1.0);
      expect(initial).toBeCloseTo(0.1, 4); // first vis initialized correctly
    });
  });

  describe('dead enemies', () => {
    it('skips dead enemies (alive=false)', () => {
      const deadEnemy = makeEnemy(50, 0, 0, false); // dead, far away
      vis.update([deadEnemy], playerAt, DT);
      // Dead enemy was not processed, so no entry → returns 1.0
      expect(vis.getOpacity(deadEnemy)).toBe(1.0);
    });
  });

  describe('clear and dispose', () => {
    it('clear() resets all entries', () => {
      const enemy = makeEnemy(50, 0, 0);
      vis.update([enemy], playerAt, DT);
      expect(vis.getOpacity(enemy)).toBeCloseTo(0.1, 4);

      vis.clear();
      // After clear, entry is gone → returns default 1.0
      expect(vis.getOpacity(enemy)).toBe(1.0);
    });

    it('dispose() does not throw', () => {
      expect(() => vis.dispose()).not.toThrow();
    });

    it('can be updated after clear()', () => {
      const enemy = makeEnemy(0, 0, 0);
      vis.update([enemy], playerAt, DT);
      vis.clear();
      vis.update([enemy], playerAt, DT);
      expect(vis.getOpacity(enemy)).toBeCloseTo(1.0, 5);
    });
  });

  describe('multiple enemies', () => {
    it('tracks multiple enemies independently', () => {
      const nearEnemy = makeEnemy(2, 0, 0);
      const farEnemy = makeEnemy(50, 0, 0);
      vis.update([nearEnemy, farEnemy], playerAt, DT);
      expect(vis.getOpacity(nearEnemy)).toBeCloseTo(1.0, 5);
      expect(vis.getOpacity(farEnemy)).toBeCloseTo(0.1, 4);
    });
  });

  describe('default config', () => {
    it('exports DEFAULT_SPATIAL_VISIBILITY_CONFIG with expected values', () => {
      expect(DEFAULT_SPATIAL_VISIBILITY_CONFIG.dimOpacity).toBe(0.08);
      expect(DEFAULT_SPATIAL_VISIBILITY_CONFIG.nearCellRadius).toBe(2.0);
      expect(DEFAULT_SPATIAL_VISIBILITY_CONFIG.fadeCellRadius).toBe(5.0);
      expect(DEFAULT_SPATIAL_VISIBILITY_CONFIG.cellSize).toBe(6.0);
      expect(DEFAULT_SPATIAL_VISIBILITY_CONFIG.lerpSpeed).toBe(6.0);
    });

    it('can be constructed with default config (no arguments)', () => {
      const defaultVis = new SpatialHashVisibility();
      const enemy = makeEnemy(0, 0, 0);
      defaultVis.update([enemy], playerAt, 0.016);
      expect(defaultVis.getOpacity(enemy)).toBeCloseTo(1.0, 4);
    });
  });
});
