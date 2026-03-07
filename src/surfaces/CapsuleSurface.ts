import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface CapsuleConfig extends SurfaceConfig {
  radius?: number
  cylinderHeight?: number
  gridSegmentsU?: number
  gridSegmentsV?: number
}

/**
 * Capsule/Pill surface: a cylinder with hemispherical caps on both ends.
 *
 * Parameterization:
 * - u in [0, 1): azimuthal angle theta = u * 2PI (wraps around)
 * - v in [0, 1]:
 *   v in [0, 0.25] -> bottom hemisphere (phi from PI to PI/2)
 *   v in [0.25, 0.75] -> cylinder body
 *   v in [0.75, 1] -> top hemisphere (phi from PI/2 to 0)
 */
export class CapsuleSurface extends Surface {
  private readonly radius: number
  private readonly cylinderHeight: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number
  private readonly halfHeight: number

  constructor(config?: CapsuleConfig) {
    const radius = config?.radius ?? 4
    const cylinderHeight = config?.cylinderHeight ?? 12
    const gridSegmentsU = config?.gridSegmentsU ?? 20
    const gridSegmentsV = config?.gridSegmentsV ?? 16

    ;(CapsuleSurface as any).__initData = {
      radius,
      cylinderHeight,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.radius = radius
    this.cylinderHeight = cylinderHeight
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV
    this.halfHeight = cylinderHeight / 2

    // Player spawns on the side of the capsule (cylinder part)
    this.surfaceRadius = radius
    this.playerLocalPosition = new THREE.Vector3(radius, 0, 0)
  }

  private static getInitData() {
    return (
      (CapsuleSurface as any).__initData ?? {
        radius: 4,
        cylinderHeight: 12,
        gridSegmentsU: 20,
        gridSegmentsV: 16,
      }
    )
  }

  private getRegion(v: number): {
    type: 'bottomCap' | 'cylinder' | 'topCap'
    localT: number
  } {
    if (v <= 0.25) {
      return { type: 'bottomCap', localT: v / 0.25 }
    } else if (v <= 0.75) {
      return { type: 'cylinder', localT: (v - 0.25) / 0.5 }
    } else {
      return { type: 'topCap', localT: (v - 0.75) / 0.25 }
    }
  }

  private getPointLocal(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2
    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)
    const region = this.getRegion(v)
    const r = this.radius

    let position: THREE.Vector3
    let normal: THREE.Vector3
    let tangentV: THREE.Vector3

    const tangentU = new THREE.Vector3(-sinTheta, 0, cosTheta).normalize()

    switch (region.type) {
      case 'bottomCap': {
        // phi goes from PI (bottom pole) to PI/2 (equator)
        const phi = Math.PI - region.localT * (Math.PI / 2)
        const sinPhi = Math.sin(phi)
        const cosPhi = Math.cos(phi)

        position = new THREE.Vector3(
          r * sinPhi * cosTheta,
          -this.halfHeight + r * cosPhi,
          r * sinPhi * sinTheta
        )
        normal = new THREE.Vector3(
          sinPhi * cosTheta,
          cosPhi,
          sinPhi * sinTheta
        ).normalize()
        tangentV = new THREE.Vector3(
          cosPhi * cosTheta,
          -sinPhi,
          cosPhi * sinTheta
        ).normalize()
        break
      }
      case 'cylinder': {
        const y = -this.halfHeight + region.localT * this.cylinderHeight
        position = new THREE.Vector3(r * cosTheta, y, r * sinTheta)
        normal = new THREE.Vector3(cosTheta, 0, sinTheta).normalize()
        tangentV = new THREE.Vector3(0, 1, 0)
        break
      }
      case 'topCap': {
        // phi goes from PI/2 (equator) to 0 (top pole)
        const phi = (Math.PI / 2) * (1 - region.localT)
        const sinPhi = Math.sin(phi)
        const cosPhi = Math.cos(phi)

        position = new THREE.Vector3(
          r * sinPhi * cosTheta,
          this.halfHeight + r * cosPhi,
          r * sinPhi * sinTheta
        )
        normal = new THREE.Vector3(
          sinPhi * cosTheta,
          cosPhi,
          sinPhi * sinTheta
        ).normalize()
        tangentV = new THREE.Vector3(
          -cosPhi * cosTheta,
          sinPhi,
          -cosPhi * sinTheta
        ).normalize()
        break
      }
    }

    return { position: position!, normal: normal!, tangentU, tangentV: tangentV! }
  }

  getPoint(u: number, v: number): SurfacePoint {
    // s44r-04-04 FIX: Apply worldRotation so entity positions are in world space,
    // consistent with bullet positions from MeshWalker (which use mesh.matrixWorld).
    // Without this, enemy positions were in local surface space while bullets were
    // in world space → collision checks fail as the surface rotates.
    return this.applyWorldRotation(this.getPointLocal(u, v))
  }

  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    // Correct du for convergence at caps
    const region = this.getRegion(v)
    let correctedDu = du

    if (region.type === 'bottomCap') {
      const phi = Math.PI - region.localT * (Math.PI / 2)
      const sinPhi = Math.sin(phi)
      correctedDu = sinPhi > 0.001 ? du / sinPhi : 0
    } else if (region.type === 'topCap') {
      const phi = (Math.PI / 2) * (1 - region.localT)
      const sinPhi = Math.sin(phi)
      correctedDu = sinPhi > 0.001 ? du / sinPhi : 0
    }

    let newU = u + correctedDu
    let newV = v + dv

    // Wrap u
    newU = ((newU % 1) + 1) % 1

    // Clamp v
    const epsilon = 0.005
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    let theta = Math.atan2(worldPos.z, worldPos.x)
    if (theta < 0) theta += Math.PI * 2
    const u = theta / (Math.PI * 2)

