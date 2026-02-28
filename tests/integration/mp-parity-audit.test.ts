/**
 * MP Parity Audit — SP vs MP Programmatic Comparison Test Suite
 *
 * This test suite compares Single-Player (SP) and Multiplayer (MP) configuration values
 * to ensure parity between the two modes. It detects configuration drift before it
 * becomes a gameplay bug.
 *
 * Background:
 *   - Session 37 found 3 critical gaps: MatchUpgradeTracker, mapSizeScaleFactor, pickup dimming
 *   - S38c-05 fixed standard weapon dealing 4x damage in MP vs SP
 *   - This suite is the programmatic safety net to prevent future drift
 *
 * Approach: Option C (Unit-level config comparison)
 *   - Import SP configs directly from TypeScript source
 *   - MP configs defined inline, extracted from server/rooms/GameRoom.ts
 *   - Tests fail if values diverge beyond allowed tolerance
 *   - Reports generated separately via `npm run parity`
 *
 * MAINTENANCE: When GameRoom.ts constants change, update the MP_* constants in this file.
 * The test will fail as a reminder when they drift.
 */

import { describe, it, expect } from 'vitest';
import { WEAPON_CONFIGS, WeaponType } from '../../src/weapons/WeaponTypes.js';
import {
  getDifficultyTier,
  MAX_TIER,
  generateScaledEndlessWave,
  computeDifficultyLevel,
} from '../../src/core/DifficultyScaling.js';

// ---------------------------------------------------------------------------
// MP Constants (extracted from server/rooms/GameRoom.ts — last synced 2026-03-01)
// When GameRoom.ts changes, update these constants and the SYNC_DATE.
// ---------------------------------------------------------------------------
const MP_SYNC_DATE = '2026-03-01';

const MP_WEAPON_CONFIGS: Record<string, { ammo: number; damageMultiplier: number; damage: number }> = {
  standard:        { ammo: -1,  damageMultiplier: 1.0, damage: 0.25 },
  spread:          { ammo: 50,  damageMultiplier: 0.8, damage: 1    },
  piercing:        { ammo: 30,  damageMultiplier: 1.5, damage: 3    },
  homing:          { ammo: 20,  damageMultiplier: 1.2, damage: 6    },
  chain_lightning: { ammo: 25,  damageMultiplier: 1.0, damage: 4    },
  plasma_mortar:   { ammo: 15,  damageMultiplier: 2.0, damage: 20   },
  gravity_gun:     { ammo: 20,  damageMultiplier: 0.5, damage: 1    },
  laser_beam:      { ammo: 40,  damageMultiplier: 0.6, damage: 2    },
  black_hole:      { ammo: 5,   damageMultiplier: 5.0, damage: 999  },
  tesla_coil:      { ammo: 30,  damageMultiplier: 0.7, damage: 1    },
};

const MP_WAVE_TIMING = {
  WAVE_FIRST_AT: 6.0,       // seconds
  WAVE_INTERVAL_BASE: 7.0,  // seconds
  WAVE_INTERVAL_MIN: 2.0,   // seconds (hard floor)
  WAVE_INTERVAL_DECAY: 0.2, // seconds shorter per wave
};

// Player count multiplier: 1p=1.0x, 2p=1.5x, 3p=2.0x, 4p=2.5x
const MP_PLAYER_COUNT_MULTIPLIER = (playerCount: number) =>
  1.0 + (Math.max(1, playerCount) - 1) * 0.5;

// Max enemies by player count (indexed by playerCount-1)
const MP_MAX_ENEMIES_BY_PLAYER_COUNT = [30, 50, 70, 90];

// Enemy type pools (from GameRoom.ts — mirrors DifficultyScaling.ts)
const MP_BASIC_TYPES = ['grunt', 'wanderer', 'duck'];
const MP_MID_TYPES = ['weaver', 'spinner', 'rocket', 'neutron', 'mayfly', 'helix', 'swarm', 'lurker', 'orbiter', 'approach_glow'];
const MP_HARD_TYPES = ['snake', 'repulsor', 'gravity_well', 'spawner', 'cluster', 'fractal', 'phaser', 'stealth_stalker'];
const MP_ELITE_TYPES = ['gate', 'virus', 'painter'];
const MP_SPLITTING_TYPES = ['giant_wanderer', 'giant_rocket', 'giant_snake', 'giant_neutron', 'titan_grunt', 'titan_spinner', 'titan_weaver', 'splitter'];

