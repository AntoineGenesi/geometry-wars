import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MasteryStore, XP_PER_KILL, DIMINISHING_FACTOR } from './MasteryStore';
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshStore(): MasteryStore {
  localStorageMock.clear();
  return MasteryStore.load();
}

function killMap(entries: Partial<Record<WeaponType, number>>): Map<WeaponType, number> {
  return new Map(Object.entries(entries) as [WeaponType, number][]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MasteryStore — XP award math', () => {
  it(`first game: ${XP_PER_KILL} XP per kill (no diminishing)`, () => {
    const store = freshStore();
    const [result] = store.awardGameXP(killMap({ [WeaponType.Standard]: 10 }));
    // diminishingFactor = 1 / (1 + 0 * DIMINISHING_FACTOR) = 1.0
    expect(result.xpAfter).toBeCloseTo(10 * XP_PER_KILL, 5);
  });

  it('game 5: diminishing returns reduce XP per kill', () => {
    const store = freshStore();
    // Simulate 4 previous games by running awardGameXP 4 times
    for (let g = 0; g < 4; g++) {
      store.awardGameXP(killMap({ [WeaponType.Standard]: 1 }));
    }
    const xpBefore = store.getXP(WeaponType.Standard);
    store.awardGameXP(killMap({ [WeaponType.Standard]: 10 }));
    const xpEarned = store.getXP(WeaponType.Standard) - xpBefore;
    // gamesPlayed=4 → diminishingFactor = 1/(1+4*0.05) = 1/1.2 ≈ 0.833
    // 10 * 0.5 * 0.833 ≈ 4.17
    expect(xpEarned).toBeCloseTo(10 * XP_PER_KILL / (1 + 4 * DIMINISHING_FACTOR), 1);
  });

  it('game 20: diminishing returns still active but gradual', () => {
    const store = freshStore();
    for (let g = 0; g < 19; g++) {
      store.awardGameXP(killMap({ [WeaponType.Standard]: 1 }));
    }
    const xpBefore = store.getXP(WeaponType.Standard);
    store.awardGameXP(killMap({ [WeaponType.Standard]: 10 }));
    const xpEarned = store.getXP(WeaponType.Standard) - xpBefore;
    // gamesPlayed=19 → diminishingFactor = 1/(1+19*0.05) = 1/1.95 ≈ 0.513
    // 10 * 0.5 * 0.513 ≈ 2.56
    const expected = 10 * XP_PER_KILL / (1 + 19 * DIMINISHING_FACTOR);
    expect(xpEarned).toBeCloseTo(expected, 1);
  });

  it('zero kills awards zero XP and does not increment gamesPlayed', () => {
    const store = freshStore();
    store.awardGameXP(killMap({ [WeaponType.Homing]: 0 }));
    expect(store.getXP(WeaponType.Homing)).toBe(0);
    // gamesPlayed stays 0 → second game still gets full XP rate
    store.awardGameXP(killMap({ [WeaponType.Homing]: 10 }));
    expect(store.getXP(WeaponType.Homing)).toBeCloseTo(10 * XP_PER_KILL, 5);
  });
});

describe('MasteryStore — level thresholds', () => {
  it('level 0 below 100 XP', () => {
    const store = freshStore();
    store.awardGameXP(killMap({ [WeaponType.Spread]: 9 })); // 4.5 XP << 100
    expect(store.getLevel(WeaponType.Spread)).toBe(0);
  });

  it('level 1 at exactly 100 XP', () => {
    // 200 kills in first game: 200 * 0.5 * 1.0 = 100 XP → Level 1
    const store = freshStore();
    store.awardGameXP(killMap({ [WeaponType.Spread]: 200 }));
    expect(store.getXP(WeaponType.Spread)).toBeCloseTo(100, 5);
    expect(store.getLevel(WeaponType.Spread)).toBe(1);
  });

  it('level 2 at 300 XP', () => {
    const store = freshStore();
    // Force XP via direct storage manipulation
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 1,
      weapons: { [WeaponType.Piercing]: { xp: 300, gamesPlayed: 5 } },
    }));
    const loaded = MasteryStore.load();
    expect(loaded.getLevel(WeaponType.Piercing)).toBe(2);
  });

  it('level 5 at exactly 1000 XP', () => {
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 1,
      weapons: { [WeaponType.LaserBeam]: { xp: 1000, gamesPlayed: 20 } },
    }));
    const store = MasteryStore.load();
    expect(store.getLevel(WeaponType.LaserBeam)).toBe(5);
  });

  it('all boundary values produce correct levels', () => {
    const cases: [number, number][] = [[0, 0], [99, 0], [100, 1], [299, 1], [300, 2], [499, 2], [500, 3], [699, 3], [700, 4], [999, 4], [1000, 5], [9999, 5]];
    for (const [xp, expectedLevel] of cases) {
      localStorage.setItem('gw_weapon_mastery', JSON.stringify({
        version: 1,
        weapons: { [WeaponType.Standard]: { xp, gamesPlayed: 0 } },
      }));
      const store = MasteryStore.load();
      expect(store.getLevel(WeaponType.Standard)).toBe(expectedLevel);
    }
  });
});

