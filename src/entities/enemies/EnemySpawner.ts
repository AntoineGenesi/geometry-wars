import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { Wanderer } from './Wanderer';
import { Grunt } from './Grunt';
import { Duck } from './Duck';
import { Mayfly } from './Mayfly';
import { Rocket } from './Rocket';
import { Neutron } from './Neutron';
import { Weaver } from './Weaver';
import { Spinner } from './Spinner';
import { Snake } from './Snake';
import { Repulsor } from './Repulsor';
import { GravityWell } from './GravityWell';
import { Gate } from './Gate';

export type EnemyType =
  | 'wanderer' | 'grunt' | 'duck' | 'mayfly' | 'rocket' | 'neutron'
  | 'weaver' | 'spinner' | 'snake' | 'repulsor' | 'gravity_well' | 'gate';

export interface SpawnRegion {
  minU?: number;
  maxU?: number;
  minV?: number;
  maxV?: number;
}

export interface WaveEnemy {
  type: EnemyType;
  count: number;
  region?: SpawnRegion;
}

// Minimum distance from player for spawning (in UV space)
const MIN_SPAWN_DISTANCE = 0.25;
// Minimum distance between enemies (in UV space)
const MIN_ENEMY_SEPARATION = 0.05;
// Max attempts to find valid spawn position
const MAX_SPAWN_ATTEMPTS = 20;

export class EnemySpawner {
  private scene: THREE.Scene;
  private enemies: BaseEnemy[] = [];
  private getTransform: (u: number, v: number) => {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
  };

  // Track player position for spawn distance checks
  private playerU: number = 0;
  private playerV: number = 0;

