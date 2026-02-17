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
import { GiantWanderer } from './GiantWanderer';
import { GiantRocket } from './GiantRocket';
import { GiantSnake } from './GiantSnake';
import { GiantNeutron } from './GiantNeutron';
import { Boss } from './Boss';
import { Cluster } from './Cluster';
import { Helix } from './Helix';
import { Fractal } from './Fractal';
import { Swarm } from './Swarm';
import { Lurker } from './Lurker';
import { Orbiter } from './Orbiter';
import { Splitter } from './Splitter';
import { Phaser } from './Phaser';
import { ApproachGlow } from './ApproachGlow';
import { StealthStalker } from './StealthStalker';
import { EnemyInstanceManager } from '../../rendering/EnemyInstanceManager';
import type { EnemyDecoratorSystem } from '../../rendering/EnemyDecorators';
import type { DDASpawnModifier, PlayerPosition } from '../../difficulty/DDASpawnModifier';
import type { Surface } from '../../surfaces/Surface';
import { MeshWalker } from '../../movement/MeshWalker';
import type { MeshSurface } from '../../surfaces/MeshSurface';
import { profiler } from '../../core/PerformanceProfiler';

export type EnemyType =
  | 'wanderer' | 'grunt' | 'duck' | 'mayfly' | 'rocket' | 'neutron'
  | 'weaver' | 'spinner' | 'snake' | 'repulsor' | 'gravity_well' | 'gravity_well_red' | 'gate'
  | 'painter' | 'virus' | 'spawner' | 'titan_grunt' | 'titan_spinner' | 'titan_weaver'
  | 'giant_wanderer' | 'giant_rocket' | 'giant_snake' | 'giant_neutron'
  | 'cluster' | 'helix' | 'fractal' | 'swarm'
  | 'lurker' | 'orbiter' | 'splitter' | 'phaser'
  | 'approach_glow' | 'stealth_stalker'
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
  /** Difficulty tier for this group (0 = normal, 1+ = scaled). */
  tier?: number;
}

// Minimum distance from player for spawning (in UV space)
const MIN_SPAWN_DISTANCE = 0.25;
// Minimum distance between enemies (in UV space)
const MIN_ENEMY_SEPARATION = 0.05;

