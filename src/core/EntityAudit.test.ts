/**
 * EntityAudit.test.ts - Unit tests for the EntityAudit system.
 *
 * Tests:
 * - Snapshot capture with mock objects
 * - Ring buffer behavior (fills up, wraps around)
 * - Mismatch detection (enemy count != instanced count)
 * - Player stuck detection
 * - Entity spawn/despawn spike detection
 * - Public API methods (getHistory, getLatest, getMismatches, reset)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { EntityAudit, AuditContext } from './EntityAudit';

// ---------------------------------------------------------------------------
// Mock objects
// ---------------------------------------------------------------------------

/** Mock BaseEnemy. */
class MockEnemy {
  active = true;
  alive = true;
  isInstanced = false;
  mesh = new THREE.Group();
}

/** Mock EnemySpawner. */
class MockEnemySpawner {
  private enemies: MockEnemy[] = [];

  spawn(count: number): void {
    for (let i = 0; i < count; i++) {
      this.enemies.push(new MockEnemy());
    }
  }

  kill(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.enemies.length > 0) {
        const enemy = this.enemies.pop()!;
        enemy.active = false;
        enemy.alive = false;
      }
    }
  }

  getEnemies() {
    return this.enemies;
  }

  clear(): void {
    this.enemies = [];
  }
}

/** Mock EnemyInstanceManager. */
class MockEnemyInstanceManager {
  private instanceCount = 0;

  register(count: number): void {
    this.instanceCount += count;
  }

  unregister(count: number): void {
    this.instanceCount = Math.max(0, this.instanceCount - count);
  }

  getStats() {
    return {
      batchCount: 1,
      totalInstances: this.instanceCount,
      typeBreakdown: new Map(),
      lodMediumInstances: 0,
      lodLowInstances: 0,
    };
  }

  reset(): void {
    this.instanceCount = 0;
  }
}

/** Mock BulletPool. */
class MockBulletPool {
  private bullets: { alive: boolean }[] = [];
  readonly root = new THREE.Group();

  spawn(count: number): void {
    for (let i = 0; i < count; i++) {
      this.bullets.push({ alive: true });
    }
  }

  kill(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.bullets.length > 0) {
        const bullet = this.bullets.pop()!;
        bullet.alive = false;
      }
    }
  }

  get activeCount(): number {
    return this.bullets.filter(b => b.alive).length;
  }

  clear(): void {
    this.bullets = [];
  }
}

/** Mock Player. */
class MockPlayer {
  surfaceU = 0.5;
  surfaceV = 0.5;
  velocityU = 0;
  velocityV = 0;
  mesh = new THREE.Group();

  constructor() {
    this.mesh.position.set(10, 0, 0);
  }
}

