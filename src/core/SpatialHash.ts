/**
 * Spatial hash grid for efficient broad-phase collision detection.
 *
 * Instead of checking every pair O(n*m), entities are inserted into cells
 * based on their world-space position. Queries only check entities in the
 * same and adjacent cells, reducing collision checks dramatically at scale.
 *
 * OPTIMIZATION (2026-02-10): Ported from collision.worker.ts optimizations.
 * Dual-path implementation:
 *
 * - Small counts (<=512): Simple Map-based storage with fixed cell size.
 *   Low overhead, no build phase, best for typical game frames with few enemies.
 *
 * - Large counts (>512): Flat hash table via counting sort + adaptive cell size.
 *   Adaptive sizing reduces neighbor counts from ~400 to ~40 at 5K entities.
 *   Flat typed arrays eliminate Map/GC overhead. Build cost amortized over queries.
 *
 * API is 100% backwards-compatible: clear() -> insert()... -> getNearby()...
 */

/**
 * Threshold above which the optimized flat hash table path is used.
 * Below this, the simpler Map-based path has less overhead per build.
 */
const FLAT_TABLE_THRESHOLD = 512;

export class SpatialHash<T> {
  private readonly defaultCellSize: number;
  private readonly defaultInvCellSize: number;

  // --- Insert phase: collect entities + positions ---
  private _entities: T[] = [];
  private _posX: Float64Array = new Float64Array(256);
  private _posY: Float64Array = new Float64Array(256);
  private _posZ: Float64Array = new Float64Array(256);
  private _count = 0;

  // --- Simple path (small counts): Map-based cells ---
  private readonly _cells: Map<number, T[]> = new Map();

  // --- Optimized path (large counts): flat hash table ---
  private _built = false;
  private _cellSize = 2.5;
  private _invCellSize = 1 / 2.5;

  // Flat hash table arrays (reused across frames, grow-only)
  private _tableSize = 64;
  private _tableMask = 63;
  private _cellStart: Int32Array = new Int32Array(64);
  private _cellCount: Int32Array = new Int32Array(64);
  private _bucketFill: Int32Array = new Int32Array(64);
  private _sortedIndices: Int32Array = new Int32Array(256);
  private _entityBucket: Int32Array = new Int32Array(256);

  // Cell coordinates per entity (cached for query phase)
  private _entityCX: Int32Array = new Int32Array(256);
  private _entityCY: Int32Array = new Int32Array(256);
  private _entityCZ: Int32Array = new Int32Array(256);

  // Reusable result array
  private readonly _nearbyResult: T[] = [];

  constructor(cellSize: number = 2.5) {
    this.defaultCellSize = cellSize;
    this.defaultInvCellSize = 1 / cellSize;
    this._cellSize = cellSize;
    this._invCellSize = 1 / cellSize;
  }

  /** Remove all entries. Call at the start of each frame. */
  clear(): void {
    this._count = 0;
    this._built = false;
    // Clear Map cells for simple path
    this._cells.forEach(arr => { arr.length = 0; });
  }

  /** Insert an entity at the given world-space position. */
  insert(x: number, y: number, z: number, entity: T): void {
    const idx = this._count;

    // Grow position arrays if needed (for optimized path)
    if (idx >= this._posX.length) {
      const newCap = this._posX.length * 2;
      const newX = new Float64Array(newCap);
      const newY = new Float64Array(newCap);
      const newZ = new Float64Array(newCap);
      newX.set(this._posX);
      newY.set(this._posY);
      newZ.set(this._posZ);
      this._posX = newX;
      this._posY = newY;
      this._posZ = newZ;
    }

    this._posX[idx] = x;
    this._posY[idx] = y;
    this._posZ[idx] = z;
    this._entities[idx] = entity;
    this._count = idx + 1;
    this._built = false;

    // Always insert into Map for simple path (cheap at low counts)
    const key = hashKey(
      Math.floor(x * this.defaultInvCellSize) | 0,
      Math.floor(y * this.defaultInvCellSize) | 0,
      Math.floor(z * this.defaultInvCellSize) | 0,
    );
    let cell = this._cells.get(key);
    if (!cell) {
      cell = [];
      this._cells.set(key, cell);
    }
    cell.push(entity);
  }

