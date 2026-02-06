import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface PeanutConfig extends SurfaceConfig {
  baseRadius?: number
  waistDepth?: number
  gridSegmentsU?: number
  gridSegmentsV?: number
}

/**
 * Peanut/Dumbbell surface: a surface of revolution with profile
 * r(v) = R * (1 - waistDepth * cos(2*phi))
 * where phi = v * PI, creating two bulges connected by a narrow waist.
 */
export class PeanutSurface extends Surface {
  private readonly baseRadius: number
  private readonly waistDepth: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  constructor(config?: PeanutConfig) {
    const baseRadius = config?.baseRadius ?? 6
    const waistDepth = config?.waistDepth ?? 0.4
    const gridSegmentsU = config?.gridSegmentsU ?? 24
    const gridSegmentsV = config?.gridSegmentsV ?? 20

    ;(PeanutSurface as any).__initData = {
      baseRadius,
      waistDepth,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.baseRadius = baseRadius
    this.waistDepth = waistDepth
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Player spawns on the upper bulge of the peanut
    const bulgeRadius = baseRadius * (1 + waistDepth)
    this.surfaceRadius = bulgeRadius
    this.playerLocalPosition = new THREE.Vector3(0, bulgeRadius * 0.7, bulgeRadius * 0.7).normalize().multiplyScalar(bulgeRadius)
  }

  private static getInitData() {
    return (
      (PeanutSurface as any).__initData ?? {
        baseRadius: 6,
        waistDepth: 0.4,
        gridSegmentsU: 24,
        gridSegmentsV: 20,
      }
    )
  }

  /**
   * Profile radius as a function of phi (polar angle).
   * r(phi) = R * (1 - waistDepth * cos(2 * phi))
   * At phi=0 and phi=PI (poles): r = R * (1 - waistDepth) -- smaller
   * At phi=PI/2 (equator): r = R * (1 + waistDepth) -- bulges
   * Wait, actually for a peanut, the bulges should be at the poles and the
   * waist at the equator. So we use:
   * r(phi) = R * (1 - waistDepth * cos(2 * phi))
   * At phi=0: cos(0)=1, r = R*(1 - waistDepth) -- narrow at pole
   * At phi=PI/4: cos(PI/2)=0, r = R -- medium
   * At phi=PI/2: cos(PI)=-1, r = R*(1 + waistDepth) -- widest
   *
   * Actually for a peanut shape we want bulges at top and bottom halves
   * and a pinch at the equator. So:
   * r(phi) = R * (1 + waistDepth * cos(2 * phi))
   * At phi=0: r = R*(1 + waistDepth) -- wide at top
   * At phi=PI/2: r = R*(1 - waistDepth) -- narrow at equator
   * At phi=PI: r = R*(1 + waistDepth) -- wide at bottom
   */
  private profileRadius(phi: number): number {
    return this.baseRadius * (1 + this.waistDepth * Math.cos(2 * phi))
  }

  private profileRadiusDerivative(phi: number): number {
    return this.baseRadius * (-2 * this.waistDepth * Math.sin(2 * phi))
  }

  getPoint(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2  // azimuthal angle
    const phi = v * Math.PI         // polar angle [0, PI]

    const r = this.profileRadius(phi)
    const drDphi = this.profileRadiusDerivative(phi)

    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)

    const position = new THREE.Vector3(
      r * sinPhi * cosTheta,
      r * cosPhi,
      r * sinPhi * sinTheta
    )

    // For surface of revolution, the tangent in theta direction:
    const tangentU = new THREE.Vector3(
      -sinPhi * sinTheta,
      0,
      sinPhi * cosTheta
    ).normalize()

    // Tangent in phi direction: d/dphi of position
    // dx/dphi = drDphi * sinPhi * cosTheta + r * cosPhi * cosTheta
    // dy/dphi = drDphi * cosPhi - r * sinPhi
    // dz/dphi = drDphi * sinPhi * sinTheta + r * cosPhi * sinTheta
    const tangentV = new THREE.Vector3(
      drDphi * sinPhi * cosTheta + r * cosPhi * cosTheta,
      drDphi * cosPhi - r * sinPhi,
      drDphi * sinPhi * sinTheta + r * cosPhi * sinTheta
    ).normalize()

    const normal = tangentU.clone().cross(tangentV).normalize()

    return { position, normal, tangentU, tangentV }
  }

  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    const phi = v * Math.PI
    const sinPhi = Math.sin(phi)
    const correctedDu = sinPhi > 0.001 ? du / sinPhi : 0