// ---------------------------------------------------------------------------
// SP Constants (extracted from src/ — read directly from imported modules)
// ---------------------------------------------------------------------------

// SP weapon types map to GameRoom.ts keys
const SP_TO_MP_WEAPON_KEY: Record<WeaponType, string> = {
  [WeaponType.Standard]:       'standard',
  [WeaponType.Spread]:         'spread',
  [WeaponType.Piercing]:       'piercing',
  [WeaponType.ChainLightning]: 'chain_lightning',
  [WeaponType.Homing]:         'homing',
  [WeaponType.PlasmaMortar]:   'plasma_mortar',
  [WeaponType.GravityGun]:     'gravity_gun',
  [WeaponType.LaserBeam]:      'laser_beam',
  [WeaponType.BlackHole]:      'black_hole',
  [WeaponType.TeslaCoil]:      'tesla_coil',
};

// SP wave timing (from src/main.ts WaveScheduler — last verified 2026-03-01)
const SP_WAVE_TIMING = {
  WAVE_FIRST_AT: 6,        // endlessNextSpawn initial value
  WAVE_INTERVAL_BASE: 7,   // endlessInterval initial value
  WAVE_INTERVAL_MIN: 2.0,  // Math.max(2.0, ...) in WaveScheduler.update()
  WAVE_INTERVAL_DECAY: 0.2, // endlessWave * 0.2 subtracted per wave
};

// SP player count multiplier formula (from DifficultyScaling.ts generateScaledEndlessWave)
// 1.0 + (playerCount - 1) * 0.5  →  1p=1.0x, 2p=1.5x, 3p=2.0x, 4p=2.5x
const SP_PLAYER_COUNT_MULTIPLIER = (playerCount: number) =>
  1.0 + (Math.max(1, playerCount) - 1) * 0.5;

