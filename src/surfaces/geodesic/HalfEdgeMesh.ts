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
    // Vertex normals for face normal consistency check (may be null)
    const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | null;

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

      // REGRESSION GUARD — Iteration 8: Fix inverted face normals.
      // The cross product normal depends on winding order. Some meshes (e.g.,
      // beveled cube from CubeSurface) have inconsistent winding, producing
      // normals that point inward instead of outward for some faces.
      // This caused the geodesic walker to reverse direction when crossing
      // into an inverted-normal face (188/299 lateral reversals on cube).
      //
      // Fix: use the geometry's vertex normals (which are always outward-pointing
      // per Three.js convention) to verify and flip the face normal if it
      // disagrees with the average vertex normal.
      if (normalAttr) {
        const vn = new THREE.Vector3(
          normalAttr.getX(a) + normalAttr.getX(b) + normalAttr.getX(c),
          normalAttr.getY(a) + normalAttr.getY(b) + normalAttr.getY(c),
          normalAttr.getZ(a) + normalAttr.getZ(b) + normalAttr.getZ(c),
        );
        if (vn.dot(normal) < 0) {
          normal.negate();
        }
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

    // 4. REGRESSION GUARD — Iteration 9: Fix geometry seam boundaries.
    // Some meshes (e.g., beveled cube from CubeSurface) have seams where
    // two halves of a flat face are built independently with DIFFERENT
    // triangulations. The vertices along the seam have NEARLY matching
    // positions (within ~0.02 world units) but are NOT exact duplicates.
    // The canonical vertex approach (PRECISION=1e-5) can't match these.
    //
    // This caused 18 false boundary edges on the cube top face at Z=0,
    // which made the geodesic walker reflect instead of crossing, producing
    // 188/299 lateral reversals (the walker ping-pongs at the seam).
    //
    // Fix: after the initial twin-linking pass, find unmatched half-edges
    // and try to match them with other unmatched half-edges whose endpoints
    // are CLOSE in world space (within SEAM_TOLERANCE). This only runs on
    // boundary edges, so it's O(B^2) where B is the number of boundaries
    // (typically <100 even on complex meshes).
    this._linkSeamEdges(posAttr);
  }

  /**
   * Second-pass twin linking for geometry seam edges.
   * Matches unmatched half-edges whose world-space endpoints are within tolerance,
   * even if their vertex indices don't canonicalize to the same value.
   */
  private _linkSeamEdges(posAttr: THREE.BufferAttribute): void {
    // Collect all unmatched (boundary) half-edges
    const unmatched: number[] = [];
    for (let i = 0; i < this.halfEdges.length; i++) {
      if (this.halfEdges[i].twin < 0) {
        unmatched.push(i);
      }
    }

    if (unmatched.length === 0) return;

    // Tolerance for position matching across seams.
    // Cube beveled geometry has vertex offsets of ~0.017 along seams.
    // Widened from 0.05 to 0.15 to handle larger offsets at bevel transitions
    // and UV-grid seams where floating-point accumulation can exceed 0.05.
    const SEAM_TOLERANCE = 0.15;
    const SEAM_TOL_SQ = SEAM_TOLERANCE * SEAM_TOLERANCE;

    // For each unmatched half-edge, pre-compute the world positions of its endpoints.
    // Use the face vertex positions (already in world space) rather than raw buffer
    // positions, since faces store transformed positions.
    const edgeData: { from: THREE.Vector3; to: THREE.Vector3; idx: number }[] = [];
    for (const heIdx of unmatched) {
      const he = this.halfEdges[heIdx];
      const f = this.faces[he.faceIndex];
      const verts = [f.pA, f.pB, f.pC];
      edgeData.push({
        from: verts[he.edgeLocal],
        to: verts[(he.edgeLocal + 1) % 3],
        idx: heIdx,
      });
    }

    // Try to match each unmatched edge with another unmatched edge going
    // in the OPPOSITE direction (twin). An edge from A->B should match
    // an edge from B'->A' where A≈A' and B≈B'.
    let linked = 0;
    for (let i = 0; i < edgeData.length; i++) {
      const ei = edgeData[i];
      if (this.halfEdges[ei.idx].twin >= 0) continue; // Already matched

      for (let j = i + 1; j < edgeData.length; j++) {
        const ej = edgeData[j];
        if (this.halfEdges[ej.idx].twin >= 0) continue; // Already matched

        // Check if ei.from ≈ ej.to AND ei.to ≈ ej.from (opposite direction)
        if (
          ei.from.distanceToSquared(ej.to) < SEAM_TOL_SQ &&
          ei.to.distanceToSquared(ej.from) < SEAM_TOL_SQ
        ) {
          // Also verify they're on different faces (not self-matching)
          if (this.halfEdges[ei.idx].faceIndex !== this.halfEdges[ej.idx].faceIndex) {
            this.halfEdges[ei.idx].twin = ej.idx;
            this.halfEdges[ej.idx].twin = ei.idx;
            linked++;
            break; // Move to next unmatched edge
          }
        }
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
