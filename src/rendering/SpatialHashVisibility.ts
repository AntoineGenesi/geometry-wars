/**
 * SpatialHashVisibility — Per-instance entity dimming based on player proximity.
 *
 * Problem: Depth-occlusion raycasting works for geometrically occluded enemies
 * (enemies behind a surface), but fails for enemies on the far side of complex
 * surfaces like toruses where raycasts pass through open space (the hole).
 *
 * Solution: Partition 3D space into a grid. Enemies in cells far from the
 * player's cell are dimmed regardless of geometric occlusion. This correctly
 * hides enemies that are geographically far away on ANY surface shape.
 *
 * The "spatial hash" is a 3D integer grid where each cell covers `cellSize`
 * world units on each axis. Cells close to the player's cell are fully visible;
 * cells farther away fade to `dimOpacity`. Opacity transitions are smoothed
 * with per-enemy lerping to prevent visual popping.
 *
 * Works WITH depth occlusion: the render loop combines both opacities using
 * Math.min() — dim if EITHER far-from-player OR behind a surface.
 * The per-enemy proximity override in RenderLoop keeps close enemies always
 * bright regardless of this system.
 *
 * Performance: Zero per-frame GC. Cell key computed with integer arithmetic.
 * WeakMap used for per-enemy state — dead enemies are GC'd automatically.
 */

import * as THREE from 'three';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';

// Pre-allocated (module-level) to avoid per-frame allocation
const _playerCellKey = { cx: 0, cy: 0, cz: 0 };

/** Configuration for the spatial hash visibility system. */
export interface SpatialVisibilityConfig {
  /**
   * Size of each grid cell in world units.
   * Smaller = finer granularity but more cell transitions.
   * Default: 6.0
   */
  cellSize: number;

  /**
   * Cell-distance within which enemies are fully visible (opacity = 1.0).
   * Uses euclidean distance between cell coordinates.
   * Default: 2.0 cells (~12 world units at cellSize=6)
   */
  nearCellRadius: number;

  /**
   * Cell-distance at which enemies reach minimum opacity (`dimOpacity`).
   * Enemies between nearCellRadius and fadeCellRadius are smoothly faded.
   * Default: 5.0 cells (~30 world units at cellSize=6)
   */
  fadeCellRadius: number;

  /**
   * Minimum opacity for enemies beyond fadeCellRadius.
   * 0.0 = invisible, 0.08 = faint glow (matches depth-occlusion far preset).
   * Default: 0.08
   */
  dimOpacity: number;

  /**
   * How fast per-enemy opacity lerps toward its target (per second).
   * Higher = snappier transitions. Default: 6.0
   */
  lerpSpeed: number;
}

/** Default config tuned for sphere/torus gameplay clarity. */
export const DEFAULT_SPATIAL_VISIBILITY_CONFIG: SpatialVisibilityConfig = {
  cellSize: 6.0,
  nearCellRadius: 2.0,
  fadeCellRadius: 5.0,
  dimOpacity: 0.08,
  lerpSpeed: 6.0,
};

/** Per-enemy internal state (WeakMap value). */
interface EnemyEntry {
  /** Current smoothed opacity (lerped each frame). */
  currentOpacity: number;
  /** Target opacity based on current cell distance. */
  targetOpacity: number;
}

/**
 * SpatialHashVisibility — per-instance dimming using player-centric grid cells.
 *
 * Usage:
 *   // Once per frame (in render loop):
 *   spatialVis.update(allEnemies, player.position, dt);
 *   // Per enemy (combine with depth occlusion):
 *   const vis = Math.min(depthOcclusion.getOpacity(enemy), spatialVis.getOpacity(enemy));
 */
export class SpatialHashVisibility {
  private readonly config: SpatialVisibilityConfig;
  private readonly invCellSize: number;
  /**
   * WeakMap: no manual cleanup required. Dead enemies are GC'd automatically.
   * Replaced on `clear()` to drop all entries (WeakMap has no .clear()).
   */
  private entries: WeakMap<object, EnemyEntry> = new WeakMap();

