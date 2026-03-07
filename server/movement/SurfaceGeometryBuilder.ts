/**
 * SurfaceGeometryBuilder — Node.js-compatible geometry factory.
 *
 * Generates THREE.BufferGeometry for each surface type used by the game,
 * without importing any browser-specific code (no WebGL, no materials, no DOM).
 *
 * The returned THREE.Mesh has an identity world matrix, so MeshSurface can be
 * constructed from it directly. Scale is applied to vertex positions (not mesh.scale)
 * so the BVH operates in correctly-scaled world space.
 *
 * Geometry parameters match the defaults used by each Surface class in src/surfaces/.
 */

import * as THREE from 'three';

export type SupportedSurface =
  | 'sphere'
  | 'torus'
  | 'cube'
  | 'peanut'
  | 'pill'
  | 'capsule'
  | 'mobius'
  | 'icosahedron'
  | 'sphere-tunnel'
  | 'cube-ring'
  | 'cube-tunnel';

/**
 * Build a THREE.Mesh for the given surface type with optional scale factor.
 * Scale is applied directly to vertex positions so MeshSurface's BVH operates
 * in correctly-scaled world space.
 */
export function buildSurfaceGeometry(
  surfaceType: SupportedSurface,
  scaleFactor: number = 1.0,
): THREE.Mesh {
  const geometry = _createGeometry(surfaceType);

  if (scaleFactor !== 1.0) {
    const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      positions.setXYZ(
        i,
        positions.getX(i) * scaleFactor,
        positions.getY(i) * scaleFactor,
        positions.getZ(i) * scaleFactor,
      );
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  const mesh = new THREE.Mesh(geometry);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function _createGeometry(surfaceType: SupportedSurface): THREE.BufferGeometry {
  switch (surfaceType) {
    case 'sphere':      return _buildSphereGeometry();
    case 'torus':       return _buildTorusGeometry();
    case 'peanut':      return _buildPeanutGeometry();
    case 'cube':        return _buildCubeGeometry();
    case 'pill':        return _buildPillGeometry();
    case 'capsule':     return _buildCapsuleGeometry();
    case 'mobius':      return _buildMobiusGeometry();
    case 'icosahedron': return _buildIcosahedronGeometry();
    case 'sphere-tunnel': return _buildSphereTunnelGeometry();
    case 'cube-ring':   return _buildCubeRingGeometry();
    case 'cube-tunnel': return _buildCubeTunnelGeometry();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPHERE  (matches SphereSurface defaults: radius=10, 40 segments, 40 rings)
// Uses the same small-pole-cap algorithm from SphereSurface._buildSphereGeometry()
// to keep cap triangles small enough for geodesic face-walking.
// ─────────────────────────────────────────────────────────────────────────────
function _buildSphereGeometry(radius = 10, segments = 40, rings = 40): THREE.BufferGeometry {
  const MIN_SIN_PHI = 0.01; // keeps cap triangles ~0.1 world units wide

  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];

  // Vertex 0: top apex
  vertices.push(0, radius, 0);
  normals.push(0, 1, 0);

  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    const rawSinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    const effectiveSinPhi =
      Math.abs(rawSinPhi) < MIN_SIN_PHI
        ? MIN_SIN_PHI * (rawSinPhi >= 0 ? 1 : -1)
        : rawSinPhi;

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);

      vertices.push(
        radius * effectiveSinPhi * cosTheta,
        radius * cosPhi,
        radius * effectiveSinPhi * sinTheta,
      );

      const nx = effectiveSinPhi * cosTheta;
      const ny = cosPhi;
      const nz = effectiveSinPhi * sinTheta;
      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
      normals.push(nx / nLen, ny / nLen, nz / nLen);
    }
  }

  // Last vertex: bottom apex
  vertices.push(0, -radius, 0);
  normals.push(0, -1, 0);

  const topApex = 0;
  const ringStart = (j: number) => 1 + j * (segments + 1);
  const bottomApex = 1 + (rings + 1) * (segments + 1);

  // Fan: top apex → first ring
  for (let i = 0; i < segments; i++) {
    const a = ringStart(0) + i;
    const b = ringStart(0) + i + 1;
    indices.push(topApex, b, a);
  }

  // Quad strips
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = ringStart(j) + i;
      const b = a + 1;
      const c = ringStart(j + 1) + i;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  // Fan: last ring → bottom apex
  for (let i = 0; i < segments; i++) {
    const a = ringStart(rings) + i;
    const b = ringStart(rings) + i + 1;
    indices.push(a, b, bottomApex);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

// ─────────────────────────────────────────────────────────────────────────────
// TORUS  — dimensions MUST match createStandardSurfaceConfig(type, 10, null)
// which passes majorRadius=10*0.8=8, minorRadius=10*0.3=3 to TorusSurface.
// Previous hardcoded (6,2) caused server mesh to be smaller than client visual
// mesh → player appeared inside the torus in MP (s44q-04 root cause).
// Rotated so hole is along Y axis (matching TorusSurface.createMesh()).
// ─────────────────────────────────────────────────────────────────────────────
function _buildTorusGeometry(): THREE.BufferGeometry {
  const geo = new THREE.TorusGeometry(8, 3, 48, 36);
  geo.rotateX(Math.PI / 2);
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// PEANUT  (matches PeanutSurface defaults: baseRadius=6, waistDepth=0.4)
// Exact port of PeanutSurface.createMesh() geometry logic.
// ─────────────────────────────────────────────────────────────────────────────
function _buildPeanutGeometry(
  baseRadius = 6,
  waistDepth = 0.4,
  segments = 64, // gridSegmentsU * 2
  rings = 56,    // gridSegmentsV * 2
): THREE.BufferGeometry {
  const MIN_SIN_PHI = 0.01;

  const geometry = new THREE.BufferGeometry();
  const vertices: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];

  // Vertex 0: top apex
  const rTop = baseRadius * (1 + waistDepth * Math.cos(0));
  vertices.push(0, rTop, 0);
  normals.push(0, 1, 0);

  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    const r = baseRadius * (1 + waistDepth * Math.cos(2 * phi));
    const rawSinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);

    const effectiveSinPhi =
      Math.abs(rawSinPhi) < MIN_SIN_PHI
        ? MIN_SIN_PHI * (rawSinPhi >= 0 ? 1 : -1)
        : rawSinPhi;

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);

      vertices.push(
        r * effectiveSinPhi * cosTheta,
        r * cosPhi,
        r * effectiveSinPhi * sinTheta,
      );

      const n = new THREE.Vector3(
        effectiveSinPhi * cosTheta,
        cosPhi,
        effectiveSinPhi * sinTheta,
      ).normalize();
      normals.push(n.x, n.y, n.z);
    }
  }

  // Last vertex: bottom apex
  const rBot = baseRadius * (1 + waistDepth * Math.cos(2 * Math.PI));
  vertices.push(0, -rBot, 0);
  normals.push(0, -1, 0);

  const topApex = 0;
  const ringStart = (j: number) => 1 + j * (segments + 1);
  const bottomApex = 1 + (rings + 1) * (segments + 1);

  for (let i = 0; i < segments; i++) {
    const a = ringStart(0) + i;
    const b = ringStart(0) + i + 1;
    indices.push(topApex, b, a);
  }

  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segments; i++) {
      const a = ringStart(j) + i;
      const b = a + 1;
      const c = ringStart(j + 1) + i;
      const d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }

  for (let i = 0; i < segments; i++) {
    const a = ringStart(rings) + i;
    const b = ringStart(rings) + i + 1;
    indices.push(a, b, bottomApex);
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

// ─────────────────────────────────────────────────────────────────────────────
// CUBE  (matches CubeSurface defaults: size=18, bevelRadius=2.7, 12 segments)
// Exact port of CubeSurface.createMesh() + getPointLocal() logic.
// ─────────────────────────────────────────────────────────────────────────────

// Face normals and rights for CubeSurface (faceIndex: 0=+Z, 1=+X, 2=-Z, 3=-X)
const _CUBE_FACE_NORMALS = [
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(-1, 0, 0),
] as const;
const _CUBE_FACE_RIGHTS = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1),
] as const;

