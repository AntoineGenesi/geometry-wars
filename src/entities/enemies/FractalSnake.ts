import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildTriangle3D, buildDiamond3D, buildCircle3D } from '../../utils/GeometryBuilder';
import { ElectricShockEffect } from '../../rendering/ElectricShockEffect';

// Pre-allocated temp objects — zero per-frame allocations
const _tempMatrix = new THREE.Matrix4();

const HISTORY_SIZE = 100;
const SEGMENT_HISTORY_STEP = 6; // frames between follower slots in history

export interface ChainedFollower {
  u: number;
  v: number;
  mesh: THREE.Group;
  enemyType: string; // 'grunt' | 'wanderer' | 'spinner' | 'titan_grunt'
  maxHealth: number;
  health: number;
  alive: boolean;
  row: number;      // 0 = left column, 1 = right column
  rowIndex: number; // position along the chain (0 = closest to head)
}

export interface FractalSnakeConfig {
  numRows: 1 | 2;
  followersPerRow: number;
  followerTypes?: string[];
}

const DEFAULT_FOLLOWER_TYPES = ['grunt', 'wanderer', 'grunt', 'wanderer'];

/**
 * FractalSnake enemy — a large fractal triangle head that drags a double-row
 * chain of real enemy instances behind it.
 *
 * The head chases the player with a sinusoidal S-curve approach (same as GiantSnake).
 * Followers are held in formation via position-history UV offsets, not independent AI.
 *
 * Damage routing: takeDamage() hits the HEAD only.
 * Per-follower hit detection and damage is handled via hitTestFollower / damageFollower.
 *
 * Static callbacks:
 *   FractalSnake.onFollowerFreed — called when a follower is freed (damaged to death or shock end)
 *   FractalSnake.onHeadDeath     — called when head dies, passes all alive followers
 */
export class FractalSnake extends BaseEnemy {
  private _followers: ChainedFollower[] = [];

  /** All follower meshes. EnemySpawner adds/removes this from the scene. */
  public readonly followerRoot = new THREE.Group();

  private posHistory: Array<{ u: number; v: number }> = [];

  /** Inner spinning triangles stored for per-frame animation. Exposed for testability. */
  readonly innerTriangles: THREE.Group[] = [];

  /** Accumulated rotation angle for inner triangles (radians). */
  private _innerAngle: number = 0;

  /**
   * Last dt value set by updateBehavior / computeMovementDirection.
   * Used in applySurfaceTransform to animate inner triangles without needing dt.
   */
  private _lastDt: number = 0;

  private sinePhase: number = 0;
  private readonly sineAmplitude = 0.5;
  private readonly sineFrequency = 1.8;

  private readonly _config: FractalSnakeConfig;

  /** Flash timers per follower — when > 0 the follower mesh is tinted white. */
  private _flashTimers: number[] = [];

  /** Active electric shock effect, if any. */
  private _shockEffect: ElectricShockEffect | null = null;

  /** True while shock is running — after it completes, remaining alive followers are freed. */
  private _shockPending: boolean = false;

  /** Called when a follower is freed (damaged to 0, or freed after shock). */
  static onFollowerFreed: ((u: number, v: number, enemyType: string) => void) | null = null;

  /** Called when the head dies. Passes all currently alive follower positions. */
  static onHeadDeath: ((followers: Array<{ u: number; v: number; enemyType: string }>) => void) | null = null;

  constructor(
    u: number = 0.5,
    v: number = 0.5,
    config?: Partial<FractalSnakeConfig>,
  ) {
    // health=12, score=300, geomCount=8, speed=0.025, radius=0.55
    // Head is ~2-3x the size of a normal Snake head (0.40)
    super(u, v, 12, 300, 8, 0.025, 0.55);

    this._config = {
      numRows: config?.numRows ?? 2,
      followersPerRow: config?.followersPerRow ?? 4,
      followerTypes: config?.followerTypes ?? DEFAULT_FOLLOWER_TYPES,
    };

    this.createMesh();
    this.initFollowers();

    // Register followerRoot so generic cleanup code removes it from scene
    this.auxiliaryObjects.push(this.followerRoot);
  }

