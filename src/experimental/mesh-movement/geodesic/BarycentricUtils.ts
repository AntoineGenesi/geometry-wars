/**
 * BarycentricUtils - Barycentric coordinate math for geodesic face walking.
 *
 * Provides:
 * - World position <-> barycentric conversion
 * - Ray-triangle exit point computation (where does a ray leave a triangle?)
 * - Barycentric clamping and validity checks
 */

import * as THREE from 'three';

/** Barycentric coordinates (u, v, w) where u + v + w = 1 */
export interface BaryCoord {
  u: number;
  v: number;
  w: number;
}

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/**
 * Convert a world-space point to barycentric coordinates within a triangle.
 * Uses the standard dot-product method.
 */
export function worldToBarycentric(
  point: THREE.Vector3,
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  pC: THREE.Vector3,
): BaryCoord {
  _v0.subVectors(pB, pA);
  _v1.subVectors(pC, pA);
  _v2.subVectors(point, pA);

  const d00 = _v0.dot(_v0);
  const d01 = _v0.dot(_v1);
  const d11 = _v1.dot(_v1);
  const d20 = _v2.dot(_v0);
  const d21 = _v2.dot(_v1);

  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-12) {
    // Degenerate triangle
    return { u: 1 / 3, v: 1 / 3, w: 1 / 3 };
  }

  const invDenom = 1 / denom;
  const v = (d11 * d20 - d01 * d21) * invDenom;
  const w = (d00 * d21 - d01 * d20) * invDenom;
  const u = 1 - v - w;

  return { u, v, w };
}

/**
 * Convert barycentric coordinates back to world-space position.
 * P = u*A + v*B + w*C
 */
export function barycentricToWorld(
  bary: BaryCoord,
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  pC: THREE.Vector3,
  out?: THREE.Vector3,
): THREE.Vector3 {
  const result = out ?? new THREE.Vector3();
  return result.set(
    bary.u * pA.x + bary.v * pB.x + bary.w * pC.x,
    bary.u * pA.y + bary.v * pB.y + bary.w * pC.y,
    bary.u * pA.z + bary.v * pB.z + bary.w * pC.z,
  );
}

/**
 * Check if barycentric coordinates are inside the triangle (all >= 0).
 */
export function isInsideTriangle(bary: BaryCoord, eps: number = -1e-8): boolean {
  return bary.u >= eps && bary.v >= eps && bary.w >= eps;
}

/**
 * Find where a 2D ray (in barycentric space) exits a triangle.
 *
 * Given a point inside a triangle (start bary) and a direction (in bary coords),
 * find the parameter t at which the ray exits and which edge it crosses.
 *
 * The direction is a delta in barycentric space: d = (du, dv, dw) with du+dv+dw=0.
 *
 * Returns { t, edgeLocal, alpha } where:
 * - t: parameter along the ray (new_bary = start + t * dir)
 * - edgeLocal: which edge is crossed (0=BC edge where u=0, 1=CA edge where v=0, 2=AB edge where w=0)
 * - alpha: interpolation along the crossed edge (0..1)
 */
export function rayExitTriangle(
  start: BaryCoord,
  dir: BaryCoord,
): { t: number; edgeLocal: number; alpha: number } | null {
  // The ray crosses edge i when bary component i becomes 0.
  // bary_i(t) = start_i + t * dir_i = 0  =>  t = -start_i / dir_i
  // We want the smallest positive t.

  const components = [
    { idx: 0, val: start.u, delta: dir.u },
    { idx: 1, val: start.v, delta: dir.v },
    { idx: 2, val: start.w, delta: dir.w },
  ];

  let bestT = Infinity;
  let bestEdge = -1;

  for (const comp of components) {
    // Only consider if the component is decreasing (delta < 0)
    if (comp.delta < -1e-12) {
      const t = -comp.val / comp.delta;
      if (t > -1e-8 && t < bestT) {
        bestT = t;
        bestEdge = comp.idx;
      }
    }
  }

  if (bestEdge < 0 || !isFinite(bestT)) {
    return null;
  }

  // Compute the barycentric coordinates at the exit point
  const exitU = start.u + bestT * dir.u;
  const exitV = start.v + bestT * dir.v;
  const exitW = start.w + bestT * dir.w;

  // The edge index: when component i=0, the edge is opposite vertex i.
  // Edge 0 (u=0) = edge BC, Edge 1 (v=0) = edge CA, Edge 2 (w=0) = edge AB
  // alpha = position along the edge:
  //   Edge 0 (BC): alpha = exitW / (exitV + exitW) -- fraction toward C
  //   Edge 1 (CA): alpha = exitU / (exitW + exitU) -- fraction toward A
  //   Edge 2 (AB): alpha = exitV / (exitU + exitV) -- fraction toward B
  let alpha: number;
  if (bestEdge === 0) {
    const sum = exitV + exitW;
    alpha = sum > 1e-10 ? exitW / sum : 0.5;
  } else if (bestEdge === 1) {
    const sum = exitW + exitU;
    alpha = sum > 1e-10 ? exitU / sum : 0.5;
  } else {
    const sum = exitU + exitV;
    alpha = sum > 1e-10 ? exitV / sum : 0.5;
  }

  return { t: bestT, edgeLocal: bestEdge, alpha };
}

