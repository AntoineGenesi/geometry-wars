/**
 * GeodesicSurface - Integration layer combining HalfEdgeMesh + FaceWalker.
 *
 * This is the single entry point used by MeshSurface to add geodesic walking.
 * It wraps a HalfEdgeMesh and FaceWalker behind a simple API:
 *
 *   - initializePosition(worldPos, faceIndex) -> FacePosition
 *   - moveGeodesic(facePos, directionWorld, distance) -> GeodesicMoveResult
 *
 * MeshSurface still owns the BVH for closest-point queries, raycasting, etc.
 * GeodesicSurface only handles walking.
 */

import * as THREE from 'three';
import { HalfEdgeMesh } from './HalfEdgeMesh';
import { FaceWalker, FacePosition, WalkResult } from './FaceWalker';
import { barycentricToWorld } from './BarycentricUtils';

export interface GeodesicMoveResult {
  /** Final face index */
  faceIndex: number;
  /** Final world-space position on the surface */
  position: THREE.Vector3;
  /** Surface normal at the final position */
  normal: THREE.Vector3;
  /** The parallel-transported direction after the walk */
  direction: THREE.Vector3;
  /** Face position for the next walk call */
  facePosition: FacePosition;
  /** Actual distance traveled */
  distanceTraveled: number;
  /** True if a non-orientable edge (e.g. Mobius seam) was crossed during this walk */
  crossedNonOrientable: boolean;
}

export class GeodesicSurface {
  readonly halfEdge: HalfEdgeMesh;
  readonly faceWalker: FaceWalker;

  constructor(geometry: THREE.BufferGeometry) {
    // Ensure geometry is indexed
    let indexedGeometry = geometry;
    if (!geometry.index) {
      const posCount = geometry.getAttribute('position').count;
      const indices = new Uint32Array(posCount);
      for (let i = 0; i < posCount; i++) indices[i] = i;
      indexedGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
    }

    this.halfEdge = new HalfEdgeMesh(indexedGeometry);
    this.faceWalker = new FaceWalker(this.halfEdge);
  }

  /**
   * Initialize a position on the mesh from a world-space point and BVH face index hint.
   */
  initializePosition(worldPos: THREE.Vector3, faceIndexHint: number): FacePosition {
    return this.faceWalker.locateOnMesh(worldPos, faceIndexHint);
  }

  /**
   * Walk geodesically from a face position in a given world-space direction.
   */
  moveGeodesic(
    facePos: FacePosition,
    directionWorld: THREE.Vector3,
    distance: number,
  ): GeodesicMoveResult {
    const result = this.faceWalker.walk(
      facePos.faceIndex,
      facePos.bary,
      directionWorld,
      distance,
    );

    return {
      faceIndex: result.faceIndex,
      position: result.position,
      normal: result.normal,
      direction: result.direction,
      facePosition: {
        faceIndex: result.faceIndex,
        bary: result.bary,
      },
      distanceTraveled: result.distanceTraveled,
      crossedNonOrientable: result.crossedNonOrientable,
    };
  }

  /**
   * Get the world-space position for a face position.
   */
  getWorldPosition(facePos: FacePosition): THREE.Vector3 {
    const [pA, pB, pC] = this.halfEdge.getFaceVertices(facePos.faceIndex);
    return barycentricToWorld(facePos.bary, pA, pB, pC);
  }

  /**
   * Get the face normal for a face position.
   */
  getNormal(facePos: FacePosition): THREE.Vector3 {
    return this.halfEdge.faces[facePos.faceIndex].normal.clone();
  }
}
