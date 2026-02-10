/**
 * Web Worker for spatial hash collision detection.
 *
 * Receives entity positions + radii via SharedArrayBuffer, runs broad-phase
 * spatial hash + narrow-phase distance check, writes collision pairs back
 * to a shared result buffer. Uses Atomics for synchronization.
 *
 * This is also exported as a pure function (runCollisionDetection) so the
 * main thread fallback path and tests can call it directly without a Worker.
 *
 * OPTIMIZATION HISTORY:
 * - Original: Map<number, number[]> + Set<number> dedup = O(n * neighbors) with GC
 * - Optimized (2026-02-10): Flat typed-array hash table + Uint32Array bitfield dedup
 *   + adaptive cell size. Zero GC after init, ~5-20x faster at high entity counts.
 *
 * Key optimizations:
 * 1. Adaptive cell size: smaller cells on dense surfaces = fewer neighbors per query
 * 2. Flat hash table: counting sort into Int32Array, no Map/Array allocation
 * 3. Bitfield dedup: Uint32Array bitfield replaces Set<number>, O(1) per check, zero GC
 * 4. Pre-allocated buffers: all typed arrays reused across frames
 * 5. j > i ordering: only check pairs where j > i, halving work + enabling bitfield
 */

import {
  POS_STRIDE,
  COLLISION_PAIR_STRIDE,
  type EntityBufferLayout,
  type CollisionResultLayout,
  getEntityViews,
  getCollisionResultViews,
} from './shared-buffers';

// ---------------------------------------------------------------------------
// Pre-allocated typed array pools (reused across frames, zero GC after init)
// ---------------------------------------------------------------------------

// Flat hash table: entities sorted by bucket via counting sort
let _cellIndices = new Int32Array(0);    // entity indices packed by bucket
let _cellStart = new Int32Array(0);      // start offset per bucket
let _cellCount = new Int32Array(0);      // entity count per bucket
let _entityBucket = new Int32Array(0);   // bucket index for each entity
let _bucketFill = new Int32Array(0);     // temp: running fill count during scatter

// Bitfield for dedup: one bit per entity. For entity i, bit j means
// "pair (i,j) has already been checked". Cleared per entity i.
let _checkedBits = new Uint32Array(0);

// Store cell coordinates per entity to avoid recomputing in the query phase
let _entityCX = new Int32Array(0);
let _entityCY = new Int32Array(0);
let _entityCZ = new Int32Array(0);

// ---------------------------------------------------------------------------
// Adaptive cell sizing
// ---------------------------------------------------------------------------

/**
 * Compute an optimal cell size based on entity count and spatial extent.
 *
 * Goal: minimize total work = sum over all entities of (neighbors checked).
 * With a 3D hash grid, each query checks 27 cells. The total work is:
 *   W = N * 27 * (average entities per cell)
 *   W = N * 27 * (N / numCells)
 *   W = 27 * N^2 / numCells
 *
 * For entities on a sphere surface (thin shell in 3D), the number of occupied
 * cells scales as surfaceArea / cellSize^2 (not volume / cellSize^3).
 * So W = 27 * N^2 * cellSize^2 / surfaceArea.
 * Minimizing cellSize minimizes W, but cellSize must be >= 2*maxRadius for
 * correctness (so adjacent cells contain all potential collision partners).
 *
 * Therefore: optimal cellSize = max(2*maxRadius, practical_minimum).
 */
function computeAdaptiveCellSize(
  positions: Float32Array,
  count: number,
  maxRadius: number,
): number {
  if (count <= 64) return 2.5; // Small counts: default is fine

  // Find bounding box to understand spatial extent
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const pi = i * POS_STRIDE;
    const x = positions[pi], y = positions[pi + 1], z = positions[pi + 2];
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

  // For sphere surface entities (thin shell), we want small cells to keep
  // neighbor counts low. The minimum safe cell size is 2 * maxRadius
  // (entities up to 1 cell away can still collide via combined radii).
  const minSafe = maxRadius * 2;

  // Target: average ~8 entities per cell. For a thin shell (2D manifold in 3D):
  // occupied cells ~ surfaceArea / cellSize^2
  // entities per cell ~ count * cellSize^2 / surfaceArea
  // Estimate surface area from bounding box extent (roughly a sphere)
  const avgExtent = (extentX + extentY + extentZ) / 3;
  const estRadius = avgExtent / 2;
  const estSurfaceArea = 4 * Math.PI * estRadius * estRadius;
  // cellSize = sqrt(TARGET * surfaceArea / count)
  const TARGET_PER_CELL = 8;
  const surfaceBasedSize = Math.sqrt(TARGET_PER_CELL * estSurfaceArea / count);

  let cellSize = Math.max(surfaceBasedSize, minSafe);

  // Clamp to reasonable range
  if (cellSize > 5.0) cellSize = 5.0;
  if (cellSize < 0.3) cellSize = 0.3;

  return cellSize;
}

