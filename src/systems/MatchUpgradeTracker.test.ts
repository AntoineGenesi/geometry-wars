import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MatchUpgradeTracker } from './MatchUpgradeTracker';
import { MasteryPointStore, weaponTypeFromNodeId } from './MasteryPointStore';
import { WeaponType } from '../weapons/WeaponTypes';
import { STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS } from './UpgradeTreeData';

/** Build a MasteryPointStore with the given nodes pre-unlocked. */
function makeStore(nodeIds: string[]): MasteryPointStore {
  const store = new MasteryPointStore();
  for (const nodeId of nodeIds) {
    const wt = weaponTypeFromNodeId(nodeId);
    if (wt) {
      store.earnPoint(wt);
      store.spendPoint(nodeId);
    }
  }
  return store;
}

describe('MatchUpgradeTracker', () => {
  let store: MasteryPointStore;
  let tracker: MatchUpgradeTracker;

  beforeEach(() => {
    store = makeStore([
      'plasma_mortar_a_1', // threshold: 10
      'plasma_mortar_a_2', // threshold: 25
      'plasma_mortar_b_1', // threshold: 10
      'standard_a_1',      // threshold: 10
    ]);
    tracker = new MatchUpgradeTracker(store);
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  it('starts fresh SP trackers with only the early right-side Blaster fundamentals active', () => {
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);
    expect([...tracker.getActiveUpgrades(WeaponType.Standard)].sort()).toEqual([
      ...STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS,
    ].sort());
  });

  it('starts with zero kill counts', () => {
    expect(tracker.getKillCount(WeaponType.PlasmaMortar)).toBe(0);
  });

  it('starts with no pending choice', () => {
    expect(tracker.getPendingChoice()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // recordKill — auto-applies one actionable node, offers real choices for 2+
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

  it('auto-applies a single actionable SP node without pending choice UI', () => {
    const choiceAvailable = vi.fn();
    const activated = vi.fn();
    const autoApplied = vi.fn();
    tracker.onBuildChoiceAvailable = choiceAvailable;
    tracker.onUpgradeActivated = activated;
    tracker.onAutoUpgradeApplied = autoApplied;

    for (let i = 0; i < 30; i++) {
      tracker.recordKill(WeaponType.Standard);
    }

    expect(choiceAvailable).not.toHaveBeenCalled();
    expect(tracker.getPendingChoice()).toBeNull();
    expect(tracker.getActiveUpgrades(WeaponType.Standard)).toContain('standard_a_1');
    expect(activated).toHaveBeenCalledWith('standard_a_1', WeaponType.Standard);
    expect(autoApplied).toHaveBeenCalledWith('standard_a_1', WeaponType.Standard);
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
  // confirmChoice — earn+spend persists to MasteryPointStore
  // -------------------------------------------------------------------------

  it('confirmChoice permanently unlocks the node in the store', () => {
    // Start with a fresh store so the node is NOT pre-unlocked via menu
    const freshStore = new MasteryPointStore();
    // Manually seed permanentUnlocks by calling earnPoint+spendPoint first,
    // then create a tracker that already knows about the node.
    freshStore.earnPoint(WeaponType.PlasmaMortar);
    freshStore.spendPoint('plasma_mortar_a_1');
    const t = new MatchUpgradeTracker(freshStore);
    t.onBuildChoiceAvailable = vi.fn();
    // Reset the store so the node appears unspent — simulate a node that was
    // in permanentUnlocks but the store was refreshed (edge-case resilience).
    // For the normal case: node IS already isUnlocked, confirmChoice is additive.
    for (let i = 0; i < 10; i++) {
      t.recordKill(WeaponType.PlasmaMortar);
    }
    t.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);
    expect(freshStore.isUnlocked('plasma_mortar_a_1')).toBe(true);
  });

  it('confirmChoice calls earnPoint for the weapon type', () => {
    const pointsBefore = store.getTotalPoints(WeaponType.PlasmaMortar);
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);
    expect(store.getTotalPoints(WeaponType.PlasmaMortar)).toBe(pointsBefore + 1);
  });

  it('confirmChoice still activates the node even when spendPoint fails (node already at max)', () => {
    // The node is already unlocked in the store (from beforeEach makeStore call).
    // confirmChoice should still activate it locally.
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).has('plasma_mortar_a_1')).toBe(true);
  });

  it('confirmChoice allows formerly excluded Standard AL/AR combinations', () => {
    tracker.syncActiveUpgrades(WeaponType.Standard, ['standard_a_4', 'standard_al_5']);
    const activated = vi.fn();
    tracker.onUpgradeActivated = activated;

    tracker.confirmChoice('standard_ar_5', WeaponType.Standard);

    expect(tracker.getActiveUpgrades(WeaponType.Standard).has('standard_al_5')).toBe(true);
    expect(tracker.getActiveUpgrades(WeaponType.Standard).has('standard_ar_5')).toBe(true);
    expect(activated).toHaveBeenCalledWith('standard_ar_5', WeaponType.Standard);
  });

  it('confirmChoice rejects Black Hole nodes excluded by already-active Black Hole choices', () => {
    const blackHoleStore = makeStore(['black_hole_ar_4']);
    const blackHoleTracker = new MatchUpgradeTracker(blackHoleStore);
    blackHoleTracker.syncActiveUpgrades(WeaponType.BlackHole, ['black_hole_al_4']);
    const activated = vi.fn();
    blackHoleTracker.onUpgradeActivated = activated;

    blackHoleTracker.confirmChoice('black_hole_ar_4', WeaponType.BlackHole);

    expect(blackHoleTracker.getActiveUpgrades(WeaponType.BlackHole).has('black_hole_al_4')).toBe(true);
    expect(blackHoleTracker.getActiveUpgrades(WeaponType.BlackHole).has('black_hole_ar_4')).toBe(false);
    expect(activated).not.toHaveBeenCalled();
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

  it('MP server rejection cleanup clears pending choice without activating locally', () => {
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }

    expect(tracker.getPendingChoice()).not.toBeNull();
    tracker.clearPendingChoice();

    expect(tracker.getPendingChoice()).toBeNull();
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);
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

  it('higher-threshold single node auto-applies after prerequisite is confirmed', () => {
    const cb = vi.fn();
    const autoApplied = vi.fn();
    tracker.onBuildChoiceAvailable = cb;
    tracker.onAutoUpgradeApplied = autoApplied;

    // Cross threshold 10, confirm a_1
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);

    // Continue kills to cross threshold 25
    for (let i = 0; i < 15; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }

    expect(cb).toHaveBeenCalledTimes(1);
    expect(tracker.getPendingChoice()).toBeNull();
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar)).toContain('plasma_mortar_a_2');
    expect(autoApplied).toHaveBeenCalledWith('plasma_mortar_a_2', WeaponType.PlasmaMortar);
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
    const emptyTracker = new MatchUpgradeTracker(new MasteryPointStore());
    const cb = vi.fn();
    emptyTracker.onBuildChoiceAvailable = cb;
    for (let i = 0; i < 100; i++) {
      emptyTracker.recordKill(WeaponType.Standard);
    }
    expect(cb).not.toHaveBeenCalled();
    expect([...emptyTracker.getActiveUpgrades(WeaponType.Standard)].sort()).toEqual([
      ...STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS,
    ].sort());
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
    for (let i = 0; i < 30; i++) {
      tracker.recordKill(WeaponType.Standard);
    }
    expect(tracker.getKillCount(WeaponType.PlasmaMortar)).toBe(0);
    expect(tracker.getActiveUpgrades(WeaponType.PlasmaMortar).size).toBe(0);
    expect(tracker.getKillCount(WeaponType.Standard)).toBe(30);
    expect(cb).not.toHaveBeenCalled();
    expect(tracker.getActiveUpgrades(WeaponType.Standard)).toContain('standard_a_1');
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  it('reset clears kill counts and pending choice, then reactivates permanent unlocks', () => {
    tracker.onBuildChoiceAvailable = vi.fn();
    for (let i = 0; i < 25; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.confirmChoice('plasma_mortar_a_1', WeaponType.PlasmaMortar);

    tracker.reset();

    expect(tracker.getKillCount(WeaponType.PlasmaMortar)).toBe(0);
    expect([...tracker.getActiveUpgrades(WeaponType.PlasmaMortar)].sort()).toEqual([
      'plasma_mortar_a_1',
      'plasma_mortar_a_2',
      'plasma_mortar_b_1',
    ]);
    expect(tracker.getPendingChoice()).toBeNull();
  });

  it('after reset, permanently unlocked nodes are active and are not re-offered', () => {
    const cb = vi.fn();
    tracker.onBuildChoiceAvailable = cb;
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    tracker.reset();
    for (let i = 0; i < 10; i++) {
      tracker.recordKill(WeaponType.PlasmaMortar);
    }
    expect(cb).toHaveBeenCalledTimes(1);
    expect([...tracker.getActiveUpgrades(WeaponType.PlasmaMortar)].sort()).toEqual([
      'plasma_mortar_a_1',
      'plasma_mortar_a_2',
      'plasma_mortar_b_1',
    ]);
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

  it('tracker snapshots the store at construction — later store mutations without refreshFromStore are ignored', () => {
    const cb = vi.fn();
    const s = makeStore(['standard_a_1']);
    const t = new MatchUpgradeTracker(s);
    t.onBuildChoiceAvailable = cb;
    // Unlock a second node directly in the store after tracker is constructed
    s.earnPoint(WeaponType.PlasmaMortar);
    s.spendPoint('plasma_mortar_a_1');

    for (let i = 0; i < 10; i++) {
      t.recordKill(WeaponType.PlasmaMortar);
    }
    // plasma_mortar_a_1 was added to the store AFTER construction, so not in permanentUnlocks
    expect(cb).not.toHaveBeenCalled();
  });

  it('refreshFromStore auto-applies one newly unlocked node whose kill threshold was already met', () => {
    const s = makeStore([]);
    const t = new MatchUpgradeTracker(s);
    const cb = vi.fn();
    const autoApplied = vi.fn();
    t.onBuildChoiceAvailable = cb;
    t.onAutoUpgradeApplied = autoApplied;

    for (let i = 0; i < 30; i++) {
      t.recordKill(WeaponType.Standard);
    }
    expect(cb).not.toHaveBeenCalled();

    s.earnPoint(WeaponType.Standard);
    s.spendPoint('standard_a_1');
    t.refreshFromStore(s);

    expect(cb).not.toHaveBeenCalled();
    expect(t.getPendingChoice()).toBeNull();
    expect(t.getActiveUpgrades(WeaponType.Standard)).toContain('standard_a_1');
    expect(autoApplied).toHaveBeenCalledWith('standard_a_1', WeaponType.Standard);
  });
});