/**
 * Convert a world-space 3D direction vector to a barycentric direction.
 *
 * A barycentric direction (du, dv, dw) satisfies du + dv + dw = 0.
 * It represents the change in barycentric coordinates per unit of movement.
 *
 * We compute it by projecting: if P moves by dir in world space,
 * what is the change in (u, v, w)?
 */
export function worldDirToBarycentric(
  dir: THREE.Vector3,
  pA: THREE.Vector3,
  pB: THREE.Vector3,
  pC: THREE.Vector3,
): BaryCoord {
  // The shifted point P + dir has barycentric coords relative to ABC.
  // The difference from center bary is our direction.
  // We use: bary(P+dir) - bary(P) where P is some reference.
  // Since bary is linear, we can pick P = centroid and just compute bary(centroid + dir) - (1/3, 1/3, 1/3).
  // Even simpler: bary is linear, so bary(P+dir) - bary(P) = bary_of_dir_from_origin.
  // That is, compute bary as if the triangle were at A, B, C and the "point" is dir + A.
  // Actually, the cleanest approach: the barycentric gradient.
  // d_u/dx = gradient_u dot dir, etc.

  // Use the inverse of the triangle basis.
  // P = u*A + v*B + w*C, with u = 1-v-w
  // P = A + v*(B-A) + w*(C-A)
  // P - A = v*e0 + w*e1  where e0=B-A, e1=C-A
  // So (v,w) = inverse([e0, e1]) * (P-A)
  // And dv/dP, dw/dP are the rows of the inverse.

  const e0 = _v0.subVectors(pB, pA);
  const e1 = _v1.subVectors(pC, pA);

  // For 3D, we project onto the face plane.
  // Using the pseudoinverse: [e0,e1]^T * [e0,e1] is 2x2.
  const d00 = e0.dot(e0);
  const d01 = e0.dot(e1);
  const d11 = e1.dot(e1);
  const det = d00 * d11 - d01 * d01;

  if (Math.abs(det) < 1e-12) {
    return { u: 0, v: 0, w: 0 };
  }

  const invDet = 1 / det;

  // dv = (d11 * e0.dot(dir) - d01 * e1.dot(dir)) * invDet
  // dw = (d00 * e1.dot(dir) - d01 * e0.dot(dir)) * invDet
  const dirDotE0 = dir.dot(e0);
  const dirDotE1 = dir.dot(e1);

  const dv = (d11 * dirDotE0 - d01 * dirDotE1) * invDet;
  const dw = (d00 * dirDotE1 - d01 * dirDotE0) * invDet;
  const du = -dv - dw; // du + dv + dw = 0

  return { u: du, v: dv, w: dw };
}

/**
 * Clamp barycentric coordinates to be inside the triangle.
 * Projects onto the nearest edge or vertex.
 */
export function clampBarycentric(bary: BaryCoord): BaryCoord {
  let u = Math.max(0, bary.u);
  let v = Math.max(0, bary.v);
  let w = Math.max(0, bary.w);
  const sum = u + v + w;
  if (sum < 1e-10) {
    return { u: 1 / 3, v: 1 / 3, w: 1 / 3 };
  }
  const invSum = 1 / sum;
  return { u: u * invSum, v: v * invSum, w: w * invSum };
}
