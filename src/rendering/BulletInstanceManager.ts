import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Bullet visual types
// ---------------------------------------------------------------------------

/**
 * Visual categories for instanced bullet rendering.
 * Each type maps to a distinct geometry + default color + scale.
 * Weapon types that don't have a dedicated visual fall back to Default.
 */
export enum BulletVisualType {
  Standard = 'standard',
  Spread = 'spread',
  Piercing = 'piercing',
  Homing = 'homing',
  Default = 'default',
}

/**
 * Per-type visual configuration.
 */
export interface BulletVisualConfig {
  color: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  /** Factory for the shared geometry of this type. */
  createGeometry: () => THREE.BufferGeometry;
}

/**
 * Visual configs keyed by BulletVisualType.
 *
 * Geometries are small capsule/cylinder shapes oriented along local +Z
 * (the lookAt direction). Scales control the elongation.
 */
export const BULLET_VISUAL_CONFIGS: Record<BulletVisualType, BulletVisualConfig> = {
  [BulletVisualType.Standard]: {
    color: 0x88ffff,
    scaleX: 0.04,
    scaleY: 0.04,
    scaleZ: 0.15,
    createGeometry: () => new THREE.CapsuleGeometry(0.5, 1.0, 4, 6),
  },
  [BulletVisualType.Spread]: {
    color: 0xffff44,
    scaleX: 0.06,
    scaleY: 0.06,
    scaleZ: 0.06,
    createGeometry: () => new THREE.SphereGeometry(0.5, 6, 6),
  },
  [BulletVisualType.Piercing]: {
    color: 0xff4444,
    scaleX: 0.03,
    scaleY: 0.03,
    scaleZ: 0.25,
    createGeometry: () => new THREE.CapsuleGeometry(0.5, 2.0, 4, 6),
  },
  [BulletVisualType.Homing]: {
    color: 0x44ff44,
    scaleX: 0.05,
    scaleY: 0.05,
    scaleZ: 0.10,
    createGeometry: () => new THREE.ConeGeometry(0.5, 1.5, 6),
  },
  [BulletVisualType.Default]: {
    color: 0xffffff,
    scaleX: 0.04,
    scaleY: 0.04,
    scaleZ: 0.12,
    createGeometry: () => new THREE.CapsuleGeometry(0.5, 1.0, 4, 6),
  },
};

// ---------------------------------------------------------------------------
// Internal data
// ---------------------------------------------------------------------------

/** Per-bullet tracking data stored in a compact struct. */
interface BulletSlot {
  /** Whether this slot is occupied. */
  active: boolean;
  /** The external id for this bullet. */
  id: string;
  /** World position. */
  posX: number;
  posY: number;
  posZ: number;
  /** Normalized direction. */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** Per-instance color (may differ from type default if overridden). */
  colorR: number;
  colorG: number;
  colorB: number;
}

/** One InstancedMesh batch per visual type. */
interface BulletBatch {
  config: BulletVisualConfig;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  instancedMesh: THREE.InstancedMesh;
  /** Flat array of slots (pre-allocated to maxInstances). */
  slots: BulletSlot[];
  /** Map from external id to slot index (for O(1) lookup). */
  idToIndex: Map<string, number>;
  /** Hint for the next free slot. */
  nextFree: number;
  /** Number of active bullets in this batch. */
  activeCount: number;
}

// Pre-allocated temporaries to avoid per-frame GC
const _tmpMatrix = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _tmpPos = new THREE.Vector3();
const _tmpScale = new THREE.Vector3();
const _tmpColor = new THREE.Color();
const _tmpLookTarget = new THREE.Vector3();
const _tmpObj = new THREE.Object3D();
const _zeroScale = new THREE.Vector3(0, 0, 0);

// ---------------------------------------------------------------------------
// BulletInstanceManager
// ---------------------------------------------------------------------------

/**
 * GPU-instanced bullet renderer. Groups bullets by visual type into
 * InstancedMesh batches. Supports up to `maxInstances` bullets per type.
 *
 * Usage:
 *   manager.addBullet(id, type, position, direction, optionalColor)
 *   manager.updateBullet(id, position, direction)
 *   manager.removeBullet(id)
 *   manager.update()  // flush changes to GPU (call once per frame)
 */
export class BulletInstanceManager {
  private scene: THREE.Scene;
  private maxInstances: number;
  private batches: Map<BulletVisualType, BulletBatch> = new Map();
  /** Reverse lookup: bullet id -> which batch type it belongs to. */
  private idToBatchType: Map<string, BulletVisualType> = new Map();

