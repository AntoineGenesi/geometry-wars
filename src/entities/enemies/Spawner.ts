import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildSquare3D } from '../../utils/GeometryBuilder';

/**
 * Spawner enemy - stationary structure that periodically spawns small enemies.
 * Priority target: destroy ASAP or it floods the field.
 * Visual: large hollow dark purple cube (cage-like).
 */
export class Spawner extends BaseEnemy {
  private spawnTimer = 0;
  private readonly spawnInterval = 4.0; // seconds between spawns
  private readonly maxSpawns = 20; // max enemies it can produce before self-destructing
  private totalSpawned = 0;
  private pulsePhase = 0;

  /** Callback for game to handle spawning enemies near this spawner */
  public static onSpawnEnemy: ((u: number, v: number) => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5) {
    // health=12, score=300, geoms=3, speed=0.005 (nearly stationary), radius=0.5
    super(surfaceU, surfaceV, 12, 300, 3, 0.005, 0.5);
    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();

    // Large outer cage (red when invulnerable)
    const outer = buildSquare3D(0.5, 0xff2222, 0.08, 0.015);
    group.add(outer);

    // Inner rotating core (green when vulnerable)
    const inner = buildSquare3D(0.25, 0x00ff44, 0.06, 0.015);
    inner.name = 'inner-core';
    group.add(inner);

    this.mesh = group;
  }

  updateBehavior(dt: number, _playerU: number, _playerV: number): void {
    // Very slow drift (nearly stationary)
    const driftAngle = Date.now() * 0.00005;
    this.surfacePosition = {
      u: Math.max(0.05, Math.min(0.95,
        this.surfacePosition.u + Math.cos(driftAngle) * this.speed * dt)),
      v: Math.max(0.05, Math.min(0.95,
        this.surfacePosition.v + Math.sin(driftAngle) * this.speed * dt)),
    };

    // Spawn timer
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnInterval && this.totalSpawned < this.maxSpawns) {
      this.spawnTimer = 0;
      this.totalSpawned++;

      if (Spawner.onSpawnEnemy) {
        // Spawn at slight offset from this position
        const offsetU = (Math.random() - 0.5) * 0.08;
        const offsetV = (Math.random() - 0.5) * 0.08;
        Spawner.onSpawnEnemy(
          Math.max(0, Math.min(1, this.surfacePosition.u + offsetU)),
          Math.max(0, Math.min(1, this.surfacePosition.v + offsetV))
        );
      }

      // Flash on spawn
      this.pulsePhase = 0;
    }

    // Pulsing and inner core rotation
    this.pulsePhase += dt * 2;
    if (this.mesh) {
      const innerCore = this.mesh.getObjectByName('inner-core');
      if (innerCore) {
        innerCore.rotation.y += 3 * dt;
        innerCore.rotation.z += 2 * dt;
      }

      // Pulse scale when about to spawn
      const spawnProgress = this.spawnTimer / this.spawnInterval;
      const pulse = 1.0 + spawnProgress * 0.15;
      this.mesh.scale.setScalar(pulse);
    }
  }

  /** Get spawn progress (0-1) for visual feedback */
  getSpawnProgress(): number {
    return this.spawnTimer / this.spawnInterval;
  }

  computeMovementDirection(dt: number, _playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    // Update timers and state
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnInterval && this.totalSpawned < this.maxSpawns) {
      this.spawnTimer = 0;
      this.totalSpawned++;

      if (Spawner.onSpawnEnemy) {
        // Spawn at slight offset from this position
        // In walker mode, we still use UV offsets (game will convert to world space)
        const offsetU = (Math.random() - 0.5) * 0.08;
        const offsetV = (Math.random() - 0.5) * 0.08;

        // Get current UV from walker if available
        if (this.walker && this.surfaceRef) {
          const currentUV = this.surfaceRef.worldToSurface(this.walker.position);
          Spawner.onSpawnEnemy(
            Math.max(0, Math.min(1, currentUV.u + offsetU)),
            Math.max(0, Math.min(1, currentUV.v + offsetV))
          );
        }
      }

      // Flash on spawn
      this.pulsePhase = 0;
    }

    // Pulsing and inner core rotation
    this.pulsePhase += dt * 2;
    if (this.mesh) {
      const innerCore = this.mesh.getObjectByName('inner-core');
      if (innerCore) {
        innerCore.rotation.y += 3 * dt;
        innerCore.rotation.z += 2 * dt;
      }

      // Pulse scale when about to spawn
      const spawnProgress = this.spawnTimer / this.spawnInterval;
      const pulse = 1.0 + spawnProgress * 0.15;
      this.mesh.scale.setScalar(pulse);
    }

    // Very slow drift (nearly stationary)
    if (this.walker) {
      const driftAngle = Date.now() * 0.00005;
      const frame = this.walker.getTangentFrame();

      const tangentDir = frame.tangent.clone().multiplyScalar(Math.cos(driftAngle));
      const bitangentDir = frame.bitangent.clone().multiplyScalar(Math.sin(driftAngle));

      return tangentDir.add(bitangentDir).normalize().multiplyScalar(this.speed * this.walkerSpeedScale);
    }

    return null;
  }
}
