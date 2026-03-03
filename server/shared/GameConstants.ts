// server/shared/GameConstants.ts
// Single source of truth for all numeric gameplay constants used on the server.
// Values must match src/weapons/WeaponTypes.ts and src/core/PlayerLevel.ts.
// DO NOT import Three.js — this file runs on Node.js.

// ---------------------------------------------------------------------------
// Weapon configs
// ---------------------------------------------------------------------------

// Mirrors src/weapons/WeaponTypes.ts WEAPON_CONFIGS.
// damage values must stay in sync with SP so displayed damage numbers match.
// S43-02 fix: standard.damage = 1.0 to match SP parity.
// SP's CollisionSystem receives bulletDamage = scorePowerMult * levelMult * buffMult * masteryMult * upgradeMult = 1.0 at game start.
// The SP WeaponTypes.ts damage:0.25 is used only for UI display, NOT in the SP collision path.
// Previous value of 0.25 (set in S38c-05) caused MP bullets to do 4x less damage than SP:
//   grunt health=2, 0.25 damage/bullet → 8 hits needed vs SP's 2 hits. Root cause of user bug.
// fireRate: shots per second — must match src/weapons/WeaponTypes.ts WEAPON_CONFIGS.fireRate.
// S44c-05 fix: previously tryShoot() hardcoded 0.1s (10/sec) for all weapons, causing
// plasma_mortar (SP=1/sec), black_hole (SP=0.3/sec), and others to fire 3-33x too fast in MP.
export const WEAPON_CONFIGS: Record<string, { ammo: number; damageMultiplier: number; damage: number; fireRate: number }> = {
  standard:        { ammo: -1,  damageMultiplier: 1.0, damage: 1.0, fireRate: 6   },
  spread:          { ammo: 50,  damageMultiplier: 0.8, damage: 1,   fireRate: 6   },
  piercing:        { ammo: 30,  damageMultiplier: 1.5, damage: 3,   fireRate: 3   },
  homing:          { ammo: 20,  damageMultiplier: 1.2, damage: 6,   fireRate: 3   },
  chain_lightning: { ammo: 25,  damageMultiplier: 1.0, damage: 4,   fireRate: 3   },
  plasma_mortar:   { ammo: 15,  damageMultiplier: 2.0, damage: 20,  fireRate: 1.0 },
  gravity_gun:     { ammo: 20,  damageMultiplier: 1.0, damage: 4,   fireRate: 1.0 },
  laser_beam:      { ammo: 200, damageMultiplier: 0.6, damage: 2,   fireRate: 60  }, // continuous; handled by applyLaserDamage, not tryShoot
  black_hole:      { ammo: 5,   damageMultiplier: 5.0, damage: 999, fireRate: 0.3 },
  tesla_coil:      { ammo: 150, damageMultiplier: 0.7, damage: 1,   fireRate: 30  }, // continuous; handled by applyTeslaDamage, not tryShoot (SP: 150 ticks = 5s)
} as const;

// ---------------------------------------------------------------------------
// Player movement / bullet constants
// ---------------------------------------------------------------------------

// Movement speed in UV units per second.
// Co-op uses MeshWalker at 3.3 world units/s. Surface radius = 10 (DEFAULT_SURFACE_SCALE).
// V direction arc = pi * 10 ≈ 31.4 world units. So 3.3 / (pi*10) ≈ 0.105 UV/s.
// S44b-09: Increased from 0.095 to 0.105 (10% faster) per user feedback.
export const PLAYER_SPEED = 0.105;

// Player speed in world units/s — used by ServerMeshWalker (MeshWalker-based movement).
// Matches SP MeshWalker speed. UV-based PLAYER_SPEED is kept for bullets/enemies.
// S44b-09: Increased from 3.0 to 3.3 (10% faster) per user feedback.
export const PLAYER_WORLD_SPEED = 3.3;

// Bullet speed in UV/s. Co-op bullets move at 4.0 world units/s.
// On a sphere of radius 10: 4.0 / (pi*10) ≈ 0.127 UV/s.
export const BULLET_SPEED = 0.13;

// S43-11 parity fix: SP src/entities/Bullet.ts uses BULLET_LIFETIME=6s.
// MP was 3.0s (2× shorter) — bullets traveled half as far, making MP harder.
export const BULLET_LIFETIME = 6.0;

// ---------------------------------------------------------------------------
// Weapon pickup constants
// ---------------------------------------------------------------------------

export const WEAPON_DROP_CHANCE = 0.08;   // 8% on enemy death
export const WEAPON_PICKUP_LIFETIME = 20.0; // seconds before despawn

// ---------------------------------------------------------------------------
// Enemy constants
// ---------------------------------------------------------------------------

// Enemy speeds in UV/s. Scaled to match PLAYER_SPEED = 0.105 (updated S44b-09).
export const ENEMY_SPEEDS: Record<string, number> = {
  grunt:        0.035,
  arrow:        0.07,
  wanderer:     0.03,
  duck:         0.025,
  weaver:       0.05,
  spinner:      0.03,
  rocket:       0.07,
  neutron:      0.05,
  snake:        0.06,
  gate:         0.025,
  blackhole:    0.012,
  repulsor:     0.04,
  mayfly:       0.095,
  proton:       0.05,
  ufo:          0.025,
  mines:        0,
  mutator:      0.035,
  bubbles:      0.03,
  spawnlet:     0.06,
  virus:        0.045,
  spawner:      0.02,
  painter:      0.04,
  titan_grunt:  0.025,
  titan_spinner: 0.02,
  titan_weaver: 0.03,
};

