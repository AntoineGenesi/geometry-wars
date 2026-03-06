import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

// Mock all pickup classes and their factories (they create THREE geometries/meshes)
vi.mock('../weapons/SuperStatePickup', () => ({ SuperStatePickup: class { mesh = {}; dispose = vi.fn(); } }));
vi.mock('../weapons/WeaponPickup', () => ({
  WeaponPickup: class { mesh = {}; dispose = vi.fn(); },
  getRandomWeaponType: vi.fn(),
}));
vi.mock('../weapons/BuffPickup', () => ({
  BuffPickup: class { mesh = {}; dispose = vi.fn(); },
  getRandomBuffType: vi.fn(),
}));
vi.mock('../buffs/BuffPickupNew', () => ({ BuffPickupNew: class { mesh = {}; dispose = vi.fn(); } }));
vi.mock('../buffs/BuffManager', () => ({
  BuffManager: class {
    static rollBuffDrop(_mult?: number) { return null; }
  },
}));
vi.mock('../entities/Companion', () => ({
  CompanionPickup: class { mesh = {}; dispose = vi.fn(); },
  getRandomCompanionType: vi.fn(),
}));

import { PickupSpawner } from './PickupSpawner';

const BASE = {
  superState: 0.05,
  weapon: 0.08,
  oldBuff: 0.05,
  companion: 0.05,
};

function makeSpawner(): PickupSpawner {
  const scene = { add: vi.fn(), remove: vi.fn() } as unknown as THREE.Scene;
  return new PickupSpawner(scene);
}

describe('PickupSpawner.setDifficultyLevel — drop rate tapering', () => {
  let spawner: PickupSpawner;

  beforeEach(() => {
    spawner = makeSpawner();
  });

  it('level 0: all rates at 100% of base', () => {
    spawner.setDifficultyLevel(0);
    expect(spawner.superStateDropRate).toBeCloseTo(BASE.superState);
    expect(spawner.weaponDropRate).toBeCloseTo(BASE.weapon);
    expect(spawner.oldBuffDropRate).toBeCloseTo(BASE.oldBuff);
    expect(spawner.companionDropRate).toBeCloseTo(BASE.companion);
  });

  it('level 4: all rates still at 100% of base (threshold is inclusive)', () => {
    spawner.setDifficultyLevel(4);
    expect(spawner.superStateDropRate).toBeCloseTo(BASE.superState);
    expect(spawner.weaponDropRate).toBeCloseTo(BASE.weapon);
    expect(spawner.oldBuffDropRate).toBeCloseTo(BASE.oldBuff);
    expect(spawner.companionDropRate).toBeCloseTo(BASE.companion);
  });

  it('level 8: all rates at 50% of base', () => {
    spawner.setDifficultyLevel(8);
    expect(spawner.superStateDropRate).toBeCloseTo(BASE.superState * 0.5);
    expect(spawner.weaponDropRate).toBeCloseTo(BASE.weapon * 0.5);
    expect(spawner.oldBuffDropRate).toBeCloseTo(BASE.oldBuff * 0.5);
    expect(spawner.companionDropRate).toBeCloseTo(BASE.companion * 0.5);
  });

  it('level 12: all rates at 25% of base', () => {
    spawner.setDifficultyLevel(12);
    expect(spawner.superStateDropRate).toBeCloseTo(BASE.superState * 0.25);
    expect(spawner.weaponDropRate).toBeCloseTo(BASE.weapon * 0.25);
    expect(spawner.oldBuffDropRate).toBeCloseTo(BASE.oldBuff * 0.25);
    expect(spawner.companionDropRate).toBeCloseTo(BASE.companion * 0.25);
  });

  it('level 20: all rates at 20% of base (floor)', () => {
    spawner.setDifficultyLevel(20);
    expect(spawner.superStateDropRate).toBeCloseTo(BASE.superState * 0.20);
    expect(spawner.weaponDropRate).toBeCloseTo(BASE.weapon * 0.20);
    expect(spawner.oldBuffDropRate).toBeCloseTo(BASE.oldBuff * 0.20);
    expect(spawner.companionDropRate).toBeCloseTo(BASE.companion * 0.20);
  });

  it('level 100: floor holds at 20% (never goes below)', () => {
    spawner.setDifficultyLevel(100);
    expect(spawner.superStateDropRate).toBeCloseTo(BASE.superState * 0.20);
    expect(spawner.weaponDropRate).toBeCloseTo(BASE.weapon * 0.20);
  });

  it('rates taper linearly between level 4 and 8', () => {
    spawner.setDifficultyLevel(6); // midpoint → multiplier = 0.75
    expect(spawner.weaponDropRate).toBeCloseTo(BASE.weapon * 0.75);
  });

  it('rates taper linearly between level 8 and 12', () => {
    spawner.setDifficultyLevel(10); // midpoint → multiplier = 0.375
    expect(spawner.weaponDropRate).toBeCloseTo(BASE.weapon * 0.375);
  });

  it('rates start at base values without calling setDifficultyLevel', () => {
    // Rates should be at full base out of the box
    expect(spawner.superStateDropRate).toBeCloseTo(BASE.superState);
    expect(spawner.weaponDropRate).toBeCloseTo(BASE.weapon);
  });

  it('calling setDifficultyLevel multiple times converges to correct value', () => {
    spawner.setDifficultyLevel(8);
    spawner.setDifficultyLevel(0);
    // Back to full rates
    expect(spawner.weaponDropRate).toBeCloseTo(BASE.weapon);
  });
});
