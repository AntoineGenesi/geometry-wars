/**
 * FaceWalker - Core geodesic walk algorithm on a triangle mesh.
 *
 * Tracks position as (faceIndex, barycentric coords) and walks along the surface
 * by computing ray-triangle exits, crossing edges, and parallel-transporting
 * the direction into the next face.
 *
 * This gives true geodesic paths: locally straight lines on the surface that
 * correctly handle curvature, saddle points, and topology.
 *
 * The algorithm:
 * 1. Start at (face, bary) with a world-space direction
 * 2. Convert direction to barycentric delta
 * 3. Find where the ray exits the current triangle
 * 4. If distance remaining, cross the edge into the adjacent face
 * 5. Parallel-transport the direction across the edge
 * 6. Repeat from step 2 with remaining distance
 */

import * as THREE from 'three';
import { HalfEdgeMesh } from './HalfEdgeMesh';
import {
  BaryCoord,
  worldToBarycentric,
  barycentricToWorld,
  rayExitTriangle,
  worldDirToBarycentric,
  clampBarycentric,
  isInsideTriangle,
} from './BarycentricUtils';
import { transportAcrossEdge } from './ParallelTransport';

/** The state of an entity on the mesh surface */
export interface FacePosition {
  faceIndex: number;
  bary: BaryCoord;
}

/** Result of a walk operation */
export interface WalkResult {
  /** Final face index */
  faceIndex: number;
  /** Final barycentric coordinates */
  bary: BaryCoord;
  /** World-space position */
  position: THREE.Vector3;
  /** World-space surface normal at the final position */
  normal: THREE.Vector3;
  /** The transported direction vector (world-space, tangent to surface) */
  direction: THREE.Vector3;
  /** How much distance was actually traveled (may be less than requested if stuck) */
  distanceTraveled: number;
}

const MAX_CROSSINGS = 200;
const _dir3D = new THREE.Vector3();

export class FaceWalker {
  readonly halfEdge: HalfEdgeMesh;

  constructor(halfEdge: HalfEdgeMesh) {
    this.halfEdge = halfEdge;
  }

