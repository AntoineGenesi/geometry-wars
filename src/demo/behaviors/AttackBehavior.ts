/**
 * AttackBehavior — interface for enemy attack patterns in the Battle Demo.
 *
 * Each concrete behavior (Melee, RadiusSlam, SlowArrow, FastArrow) implements
 * this interface and is owned by a GLBCharacterEnemy.
 *
 * Debug-only — not part of the main game code path.
 */

import * as THREE from 'three';
import type { GLBCharacterEnemy } from '../GLBCharacterEnemy';
import type { Projectile } from './Projectile';

export interface AttackBehavior {
  /** Unique name for this behavior */
  readonly name: string;
  /**
   * Attack range in UV units. When UV distance between character and player
   * is less than this, the behavior can execute.
   */
  readonly range: number;
  /** Cooldown in seconds between attacks */
  readonly cooldown: number;
  /** Is the behavior off cooldown and ready to fire? */
  isReady(): boolean;
  /**
   * Execute the attack.
   * @param character   - The attacking enemy
   * @param playerPos   - Current player world position (for projectile targeting)
   * @param scene       - THREE.Scene for adding projectile meshes
   * @param onPlayerHit - Callback when player is hit; receives damage + type
   */
  execute(
    character: GLBCharacterEnemy,
    playerPos: THREE.Vector3,
    scene: THREE.Scene,
    onPlayerHit: (damage: number, type: AttackType) => void,
  ): void;
  /**
   * Update per-frame. Called every frame to advance projectiles,
   * check hits, and clean up expired effects.
   * @param dt        - Delta time in seconds
   * @param playerPos - Current player world position
   * @param onPlayerHit - Hit callback
   */
  update(
    dt: number,
    playerPos: THREE.Vector3,
    onPlayerHit: (damage: number, type: AttackType) => void,
  ): void;
  /** Remove all active projectiles / effects from the scene. */
  dispose(): void;
  /**
   * Optional: return active world-space projectiles that can be deflected by player bullets.
   * Behaviors without deflectable projectiles can omit this.
   */
  getActiveProjectiles?(): ReadonlyArray<Projectile>;
}

export type AttackType = 'melee' | 'slam' | 'slow-arrow' | 'fast-arrow';
