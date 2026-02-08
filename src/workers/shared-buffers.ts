/**
 * SharedArrayBuffer layout definitions for zero-copy data transfer between
 * the main thread and Web Workers (collision detection + AI computation).
 *
 * Memory layout uses typed array views over a single SharedArrayBuffer per
 * concern, avoiding serialization/deserialization overhead entirely.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Floats per entity position (x, y, z) */
export const POS_STRIDE = 3;

/** Floats per entity velocity (vx, vy, vz) */
export const VEL_STRIDE = 3;

/** Floats per entity radius (r) */
export const RADIUS_STRIDE = 1;

/** Bytes per entity type (Uint8) */
export const TYPE_STRIDE = 1;

/** Floats per AI output (du, dv) */
export const AI_OUTPUT_STRIDE = 2;

/** Ints per collision pair (indexA, indexB) */
export const COLLISION_PAIR_STRIDE = 2;

/** Maximum collision pairs per frame (prevents buffer overflow) */
export const MAX_COLLISION_PAIRS = 8192;

/** Padding for Atomics alignment (must be multiple of 4 bytes) */
const ATOMICS_ALIGNMENT = 4;

// ---------------------------------------------------------------------------
// Enemy type enum (mirrors the class hierarchy for worker-side AI)
// ---------------------------------------------------------------------------

export const enum EnemyType {
  Grunt = 0,
  Weaver = 1,
  Wanderer = 2,
  Spinner = 3,
  Snake = 4,
  Rocket = 5,
  Repulsor = 6,
  GravityWell = 7,
  Spawner = 8,
  Mayfly = 9,
  Painter = 10,
  Duck = 11,
  Neutron = 12,
  Gate = 13,
  Virus = 14,
  Boss = 15,
  TitanGrunt = 16,
  TitanWeaver = 17,
  TitanSpinner = 18,
  GiantWanderer = 19,
  GiantRocket = 20,
  GiantSnake = 21,
  GiantNeutron = 22,
  SpinnerSpawn = 23,
  Unknown = 255,
}

/** Map from class name to EnemyType enum value. */
export const ENEMY_TYPE_MAP: Record<string, EnemyType> = {
  Grunt: EnemyType.Grunt,
  Weaver: EnemyType.Weaver,
  Wanderer: EnemyType.Wanderer,
  Spinner: EnemyType.Spinner,
  Snake: EnemyType.Snake,
  Rocket: EnemyType.Rocket,
  Repulsor: EnemyType.Repulsor,
  GravityWell: EnemyType.GravityWell,
  Spawner: EnemyType.Spawner,
  Mayfly: EnemyType.Mayfly,
  Painter: EnemyType.Painter,
  Duck: EnemyType.Duck,
  Neutron: EnemyType.Neutron,
  Gate: EnemyType.Gate,
  Virus: EnemyType.Virus,
  Boss: EnemyType.Boss,
  TitanGrunt: EnemyType.TitanGrunt,
  TitanWeaver: EnemyType.TitanWeaver,
  TitanSpinner: EnemyType.TitanSpinner,
  GiantWanderer: EnemyType.GiantWanderer,
  GiantRocket: EnemyType.GiantRocket,
  GiantSnake: EnemyType.GiantSnake,
  GiantNeutron: EnemyType.GiantNeutron,
  SpinnerSpawn: EnemyType.SpinnerSpawn,
};

// ---------------------------------------------------------------------------
// Buffer descriptors
// ---------------------------------------------------------------------------

/** Describes the layout of an EntityBuffer (positions + velocities + radii + types). */
export interface EntityBufferLayout {
  /** The SharedArrayBuffer backing the data. */
  sab: SharedArrayBuffer;
  /** Number of entities currently stored. */
  count: number;
  /** Maximum capacity (entities). */
  capacity: number;
  /** Byte offset where positions start (Float32). */
  positionsOffset: number;
  /** Byte offset where velocities start (Float32). */
  velocitiesOffset: number;
  /** Byte offset where radii start (Float32). */
  radiiOffset: number;
  /** Byte offset where types start (Uint8). */
  typesOffset: number;
  /** Byte offset for surface U coords (Float32). */
  surfaceUOffset: number;
  /** Byte offset for surface V coords (Float32). */
  surfaceVOffset: number;
  /** Byte offset for speeds (Float32). */
  speedsOffset: number;
}

