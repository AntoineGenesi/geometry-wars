/**
 * Spatial hash grid for efficient broad-phase collision detection.
 *
 * Instead of checking every pair O(n*m), entities are inserted into cells
 * based on their world-space position. Queries only check entities in the
 * same and adjacent cells, reducing collision checks dramatically at scale.
 */

export class SpatialHash<T> {
  private readonly cellSize: number;
  private readonly invCellSize: number;
  private readonly cells: Map<number, T[]> = new Map();

  // Reusable arrays to avoid per-query allocation
  private readonly _nearbyResult: T[] = [];

  constructor(cellSize: number = 2.5) {
    this.cellSize = cellSize;
    this.invCellSize = 1 / cellSize;
  }

  /** Remove all entries. Call at the start of each frame. */
  clear(): void {
    this.cells.forEach(arr => { arr.length = 0; });
  }

  /** Insert an entity at the given world-space position. */
  insert(x: number, y: number, z: number, entity: T): void {
    const key = this.hashKey(x, y, z);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = [];
      this.cells.set(key, cell);
    }
    cell.push(entity);
  }

  /**
   * Return all entities in the same cell and the 26 neighboring cells.
   * The returned array is reused between calls -- do NOT store a reference.
   */
  getNearby(x: number, y: number, z: number): readonly T[] {
    const result = this._nearbyResult;
    result.length = 0;

    const cx = Math.floor(x * this.invCellSize);
    const cy = Math.floor(y * this.invCellSize);
    const cz = Math.floor(z * this.invCellSize);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = this.hashKeyFromCell(cx + dx, cy + dy, cz + dz);
          const cell = this.cells.get(key);
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

  private hashKey(x: number, y: number, z: number): number {
    const cx = Math.floor(x * this.invCellSize);
    const cy = Math.floor(y * this.invCellSize);
    const cz = Math.floor(z * this.invCellSize);
    return this.hashKeyFromCell(cx, cy, cz);
  }

  private hashKeyFromCell(cx: number, cy: number, cz: number): number {
    // Large prime-based spatial hash to minimize collisions
    // Using bitwise OR 0 to convert to 32-bit int for speed
    return ((cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)) | 0;
  }
}