interface _CubeDerived {
  size: number;
  bevelRadius: number;
  halfSize: number;
  flatHalfSize: number;
  bevelFraction: number;
  flatFraction: number;
}

function _cubeDerived(size: number, bevelRadius: number): _CubeDerived {
  const clampedBevel = Math.min(bevelRadius, size * 0.4);
  const halfSize = size / 2;
  const flatHalfSize = halfSize - clampedBevel;
  const bevelArc = (Math.PI / 2) * clampedBevel;
  const totalHeight = 2 * flatHalfSize + 2 * flatHalfSize + 2 * bevelArc;
  return {
    size,
    bevelRadius: clampedBevel,
    halfSize,
    flatHalfSize,
    bevelFraction: bevelArc / totalHeight,
    flatFraction: flatHalfSize / totalHeight,
  };
}

function _cubeVRegion(
  v: number,
  d: _CubeDerived,
): { type: 'bottomFlat' | 'bottomBevel' | 'middle' | 'topBevel' | 'topFlat'; localT: number } {
  const bf = d.flatFraction;
  const bb = d.flatFraction + d.bevelFraction;
  const tb = 1 - d.flatFraction - d.bevelFraction;
  const tf = 1 - d.flatFraction;

  if (v <= bf) return { type: 'bottomFlat', localT: bf > 0 ? v / bf : 0 };
  if (v <= bb) return { type: 'bottomBevel', localT: bb > bf ? (v - bf) / (bb - bf) : 0 };
  if (v <= tb) return { type: 'middle', localT: tb > bb ? (v - bb) / (tb - bb) : 0.5 };
  if (v <= tf) return { type: 'topBevel', localT: tf > tb ? (v - tb) / (tf - tb) : 0 };
  return { type: 'topFlat', localT: tf < 1 ? (v - tf) / (1 - tf) : 0 };
}