/** Describes the collision result buffer layout. */
export interface CollisionResultLayout {
  /** The SharedArrayBuffer backing the data. */
  sab: SharedArrayBuffer;
  /** Maximum number of pairs that can be written. */
  maxPairs: number;
  /** Byte offset for the pair count (Int32 for Atomics). */
  countOffset: number;
  /** Byte offset where pairs start (Int32Array, stride 2). */
  pairsOffset: number;
}

/** Describes the AI output buffer layout. */
export interface AIOutputLayout {
  /** The SharedArrayBuffer backing the data. */
  sab: SharedArrayBuffer;
  /** Number of enemy slots. */
  capacity: number;
  /** Byte offset where movement deltas start (Float32, stride 2: du, dv). */
  deltasOffset: number;
  /** Byte offset for ready flag (Int32 for Atomics). */
  readyOffset: number;
}

// ---------------------------------------------------------------------------
// Typed views (zero-copy accessors)
// ---------------------------------------------------------------------------

export interface EntityBufferViews {
  positions: Float32Array;
  velocities: Float32Array;
  radii: Float32Array;
  types: Uint8Array;
  surfaceU: Float32Array;
  surfaceV: Float32Array;
  speeds: Float32Array;
}

export interface CollisionResultViews {
  count: Int32Array;
  pairs: Int32Array;
}

export interface AIOutputViews {
  deltas: Float32Array;
  ready: Int32Array;
}

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/**
 * Allocate a SharedArrayBuffer for entity data with the given capacity.
 * Layout:
 *   [positions: Float32 x capacity*3]
 *   [velocities: Float32 x capacity*3]
 *   [radii: Float32 x capacity*1]
 *   [types: Uint8 x capacity*1, padded to 4-byte alignment]
 *   [surfaceU: Float32 x capacity*1]
 *   [surfaceV: Float32 x capacity*1]
 *   [speeds: Float32 x capacity*1]
 */
export function createEntityBuffer(capacity: number): EntityBufferLayout {
  const positionsBytes = capacity * POS_STRIDE * Float32Array.BYTES_PER_ELEMENT;
  const velocitiesBytes = capacity * VEL_STRIDE * Float32Array.BYTES_PER_ELEMENT;
  const radiiBytes = capacity * RADIUS_STRIDE * Float32Array.BYTES_PER_ELEMENT;
  const typesBytes = alignUp(capacity * TYPE_STRIDE, ATOMICS_ALIGNMENT);
  const surfaceUBytes = capacity * Float32Array.BYTES_PER_ELEMENT;
  const surfaceVBytes = capacity * Float32Array.BYTES_PER_ELEMENT;
  const speedsBytes = capacity * Float32Array.BYTES_PER_ELEMENT;

  const totalBytes = positionsBytes + velocitiesBytes + radiiBytes + typesBytes
    + surfaceUBytes + surfaceVBytes + speedsBytes;

  const sab = new SharedArrayBuffer(totalBytes);

  let offset = 0;
  const positionsOffset = offset; offset += positionsBytes;
  const velocitiesOffset = offset; offset += velocitiesBytes;
  const radiiOffset = offset; offset += radiiBytes;
  const typesOffset = offset; offset += typesBytes;
  const surfaceUOffset = offset; offset += surfaceUBytes;
  const surfaceVOffset = offset; offset += surfaceVBytes;
  const speedsOffset = offset;

  return {
    sab,
    count: 0,
    capacity,
    positionsOffset,
    velocitiesOffset,
    radiiOffset,
    typesOffset,
    surfaceUOffset,
    surfaceVOffset,
    speedsOffset,
  };
}

/**
 * Allocate a SharedArrayBuffer for collision results.
 * Layout:
 *   [count: Int32 x 1]  (Atomics-compatible pair count)
 *   [pairs: Int32 x maxPairs*2]
 */
export function createCollisionResultBuffer(
  maxPairs: number = MAX_COLLISION_PAIRS
): CollisionResultLayout {
  const countBytes = Int32Array.BYTES_PER_ELEMENT; // 4 bytes
  const pairsBytes = maxPairs * COLLISION_PAIR_STRIDE * Int32Array.BYTES_PER_ELEMENT;

  const sab = new SharedArrayBuffer(countBytes + pairsBytes);

  return {
    sab,
    maxPairs,
    countOffset: 0,
    pairsOffset: countBytes,
  };
}

/**
 * Allocate a SharedArrayBuffer for AI output.
 * Layout:
 *   [ready: Int32 x 1]  (Atomics-compatible flag: 0=processing, 1=ready)
 *   [deltas: Float32 x capacity*2]  (du, dv per enemy)
 */
