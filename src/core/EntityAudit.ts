/**
 * EntityAudit - Comprehensive entity tracking and mismatch detection system.
 *
 * Captures per-frame snapshots of:
 * - Enemy count (from EnemySpawner) vs InstancedMesh instance count (from EnemyInstanceManager)
 * - Bullet count (from BulletPool) vs bullet InstancedMesh count
 * - Player position, velocity, and movement state
 * - Orphaned instances (InstancedMesh slots with no backing entity)
 * - Invisible entities (entity exists but has no InstancedMesh slot)
 *
 * Stores snapshots in a ring buffer for historical analysis.
 * Detects mismatches: count desync, player stuck, entity spawn/despawn spikes.
 *
 * Used by programmatic tests to verify entity/render consistency across
 * single-player, split-screen, and LAN multiplayer modes.
 */

import * as THREE from 'three';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';
import type { EnemySpawner } from '../entities/enemies/EnemySpawner';
import type { EnemyInstanceManager } from '../rendering/EnemyInstanceManager';
import type { BulletPool } from '../entities/Bullet';
import type { BulletInstanceManager } from '../rendering/BulletInstanceManager';
import type { Player } from '../entities/Player';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Snapshot of entity/render state at a single frame. */
export interface EntityAuditSnapshot {
  /** Frame number since audit start. */
  frameNumber: number;
  /** Wall-clock timestamp (ms since epoch). */
  timestamp: number;

  /** Enemy tracking. */
  enemies: {
    /** Alive enemies from EnemySpawner. */
    alive: number;
    /** Active InstancedMesh instances from EnemyInstanceManager. */
    instanced: number;
    /** InstancedMesh slots with no backing enemy. */
    orphanedInstances: number;
    /** Enemies with no InstancedMesh slot (invisible entities). */
    invisibleEntities: number;
  };

  /** Bullet tracking. */
  bullets: {
    /** Alive bullets from BulletPool. */
    alive: number;
    /** Active bullet InstancedMesh instances (if available). */
    instanced: number;
  };

  /** Player tracking. */
  player: {
    /** Surface UV coordinates. */
    u: number;
    v: number;
    /** World position. */
    worldX: number;
    worldY: number;
    worldZ: number;
    /** Velocity magnitude (UV space). */
    speed: number;
  };

  /** Human-readable mismatch descriptions (empty if no issues). */
  mismatches: string[];

  /** Performance metrics. */
  fps: number;
  drawCalls: number;
}

/** Audit context - references to entities and managers. */
export interface AuditContext {
  /** Enemy spawner (source of truth for alive enemies). */
  enemySpawner: EnemySpawner;
  /** Enemy instance manager (GPU batching). */
  enemyInstanceManager: EnemyInstanceManager | null;
  /** Bullet pool (source of truth for alive bullets). */
  bulletPool: BulletPool;
  /** Bullet instance manager (GPU batching for bullets). */
  bulletInstanceManager: BulletInstanceManager | null;
  /** Player (for position/velocity tracking). */
  player: Player;
  /** WebGLRenderer (for draw call stats). */
  renderer: THREE.WebGLRenderer;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default ring buffer size (300 = ~5 seconds at 60fps). */
const DEFAULT_HISTORY_SIZE = 300;

/** Player stuck threshold (speed below this for N frames = stuck). */
const STUCK_SPEED_THRESHOLD = 0.001;
const STUCK_FRAME_COUNT = 60; // 1 second at 60fps

/** Entity count change threshold (spike detection). */
const SPIKE_THRESHOLD = 10; // 10+ entities spawned/despawned in 1 frame

// ---------------------------------------------------------------------------
// Pre-allocated temp objects (zero-allocation design)
// ---------------------------------------------------------------------------

const _tempPos = new THREE.Vector3();

// ---------------------------------------------------------------------------
// EntityAudit
// ---------------------------------------------------------------------------

export class EntityAudit {
  /** Ring buffer of snapshots (fixed size, wraps around). */
  private readonly history: EntityAuditSnapshot[];
  /** Current write position in ring buffer. */
  private historyIndex = 0;
  /** Total snapshots captured (may exceed buffer size). */
  private totalSnapshots = 0;

  /** Frame counter (increments per capture). */
  private frameNumber = 0;

  /** Previous enemy count (for spike detection). -1 = not yet initialized. */
  private prevEnemyCount = -1;
  /** Previous bullet count (for spike detection). -1 = not yet initialized. */
  private prevBulletCount = -1;

  /** Player stuck detection: consecutive frames below threshold. */
  private stuckFrameCount = 0;

