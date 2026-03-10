import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface PipeConfig extends SurfaceConfig {
  radius?: number          // Outer cylinder radius (default 5)
  height?: number          // Pipe body height (default 14)
  bevelRadius?: number     // Radius of the bevel curve at each end (default 1.5)
  gridSegmentsU?: number   // Segments around circumference (default 24)
  gridSegmentsV?: number   // Segments along the full v range (default 28)
}

/**
 * Pipe Surface: an open-ended tube where players traverse both outer and inner surfaces.
 *
 * Imagine a sheet of paper rolled into a tube. At each end, the surface curves
 * inward via a smooth bevel (quarter-circle arc), connecting the outer wall to
 * the inner wall. The inner wall has reversed normals so both surfaces face
 * outward from the player's perspective.
 *
 * The geometry consists of 5 continuous regions arranged as a U-shaped
 * cross-section swept around the Y axis:
 *
 *   1. Inner cylinder  (v: 0 to innerFrac)       - inner wall, going upward
 *   2. Top bevel       (v: innerFrac to topBevel) - curves from inner to outer at top
 *   3. Outer cylinder  (v: topBevel to outerEnd)  - outer wall, going downward
 *   4. Bottom bevel    (v: outerEnd to botBevel)  - curves from outer to inner at bottom
 *   5. (wraps back to inner cylinder at v=1 -> v=0)
 *
 * UV mapping:
 *   u: [0, 1) azimuthal angle around circumference (wraps)
 *   v: [0, 1) continuous path: inner wall -> top bevel -> outer wall -> bottom bevel
 *       v wraps, making this a doubly-periodic surface like a torus.
 *
 * Cross-section profile (looking at the pipe from the side):
 *
 *        ___bevel___
 *       /           \
 *      |  (inner)    |  (outer)
 *      |             |
 *       \___bevel___/
 */
export class PipeSurface extends Surface {
  private readonly radius: number
  private readonly height: number
  private readonly halfHeight: number
  private readonly bevelRadius: number
  private readonly innerRadius: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  // Fractional boundaries for the 4 regions in v-space
  private readonly innerFrac: number
  private readonly topBevelEnd: number
  private readonly outerEnd: number
  // bottomBevelEnd = 1.0 (wraps to 0)

  constructor(config?: PipeConfig) {
    const radius = config?.radius ?? 3.5
    const height = config?.height ?? 10
    const bevelRadius = config?.bevelRadius ?? 1
    const gridSegmentsU = config?.gridSegmentsU ?? 24
    const gridSegmentsV = config?.gridSegmentsV ?? 28

    ;(PipeSurface as any).__initData = {
      radius,
      height,
      bevelRadius,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.radius = radius
    this.height = height
    this.halfHeight = height / 2
    this.bevelRadius = bevelRadius
    this.innerRadius = radius - 2 * bevelRadius
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Arc lengths of each region (proportional to v allocation)
    const bevelArc = (Math.PI / 2) * bevelRadius    // quarter-circle arc
    const innerLength = height                        // inner cylinder length
    const outerLength = height                        // outer cylinder length
    const totalLength = innerLength + outerLength + 2 * bevelArc

    this.innerFrac = innerLength / totalLength
    this.topBevelEnd = (innerLength + bevelArc) / totalLength
    this.outerEnd = (innerLength + bevelArc + outerLength) / totalLength
    // bottomBevelEnd = 1.0

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
      (PipeSurface as any).__initData ?? {
        radius: 3.5,
        height: 10,
        bevelRadius: 1,
        gridSegmentsU: 24,
        gridSegmentsV: 28,
      }
    )
  }

  /**
   * Decompose v into one of four regions with a local parameter t in [0, 1].
   */
  private getRegion(v: number): {
    type: 'inner' | 'topBevel' | 'outer' | 'bottomBevel'
    localT: number
  } {
    // Normalize v to [0, 1)
    const vn = ((v % 1) + 1) % 1

    if (vn < this.innerFrac) {
      return { type: 'inner', localT: this.innerFrac > 0 ? vn / this.innerFrac : 0 }
    } else if (vn < this.topBevelEnd) {
      const range = this.topBevelEnd - this.innerFrac
      return { type: 'topBevel', localT: range > 0 ? (vn - this.innerFrac) / range : 0 }
    } else if (vn < this.outerEnd) {
      const range = this.outerEnd - this.topBevelEnd
      return { type: 'outer', localT: range > 0 ? (vn - this.topBevelEnd) / range : 0 }
    } else {
      const range = 1 - this.outerEnd
      return { type: 'bottomBevel', localT: range > 0 ? (vn - this.outerEnd) / range : 0 }
    }
  }

