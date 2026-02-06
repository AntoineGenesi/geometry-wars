import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface SphereConfig extends SurfaceConfig {
  radius?: number
  gridSegmentsU?: number
  gridSegmentsV?: number
}

export class SphereSurface extends Surface {
  private readonly radius: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  constructor(config?: SphereConfig) {
    const radius = config?.radius ?? 10
    const gridSegmentsU = config?.gridSegmentsU ?? 20
    const gridSegmentsV = config?.gridSegmentsV ?? 20

    // Store in a temp object since we can't assign before super()
    const self = { radius, gridSegmentsU, gridSegmentsV }
    ;(SphereSurface as any).__initData = self
    super(config)

    this.radius = radius
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Set base class properties for generic rotation system
    this.surfaceRadius = radius
    this.playerLocalPosition = new THREE.Vector3(0, radius, 0) // Top of sphere
  }

  private static getInitData(): {
    radius: number
    gridSegmentsU: number
    gridSegmentsV: number
  } {
    return (
      (SphereSurface as any).__initData ?? {
        radius: 10,
        gridSegmentsU: 20,
        gridSegmentsV: 20,
      }
    )
  }

  /**
   * Get point on sphere in LOCAL coordinates (before world rotation).
   * Used internally for calculations.
   */
  private getPointLocal(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2
    const phi = v * Math.PI
    const r = this.radius

    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    const sinTheta = Math.sin(theta)
    const cosTheta = Math.cos(theta)

    const position = new THREE.Vector3(
      r * sinPhi * cosTheta,
      r * cosPhi,
      r * sinPhi * sinTheta
    )

    const normal = position.clone().normalize()

    // Tangent in u direction (d/dtheta)
    const tangentU = new THREE.Vector3(
      -sinPhi * sinTheta,
      0,
      sinPhi * cosTheta
    ).normalize()

    // Tangent in v direction (d/dphi)
    const tangentV = new THREE.Vector3(
      cosPhi * cosTheta,
      -sinPhi,
      cosPhi * sinTheta
    ).normalize()

    return { position, normal, tangentU, tangentV }
  }

  /**
   * Get point on sphere in WORLD coordinates (after applying world rotation).
   * Uses the base class applyWorldRotation for consistency.
   */
  getPoint(u: number, v: number): SurfacePoint {
    const local = this.getPointLocal(u, v)
    return this.applyWorldRotation(local)
  }

  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    // Scale du by 1/sin(phi) to correct for latitude convergence at poles
    const phi = v * Math.PI
    const sinPhi = Math.sin(phi)
    const correctedDu = sinPhi > 0.001 ? du / sinPhi : 0

    let newU = u + correctedDu
    let newV = v + dv

    // Wrap u around [0, 1)
    newU = ((newU % 1) + 1) % 1

    // Clamp v to [epsilon, 1-epsilon] to avoid pole singularities
    const epsilon = 0.01
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const normalized = worldPos.clone().normalize()

    // phi = acos(y / r), theta = atan2(z, x)
    const phi = Math.acos(
      Math.max(-1, Math.min(1, normalized.y))
    )
    let theta = Math.atan2(normalized.z, normalized.x)
    if (theta < 0) theta += Math.PI * 2

    const u = theta / (Math.PI * 2)
    const v = phi / Math.PI

    return { u, v }
  }

  createMesh(): THREE.Mesh {
    const { radius, gridSegmentsU, gridSegmentsV } =
      SphereSurface.getInitData()
    const geometry = new THREE.SphereGeometry(
      radius,
      gridSegmentsU * 2,
      gridSegmentsV * 2
    )
    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { radius, gridSegmentsU, gridSegmentsV } =
      SphereSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 32

    // Longitude lines (constant theta)
    for (let i = 0; i < gridSegmentsU; i++) {
      const theta = (i / gridSegmentsU) * Math.PI * 2
      for (let j = 0; j < lineDetail; j++) {
        const phi0 = (j / lineDetail) * Math.PI
        const phi1 = ((j + 1) / lineDetail) * Math.PI

        vertices.push(
          radius * Math.sin(phi0) * Math.cos(theta),
          radius * Math.cos(phi0),
          radius * Math.sin(phi0) * Math.sin(theta)
        )
        vertices.push(
          radius * Math.sin(phi1) * Math.cos(theta),
          radius * Math.cos(phi1),
          radius * Math.sin(phi1) * Math.sin(theta)
        )
      }
    }

    // Latitude lines (constant phi)
    for (let j = 1; j < gridSegmentsV; j++) {
      const phi = (j / gridSegmentsV) * Math.PI
      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          radius * Math.sin(phi) * Math.cos(theta0),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta0)
        )
        vertices.push(
          radius * Math.sin(phi) * Math.cos(theta1),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta1)
        )
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
