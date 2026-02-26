/**
 * GLBCharacterEnemy — A rigged GLB character with combat behaviour for the
 * AnimatedCharacterBattleDemo.
 *
 * Wraps AnimatedCharacter with:
 *  - UV-based movement toward the player (overriding the idle wandering)
 *  - Health / damage system
 *  - Hit flash (brief white emissive burst)
 *  - Death animation + fade-out
 *  - Respawn callback (onDead fires after death anim completes)
 *
 * Debug-only — not part of the main game code path.
 */

import * as THREE from 'three';
import { AnimatedCharacter, AnimatedCharacterConfig } from './AnimatedCharacter';
import type { Surface } from '../surfaces/Surface';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** UV units / second toward the player. */
const MOVE_SPEED = 0.035;

/** World-space radius for bullet collision checks. */
const COLLISION_RADIUS = 0.55;

/** How long the hit flash lasts (seconds). */
const HIT_FLASH_DURATION = 0.12;

/** Health fraction at which the character starts playing attack-melee. */
const ATTACK_THRESHOLD = 0.45;

/** Delay (ms) between death animation start and fade-out start. */
const DEATH_ANIM_WAIT_MS = 1100;

/** Fade-out duration (ms). */
const FADE_DURATION_MS = 500;

// ---------------------------------------------------------------------------
// GLBCharacterEnemy
// ---------------------------------------------------------------------------

export class GLBCharacterEnemy {
  /** The wrapped AnimatedCharacter — manages rendering + skeletal animation. */
  readonly char: AnimatedCharacter;

  health: number;
  readonly maxHealth: number;

  /** True while the character is alive and interactive. */
  alive: boolean = true;

  /** Fired after death animation + fade complete. */
  onDead?: (enemy: GLBCharacterEnemy) => void;

  private hitFlashTimer = 0;
  private deathStarted = false;
  private hasPlayedAttack = false;

  constructor(config: AnimatedCharacterConfig, health = 3) {
    this.health = health;
    this.maxHealth = health;
    // Pass walkSpeed=0 so AnimatedCharacter doesn't auto-wander;
    // we drive u/v externally via tickExternal().
    this.char = new AnimatedCharacter({ ...config, walkSpeed: 0, headingWanderRate: 0 });
  }

  /** World-space position of the character's root (updated each tickExternal). */
  get worldPosition(): THREE.Vector3 {
    return this.char.root.position;
  }

  /** Collision sphere radius in world units. */
  get collisionRadius(): number {
    return COLLISION_RADIUS;
  }

  /**
   * Update movement, animations, and hit flash.
   * @param dt         - Frame delta time (seconds, already clamped)
   * @param playerU    - Player UV u-coordinate on the surface
   * @param playerV    - Player UV v-coordinate on the surface
   * @param surface    - The shared game surface for moveOnSurface()
   */
  update(dt: number, playerU: number, playerV: number, surface: Surface): void {
    if (this.deathStarted) {
      // During death: keep animating but don't move
      this.char.tickExternal(dt);
      return;
    }
    if (!this.alive) return;

    // --- Movement toward player in UV space ---
    const du = playerU - this.char.u;
    const dv = playerV - this.char.v;
    const uvDist = Math.sqrt(du * du + dv * dv);

    if (uvDist > 0.005) {
      const step = MOVE_SPEED * dt;
      const moved = surface.moveOnSurface(
        this.char.u,
        this.char.v,
        (du / uvDist) * step,
        (dv / uvDist) * step,
      );
      this.char.u = moved.u;
      this.char.v = moved.v;
      // Face the player: heading = angle toward player in UV tangent space
      this.char.headingAngle = Math.atan2(dv, du);
      this.char.setState('walk');
    } else {
      this.char.setState('idle');
    }

    // --- One-shot attack anim when health drops below threshold ---
    if (
      !this.hasPlayedAttack &&
      this.health / this.maxHealth < ATTACK_THRESHOLD
    ) {
      this.hasPlayedAttack = true;
      this.char.playOneShot('attack-melee');
    }

    // --- Hit flash countdown ---
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= dt;
      if (this.hitFlashTimer <= 0) {
        this._clearHitFlash();
      }
    }

    this.char.tickExternal(dt);
  }

  /**
   * Apply damage. Triggers hit flash; triggers death sequence at 0 HP.
   */
  takeDamage(amount = 1): void {
    if (!this.alive || this.deathStarted) return;
    this.health -= amount;
    this._applyHitFlash();
    if (this.health <= 0) {
      this._startDeath();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _applyHitFlash(): void {
    this.char.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(0xffffff);
          mat.emissiveIntensity = 2.0;
        }
      }
    });
    this.hitFlashTimer = HIT_FLASH_DURATION;
  }

  private _clearHitFlash(): void {
    this.char.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        const mat = m as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      }
    });
  }

  private _startDeath(): void {
    this.alive = false;
    this.deathStarted = true;

    this.char.playOneShot('die');

    // After death anim plays, fade out and fire callback
    setTimeout(() => this._startFade(), DEATH_ANIM_WAIT_MS);
  }

  private _startFade(): void {
    const startTime = performance.now();
    const root = this.char.root;

    const fadeTick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / FADE_DURATION_MS, 1);
      const opacity = 1 - t;

      root.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          const mat = m as THREE.MeshStandardMaterial;
          mat.transparent = true;
          mat.opacity = opacity;
        }
      });

      if (t < 1) {
        requestAnimationFrame(fadeTick);
      } else {
        this.onDead?.(this);
      }
    };

    requestAnimationFrame(fadeTick);
  }

  /** Clean up Three.js resources. Does NOT remove root from scene. */
  dispose(): void {
    this.char.dispose();
  }
}
