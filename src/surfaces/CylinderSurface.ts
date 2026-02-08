import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface CylinderConfig extends SurfaceConfig {
  radius?: number          // Cylinder radius (default 4)
  height?: number          // Cylinder body height, excluding bevels (default 16)
  bevelRadius?: number     // Radius of rounded lip at each open end (default 0.6)
  gridSegmentsU?: number   // Segments around circumference (default 24)
  gridSegmentsV?: number   // Segments along height (default 20)
}

/**
 * Cylinder Surface: an open-ended cylinder ("a flat piece of paper curled on itself")
 * with small beveled/rounded lips at the top and bottom edges.
 *
 * The cylinder is elongated (height > diameter) and oriented along the Y axis.
 * Players can move freely around the circumference (wrapping) and along the
 * height (clamped at the bevel edges).
 *
 * UV mapping:
 *   u: [0, 1) azimuthal angle around circumference (wraps)
 *   v: [0, 1] position along height (clamped)
 *     v=0:           bottom bevel lip
 *     v=bevelFrac:   bottom of cylinder body
 *     v=1-bevelFrac: top of cylinder body
 *     v=1:           top bevel lip
 *
 * Bevel geometry:
 *   The bevel is a quarter-circle arc at each open end. The arc center sits at
 *   (radius - bevelRadius) from the axis, at y = +/-halfHeight. The arc curves
 *   from the body junction (pointing outward, flush with the cylinder wall) to
 *   the lip (pointing downward/upward, curving inward).
 */