  /**
   * Walk along the mesh surface from a starting position in a given direction.
   *
   * @param startFace - Starting face index
   * @param startBary - Starting barycentric coordinates within that face
   * @param directionWorld - Movement direction in world space (should be tangent to surface)
   * @param distance - Distance to walk in world units
   * @returns The result of the walk
   */
  walk(
    startFace: number,
    startBary: BaryCoord,
    directionWorld: THREE.Vector3,
    distance: number,
  ): WalkResult {
    if (distance < 1e-8) {
      return this._makeResult(startFace, startBary, directionWorld, 0);
    }

    let currentFace = startFace;
    let currentBary: BaryCoord = { ...startBary };
    let currentDir = directionWorld.clone();
    let remaining = distance;
    let totalTraveled = 0;
    let crossings = 0;

    while (remaining > 1e-8 && crossings < MAX_CROSSINGS) {
      // Get current face vertices
      const [pA, pB, pC] = this.halfEdge.getFaceVertices(currentFace);
      const faceNormal = this.halfEdge.faces[currentFace].normal;

      // Project direction onto face plane (remove normal component)
      const dotN = currentDir.dot(faceNormal);
      _dir3D.copy(currentDir).addScaledVector(faceNormal, -dotN);
      const dirLen = _dir3D.length();
      if (dirLen < 1e-10) {
        // Direction is perpendicular to face - can't move
        break;
      }
      _dir3D.multiplyScalar(1 / dirLen);

      // Convert world direction to barycentric direction
      const baryDir = worldDirToBarycentric(_dir3D, pA, pB, pC);

      // Compute world distance per unit of barycentric parameter t.
      // The world displacement for baryDir * t is t * (dv*(B-A) + dw*(C-A)).
      const worldDisp = new THREE.Vector3()
        .addScaledVector(new THREE.Vector3().subVectors(pB, pA), baryDir.v)
        .addScaledVector(new THREE.Vector3().subVectors(pC, pA), baryDir.w);
      const worldDistPerT = worldDisp.length();

      if (worldDistPerT < 1e-10) {
        break;
      }

      // How much t do we need for the remaining distance?
      const tNeeded = remaining / worldDistPerT;

      // Find where the ray exits the triangle
      const exit = rayExitTriangle(currentBary, baryDir);

      if (!exit || exit.t >= tNeeded) {
        // We can stay within this triangle
        currentBary = {
          u: currentBary.u + tNeeded * baryDir.u,
          v: currentBary.v + tNeeded * baryDir.v,
          w: currentBary.w + tNeeded * baryDir.w,
        };
        // Clamp for numerical safety
        currentBary = clampBarycentric(currentBary);
        totalTraveled += remaining;
        remaining = 0;
        currentDir.copy(_dir3D);
        break;
      }

      // We exit the triangle at parameter exit.t
      const distInThisFace = exit.t * worldDistPerT;
      totalTraveled += distInThisFace;
      remaining -= distInThisFace;

      // Compute the exit barycentric coordinates
      const exitBary: BaryCoord = {
        u: currentBary.u + exit.t * baryDir.u,
        v: currentBary.v + exit.t * baryDir.v,
        w: currentBary.w + exit.t * baryDir.w,
      };

      // Check if we're at or near a vertex (two or more components near zero)
      const eps = 0.05; // Tolerance for vertex detection
      const atVertex =
        (Math.abs(exitBary.u) < eps && Math.abs(exitBary.v) < eps) ||
        (Math.abs(exitBary.v) < eps && Math.abs(exitBary.w) < eps) ||
        (Math.abs(exitBary.w) < eps && Math.abs(exitBary.u) < eps);

      // Map ray-exit edge index to half-edge edge index.
      // rayExitTriangle returns edgeLocal based on which bary component hits zero:
      //   0: u=0 → edge BC (opposite vertex A) → half-edge edge 1 (B→C)
      //   1: v=0 → edge CA (opposite vertex B) → half-edge edge 2 (C→A)
      //   2: w=0 → edge AB (opposite vertex C) → half-edge edge 0 (A→B)
      let heEdgeLocal = (exit.edgeLocal + 1) % 3;

      // When at a vertex, we need to pick the correct edge to cross.
      // The direction vector points toward the adjacent face we want to enter.
      // Choose the edge where crossing it moves us in the direction of the velocity.
      if (atVertex) {
        let bestEdge = heEdgeLocal;
        let bestDot = -Infinity;

        for (let testEdge = 0; testEdge < 3; testEdge++) {
          const he = this.halfEdge.getHalfEdge(currentFace, testEdge);
          if (he.twin < 0) continue; // Skip boundary edges

          // Get the edge midpoint
          const [edgeStart, edgeEnd] = this.halfEdge.getEdgeVertices(currentFace, testEdge);
          const edgeMid = new THREE.Vector3().addVectors(edgeStart, edgeEnd).multiplyScalar(0.5);

          // Get the current position in world space
          const currentPos = barycentricToWorld(exitBary, pA, pB, pC);

          // Direction from current position toward the edge
          const toEdge = edgeMid.clone().sub(currentPos);

          // How much does our movement direction align with going toward this edge?
          const dot = _dir3D.dot(toEdge);

          if (dot > bestDot) {
            bestDot = dot;
            bestEdge = testEdge;
          }
        }

        heEdgeLocal = bestEdge;
      }

      // Get the half-edge we're crossing
      const he = this.halfEdge.getHalfEdge(currentFace, heEdgeLocal);

      if (he.twin < 0) {
        // Boundary edge - reflect direction and stay on current face
        const exitBary: BaryCoord = {
          u: currentBary.u + exit.t * baryDir.u,
          v: currentBary.v + exit.t * baryDir.v,
          w: currentBary.w + exit.t * baryDir.w,
        };
        currentBary = clampBarycentric(exitBary);
        currentDir.copy(this._reflectAtBoundary(_dir3D, currentFace, heEdgeLocal));
        crossings++;
        continue;
      }

      // Get the adjacent face via the twin half-edge
      const twinHe = this.halfEdge.halfEdges[he.twin];
      const adjFace = twinHe.faceIndex;

      // Transport direction across the edge
      const [edgeStart, edgeEnd] = this.halfEdge.getEdgeVertices(currentFace, heEdgeLocal);
      const adjNormal = this.halfEdge.faces[adjFace].normal;

      const transportedDir = _dir3D.clone();
      transportAcrossEdge(transportedDir, edgeStart, edgeEnd, faceNormal, adjNormal);

      // Compute entry barycentric coordinates on the adjacent face.
      // Instead of converting via world position (which fails on sharp folds like cube edges),
      // we use the edge parametric position (alpha) and the twin half-edge's local edge index
      // to directly compute the entry point in the adjacent face's barycentric space.
      const adjBary = this._computeEntryBary(twinHe.edgeLocal, exit.alpha);

      currentFace = adjFace;
      currentBary = adjBary;
      currentDir.copy(transportedDir);
      crossings++;
    }

    return this._makeResult(currentFace, currentBary, currentDir, totalTraveled);
  }