/** Hard cap on total enemy count to prevent O(n^2) separation from cratering FPS. */
const MAX_ENEMY_COUNT = 400;
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
  /** Generation for next splitter spawn (0 = default large, 1 = medium, 2 = tiny) */
  _nextSplitterGen: number = 0;
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

  /** Optional instance manager for GPU-batched rendering. */
  private instanceManager: EnemyInstanceManager | null = null;

  /** Optional decorator system for enemy visual embellishments. */
  private decoratorSystem: EnemyDecoratorSystem | null = null;

  /** Optional DDA spawn modifier for dynamic difficulty adjustment. */
  private ddaModifier: DDASpawnModifier | null = null;
  /** Player positions for DDA zone detection (updated externally). */
  private ddaPlayers: PlayerPosition[] = [];

  /**
   * Speed normalization factor from the surface. Enemies multiply their
   * base UV speed by this factor so that movement feels consistent across
   * surfaces of different sizes. Default 1.0 (no scaling).
   * Set via setSurfaceSpeedScale() after construction.
   */
  private surfaceSpeedScale: number = 1.0;

  /**
   * Reference to the current surface, used for:
   * - Per-position UV Jacobian correction (getUVScaleAt)
   * - Proper UV wrapping/clamping (wrapUV)
   * - Topology-aware separation forces (wrapsU/wrapsV)
   * Set via setSurface() after construction.
   */
  private surface: Surface | null = null;

  /**
   * MeshSurface for geodesic mesh walking. When set, spawned enemies
   * get a MeshWalker for surface-constrained movement without UV coordinates.
   * Set via setMeshSurface() after construction.
   */
  private meshSurface: MeshSurface | null = null;

  /** Player world-space position for mesh-walker-mode enemies. */
  private playerWorldPos: THREE.Vector3 = new THREE.Vector3();

  /**
   * Persistent transform cache keyed by integer-rounded UV coordinates.
   * Uses Map<number, transform> for O(1) lookup instead of O(n) linear scan.
   * NOT cleared every frame — transforms are stable for static surfaces.
   * Call clearTransformCache() only when the surface changes.
   *
   * Grid size 0.005 = 200×200 cells across UV space. Enemies moving at typical
   * speed (~0.3 UV/s) land in a new cell every ~1 second, keeping cache warm.
   */
  private readonly transformMap = new Map<number, {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
  }>();
  private readonly transformMapGridSize = 0.005; // UV grid resolution

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

  /** Set the instance manager for GPU-batched enemy rendering. */
  setInstanceManager(manager: EnemyInstanceManager): void {
    this.instanceManager = manager;
  }

  /** Get the instance manager (for external updates). */
  getInstanceManager(): EnemyInstanceManager | null {
    return this.instanceManager;
  }

  /** Set the decorator system for enemy visual embellishments (motes, cores). */
  setDecoratorSystem(system: EnemyDecoratorSystem): void {
    this.decoratorSystem = system;
  }

  /** Set the DDA spawn modifier for dynamic difficulty adjustment. */
  setDDAModifier(modifier: DDASpawnModifier): void {
    this.ddaModifier = modifier;
  }

  /** Update player positions for DDA zone detection. */
  setDDAPlayers(players: PlayerPosition[]): void {
    this.ddaPlayers = players;
  }

  /**
   * Set the surface speed normalization factor.
   * Enemies spawned after this call will have their speed multiplied
   * by this factor, ensuring consistent perceived speed across surfaces.
   * Get this value from surface.speedScale.
   */
  setSurfaceSpeedScale(scale: number): void {
    this.surfaceSpeedScale = scale;
  }

  /** Get the current surface speed scale (for debugging/inspection). */
  getSurfaceSpeedScale(): number {
    return this.surfaceSpeedScale;
  }

  /**
   * Set the surface reference for UV-aware enemy movement.
   * This enables per-position speed correction (UV Jacobian),
   * proper UV wrapping, and topology-aware separation forces.
   */
  setSurface(surface: Surface): void {
    this.surface = surface;
    // Surface changed — cached transforms are no longer valid
    this.transformMap.clear();
  }

  /** Get the current surface reference. */
  getSurface(): Surface | null {
    return this.surface;
  }

  /**
   * Set the MeshSurface for geodesic mesh walking.
   * When set, newly spawned enemies receive a MeshWalker for
   * surface-constrained movement (if they implement computeMovementDirection).
   */
  setMeshSurface(meshSurface: MeshSurface): void {
    this.meshSurface = meshSurface;
  }

  /** Get the current MeshSurface reference. */
  getMeshSurface(): MeshSurface | null {
    return this.meshSurface;
  }

  /** Set player position for spawn distance calculations */
  setPlayerPosition(u: number, v: number): void {
    this.playerU = u;
    this.playerV = v;
  }

  /** Set player world-space position for mesh-walker-mode enemies. */
  setPlayerWorldPosition(worldPos: THREE.Vector3): void {
    this.playerWorldPos.copy(worldPos);
  }

  /**
   * Get surface transform with persistent O(1) caching.
   * Snaps UV to a 0.005 grid for the key, so nearby positions share cache entries.
   * Cache persists across frames — surface transforms are stable for static surfaces.
   * Call clearTransformCache() when the surface changes.
   */
  private getCachedTransform(u: number, v: number): {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
  } {
    // Snap to grid and encode as a single integer key (O(1) Map lookup)
    const gs = this.transformMapGridSize;
    const iu = Math.round(u / gs) & 0x3FFF; // clamp to 14 bits (0..16383)
    const iv = Math.round(v / gs) & 0x3FFF;
    const key = (iu << 14) | iv; // 28-bit integer key, safe as JS number

    const cached = this.transformMap.get(key);
    if (cached) return cached;

    // Cache miss — compute and store (one-time cost per UV cell)
    const transform = this.getTransform(u, v);
    this.transformMap.set(key, transform);
    return transform;
  }

  /**
   * Clear the transform cache. Call when the surface changes to avoid stale transforms.
   */
  clearTransformCache(): void {
    this.transformMap.clear();
  }

  /** Calculate UV distance with proper wrapping for the current surface topology. */
  private uvDistance(u1: number, v1: number, u2: number, v2: number): number {
    let du = Math.abs(u1 - u2);
    let dv = Math.abs(v1 - v2);

    // Use shortest-path across UV seam for wrapping axes
    if (this.surface?.wrapsU ?? true) {
      if (du > 0.5) du = 1 - du;
    }
    if (this.surface?.wrapsV ?? false) {
      if (dv > 0.5) dv = 1 - dv;
    }

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

      // Check distance from other active enemies using spatial grid (O(1) vs O(n))
      // The sepGrid is populated by the most recent applySeparation() call.
      // Fall back to O(n) scan only if the grid hasn't been built yet.
      let tooClose = false;
      if (this.sepGrid.size > 0) {
        const invCell = 1 / this.sepCellSize;
        const cx = (u * invCell) | 0;
        const cy = (v * invCell) | 0;
        outerGrid: for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const key = (cx + dx) * 1009 + (cy + dy);
            const bucket = this.sepGrid.get(key);
            if (!bucket) continue;
            for (const idx of bucket) {
              const enemy = this.enemies[idx];
              if (!enemy?.active) continue;
              const enemyDist = this.uvDistance(u, v, enemy.surfacePosition.u, enemy.surfacePosition.v);
              if (enemyDist < MIN_ENEMY_SEPARATION) {
                tooClose = true;
                break outerGrid;
              }
            }
          }
        }
      } else {
        // First spawn in wave before any update: fall back to O(n) scan
        for (const enemy of this.enemies) {
          if (!enemy.active) continue;
          const enemyDist = this.uvDistance(u, v, enemy.surfacePosition.u, enemy.surfacePosition.v);
          if (enemyDist < MIN_ENEMY_SEPARATION) {
            tooClose = true;
            break;
          }
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

  spawn(type: EnemyType, surfaceU?: number, surfaceV?: number, tier: number = 0, skipSpawnWarning: boolean = false): BaseEnemy {
    // Hard cap: skip spawning if at max to prevent FPS crater from O(n^2) separation
    let activeCount = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].active) activeCount++;
    }
    if (activeCount >= MAX_ENEMY_COUNT) {
      // Return a dummy inactive enemy to avoid null returns; caller handles inactive enemies
      const dummy = new Wanderer(0, 0);
      dummy.active = false;
      return dummy;
    }

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
        enemy = new GravityWell(u, v, 'blue');
        break;
      case 'gravity_well_red':
        enemy = new GravityWell(u, v, 'red');
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
      case 'giant_wanderer':
        enemy = new GiantWanderer(u, v);
        break;
      case 'giant_rocket':
        enemy = new GiantRocket(u, v);
        break;
      case 'giant_snake':
        enemy = new GiantSnake(u, v);
        break;
      case 'giant_neutron':
        enemy = new GiantNeutron(u, v);
        break;
      case 'cluster':
        enemy = new Cluster(u, v);
        break;
      case 'helix':
        enemy = new Helix(u, v);
        break;
      case 'fractal':
        enemy = new Fractal(u, v);
        break;
      case 'swarm':
        enemy = new Swarm(u, v);
        break;
      case 'lurker':
        enemy = new Lurker(u, v);
        break;
      case 'orbiter':
        enemy = new Orbiter(u, v);
        break;
      case 'splitter':
        enemy = new Splitter(u, v, this._nextSplitterGen);
        this._nextSplitterGen = 0; // reset after use
        break;
      case 'phaser':
        enemy = new Phaser(u, v);
        break;
      case 'approach_glow':
        enemy = new ApproachGlow(u, v);
        break;
      case 'stealth_stalker':
        enemy = new StealthStalker(u, v);
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

    // Store the base type name for tier-based split spawning
    enemy.baseTypeName = type;

    // Apply surface speed normalization factor.
    // This scales ALL UV movement automatically in BaseEnemy.update(),
    // catching speed, currentSpeed, dashSpeed, chargeSpeed, etc.
    // without requiring changes to individual enemy subclasses.
    enemy.surfaceSpeedScale = this.surfaceSpeedScale;

    // Pass surface reference for per-position UV correction.
    // This routes enemy movement through moveOnSurface(), fixing
    // bunching at UV boundaries on non-toroidal surfaces.
    if (this.surface) {
      enemy.surfaceRef = this.surface;
    }

    // Apply difficulty tier scaling (stats, visuals, splitting behavior)
    if (tier > 0) {
      enemy.applyDifficultyTier(tier);
    }

    // Create MeshWalker for geodesic surface movement (if MeshSurface available).
    // The walker is created at the enemy's initial world position (from getTransform).
    // Enemy types that implement computeMovementDirection() will use the walker;
    // those that don't will continue using the UV code path in BaseEnemy.update().
    if (this.meshSurface) {
      const initialTransform = this.getTransform(u, v);
      enemy.walker = new MeshWalker(this.meshSurface, initialTransform.position, enemy.speed);
    }

    // Apply initial surface transform
    enemy.applySurfaceTransform(this.getTransform);

    // Try to register with instance manager for GPU-batched rendering
    const instanced = this.instanceManager?.register(enemy) ?? false;

    // Register with decorator system for orbiting motes + inner cores
    this.decoratorSystem?.register(enemy);

    if (skipSpawnWarning) {
      // Network mode: enemies appear instantly, no warning animation.
      // The server is authoritative for spawn timing, so the client
      // should show enemies immediately when the server reports them.
      enemy.isMaterializing = false;
      if (enemy.mesh) {
        if (!instanced) {
          this.scene.add(enemy.mesh);
          enemy.mesh.visible = true;
        }
        enemy.mesh.scale.setScalar(1);
      }
    } else {
      // Create spawn warning indicator (pulsing red ring)
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

      // Mark as materializing (spawn warning in progress)
      enemy.isMaterializing = true;

      // Start hidden - materializes when warning completes
      if (enemy.mesh) {
        if (!instanced) {
          // Non-instanced: add mesh to scene, hide until materialized
          this.scene.add(enemy.mesh);
          enemy.mesh.visible = false;
        }
        // Instanced enemies: mesh is already hidden by the instance manager,
        // and the individual mesh is NOT added to the scene (instance mesh handles rendering)
      }
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
    // Apply DDA modifications to the wave if modifier is set
    const modifiedWave = this.ddaModifier
      ? this.ddaModifier.modifyWave(waveEnemies, this.ddaPlayers)
      : waveEnemies;

    for (const waveEnemy of modifiedWave) {
      const region = waveEnemy.region || {};
      const minU = region.minU !== undefined ? region.minU : 0;
      const maxU = region.maxU !== undefined ? region.maxU : 1;
      const minV = region.minV !== undefined ? region.minV : 0;
      const maxV = region.maxV !== undefined ? region.maxV : 1;
      const tier = waveEnemy.tier ?? 0;

      for (let i = 0; i < waveEnemy.count; i++) {
        // Find valid position away from player and other enemies
        const validPos = this.findValidSpawnPosition(minU, maxU, minV, maxV);
        if (validPos) {
          // For individual spawns, also run DDA type modification based on actual position
          const finalType = this.ddaModifier
            ? this.ddaModifier.modifySpawnType(waveEnemy.type, validPos.u, validPos.v, this.ddaPlayers)
            : waveEnemy.type;
          this.spawn(finalType, validPos.u, validPos.v, tier);
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

        // Make enemy visible (find the materializing enemy at this position)
        for (const enemy of this.enemies) {
          if (enemy.isMaterializing
              && Math.abs(enemy.surfacePosition.u - warning.u) < 0.001
              && Math.abs(enemy.surfacePosition.v - warning.v) < 0.001) {
            enemy.isMaterializing = false;
            if (enemy.mesh) {
              if (!enemy.isInstanced) {
                enemy.mesh.visible = true;
              }
              // Scale-in effect
              enemy.mesh.scale.setScalar(0.01);
            }
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

        // Reposition on surface (in case surface moves) - use cached transform
        const t = this.getCachedTransform(warning.u, warning.v);
        warning.mesh.position.copy(t.position).addScaledVector(t.normal, 0.05);
        warning.mesh.lookAt(warning.mesh.position.clone().add(t.normal));
      }
    }

    // Update all enemies
    profiler.begin('enemy_loop_update');

    for (const enemy of this.enemies) {
      if (enemy.active) {
        // Skip updating enemies that haven't materialized yet
        if (enemy.isMaterializing) continue;

        enemy.setPlayerPosition(playerU, playerV);
        enemy.setPlayerWorldPosition(this.playerWorldPos);
        enemy.update(dt);

        // Use cached transform getter (avoids repeated trig/matrix ops for nearby enemies)
        enemy.applySurfaceTransform((u: number, v: number) => this.getCachedTransform(u, v));

        // Scale-in newly materialized enemies
        if (enemy.mesh && enemy.mesh.scale.x < 1) {
          const newScale = Math.min(1, enemy.mesh.scale.x + dt * 3);
          enemy.mesh.scale.setScalar(newScale);
        }
      }
    }
    profiler.end('enemy_loop_update');

    // Apply enemy separation (prevent overlapping)
    profiler.begin('enemy_separation');
    this.applySeparation(dt);
    profiler.end('enemy_separation');

    // Remove dead enemies — in-place compaction avoids new array allocation every frame
    let writeIdx = 0;
    for (let readIdx = 0; readIdx < this.enemies.length; readIdx++) {
      const enemy = this.enemies[readIdx];
      if (!enemy.active) {
        // Unregister from instance manager
        if (enemy.isInstanced && this.instanceManager) {
          this.instanceManager.unregister(enemy);
        }
        // Unregister from decorator system
        this.decoratorSystem?.unregister(enemy);
        if (enemy.mesh && !enemy.isInstanced) {
          this.scene.remove(enemy.mesh);
        }
        if (enemy instanceof Painter) {
          this.scene.remove(enemy.trailRoot);
        }
        enemy.destroy();
        // skip (don't copy to writeIdx)
      } else {
        this.enemies[writeIdx++] = enemy;
      }
    }
    this.enemies.length = writeIdx;
  }

  clear(): void {
    for (const enemy of this.enemies) {
      if (enemy.isInstanced && this.instanceManager) {
        this.instanceManager.unregister(enemy);
      }
      this.decoratorSystem?.unregister(enemy);
      if (enemy.mesh && !enemy.isInstanced) {
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
    let count = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i].active) count++;
    }
    return count;
  }

  /** Separation spatial grid — maps UV cells to enemy indices. Reused across frames. */
  private readonly sepGrid = new Map<number, number[]>();
  private readonly sepCellSize = MIN_ENEMY_SEPARATION * 2; // cell slightly larger than sep dist
  private readonly sepActiveIndices: number[] = [];

  /** Apply gentle separation force between nearby enemies.
   *  Uses a spatial grid to avoid O(n^2) brute force — only checks neighbors.
   *
   *  Fixed to handle UV wrapping: on surfaces where U or V wraps (torus,
   *  pipe, etc.), enemies near opposing UV boundaries now correctly repel
   *  each other across the seam. On non-wrapping surfaces (sphere poles,
   *  cube top/bottom), uses proper wrapUV() instead of hard clamping. */
  private applySeparation(dt: number): void {
    const separationStrength = 0.1;
    const minDist = MIN_ENEMY_SEPARATION;
    const minDistSq = minDist * minDist;
    const cellSize = this.sepCellSize;
    const invCell = 1 / cellSize;

    const uWraps = this.surface?.wrapsU ?? true;
    const vWraps = this.surface?.wrapsV ?? false;

    // Build spatial grid
    this.sepGrid.forEach(arr => { arr.length = 0; });
    this.sepActiveIndices.length = 0;

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.active) continue;
      this.sepActiveIndices.push(i);
      const cx = (e.surfacePosition.u * invCell) | 0;
      const cy = (e.surfacePosition.v * invCell) | 0;
      const key = cx * 1009 + cy;
      let bucket = this.sepGrid.get(key);
      if (!bucket) {
        bucket = [];
        this.sepGrid.set(key, bucket);
      }
      bucket.push(i);

      // For wrapping surfaces, also hash into wrapped neighbor cells
      // so enemies near u=0 find enemies near u=1 and vice versa
      if (uWraps) {
        const maxCell = (1.0 * invCell) | 0;
        if (cx <= 0) {
          const wrappedKey = maxCell * 1009 + cy;
          let wBucket = this.sepGrid.get(wrappedKey);
          if (!wBucket) { wBucket = []; this.sepGrid.set(wrappedKey, wBucket); }
          wBucket.push(i);
        }
        if (cx >= maxCell) {
          const wrappedKey = 0 * 1009 + cy;
          let wBucket = this.sepGrid.get(wrappedKey);
          if (!wBucket) { wBucket = []; this.sepGrid.set(wrappedKey, wBucket); }
          wBucket.push(i);
        }
      }
      if (vWraps) {
        const maxCell = (1.0 * invCell) | 0;
        if (cy <= 0) {
          const wrappedKey = cx * 1009 + maxCell;
          let wBucket = this.sepGrid.get(wrappedKey);
          if (!wBucket) { wBucket = []; this.sepGrid.set(wrappedKey, wBucket); }
          wBucket.push(i);
        }
        if (cy >= maxCell) {
          const wrappedKey = cx * 1009 + 0;
          let wBucket = this.sepGrid.get(wrappedKey);
          if (!wBucket) { wBucket = []; this.sepGrid.set(wrappedKey, wBucket); }
          wBucket.push(i);
        }
      }
    }

    // For each active enemy, check only neighboring cells
    for (const i of this.sepActiveIndices) {
      const a = this.enemies[i];
      const cx = (a.surfacePosition.u * invCell) | 0;
      const cy = (a.surfacePosition.v * invCell) | 0;

      // Check 3x3 neighborhood
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const key = (cx + dx) * 1009 + (cy + dy);
          const bucket = this.sepGrid.get(key);
          if (!bucket) continue;

          for (const j of bucket) {
            if (j <= i) continue; // avoid double-processing pairs

            const b = this.enemies[j];

            // Compute UV delta with wrapping awareness
            let du = a.surfacePosition.u - b.surfacePosition.u;
            let dv = a.surfacePosition.v - b.surfacePosition.v;

            // Shortest-path distance across UV seam for wrapping axes
            if (uWraps) {
              if (du > 0.5) du -= 1;
              else if (du < -0.5) du += 1;
            }
            if (vWraps) {
              if (dv > 0.5) dv -= 1;
              else if (dv < -0.5) dv += 1;
            }

            const distSq = du * du + dv * dv;

            if (distSq < minDistSq && distSq > 0.000001) {
              const dist = Math.sqrt(distSq);
              const pushStrength = (minDist - dist) * separationStrength * dt;
              const normU = du / dist;
              const normV = dv / dist;

              a.surfacePosition.u += normU * pushStrength;
              a.surfacePosition.v += normV * pushStrength;
              b.surfacePosition.u -= normU * pushStrength;
              b.surfacePosition.v -= normV * pushStrength;

              // Inline wrap/clamp using pre-computed wrapsU/vWraps flags — zero allocations.
              // The push is tiny (<0.001 UV/frame) so values rarely leave [0,1]; the
              // full surface.wrapUV() call was unnecessary here and allocates {u,v} objects.
              if (uWraps) {
                a.surfacePosition.u = ((a.surfacePosition.u % 1) + 1) % 1;
                b.surfacePosition.u = ((b.surfacePosition.u % 1) + 1) % 1;
              } else {
                a.surfacePosition.u = Math.max(0.005, Math.min(0.995, a.surfacePosition.u));
                b.surfacePosition.u = Math.max(0.005, Math.min(0.995, b.surfacePosition.u));
              }
              if (vWraps) {
                a.surfacePosition.v = ((a.surfacePosition.v % 1) + 1) % 1;
                b.surfacePosition.v = ((b.surfacePosition.v % 1) + 1) % 1;
              } else {
                a.surfacePosition.v = Math.max(0.005, Math.min(0.995, a.surfacePosition.v));
                b.surfacePosition.v = Math.max(0.005, Math.min(0.995, b.surfacePosition.v));
              }
            }
          }
        }
      }
    }
  }
}