  constructor(
    scene: THREE.Scene,
    getTransform: (u: number, v: number) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    }
  ) {
    this.scene = scene;
    this.getTransform = getTransform;
  }

  /** Set player position for spawn distance calculations */
  setPlayerPosition(u: number, v: number): void {
    this.playerU = u;
    this.playerV = v;
  }

  /** Calculate UV distance (wrapping-aware for toroidal surfaces) */
  private uvDistance(u1: number, v1: number, u2: number, v2: number): number {
    const du = Math.abs(u1 - u2);
    const dv = Math.abs(v1 - v2);
    return Math.sqrt(du * du + dv * dv);
  }

  /** Find a valid spawn position away from player and other enemies */
  private findValidSpawnPosition(minU: number, maxU: number, minV: number, maxV: number): { u: number, v: number } | null {
    for (let attempt = 0; attempt < MAX_SPAWN_ATTEMPTS; attempt++) {
      const u = minU + Math.random() * (maxU - minU);
      const v = minV + Math.random() * (maxV - minV);

      // Check distance from player
      const playerDist = this.uvDistance(u, v, this.playerU, this.playerV);
      if (playerDist < MIN_SPAWN_DISTANCE) {
        continue; // Too close to player, try again
      }

      // Check distance from other active enemies
      let tooClose = false;
      for (const enemy of this.enemies) {
        if (!enemy.active) continue;
        const enemyDist = this.uvDistance(u, v, enemy.surfacePosition.u, enemy.surfacePosition.v);
        if (enemyDist < MIN_ENEMY_SEPARATION) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        return { u, v };
      }
    }

    // Fallback: spawn at edge of region away from player
    const fallbackU = this.playerU < 0.5 ? maxU : minU;
    const fallbackV = this.playerV < 0.5 ? maxV : minV;
    return { u: fallbackU, v: fallbackV };
  }

  spawn(type: EnemyType, surfaceU?: number, surfaceV?: number): BaseEnemy {
    // Use provided position or find valid random position
    let u: number;
    let v: number;

    if (surfaceU !== undefined && surfaceV !== undefined) {
      u = surfaceU;
      v = surfaceV;
    } else {
      const validPos = this.findValidSpawnPosition(0, 1, 0, 1);
      u = validPos?.u ?? Math.random();
      v = validPos?.v ?? Math.random();
    }

    let enemy: BaseEnemy;

    switch (type) {
      case 'wanderer':
        enemy = new Wanderer(u, v);
        break;
      case 'grunt':
        enemy = new Grunt(u, v);
        break;
      case 'duck':
        enemy = new Duck(u, v);
        break;
      case 'mayfly':
        enemy = new Mayfly(u, v);
        break;
      case 'rocket':
        enemy = new Rocket(u, v);
        break;
      case 'neutron':
        enemy = new Neutron(u, v);
        break;
      case 'weaver':
        enemy = new Weaver(u, v);
        break;
      case 'spinner':
        enemy = new Spinner(u, v);
        break;
      case 'snake':
        enemy = new Snake(u, v);
        break;
      case 'repulsor':
        enemy = new Repulsor(u, v);
        break;
      case 'gravity_well':
        enemy = new GravityWell(u, v);
        break;
      case 'gate':
        enemy = new Gate(u, v);
        break;
      default:
        enemy = new Wanderer(u, v);
    }

    // Apply initial surface transform
    enemy.applySurfaceTransform(this.getTransform);

    // Add to scene if mesh exists
    if (enemy.mesh) {
      this.scene.add(enemy.mesh);
    }

    // Add to enemies list
    this.enemies.push(enemy);

    return enemy;
  }

  spawnWave(waveEnemies: WaveEnemy[]): void {
    for (const waveEnemy of waveEnemies) {
      const region = waveEnemy.region || {};
      const minU = region.minU !== undefined ? region.minU : 0;
      const maxU = region.maxU !== undefined ? region.maxU : 1;
      const minV = region.minV !== undefined ? region.minV : 0;
      const maxV = region.maxV !== undefined ? region.maxV : 1;

      for (let i = 0; i < waveEnemy.count; i++) {
        // Find valid position away from player and other enemies
        const validPos = this.findValidSpawnPosition(minU, maxU, minV, maxV);
        if (validPos) {
          this.spawn(waveEnemy.type, validPos.u, validPos.v);
        }
      }
    }
  }

  getEnemies(): BaseEnemy[] {
    return this.enemies;
  }

  update(dt: number, playerU: number, playerV: number): void {
    // Track player position for spawn calculations
    this.setPlayerPosition(playerU, playerV);

    // Update all enemies
    for (const enemy of this.enemies) {
      if (enemy.active) {
        enemy.setPlayerPosition(playerU, playerV);
        enemy.update(dt);
        enemy.applySurfaceTransform(this.getTransform);
      }
    }

    // Apply enemy separation (prevent overlapping)
    this.applySeparation(dt);

    // Remove dead enemies
    this.enemies = this.enemies.filter(enemy => {
      if (!enemy.active) {
        if (enemy.mesh) {
          this.scene.remove(enemy.mesh);
        }
        enemy.destroy();
        return false;
      }
      return true;
    });
  }

  clear(): void {
    for (const enemy of this.enemies) {
      if (enemy.mesh) {
        this.scene.remove(enemy.mesh);
      }
      enemy.destroy();
    }
    this.enemies = [];
  }

  getActiveCount(): number {
    return this.enemies.filter(e => e.active).length;
  }

  /** Apply gentle separation force between overlapping enemies */
  private applySeparation(dt: number): void {
    const separationStrength = 0.1; // How fast enemies push apart
    const minDist = MIN_ENEMY_SEPARATION;

    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      if (!a.active) continue;

      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (!b.active) continue;

        const du = a.surfacePosition.u - b.surfacePosition.u;
        const dv = a.surfacePosition.v - b.surfacePosition.v;
        const dist = Math.sqrt(du * du + dv * dv);

        if (dist < minDist && dist > 0.001) {
          // Push enemies apart
          const pushStrength = (minDist - dist) * separationStrength * dt;
          const normU = du / dist;
          const normV = dv / dist;

          a.surfacePosition.u += normU * pushStrength;
          a.surfacePosition.v += normV * pushStrength;
          b.surfacePosition.u -= normU * pushStrength;
          b.surfacePosition.v -= normV * pushStrength;

          // Clamp to surface bounds
          a.surfacePosition.u = Math.max(0, Math.min(1, a.surfacePosition.u));
          a.surfacePosition.v = Math.max(0, Math.min(1, a.surfacePosition.v));
          b.surfacePosition.u = Math.max(0, Math.min(1, b.surfacePosition.u));
          b.surfacePosition.v = Math.max(0, Math.min(1, b.surfacePosition.v));
        }
      }
    }
  }
}
