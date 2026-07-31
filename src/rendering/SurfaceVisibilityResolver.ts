import * as THREE from 'three';
import type { MeshSurface } from '../surfaces/MeshSurface';

export const SURFACE_VISIBILITY_DIRECT = 1;
export const SURFACE_VISIBILITY_EDGE_BLOCKED = 0.34;
export const SURFACE_VISIBILITY_LONG_PATH = 0.06;
export const SURFACE_VISIBILITY_IMPORTANT_FLOOR = 0.22;
export const SURFACE_VISIBILITY_DEFAULT_MIN_BRIGHTNESS = 0.35;

const HARD_EDGE_COSINE = Math.cos(THREE.MathUtils.degToRad(50));
const LONG_PATH_RATIO = 0.52;
const MAX_CACHED_FIELDS = 6;
const LARGE_ENEMY_RADIUS = 1.1;
const DISTANCE_EPSILON = 1e-7;
const ACTIVE_FIELD_REUSE_RATIO = 0.04;
const ENTITY_FACE_REQUERY_EDGE_RATIO = 0.5;

export type SurfaceVisibilityClass =
  | 'direct'
  | 'edge-blocked'
  | 'long-path'
  | 'important-occluded'
  | 'opaque-hidden';

export interface SurfaceVisibilityResult {
  className: SurfaceVisibilityClass;
  visibility: number;
  minColorBrightness: number;
  occluded: boolean;
  playerFaceIndex: number;
  entityFaceIndex: number;
  topologyDistance: number;
  topologyDistanceRatio: number;
  hardEdgeCrossings: number;
}

export interface ResolveSurfaceVisibilityOptions {
  playerWorldPosition: THREE.Vector3;
  playerFaceIndex?: number;
  entityWorldPosition: THREE.Vector3;
  entityFaceIndex?: number;
  entityKey?: object;
  opaqueSurfaces?: boolean;
  important?: boolean;
  enemyRadius?: number;
}

export interface SurfaceVisibilityResolverStats {
  faceCount: number;
  edgeCount: number;
  buildMs: number;
  fieldBuilds: number;
  fieldCacheHits: number;
  lastFieldBuildMs: number;
  maxFieldBuildMs: number;
  resolveCount: number;
  faceQueries: number;
}

interface GraphEdge {
  face: number;
  distance: number;
  hard: boolean;
}

interface DistanceField {
  sourceFace: number;
  distances: Float64Array;
  hardEdgeCrossings: Uint16Array;
  maxDistance: number;
}

interface HeapEntry {
  face: number;
  distance: number;
  hardEdgeCrossings: number;
}

class MinHeap {
  private readonly entries: HeapEntry[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(entry: HeapEntry): void {
    const entries = this.entries;
    let index = entries.length;
    entries.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!isBefore(entry, entries[parent])) break;
      entries[index] = entries[parent];
      index = parent;
    }
    entries[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const entries = this.entries;
    const root = entries[0];
    const tail = entries.pop();
    if (!tail || entries.length === 0) return root;

    let index = 0;
    entries[0] = tail;
    while (true) {
      const left = index * 2 + 1;
      if (left >= entries.length) break;
      const right = left + 1;
      let child = left;
      if (right < entries.length && isBefore(entries[right], entries[left])) child = right;
      if (!isBefore(entries[child], tail)) break;
      entries[index] = entries[child];
      index = child;
    }
    entries[index] = tail;
    return root;
  }
}

