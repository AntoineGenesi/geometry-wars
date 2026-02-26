import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildTriangle3D, buildDiamond3D, buildCircle3D, buildChevron3D, buildPolygon3D } from '../../utils/GeometryBuilder';

// Pre-allocated temp objects — zero per-frame allocations
const _tempMatrix = new THREE.Matrix4();
const _tempQuat = new THREE.Quaternion();

const HISTORY_SIZE = 100;
const SEGMENT_HISTORY_STEP = 6; // frames between follower slots in history

export interface ChainedFollower {
  u: number;
  v: number;
  mesh: THREE.Group;
  enemyType: string; // 'grunt' | 'wanderer' | 'spinner' | 'titan_grunt' | 'rocket' | 'neutron'
  maxHealth: number;
  health: number;
  alive: boolean;
  row: number;      // 0 = left column, 1 = right column
  rowIndex: number; // position along the chain (0 = closest to head)
  spinAngle: number; // accumulated spin for follower animation
}

export type FractalSnakeHeadVariant = 'standard' | 'triple_inner' | 'double_outer' | 'pulsing';

export interface FractalSnakeConfig {
  numRows: 1 | 2;
  followersPerRow: number;
  followerTypes?: string[];
  headVariant?: FractalSnakeHeadVariant;
}

const DEFAULT_FOLLOWER_TYPES = ['grunt', 'wanderer', 'spinner', 'titan_grunt'];

