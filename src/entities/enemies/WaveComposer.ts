/**
 * WaveComposer — Generates strategically varied enemy wave compositions.
 *
 * Instead of uniform enemy blobs ("spawn 20 grunts"), waves use archetypes
 * that mix complementary enemy types, creating distinct gameplay moments:
 *
 * - **Swarm**: Fast small enemies that overwhelm via numbers
 * - **Support**: Mid-range enemies with area denial / healing
 * - **Chaos**: Unpredictable high-damage enemies
 * - **SingleBig**: One or two large threats (snakes, bosses)
 * - **Rest**: Breathing room — only 4 enemies, player recovers
 *
 * Snake segments scale with wave number: early=14, mid=20-35, late=50.
 * Enemy count scales with player count: 1p=0.8x, 2p=1.0x, 3p=1.4x, 4p=2.0x.
 */

import type { WaveEnemy, EnemyType } from './EnemySpawner';

interface ArchetypeEntry {
  type: EnemyType;
  weight: number;
  /** Only include this enemy type at or after this wave number. */
  minWave?: number;
}

interface WaveArchetype {
  name: string;
  entries: ArchetypeEntry[];
  /** Override total enemy count (e.g. rest waves). */
  maxCount?: number;
  /** Whether snake types in this archetype get wave-based segment scaling. */
  snakeScaling?: boolean;
}

const ARCHETYPES: WaveArchetype[] = [
  {
    name: 'Swarm',
    entries: [
      { type: 'grunt',   weight: 0.5 },
      { type: 'mayfly',  weight: 0.3 },
      { type: 'duck',    weight: 0.2 },
    ],
  },
  {
    name: 'Support',
    entries: [
      { type: 'wanderer', weight: 0.4 },
      { type: 'weaver',   weight: 0.3 },
      { type: 'virus',    weight: 0.3 },
    ],
  },
  {
    name: 'Chaos',
    entries: [
      { type: 'rocket',  weight: 0.33 },
      { type: 'spinner', weight: 0.33 },
      { type: 'painter', weight: 0.34 },
    ],
  },
  {
    name: 'SingleBig',
    entries: [
      { type: 'snake',       weight: 0.5 },
      { type: 'giant_snake', weight: 0.35, minWave: 10 },
      { type: 'boss_ruby',   weight: 0.15, minWave: 20 },
    ],
    snakeScaling: true,
  },
  {
    // Rest wave: minimal enemies, player resets resources
    name: 'Rest',
    entries: [
      { type: 'grunt', weight: 1.0 },
    ],
    maxCount: 4,
  },
];

/** Index of the Rest archetype in the ARCHETYPES array. */
const REST_ARCHETYPE_IDX = 4;
/** How often (in waves) a rest wave appears. */
const REST_WAVE_INTERVAL = 15;
/** Number of main archetypes (excluding Rest). */
const MAIN_ARCHETYPE_COUNT = REST_ARCHETYPE_IDX;

export class WaveComposer {
  /**
   * Generate a wave composition for the given wave number and player count.
   *
   * @param waveNumber - Current wave number (1-based)
   * @param playerCount - Number of active players (1-4); controls enemy count scaling
   * @returns Array of WaveEnemy entries ready to pass to EnemySpawner.spawnWave()
   */
  composeWave(waveNumber: number, playerCount: number = 1): WaveEnemy[] {
    const archetype = this.selectArchetype(waveNumber);
    const totalCount = this.computeTotalCount(waveNumber, archetype, playerCount);
    return this.buildEntries(waveNumber, archetype, totalCount);
  }

  /** Select the archetype for this wave (rest every REST_WAVE_INTERVAL, else cycle). */
  private selectArchetype(waveNumber: number): WaveArchetype {
    if (waveNumber > 0 && waveNumber % REST_WAVE_INTERVAL === 0) {
      return ARCHETYPES[REST_ARCHETYPE_IDX];
    }
    return ARCHETYPES[(waveNumber - 1) % MAIN_ARCHETYPE_COUNT];
  }

  /** Compute total enemy count for this wave (grows with waves, scaled by players). */
  private computeTotalCount(waveNumber: number, archetype: WaveArchetype, playerCount: number): number {
    if (archetype.maxCount !== undefined) {
      return archetype.maxCount;
    }
    const base = Math.min(20, 6 + Math.floor(waveNumber * 0.4));
    return Math.max(1, Math.round(base * this.getPlayerCountScale(playerCount)));
  }

  /** Distribute total count across archetype entries by weight. */
  private buildEntries(waveNumber: number, archetype: WaveArchetype, totalCount: number): WaveEnemy[] {
    // Filter entries by minWave (e.g. giant_snake unavailable on early waves)
    const valid = archetype.entries.filter(e => !e.minWave || waveNumber >= e.minWave);

    if (valid.length === 0) {
      return [{ type: 'grunt', count: Math.max(1, totalCount) }];
    }

    const totalWeight = valid.reduce((sum, e) => sum + e.weight, 0);
    const result: WaveEnemy[] = [];
    let remaining = totalCount;

    for (let i = 0; i < valid.length; i++) {
      const entry = valid[i];
      const isLast = i === valid.length - 1;
      const count = isLast
        ? remaining
        : Math.max(1, Math.round(remaining * (entry.weight / totalWeight)));

      if (count <= 0) continue;

      const waveEntry: WaveEnemy = { type: entry.type, count };

      // Attach snake segment scaling for SingleBig archetype
      if (archetype.snakeScaling && (entry.type === 'snake' || entry.type === 'giant_snake')) {
        waveEntry.maxSegments = this.getMaxSegmentsForWave(waveNumber, entry.type);
      }

      result.push(waveEntry);
      remaining -= count;
    }

    return result;
  }

  /**
   * Get max snake segments for a given wave number.
   *
   * Scaling:
   * - Waves  1-9:  14 segments (default cap, same as before)
   * - Waves 10-29: 14 + (waveNumber - 9), growing from 15→34
   * - Waves 30-49: 34 + (waveNumber - 29) * 0.8, growing to ~50
   * - Waves 50+:   50 (hard cap)
   *
   * GiantSnake uses half the value (its segments are larger).
   */
  getMaxSegmentsForWave(waveNumber: number, type: EnemyType = 'snake'): number {
    let maxSeg: number;
    if (waveNumber < 10) {
      maxSeg = 14;
    } else if (waveNumber < 30) {
      maxSeg = 14 + (waveNumber - 9);
    } else {
      maxSeg = Math.min(50, 34 + Math.floor((waveNumber - 29) * 0.8));
    }
    // GiantSnake segments are physically larger, so fewer look equivalent
    return type === 'giant_snake' ? Math.max(7, Math.floor(maxSeg * 0.5)) : maxSeg;
  }

  /**
   * Enemy count multiplier based on player count.
   * More players = more enemies to maintain difficulty.
   */
  getPlayerCountScale(playerCount: number): number {
    if (playerCount <= 1) return 0.8;
    if (playerCount <= 2) return 1.0;
    if (playerCount <= 3) return 1.4;
    return 2.0;
  }
}

/** Singleton instance — avoids repeated construction across wave spawns. */
export const waveComposer = new WaveComposer();
