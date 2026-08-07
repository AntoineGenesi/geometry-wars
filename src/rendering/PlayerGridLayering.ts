import * as THREE from 'three';

export const PLAYER_GRID_OCCLUDER_NAME = 'mp-player-grid-occluder';
export const PLAYER_GRID_RENDER_ORDER = 2;

export function createPlayerGridOccluder(): THREE.Sprite | null {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) return null;

  const image = context.createImageData(64, 64);
  const rx = 30;
  const ry = 27;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const nx = (x + 0.5 - 32) / rx;
      const ny = (y + 0.5 - 32) / ry;
      if ((nx * nx) + (ny * ny) > 1) continue;
      const index = (y * 64 + x) * 4;
      image.data[index] = 2;
      image.data[index + 1] = 8;
      image.data[index + 2] = 23;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    alphaTest: 0.5,
    depthTest: false,
    depthWrite: false,
  });
  const occluder = new THREE.Sprite(material);
  occluder.name = PLAYER_GRID_OCCLUDER_NAME;
  occluder.renderOrder = PLAYER_GRID_RENDER_ORDER - 0.1;
  occluder.scale.set(0.68, 0.62, 1);
  return occluder;
}

export function applyPlayerGridLayering(root: THREE.Object3D): void {
  root.renderOrder = PLAYER_GRID_RENDER_ORDER;
  root.traverse((child) => {
    child.renderOrder = PLAYER_GRID_RENDER_ORDER;
    if (!(child instanceof THREE.Mesh) && !(child instanceof THREE.LineSegments)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (!(material instanceof THREE.Material)) continue;
      material.transparent = true;
      material.blending = THREE.NoBlending;
      material.opacity = 1;
      material.depthTest = false;
      material.depthWrite = true;
      material.needsUpdate = true;
    }
  });
}

export function syncPlayerGridOccluder(occluder: THREE.Object3D | null | undefined, playerRoot: THREE.Object3D): void {
  if (!occluder) return;
  occluder.visible = playerRoot.visible;
  occluder.position.copy(playerRoot.position);
}
