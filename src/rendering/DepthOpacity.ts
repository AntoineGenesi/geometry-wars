/**
 * Depth-based opacity module.
 *
 * Two systems work together:
 *
 * 1. **computeDepthVisibility()** (legacy) -- dot-product between entity normal
 *    and camera direction. Fast but inaccurate on complex surfaces like cube tunnels
 *    where enemies behind multiple walls appear equally bright.
 *
 * 2. **DepthOcclusionSystem** (new) -- raycasts from camera to each enemy and
 *    counts how many surface faces the ray passes through. Enemies behind zero
 *    surfaces are fully visible, behind one surface are significantly dimmed,
 *    behind two or more are nearly invisible. Raycasts are batched across frames
 *    for performance (budget: ~100 raycasts per frame at 5K enemies).
 *
 * Pre-allocated temp vectors are used internally to avoid per-frame GC pressure.
 */

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

// Pre-allocated temp vectors (module-level, zero per-frame allocation)
const _toCamera = new THREE.Vector3();

/**
 * Depth opacity curve configuration.
 * Controls how aggressively far-side entities are faded.
 */
export interface DepthOpacityCurve {
  /** Minimum opacity for entities on the far side (0.0 = invisible, 0.15 = faint glow).
   *  Default: 0.06 */
  farSideMin: number;

  /** Maximum opacity for entities on the near side (typically 1.0).
   *  Default: 1.0 */
  nearSideMax: number;

  /** Exponent for the opacity curve. Higher = steeper transition.
   *  1.0 = linear, 2.0 = quadratic, 3.0+ = very steep.
   *  Default: 3.0 */
  exponent: number;

  /** The dot-product threshold below which entities are at minimum opacity.
   *  A value of 0.0 means only entities directly behind start fading.
   *  A value of 0.3 means entities even slightly past the equator fade.
   *  Default: 0.15 */
  fadeStartThreshold: number;
}

/** Built-in presets for depth opacity curves. */
export const DEPTH_OPACITY_PRESETS: Record<string, DepthOpacityCurve> = {
  /** Steep curve: far side barely visible (recommended for gameplay) */
  steep: {
    farSideMin: 0.06,
    nearSideMax: 1.0,
    exponent: 3.5,
    fadeStartThreshold: 0.1,
  },

  /** Moderate curve: far side somewhat visible */
  moderate: {
    farSideMin: 0.15,
    nearSideMax: 1.0,
    exponent: 2.0,
    fadeStartThreshold: 0.0,
  },

  /** Gentle curve: far side still fairly visible (old behavior) */
  gentle: {
    farSideMin: 0.2,
    nearSideMax: 1.0,
    exponent: 1.0,
    fadeStartThreshold: -0.5,
  },

  /** None: all entities fully visible regardless of depth */
  none: {
    farSideMin: 1.0,
    nearSideMax: 1.0,
    exponent: 1.0,
    fadeStartThreshold: -1.0,
  },

  /** Extreme: far side almost invisible */
  extreme: {
    farSideMin: 0.02,
    nearSideMax: 1.0,
    exponent: 5.0,
    fadeStartThreshold: 0.2,
  },
};

/** The default curve used by the game. */
export const DEFAULT_DEPTH_CURVE: DepthOpacityCurve = DEPTH_OPACITY_PRESETS.steep;

/**
 * Compute the visibility (opacity) of an entity based on its position relative
 * to the camera and its surface normal.
 *
 * Uses pre-allocated temp vectors internally -- safe to call per-entity per-frame.
 *
 * @param entityPos - World position of the entity
 * @param entityNormal - Outward surface normal at the entity position (normalized)
 * @param cameraPos - World position of the camera
 * @param curve - Depth opacity curve configuration (defaults to steep)
 * @returns Opacity value in [farSideMin, nearSideMax]
 */
export function computeDepthVisibility(
  entityPos: THREE.Vector3,
  entityNormal: THREE.Vector3,
  cameraPos: THREE.Vector3,
  curve: DepthOpacityCurve = DEFAULT_DEPTH_CURVE,
): number {
  // Direction from entity toward camera (uses pre-allocated vector)
  _toCamera.copy(cameraPos).sub(entityPos).normalize();

  // Dot product: >0 = facing camera, <0 = facing away
  const dot = entityNormal.dot(_toCamera);

  // If below fade threshold, return minimum
  if (dot <= curve.fadeStartThreshold) {
    return curve.farSideMin;
  }

  // Remap dot from [fadeStartThreshold, 1.0] to [0, 1]
  const range = 1.0 - curve.fadeStartThreshold;
  const t = (dot - curve.fadeStartThreshold) / range;

  // Apply exponential curve for steep transition
  const curved = Math.pow(Math.min(1.0, Math.max(0.0, t)), curve.exponent);

  // Lerp between farSideMin and nearSideMax
  return curve.farSideMin + curved * (curve.nearSideMax - curve.farSideMin);
}

// ---------------------------------------------------------------------------
// Raycast-based depth occlusion system
// ---------------------------------------------------------------------------

/**
 * Configuration for the raycast-based depth occlusion system.
 */
