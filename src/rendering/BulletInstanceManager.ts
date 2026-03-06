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
// Scale values are relative to the geometry's local axes:
// - CapsuleGeometry: body extends along +Y. scaleY = bullet length, scaleX=scaleZ = bullet radius.
// - SphereGeometry: uniform, all scale axes equal.
// - ConeGeometry: apex at +Y, base at -Y. scaleY = bullet length, scaleX=scaleZ = base radius.
export const BULLET_VISUAL_CONFIGS: Record<BulletVisualType, BulletVisualConfig> = {
  [BulletVisualType.Standard]: {
    color: 0x88ffff,
    scaleX: 0.04,
    scaleY: 0.18,  // length along travel direction
    scaleZ: 0.04,
    createGeometry: () => new THREE.CapsuleGeometry(0.5, 1.0, 4, 8),
  },
  [BulletVisualType.Spread]: {
    color: 0x44ffff,
    scaleX: 0.16,
    scaleY: 0.16,  // spherical — all axes equal; 0.5 * 0.16 = 0.08 matches SP SphereGeometry(0.08)
    scaleZ: 0.16,
    createGeometry: () => new THREE.SphereGeometry(0.5, 8, 8),
  },
  [BulletVisualType.Piercing]: {
    color: 0xff4444,
    scaleX: 0.03,
    scaleY: 0.28,  // longer and thinner for piercing bullets
    scaleZ: 0.03,
    createGeometry: () => new THREE.CapsuleGeometry(0.5, 2.0, 4, 8),
  },
  [BulletVisualType.Homing]: {
    color: 0x44ff44,
    scaleX: 0.05,
    scaleY: 0.12,  // cone apex faces +Y (direction of travel)
    scaleZ: 0.05,
    createGeometry: () => new THREE.ConeGeometry(0.5, 1.5, 6),
  },
  [BulletVisualType.Default]: {
    color: 0xffffff,
    scaleX: 0.04,
    scaleY: 0.15,  // length along travel direction
    scaleZ: 0.04,
    createGeometry: () => new THREE.CapsuleGeometry(0.5, 1.0, 4, 8),
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

/**
 * Per-type batch data. Instead of owning an InstancedMesh, each batch
 * records the geometry it registered in the shared BatchedMesh plus the
 * pre-allocated instance IDs for that geometry type.
 */
interface BulletBatch {
  config: BulletVisualConfig;
  geometry: THREE.BufferGeometry;
  /** Geometry ID returned by BatchedMesh.addGeometry(). */
  geometryId: number;
  /** Pre-allocated BatchedMesh instance IDs for this type (length = maxInstances). */
  instanceIds: number[];
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
const _tmpDir = new THREE.Vector3();
// CapsuleGeometry's long axis is +Y. Rotate +Y to align with bullet direction.
const _Y_AXIS = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// BulletInstanceManager
// ---------------------------------------------------------------------------

/**
 * GPU-instanced bullet renderer using BatchedMesh.
 *
 * All bullet types share a single BatchedMesh → a single draw call for all
 * bullets regardless of geometry type. Each type is pre-allocated
 * `maxInstances` slots in the shared BatchedMesh on first use.
 *
 * Public API is identical to the previous InstancedMesh implementation:
 *   manager.addBullet(id, type, position, direction, optionalColor)
 *   manager.updateBullet(id, position, direction)
 *   manager.removeBullet(id)
 *   manager.update()  // flush changes to GPU (call once per frame)
 */
export class BulletInstanceManager {
  private scene: THREE.Scene;
  private maxInstances: number;
  private batches: Map<BulletVisualType, BulletBatch> = new Map();
  /** Reverse lookup: bullet id → which batch type it belongs to. */
  private idToBatchType: Map<string, BulletVisualType> = new Map();

  /** Shared BatchedMesh for all bullet types (null until first use). */
  private batchedMesh: THREE.BatchedMesh | null = null;
  /** Shared material for all bullet types. */
  private material: THREE.MeshBasicMaterial | null = null;
  /** Whether ensureInitialized() has run. */
  private initialized = false;

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

    // Lazily initialize BatchedMesh + all batches on first use
    this.ensureInitialized();

    const batch = this.batches.get(type)!;
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

    // Set initial instance color immediately so getColorAt works before update()
    _tmpColor.setRGB(slot.colorR, slot.colorG, slot.colorB);
    this.batchedMesh!.setColorAt(batch.instanceIds[slotIndex], _tmpColor);
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
    if (!batch || !this.batchedMesh) return;

    const slotIndex = batch.idToIndex.get(id);
    if (slotIndex === undefined) return;

    // Hide instance — do NOT call deleteInstance() since we manage slot reuse
    this.batchedMesh.setVisibleAt(batch.instanceIds[slotIndex], false);

    // Free slot
    const slot = batch.slots[slotIndex];
    slot.active = false;
    slot.id = '';
    batch.idToIndex.delete(id);
    batch.activeCount--;
    this.idToBatchType.delete(id);

    if (slotIndex < batch.nextFree) {
      batch.nextFree = slotIndex;
    }
  }

  /**
   * Flush all pending position/orientation/color changes to the GPU.
   * Call once per frame after all addBullet/updateBullet/removeBullet calls.
   */
  update(): void {
    if (!this.batchedMesh) return;

    for (const batch of this.batches.values()) {
      const config = batch.config;

      for (let i = 0; i < this.maxInstances; i++) {
        const slot = batch.slots[i];
        if (!slot.active) continue;

        const instanceId = batch.instanceIds[i];

        // Compute orientation quaternion: align capsule +Y axis with bullet direction.
        // CapsuleGeometry extends along the local +Y axis, so we rotate Y→direction.
        // (Previously used lookAt which aligned -Z with direction, making the capsule
        // appear as a disc perpendicular to travel — the "polygon" look the user saw.)
        _tmpPos.set(slot.posX, slot.posY, slot.posZ);
        _tmpDir.set(slot.dirX, slot.dirY, slot.dirZ);
        if (_tmpDir.lengthSq() < 0.0001) {
          _tmpDir.set(0, 1, 0);
        } else {
          _tmpDir.normalize();
        }
        _tmpQuat.setFromUnitVectors(_Y_AXIS, _tmpDir);

        // Compose final matrix: position + orientation + type scale
        _tmpScale.set(config.scaleX, config.scaleY, config.scaleZ);
        _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
        this.batchedMesh.setMatrixAt(instanceId, _tmpMatrix);

        // Set color
        _tmpColor.setRGB(slot.colorR, slot.colorG, slot.colorB);
        this.batchedMesh.setColorAt(instanceId, _tmpColor);

        // Make visible (no-op if already visible)
        this.batchedMesh.setVisibleAt(instanceId, true);
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
   * Dispose all GPU resources and remove the BatchedMesh from the scene.
   */
  dispose(): void {
    this.clear();
    if (this.batchedMesh) {
      this.scene.remove(this.batchedMesh);
      this.batchedMesh.dispose();
      this.batchedMesh = null;
    }
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    for (const batch of this.batches.values()) {
      batch.geometry.dispose();
    }
    this.batches.clear();
    this.idToBatchType.clear();
    this.initialized = false;
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
   * batchCount = number of geometry types with active bullets (informational);
   * the actual draw call count is 1 (one BatchedMesh for all types).
   */
  getStats(): {
    totalActive: number;
    batchCount: number;
    typeBreakdown: Map<BulletVisualType, number>;
  } {
    const typeBreakdown = new Map<BulletVisualType, number>();
    let totalActive = 0;
    let activeBatchCount = 0;
    for (const [type, batch] of this.batches) {
      totalActive += batch.activeCount;
      if (batch.activeCount > 0) {
        typeBreakdown.set(type, batch.activeCount);
        activeBatchCount++;
      }
    }
    return {
      totalActive,
      batchCount: activeBatchCount,
      typeBreakdown,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Lazily initialize the shared BatchedMesh and all batch structures.
   * Registers all 5 geometry types and pre-allocates maxInstances slots per type.
   * Called on first addBullet(); no-op on subsequent calls.
   */
  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Compute total vertex/index counts from all geometry types to size the BatchedMesh buffer.
    const allTypes = Object.values(BulletVisualType) as BulletVisualType[];
    const geometries: THREE.BufferGeometry[] = allTypes.map((type) =>
      BULLET_VISUAL_CONFIGS[type].createGeometry(),
    );

    let totalVertexCount = 0;
    let totalIndexCount = 0;
    for (const geo of geometries) {
      totalVertexCount += geo.attributes.position.count;
      const idx = geo.index;
      totalIndexCount += idx ? idx.count : geo.attributes.position.count;
    }

    // Create shared material — bullets are visually differentiated by per-instance color.
    // MeshBasicMaterial: unlit, always renders at full brightness regardless of scene lighting.
    // This matches how SP WeaponManager renders projectiles (also MeshBasicMaterial) — ensuring
    // bullets look consistent and bright across all lighting conditions, including dark scenes.
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    // Create the shared BatchedMesh with capacity for all types × maxInstances.
    const totalInstances = this.maxInstances * allTypes.length;
    this.batchedMesh = new THREE.BatchedMesh(
      totalInstances,
      totalVertexCount + 64,  // small safety margin
      totalIndexCount + 64,
      this.material,
    );
    this.batchedMesh.frustumCulled = false;
    this.batchedMesh.name = 'batched-bullets';

    // Register each geometry and pre-allocate all instance slots.
    for (let t = 0; t < allTypes.length; t++) {
      const type = allTypes[t];
      const config = BULLET_VISUAL_CONFIGS[type];
      const geometry = geometries[t];

      const geometryId = this.batchedMesh.addGeometry(geometry);

      // Pre-allocate maxInstances slots for this type; hide them all initially.
      const instanceIds: number[] = [];
      const defaultColor = new THREE.Color(config.color);

      for (let i = 0; i < this.maxInstances; i++) {
        const instanceId = this.batchedMesh.addInstance(geometryId);
        instanceIds.push(instanceId);
        // Initialize color for this slot
        this.batchedMesh.setColorAt(instanceId, defaultColor);
        // Hide until a bullet is assigned to this slot
        this.batchedMesh.setVisibleAt(instanceId, false);
      }

      // Build the slot array
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
        geometryId,
        instanceIds,
        slots,
        idToIndex: new Map(),
        nextFree: 0,
        activeCount: 0,
      };
      this.batches.set(type, batch);
    }

    this.scene.add(this.batchedMesh);
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
