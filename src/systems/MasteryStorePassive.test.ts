/**
 * Phase 3 integration tests: passive bonus multipliers from cross-game mastery.
 *
 * Verifies that getPassiveMultipliers() returns correct damage/fire rate values,
 * that the multipliers compose correctly with a 1.0 baseline (Level 0 = no bonus),
 * and that Level 3 produces measurably higher damage than Level 0.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { MasteryStore, XP_PER_KILL } from './MasteryStore';
import { WeaponType } from '../weapons/WeaponTypes';

// ── localStorage mock ─────────────────────────────────────────────────────────

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

function freshStore(): MasteryStore {
  localStorageMock.clear();
  return MasteryStore.load();
}

function killMap(entries: Partial<Record<WeaponType, number>>): Map<WeaponType, number> {
  return new Map(Object.entries(entries) as [WeaponType, number][]);
}

/**
 * Award exactly enough kills in a single game to land at the given XP total.
 * Game 1 has diminishingFactor=1.0, so XP = kills * XP_PER_KILL.
 */
function awardExactXP(store: MasteryStore, weapon: WeaponType, targetXP: number): void {
  const kills = Math.ceil(targetXP / XP_PER_KILL);
  store.awardGameXP(killMap({ [weapon]: kills }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getPassiveMultipliers — Level 0 baseline', () => {
  it('returns 1.0 damage and fire rate for all weapons at Level 0', () => {
    const store = freshStore();
    const bonuses = store.getPassiveMultipliers();

    for (const type of Object.values(WeaponType)) {
      const bonus = bonuses.get(type)!;
      expect(bonus.damageMultiplier).toBe(1.0);
      expect(bonus.fireRateMultiplier).toBe(1.0);
    }
  });
});

describe('getPassiveMultipliers — Level 3 Blaster (Standard)', () => {
  let store: MasteryStore;
  beforeEach(() => {
    store = freshStore();
    // Award exactly 500 XP (Level 3 threshold) in one game: 50 kills * 10 XP = 500 XP
    awardExactXP(store, WeaponType.Standard, 500);
  });

  it('reaches Level 3 after 500 XP', () => {
    expect(store.getLevel(WeaponType.Standard)).toBe(3);
  });

  it('returns damageMultiplier > 1.0 at Level 3', () => {
    const bonuses = store.getPassiveMultipliers();
    const bonus = bonuses.get(WeaponType.Standard)!;
    expect(bonus.damageMultiplier).toBeGreaterThan(1.0);
  });

  it('returns fireRateMultiplier > 1.0 at Level 3 (Blaster has rate bonus)', () => {
    const bonuses = store.getPassiveMultipliers();
    const bonus = bonuses.get(WeaponType.Standard)!;
    expect(bonus.fireRateMultiplier).toBeGreaterThan(1.0);
  });

  it('Level 3 Blaster damage multiplier matches expected interpolated value', () => {
    // L1=1.10, L5=1.50. t=(3-1)/4=0.5. dmg = 1.10 + 0.5 * (1.50-1.10) = 1.30
    const bonuses = store.getPassiveMultipliers();
    const bonus = bonuses.get(WeaponType.Standard)!;
    expect(bonus.damageMultiplier).toBeCloseTo(1.30, 5);
  });

  it('Level 3 Blaster deals measurably more damage than Level 0 baseline', () => {
    // Level 0 baseline = 1.0, Level 3 = 1.30 → 30% more damage
    const l3Bonuses = store.getPassiveMultipliers();
    const l3Damage = l3Bonuses.get(WeaponType.Standard)!.damageMultiplier;
    expect(l3Damage).toBeGreaterThan(1.0);
    expect(l3Damage - 1.0).toBeGreaterThanOrEqual(0.20);
  });
});

describe('getPassiveMultipliers — composing with 1.0 baseline', () => {
  it('Level 0 passive multiplied by in-session mult (1.0) stays 1.0', () => {
    const store = freshStore();
    const bonuses = store.getPassiveMultipliers();
    const passive = bonuses.get(WeaponType.Standard)!.damageMultiplier; // 1.0
    const inSession = 1.0;
    expect(passive * inSession).toBe(1.0);
  });

  it('Level 5 Blaster returns max damage multiplier (1.50)', () => {
    const store = freshStore();
    // 100 kills * 10 XP = 1000 XP → Level 5
    awardExactXP(store, WeaponType.Standard, 1000);
    expect(store.getLevel(WeaponType.Standard)).toBe(5);
    const bonuses = store.getPassiveMultipliers();
    const bonus = bonuses.get(WeaponType.Standard)!;
    expect(bonus.damageMultiplier).toBeCloseTo(1.50, 5);
  });

  it('Level 5 LaserBeam returns max damage multiplier (1.70)', () => {
    const store = freshStore();
    awardExactXP(store, WeaponType.LaserBeam, 1000);
    const bonuses = store.getPassiveMultipliers();
    expect(bonuses.get(WeaponType.LaserBeam)!.damageMultiplier).toBeCloseTo(1.70, 5);
  });

  it('non-Standard weapons with Level 0 also return 1.0', () => {
    const store = freshStore();
    const bonuses = store.getPassiveMultipliers();
    for (const type of [WeaponType.PlasmaMortar, WeaponType.GravityGun, WeaponType.BlackHole]) {
      expect(bonuses.get(type)!.fireRateMultiplier).toBe(1.0);
    }
  });
});