export interface DepthOcclusionConfig {
  /** Max raycasts to perform per frame. Higher = more responsive but more CPU.
   *  At 5K enemies with batchSize=100, all enemies are checked every 50 frames (~0.8s at 60fps).
   *  Default: 100 */
  batchSize: number;

  /** Opacity for enemies with 0 surface intersections (fully visible). Default: 1.0 */
  opacity0: number;

  /** Opacity for enemies behind 1 surface layer. Default: 0.3 */
  opacity1: number;

  /** Opacity for enemies behind 2+ surface layers. Default: 0.07 */
  opacity2Plus: number;

  /** How fast cached opacity lerps toward target (per second). Higher = snappier.
   *  Default: 8.0 */
  lerpSpeed: number;

  /** Maximum distance from camera to consider for raycasting. Enemies beyond this
   *  distance use the dot-product fallback. Default: Infinity (no limit) */
  maxRaycastDistance: number;

  /** Small offset to push ray origin away from camera along ray direction, avoiding
   *  self-intersections with the surface the camera might be sitting on. Default: 0.05 */
  rayOriginOffset: number;
}

/** Default occlusion config tuned for gameplay clarity. */
export const DEFAULT_OCCLUSION_CONFIG: DepthOcclusionConfig = {
  batchSize: 100,
  opacity0: 1.0,
  opacity1: 0.5,
  opacity2Plus: 0.15,
  lerpSpeed: 8.0,
  maxRaycastDistance: Infinity,
  rayOriginOffset: 0.05,
};

// Pre-allocated objects for DepthOcclusionSystem (zero per-frame GC)
const _occRay = new THREE.Ray();
const _occDir = new THREE.Vector3();
const _occInvMatrix = new THREE.Matrix4();

/** Internal per-entity state for the occlusion system. */
interface OcclusionEntry {
  /** Number of surface intersections between camera and entity (last raycast). */
  intersectionCount: number;
  /** Target opacity based on intersection count. */
  targetOpacity: number;
  /** Current smoothed opacity (lerped toward target each frame). */
  currentOpacity: number;
  /** Frame number when this entity was last raycasted. */
  lastRaycastFrame: number;
}

/**
 * Minimal interface for entities the occlusion system can track.
 * BaseEnemy satisfies this without modification.
 */
export interface OccludableEntity {
  readonly position: THREE.Vector3;
  readonly alive: boolean;
}

/**
 * DepthOcclusionSystem -- Raycast-based occlusion for enemies on complex 3D surfaces.
 *
 * Each frame, a batch of enemies are raycasted from the camera. The ray counts how many
 * surface faces it passes through before reaching the enemy. This count determines opacity:
 *   0 intersections   = fully visible (enemy is on the visible surface)
 *   1-2 intersections = dimmed (enemy behind one wall: entry + exit face)
 *   3+ intersections  = nearly invisible (enemy behind multiple surfaces)
 *
 * Between raycast updates, opacity is smoothly lerped for flicker-free transitions.
 *
 * Performance: At 5K enemies with batchSize=100, each enemy is re-checked every ~50 frames.
 * The BVH raycast is O(log n) per ray, so 100 raycasts/frame is very cheap (~0.2ms).
 *
 * Entity tracking uses a WeakMap keyed by object reference, so dead enemies are
 * automatically garbage-collected without manual cleanup.
 */
export class DepthOcclusionSystem {
  private readonly config: DepthOcclusionConfig;
  /** WeakMap avoids manual cleanup -- dead enemies are GC'd automatically.
   *  Replaced on clear() to drop all entries. */
  private entries: WeakMap<object, OcclusionEntry> = new WeakMap();

  /** Surface mesh to raycast against. */
  private surfaceMesh: THREE.Mesh | null = null;
  /** BVH accelerator for the surface mesh. */
  private bvh: MeshBVH | null = null;

  /** Round-robin index: which entity index to start raycasting from this frame. */
  private batchCursor: number = 0;
  /** Monotonically increasing frame counter. */
  private frameNumber: number = 0;

  constructor(config?: Partial<DepthOcclusionConfig>) {
    this.config = { ...DEFAULT_OCCLUSION_CONFIG, ...config };
  }

  /**
   * Set the surface mesh to raycast against.
   * Must be called before update(). The mesh must have a BVH built on its geometry.
   */
  setSurfaceMesh(mesh: THREE.Mesh): void {
    this.surfaceMesh = mesh;
    const geo = mesh.geometry;
    if (!geo.boundsTree) {
      geo.boundsTree = new MeshBVH(geo);
    }
    this.bvh = geo.boundsTree as MeshBVH;
  }