export function createAIOutputBuffer(capacity: number): AIOutputLayout {
  const readyBytes = Int32Array.BYTES_PER_ELEMENT; // 4 bytes
  const deltasBytes = capacity * AI_OUTPUT_STRIDE * Float32Array.BYTES_PER_ELEMENT;

  // Align deltas to 4-byte boundary (already is, but be explicit)
  const deltasOffset = alignUp(readyBytes, ATOMICS_ALIGNMENT);
  const totalBytes = deltasOffset + deltasBytes;

  const sab = new SharedArrayBuffer(totalBytes);

  return {
    sab,
    capacity,
    deltasOffset,
    readyOffset: 0,
  };
}

// ---------------------------------------------------------------------------
// View accessors (create typed array views over the SAB)
// ---------------------------------------------------------------------------

export function getEntityViews(layout: EntityBufferLayout): EntityBufferViews {
  return {
    positions: new Float32Array(layout.sab, layout.positionsOffset, layout.capacity * POS_STRIDE),
    velocities: new Float32Array(layout.sab, layout.velocitiesOffset, layout.capacity * VEL_STRIDE),
    radii: new Float32Array(layout.sab, layout.radiiOffset, layout.capacity * RADIUS_STRIDE),
    types: new Uint8Array(layout.sab, layout.typesOffset, layout.capacity * TYPE_STRIDE),
    surfaceU: new Float32Array(layout.sab, layout.surfaceUOffset, layout.capacity),
    surfaceV: new Float32Array(layout.sab, layout.surfaceVOffset, layout.capacity),
    speeds: new Float32Array(layout.sab, layout.speedsOffset, layout.capacity),
  };
}

export function getCollisionResultViews(layout: CollisionResultLayout): CollisionResultViews {
  return {
    count: new Int32Array(layout.sab, layout.countOffset, 1),
    pairs: new Int32Array(layout.sab, layout.pairsOffset, layout.maxPairs * COLLISION_PAIR_STRIDE),
  };
}

export function getAIOutputViews(layout: AIOutputLayout): AIOutputViews {
  return {
    deltas: new Float32Array(layout.sab, layout.deltasOffset, layout.capacity * AI_OUTPUT_STRIDE),
    ready: new Int32Array(layout.sab, layout.readyOffset, 1),
  };
}

// ---------------------------------------------------------------------------
// Write helpers (main thread writes entity data into the SAB)
// ---------------------------------------------------------------------------

export interface EntityData {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  type: number;
  surfaceU: number;
  surfaceV: number;
  speed: number;
}

/**
 * Write entity data into the shared buffer. Returns the number of entities written.
 * Caps at layout.capacity.
 */
export function writeEntityData(
  layout: EntityBufferLayout,
  views: EntityBufferViews,
  entities: readonly EntityData[],
): number {
  const count = Math.min(entities.length, layout.capacity);

  for (let i = 0; i < count; i++) {
    const e = entities[i];
    const pi = i * POS_STRIDE;
    views.positions[pi] = e.x;
    views.positions[pi + 1] = e.y;
    views.positions[pi + 2] = e.z;

    const vi = i * VEL_STRIDE;
    views.velocities[vi] = e.vx;
    views.velocities[vi + 1] = e.vy;
    views.velocities[vi + 2] = e.vz;

    views.radii[i] = e.radius;
    views.types[i] = e.type;
    views.surfaceU[i] = e.surfaceU;
    views.surfaceV[i] = e.surfaceV;
    views.speeds[i] = e.speed;
  }

  layout.count = count;
  return count;
}

/**
 * Read collision pairs from the result buffer.
 * Returns an array of [indexA, indexB] tuples.
 */
export function readCollisionPairs(
  views: CollisionResultViews,
): Array<[number, number]> {
  const count = Atomics.load(views.count, 0);
  const result: Array<[number, number]> = [];

  for (let i = 0; i < count; i++) {
    const offset = i * COLLISION_PAIR_STRIDE;
    result.push([views.pairs[offset], views.pairs[offset + 1]]);
  }

  return result;
}

/**
 * Read AI movement deltas from the output buffer.
 * Returns an array of { du, dv } objects.
 */
export function readAIDeltas(
  views: AIOutputViews,
  count: number,
): Array<{ du: number; dv: number }> {
  const result: Array<{ du: number; dv: number }> = [];

  for (let i = 0; i < count; i++) {
    const offset = i * AI_OUTPUT_STRIDE;
    result.push({
      du: views.deltas[offset],
      dv: views.deltas[offset + 1],
    });
  }

  return result;
}
