import * as THREE from 'three';
import { ENEMY_TYPES, EnemySpawner, type EnemyType } from './EnemySpawner';

export const PREVIEW_ENEMY_TYPES: readonly EnemyType[] = ENEMY_TYPES;

const previewTransform = {
  position: new THREE.Vector3(0, 0, 0),
  normal: new THREE.Vector3(0, 0, 1),
  tangent: new THREE.Vector3(1, 0, 0),
  bitangent: new THREE.Vector3(0, 1, 0),
};

function normalizeObjectForPreview(object: THREE.Object3D): void {
  object.visible = true;
  object.position.set(0, 0, 0);
  object.rotation.set(0.65, 0, -0.55);

  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  const scale = 1.45 / maxDim;

  object.position.sub(center);
  object.scale.multiplyScalar(scale);
}

export function createEnemyPreviewObject(type: EnemyType): THREE.Object3D | null {
  const scene = new THREE.Scene();
  const spawner = new EnemySpawner(scene, () => previewTransform);
  const enemy = spawner.spawn(type, 0.5, 0.5, 0, true);
  const object = enemy.mesh;

  if (!object) {
    spawner.clear();
    return null;
  }

  scene.remove(object);
  enemy.mesh = null;
  spawner.clear();

  normalizeObjectForPreview(object);
  return object;
}

export function isPreviewEnemyType(value: string): value is EnemyType {
  return (PREVIEW_ENEMY_TYPES as readonly string[]).includes(value);
}

export function disposePreviewObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const item of material) item.dispose();
    } else if (material) {
      material.dispose();
    }
  });
}