function _cubeURegion(
  u: number,
  d: _CubeDerived,
): { faceIndex: number; type: 'face' | 'bevel'; localS: number } {
  const faceWidth = 2 * d.flatHalfSize;
  const bevelWidth = (Math.PI / 2) * d.bevelRadius;
  const segmentWidth = faceWidth + bevelWidth;
  const totalWidth = 4 * segmentWidth;

  const scaledU = ((u % 1) + 1) % 1;
  const posInTotal = scaledU * totalWidth;
  const segmentIndex = Math.floor(posInTotal / segmentWidth);
  const posInSegment = posInTotal - segmentIndex * segmentWidth;

  if (posInSegment < faceWidth) {
    return { faceIndex: segmentIndex % 4, type: 'face', localS: posInSegment / faceWidth };
  } else {
    return { faceIndex: segmentIndex % 4, type: 'bevel', localS: (posInSegment - faceWidth) / bevelWidth };
  }
}

function _cubePointLocal(u: number, v: number, d: _CubeDerived): { pos: THREE.Vector3; norm: THREE.Vector3 } {
  const { halfSize, flatHalfSize, bevelRadius } = d;
  const vR = _cubeVRegion(v, d);
  const uR = _cubeURegion(u, d);

  const faceNorm = _CUBE_FACE_NORMALS[uR.faceIndex];
  const faceRight = _CUBE_FACE_RIGHTS[uR.faceIndex];
  const nextFaceNorm = _CUBE_FACE_NORMALS[(uR.faceIndex + 1) % 4];
  const nextFaceRight = _CUBE_FACE_RIGHTS[(uR.faceIndex + 1) % 4];

  let pos!: THREE.Vector3;
  let norm!: THREE.Vector3;

  if (vR.type === 'bottomFlat') {
    const y = -halfSize;
    if (uR.type === 'face') {
      const tangentPos = (uR.localS - 0.5) * 2 * flatHalfSize;
      const normalPos = flatHalfSize * vR.localT;
      pos = new THREE.Vector3(faceRight.x * tangentPos + faceNorm.x * normalPos, y, faceRight.z * tangentPos + faceNorm.z * normalPos);
    } else {
      const normalPos = flatHalfSize * vR.localT;
      const x1 = faceRight.x * flatHalfSize + faceNorm.x * normalPos;
      const z1 = faceRight.z * flatHalfSize + faceNorm.z * normalPos;
      const x2 = nextFaceRight.x * (-flatHalfSize) + nextFaceNorm.x * normalPos;
      const z2 = nextFaceRight.z * (-flatHalfSize) + nextFaceNorm.z * normalPos;
      const blendT = (1 - Math.cos(uR.localS * Math.PI)) / 2;
      pos = new THREE.Vector3(x1 * (1 - blendT) + x2 * blendT, y, z1 * (1 - blendT) + z2 * blendT);
    }
    norm = new THREE.Vector3(0, -1, 0);

  } else if (vR.type === 'topFlat') {
    const y = halfSize;
    if (uR.type === 'face') {
      const tangentPos = (uR.localS - 0.5) * 2 * flatHalfSize;
      const normalPos = flatHalfSize * (1 - vR.localT);
      pos = new THREE.Vector3(faceRight.x * tangentPos + faceNorm.x * normalPos, y, faceRight.z * tangentPos + faceNorm.z * normalPos);
    } else {
      const normalPos = flatHalfSize * (1 - vR.localT);
      const x1 = faceRight.x * flatHalfSize + faceNorm.x * normalPos;
      const z1 = faceRight.z * flatHalfSize + faceNorm.z * normalPos;
      const x2 = nextFaceRight.x * (-flatHalfSize) + nextFaceNorm.x * normalPos;
      const z2 = nextFaceRight.z * (-flatHalfSize) + nextFaceNorm.z * normalPos;
      const blendT = (1 - Math.cos(uR.localS * Math.PI)) / 2;
      pos = new THREE.Vector3(x1 * (1 - blendT) + x2 * blendT, y, z1 * (1 - blendT) + z2 * blendT);
    }
    norm = new THREE.Vector3(0, 1, 0);

  } else if (vR.type === 'middle') {
    const y = (vR.localT - 0.5) * 2 * flatHalfSize;
    if (uR.type === 'face') {
      const x = (uR.localS - 0.5) * 2 * flatHalfSize;
      pos = faceNorm.clone().multiplyScalar(halfSize).add(faceRight.clone().multiplyScalar(x)).add(new THREE.Vector3(0, y, 0));
      norm = faceNorm.clone();
    } else {
      const angle = uR.localS * (Math.PI / 2);
      const blendedNormal = faceNorm.clone().multiplyScalar(Math.cos(angle)).add(nextFaceNorm.clone().multiplyScalar(Math.sin(angle)));
      const edgeCenter = faceNorm.clone().multiplyScalar(flatHalfSize).add(nextFaceNorm.clone().multiplyScalar(flatHalfSize));
      pos = edgeCenter.clone().add(blendedNormal.clone().multiplyScalar(bevelRadius)).add(new THREE.Vector3(0, y, 0));
      norm = blendedNormal.clone().normalize();
    }

  } else if (vR.type === 'bottomBevel') {
    const bevelAngle = (1 - vR.localT) * (Math.PI / 2);
    const cosAngle = Math.cos(bevelAngle);
    const sinAngle = Math.sin(bevelAngle);
    const y = -flatHalfSize - bevelRadius * sinAngle;
    if (uR.type === 'face') {
      const x = (uR.localS - 0.5) * 2 * flatHalfSize;
      const distFromCenter = flatHalfSize + bevelRadius * cosAngle;
      pos = faceNorm.clone().multiplyScalar(distFromCenter).add(faceRight.clone().multiplyScalar(x)).add(new THREE.Vector3(0, y, 0));
      norm = faceNorm.clone().multiplyScalar(cosAngle).add(new THREE.Vector3(0, -sinAngle, 0)).normalize();
    } else {
      const hAngle = uR.localS * (Math.PI / 2);
      const blendedHoriz = faceNorm.clone().multiplyScalar(Math.cos(hAngle)).add(nextFaceNorm.clone().multiplyScalar(Math.sin(hAngle))).normalize();
      const cornerCenter = faceNorm.clone().multiplyScalar(flatHalfSize).add(nextFaceNorm.clone().multiplyScalar(flatHalfSize)).add(new THREE.Vector3(0, -flatHalfSize, 0));
      norm = blendedHoriz.clone().multiplyScalar(cosAngle).add(new THREE.Vector3(0, -sinAngle, 0)).normalize();
      pos = cornerCenter.clone().add(norm.clone().multiplyScalar(bevelRadius));
    }

  } else { // topBevel
    const bevelAngle = vR.localT * (Math.PI / 2);
    const cosAngle = Math.cos(bevelAngle);
    const sinAngle = Math.sin(bevelAngle);
    const y = flatHalfSize + bevelRadius * sinAngle;
    if (uR.type === 'face') {
      const x = (uR.localS - 0.5) * 2 * flatHalfSize;
      const distFromCenter = flatHalfSize + bevelRadius * cosAngle;
      pos = faceNorm.clone().multiplyScalar(distFromCenter).add(faceRight.clone().multiplyScalar(x)).add(new THREE.Vector3(0, y, 0));
      norm = faceNorm.clone().multiplyScalar(cosAngle).add(new THREE.Vector3(0, sinAngle, 0)).normalize();
    } else {
      const hAngle = uR.localS * (Math.PI / 2);
      const blendedHoriz = faceNorm.clone().multiplyScalar(Math.cos(hAngle)).add(nextFaceNorm.clone().multiplyScalar(Math.sin(hAngle))).normalize();
      const cornerCenter = faceNorm.clone().multiplyScalar(flatHalfSize).add(nextFaceNorm.clone().multiplyScalar(flatHalfSize)).add(new THREE.Vector3(0, flatHalfSize, 0));
      norm = blendedHoriz.clone().multiplyScalar(cosAngle).add(new THREE.Vector3(0, sinAngle, 0)).normalize();
      pos = cornerCenter.clone().add(norm.clone().multiplyScalar(bevelRadius));
    }
  }

  return { pos, norm };
}