    const r = this.radius
    let v: number

    if (worldPos.y < -this.halfHeight) {
      // Bottom hemisphere
      const localPos = new THREE.Vector3(
        worldPos.x,
        worldPos.y + this.halfHeight,
        worldPos.z
      )
      const phi = Math.atan2(
        Math.sqrt(localPos.x * localPos.x + localPos.z * localPos.z),
        localPos.y
      )
      // phi from PI (pole) to PI/2 (equator), localT = (PI - phi) / (PI/2)
      const localT = Math.max(0, Math.min(1, (Math.PI - phi) / (Math.PI / 2)))
      v = localT * 0.25
    } else if (worldPos.y > this.halfHeight) {
      // Top hemisphere
      const localPos = new THREE.Vector3(
        worldPos.x,
        worldPos.y - this.halfHeight,
        worldPos.z
      )
      const phi = Math.atan2(
        Math.sqrt(localPos.x * localPos.x + localPos.z * localPos.z),
        localPos.y
      )
      // phi from PI/2 (equator) to 0 (pole), localT = 1 - phi / (PI/2)
      const localT = Math.max(0, Math.min(1, 1 - phi / (Math.PI / 2)))
      v = 0.75 + localT * 0.25
    } else {
      // Cylinder region
      const localT = (worldPos.y + this.halfHeight) / this.cylinderHeight
      v = 0.25 + Math.max(0, Math.min(1, localT)) * 0.5
    }

    return { u, v }
  }

  createMesh(): THREE.Mesh {
    const { radius, cylinderHeight, gridSegmentsU, gridSegmentsV } =
      CapsuleSurface.getInitData()
    const geometry = new THREE.CapsuleGeometry(
      radius,
      cylinderHeight,
      gridSegmentsV,
      gridSegmentsU * 2
    )
    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { radius, cylinderHeight, gridSegmentsU, gridSegmentsV } =
      CapsuleSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 48
    const halfH = cylinderHeight / 2

    // Total v segments: split between caps and cylinder
    const capSegments = Math.max(2, Math.floor(gridSegmentsV / 4))
    const cylSegments = Math.max(2, gridSegmentsV - capSegments * 2)

    // Bottom hemisphere latitude lines
    for (let j = 0; j < capSegments; j++) {
      const t = j / capSegments
      const phi = Math.PI - t * (Math.PI / 2)
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          radius * sinPhi * Math.cos(theta0),
          -halfH + radius * cosPhi,
          radius * sinPhi * Math.sin(theta0)
        )
        vertices.push(
          radius * sinPhi * Math.cos(theta1),
          -halfH + radius * cosPhi,
          radius * sinPhi * Math.sin(theta1)
        )
      }
    }

    // Cylinder ring lines
    for (let j = 0; j <= cylSegments; j++) {
      const y = -halfH + (j / cylSegments) * cylinderHeight

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          radius * Math.cos(theta0), y, radius * Math.sin(theta0),
          radius * Math.cos(theta1), y, radius * Math.sin(theta1)
        )
      }
    }

    // Top hemisphere latitude lines
    for (let j = 1; j <= capSegments; j++) {
      const t = j / capSegments
      const phi = (Math.PI / 2) * (1 - t)
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          radius * sinPhi * Math.cos(theta0),
          halfH + radius * cosPhi,
          radius * sinPhi * Math.sin(theta0)
        )
        vertices.push(
          radius * sinPhi * Math.cos(theta1),
          halfH + radius * cosPhi,
          radius * sinPhi * Math.sin(theta1)
        )
      }
    }

    // Vertical/meridian lines (longitude lines running the full length)
    for (let i = 0; i < gridSegmentsU; i++) {
      const theta = (i / gridSegmentsU) * Math.PI * 2
      const cosTheta = Math.cos(theta)
      const sinTheta = Math.sin(theta)

      // Bottom cap meridian
      for (let j = 0; j < lineDetail / 2; j++) {
        const phi0 = Math.PI - (j / (lineDetail / 2)) * (Math.PI / 2)
        const phi1 = Math.PI - ((j + 1) / (lineDetail / 2)) * (Math.PI / 2)

        vertices.push(
          radius * Math.sin(phi0) * cosTheta,
          -halfH + radius * Math.cos(phi0),
          radius * Math.sin(phi0) * sinTheta
        )
        vertices.push(
          radius * Math.sin(phi1) * cosTheta,
          -halfH + radius * Math.cos(phi1),
          radius * Math.sin(phi1) * sinTheta
        )
      }

      // Cylinder vertical line
      const cylLineSegments = Math.max(1, cylSegments)
      for (let j = 0; j < cylLineSegments; j++) {
        const y0 = -halfH + (j / cylLineSegments) * cylinderHeight
        const y1 = -halfH + ((j + 1) / cylLineSegments) * cylinderHeight

        vertices.push(
          radius * cosTheta, y0, radius * sinTheta,
          radius * cosTheta, y1, radius * sinTheta
        )
      }

      // Top cap meridian
      for (let j = 0; j < lineDetail / 2; j++) {
        const phi0 = (Math.PI / 2) * (1 - j / (lineDetail / 2))
        const phi1 = (Math.PI / 2) * (1 - (j + 1) / (lineDetail / 2))

        vertices.push(
          radius * Math.sin(phi0) * cosTheta,
          halfH + radius * Math.cos(phi0),
          radius * Math.sin(phi0) * sinTheta
        )
        vertices.push(
          radius * Math.sin(phi1) * cosTheta,
          halfH + radius * Math.cos(phi1),
          radius * Math.sin(phi1) * sinTheta
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
