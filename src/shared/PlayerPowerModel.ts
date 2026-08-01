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
}

export interface PlayerPowerInput {
  score?: number;
  survivalSeconds?: number;
  streak?: number;
  blaster?: WeaponPowerInput;
  activeWeapon?: WeaponPowerInput;
  companions?: CompanionPowerInput;
}

export interface PlayerPowerBreakdown {
  scorePressure: number;
  survivalPressure: number;
  streakPressure: number;
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

export const BASELINE_BLASTER_DPS = 12;
export const GUARDIAN_DPS = 3;
export const HUNTER_DPS = 3;
export const MAX_POWER_DIFFICULTY_BONUS = 5;

const MAX_SCORE = 5_000_000;
const MAX_SURVIVAL_SECONDS = 600;
const MAX_STREAK = 250;
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

/**
 * Pure, bounded estimate of the pressure a player's current capability should
 * add. Runtime collectors own authority and validation; this function treats
 * absent data as a baseline player and never consumes assistance state.
 */
export function computePlayerPower(input: PlayerPowerInput = {}): PlayerPowerBreakdown {
  const score = Math.min(MAX_SCORE, finiteNonNegative(input.score));
  const survivalSeconds = Math.min(MAX_SURVIVAL_SECONDS, finiteNonNegative(input.survivalSeconds));
  const streak = Math.min(MAX_STREAK, finiteNonNegative(input.streak));

  const scorePressure = score <= 5_000
    ? 0
    : 1.5 * Math.log10(1 + (score - 5_000) / 25_000)
      / Math.log10(1 + (MAX_SCORE - 5_000) / 25_000);
  const survivalPressure = survivalSeconds / MAX_SURVIVAL_SECONDS;
  const streakPressure = streak / MAX_STREAK;

  const blasterDps = weaponDps(input.blaster);
  const activeWeaponDps = weaponDps(input.activeWeapon);
  const guardianCount = Math.min(MAX_COMPANIONS_PER_TYPE, finiteNonNegative(input.companions?.guardian));
  const hunterCount = Math.min(MAX_COMPANIONS_PER_TYPE, finiteNonNegative(input.companions?.hunter));
  const protectorCount = Math.min(MAX_COMPANIONS_PER_TYPE, finiteNonNegative(input.companions?.protector));
  const guardianDps = guardianCount * GUARDIAN_DPS;
  const hunterDps = hunterCount * HUNTER_DPS;
  const companionDps = guardianDps + hunterDps;
  const protectorValue = 0.15 * protectorCount;

  const totalOffenseDps = blasterDps + activeWeaponDps + companionDps;
  const offenseRatio = totalOffenseDps / BASELINE_BLASTER_DPS;
  const offensePressure = clamp(Math.log2(Math.max(1, offenseRatio)) * 1.35, 0, 3.5);
  const powerScore = scorePressure + survivalPressure + streakPressure + offensePressure + protectorValue;
  const difficultyBonus = clamp(powerScore, 0, MAX_POWER_DIFFICULTY_BONUS);

  return {
    scorePressure,
    survivalPressure,
    streakPressure,
    blasterDps,
    activeWeaponDps,
    guardianDps,
    hunterDps,
    companionDps,
    protectorValue,
    offenseRatio,
    powerScore,
    difficultyBonus,
    hpMultiplier: 1 + difficultyBonus * 0.25,
  };
}