describe('MasteryStore — awardGameXP results', () => {
  it('returns correct before/after and leveledUp flag', () => {
    // Start with 98 XP, gamesPlayed=1 → 5 kills pushes over the 100 XP threshold
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 1,
      weapons: { [WeaponType.BlackHole]: { xp: 98, gamesPlayed: 1 } },
    }));
    const store = MasteryStore.load();
    // gamesPlayed=1 → diminishingFactor = 1/(1+0.05) ≈ 0.952 → 5 * 0.5 * 0.952 ≈ 2.38 XP → ~100.38 total
    const [result] = store.awardGameXP(killMap({ [WeaponType.BlackHole]: 5 }));
    expect(result.xpBefore).toBeCloseTo(98, 5);
    expect(result.xpAfter).toBeGreaterThan(100);
    expect(result.levelBefore).toBe(0);
    expect(result.levelAfter).toBe(1);
    expect(result.leveledUp).toBe(true);
  });

  it('multiple weapons returned in results', () => {
    const store = freshStore();
    const results = store.awardGameXP(killMap({
      [WeaponType.Standard]: 5,
      [WeaponType.Homing]: 3,
    }));
    expect(results).toHaveLength(2);
    const types = results.map(r => r.weaponType);
    expect(types).toContain(WeaponType.Standard);
    expect(types).toContain(WeaponType.Homing);
  });
});

describe('MasteryStore — passive multipliers', () => {
  it('level 0 returns 1.0 multipliers', () => {
    const store = freshStore();
    const multipliers = store.getPassiveMultipliers();
    const bonus = multipliers.get(WeaponType.Standard)!;
    expect(bonus.damageMultiplier).toBe(1.0);
    expect(bonus.fireRateMultiplier).toBe(1.0);
    expect(bonus.specialBonus).toBeUndefined();
  });

  it('level 1 blaster: +10% dmg, +5% rate', () => {
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 1,
      weapons: { [WeaponType.Standard]: { xp: 100, gamesPlayed: 2 } },
    }));
    const store = MasteryStore.load();
    const bonus = store.getPassiveMultipliers().get(WeaponType.Standard)!;
    expect(bonus.damageMultiplier).toBeCloseTo(1.10, 5);
    expect(bonus.fireRateMultiplier).toBeCloseTo(1.05, 5);
    expect(bonus.specialBonus).toBeUndefined();
  });

  it('level 5 blaster: +50% dmg, +20% rate, special bonus', () => {
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 1,
      weapons: { [WeaponType.Standard]: { xp: 1000, gamesPlayed: 20 } },
    }));
    const store = MasteryStore.load();
    const bonus = store.getPassiveMultipliers().get(WeaponType.Standard)!;
    expect(bonus.damageMultiplier).toBeCloseTo(1.50, 5);
    expect(bonus.fireRateMultiplier).toBeCloseTo(1.20, 5);
    expect(bonus.specialBonus).toBe('+1 extra bullet');
  });

  it('level 3 interpolated correctly (midpoint between L1 and L5)', () => {
    // Level 3 → t = (3-1)/4 = 0.5
    // Standard: dmg = 1.10 + 0.5*(1.50-1.10) = 1.10+0.20 = 1.30
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 1,
      weapons: { [WeaponType.Standard]: { xp: 500, gamesPlayed: 10 } },
    }));
    const store = MasteryStore.load();
    const bonus = store.getPassiveMultipliers().get(WeaponType.Standard)!;
    expect(bonus.damageMultiplier).toBeCloseTo(1.30, 5);
    expect(bonus.fireRateMultiplier).toBeCloseTo(1.125, 5);
  });

  it('all 10 weapons have entries in multipliers', () => {
    const store = freshStore();
    const multipliers = store.getPassiveMultipliers();
    expect(multipliers.size).toBe(10);
    for (const type of Object.values(WeaponType)) {
      expect(multipliers.has(type)).toBe(true);
    }
  });
});

