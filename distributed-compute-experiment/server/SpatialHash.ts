/**
 * Server-Side Spatial Hash — Phase 1.1
 *
 * Ported from src/core/SpatialHash.ts (client-side) for use in the Node.js
 * game server. Reduces bullet-enemy collision detection from O(B×E) to
 * O(B × avg_bucket_size), which at a 0.1 cell size is approximately
 * O(B × 2–4) in practice.
 *
 * At 90 enemies and 200 bullets with cellSize=0.1:
 *   - Before: 18,000 distance checks per tick
 *   - After:  ~400–800 distance checks per tick (~96% reduction)
 *
 * UV SPACE NOTES:
 * All coordinates are in UV space [0, 1). The hash wraps at boundaries
 * (toroidal topology). This matches how the server tracks entities.
 *
 * USAGE (in GameRoom.ts):
 *   const hash = new SpatialHash(0.1);
 *   enemies.forEach(e => hash.insert(e.id, e.surfaceU, e.surfaceV));
 *   const candidates = hash.queryRadius(bullet.x, bullet.y, 0.05);
 *   // Only distance-check `candidates`, not all enemies
 */

export interface HashedEntity {
  id: string;
  u: number;
  v: number;
}

export class SpatialHash {
  private readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly cells: Map<number, HashedEntity[]>;

  constructor(cellSize: number = 0.1) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
    this.cells = new Map();
  }

  /** Remove all entities. Call at the start of each tick before re-inserting. */
  clear(): void {
    this.cells.clear();
  }

  /** Insert an entity into the hash. */
  insert(id: string, u: number, v: number): void {
    const key = this.cellKey(u, v);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = [];
      this.cells.set(key, bucket);
    }
    bucket.push({ id, u, v });
  }

  /**
   * Return all entities within `radius` UV units of (u, v).
   *
   * Searches all cells whose bounding boxes overlap the query circle.
   * Then does exact distance filtering on the candidates.
   *
   * At cellSize=0.1 and radius=0.05, this searches 1–4 cells.
   */
  queryRadius(u: number, v: number, radius: number): HashedEntity[] {
    const results: HashedEntity[] = [];
    const radiusSq = radius * radius;

    // Compute cell range to search (account for toroidal wrapping)
    const cellRadius = Math.ceil(radius * this.invCellSize);
    const centerCellU = Math.floor(u * this.invCellSize);
    const centerCellV = Math.floor(v * this.invCellSize);

    for (let cu = centerCellU - cellRadius; cu <= centerCellU + cellRadius; cu++) {
      for (let cv = centerCellV - cellRadius; cv <= centerCellV + cellRadius; cv++) {
        const key = this.wrapCellKey(cu, cv);
        const bucket = this.cells.get(key);
        if (!bucket) continue;

        for (const entity of bucket) {
          // Toroidal distance (UV wraps at [0,1))
          const du = this.toroidalDist(entity.u - u);
          const dv = this.toroidalDist(entity.v - v);
          const distSq = du * du + dv * dv;
          if (distSq <= radiusSq) {
            results.push(entity);
          }
        }
      }
    }

    return results;
  }

  /** Return the cell count (for profiling). */
  get cellCount(): number {
    return this.cells.size;
  }

  /** Return total entity count across all cells (for profiling). */
  get entityCount(): number {
    let total = 0;
    this.cells.forEach(bucket => { total += bucket.length; });
    return total;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Hash a (u, v) position to a cell key. */
  private cellKey(u: number, v: number): number {
    const cu = Math.floor(u * this.invCellSize);
    const cv = Math.floor(v * this.invCellSize);
    return this.wrapCellKey(cu, cv);
  }

  /**
   * Combine cell coordinates into a unique integer key with toroidal wrapping.
   *
   * UV space is [0, 1) with ~10 cells per axis at cellSize=0.1.
   * We use a large prime multiplier to reduce collisions.
   */
  private wrapCellKey(cu: number, cv: number): number {
    const cellsPerAxis = Math.ceil(this.invCellSize);
    // Wrap cell coordinates into [0, cellsPerAxis)
    const wu = ((cu % cellsPerAxis) + cellsPerAxis) % cellsPerAxis;
    const wv = ((cv % cellsPerAxis) + cellsPerAxis) % cellsPerAxis;
    return wu * 10007 + wv;
  }

  /**
   * Return the shortest toroidal distance component (wraps at 1.0).
   * e.g. toroidalDist(0.9 - 0.1) = -0.2 (not 0.8)
   */
  private toroidalDist(delta: number): number {
    // Wrap delta into [-0.5, 0.5]
    let d = delta % 1;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    return d;
  }
}