  /**
   * Get the cross-section profile point for a given region and localT.
   * Returns {r, y, nr, ny} where r is radial distance from axis, y is height,
   * nr/ny are the normal components in the radial/y plane.
   * Also returns tangent in the v-direction (dr, dy components).
   */
  private getProfile(region: { type: string; localT: number }): {
    r: number; y: number; nr: number; ny: number; tvR: number; tvY: number
  } {
    const R = this.radius
    const bR = this.bevelRadius
    const iR = this.innerRadius
    const hH = this.halfHeight

    switch (region.type) {
      case 'inner': {
        // Inner cylinder going from bottom to top
        // Inner wall: radius = innerRadius, normal points inward (toward axis = -r)
        const y = -hH + region.localT * this.height
        return { r: iR, y, nr: -1, ny: 0, tvR: 0, tvY: 1 }
      }

      case 'topBevel': {
        // Quarter-circle bevel at top, curving from inner wall to outer wall
        // Center of bevel arc: (innerRadius + bevelRadius, halfHeight) = (R - bevelRadius, halfHeight)
        // Angle sweeps from PI (pointing inward/down) to PI/2 (pointing upward/outward)
        const angle = Math.PI - region.localT * (Math.PI / 2)
        const cosA = Math.cos(angle)
        const sinA = Math.sin(angle)
        const centerR = R - bR
        const centerY = hH

        return {
          r: centerR + bR * cosA,
          y: centerY + bR * sinA,
          nr: cosA,
          ny: sinA,
          tvR: sinA,   // d/dangle of cos(angle) * -1 (because angle decreases)
          tvY: -cosA,  // d/dangle of sin(angle) * -1
        }
      }

      case 'outer': {
        // Outer cylinder going from top to bottom
        // Outer wall: radius = R, normal points outward (+r)
        const y = hH - region.localT * this.height
        return { r: R, y, nr: 1, ny: 0, tvR: 0, tvY: -1 }
      }

      case 'bottomBevel': {
        // Quarter-circle bevel at bottom, curving from outer wall to inner wall
        // Center of bevel arc: (R - bevelRadius, -halfHeight)
        // Angle sweeps from PI/2 (pointing downward/outward) to 0 (pointing outward/up toward inner)
        // Actually: sweeps from 0 (right/outward) to -PI/2 (downward/inward)
        const angle = (Math.PI / 2) * (1 - region.localT)
        const cosA = Math.cos(angle)
        const sinA = Math.sin(angle)
        const centerR = R - bR
        const centerY = -hH

        return {
          r: centerR + bR * cosA,
          y: centerY - bR * sinA,
          nr: cosA,
          ny: -sinA,
          tvR: sinA,    // tangent direction: moving from outer to inner
          tvY: cosA,
        }
      }

      default:
        return { r: R, y: 0, nr: 1, ny: 0, tvR: 0, tvY: 1 }
    }
  }

  private getPointLocal(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2
    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)
    const region = this.getRegion(v)
    const profile = this.getProfile(region)

    const position = new THREE.Vector3(
      profile.r * cosTheta,
      profile.y,
      profile.r * sinTheta
    )

    const normal = new THREE.Vector3(
      profile.nr * cosTheta,
      profile.ny,
      profile.nr * sinTheta
    ).normalize()

    // Tangent in u direction (around circumference)
    const tangentU = new THREE.Vector3(-sinTheta, 0, cosTheta).normalize()

    // Tangent in v direction (along the profile path)
    const tangentV = new THREE.Vector3(
      profile.tvR * cosTheta,
      profile.tvY,
      profile.tvR * sinTheta
    ).normalize()

