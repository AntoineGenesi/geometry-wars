import { describe, expect, it } from 'vitest';
import { getAllNodes } from '../systems/UpgradeTreeData';
import { WeaponType } from '../weapons/WeaponTypes';
import {
  MP_SUPPORTED_UPGRADE_NODE_IDS,
  filterMpSupportedUpgradeNodeIds,
  getMpUpgradeNodeSupport,
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

  it('makes standard_al_5 a distinct MP-supported scatter upgrade over standard_a_4', () => {
    const rapidBurst = getStandardUpgradePattern(new Set(['standard_a_4']));
    const shotgunSpread = getStandardUpgradePattern(new Set(['standard_a_4', 'standard_al_5']));

    expect(shotgunSpread.fanExtraBolts).toBe(rapidBurst.fanExtraBolts);
    expect(shotgunSpread.fanAngle).toBeGreaterThan(rapidBurst.fanAngle);
    expect(shotgunSpread.fanAngle).toBeCloseTo(Math.PI * 35 / 180);
  });

  it('matches SP Spread pellet upgrade semantics', () => {
    expect(getSpreadUpgradePattern(new Set(['spread_a_1', 'spread_a_2', 'spread_a_3']))).toEqual({
      bulletCount: 8,
      spreadAngle: Math.PI / 6,
    });
  });

  it('uses Spread AL nodes as final pellet counts instead of stacking trunk extras twice', () => {
    expect(getSpreadUpgradePattern(new Set(['spread_a_1', 'spread_a_2', 'spread_a_3', 'spread_al_4'])).bulletCount).toBe(9);
    expect(getSpreadUpgradePattern(new Set(['spread_a_1', 'spread_a_2', 'spread_a_3', 'spread_al_5'])).bulletCount).toBe(10);
  });

  it('applies the same Standard and Spread damage/fire-rate families used by SP', () => {
    expect(getUpgradeDamageMultiplier(WeaponType.Standard, new Set(['standard_a_1']))).toBeCloseTo(1);
    expect(getUpgradeDamageMultiplier(WeaponType.Standard, new Set(['standard_a_2']))).toBeCloseTo(1.4);
    expect(getUpgradeFireRateMultiplier(WeaponType.Standard, new Set(['standard_b_1']))).toBeCloseTo(1);
    expect(getUpgradeDamageMultiplier(WeaponType.Spread, new Set(['spread_al_5']))).toBeCloseTo(1.15);
    expect(getUpgradeFireRateMultiplier(WeaponType.Standard, new Set(['standard_ar_5']))).toBeCloseTo(1.5);
  });

  it('keeps all MP-supported ids present in the rebuilt retained tree', () => {
    const retainedNodeIds = new Set(getAllNodes().map(node => node.id));

    for (const nodeId of MP_SUPPORTED_UPGRADE_NODE_IDS) {
      expect(retainedNodeIds.has(nodeId)).toBe(true);
      expect(getMpUpgradeNodeSupport(nodeId).status).toBe('server_authoritative');
    }
  });

  it('returns unsupported reasons for retained nodes without MP support', () => {
    for (const nodeId of ['standard_b_4', 'black_hole_al_4', 'plasma_mortar_a_4']) {
      const support = getMpUpgradeNodeSupport(nodeId);
      expect(support.status).toBe('unsupported');
      expect(support.reason.length).toBeGreaterThan(0);
    }
  });

  it('filters unsupported MP build-choice ids while preserving supported ids', () => {
    expect(filterMpSupportedUpgradeNodeIds([
      'standard_a_1',
      'standard_b_4',
      'black_hole_al_4',
      'spread_b_2',
      'plasma_mortar_a_4',
    ])).toEqual(['standard_a_1', 'spread_b_2']);
  });
});