    let newU = u + correctedDu
    let newV = v + dv

    // Wrap u
    newU = ((newU % 1) + 1) % 1

    // Clamp v near poles
    const epsilon = 0.01
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    // Approximate: find the closest phi by scanning, then compute theta
    let bestPhi = 0
    let bestDist = Infinity
    const steps = 100

    for (let i = 0; i <= steps; i++) {
      const phi = (i / steps) * Math.PI
      const r = this.profileRadius(phi)
      const ringRadius = r * Math.sin(phi)
      const ringY = r * Math.cos(phi)

      const xzDist = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z)
      const dist = Math.sqrt(
        (xzDist - ringRadius) * (xzDist - ringRadius) +
        (worldPos.y - ringY) * (worldPos.y - ringY)
      )

      if (dist < bestDist) {
        bestDist = dist
        bestPhi = phi
      }
    }

    let theta = Math.atan2(worldPos.z, worldPos.x)
    if (theta < 0) theta += Math.PI * 2

    return {
      u: theta / (Math.PI * 2),
      v: bestPhi / Math.PI,
    }
  }

  createMesh(): THREE.Mesh {
    const { baseRadius, waistDepth, gridSegmentsU, gridSegmentsV } =
      PeanutSurface.getInitData()
    const segments = gridSegmentsU * 2
    const rings = gridSegmentsV * 2

    const geometry = new THREE.BufferGeometry()
    const vertices: number[] = []
    const indices: number[] = []
    const normals: number[] = []

    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * Math.PI
      const r = baseRadius * (1 + waistDepth * Math.cos(2 * phi))
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2
        const cosTheta = Math.cos(theta)
        const sinTheta = Math.sin(theta)

        vertices.push(
          r * sinPhi * cosTheta,
          r * cosPhi,
          r * sinPhi * sinTheta
        )

        // Approximate normal
        const n = new THREE.Vector3(
          sinPhi * cosTheta,
          cosPhi,
          sinPhi * sinTheta
        ).normalize()
        normals.push(n.x, n.y, n.z)
      }
    }

    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segments; i++) {
        const a = j * (segments + 1) + i
        const b = a + 1
        const c = a + (segments + 1)
        const d = c + 1
        indices.push(a, c, b, b, c, d)
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setIndex(indices)

    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { baseRadius, waistDepth, gridSegmentsU, gridSegmentsV } =
      PeanutSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 48

    // Longitude lines (constant theta)
    for (let i = 0; i < gridSegmentsU; i++) {
      const theta = (i / gridSegmentsU) * Math.PI * 2
      const cosTheta = Math.cos(theta)
      const sinTheta = Math.sin(theta)

      for (let j = 0; j < lineDetail; j++) {
        const phi0 = (j / lineDetail) * Math.PI
        const phi1 = ((j + 1) / lineDetail) * Math.PI

        const r0 = baseRadius * (1 + waistDepth * Math.cos(2 * phi0))
        const r1 = baseRadius * (1 + waistDepth * Math.cos(2 * phi1))

        vertices.push(
          r0 * Math.sin(phi0) * cosTheta,
          r0 * Math.cos(phi0),
          r0 * Math.sin(phi0) * sinTheta
        )
        vertices.push(
          r1 * Math.sin(phi1) * cosTheta,
          r1 * Math.cos(phi1),
          r1 * Math.sin(phi1) * sinTheta
        )
      }
    }

    // Latitude lines (constant phi)
    for (let j = 1; j < gridSegmentsV; j++) {
      const phi = (j / gridSegmentsV) * Math.PI
      const r = baseRadius * (1 + waistDepth * Math.cos(2 * phi))
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          r * sinPhi * Math.cos(theta0),
          r * cosPhi,
          r * sinPhi * Math.sin(theta0)
        )
        vertices.push(
          r * sinPhi * Math.cos(theta1),
          r * cosPhi,
          r * sinPhi * Math.sin(theta1)
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