function isBefore(a: HeapEntry, b: HeapEntry): boolean {
  if (Math.abs(a.distance - b.distance) > DISTANCE_EPSILON) return a.distance < b.distance;
  return a.hardEdgeCrossings < b.hardEdgeCrossings;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Shared SP/MP enemy visibility authority based only on the walkable mesh.
 *
 * Adjacency is built once. A shortest-path field is computed at most once for
 * each recent player face, so resolving 150 enemies performs table lookups
 * rather than 150 graph searches. Face normals mark sharp topology crossings;
 * no surface name, UV coordinate, camera ray, or player hemisphere is used.
 */
export class SurfaceVisibilityResolver {
  private readonly meshSurface: MeshSurface;
  private readonly adjacency: GraphEdge[][];
  private readonly fields = new Map<number, DistanceField>();
  private readonly entityFaces = new WeakMap<object, { face: number; position: THREE.Vector3 }>();
  private readonly entityFaceRequeryDistanceSq: number;
  private activeField: DistanceField | null = null;
  private readonly stats: SurfaceVisibilityResolverStats;

  constructor(meshSurface: MeshSurface) {
    this.meshSurface = meshSurface;
    const startedAt = performance.now();
    const graph = this.buildGraph(meshSurface.mesh.geometry);
    this.adjacency = graph.adjacency;
    this.entityFaceRequeryDistanceSq = Math.pow(
      graph.meanEdgeDistance * ENTITY_FACE_REQUERY_EDGE_RATIO,
      2,
    );
    this.stats = {
      faceCount: graph.adjacency.length,
      edgeCount: graph.edgeCount,
      buildMs: performance.now() - startedAt,
      fieldBuilds: 0,
      fieldCacheHits: 0,
      lastFieldBuildMs: 0,
      maxFieldBuildMs: 0,
      resolveCount: 0,
      faceQueries: 0,
    };
  }

  resolve(options: ResolveSurfaceVisibilityOptions): SurfaceVisibilityResult {
    this.stats.resolveCount++;
    const playerFace = this.resolveFace(options.playerFaceIndex, options.playerWorldPosition);
    const entityFace = this.resolveEntityFace(options);
    const field = this.getDistanceField(playerFace);
    const topologyDistance = field.distances[entityFace];
    const reachable = Number.isFinite(topologyDistance);
    const ratio = reachable && field.maxDistance > DISTANCE_EPSILON
      ? THREE.MathUtils.clamp(topologyDistance / field.maxDistance, 0, 1)
      : reachable ? 0 : 1;
    const hardEdgeCrossings = reachable ? field.hardEdgeCrossings[entityFace] : 0xffff;
    const important = options.important === true || (options.enemyRadius ?? 0) >= LARGE_ENEMY_RADIUS;
    const blocked = hardEdgeCrossings > 0;
    const longPath = !reachable || ratio >= LONG_PATH_RATIO;

    if (!blocked && !longPath) {
      return this.result('direct', SURFACE_VISIBILITY_DIRECT, false, playerFace, entityFace,
        topologyDistance, ratio, hardEdgeCrossings);
    }

    if (options.opaqueSurfaces) {
      return this.result('opaque-hidden', 0, true, playerFace, entityFace,
        topologyDistance, ratio, hardEdgeCrossings);
    }

    if (important) {
      return this.result('important-occluded', SURFACE_VISIBILITY_IMPORTANT_FLOOR, true,
        playerFace, entityFace, topologyDistance, ratio, hardEdgeCrossings);
    }

    if (longPath) {
      return this.result('long-path', SURFACE_VISIBILITY_LONG_PATH, true, playerFace,
        entityFace, topologyDistance, ratio, hardEdgeCrossings);
    }

    return this.result('edge-blocked', SURFACE_VISIBILITY_EDGE_BLOCKED, true, playerFace,
      entityFace, topologyDistance, ratio, hardEdgeCrossings);
  }

  locateFace(worldPosition: THREE.Vector3): number {
    this.stats.faceQueries++;
    return this.meshSurface.closestPointOnSurface(worldPosition)?.faceIndex ?? 0;
  }

  getStats(): SurfaceVisibilityResolverStats {
    return { ...this.stats };
  }

  private resolveFace(faceIndex: number | undefined, worldPosition: THREE.Vector3): number {
    if (faceIndex !== undefined && faceIndex >= 0 && faceIndex < this.adjacency.length) {
      return faceIndex;
    }
    return this.locateFace(worldPosition);
  }

  private resolveEntityFace(options: ResolveSurfaceVisibilityOptions): number {
    if (options.entityFaceIndex !== undefined) {
      return this.resolveFace(options.entityFaceIndex, options.entityWorldPosition);
    }
    if (!options.entityKey) return this.locateFace(options.entityWorldPosition);

    const cached = this.entityFaces.get(options.entityKey);
    if (cached && cached.position.distanceToSquared(options.entityWorldPosition)
      <= this.entityFaceRequeryDistanceSq) {
      return cached.face;
    }
    const face = this.locateFace(options.entityWorldPosition);
    if (cached) {
      cached.face = face;
      cached.position.copy(options.entityWorldPosition);
    } else {
      this.entityFaces.set(options.entityKey, {
        face,
        position: options.entityWorldPosition.clone(),
      });
    }
    return face;
  }

  private result(
    className: SurfaceVisibilityClass,
    visibility: number,
    occluded: boolean,
    playerFaceIndex: number,
    entityFaceIndex: number,
    topologyDistance: number,
    topologyDistanceRatio: number,
    hardEdgeCrossings: number,
  ): SurfaceVisibilityResult {
    return {
      className,
      visibility,
      minColorBrightness: visibility,
      occluded,
      playerFaceIndex,
      entityFaceIndex,
      topologyDistance,
      topologyDistanceRatio,
      hardEdgeCrossings,
    };
  }

  private getDistanceField(sourceFace: number): DistanceField {
    if (this.activeField) {
      const sourceDistance = this.activeField.distances[sourceFace];
      const reuseDistance = this.activeField.maxDistance * ACTIVE_FIELD_REUSE_RATIO;
      if (sourceDistance <= reuseDistance
        && this.activeField.hardEdgeCrossings[sourceFace] === 0) {
        this.stats.fieldCacheHits++;
        return this.activeField;
      }
    }

    const cached = this.fields.get(sourceFace);
    if (cached) {
      this.stats.fieldCacheHits++;
      this.fields.delete(sourceFace);
      this.fields.set(sourceFace, cached);
      this.activeField = cached;
      return cached;
    }

    const startedAt = performance.now();
    const distances = new Float64Array(this.adjacency.length);
    distances.fill(Number.POSITIVE_INFINITY);
    const hardEdgeCrossings = new Uint16Array(this.adjacency.length);
    hardEdgeCrossings.fill(0xffff);
    distances[sourceFace] = 0;
    hardEdgeCrossings[sourceFace] = 0;

    const heap = new MinHeap();
    heap.push({ face: sourceFace, distance: 0, hardEdgeCrossings: 0 });
    let maxDistance = 0;

    while (heap.size > 0) {
      const current = heap.pop()!;
      const knownDistance = distances[current.face];
      const knownHardEdges = hardEdgeCrossings[current.face];
      if (current.distance > knownDistance + DISTANCE_EPSILON) continue;
      if (Math.abs(current.distance - knownDistance) <= DISTANCE_EPSILON
        && current.hardEdgeCrossings > knownHardEdges) continue;

      maxDistance = Math.max(maxDistance, current.distance);
      for (const edge of this.adjacency[current.face]) {
        const nextDistance = current.distance + edge.distance;
        const nextHardEdges = Math.min(0xffff, current.hardEdgeCrossings + (edge.hard ? 1 : 0));
        const improvesDistance = nextDistance < distances[edge.face] - DISTANCE_EPSILON;
        const tiesWithFewerHardEdges = Math.abs(nextDistance - distances[edge.face]) <= DISTANCE_EPSILON
          && nextHardEdges < hardEdgeCrossings[edge.face];
        if (!improvesDistance && !tiesWithFewerHardEdges) continue;

        distances[edge.face] = nextDistance;
        hardEdgeCrossings[edge.face] = nextHardEdges;
        heap.push({ face: edge.face, distance: nextDistance, hardEdgeCrossings: nextHardEdges });
      }
    }

    const field = { sourceFace, distances, hardEdgeCrossings, maxDistance };
    this.fields.set(sourceFace, field);
    this.activeField = field;
    if (this.fields.size > MAX_CACHED_FIELDS) {
      const oldest = this.fields.keys().next().value;
      if (oldest !== undefined) this.fields.delete(oldest);
    }
    const elapsed = performance.now() - startedAt;
    this.stats.fieldBuilds++;
    this.stats.lastFieldBuildMs = elapsed;
    this.stats.maxFieldBuildMs = Math.max(this.stats.maxFieldBuildMs, elapsed);
    return field;
  }

  private buildGraph(geometry: THREE.BufferGeometry): {
    adjacency: GraphEdge[][];
    edgeCount: number;
    meanEdgeDistance: number;
  } {
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = geometry.getIndex();
    const faceCount = Math.floor((index?.count ?? positions.count) / 3);
    const adjacency: GraphEdge[][] = Array.from({ length: faceCount }, () => []);
    const centroids = Array.from({ length: faceCount }, () => new THREE.Vector3());
    const normals = Array.from({ length: faceCount }, () => new THREE.Vector3());
    geometry.computeBoundingBox();
    const diagonal = geometry.boundingBox?.getSize(new THREE.Vector3()).length() ?? 1;
    const weldScale = 1 / Math.max(diagonal * 1e-6, 1e-8);
    const weldedIds = new Map<string, number>();
    const edges = new Map<string, number[]>();
    let nextWeldedId = 0;

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const vertexIndex = (offset: number): number => index ? index.getX(offset) : offset;
    const weldedId = (vertex: THREE.Vector3): number => {
      const key = `${Math.round(vertex.x * weldScale)},${Math.round(vertex.y * weldScale)},${Math.round(vertex.z * weldScale)}`;
      let id = weldedIds.get(key);
      if (id === undefined) {
        id = nextWeldedId++;
        weldedIds.set(key, id);
      }
      return id;
    };

    for (let face = 0; face < faceCount; face++) {
      a.fromBufferAttribute(positions, vertexIndex(face * 3));
      b.fromBufferAttribute(positions, vertexIndex(face * 3 + 1));
      c.fromBufferAttribute(positions, vertexIndex(face * 3 + 2));
      centroids[face].copy(a).add(b).add(c).multiplyScalar(1 / 3);
      normals[face].crossVectors(ab.subVectors(b, a), ac.subVectors(c, a)).normalize();
      const ids = [weldedId(a), weldedId(b), weldedId(c)];
      for (let edge = 0; edge < 3; edge++) {
        const key = edgeKey(ids[edge], ids[(edge + 1) % 3]);
        const owners = edges.get(key);
        if (owners) owners.push(face);
        else edges.set(key, [face]);
      }
    }

    let edgeCount = 0;
    let totalEdgeDistance = 0;
    for (const owners of edges.values()) {
      if (owners.length < 2) continue;
      for (let i = 0; i < owners.length - 1; i++) {
        for (let j = i + 1; j < owners.length; j++) {
          const from = owners[i];
          const to = owners[j];
          const distance = Math.max(centroids[from].distanceTo(centroids[to]), DISTANCE_EPSILON);
          const hard = normals[from].dot(normals[to]) < HARD_EDGE_COSINE;
          adjacency[from].push({ face: to, distance, hard });
          adjacency[to].push({ face: from, distance, hard });
          edgeCount++;
          totalEdgeDistance += distance;
        }
      }
    }

    return {
      adjacency,
      edgeCount,
      meanEdgeDistance: edgeCount > 0 ? totalEdgeDistance / edgeCount : 1,
    };
  }
}
