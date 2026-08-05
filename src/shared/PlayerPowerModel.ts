export interface WeaponPowerInput {
  damage?: number;
  shotsPerSecond?: number;
  projectilesPerShot?: number;
  multiHitPotential?: number;
}

export interface CompanionPowerInput {
  guardian?: number;
  hunter?: number;
  protector?: number;
  guardianDamage?: number;
  hunterDamage?: number;
  guardianShotsPerSecond?: number;
  hunterShotsPerSecond?: number;
}

export interface PlayerPowerInput {
  /** Display/current score. Historically this may include combo and geom multipliers. */
  score?: number;
  /** Kill score before combo and score multipliers. Preferred DDA score basis. */
  rawScore?: number;
  /** Score after combo/score multipliers. Defaults to `score` for legacy callers. */
  multipliedScore?: number;
  survivalSeconds?: number;
  streak?: number;
  /** Raw kill count. Used as a stable dominance signal when score multipliers spike. */
  totalKills?: number;
  blaster?: WeaponPowerInput;
  activeWeapon?: WeaponPowerInput;
  companions?: CompanionPowerInput;
}

export interface PlayerPowerBreakdown {
  rawScore: number;
  multipliedScore: number;
  effectiveScore: number;
  scorePressure: number;
  multiplierScorePressure: number;
  survivalPressure: number;
  streakPressure: number;
  killPressure: number;
  blasterDps: number;
  activeWeaponDps: number;
  guardianDps: number;
  hunterDps: number;
  companionDps: number;
  protectorValue: number;
  offenseRatio: number;
  powerScore: number;
  difficultyBonus: number;
  hpMultiplier: number;
}

export interface PlayerPowerRuntimeState {
  input: PlayerPowerInput;
  breakdown: PlayerPowerBreakdown;
  /** Test-only acceleration for deterministic long-run browser proof. */
  proofOverride?: Pick<PlayerPowerInput, 'survivalSeconds' | 'streak'>;
}

export const BASELINE_BLASTER_DPS = 6;
export const GUARDIAN_SHOTS_PER_SECOND = 3;
export const HUNTER_SHOTS_PER_SECOND = 1.5;
export const MP_COMPANION_DAMAGE_PER_HIT = 1;
export const MAX_POWER_DIFFICULTY_BONUS = 5;
export const HP_SCALING_DIFFICULTY_THRESHOLD = 0.25;

const MAX_SCORE = 5_000_000;
const MAX_SURVIVAL_SECONDS = 600;
const MAX_STREAK = 250;
const MAX_KILLS = 800;
const MAX_COMPANIONS_PER_TYPE = 4;

function finiteNonNegative(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function weaponDps(input: WeaponPowerInput | undefined): number {
  if (!input) return 0;
  const damage = finiteNonNegative(input.damage);
  const rate = finiteNonNegative(input.shotsPerSecond);
  const projectiles = clamp(finiteNonNegative(input.projectilesPerShot) || 1, 1, 12);
  const multiHit = clamp(finiteNonNegative(input.multiHitPotential) || 1, 1, 4);
  return damage * rate * projectiles * multiHit;
}

function computeCompanionDps(count: number, damage: number | undefined, shotsPerSecond: number | undefined): number {
  const shotDamage = finiteNonNegative(damage ?? MP_COMPANION_DAMAGE_PER_HIT);
  const rate = finiteNonNegative(shotsPerSecond);
  return count * shotDamage * rate;
}

/**
 * Pure, bounded estimate of the pressure a player's current capability should
 * add. Runtime collectors own authority and validation; this function treats
 * absent data as a baseline player and never consumes assistance state.
 */
export function computePlayerPower(input: PlayerPowerInput = {}): PlayerPowerBreakdown {
  const fallbackScore = finiteNonNegative(input.score);
  const rawScore = Math.min(MAX_SCORE, finiteNonNegative(input.rawScore ?? fallbackScore));
  const multipliedScore = Math.min(MAX_SCORE, finiteNonNegative(input.multipliedScore ?? fallbackScore));
  const multiplierExcess = Math.max(0, multipliedScore - rawScore);
  const dampenedMultiplierScore = Math.min(multiplierExcess, Math.max(10_000, rawScore * 0.25));
  const effectiveScore = Math.min(MAX_SCORE, rawScore + dampenedMultiplierScore);
  const survivalSeconds = Math.min(MAX_SURVIVAL_SECONDS, finiteNonNegative(input.survivalSeconds));
  const streak = Math.min(MAX_STREAK, finiteNonNegative(input.streak));
  const totalKills = Math.min(MAX_KILLS, finiteNonNegative(input.totalKills));

  const scorePressure = effectiveScore <= 5_000
    ? 0
    : 1.5 * Math.log10(1 + (effectiveScore - 5_000) / 25_000)
      / Math.log10(1 + (MAX_SCORE - 5_000) / 25_000);
  const rawScorePressure = rawScore <= 5_000
    ? 0
    : 1.5 * Math.log10(1 + (rawScore - 5_000) / 25_000)
      / Math.log10(1 + (MAX_SCORE - 5_000) / 25_000);
  const multiplierScorePressure = Math.max(0, scorePressure - rawScorePressure);
  const survivalPressure = survivalSeconds / MAX_SURVIVAL_SECONDS;
  const streakPressure = streak / MAX_STREAK;
  const killPressure = Math.min(1, totalKills / MAX_KILLS);

  const blasterDps = weaponDps(input.blaster);
  const activeWeaponDps = weaponDps(input.activeWeapon);
  const guardianCount = Math.min(MAX_COMPANIONS_PER_TYPE, finiteNonNegative(input.companions?.guardian));
  const hunterCount = Math.min(MAX_COMPANIONS_PER_TYPE, finiteNonNegative(input.companions?.hunter));
  const protectorCount = Math.min(MAX_COMPANIONS_PER_TYPE, finiteNonNegative(input.companions?.protector));
  const guardianDps = computeCompanionDps(
    guardianCount,
    input.companions?.guardianDamage,
    input.companions?.guardianShotsPerSecond ?? GUARDIAN_SHOTS_PER_SECOND,
  );
  const hunterDps = computeCompanionDps(
    hunterCount,
    input.companions?.hunterDamage,
    input.companions?.hunterShotsPerSecond ?? HUNTER_SHOTS_PER_SECOND,
  );
  const companionDps = guardianDps + hunterDps;
  const protectorValue = 0.15 * protectorCount;

  const totalOffenseDps = blasterDps + activeWeaponDps + companionDps;
  const offenseRatio = totalOffenseDps / BASELINE_BLASTER_DPS;
  const offensePressure = clamp(Math.log2(Math.max(1, offenseRatio)) * 1.35, 0, 3.5);
  const powerScore = scorePressure + survivalPressure + streakPressure + killPressure + offensePressure + protectorValue;
  const difficultyBonus = clamp(powerScore, 0, MAX_POWER_DIFFICULTY_BONUS);
  const hpMultiplier = difficultyBonus >= HP_SCALING_DIFFICULTY_THRESHOLD
    ? 1 + difficultyBonus * 0.25
    : 1;

  return {
    rawScore,
    multipliedScore,
    effectiveScore,
    scorePressure,
    multiplierScorePressure,
    survivalPressure,
    streakPressure,
    killPressure,
    blasterDps,
    activeWeaponDps,
    guardianDps,
    hunterDps,
    companionDps,
    protectorValue,
    offenseRatio,
    powerScore,
    difficultyBonus,
    hpMultiplier,
  };
}