/** Mock WebGLRenderer. */
class MockRenderer {
  info = {
    render: {
      calls: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('EntityAudit', () => {
  let audit: EntityAudit;
  let context: AuditContext;
  let spawner: MockEnemySpawner;
  let instanceManager: MockEnemyInstanceManager;
  let bulletPool: MockBulletPool;
  let player: MockPlayer;
  let renderer: MockRenderer;

  beforeEach(() => {
    audit = new EntityAudit(10); // Small buffer for testing wrap behavior
    spawner = new MockEnemySpawner();
    instanceManager = new MockEnemyInstanceManager();
    bulletPool = new MockBulletPool();
    player = new MockPlayer();
    renderer = new MockRenderer();

    context = {
      enemySpawner: spawner as any,
      enemyInstanceManager: instanceManager as any,
      bulletPool: bulletPool as any,
      bulletInstanceManager: null,
      player: player as any,
      renderer: renderer as any,
    };
  });

  // -------------------------------------------------------------------------
  // Snapshot capture
  // -------------------------------------------------------------------------

  it('should capture a basic snapshot', () => {
    spawner.spawn(5);
    instanceManager.register(5);
    bulletPool.spawn(10);

    const snapshot = audit.capture(context);

    expect(snapshot.frameNumber).toBe(0);
    expect(snapshot.enemies.alive).toBe(5);
    expect(snapshot.enemies.instanced).toBe(5);
    expect(snapshot.bullets.alive).toBe(10);
    expect(snapshot.player.u).toBe(0.5);
    expect(snapshot.player.v).toBe(0.5);
    expect(snapshot.mismatches).toHaveLength(0);
  });

  it('should capture player world position', () => {
    const snapshot = audit.capture(context);
    expect(snapshot.player.worldX).toBe(10);
    expect(snapshot.player.worldY).toBe(0);
    expect(snapshot.player.worldZ).toBe(0);
  });

  it('should calculate player speed', () => {
    player.velocityU = 0.3;
    player.velocityV = 0.4;
    const snapshot = audit.capture(context);
    expect(snapshot.player.speed).toBeCloseTo(0.5, 5); // sqrt(0.3^2 + 0.4^2) = 0.5
  });

  it('should capture draw calls', () => {
    renderer.info.render.calls = 42;
    const snapshot = audit.capture(context);
    expect(snapshot.drawCalls).toBe(42);
  });

  // -------------------------------------------------------------------------
  // Mismatch detection
  // -------------------------------------------------------------------------

  it('should detect enemy count mismatch (more alive than instanced)', () => {
    spawner.spawn(10);
    instanceManager.register(5);

    const snapshot = audit.capture(context);
    expect(snapshot.enemies.alive).toBe(10);
    expect(snapshot.enemies.instanced).toBe(5);
    expect(snapshot.enemies.invisibleEntities).toBe(5);
    expect(snapshot.mismatches.length).toBeGreaterThan(0);
    expect(snapshot.mismatches.some(m => m.includes('Enemy count mismatch'))).toBe(true);
    expect(snapshot.mismatches.some(m => m.includes('Invisible entities'))).toBe(true);
  });

  it('should detect orphaned instances (more instanced than alive)', () => {
    spawner.spawn(5);
    instanceManager.register(10);

    const snapshot = audit.capture(context);
    expect(snapshot.enemies.alive).toBe(5);
    expect(snapshot.enemies.instanced).toBe(10);
    expect(snapshot.enemies.orphanedInstances).toBe(5);
    expect(snapshot.mismatches.length).toBeGreaterThan(0);
    expect(snapshot.mismatches.some(m => m.includes('Orphaned instances'))).toBe(true);
  });

  it('should detect player stuck (low velocity for many frames)', () => {
    player.velocityU = 0;
    player.velocityV = 0;

    // Capture 65 frames with zero velocity (stuck threshold is 60)
    for (let i = 0; i < 65; i++) {
      audit.capture(context);
    }

    const latest = audit.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.mismatches.some(m => m.includes('Player stuck'))).toBe(true);
  });

  it('should reset stuck counter when player moves', () => {
    player.velocityU = 0;
    player.velocityV = 0;

    // 30 frames stuck
    for (let i = 0; i < 30; i++) {
      audit.capture(context);
    }

    // Player moves
    player.velocityU = 0.1;
    player.velocityV = 0.1;
    audit.capture(context);

    // Stuck counter should reset
    player.velocityU = 0;
    player.velocityV = 0;
    for (let i = 0; i < 30; i++) {
      audit.capture(context);
    }

    const latest = audit.getLatest();
    expect(latest!.mismatches.some(m => m.includes('Player stuck'))).toBe(false);
  });

  it('should detect enemy spawn spike', () => {
    // First frame: 0 enemies
    audit.capture(context);

    // Second frame: 15 enemies spawned (spike threshold is 10)
    spawner.spawn(15);
    instanceManager.register(15);
    const snapshot = audit.capture(context);

    expect(snapshot.mismatches.some(m => m.includes('Enemy count spike'))).toBe(true);
    expect(snapshot.mismatches.some(m => m.includes('15 enemies spawned'))).toBe(true);
  });

  it('should detect enemy despawn spike', () => {
    // First frame: 20 enemies
    spawner.spawn(20);
    instanceManager.register(20);
    audit.capture(context);

    // Second frame: 15 enemies despawned
    spawner.kill(15);
    instanceManager.unregister(15);
    const snapshot = audit.capture(context);

    expect(snapshot.mismatches.some(m => m.includes('Enemy count spike'))).toBe(true);
    expect(snapshot.mismatches.some(m => m.includes('15 enemies despawned'))).toBe(true);
  });

  it('should detect bullet spawn spike', () => {
    audit.capture(context);

    bulletPool.spawn(12);
    const snapshot = audit.capture(context);

    expect(snapshot.mismatches.some(m => m.includes('Bullet count spike'))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Ring buffer behavior
  // -------------------------------------------------------------------------

  it('should fill ring buffer without wrapping', () => {
    for (let i = 0; i < 5; i++) {
      audit.capture(context);
    }

    const history = audit.getHistory();
    expect(history).toHaveLength(5);
    expect(history[0].frameNumber).toBe(0);
    expect(history[4].frameNumber).toBe(4);
  });

  it('should wrap ring buffer when full', () => {
    // Buffer size is 10, capture 15 snapshots
    for (let i = 0; i < 15; i++) {
      audit.capture(context);
    }

    const history = audit.getHistory();
    expect(history).toHaveLength(10); // Buffer size
    // Oldest snapshot should be frame 5 (frames 0-4 overwritten)
    expect(history[0].frameNumber).toBe(5);
    expect(history[9].frameNumber).toBe(14);
  });

  it('should maintain chronological order after wrap', () => {
    for (let i = 0; i < 25; i++) {
      audit.capture(context);
    }

    const history = audit.getHistory();
    expect(history).toHaveLength(10);

    // Check chronological order
    for (let i = 1; i < history.length; i++) {
      expect(history[i].frameNumber).toBe(history[i - 1].frameNumber + 1);
    }
  });

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  it('getLatest should return most recent snapshot', () => {
    audit.capture(context);
    spawner.spawn(5);
    audit.capture(context);
    spawner.spawn(5);
    const snapshot = audit.capture(context);

    const latest = audit.getLatest();
    expect(latest).not.toBeNull();
    expect(latest!.frameNumber).toBe(snapshot.frameNumber);
    expect(latest!.enemies.alive).toBe(10);
  });

  it('getLatest should return null when no snapshots', () => {
    const latest = audit.getLatest();
    expect(latest).toBeNull();
  });

  it('getMismatches should return only frames with issues', () => {
    // Frame 0: no issues
    audit.capture(context);

    // Frame 1: mismatch
    spawner.spawn(10);
    instanceManager.register(5);
    audit.capture(context);

    // Frame 2: no issues (fixed)
    instanceManager.register(5);
    audit.capture(context);

    const mismatches = audit.getMismatches();
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].frame).toBe(1);
    expect(mismatches[0].issues.length).toBeGreaterThan(0);
  });

  it('reset should clear all snapshots', () => {
    for (let i = 0; i < 5; i++) {
      audit.capture(context);
    }

    audit.reset();

    expect(audit.getLatest()).toBeNull();
    expect(audit.getHistory()).toHaveLength(0);
    expect(audit.getMismatches()).toHaveLength(0);
  });

  it('reset should restart frame counter', () => {
    for (let i = 0; i < 5; i++) {
      audit.capture(context);
    }

    audit.reset();
    const snapshot = audit.capture(context);

    expect(snapshot.frameNumber).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('should handle null enemyInstanceManager gracefully', () => {
    context.enemyInstanceManager = null;
    spawner.spawn(5);

    const snapshot = audit.capture(context);
    expect(snapshot.enemies.alive).toBe(5);
    expect(snapshot.enemies.instanced).toBe(0);
    expect(snapshot.enemies.orphanedInstances).toBe(0);
    expect(snapshot.enemies.invisibleEntities).toBe(0);
  });

  it('should handle zero entities', () => {
    const snapshot = audit.capture(context);
    expect(snapshot.enemies.alive).toBe(0);
    expect(snapshot.enemies.instanced).toBe(0);
    expect(snapshot.bullets.alive).toBe(0);
    expect(snapshot.mismatches).toHaveLength(0);
  });

  it('should handle rapid spawn/despawn cycles', () => {
    for (let i = 0; i < 5; i++) {
      spawner.spawn(20);
      instanceManager.register(20);
      audit.capture(context);

      spawner.kill(20);
      instanceManager.unregister(20);
      audit.capture(context);
    }

    const history = audit.getHistory();
    expect(history).toHaveLength(10); // 5 cycles * 2 snapshots = 10
  });

  // -------------------------------------------------------------------------
  // Integration scenarios
  // -------------------------------------------------------------------------

  it('should detect gradual entity count increase', () => {
    for (let i = 0; i < 10; i++) {
      spawner.spawn(2);
      instanceManager.register(2);
      audit.capture(context);
    }

    const history = audit.getHistory();
    expect(history[0].enemies.alive).toBe(2);
    expect(history[9].enemies.alive).toBe(20);

    // No spikes (gradual increase)
    const mismatches = audit.getMismatches();
    expect(mismatches.every(m => !m.issues.some(i => i.includes('spike')))).toBe(true);
  });

  it('should track player movement trajectory', () => {
    player.surfaceU = 0;
    player.surfaceV = 0;
    audit.capture(context);

    player.surfaceU = 0.1;
    player.surfaceV = 0.1;
    audit.capture(context);

    player.surfaceU = 0.2;
    player.surfaceV = 0.2;
    audit.capture(context);

    const history = audit.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0].player.u).toBe(0);
    expect(history[1].player.u).toBe(0.1);
    expect(history[2].player.u).toBe(0.2);
  });

  it('should handle multiple simultaneous mismatches', () => {
    // Cause multiple issues at once
    spawner.spawn(15); // Spike
    instanceManager.register(10); // Mismatch
    player.velocityU = 0; // Stuck (after 60 frames)

    for (let i = 0; i < 65; i++) {
      audit.capture(context);
    }

    const latest = audit.getLatest();
    expect(latest!.mismatches.length).toBeGreaterThan(1);
  });
});
