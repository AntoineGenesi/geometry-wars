import * as THREE from 'three';
import type { SurfacePoint } from '../surfaces/Surface';

export interface NetworkEnemyFrameState {
  surfaceU: number;
  surfaceV: number;
  wx: number;
  wy: number;
  wz: number;
  nx?: number;
  ny?: number;
  nz?: number;
  tx?: number;
  ty?: number;
  tz?: number;
  bx?: number;
  by?: number;
  bz?: number;
}

export interface EnemyRenderTargetFrame {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
  source: 'server-frame' | 'surface-uv' | 'default';
}

function finiteVector(x: unknown, y: unknown, z: unknown): boolean {
  return typeof x === 'number' && typeof y === 'number' && typeof z === 'number'
    && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

function hasFiniteServerFrame(enemy: NetworkEnemyFrameState): boolean {
  return finiteVector(enemy.nx, enemy.ny, enemy.nz)
    && finiteVector(enemy.tx, enemy.ty, enemy.tz)
    && finiteVector(enemy.bx, enemy.by, enemy.bz);
}

function hasUsableBasis(normal: THREE.Vector3, tangent: THREE.Vector3, bitangent: THREE.Vector3): boolean {
  const minAxisLengthSq = 1e-8;
  if (
    normal.lengthSq() < minAxisLengthSq
    || tangent.lengthSq() < minAxisLengthSq
    || bitangent.lengthSq() < minAxisLengthSq
  ) {
    return false;
  }

  // The three axes must span volume. If the scalar triple product is near zero,
  // makeBasis() would create an edge-on or flattened enemy pose.
  const determinant = tangent.clone().cross(normal).dot(bitangent);
  return Math.abs(determinant) >= 1e-4;
}

/**
 * Resolve the MP enemy render frame.
 *
 * The server's MeshWalker frame is authoritative whenever it is present. UV is
 * only compatibility data and can reconstruct the wrong tunnel/outer frame on
 * sphere-tunnel even when wx/wy/wz is correct.
 */
export function resolveEnemyRenderTargetFrame(
  enemy: NetworkEnemyFrameState,
  fallbackSurfacePoint?: SurfacePoint | null,
): EnemyRenderTargetFrame {
  const position = new THREE.Vector3(enemy.wx, enemy.wy, enemy.wz);

  if (hasFiniteServerFrame(enemy)) {
    const normal = new THREE.Vector3(enemy.nx, enemy.ny, enemy.nz);
    const tangent = new THREE.Vector3(enemy.tx, enemy.ty, enemy.tz);
    const bitangent = new THREE.Vector3(enemy.bx, enemy.by, enemy.bz);
    if (hasUsableBasis(normal, tangent, bitangent)) {
      return { position, normal, tangent, bitangent, source: 'server-frame' };
    }
  }

  if (fallbackSurfacePoint) {
    return {
      position,
      normal: fallbackSurfacePoint.normal.clone(),
      tangent: fallbackSurfacePoint.tangentU.clone(),
      bitangent: fallbackSurfacePoint.tangentV.clone(),
      source: 'surface-uv',
    };
  }

  return {
    position,
    normal: new THREE.Vector3(0, 1, 0),
    tangent: new THREE.Vector3(1, 0, 0),
    bitangent: new THREE.Vector3(0, 0, 1),
    source: 'default',
  };
}