// s44q-04: size MUST match createStandardSurfaceConfig(type, 10, null) → size=10, bevelRadius=0.6.
// Previous default (18, 2.7) was LARGER than client → player floated above cube.
function _buildCubeGeometry(size = 10, bevelRadius = 0.6, gridSegments = 12): THREE.BufferGeometry {
  const d = _cubeDerived(size, bevelRadius);
  const segments = gridSegments * 4;
  const uSegments = segments;
  const vSegments = segments;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= vSegments; j++) {
    for (let i = 0; i <= uSegments; i++) {
      const u = i / uSegments;
      const v = j / vSegments;
      const { pos, norm } = _cubePointLocal(u, v, d);
      positions.push(pos.x, pos.y, pos.z);
      normals.push(norm.x, norm.y, norm.z);
      uvs.push(u, v);
    }
  }

  for (let j = 0; j < vSegments; j++) {
    for (let i = 0; i < uSegments; i++) {
      const a = j * (uSegments + 1) + i;
      const b = a + 1;
      const c = a + uSegments + 1;
      const dd = c + 1;
      indices.push(a, b, c);
      indices.push(b, dd, c);
    }
  }

  // Cap triangles to fill boundary holes at top/bottom flat face corners
  const bottomCenterIdx = positions.length / 3;
  positions.push(0, -d.halfSize, 0);
  normals.push(0, -1, 0);
  uvs.push(0.5, 0);

  const topCenterIdx = positions.length / 3;
  positions.push(0, d.halfSize, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 1);

  for (let i = 0; i < uSegments; i++) {
    const uMid = (i + 0.5) / uSegments;
    const uR = _cubeURegion(uMid, d);
    if (uR.type !== 'bevel') continue;
    const bottomA = i;
    const bottomB = i + 1;
    indices.push(bottomCenterIdx, bottomB, bottomA);
    const topA = vSegments * (uSegments + 1) + i;
    const topB = topA + 1;
    indices.push(topCenterIdx, topA, topB);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// PILL  — dimensions MUST match createStandardSurfaceConfig(type, 10, null)
// which passes radius=10, height=20 to PillSurface.
// Previous hardcoded (4,16) was smaller than client → player inside pill.
// ─────────────────────────────────────────────────────────────────────────────
function _buildPillGeometry(): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(10, 20, 20, 48);
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPSULE  — dimensions MUST match createStandardSurfaceConfig(type, 10, null)
// which passes radius=10 to CapsuleSurface (cylinderHeight defaults to 12).
// Previous hardcoded (4,12) was smaller than client → player inside capsule.
// ─────────────────────────────────────────────────────────────────────────────
function _buildCapsuleGeometry(): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(10, 12, 16, 40);
}

