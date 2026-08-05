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
  const materials = new Set<THREE.Material>();
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
    cached.filter(Boolean).forEach((material) => materials.add(material));
  }

  enemy.mesh?.traverse((child) => {
    const materialOrMaterials = (child as { material?: THREE.Material | THREE.Material[] }).material;
    if (!materialOrMaterials) return;
    const childMaterials = Array.isArray(materialOrMaterials) ? materialOrMaterials : [materialOrMaterials];
    childMaterials.filter(Boolean).forEach((material) => materials.add(material));
  });
  materials.forEach(apply);
  return applied;
}
