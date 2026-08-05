import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Surface, type SurfacePoint } from './Surface';

class TestSurface extends Surface {
  getPoint(_u: number, _v: number): SurfacePoint {
    return {
      position: new THREE.Vector3(0, 0, 1),
      normal: new THREE.Vector3(0, 0, 1),
      tangentU: new THREE.Vector3(1, 0, 0),
      tangentV: new THREE.Vector3(0, 1, 0),
    };
  }

  moveOnSurface(u: number, v: number, du: number, dv: number): { u: number; v: number } {
    return { u: u + du, v: v + dv };
  }

  worldToSurface(_worldPos: THREE.Vector3): { u: number; v: number } {
    return { u: 0.5, v: 0.5 };
  }

  createMesh(): THREE.Mesh {
    return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.createSurfaceMaterial());
  }

  createGrid(): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(1, 0, 0),
    ]);
    return new THREE.LineSegments(geometry, this.createGridMaterial());
  }
}

describe('Surface render layering', () => {
  it('keeps grid lines as a true overlay above depth-writing enemy bodies', () => {
    const surface = new TestSurface();
    const material = surface.gridMesh.material as THREE.LineBasicMaterial;

    expect(surface.mesh.renderOrder).toBe(0);
    expect(surface.gridMesh.renderOrder).toBeGreaterThan(surface.mesh.renderOrder);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
  });
});