export class CylinderSurface extends Surface {
  private readonly radius: number
  private readonly height: number
  private readonly bevelRadius: number
  private readonly halfHeight: number
  private readonly bevelFraction: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  constructor(config?: CylinderConfig) {
    const radius = config?.radius ?? 4
    const height = config?.height ?? 16
    const bevelRadius = config?.bevelRadius ?? 0.6
    const gridSegmentsU = config?.gridSegmentsU ?? 24
    const gridSegmentsV = config?.gridSegmentsV ?? 20

    ;(CylinderSurface as any).__initData = {
      radius,
      height,
      bevelRadius,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.radius = radius
    this.height = height
    this.bevelRadius = Math.min(bevelRadius, radius * 0.5)
    this.halfHeight = height / 2
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Bevel arc length = PI/2 * bevelRadius. Total v-length = height + 2 * bevel arc.
    const bevelArc = (Math.PI / 2) * this.bevelRadius
    const totalVLength = height + 2 * bevelArc
    this.bevelFraction = bevelArc / totalVLength

    this.surfaceRadius = radius
    this.playerLocalPosition = new THREE.Vector3(radius, 0, 0)
  }

  private static getInitData(): {
    radius: number
    height: number
    bevelRadius: number
    gridSegmentsU: number
    gridSegmentsV: number
  } {
    return (
      (CylinderSurface as any).__initData ?? {
        radius: 4,
        height: 16,
        bevelRadius: 0.6,
        gridSegmentsU: 24,
        gridSegmentsV: 20,
      }
    )
  }

  /**
   * Decompose v into region and local parameter.
   *   Bottom bevel: v in [0, bevelFraction]          localT 0..1
   *   Cylinder body: v in [bevelFraction, 1-bevelFraction]  localT 0..1
   *   Top bevel: v in [1-bevelFraction, 1]            localT 0..1
   */
  private getRegion(v: number): {
    type: 'bottomBevel' | 'body' | 'topBevel'
    localT: number
  } {
    const bf = this.bevelFraction
    if (v <= bf) {
      return { type: 'bottomBevel', localT: bf > 0 ? v / bf : 1 }
    } else if (v >= 1 - bf) {
      return { type: 'topBevel', localT: bf > 0 ? (v - (1 - bf)) / bf : 1 }
    } else {
      const bodyRange = 1 - 2 * bf
      return { type: 'body', localT: bodyRange > 0 ? (v - bf) / bodyRange : 0.5 }
    }
  }

  getPoint(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2
    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)
    const region = this.getRegion(v)
    const r = this.radius
    const br = this.bevelRadius

    let position: THREE.Vector3
    let normal: THREE.Vector3
    let tangentV: THREE.Vector3

    const tangentU = new THREE.Vector3(-sinTheta, 0, cosTheta).normalize()

    switch (region.type) {
      case 'bottomBevel': {
        // Quarter-circle lip at the bottom open end.
        // alpha=PI/2 at the lip (localT=0), alpha=0 at body junction (localT=1).
        const alpha = (Math.PI / 2) * (1 - region.localT)
        const cosAlpha = Math.cos(alpha)
        const sinAlpha = Math.sin(alpha)
        const bevelR = (r - br) + br * cosAlpha
        const bevelY = -this.halfHeight - br * sinAlpha

        position = new THREE.Vector3(bevelR * cosTheta, bevelY, bevelR * sinTheta)
        normal = new THREE.Vector3(cosAlpha * cosTheta, -sinAlpha, cosAlpha * sinTheta).normalize()
        tangentV = new THREE.Vector3(sinAlpha * cosTheta, cosAlpha, sinAlpha * sinTheta).normalize()
        break
      }

      case 'body': {
        const y = -this.halfHeight + region.localT * this.height
        position = new THREE.Vector3(r * cosTheta, y, r * sinTheta)
        normal = new THREE.Vector3(cosTheta, 0, sinTheta).normalize()
        tangentV = new THREE.Vector3(0, 1, 0)
        break
      }

      case 'topBevel': {
        // Quarter-circle lip at the top open end.
        // alpha=0 at body junction (localT=0), alpha=PI/2 at the lip (localT=1).
        const alpha = (Math.PI / 2) * region.localT
        const cosAlpha = Math.cos(alpha)
        const sinAlpha = Math.sin(alpha)
        const bevelR = (r - br) + br * cosAlpha
        const bevelY = this.halfHeight + br * sinAlpha

        position = new THREE.Vector3(bevelR * cosTheta, bevelY, bevelR * sinTheta)
        normal = new THREE.Vector3(cosAlpha * cosTheta, sinAlpha, cosAlpha * sinTheta).normalize()
        tangentV = new THREE.Vector3(-sinAlpha * cosTheta, cosAlpha, -sinAlpha * sinTheta).normalize()
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

    // On the bevels, circumference is smaller -- correct du for uniform apparent speed
    if (region.type === 'bottomBevel') {
      const alpha = (Math.PI / 2) * (1 - region.localT)
      const currentR = (this.radius - this.bevelRadius) + this.bevelRadius * Math.cos(alpha)
      correctedDu = currentR > 0.001 ? du * (this.radius / currentR) : 0
    } else if (region.type === 'topBevel') {
      const alpha = (Math.PI / 2) * region.localT
      const currentR = (this.radius - this.bevelRadius) + this.bevelRadius * Math.cos(alpha)
      correctedDu = currentR > 0.001 ? du * (this.radius / currentR) : 0
    }

    let newU = u + correctedDu
    let newV = v + dv

    // u wraps (circumference is periodic)
    newU = ((newU % 1) + 1) % 1

    // v is clamped (open-ended -- cannot go past the bevel lips)
    const epsilon = 0.002
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    let theta = Math.atan2(worldPos.z, worldPos.x)
    if (theta < 0) theta += Math.PI * 2
    const u = theta / (Math.PI * 2)

    const r = this.radius
    const br = this.bevelRadius
    const bf = this.bevelFraction

    if (worldPos.y < -this.halfHeight) {
      // Bottom bevel region
      const dy = worldPos.y - (-this.halfHeight)
      const horizontalR = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z)
      const dr = horizontalR - (r - br)

      let alpha = Math.atan2(-dy, Math.max(0, dr))
      alpha = Math.max(0, Math.min(Math.PI / 2, alpha))

      // localT = 1 - alpha/(PI/2): lip (alpha=PI/2) -> localT=0, body (alpha=0) -> localT=1
      const localT = 1 - alpha / (Math.PI / 2)
      return { u, v: localT * bf }
    } else if (worldPos.y > this.halfHeight) {
      // Top bevel region
      const dy = worldPos.y - this.halfHeight
      const horizontalR = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z)
      const dr = horizontalR - (r - br)

      let alpha = Math.atan2(dy, Math.max(0, dr))
      alpha = Math.max(0, Math.min(Math.PI / 2, alpha))

      const localT = alpha / (Math.PI / 2)
      return { u, v: (1 - bf) + localT * bf }
    } else {
      // Cylinder body
      const localT = (worldPos.y + this.halfHeight) / this.height
      const bodyRange = 1 - 2 * bf
      return { u, v: bf + Math.max(0, Math.min(1, localT)) * bodyRange }
    }
  }

