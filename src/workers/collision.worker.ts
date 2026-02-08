/**
 * Web Worker for spatial hash collision detection.
 *
 * Receives entity positions + radii via SharedArrayBuffer, runs broad-phase
 * spatial hash + narrow-phase distance check, writes collision pairs back
 * to a shared result buffer. Uses Atomics for synchronization.
 *
 * This is also exported as a pure function (runCollisionDetection) so the
 * main thread fallback path and tests can call it directly without a Worker.
 */

import {
  POS_STRIDE,
  RADIUS_STRIDE,
  COLLISION_PAIR_STRIDE,
  type EntityBufferLayout,
  type CollisionResultLayout,
  getEntityViews,
  getCollisionResultViews,
} from './shared-buffers';

// ---------------------------------------------------------------------------
// Spatial hash (worker-local, no allocations after init)
// ---------------------------------------------------------------------------

const CELL_SIZE = 2.5;
const INV_CELL_SIZE = 1 / CELL_SIZE;

/** Prime-based spatial hash (mirrors SpatialHash.ts). */
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

  // Build spatial hash (Map<cellKey, number[]> where number is entity index)
  const cells = new Map<number, number[]>();

  for (let i = 0; i < count; i++) {
    const pi = i * POS_STRIDE;
    const cx = Math.floor(positions[pi] * INV_CELL_SIZE);
    const cy = Math.floor(positions[pi + 1] * INV_CELL_SIZE);
    const cz = Math.floor(positions[pi + 2] * INV_CELL_SIZE);
    const key = hashKey(cx, cy, cz);

    let cell = cells.get(key);
    if (!cell) {
      cell = [];
      cells.set(key, cell);
    }
    cell.push(i);
  }

  // Check each entity against entities in same + neighboring cells
  // Use a Set to avoid duplicate pairs
  let pairIdx = 0;
  const seen = new Set<number>();

  for (let i = 0; i < count; i++) {
    if (pairIdx >= maxPairs) break;

    const pi = i * POS_STRIDE;
    const ax = positions[pi];
    const ay = positions[pi + 1];
    const az = positions[pi + 2];
    const ar = radii[i];

    const cx = Math.floor(ax * INV_CELL_SIZE);
    const cy = Math.floor(ay * INV_CELL_SIZE);
    const cz = Math.floor(az * INV_CELL_SIZE);

    // Check 27 neighboring cells
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = hashKey(cx + dx, cy + dy, cz + dz);
          const cell = cells.get(key);
          if (!cell) continue;

          for (let c = 0; c < cell.length; c++) {
            const j = cell[c];
            if (j <= i) continue; // Avoid duplicate pairs + self-check

            // Canonical pair key for dedup
            const pairKey = i * count + j;
            if (seen.has(pairKey)) continue;
            seen.add(pairKey);

            // Narrow-phase: squared distance check
            const pj = j * POS_STRIDE;
            const ddx = ax - positions[pj];
            const ddy = ay - positions[pj + 1];
            const ddz = az - positions[pj + 2];
            const distSq = ddx * ddx + ddy * ddy + ddz * ddz;

            const combinedRadius = ar + radii[j];
            if (distSq < combinedRadius * combinedRadius) {
              const offset = pairIdx * COLLISION_PAIR_STRIDE;
              pairs[offset] = i;
              pairs[offset + 1] = j;
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
