import { describe, expect, it } from 'vitest';
import { WeaponType } from '../weapons/WeaponTypes';
import {
  getSpreadUpgradePattern,
  getStandardUpgradePattern,
  getUpgradeDamageMultiplier,
  getUpgradeFireRateMultiplier,
} from './WeaponUpgradeEffects';

describe('shared weapon upgrade effects', () => {
  it('matches SP Standard fan and branch-B counts', () => {
    const pattern = getStandardUpgradePattern(new Set(['standard_a_4', 'standard_b_3']));
    expect(pattern).toEqual({
      fanExtraBolts: 4,
      fanAngle: Math.PI / 7.2,
      branchBExtraBolts: 3,
      branchBConeAngle: Math.PI / 36,
    });
  });

  it('matches SP Spread pellet upgrade semantics', () => {
    expect(getSpreadUpgradePattern(new Set(['spread_a_1', 'spread_a_2', 'spread_a_3']))).toEqual({
      bulletCount: 8,
      spreadAngle: Math.PI / 6,
    });
  });

  it('applies the same Standard and Spread damage/fire-rate families used by SP', () => {
    expect(getUpgradeDamageMultiplier(WeaponType.Standard, new Set(['standard_a_1']))).toBeCloseTo(1.2);
    expect(getUpgradeDamageMultiplier(WeaponType.Spread, new Set(['spread_al_5']))).toBeCloseTo(1.15);
    expect(getUpgradeFireRateMultiplier(WeaponType.Standard, new Set(['standard_ar_5']))).toBeCloseTo(1.5);
  });
});