  createMesh(): THREE.Mesh {
    const { radius, height, bevelRadius, gridSegmentsU, gridSegmentsV } =
      CylinderSurface.getInitData()

    const cappedBevel = Math.min(bevelRadius, radius * 0.5)
    const geometry = this.buildCylinderGeometry(
      radius, height, cappedBevel, gridSegmentsU * 2, gridSegmentsV * 2
    )
    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  /**
   * Build cylinder geometry with beveled edges via lathe profile.
   * Profile: bottom bevel arc -> straight body -> top bevel arc.
   */
  private buildCylinderGeometry(
    radius: number,
    height: number,
    bevelRadius: number,
    segmentsU: number,
    segmentsV: number
  ): THREE.BufferGeometry {
    const halfH = height / 2
    const br = bevelRadius
    const bevelSteps = Math.max(4, Math.floor(segmentsV / 4))
    const bodySteps = Math.max(4, segmentsV - bevelSteps * 2)

    // Build profile points (r, y) from bottom bevel lip to top bevel lip
    const profile: Array<{ r: number; y: number }> = []

    // Bottom bevel: alpha from PI/2 (lip) to 0 (body junction)
    for (let i = 0; i <= bevelSteps; i++) {
      const alpha = (Math.PI / 2) * (1 - i / bevelSteps)
      profile.push({
        r: (radius - br) + br * Math.cos(alpha),
        y: -halfH - br * Math.sin(alpha),
      })
    }

    // Cylinder body (skip endpoints that overlap with bevel)
    for (let i = 1; i < bodySteps; i++) {
      profile.push({
        r: radius,
        y: -halfH + (i / bodySteps) * height,
      })
    }

    // Top bevel: alpha from 0 (body junction) to PI/2 (lip)
    for (let i = 0; i <= bevelSteps; i++) {
      const alpha = (Math.PI / 2) * (i / bevelSteps)
      profile.push({
        r: (radius - br) + br * Math.cos(alpha),
        y: halfH + br * Math.sin(alpha),
      })
    }

    const rows = profile.length
    const cols = segmentsU + 1
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    for (let j = 0; j < rows; j++) {
      const { r: pr, y: py } = profile[j]
      const vCoord = j / (rows - 1)

      for (let i = 0; i <= segmentsU; i++) {
        const theta = (i / segmentsU) * Math.PI * 2
        const cosT = Math.cos(theta)
        const sinT = Math.sin(theta)

        positions.push(pr * cosT, py, pr * sinT)

        // Normal from profile slope (perpendicular to profile tangent)
        let nx: number, ny: number
        if (j === 0) {
          const next = profile[j + 1]
          nx = next.y - py
          ny = -(next.r - pr)
        } else if (j === rows - 1) {
          const prev = profile[j - 1]
          nx = py - prev.y
          ny = -(pr - prev.r)
        } else {
          const prev = profile[j - 1]
          const next = profile[j + 1]
          nx = next.y - prev.y
          ny = -(next.r - prev.r)
        }
        const len = Math.sqrt(nx * nx + ny * ny) || 1
        nx /= len
        ny /= len

        normals.push(nx * cosT, ny, nx * sinT)
        uvs.push(i / segmentsU, vCoord)
      }
    }

    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < segmentsU; i++) {
        const a = j * cols + i
        const b = j * cols + i + 1
        const c = (j + 1) * cols + i
        const d = (j + 1) * cols + i + 1

        indices.push(a, c, b)
        indices.push(b, c, d)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)

    return geometry
  }