  /**
   * Main per-frame update. Raycasts a batch of entities and lerps all opacities.
   *
   * @param entities - All alive entities to track. Order should be stable between frames.
   * @param cameraPos - World-space camera position.
   * @param dt - Frame delta time in seconds (for lerp smoothing).
   */
  update(entities: OccludableEntity[], cameraPos: THREE.Vector3, dt: number): void {
    this.frameNumber++;
    if (!this.bvh || !this.surfaceMesh) return;

    const batchSize = this.config.batchSize;
    const entityCount = entities.length;
    if (entityCount === 0) return;

    // Compute inverse matrix once per frame for local-space ray transforms
    _occInvMatrix.copy(this.surfaceMesh.matrixWorld).invert();

    // --- Batch raycast: process `batchSize` entities starting from batchCursor ---
    const startIdx = this.batchCursor % entityCount;
    let processed = 0;
    let idx = startIdx;

    while (processed < batchSize && processed < entityCount) {
      const entity = entities[idx];
      if (entity.alive) {
        this.raycastEntity(entity, cameraPos);
      }
      processed++;
      idx = (idx + 1) % entityCount;
    }
    this.batchCursor = idx;

    // --- Lerp all entries toward their target opacity ---
    const lerpFactor = Math.min(1.0, this.config.lerpSpeed * dt);
    for (const entity of entities) {
      if (!entity.alive) continue;
      const entry = this.entries.get(entity);
      if (entry) {
        entry.currentOpacity += (entry.targetOpacity - entry.currentOpacity) * lerpFactor;
      }
    }
  }

  /**
   * Get the current smoothed opacity for an entity.
   * Returns 1.0 if the entity hasn't been raycasted yet.
   */
  getOpacity(entity: OccludableEntity): number {
    const entry = this.entries.get(entity);
    return entry ? entry.currentOpacity : 1.0;
  }

  /**
   * Clear all tracked entities (e.g., on level change).
   * Since WeakMap entries are GC'd automatically, this just resets cursors.
   */
  clear(): void {
    // Replace the WeakMap entirely to drop all entries (WeakMap has no .clear())
    this.entries = new WeakMap();
    this.batchCursor = 0;
    this.frameNumber = 0;
  }

  /**
   * Dispose the system.
   */
  dispose(): void {
    this.clear();
    this.surfaceMesh = null;
    this.bvh = null;
  }

  /** Get the raw intersection count for an entity (for debug display). */
  getIntersectionCount(entity: OccludableEntity): number {
    const entry = this.entries.get(entity);
    return entry ? entry.intersectionCount : -1;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  /**
   * Raycast from camera to a single entity, counting surface intersections.
   */
  private raycastEntity(entity: OccludableEntity, cameraPos: THREE.Vector3): void {
    // Direction: camera -> entity
    _occDir.copy(entity.position).sub(cameraPos);
    const dist = _occDir.length();
    if (dist < 0.001) return; // Entity is at camera position, skip
    _occDir.divideScalar(dist); // normalize in-place (avoid .normalize() alloc)

    // Build ray in local space of the surface mesh
    // Origin = camera pos + small offset along ray direction to avoid surface self-hit
    _occRay.origin.copy(cameraPos)
      .addScaledVector(_occDir, this.config.rayOriginOffset);
    _occRay.origin.applyMatrix4(_occInvMatrix);
    _occRay.direction.copy(_occDir).transformDirection(_occInvMatrix).normalize();

    // Raycast all intersections (BVH returns array of { distance, faceIndex, ... })
    const localDist = dist - this.config.rayOriginOffset;
    const hits = this.bvh!.raycast(_occRay, THREE.DoubleSide, 0, localDist);

    // Count unique face intersections. Filter out hits near the entity itself
    // (the face the enemy sits on often gets hit). Deduplicate by distance
    // to handle coplanar triangles (two triangles sharing an edge on one quad face
    // can both register hits at nearly identical distances).
    const minHitDist = localDist * 0.92; // ignore hits within 8% of entity distance
    const DEDUP_EPSILON = 0.01; // merge hits within 1cm of each other

    // Sort hits by distance for deduplication
    const validHits: number[] = [];
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].distance < minHitDist) {
        validHits.push(hits[i].distance);
      }
    }
    validHits.sort((a, b) => a - b);

    // Deduplicate: merge hits that are very close together (coplanar triangle pairs)
    let count = 0;
    let lastDist = -Infinity;
    for (let i = 0; i < validHits.length; i++) {
      if (validHits[i] - lastDist > DEDUP_EPSILON) {
        count++;
        lastDist = validHits[i];
      }
    }

    // Map intersection count to target opacity.
    // On a closed surface, a ray entering and exiting counts as 2 unique hits.
    // 0       = clear line of sight (full opacity)
    // 1-2     = behind one surface layer (dimmed)
    // 3+      = behind multiple surfaces (nearly invisible)
    let targetOpacity: number;
    if (count === 0) {
      targetOpacity = this.config.opacity0;
    } else if (count <= 2) {
      // Behind one surface layer (enter + exit)
      targetOpacity = this.config.opacity1;
    } else {
      // Behind multiple surfaces
      targetOpacity = this.config.opacity2Plus;
    }

    // Get or create entry
    const existing = this.entries.get(entity);
    if (!existing) {
      this.entries.set(entity, {
        intersectionCount: count,
        targetOpacity,
        currentOpacity: targetOpacity, // No lerp on first appearance
        lastRaycastFrame: this.frameNumber,
      });
    } else {
      existing.intersectionCount = count;
      existing.targetOpacity = targetOpacity;
      existing.lastRaycastFrame = this.frameNumber;
    }
  }
}
