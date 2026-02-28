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
 *  - State machine: IDLE → WALKING → ATTACKING → DYING → DEAD
 *  - Attack behavior slot (assigned by CharacterBehaviorSystem)
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

/** Delay (ms) between death animation start and fade-out start. */
const DEATH_ANIM_WAIT_MS = 1100;

/** Fade-out duration (ms). */
const FADE_DURATION_MS = 500;

/**
 * UV distance at which the enemy transitions from WALKING → ATTACKING state.
 * Actual attack execution is gated by behavior.range in CharacterBehaviorSystem.
 */
const ATTACK_STATE_THRESHOLD = 0.25;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * Enemy state machine:
 *   IDLE      — no player detected (or too far away)
 *   WALKING   — moving toward player
 *   ATTACKING — player within attack-state range (CharacterBehaviorSystem fires attacks)
 *   DYING     — death animation playing
 *   DEAD      — fully faded, onDead callback fired
 */
export type EnemyState = 'idle' | 'walking' | 'attacking' | 'dying' | 'dead';

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

  /** Current state machine state. */
  state: EnemyState = 'idle';

  /** Fired after death animation + fade complete. */
  onDead?: (enemy: GLBCharacterEnemy) => void;

  private hitFlashTimer = 0;

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
   * Update movement, state machine, animations, and hit flash.
   * @param dt         - Frame delta time (seconds, already clamped)
   * @param playerU    - Player UV u-coordinate on the surface
   * @param playerV    - Player UV v-coordinate on the surface
   * @param surface    - The shared game surface for moveOnSurface()
   */
  update(dt: number, playerU: number, playerV: number, surface: Surface): void {
    if (this.state === 'dying' || this.state === 'dead') {
      this.char.tickExternal(dt);
      return;
    }
    if (!this.alive) return;

    // --- UV distance to player ---
    const du = playerU - this.char.u;
    const dv = playerV - this.char.v;
    const uvDist = Math.sqrt(du * du + dv * dv);

    // --- State machine transitions ---
    if (uvDist > 0.5) {
      // Player too far — idle
      this._setState('idle');
    } else if (uvDist > ATTACK_STATE_THRESHOLD) {
      // Mid-range — walk toward player
      this._setState('walking');
    } else {
      // Close range — switch to attacking state (CharacterBehaviorSystem handles fire)
      this._setState('attacking');
    }

    // --- Movement (WALKING state: chase player; ATTACKING state: keep facing) ---
    if (uvDist > 0.005) {
      // Always face player
      this.char.headingAngle = Math.atan2(dv, du);

      if (this.state === 'walking') {
        const step = MOVE_SPEED * dt;
        const moved = surface.moveOnSurface(
          this.char.u,
          this.char.v,
          (du / uvDist) * step,
          (dv / uvDist) * step,
        );
        this.char.u = moved.u;
        this.char.v = moved.v;
      }
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
    if (!this.alive || this.state === 'dying' || this.state === 'dead') return;
    this.health -= amount;
    this._applyHitFlash();
    if (this.health <= 0) {
      this._startDeath();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _setState(newState: EnemyState): void {
    if (this.state === newState) return;
    this.state = newState;
    switch (newState) {
      case 'idle':
        this.char.setState('idle');
        break;
      case 'walking':
        this.char.setState('walk');
        break;
      case 'attacking':
        // Idle while attacking — attack oneshots overlay the idle animation
        this.char.setState('idle');
        break;
    }
  }

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
    this.state = 'dying';

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
        this.state = 'dead';
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
