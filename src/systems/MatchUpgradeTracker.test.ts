import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatchUpgradeTracker } from './MatchUpgradeTracker';
import { WeaponType } from '../weapons/WeaponTypes';

describe('MatchUpgradeTracker', () => {
  // Permanently unlock nodes to test choice flow
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

  it('starts with no pending choice', () => {
    expect(tracker.getPendingChoice()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // recordKill — fires onBuildChoiceAvailable, does NOT auto-activate
  // -------------------------------------------------------------------------

  it('does not fire onBuildChoiceAvailable before threshold', () => {
    const cb = vi.fn();
    tracker.onBuildChoiceAvailable = cb;
    for (let i = 0; i < 9; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    expect(cb).not.toHaveBeenCalled();
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);
  });

  it('fires onBuildChoiceAvailable exactly at kill threshold', () => {
    const cb = vi.fn();
    tracker.onBuildChoiceAvailable = cb;
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    expect(cb).toHaveBeenCalledTimes(1);
    const [weaponType, nodeIds] = cb.mock.calls[0];
    expect(weaponType).toBe(WeaponType.PlasmaMortar);
    // Both threshold-10 nodes should be offered (root nodes — prereqs always met)
    expect(nodeIds).toContain('plasma_mortar_a_1');
    expect(nodeIds).toContain('plasma_mortar_b_1');
    expect(nodeIds).toHaveLength(2);
  });

  it('does NOT auto-activate nodes — getActiveUpgrades is empty before confirmChoice', () => {
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);
  });

  it('does not fire onBuildChoiceAvailable more than once per threshold crossing', () => {
    const cb = vi.fn();
    tracker.onBuildChoiceAvailable = cb;
    for (let i = 0; i < 20; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    // Only fires once at kill 10; kills 11-20 do not re-fire
    expect(cb).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // confirmChoice — activates node, fires onUpgradeActivated, clears pending
  // -------------------------------------------------------------------------

  it('confirmChoice activates the chosen node', () => {
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).has('plasma_mortar_a_1')).toBe(true);
  });

  it('confirmChoice fires onUpgradeActivated', () => {
    const activated = vi.fn();
    tracker.onUpgradeActivated = activated;
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);
    expect(activated).toHaveBeenCalledTimes(1);
    expect(activated).toHaveBeenCalledWith('plasma_mortar_a_1', WeaponType.PlasmaMortar);
  });

  it('confirmChoice clears the pending choice', () => {
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    expect(tracker.getPendingChoice()).not.toBeNull();
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);
    expect(tracker.getPendingChoice()).toBeNull();
  });

  it('confirmChoice does not re-activate an already-active node', () => {
    const activated = vi.fn();
    tracker.onUpgradeActivated = activated;
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar); // duplicate
    expect(activated).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // getPendingChoice
  // -------------------------------------------------------------------------

  it('getPendingChoice returns the current pending choice', () => {
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    const pending = tracker.getPendingChoice();
    expect(pending).not.toBeNull();
    expect(pending!.weaponType).toBe(WeaponType.PlasmaMortar);
    expect(pending!.nodeIds).toContain('plasma_mortar_a_1');
  });

  it('getPendingChoice returns a copy — mutating it does not affect tracker', () => {
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    const pending = tracker.getPendingChoice()!;
    pending.nodeIds.push('fake_node');
    expect(tracker.getPendingChoice()!.nodeIds).not.toContain('fake_node');
  });

  // -------------------------------------------------------------------------
  // Prerequisite filtering
  // -------------------------------------------------------------------------

  it('higher-threshold node is offered only when its prerequisite is confirmed', () => {
    const choices: string[][] = [];
    tracker.onBuildChoiceAvailable = (_wt, nodeIds) => choices.push([...nodeIds]);

    // Kill 25 — crosses threshold 10 AND 25
    // At threshold 10: plasma_mortar_a_1 and plasma_mortar_b_1 offered
    // At threshold 25: plasma_mortar_a_2 NOT offered (plasma_mortar_a_1 not yet active)
    for (let i = 0; i < 25; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    expect(choices).toHaveLength(1); // only threshold-10 event fired
    expect(choices[0]).toContain('plasma_mortar_a_1');
    expect(choices[0]).not.toContain('plasma_mortar_a_2');
  });

  it('higher-threshold node is offered after prerequisite is confirmed', () => {
    const cb = vi.fn();
    tracker.onBuildChoiceAvailable = cb;

    // Cross threshold 10, confirm a_1
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);

    // Continue kills to cross threshold 25
    for (let i = 0; i < 15; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }

    expect(cb).toHaveBeenCalledTimes(2);
    const [, secondNodeIds] = cb.mock.calls[1];
    expect(secondNodeIds).toContain('plasma_mortar_a_2');
  });

  // -------------------------------------------------------------------------
  // Ceiling — only permanently unlocked nodes are offered
  // -------------------------------------------------------------------------

  it('does not offer nodes not in permanentUnlocks', () => {
    const cb = vi.fn();
    tracker.onBuildChoiceAvailable = cb;
    for (let i = 0; i < 60; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    const allOffered = cb.mock.calls.flatMap(c => c[1] as string[]);
    expect(allOffered).not.toContain('plasma_mortar_a_3');
  });

  it('tracker with no permanent unlocks never fires onBuildChoiceAvailable', () => {
    const emptyTracker = new MatchUpgradeTracker(new Set());
    const cb = vi.fn();
    emptyTracker.onBuildChoiceAvailable = cb;
    for (let i = 0; i < 100; i++) {
      emptyTracker.recordKill(WeaponType.Standard);
    }
    expect(cb).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Null callback — no throw
  // -------------------------------------------------------------------------

  it('does not throw when onBuildChoiceAvailable is null', () => {
    tracker.onBuildChoiceAvailable = null;
    expect(() => {
      for (let i = 0; i < 15; i++) {
        tracker.recordKill(WeaponType.PlasmaMortar);
      }
    }).not.toThrow();
  });

  it('does not throw when onUpgradeActivated is null', () => {
    tracker.onUpgradeActivated = null;
    tracker.onBuildChoiceAvailable = (_wt, nodeIds) => {
      tracker.confirmChoice(nodeIds[0], WeaponType.PlasmaMortar);
    };
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
    const cb = vi.fn();
    tracker.onBuildChoiceAvailable = cb;
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.Standard);
    }
    expect(tracker.getKillCount(WeaponType.PlasmaMortar)).toBe(0);
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);
    expect(tracker.getKillCount(WeaponType.Standard)).toBe(10);
    // Callback fired for Standard only
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toBe(WeaponType.Standard);
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  it('reset clears kill counts, active upgrades, and pending choice', () => {
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 25; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);

    tracker.reset();

    expect(tracker.getKillCount(WeaponType.PlasmaMortar)).toBe(0);
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);
    expect(tracker.getPendingChoice()).toBeNull();
  });

  it('after reset, nodes can be offered again in a new match', () => {
    const cb = vi.fn();
    tracker.onBuildChoiceAvailable = cb;
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.reset();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    expect(cb).toHaveBeenCalledTimes(2); // once before reset, once after
  });

  // -------------------------------------------------------------------------
  // getActiveUpgrades returns a copy
  // -------------------------------------------------------------------------

  it('getActiveUpgrades returns an immutable copy', () => {
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);
    const active = tracker.getActiveUpgrades(WeaponType.PlasmaMortar);
    active.add('fake_node');
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).has('fake_node')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // permanentUnlocks immutability
  // -------------------------------------------------------------------------

  it('modifying the constructor set does not affect the tracker', () => {
    const cb = vi.fn();
    const mutableSet = new Set(['standard_a_1']);
    const t = new MatchUpgradeTracker(mutableSet);
    t.onBuildChoiceAvailable = cb;
    mutableSet.clear(); // clear after construction

    for (let i = 0; i < 10; i++) {
      t.recordKill(WeaponType.Standard);
    }
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][1]).toContain('standard_a_1');
  });
});