  createGrid(): THREE.LineSegments {
    const { radius, height, bevelRadius, gridSegmentsU, gridSegmentsV } =
      CylinderSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 48
    const halfH = height / 2
    const br = Math.min(bevelRadius, radius * 0.5)

    const bevelSteps = Math.max(2, Math.floor(gridSegmentsV / 4))
    const bodySegments = Math.max(2, gridSegmentsV - bevelSteps * 2)

    // --- Horizontal ring lines (constant height, varying azimuth) ---

    // Bottom bevel rings
    for (let j = 0; j <= bevelSteps; j++) {
      const alpha = (Math.PI / 2) * (1 - j / bevelSteps)
      const ringR = (radius - br) + br * Math.cos(alpha)
      const ringY = -halfH - br * Math.sin(alpha)

      for (let i = 0; i < lineDetail; i++) {
        const t0 = (i / lineDetail) * Math.PI * 2
        const t1 = ((i + 1) / lineDetail) * Math.PI * 2
        vertices.push(
          ringR * Math.cos(t0), ringY, ringR * Math.sin(t0),
          ringR * Math.cos(t1), ringY, ringR * Math.sin(t1)
        )
      }
    }

    // Body rings
    for (let j = 1; j < bodySegments; j++) {
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

    // Top bevel rings
    for (let j = 0; j <= bevelSteps; j++) {
      const alpha = (Math.PI / 2) * (j / bevelSteps)
      const ringR = (radius - br) + br * Math.cos(alpha)
      const ringY = halfH + br * Math.sin(alpha)

      for (let i = 0; i < lineDetail; i++) {
        const t0 = (i / lineDetail) * Math.PI * 2
        const t1 = ((i + 1) / lineDetail) * Math.PI * 2
        vertices.push(
          ringR * Math.cos(t0), ringY, ringR * Math.sin(t0),
          ringR * Math.cos(t1), ringY, ringR * Math.sin(t1)
        )
      }
    }

    // --- Vertical meridian lines (constant azimuth, varying height) ---
    const bevelDetail = Math.max(8, lineDetail / 4)
    for (let i = 0; i < gridSegmentsU; i++) {
      const theta = (i / gridSegmentsU) * Math.PI * 2
      const cosT = Math.cos(theta)
      const sinT = Math.sin(theta)

      // Bottom bevel meridian
      for (let j = 0; j < bevelDetail; j++) {
        const a0 = (Math.PI / 2) * (1 - j / bevelDetail)
        const a1 = (Math.PI / 2) * (1 - (j + 1) / bevelDetail)
        const r0 = (radius - br) + br * Math.cos(a0)
        const y0 = -halfH - br * Math.sin(a0)
        const r1 = (radius - br) + br * Math.cos(a1)
        const y1 = -halfH - br * Math.sin(a1)
        vertices.push(r0 * cosT, y0, r0 * sinT, r1 * cosT, y1, r1 * sinT)
      }

      // Body vertical line
      for (let j = 0; j < bodySegments; j++) {
        const y0 = -halfH + (j / bodySegments) * height
        const y1 = -halfH + ((j + 1) / bodySegments) * height
        vertices.push(radius * cosT, y0, radius * sinT, radius * cosT, y1, radius * sinT)
      }

      // Top bevel meridian
      for (let j = 0; j < bevelDetail; j++) {
        const a0 = (Math.PI / 2) * (j / bevelDetail)
        const a1 = (Math.PI / 2) * ((j + 1) / bevelDetail)
        const r0 = (radius - br) + br * Math.cos(a0)
        const y0 = halfH + br * Math.sin(a0)
        const r1 = (radius - br) + br * Math.cos(a1)
        const y1 = halfH + br * Math.sin(a1)
        vertices.push(r0 * cosT, y0, r0 * sinT, r1 * cosT, y1, r1 * sinT)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
