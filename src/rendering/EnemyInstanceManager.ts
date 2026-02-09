import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';

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

/** Enemy type identifier extracted from the constructor name. */
type EnemyTypeKey = string;

interface InstanceBatch {
  /** The merged geometry for this enemy type. */
  geometry: THREE.BufferGeometry;
  /** Shared material (MeshStandardMaterial clone). */
  material: THREE.MeshStandardMaterial;
  /** The InstancedMesh object added to the scene. */
  instancedMesh: THREE.InstancedMesh;
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

/** Temporary objects reused per-frame to avoid GC pressure. */
const _tempMatrix = new THREE.Matrix4();
const _tempPosition = new THREE.Vector3();
const _tempQuaternion = new THREE.Quaternion();
const _tempColor = new THREE.Color();
const _zeroScale = new THREE.Vector3(0, 0, 0);

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

    // Hide this instance by setting scale to 0
    _tempMatrix.compose(_tempPosition.set(0, 0, 0), _tempQuaternion.identity(), _zeroScale);
    batch.instancedMesh.setMatrixAt(index, _tempMatrix);

    // Free the slot
    batch.enemyToIndex.delete(enemy);
    batch.indexToEnemy[index] = null;

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
   * Set per-instance opacity via the instance color alpha trick.
   * Since InstancedMesh doesn't natively support per-instance opacity,
   * we encode it in the color brightness (darken = transparent effect).
   */
  setInstanceVisibility(enemy: BaseEnemy, visibility: number): void {
    const typeKey = (enemy as any)._instanceType as string | undefined;
    if (!typeKey) return;

    const batch = this.batches.get(typeKey);
    if (!batch) return;

    const index = batch.enemyToIndex.get(enemy);
    if (index === undefined) return;

    // Modulate base color by visibility factor
    _tempColor.copy(batch.baseColor).multiplyScalar(visibility);
    batch.instancedMesh.setColorAt(index, _tempColor);
  }

  /**
   * Flush visibility changes (call after setting all visibilities for the frame).
   */
  flushColors(): void {
    for (const batch of this.batches.values()) {
      if (batch.instancedMesh.instanceColor) {
        batch.instancedMesh.instanceColor.needsUpdate = true;
      }
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
  }

  /**
   * Get draw call statistics.
   */
  getStats(): { batchCount: number; totalInstances: number; typeBreakdown: Map<string, number> } {
    const typeBreakdown = new Map<string, number>();
    let totalInstances = 0;
    for (const [key, batch] of this.batches) {
      const count = batch.enemyToIndex.size;
      typeBreakdown.set(key, count);
      totalInstances += count;
    }
    return {
      batchCount: this.batches.size,
      totalInstances,
      typeBreakdown,
    };
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
      emissiveIntensity: templateMaterial ? (templateMaterial as THREE.MeshStandardMaterial).emissiveIntensity : 0.4,
      metalness: templateMaterial ? (templateMaterial as THREE.MeshStandardMaterial).metalness : 0.3,
      roughness: templateMaterial ? (templateMaterial as THREE.MeshStandardMaterial).roughness : 0.4,
      transparent: true,
    });

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

    return {
      geometry: mergedGeometry,
      material,
      instancedMesh,
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
