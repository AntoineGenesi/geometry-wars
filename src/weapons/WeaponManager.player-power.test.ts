import { describe, expect, it, vi } from 'vitest';
import { WeaponManager } from './WeaponManager';
import { WeaponType } from './WeaponTypes';

const canvasContext = {
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  fillRect: vi.fn(),
};

vi.stubGlobal('document', {
  createElement: vi.fn(() => ({
    width: 64,
    height: 64,
    getContext: vi.fn(() => canvasContext),
  })),
});

describe('WeaponManager player-power collector', () => {
  it('reports the live dual-barrel baseline as 12 DPS', () => {
    const manager = new WeaponManager();
    const snapshot = manager.getPlayerPowerWeapons(1);
    expect(snapshot.blaster).toEqual({
      damage: 1,
      shotsPerSecond: 6,
      projectilesPerShot: 2,
      multiHitPotential: 1,
    });
    manager.dispose();
  });

  it('uses active fan and fire-rate nodes from the live upgrade tracker', () => {
    const manager = new WeaponManager();
    const standardNodes = new Set([
      'standard_a_1', 'standard_a_2', 'standard_a_3',
      'standard_b_1', 'standard_b_2', 'standard_b_3',
    ]);
    manager.setUpgradeTracker({
      getActiveUpgrades: (type: WeaponType) => type === WeaponType.Standard ? standardNodes : new Set(),
    } as any);

    const snapshot = manager.getPlayerPowerWeapons(2.2);
    expect(snapshot.blaster.damage).toBeCloseTo(2.2);
    expect(snapshot.blaster.shotsPerSecond).toBeCloseTo(11.7);
    expect(snapshot.blaster.projectilesPerShot).toBe(8);
    manager.dispose();
  });
});