describe('MasteryStore — save/load round-trip', () => {
  it('persists XP across load() calls', () => {
    const store1 = freshStore();
    store1.awardGameXP(killMap({ [WeaponType.TeslaCoil]: 10 }));
    const xpAfter = store1.getXP(WeaponType.TeslaCoil);

    const store2 = MasteryStore.load(); // reloads from localStorage
    expect(store2.getXP(WeaponType.TeslaCoil)).toBeCloseTo(xpAfter, 5);
  });

  it('unknown schema version → resets to empty', () => {
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 99,
      weapons: { [WeaponType.Standard]: { xp: 9999, gamesPlayed: 100 } },
    }));
    const store = MasteryStore.load();
    expect(store.getXP(WeaponType.Standard)).toBe(0);
  });

  it('corrupted JSON → resets to empty', () => {
    localStorage.setItem('gw_weapon_mastery', '{ not valid JSON !!!');
    const store = MasteryStore.load();
    expect(store.getXP(WeaponType.Standard)).toBe(0);
  });

  it('missing localStorage key → returns zero XP', () => {
    localStorageMock.clear();
    const store = MasteryStore.load();
    expect(store.getXP(WeaponType.Homing)).toBe(0);
  });
});

describe('MasteryStore — reset()', () => {
  it('clears all XP and localStorage', () => {
    const store = freshStore();
    store.awardGameXP(killMap({ [WeaponType.GravityGun]: 15 }));
    expect(store.getXP(WeaponType.GravityGun)).toBeGreaterThan(0);

    store.reset();
    expect(store.getXP(WeaponType.GravityGun)).toBe(0);
    expect(localStorage.getItem('gw_weapon_mastery')).toBeNull();
  });

  it('after reset, awardGameXP starts fresh (no diminishing from prior games)', () => {
    const store = freshStore();
    // Play 10 games to accumulate gamesPlayed
    for (let g = 0; g < 10; g++) {
      store.awardGameXP(killMap({ [WeaponType.Standard]: 1 }));
    }
    store.reset();
    // Now game 1 should give full XP_PER_KILL * kills
    store.awardGameXP(killMap({ [WeaponType.Standard]: 10 }));
    expect(store.getXP(WeaponType.Standard)).toBeCloseTo(10 * XP_PER_KILL, 5);
  });
});

describe('MasteryStore — awardGameXP() realistic scenario', () => {
  it('5 Blaster kills + 3 Spread Shot kills — XP awarded correctly', () => {
    const store = freshStore();
    const results = store.awardGameXP(
      killMap({ [WeaponType.Standard]: 5, [WeaponType.Spread]: 3 }),
    );

    // gamesPlayed was 0 for both → diminishingFactor = 1.0
    const blasterResult = results.find(r => r.weaponType === WeaponType.Standard)!;
    const spreadResult  = results.find(r => r.weaponType === WeaponType.Spread)!;

    expect(blasterResult).toBeDefined();
    expect(spreadResult).toBeDefined();

    // 5 kills × XP_PER_KILL × 1.0 = 2.5 XP
    expect(blasterResult.xpBefore).toBe(0);
    expect(blasterResult.xpAfter).toBeCloseTo(5 * XP_PER_KILL, 5);

    // 3 kills × XP_PER_KILL × 1.0 = 1.5 XP
    expect(spreadResult.xpBefore).toBe(0);
    expect(spreadResult.xpAfter).toBeCloseTo(3 * XP_PER_KILL, 5);
  });

  it('gamesPlayed incremented only for weapons with kills > 0', () => {
    const store = freshStore();
    // Award with 5 Blaster kills
    store.awardGameXP(killMap({ [WeaponType.Standard]: 5 }));
    const xpAfterGame1 = store.getXP(WeaponType.Standard);

    // Second game with 5 kills — gamesPlayed is now 1 → diminishing returns
    store.awardGameXP(killMap({ [WeaponType.Standard]: 5 }));
    const xpGame2 = store.getXP(WeaponType.Standard) - xpAfterGame1;

    // gamesPlayed=1 → factor = 1/(1+DIMINISHING_FACTOR) → 5*XP_PER_KILL/factor
    expect(xpGame2).toBeCloseTo(5 * XP_PER_KILL / (1 + DIMINISHING_FACTOR), 1);

    // Spread Shot had 0 kills → gamesPlayed stays 0 → next game still gets full XP
    store.awardGameXP(killMap({ [WeaponType.Spread]: 5 }));
    expect(store.getXP(WeaponType.Spread)).toBeCloseTo(5 * XP_PER_KILL, 5);
  });
});

