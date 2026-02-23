import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildTriangle3D, buildDiamond3D, buildCircle3D } from '../../utils/GeometryBuilder';

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

    // Update all follower mesh positions
    for (const follower of this._followers) {
      if (!follower.alive) {
        follower.mesh.visible = false;
        continue;
      }
      const t = getTransform(follower.u, follower.v);
      follower.mesh.position.copy(t.position).addScaledVector(t.normal, this.radius);
      _tempMatrix.makeBasis(t.bitangent, t.normal, t.tangent);
      follower.mesh.quaternion.setFromRotationMatrix(_tempMatrix);
    }
  }

  // ─────────────────────────── cleanup ─────────────────────────────────────

  destroy(): void {
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
