/**
 * HalfEdgeMesh - Face adjacency structure for geodesic walking.
 *
 * Builds a half-edge connectivity map from a THREE.BufferGeometry so that
 * FaceWalker can cross edges in O(1). Each directed edge (v0 -> v1) maps to
 * its twin (v1 -> v0) on the adjacent triangle.
 *
 * Non-manifold edges (boundary or shared by >2 faces) are stored as null twins
 * and the walker treats them as reflecting walls.
 */

import * as THREE from 'three';

/** Per-face data cached for fast access */
export interface FaceData {
  /** Vertex indices in the original BufferGeometry */
  a: number;
  b: number;
  c: number;
  /** World-space vertex positions (pre-computed) */
  pA: THREE.Vector3;
  pB: THREE.Vector3;
  pC: THREE.Vector3;
  /** Face normal (not necessarily unit length until normalized) */
  normal: THREE.Vector3;
}

/**
 * A directed half-edge from vertex `from` to vertex `to`, belonging to face `faceIndex`.
 * `twin` is the index of the half-edge going the opposite direction on the adjacent face,
 * or -1 if there is no adjacent face (boundary).
 */
export interface HalfEdge {
  from: number;
  to: number;
  faceIndex: number;
  /** Local edge index within the face (0, 1, or 2) */
  edgeLocal: number;
  /** Index of the twin half-edge, or -1 for boundary */
  twin: number;
}

export class HalfEdgeMesh {
  readonly faces: FaceData[];
  readonly halfEdges: HalfEdge[];
  /** For each face, the indices of its 3 half-edges [e0, e1, e2] */
  readonly faceHalfEdges: [number, number, number][];
  readonly vertexCount: number;
  readonly faceCount: number;

  constructor(geometry: THREE.BufferGeometry) {
    const index = geometry.index;
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;

    if (!index) {
      throw new Error('HalfEdgeMesh requires indexed geometry');
    }

    this.vertexCount = posAttr.count;
    this.faceCount = index.count / 3;
    this.faces = new Array(this.faceCount);
    this.halfEdges = [];
    this.faceHalfEdges = new Array(this.faceCount);

    // 1. Build position-based vertex canonicalization.
    // THREE.js geometries duplicate vertices at UV seams (sphere poles, torus seams).
    // We need to match edges by position, not by index.
    const PRECISION = 1e-5;
    const posKey = (idx: number): string => {
      const x = Math.round(posAttr.getX(idx) / PRECISION) * PRECISION;
      const y = Math.round(posAttr.getY(idx) / PRECISION) * PRECISION;
      const z = Math.round(posAttr.getZ(idx) / PRECISION) * PRECISION;
      return `${x},${y},${z}`;
    };

    // Map each vertex index to a canonical index (first occurrence of that position)
    const posToCanonical = new Map<string, number>();
    const canonical = new Uint32Array(this.vertexCount);
    for (let i = 0; i < this.vertexCount; i++) {
      const key = posKey(i);
      const existing = posToCanonical.get(key);
      if (existing !== undefined) {
        canonical[i] = existing;
      } else {
        canonical[i] = i;
        posToCanonical.set(key, i);
      }
    }

    // 2. Build face data and half-edges
    // Edge map uses canonical vertex indices for twin matching
    const edgeMap = new Map<string, number>();

    for (let fi = 0; fi < this.faceCount; fi++) {
      const a = index.getX(fi * 3);
      const b = index.getX(fi * 3 + 1);
      const c = index.getX(fi * 3 + 2);

      const pA = new THREE.Vector3().fromBufferAttribute(posAttr, a);
      const pB = new THREE.Vector3().fromBufferAttribute(posAttr, b);
      const pC = new THREE.Vector3().fromBufferAttribute(posAttr, c);

      // Compute face normal via cross product
      const ab = new THREE.Vector3().subVectors(pB, pA);
      const ac = new THREE.Vector3().subVectors(pC, pA);
      const normal = new THREE.Vector3().crossVectors(ab, ac);
      const normalLen = normal.length();
      if (normalLen > 1e-10) {
        normal.multiplyScalar(1 / normalLen);
      }

      this.faces[fi] = { a, b, c, pA, pB, pC, normal };

      // Create 3 half-edges for this face
      const verts = [a, b, c];
      const heIndices: [number, number, number] = [0, 0, 0];

      for (let ei = 0; ei < 3; ei++) {
        const from = verts[ei];
        const to = verts[(ei + 1) % 3];
        const heIdx = this.halfEdges.length;

        this.halfEdges.push({
          from,
          to,
          faceIndex: fi,
          edgeLocal: ei,
          twin: -1,
        });

        heIndices[ei] = heIdx;
        // Use canonical indices for the edge key
        const cFrom = canonical[from];
        const cTo = canonical[to];
        edgeMap.set(`${cFrom}-${cTo}`, heIdx);
      }

      this.faceHalfEdges[fi] = heIndices;
    }

    // 3. Link twins using canonical vertex indices
    for (let i = 0; i < this.halfEdges.length; i++) {
      const he = this.halfEdges[i];
      const cFrom = canonical[he.from];
      const cTo = canonical[he.to];
      const twinKey = `${cTo}-${cFrom}`;
      const twinIdx = edgeMap.get(twinKey);
      if (twinIdx !== undefined && twinIdx !== i) {
        he.twin = twinIdx;
      }
    }
  }

  /**
   * Get the half-edge for a specific edge of a face.
   * @param faceIndex Face index
   * @param edgeLocal Edge index within the face (0=AB, 1=BC, 2=CA)
   */
  getHalfEdge(faceIndex: number, edgeLocal: number): HalfEdge {
    return this.halfEdges[this.faceHalfEdges[faceIndex][edgeLocal]];
  }

  /**
   * Get the adjacent face across a given edge of a face.
   * Returns -1 if the edge is a boundary.
   */
  getAdjacentFace(faceIndex: number, edgeLocal: number): number {
    const he = this.getHalfEdge(faceIndex, edgeLocal);
    if (he.twin < 0) return -1;
    return this.halfEdges[he.twin].faceIndex;
  }

  /**
   * Get the vertex positions for a face as a tuple.
   */
  getFaceVertices(faceIndex: number): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
    const f = this.faces[faceIndex];
    return [f.pA, f.pB, f.pC];
  }

  /**
   * Get the two vertex positions that define an edge of a face.
   * @param faceIndex Face index
   * @param edgeLocal Edge index (0=AB, 1=BC, 2=CA)
   */
  getEdgeVertices(faceIndex: number, edgeLocal: number): [THREE.Vector3, THREE.Vector3] {
    const f = this.faces[faceIndex];
    const verts = [f.pA, f.pB, f.pC];
    return [verts[edgeLocal], verts[(edgeLocal + 1) % 3]];
  }
}
