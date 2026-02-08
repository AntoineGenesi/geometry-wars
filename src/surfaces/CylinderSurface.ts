import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface CylinderConfig extends SurfaceConfig {
  radius?: number          // Cylinder radius (default 4)
  height?: number          // Cylinder body height, excluding caps (default 16)
  gridSegmentsU?: number   // Segments around circumference (default 24)
  gridSegmentsV?: number   // Segments along height (default 20)
}

/**
 * Cylinder Surface: a cylinder with hemispherical caps on both ends.
 *
 * The cylinder is elongated (height > diameter) and oriented along the Y axis.
 * Players can move freely around the circumference (wrapping) and along the
 * height, traversing over the hemispherical end caps.
 *
 * UV mapping:
 *   u: [0, 1) azimuthal angle around circumference (wraps)
 *   v: [0, 1] position along height (clamped near poles)
 *     v=0:           bottom pole
 *     v=capFrac:     bottom of cylinder body
 *     v=1-capFrac:   top of cylinder body
 *     v=1:           top pole
 *
 * Cap geometry:
 *   Each cap is a quarter-sphere (hemisphere) of the same radius as the cylinder,
 *   centered at +/-halfHeight on the Y axis. The cap sweeps from the body junction
 *   (equator, phi=PI/2) to the pole (phi=0 or PI), fully closing both ends.
 */