  // ─────────────────────────── mesh creation ───────────────────────────────

  private createMesh(): void {
    // Large outer triangle — bright cyan/teal
    const headGroup = buildTriangle3D(0.55, 0x00ffee, 0.14, 0.030);

    // 2 inner spinning triangles — white, smaller, added as children in head's local space
    const innerSizes = [0.30, 0.18];
    for (let i = 0; i < innerSizes.length; i++) {
      const inner = buildTriangle3D(innerSizes[i], 0xffffff, 0.08, 0.018);
      // Stagger starting angles so they don't overlap at spawn
      inner.rotation.z = (i * Math.PI) / 2;
      headGroup.add(inner);
      this.innerTriangles.push(inner);
    }

    this.mesh = headGroup;
  }

  private createFollowerMesh(enemyType: string): THREE.Group {
    switch (enemyType) {
      case 'titan_grunt':
        // Large red diamond — visually big follower
        return buildDiamond3D(0.28, 0xff4444, 0.10, 0.020);
      case 'spinner':
        // Small spinning ring/circle
        return buildCircle3D(0.18, 12, 0x44ffff, 0.07, 0.018);
      case 'grunt':
      case 'wanderer':
      default:
        // Small green diamond — same as Snake body segment
        return buildDiamond3D(0.16, 0x44ff88, 0.09, 0.016);
    }
  }

  private initFollowers(): void {
    const types = this._config.followerTypes ?? DEFAULT_FOLLOWER_TYPES;

    for (let row = 0; row < this._config.numRows; row++) {
      for (let rowIndex = 0; rowIndex < this._config.followersPerRow; rowIndex++) {
        const enemyType = types[rowIndex % types.length];
        const mesh = this.createFollowerMesh(enemyType);
        this.followerRoot.add(mesh);

        this._followers.push({
          u: this.surfacePosition.u,
          v: this.surfacePosition.v,
          mesh,
          enemyType,
          maxHealth: enemyType === 'titan_grunt' ? 4 : 2,
          health: enemyType === 'titan_grunt' ? 4 : 2,
          alive: true,
          row,
          rowIndex,
        });
        this._flashTimers.push(0);
      }
    }
  }

  // ─────────────────────────── public API ──────────────────────────────────

  /**
   * Returns a snapshot of all follower states.
   * Used by the spawner integration and for damage routing.
   */
  getFollowerData(): Array<{
    u: number;
    v: number;
    health: number;
    maxHealth: number;
    enemyType: string;
    alive: boolean;
    row: number;
    rowIndex: number;
  }> {
    return this._followers.map((f) => ({
      u: f.u,
      v: f.v,
      health: f.health,
      maxHealth: f.maxHealth,
      enemyType: f.enemyType,
      alive: f.alive,
      row: f.row,
      rowIndex: f.rowIndex,
    }));
  }

  /**
   * Test each alive follower's UV position against a bullet UV position.
   * @returns follower index if hit, null otherwise.
   */
  hitTestFollower(bulletU: number, bulletV: number, hitRadius: number): number | null {
    for (let i = 0; i < this._followers.length; i++) {
      const f = this._followers[i];
      if (!f.alive) continue;
      const du = f.u - bulletU;
      const dv = f.v - bulletV;
      if (Math.sqrt(du * du + dv * dv) < hitRadius) {
        return i;
      }
    }
    return null;
  }

  /**
   * Deal damage to a specific follower.
   * @returns true if the follower died, false if still alive.
   */
  damageFollower(index: number, amount: number): boolean {
    const f = this._followers[index];
    if (!f || !f.alive) return false;

    f.health -= amount;

    if (f.health <= 0) {
      f.alive = false;
      this.followerRoot.remove(f.mesh);
      if (FractalSnake.onFollowerFreed) {
        FractalSnake.onFollowerFreed(f.u, f.v, f.enemyType);
      }
      return true;
    }

    // Start white flash timer
    this._flashTimers[index] = 0.15;
    return false;
  }

