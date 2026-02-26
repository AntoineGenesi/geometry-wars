/**
 * CharacterBehaviorSystem — orchestrates attack behaviors for all enemies in
 * the AnimatedCharacterBattleDemo.
 *
 * Responsibilities:
 *  - Per-frame update of all behaviors (projectile movement, cooldown decay)
 *  - Hit detection (projectile → player, melee range → player)
 *  - Routing hit callbacks to the demo for visual/audio effects
 *
 * Debug-only — not part of the main game code path.
 */

import * as THREE from 'three';
import type { GLBCharacterEnemy } from './GLBCharacterEnemy';
import type { AttackBehavior, AttackType } from './behaviors/AttackBehavior';

export type PlayerHitCallback = (damage: number, type: AttackType) => void;

export class CharacterBehaviorSystem {
  private readonly scene: THREE.Scene;
  private readonly onPlayerHit: PlayerHitCallback;

  /**
   * Map of enemy → their assigned behavior.
   * Maintained externally (enemies register when spawned, unregister on death).
   */
  private readonly registry = new Map<GLBCharacterEnemy, AttackBehavior>();

  constructor(scene: THREE.Scene, onPlayerHit: PlayerHitCallback) {
    this.scene = scene;
    this.onPlayerHit = onPlayerHit;
  }

  /**
   * Register an enemy with its assigned attack behavior.
   * Call once per enemy spawn.
   */
  register(enemy: GLBCharacterEnemy, behavior: AttackBehavior): void {
    this.registry.set(enemy, behavior);
  }

  /**
   * Unregister an enemy (called on death / despawn).
   * Also disposes the behavior's active projectiles.
   */
  unregister(enemy: GLBCharacterEnemy): void {
    const behavior = this.registry.get(enemy);
    if (behavior) {
      behavior.dispose();
      this.registry.delete(enemy);
    }
  }

  /**
   * Per-frame update. Call from AnimatedCharacterBattleDemo._update().
   *
   * @param dt        - Frame delta time in seconds
   * @param playerPos - Current player world position
   * @param playerU   - Player UV u-coordinate
   * @param playerV   - Player UV v-coordinate
   */
  update(
    dt: number,
    playerPos: THREE.Vector3,
    playerU: number,
    playerV: number,
  ): void {
    for (const [enemy, behavior] of this.registry) {
      if (!enemy.alive) continue;

      // Update projectiles / effects for this behavior
      behavior.update(dt, playerPos, this.onPlayerHit);

      // Check if the enemy should attack (in range + cooldown ready).
      // Uses behavior.range directly — each behavior defines its own attack range,
      // so ranged behaviors (SlowArrow range=0.35, FastArrow range=0.55) can fire
      // at full range without being gated by the close-range ATTACKING state.
      if (behavior.isReady()) {
        const uvDist = Math.sqrt(
          Math.pow(enemy.char.u - playerU, 2) +
          Math.pow(enemy.char.v - playerV, 2),
        );
        if (uvDist < behavior.range) {
          behavior.execute(enemy, playerPos, this.scene, this.onPlayerHit);
        }
      }
    }
  }

  /** Dispose all behaviors and clear registry. Call on demo teardown. */
  dispose(): void {
    for (const behavior of this.registry.values()) {
      behavior.dispose();
    }
    this.registry.clear();
  }
}
