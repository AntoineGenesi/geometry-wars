import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  PLAYER_GRID_RENDER_ORDER,
  applyPlayerGridLayering,
  syncPlayerGridOccluder,
} from './PlayerGridLayering';

describe('PlayerGridLayering', () => {
  it('renders player geometry after the transparent surface grid', () => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x00ffff }),
    );
    const line = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0x00ffff }),
    );
    root.add(mesh, line);

    applyPlayerGridLayering(root);

    expect(root.renderOrder).toBe(PLAYER_GRID_RENDER_ORDER);
    expect(mesh.renderOrder).toBe(PLAYER_GRID_RENDER_ORDER);
    expect(line.renderOrder).toBe(PLAYER_GRID_RENDER_ORDER);

    for (const material of [mesh.material, line.material]) {
      expect(material.transparent).toBe(true);
      expect(material.blending).toBe(THREE.NoBlending);
      expect(material.opacity).toBe(1);
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(true);
    }
  });

  it('syncs the player grid backing to the player root visibility and position', () => {
    const playerRoot = new THREE.Group();
    const occluder = new THREE.Object3D();
    playerRoot.position.set(1, 2, 3);
    playerRoot.visible = false;

    syncPlayerGridOccluder(occluder, playerRoot);

    expect(occluder.visible).toBe(false);
    expect(occluder.position.toArray()).toEqual([1, 2, 3]);
  });
});
