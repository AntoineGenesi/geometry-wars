// server/shared/GameSettings.ts
// Typed data model for all host-configurable game settings.
// Used server-side only — SP (main.ts → GameLoop.ts) must NOT import this file.
// Validation ensures all values are within safe ranges before applying to a room.

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

export type GameMode =
  | 'waves'
  | 'king'
  | 'sniper'
  | 'rainbow'
  | 'claustrophobia'
  | 'pvp'
  | 'pvpve';

/** Surface types supported by the server. Matches SurfaceFactory.SurfaceType minus 'custom'. */
export type GameSurface =
  | 'sphere'
  | 'cube'
  | 'pill'
  | 'pipe'
  | 'torus'
  | 'peanut'
  | 'capsule'
  | 'icosahedron'
  | 'mobius'
  | 'sphere-tunnel'
  | 'cube-ring'
  | 'cube-tunnel'
  | 'mobius-bevel';

export type PvpWinCondition = 'kills' | 'survival' | 'score';

/**
 * How enemy spawn rate adjusts as players are eliminated (PvPvE mode).
 * - low:    spawn rate decreases (-20% per eliminated player) — game gets easier
 * - medium: no adjustment (default)
 * - high:   spawn rate increases (+30% per eliminated player) — game gets harder
 */
export type EnemyDifficultyPerPlayer = 'low' | 'medium' | 'high';

export type HealthBarVisibility = 'all' | 'friendly' | 'enemy' | 'none';

export type VisualQuality = 'low' | 'medium' | 'high' | 'auto';

export type StartingWeapon =
  | 'standard'
  | 'spread'
  | 'piercing'
  | 'homing'
  | 'chain_lightning'
  | 'plasma_mortar'
  | 'gravity_gun'
  | 'laser_beam'
  | 'black_hole'
  | 'tesla_coil';

// ---------------------------------------------------------------------------
// GameSettings interface
// ---------------------------------------------------------------------------

export interface GameSettings {
  /** Game mode. Default: 'waves'. */
  mode: GameMode;

  /** Surface to play on. Default: 'sphere'. */
  surface: GameSurface;

  /** Number of player lives (1–9). Ignored when infiniteLives is true. Default: 3. */
  lives: number;

  /** Whether players have infinite lives. Default: false. */
  infiniteLives: boolean;

  /**
   * Global difficulty multiplier applied to enemy spawn rates and AI aggressiveness.
   * Range: 0.5–2.0. Default: 1.0.
   */
  difficultyMultiplier: number;

  /**
   * Multiplier on enemy spawn rate (higher = more enemies, faster).
   * Range: 0.25–3.0. Default: 1.0.
   */
  enemySpawnRateMultiplier: number;

  /**
   * How often boss enemies appear relative to normal waves.
   * 0.0 = never, 1.0 = maximum frequency. Default: 0.5.
   */
  bossFrequency: number;

  /** Whether PvP damage between players is enabled. Default: false. */
  pvpEnabled: boolean;

  /**
   * Win condition for PvP modes ('pvp' | 'pvpve').
   * Stripped (set to default) for non-PvP modes by validateSettings().
   * Default: 'kills'.
   */
  pvpWinCondition: PvpWinCondition;

  /**
   * How often passive healing orbs spawn, in seconds.
   * Range: 5–120. Default: 30.
   */
  healingFrequency: number;

  /**
   * HP restored per healing pickup.
   * Range: 5–100. Default: 25.
   */
  healingAmount: number;

  /** Which health bars are visible in-game. Default: 'all'. */
  healthBarVisibility: HealthBarVisibility;

  /**
   * Whether player bullets can damage teammates.
   * Only meaningful when pvpEnabled is true. Default: false.
   */
  friendlyFire: boolean;

  /**
   * Multiplier on weapon pickup spawn rate.
   * Range: 0.1–3.0. Default: 1.0.
   */
  weaponSpawnFrequency: number;

  /**
   * Multiplier on buff pickup spawn rate.
   * Range: 0.1–3.0. Default: 1.0.
   */
  buffSpawnFrequency: number;

  /** Weapon all players start with. Default: 'standard'. */
  startingWeapon: StartingWeapon;

  /**
   * Match time limit in seconds. 0 = unlimited.
   * Range: 0, or 60–3600. Default: 0.
   */
  timeLimit: number;

  /**
   * Maximum simultaneous enemies allowed on-surface.
   * Range: 10–100. Default: 50.
   */
  enemyCountCap: number;

  /**
   * Maximum simultaneous bullets allowed in the world.
   * Range: 50–1000. Default: 500.
   */
  bulletCountCap: number;

  /** Rendering quality preset. Default: 'auto'. */
  visualQuality: VisualQuality;

