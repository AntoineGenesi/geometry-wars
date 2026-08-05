import { describe, expect, it } from 'vitest';
import {
  BASELINE_BLASTER_DPS,
  computePlayerPower,
  GUARDIAN_SHOTS_PER_SECOND,
  HUNTER_SHOTS_PER_SECOND,
  MP_COMPANION_DAMAGE_PER_HIT,
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
      rawScore: 0,
      multipliedScore: 0,
      effectiveScore: 0,
      scorePressure: 0,
      multiplierScorePressure: 0,
      survivalPressure: 0,
      streakPressure: 0,
      killPressure: 0,
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

  it('dampens a 770K multiplied-score spike when raw combat score is low', () => {
    const rawRun = computePlayerPower({
      rawScore: 40_000,
      multipliedScore: 770_000,
      survivalSeconds: 180,
      streak: 120,
      totalKills: 80,
      blaster: { damage: 1.2, shotsPerSecond: 7, projectilesPerShot: 2 },
    });
    const inflatedRun = computePlayerPower({
      rawScore: 770_000,
      multipliedScore: 770_000,
      survivalSeconds: 180,
      streak: 120,
      totalKills: 80,
      blaster: { damage: 1.2, shotsPerSecond: 7, projectilesPerShot: 2 },
    });

    expect(rawRun.effectiveScore).toBeLessThan(100_000);
    expect(rawRun.multiplierScorePressure).toBeLessThan(0.15);
    expect(rawRun.difficultyBonus).toBeLessThan(inflatedRun.difficultyBonus - 0.4);
  });

  it('still recognizes strong play from kills, survival, and weapon output when score is dampened', () => {
    const strongCombat = computePlayerPower({
      rawScore: 60_000,
      multipliedScore: 770_000,
      survivalSeconds: 600,
      streak: 250,
      totalKills: 300,
      blaster: { damage: 2, shotsPerSecond: 9, projectilesPerShot: 4 },
      companions: { guardian: 2, hunter: 2 },
    });

    expect(strongCombat.rawScore).toBe(60_000);
    expect(strongCombat.effectiveScore).toBeLessThan(100_000);
    expect(strongCombat.killPressure).toBeGreaterThan(0.3);
    expect(strongCombat.difficultyBonus).toBeGreaterThanOrEqual(3);
  });

  it('counts Protector only as bounded defensive value', () => {
    const result = computePlayerPower({ ...baseline, companions: { protector: 4 } });
    expect(result.companionDps).toBe(0);
    expect(result.guardianDps).toBe(0);
    expect(result.hunterDps).toBe(0);
    expect(result.protectorValue).toBeGreaterThan(0);
  });

  it('defaults Guardian and Hunter output to the MP authoritative companion-hit formula', () => {
    const result = computePlayerPower({
      ...baseline,
      companions: { guardian: 4, hunter: 4 },
    });

    expect(result.guardianDps).toBe(4 * MP_COMPANION_DAMAGE_PER_HIT * GUARDIAN_SHOTS_PER_SECOND);
    expect(result.hunterDps).toBe(4 * MP_COMPANION_DAMAGE_PER_HIT * HUNTER_SHOTS_PER_SECOND);
  });

  it('allows SP collectors to feed live blaster bullet damage into companion output', () => {
    const liveBulletDamage = 2.2;
    const result = computePlayerPower({
      ...baseline,
      companions: {
        guardian: 2,
        hunter: 2,
        guardianDamage: liveBulletDamage,
        hunterDamage: liveBulletDamage,
        guardianShotsPerSecond: GUARDIAN_SHOTS_PER_SECOND,
        hunterShotsPerSecond: HUNTER_SHOTS_PER_SECOND,
      },
    });

    expect(result.guardianDps).toBeCloseTo(2 * liveBulletDamage * GUARDIAN_SHOTS_PER_SECOND);
    expect(result.hunterDps).toBeCloseTo(2 * liveBulletDamage * HUNTER_SHOTS_PER_SECOND);
  });

  it('gives the reported high-power case decisive bounded pressure', () => {
    const highPower = computePlayerPower({
      score: 1_000_000,
      rawScore: 1_000_000,
      multipliedScore: 1_000_000,
      totalKills: 250,
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
      rawScore: 250_000,
      multipliedScore: 250_000,
      totalKills: 75,
      survivalSeconds: 180,
      streak: 75,
      blaster: { damage: 1.4, shotsPerSecond: 7.8, projectilesPerShot: 3 },
      activeWeapon: { damage: 4, shotsPerSecond: 3, multiHitPotential: 2 },
      companions: { guardian: 1, hunter: 2, protector: 1 },
    };
    const mpSnapshot = structuredClone(spSnapshot);
    expect(computePlayerPower(mpSnapshot)).toEqual(computePlayerPower(spSnapshot));
  });

  it('does not emit an HP multiplier for near-neutral survival-only pressure', () => {
    const result = computePlayerPower({
      score: 1_000,
      survivalSeconds: 5,
      streak: 0,
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 2 },
    });

    expect(result.difficultyBonus).toBeGreaterThan(0);
    expect(result.difficultyBonus).toBeLessThan(0.05);
    expect(result.hpMultiplier).toBe(1);
  });
});
