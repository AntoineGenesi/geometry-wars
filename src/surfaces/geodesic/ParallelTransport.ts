/**
 * ParallelTransport - Transport a direction vector across a mesh edge.
 *
 * When a geodesic path crosses from face F1 to face F2 across a shared edge,
 * the direction vector must be "unfolded" into the new face's plane.
 * This is equivalent to rotating the direction by the dihedral angle between
 * the two faces around the shared edge axis.
 *
 * This gives true parallel transport along a geodesic, which is what makes
 * a path a geodesic (locally straight) rather than just any curve on the surface.
 */

import * as THREE from 'three';

const _edgeDir = new THREE.Vector3();
const _temp = new THREE.Vector3();

/**
 * Transport a direction vector from one face to an adjacent face across a shared edge.
 *
 * The direction is rotated around the shared edge axis by the dihedral angle
 * between the two face normals. This "unfolds" the direction into the new plane.
 *
 * @param direction - The direction vector in the source face's plane (mutated in place)
 * @param edgeStart - Start vertex of the shared edge
 * @param edgeEnd - End vertex of the shared edge
 * @param normalFrom - Normal of the source face
 * @param normalTo - Normal of the destination face
 * @returns The transported direction (same reference as `direction`, mutated)
 */
export function transportAcrossEdge(
  direction: THREE.Vector3,
  edgeStart: THREE.Vector3,
  edgeEnd: THREE.Vector3,
  normalFrom: THREE.Vector3,
  normalTo: THREE.Vector3,
): THREE.Vector3 {
  // Edge direction (rotation axis)
  _edgeDir.subVectors(edgeEnd, edgeStart);
  const edgeLen = _edgeDir.length();
  if (edgeLen < 1e-10) return direction;
  _edgeDir.multiplyScalar(1 / edgeLen);

  // Compute the dihedral angle between the two faces.
  // The dihedral angle is the angle between the normals, measured around the edge.
  // We use atan2 with the signed cross product to get the correct sign.
  let cosAngle = normalFrom.dot(normalTo);

  // Handle non-orientable surfaces (e.g., Mobius strip seam):
  // If normals are nearly opposite (dihedral > 120°), the faces are actually nearly
  // coplanar but with inconsistent winding order. Use the flipped normal to compute
  // the correct (small) transport angle instead of the erroneous ~180° rotation.
  let effectiveNormalTo = normalTo;
  if (cosAngle < -0.5) {
    effectiveNormalTo = normalTo.clone().negate();
    cosAngle = normalFrom.dot(effectiveNormalTo);
  }

  // Cross product of normals gives a vector along the edge (with magnitude = sin(angle))
  _temp.crossVectors(normalFrom, effectiveNormalTo);
  const sinAngle = _temp.dot(_edgeDir);

  const angle = Math.atan2(sinAngle, cosAngle);

  // Rotate the direction around the edge axis by the dihedral angle.
  // This parallel-transports the direction from the source plane into the destination plane.
  //
  // The angle α = atan2(cross(n1,n2)·e, n1·n2) is the rotation that takes n1 to n2 around e.
  // Parallel transport applies this same rotation to the direction vector so that geodesic
  // paths stay locally straight across the fold (unfolding interpretation: a straight path
  // in the "unrolled" surface maps to the SAME rotation, not its inverse).
  //
  // Note: applying -angle (the inverse rotation) was wrong — it caused bullet directions to
  // rotate 90° the wrong way at cube face boundaries, making bullets follow edges.
  // REGRESSION GUARD: do NOT revert to -angle without verifying bullet trajectories on cube.
  if (Math.abs(angle) > 1e-8) {
    direction.applyAxisAngle(_edgeDir, angle);
  }

  // Project onto the destination face plane to remove any numerical drift
  const dot = direction.dot(normalTo);
  direction.addScaledVector(normalTo, -dot);

  const len = direction.length();
  if (len > 1e-10) {
    direction.multiplyScalar(1 / len);
  }

  return direction;
}

/**
 * Compute the dihedral angle between two faces sharing an edge.
 * Positive when the faces are convex (fold outward), negative when concave.
 */
export function dihedralAngle(
  edgeStart: THREE.Vector3,
  edgeEnd: THREE.Vector3,
  normalFrom: THREE.Vector3,
  normalTo: THREE.Vector3,
): number {
  _edgeDir.subVectors(edgeEnd, edgeStart).normalize();
  const cosAngle = normalFrom.dot(normalTo);
  _temp.crossVectors(normalFrom, normalTo);
  const sinAngle = _temp.dot(_edgeDir);
  return Math.atan2(sinAngle, cosAngle);
}