  /**
   * How enemy spawn rate adjusts as players are eliminated (PvPvE).
   * - low:    -20% spawn rate per eliminated player (game gets easier)
   * - medium: no adjustment (default)
   * - high:   +30% spawn rate per eliminated player (game gets harder)
   */
  enemyDifficultyPerPlayer: EnemyDifficultyPerPlayer;
}

// ---------------------------------------------------------------------------
// Valid value sets (used by validation)
// ---------------------------------------------------------------------------

export const VALID_MODES: readonly GameMode[] = [
  'waves', 'king', 'sniper', 'rainbow', 'claustrophobia', 'pvp', 'pvpve',
] as const;

export const VALID_SURFACES: readonly GameSurface[] = [
  'sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut', 'capsule',
  'icosahedron', 'mobius', 'sphere-tunnel', 'cube-ring', 'cube-tunnel', 'mobius-bevel',
] as const;

export const VALID_STARTING_WEAPONS: readonly StartingWeapon[] = [
  'standard', 'spread', 'piercing', 'homing', 'chain_lightning',
  'plasma_mortar', 'gravity_gun', 'laser_beam', 'black_hole', 'tesla_coil',
] as const;

export const PVP_MODES: readonly GameMode[] = ['pvp', 'pvpve'] as const;

// ---------------------------------------------------------------------------
// Default settings ("vanilla" state)
// ---------------------------------------------------------------------------

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = {
  mode:                    'waves',
  surface:                 'sphere',
  lives:                   3,
  infiniteLives:           false,
  difficultyMultiplier:    1.0,
  enemySpawnRateMultiplier: 1.0,
  bossFrequency:           0.5,
  pvpEnabled:              false,
  pvpWinCondition:         'kills',
  healingFrequency:        30,
  healingAmount:           25,
  healthBarVisibility:     'all',
  friendlyFire:            true,
  weaponSpawnFrequency:    1.0,
  buffSpawnFrequency:      1.0,
  startingWeapon:          'standard',
  timeLimit:               0,
  enemyCountCap:           50,
  bulletCountCap:          500,
  visualQuality:           'auto',
  enemyDifficultyPerPlayer: 'medium',
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Clamp a number to [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Return true if value is a finite number. */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value);
}

/**
 * Validate and normalise a partial settings object into a full GameSettings.
 *
 * Rules:
 * - Numeric fields are clamped to their documented ranges.
 * - Invalid mode/surface strings fall back to the default.
 * - PvP-specific settings (pvpEnabled, pvpWinCondition, friendlyFire) are reset
 *   to defaults when mode is not 'pvp' or 'pvpve'.
 * - Unknown keys are ignored (result contains only known fields).
 *
 * @throws never — this function always returns a valid GameSettings.
 */