  constructor(scene: THREE.Scene, maxInstances = 2000) {
    this.scene = scene;
    this.maxInstances = maxInstances;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Register a new bullet for instanced rendering.
   * If the id already exists, this is a no-op.
   * If the batch for this type is full, the bullet is silently dropped.
   */
  addBullet(
    id: string,
    type: BulletVisualType,
    position: THREE.Vector3,
    direction: THREE.Vector3,
    color?: THREE.Color,
  ): void {
    // Reject duplicates
    if (this.idToBatchType.has(id)) return;

    const batch = this.getOrCreateBatch(type);
    const slotIndex = this.allocateSlot(batch);
    if (slotIndex < 0) return; // Pool full

    const config = batch.config;
    const bulletColor = color ?? _tmpColor.setHex(config.color);

    const slot = batch.slots[slotIndex];
    slot.active = true;
    slot.id = id;
    slot.posX = position.x;
    slot.posY = position.y;
    slot.posZ = position.z;

    const dirLen = direction.length();
    if (dirLen > 0.0001) {
      slot.dirX = direction.x / dirLen;
      slot.dirY = direction.y / dirLen;
      slot.dirZ = direction.z / dirLen;
    } else {
      slot.dirX = 0;
      slot.dirY = 0;
      slot.dirZ = 1;
    }

    slot.colorR = bulletColor.r;
    slot.colorG = bulletColor.g;
    slot.colorB = bulletColor.b;

    batch.idToIndex.set(id, slotIndex);
    batch.activeCount++;
    this.idToBatchType.set(id, type);

    // Set initial instance color
    _tmpColor.setRGB(slot.colorR, slot.colorG, slot.colorB);
    batch.instancedMesh.setColorAt(slotIndex, _tmpColor);
  }

  /**
   * Update an existing bullet's position and direction.
   * No-op if the id doesn't exist.
   */
  updateBullet(
    id: string,
    position: THREE.Vector3,
    direction: THREE.Vector3,
  ): void {
    const type = this.idToBatchType.get(id);
    if (type === undefined) return;

    const batch = this.batches.get(type);
    if (!batch) return;

    const slotIndex = batch.idToIndex.get(id);
    if (slotIndex === undefined) return;

    const slot = batch.slots[slotIndex];
    slot.posX = position.x;
    slot.posY = position.y;
    slot.posZ = position.z;

    const dirLen = direction.length();
    if (dirLen > 0.0001) {
      slot.dirX = direction.x / dirLen;
      slot.dirY = direction.y / dirLen;
      slot.dirZ = direction.z / dirLen;
    }
  }

  /**
   * Remove a bullet from instanced rendering.
   * Frees the slot for reuse. No-op if the id doesn't exist.
   */
  removeBullet(id: string): void {
    const type = this.idToBatchType.get(id);
    if (type === undefined) return;

    const batch = this.batches.get(type);
    if (!batch) return;

    const slotIndex = batch.idToIndex.get(id);
    if (slotIndex === undefined) return;

    // Zero-scale the instance so it's invisible
    _tmpMatrix.compose(_tmpPos.set(0, 0, 0), _tmpQuat.identity(), _zeroScale);
    batch.instancedMesh.setMatrixAt(slotIndex, _tmpMatrix);

    // Free slot
    const slot = batch.slots[slotIndex];
    slot.active = false;
    slot.id = '';
    batch.idToIndex.delete(id);
    batch.activeCount--;
    this.idToBatchType.delete(id);

    // Update free hint to help allocation
    if (slotIndex < batch.nextFree) {
      batch.nextFree = slotIndex;
    }
  }

  /**
   * Flush all pending position/orientation/color changes to the GPU.
   * Call once per frame after all addBullet/updateBullet/removeBullet calls.
   */
  update(): void {
    for (const batch of this.batches.values()) {
      const config = batch.config;
      let maxUsedIndex = -1;

      for (let i = 0; i < this.maxInstances; i++) {
        const slot = batch.slots[i];
        if (!slot.active) continue;

        if (i > maxUsedIndex) maxUsedIndex = i;

        // Compute orientation quaternion: align local +Z with direction
        _tmpPos.set(slot.posX, slot.posY, slot.posZ);
        _tmpLookTarget.set(
          slot.posX + slot.dirX,
          slot.posY + slot.dirY,
          slot.posZ + slot.dirZ,
        );
        _tmpObj.position.copy(_tmpPos);
        _tmpObj.lookAt(_tmpLookTarget);
        _tmpObj.updateMatrix();

        // Extract the quaternion from the Object3D's computed matrix
        _tmpObj.matrix.decompose(_tmpPos, _tmpQuat, _tmpScale);

        // Compose final matrix: position + orientation + type scale
        _tmpScale.set(config.scaleX, config.scaleY, config.scaleZ);
        _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
        batch.instancedMesh.setMatrixAt(i, _tmpMatrix);

        // Set color
        _tmpColor.setRGB(slot.colorR, slot.colorG, slot.colorB);
        batch.instancedMesh.setColorAt(i, _tmpColor);
      }

      // Set count to cover all used indices (InstancedMesh renders 0..count-1)
      batch.instancedMesh.count = maxUsedIndex + 1;
      batch.instancedMesh.instanceMatrix.needsUpdate = true;
      if (batch.instancedMesh.instanceColor) {
        batch.instancedMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /**
   * Remove all active bullets across all batches.
   */
  clear(): void {
    // Collect all ids first to avoid mutating during iteration
    const ids = [...this.idToBatchType.keys()];
    for (const id of ids) {
      this.removeBullet(id);
    }
  }

  /**
   * Dispose all GPU resources and remove InstancedMeshes from the scene.
   */
  dispose(): void {
    this.clear();
    for (const batch of this.batches.values()) {
      this.scene.remove(batch.instancedMesh);
      batch.geometry.dispose();
      batch.material.dispose();
      batch.instancedMesh.dispose();
    }
    this.batches.clear();
    this.idToBatchType.clear();
  }

  // -----------------------------------------------------------------------
  // Read-only accessors
  // -----------------------------------------------------------------------

  /** Total number of active bullets across all types. */
  get activeCount(): number {
    let total = 0;
    for (const batch of this.batches.values()) {
      total += batch.activeCount;
    }
    return total;
  }

  /**
   * Statistics for debugging and performance monitoring.
   */
  getStats(): {
    totalActive: number;
    batchCount: number;
    typeBreakdown: Map<BulletVisualType, number>;
  } {
    const typeBreakdown = new Map<BulletVisualType, number>();
    let totalActive = 0;
    for (const [type, batch] of this.batches) {
      typeBreakdown.set(type, batch.activeCount);
      totalActive += batch.activeCount;
    }
    return {
      totalActive,
      batchCount: this.batches.size,
      typeBreakdown,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Lazily create a batch for a visual type, or return existing.
   */
  private getOrCreateBatch(type: BulletVisualType): BulletBatch {
    const existing = this.batches.get(type);
    if (existing) return existing;

    const config = BULLET_VISUAL_CONFIGS[type];
    const geometry = config.createGeometry();

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, // White base - actual color from instanceColor
      emissive: new THREE.Color(config.color),
      emissiveIntensity: 0.6,
      metalness: 0.2,
      roughness: 0.3,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const instancedMesh = new THREE.InstancedMesh(geometry, material, this.maxInstances);
    instancedMesh.count = 0;
    instancedMesh.frustumCulled = false;
    instancedMesh.name = `instanced-bullet-${type}`;

    // Initialize all slots to zero-scale (hidden)
    for (let i = 0; i < this.maxInstances; i++) {
      _tmpMatrix.compose(_tmpPos.set(0, 0, 0), _tmpQuat.identity(), _zeroScale);
      instancedMesh.setMatrixAt(i, _tmpMatrix);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;

    // Initialize instance colors to type default
    const defaultColor = new THREE.Color(config.color);
    for (let i = 0; i < this.maxInstances; i++) {
      instancedMesh.setColorAt(i, defaultColor);
    }
    if (instancedMesh.instanceColor) {
      instancedMesh.instanceColor.needsUpdate = true;
    }

    // Pre-allocate slot array
    const slots: BulletSlot[] = [];
    for (let i = 0; i < this.maxInstances; i++) {
      slots.push({
        active: false,
        id: '',
        posX: 0, posY: 0, posZ: 0,
        dirX: 0, dirY: 0, dirZ: 1,
        colorR: defaultColor.r,
        colorG: defaultColor.g,
        colorB: defaultColor.b,
      });
    }

    const batch: BulletBatch = {
      config,
      geometry,
      material,
      instancedMesh,
      slots,
      idToIndex: new Map(),
      nextFree: 0,
      activeCount: 0,
    };

    this.batches.set(type, batch);
    this.scene.add(instancedMesh);

    return batch;
  }

  /**
   * Find the next free slot in a batch using a scan-from-hint approach.
   * Returns -1 if all slots are occupied.
   */
  private allocateSlot(batch: BulletBatch): number {
    // Scan forward from hint
    for (let i = batch.nextFree; i < this.maxInstances; i++) {
      if (!batch.slots[i].active) {
        batch.nextFree = i + 1;
        return i;
      }
    }
    // Wrap around
    for (let i = 0; i < batch.nextFree; i++) {
      if (!batch.slots[i].active) {
        batch.nextFree = i + 1;
        return i;
      }
    }
    return -1;
  }
}
