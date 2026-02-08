import * as THREE from 'three';
import type { InputState } from '../input/InputManager';
import { BulletPool } from './Bullet';
import { buildChevron3D } from '../utils/GeometryBuilder';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYER_SPEED = 0.08; // units / sec in UV space - very slow for precise control
const FIRE_RATE = 10; // shots / sec
const FIRE_INTERVAL = 1 / FIRE_RATE;
const INVINCIBILITY_DURATION = 2; // seconds after respawn
const BLINK_FREQUENCY = 10; // blinks per second during invincibility
const INITIAL_LIVES = 3;
const INITIAL_BOMBS = 3;

// Ship visual dimensions.
const SHIP_HALF_W = 0.15; // half-width of the chevron
const SHIP_LENGTH = 0.3; // nose to tail

// Rotation smoothing to prevent spinning when moving sideways
const ROTATION_SMOOTHING = 0.4; // Higher = faster rotation (0-1) - increased for responsiveness

// Neon cyan colour.
const SHIP_COLOR = 0x00ffff;

// ---------------------------------------------------------------------------
// Player entity
// ---------------------------------------------------------------------------

export class Player {
  // -- Surface coordinates --------------------------------------------------
  surfaceU = 0;
  surfaceV = 0;

  // -- 3-D representation ---------------------------------------------------
  readonly mesh: THREE.Group;

  // -- Physics --------------------------------------------------------------
  velocityU = 0;
  velocityV = 0;

  // -- Aiming ---------------------------------------------------------------
  /** Aim angle in radians (0 = +Z in local surface space). */
  aimAngle = 0;

  // -- Rotation smoothing ---------------------------------------------------
  /** Smoothed quaternion to prevent spinning when moving sideways */
  private smoothedQuaternion = new THREE.Quaternion();
  private hasInitialRotation = false;

  // -- Shooting -------------------------------------------------------------
  private fireCooldown = 0;
  /** External fire rate multiplier (e.g. from leveling). Higher = faster. */
  fireRateMultiplier = 1.0;

  // -- State ----------------------------------------------------------------
  lives = INITIAL_LIVES;
  bombs = INITIAL_BOMBS;
  score = 0;
  multiplier = 1;
  alive = true;

  // -- Invincibility --------------------------------------------------------
  private invincibilityTimer = INVINCIBILITY_DURATION;
  private isInvincible = true;

  // -- Bullet pool reference ------------------------------------------------
  private readonly bulletPool: BulletPool;

  // -- Callbacks ------------------------------------------------------------
  /** Called when the player fires; receives nose world position + direction. */
  onShoot?: (origin: THREE.Vector3, direction: THREE.Vector3) => void;
  /** If set, delegates firing to weapon system instead of default bulletPool. */
  weaponFireHandler?: (origin: THREE.Vector3, direction: THREE.Vector3) => void;
  /** Called when the player uses a bomb. */
  onBomb?: () => void;
  /** Called when the player dies. */
  onDeath?: (position: THREE.Vector3) => void;

