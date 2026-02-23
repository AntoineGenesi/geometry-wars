import { EnemySpawner } from './EnemySpawner';
import { BaseEnemy } from './BaseEnemy';
import { Boss } from './Boss';
import { Spawner } from './Spawner';
import { Snake } from './Snake';
import { TitanGrunt } from './TitanGrunt';
import { TitanSpinner } from './TitanSpinner';
import { TitanWeaver } from './TitanWeaver';
import { GiantWanderer } from './GiantWanderer';
import { GiantRocket } from './GiantRocket';
import { GiantSnake } from './GiantSnake';
import { GiantNeutron } from './GiantNeutron';
import { Virus } from './Virus';
import { Splitter } from './Splitter';

/**
 * EnemyDeathCallbacks
 *
 * Wires up all static enemy death callbacks (titans, boss, virus, spawner, etc.)
 * Previously ~200 lines scattered in main.ts initialization.
 */
export class EnemyDeathCallbacks {
  static wire(enemySpawner: EnemySpawner): void {
    // Wire up enemy death handler (handled in collision system now)
    BaseEnemy.onDeath = (_position, _score, _geoms) => {
      // Handled in checkBulletEnemyCollisions callback
    };

    // Tier-based split death: tiered enemies break into children on death
    BaseEnemy.onTierSplitDeath = (type: string, u: number, v: number, count: number, childTier: number) => {
      for (let i = 0; i < count; i++) {
        const offsetU = (Math.random() - 0.5) * 0.08;
        const offsetV = (Math.random() - 0.5) * 0.08;
        const clampedU = Math.max(0, Math.min(1, u + offsetU));
        const clampedV = Math.max(0, Math.min(1, v + offsetV));
        enemySpawner.spawn(type as any, clampedU, clampedV, Math.max(0, childTier));
      }
    };

    // Snake: peeled tail segment spawns as independent Grunt
    Snake.onSegmentDeath = (u: number, v: number) => {
      const offsetU = (Math.random() - 0.5) * 0.06;
      const offsetV = (Math.random() - 0.5) * 0.06;
      enemySpawner.spawn('grunt', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
    };

    // Snake head kill: all remaining segments spawn as independent Grunts
    Snake.onHeadDeath = (segments: Array<{ u: number; v: number }>) => {
      // Half the segments die quietly (score already given), half spawn as enemies
      for (let i = 0; i < segments.length; i++) {
        if (i % 2 === 0) continue; // every other segment escapes
        const seg = segments[i];
        const offsetU = (Math.random() - 0.5) * 0.08;
        const offsetV = (Math.random() - 0.5) * 0.08;
        enemySpawner.spawn('grunt', Math.max(0, Math.min(1, seg.u + offsetU)), Math.max(0, Math.min(1, seg.v + offsetV)));
      }
    };

    // Splitter death: spawn child splitters at correct generation
    Splitter.onSplitterDeath = (u: number, v: number, generation: number) => {
      enemySpawner._nextSplitterGen = generation;
      enemySpawner.spawn('splitter', u, v);
    };

    // Spawner: periodically spawns wanderers
    Spawner.onSpawnEnemy = (u: number, v: number) => {
      enemySpawner.spawn('wanderer', u, v);
    };

    // Titan death spawns: spawn smaller versions on death
    TitanGrunt.onDeathSpawn = (u: number, v: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const offsetU = (Math.random() - 0.5) * 0.06;
        const offsetV = (Math.random() - 0.5) * 0.06;
        enemySpawner.spawn('grunt', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
      }
    };

    TitanSpinner.onDeathSpawn = (u: number, v: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const offsetU = (Math.random() - 0.5) * 0.06;
        const offsetV = (Math.random() - 0.5) * 0.06;
        enemySpawner.spawn('spinner', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
      }
    };

    TitanWeaver.onDeathSpawn = (u: number, v: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const offsetU = (Math.random() - 0.5) * 0.06;
        const offsetV = (Math.random() - 0.5) * 0.06;
        enemySpawner.spawn('weaver', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
      }
    };

    // Giant enemy death spawns: break apart into smaller versions
    GiantWanderer.onDeathSpawn = (u: number, v: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const offsetU = (Math.random() - 0.5) * 0.08;
        const offsetV = (Math.random() - 0.5) * 0.08;
        enemySpawner.spawn('wanderer', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
      }
    };

    GiantRocket.onDeathSpawn = (u: number, v: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const offsetU = (Math.random() - 0.5) * 0.08;
        const offsetV = (Math.random() - 0.5) * 0.08;
        enemySpawner.spawn('rocket', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
      }
    };

    GiantSnake.onDeathSpawn = (u: number, v: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const offsetU = (Math.random() - 0.5) * 0.1;
        const offsetV = (Math.random() - 0.5) * 0.1;
        enemySpawner.spawn('snake', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
      }
    };

    GiantNeutron.onDeathSpawn = (u: number, v: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const offsetU = (Math.random() - 0.5) * 0.08;
        const offsetV = (Math.random() - 0.5) * 0.08;
        enemySpawner.spawn('neutron', Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
      }
    };

    // Boss system callbacks are wired separately (need more context)
    // Virus infection callback is wired separately (needs spawner reference)
  }

  /**
   * Wire boss-specific callbacks (requires additional context)
   */
  static wireBossCallbacks(
    enemySpawner: EnemySpawner,
    onHealthUpdate: (currentHP: number, maxHP: number, phase: number, totalPhases: number) => void,
    onPhaseChange: (phase: number) => void,
  ): void {
    Boss.onShieldSpawn = (types: string[], count: number, u: number, v: number) => {
      for (let i = 0; i < count; i++) {
        const type = types[Math.floor(Math.random() * types.length)];
        const offsetU = (Math.random() - 0.5) * 0.3;
        const offsetV = (Math.random() - 0.5) * 0.3;
        enemySpawner.spawn(type as any, Math.max(0, Math.min(1, u + offsetU)), Math.max(0, Math.min(1, v + offsetV)));
      }
    };

    Boss.onHealthUpdate = onHealthUpdate;
    Boss.onPhaseChange = onPhaseChange;
  }

  /**
   * Wire virus infection callback
   */
  static wireVirusCallback(enemySpawner: EnemySpawner): void {
    Virus.onInfectKill = (u: number, v: number) => {
      if (Math.random() < 0.2) {
        enemySpawner.spawn('virus', u, v);
      }
    };
  }
}
