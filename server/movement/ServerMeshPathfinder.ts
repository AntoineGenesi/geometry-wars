import * as THREE from 'three';
import type { MeshSurface } from '../../src/surfaces/MeshSurface';

export interface ServerMeshPoint {
  faceIndex: number;
  wx: number;
  wy: number;
  wz: number;
}

interface FaceNeighbor {
  faceIndex: number;
  cost: number;
}

interface DistanceField {
  distances: Float64Array;
  nextFaces: Int32Array;
}

interface HeapEntry {
  faceIndex: number;
  distance: number;
}

/**
 * Cached face-graph distance fields for server-side target selection.
 * Fields are keyed by target face, so every enemy chasing the same player can
 * share one topology solve until that player crosses a triangle edge.
 */
export class ServerMeshPathfinder {
  private readonly faceCenters: THREE.Vector3[];
  private readonly neighbors: FaceNeighbor[][];
  private readonly fields = new Map<number, DistanceField>();

  constructor(private readonly surface: MeshSurface) {
    const halfEdge = surface.geodesic.halfEdge;
    this.faceCenters = halfEdge.faces.map((face) => new THREE.Vector3()
      .copy(face.pA)
      .add(face.pB)
      .add(face.pC)
      .multiplyScalar(1 / 3)
      .applyMatrix4(surface.mesh.matrixWorld));
    this.neighbors = Array.from({ length: halfEdge.faceCount }, () => []);

    for (let faceIndex = 0; faceIndex < halfEdge.faceCount; faceIndex++) {
      for (const edgeIndex of halfEdge.faceHalfEdges[faceIndex]) {
        const twinIndex = halfEdge.halfEdges[edgeIndex].twin;
        if (twinIndex < 0 || !this.hasCoincidentEndpoints(edgeIndex, twinIndex)) continue;
        const neighborFace = halfEdge.halfEdges[twinIndex].faceIndex;
        if (neighborFace === faceIndex) continue;
        this.neighbors[faceIndex].push({
          faceIndex: neighborFace,
          cost: this.faceCenters[faceIndex].distanceTo(this.faceCenters[neighborFace]),
        });
      }
    }
  }

  getPathDistance(origin: ServerMeshPoint, target: ServerMeshPoint): number {
    if (!this.isValidFace(origin.faceIndex) || !this.isValidFace(target.faceIndex)) {
      return Infinity;
    }
    if (origin.faceIndex === target.faceIndex) {
      return Math.hypot(target.wx - origin.wx, target.wy - origin.wy, target.wz - origin.wz);
    }

    const field = this.getDistanceField(target.faceIndex);
    const nextFace = field.nextFaces[origin.faceIndex];
    if (nextFace < 0 || !Number.isFinite(field.distances[nextFace])) return Infinity;

    const nextCenter = this.faceCenters[nextFace];
    const targetCenter = this.faceCenters[target.faceIndex];
    return Math.hypot(
      nextCenter.x - origin.wx,
      nextCenter.y - origin.wy,
      nextCenter.z - origin.wz,
    ) + field.distances[nextFace] + Math.hypot(
      target.wx - targetCenter.x,
      target.wy - targetCenter.y,
      target.wz - targetCenter.z,
    );
  }

  /** Write the next mesh-path direction into `out`; return connected path distance. */
  getPathDirection(
    origin: ServerMeshPoint,
    target: ServerMeshPoint,
    out: THREE.Vector3,
  ): number {
    const distance = this.getPathDistance(origin, target);
    if (!Number.isFinite(distance)) {
      out.set(0, 0, 0);
      return distance;
    }

    if (origin.faceIndex === target.faceIndex) {
      out.set(target.wx - origin.wx, target.wy - origin.wy, target.wz - origin.wz);
      return distance;
    }

    const field = this.getDistanceField(target.faceIndex);
    const nextCenter = this.faceCenters[field.nextFaces[origin.faceIndex]];
    out.set(nextCenter.x - origin.wx, nextCenter.y - origin.wy, nextCenter.z - origin.wz);
    return distance;
  }

  clearCache(): void {
    this.fields.clear();
  }

  private isValidFace(faceIndex: number): boolean {
    return Number.isInteger(faceIndex) && faceIndex >= 0 && faceIndex < this.faceCenters.length;
  }

  private hasCoincidentEndpoints(edgeIndex: number, twinIndex: number): boolean {
    const halfEdge = this.surface.geodesic.halfEdge;
    const edge = halfEdge.halfEdges[edgeIndex];
    const twin = halfEdge.halfEdges[twinIndex];
    const position = this.surface.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const distanceSq = (a: number, b: number): number => {
      const dx = position.getX(a) - position.getX(b);
      const dy = position.getY(a) - position.getY(b);
      const dz = position.getZ(a) - position.getZ(b);
      return dx * dx + dy * dy + dz * dz;
    };
    const epsilonSq = 1e-6;
    return (distanceSq(edge.from, twin.to) <= epsilonSq
      && distanceSq(edge.to, twin.from) <= epsilonSq)
      || (distanceSq(edge.from, twin.from) <= epsilonSq
        && distanceSq(edge.to, twin.to) <= epsilonSq);
  }

  private getDistanceField(targetFace: number): DistanceField {
    const cached = this.fields.get(targetFace);
    if (cached) return cached;

    // Bound cache growth during long sessions where players traverse many faces.
    if (this.fields.size >= 16) this.fields.delete(this.fields.keys().next().value as number);

    const distances = new Float64Array(this.faceCenters.length);
    distances.fill(Infinity);
    const nextFaces = new Int32Array(this.faceCenters.length);
    nextFaces.fill(-1);
    distances[targetFace] = 0;
    nextFaces[targetFace] = targetFace;

    const heap: HeapEntry[] = [{ faceIndex: targetFace, distance: 0 }];
    while (heap.length > 0) {
      const current = this.popHeap(heap)!;
      if (current.distance !== distances[current.faceIndex]) continue;
      for (const neighbor of this.neighbors[current.faceIndex]) {
        const candidate = current.distance + neighbor.cost;
        if (candidate >= distances[neighbor.faceIndex]) continue;
        distances[neighbor.faceIndex] = candidate;
        nextFaces[neighbor.faceIndex] = current.faceIndex;
        this.pushHeap(heap, { faceIndex: neighbor.faceIndex, distance: candidate });
      }
    }

    const field = { distances, nextFaces };
    this.fields.set(targetFace, field);
    return field;
  }

  private pushHeap(heap: HeapEntry[], entry: HeapEntry): void {
    let index = heap.length;
    heap.push(entry);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent].distance <= entry.distance) break;
      heap[index] = heap[parent];
      index = parent;
    }
    heap[index] = entry;
  }

  private popHeap(heap: HeapEntry[]): HeapEntry | undefined {
    if (heap.length === 0) return undefined;
    const root = heap[0];
    const last = heap.pop()!;
    if (heap.length === 0) return root;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const child = right < heap.length && heap[right].distance < heap[left].distance
        ? right : left;
      if (heap[child].distance >= last.distance) break;
      heap[index] = heap[child];
      index = child;
    }
    heap[index] = last;
    return root;
  }
}