// ─────────────────────────────────────────────────────────────────────────────
// MOBIUS  (matches MobiusSurface defaults: majorRadius=8, stripWidth=3)
// Exact port of MobiusSurface.createMesh() with Mobius twist seam.
// ─────────────────────────────────────────────────────────────────────────────
function _buildMobiusGeometry(majorRadius = 8, stripWidth = 3, segU = 64, segV = 16): THREE.BufferGeometry {
  const R = majorRadius;
  const w = stripWidth;

  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Rows 0..segU-1 only (no duplicate last row — Mobius twist seam uses index reuse)
  for (let i = 0; i < segU; i++) {
    const t = (i / segU) * Math.PI * 2;
    const halfT = t / 2;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    const cosHalfT = Math.cos(halfT);
    const sinHalfT = Math.sin(halfT);

    for (let j = 0; j <= segV; j++) {
      const s = (j / segV - 0.5) * 2 * w;

      vertices.push(
        (R + s * cosHalfT) * cosT,
        (R + s * cosHalfT) * sinT,
        s * sinHalfT,
      );

      const dtX = -s * 0.5 * sinHalfT * cosT - (R + s * cosHalfT) * sinT;
      const dtY = -s * 0.5 * sinHalfT * sinT + (R + s * cosHalfT) * cosT;
      const dtZ = s * 0.5 * cosHalfT;
      const dsX = cosHalfT * cosT;
      const dsY = cosHalfT * sinT;
      const dsZ = sinHalfT;

      const tU = new THREE.Vector3(dtX, dtY, dtZ);
      const tV = new THREE.Vector3(dsX, dsY, dsZ);
      const n = new THREE.Vector3().crossVectors(tU, tV).normalize();
      normals.push(n.x, n.y, n.z);
      uvs.push(i / segU, j / segV);
    }
  }

  // Main body triangles (rows 0..segU-2)
  for (let i = 0; i < segU - 1; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * (segV + 1) + j;
      const b = a + segV + 1;
      const c = a + 1;
      const dd = b + 1;
      indices.push(a, b, c);
      indices.push(b, dd, c);
    }
  }

  // Mobius twist seam: last body row back to first row with v-flip
  const lastBodyRow = (segU - 1) * (segV + 1);
  for (let j = 0; j < segV; j++) {
    const a = lastBodyRow + j;
    const b = 0 + (segV - j);
    const c = lastBodyRow + j + 1;
    const dd = 0 + (segV - j - 1);
    indices.push(a, b, c);
    indices.push(b, dd, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// ICOSAHEDRON  (matches IcosahedronSurface defaults: radius=10, subdivisions=2)
// ─────────────────────────────────────────────────────────────────────────────
function _buildIcosahedronGeometry(): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(10, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// SPHERE-TUNNEL  (matches SphereWithTunnelSurface defaults)
// Exact port of SphereWithTunnelSurface.createMesh() + profileAt() logic.
// ─────────────────────────────────────────────────────────────────────────────
interface _SphereTunnelBevel {
  pe: number; Cr: number; CyTop: number; bAngle: number;
  sArc: number; bArc: number; tLen: number; totalP: number;
}

function _stComputeBevel(R: number, tr: number, bR: number): _SphereTunnelBevel {
  if (bR < 0.001) {
    const ha = Math.asin(tr / R);
    const hLen = R * Math.cos(ha);
    return { pe: ha, Cr: 0, CyTop: 0, bAngle: 0, sArc: (Math.PI - 2 * ha) * R, bArc: 0, tLen: 2 * hLen, totalP: (Math.PI - 2 * ha) * R + 2 * hLen };
  }
  const sinPhiEnd = Math.min((tr + bR) / (R - bR), 0.99);
  const pe = Math.asin(sinPhiEnd);
  const cosPhiEnd = Math.cos(pe);
  const Cr = tr + bR;
  const CyTop = cosPhiEnd * (R - bR);
  const bAngle = Math.PI / 2 + pe;
  const sArc = (Math.PI - 2 * pe) * R;
  const bArc = bR * bAngle;
  const tLen = 2 * CyTop;
  return { pe, Cr, CyTop, bAngle, sArc, bArc, tLen, totalP: sArc + 2 * bArc + tLen };
}

function _stProfileAt(t: number, R: number, tr: number, bR: number, bevel: _SphereTunnelBevel): { r: number; y: number } {
  const { pe, Cr, CyTop, bAngle, sArc, bArc, tLen, totalP } = bevel;
  const pos = ((t % 1) + 1) % 1 * totalP;
  let acc = 0;

  acc += sArc;
  if (pos < acc) {
    const localT = pos / sArc;
    const phi = (Math.PI - pe) - localT * (Math.PI - 2 * pe);
    return { r: R * Math.sin(phi), y: R * Math.cos(phi) };
  }

  if (bR < 0.001) {
    const hLen = R * Math.cos(pe);
    const localT = (pos - acc) / tLen;
    return { r: tr, y: hLen * (1 - 2 * localT) };
  }

  acc += bArc;
  if (pos < acc) {
    const localT = (pos - (acc - bArc)) / bArc;
    const a = (Math.PI / 2 - pe) + localT * bAngle;
    return { r: Cr + bR * Math.cos(a), y: CyTop + bR * Math.sin(a) };
  }

  acc += tLen;
  if (pos < acc) {
    const localT = (pos - (acc - tLen)) / tLen;
    return { r: tr, y: CyTop * (1 - 2 * localT) };
  }

  const localT = (pos - acc) / bArc;
  const a = Math.PI + localT * bAngle;
  return { r: Cr + bR * Math.cos(a), y: -CyTop + bR * Math.sin(a) };
}

// s44q-04: dimensions MUST match createStandardSurfaceConfig(type, 10, null).
// SphereWithTunnelSurface reads config?.radius→10, config?.tunnelRadius→3, config?.bevelRadius→0.6.
// Previous hardcoded (R=8, tr=2) was smaller than client → player inside sphere-tunnel.
function _buildSphereTunnelGeometry(): THREE.BufferGeometry {
  const R = 10, tr = 3, bR = 0.6, gridSegmentsV = 32;
  const bevel = _stComputeBevel(R, tr, bR);

  const radialSegs = Math.max(gridSegmentsV, 32);
  const targetStep = bevel.totalP / radialSegs;
  const ringCircumference = 2 * Math.PI * R;
  const tubularSegs = Math.max(Math.round(ringCircumference / targetStep), 48);

  const positions: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= radialSegs; j++) {
    const v = j / radialSegs;
    const { r: pr, y: py } = _stProfileAt(v, R, tr, bR, bevel);

    for (let i = 0; i <= tubularSegs; i++) {
      const theta = (i / tubularSegs) * Math.PI * 2;
      positions.push(pr * Math.cos(theta), py, pr * Math.sin(theta));
    }
  }

  for (let j = 0; j < radialSegs; j++) {
    for (let i = 0; i < tubularSegs; i++) {
      const a = j * (tubularSegs + 1) + i;
      const b = a + 1;
      const c = (j + 1) * (tubularSegs + 1) + i;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// CUBE-RING  — dimensions from createStandardSurfaceConfig cube-ring override:
// majorRadius=4, crossSection=2. Port of CubeRingSurface.createMesh() + profileAt().
// ─────────────────────────────────────────────────────────────────────────────
function _crProfileAt(t: number, H: number, B: number): { r: number; y: number } {
  const flat = H - B;
  const totalPerimeter = 4 * 2 * flat + 4 * (Math.PI / 2) * B;
  let pos = ((t % 1) + 1) % 1 * totalPerimeter;
  let acc = 0;

  acc += 2 * flat;
  if (pos < acc) {
    const lt = (pos - (acc - 2 * flat)) / (2 * flat);
    return { r: H, y: -flat + lt * 2 * flat };
  }

  const cLen = (Math.PI / 2) * B;
  acc += cLen;
  if (pos < acc) {
    const a = ((pos - (acc - cLen)) / cLen) * (Math.PI / 2);
    return { r: flat + B * Math.cos(a), y: flat + B * Math.sin(a) };
  }

  acc += 2 * flat;
  if (pos < acc) {
    const lt = (pos - (acc - 2 * flat)) / (2 * flat);
    return { r: flat - lt * 2 * flat, y: H };
  }

  acc += cLen;
  if (pos < acc) {
    const a = Math.PI / 2 + ((pos - (acc - cLen)) / cLen) * (Math.PI / 2);
    return { r: -flat + B * Math.cos(a), y: flat + B * Math.sin(a) };
  }

  acc += 2 * flat;
  if (pos < acc) {
    const lt = (pos - (acc - 2 * flat)) / (2 * flat);
    return { r: -H, y: flat - lt * 2 * flat };
  }

  acc += cLen;
  if (pos < acc) {
    const a = Math.PI + ((pos - (acc - cLen)) / cLen) * (Math.PI / 2);
    return { r: -flat + B * Math.cos(a), y: -flat + B * Math.sin(a) };
  }

  acc += 2 * flat;
  if (pos < acc) {
    const lt = (pos - (acc - 2 * flat)) / (2 * flat);
    return { r: -flat + lt * 2 * flat, y: -H };
  }

  const a = (3 * Math.PI) / 2 + ((pos - acc) / cLen) * (Math.PI / 2);
  return { r: flat + B * Math.cos(a), y: -flat + B * Math.sin(a) };
}

// s44q-04: dimensions MUST match createStandardSurfaceConfig(type, 10, null).
// Cube-ring overrides: majorRadius=4, crossSection=2. Previous (6, 3) was bigger → player offset.
function _buildCubeRingGeometry(): THREE.BufferGeometry {
  const majorRadius = 4;
  const halfSide = 1.0; // crossSection=2, halfSide = crossSection/2
  const bevelRadius = 0.4;
  const gridSegmentsV = 24;

  const R = majorRadius;
  const H = halfSide;
  const B = Math.min(bevelRadius, H * 0.95);

  const crossPerimeter = 4 * 2 * (H - B) + 4 * (Math.PI / 2) * B;
  const ringCircumference = 2 * Math.PI * R;
  const radialSegs = Math.max(gridSegmentsV, 24);
  const targetStep = crossPerimeter / radialSegs;
  const tubularSegs = Math.max(Math.round(ringCircumference / targetStep), 48);

  const positions: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= radialSegs; j++) {
    const v = j / radialSegs;
    const profile = _crProfileAt(v, H, B);

    for (let i = 0; i <= tubularSegs; i++) {
      const phi = (i / tubularSegs) * Math.PI * 2;
      positions.push(
        (R + profile.r) * Math.cos(phi),
        profile.y,
        (R + profile.r) * Math.sin(phi),
      );
    }
  }

  for (let j = 0; j < radialSegs; j++) {
    for (let i = 0; i < tubularSegs; i++) {
      const a = j * (tubularSegs + 1) + i;
      const b = a + 1;
      const c = (j + 1) * (tubularSegs + 1) + i;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// CUBE-TUNNEL  (matches CubeWithTunnelSurface defaults: size=20, wallThickness=2.0)
// Exact port of CubeWithTunnelSurface.createMesh() + getPointLocal() chain.
// ─────────────────────────────────────────────────────────────────────────────

// Face normals/rights reused from CubeWithTunnelSurface (same constants)
const _CT_FACE_NORMALS = [
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(-1, 0, 0),
] as const;

interface _CTDerived {
  halfSize: number;
  lipRadius: number;
  wallHeight: number;
  spineHalfSize: number;
  spineFlatHalfSize: number;
  bevelRadius: number;
  outerWallFrac: number;
  lipFrac: number;
}

function _ctDerived(size: number, wallThickness: number, bevelRadius: number): _CTDerived {
  const halfSize = size / 2;
  const lipRadius = wallThickness / 2;
  const wallHeight = halfSize - lipRadius;
  const spineHalfSize = halfSize - lipRadius;
  const spineFlatHalfSize = spineHalfSize - bevelRadius;
  const outerWallLen = 2 * wallHeight;
  const lipLen = Math.PI * lipRadius;
  const totalV = 2 * outerWallLen + 2 * lipLen;
  return {
    halfSize, lipRadius, wallHeight, spineHalfSize, spineFlatHalfSize, bevelRadius,
    outerWallFrac: outerWallLen / totalV,
    lipFrac: lipLen / totalV,
  };
}

function _ctVRegion(
  v: number,
  d: _CTDerived,
): { type: 'outerWall' | 'topLip' | 'innerWall' | 'bottomLip'; localT: number } {
  const vw = ((v % 1) + 1) % 1;
  const owf = d.outerWallFrac;
  const lf = d.lipFrac;

  if (vw < owf) return { type: 'outerWall', localT: owf > 0 ? vw / owf : 0.5 };
  if (vw < owf + lf) return { type: 'topLip', localT: lf > 0 ? (vw - owf) / lf : 0 };
  if (vw < 2 * owf + lf) return { type: 'innerWall', localT: owf > 0 ? (vw - owf - lf) / owf : 0.5 };
  return { type: 'bottomLip', localT: lf > 0 ? (vw - 2 * owf - lf) / lf : 0 };
}

function _ctURegion(
  u: number,
  d: _CTDerived,
): { faceIndex: number; type: 'face' | 'bevel'; localS: number } {
  const faceWidth = 2 * d.spineFlatHalfSize;
  const bevelWidth = (Math.PI / 2) * d.bevelRadius;
  const segmentWidth = faceWidth + bevelWidth;
  const totalWidth = 4 * segmentWidth;

  const scaledU = ((u % 1) + 1) % 1;
  const posInTotal = scaledU * totalWidth;
  const segmentIndex = Math.floor(posInTotal / segmentWidth);
  const posInSegment = posInTotal - segmentIndex * segmentWidth;

  if (posInSegment < faceWidth) {
    return { faceIndex: segmentIndex % 4, type: 'face', localS: faceWidth > 0 ? posInSegment / faceWidth : 0.5 };
  }
  return { faceIndex: segmentIndex % 4, type: 'bevel', localS: bevelWidth > 0 ? (posInSegment - faceWidth) / bevelWidth : 0 };
}

function _ctGetProfile(
  v: number,
  d: _CTDerived,
): { nOffset: number; yOffset: number } {
  const vRegion = _ctVRegion(v, d);
  const lR = d.lipRadius;
  const wH = d.wallHeight;

  switch (vRegion.type) {
    case 'outerWall':
      return { nOffset: lR, yOffset: (2 * vRegion.localT - 1) * wH };
    case 'topLip': {
      const a = vRegion.localT * Math.PI;
      return { nOffset: lR * Math.cos(a), yOffset: wH + lR * Math.sin(a) };
    }
    case 'innerWall':
      return { nOffset: -lR, yOffset: (1 - 2 * vRegion.localT) * wH };
    case 'bottomLip': {
      const a = Math.PI + vRegion.localT * Math.PI;
      return { nOffset: lR * Math.cos(a), yOffset: -wH + lR * Math.sin(a) };
    }
  }
}

function _ctGetSpinePoint(u: number, d: _CTDerived): { position: THREE.Vector3; outward: THREE.Vector3 } {
  const uR = _ctURegion(u, d);
  const fn = _CT_FACE_NORMALS[uR.faceIndex];
  const nextFn = _CT_FACE_NORMALS[(uR.faceIndex + 1) % 4];

  if (uR.type === 'face') {
    // Face right vectors (same as FACE_NORMALS but for right direction)
    // faceRights: 0=(1,0,0), 1=(0,0,-1), 2=(-1,0,0), 3=(0,0,1)
    const faceRights = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
    ];
    const fr = faceRights[uR.faceIndex];
    const x = (uR.localS - 0.5) * 2 * d.spineFlatHalfSize;
    return {
      position: fn.clone().multiplyScalar(d.spineHalfSize).add(fr.clone().multiplyScalar(x)),
      outward: fn.clone(),
    };
  } else {
    const a = uR.localS * (Math.PI / 2);
    const cornerCenter = fn.clone().multiplyScalar(d.spineFlatHalfSize).add(nextFn.clone().multiplyScalar(d.spineFlatHalfSize));
    const blended = fn.clone().multiplyScalar(Math.cos(a)).add(nextFn.clone().multiplyScalar(Math.sin(a)));
    return {
      position: cornerCenter.clone().add(blended.clone().multiplyScalar(d.bevelRadius)),
      outward: blended.clone(),
    };
  }
}

function _ctPointLocal(u: number, v: number, d: _CTDerived): THREE.Vector3 {
  const spine = _ctGetSpinePoint(u, d);
  const profile = _ctGetProfile(v, d);

  return spine.position.clone()
    .add(spine.outward.clone().multiplyScalar(profile.nOffset))
    .add(new THREE.Vector3(0, profile.yOffset, 0));
}

function _buildCubeTunnelGeometry(): THREE.BufferGeometry {
  const size = 20;
  const wallThickness = 2.0;
  const minBevel = wallThickness / 2 + 0.1;
  const bevelRadius = Math.max(size * 0.12, minBevel);
  const gridSegments = 16;
  const d = _ctDerived(size, wallThickness, bevelRadius);

  const segments = gridSegments * 4;
  const uSegs = segments;
  const vSegs = segments;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let j = 0; j <= vSegs; j++) {
    for (let i = 0; i <= uSegs; i++) {
      const u = i / uSegs;
      const v = j / vSegs;
      const pos = _ctPointLocal(u, v, d);
      positions.push(pos.x, pos.y, pos.z);
      normals.push(0, 0, 1); // placeholder — recomputed below
      uvs.push(u, v);
    }
  }

  for (let j = 0; j < vSegs; j++) {
    for (let i = 0; i < uSegs; i++) {
      const a = j * (uSegs + 1) + i;
      const b = a + 1;
      const c = a + uSegs + 1;
      const dd = c + 1;
      indices.push(a, b, c);
      indices.push(b, dd, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals(); // recompute accurate normals from positions
  return geo;
}