export class CylinderSurface extends Surface {
  private readonly radius: number
  private readonly height: number
  private readonly halfHeight: number
  private readonly capFraction: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  constructor(config?: CylinderConfig) {
    const radius = config?.radius ?? 4
    const height = config?.height ?? 16
    const gridSegmentsU = config?.gridSegmentsU ?? 24
    const gridSegmentsV = config?.gridSegmentsV ?? 20

    ;(CylinderSurface as any).__initData = {
      radius,
      height,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.radius = radius
    this.height = height
    this.halfHeight = height / 2
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Cap arc length = PI/2 * radius (quarter-circle of full radius).
    // Total v-length = height + 2 * cap arc.
    const capArc = (Math.PI / 2) * radius
    const totalVLength = height + 2 * capArc
    this.capFraction = capArc / totalVLength

    this.surfaceRadius = radius
    this.playerLocalPosition = new THREE.Vector3(radius, 0, 0)
  }

  private static getInitData(): {
    radius: number
    height: number
    gridSegmentsU: number
    gridSegmentsV: number
  } {
    return (
      (CylinderSurface as any).__initData ?? {
        radius: 4,
        height: 16,
        gridSegmentsU: 24,
        gridSegmentsV: 20,
      }
    )
  }

  /**
   * Decompose v into region and local parameter.
   *   Bottom cap: v in [0, capFraction]               localT 0..1
   *   Cylinder body: v in [capFraction, 1-capFraction] localT 0..1
   *   Top cap: v in [1-capFraction, 1]                localT 0..1
   */
  private getRegion(v: number): {
    type: 'bottomCap' | 'body' | 'topCap'
    localT: number
  } {
    const cf = this.capFraction
    if (v <= cf) {
      return { type: 'bottomCap', localT: cf > 0 ? v / cf : 1 }
    } else if (v >= 1 - cf) {
      return { type: 'topCap', localT: cf > 0 ? (v - (1 - cf)) / cf : 1 }
    } else {
      const bodyRange = 1 - 2 * cf
      return { type: 'body', localT: bodyRange > 0 ? (v - cf) / bodyRange : 0.5 }
    }
  }

  getPoint(u: number, v: number): SurfacePoint {
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
        // Hemisphere cap at the bottom end.
        // phi goes from PI (bottom pole, localT=0) to PI/2 (equator/body junction, localT=1).
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

      case 'body': {
        const y = -this.halfHeight + region.localT * this.height
        position = new THREE.Vector3(r * cosTheta, y, r * sinTheta)
        normal = new THREE.Vector3(cosTheta, 0, sinTheta).normalize()
        tangentV = new THREE.Vector3(0, 1, 0)
        break
      }

      case 'topCap': {
        // Hemisphere cap at the top end.
        // phi goes from PI/2 (equator/body junction, localT=0) to 0 (top pole, localT=1).
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

  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    const region = this.getRegion(v)
    let correctedDu = du

    // On the caps, circumference shrinks toward poles -- correct du for convergence
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

    // u wraps (circumference is periodic)
    newU = ((newU % 1) + 1) % 1

    // v is clamped near poles (avoid singularity at exact pole)
    const epsilon = 0.005
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    let theta = Math.atan2(worldPos.z, worldPos.x)
    if (theta < 0) theta += Math.PI * 2
    const u = theta / (Math.PI * 2)

    const r = this.radius
    const cf = this.capFraction

    if (worldPos.y < -this.halfHeight) {
      // Bottom hemisphere cap
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
      return { u, v: localT * cf }
    } else if (worldPos.y > this.halfHeight) {
      // Top hemisphere cap
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
      return { u, v: (1 - cf) + localT * cf }
    } else {
      // Cylinder body
      const localT = (worldPos.y + this.halfHeight) / this.height
      const bodyRange = 1 - 2 * cf
      return { u, v: cf + Math.max(0, Math.min(1, localT)) * bodyRange }
    }
  }

  createMesh(): THREE.Mesh {
    const { radius, height, gridSegmentsU, gridSegmentsV } =
      CylinderSurface.getInitData()

    // CapsuleGeometry creates a cylinder with hemisphere caps -- exactly what we need.
    const geometry = new THREE.CapsuleGeometry(
      radius,
      height,
      gridSegmentsV,
      gridSegmentsU * 2
    )
    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { radius, height, gridSegmentsU, gridSegmentsV } =
      CylinderSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 48
    const halfH = height / 2

    const capSegments = Math.max(2, Math.floor(gridSegmentsV / 4))
    const bodySegments = Math.max(2, gridSegmentsV - capSegments * 2)

    // --- Horizontal ring lines (constant height, varying azimuth) ---

    // Bottom hemisphere latitude lines
    for (let j = 0; j < capSegments; j++) {
      const t = j / capSegments
      const phi = Math.PI - t * (Math.PI / 2)
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let i = 0; i < lineDetail; i++) {
        const t0 = (i / lineDetail) * Math.PI * 2
        const t1 = ((i + 1) / lineDetail) * Math.PI * 2
        vertices.push(
          radius * sinPhi * Math.cos(t0), -halfH + radius * cosPhi, radius * sinPhi * Math.sin(t0),
          radius * sinPhi * Math.cos(t1), -halfH + radius * cosPhi, radius * sinPhi * Math.sin(t1)
        )
      }
    }

    // Body rings
    for (let j = 0; j <= bodySegments; j++) {
      const y = -halfH + (j / bodySegments) * height
      for (let i = 0; i < lineDetail; i++) {
        const t0 = (i / lineDetail) * Math.PI * 2
        const t1 = ((i + 1) / lineDetail) * Math.PI * 2
        vertices.push(
          radius * Math.cos(t0), y, radius * Math.sin(t0),
          radius * Math.cos(t1), y, radius * Math.sin(t1)
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
        const t0 = (i / lineDetail) * Math.PI * 2
        const t1 = ((i + 1) / lineDetail) * Math.PI * 2
        vertices.push(
          radius * sinPhi * Math.cos(t0), halfH + radius * cosPhi, radius * sinPhi * Math.sin(t0),
          radius * sinPhi * Math.cos(t1), halfH + radius * cosPhi, radius * sinPhi * Math.sin(t1)
        )
      }
    }

    // --- Vertical meridian lines (constant azimuth, varying height) ---
    const capDetail = Math.max(8, lineDetail / 4)
    for (let i = 0; i < gridSegmentsU; i++) {
      const theta = (i / gridSegmentsU) * Math.PI * 2
      const cosT = Math.cos(theta)
      const sinT = Math.sin(theta)

      // Bottom cap meridian
      for (let j = 0; j < capDetail; j++) {
        const phi0 = Math.PI - (j / capDetail) * (Math.PI / 2)
        const phi1 = Math.PI - ((j + 1) / capDetail) * (Math.PI / 2)
        vertices.push(
          radius * Math.sin(phi0) * cosT, -halfH + radius * Math.cos(phi0), radius * Math.sin(phi0) * sinT,
          radius * Math.sin(phi1) * cosT, -halfH + radius * Math.cos(phi1), radius * Math.sin(phi1) * sinT
        )
      }

      // Body vertical line
      for (let j = 0; j < bodySegments; j++) {
        const y0 = -halfH + (j / bodySegments) * height
        const y1 = -halfH + ((j + 1) / bodySegments) * height
        vertices.push(radius * cosT, y0, radius * sinT, radius * cosT, y1, radius * sinT)
      }

      // Top cap meridian
      for (let j = 0; j < capDetail; j++) {
        const phi0 = (Math.PI / 2) * (1 - j / capDetail)
        const phi1 = (Math.PI / 2) * (1 - (j + 1) / capDetail)
        vertices.push(
          radius * Math.sin(phi0) * cosT, halfH + radius * Math.cos(phi0), radius * Math.sin(phi0) * sinT,
          radius * Math.sin(phi1) * cosT, halfH + radius * Math.cos(phi1), radius * Math.sin(phi1) * sinT
        )
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