    return { position, normal, tangentU, tangentV }
  }

  getPoint(u: number, v: number): SurfacePoint {
    // s44r-04-04 FIX: Apply worldRotation so entity positions are in world space,
    // consistent with bullet positions from MeshWalker (which use mesh.matrixWorld).
    return this.applyWorldRotation(this.getPointLocal(u, v))
  }

  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    const region = this.getRegion(v)
    let correctedDu = du

    // On the bevel regions, the effective circumference changes with radius
    if (region.type === 'topBevel' || region.type === 'bottomBevel') {
      const profile = this.getProfile(region)
      // Scale du by the ratio of outer radius to local radius
      if (profile.r > 0.001) {
        correctedDu = du * this.radius / profile.r
      }
    } else if (region.type === 'inner') {
      // Inner cylinder has smaller circumference
      if (this.innerRadius > 0.001) {
        correctedDu = du * this.radius / this.innerRadius
      }
    }

    let newU = u + correctedDu
    let newV = v + dv

    // Both u and v wrap (doubly periodic, like a torus)
    newU = ((newU % 1) + 1) % 1
    newV = ((newV % 1) + 1) % 1

    return { u: newU, v: newV }
  }

  /** Pipe wraps in both U and V (inner+outer walls form a loop). */
  get wrapsV(): boolean { return true }

  wrapUV(u: number, v: number): { u: number; v: number } {
    return {
      u: ((u % 1) + 1) % 1,
      v: ((v % 1) + 1) % 1,
    }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    // Find u from azimuthal angle
    let theta = Math.atan2(worldPos.z, worldPos.x)
    if (theta < 0) theta += Math.PI * 2
    const u = theta / (Math.PI * 2)

    // Find v by determining which region the point is in
    const radialDist = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z)
    const y = worldPos.y
    const R = this.radius
    const iR = this.innerRadius
    const bR = this.bevelRadius
    const hH = this.halfHeight
    const midR = (R + iR) / 2

    // Determine region based on position
    if (y > hH - bR && radialDist >= midR) {
      // Top bevel region (outer side)
      // Project onto the bevel arc centered at (R - bR, hH)
      const cx = R - bR
      const cy = hH
      const dx = radialDist - cx
      const dy = y - cy
      let angle = Math.atan2(dy, dx)
      angle = Math.max(Math.PI / 2, Math.min(Math.PI, angle))
      const localT = (Math.PI - angle) / (Math.PI / 2)
      return { u, v: this.innerFrac + localT * (this.topBevelEnd - this.innerFrac) }
    } else if (y > hH - bR && radialDist < midR) {
      // Top bevel region (inner side)
      const cx = R - bR
      const cy = hH
      const dx = radialDist - cx
      const dy = y - cy
      let angle = Math.atan2(dy, dx)
      angle = Math.max(Math.PI / 2, Math.min(Math.PI, angle))
      const localT = (Math.PI - angle) / (Math.PI / 2)
      return { u, v: this.innerFrac + localT * (this.topBevelEnd - this.innerFrac) }
    } else if (y < -hH + bR && radialDist >= midR) {
      // Bottom bevel region (outer side)
      const cx = R - bR
      const cy = -hH
      const dx = radialDist - cx
      const dy = -(y - cy)  // flip because bottom bevel curves downward
      let angle = Math.atan2(dy, dx)
      angle = Math.max(0, Math.min(Math.PI / 2, angle))
      const localT = 1 - angle / (Math.PI / 2)
      return { u, v: this.outerEnd + localT * (1 - this.outerEnd) }
    } else if (y < -hH + bR && radialDist < midR) {
      // Bottom bevel region (inner side)
      const cx = R - bR
      const cy = -hH
      const dx = radialDist - cx
      const dy = -(y - cy)
      let angle = Math.atan2(dy, dx)
      angle = Math.max(0, Math.min(Math.PI / 2, angle))
      const localT = 1 - angle / (Math.PI / 2)
      return { u, v: this.outerEnd + localT * (1 - this.outerEnd) }
    } else if (radialDist > midR) {
      // Outer cylinder region
      // Outer goes from top (localT=0) to bottom (localT=1)
      const localT = Math.max(0, Math.min(1, (hH - y) / this.height))
      return { u, v: this.topBevelEnd + localT * (this.outerEnd - this.topBevelEnd) }
    } else {
      // Inner cylinder region
      // Inner goes from bottom (localT=0) to top (localT=1)
      const localT = Math.max(0, Math.min(1, (y + hH) / this.height))
      return { u, v: localT * this.innerFrac }
    }
  }

  createMesh(): THREE.Mesh {
    const { radius, height, bevelRadius, gridSegmentsU, gridSegmentsV } =
      PipeSurface.getInitData()

    // Build mesh via LatheGeometry with a U-shaped profile
    const points: THREE.Vector2[] = []
    const profileSegments = gridSegmentsV * 2
    const iR = radius - 2 * bevelRadius
    const hH = height / 2

    // Trace the U-shaped cross-section profile:
    // 1. Inner cylinder bottom to top
    const innerSegs = Math.floor(profileSegments * 0.3)
    for (let i = 0; i <= innerSegs; i++) {
      const t = i / innerSegs
      points.push(new THREE.Vector2(iR, -hH + t * height))
    }

    // 2. Top bevel (inner to outer)
    const bevelSegs = Math.floor(profileSegments * 0.1)
    for (let i = 1; i <= bevelSegs; i++) {
      const t = i / bevelSegs
      const angle = Math.PI - t * (Math.PI / 2)
      const cx = radius - bevelRadius
      const cy = hH
      points.push(new THREE.Vector2(
        cx + bevelRadius * Math.cos(angle),
        cy + bevelRadius * Math.sin(angle)
      ))
    }

    // 3. Outer cylinder top to bottom
    const outerSegs = Math.floor(profileSegments * 0.3)
    for (let i = 1; i <= outerSegs; i++) {
      const t = i / outerSegs
      points.push(new THREE.Vector2(radius, hH - t * height))
    }

    // 4. Bottom bevel (outer to inner)
    for (let i = 1; i <= bevelSegs; i++) {
      const t = i / bevelSegs
      const angle = (Math.PI / 2) * (1 - t)
      const cx = radius - bevelRadius
      const cy = -hH
      points.push(new THREE.Vector2(
        cx + bevelRadius * Math.cos(angle),
        cy - bevelRadius * Math.sin(angle)
      ))
    }

    const geometry = new THREE.LatheGeometry(points, gridSegmentsU * 2)

    // LatheGeometry normals point outward by default. The inner surface
    // needs inward-facing normals. Since we use DoubleSide rendering for
    // the pipe, Three.js handles this automatically.
    const material = this.createSurfaceMaterial()
    material.side = THREE.DoubleSide

    return new THREE.Mesh(geometry, material)
  }

  createGrid(): THREE.LineSegments {
    const { radius, height, bevelRadius, gridSegmentsU, gridSegmentsV } =
      PipeSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 48
    const iR = radius - 2 * bevelRadius
    const hH = height / 2

    // Compute v-space boundary fractions locally.
    // IMPORTANT: createGrid() is called from super(config) before instance properties
    // (this.innerFrac, this.radius, etc.) are assigned by the subclass constructor.
    // Therefore we MUST NOT call this.getRegion() / this.getProfile() here —
    // those methods access undefined instance properties and produce NaN positions.
    // Instead we replicate the region/profile math using local variables from getInitData().
    const bevelArc = (Math.PI / 2) * bevelRadius
    const totalLength = height + height + 2 * bevelArc
    const innerFrac   = height / totalLength
    const topBevelEnd = (height + bevelArc) / totalLength
    const outerEnd    = (height + bevelArc + height) / totalLength

    /**
     * Compute the (radial, y) profile point at normalized v ∈ [0, 1).
     * Mirrors the region+profile logic in getRegion()/getProfile() but uses
     * only local variables — safe to call before instance fields are set.
     */
    const getProfileAt = (v: number): { r: number; y: number } => {
      const vn = ((v % 1) + 1) % 1
      if (vn < innerFrac) {
        const localT = innerFrac > 0 ? vn / innerFrac : 0
        return { r: iR, y: -hH + localT * height }
      } else if (vn < topBevelEnd) {
        const range  = topBevelEnd - innerFrac
        const localT = range > 0 ? (vn - innerFrac) / range : 0
        const angle  = Math.PI - localT * (Math.PI / 2)
        return {
          r: (radius - bevelRadius) + bevelRadius * Math.cos(angle),
          y: hH + bevelRadius * Math.sin(angle),
        }
      } else if (vn < outerEnd) {
        const range  = outerEnd - topBevelEnd
        const localT = range > 0 ? (vn - topBevelEnd) / range : 0
        return { r: radius, y: hH - localT * height }
      } else {
        const range  = 1 - outerEnd
        const localT = range > 0 ? (vn - outerEnd) / range : 0
        const angle  = (Math.PI / 2) * (1 - localT)
        return {
          r: (radius - bevelRadius) + bevelRadius * Math.cos(angle),
          y: -hH - bevelRadius * Math.sin(angle),
        }
      }
    }

    // --- Ring lines (constant v, varying u/theta) ---
    const totalRings = gridSegmentsV
    for (let j = 0; j < totalRings; j++) {
      const v = j / totalRings
      const { r, y } = getProfileAt(v)

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          r * Math.cos(theta0), y, r * Math.sin(theta0),
          r * Math.cos(theta1), y, r * Math.sin(theta1)
        )
      }
    }

    // --- Meridian lines (constant u/theta, varying v) ---
    const meridians = gridSegmentsU
    const vSteps = gridSegmentsV * 2  // more steps for smooth bevels

    for (let i = 0; i < meridians; i++) {
      const theta = (i / meridians) * Math.PI * 2
      const cosTheta = Math.cos(theta)
      const sinTheta = Math.sin(theta)

      for (let j = 0; j < vSteps; j++) {
        const v0 = j / vSteps
        const v1 = (j + 1) / vSteps
        const p0 = getProfileAt(v0)
        const p1 = getProfileAt(v1)

        vertices.push(
          p0.r * cosTheta, p0.y, p0.r * sinTheta,
          p1.r * cosTheta, p1.y, p1.r * sinTheta
        )
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