  constructor(bulletPool: BulletPool) {
    this.bulletPool = bulletPool;

    // -- Build the 3D ship mesh (chevron prism with depth) ------------------
    this.mesh = buildChevron3D(SHIP_LENGTH, SHIP_HALF_W, SHIP_COLOR, 0.1, 0.025);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Reset the player to the default spawn state.
   * Optionally provide spawn coordinates on the surface.
   */
  respawn(u = 0, v = 0): void {
    this.surfaceU = u;
    this.surfaceV = v;
    this.velocityU = 0;
    this.velocityV = 0;
    this.alive = true;
    this.invincibilityTimer = INVINCIBILITY_DURATION;
    this.isInvincible = true;
    this.fireCooldown = 0;
    this.mesh.visible = true;
  }

  /**
   * Calculate a safe respawn position away from death location.
   * Returns a position on the opposite side of the surface.
   */
  getSafeRespawnPosition(): { u: number; v: number } {
    // Respawn on opposite side of the surface
    const safeU = (this.surfaceU + 0.5) % 1;
    const safeV = (this.surfaceV + 0.5) % 1;
    return { u: safeU, v: safeV };
  }

  /**
   * Respawn at a safe position away from current location.
   */
  respawnSafe(): void {
    const { u, v } = this.getSafeRespawnPosition();
    this.respawn(u, v);
  }

  /**
   * Fixed-timestep update.  Reads the current InputState and advances
   * the player simulation by `dt` seconds.
   */
  update(dt: number, input: InputState): void {
    if (!this.alive) return;

    // -- Movement -----------------------------------------------------------
    // Set velocity; actual surface movement is handled externally via
    // surface.moveOnSurface() so that surface constraints are respected.
    this.velocityU = input.moveX * PLAYER_SPEED;
    this.velocityV = input.moveY * PLAYER_SPEED;

    // -- Aim direction ------------------------------------------------------
    const aimLen = Math.sqrt(input.aimX * input.aimX + input.aimY * input.aimY);
    if (aimLen > 0.1) {
      // aimX maps to rotation around Y; aimY is depth.
      // atan2(x, -y) gives angle where aimY=-1 (up on screen) maps to 0 (forward +Z).
      this.aimAngle = Math.atan2(input.aimX, -input.aimY);
    }

    // -- Shooting -----------------------------------------------------------
    this.fireCooldown -= dt;
    if (input.shooting && this.fireCooldown <= 0) {
      this.fireCooldown = FIRE_INTERVAL / this.fireRateMultiplier;
      this.fire();
    }

    // -- Bomb ---------------------------------------------------------------
    if (input.bomb && this.bombs > 0) {
      this.bombs -= 1;
      this.onBomb?.();
    }

    // -- Invincibility ------------------------------------------------------
    if (this.isInvincible) {
      this.invincibilityTimer -= dt;
      if (this.invincibilityTimer <= 0) {
        this.isInvincible = false;
        this.invincibilityTimer = 0;
        this.mesh.visible = true;
      } else {
        // Blink effect: toggle visibility at BLINK_FREQUENCY Hz.
        const blinkPhase = Math.sin(
          this.invincibilityTimer * Math.PI * 2 * BLINK_FREQUENCY,
        );
        this.mesh.visible = blinkPhase > 0;
      }
    }
  }

  /**
   * Apply the surface mapping: given a callback that converts (u, v) to a
   * world position, normal, and tangent frame, orient the ship mesh.
   */
  applySurfaceTransform(
    getTransform: (
      u: number,
      v: number,
    ) => { position: THREE.Vector3; normal: THREE.Vector3; tangent: THREE.Vector3; bitangent: THREE.Vector3 },
  ): void {
    const { position, normal, tangent, bitangent } = getTransform(
      this.surfaceU,
      this.surfaceV,
    );

    this.mesh.position.copy(position);

    // Build a rotation matrix from the surface frame.
    // tangent   = local X
    // normal    = local Y (up from surface)
    // bitangent = local Z (forward default)
    const mat = new THREE.Matrix4();
    mat.makeBasis(tangent, normal, bitangent);

    // Apply aim rotation around the surface normal.
    const aimQuat = new THREE.Quaternion().setFromAxisAngle(normal, -this.aimAngle);
    const targetQuat = new THREE.Quaternion().setFromRotationMatrix(mat);
    targetQuat.premultiply(aimQuat);

    // Smooth the rotation to prevent spinning when moving sideways
    if (!this.hasInitialRotation) {
      this.smoothedQuaternion.copy(targetQuat);
      this.hasInitialRotation = true;
    } else {
      this.smoothedQuaternion.slerp(targetQuat, ROTATION_SMOOTHING);
    }

    this.mesh.quaternion.copy(this.smoothedQuaternion);
  }

  /**
   * Returns the world-space position of the ship nose, useful for spawning
   * bullets.  Must be called after `applySurfaceTransform`.
   */
  getNoseWorldPosition(): THREE.Vector3 {
    const local = new THREE.Vector3(0, 0, SHIP_LENGTH * 0.5);
    return local.applyMatrix4(this.mesh.matrixWorld);
  }

  /**
   * Returns the world-space forward direction (aim direction on the surface).
   * Must be called after `applySurfaceTransform`.
   */
  getAimDirection(): THREE.Vector3 {
    const forward = new THREE.Vector3(0, 0, 1);
    forward.applyQuaternion(this.mesh.quaternion);
    return forward.normalize();
  }

  /** Whether the player can currently take damage. */
  get canTakeDamage(): boolean {
    return this.alive && !this.isInvincible;
  }

  /** Whether enemies can track/see the player (false during spawn invincibility). */
  get canBeTracked(): boolean {
    return this.alive && !this.isInvincible;
  }

  /**
   * Kill the player.  Decrements lives and triggers respawn or game over.
   */
  die(): void {
    if (!this.canTakeDamage) return;

    this.alive = false;
    this.mesh.visible = false;
    this.lives -= 1;
    this.multiplier = 1;
    this.onDeath?.(this.mesh.position.clone());

    if (this.lives > 0) {
      // Respawn will be triggered externally after the death animation.
      // The caller should invoke respawn() after a short delay.
    }
  }

  /**
   * Add to the score multiplier (called when collecting geoms).
   */
  addMultiplier(amount: number): void {
    this.multiplier += amount;
  }

  /**
   * Add to the score.
   */
  addScore(basePoints: number): void {
    this.score += basePoints * this.multiplier;
  }

  /**
   * Tint the player mesh to a specific color.
   * Updates all MeshStandardMaterial (tubes/joints) and LineBasicMaterial children
   * to use the new color as both diffuse and emissive.
   */
  setColor(color: number): void {
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material;
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.color.setHex(color);
          mat.emissive.setHex(color);
        } else if (mat instanceof THREE.MeshBasicMaterial) {
          mat.color.setHex(color);
        }
      }
      if (child instanceof THREE.LineSegments) {
        const mat = child.material;
        if (mat instanceof THREE.LineBasicMaterial) {
          mat.color.setHex(color);
        }
      }
    });
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private fire(): void {
    // Compute world-space nose position and aim direction.
    // These rely on the mesh matrices being up to date, so
    // applySurfaceTransform should have been called this frame.
    this.mesh.updateMatrixWorld(true);
    const origin = this.getNoseWorldPosition();
    const direction = this.getAimDirection();

    // Delegate to weapon system if handler is set
    if (this.weaponFireHandler) {
      this.weaponFireHandler(origin, direction);
      return;
    }

    this.bulletPool.spawn(
      origin,
      direction,
      this.surfaceU,
      this.surfaceV,
      this.aimAngle,
    );

    this.onShoot?.(origin, direction);
  }
}
