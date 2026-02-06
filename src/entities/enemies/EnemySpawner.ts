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
import { Painter } from './Painter';
import { Virus } from './Virus';
import { Spawner } from './Spawner';
import { TitanGrunt } from './TitanGrunt';
import { TitanSpinner } from './TitanSpinner';
import { TitanWeaver } from './TitanWeaver';
import { Boss } from './Boss';

export type EnemyType =
  | 'wanderer' | 'grunt' | 'duck' | 'mayfly' | 'rocket' | 'neutron'
  | 'weaver' | 'spinner' | 'snake' | 'repulsor' | 'gravity_well' | 'gate'
  | 'painter' | 'virus' | 'spawner' | 'titan_grunt' | 'titan_spinner' | 'titan_weaver'
  | 'boss_sapphire' | 'boss_ruby' | 'boss_emerald' | 'boss_topaz' | 'boss_amethyst' | 'boss_opal';

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

/** Spawn warning indicator - pulsing ring at spawn location */
interface SpawnWarning {
  mesh: THREE.Mesh;
  u: number;
  v: number;
  age: number;
  duration: number;
  type: EnemyType;
}

const SPAWN_WARNING_DURATION = 0.8; // seconds before enemy materializes

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

  // Spawn warning indicators
  private spawnWarnings: SpawnWarning[] = [];
  private static warningGeometry: THREE.RingGeometry | null = null;
  private static warningMaterial: THREE.MeshBasicMaterial | null = null;

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

    // Shared warning geometry/material
    if (!EnemySpawner.warningGeometry) {
      EnemySpawner.warningGeometry = new THREE.RingGeometry(0.2, 0.35, 16);
    }
    if (!EnemySpawner.warningMaterial) {
      EnemySpawner.warningMaterial = new THREE.MeshBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    }
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
      case 'painter':
        enemy = new Painter(u, v);
        break;
      case 'virus':
        enemy = new Virus(u, v);
        break;
      case 'spawner':
        enemy = new Spawner(u, v);
        break;
      case 'titan_grunt':
        enemy = new TitanGrunt(u, v);
        break;
      case 'titan_spinner':
        enemy = new TitanSpinner(u, v);
        break;
      case 'titan_weaver':
        enemy = new TitanWeaver(u, v);
        break;
      case 'boss_sapphire':
        enemy = new Boss('sapphire', u, v);
        break;
      case 'boss_ruby':
        enemy = new Boss('ruby', u, v);
        break;
      case 'boss_emerald':
        enemy = new Boss('emerald', u, v);
        break;
      case 'boss_topaz':
        enemy = new Boss('topaz', u, v);
        break;
      case 'boss_amethyst':
        enemy = new Boss('amethyst', u, v);
        break;
      case 'boss_opal':
        enemy = new Boss('opal', u, v);
        break;
      default:
        enemy = new Wanderer(u, v);
    }

    // Create spawn warning indicator first
    const warningMesh = new THREE.Mesh(
      EnemySpawner.warningGeometry!,
      EnemySpawner.warningMaterial!.clone(),
    );
    const t = this.getTransform(u, v);
    warningMesh.position.copy(t.position).addScaledVector(t.normal, 0.05);
    warningMesh.lookAt(warningMesh.position.clone().add(t.normal));
    this.scene.add(warningMesh);

    this.spawnWarnings.push({
      mesh: warningMesh,
      u, v,
      age: 0,
      duration: SPAWN_WARNING_DURATION,
      type,
    });

    // Apply initial surface transform
    enemy.applySurfaceTransform(this.getTransform);

    // Start hidden - materializes when warning completes
    if (enemy.mesh) {
      this.scene.add(enemy.mesh);
      enemy.mesh.visible = false;
    }

    // Painter trail visuals need separate scene group
    if (enemy instanceof Painter) {
      this.scene.add(enemy.trailRoot);
    }

    // Add to enemies list (but hidden/invulnerable during warning)
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

    // Update spawn warnings
    for (let i = this.spawnWarnings.length - 1; i >= 0; i--) {
      const warning = this.spawnWarnings[i];
      warning.age += dt;
      const progress = warning.age / warning.duration;

      if (progress >= 1) {
        // Warning complete - materialize the enemy
        this.scene.remove(warning.mesh);
        (warning.mesh.material as THREE.MeshBasicMaterial).dispose();
        this.spawnWarnings.splice(i, 1);

        // Make enemy visible (find the hidden enemy at this position)
        for (const enemy of this.enemies) {
          if (enemy.mesh && !enemy.mesh.visible
              && Math.abs(enemy.surfacePosition.u - warning.u) < 0.001
              && Math.abs(enemy.surfacePosition.v - warning.v) < 0.001) {
            enemy.mesh.visible = true;
            // Scale-in effect
            enemy.mesh.scale.setScalar(0.01);
            break;
          }
        }
      } else {
        // Animate warning: pulse scale + fade
        const pulse = 1 + Math.sin(progress * Math.PI * 6) * 0.3;
        const scale = (1 - progress) * 1.5 + 0.5;
        warning.mesh.scale.setScalar(scale * pulse);
        (warning.mesh.material as THREE.MeshBasicMaterial).opacity =
          0.4 + Math.sin(progress * Math.PI * 4) * 0.4;

        // Reposition on surface (in case surface moves)
        const t = this.getTransform(warning.u, warning.v);
        warning.mesh.position.copy(t.position).addScaledVector(t.normal, 0.05);
        warning.mesh.lookAt(warning.mesh.position.clone().add(t.normal));
      }
    }

    // Update all enemies
    for (const enemy of this.enemies) {
      if (enemy.active) {
        // Skip updating enemies that haven't materialized yet
        if (enemy.mesh && !enemy.mesh.visible) continue;

        enemy.setPlayerPosition(playerU, playerV);
        enemy.update(dt);
        enemy.applySurfaceTransform(this.getTransform);

        // Scale-in newly materialized enemies
        if (enemy.mesh && enemy.mesh.scale.x < 1) {
          const newScale = Math.min(1, enemy.mesh.scale.x + dt * 3);
          enemy.mesh.scale.setScalar(newScale);
        }
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
        if (enemy instanceof Painter) {
          this.scene.remove(enemy.trailRoot);
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
      if (enemy instanceof Painter) {
        this.scene.remove(enemy.trailRoot);
      }
      enemy.destroy();
    }
    this.enemies = [];

    // Clean up any active spawn warnings
    for (const warning of this.spawnWarnings) {
      this.scene.remove(warning.mesh);
      (warning.mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    this.spawnWarnings = [];
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
