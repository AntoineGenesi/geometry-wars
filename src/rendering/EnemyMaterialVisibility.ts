import * as THREE from 'three';

export interface NonInstancedEnemyVisual {
  mesh: THREE.Object3D | null;
  cachedMaterials: THREE.Material[] | null;
}

/** Apply the resolver's final visibility to mesh-rendered enemy materials. */
export function applyNonInstancedEnemyVisibility(
  enemy: NonInstancedEnemyVisual,
  visibility: number,
): number {
  const resolvedVisibility = Number.isFinite(visibility)
    ? THREE.MathUtils.clamp(visibility, 0, 1)
    : 1;
  const cached = enemy.cachedMaterials;
  let applied = 0;

  const apply = (material: THREE.Material): void => {
    if (!material.transparent) {
      material.transparent = true;
      material.needsUpdate = true;
    }
    material.opacity = resolvedVisibility;
    applied++;
  };

  if (cached && cached.length > 0) {
    cached.forEach(apply);
    return applied;
  }

  enemy.mesh?.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.filter(Boolean).forEach(apply);
  });
  return applied;
}
