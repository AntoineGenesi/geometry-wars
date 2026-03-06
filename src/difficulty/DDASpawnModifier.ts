// ---------------------------------------------------------------------------
// DDA Spawn Modifier
//
// Hooks into EnemySpawner wave composition to modify enemy types based on
// the DDA level of nearby players.
//
// PRIMARY MECHANISM: Enemy type substitution (swap hard -> easy enemies).
// This is the most invisible form of DDA.
//
// CONSTRAINTS (from user):
//   - NO resource buffs (geoms, health, pickups)
//   - Speed boost MAX 20% and only at level 3
//   - Primary mechanism: enemy type mix
//   - Must be subtle and undetectable
// ---------------------------------------------------------------------------

import type { EnemyType, WaveEnemy } from '../entities/enemies/EnemySpawner';
import type { DDADecisionEngine, DDALevelValue } from './DDADecisionEngine';

// ---------------------------------------------------------------------------
// Enemy difficulty classification
// ---------------------------------------------------------------------------

/** Difficulty tier for an enemy type. */
export type EnemyDifficulty = 'easy' | 'medium' | 'hard' | 'elite' | 'boss';

/** Map every enemy type to its difficulty tier. */
const ENEMY_DIFFICULTY: Record<string, EnemyDifficulty> = {
  // Easy: predictable movement, low threat
  grunt: 'easy',
  wanderer: 'easy',
  duck: 'easy',
  mayfly: 'easy',

  // Medium: more complex behavior, moderate threat
  weaver: 'medium',
  spinner: 'medium',
  rocket: 'medium',
  neutron: 'medium',
  helix: 'medium',
  swarm: 'medium',
  lurker: 'medium',
  orbiter: 'medium',

  // Hard: dangerous mechanics, high threat
  snake: 'hard',
  repulsor: 'hard',
  gravity_well: 'hard',
  spawner: 'hard',
  cluster: 'hard',
  fractal: 'hard',
  phaser: 'hard',

  // Elite: very dangerous, screen control
  gate: 'elite',
  virus: 'elite',
  painter: 'elite',

  // Boss / Splitting: never modify these
  titan_grunt: 'boss',
  titan_spinner: 'boss',
  titan_weaver: 'boss',
  giant_wanderer: 'boss',
  giant_rocket: 'boss',
  giant_snake: 'boss',
  giant_neutron: 'boss',
  splitter: 'boss',
  boss_sapphire: 'boss',
  boss_ruby: 'boss',
  boss_emerald: 'boss',
  boss_topaz: 'boss',
  boss_amethyst: 'boss',
  boss_opal: 'boss',
};

/** Pool of easy enemies to substitute in. */
const EASY_POOL: readonly EnemyType[] = ['grunt', 'wanderer', 'duck', 'mayfly'];

/** Pool of medium enemies to substitute in (when downgrading hard -> medium). */
const MEDIUM_POOL: readonly EnemyType[] = [
  'weaver', 'spinner', 'rocket', 'neutron', 'helix', 'swarm', 'lurker', 'orbiter',
];

/**
 * Swap probability per DDA level.
 *
 * Level 0: no swaps
 * Level 1: 15% chance to swap hard -> easy
 * Level 2: 30% chance to swap hard -> easy, 10% elite -> medium
 * Level 3: 50% chance to swap hard -> easy, 25% elite -> medium
 */
const SWAP_CHANCE_HARD: readonly number[] = [0, 0.15, 0.30, 0.50];
const SWAP_CHANCE_ELITE: readonly number[] = [0, 0, 0.10, 0.25];

// ---------------------------------------------------------------------------
// Player position for zone assignment
// ---------------------------------------------------------------------------

export interface PlayerPosition {
  index: number;
  u: number;
  v: number;
}

// ---------------------------------------------------------------------------
// DDASpawnModifier
// ---------------------------------------------------------------------------

export class DDASpawnModifier {
  private readonly engine: DDADecisionEngine;

  constructor(engine: DDADecisionEngine) {
    this.engine = engine;
  }

  /**
   * Get the difficulty classification for an enemy type.
   */
  getEnemyDifficulty(type: EnemyType): EnemyDifficulty {
    return ENEMY_DIFFICULTY[type] ?? 'medium';
  }

  /**
   * Determine which player's zone a spawn position belongs to.
   * Returns the player index of the nearest player (UV distance).
   *
   * For single player, always returns 0.
   */
  getPlayerZone(spawnU: number, spawnV: number, players: readonly PlayerPosition[]): number {
    if (players.length <= 1) return 0;

    let nearestIndex = 0;
    let nearestDistSq = Infinity;

    for (let i = 0; i < players.length; i++) {
      const du = spawnU - players[i].u;
      const dv = spawnV - players[i].v;
      const distSq = du * du + dv * dv;
      if (distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearestIndex = i;
      }
    }

    return nearestIndex;
  }

