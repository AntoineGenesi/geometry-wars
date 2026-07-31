import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { LODLevel, LODGeometryCache } from './LODManager';
// s44r11-01: shader effects (lava, crystal, etc.) removed — incompatible with MeshBasicMaterial.
// import { getEnemyShaderStyle, enhanceMaterialWithShaderEffect } from './EnemyShaderEffects';
import {
  SURFACE_VISIBILITY_DEFAULT_MIN_BRIGHTNESS as ENEMY_OCCLUSION_DEFAULT_MIN_BRIGHTNESS,
} from './SurfaceVisibilityResolver';

/**
 * EnemyInstanceManager - Replaces individual enemy meshes with InstancedMesh
 * batches to reduce GPU draw calls from ~2000 (at 100 enemies) to ~15.
 *
 * For each registered enemy type, all child geometries (tubes + joints from
 * GeometryBuilder) are merged into a single BufferGeometry and rendered via
 * one InstancedMesh. Per-instance position, rotation, scale, and color are
 * updated each frame from the enemy's mesh transform.
 *
 * Enemies that are too complex for instancing (multi-part, dynamic sub-meshes)
 * fall back to individual rendering.
 */

/** Max instances per enemy type. 200 is generous for most gameplay. */
const DEFAULT_MAX_INSTANCES = 200;

/** Max instances for shared LOD batches (medium/low). Needs to hold ALL distant enemies. */
const LOD_BATCH_MAX_INSTANCES = 500;

/** Enemy type identifier extracted from the constructor name. */
type EnemyTypeKey = string;

interface InstanceBatch {
  /** The merged geometry for this enemy type. */
  geometry: THREE.BufferGeometry;
  /** Shared material (MeshBasicMaterial — unlit, instanceColor-driven). */
  material: THREE.Material;
  /** The InstancedMesh object added to the scene. */
  instancedMesh: THREE.InstancedMesh;
  /** Per-instance opacity attribute (float, 0..1). Used by the custom shader
   *  injected via onBeforeCompile to produce real alpha transparency. */
  opacityAttribute: THREE.InstancedBufferAttribute;
  /** Map from enemy reference to its instance index. */
  enemyToIndex: Map<BaseEnemy, number>;
  /** Reverse map: index to enemy (for recycling slots). */
  indexToEnemy: (BaseEnemy | null)[];
  /** Next free slot index. */
  nextFreeIndex: number;
  /** Number of active instances this frame. */
  activeCount: number;
  /** Base color for this enemy type (for resetting after hit flash). */
  baseColor: THREE.Color;
  /** Per-instance "intended" color before dimming (RGB, 3 floats per instance).
   *  Tracks the undimmed color so setInstanceVisibility can modulate instanceColor
   *  correctly even when rainbow mode or other color overrides are active.
   *  This enables RGB-based dimming that works on BOTH WebGL and WebGPU
   *  (onBeforeCompile-based alpha dimming is WebGL-only). */
  perInstanceColors: Float32Array;
  /** Per-slot brightness safety floor. Defaults to the historical global floor;
   * far occluded readable enemies can lower this per slot without weakening
   * normal/direct enemy safeguards. */
  perInstanceMinBrightness: Float32Array;
  /** Highest slot index ever allocated (inclusive). Maintained by allocateSlot/unregister.
   *  Used as a cheap O(1) substitute for getMaxUsedIndex() when setting instancedMesh.count. */
  highWaterMark: number;
}

/**
 * LODSharedBatch - A shared InstancedMesh for all enemies at a given LOD level.
 * MEDIUM LOD uses simplified icosahedron geometry (20 tris).
 * LOW LOD uses a coarse octahedral geometry (8 tris).
 * Enemies are colored per-instance using their type's base color.
 */
interface LODSharedBatch {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  instancedMesh: THREE.InstancedMesh;
  opacityAttribute: THREE.InstancedBufferAttribute;
  /** Map from enemy reference to its slot index in this LOD batch. */
  enemyToIndex: Map<BaseEnemy, number>;
  /** Reverse map: index to enemy for slot recycling. */
  indexToEnemy: (BaseEnemy | null)[];
  nextFreeIndex: number;
  /** Number of slots currently occupied. */
  usedCount: number;
  /** Highest slot index ever allocated (inclusive). O(1) substitute for getMaxUsedLODIndex(). */
  highWaterMark: number;
  /** Per-slot brightness safety floor for shared LOD batches. */
  minBrightness: Float32Array;
}

/** Temporary objects reused per-frame to avoid GC pressure. */
const _tempMatrix = new THREE.Matrix4();
const _tempPosition = new THREE.Vector3();
const _tempQuaternion = new THREE.Quaternion();
const _tempColor = new THREE.Color();
const _zeroScale = new THREE.Vector3(0, 0, 0);
const _lodScale = new THREE.Vector3();
const _tempScale = new THREE.Vector3();

/**
 * Enemy types that support instancing.
 * These all use simple prism-frame geometries from GeometryBuilder
 * with no sub-part animation (no independent child mesh transforms).
 */
const INSTANCEABLE_TYPES = new Set([
  'Grunt', 'Duck', 'Mayfly', 'Rocket', 'Neutron',
  'Weaver', 'Wanderer', 'SpinnerSpawn', 'Spinner', 'Virus',
  'Lurker', 'Orbiter', 'Splitter',
  // Note: Phaser is excluded because it uses per-instance opacity changes
  // that require individual material control (transparent fading in/out).
]);

export class EnemyInstanceManager {
  private scene: THREE.Scene;
  private batches: Map<EnemyTypeKey, InstanceBatch> = new Map();
  private maxInstances: number;

  /** Whether the renderer is WebGPU. When true, onBeforeCompile doesn't work
   *  so we use TSL opacityNode for per-instance alpha instead. */
  private isWebGPU: boolean;

  /** Cached TSL attribute function (WebGPU only). Loaded once via dynamic import,
   *  then used synchronously for all subsequent batch creations. */
  private static _tslAttribute: ((name: string) => any) | null = null;
  /** Whether the TSL import has been attempted (prevents repeated import attempts). */
  private static _tslImportDone: boolean = false;
  /** Materials awaiting TSL import resolution (WebGPU only). Once the import resolves,
   *  these materials get opacityNode set and are marked needsUpdate. */
  private static _pendingTslMaterials: THREE.MeshBasicMaterial[] = [];

  /** Shared LOD batches for reduced-detail rendering. */
  private lodMediumBatch: LODSharedBatch | null = null;
  private lodLowBatch: LODSharedBatch | null = null;
  private lodGeometryCache: LODGeometryCache = new LODGeometryCache();

  /** Tracks which LOD batch each enemy is currently in (MEDIUM or LOW), if any.
   *  Enemies at HIGH LOD are NOT in this map — they use their type-specific batch. */
  private enemyLODPlacement: Map<BaseEnemy, LODLevel> = new Map();

  /** Per-type base colors extracted during batch creation, used to color LOD instances. */
  private typeBaseColors: Map<EnemyTypeKey, THREE.Color> = new Map();

  /** Frame counter for periodic highWaterMark revalidation (RC16 defense). */
  private _hwmRevalidateCounter = 0;
  /** How often to revalidate highWaterMark (every N frames). */
  private static readonly HWM_REVALIDATE_INTERVAL = 60; // ~1s at 60fps

