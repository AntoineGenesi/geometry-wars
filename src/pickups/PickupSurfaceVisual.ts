import * as THREE from 'three';
import type {
  SurfaceVisibilityResolver,
  SurfaceVisibilityResult,
} from '../rendering/SurfaceVisibilityResolver';

export interface PickupSurfaceFrame {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
}

export interface PickupSurfacePoseOptions {
  normalOffset: number;
  spinAngle?: number;
}

export interface PickupSurfacePoseState {
  revision: number;
  sourcePosition: [number, number, number];
  sourceNormal: [number, number, number];
  normalOffset: number;
  spinAngle: number;
  appliedQuaternion: [number, number, number, number];
}

export interface ResolvePickupVisibilityOptions {
  resolver: SurfaceVisibilityResolver;
  playerWorldPosition: THREE.Vector3;
  playerFaceIndex?: number;
  pickupWorldPosition: THREE.Vector3;
  pickupMesh: THREE.Group;
  opaqueSurfaces?: boolean;
}

export const PICKUP_OCCLUDED_BODY_FLOOR = 0.35;

const FRAME_EPSILON_SQ = 1e-10;
const _normal = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _rightHandedZ = new THREE.Vector3();
const _fallbackAxis = new THREE.Vector3();
const _surfaceMatrix = new THREE.Matrix4();
const _surfaceQuaternion = new THREE.Quaternion();
const _spinQuaternion = new THREE.Quaternion();
const _localNormalAxis = new THREE.Vector3(0, 1, 0);
const _pickupMaterials = new WeakMap<THREE.Group, Array<{ material: THREE.Material & { opacity: number }; baseOpacity: number }>>();

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

/**
 * Builds the pickup-local frame: X=tangent, Y=normal, Z=tangent x normal.
 * The supplied bitangent is only a recovery input because most surfaces expose
 * it as normal x tangent, which would be left-handed in the X/Y/Z order above.
 */
export function makeRightHandedPickupBasis(
  frame: Pick<PickupSurfaceFrame, 'normal' | 'tangent' | 'bitangent'>,
  target: THREE.Matrix4,
): boolean {
  if (!isFiniteVector(frame.normal)) return false;
  _normal.copy(frame.normal);
  if (_normal.lengthSq() <= FRAME_EPSILON_SQ) return false;
  _normal.normalize();

  if (isFiniteVector(frame.tangent)) {
    _tangent.copy(frame.tangent).addScaledVector(_normal, -frame.tangent.dot(_normal));
  } else {
    _tangent.set(0, 0, 0);
  }

  if (_tangent.lengthSq() <= FRAME_EPSILON_SQ && isFiniteVector(frame.bitangent)) {
    _tangent.crossVectors(frame.bitangent, _normal);
  }

  if (_tangent.lengthSq() <= FRAME_EPSILON_SQ) {
    _fallbackAxis.set(Math.abs(_normal.x) < 0.8 ? 1 : 0, Math.abs(_normal.x) < 0.8 ? 0 : 1, 0);
    _tangent.crossVectors(_fallbackAxis, _normal);
  }

  if (_tangent.lengthSq() <= FRAME_EPSILON_SQ) return false;
  _tangent.normalize();
  _rightHandedZ.crossVectors(_tangent, _normal).normalize();
  target.makeBasis(_tangent, _normal, _rightHandedZ);
  return Number.isFinite(target.determinant()) && target.determinant() > 0;
}