// Score awarded per enemy kill.
export const ENEMY_SCORES: Record<string, number> = {
  grunt:        25,
  arrow:        75,
  wanderer:     25,
  duck:         25,
  weaver:       50,
  spinner:      100,
  rocket:       75,
  neutron:      75,
  snake:        50,
  gate:         150,
  blackhole:    200,
  repulsor:     50,
  mayfly:       150,
  proton:       100,
  ufo:          300,
  mines:        25,
  mutator:      200,
  bubbles:      50,
  spawnlet:     25,
  virus:        150,
  spawner:      200,
  painter:      100,
  titan_grunt:  150,
  titan_spinner: 200,
  titan_weaver: 175,
};

// Enemy HP — mirrors SP base health values from each enemy's super() constructor.
// S40-07: Fixed parity — values now match SP src/entities/enemies/*.ts.
export const ENEMY_HEALTH: Record<string, number> = {
  grunt:        2,   // Grunt.ts: super(..., 2, ...)
  arrow:        1,   // no SP equivalent, keep 1
  wanderer:     2,   // Wanderer.ts: super(..., 2, ...)
  duck:         1,   // Duck.ts: super(..., 1, ...)
  weaver:       2,   // Weaver.ts: super(..., 2, ...)
  spinner:      1,   // Spinner.ts: super(..., 1, ...) — was 3, caused 3x slower kills
  rocket:       2,   // Rocket.ts: super(..., 2, ...)
  neutron:      2,   // Neutron.ts: super(..., 2, ...)
  snake:        6,   // Snake.ts: super(..., 6, ...)
  gate:         1,   // Gate.ts: super(..., 1, ...) — was 2, caused 2x slower kills
  blackhole:    10,  // no SP equivalent, keep 10
  repulsor:     5,   // Repulsor.ts: super(..., 5, ...)
  mayfly:       1,   // Mayfly.ts: super(..., 1, ...)
  proton:       5,   // no SP equivalent, keep 5
  ufo:          5,   // no SP equivalent, keep 5
  mines:        1,   // no SP equivalent, keep 1
  mutator:      4,   // no SP equivalent, keep 4
  bubbles:      2,   // no SP equivalent, keep 2
  spawnlet:     1,   // no SP equivalent, keep 1
  virus:        1,   // Virus.ts: super(..., 1, ...) — was 3, caused 3x slower kills
  spawner:      12,  // Spawner.ts: super(..., 12, ...)
  painter:      3,   // Painter.ts: super(..., 3, ...)
  titan_grunt:  10,  // TitanGrunt.ts: super(..., 10, ...)
  titan_spinner: 8,  // TitanSpinner.ts: super(..., 8, ...)
  titan_weaver: 8,   // TitanWeaver.ts: super(..., 8, ...)
};

// ---------------------------------------------------------------------------
// Player level constants
// Mirrors src/core/PlayerLevel.ts — DO NOT import that file (it uses Three.js).
// ---------------------------------------------------------------------------

// Kill count thresholds per level (index = level number).
export const LEVEL_THRESHOLDS = [0, 10, 25, 50, 80, 120, 175, 250, 350, 500];

// Cumulative damage multiplier per level (index = level number).
export const LEVEL_DAMAGE_MULTIPLIERS = [1.0, 1.15, 1.15, 1.15, 1.15, 1.45, 1.45, 1.45, 1.80, 2.0];

// Cumulative fire rate multiplier per level.
export const LEVEL_FIRE_RATE_MULTIPLIERS = [1.0, 1.0, 1.15, 1.15, 1.15, 1.15, 1.40, 1.40, 1.40, 1.55];

// Cumulative move speed multiplier per level.
export const LEVEL_MOVE_SPEED_MULTIPLIERS = [1.0, 1.0, 1.0, 1.15, 1.15, 1.15, 1.15, 1.30, 1.30, 1.45];

// ---------------------------------------------------------------------------
// PvP health constants (s44j-pvp-13a)
// ---------------------------------------------------------------------------

/** Starting and maximum health for all players in PvP mode. */
export const PLAYER_PVP_MAX_HEALTH = 100;

/**
 * Seconds of invincibility granted after a PvP death + respawn.
 * Long enough to orient/move away, short enough to not feel unfair.
 */
export const PLAYER_PVP_INVINCIBILITY_DURATION = 3.0;

// ---------------------------------------------------------------------------
// Health pickup constants (s44j-pvp-13c)
// ---------------------------------------------------------------------------

/** Player health threshold (0–1) below which a health pickup may spawn. */
export const HEALTH_PICKUP_THRESHOLD = 0.70; // 70% of maxHealth

/** Default cooldown (seconds) between health pickup spawns per player. Reads from RoomConfig. */
export const HEALTH_PICKUP_SPAWN_FREQUENCY = 30;

/** Default HP restored per health pickup. Reads from RoomConfig. */
export const HEALTH_PICKUP_HEAL_AMOUNT = 20;

/** Seconds before an uncollected health pickup expires and is removed. */
export const HEALTH_PICKUP_LIFETIME = 10.0;

/** UV-space spawn offset radius from the damaged player's position. */
export const HEALTH_PICKUP_SPAWN_RADIUS = 0.04;

// ---------------------------------------------------------------------------
// GameSettings — re-export defaults for convenience
// ---------------------------------------------------------------------------
// Full type definitions and validateSettings() live in GameSettings.ts.
// Importing DEFAULT_GAME_SETTINGS from here avoids deep relative paths.
export { DEFAULT_GAME_SETTINGS, validateSettings } from './GameSettings';
export type { GameSettings, GameMode, GameSurface } from './GameSettings';
