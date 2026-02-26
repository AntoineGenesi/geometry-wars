import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatchUpgradeTracker } from './MatchUpgradeTracker';
import { WeaponType } from '../weapons/WeaponTypes';

describe('MatchUpgradeTracker', () => {
  // Permanently unlock 3 nodes to test activation ceiling
  const permanentUnlocks = new Set([
    'plasma_mortar_a_1', // threshold: 10
    'plasma_mortar_a_2', // threshold: 25
    'plasma_mortar_b_1', // threshold: 10
    'standard_a_1',      // threshold: 10
  ]);

  let tracker: MatchUpgradeTracker;

  beforeEach(() => {
    tracker = new MatchUpgradeTracker(permanentUnlocks);
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('starts with no active upgrades', () => {
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);
    expect(tracker.getActiveUpgrades(WeaponType.Standard).size).toBe(0);
  });

  it('starts with zero kill counts', () => {
    expect(tracker.getKillCount(WeaponType.PlasmaMortar)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // recordKill — basic activation
  // -------------------------------------------------------------------------

  it('does not activate nodes before threshold', () => {
    for (let i = 0; i < 9; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);
  });

  it('activates node exactly at kill threshold', () => {
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    const active = tracker.getActiveUpgrades(WeaponType.PlasmaMortar);
    expect(active.has('plasma_mortar_a_1')).toBe(true);
    expect(active.has('plasma_mortar_b_1')).toBe(true);
    expect(active.size).toBe(2); // both threshold-10 nodes activate
  });

  it('activates higher-threshold nodes when kills continue', () => {
    for (let i = 0; i < 25; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    const active = tracker.getActiveUpgrades(WeaponType.PlasmaMortar);
    expect(active.has('plasma_mortar_a_1')).toBe(true);
    expect(active.has('plasma_mortar_a_2')).toBe(true);
    expect(active.has('plasma_mortar_b_1')).toBe(true);
    expect(active.size).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Ceiling — only permanently unlocked nodes activate
  // -------------------------------------------------------------------------

  it('does not activate nodes not in permanentUnlocks', () => {
    // plasma_mortar_a_3 is NOT in permanentUnlocks — should never activate
    for (let i = 0; i < 60; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    const active = tracker.getActiveUpgrades(WeaponType.PlasmaMortar);
    expect(active.has('plasma_mortar_a_3')).toBe(false);
  });

  it('tracker with no permanent unlocks never activates anything', () => {
    const emptyTracker = new MatchUpgradeTracker(new Set());
    for (let i = 0; i < 100; i++) {
      emptyTracker.recordKill(WeaponType.Standard);
    }
    expect(emptyTracker.getActiveUpgrades(WeaponType.Standard).size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // onUpgradeActivated callback
  // -------------------------------------------------------------------------

  it('fires onUpgradeActivated when a node activates', () => {
    const callback = vi.fn();
    tracker.onUpgradeActivated = callback;

    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }

    // Both threshold-10 nodes should have fired the callback
    expect(callback).toHaveBeenCalledTimes(2);
    const callArgs = callback.mock.calls.map(c => ({ nodeId: c[0], wt: c[1] }));
    const nodeIds = callArgs.map(a => a.nodeId);
    expect(nodeIds).toContain('plasma_mortar_a_1');
    expect(nodeIds).toContain('plasma_mortar_b_1');
    expect(callArgs[0].wt).toBe(WeaponType.PlasmaMortar);
  });

  it('does not fire callback for already-active nodes', () => {
    const callback = vi.fn();
    tracker.onUpgradeActivated = callback;

    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    // Add more kills — should not re-fire
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }

    expect(callback).toHaveBeenCalledTimes(2); // only the initial 2
  });

  it('does not fire callback when onUpgradeActivated is null', () => {
    tracker.onUpgradeActivated = null;
    expect(() => {
      for (let i = 0; i < 15; i++) {
        tracker.recordKill(WeaponType.PlasmaMortar);
      }
    }).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Cross-weapon isolation
  // -------------------------------------------------------------------------

  it('kill counts are tracked per weapon independently', () => {
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.Standard);
    }
    // PlasmaMortar should not be affected
    expect(tracker.getKillCount(WeaponType.PlasmaMortar)).toBe(0);
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);

    // Standard should have activated
    expect(tracker.getKillCount(WeaponType.Standard)).toBe(10);
    expect(tracker.getActiveUpgrades(WeaponType.Standard).has('standard_a_1')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  it('reset clears kill counts and active upgrades', () => {
    for (let i = 0; i < 25; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.reset();

    expect(tracker.getKillCount(WeaponType.PlasmaMortar)).toBe(0);
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);
  });

  it('after reset, nodes can activate again in a new match', () => {
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.reset();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).has('plasma_mortar_a_1')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // getActiveUpgrades returns a copy
  // -------------------------------------------------------------------------

  it('getActiveUpgrades returns an immutable copy', () => {
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    const active = tracker.getActiveUpgrades(WeaponType.PlasmaMortar);
    active.add('fake_node'); // mutate the returned set
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).has('fake_node')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // permanentUnlocks immutability
  // -------------------------------------------------------------------------

  it('modifying the constructor set does not affect the tracker', () => {
    const mutableSet = new Set(['standard_a_1']);
    const t = new MatchUpgradeTracker(mutableSet);
    mutableSet.clear(); // clear after construction

    for (let i = 0; i < 10; i++) {
      t.recordKill(WeaponType.Standard);
    }
    expect(t.getActiveUpgrades(WeaponType.Standard).has('standard_a_1')).toBe(true);
  });
});
