import * as THREE from 'three';
import type { MeshSurface, TangentFrame } from '../../src/surfaces/MeshSurface';
import type { FacePosition } from '../../src/surfaces/geodesic/FaceWalker';

/**
 * Canonical server-side position on a surface mesh.
 * Face and barycentric coordinates are authoritative; world/frame values are
 * synchronized caches derived from that exact triangle location.
 */
export interface ServerMeshLocation {
  faceIndex: number;
  baryU: number;
  baryV: number;
  baryW: number;
  wx: number; wy: number; wz: number;
  nx: number; ny: number; nz: number;
  tangentX: number; tangentY: number; tangentZ: number;
  bitangentX: number; bitangentY: number; bitangentZ: number;
}

const _point = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _normalMatrix = new THREE.Matrix3();
const _faceA = new THREE.Vector3();
const _faceB = new THREE.Vector3();
const _faceC = new THREE.Vector3();
const _triangle = new THREE.Triangle();
const _closest = new THREE.Vector3();

function assertFacePosition(surface: MeshSurface, facePosition: FacePosition): void {
  const { faceIndex, bary } = facePosition;
  const faceCount = surface.geodesic.halfEdge.faceCount;
  const sum = bary.u + bary.v + bary.w;
  if (!Number.isInteger(faceIndex) || faceIndex < 0 || faceIndex >= faceCount) {
    throw new Error(`Invalid server mesh face index: ${faceIndex}`);
  }
  if (![bary.u, bary.v, bary.w, sum].every(Number.isFinite)
    || bary.u < -1e-5 || bary.v < -1e-5 || bary.w < -1e-5
    || Math.abs(sum - 1) > 1e-4) {
    throw new Error('Invalid server mesh barycentric coordinates');
  }
}

export function toFacePosition(location: ServerMeshLocation): FacePosition {
  return {
    faceIndex: location.faceIndex,
    bary: { u: location.baryU, v: location.baryV, w: location.baryW },
  };
}

/** Reconstruct exact world point and interpolated normal from face coordinates. */
export function resolveServerMeshLocation(
  surface: MeshSurface,
  facePosition: FacePosition,
  outPoint: THREE.Vector3,
  outNormal: THREE.Vector3,
): void {
  assertFacePosition(surface, facePosition);
  const { faceIndex, bary } = facePosition;
  const geometry = surface.mesh.geometry;
  const face = surface.geodesic.halfEdge.faces[faceIndex];

  outPoint.set(0, 0, 0)
    .addScaledVector(face.pA, bary.u)
    .addScaledVector(face.pB, bary.v)
    .addScaledVector(face.pC, bary.w)
    .applyMatrix4(surface.mesh.matrixWorld);

  const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (normalAttr) {
    _faceA.fromBufferAttribute(normalAttr, face.a);
    _faceB.fromBufferAttribute(normalAttr, face.b);
    _faceC.fromBufferAttribute(normalAttr, face.c);
    outNormal.set(0, 0, 0)
      .addScaledVector(_faceA, bary.u)
      .addScaledVector(_faceB, bary.v)
      .addScaledVector(_faceC, bary.w);
  } else {
    outNormal.copy(face.normal);
  }
  _normalMatrix.getNormalMatrix(surface.mesh.matrixWorld);
  outNormal.applyMatrix3(_normalMatrix).normalize();
}

export function createServerMeshLocation(
  surface: MeshSurface,
  facePosition: FacePosition,
  frame?: TangentFrame,
): ServerMeshLocation {
  resolveServerMeshLocation(surface, facePosition, _point, _normal);
  const resolvedFrame = frame ?? surface.getTangentFrame(_normal);
  return {
    faceIndex: facePosition.faceIndex,
    baryU: facePosition.bary.u,
    baryV: facePosition.bary.v,
    baryW: facePosition.bary.w,
    wx: _point.x, wy: _point.y, wz: _point.z,
    nx: resolvedFrame.normal.x, ny: resolvedFrame.normal.y, nz: resolvedFrame.normal.z,
    tangentX: resolvedFrame.tangent.x,
    tangentY: resolvedFrame.tangent.y,
    tangentZ: resolvedFrame.tangent.z,
    bitangentX: resolvedFrame.bitangent.x,
    bitangentY: resolvedFrame.bitangent.y,
    bitangentZ: resolvedFrame.bitangent.z,
  };
}

