import { describe, it, expect, beforeEach } from 'vitest';
import { MasteryPointStore, weaponTypeFromNodeId } from './MasteryPointStore';
import { WeaponType } from '../weapons/WeaponTypes';

// Mock localStorage for test environment
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

describe('MasteryPointStore', () => {
  let store: MasteryPointStore;

  beforeEach(() => {
    localStorageMock.clear();
    store = new MasteryPointStore();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('starts with zero points for all weapons', () => {
    expect(store.getTotalPoints()).toBe(0);
    expect(store.getSpentPoints()).toBe(0);
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(0);
    expect(store.getAvailablePoints(WeaponType.Spread)).toBe(0);
  });

  it('starts with no unlocked nodes', () => {
    expect(store.getUnlockedNodes().size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // earnPoint — per-weapon
  // -------------------------------------------------------------------------

  it('earnPoint credits the specified weapon only', () => {
    store.earnPoint(WeaponType.Standard);
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(1);
    expect(store.getAvailablePoints(WeaponType.Spread)).toBe(0);
    expect(store.getTotalPoints(WeaponType.Standard)).toBe(1);
    expect(store.getTotalPoints(WeaponType.Spread)).toBe(0);
  });

  it('multiple earnPoint calls accumulate per weapon', () => {
    store.earnPoint(WeaponType.Standard);
    store.earnPoint(WeaponType.Standard);
    store.earnPoint(WeaponType.Spread);
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(2);
    expect(store.getAvailablePoints(WeaponType.Spread)).toBe(1);
    expect(store.getTotalPoints()).toBe(3); // global sum
  });

  it('getTotalPoints() without arg returns sum across all weapons', () => {
    store.earnPoint(WeaponType.Standard);
    store.earnPoint(WeaponType.Homing);
    store.earnPoint(WeaponType.Homing);
    expect(store.getTotalPoints()).toBe(3);
  });

  // -------------------------------------------------------------------------
  // spendPoint — per-weapon isolation
  // -------------------------------------------------------------------------

  it('spendPoint returns false when that weapon has no points', () => {
    // Earn points for Spread, try to spend on Standard node
    store.earnPoint(WeaponType.Spread);
    const result = store.spendPoint('standard_a_1');
    expect(result).toBe(false);
    expect(store.getUnlockedNodes().size).toBe(0);
    // Spread points unchanged
    expect(store.getAvailablePoints(WeaponType.Spread)).toBe(1);
  });

  it('spendPoint returns true and unlocks node when correct weapon has points', () => {
    store.earnPoint(WeaponType.Standard);
    const result = store.spendPoint('standard_a_1');
    expect(result).toBe(true);
    expect(store.isUnlocked('standard_a_1')).toBe(true);
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(0);
    expect(store.getSpentPoints(WeaponType.Standard)).toBe(1);
  });

  it('spending on weapon A does not affect weapon B points', () => {
    store.earnPoint(WeaponType.Standard);
    store.earnPoint(WeaponType.Spread);
    store.spendPoint('standard_a_1');
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(0);
    expect(store.getAvailablePoints(WeaponType.Spread)).toBe(1); // untouched
  });

  it('spendPoint returns false when node already unlocked', () => {
    store.earnPoint(WeaponType.Standard);
    store.earnPoint(WeaponType.Standard);
    store.spendPoint('standard_a_1');
    const second = store.spendPoint('standard_a_1');
    expect(second).toBe(false);
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(1); // only one spent
  });

  it('can unlock multiple distinct nodes within same weapon', () => {
    store.earnPoint(WeaponType.Standard);
    store.earnPoint(WeaponType.Standard);
    store.spendPoint('standard_a_1');
    store.spendPoint('standard_b_1');
    expect(store.getUnlockedNodes().size).toBe(2);
    expect(store.isUnlocked('standard_a_1')).toBe(true);
    expect(store.isUnlocked('standard_b_1')).toBe(true);
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(0);
  });

  it('multi-word weapon type (chain_lightning) spends from correct pool', () => {
    store.earnPoint(WeaponType.ChainLightning);
    const result = store.spendPoint('chain_lightning_a_1');
    expect(result).toBe(true);
    expect(store.isUnlocked('chain_lightning_a_1')).toBe(true);
    expect(store.getAvailablePoints(WeaponType.ChainLightning)).toBe(0);
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(0); // not affected
  });

  // -------------------------------------------------------------------------
  // refundPoint
  // -------------------------------------------------------------------------

  it('refundPoint returns false when node not unlocked', () => {
    const result = store.refundPoint('standard_a_1');
    expect(result).toBe(false);
  });

  it('refundPoint re-locks node and returns point to weapon pool', () => {
    store.earnPoint(WeaponType.Standard);
    store.spendPoint('standard_a_1');
    const result = store.refundPoint('standard_a_1');
    expect(result).toBe(true);
    expect(store.isUnlocked('standard_a_1')).toBe(false);
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(1);
    expect(store.getSpentPoints(WeaponType.Standard)).toBe(0);
  });

  it('after refund, point can be re-spent on same weapon different node', () => {
    store.earnPoint(WeaponType.Standard);
    store.spendPoint('standard_a_1');
    store.refundPoint('standard_a_1');
    const result = store.spendPoint('standard_b_1');
    expect(result).toBe(true);
    expect(store.isUnlocked('standard_b_1')).toBe(true);
    expect(store.isUnlocked('standard_a_1')).toBe(false);
  });

  it('refunding weapon A node does not give points to weapon B', () => {
    store.earnPoint(WeaponType.Standard);
    store.spendPoint('standard_a_1');
    store.refundPoint('standard_a_1');
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(1);
    expect(store.getAvailablePoints(WeaponType.Spread)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // isUnlocked / getUnlockedNodes
  // -------------------------------------------------------------------------

  it('isUnlocked returns false for unknown node', () => {
    expect(store.isUnlocked('nonexistent_a_1')).toBe(false);
  });

  it('getUnlockedNodes returns an immutable copy', () => {
    store.earnPoint(WeaponType.Standard);
    store.spendPoint('standard_a_1');
    const set1 = store.getUnlockedNodes();
    const set2 = store.getUnlockedNodes();
    expect(set1).not.toBe(set2); // different Set instances
    expect(set1).toEqual(set2);
  });

  // -------------------------------------------------------------------------
  // Persistence (save / load)
  // -------------------------------------------------------------------------

  it('persists per-weapon state across instances', () => {
    store.earnPoint(WeaponType.TeslaCoil);
    store.earnPoint(WeaponType.TeslaCoil);
    store.spendPoint('tesla_coil_b_2');

    const store2 = new MasteryPointStore();
    expect(store2.getTotalPoints(WeaponType.TeslaCoil)).toBe(2);
    expect(store2.getSpentPoints(WeaponType.TeslaCoil)).toBe(1);
    expect(store2.isUnlocked('tesla_coil_b_2')).toBe(true);
    expect(store2.getAvailablePoints(WeaponType.TeslaCoil)).toBe(1);
    // Other weapons still 0
    expect(store2.getAvailablePoints(WeaponType.Standard)).toBe(0);
  });

  it('handles missing localStorage gracefully', () => {
    localStorageMock.removeItem('gw_mastery_points');
    const freshStore = new MasteryPointStore();
    expect(freshStore.getTotalPoints()).toBe(0);
  });

  it('handles corrupt localStorage data gracefully', () => {
    localStorageMock.setItem('gw_mastery_points', 'not-valid-json{{{');
    const freshStore = new MasteryPointStore();
    expect(freshStore.getTotalPoints()).toBe(0);
    expect(freshStore.getUnlockedNodes().size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  it('reset clears all state', () => {
    store.earnPoint(WeaponType.Standard);
    store.spendPoint('standard_a_1');
    store.reset();
    expect(store.getTotalPoints()).toBe(0);
    expect(store.getSpentPoints()).toBe(0);
    expect(store.getUnlockedNodes().size).toBe(0);
    expect(store.getAvailablePoints(WeaponType.Standard)).toBe(0);
  });

  it('reset also removes from localStorage', () => {
    store.earnPoint(WeaponType.Standard);
    store.reset();
    expect(localStorageMock.getItem('gw_mastery_points')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Static load factory
  // -------------------------------------------------------------------------

  it('MasteryPointStore.load() returns a loaded instance', () => {
    store.earnPoint(WeaponType.Standard);
    store.spendPoint('standard_a_1');

    const loaded = MasteryPointStore.load();
    expect(loaded.getTotalPoints(WeaponType.Standard)).toBe(1);
    expect(loaded.isUnlocked('standard_a_1')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Immutability — mutations don't affect internals via returned values
  // -------------------------------------------------------------------------

  it('mutating returned Set does not affect store', () => {
    store.earnPoint(WeaponType.Standard);
    store.spendPoint('standard_a_1');
    const nodes = store.getUnlockedNodes();
    nodes.add('standard_b_1'); // mutate the returned set
    expect(store.isUnlocked('standard_b_1')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Multi-level node support (maxPoints > 1)
  // -------------------------------------------------------------------------

  it('spendPoint with maxPoints=3 allows spending up to 3 times on same node', () => {
    store.earnPoint(WeaponType.BlackHole);
    store.earnPoint(WeaponType.BlackHole);
    store.earnPoint(WeaponType.BlackHole);

    expect(store.spendPoint('black_hole_a_1', 3)).toBe(true);
    expect(store.getNodePoints('black_hole_a_1')).toBe(1);
    expect(store.isUnlocked('black_hole_a_1')).toBe(true);

    expect(store.spendPoint('black_hole_a_1', 3)).toBe(true);
    expect(store.getNodePoints('black_hole_a_1')).toBe(2);

    expect(store.spendPoint('black_hole_a_1', 3)).toBe(true);
    expect(store.getNodePoints('black_hole_a_1')).toBe(3);

    // 4th spend should fail — at maxPoints
    expect(store.spendPoint('black_hole_a_1', 3)).toBe(false);
    expect(store.getNodePoints('black_hole_a_1')).toBe(3);
    expect(store.getAvailablePoints(WeaponType.BlackHole)).toBe(0);
  });

  it('refundPoint decrements multi-level node one rank at a time', () => {
    store.earnPoint(WeaponType.BlackHole);
    store.earnPoint(WeaponType.BlackHole);
    store.earnPoint(WeaponType.BlackHole);

    store.spendPoint('black_hole_a_1', 3);
    store.spendPoint('black_hole_a_1', 3);
    store.spendPoint('black_hole_a_1', 3);
    expect(store.getNodePoints('black_hole_a_1')).toBe(3);

    // Refund once → rank 2
    expect(store.refundPoint('black_hole_a_1')).toBe(true);
    expect(store.getNodePoints('black_hole_a_1')).toBe(2);
    expect(store.isUnlocked('black_hole_a_1')).toBe(true); // still has points
    expect(store.getAvailablePoints(WeaponType.BlackHole)).toBe(1);

    // Refund twice → rank 1
    store.refundPoint('black_hole_a_1');
    expect(store.getNodePoints('black_hole_a_1')).toBe(1);

    // Refund three times → fully locked
    store.refundPoint('black_hole_a_1');
    expect(store.getNodePoints('black_hole_a_1')).toBe(0);
    expect(store.isUnlocked('black_hole_a_1')).toBe(false);
    expect(store.getAvailablePoints(WeaponType.BlackHole)).toBe(3);
  });

  it('getNodePoints returns 0 for unknown node', () => {
    expect(store.getNodePoints('nonexistent_a_1')).toBe(0);
  });

  it('multi-level node points persist across instances', () => {
    store.earnPoint(WeaponType.BlackHole);
    store.earnPoint(WeaponType.BlackHole);
    store.spendPoint('black_hole_a_1', 3);
    store.spendPoint('black_hole_a_1', 3);

    const store2 = new MasteryPointStore();
    expect(store2.getNodePoints('black_hole_a_1')).toBe(2);
    expect(store2.isUnlocked('black_hole_a_1')).toBe(true);
    expect(store2.getSpentPoints(WeaponType.BlackHole)).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Legacy v1 format migration
  // -------------------------------------------------------------------------

  it('migrates v1 global format: keeps node unlocks, resets unspent points', () => {
    // Simulate v1 format (global pool)
    const oldFormat = JSON.stringify({
      totalPoints: 5,
      spentPoints: 2,
      nodePoints: { 'standard_a_1': 1, 'homing_b_2': 1 },
    });
    localStorageMock.setItem('gw_mastery_points', oldFormat);

    const migrated = new MasteryPointStore();
    // Node unlocks are preserved
    expect(migrated.isUnlocked('standard_a_1')).toBe(true);
    expect(migrated.isUnlocked('homing_b_2')).toBe(true);
    expect(migrated.getNodePoints('standard_a_1')).toBe(1);
    expect(migrated.getNodePoints('homing_b_2')).toBe(1);
    // Spent is reconstructed from nodePoints, total = spent (available = 0)
    expect(migrated.getAvailablePoints(WeaponType.Standard)).toBe(0);
    expect(migrated.getAvailablePoints(WeaponType.Homing)).toBe(0);
  });

  it('migrates v1 legacy permanentUnlocks format', () => {
    const oldFormat = JSON.stringify({
      totalPoints: 5,
      spentPoints: 2,
      permanentUnlocks: { 'standard_a_1': true, 'homing_b_2': true },
    });
    localStorageMock.setItem('gw_mastery_points', oldFormat);

    const migrated = new MasteryPointStore();
    expect(migrated.isUnlocked('standard_a_1')).toBe(true);
    expect(migrated.isUnlocked('homing_b_2')).toBe(true);
    expect(migrated.getNodePoints('standard_a_1')).toBe(1);
    expect(migrated.getNodePoints('homing_b_2')).toBe(1);
  });

  // -------------------------------------------------------------------------
  // weaponTypeFromNodeId helper
  // -------------------------------------------------------------------------

  it('weaponTypeFromNodeId extracts single-word weapon types', () => {
    expect(weaponTypeFromNodeId('standard_a_1')).toBe(WeaponType.Standard);
    expect(weaponTypeFromNodeId('spread_b_3')).toBe(WeaponType.Spread);
    expect(weaponTypeFromNodeId('homing_al_5')).toBe(WeaponType.Homing);
  });

  it('weaponTypeFromNodeId extracts multi-word weapon types', () => {
    expect(weaponTypeFromNodeId('chain_lightning_a_1')).toBe(WeaponType.ChainLightning);
    expect(weaponTypeFromNodeId('plasma_mortar_b_2')).toBe(WeaponType.PlasmaMortar);
    expect(weaponTypeFromNodeId('gravity_gun_al_3')).toBe(WeaponType.GravityGun);
    expect(weaponTypeFromNodeId('laser_beam_a_1')).toBe(WeaponType.LaserBeam);
    expect(weaponTypeFromNodeId('black_hole_b_1')).toBe(WeaponType.BlackHole);
    expect(weaponTypeFromNodeId('tesla_coil_ar_2')).toBe(WeaponType.TeslaCoil);
  });

  it('weaponTypeFromNodeId returns null for unknown node', () => {
    expect(weaponTypeFromNodeId('unknown_a_1')).toBeNull();
    expect(weaponTypeFromNodeId('nonexistent')).toBeNull();
  });
});
