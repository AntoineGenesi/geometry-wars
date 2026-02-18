import * as THREE from 'three';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';

/**
 * LOD (Level of Detail) levels for enemy rendering.
 *
 * - HIGH: Full geometry (~50-200 triangles)
 * - MEDIUM: Simplified icosahedron (~20 triangles)
 * - LOW: Billboard quad (2 triangles)
 */
export enum LODLevel {
  HIGH = 0,
  MEDIUM = 1,
  LOW = 2,
}

/**
 * Distance thresholds and hysteresis for LOD transitions.
 */
export interface LODConfig {
  /** Max distance for HIGH detail (full geometry). */
  highDistance: number;
  /** Max distance for MEDIUM detail (simplified). Beyond this -> LOW. */
  mediumDistance: number;
  /** Hysteresis band to prevent flickering at boundaries. */
  hysteresis: number;
}

/** Defaults: keep full detail much longer (HIGH < 60, MEDIUM < 120).
 *  Previous values (20/50) caused enemies to appear as grey octagon shapes
 *  too close to the camera — visually jarring. */
export const DEFAULT_LOD_CONFIG: LODConfig = {
  highDistance: 60,
  mediumDistance: 120,
  hysteresis: 3,
};

/** Triangle count estimates per LOD level. */
const MEDIUM_TRIANGLE_COUNT = 20;
const LOW_TRIANGLE_COUNT = 2;

/** Pre-allocated temp objects to avoid per-frame GC pressure. */
const _tempVec3 = new THREE.Vector3();
const _tempMatrix = new THREE.Matrix4();
const _tempUp = new THREE.Vector3(0, 1, 0);

/**
 * LODGeometryCache - Creates and caches simplified geometries for
 * MEDIUM and LOW LOD levels. Shared across all enemy types.
 */
export class LODGeometryCache {
  private mediumGeo: THREE.BufferGeometry | null = null;
  private lowGeo: THREE.BufferGeometry | null = null;

  /**
   * Get the MEDIUM LOD geometry: an icosahedron with detail 0.
   * 20 faces = ~20 triangles -- sufficient for a "simplified enemy" silhouette.
   */
  getMediumGeometry(): THREE.BufferGeometry {
    if (!this.mediumGeo) {
      this.mediumGeo = new THREE.IcosahedronGeometry(0.3, 0);
    }
    return this.mediumGeo;
  }

  /**
   * Get the LOW LOD geometry: a single quad (2 triangles) for billboard rendering.
   * Vertices in XY plane, centered at origin, unit size (scaled per-instance).
   */
  getLowGeometry(): THREE.BufferGeometry {
    if (!this.lowGeo) {
      this.lowGeo = new THREE.PlaneGeometry(0.6, 0.6, 1, 1);
    }
    return this.lowGeo;
  }

  /**
   * Dispose all cached geometries.
   */
  dispose(): void {
    if (this.mediumGeo) {
      this.mediumGeo.dispose();
      this.mediumGeo = null;
    }
    if (this.lowGeo) {
      this.lowGeo.dispose();
      this.lowGeo = null;
    }
  }
}

/** Stats returned by getStats(). */
interface LODStats {
  high: number;
  medium: number;
  low: number;
  total: number;
}

/** Triangle reduction estimate. */
interface TriangleEstimate {
  /** Total triangles without any LOD (all enemies at full detail). */
  withoutLOD: number;
  /** Total triangles with LOD applied. */
  withLOD: number;
  /** Fraction of triangles saved (0..1). */
  reduction: number;
}

/**
 * LODManager - Assigns LOD levels to enemies based on camera distance.
 *
 * Designed to work alongside EnemyInstanceManager. Each frame, call
 * `update(camera, enemies)` to get a Map<BaseEnemy, LODLevel> that
 * the instance manager (or individual renderers) can use to select
 * which geometry/material to use per enemy.
 *
 * Features:
 * - Three LOD levels: HIGH (full), MEDIUM (simplified icosahedron), LOW (billboard)
 * - Hysteresis bands to prevent flickering at distance boundaries
 * - Billboard quaternion computation for LOW-level enemies
 * - Base color extraction from enemy meshes for billboard tinting
 * - Geometry cache for simplified/billboard geometries
 * - Performance stats and triangle reduction estimation
 */
export class LODManager {
  private config: LODConfig;
  private geometryCache: LODGeometryCache;

  /** Reusable assignment map (avoids allocating a new Map every frame). */
  private assignments: Map<BaseEnemy, LODLevel> = new Map();

  /** Previous-frame assignments for hysteresis comparison. */
  private previousLevels: Map<BaseEnemy, LODLevel> = new Map();

  /** Cached stats updated each frame. */
  private stats: LODStats = { high: 0, medium: 0, low: 0, total: 0 };

  constructor(config?: LODConfig) {
    this.config = config ? { ...config } : { ...DEFAULT_LOD_CONFIG };
    this.geometryCache = new LODGeometryCache();
  }

  /**
   * Update LOD assignments for all active enemies.
   *
   * @param camera - The active camera (used for distance computation).
   * @param enemies - Array of all enemies to evaluate.
   * @returns The same Map instance each frame (reused to avoid GC).
   */
  update(camera: THREE.Camera, enemies: BaseEnemy[]): Map<BaseEnemy, LODLevel> {
    this.assignments.clear();
    this.stats.high = 0;
    this.stats.medium = 0;
    this.stats.low = 0;
    this.stats.total = 0;

    const cameraPos = camera.position;

    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];