  constructor(config: Partial<SpatialVisibilityConfig> = {}) {
    this.config = { ...DEFAULT_SPATIAL_VISIBILITY_CONFIG, ...config };
    this.invCellSize = 1 / this.config.cellSize;
  }

  /**
   * Main per-frame update.
   * Computes target opacity for each enemy based on its cell distance from the
   * player's cell, then lerps current opacity toward the target.
   *
   * Call once per frame before reading opacities.
   *
   * @param enemies - All alive enemies to process.
   * @param playerPos - World-space player position (camera proxy for surface proximity).
   * @param dt - Frame delta time in seconds (for lerp smoothing).
   */
  update(enemies: BaseEnemy[], playerPos: THREE.Vector3, dt: number): void {
    const invCS = this.invCellSize;
    const lerpFactor = Math.min(1.0, this.config.lerpSpeed * dt);

    // Compute player's cell coordinates (integer grid)
    _playerCellKey.cx = Math.floor(playerPos.x * invCS) | 0;
    _playerCellKey.cy = Math.floor(playerPos.y * invCS) | 0;
    _playerCellKey.cz = Math.floor(playerPos.z * invCS) | 0;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      // Enemy cell coordinates
      const ecx = (Math.floor(enemy.position.x * invCS) | 0) - _playerCellKey.cx;
      const ecy = (Math.floor(enemy.position.y * invCS) | 0) - _playerCellKey.cy;
      const ecz = (Math.floor(enemy.position.z * invCS) | 0) - _playerCellKey.cz;

      // Euclidean distance in cell space (avoids per-frame sqrt on world coords)
      const cellDist = Math.sqrt(ecx * ecx + ecy * ecy + ecz * ecz);
      const targetOpacity = this._cellDistToOpacity(cellDist);

      // Get or create entry — initialize currentOpacity to target on first appearance
      // (no lerp-in flash from 1.0 for enemies that spawn far away)
      let entry = this.entries.get(enemy);
      if (!entry) {
        entry = { currentOpacity: targetOpacity, targetOpacity };
        this.entries.set(enemy, entry);
      } else {
        entry.targetOpacity = targetOpacity;
        // Lerp toward target
        entry.currentOpacity += (targetOpacity - entry.currentOpacity) * lerpFactor;
      }
    }
  }

  /**
   * Get the current smoothed opacity for a specific enemy.
   * Returns 1.0 if the enemy has not been processed yet.
   */
  getOpacity(enemy: BaseEnemy): number {
    const entry = this.entries.get(enemy);
    return entry ? entry.currentOpacity : 1.0;
  }

  /**
   * Clear all tracked entries (e.g., on level change / surface change).
   * Since WeakMap has no .clear(), we replace the map to drop all entries.
   */
  clear(): void {
    this.entries = new WeakMap();
  }

  /**
   * Dispose the system. Same as clear() — no other resources to release.
   */
  dispose(): void {
    this.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Map a euclidean cell-distance to an opacity value.
   * nearCellRadius → 1.0
   * fadeCellRadius → dimOpacity
   * In between: smooth-step interpolation (no linear ramp; avoids noticeably
   * fast fade near the inner boundary and very slow fade near the outer boundary).
   */
  private _cellDistToOpacity(cellDist: number): number {
    const { nearCellRadius, fadeCellRadius, dimOpacity } = this.config;
    if (cellDist <= nearCellRadius) return 1.0;
    if (cellDist >= fadeCellRadius) return dimOpacity;

    const t = (cellDist - nearCellRadius) / (fadeCellRadius - nearCellRadius);
    // Smoothstep: t² * (3 - 2t) → derivative = 0 at both ends, no abrupt ramp
    const smoothT = t * t * (3.0 - 2.0 * t);
    return 1.0 - smoothT * (1.0 - dimOpacity);
  }
}