// ---------------------------------------------------------------------------
// Hash function
// ---------------------------------------------------------------------------

/** Prime-based spatial hash. */
function hashKey(cx: number, cy: number, cz: number): number {
  return ((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) | 0;
}

// ---------------------------------------------------------------------------
// Pure collision detection function (usable in worker or main thread)
// ---------------------------------------------------------------------------

export interface CollisionInput {
  positions: Float32Array;
  radii: Float32Array;
  count: number;
}

export interface CollisionOutput {
  pairs: Int32Array;
  pairCount: Int32Array;
  maxPairs: number;
}

/**
 * Run spatial hash collision detection. Pure function -- no Worker dependency.
 *
 * Algorithm:
 * 1. Compute adaptive cell size from entity distribution
 * 2. Build flat hash table via counting sort (zero allocation)
 * 3. For each entity, query 27 neighbor cells
 * 4. Use Uint32Array bitfield for O(1) pair dedup (replaces Set<number>)
 * 5. Only check pairs where j > i (eliminates half the work)
 *
 * Writes results directly into the output buffer (pairs + pairCount).
 * Returns the number of collision pairs found.
 */
export function runCollisionDetection(
  input: CollisionInput,
  output: CollisionOutput,
): number {
  const { positions, radii, count } = input;
  const { pairs, pairCount, maxPairs } = output;

  // Reset pair count
  Atomics.store(pairCount, 0, 0);

  if (count === 0) return 0;

  // --- Find max radius for adaptive cell sizing ---
  let maxRadius = 0;
  for (let i = 0; i < count; i++) {
    if (radii[i] > maxRadius) maxRadius = radii[i];
  }

  // --- Compute adaptive cell size ---
  const cellSize = computeAdaptiveCellSize(positions, count, maxRadius);
  const invCellSize = 1 / cellSize;

  // --- Hash table sizing ---
  // Power-of-2 table for fast modulo via bitmask. Load factor ~0.5.
  let tableSize = 64;
  while (tableSize < count * 2) tableSize *= 2;
  const tableMask = tableSize - 1;

  // --- Ensure typed arrays are large enough ---
  if (_cellIndices.length < count) {
    _cellIndices = new Int32Array(count * 2); // over-allocate for growth
    _entityBucket = new Int32Array(count * 2);
    _entityCX = new Int32Array(count * 2);
    _entityCY = new Int32Array(count * 2);
    _entityCZ = new Int32Array(count * 2);
  }
  if (_cellStart.length < tableSize) {
    _cellStart = new Int32Array(tableSize);
    _cellCount = new Int32Array(tableSize);
    _bucketFill = new Int32Array(tableSize);
  }

  // Bitfield: one bit per entity for dedup. Size = ceil(count / 32).
  const bitfieldSize = ((count + 31) >>> 5); // ceil(count/32)
  if (_checkedBits.length < bitfieldSize) {
    _checkedBits = new Uint32Array(bitfieldSize * 2); // over-allocate
  }

  // =========================================================================
  // Phase 1: Compute cell coordinates + bucket for each entity
  // =========================================================================
  for (let b = 0; b < tableSize; b++) {
    _cellCount[b] = 0;
  }

  for (let i = 0; i < count; i++) {
    const pi = i * POS_STRIDE;
    const cx = Math.floor(positions[pi] * invCellSize) | 0;
    const cy = Math.floor(positions[pi + 1] * invCellSize) | 0;
    const cz = Math.floor(positions[pi + 2] * invCellSize) | 0;
    _entityCX[i] = cx;
    _entityCY[i] = cy;
    _entityCZ[i] = cz;

    const key = hashKey(cx, cy, cz);
    const bucket = (key & 0x7FFFFFFF) & tableMask;
    _entityBucket[i] = bucket;
    _cellCount[bucket]++;
  }

  // =========================================================================
  // Phase 2: Prefix sum for bucket start offsets
  // =========================================================================
  let offset = 0;
  for (let b = 0; b < tableSize; b++) {
    _cellStart[b] = offset;
    _bucketFill[b] = 0;
    offset += _cellCount[b];
  }

  // =========================================================================
  // Phase 3: Scatter entity indices into flat array (counting sort)
  // =========================================================================
  for (let i = 0; i < count; i++) {
    const bucket = _entityBucket[i];
    _cellIndices[_cellStart[bucket] + _bucketFill[bucket]] = i;
    _bucketFill[bucket]++;
  }

  // =========================================================================
  // Phase 4: Collision detection with bitfield dedup
  // =========================================================================
  let pairIdx = 0;

  for (let i = 0; i < count; i++) {
    if (pairIdx >= maxPairs) break;

    const pi = i * POS_STRIDE;
    const ax = positions[pi];
    const ay = positions[pi + 1];
    const az = positions[pi + 2];
    const ar = radii[i];
    const icx = _entityCX[i];
    const icy = _entityCY[i];
    const icz = _entityCZ[i];

    // Clear bitfield for this entity (only the portion we'll use).
    // We only check j > i, so we only need bits for indices [i+1, count).
    // But clearing the full bitfield is fast with typed arrays.
    // Optimization: only clear bits that were set (tracked below).
    // For simplicity and cache efficiency, clear the needed range.
    const startWord = (i + 1) >>> 5;
    const endWord = bitfieldSize;
    for (let w = startWord; w < endWord; w++) {
      _checkedBits[w] = 0;
    }

    // Check 27 neighboring cells
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const ncx = icx + dx;
          const ncy = icy + dy;
          const ncz = icz + dz;
          const key = hashKey(ncx, ncy, ncz);
          const bucket = (key & 0x7FFFFFFF) & tableMask;
          const bLen = _cellCount[bucket];
          if (bLen === 0) continue;

          const bOff = _cellStart[bucket];
          for (let c = 0; c < bLen; c++) {
            const j = _cellIndices[bOff + c];
            if (j <= i) continue; // Only check j > i

            // Bitfield dedup: check if pair (i,j) already tested
            const word = j >>> 5;
            const bit = 1 << (j & 31);
            if (_checkedBits[word] & bit) continue;
            _checkedBits[word] |= bit;

            // Verify j is in the target cell (not a hash collision).
            // This is cheaper than the distance check for non-colliding pairs.
            if (_entityCX[j] !== ncx || _entityCY[j] !== ncy || _entityCZ[j] !== ncz) continue;

            // Narrow-phase: squared distance check
            const pj = j * POS_STRIDE;
            const ddx = ax - positions[pj];
            const ddy = ay - positions[pj + 1];
            const ddz = az - positions[pj + 2];
            const distSq = ddx * ddx + ddy * ddy + ddz * ddz;

            const combinedRadius = ar + radii[j];
            if (distSq < combinedRadius * combinedRadius) {
              const off = pairIdx * COLLISION_PAIR_STRIDE;
              pairs[off] = i;
              pairs[off + 1] = j;
              pairIdx++;

              if (pairIdx >= maxPairs) break;
            }
          }
          if (pairIdx >= maxPairs) break;
        }
        if (pairIdx >= maxPairs) break;
      }
      if (pairIdx >= maxPairs) break;
    }
  }

  Atomics.store(pairCount, 0, pairIdx);
  return pairIdx;
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

export interface CollisionWorkerMessage {
  type: 'run';
  entityBuffer: EntityBufferLayout;
  resultBuffer: CollisionResultLayout;
}

export interface CollisionWorkerResponse {
  type: 'done';
  pairCount: number;
}

// Only attach listener in Worker context (not in tests/main thread)
if (typeof self !== 'undefined' && typeof (self as any).WorkerGlobalScope !== 'undefined') {
  self.onmessage = (e: MessageEvent<CollisionWorkerMessage>) => {
    if (e.data.type === 'run') {
      const views = getEntityViews(e.data.entityBuffer);
      const resultViews = getCollisionResultViews(e.data.resultBuffer);

      const pairCount = runCollisionDetection(
        {
          positions: views.positions,
          radii: views.radii,
          count: e.data.entityBuffer.count,
        },
        {
          pairs: resultViews.pairs,
          pairCount: resultViews.count,
          maxPairs: e.data.resultBuffer.maxPairs,
        },
      );

      (self as any).postMessage({ type: 'done', pairCount } satisfies CollisionWorkerResponse);
    }
  };
}
