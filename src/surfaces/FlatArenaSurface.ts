import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

const ARENA_SIZE = 20 // world units — 20×20 flat plane
const GRID_DIVS = 10

export class FlatArenaSurface extends Surface {
  constructor(config?: SurfaceConfig) {
    super(config)
    this.surfaceRadius = ARENA_SIZE / 2
    // Player stays at the "front" of the surface — for a flat plane this means
    // we place them slightly above center so the camera looks down on the arena.
    this.playerLocalPosition = new THREE.Vector3(0, 1, 0)
  }

  // ---------------------------------------------------------------------------
  // Core surface mapping — UV [0,1]² ↔ world XZ plane
  // ---------------------------------------------------------------------------

  getPoint(u: number, v: number): SurfacePoint {
    const local: SurfacePoint = {
      position: new THREE.Vector3((u - 0.5) * ARENA_SIZE, 0, (v - 0.5) * ARENA_SIZE),
      normal: new THREE.Vector3(0, 1, 0),
      tangentU: new THREE.Vector3(1, 0, 0),
      tangentV: new THREE.Vector3(0, 0, 1),
    }
    return this.applyWorldRotation(local)
  }

  moveOnSurface(u: number, v: number, du: number, dv: number): { u: number; v: number } {
    return {
      u: Math.max(0.01, Math.min(0.99, u + du)),
      v: Math.max(0.01, Math.min(0.99, v + dv)),
    }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    // Inverse the worldRotation to get local-space position, then map to UV
    const inverseRot = this.worldRotation.clone().invert()
    const local = worldPos.clone().applyQuaternion(inverseRot)
    return {
      u: Math.max(0, Math.min(1, local.x / ARENA_SIZE + 0.5)),
      v: Math.max(0, Math.min(1, local.z / ARENA_SIZE + 0.5)),
    }
  }

  // Flat plane: no wrapping in either axis
  override get wrapsU(): boolean { return false }
  override get wrapsV(): boolean { return false }

  override wrapUV(u: number, v: number): { u: number; v: number } {
    const epsilon = 0.005
    return {
      u: Math.max(epsilon, Math.min(1 - epsilon, u)),
      v: Math.max(epsilon, Math.min(1 - epsilon, v)),
    }
  }

  // ---------------------------------------------------------------------------
  // Mesh creation — flat PlaneGeometry in the XZ plane
  // ---------------------------------------------------------------------------

  createMesh(): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(ARENA_SIZE, ARENA_SIZE, GRID_DIVS, GRID_DIVS)
    geo.rotateX(-Math.PI / 2) // lay flat in XZ plane (PlaneGeometry defaults to XY)
    return new THREE.Mesh(geo, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const half = ARENA_SIZE / 2
    const verts: number[] = []
    for (let i = 0; i <= GRID_DIVS; i++) {
      const t = ((i / GRID_DIVS) - 0.5) * ARENA_SIZE
      // Lines parallel to X axis
      verts.push(-half, 0, t, half, 0, t)
      // Lines parallel to Z axis
      verts.push(t, 0, -half, t, 0, half)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    return new THREE.LineSegments(geo, this.createGridMaterial())
  }
}