describe('MasteryStore — getAllLevels()', () => {
  it('returns a map with all 10 weapon types', () => {
    const store = freshStore();
    const levels = store.getAllLevels();
    expect(levels.size).toBe(10);
    for (const type of Object.values(WeaponType)) {
      expect(levels.has(type)).toBe(true);
    }
  });

  it('returns level 0 for weapons with no XP', () => {
    const store = freshStore();
    const levels = store.getAllLevels();
    for (const lv of levels.values()) {
      expect(lv).toBe(0);
    }
  });

  it('reflects current levels after XP award', () => {
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 1,
      weapons: { [WeaponType.Standard]: { xp: 300, gamesPlayed: 5 } },
    }));
    const store = MasteryStore.load();
    const levels = store.getAllLevels();
    expect(levels.get(WeaponType.Standard)).toBe(2);
    expect(levels.get(WeaponType.Homing)).toBe(0);
  });
});

describe('MasteryStore — getBonusDescription()', () => {
  it('returns empty string for level 0', () => {
    const store = freshStore();
    expect(store.getBonusDescription(WeaponType.Standard, 0)).toBe('');
  });

  it('level 2 Blaster: includes weapon name and damage percentage', () => {
    const store = freshStore();
    // Level 2: t=(2-1)/4=0.25, dmg=1.10+0.25*(1.50-1.10)=1.20 → +20%
    const desc = store.getBonusDescription(WeaponType.Standard, 2);
    expect(desc).toContain('Blaster');
    expect(desc).toContain('+20%');
  });

  it('level 5 Plasma Mortar: returns special bonus', () => {
    const store = freshStore();
    const desc = store.getBonusDescription(WeaponType.PlasmaMortar, 5);
    expect(desc).toContain('Plasma Mortar');
    expect(desc).toContain('+50% AoE radius');
  });

  it('level 5 Blaster: returns special bonus (not damage %)', () => {
    const store = freshStore();
    const desc = store.getBonusDescription(WeaponType.Standard, 5);
    expect(desc).toContain('+1 extra bullet');
  });

  it('level 1 returns a non-empty description', () => {
    const store = freshStore();
    const desc = store.getBonusDescription(WeaponType.Homing, 1);
    expect(desc.length).toBeGreaterThan(0);
  });
});

describe('MasteryStore — getProgress()', () => {
  it('returns correct progress at level 0', () => {
    const store = freshStore();
    const progress = store.getProgress(WeaponType.Standard);
    expect(progress.level).toBe(0);
    expect(progress.nextThreshold).toBe(100);
    expect(progress.progressPct).toBe(0);
  });

  it('returns 100% progressPct at max level', () => {
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 1,
      weapons: { [WeaponType.Standard]: { xp: 1000, gamesPlayed: 20 } },
    }));
    const store = MasteryStore.load();
    const progress = store.getProgress(WeaponType.Standard);
    expect(progress.level).toBe(5);
    expect(progress.nextThreshold).toBeNull();
    expect(progress.progressPct).toBe(100);
  });

  it('returns partial progress within a level', () => {
    // Level 1 spans 100-299, so 200 XP = 50% through level 1
    localStorage.setItem('gw_weapon_mastery', JSON.stringify({
      version: 1,
      weapons: { [WeaponType.Standard]: { xp: 200, gamesPlayed: 5 } },
    }));
    const store = MasteryStore.load();
    const progress = store.getProgress(WeaponType.Standard);
    expect(progress.level).toBe(1);
    expect(progress.progressPct).toBeCloseTo(50, 1);
  });
});

describe('MasteryStore — balance targets', () => {
  it('crushing first game (200 kills) yields exactly 1 upgrade (Level 1)', () => {
    const store = freshStore();
    // 200 kills * 0.5 XP/kill * 1.0 diminishing = 100 XP → Level 1
    const [result] = store.awardGameXP(killMap({ [WeaponType.TeslaCoil]: 200 }));
    expect(result.levelAfter).toBe(1);
    expect(result.leveledUp).toBe(true);
    expect(result.xpAfter).toBeCloseTo(100, 5);
  });

  it('single game cannot reach Level 2 without extreme kill counts (600+)', () => {
    const store = freshStore();
    // 599 kills → 299.5 XP → Level 1 (not Level 2)
    const [result] = store.awardGameXP(killMap({ [WeaponType.TeslaCoil]: 599 }));
    expect(result.levelAfter).toBe(1);
    // 600 kills → 300 XP → Level 2
    localStorageMock.clear();
    const store2 = MasteryStore.load();
    const [result2] = store2.awardGameXP(killMap({ [WeaponType.TeslaCoil]: 600 }));
    expect(result2.levelAfter).toBe(2);
  });

  it('20 games of regular use (150 kills/game) approaches full mastery', () => {
    const store = freshStore();
    for (let g = 0; g < 20; g++) {
      store.awardGameXP(killMap({ [WeaponType.Standard]: 150 }));
    }
    const level = store.getLevel(WeaponType.Standard);
    // Should be at least Level 4 (700+ XP) after 20 solid games
    expect(level).toBeGreaterThanOrEqual(4);
  });
});
