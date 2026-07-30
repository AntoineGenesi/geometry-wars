import * as THREE from 'three';

export function useBasicEnemyMaterials(root: THREE.Object3D, color: THREE.ColorRepresentation): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.material = new THREE.MeshBasicMaterial({ color });
  });
}