  /**
   * Modify a single enemy type based on DDA level.
   *
   * May return a different (easier) enemy type if the DDA system
   * decides to substitute. Uses probabilistic swapping to mask
   * the adjustment within natural spawn variation.
   *
   * @param enemyType Original enemy type from wave definition.
   * @param spawnU UV spawn position (for zone detection).
   * @param spawnV UV spawn position.
   * @param players Array of player positions (for zone detection).
   * @returns The (possibly modified) enemy type to actually spawn.
   */
  modifySpawnType(
    enemyType: EnemyType,
    spawnU: number,
    spawnV: number,
    players: readonly PlayerPosition[],
  ): EnemyType {
    if (!this.engine.isEnabled()) return enemyType;

    // Determine which player's zone this spawn is in
    const zoneOwner = this.getPlayerZone(spawnU, spawnV, players);
    const ddaLevel = this.engine.getDDALevel(zoneOwner);

    // No adjustment at level 0
    if (ddaLevel === 0) return enemyType;

    const difficulty = this.getEnemyDifficulty(enemyType);

    // Never modify boss/splitting enemies
    if (difficulty === 'boss') return enemyType;

    // Easy enemies: never downgrade further
    if (difficulty === 'easy') return enemyType;

    // Hard enemies: chance to swap to easy
    if (difficulty === 'hard') {
      const swapChance = SWAP_CHANCE_HARD[ddaLevel];
      if (Math.random() < swapChance) {
        return EASY_POOL[Math.floor(Math.random() * EASY_POOL.length)];
      }
    }

    // Medium enemies: at level 3, small chance to swap to easy
    if (difficulty === 'medium' && ddaLevel >= 3) {
      if (Math.random() < 0.15) {
        return EASY_POOL[Math.floor(Math.random() * EASY_POOL.length)];
      }
    }

    // Elite enemies: chance to swap to medium
    if (difficulty === 'elite') {
      const swapChance = SWAP_CHANCE_ELITE[ddaLevel];
      if (Math.random() < swapChance) {
        return MEDIUM_POOL[Math.floor(Math.random() * MEDIUM_POOL.length)];
      }
    }

    return enemyType;
  }

  /**
   * Modify an entire wave's enemy list based on DDA.
   *
   * Creates a new array with potentially modified enemy types.
   * Does NOT modify the input array.
   *
   * @param waveEnemies Original wave definition.
   * @param players Array of player positions.
   * @returns New wave definition with DDA modifications applied.
   */
  modifyWave(
    waveEnemies: readonly WaveEnemy[],
    players: readonly PlayerPosition[],
  ): WaveEnemy[] {
    if (!this.engine.isEnabled()) {
      // Return a shallow copy (do not return the original to maintain immutability)
      return waveEnemies.map(e => ({ ...e }));
    }

    const modified: WaveEnemy[] = [];

    for (const entry of waveEnemies) {
      // For each spawn group, check if we should modify the type
      // Use the region center (or 0.5, 0.5) as approximate spawn position
      const approxU = entry.region
        ? ((entry.region.minU ?? 0) + (entry.region.maxU ?? 1)) / 2
        : 0.5;
      const approxV = entry.region
        ? ((entry.region.minV ?? 0) + (entry.region.maxV ?? 1)) / 2
        : 0.5;

      const modifiedType = this.modifySpawnType(
        entry.type,
        approxU,
        approxV,
        players,
      );

      modified.push({
        type: modifiedType,
        count: entry.count,
        region: entry.region,
        tier: entry.tier,
      });
    }

    return modified;
  }

  /**
   * Get the player speed multiplier from the DDA engine.
   * Convenience wrapper.
   */
  getSpeedMultiplier(playerIndex: number): number {
    return this.engine.getSpeedMultiplier(playerIndex);
  }

  /**
   * Get the DDA level for a player.
   * Convenience wrapper.
   */
  getDDALevel(playerIndex: number): DDALevelValue {
    return this.engine.getDDALevel(playerIndex);
  }

  /**
   * Get the HP multiplier for enemies near a dominating player.
   *
   * When a player is performing very well, enemies get tougher HP to compensate.
   * Returns 1.0 when performance is normal; up to 5.0 when fully dominating.
   *
   * @param playerIndex Player index (0-based).
   * @param companionCount Active guardian/hunter companion count.
   * @param isSmallMap Whether the current map is small (harder to escape → dominance boost).
   */
  getDominanceHpMultiplier(
    playerIndex: number,
    companionCount: number = 0,
    isSmallMap: boolean = false,
  ): number {
    return this.engine.getDominanceHpMultiplier(playerIndex, companionCount, isSmallMap);
  }
}

/**
 * Export the difficulty classification for external use (tests, debug).
 */
export { ENEMY_DIFFICULTY, EASY_POOL, MEDIUM_POOL };
