import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildTriangle3D, buildDiamond3D } from '../../utils/GeometryBuilder';

// Pre-allocated temp objects - zero per-frame allocations
const _tempMatrix = new THREE.Matrix4();

interface SnakeSegData {
  u: number;
  v: number;
  mesh: THREE.Group;
}

const DEFAULT_HISTORY_SIZE = 80;
const SEGMENT_HISTORY_STEP = 8;  // frames between segments in history
const DEFAULT_INITIAL_SEGMENTS = 2;
const GROW_INTERVAL = 7;         // seconds between new segment spawns
/** Default max segments — overridable per-instance for late-game scaling (up to 50). */
const DEFAULT_MAX_SEGMENTS = 14;
const ORBIT_ANGULAR_SPEED = 0.7; // radians/sec — how fast it circles the player
const ORBIT_RADIUS = 0.28;       // UV units from player
const ORBIT_SHRINK_RATE = 0.002; // UV/sec — slowly tightens orbit
const ORBIT_RADIUS_MIN = 0.10;   // minimum orbit radius

/**
 * Snake enemy — a chained series of segments led by a large triangle head.
 *
 * Behavior: orbits around the player in a slow spiral, gradually tightening.
 * Each body segment follows the one ahead via a position-history queue.
 * Every GROW_INTERVAL seconds a new segment appears at the tail.
 *
 * Tactical challenge (risk/reward):
 * - Bullets hitting the snake (70% chance) peel the last tail segment,
 *   which immediately spawns as an independent Grunt.
 * - Bullets that slip through (30% chance) damage the head directly.
 * - Killing the head spawns ALL remaining segments as independent Grunts.
 * → Shooting it is always risky; ignoring it makes it grow.
 *
 * Visual:
 * - Head: large yellow-green triangle (buildTriangle3D)
 * - Segments: smaller green diamonds (buildDiamond3D)
 * - Segment meshes live in `segmentRoot` (a THREE.Group added to scene by EnemySpawner)
 */
export class Snake extends BaseEnemy {
  private segs: SnakeSegData[] = [];

  /** All segment meshes. EnemySpawner adds/removes this from the scene. */
  public readonly segmentRoot = new THREE.Group();

  private posHistory: Array<{ u: number; v: number }> = [];

  private orbitAngle: number;
  private orbitRadius: number = ORBIT_RADIUS;

  private growTimer: number = 0;

  /**
   * Maximum segments this snake can grow to. Configurable per-instance for late-game
   * wave scaling (e.g. wave 50 snakes grow to 50 segments — one snake = entire army).
   */
  private readonly maxSegments: number;

  /**
   * Position history buffer size — scales with maxSegments so all segments have
   * enough history to trail behind the head without collapsing to the tail position.
   * Formula: (maxSegments + 2) * SEGMENT_HISTORY_STEP
   */
  private readonly historySize: number;

  /** Fired when the head dies. Caller spawns Grunts at each segment position. */
  static onHeadDeath: ((segments: Array<{ u: number; v: number }>) => void) | null = null;

  /** Fired when a single tail segment is peeled off. Caller spawns one Grunt. */
  static onSegmentDeath: ((u: number, v: number) => void) | null = null;

  /**
   * @param u - Initial surface U coordinate
   * @param v - Initial surface V coordinate
   * @param maxSegments - Max body segments (default 14; use 30-50 for late-game waves)
   * @param initialSegments - Starting segment count (default 2; scales up to 10 with difficulty)
   */
  constructor(u: number = 0.5, v: number = 0.5, maxSegments: number = DEFAULT_MAX_SEGMENTS, initialSegments: number = DEFAULT_INITIAL_SEGMENTS) {
    // health=6, score=50, geoms=4, speed=0.03 (slow), radius=0.3
    super(u, v, 6, 50, 4, 0.03, 0.30);
    this.maxSegments = maxSegments;
    // Scale history buffer so the last segment always has a valid history entry
    this.historySize = Math.max(DEFAULT_HISTORY_SIZE, (maxSegments + 2) * SEGMENT_HISTORY_STEP);
    this.orbitAngle = Math.random() * Math.PI * 2; // randomise starting arc
    this.createMesh();
    this.initSegments(Math.min(initialSegments, maxSegments));
    // Register segmentRoot so generic cleanup code (network-main.ts) removes it from scene.
    this.auxiliaryObjects.push(this.segmentRoot);
  }

