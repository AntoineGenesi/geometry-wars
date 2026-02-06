import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface CylinderConfig extends SurfaceConfig {
  radius?: number
  height?: number
  gridSegmentsU?: number
  gridSegmentsV?: number
  includeCaps?: boolean
}

export class CylinderSurface extends Surface {
  private readonly radius: number
  private readonly height: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number
  private readonly includeCaps: boolean

  constructor(config?: CylinderConfig) {
    const radius = config?.radius ?? 5
    const height = config?.height ?? 16
    const gridSegmentsU = config?.gridSegmentsU ?? 20
    const gridSegmentsV = config?.gridSegmentsV ?? 10
    const includeCaps = config?.includeCaps ?? false

    ;(CylinderSurface as any).__initData = {
      radius,
      height,
      gridSegmentsU,
      gridSegmentsV,
      includeCaps,
    }
    super(config)

    this.radius = radius
    this.height = height
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV
    this.includeCaps = includeCaps

    // Player spawns on the side of the cylinder, facing outward
    this.surfaceRadius = radius
    this.playerLocalPosition = new THREE.Vector3(radius, 0, 0)
  }

  private static getInitData() {
    return (
      (CylinderSurface as any).__initData ?? {
        radius: 5,
        height: 16,
        gridSegmentsU: 20,
        gridSegmentsV: 10,
        includeCaps: false,
      }
    )
  }

  getPoint(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2
    const y = (v - 0.5) * this.height
    const r = this.radius

    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)

    const position = new THREE.Vector3(
      r * cosTheta,
      y,
      r * sinTheta
    )

    const normal = new THREE.Vector3(cosTheta, 0, sinTheta)

    // Tangent in u direction (around circumference)
    const tangentU = new THREE.Vector3(-sinTheta, 0, cosTheta)

    // Tangent in v direction (along height)
    const tangentV = new THREE.Vector3(0, 1, 0)

    return { position, normal, tangentU, tangentV }
  }

  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    let newU = u + du
    let newV = v + dv

    // Wrap u around [0, 1)
    newU = ((newU % 1) + 1) % 1

    // Clamp v to [0, 1] -- cylinder has ends
    if (!this.includeCaps) {
      newV = Math.max(0, Math.min(1, newV))
    } else {
      newV = Math.max(0, Math.min(1, newV))
    }

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    let theta = Math.atan2(worldPos.z, worldPos.x)
    if (theta < 0) theta += Math.PI * 2

    const u = theta / (Math.PI * 2)
    const v = worldPos.y / this.height + 0.5

    return {
      u,
      v: Math.max(0, Math.min(1, v)),
    }
  }

  createMesh(): THREE.Mesh {
    const { radius, height, gridSegmentsU, gridSegmentsV } =
      CylinderSurface.getInitData()
    const geometry = new THREE.CylinderGeometry(
      radius,
      radius,
      height,
      gridSegmentsU * 2,
      gridSegmentsV * 2,
      true // open-ended for now
    )
    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { radius, height, gridSegmentsU, gridSegmentsV } =
      CylinderSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 32

    // Circumference rings (constant v)
    for (let j = 0; j <= gridSegmentsV; j++) {
      const y = (j / gridSegmentsV - 0.5) * height
      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          radius * Math.cos(theta0), y, radius * Math.sin(theta0),
          radius * Math.cos(theta1), y, radius * Math.sin(theta1)
        )
      }
    }

    // Vertical lines (constant u)
    for (let i = 0; i < gridSegmentsU; i++) {
      const theta = (i / gridSegmentsU) * Math.PI * 2
      const x = radius * Math.cos(theta)
      const z = radius * Math.sin(theta)

      for (let j = 0; j < gridSegmentsV; j++) {
        const y0 = (j / gridSegmentsV - 0.5) * height
        const y1 = ((j + 1) / gridSegmentsV - 0.5) * height

        vertices.push(x, y0, z, x, y1, z)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    )

    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