function faceIntersectsWorldBall(
  surface: MeshSurface,
  faceIndex: number,
  center: THREE.Vector3,
  radiusSq: number,
): boolean {
  const face = surface.geodesic.halfEdge.faces[faceIndex];
  _faceA.copy(face.pA).applyMatrix4(surface.mesh.matrixWorld);
  _faceB.copy(face.pB).applyMatrix4(surface.mesh.matrixWorld);
  _faceC.copy(face.pC).applyMatrix4(surface.mesh.matrixWorld);
  _triangle.set(_faceA, _faceB, _faceC).closestPointToPoint(center, _closest);
  return _closest.distanceToSquared(center) <= radiusSq + 1e-6;
}

function hasCoincidentEndpoints(
  surface: MeshSurface,
  edgeIndex: number,
  twinIndex: number,
): boolean {
  const halfEdge = surface.geodesic.halfEdge;
  const edge = halfEdge.halfEdges[edgeIndex];
  const twin = halfEdge.halfEdges[twinIndex];
  const position = surface.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const distanceSq = (a: number, b: number): number => {
    const dx = position.getX(a) - position.getX(b);
    const dy = position.getY(a) - position.getY(b);
    const dz = position.getZ(a) - position.getZ(b);
    return dx * dx + dy * dy + dz * dz;
  };
  const epsilonSq = 1e-6;
  const reversed = distanceSq(edge.from, twin.to) <= epsilonSq
    && distanceSq(edge.to, twin.from) <= epsilonSq;
  const sameDirection = distanceSq(edge.from, twin.from) <= epsilonSq
    && distanceSq(edge.to, twin.to) <= epsilonSq;
  return reversed || sameDirection;
}

/**
 * True only when candidate lies in the same connected mesh patch inside the
 * portal's visible radius. A nearby folded/opposite wall cannot enter the BFS
 * because it has no half-edge path through the radius-bounded patch.
 */
export function isWithinConnectedSurfacePatch(
  surface: MeshSurface,
  origin: ServerMeshLocation,
  candidate: ServerMeshLocation,
  radius: number,
): boolean {
  if (radius < 0 || !Number.isFinite(radius)) return false;
  const dx = candidate.wx - origin.wx;
  const dy = candidate.wy - origin.wy;
  const dz = candidate.wz - origin.wz;
  const radiusSq = radius * radius;
  if (dx * dx + dy * dy + dz * dz > radiusSq) return false;
  if (candidate.faceIndex === origin.faceIndex) return true;

  const halfEdge = surface.geodesic.halfEdge;
  if (origin.faceIndex < 0 || candidate.faceIndex < 0
    || origin.faceIndex >= halfEdge.faceCount
    || candidate.faceIndex >= halfEdge.faceCount) return false;

  const center = _point.set(origin.wx, origin.wy, origin.wz);
  const visited = new Uint8Array(halfEdge.faceCount);
  const queue: number[] = [origin.faceIndex];
  visited[origin.faceIndex] = 1;

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const faceIndex = queue[cursor];
    const faceEdges = halfEdge.faceHalfEdges[faceIndex];
    for (const edgeIndex of faceEdges) {
      const twinIndex = halfEdge.halfEdges[edgeIndex].twin;
      if (twinIndex < 0) continue;
      // HalfEdgeMesh has a permissive seam matcher for geodesic recovery.
      // Portal trigger topology must not cross its merely-near edge links.
      if (!hasCoincidentEndpoints(surface, edgeIndex, twinIndex)) continue;
      const neighbor = halfEdge.halfEdges[twinIndex].faceIndex;
      if (visited[neighbor]) continue;
      visited[neighbor] = 1;
      if (!faceIntersectsWorldBall(surface, neighbor, center, radiusSq)) continue;
      if (neighbor === candidate.faceIndex) return true;
      queue.push(neighbor);
    }
  }
  return false;
}
