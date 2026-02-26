import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MasteryPointStore } from './MasteryPointStore';

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

  it('starts with zero points', () => {
    expect(store.getTotalPoints()).toBe(0);
    expect(store.getSpentPoints()).toBe(0);
    expect(store.availablePoints).toBe(0);
  });

  it('starts with no unlocked nodes', () => {
    expect(store.getUnlockedNodes().size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // earnPoint
  // -------------------------------------------------------------------------

  it('earnPoint increments totalPoints', () => {
    store.earnPoint();
    expect(store.getTotalPoints()).toBe(1);
    expect(store.availablePoints).toBe(1);
  });

  it('multiple earnPoint calls accumulate', () => {
    store.earnPoint();
    store.earnPoint();
    store.earnPoint();
    expect(store.getTotalPoints()).toBe(3);
    expect(store.availablePoints).toBe(3);
  });

  // -------------------------------------------------------------------------
  // spendPoint
  // -------------------------------------------------------------------------

  it('spendPoint returns false when no points available', () => {
    const result = store.spendPoint('standard_a_1');
    expect(result).toBe(false);
    expect(store.getUnlockedNodes().size).toBe(0);
  });

  it('spendPoint returns true and unlocks node when points available', () => {
    store.earnPoint();
    const result = store.spendPoint('standard_a_1');
    expect(result).toBe(true);
    expect(store.isUnlocked('standard_a_1')).toBe(true);
    expect(store.availablePoints).toBe(0);
    expect(store.getSpentPoints()).toBe(1);
  });

  it('spendPoint returns false when node already unlocked', () => {
    store.earnPoint();
    store.earnPoint();
    store.spendPoint('standard_a_1');
    const second = store.spendPoint('standard_a_1');
    expect(second).toBe(false);
    expect(store.availablePoints).toBe(1); // only one spent
  });

  it('can unlock multiple distinct nodes', () => {
    store.earnPoint();
    store.earnPoint();
    store.spendPoint('standard_a_1');
    store.spendPoint('standard_b_1');
    expect(store.getUnlockedNodes().size).toBe(2);
    expect(store.isUnlocked('standard_a_1')).toBe(true);
    expect(store.isUnlocked('standard_b_1')).toBe(true);
    expect(store.availablePoints).toBe(0);
  });

  // -------------------------------------------------------------------------
  // refundPoint
  // -------------------------------------------------------------------------

  it('refundPoint returns false when node not unlocked', () => {
    const result = store.refundPoint('standard_a_1');
    expect(result).toBe(false);
  });

  it('refundPoint re-locks node and returns point', () => {
    store.earnPoint();
    store.spendPoint('standard_a_1');
    const result = store.refundPoint('standard_a_1');
    expect(result).toBe(true);
    expect(store.isUnlocked('standard_a_1')).toBe(false);
    expect(store.availablePoints).toBe(1);
    expect(store.getSpentPoints()).toBe(0);
  });

  it('after refund, point can be spent on a different node', () => {
    store.earnPoint();
    store.spendPoint('standard_a_1');
    store.refundPoint('standard_a_1');
    const result = store.spendPoint('standard_b_1');
    expect(result).toBe(true);
    expect(store.isUnlocked('standard_b_1')).toBe(true);
    expect(store.isUnlocked('standard_a_1')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // isUnlocked / getUnlockedNodes
  // -------------------------------------------------------------------------

  it('isUnlocked returns false for unknown node', () => {
    expect(store.isUnlocked('nonexistent_a_1')).toBe(false);
  });

  it('getUnlockedNodes returns an immutable copy', () => {
    store.earnPoint();
    store.spendPoint('standard_a_1');
    const set1 = store.getUnlockedNodes();
    const set2 = store.getUnlockedNodes();
    expect(set1).not.toBe(set2); // different Set instances
    expect(set1).toEqual(set2);
  });

  // -------------------------------------------------------------------------
  // Persistence (save / load)
  // -------------------------------------------------------------------------

  it('persists state across instances', () => {
    store.earnPoint();
    store.earnPoint();
    store.spendPoint('tesla_coil_b_2');

    const store2 = new MasteryPointStore();
    expect(store2.getTotalPoints()).toBe(2);
    expect(store2.getSpentPoints()).toBe(1);
    expect(store2.isUnlocked('tesla_coil_b_2')).toBe(true);
    expect(store2.availablePoints).toBe(1);
  });

  it('handles missing localStorage gracefully', () => {
    // Remove the item and create a fresh store
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
    store.earnPoint();
    store.spendPoint('standard_a_1');
    store.reset();
    expect(store.getTotalPoints()).toBe(0);
    expect(store.getSpentPoints()).toBe(0);
    expect(store.getUnlockedNodes().size).toBe(0);
  });

  it('reset also removes from localStorage', () => {
    store.earnPoint();
    store.reset();
    expect(localStorageMock.getItem('gw_mastery_points')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Static load factory
  // -------------------------------------------------------------------------

  it('MasteryPointStore.load() returns a loaded instance', () => {
    store.earnPoint();
    store.spendPoint('standard_a_1');

    const loaded = MasteryPointStore.load();
    expect(loaded.getTotalPoints()).toBe(1);
    expect(loaded.isUnlocked('standard_a_1')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Immutability — mutations don't affect internals via returned values
  // -------------------------------------------------------------------------

  it('mutating returned Set does not affect store', () => {
    store.earnPoint();
    store.spendPoint('standard_a_1');
    const nodes = store.getUnlockedNodes();
    nodes.add('standard_b_1'); // mutate the returned set
    expect(store.isUnlocked('standard_b_1')).toBe(false);
  });
});