/**
 * FractalSnake enemy — a large fractal triangle head that drags a double-row
 * chain of real enemy instances behind it.
 *
 * The head chases the player with a sinusoidal S-curve approach (same as GiantSnake).
 * Followers are held in formation via position-history UV offsets, not independent AI.
 *
 * Damage routing: takeDamage() hits the HEAD only.
 * Sub-task 3 handles routing damage to individual followers.
 *
 * Static callbacks:
 *   FractalSnake.onFollowerFreed — called when a follower is freed (sub-task 3)
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

  /** Called when a follower is freed (damaged to 0). Sub-task 3 wires this. */
  static onFollowerFreed: ((u: number, v: number, enemyType: string) => void) | null = null;

  /** Called when the head dies. Passes the FractalSnake instance so caller can triggerShock(). */
  static onHeadDeath: ((self: FractalSnake) => void) | null = null;

  // ─────────────────────────── shock effect state ──────────────────────────

  /** Lines drawn from head to followers during electric shock. */
  private _shockLines: THREE.Line[] = [];
  /** Time remaining on the shock effect (seconds). */
  private _shockTimeLeft: number = 0;
  /** Total duration of the shock effect. */
  private static readonly SHOCK_DURATION = 0.8;
  /** Scene reference during shock (needed to remove lines when done). */
  private _shockScene: THREE.Scene | null = null;
  /** Followers queued to be freed as shock progresses (indices into _followers). */
  private _shockFollowerQueue: number[] = [];

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
      headVariant: config?.headVariant ?? 'standard',
    };

    this.createMesh();
    this.initFollowers();

    // Register followerRoot so generic cleanup code removes it from scene
    this.auxiliaryObjects.push(this.followerRoot);
  }

  // ─────────────────────────── mesh creation ───────────────────────────────

  private createMesh(): void {
    const variant = this._config.headVariant ?? 'standard';

    switch (variant) {
      case 'triple_inner': {
        // Cyan outer + 3 inner triangles spinning in 3-way alternating directions
        const headGroup = buildTriangle3D(0.55, 0x00ffee, 0.14, 0.030);
        const innerSizes = [0.30, 0.20, 0.12];
        for (let i = 0; i < innerSizes.length; i++) {
          const inner = buildTriangle3D(innerSizes[i], 0xffffff, 0.08, 0.018);
          inner.rotation.z = (i * Math.PI * 2) / 3;
          headGroup.add(inner);
          this.innerTriangles.push(inner);
        }
        this.mesh = headGroup;
        break;
      }
      case 'double_outer': {
        // Magenta outer + cyan middle + 1 white inner
        const headGroup = new THREE.Group();
        const outer1 = buildTriangle3D(0.68, 0xff00ff, 0.10, 0.028);
        const outer2 = buildTriangle3D(0.52, 0x00ffee, 0.14, 0.026);
        headGroup.add(outer1);
        headGroup.add(outer2);
        const inner = buildTriangle3D(0.28, 0xffffff, 0.08, 0.018);
        headGroup.add(inner);
        this.innerTriangles.push(inner);
        this.mesh = headGroup;
        break;
      }
      case 'pulsing': {
        // Orange outer triangle, no inner triangles — head pulses in size
        const headGroup = buildTriangle3D(0.58, 0xff8800, 0.14, 0.030);
        this.mesh = headGroup;
        break;
      }
      case 'standard':
      default: {
        // Large outer triangle — bright cyan/teal + 2 inner spinning triangles
        const headGroup = buildTriangle3D(0.55, 0x00ffee, 0.14, 0.030);
        const innerSizes = [0.30, 0.18];
        for (let i = 0; i < innerSizes.length; i++) {
          const inner = buildTriangle3D(innerSizes[i], 0xffffff, 0.08, 0.018);
          inner.rotation.z = (i * Math.PI) / 2;
          headGroup.add(inner);
          this.innerTriangles.push(inner);
        }
        this.mesh = headGroup;
        break;
      }
    }
  }

  private createFollowerMesh(enemyType: string): THREE.Group {
    switch (enemyType) {
      case 'titan_grunt':
        // Large red diamond — visually big follower
        return buildDiamond3D(0.28, 0xff4444, 0.10, 0.020);
      case 'spinner':
        // Cyan ring — matches Spinner's color
        return buildCircle3D(0.18, 12, 0x44ffff, 0.07, 0.018);
      case 'rocket':
        // Small red chevron — recognizable rocket shape
        return buildChevron3D(0.22, 0.10, 0xff2200, 0.06, 0.016);
      case 'neutron':
        // Blue pentagon — matches Neutron's blue theme
        return buildPolygon3D(5, 0.16, 0x4488ff, 0.07, 0.016);
      case 'wanderer':
        // Orange ring/circle — matches Wanderer's color scheme
        return buildCircle3D(0.15, 8, 0xff8800, 0.07, 0.016);
      case 'grunt':
      default:
        // Small green diamond — matches Grunt's color
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

        const fHealth = enemyType === 'titan_grunt' ? 4 : 2;
        this._followers.push({
          u: this.surfacePosition.u,
          v: this.surfacePosition.v,
          mesh,
          enemyType,
          maxHealth: fHealth,
          health: fHealth,
          alive: true,
          row,
          rowIndex,
          spinAngle: Math.random() * Math.PI * 2, // random start angle for variety
        });
      }
    }
  }

  // ─────────────────────────── public API ──────────────────────────────────

  /**
   * Returns a snapshot of all follower states.
   * Used by sub-task 3 for damage routing and by spawner integration.
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

  // ─────────────────────────── damage / death ──────────────────────────────

  /**
   * Hits the HEAD only. Followers have their own health — sub-task 3 handles routing.
   */
  takeDamage(amount: number, attackerId: number = -1): void {
    super.takeDamage(amount, attackerId);
  }

  die(): void {
    if (!this.alive) return;

    // Fire callback with self so caller can invoke triggerShock()
    if (FractalSnake.onHeadDeath) {
      FractalSnake.onHeadDeath(this);
    }

    super.die();
  }

  // ─────────────────────────── follower collision ──────────────────────────

  /**
   * Hit-test a bullet (UV coords) against all alive followers.
   * Returns the index of the first follower within `radius` UV units, or null.
   */
  hitTestFollower(u: number, v: number, radius: number): number | null {
    const radiusSq = radius * radius;
    for (let i = 0; i < this._followers.length; i++) {
      const f = this._followers[i];
      if (!f.alive) continue;
      const du = u - f.u;
      const dv = v - f.v;
      if (du * du + dv * dv < radiusSq) return i;
    }
    return null;
  }

  /**
   * Apply damage to follower at `idx`.
   * Returns true if the follower died (health reached 0).
   * Fires `onFollowerFreed` when the follower dies.
   */
  damageFollower(idx: number, amount: number): boolean {
    const f = this._followers[idx];
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
    return false;
  }

  // ─────────────────────────── electric shock ──────────────────────────────

  /**
   * Trigger the electric shock death effect.
   * Creates cyan line segments from the head to each alive follower.
   * Over SHOCK_DURATION, followers are progressively freed (calling onFollowerFreed).
   * Called from EnemyDeathCallbacks when the head dies.
   */
  triggerShock(scene: THREE.Scene): void {
    if (this._shockTimeLeft > 0) return; // already shocking

    this._shockScene = scene;
    this._shockTimeLeft = FractalSnake.SHOCK_DURATION;

    // Apply immediate 50% maxHealth damage to all alive followers.
    // Followers that die fire onFollowerFreed now; survivors are released progressively.
    for (let i = 0; i < this._followers.length; i++) {
      const f = this._followers[i];
      if (!f.alive) continue;
      const damage = Math.max(1, Math.floor(f.maxHealth * 0.5));
      f.health -= damage;
      if (f.health <= 0) {
        f.alive = false;
        this.followerRoot.remove(f.mesh);
        if (FractalSnake.onFollowerFreed) {
          FractalSnake.onFollowerFreed(f.u, f.v, f.enemyType);
        }
      }
    }

    // Build queue of still-alive follower indices for progressive release
    this._shockFollowerQueue = this._followers
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => f.alive)
      .map(({ i }) => i);

    // Create shock lines: one line per alive follower, head → follower
    const headPos = this.position;
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00ffee,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (const idx of this._shockFollowerQueue) {
      const f = this._followers[idx];
      const points = [
        headPos.clone(),
        f.mesh.position.clone(),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geo, lineMat.clone());
      scene.add(line);
      this._shockLines.push(line);
    }
  }

  /**
   * Update the electric shock effect each frame.
   * Progressively frees followers as the shock duration elapses.
   * Call from GameLoop for all active FractalSnakes.
   */
  updateShockEffect(dt: number): void {
    if (this._shockTimeLeft <= 0) return;

    const prevTime = this._shockTimeLeft;
    this._shockTimeLeft -= dt;
    const elapsed = FractalSnake.SHOCK_DURATION - this._shockTimeLeft;
    const progress = elapsed / FractalSnake.SHOCK_DURATION;

    // Free followers progressively over the shock duration
    const totalFollowers = this._shockFollowerQueue.length;
    if (totalFollowers > 0) {
      const targetFreed = Math.floor(progress * totalFollowers);
      const currentFreed = totalFollowers - this._shockFollowerQueue.length;
      const toFree = Math.min(targetFreed - currentFreed, this._shockFollowerQueue.length);

      for (let i = 0; i < toFree; i++) {
        const idx = this._shockFollowerQueue.shift()!;
        const f = this._followers[idx];
        if (f && f.alive) {
          f.alive = false;
          this.followerRoot.remove(f.mesh);
          if (FractalSnake.onFollowerFreed) {
            FractalSnake.onFollowerFreed(f.u, f.v, f.enemyType);
          }
        }
      }
    }

    // Fade out shock lines
    const fadeOpacity = 1 - progress;
    for (const line of this._shockLines) {
      (line.material as THREE.LineBasicMaterial).opacity = Math.max(0, fadeOpacity * 0.9);
    }

    // Clean up when done
    if (this._shockTimeLeft <= 0) {
      this._removeShockLines();
    }
  }

  private _removeShockLines(): void {
    for (const line of this._shockLines) {
      this._shockScene?.remove(line);
      (line.geometry as THREE.BufferGeometry).dispose();
      (line.material as THREE.LineBasicMaterial).dispose();
    }
    this._shockLines = [];
    this._shockScene = null;
    this._shockFollowerQueue = [];
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

    // Pulsing head variant: scale the outer triangle when fully materialized
    if (this._config.headVariant === 'pulsing' && this.mesh && this.mesh.scale.x >= 1.0) {
      // Scale blooms outward (1.0 → 1.12 → 1.0) — always >= 1.0 to avoid scale-in conflict
      const pulseScale = 1.0 + 0.12 * Math.abs(Math.sin(this._innerAngle * 1.5));
      this.mesh.scale.setScalar(pulseScale);
    }

    // Update all follower mesh positions
    for (const follower of this._followers) {
      if (!follower.alive) continue; // mesh already removed from scene by damageFollower/shock

      const t = getTransform(follower.u, follower.v);
      follower.mesh.position.copy(t.position).addScaledVector(t.normal, this.radius);

      // Base orientation: aligned to surface
      _tempMatrix.makeBasis(t.bitangent, t.normal, t.tangent);
      follower.mesh.quaternion.setFromRotationMatrix(_tempMatrix);

      // Slow spin around surface normal — makes followers feel like trapped enemies
      follower.spinAngle += this._lastDt * 0.9;
      _tempQuat.setFromAxisAngle(t.normal, follower.spinAngle);
      follower.mesh.quaternion.multiply(_tempQuat);
    }
  }

  // ─────────────────────────── cleanup ─────────────────────────────────────

  destroy(): void {
    // Clean up any active shock lines
    this._removeShockLines();

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
    super.destroy();
  }
}