export function validateSettings(partial: Partial<GameSettings> = {}): GameSettings {
  // Mode — reject unknown values
  const mode: GameMode = (VALID_MODES as readonly string[]).includes(partial.mode as string)
    ? (partial.mode as GameMode)
    : DEFAULT_GAME_SETTINGS.mode;

  // Surface — reject unknown values
  const surface: GameSurface = (VALID_SURFACES as readonly string[]).includes(partial.surface as string)
    ? (partial.surface as GameSurface)
    : DEFAULT_GAME_SETTINGS.surface;

  // Numeric clamps
  const lives = isFiniteNumber(partial.lives)
    ? clamp(Math.round(partial.lives), 1, 9)
    : DEFAULT_GAME_SETTINGS.lives;

  const difficultyMultiplier = isFiniteNumber(partial.difficultyMultiplier)
    ? clamp(partial.difficultyMultiplier, 0.5, 2.0)
    : DEFAULT_GAME_SETTINGS.difficultyMultiplier;

  const enemySpawnRateMultiplier = isFiniteNumber(partial.enemySpawnRateMultiplier)
    ? clamp(partial.enemySpawnRateMultiplier, 0.25, 3.0)
    : DEFAULT_GAME_SETTINGS.enemySpawnRateMultiplier;

  const bossFrequency = isFiniteNumber(partial.bossFrequency)
    ? clamp(partial.bossFrequency, 0.0, 1.0)
    : DEFAULT_GAME_SETTINGS.bossFrequency;

  const healingFrequency = isFiniteNumber(partial.healingFrequency)
    ? clamp(Math.round(partial.healingFrequency), 5, 120)
    : DEFAULT_GAME_SETTINGS.healingFrequency;

  const healingAmount = isFiniteNumber(partial.healingAmount)
    ? clamp(Math.round(partial.healingAmount), 5, 100)
    : DEFAULT_GAME_SETTINGS.healingAmount;

  const weaponSpawnFrequency = isFiniteNumber(partial.weaponSpawnFrequency)
    ? clamp(partial.weaponSpawnFrequency, 0.1, 3.0)
    : DEFAULT_GAME_SETTINGS.weaponSpawnFrequency;

  const buffSpawnFrequency = isFiniteNumber(partial.buffSpawnFrequency)
    ? clamp(partial.buffSpawnFrequency, 0.1, 3.0)
    : DEFAULT_GAME_SETTINGS.buffSpawnFrequency;

  // timeLimit: 0 = unlimited, or clamped to 60–3600 seconds
  let timeLimit = DEFAULT_GAME_SETTINGS.timeLimit;
  if (isFiniteNumber(partial.timeLimit)) {
    if (partial.timeLimit === 0) {
      timeLimit = 0;
    } else {
      timeLimit = clamp(Math.round(partial.timeLimit), 60, 3600);
    }
  }

  const enemyCountCap = isFiniteNumber(partial.enemyCountCap)
    ? clamp(Math.round(partial.enemyCountCap), 10, 100)
    : DEFAULT_GAME_SETTINGS.enemyCountCap;

  const bulletCountCap = isFiniteNumber(partial.bulletCountCap)
    ? clamp(Math.round(partial.bulletCountCap), 50, 1000)
    : DEFAULT_GAME_SETTINGS.bulletCountCap;

  // Boolean fields
  const infiniteLives = typeof partial.infiniteLives === 'boolean'
    ? partial.infiniteLives
    : DEFAULT_GAME_SETTINGS.infiniteLives;

  // healthBarVisibility
  const validVisibility: readonly HealthBarVisibility[] = ['all', 'friendly', 'enemy', 'none'];
  const healthBarVisibility: HealthBarVisibility = validVisibility.includes(partial.healthBarVisibility as HealthBarVisibility)
    ? (partial.healthBarVisibility as HealthBarVisibility)
    : DEFAULT_GAME_SETTINGS.healthBarVisibility;

  // startingWeapon
  const startingWeapon: StartingWeapon = (VALID_STARTING_WEAPONS as readonly string[]).includes(partial.startingWeapon as string)
    ? (partial.startingWeapon as StartingWeapon)
    : DEFAULT_GAME_SETTINGS.startingWeapon;

  // visualQuality
  const validQualities: readonly VisualQuality[] = ['low', 'medium', 'high', 'auto'];
  const visualQuality: VisualQuality = validQualities.includes(partial.visualQuality as VisualQuality)
    ? (partial.visualQuality as VisualQuality)
    : DEFAULT_GAME_SETTINGS.visualQuality;

  // enemyDifficultyPerPlayer
  const validDifficultyPerPlayer: readonly EnemyDifficultyPerPlayer[] = ['low', 'medium', 'high'];
  const enemyDifficultyPerPlayer: EnemyDifficultyPerPlayer = validDifficultyPerPlayer.includes(partial.enemyDifficultyPerPlayer as EnemyDifficultyPerPlayer)
    ? (partial.enemyDifficultyPerPlayer as EnemyDifficultyPerPlayer)
    : DEFAULT_GAME_SETTINGS.enemyDifficultyPerPlayer;

  // PvP settings — strip if mode is not a PvP mode
  const isPvpMode = (PVP_MODES as readonly string[]).includes(mode);

  const pvpEnabled = isPvpMode
    ? (typeof partial.pvpEnabled === 'boolean' ? partial.pvpEnabled : true) // auto-enable pvpEnabled for pvp/pvpve modes
    : false;

  const validWinConditions: readonly PvpWinCondition[] = ['kills', 'survival', 'score'];
  const pvpWinCondition: PvpWinCondition = isPvpMode
    ? (validWinConditions.includes(partial.pvpWinCondition as PvpWinCondition)
        ? (partial.pvpWinCondition as PvpWinCondition)
        : DEFAULT_GAME_SETTINGS.pvpWinCondition)
    : DEFAULT_GAME_SETTINGS.pvpWinCondition;

  // s44k-07: PvP and PvPvE modes default to friendlyFire=true so players can damage each other.
  // The cooperative-by-default PvPvE behaviour (s44j-pvpve-14e friendlyFire=false) turned out
  // to be confusing — users expect to shoot each other in both PvP modes.
  const friendlyFire = isPvpMode
    ? (typeof partial.friendlyFire === 'boolean' ? partial.friendlyFire : true)
    : false;

  return {
    mode,
    surface,
    lives,
    infiniteLives,
    difficultyMultiplier,
    enemySpawnRateMultiplier,
    bossFrequency,
    pvpEnabled,
    pvpWinCondition,
    healingFrequency,
    healingAmount,
    healthBarVisibility,
    friendlyFire,
    weaponSpawnFrequency,
    buffSpawnFrequency,
    startingWeapon,
    timeLimit,
    enemyCountCap,
    bulletCountCap,
    visualQuality,
    enemyDifficultyPerPlayer,
  };
}
