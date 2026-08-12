import { describe, expect, it } from 'vitest';
import { STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS, getAllNodes } from '../systems/UpgradeTreeData';
import { WeaponType } from '../weapons/WeaponTypes';
import {
  MP_SUPPORTED_UPGRADE_NODE_IDS,
  MP_UPGRADE_NODE_SUPPORT,
  filterMpSupportedUpgradeNodeIds,
  getMpUpgradeNodeSupport,
  getSpreadUpgradePattern,
  getStandardUpgradePattern,
  getUpgradeDamageMultiplier,
  getUpgradeFireRateMultiplier,
  isMpUpgradeNodeSupported,
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

  it('maps the early right-side Blaster baseline to supported tight bolts and faster fire', () => {
    const active = new Set<string>(STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS);

    expect(getStandardUpgradePattern(active)).toMatchObject({
      fanExtraBolts: 0,
      branchBExtraBolts: 3,
      branchBConeAngle: Math.PI / 36,
    });
    expect(getUpgradeFireRateMultiplier(WeaponType.Standard, active)).toBeCloseTo(1.8);
    expect(getUpgradeDamageMultiplier(WeaponType.Standard, active)).toBeCloseTo(1);
    for (const nodeId of STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS) {
      expect(isMpUpgradeNodeSupported(nodeId)).toBe(true);
    }
    expect(isMpUpgradeNodeSupported('standard_b_4')).toBe(false);
  });

  it('defines MP support for every retained tree node and no stale removed nodes', () => {
    const retainedNodeIds = getAllNodes().map(node => node.id).sort();
    const supportNodeIds = Object.keys(MP_UPGRADE_NODE_SUPPORT).sort();

    expect(supportNodeIds).toEqual(retainedNodeIds);
    for (const nodeId of supportNodeIds) {
      expect(getMpUpgradeNodeSupport(nodeId).reason.length).toBeGreaterThan(0);
    }
  });

  it('keeps the proven MP Standard and Spread support subset explicit', () => {
    expect([...MP_SUPPORTED_UPGRADE_NODE_IDS].sort()).toEqual([
      'spread_a_1',
      'spread_a_2',
      'spread_a_3',
      'spread_al_4',
      'spread_al_5',
      'spread_b_1',
      'spread_b_2',
      'standard_a_1',
      'standard_a_2',
      'standard_a_3',
      'standard_a_4',
      'standard_al_5',
      'standard_al_6',
      'standard_b_1',
      'standard_b_2',
      'standard_b_3',
    ]);
    expect(getMpUpgradeNodeSupport('standard_a_1').status).toBe('server_authoritative');
    expect(getMpUpgradeNodeSupport('spread_al_5').status).toBe('server_authoritative');
  });

  it('filters unsupported retained or stale nodes out of MP build-choice offers', () => {
    expect(isMpUpgradeNodeSupported('standard_b_4')).toBe(false);
    expect(getMpUpgradeNodeSupport('standard_b_4').status).toBe('unsupported');
    expect(getMpUpgradeNodeSupport('black_hole_a_1').status).toBe('unsupported');
    expect(getMpUpgradeNodeSupport('standard_al_10').status).toBe('unsupported');

    expect(filterMpSupportedUpgradeNodeIds([
      'standard_a_1',
      'standard_b_4',
      'black_hole_a_1',
      'spread_b_2',
      'standard_al_10',
    ])).toEqual(['standard_a_1', 'spread_b_2']);
  });
});
