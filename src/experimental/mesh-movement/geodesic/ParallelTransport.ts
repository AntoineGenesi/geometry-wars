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
  const cosAngle = normalFrom.dot(normalTo);

  // Cross product of normals gives a vector along the edge (with magnitude = sin(angle))
  _temp.crossVectors(normalFrom, normalTo);
  const sinAngle = _temp.dot(_edgeDir);

  const angle = Math.atan2(sinAngle, cosAngle);

  // Rotate the direction around the edge axis by the negative of the dihedral angle.
  // This "unfolds" the direction from the source plane into the destination plane.
  if (Math.abs(angle) > 1e-8) {
    direction.applyAxisAngle(_edgeDir, -angle);
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