  /**
   * Return all entities in the same cell and the 26 neighboring cells.
   * The returned array is reused between calls -- do NOT store a reference.
   */
  getNearby(x: number, y: number, z: number): readonly T[] {
    // Choose path based on entity count
    if (this._count <= FLAT_TABLE_THRESHOLD) {
      return this._getNearbySimple(x, y, z);
    }
    return this._getNearbyOptimized(x, y, z);
  }

  /**
   * Simple path: Map-based lookup with fixed cell size.
   * Best for small entity counts where build overhead is not worthwhile.
   */
  private _getNearbySimple(x: number, y: number, z: number): readonly T[] {
    const result = this._nearbyResult;
    result.length = 0;

    const invCS = this.defaultInvCellSize;
    const cx = Math.floor(x * invCS) | 0;
    const cy = Math.floor(y * invCS) | 0;
    const cz = Math.floor(z * invCS) | 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = hashKey(cx + dx, cy + dy, cz + dz);
          const cell = this._cells.get(key);
          if (cell) {
            for (let i = 0; i < cell.length; i++) {
              result.push(cell[i]);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Optimized path: flat hash table with adaptive cell size.
   * Build is lazy (first call after inserts triggers it).
   */
  private _getNearbyOptimized(x: number, y: number, z: number): readonly T[] {
    if (!this._built) {
      this._build();
    }

    const result = this._nearbyResult;
    result.length = 0;

    const invCS = this._invCellSize;
    const cx = Math.floor(x * invCS) | 0;
    const cy = Math.floor(y * invCS) | 0;
    const cz = Math.floor(z * invCS) | 0;
    const mask = this._tableMask;
    const cellStart = this._cellStart;
    const cellCount = this._cellCount;
    const sortedIndices = this._sortedIndices;
    const entities = this._entities;
    const ecx = this._entityCX;
    const ecy = this._entityCY;
    const ecz = this._entityCZ;

    for (let dx = -1; dx <= 1; dx++) {
      const ncx = cx + dx;
      for (let dy = -1; dy <= 1; dy++) {
        const ncy = cy + dy;
        for (let dz = -1; dz <= 1; dz++) {
          const ncz = cz + dz;
          const key = hashKey(ncx, ncy, ncz);
          const bucket = (key & 0x7FFFFFFF) & mask;
          const bLen = cellCount[bucket];
          if (bLen === 0) continue;

          const bOff = cellStart[bucket];
          for (let c = 0; c < bLen; c++) {
            const ei = sortedIndices[bOff + c];
            // Verify entity is actually in this cell (not a hash collision)
            if (ecx[ei] === ncx && ecy[ei] === ncy && ecz[ei] === ncz) {
              result.push(entities[ei]);
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Build the flat hash table from collected inserts.
   * Uses counting sort for zero per-frame allocation (after warmup).
   */
  private _build(): void {
    const count = this._count;
    this._built = true;

    if (count === 0) return;

    // --- Compute adaptive cell size ---
    this._cellSize = this._computeAdaptiveCellSize(count);
    this._invCellSize = 1 / this._cellSize;
    const invCS = this._invCellSize;

    // --- Ensure per-entity typed arrays are large enough ---
    if (this._sortedIndices.length < count) {
      const newCap = count * 2; // Over-allocate for growth
      this._sortedIndices = new Int32Array(newCap);
      this._entityBucket = new Int32Array(newCap);
      this._entityCX = new Int32Array(newCap);
      this._entityCY = new Int32Array(newCap);
      this._entityCZ = new Int32Array(newCap);
    }

    // --- Hash table sizing: power-of-2 for fast modulo via bitmask ---
    let tableSize = 64;
    while (tableSize < count * 2) tableSize *= 2;
    this._tableSize = tableSize;
    this._tableMask = tableSize - 1;
    const mask = this._tableMask;

    // Ensure table arrays are large enough
    if (this._cellStart.length < tableSize) {
      this._cellStart = new Int32Array(tableSize);
      this._cellCount = new Int32Array(tableSize);
      this._bucketFill = new Int32Array(tableSize);
    }

    const cellCount = this._cellCount;
    const cellStart = this._cellStart;
    const bucketFill = this._bucketFill;
    const entityBucket = this._entityBucket;
    const entityCX = this._entityCX;
    const entityCY = this._entityCY;
    const entityCZ = this._entityCZ;
    const sortedIndices = this._sortedIndices;
    const posX = this._posX;
    const posY = this._posY;
    const posZ = this._posZ;

    // Phase 1: Compute cell coords + bucket, count per bucket
    for (let b = 0; b < tableSize; b++) {
      cellCount[b] = 0;
    }

    for (let i = 0; i < count; i++) {
      const cx = Math.floor(posX[i] * invCS) | 0;
      const cy = Math.floor(posY[i] * invCS) | 0;
      const cz = Math.floor(posZ[i] * invCS) | 0;
      entityCX[i] = cx;
      entityCY[i] = cy;
      entityCZ[i] = cz;

      const key = hashKey(cx, cy, cz);
      const bucket = (key & 0x7FFFFFFF) & mask;
      entityBucket[i] = bucket;
      cellCount[bucket]++;
    }

    // Phase 2: Prefix sum for bucket start offsets
    let offset = 0;
    for (let b = 0; b < tableSize; b++) {
      cellStart[b] = offset;
      bucketFill[b] = 0;
      offset += cellCount[b];
    }

    // Phase 3: Scatter entity indices into flat sorted array
    for (let i = 0; i < count; i++) {
      const bucket = entityBucket[i];
      sortedIndices[cellStart[bucket] + bucketFill[bucket]] = i;
      bucketFill[bucket]++;
    }
  }

  /**
   * Compute adaptive cell size from the spatial extent of inserted entities.
   *
   * For entities on a sphere surface (thin shell), smaller cells dramatically
   * reduce neighbor counts. The default 2.5 gives ~400 neighbors at 5K entities
   * on a radius-10 sphere; adaptive sizing brings this down to ~40.
   */
  private _computeAdaptiveCellSize(count: number): number {
    // Small counts: adaptive sizing overhead not worthwhile
    if (count <= 64) return this.defaultCellSize;

    const posX = this._posX;
    const posY = this._posY;
    const posZ = this._posZ;

    // Find bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = posX[i], y = posY[i], z = posZ[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const extentZ = maxZ - minZ;

    // Estimate sphere surface area from bounding box
    const avgExtent = (extentX + extentY + extentZ) / 3;
    const estRadius = avgExtent / 2;
    const estSurfaceArea = 4 * Math.PI * estRadius * estRadius;

    // Target ~8 entities per cell. For a thin shell (2D manifold in 3D):
    // occupied cells ~ surfaceArea / cellSize^2
    // entities per cell ~ count * cellSize^2 / surfaceArea
    // cellSize = sqrt(TARGET * surfaceArea / count)
    const TARGET_PER_CELL = 8;
    const surfaceBasedSize = Math.sqrt(TARGET_PER_CELL * estSurfaceArea / count);

    // Minimum safe size
    const minSafe = 0.3;

    let cellSize = Math.max(surfaceBasedSize, minSafe);

    // Clamp to reasonable range
    if (cellSize > 5.0) cellSize = 5.0;
    if (cellSize < 0.3) cellSize = 0.3;

    return cellSize;
  }
}

/** Prime-based spatial hash. Matches the one in collision.worker.ts. */
function hashKey(cx: number, cy: number, cz: number): number {
  return ((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) | 0;
}
