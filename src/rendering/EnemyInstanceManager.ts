import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { LODLevel, LODGeometryCache } from './LODManager';
import { getEnemyShaderStyle, enhanceMaterialWithShaderEffect } from './EnemyShaderEffects';
import { getEntityVisibilityState, EntityVisibilityState } from './EntityCulling';

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
  /** Shared material (MeshStandardMaterial clone). */
  material: THREE.MeshStandardMaterial;
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
}

/**
 * LODSharedBatch - A shared InstancedMesh for all enemies at a given LOD level.
 * MEDIUM LOD uses simplified icosahedron geometry (20 tris).
 * LOW LOD uses billboard quad geometry (2 tris).
 * Enemies are colored per-instance using their type's base color.
 */
interface LODSharedBatch {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  instancedMesh: THREE.InstancedMesh;
  opacityAttribute: THREE.InstancedBufferAttribute;
  /** Map from enemy reference to its slot index in this LOD batch. */
  enemyToIndex: Map<BaseEnemy, number>;
  /** Reverse map: index to enemy for slot recycling. */
  indexToEnemy: (BaseEnemy | null)[];
  nextFreeIndex: number;
  /** Number of slots currently occupied. */
  usedCount: number;
}

/** Temporary objects reused per-frame to avoid GC pressure. */
const _tempMatrix = new THREE.Matrix4();
const _tempPosition = new THREE.Vector3();
const _tempQuaternion = new THREE.Quaternion();
const _tempColor = new THREE.Color();
const _zeroScale = new THREE.Vector3(0, 0, 0);
const _lodScale = new THREE.Vector3();
const _lodBillboardUp = new THREE.Vector3(0, 1, 0);

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

  /** Shared LOD batches for reduced-detail rendering. */
  private lodMediumBatch: LODSharedBatch | null = null;
  private lodLowBatch: LODSharedBatch | null = null;
  private lodGeometryCache: LODGeometryCache = new LODGeometryCache();

  /** Tracks which LOD batch each enemy is currently in (MEDIUM or LOW), if any.
   *  Enemies at HIGH LOD are NOT in this map — they use their type-specific batch. */
  private enemyLODPlacement: Map<BaseEnemy, LODLevel> = new Map();

  /** Per-type base colors extracted during batch creation, used to color LOD instances. */
  private typeBaseColors: Map<EnemyTypeKey, THREE.Color> = new Map();

  constructor(scene: THREE.Scene, maxInstances = DEFAULT_MAX_INSTANCES) {
    this.scene = scene;
    this.maxInstances = maxInstances;
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

    // Free the slot
    batch.enemyToIndex.delete(enemy);
    batch.indexToEnemy[index] = null;

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

      // Skip materializing enemies (spawn warning in progress) - keep at zero scale
      if (enemy.isMaterializing) continue;

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
      batch.instancedMesh.count = this.getMaxUsedIndex(batch) + 1;
    }
  }

  /**
   * Update all instance matrices with LOD-aware geometry swapping.
   * Enemies at MEDIUM/LOW LOD are hidden in their type-specific batch and
   * shown in a shared simplified-geometry batch instead. This reduces triangle
   * count for distant enemies from ~200 per enemy to 20 (medium) or 2 (low).
   *
   * @param enemies - All active enemies.
   * @param lodAssignments - LOD level per enemy from LODManager.update().
   * @param camera - Camera for billboard orientation (LOW LOD quads face camera).
   */
  updateInstancesWithLOD(
    enemies: BaseEnemy[],
    lodAssignments: Map<BaseEnemy, LODLevel>,
    camera: THREE.Camera,
    /** Phase 1 culling: hide or dim instanced enemies >90° from player's surface normal. */
    playerCulling?: { position: THREE.Vector3; normal: THREE.Vector3 },
    /** When true, entities >90° are fully hidden (zero-scaled). When false (default), they are dimmed to 0.3 opacity. */
    hide90DegreeEntities: boolean = false,
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

    const cameraPos = camera.position;

    for (const enemy of enemies) {
      if (!enemy.active || !enemy.alive) continue;

      const typeKey = (enemy as any)._instanceType as string | undefined;
      if (!typeKey) continue;

      const batch = this.batches.get(typeKey);
      if (!batch) continue;

      const highIndex = batch.enemyToIndex.get(enemy);
      if (highIndex === undefined) continue;

      if (!enemy.mesh) continue;

      // Skip materializing enemies (spawn warning in progress)
      if (enemy.isMaterializing) continue;

      // Phase 1 culling: hide or dim enemies >90° from player's surface normal hemisphere.
      if (playerCulling && enemy.mesh) {
        const visibility = getEntityVisibilityState(
          playerCulling.position,
          playerCulling.normal,
          enemy.mesh.position,
        );
        if (visibility === EntityVisibilityState.HIDDEN) {
          if (hide90DegreeEntities) {
            // Old behavior: zero-scale the high-detail instance slot (fully hidden)
            _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
            batch.instancedMesh.setMatrixAt(highIndex, _tempMatrix);
            // Remove from any LOD shared batch too
            if (this.enemyLODPlacement.has(enemy)) {
              this.removeLODPlacement(enemy);
            }
            continue;
          } else {
            // Dim behavior: render at 0.3 opacity so the entity is visible but clearly on the far side
            batch.opacityAttribute.setX(highIndex, 0.3);
          }
        } else {
          // Visible entity: restore full opacity
          batch.opacityAttribute.setX(highIndex, 1.0);
        }
      }

      const lodLevel = lodAssignments.get(enemy);

      if (lodLevel === LODLevel.MEDIUM || lodLevel === LODLevel.LOW) {
        // Hide in the HIGH-detail type batch
        _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
        batch.instancedMesh.setMatrixAt(highIndex, _tempMatrix);

        // Show in the shared LOD batch
        const lodBatch = lodLevel === LODLevel.MEDIUM ? this.lodMediumBatch : this.lodLowBatch;
        enemy.mesh.updateWorldMatrix(false, false);
        this.placeLODInstance(enemy, typeKey, lodBatch, lodLevel, cameraPos);
      } else {
        // HIGH LOD: render in the type-specific batch (normal path)
        enemy.mesh.updateWorldMatrix(false, false);
        batch.instancedMesh.setMatrixAt(highIndex, enemy.mesh.matrixWorld);
        batch.activeCount++;

        // If enemy was previously in a LOD batch, remove it
        if (this.enemyLODPlacement.has(enemy)) {
          this.removeLODPlacement(enemy);
        }
      }
    }

    // Finalize HIGH-detail batches
    for (const batch of this.batches.values()) {
      batch.instancedMesh.instanceMatrix.needsUpdate = true;
      if (batch.instancedMesh.instanceColor) {
        batch.instancedMesh.instanceColor.needsUpdate = true;
      }
      batch.instancedMesh.count = this.getMaxUsedIndex(batch) + 1;
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
  setInstanceVisibility(enemy: BaseEnemy, visibility: number): void {
    const typeKey = (enemy as any)._instanceType as string | undefined;
    if (!typeKey) return;

    const batch = this.batches.get(typeKey);
    if (!batch) return;

    const index = batch.enemyToIndex.get(enemy);
    if (index === undefined) return;

    // Write to the per-instance opacity attribute (read by fragment shader)
    batch.opacityAttribute.setX(index, visibility);
  }

  /**
   * Flush visibility and color changes (call after setting all visibilities for the frame).
   */
  flushColors(): void {
    for (const batch of this.batches.values()) {
      if (batch.instancedMesh.instanceColor) {
        batch.instancedMesh.instanceColor.needsUpdate = true;
      }
      batch.opacityAttribute.needsUpdate = true;
    }
    // Also flush LOD batches
    if (this.lodMediumBatch) {
      if (this.lodMediumBatch.instancedMesh.instanceColor) {
        this.lodMediumBatch.instancedMesh.instanceColor.needsUpdate = true;
      }
      this.lodMediumBatch.opacityAttribute.needsUpdate = true;
    }
    if (this.lodLowBatch) {
      if (this.lodLowBatch.instancedMesh.instanceColor) {
        this.lodLowBatch.instancedMesh.instanceColor.needsUpdate = true;
      }
      this.lodLowBatch.opacityAttribute.needsUpdate = true;
    }
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
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 2.5,
      metalness: 0.1,
      roughness: 0.3,
      transparent: true,
      depthWrite: false,
    });

    // Inject per-instance opacity (same shader injection as type batches)
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
        '#include <dithering_fragment>\n  gl_FragColor.rgb *= vInstanceOpacity;\n  gl_FragColor.a *= vInstanceOpacity;',
      );
    };

    const instancedMesh = new THREE.InstancedMesh(
      geometry,
      material,
      LOD_BATCH_MAX_INSTANCES,
    );
    instancedMesh.count = 0;
    instancedMesh.frustumCulled = false;
    instancedMesh.name = name;

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
    };
  }

  /**
   * Place an enemy instance into a shared LOD batch.
   * Uses the enemy's world position + the type's base color.
   * For LOW LOD (billboards), orients the quad to face the camera.
   */
  private placeLODInstance(
    enemy: BaseEnemy,
    typeKey: string,
    lodBatch: LODSharedBatch,
    lodLevel: LODLevel,
    cameraPos: THREE.Vector3,
  ): void {
    // Get or allocate a slot
    let slotIndex = lodBatch.enemyToIndex.get(enemy);
    if (slotIndex === undefined) {
      slotIndex = this.allocateLODSlot(lodBatch);
      if (slotIndex < 0) return; // No free slots
      lodBatch.enemyToIndex.set(enemy, slotIndex);
      lodBatch.indexToEnemy[slotIndex] = enemy;
    }

    // Extract position from enemy mesh world matrix
    _tempPosition.setFromMatrixPosition(enemy.mesh!.matrixWorld);

    if (lodLevel === LODLevel.LOW) {
      // Billboard: orient quad to face camera
      _tempMatrix.lookAt(_tempPosition, cameraPos, _lodBillboardUp);
      _tempQuaternion.setFromRotationMatrix(_tempMatrix);
      // Scale based on enemy radius for appropriate visual size
      const s = enemy.radius * 2;
      _lodScale.set(s, s, s);
      _tempMatrix.compose(_tempPosition, _tempQuaternion, _lodScale);
    } else {
      // MEDIUM: use icosahedron with enemy's rotation but simplified geometry
      _tempQuaternion.setFromRotationMatrix(enemy.mesh!.matrixWorld);
      const s = enemy.radius * 1.5;
      _lodScale.set(s, s, s);
      _tempMatrix.compose(_tempPosition, _tempQuaternion, _lodScale);
    }

    lodBatch.instancedMesh.setMatrixAt(slotIndex, _tempMatrix);

    // Color from the enemy type's base color
    const baseColor = this.typeBaseColors.get(typeKey);
    if (baseColor) {
      lodBatch.instancedMesh.setColorAt(slotIndex, baseColor);
    }

    // Opacity: keep at 1.0 (main.ts render loop handles opacity via setInstanceVisibility)
    lodBatch.opacityAttribute.setX(slotIndex, 1.0);

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
        return i;
      }
    }
    for (let i = 0; i < lodBatch.nextFreeIndex; i++) {
      if (lodBatch.indexToEnemy[i] === null) {
        lodBatch.nextFreeIndex = i + 1;
        lodBatch.usedCount++;
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
    if (lodBatch.instancedMesh.instanceColor) {
      lodBatch.instancedMesh.instanceColor.needsUpdate = true;
    }
    lodBatch.opacityAttribute.needsUpdate = true;
    lodBatch.instancedMesh.count = this.getMaxUsedLODIndex(lodBatch) + 1;
  }

  /**
   * Set per-instance opacity on LOD batches for a given enemy.
   * Called from main.ts render loop alongside setInstanceVisibility.
   */
  setLODInstanceVisibility(enemy: BaseEnemy, visibility: number): void {
    const currentLOD = this.enemyLODPlacement.get(enemy);
    if (currentLOD === undefined) return;

    const lodBatch = currentLOD === LODLevel.MEDIUM ? this.lodMediumBatch : this.lodLowBatch;
    if (!lodBatch) return;

    const slotIndex = lodBatch.enemyToIndex.get(enemy);
    if (slotIndex === undefined) return;

    lodBatch.opacityAttribute.setX(slotIndex, visibility);
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
    let templateMaterial: THREE.MeshStandardMaterial | null = null;

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

        // Extract color from the first valid material
        if (!templateMaterial && child.material) {
          const mat = child.material as THREE.MeshStandardMaterial;
          if (mat.color) {
            baseColor = mat.color.clone();
            templateMaterial = mat;
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
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, // White - actual color comes from instanceColor
      emissive: baseColor.clone(),
      emissiveIntensity: templateMaterial ? Math.max((templateMaterial as THREE.MeshStandardMaterial).emissiveIntensity, 2.0) : 2.0,
      metalness: templateMaterial ? (templateMaterial as THREE.MeshStandardMaterial).metalness : 0.3,
      roughness: templateMaterial ? (templateMaterial as THREE.MeshStandardMaterial).roughness : 0.4,
      transparent: true,
      depthWrite: false, // Transparent objects should not write to depth buffer
    });

    // Inject per-instance opacity into the shader via onBeforeCompile.
    // This reads a custom `instanceOpacity` attribute and multiplies the
    // fragment alpha by it, producing real per-instance transparency.
    material.onBeforeCompile = (shader) => {
      // Declare the attribute + varying in the vertex shader
      shader.vertexShader = shader.vertexShader.replace(
        'void main() {',
        'attribute float instanceOpacity;\nvarying float vInstanceOpacity;\nvoid main() {\n  vInstanceOpacity = instanceOpacity;',
      );
      // Multiply the fragment output alpha by the per-instance opacity
      shader.fragmentShader = shader.fragmentShader.replace(
        'void main() {',
        'varying float vInstanceOpacity;\nvoid main() {',
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n  gl_FragColor.rgb *= vInstanceOpacity;\n  gl_FragColor.a *= vInstanceOpacity;',
      );
    };

    // Enhance material with per-type shader effects (lava, crystal, pulse, nebula)
    // This wraps the existing onBeforeCompile to add vertex displacement + fragment color mods
    const shaderStyle = getEnemyShaderStyle(typeKey);
    enhanceMaterialWithShaderEffect(material, shaderStyle, baseColor);

    // Create InstancedMesh
    const instancedMesh = new THREE.InstancedMesh(mergedGeometry, material, this.maxInstances);
    instancedMesh.count = 0; // Start with 0 visible instances
    instancedMesh.frustumCulled = false; // Enemies are on curved surfaces; bbox culling is unreliable
    instancedMesh.name = `instanced-${typeKey}`;

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

    return {
      geometry: mergedGeometry,
      material,
      instancedMesh,
      opacityAttribute,
      enemyToIndex: new Map(),
      indexToEnemy: new Array(this.maxInstances).fill(null),
      nextFreeIndex: 0,
      activeCount: 0,
      baseColor,
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
        return i;
      }
    }
    // Wrap around and scan from 0
    for (let i = 0; i < batch.nextFreeIndex; i++) {
      if (batch.indexToEnemy[i] === null) {
        batch.nextFreeIndex = i + 1;
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