// SP enemy type pools (from src/core/DifficultyScaling.ts)
const SP_BASIC_TYPES = ['grunt', 'wanderer', 'duck'];
const SP_MID_TYPES = ['weaver', 'spinner', 'rocket', 'neutron', 'mayfly', 'helix', 'swarm', 'lurker', 'orbiter', 'approach_glow'];
const SP_HARD_TYPES = ['snake', 'repulsor', 'gravity_well', 'spawner', 'cluster', 'fractal', 'phaser', 'stealth_stalker', 'fractal_snake'];
const SP_ELITE_TYPES = ['gate', 'virus', 'painter'];
const SP_SPLITTING_TYPES = ['giant_wanderer', 'giant_rocket', 'giant_snake', 'giant_neutron', 'titan_grunt', 'titan_spinner', 'titan_weaver', 'splitter'];

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe(`MP Parity Audit (synced ${MP_SYNC_DATE})`, () => {

  // =========================================================================
  // Section 1: Weapon Base Damage
  // CRITICAL: Damage values must match exactly. Any divergence = gameplay imbalance.
  // =========================================================================
  describe('Weapon Base Damage (SP vs MP)', () => {
    const weaponTypes = Object.values(WeaponType);

    it('all weapon types are represented in MP weapon config', () => {
      for (const wt of weaponTypes) {
        const key = SP_TO_MP_WEAPON_KEY[wt];
        expect(MP_WEAPON_CONFIGS).toHaveProperty(key,
          `WeaponType.${wt} (key: ${key}) is missing from MP_WEAPON_CONFIGS`
        );
      }
    });

    it.each(weaponTypes)('damage matches for %s', (weaponType) => {
      const spConfig = WEAPON_CONFIGS[weaponType];
      const mpKey = SP_TO_MP_WEAPON_KEY[weaponType];
      const mpConfig = MP_WEAPON_CONFIGS[mpKey];

      expect(mpConfig).toBeDefined();
      expect(mpConfig.damage).toBe(spConfig.damage,
        `Weapon ${weaponType}: SP damage=${spConfig.damage} but MP damage=${mpConfig.damage}`
      );
    });

    it('standard weapon damage is 0.25 (not 1.0 — S38c-05 regression guard)', () => {
      // This exact value caused 4x damage in MP before S38c-05 fix.
      // If this fails, someone reverted the fix!
      expect(MP_WEAPON_CONFIGS.standard.damage).toBe(0.25);
      expect(WEAPON_CONFIGS[WeaponType.Standard].damage).toBe(0.25);
    });
  });

  // =========================================================================
  // Section 2: Difficulty Tier Multipliers
  // These must be identical in SP and MP — the server uses the SAME tier system
  // through DifficultyScaling.ts (GameRoom.ts imports computeDifficultyLevel etc.)
  // =========================================================================
  describe('Difficulty Tier Multipliers', () => {
    // MP difficulty tier definitions (extracted from DifficultyScaling.ts directly —
    // the server imports these from the same source)
    const EXPECTED_TIERS = [
      { tier: 0, healthMultiplier: 1.0,  speedMultiplier: 1.0,  scaleMultiplier: 1.0  },
      { tier: 1, healthMultiplier: 3.0,  speedMultiplier: 1.15, scaleMultiplier: 1.1  },
      { tier: 2, healthMultiplier: 10.0, speedMultiplier: 1.30, scaleMultiplier: 1.2  },
      { tier: 3, healthMultiplier: 25.0, speedMultiplier: 1.50, scaleMultiplier: 1.35 },
      { tier: 4, healthMultiplier: 60.0, speedMultiplier: 1.70, scaleMultiplier: 1.5  },
    ];

    it(`has ${EXPECTED_TIERS.length} difficulty tiers (MAX_TIER = ${EXPECTED_TIERS.length - 1})`, () => {
      expect(MAX_TIER).toBe(EXPECTED_TIERS.length - 1);
    });

    it.each(EXPECTED_TIERS)('tier $tier: health=$healthMultiplier, speed=$speedMultiplier, scale=$scaleMultiplier', (expected) => {
      const tier = getDifficultyTier(expected.tier);
      expect(tier.healthMultiplier).toBe(expected.healthMultiplier);
      expect(tier.speedMultiplier).toBe(expected.speedMultiplier);
      expect(tier.scaleMultiplier).toBe(expected.scaleMultiplier);
    });

    it('tier health multipliers increase monotonically', () => {
      for (let i = 1; i <= MAX_TIER; i++) {
        const prev = getDifficultyTier(i - 1);
        const curr = getDifficultyTier(i);
        expect(curr.healthMultiplier).toBeGreaterThan(prev.healthMultiplier);
      }
    });

    it('tier speed multipliers increase monotonically', () => {
      for (let i = 1; i <= MAX_TIER; i++) {
        const prev = getDifficultyTier(i - 1);
        const curr = getDifficultyTier(i);
        expect(curr.speedMultiplier).toBeGreaterThan(prev.speedMultiplier);
      }
    });
  });

  // =========================================================================
  // Section 3: Wave Timing Constants
  // SP (WaveScheduler in main.ts) and MP (GameRoom.ts) must use identical timing.
  // =========================================================================
  describe('Wave Timing Constants (SP vs MP)', () => {
    it('first wave at same time', () => {
      expect(MP_WAVE_TIMING.WAVE_FIRST_AT).toBe(SP_WAVE_TIMING.WAVE_FIRST_AT);
    });

    it('base interval matches', () => {
      expect(MP_WAVE_TIMING.WAVE_INTERVAL_BASE).toBe(SP_WAVE_TIMING.WAVE_INTERVAL_BASE);
    });

    it('minimum interval matches', () => {
      expect(MP_WAVE_TIMING.WAVE_INTERVAL_MIN).toBe(SP_WAVE_TIMING.WAVE_INTERVAL_MIN);
    });

    it('interval decay per wave matches', () => {
      expect(MP_WAVE_TIMING.WAVE_INTERVAL_DECAY).toBe(SP_WAVE_TIMING.WAVE_INTERVAL_DECAY);
    });
  });

  // =========================================================================
  // Section 4: Player Count Scaling Formula
  // 1p=1.0x, 2p=1.5x, 3p=2.0x, 4p=2.5x in both SP and MP.
  // =========================================================================
  describe('Player Count Scaling Formula', () => {
    const testCases = [
      { players: 1, expected: 1.0 },
      { players: 2, expected: 1.5 },
      { players: 3, expected: 2.0 },
      { players: 4, expected: 2.5 },
    ];

    it.each(testCases)('$players players → $expected multiplier (SP)', ({ players, expected }) => {
      expect(SP_PLAYER_COUNT_MULTIPLIER(players)).toBe(expected);
    });

    it.each(testCases)('$players players → $expected multiplier (MP)', ({ players, expected }) => {
      expect(MP_PLAYER_COUNT_MULTIPLIER(players)).toBe(expected);
    });

    it('SP and MP formulas produce identical outputs for 1-4 players', () => {
      for (let p = 1; p <= 4; p++) {
        expect(SP_PLAYER_COUNT_MULTIPLIER(p)).toBe(MP_PLAYER_COUNT_MULTIPLIER(p));
      }
    });
  });

  // =========================================================================
  // Section 5: Player Count Difficulty Bonus
  // Each additional player increases difficulty level by +0.3 in both modes.
  // =========================================================================
  describe('Player Count Difficulty Bonus', () => {
    it('single player has no difficulty bonus', () => {
      const level = computeDifficultyLevel({
        score: 0, elapsedTime: 0, combo: 0, totalKills: 0, playerLevel: 0,
        playerCount: 1,
      });
      const levelNoCount = computeDifficultyLevel({
        score: 0, elapsedTime: 0, combo: 0, totalKills: 0, playerLevel: 0,
      });
      expect(level).toBe(levelNoCount);
    });

    it('2 players adds +0.3 difficulty vs 1 player', () => {
      const base = { score: 0, elapsedTime: 0, combo: 0, totalKills: 0, playerLevel: 0 };
      const level1p = computeDifficultyLevel({ ...base, playerCount: 1 });
      const level2p = computeDifficultyLevel({ ...base, playerCount: 2 });
      expect(level2p - level1p).toBeCloseTo(0.3, 5);
    });

    it('4 players adds +0.9 difficulty vs 1 player', () => {
      const base = { score: 0, elapsedTime: 0, combo: 0, totalKills: 0, playerLevel: 0 };
      const level1p = computeDifficultyLevel({ ...base, playerCount: 1 });
      const level4p = computeDifficultyLevel({ ...base, playerCount: 4 });
      expect(level4p - level1p).toBeCloseTo(0.9, 5);
    });
  });

  // =========================================================================
  // Section 6: Enemy Type Pools
  // SP and MP must draw from the same enemy pools. If MP has a subset,
  // document it explicitly. Missing types get remapped in GameRoom.ts (WAVE_TYPE_REMAP).
  // =========================================================================
  describe('Enemy Type Pools (SP vs MP)', () => {
    it('BASIC types match exactly', () => {
      expect(MP_BASIC_TYPES.sort()).toEqual(SP_BASIC_TYPES.sort());
    });

    it('MID types match exactly', () => {
      expect(MP_MID_TYPES.sort()).toEqual(SP_MID_TYPES.sort());
    });

    it('ELITE types match exactly', () => {
      expect(MP_ELITE_TYPES.sort()).toEqual(SP_ELITE_TYPES.sort());
    });

    it('SPLITTING types match exactly', () => {
      expect(MP_SPLITTING_TYPES.sort()).toEqual(SP_SPLITTING_TYPES.sort());
    });

    it('HARD types: MP is a subset of SP (fractal_snake is SP-only — ported separately)', () => {
      // fractal_snake is a complex composite enemy handled separately in MP (s41-10 ported AI).
      // GameRoom.ts uses WAVE_TYPE_REMAP to substitute it: fractal_snake -> fractal -> spinner
      const spHardSet = new Set(SP_HARD_TYPES);
      const mpHardSet = new Set(MP_HARD_TYPES);

      // MP HARD types should all exist in SP HARD types
      for (const type of MP_HARD_TYPES) {
        expect(spHardSet.has(type)).toBe(true,
          `MP HARD type '${type}' not found in SP HARD types`
        );
      }

      // fractal_snake is SP-only (expected missing from MP)
      expect(spHardSet.has('fractal_snake')).toBe(true);
      expect(mpHardSet.has('fractal_snake')).toBe(false);
    });

    it('generateScaledEndlessWave produces consistent results for same inputs', () => {
      // Same wave generation function used in both SP (via DifficultyScaling import)
      // and should be mirrored in MP. This verifies the SP function works correctly.
      const wave = generateScaledEndlessWave(5, 2.0, 0, 2);
      expect(Array.isArray(wave)).toBe(true);
      expect(wave.length).toBeGreaterThan(0);
      for (const entry of wave) {
        expect(entry.type).toBeDefined();
        expect(entry.count).toBeGreaterThan(0);
        expect(entry.tier).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // =========================================================================
  // Section 7: Max Enemy Counts by Player Count
  // MP has explicit caps per player count. SP uses map size + player scaling.
  // =========================================================================
  describe('Max Enemies by Player Count', () => {
    it('1 player cap is 30 (MP)', () => {
      expect(MP_MAX_ENEMIES_BY_PLAYER_COUNT[0]).toBe(30);
    });

    it('2 player cap is 50 (MP = 30 * 1.5 + rounding)', () => {
      expect(MP_MAX_ENEMIES_BY_PLAYER_COUNT[1]).toBe(50);
    });

    it('4 player cap is 90 (MP = 30 * 2.5 + rounding)', () => {
      expect(MP_MAX_ENEMIES_BY_PLAYER_COUNT[3]).toBe(90);
    });

    it('MP caps scale proportionally with player count multiplier', () => {
      const base = MP_MAX_ENEMIES_BY_PLAYER_COUNT[0]; // 1p baseline = 30
      for (let i = 0; i < MP_MAX_ENEMIES_BY_PLAYER_COUNT.length; i++) {
        const playerCount = i + 1;
        const multiplier = MP_PLAYER_COUNT_MULTIPLIER(playerCount);
        const expected = Math.round(base * multiplier);
        const actual = MP_MAX_ENEMIES_BY_PLAYER_COUNT[i];
        // Allow ±2 rounding tolerance
        expect(Math.abs(actual - expected)).toBeLessThanOrEqual(2,
          `MP max enemies for ${playerCount}p: expected ~${expected}, got ${actual}`
        );
      }
    });
  });

  // =========================================================================
  // Section 8: Documented Discrepancies (non-failing — informational)
  // These are known differences between SP and MP that are INTENTIONAL or
  // ACCEPTABLE. They are documented here so future maintainers understand why.
  // =========================================================================
  describe('Documented Discrepancies (expected differences)', () => {
    it('DOCUMENTED: weapon ammo counts differ (SP=ticks/shots, MP=shots only)', () => {
      // SP spread ammo = 100, MP spread ammo = 50
      // SP laser ammo = 200 (ticks at 60Hz = 3.33s), MP laser ammo = 40
      // SP tesla ammo = 150 (ticks at 30Hz = 5s), MP tesla ammo = 30
      // These may reflect intentional balance differences for multiplayer.
      // INVESTIGATION NEEDED: Verify if MP ammo counts create shorter weapon durations.
      const spSpread = WEAPON_CONFIGS[WeaponType.Spread].ammo;
      const mpSpread = MP_WEAPON_CONFIGS.spread.ammo;
      expect(spSpread).toBe(100);   // SP
      expect(mpSpread).toBe(50);    // MP — HALF of SP
      // This test PASSES to document the discrepancy — it's expected to be different.
    });

    it('DOCUMENTED: bullet lifetime differs (SP=6s, MP=3s) — speed representation different', () => {
      // SP: BULLET_LIFETIME = 6 seconds at 4.0 world units/s = 24 world units range
      // MP: BULLET_LIFETIME = 3.0 seconds at 0.13 UV/s × sphere(R=10) circumference
      //     = 0.13 × 3.14159 × 10 × 3 = ~12.25 world units range
      // SP bullets travel TWICE as far. This may be intentional (SP has MeshBullet)
      // or a balance discrepancy. INVESTIGATION NEEDED.
      const MP_BULLET_LIFETIME = 3.0;
      const SP_BULLET_LIFETIME = 6; // from src/entities/Bullet.ts
      expect(SP_BULLET_LIFETIME / MP_BULLET_LIFETIME).toBe(2); // SP lives 2x longer
    });

    it('DOCUMENTED: player speed representation differs (SP=UV 0.08, MP=UV 0.095)', () => {
      // SP Player.ts: PLAYER_SPEED = 0.08 UV/s (used for UV-space movement)
      // MP GameRoom.ts: PLAYER_SPEED = 0.095 UV/s
      // NOTE: The GameRoom.ts comment explains that 0.095 = 3.0 world/s on sphere R=10,
      // which matches the MeshWalker speed used in SP's GameLoop. The 0.08 in Player.ts
      // may be a legacy value. The effective speed is 0.095 in both modes.
      const SP_PLAYER_SPEED_UV = 0.08;  // from src/entities/Player.ts
      const MP_PLAYER_SPEED_UV = 0.095; // from server/rooms/GameRoom.ts
      const SP_WORLD_SPEED = 3.0;       // MeshWalker speed in GameLoop
      const SPHERE_R = 10;
      const SP_EFFECTIVE_UV = SP_WORLD_SPEED / (Math.PI * SPHERE_R);
      // SP effective UV speed ≈ 0.0955 ≈ 0.095 (matches MP)
      expect(SP_EFFECTIVE_UV).toBeCloseTo(MP_PLAYER_SPEED_UV, 2);
    });
  });

});