      if (!enemy.active || !enemy.alive) {
        continue;
      }

      const dist = _tempVec3.copy(enemy.position).distanceTo(cameraPos);
      const previousLevel = this.previousLevels.get(enemy);
      const level = this.computeLevel(dist, previousLevel);

      this.assignments.set(enemy, level);

      switch (level) {
        case LODLevel.HIGH:
          this.stats.high++;
          break;
        case LODLevel.MEDIUM:
          this.stats.medium++;
          break;
        case LODLevel.LOW:
          this.stats.low++;
          break;
      }
      this.stats.total++;
    }

    // Swap previous levels: copy current assignments for next frame's hysteresis
    this.previousLevels.clear();
    for (const [enemy, level] of this.assignments) {
      this.previousLevels.set(enemy, level);
    }

    return this.assignments;
  }

  /**
   * Compute LOD level from distance, applying hysteresis if there was a previous level.
   */
  private computeLevel(
    distance: number,
    previousLevel: LODLevel | undefined,
  ): LODLevel {
    const { highDistance, mediumDistance, hysteresis } = this.config;

    if (previousLevel === undefined) {
      // No previous level -> use raw thresholds
      if (distance <= highDistance) return LODLevel.HIGH;
      if (distance <= mediumDistance) return LODLevel.MEDIUM;
      return LODLevel.LOW;
    }

    // Apply hysteresis: require exceeding threshold + hysteresis to transition away,
    // but allow transitioning back at exactly the threshold.
    switch (previousLevel) {
      case LODLevel.HIGH:
        // Must exceed highDistance + hysteresis to drop to MEDIUM
        if (distance > highDistance + hysteresis) {
          if (distance > mediumDistance + hysteresis) return LODLevel.LOW;
          return LODLevel.MEDIUM;
        }
        return LODLevel.HIGH;

      case LODLevel.MEDIUM:
        // Can go back to HIGH if within highDistance
        if (distance <= highDistance) return LODLevel.HIGH;
        // Must exceed mediumDistance + hysteresis to drop to LOW
        if (distance > mediumDistance + hysteresis) return LODLevel.LOW;
        return LODLevel.MEDIUM;

      case LODLevel.LOW:
        // Can go back to MEDIUM if within mediumDistance
        if (distance <= mediumDistance) {
          if (distance <= highDistance) return LODLevel.HIGH;
          return LODLevel.MEDIUM;
        }
        return LODLevel.LOW;
    }
  }

  /**
   * Compute a quaternion that orients a billboard quad to face the camera.
   *
   * @param entityPos - World position of the entity.
   * @param cameraPos - World position of the camera.
   * @returns A quaternion that makes a quad face the camera.
   */
  static computeBillboardQuaternion(
    entityPos: THREE.Vector3,
    cameraPos: THREE.Vector3,
  ): THREE.Quaternion {
    const direction = _tempVec3.subVectors(cameraPos, entityPos);
    const lengthSq = direction.lengthSq();

    // Degenerate case: entity is at camera position
    if (lengthSq < 1e-10) {
      return new THREE.Quaternion();
    }

    direction.normalize();

    // Build a lookAt matrix from entity toward camera
    _tempMatrix.lookAt(entityPos, cameraPos, _tempUp);
    const quat = new THREE.Quaternion();
    quat.setFromRotationMatrix(_tempMatrix);

    return quat;
  }

  /**
   * Extract the base emissive/diffuse color from an enemy's mesh.
   * Traverses the mesh group and returns the first MeshStandardMaterial color found.
   *
   * @param enemy - The enemy to extract color from.
   * @returns The color, or null if no material found.
   */
  static extractBaseColor(enemy: BaseEnemy): THREE.Color | null {
    if (!enemy.mesh) return null;

    let color: THREE.Color | null = null;

    enemy.mesh.traverse((child) => {
      if (color) return; // Already found one
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        if (mat.emissive) {
          color = mat.emissive.clone();
        } else if (mat.color) {
          color = mat.color.clone();
        }
      }
    });

    return color;
  }

  /**
   * Get current LOD distribution statistics.
   */
  getStats(): LODStats {
    return { ...this.stats };
  }

  /**
   * Estimate triangle count reduction from LOD system.
   *
   * @param fullDetailTris - Average triangle count for a full-detail enemy.
   * @returns Triangle counts with and without LOD, and the reduction fraction.
   */
  estimateTriangleReduction(fullDetailTris: number): TriangleEstimate {
    const withoutLOD = this.stats.total * fullDetailTris;
    const withLOD =
      this.stats.high * fullDetailTris +
      this.stats.medium * MEDIUM_TRIANGLE_COUNT +
      this.stats.low * LOW_TRIANGLE_COUNT;

    return {
      withoutLOD,
      withLOD,
      reduction: withoutLOD > 0 ? 1 - withLOD / withoutLOD : 0,
    };
  }

  /**
   * Update LOD distance thresholds at runtime.
   * Called by the adaptive quality system when quality level changes —
   * lower quality levels use tighter distances so more enemies are rendered
   * at MEDIUM/LOW LOD, reducing GPU vertex load.
   */
  setConfig(config: Partial<LODConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get the shared geometry cache (for creating InstancedMesh batches per LOD level).
   */
  getGeometryCache(): LODGeometryCache {
    return this.geometryCache;
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    this.assignments.clear();
    this.previousLevels.clear();
    this.stats = { high: 0, medium: 0, low: 0, total: 0 };
    this.geometryCache.dispose();
  }
}