  /** Dirty flag: true when any instanceColor or opacityAttribute value changed this frame.
   *  flushColors() skips needsUpdate=true if false, avoiding unnecessary GPU buffer uploads. */
  private _colorsDirty = false;
  private readonly _dirtyTypeBatches = new Set<InstanceBatch>();
  private readonly _dirtyLODBatches = new Set<LODSharedBatch>();

  constructor(scene: THREE.Scene, maxInstances = DEFAULT_MAX_INSTANCES, isWebGPU = false) {
    this.scene = scene;
    this.maxInstances = maxInstances;
    this.isWebGPU = isWebGPU;
  }

  /**
   * Apply per-instance opacity to a material. Two paths:
   *
   * - **WebGL2:** onBeforeCompile injects `instanceOpacity` attribute into the GLSL shader.
   *   This multiplies fragment alpha by the per-instance value.
   *
   * - **WebGPU:** onBeforeCompile doesn't work (WebGPU uses TSL node materials).
   *   Instead, set material.opacityNode to read the `instanceOpacity` attribute via TSL.
   *   This is dynamically imported to avoid bundling WebGPU-only code when not needed.
   *
   * Both paths only affect ALPHA. RGB is already premultiplied via instanceColor dimming.
   * REGRESSION GUARD (s44r12-03): never multiply rgb by instanceOpacity.
   */
  private _applyInstanceOpacity(material: THREE.MeshBasicMaterial, cacheKey: string): void {
    if (this.isWebGPU) {
      // WebGPU path: use TSL opacityNode to read the instanceOpacity attribute.
      //
      // s44r28-01 fix: The original code used a fire-and-forget dynamic import:
      //   import('three/tsl').then(tsl => { material.opacityNode = ... })
      // In Vite dev mode, dynamic imports are async HTTP requests. The .then()
      // resolved AFTER the material was first compiled by the WebGPU renderer,
      // so the opacityNode was never included in the compiled shader. Without
      // material.needsUpdate = true, the shader wasn't recompiled.
      //
      // Fix: Cache the TSL attribute function at the class level. First batch
      // triggers the async import; subsequent batches use the cached function
      // synchronously. All materials created before the import resolves are
      // queued in _pendingTslMaterials and patched+recompiled when it arrives.
      if (EnemyInstanceManager._tslAttribute) {
        // TSL already loaded — apply synchronously (no race)
        (material as any).opacityNode = EnemyInstanceManager._tslAttribute('instanceOpacity');
      } else {
        // Queue this material for patching when the import resolves
        EnemyInstanceManager._pendingTslMaterials.push(material);

        if (!EnemyInstanceManager._tslImportDone) {
          EnemyInstanceManager._tslImportDone = true;
          import('three/tsl').then((tsl: any) => {
            const { attribute: tslAttribute } = tsl;
            if (tslAttribute) {
              EnemyInstanceManager._tslAttribute = tslAttribute;
              // Patch all queued materials and trigger recompilation
              for (const mat of EnemyInstanceManager._pendingTslMaterials) {
                (mat as any).opacityNode = tslAttribute('instanceOpacity');
                mat.needsUpdate = true;
              }
              EnemyInstanceManager._pendingTslMaterials = [];
            }
          }).catch(() => {
            // TSL module unavailable — fall back to RGB-only dimming (no alpha).
            // Enemies will be slightly more visible on far side but not invisible.
            console.warn('[EnemyInstanceManager] three/tsl not available — WebGPU per-instance alpha disabled');
            EnemyInstanceManager._pendingTslMaterials = [];
          });
        }
      }
    } else {
      // WebGL2 path: inject instanceOpacity attribute via onBeforeCompile.
      material.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace(
          'void main() {',
          'attribute float instanceOpacity;\nvarying float vInstanceOpacity;\nvoid main() {\n  vInstanceOpacity = instanceOpacity;',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          'void main() {',
          'varying float vInstanceOpacity;\nvoid main() {',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\n  gl_FragColor.a *= vInstanceOpacity;',
        );
      };
    }
    material.customProgramCacheKey = () => cacheKey;
  }

  /**
   * Check if an enemy type supports instanced rendering.
   */
  static isInstanceable(enemy: BaseEnemy): boolean {
    return INSTANCEABLE_TYPES.has(enemy.constructor.name);
  }

  /**
   * Register an enemy for instanced rendering.
   * Lazily creates the InstancedMesh batch for the enemy's type on first registration.
   * Returns true if the enemy was registered, false if it can't be instanced.
   */
  register(enemy: BaseEnemy): boolean {
    if (!EnemyInstanceManager.isInstanceable(enemy)) {
      return false;
    }
    if (!enemy.mesh) {
      return false;
    }

    const typeKey = enemy.constructor.name;
    let batch = this.batches.get(typeKey);

    // Lazily create batch from this enemy's mesh (first enemy of this type)
    if (!batch) {
      const newBatch = this.createBatch(typeKey, enemy.mesh as THREE.Group);
      if (!newBatch) {
        return false;
      }
      batch = newBatch;
      this.batches.set(typeKey, batch);
      this.scene.add(batch.instancedMesh);
      // Cache base color for LOD batch coloring
      this.typeBaseColors.set(typeKey, batch.baseColor.clone());
    }

    // Allocate an instance slot
    if (batch.enemyToIndex.has(enemy)) {
      return true; // Already registered
    }

    const index = this.allocateSlot(batch);
    if (index < 0) {
      return false; // No free slots
    }

    batch.enemyToIndex.set(enemy, index);
    batch.indexToEnemy[index] = enemy;

    // Hide the individual mesh - InstancedMesh handles rendering
    enemy.mesh.visible = false;
    enemy.isInstanced = true;

    // Set initial instance to zero scale (hidden until first update)
    _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
    batch.instancedMesh.setMatrixAt(index, _tempMatrix);
    batch.instancedMesh.setColorAt(index, batch.baseColor);
    batch.opacityAttribute.setX(index, 1.0);
    // Initialize per-instance intended color to base color
    const ci = index * 3;
    batch.perInstanceColors[ci] = batch.baseColor.r;
    batch.perInstanceColors[ci + 1] = batch.baseColor.g;
    batch.perInstanceColors[ci + 2] = batch.baseColor.b;
    batch.perInstanceMinBrightness[index] = ENEMY_OCCLUSION_DEFAULT_MIN_BRIGHTNESS;
    this._colorsDirty = true;
    this._dirtyTypeBatches.add(batch);

    // Track the instance index on the enemy for external reference
    (enemy as any)._instanceIndex = index;
    (enemy as any)._instanceType = typeKey;

    return true;
  }

  /**
   * Unregister an enemy (on death/despawn). Frees the instance slot.
   */
  unregister(enemy: BaseEnemy): void {
    const typeKey = enemy.constructor.name;
    const batch = this.batches.get(typeKey);
    if (!batch) return;

    const index = batch.enemyToIndex.get(enemy);
    if (index === undefined) return;

    // Hide this instance by setting scale to 0 and opacity to 0
    _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
    batch.instancedMesh.setMatrixAt(index, _tempMatrix);
    batch.opacityAttribute.setX(index, 0.0);
    this._colorsDirty = true;
    this._dirtyTypeBatches.add(batch);

    // Free the slot
    batch.enemyToIndex.delete(enemy);
    batch.indexToEnemy[index] = null;

    // Recompute highWaterMark correctly — scan from the TOP of the array, not from
    // the freed index downward. The old code scanned downward from index-1, which missed
    // occupied slots ABOVE the freed index (e.g., index 30 freed, highWaterMark drops to 25,
    // but index 28 was re-allocated via wrap-around — now index 28 is above highWaterMark
    // and count=26 means it won't render). This was RC15: the root cause of invisible
    // enemies despite correct game state, ICB, and matrix.
    if (index >= batch.highWaterMark) {
      let newMax = -1;
      for (let i = this.maxInstances - 1; i >= 0; i--) {
        if (batch.indexToEnemy[i] !== null) { newMax = i; break; }
      }
      batch.highWaterMark = newMax;
    }

    // Also remove from any LOD shared batch
    this.removeLODPlacement(enemy);

    // Clean up enemy references
    enemy.isInstanced = false;
    (enemy as any)._instanceIndex = undefined;
    (enemy as any)._instanceType = undefined;
  }

  /**
   * Update all instance matrices and colors from enemy state.
   * Call once per frame before rendering.
   */
  updateInstances(enemies: BaseEnemy[]): void {
    // Reset active counts
    for (const batch of this.batches.values()) {
      batch.activeCount = 0;
    }

    for (const enemy of enemies) {
      if (!enemy.active || !enemy.alive) continue;

      const typeKey = (enemy as any)._instanceType as string | undefined;
      if (!typeKey) continue;

      const batch = this.batches.get(typeKey);
      if (!batch) continue;

      const index = batch.enemyToIndex.get(enemy);
      if (index === undefined) continue;

      if (!enemy.mesh) continue;

      // s44r29-08: Materializing enemies (spawn warning in progress) — keep at zero scale
      // but at correct position/rotation so the matrix is ready when materialization ends.
      // Previously, materializing enemies were skipped entirely (continue), leaving their
      // InstancedMesh slot at whatever state registration set (zero-scale at origin).
      // This caused a 1-frame gap where the enemy was invisible after materialization ended.
      if (enemy.isMaterializing) {
        _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
        batch.instancedMesh.setMatrixAt(index, _tempMatrix);
        continue;
      }

      // Extract world matrix from the enemy's mesh (includes surface transform + behavior rotation/scale)
      enemy.mesh.updateWorldMatrix(false, false);
      batch.instancedMesh.setMatrixAt(index, enemy.mesh.matrixWorld);
      batch.activeCount++;
    }

    // Mark matrices as dirty and update instance count
    for (const batch of this.batches.values()) {
      batch.instancedMesh.instanceMatrix.needsUpdate = true;
      if (batch.instancedMesh.instanceColor) {
        batch.instancedMesh.instanceColor.needsUpdate = true;
      }
      // Set count to max registered index + 1 to avoid rendering garbage
      // (InstancedMesh renders indices 0..count-1, so we need count >= max used index)
      // highWaterMark is O(1) — maintained incrementally in allocateSlot/unregister.
      batch.instancedMesh.count = batch.highWaterMark + 1;
    }
  }

  /**
   * Update all instance matrices with LOD-aware geometry swapping.
   * Enemies at MEDIUM/LOW LOD are hidden in their type-specific batch and
   * shown in a shared simplified-geometry batch instead. This reduces triangle
   * count for distant enemies from ~200 per enemy to 20 (medium) or 8 (low).
   *
   * @param enemies - All active enemies.
   * @param lodAssignments - LOD level per enemy from LODManager.update().
   * @param camera - Retained for call-site compatibility; LOD orientation comes from the enemy.
   */
  updateInstancesWithLOD(
    enemies: BaseEnemy[],
    lodAssignments: Map<BaseEnemy, LODLevel>,
    _camera: THREE.Camera,
  ): void {
    // Lazily create shared LOD batches on first use
    if (!this.lodMediumBatch) {
      this.lodMediumBatch = this.createLODSharedBatch(
        'lod-medium',
        this.lodGeometryCache.getMediumGeometry(),
      );
      this.scene.add(this.lodMediumBatch.instancedMesh);
    }
    if (!this.lodLowBatch) {
      this.lodLowBatch = this.createLODSharedBatch(
        'lod-low',
        this.lodGeometryCache.getLowGeometry(),
      );
      this.scene.add(this.lodLowBatch.instancedMesh);
    }

    // Reset active counts for HIGH-detail type batches
    for (const batch of this.batches.values()) {
      batch.activeCount = 0;
    }

    // Hide all LOD instances by zero-scaling (will be re-shown below for active enemies)
    this.hideAllLODInstances(this.lodMediumBatch);
    this.hideAllLODInstances(this.lodLowBatch);

    for (const enemy of enemies) {
      if (!enemy.active || !enemy.alive) continue;

      const typeKey = (enemy as any)._instanceType as string | undefined;
      if (!typeKey) continue;

      const batch = this.batches.get(typeKey);
      if (!batch) continue;

      const highIndex = batch.enemyToIndex.get(enemy);
      if (highIndex === undefined) continue;

      if (!enemy.mesh) continue;

      // s44r29-08: Materializing enemies — zero-scale in HIGH batch, skip LOD/culling.
      // Previously skipped entirely (continue), leaving stale registration matrix.
      if (enemy.isMaterializing) {
        _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
        batch.instancedMesh.setMatrixAt(highIndex, _tempMatrix);
        continue;
      }

      const lodLevel = lodAssignments.get(enemy);

      if (lodLevel === LODLevel.MEDIUM || lodLevel === LODLevel.LOW) {
        // Show in the shared LOD batch
        const lodBatch = lodLevel === LODLevel.MEDIUM ? this.lodMediumBatch : this.lodLowBatch;
        enemy.mesh.updateWorldMatrix(false, false);
        this.placeLODInstance(enemy, typeKey, lodBatch, lodLevel);

        // s44r29-02: Only hide HIGH batch if LOD placement succeeded.
        // If LOD slot allocation failed (batch full), fall back to HIGH batch
        // so the enemy remains visible. Previously, the HIGH batch was zero-scaled
        // BEFORE LOD placement — if placement failed, the enemy was invisible in
        // both batches (zero-scale HIGH + not in LOD = rendered nowhere).
        if (this.enemyLODPlacement.has(enemy)) {
          // LOD placement succeeded — hide in HIGH batch
          _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
          batch.instancedMesh.setMatrixAt(highIndex, _tempMatrix);
        } else {
          // LOD placement failed — keep in HIGH batch as fallback
          batch.instancedMesh.setMatrixAt(highIndex, enemy.mesh.matrixWorld);
          batch.activeCount++;
        }
      } else {
        // HIGH LOD: render in the type-specific batch (normal path)
        enemy.mesh.updateWorldMatrix(false, false);
        batch.instancedMesh.setMatrixAt(highIndex, enemy.mesh.matrixWorld);
        batch.activeCount++;

        // RC18 DEBUG: detect zero-scale or zero-position matrices
        if (this._hwmRevalidateCounter === 0) { // once per second
          const e = enemy.mesh.matrixWorld.elements;
          const sx = Math.sqrt(e[0]*e[0] + e[1]*e[1] + e[2]*e[2]);
          const pos = Math.sqrt(e[12]*e[12] + e[13]*e[13] + e[14]*e[14]);
          if (sx < 0.001 || pos < 0.001) {
            console.warn(`[RC18] Enemy ${enemy.constructor.name} idx=${highIndex} has zero-scale(${sx.toFixed(4)}) or zero-pos(${pos.toFixed(4)})`, enemy.mesh.position, enemy.mesh.scale);
          }
        }

        // If enemy was previously in a LOD batch, remove it
        if (this.enemyLODPlacement.has(enemy)) {
          this.removeLODPlacement(enemy);
        }
      }
    }

    // RC16: Periodic full revalidation of highWaterMark to catch any drift between
    // the incrementally-maintained value and the actual maximum used index.
    // The incremental tracking in allocateSlot/unregister SHOULD be correct, but
    // if any code path modifies indexToEnemy without updating highWaterMark, the
    // count would be wrong and instances beyond count wouldn't render.
    // Cost: O(maxInstances) per batch every ~1s — negligible vs per-frame work.
    const doFullRevalidation = ++this._hwmRevalidateCounter >= EnemyInstanceManager.HWM_REVALIDATE_INTERVAL;
    if (doFullRevalidation) this._hwmRevalidateCounter = 0;

    // Finalize HIGH-detail batches
    for (const batch of this.batches.values()) {
      batch.instancedMesh.instanceMatrix.needsUpdate = true;
      if (doFullRevalidation) {
        // Full scan: recompute highWaterMark from scratch
        const trueMax = this.getMaxUsedIndex(batch);
        if (trueMax !== batch.highWaterMark) {
          console.warn(`[EnemyInstanceManager] HWM drift detected for batch: incremental=${batch.highWaterMark}, actual=${trueMax}. Correcting.`);
          batch.highWaterMark = trueMax;
        }
      }

      // highWaterMark is O(1) — maintained incrementally in allocateSlot/unregister.
      batch.instancedMesh.count = batch.highWaterMark + 1;
    }

    // Finalize LOD batches
    this.finalizeLODBatch(this.lodMediumBatch);
    this.finalizeLODBatch(this.lodLowBatch);
  }

  /**
   * Set a custom color for a specific enemy instance.
   * Used by Rainbow mode to tint instanced enemies with their assigned color.
   * Call flushColors() after setting all colors for the frame.
   */
  setEnemyColor(enemy: BaseEnemy, color: THREE.Color): void {
    const typeKey = (enemy as any)._instanceType as string | undefined;
    if (!typeKey) return;

    const batch = this.batches.get(typeKey);
    if (!batch) return;

    const index = batch.enemyToIndex.get(enemy);
    if (index === undefined) return;

    batch.instancedMesh.setColorAt(index, color);
    // Track intended color for RGB dimming (so setInstanceVisibility can modulate correctly)
    const ci = index * 3;
    batch.perInstanceColors[ci] = color.r;
    batch.perInstanceColors[ci + 1] = color.g;
    batch.perInstanceColors[ci + 2] = color.b;
    this._colorsDirty = true;
    this._dirtyTypeBatches.add(batch);
  }

  /**
   * s44r29-08: Immediately sync an enemy's mesh world matrix to its InstancedMesh slot.
   * Called by EnemySpawner when materialization ends so the enemy is visible on the
   * very first frame — eliminates the 1-frame gap where updateInstancesWithLOD hasn't
   * run yet but the enemy is no longer materializing.
   */
  syncInstanceMatrix(enemy: BaseEnemy): void {
    const typeKey = (enemy as any)._instanceType as string | undefined;
    if (!typeKey) return;

    const batch = this.batches.get(typeKey);
    if (!batch) return;

    const index = batch.enemyToIndex.get(enemy);
    if (index === undefined) return;

    if (!enemy.mesh) return;

    enemy.mesh.updateWorldMatrix(false, false);
    batch.instancedMesh.setMatrixAt(index, enemy.mesh.matrixWorld);
    batch.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Flash an enemy's instance color for hit feedback.
   * Temporarily sets color to white, then restores after duration.
   */
  hitFlash(enemy: BaseEnemy, durationMs = 80): void {
    const typeKey = (enemy as any)._instanceType as string | undefined;
    if (!typeKey) return;

    const batch = this.batches.get(typeKey);
    if (!batch) return;

    const index = batch.enemyToIndex.get(enemy);
    if (index === undefined) return;

    // Set to white (flash)
    _tempColor.setHex(0xffffff);
    batch.instancedMesh.setColorAt(index, _tempColor);
    if (batch.instancedMesh.instanceColor) {
      batch.instancedMesh.instanceColor.needsUpdate = true;
    }

    // Restore after duration
    setTimeout(() => {
      if (batch.enemyToIndex.has(enemy)) {
        batch.instancedMesh.setColorAt(index, batch.baseColor);
        if (batch.instancedMesh.instanceColor) {
          batch.instancedMesh.instanceColor.needsUpdate = true;
        }
      }
    }, durationMs);
  }

  /**
   * Set per-instance opacity via a custom instanceOpacity attribute.
   * The material's onBeforeCompile injects shader code that reads this
   * attribute and applies it to the fragment alpha, producing real
   * alpha transparency per instance.
   */
  setInstanceVisibility(
    enemy: BaseEnemy,
    visibility: number,
    minColorBrightness = ENEMY_OCCLUSION_DEFAULT_MIN_BRIGHTNESS,
  ): void {
    const typeKey = (enemy as any)._instanceType as string | undefined;
    if (!typeKey) return;

    const batch = this.batches.get(typeKey);
    if (!batch) return;

    const index = batch.enemyToIndex.get(enemy);
    if (index === undefined) return;

    // s44r21-01: Defense-in-depth NaN guard. If visibility is NaN (from surfacePosition
    // NaN propagation), treat as fully visible rather than hiding the enemy.
    // NaN > 0 = false → opacityAttribute would be 0.0 (hidden). NaN * color = NaN → black.
    if (!isFinite(visibility) || visibility < 0) visibility = 1.0;

    // s44r18-20: RGB-only dimming — set opacityAttribute to binary (1.0 visible / 0.0 hidden).
    // Previous code: opacityAttribute=visibility AND instanceColor=baseColor×visibility → output=baseColor×visibility²
    // At visibility=0.40: 0.40²=16% effective brightness → near-invisible on dark background.
    // Fix: opacityAttribute is binary; only instanceColor provides dimming (linear, not squared).
    // At visibility=0.40: output=baseColor×0.40 = 40% brightness — dim but clearly visible.
    const nextOpacity = visibility > 0 ? 1.0 : 0.0;
    const nextMinBrightness = visibility > 0
      ? Math.max(0, Math.min(ENEMY_OCCLUSION_DEFAULT_MIN_BRIGHTNESS, minColorBrightness))
      : 0;

    // RGB-based dimming: modulate instanceColor by visibility.
    // This works on BOTH WebGL and WebGPU (onBeforeCompile alpha is WebGL-only).
    // Reads the per-instance intended color (set by register/setEnemyColor) and
    // multiplies by visibility, so dimmed enemies have darker colors.
    const ci = index * 3;
    let r = batch.perInstanceColors[ci] * visibility;
    let g = batch.perInstanceColors[ci + 1] * visibility;
    let b = batch.perInstanceColors[ci + 2] * visibility;

    // s44r29-01: Minimum ICB floor. SURFACE_DIM_OPACITY=0.25 × dark baseColor (~0.37) = icb≈0.093
    // which is below INVISIBLE_THRESHOLD (0.10) — enemies appear invisible on dark backgrounds.
    // When visibility > 0 (enemy should be dim, not hidden), scale all channels proportionally
    // so avg(r,g,b) >= MIN_ICB. Proportional scaling preserves hue.
    // The per-result floor comes from SurfaceVisibilityResolver. Direct enemies
    // retain the historical 0.35 safeguard while blocked/long-path enemies can
    // use their documented lower class floor without being raised again here.
    if (visibility > 0) {
      const avg = (r + g + b) / 3;
      const MIN_ICB = nextMinBrightness;
      if (avg > 0 && avg < MIN_ICB) {
        const scale = MIN_ICB / avg;
        r *= scale;
        g *= scale;
        b *= scale;
      } else if (avg === 0) {
        r = MIN_ICB;
        g = MIN_ICB;
        b = MIN_ICB;
      }
    }

    const colorAttribute = batch.instancedMesh.instanceColor;
    const colorChanged = !colorAttribute
      || Math.abs(colorAttribute.getX(index) - r) > 1e-6
      || Math.abs(colorAttribute.getY(index) - g) > 1e-6
      || Math.abs(colorAttribute.getZ(index) - b) > 1e-6;
    const opacityChanged = Math.abs(batch.opacityAttribute.getX(index) - nextOpacity) > 1e-6;
    const minChanged = Math.abs(batch.perInstanceMinBrightness[index] - nextMinBrightness) > 1e-6;
    if (opacityChanged) batch.opacityAttribute.setX(index, nextOpacity);
    if (minChanged) batch.perInstanceMinBrightness[index] = nextMinBrightness;
    if (colorChanged) {
      _tempColor.setRGB(r, g, b);
      batch.instancedMesh.setColorAt(index, _tempColor);
    }
    if (colorChanged || opacityChanged) {
      this._colorsDirty = true;
      this._dirtyTypeBatches.add(batch);
    }
  }

  /**
   * s44r29-02: Universal safety net — ensure ALL occupied batch slots have
   * instanceColorBrightness >= MIN_ICB. This catches any code path that
   * bypasses the per-enemy visibility loop (LOD transitions, race conditions,
   * enemies skipped by the loop due to missing mesh/alive state, etc.).
   *
   * s44r29-05: Also checks matrix scale. An enemy with correct ICB but
   * zero-scale matrix is invisible. This catches enemies stuck at zero-scale
   * from registration, LOD transitions, or materialization timing gaps.
   * The test (verify-enemies-all-surfaces.mjs) only checked ICB, missing
   * zero-scale matrix invisibility entirely — RC12 root cause.
   *
   * Call AFTER the per-enemy visibility loop and BEFORE flushColors().
   */
  ensureMinimumVisibility(): void {
    const DEFAULT_MIN_ICB = ENEMY_OCCLUSION_DEFAULT_MIN_BRIGHTNESS;
    const MIN_SCALE = 0.001; // Below this, the instance is effectively invisible

    for (const batch of this.batches.values()) {
      if (!batch.instancedMesh.instanceColor) continue;

      // RC16: Ensure count covers all registered enemies. If an enemy was registered
      // at an index above the current count, it would never be drawn regardless of
      // correct ICB/scale/matrix — the GPU simply doesn't draw instances past count.
      for (const [, index] of batch.enemyToIndex) {
        if (index >= batch.instancedMesh.count) {
          // Enemy registered above current draw count — fix immediately
          batch.highWaterMark = Math.max(batch.highWaterMark, index);
          batch.instancedMesh.count = batch.highWaterMark + 1;
        }
      }
      for (const [enemy, index] of batch.enemyToIndex) {
        // --- Color check (existing) ---
        batch.instancedMesh.getColorAt(index, _tempColor);
        const avg = (_tempColor.r + _tempColor.g + _tempColor.b) / 3;
        const minIcb = batch.perInstanceMinBrightness[index] ?? DEFAULT_MIN_ICB;
        if (avg < minIcb && avg >= 0) {
          // Only fix if opacity indicates visible (not intentionally hidden)
          const opacity = batch.opacityAttribute.getX(index);
          if (opacity > 0) {
            if (avg > 0) {
              const scale = minIcb / avg;
              _tempColor.r *= scale;
              _tempColor.g *= scale;
              _tempColor.b *= scale;
            } else {
              _tempColor.setRGB(minIcb, minIcb, minIcb);
            }
            batch.instancedMesh.setColorAt(index, _tempColor);
            this._colorsDirty = true;
            this._dirtyTypeBatches.add(batch);
          }
        }

        // --- Matrix scale check (s44r29-05) ---
        // Skip enemies that are intentionally in a LOD batch (their HIGH slot
        // is zero-scaled by design — they render from the LOD batch instead).
        if (this.enemyLODPlacement.has(enemy)) continue;
        // Skip enemies that are dead, inactive, materializing, or have no mesh
        if (!enemy.active || !enemy.alive || enemy.isMaterializing || !enemy.mesh) continue;

        batch.instancedMesh.getMatrixAt(index, _tempMatrix);
        _tempScale.setFromMatrixScale(_tempMatrix);
        const maxScale = Math.max(_tempScale.x, _tempScale.y, _tempScale.z);
        if (maxScale < MIN_SCALE) {
          // Enemy should be visible but has zero-scale matrix — restore from mesh
          enemy.mesh.updateWorldMatrix(false, false);
          batch.instancedMesh.setMatrixAt(index, enemy.mesh.matrixWorld);
          batch.instancedMesh.instanceMatrix.needsUpdate = true;
        }
      }
    }

    // Also check LOD batches
    const lodBatches = [this.lodMediumBatch, this.lodLowBatch];
    for (const lodBatch of lodBatches) {
      if (!lodBatch?.instancedMesh.instanceColor) continue;
      for (const [enemy, slotIndex] of lodBatch.enemyToIndex) {
        // --- Color check ---
        lodBatch.instancedMesh.getColorAt(slotIndex, _tempColor);
        const avg = (_tempColor.r + _tempColor.g + _tempColor.b) / 3;
        const minIcb = lodBatch.minBrightness[slotIndex] ?? DEFAULT_MIN_ICB;
        if (avg < minIcb && avg >= 0) {
          const opacity = lodBatch.opacityAttribute.getX(slotIndex);
          if (opacity > 0) {
            if (avg > 0) {
              const scale = minIcb / avg;
              _tempColor.r *= scale;
              _tempColor.g *= scale;
              _tempColor.b *= scale;
            } else {
              _tempColor.setRGB(minIcb, minIcb, minIcb);
            }
            lodBatch.instancedMesh.setColorAt(slotIndex, _tempColor);
            this._colorsDirty = true;
            this._dirtyLODBatches.add(lodBatch);
          }
        }

        // --- Matrix scale check (s44r29-05) ---
        if (!enemy.active || !enemy.alive || enemy.isMaterializing || !enemy.mesh) continue;

        lodBatch.instancedMesh.getMatrixAt(slotIndex, _tempMatrix);
        _tempScale.setFromMatrixScale(_tempMatrix);
        const maxScale = Math.max(_tempScale.x, _tempScale.y, _tempScale.z);
        if (maxScale < MIN_SCALE) {
          // LOD slot has zero-scale but enemy is alive — restore placement.
          // This catches enemies that were zero-scaled by hideAllLODInstances()
          // but not re-placed by placeLODInstance() due to timing gaps.
          enemy.mesh.updateWorldMatrix(false, false);
          _tempPosition.setFromMatrixPosition(enemy.mesh.matrixWorld);
          const lodLevel = this.enemyLODPlacement.get(enemy);
          const s = enemy.radius * (lodLevel === LODLevel.LOW ? 2 : 1.5);
          _lodScale.set(s, s, s);
          _tempMatrix.compose(_tempPosition, _tempQuaternion.identity(), _lodScale);
          lodBatch.instancedMesh.setMatrixAt(slotIndex, _tempMatrix);
          lodBatch.instancedMesh.instanceMatrix.needsUpdate = true;
        }
      }
    }
  }

  /**
   * Flush visibility and color changes (call after setting all visibilities for the frame).
   */
  flushColors(): void {
    // Skip GPU upload if no color/opacity values changed this frame.
    // Avoids re-uploading the full instanceColor buffer on every frame when the
    // scene is stable (enemies at steady-state visibility). Three.js reuses the
    // previous frame's buffer when needsUpdate is not set.
    if (!this._colorsDirty) return;
    this._colorsDirty = false;

    for (const batch of this._dirtyTypeBatches) {
      if (batch.instancedMesh.instanceColor) {
        batch.instancedMesh.instanceColor.needsUpdate = true;
      }
      batch.opacityAttribute.needsUpdate = true;
    }
    // Also flush LOD batches
    for (const lodBatch of this._dirtyLODBatches) {
      if (lodBatch.instancedMesh.instanceColor) {
        lodBatch.instancedMesh.instanceColor.needsUpdate = true;
      }
      lodBatch.opacityAttribute.needsUpdate = true;
    }
    this._dirtyTypeBatches.clear();
    this._dirtyLODBatches.clear();
  }

  /**
   * Check if an enemy is managed by this instance manager.
   */
  isManaged(enemy: BaseEnemy): boolean {
    return (enemy as any)._instanceType !== undefined;
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    for (const batch of this.batches.values()) {
      this.scene.remove(batch.instancedMesh);
      batch.geometry.dispose();
      batch.material.dispose();
      batch.instancedMesh.dispose();
    }
    this.batches.clear();

    // Dispose LOD shared batches
    if (this.lodMediumBatch) {
      this.scene.remove(this.lodMediumBatch.instancedMesh);
      this.lodMediumBatch.material.dispose();
      this.lodMediumBatch.instancedMesh.dispose();
      this.lodMediumBatch = null;
    }
    if (this.lodLowBatch) {
      this.scene.remove(this.lodLowBatch.instancedMesh);
      this.lodLowBatch.material.dispose();
      this.lodLowBatch.instancedMesh.dispose();
      this.lodLowBatch = null;
    }
    this.lodGeometryCache.dispose();
    this.enemyLODPlacement.clear();
    this.typeBaseColors.clear();
  }

  /**
   * Get draw call statistics.
   */
  getStats(): {
    batchCount: number;
    totalInstances: number;
    typeBreakdown: Map<string, number>;
    lodMediumInstances: number;
    lodLowInstances: number;
  } {
    const typeBreakdown = new Map<string, number>();
    let totalInstances = 0;
    for (const [key, batch] of this.batches) {
      const count = batch.enemyToIndex.size;
      typeBreakdown.set(key, count);
      totalInstances += count;
    }
    return {
      batchCount: this.batches.size + (this.lodMediumBatch ? 1 : 0) + (this.lodLowBatch ? 1 : 0),
      totalInstances,
      typeBreakdown,
      lodMediumInstances: this.lodMediumBatch?.usedCount ?? 0,
      lodLowInstances: this.lodLowBatch?.usedCount ?? 0,
    };
  }

  /**
   * Get LOD statistics: how many enemies are in each LOD batch.
   */
  getLODStats(): { mediumCount: number; lowCount: number } {
    return {
      mediumCount: this.lodMediumBatch?.usedCount ?? 0,
      lowCount: this.lodLowBatch?.usedCount ?? 0,
    };
  }

  // ---- LOD batch helpers (zero per-frame allocations) ----

  /**
   * Create a shared LOD InstancedMesh batch with a simplified geometry.
   */
  private createLODSharedBatch(
    name: string,
    geometry: THREE.BufferGeometry,
  ): LODSharedBatch {
    // s44r11-01: Switched to MeshBasicMaterial (see createBatch() comment for rationale).
    // LOD batches must match type batches' dimming behavior.
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    // Per-instance alpha (same as type batches). See createBatch() REGRESSION GUARD (s44r12-03).
    this._applyInstanceOpacity(material, `lod-${name}`);

    const instancedMesh = new THREE.InstancedMesh(
      geometry,
      material,
      LOD_BATCH_MAX_INSTANCES,
    );
    instancedMesh.count = 0;
    instancedMesh.frustumCulled = false;
    instancedMesh.name = name;
    // Surface/grid do not write depth; player bodies do. Rendering after the
    // grid while respecting depth keeps readable ghosts behind player pixels.
    instancedMesh.renderOrder = 2;

    // Initialize all slots to zero-scale
    for (let i = 0; i < LOD_BATCH_MAX_INSTANCES; i++) {
      _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
      instancedMesh.setMatrixAt(i, _tempMatrix);
      instancedMesh.setColorAt(i, _tempColor.setHex(0xffffff));
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }

    const opacityArray = new Float32Array(LOD_BATCH_MAX_INSTANCES);
    opacityArray.fill(1.0);
    const opacityAttribute = new THREE.InstancedBufferAttribute(opacityArray, 1);
    instancedMesh.geometry.setAttribute('instanceOpacity', opacityAttribute);

    return {
      geometry,
      material,
      instancedMesh,
      opacityAttribute,
      enemyToIndex: new Map(),
      indexToEnemy: new Array(LOD_BATCH_MAX_INSTANCES).fill(null),
      nextFreeIndex: 0,
      usedCount: 0,
      highWaterMark: -1,
      minBrightness: new Float32Array(LOD_BATCH_MAX_INSTANCES).fill(ENEMY_OCCLUSION_DEFAULT_MIN_BRIGHTNESS),
    };
  }

  /**
   * Place an enemy instance into a shared LOD batch.
   * Uses the enemy's world position + the type's base color.
   * Both simplified levels retain the enemy's surface orientation.
   */
  private placeLODInstance(
    enemy: BaseEnemy,
    typeKey: string,
    lodBatch: LODSharedBatch,
    lodLevel: LODLevel,
  ): void {
    // Get or allocate a slot
    let slotIndex = lodBatch.enemyToIndex.get(enemy);
    let allocated = false;
    if (slotIndex === undefined) {
      slotIndex = this.allocateLODSlot(lodBatch);
      if (slotIndex < 0) return; // No free slots
      lodBatch.enemyToIndex.set(enemy, slotIndex);
      lodBatch.indexToEnemy[slotIndex] = enemy;
      allocated = true;
    }

    // Extract position from enemy mesh world matrix
    _tempPosition.setFromMatrixPosition(enemy.mesh!.matrixWorld);

    _tempQuaternion.setFromRotationMatrix(enemy.mesh!.matrixWorld);
    const s = enemy.radius * (lodLevel === LODLevel.LOW ? 1.65 : 1.5);
    _lodScale.set(s, s, s);
    _tempMatrix.compose(_tempPosition, _tempQuaternion, _lodScale);

    lodBatch.instancedMesh.setMatrixAt(slotIndex, _tempMatrix);

    if (allocated) {
      // Initialize visual attributes once. The rendered-frame visibility pass owns
      // subsequent changes; rewriting base color/opacity here forced a GPU upload
      // every frame for dimmed LOD enemies.
      const baseColor = this.typeBaseColors.get(typeKey);
      if (baseColor) lodBatch.instancedMesh.setColorAt(slotIndex, baseColor);
      lodBatch.opacityAttribute.setX(slotIndex, 1.0);
      this._colorsDirty = true;
      this._dirtyLODBatches.add(lodBatch);
    }

    // Track placement
    this.enemyLODPlacement.set(enemy, lodLevel);
  }

  /**
   * Remove an enemy from its current LOD shared batch.
   */
  private removeLODPlacement(enemy: BaseEnemy): void {
    const currentLOD = this.enemyLODPlacement.get(enemy);
    if (currentLOD === undefined) return;

    const lodBatch = currentLOD === LODLevel.MEDIUM ? this.lodMediumBatch : this.lodLowBatch;
    if (!lodBatch) return;

    const slotIndex = lodBatch.enemyToIndex.get(enemy);
    if (slotIndex !== undefined) {
      // Zero-scale to hide
      _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
      lodBatch.instancedMesh.setMatrixAt(slotIndex, _tempMatrix);
      lodBatch.opacityAttribute.setX(slotIndex, 0.0);

      lodBatch.enemyToIndex.delete(enemy);
      lodBatch.indexToEnemy[slotIndex] = null;
      lodBatch.usedCount = Math.max(0, lodBatch.usedCount - 1);

      // Update highWaterMark if we just freed the highest slot
      // RC15: Scan from top of array, not from freed index downward.
      // Matches the fix in unregister() (lines 316-322) — old code missed
      // occupied slots above the freed index via wrap-around allocation.
      if (slotIndex >= lodBatch.highWaterMark) {
        let newMax = -1;
        for (let i = LOD_BATCH_MAX_INSTANCES - 1; i >= 0; i--) {
          if (lodBatch.indexToEnemy[i] !== null) { newMax = i; break; }
        }
        lodBatch.highWaterMark = newMax;
      }
    }

    this.enemyLODPlacement.delete(enemy);
  }

  /**
   * Hide all instances in a LOD batch (called at start of frame, re-shown for active enemies).
   */
  private hideAllLODInstances(lodBatch: LODSharedBatch): void {
    // Only hide slots that are actually occupied (avoid touching all 500 slots)
    for (const [, slotIndex] of lodBatch.enemyToIndex) {
      _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
      lodBatch.instancedMesh.setMatrixAt(slotIndex, _tempMatrix);
    }
  }

  /**
   * Allocate a free slot in a LOD shared batch.
   */
  private allocateLODSlot(lodBatch: LODSharedBatch): number {
    for (let i = lodBatch.nextFreeIndex; i < LOD_BATCH_MAX_INSTANCES; i++) {
      if (lodBatch.indexToEnemy[i] === null) {
        lodBatch.nextFreeIndex = i + 1;
        lodBatch.usedCount++;
        if (i > lodBatch.highWaterMark) lodBatch.highWaterMark = i;
        return i;
      }
    }
    for (let i = 0; i < lodBatch.nextFreeIndex; i++) {
      if (lodBatch.indexToEnemy[i] === null) {
        lodBatch.nextFreeIndex = i + 1;
        lodBatch.usedCount++;
        if (i > lodBatch.highWaterMark) lodBatch.highWaterMark = i;
        return i;
      }
    }
    return -1;
  }

  /**
   * Get the highest used index in a LOD batch (for setting count).
   */
  private getMaxUsedLODIndex(lodBatch: LODSharedBatch): number {
    for (let i = LOD_BATCH_MAX_INSTANCES - 1; i >= 0; i--) {
      if (lodBatch.indexToEnemy[i] !== null) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Finalize a LOD batch: mark dirty, set count.
   */
  private finalizeLODBatch(lodBatch: LODSharedBatch): void {
    lodBatch.instancedMesh.instanceMatrix.needsUpdate = true;
    // highWaterMark is O(1) — maintained incrementally in allocateLODSlot/removeLODPlacement.
    lodBatch.instancedMesh.count = lodBatch.highWaterMark + 1;
  }

  /**
   * Set per-instance opacity on LOD batches for a given enemy.
   * Called from main.ts render loop alongside setInstanceVisibility.
   */
  setLODInstanceVisibility(
    enemy: BaseEnemy,
    visibility: number,
    minColorBrightness = ENEMY_OCCLUSION_DEFAULT_MIN_BRIGHTNESS,
  ): void {
    const currentLOD = this.enemyLODPlacement.get(enemy);
    if (currentLOD === undefined) return;

    const lodBatch = currentLOD === LODLevel.MEDIUM ? this.lodMediumBatch : this.lodLowBatch;
    if (!lodBatch) return;

    const slotIndex = lodBatch.enemyToIndex.get(enemy);
    if (slotIndex === undefined) return;

    // s44r21-01: NaN guard (same as setInstanceVisibility)
    if (!isFinite(visibility) || visibility < 0) visibility = 1.0;

    // s44r18-20: RGB-only dimming — binary opacityAttribute to avoid visibility² darkening.
    // See setInstanceVisibility for full rationale.
    const nextOpacity = visibility > 0 ? 1.0 : 0.0;
    const nextMinBrightness = visibility > 0
      ? Math.max(0, Math.min(ENEMY_OCCLUSION_DEFAULT_MIN_BRIGHTNESS, minColorBrightness))
      : 0;

    // RGB-based dimming for LOD batches (WebGPU compatibility).
    // Use the enemy type's base color since LOD batches are shared across types.
    const typeKey = (enemy as any)._instanceType as string | undefined;
    const baseColor = typeKey ? this.typeBaseColors.get(typeKey) : null;
    if (baseColor) {
      let r = baseColor.r * visibility;
      let g = baseColor.g * visibility;
      let b = baseColor.b * visibility;

      // s44r29-01: Same minimum ICB floor as setInstanceVisibility (see comment there).
      if (visibility > 0) {
        const avg = (r + g + b) / 3;
        const MIN_ICB = nextMinBrightness;
        if (avg > 0 && avg < MIN_ICB) {
          const scale = MIN_ICB / avg;
          r *= scale;
          g *= scale;
          b *= scale;
        } else if (avg === 0) {
          r = MIN_ICB;
          g = MIN_ICB;
          b = MIN_ICB;
        }
      }

      const colorAttribute = lodBatch.instancedMesh.instanceColor;
      const colorChanged = !colorAttribute
        || Math.abs(colorAttribute.getX(slotIndex) - r) > 1e-6
        || Math.abs(colorAttribute.getY(slotIndex) - g) > 1e-6
        || Math.abs(colorAttribute.getZ(slotIndex) - b) > 1e-6;
      const opacityChanged = Math.abs(lodBatch.opacityAttribute.getX(slotIndex) - nextOpacity) > 1e-6;
      const minChanged = Math.abs(lodBatch.minBrightness[slotIndex] - nextMinBrightness) > 1e-6;
      if (opacityChanged) lodBatch.opacityAttribute.setX(slotIndex, nextOpacity);
      if (minChanged) lodBatch.minBrightness[slotIndex] = nextMinBrightness;
      if (colorChanged) {
        _tempColor.setRGB(r, g, b);
        lodBatch.instancedMesh.setColorAt(slotIndex, _tempColor);
      }
      if (colorChanged || opacityChanged) {
        this._colorsDirty = true;
        this._dirtyLODBatches.add(lodBatch);
      }
    }
  }

  /**
   * Check if an enemy is currently placed in a LOD shared batch.
   */
  isInLODBatch(enemy: BaseEnemy): boolean {
    return this.enemyLODPlacement.has(enemy);
  }

  // ---- Private helpers ----

  /**
   * Create an InstancedMesh batch from a prototype enemy mesh.
   * Merges all child geometries into one BufferGeometry.
   */
  private createBatch(typeKey: string, prototypeMesh: THREE.Group): InstanceBatch | null {
    // Collect all child mesh geometries, applying their local transforms
    const geometries: THREE.BufferGeometry[] = [];
    let baseColor = new THREE.Color(0xffffff);

    prototypeMesh.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const geo = child.geometry as THREE.BufferGeometry;
        // Skip degenerate (zero-length edge) geometries
        if (!geo.attributes.position || geo.attributes.position.count === 0) {
          return;
        }

        // Clone geometry and apply the child's local transform
        const clonedGeo = geo.clone();
        child.updateWorldMatrix(true, false);

        // Get the local transform relative to the prototype mesh root
        const localMatrix = new THREE.Matrix4();
        localMatrix.copy(child.matrixWorld);

        // We need relative-to-group transform, not world transform
        // Since the prototypeMesh might have a world transform applied,
        // we compute child's transform relative to prototypeMesh
        const groupInverse = new THREE.Matrix4().copy(prototypeMesh.matrixWorld).invert();
        localMatrix.premultiply(groupInverse);

        clonedGeo.applyMatrix4(localMatrix);

        // Strip non-position attributes that might differ between children
        // Keep only position and normal for the merged geometry
        const stripped = new THREE.BufferGeometry();
        stripped.setAttribute('position', clonedGeo.getAttribute('position'));
        if (clonedGeo.getAttribute('normal')) {
          stripped.setAttribute('normal', clonedGeo.getAttribute('normal'));
        }
        if (clonedGeo.index) {
          stripped.setIndex(clonedGeo.index);
        }

        geometries.push(stripped);

        // Extract base color from the first valid material
        if (baseColor.getHex() === 0xffffff && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.color) {
            baseColor = mat.color.clone();
          }
        }
      }
    });

    if (geometries.length === 0) {
      return null;
    }

    // Merge all geometries into one
    const mergedGeometry = mergeGeometries(geometries, false);
    if (!mergedGeometry) {
      return null;
    }

    // Create shared material (one per enemy type)
    // s44r11-01: Switched from MeshStandardMaterial to MeshBasicMaterial.
    // MeshStandardMaterial had emissive at 2.0× baseColor which dominated visual output.
    // Since the main game has NO scene lights (main.ts adds none), MeshStandardMaterial's
    // diffuse channel contributed nothing — enemies were lit entirely by emissive.
    // Three.js instanceColor only modulates diffuse, NOT emissive, so RGB dimming
    // (per-instance color × 0.3 for far-side enemies) was invisible.
    //
    // MeshBasicMaterial is unlit: output = material.color × instanceColor. No emissive
    // channel to fight with. Per-instance RGB dimming directly controls visual brightness.
    // The bloom post-processing effect provides the glow halo (unchanged).
    // The onBeforeCompile shader injection still works for additional alpha dimming on WebGL.
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff, // White - actual color comes from instanceColor
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
    });

    // Per-instance alpha transparency: two paths depending on renderer backend.
    //
    // REGRESSION GUARD (s44r12-03): Only multiply ALPHA by instanceOpacity, NOT rgb.
    // instanceColor already carries RGB dimming (baseColor × V). Multiplying rgb too
    // causes vis² double-dimming (V=0.15 → 2.25% brightness → invisible).
    this._applyInstanceOpacity(material, `enemy-${typeKey}`);

    // s44r11-01: Shader effects (lava, crystal, pulse, nebula) are skipped with MeshBasicMaterial.
    // The effects use `objectNormal` and `modelMatrix` which are only available in
    // MeshStandardMaterial's shader. MeshBasicMaterial doesn't compute normals.
    // The bloom post-processing and per-instance color provide sufficient visual variety.
    // If shader effects are needed in the future, they should be rewritten for basic shaders.

    // Create InstancedMesh
    const instancedMesh = new THREE.InstancedMesh(mergedGeometry, material, this.maxInstances);
    instancedMesh.count = 0; // Start with 0 visible instances
    instancedMesh.frustumCulled = false; // Enemies are on curved surfaces; bbox culling is unreliable
    instancedMesh.name = `instanced-${typeKey}`;
    instancedMesh.renderOrder = 2;

    // Initialize all instance matrices to zero-scale (hidden)
    for (let i = 0; i < this.maxInstances; i++) {
      _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
      instancedMesh.setMatrixAt(i, _tempMatrix);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;

    // Initialize instance colors to base color
    for (let i = 0; i < this.maxInstances; i++) {
      instancedMesh.setColorAt(i, baseColor);
    }
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }

    // Create per-instance opacity attribute (float, default 1.0 = fully opaque)
    const opacityArray = new Float32Array(this.maxInstances);
    opacityArray.fill(1.0);
    const opacityAttribute = new THREE.InstancedBufferAttribute(opacityArray, 1);
    instancedMesh.geometry.setAttribute('instanceOpacity', opacityAttribute);

    // Create per-instance intended color array (RGB, 3 floats per instance).
    // Tracks the undimmed color for each instance so setInstanceVisibility can
    // modulate instanceColor correctly. Initialized to baseColor.
    const perInstanceColors = new Float32Array(this.maxInstances * 3);
    for (let i = 0; i < this.maxInstances; i++) {
      perInstanceColors[i * 3] = baseColor.r;
      perInstanceColors[i * 3 + 1] = baseColor.g;
      perInstanceColors[i * 3 + 2] = baseColor.b;
    }
    const perInstanceMinBrightness = new Float32Array(this.maxInstances);
    perInstanceMinBrightness.fill(ENEMY_OCCLUSION_DEFAULT_MIN_BRIGHTNESS);

    return {
      geometry: mergedGeometry,
      material,
      instancedMesh,
      opacityAttribute,
      perInstanceColors,
      perInstanceMinBrightness,
      enemyToIndex: new Map(),
      indexToEnemy: new Array(this.maxInstances).fill(null),
      nextFreeIndex: 0,
      activeCount: 0,
      baseColor,
      highWaterMark: -1,
    };
  }

  /**
   * Allocate the next free slot in a batch.
   * Uses a simple linear scan from nextFreeIndex.
   */
  private allocateSlot(batch: InstanceBatch): number {
    // Start scanning from the hint
    for (let i = batch.nextFreeIndex; i < this.maxInstances; i++) {
      if (batch.indexToEnemy[i] === null) {
        batch.nextFreeIndex = i + 1;
        if (i > batch.highWaterMark) batch.highWaterMark = i;
        return i;
      }
    }
    // Wrap around and scan from 0
    for (let i = 0; i < batch.nextFreeIndex; i++) {
      if (batch.indexToEnemy[i] === null) {
        batch.nextFreeIndex = i + 1;
        if (i > batch.highWaterMark) batch.highWaterMark = i;
        return i;
      }
    }
    return -1; // All slots full
  }

  /**
   * Get the highest used index in a batch (for setting instancedMesh.count).
   */
  private getMaxUsedIndex(batch: InstanceBatch): number {
    for (let i = this.maxInstances - 1; i >= 0; i--) {
      if (batch.indexToEnemy[i] !== null) {
        return i;
      }
    }
    return -1;
  }
}