  private createMesh(): void {
    // Large yellow-green triangle head
    this.mesh = buildTriangle3D(0.40, 0xffdd00, 0.12, 0.025);
  }

  private createSegmentMesh(): THREE.Group {
    // Slightly smaller green diamond body segment
    return buildDiamond3D(0.16, 0x44ff88, 0.09, 0.016);
  }

  private initSegments(count: number): void {
    for (let i = 0; i < count; i++) {
      const mesh = this.createSegmentMesh();
      this.segmentRoot.add(mesh);
      this.segs.push({
        u: (((this.surfacePosition.u - (i + 1) * 0.09) % 1) + 1) % 1,
        v: this.surfacePosition.v,
        mesh,
      });
    }
  }

  private addSegment(): void {
    if (this.segs.length >= this.maxSegments) return;
    const last = this.segs[this.segs.length - 1];
    const mesh = this.createSegmentMesh();
    this.segmentRoot.add(mesh);
    this.segs.push({
      u: last ? last.u : this.surfacePosition.u,
      v: last ? last.v : this.surfacePosition.v,
      mesh,
    });
  }

  /** Peel the last segment and dispose its mesh. */
  private removeLastSegment(): void {
    const idx = this.segs.length - 1;
    const seg = this.segs[idx];
    this.segs.splice(idx, 1);
    this.segmentRoot.remove(seg.mesh);
    seg.mesh.traverse((child) => {
      const m = child as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((mt) => (mt as THREE.Material).dispose());
        else (m.material as THREE.Material).dispose();
      }
    });
  }

  // ─────────────────────────── damage / death ──────────────────────────────

  takeDamage(amount: number, attackerId: number = -1): void {
    // 70% chance: bullet hits a segment — peel tail, spawn as Grunt
    if (this.segs.length > 0 && Math.random() < 0.70) {
      const seg = this.segs[this.segs.length - 1];
      if (Snake.onSegmentDeath) {
        Snake.onSegmentDeath(seg.u, seg.v);
      }
      this.removeLastSegment();
      // Award partial score via the base death callback chain (handled externally)
    } else {
      // Hit the head directly
      super.takeDamage(amount, attackerId);
    }
  }

  die(): void {
    if (!this.alive) return;
    // Spawn remaining segments as independent Grunts
    if (Snake.onHeadDeath && this.segs.length > 0) {
      Snake.onHeadDeath(this.segs.map((s) => ({ u: s.u, v: s.v })));
    }
    super.die();
  }

  // ─────────────────────────── shared logic ────────────────────────────────

  /** Update segment UV positions from head's position history. Also handles growth. */
  private _updateSegmentsAndGrowth(dt: number): void {
    for (let i = 0; i < this.segs.length; i++) {
      const histIdx = Math.min((i + 1) * SEGMENT_HISTORY_STEP, this.posHistory.length - 1);
      if (histIdx < this.posHistory.length) {
        this.segs[i].u = this.posHistory[histIdx].u;
        this.segs[i].v = this.posHistory[histIdx].v;
      }
    }

    this.growTimer += dt;
    if (this.growTimer >= GROW_INTERVAL) {
      this.addSegment();
      this.growTimer = 0;
    }
  }

  // ─────────────────────────── UV movement mode ────────────────────────────

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Orbit around player in UV space
    this.orbitAngle += ORBIT_ANGULAR_SPEED * dt;
    this.orbitRadius = Math.max(ORBIT_RADIUS_MIN, this.orbitRadius - ORBIT_SHRINK_RATE * dt);

    const targetU = playerU + Math.cos(this.orbitAngle) * this.orbitRadius;
    const targetV = playerV + Math.sin(this.orbitAngle) * this.orbitRadius * 0.5; // V compressed

    const dU = targetU - this.surfacePosition.u;
    const dV = targetV - this.surfacePosition.v;
    const dist = Math.sqrt(dU * dU + dV * dV);

    if (dist > 0.001) {
      // Ease into position smoothly; cap movement to speed * dt
      const moveScale = Math.min(dist / 0.08, 1.0) * this.speed;
      this.surfacePosition.u += (dU / dist) * moveScale * dt;
      this.surfacePosition.v += (dV / dist) * moveScale * dt;
    }

    // Record position AFTER moving
    this.posHistory.unshift({ u: this.surfacePosition.u, v: this.surfacePosition.v });
    if (this.posHistory.length > this.historySize) this.posHistory.pop();

    this._updateSegmentsAndGrowth(dt);
  }

  // ─────────────────────────── Walker mode (world-space) ───────────────────

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    if (!this.walker) return null;

    // Record current UV position (bridged from last frame) to history
    this.posHistory.unshift({ u: this.surfacePosition.u, v: this.surfacePosition.v });
    if (this.posHistory.length > this.historySize) this.posHistory.pop();

    this._updateSegmentsAndGrowth(dt);

    // Orbit in world-space tangent plane
    this.orbitAngle += ORBIT_ANGULAR_SPEED * dt;
    this.orbitRadius = Math.max(ORBIT_RADIUS_MIN, this.orbitRadius - ORBIT_SHRINK_RATE * dt);

    const frame = this.walker.getTangentFrame();
    const toPlayer = playerWorldPos.clone().sub(this.walker.position);
    const distToPlayer = toPlayer.length();
    if (distToPlayer < 0.01) return null;
    toPlayer.normalize();

    // Project player direction onto tangent plane
    const tComp = toPlayer.dot(frame.tangent);
    const bComp = toPlayer.dot(frame.bitangent);

    // Orbit direction = 90° rotation of player direction in tangent plane
    // Plus a small inward bias so it slowly spirals in
    const inward = 0.15;
    const orbitT = -bComp + tComp * inward;
    const orbitB = tComp + bComp * inward;

    const moveDir = frame.tangent.clone()
      .multiplyScalar(orbitT)
      .add(frame.bitangent.clone().multiplyScalar(orbitB));

    if (moveDir.length() > 0.001) {
      return moveDir.normalize().multiplyScalar(this.speed * this.walkerSpeedScale);
    }

    return null;
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
    // Update head mesh (uses walker.position or UV transform)
    super.applySurfaceTransform(getTransform);

    // In MP mode, updateBehavior is not called (server is authoritative for positions),
    // so posHistory never gets filled and segments would stay at their initial spawn positions.
    // Detect this by checking if head has moved since the last history entry.
    // In SP, updateBehavior already recorded the same position → no duplicate added.
    const headU = this.surfacePosition.u;
    const headV = this.surfacePosition.v;
    const lastH = this.posHistory[0];
    if (!lastH || Math.abs(lastH.u - headU) > 0.0005 || Math.abs(lastH.v - headV) > 0.0005) {
      this.posHistory.unshift({ u: headU, v: headV });
      if (this.posHistory.length > this.historySize) this.posHistory.pop();
      // Update segment UV positions from history so they trail the head
      for (let i = 0; i < this.segs.length; i++) {
        const histIdx = Math.min((i + 1) * SEGMENT_HISTORY_STEP, this.posHistory.length - 1);
        if (histIdx < this.posHistory.length) {
          this.segs[i].u = this.posHistory[histIdx].u;
          this.segs[i].v = this.posHistory[histIdx].v;
        }
      }
    }

    // Update each segment mesh in world space
    // segmentRoot is at world origin — child positions ARE world positions
    for (const seg of this.segs) {
      const t = getTransform(seg.u, seg.v);
      seg.mesh.position.copy(t.position).addScaledVector(t.normal, this.radius);
      _tempMatrix.makeBasis(t.bitangent, t.normal, t.tangent);
      seg.mesh.quaternion.setFromRotationMatrix(_tempMatrix);
    }
  }

  // ─────────────────────────── cleanup ─────────────────────────────────────

  destroy(): void {
    for (const seg of this.segs) {
      this.segmentRoot.remove(seg.mesh);
      seg.mesh.traverse((child) => {
        const m = child as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mt) => (mt as THREE.Material).dispose());
          else (m.material as THREE.Material).dispose();
        }
      });
    }
    this.segs = [];
    super.destroy();
  }

  /** Expose segment positions for external debugging or special collision queries. */
  getSegmentData(): Array<{ u: number; v: number; radius: number }> {
    return this.segs.map((s) => ({ u: s.u, v: s.v, radius: 0.16 }));
  }
}
