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
  /** True if a non-orientable edge (e.g. Mobius seam) was crossed during this walk */
  crossedNonOrientable: boolean;
}

const MAX_CROSSINGS = 200;
const _dir3D = new THREE.Vector3();
const _fanTransportTemp = new THREE.Vector3(); // for vertex fan parallel transport

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
    let crossedNonOrientable = false;

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

      // Check if we're at or near a vertex (two or more components near zero).
      // Use a tight tolerance — true vertex exits have bary components near machine
      // epsilon (~1e-15). A loose tolerance (like 0.05) falsely triggers when the
      // player exits an edge very close to a corner (e.g. v=0.004 after normal drift),
      // causing the wrong adjacent face to be selected with a mismatched alpha.
      const eps = 0.001; // Tolerance for vertex detection
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
      //
      // For pole vertices (sphere N/S poles, capsule/pill caps), we also check ALL
      // faces in the vertex fan — not just the 3 edges of the current face. This
      // allows crossing through the pole to the "other side" of the sphere.
      let usedVertexFan = false;

      if (atVertex) {
        let bestEdge = heEdgeLocal;
        let bestDot = -Infinity;

        // Get the vertex's world position (all methods agree since exitBary ≈ vertex)
        const currentPos = barycentricToWorld(exitBary, pA, pB, pC);

        for (let testEdge = 0; testEdge < 3; testEdge++) {
          const he = this.halfEdge.getHalfEdge(currentFace, testEdge);
          if (he.twin < 0) continue; // Skip boundary edges

          // Get the edge midpoint
          const [edgeStart, edgeEnd] = this.halfEdge.getEdgeVertices(currentFace, testEdge);
          const edgeMid = new THREE.Vector3().addVectors(edgeStart, edgeEnd).multiplyScalar(0.5);

          // Direction from current position toward the edge
          const toEdge = edgeMid.sub(currentPos);

          // How much does our movement direction align with going toward this edge?
          const dot = _dir3D.dot(toEdge);

          if (dot > bestDot) {
            bestDot = dot;
            bestEdge = testEdge;
          }
        }

        heEdgeLocal = bestEdge;

        // Vertex fan traversal: check ALL faces adjacent to this vertex.
        // Handles pole singularities where adjacent cap triangles don't share
        // an edge — only a vertex. Without this, the walker circles the pole
        // indefinitely instead of crossing through.
        //
        // Determine which local vertex (A/B/C) of the current face we're at.
        let vertexGlobalIdx: number;
        if (Math.abs(exitBary.v) < eps && Math.abs(exitBary.w) < eps) {
          vertexGlobalIdx = this.halfEdge.faces[currentFace].a; // vertex A (u≈1)
        } else if (Math.abs(exitBary.u) < eps && Math.abs(exitBary.w) < eps) {
          vertexGlobalIdx = this.halfEdge.faces[currentFace].b; // vertex B (v≈1)
        } else {
          vertexGlobalIdx = this.halfEdge.faces[currentFace].c; // vertex C (w≈1)
        }

        const canonicalIdx = this.halfEdge.canonical[vertexGlobalIdx];
        const adjacentFaces = this.halfEdge.vertexToFaces[canonicalIdx];

        // Find the face in the fan with the best alignment to movement direction.
        // Must beat the local edge selection to be used.
        let bestFanFace = -1;
        let bestFanDot = bestDot;

        for (const fi of adjacentFaces) {
          if (fi === currentFace) continue;

          const [fpA, fpB, fpC] = this.halfEdge.getFaceVertices(fi);
          const centroidX = (fpA.x + fpB.x + fpC.x) / 3;
          const centroidY = (fpA.y + fpB.y + fpC.y) / 3;
          const centroidZ = (fpA.z + fpB.z + fpC.z) / 3;
          // Direction from vertex toward face centroid (not normalized, consistent with edge-dot above)
          const toCentX = centroidX - currentPos.x;
          const toCentY = centroidY - currentPos.y;
          const toCentZ = centroidZ - currentPos.z;
          const dot = _dir3D.x * toCentX + _dir3D.y * toCentY + _dir3D.z * toCentZ;

          if (dot > bestFanDot) {
            bestFanDot = dot;
            bestFanFace = fi;
          }
        }

        if (bestFanFace >= 0) {
          // Jump into the target face via the vertex fan.
          // Find which vertex in the target face is the shared pole vertex.
          const f = this.halfEdge.faces[bestFanFace];
          const cA = this.halfEdge.canonical[f.a];
          const cB = this.halfEdge.canonical[f.b];
          const cC = this.halfEdge.canonical[f.c];

          const nudge = 0.005; // same as _computeEntryBary eps — nudge off the vertex
          let eu: number, ev: number, ew: number;
          if (cA === canonicalIdx) {
            eu = 1 - 2 * nudge; ev = nudge; ew = nudge;
          } else if (cB === canonicalIdx) {
            eu = nudge; ev = 1 - 2 * nudge; ew = nudge;
          } else {
            eu = nudge; ev = nudge; ew = 1 - 2 * nudge;
          }
          // Already sums to 1, no normalization needed

          // Transport direction into new face using proper parallel transport.
          // Simple projection (subtract normal component) loses the in-plane rotation
          // information and causes accumulated angular errors near high-valence vertices
          // like sphere poles, visibly curving bullet paths. Proper transport rotates
          // by the dihedral angle (same as edge crossings) to avoid this drift.
          const adjNormal = this.halfEdge.faces[bestFanFace].normal;
          const transportedDir = _dir3D.clone();

          // Try to find a shared edge between currentFace and bestFanFace.
          // Adjacent fan faces share a polar edge → use dihedral-angle rotation.
          // Non-adjacent fan faces (only share the vertex) → rotate by normal rotation.
          let sharedEdgeLocal = -1;
          for (let testEdge = 0; testEdge < 3; testEdge++) {
            const testHe = this.halfEdge.getHalfEdge(currentFace, testEdge);
            if (testHe.twin >= 0 && this.halfEdge.halfEdges[testHe.twin].faceIndex === bestFanFace) {
              sharedEdgeLocal = testEdge;
              break;
            }
          }

          if (sharedEdgeLocal >= 0) {
            // Adjacent faces share an edge — proper dihedral-angle rotation (same as edge crossings)
            const [edgeStart, edgeEnd] = this.halfEdge.getEdgeVertices(currentFace, sharedEdgeLocal);
            transportAcrossEdge(transportedDir, edgeStart, edgeEnd, faceNormal, adjNormal);
          } else {
            // Non-adjacent faces only share the vertex — rotate direction using normal rotation axis.
            // This computes the same dihedral rotation as transportAcrossEdge but uses the
            // cross(n1, n2) axis since there is no specific shared edge to rotate around.
            _fanTransportTemp.crossVectors(faceNormal, adjNormal);
            const sinA = _fanTransportTemp.length();
            if (sinA > 1e-8) {
              _fanTransportTemp.multiplyScalar(1 / sinA);
              const angle = Math.atan2(sinA, faceNormal.dot(adjNormal));
              transportedDir.applyAxisAngle(_fanTransportTemp, angle);
            }
            // Project onto destination face plane to remove numerical drift
            transportedDir.addScaledVector(adjNormal, -transportedDir.dot(adjNormal));
            const transportLen = transportedDir.length();
            if (transportLen > 1e-6) transportedDir.multiplyScalar(1 / transportLen);
          }

          currentFace = bestFanFace;
          currentBary = { u: eu, v: ev, w: ew };
          currentDir.copy(transportedDir);
          crossings++;
          usedVertexFan = true;
        }
      }

      if (usedVertexFan) continue;

      // Get the half-edge we're crossing
      const he = this.halfEdge.getHalfEdge(currentFace, heEdgeLocal);

      if (he.twin < 0) {
        // True boundary edge (e.g., Mobius strip physical edge at v=0/v=1).
        // HalfEdgeMesh._linkSeamEdges now stitches false parameterization-artifact
        // boundaries (cube UV seams, etc.), so remaining twin=-1 edges are genuine
        // geometric boundaries. Reflect the direction so bullets/entities bounce off
        // the strip edge rather than freezing there.
        //
        // REGRESSION GUARD: _linkSeamEdges tolerance=0.15 was widened to fix 18
        // false boundaries on the cube top face. Do NOT revert that without re-testing
        // bullet behavior on the cube and Mobius strip surfaces.
        const reflectedDir = this._reflectAtBoundary(_dir3D, currentFace, heEdgeLocal);

        // Advance to boundary, then nudge slightly inward to prevent immediate
        // re-crossing the same edge on the next step.
        // The zero bary component for heEdgeLocal: 0→w, 1→u, 2→v
        const eps = 0.005;
        const clamped = clampBarycentric(exitBary);
        const zeroIdx = (heEdgeLocal + 2) % 3;
        let nu = clamped.u, nv = clamped.v, nw = clamped.w;
        if (zeroIdx === 0) nu = eps;
        else if (zeroIdx === 1) nv = eps;
        else nw = eps;
        const sum = nu + nv + nw;
        currentBary = { u: nu / sum, v: nv / sum, w: nw / sum };

        currentDir.copy(reflectedDir);
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
      const adjBary = this._computeEntryBary(twinHe.edgeLocal, exit.alpha, !!he.nonOrientable);

      if (he.nonOrientable) crossedNonOrientable = true;

      currentFace = adjFace;
      currentBary = adjBary;
      currentDir.copy(transportedDir);
      crossings++;
    }

    return this._makeResult(currentFace, currentBary, currentDir, totalTraveled, crossedNonOrientable);
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
   * For orientable edges, the twin goes in the OPPOSITE direction along the same
   * geometric edge, so alpha=0 on source corresponds to alpha=1 on twin.
   *
   * For non-orientable edges (Mobius strip seam), the twin goes in the SAME direction,
   * so alpha maps directly without flipping.
   */
  private _computeEntryBary(twinEdgeLocal: number, alpha: number, nonOrientable: boolean = false): BaryCoord {
    // For orientable edges: twin goes opposite direction → flip alpha
    // For non-orientable edges: twin goes same direction → keep alpha
    const flippedAlpha = nonOrientable ? alpha : 1 - alpha;
    // Nudge entry point away from the edge to avoid immediately re-crossing.
    // Must be larger than vertex detection epsilon (0.001) but small enough to not
    // add significant world displacement at each crossing (the displacement per crossing
    // is ~eps/(1+eps)*triangle_height, which at eps=0.1 causes ~0.09 extra per cap crossing
    // and causes oscillation on pill/capsule surfaces). eps=0.005 gives ~0.005*height extra,
    // which is negligible even for large triangles. Must be > vertex_eps (0.001) to prevent
    // vertex detection immediately firing on re-entry.
    const eps = 0.005;

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
    crossedNonOrientable = false,
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
      crossedNonOrientable,
    };
  }
}