export function applyPickupSurfacePose(
  mesh: THREE.Object3D,
  frame: PickupSurfaceFrame,
  options: PickupSurfacePoseOptions,
): boolean {
  if (!isFiniteVector(frame.position) || !Number.isFinite(options.normalOffset)) return false;
  if (!makeRightHandedPickupBasis(frame, _surfaceMatrix)) return false;

  mesh.position.copy(frame.position).addScaledVector(_normal, options.normalOffset);
  _surfaceQuaternion.setFromRotationMatrix(_surfaceMatrix);
  _spinQuaternion.setFromAxisAngle(
    _localNormalAxis,
    Number.isFinite(options.spinAngle) ? options.spinAngle! : 0,
  );
  mesh.quaternion.copy(_surfaceQuaternion).multiply(_spinQuaternion).normalize();
  mesh.updateMatrix();

  if (!mesh.matrix.elements.every(Number.isFinite) || mesh.matrix.determinant() <= 0) return false;

  const existingState = mesh.userData.pickupSurfacePose as PickupSurfacePoseState | undefined;
  const poseState: PickupSurfacePoseState = existingState ?? {
    revision: 0,
    sourcePosition: [0, 0, 0],
    sourceNormal: [0, 0, 0],
    normalOffset: 0,
    spinAngle: 0,
    appliedQuaternion: [0, 0, 0, 1],
  };
  poseState.revision++;
  frame.position.toArray(poseState.sourcePosition);
  _normal.toArray(poseState.sourceNormal);
  poseState.normalOffset = options.normalOffset;
  poseState.spinAngle = Number.isFinite(options.spinAngle) ? options.spinAngle! : 0;
  mesh.quaternion.toArray(poseState.appliedQuaternion);
  mesh.userData.pickupSurfacePose = poseState;
  return true;
}

export function getPickupBodyVisibility(result: SurfaceVisibilityResult): number {
  if (result.className === 'opaque-hidden') return 0;
  if (result.className === 'direct') return 1;
  return Math.max(PICKUP_OCCLUDED_BODY_FLOOR, result.visibility);
}

function getPickupMaterials(mesh: THREE.Group): Array<{ material: THREE.Material & { opacity: number }; baseOpacity: number }> {
  const cached = _pickupMaterials.get(mesh);
  if (cached) return cached;

  const targets: Array<{ material: THREE.Material & { opacity: number }; baseOpacity: number }> = [];
  const collect = (object: THREE.Object3D): void => {
    if (object.name === 'spawn-indicator') return;
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!('opacity' in material)) continue;
        const opacityMaterial = material as THREE.Material & { opacity: number };
        const baseOpacity = typeof material.userData.baseOpacity === 'number'
          ? material.userData.baseOpacity as number
          : opacityMaterial.opacity;
        material.userData.baseOpacity = baseOpacity;
        targets.push({ material: opacityMaterial, baseOpacity });
      }
    }
    for (const child of object.children) collect(child);
  };
  collect(mesh);
  _pickupMaterials.set(mesh, targets);
  return targets;
}

export function applyPickupBodyVisibility(mesh: THREE.Group, visibility: number): void {
  const ageFactor = THREE.MathUtils.clamp(
    typeof mesh.userData.ageFactor === 'number' ? mesh.userData.ageFactor : 1,
    0,
    1,
  );

  for (const target of getPickupMaterials(mesh)) {
    const authoredFactor = typeof target.material.userData.pickupOpacityFactor === 'number'
      && Number.isFinite(target.material.userData.pickupOpacityFactor)
      ? Math.max(0, target.material.userData.pickupOpacityFactor as number)
      : 1;
    target.material.opacity = target.baseOpacity * authoredFactor * ageFactor * visibility;
  }
}

export function resolveAndApplyPickupVisibility(
  options: ResolvePickupVisibilityOptions,
): SurfaceVisibilityResult {
  const result = options.resolver.resolve({
    playerWorldPosition: options.playerWorldPosition,
    playerFaceIndex: options.playerFaceIndex,
    entityWorldPosition: options.pickupWorldPosition,
    entityKey: options.pickupMesh,
    opaqueSurfaces: options.opaqueSurfaces,
  });
  const bodyVisibility = getPickupBodyVisibility(result);
  options.pickupMesh.userData.surfaceVisibility = result;
  options.pickupMesh.userData.pickupBodyVisibility = bodyVisibility;
  applyPickupBodyVisibility(options.pickupMesh, bodyVisibility);
  return result;
}
