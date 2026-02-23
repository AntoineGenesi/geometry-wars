/**
 * WeaponMasteryManager tests.
 * Covers: kill counting, tier boundaries, multiplier computation,
 * reset behavior, and regression test for Spread mastery tier-up.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WeaponMasteryManager, MASTERY_THRESHOLDS } from './WeaponMasteryManager';
import { WeaponType } from '../weapons/WeaponTypes';
import { BuffManager, StackBuffType } from './BuffManager';

// ---------------------------------------------------------------------------
// WeaponMasteryManager unit tests
// ---------------------------------------------------------------------------

describe('WeaponMasteryManager', () => {
  let manager: WeaponMasteryManager;

  beforeEach(() => {
    manager = new WeaponMasteryManager();
  });

  describe('kill counting', () => {
    it('starts at 0 kills for any weapon', () => {
      expect(manager.getKills(WeaponType.Spread)).toBe(0);
      expect(manager.getKills(WeaponType.Homing)).toBe(0);
    });

    it('increments kill count per weapon', () => {
      manager.recordKill(WeaponType.Spread);
      manager.recordKill(WeaponType.Spread);
      manager.recordKill(WeaponType.Homing);
      expect(manager.getKills(WeaponType.Spread)).toBe(2);
      expect(manager.getKills(WeaponType.Homing)).toBe(1);
    });

    it('tracks different weapons independently', () => {
      for (let i = 0; i < 10; i++) manager.recordKill(WeaponType.Standard);
      expect(manager.getKills(WeaponType.Standard)).toBe(10);
      expect(manager.getKills(WeaponType.Spread)).toBe(0);
    });
  });

  describe('mastery tiers', () => {
    it('starts at tier 0 for any weapon', () => {
      expect(manager.getMasteryTier(WeaponType.Spread)).toBe(0);
    });

    it('returns tier 0 below threshold[0]', () => {
      for (let i = 0; i < MASTERY_THRESHOLDS[0] - 1; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      expect(manager.getMasteryTier(WeaponType.Spread)).toBe(0);
    });

    it('returns tier 1 at exactly threshold[0] kills', () => {
      for (let i = 0; i < MASTERY_THRESHOLDS[0]; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      expect(manager.getMasteryTier(WeaponType.Spread)).toBe(1);
    });

    it('returns tier 2 at exactly threshold[1] kills', () => {
      for (let i = 0; i < MASTERY_THRESHOLDS[1]; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      expect(manager.getMasteryTier(WeaponType.Spread)).toBe(2);
    });

    it('returns tier 3 at exactly threshold[2] kills', () => {
      for (let i = 0; i < MASTERY_THRESHOLDS[2]; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      expect(manager.getMasteryTier(WeaponType.Spread)).toBe(3);
    });

    it('stays at tier 3 beyond threshold[2]', () => {
      for (let i = 0; i < MASTERY_THRESHOLDS[2] + 20; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      expect(manager.getMasteryTier(WeaponType.Spread)).toBe(3);
    });
  });

  describe('onMasteryTierUp callback', () => {
    it('fires when tier 1 threshold is crossed', () => {
      const callback = vi.fn();
      manager.onMasteryTierUp = callback;
      for (let i = 0; i < MASTERY_THRESHOLDS[0]; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      expect(callback).toHaveBeenCalledWith(WeaponType.Spread, 1);
    });

    it('fires when tier 2 threshold is crossed', () => {
      const callback = vi.fn();
      manager.onMasteryTierUp = callback;
      for (let i = 0; i < MASTERY_THRESHOLDS[1]; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      // Should have fired once for tier1 and once for tier2
      expect(callback).toHaveBeenCalledWith(WeaponType.Spread, 1);
      expect(callback).toHaveBeenCalledWith(WeaponType.Spread, 2);
    });

    it('fires when tier 3 threshold is crossed', () => {
      const callback = vi.fn();
      manager.onMasteryTierUp = callback;
      for (let i = 0; i < MASTERY_THRESHOLDS[2]; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      expect(callback).toHaveBeenCalledWith(WeaponType.Spread, 3);
    });

    it('does NOT fire again after tier 3 (already max)', () => {
      const callback = vi.fn();
      manager.onMasteryTierUp = callback;
      for (let i = 0; i < MASTERY_THRESHOLDS[2] + 10; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      // Only 3 tier-up events, not more
      expect(callback).toHaveBeenCalledTimes(3);
    });

    it('fires for correct weapon type', () => {
      const callback = vi.fn();
      manager.onMasteryTierUp = callback;
      for (let i = 0; i < MASTERY_THRESHOLDS[0]; i++) {
        manager.recordKill(WeaponType.Homing);
      }
      expect(callback).toHaveBeenCalledWith(WeaponType.Homing, 1);
      // Spread should not have triggered
      expect(callback).not.toHaveBeenCalledWith(WeaponType.Spread, expect.anything());
    });
  });

  describe('getProgress', () => {
    it('returns 0 kills, tier 0, next threshold = MASTERY_THRESHOLDS[0] for fresh weapon', () => {
      const p = manager.getProgress(WeaponType.Spread);
      expect(p.kills).toBe(0);
      expect(p.tier).toBe(0);
      expect(p.nextThreshold).toBe(MASTERY_THRESHOLDS[0]);
    });

    it('returns null nextThreshold at tier 3', () => {
      for (let i = 0; i < MASTERY_THRESHOLDS[2]; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      const p = manager.getProgress(WeaponType.Spread);
      expect(p.tier).toBe(3);
      expect(p.nextThreshold).toBeNull();
    });
  });

  describe('reset', () => {
    it('clears all kill counts', () => {
      for (let i = 0; i < 20; i++) manager.recordKill(WeaponType.Spread);
      for (let i = 0; i < 5; i++) manager.recordKill(WeaponType.Homing);
      manager.reset();
      expect(manager.getKills(WeaponType.Spread)).toBe(0);
      expect(manager.getKills(WeaponType.Homing)).toBe(0);
    });

    it('resets tiers to 0 after reset', () => {
      for (let i = 0; i < MASTERY_THRESHOLDS[2]; i++) {
        manager.recordKill(WeaponType.Spread);
      }
      expect(manager.getMasteryTier(WeaponType.Spread)).toBe(3);
      manager.reset();
      expect(manager.getMasteryTier(WeaponType.Spread)).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// BuffManager.getMasteryMultiplier tests
// ---------------------------------------------------------------------------

describe('BuffManager.getMasteryMultiplier', () => {
  let buffManager: BuffManager;

  beforeEach(() => {
    buffManager = new BuffManager();
  });

  it('returns damageMultiplier 1.0 when no mastery stacks', () => {
    const result = buffManager.getMasteryMultiplier(WeaponType.Spread);
    expect(result.damageMultiplier).toBe(1.0);
  });

  it('returns correct damageMultiplier for Blaster at 1 stack', () => {
    buffManager.addBuff(StackBuffType.MasteryBlaster);
    const result = buffManager.getMasteryMultiplier(WeaponType.Standard);
    expect(result.damageMultiplier).toBeCloseTo(1.4);
  });

  it('returns correct damageMultiplier for Blaster at 2 stacks', () => {
    buffManager.addBuff(StackBuffType.MasteryBlaster);
    buffManager.addBuff(StackBuffType.MasteryBlaster);
    const result = buffManager.getMasteryMultiplier(WeaponType.Standard);
    expect(result.damageMultiplier).toBeCloseTo(1.8);
  });

  it('returns correct damageMultiplier for LaserBeam at 3 stacks', () => {
    for (let i = 0; i < 3; i++) buffManager.addBuff(StackBuffType.MasteryLaserBeam);
    const result = buffManager.getMasteryMultiplier(WeaponType.LaserBeam);
    expect(result.damageMultiplier).toBeCloseTo(2.8);
  });

  it('returns extraPellets specialBonus for Spread at 1 stack', () => {
    buffManager.addBuff(StackBuffType.MasterySpread);
    const result = buffManager.getMasteryMultiplier(WeaponType.Spread);
    expect(result.specialBonus.extraPellets).toBe(2);
  });

  it('caps at maxStack 3 for mastery buffs', () => {
    // Add 5 stacks — should cap at 3
    for (let i = 0; i < 5; i++) buffManager.addBuff(StackBuffType.MasteryBlaster);
    expect(buffManager.getStacks(StackBuffType.MasteryBlaster)).toBe(3);
    const result = buffManager.getMasteryMultiplier(WeaponType.Standard);
    expect(result.damageMultiplier).toBeCloseTo(2.2);
  });
});

// ---------------------------------------------------------------------------
// Regression test: fire Spread 10 times → tier 1 + multiplier > 1.0
// ---------------------------------------------------------------------------

describe('Regression: Spread mastery tier 1 integration', () => {
  it('awards mastery tier 1 after 10 Spread kills and getMasteryMultiplier returns > 1 via buff stacks', () => {
    const masteryManager = new WeaponMasteryManager();
    const buffManager = new BuffManager();

    // Wire tier-up → buff award
    masteryManager.onMasteryTierUp = (weaponType, _tier) => {
      const buffMap: Partial<Record<WeaponType, StackBuffType>> = {
        [WeaponType.Spread]: StackBuffType.MasterySpread,
      };
      const buffType = buffMap[weaponType];
      if (buffType) buffManager.addBuff(buffType);
    };

    // Record 10 kills with Spread
    for (let i = 0; i < 10; i++) {
      masteryManager.recordKill(WeaponType.Spread);
    }

    // Tier should be 1
    expect(masteryManager.getMasteryTier(WeaponType.Spread)).toBe(1);

    // Buff stacks should be 1 (tier-up fired once)
    expect(buffManager.getStacks(StackBuffType.MasterySpread)).toBe(1);

    // getMasteryMultiplier for Spread: Spread gives specialBonus.extraPellets, not damageMultiplier
    // but via WeaponManager injection, we'd pass buffManager.getMasteryMultiplier(Spread).damageMultiplier
    // which is 1.0 for Spread (it's pellet-count based). Test the specialBonus path:
    const mult = buffManager.getMasteryMultiplier(WeaponType.Spread);
    expect(mult.specialBonus.extraPellets).toBe(2); // 1 stack × 2 extra pellets
  });

  it('mastery multiplier > 1.0 for Blaster after 10 kills and buff applied', () => {
    const masteryManager = new WeaponMasteryManager();
    const buffManager = new BuffManager();

    masteryManager.onMasteryTierUp = (weaponType, _tier) => {
      if (weaponType === WeaponType.Standard) {
        buffManager.addBuff(StackBuffType.MasteryBlaster);
      }
    };

    for (let i = 0; i < 10; i++) {
      masteryManager.recordKill(WeaponType.Standard);
    }

    const mult = buffManager.getMasteryMultiplier(WeaponType.Standard);
    expect(mult.damageMultiplier).toBeGreaterThan(1.0);
  });
});

// ---------------------------------------------------------------------------
// rollBuffDrop exclusion test
// ---------------------------------------------------------------------------

describe('BuffManager.rollBuffDrop mastery exclusion', () => {
  it('never returns a mastery buff type', () => {
    const masteryTypes = new Set(Object.values(StackBuffType).filter(v => v.startsWith('mastery_')));
    // Run many trials — mastery buffs must never appear
    for (let i = 0; i < 1000; i++) {
      const drop = BuffManager.rollBuffDrop();
      if (drop !== null) {
        expect(masteryTypes.has(drop)).toBe(false);
      }
    }
  });
});