  /**
   * Compute barycentric coordinates for an entry point on a face's edge.
   *
   * When we cross from face A to face B through a shared edge, we know:
   * - The twin half-edge's local edge index in face B (0, 1, or 2)
   * - Alpha: the interpolation parameter along the edge (0..1)
   *
   * Edge local indices map to vertex pairs:
   *   0: vertices A->B (edge AB)
   *   1: vertices B->C (edge BC)
   *   2: vertices C->A (edge CA)
   *
   * But the twin half-edge goes in the OPPOSITE direction along the same geometric edge.
   * So alpha=0 on the source side corresponds to alpha=1 on the twin side.
   *
   * For entry on edge `edgeLocal` at parameter `alpha` (where alpha is already
   * from the SOURCE face's perspective), we flip it for the twin.
   */
  private _computeEntryBary(twinEdgeLocal: number, alpha: number): BaryCoord {
    // The twin half-edge goes the opposite direction, so flip alpha
    const flippedAlpha = 1 - alpha;
    // Nudge entry point away from the edge to avoid immediately re-crossing.
    // This must be larger than the vertex detection epsilon (0.05) to prevent ping-ponging.
    const eps = 0.1;

    // Entry point on the twin's edge: interpolate between the two edge vertices.
    // For edge i of the triangle, the two vertices on that edge have zero bary for
    // the opposite vertex.
    //
    // Edge 0 (A->B): bary = ((1-t), t, 0)  -- w=0
    // Edge 1 (B->C): bary = (0, (1-t), t)  -- u=0
    // Edge 2 (C->A): bary = (t, 0, (1-t))  -- v=0
    //
    // We nudge slightly off the edge to avoid re-triggering the same crossing.
    let u: number, v: number, w: number;

    switch (twinEdgeLocal) {
      case 0: // edge AB, w=0
        u = 1 - flippedAlpha;
        v = flippedAlpha;
        w = eps;
        break;
      case 1: // edge BC, u=0
        u = eps;
        v = 1 - flippedAlpha;
        w = flippedAlpha;
        break;
      case 2: // edge CA, v=0
        u = flippedAlpha;
        v = eps;
        w = 1 - flippedAlpha;
        break;
      default:
        u = 1 / 3;
        v = 1 / 3;
        w = 1 / 3;
    }

    // Renormalize to ensure u+v+w=1
    const sum = u + v + w;
    return { u: u / sum, v: v / sum, w: w / sum };
  }

  /**
   * Find which face contains a given world position (using BVH face index as hint).
   * Returns the face index and barycentric coordinates.
   */
  locateOnMesh(worldPos: THREE.Vector3, hintFaceIndex: number): FacePosition {
    // First try the hint face
    if (hintFaceIndex >= 0 && hintFaceIndex < this.halfEdge.faceCount) {
      const [pA, pB, pC] = this.halfEdge.getFaceVertices(hintFaceIndex);
      const bary = worldToBarycentric(worldPos, pA, pB, pC);
      if (isInsideTriangle(bary, -0.01)) {
        return { faceIndex: hintFaceIndex, bary: clampBarycentric(bary) };
      }
    }

    // Brute-force fallback: find the face whose centroid is closest
    // This is O(n) but only used for initialization, not per-frame
    let bestFace = 0;
    let bestDist = Infinity;
    const centroid = new THREE.Vector3();

    for (let fi = 0; fi < this.halfEdge.faceCount; fi++) {
      const f = this.halfEdge.faces[fi];
      centroid.set(
        (f.pA.x + f.pB.x + f.pC.x) / 3,
        (f.pA.y + f.pB.y + f.pC.y) / 3,
        (f.pA.z + f.pB.z + f.pC.z) / 3,
      );
      const dist = centroid.distanceToSquared(worldPos);
      if (dist < bestDist) {
        bestDist = dist;
        bestFace = fi;
      }
    }

    const [pA, pB, pC] = this.halfEdge.getFaceVertices(bestFace);
    const bary = worldToBarycentric(worldPos, pA, pB, pC);
    return { faceIndex: bestFace, bary: clampBarycentric(bary) };
  }

  /**
   * Reflect a direction at a boundary edge.
   * The direction is mirrored across the edge so the walker bounces back.
   */
  private _reflectAtBoundary(
    dir: THREE.Vector3,
    faceIndex: number,
    edgeLocal: number,
  ): THREE.Vector3 {
    const [edgeStart, edgeEnd] = this.halfEdge.getEdgeVertices(faceIndex, edgeLocal);
    const edgeDir = new THREE.Vector3().subVectors(edgeEnd, edgeStart).normalize();

    // Reflect: r = d - 2*(d.n)*n where n is the edge normal in the face plane
    const faceNormal = this.halfEdge.faces[faceIndex].normal;
    const edgeNormalInPlane = new THREE.Vector3().crossVectors(faceNormal, edgeDir).normalize();

    const reflected = dir.clone();
    const dotEdgeN = reflected.dot(edgeNormalInPlane);
    reflected.addScaledVector(edgeNormalInPlane, -2 * dotEdgeN);

    return reflected;
  }

  /**
   * Build a WalkResult from the current state.
   */
  private _makeResult(
    faceIndex: number,
    bary: BaryCoord,
    direction: THREE.Vector3,
    distanceTraveled: number,
  ): WalkResult {
    const [pA, pB, pC] = this.halfEdge.getFaceVertices(faceIndex);
    const position = barycentricToWorld(bary, pA, pB, pC);
    const normal = this.halfEdge.faces[faceIndex].normal.clone();

    return {
      faceIndex,
      bary: { ...bary },
      position,
      normal,
      direction: direction.clone(),
      distanceTraveled,
    };
  }
}
