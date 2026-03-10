// src/shared/GameBalanceConstants.ts
// Single source of truth for all numeric gameplay constants shared between SP client and MP server.
// ZERO Three.js imports — this file must run on both browser (Vite) and Node.js (Colyseus server).
//
// Previously, these values were manually duplicated in:
//   - src/weapons/WeaponTypes.ts (SP weapon configs)
//   - src/core/PlayerLevel.ts (SP level thresholds/multipliers)
//   - server/shared/GameConstants.ts (MP server copies)
// Each had comments like "must match SP values" — a fragile pattern that caused bugs:
//   - s43-02: bullet damage 4× too low (0.25 vs 1.0)
//   - s44c-05: fire rate uniform 10/s for all weapons
//   - s43-11: bullet lifetime 3s vs 6s
//
// Now both client and server import from HERE. Change once, applies everywhere.

// ---------------------------------------------------------------------------
// Weapon numeric configs (shared between SP and MP)
// ---------------------------------------------------------------------------
// Keys match WeaponType enum values in src/weapons/WeaponTypes.ts.
// Visual properties (color, name, description, projectileSpeed) remain in WeaponTypes.ts
// since the server doesn't need them.

export interface SharedWeaponConfig {
  ammo: number;
  damage: number;
  fireRate: number; // shots per second
}

export const SHARED_WEAPON_CONFIGS: Record<string, SharedWeaponConfig> = {
  standard:        { ammo: -1,  damage: 0.25, fireRate: 6   },
  spread:          { ammo: 100, damage: 1,    fireRate: 6   },
  piercing:        { ammo: 50,  damage: 3,    fireRate: 3   },
  homing:          { ammo: 40,  damage: 6,    fireRate: 3   },
  chain_lightning: { ammo: 50,  damage: 4,    fireRate: 3   },
  plasma_mortar:   { ammo: 18,  damage: 20,   fireRate: 1.0 },
  gravity_gun:     { ammo: 20,  damage: 8,    fireRate: 1   },
  laser_beam:      { ammo: 200, damage: 2,    fireRate: 60  },
  black_hole:      { ammo: 6,   damage: 999,  fireRate: 0.3 },
  tesla_coil:      { ammo: 150, damage: 1,    fireRate: 30  },
} as const;

// ---------------------------------------------------------------------------
// Server weapon configs (extended with damageMultiplier for server-side damage calc)
// ---------------------------------------------------------------------------
// Server uses damageMultiplier differently from SP. In SP, damage is for UI display only;
// actual damage comes from CollisionSystem bulletDamage parameter.
// In MP server, damage is the actual HP deducted per hit.
// s43-02: standard.damage must be 1.0 on server (not 0.25) because SP CollisionSystem
// passes bulletDamage=1.0 at game start (scorePowerMult * levelMult * buffMult * etc.).

export interface ServerWeaponConfig {
  ammo: number;
  damageMultiplier: number;
  damage: number;
  fireRate: number;
}

export const SERVER_WEAPON_CONFIGS: Record<string, ServerWeaponConfig> = {
  standard:        { ammo: -1,  damageMultiplier: 1.0, damage: 1.0, fireRate: 6   },
  spread:          { ammo: 50,  damageMultiplier: 0.8, damage: 1,   fireRate: 6   },
  piercing:        { ammo: 30,  damageMultiplier: 1.5, damage: 3,   fireRate: 3   },
  homing:          { ammo: 20,  damageMultiplier: 1.2, damage: 6,   fireRate: 3   },
  chain_lightning: { ammo: 25,  damageMultiplier: 1.0, damage: 4,   fireRate: 3   },
  plasma_mortar:   { ammo: 15,  damageMultiplier: 2.0, damage: 20,  fireRate: 1.0 },
  gravity_gun:     { ammo: 20,  damageMultiplier: 1.0, damage: 4,   fireRate: 1.0 },
  laser_beam:      { ammo: 200, damageMultiplier: 0.6, damage: 2,   fireRate: 60  },
  black_hole:      { ammo: 5,   damageMultiplier: 5.0, damage: 999, fireRate: 0.3 },
  tesla_coil:      { ammo: 150, damageMultiplier: 0.7, damage: 1,   fireRate: 30  },
} as const;

// ---------------------------------------------------------------------------
// Player level constants
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
// Bullet constants
// ---------------------------------------------------------------------------
// SP Bullet.ts and server share the same lifetime. Speed differs by unit system
// (SP uses world units, server uses UV units).
export const BULLET_LIFETIME = 6.0;

// World-space bullet speed (used by SP Bullet.ts and network-main.ts FaceWalker rendering).
export const BULLET_SPEED_WORLD = 4.0;

// UV-space bullet speed (used by server GameRoom.ts for UV-based movement).
// On a sphere of radius 10: 4.0 / (π*10) ≈ 0.127 UV/s.
export const BULLET_SPEED_UV = 0.13;

// ---------------------------------------------------------------------------
// Player movement constants
// ---------------------------------------------------------------------------
// World-space speed for MeshWalker-based movement (SP + MP server).
// s44b-09: Increased from 3.0 to 3.3 (10% faster) per user feedback.
export const PLAYER_WORLD_SPEED = 3.3;

// UV-space movement speed used by MP server for UV-based calculations.
// s44b-09: Increased from 0.095 to 0.105 per user feedback.
export const PLAYER_SPEED_UV = 0.105;

// ---------------------------------------------------------------------------
// Weapon pickup constants
// ---------------------------------------------------------------------------
export const WEAPON_DROP_CHANCE = 0.08;      // 8% on enemy death
export const WEAPON_PICKUP_LIFETIME = 20.0;  // seconds before despawn

// ---------------------------------------------------------------------------
// Enemy constants
// ---------------------------------------------------------------------------
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

export const ENEMY_HEALTH: Record<string, number> = {
  grunt:        2,
  arrow:        1,
  wanderer:     2,
  duck:         1,
  weaver:       2,
  spinner:      1,
  rocket:       2,
  neutron:      2,
  snake:        6,
  gate:         1,
  blackhole:    10,
  repulsor:     5,
  mayfly:       1,
  proton:       5,
  ufo:          5,
  mines:        1,
  mutator:      4,
  bubbles:      2,
  spawnlet:     1,
  virus:        1,
  spawner:      12,
  painter:      3,
  titan_grunt:  10,
  titan_spinner: 8,
  titan_weaver: 8,
};

// ---------------------------------------------------------------------------
// PvP constants
// ---------------------------------------------------------------------------
export const PLAYER_PVP_MAX_HEALTH = 100;
export const PLAYER_PVP_INVINCIBILITY_DURATION = 3.0;
export const PVP_KILLS_TO_WIN = 10;

// ---------------------------------------------------------------------------
// Health pickup constants
// ---------------------------------------------------------------------------
export const HEALTH_PICKUP_THRESHOLD = 0.70;
export const HEALTH_PICKUP_SPAWN_FREQUENCY = 30;
export const HEALTH_PICKUP_HEAL_AMOUNT = 20;
export const HEALTH_PICKUP_LIFETIME = 10.0;
export const HEALTH_PICKUP_SPAWN_RADIUS = 0.04;

// ---------------------------------------------------------------------------
// PvPvE difficulty-per-player constants
// ---------------------------------------------------------------------------
export const DIFFICULTY_PER_PLAYER_FACTOR: Record<string, number> = {
  low:    -0.20,
  medium:  0.00,
  high:    0.30,
} as const;