  constructor(historySize = DEFAULT_HISTORY_SIZE) {
    // Pre-allocate ring buffer
    this.history = new Array(historySize);
    for (let i = 0; i < historySize; i++) {
      this.history[i] = this.createEmptySnapshot();
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Capture a snapshot of entity/render state for the current frame.
   * Reuses pre-allocated snapshot objects (zero per-frame allocations).
   */
  capture(context: AuditContext): EntityAuditSnapshot {
    const snapshot = this.history[this.historyIndex];

    // Reset snapshot state
    snapshot.frameNumber = this.frameNumber++;
    snapshot.timestamp = Date.now();
    snapshot.mismatches.length = 0; // Clear array without allocation

    // -- Enemy tracking -----------------------------------------------------
    const enemies = context.enemySpawner.getEnemies();
    const aliveEnemies = enemies.filter((e: BaseEnemy) => e.active && e.alive);
    snapshot.enemies.alive = aliveEnemies.length;

    if (context.enemyInstanceManager) {
      const stats = context.enemyInstanceManager.getStats();
      snapshot.enemies.instanced = stats.totalInstances;

      // Mismatch: enemy count != instanced count
      const countMismatch = snapshot.enemies.alive - snapshot.enemies.instanced;
      if (countMismatch !== 0) {
        snapshot.mismatches.push(
          `Enemy count mismatch: ${snapshot.enemies.alive} alive, ${snapshot.enemies.instanced} instanced (delta: ${countMismatch})`
        );
      }

      // Orphaned instances: InstancedMesh slots with no backing enemy
      // (Detected by checking if instance count exceeds alive enemy count)
      snapshot.enemies.orphanedInstances = Math.max(0, snapshot.enemies.instanced - snapshot.enemies.alive);

      // Invisible entities: enemies with no InstancedMesh slot
      // (Detected by checking if alive enemy count exceeds instance count)
      snapshot.enemies.invisibleEntities = Math.max(0, snapshot.enemies.alive - snapshot.enemies.instanced);

      if (snapshot.enemies.orphanedInstances > 0) {
        snapshot.mismatches.push(
          `Orphaned instances: ${snapshot.enemies.orphanedInstances} InstancedMesh slots with no backing enemy`
        );
      }
      if (snapshot.enemies.invisibleEntities > 0) {
        snapshot.mismatches.push(
          `Invisible entities: ${snapshot.enemies.invisibleEntities} enemies with no InstancedMesh slot`
        );
      }
    } else {
      snapshot.enemies.instanced = 0;
      snapshot.enemies.orphanedInstances = 0;
      snapshot.enemies.invisibleEntities = 0;
    }

    // -- Bullet tracking ----------------------------------------------------
    snapshot.bullets.alive = context.bulletPool.activeCount;
    if (context.bulletInstanceManager) {
      const bulletStats = context.bulletInstanceManager.getStats();
      snapshot.bullets.instanced = bulletStats.totalActive;
      // Detect bullet count mismatch
      const bulletMismatch = snapshot.bullets.alive - snapshot.bullets.instanced;
      if (bulletMismatch !== 0) {
        snapshot.mismatches.push(
          `Bullet count mismatch: ${snapshot.bullets.alive} alive, ${snapshot.bullets.instanced} instanced (delta: ${bulletMismatch})`
        );
      }
    } else {
      snapshot.bullets.instanced = snapshot.bullets.alive;
    }

    // -- Player tracking ----------------------------------------------------
    snapshot.player.u = context.player.surfaceU;
    snapshot.player.v = context.player.surfaceV;

    // World position from mesh
    context.player.mesh.updateWorldMatrix(false, false);
    _tempPos.setFromMatrixPosition(context.player.mesh.matrixWorld);
    snapshot.player.worldX = _tempPos.x;
    snapshot.player.worldY = _tempPos.y;
    snapshot.player.worldZ = _tempPos.z;

    // Velocity magnitude
    const vU = context.player.velocityU;
    const vV = context.player.velocityV;
    snapshot.player.speed = Math.sqrt(vU * vU + vV * vV);

    // Player stuck detection
    if (snapshot.player.speed < STUCK_SPEED_THRESHOLD) {
      this.stuckFrameCount++;
      if (this.stuckFrameCount >= STUCK_FRAME_COUNT) {
        snapshot.mismatches.push(
          `Player stuck: velocity below ${STUCK_SPEED_THRESHOLD} for ${this.stuckFrameCount} frames`
        );
      }
    } else {
      this.stuckFrameCount = 0;
    }

    // -- Entity spawn/despawn spike detection -------------------------------
    // Skip spike detection on first frame (prevCount not yet initialized)
    if (this.prevEnemyCount >= 0) {
      const enemyDelta = Math.abs(snapshot.enemies.alive - this.prevEnemyCount);
      if (enemyDelta >= SPIKE_THRESHOLD) {
        snapshot.mismatches.push(
          `Enemy count spike: ${enemyDelta} enemies ${snapshot.enemies.alive > this.prevEnemyCount ? 'spawned' : 'despawned'} in 1 frame`
        );
      }
    }
    this.prevEnemyCount = snapshot.enemies.alive;

    if (this.prevBulletCount >= 0) {
      const bulletDelta = Math.abs(snapshot.bullets.alive - this.prevBulletCount);
      if (bulletDelta >= SPIKE_THRESHOLD) {
        snapshot.mismatches.push(
          `Bullet count spike: ${bulletDelta} bullets ${snapshot.bullets.alive > this.prevBulletCount ? 'spawned' : 'despawned'} in 1 frame`
        );
      }
    }
    this.prevBulletCount = snapshot.bullets.alive;

    // -- Performance metrics ------------------------------------------------
    // FPS is tracked externally (usually by PerformanceTracker), so we don't compute it here
    snapshot.fps = 0; // Caller can set this after capture if needed
    snapshot.drawCalls = context.renderer.info.render.calls;

    // -- Advance ring buffer ------------------------------------------------
    this.historyIndex = (this.historyIndex + 1) % this.history.length;
    this.totalSnapshots++;

    return snapshot;
  }

  /**
   * Get all snapshots in chronological order.
   * Returns a copy of the ring buffer unwrapped to correct order.
   */
  getHistory(): EntityAuditSnapshot[] {
    const count = Math.min(this.totalSnapshots, this.history.length);
    if (count === 0) return [];

    // Unwrap ring buffer: oldest snapshot first, newest last
    const result: EntityAuditSnapshot[] = [];
    if (this.totalSnapshots <= this.history.length) {
      // Buffer not yet wrapped - return in order
      for (let i = 0; i < count; i++) {
        result.push(this.cloneSnapshot(this.history[i]));
      }
    } else {
      // Buffer wrapped - start from current write position (oldest), wrap to end
      for (let i = 0; i < this.history.length; i++) {
        const idx = (this.historyIndex + i) % this.history.length;
        result.push(this.cloneSnapshot(this.history[idx]));
      }
    }
    return result;
  }

  /**
   * Get the most recent snapshot (or null if no snapshots captured).
   */
  getLatest(): EntityAuditSnapshot | null {
    if (this.totalSnapshots === 0) return null;
    const idx = (this.historyIndex + this.history.length - 1) % this.history.length;
    return this.cloneSnapshot(this.history[idx]);
  }

  /**
   * Get all frames with mismatches (frame number + issues).
   */
  getMismatches(): { frame: number; issues: string[] }[] {
    const result: { frame: number; issues: string[] }[] = [];
    const history = this.getHistory();
    for (const snapshot of history) {
      if (snapshot.mismatches.length > 0) {
        result.push({
          frame: snapshot.frameNumber,
          issues: [...snapshot.mismatches],
        });
      }
    }
    return result;
  }

  /**
   * Reset the audit state (clear all snapshots).
   */
  reset(): void {
    this.historyIndex = 0;
    this.totalSnapshots = 0;
    this.frameNumber = 0;
    this.prevEnemyCount = -1;
    this.prevBulletCount = -1;
    this.stuckFrameCount = 0;
    // Reset snapshot data
    for (let i = 0; i < this.history.length; i++) {
      const snapshot = this.history[i];
      snapshot.frameNumber = 0;
      snapshot.timestamp = 0;
      snapshot.enemies.alive = 0;
      snapshot.enemies.instanced = 0;
      snapshot.enemies.orphanedInstances = 0;
      snapshot.enemies.invisibleEntities = 0;
      snapshot.bullets.alive = 0;
      snapshot.bullets.instanced = 0;
      snapshot.player.u = 0;
      snapshot.player.v = 0;
      snapshot.player.worldX = 0;
      snapshot.player.worldY = 0;
      snapshot.player.worldZ = 0;
      snapshot.player.speed = 0;
      snapshot.mismatches.length = 0;
      snapshot.fps = 0;
      snapshot.drawCalls = 0;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private createEmptySnapshot(): EntityAuditSnapshot {
    return {
      frameNumber: 0,
      timestamp: 0,
      enemies: {
        alive: 0,
        instanced: 0,
        orphanedInstances: 0,
        invisibleEntities: 0,
      },
      bullets: {
        alive: 0,
        instanced: 0,
      },
      player: {
        u: 0,
        v: 0,
        worldX: 0,
        worldY: 0,
        worldZ: 0,
        speed: 0,
      },
      mismatches: [],
      fps: 0,
      drawCalls: 0,
    };
  }

  private cloneSnapshot(snapshot: EntityAuditSnapshot): EntityAuditSnapshot {
    return {
      frameNumber: snapshot.frameNumber,
      timestamp: snapshot.timestamp,
      enemies: { ...snapshot.enemies },
      bullets: { ...snapshot.bullets },
      player: { ...snapshot.player },
      mismatches: [...snapshot.mismatches],
      fps: snapshot.fps,
      drawCalls: snapshot.drawCalls,
    };
  }
}