  /**
   * Trigger the electric shock effect on head death.
   * - Creates lightning lines from head to each alive follower
   * - Deals 50% maxHealth damage to all alive followers
   * - After 0.8s, frees any still-alive followers
   *
   * Called externally by EnemyDeathCallbacks when head dies.
   */
  triggerShock(scene: THREE.Scene): void {
    const aliveFollowers = this._followers.filter((f) => f.alive);
    if (aliveFollowers.length === 0) return;

    // Collect world positions for the shock effect
    const headPos = this.mesh
      ? this.mesh.position.clone()
      : new THREE.Vector3(0, 0, 0);

    const targetPositions = aliveFollowers.map((f) => f.mesh.position.clone());

    // Create and trigger shock visual
    const effect = new ElectricShockEffect(scene);
    effect.trigger(headPos, targetPositions);
    this._shockEffect = effect;
    this._shockPending = true;

    // Apply 50% maxHealth damage to all alive followers
    for (let i = 0; i < this._followers.length; i++) {
      const f = this._followers[i];
      if (!f.alive) continue;
      const dmg = Math.ceil(f.maxHealth * 0.5);
      this.damageFollower(i, dmg);
    }
  }

  /**
   * Update the active shock effect and handle post-shock follower freeing.
   * Call this from applySurfaceTransform or a dedicated update path.
   */
  updateShockEffect(dt: number): void {
    if (!this._shockEffect) return;

    const wasActive = this._shockEffect.active;
    this._shockEffect.update(dt);

    if (wasActive && !this._shockEffect.active && this._shockPending) {
      // Shock has completed — free all still-alive followers
      this._shockPending = false;
      for (let i = 0; i < this._followers.length; i++) {
        const f = this._followers[i];
        if (!f.alive) continue;
        f.alive = false;
        this.followerRoot.remove(f.mesh);
        if (FractalSnake.onFollowerFreed) {
          FractalSnake.onFollowerFreed(f.u, f.v, f.enemyType);
        }
      }
      this._shockEffect.dispose();
      this._shockEffect = null;
    }
  }

  // ─────────────────────────── damage / death ──────────────────────────────

  /**
   * Hits the HEAD only. Followers have their own health — use damageFollower() for them.
   */
  takeDamage(amount: number, attackerId: number = -1): void {
    super.takeDamage(amount, attackerId);
  }

  die(): void {
    if (!this.alive) return;

    // Fire callback with all currently alive followers before dying
    if (FractalSnake.onHeadDeath) {
      const aliveFollowers = this._followers.filter((f) => f.alive);
      FractalSnake.onHeadDeath(
        aliveFollowers.map((f) => ({ u: f.u, v: f.v, enemyType: f.enemyType })),
      );
    }

    super.die();
  }

  // ─────────────────────────── UV movement mode ────────────────────────────

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this._lastDt = dt;
    this.sinePhase += this.sineFrequency * dt;

