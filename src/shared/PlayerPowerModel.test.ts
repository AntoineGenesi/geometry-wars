import { describe, expect, it } from 'vitest';
import {
  BASELINE_BLASTER_DPS,
  computePlayerPower,
  type PlayerPowerInput,
} from './PlayerPowerModel';

const baseline: PlayerPowerInput = {
  blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 2 },
};

function expectMonotonic(field: keyof PlayerPowerInput, low: unknown, high: unknown): void {
  const lowPower = computePlayerPower({ ...baseline, [field]: low });
  const highPower = computePlayerPower({ ...baseline, [field]: high });
  expect(highPower.difficultyBonus).toBeGreaterThan(lowPower.difficultyBonus);
}

describe('computePlayerPower', () => {
  it('keeps zero and undefined capability at baseline', () => {
    expect(computePlayerPower()).toEqual({
      scorePressure: 0,
      survivalPressure: 0,
      streakPressure: 0,
      blasterDps: 0,
      activeWeaponDps: 0,
      guardianDps: 0,
      hunterDps: 0,
      companionDps: 0,
      protectorValue: 0,
      offenseRatio: 0,
      powerScore: 0,
      difficultyBonus: 0,
      hpMultiplier: 1,
    });
    expect(computePlayerPower({ score: 0, survivalSeconds: 0, streak: 0 }).difficultyBonus).toBe(0);
  });

  it('uses the real dual-blaster baseline', () => {
    const result = computePlayerPower(baseline);
    expect(result.blasterDps).toBe(BASELINE_BLASTER_DPS);
    expect(result.offenseRatio).toBe(1);
    expect(result.difficultyBonus).toBe(0);
  });

  it('is monotonic for score, survival, streak, blaster, active weapon, and shooting drones', () => {
    expectMonotonic('score', 10_000, 1_000_000);
    expectMonotonic('survivalSeconds', 10, 500);
    expectMonotonic('streak', 1, 200);

    const weakBlaster = computePlayerPower({ blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 2 } });
    const strongBlaster = computePlayerPower({ blaster: { damage: 2, shotsPerSecond: 9, projectilesPerShot: 4 } });
    expect(strongBlaster.difficultyBonus).toBeGreaterThan(weakBlaster.difficultyBonus);

    const weakWeapon = computePlayerPower({ ...baseline, activeWeapon: { damage: 1, shotsPerSecond: 1 } });
    const strongWeapon = computePlayerPower({ ...baseline, activeWeapon: { damage: 8, shotsPerSecond: 3, multiHitPotential: 2 } });
    expect(strongWeapon.difficultyBonus).toBeGreaterThan(weakWeapon.difficultyBonus);

    const noDrones = computePlayerPower(baseline);
    const drones = computePlayerPower({ ...baseline, companions: { guardian: 2, hunter: 2 } });
    expect(drones.difficultyBonus).toBeGreaterThan(noDrones.difficultyBonus);
  });

  it('counts Protector only as bounded defensive value', () => {
    const result = computePlayerPower({ ...baseline, companions: { protector: 4 } });
    expect(result.companionDps).toBe(0);
    expect(result.guardianDps).toBe(0);
    expect(result.hunterDps).toBe(0);
    expect(result.protectorValue).toBeGreaterThan(0);
  });

  it('gives the reported high-power case decisive bounded pressure', () => {
    const highPower = computePlayerPower({
      score: 1_000_000,
      survivalSeconds: 600,
      streak: 250,
      blaster: { damage: 2, shotsPerSecond: 9, projectilesPerShot: 4 },
      companions: { guardian: 2, hunter: 2 },
    });
    const sameWaveBaseline = computePlayerPower(baseline);

    expect(highPower.difficultyBonus).toBeGreaterThanOrEqual(3);
    expect(highPower.difficultyBonus - sameWaveBaseline.difficultyBonus).toBeGreaterThanOrEqual(2);
    expect(highPower.difficultyBonus).toBeLessThanOrEqual(5);
  });

  it('produces equivalent output from equivalent SP and MP snapshots', () => {
    const spSnapshot: PlayerPowerInput = {
      score: 250_000,
      survivalSeconds: 180,
      streak: 75,
      blaster: { damage: 1.4, shotsPerSecond: 7.8, projectilesPerShot: 3 },
      activeWeapon: { damage: 4, shotsPerSecond: 3, multiHitPotential: 2 },
      companions: { guardian: 1, hunter: 2, protector: 1 },
    };
    const mpSnapshot = structuredClone(spSnapshot);
    expect(computePlayerPower(mpSnapshot)).toEqual(computePlayerPower(spSnapshot));
  });
});
