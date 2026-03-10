// server/shared/GameConstants.ts
// Re-exports from the shared constants file (src/shared/GameBalanceConstants.ts).
// Previously, all values were manually duplicated here with "must match SP" comments.
// Now both server and client import from the same source — no more manual sync.
//
// Server-specific re-exports and aliases are defined here. The shared file has the values.

// ---------------------------------------------------------------------------
// Re-export everything from shared constants
// ---------------------------------------------------------------------------
export {
  // Weapon configs (server uses SERVER_WEAPON_CONFIGS with damageMultiplier)
  SERVER_WEAPON_CONFIGS,
  // Level system
  LEVEL_THRESHOLDS,
  LEVEL_DAMAGE_MULTIPLIERS,
  LEVEL_FIRE_RATE_MULTIPLIERS,
  LEVEL_MOVE_SPEED_MULTIPLIERS,
  // Bullet
  BULLET_LIFETIME,
  BULLET_SPEED_UV,
  // Player movement
  PLAYER_WORLD_SPEED,
  PLAYER_SPEED_UV,
  // Weapon pickups
  WEAPON_DROP_CHANCE,
  WEAPON_PICKUP_LIFETIME,
  // Enemies
  ENEMY_SPEEDS,
  ENEMY_SCORES,
  ENEMY_HEALTH,
  // PvP
  PLAYER_PVP_MAX_HEALTH,
  PLAYER_PVP_INVINCIBILITY_DURATION,
  PVP_KILLS_TO_WIN,
  // Health pickups
  HEALTH_PICKUP_THRESHOLD,
  HEALTH_PICKUP_SPAWN_FREQUENCY,
  HEALTH_PICKUP_HEAL_AMOUNT,
  HEALTH_PICKUP_LIFETIME,
  HEALTH_PICKUP_SPAWN_RADIUS,
  // PvPvE
  DIFFICULTY_PER_PLAYER_FACTOR,
} from '../../src/shared/GameBalanceConstants';

// Server-specific aliases for backward compatibility.
// The server codebase uses WEAPON_CONFIGS and BULLET_SPEED and PLAYER_SPEED — alias them.
import {
  SERVER_WEAPON_CONFIGS as _SERVER_WEAPON_CONFIGS,
  BULLET_SPEED_UV as _BULLET_SPEED_UV,
  PLAYER_SPEED_UV as _PLAYER_SPEED_UV,
} from '../../src/shared/GameBalanceConstants';

/** Server WEAPON_CONFIGS — uses SERVER_WEAPON_CONFIGS from shared (includes damageMultiplier). */
export const WEAPON_CONFIGS = _SERVER_WEAPON_CONFIGS;

/** Server BULLET_SPEED (UV/s) — alias for BULLET_SPEED_UV from shared. */
export const BULLET_SPEED = _BULLET_SPEED_UV;

/** Server PLAYER_SPEED (UV/s) — alias for PLAYER_SPEED_UV from shared. */
export const PLAYER_SPEED = _PLAYER_SPEED_UV;

// ---------------------------------------------------------------------------
// GameSettings — re-export defaults for convenience
// ---------------------------------------------------------------------------
export { DEFAULT_GAME_SETTINGS, validateSettings } from './GameSettings';
export type { GameSettings, GameMode, GameSurface } from './GameSettings';