    const deltaU = playerU - this.surfacePosition.u;
    const deltaV = playerV - this.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance > 0.01) {
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;
      const perpU = -dirV;
      const perpV = dirU;
      const sineOffset = Math.sin(this.sinePhase) * this.sineAmplitude;

      this.surfacePosition.u += (dirU + perpU * sineOffset) * this.speed * dt;
      this.surfacePosition.v += (dirV + perpV * sineOffset) * this.speed * dt;
    }

    // Record position AFTER moving
    this.posHistory.unshift({ u: this.surfacePosition.u, v: this.surfacePosition.v });
    if (this.posHistory.length > HISTORY_SIZE) this.posHistory.pop();

    this._updateFollowerPositions();
  }

  // ─────────────────────────── Walker mode (world-space) ───────────────────

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    this._lastDt = dt;
    this.sinePhase += this.sineFrequency * dt;

    // Record current UV to history (synced from base class walker bridge)
    this.posHistory.unshift({ u: this.surfacePosition.u, v: this.surfacePosition.v });
    if (this.posHistory.length > HISTORY_SIZE) this.posHistory.pop();

    this._updateFollowerPositions();

    const toPlayer = playerWorldPos.clone().sub(this.walker.position);
    const distance = toPlayer.length();

    if (distance > 0.01) {
      const dirToPlayer = toPlayer.clone().normalize();
      const frame = this.walker.getTangentFrame();

      const tangentComponent = dirToPlayer.dot(frame.tangent);
      const bitangentComponent = dirToPlayer.dot(frame.bitangent);
      const perpTangent = -bitangentComponent;
      const perpBitangent = tangentComponent;

      const sineOffset = Math.sin(this.sinePhase) * this.sineAmplitude;

      const moveDir = frame.tangent.clone()
        .multiplyScalar(tangentComponent + perpTangent * sineOffset)
        .add(frame.bitangent.clone().multiplyScalar(bitangentComponent + perpBitangent * sineOffset));

      if (moveDir.length() > 0.001) {
        return moveDir.normalize().multiplyScalar(this.speed * this.walkerSpeedScale);
      }
    }

    return null;
  }

  // ─────────────────────────── shared logic ────────────────────────────────

  /** Update follower UV positions from position history queue. */
  private _updateFollowerPositions(): void {
    for (const follower of this._followers) {
      if (!follower.alive) continue;

      // Each rowIndex maps to a history slot: (rowIndex+1) * SEGMENT_HISTORY_STEP
      const histIdx = Math.min(
        (follower.rowIndex + 1) * SEGMENT_HISTORY_STEP,
        this.posHistory.length - 1,
      );

      if (histIdx < this.posHistory.length) {
        const pos = this.posHistory[histIdx];
        follower.u = pos.u;
        // Double-row offset: row 0 → V - 0.03, row 1 → V + 0.03 (perpendicular to trail)
        const vOffset = follower.row === 0 ? -0.03 : 0.03;
        follower.v = pos.v + vOffset;
      }
    }
  }

  // ─────────────────────────── surface transform ───────────────────────────

  applySurfaceTransform(
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    // Update head mesh position/orientation via base class
    super.applySurfaceTransform(getTransform);

    // Animate inner spinning triangles (counter-rotate in head's local space)
    const rotSpeed = 1.5; // rad/s
    this._innerAngle += this._lastDt * rotSpeed;
    for (let i = 0; i < this.innerTriangles.length; i++) {
      const dir = i % 2 === 0 ? 1 : -1; // alternate rotation direction
      this.innerTriangles[i].rotation.z = this._innerAngle * dir;
    }

    // Update shock effect
    this.updateShockEffect(this._lastDt);

    // Update all follower mesh positions and flash effects
    for (let i = 0; i < this._followers.length; i++) {
      const follower = this._followers[i];

      if (!follower.alive) {
        follower.mesh.visible = false;
        continue;
      }

      const t = getTransform(follower.u, follower.v);
      follower.mesh.position.copy(t.position).addScaledVector(t.normal, this.radius);
      _tempMatrix.makeBasis(t.bitangent, t.normal, t.tangent);
      follower.mesh.quaternion.setFromRotationMatrix(_tempMatrix);

      // Flash effect: tint emissive white while timer > 0
      if (this._flashTimers[i] > 0) {
        this._flashTimers[i] -= this._lastDt;
        follower.mesh.traverse((child) => {
          const m = child as THREE.Mesh;
          if (m.isMesh && m.material) {
            const mat = m.material as THREE.MeshStandardMaterial;
            if (mat.emissive) {
              mat.emissive.set(0xffffff);
            }
          }
        });
      } else if (this._flashTimers[i] < 0) {
        // Timer just expired — restore original emissive color
        this._flashTimers[i] = 0;
        follower.mesh.traverse((child) => {
          const m = child as THREE.Mesh;
          if (m.isMesh && m.material) {
            const mat = m.material as THREE.MeshStandardMaterial;
            if (mat.emissive && mat.color) {
              mat.emissive.copy(mat.color);
            }
          }
        });
      }
    }
  }

  // ─────────────────────────── cleanup ─────────────────────────────────────

  destroy(): void {
    if (this._shockEffect) {
      this._shockEffect.dispose();
      this._shockEffect = null;
    }
    for (const follower of this._followers) {
      this.followerRoot.remove(follower.mesh);
      follower.mesh.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) {
            m.material.forEach((mt) => (mt as THREE.Material).dispose());
          } else {
            (m.material as THREE.Material).dispose();
          }
        }
      });
    }
    this._followers = [];
    this._flashTimers = [];
    super.destroy();
  }
}
