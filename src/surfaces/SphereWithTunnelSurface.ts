import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface SphereWithTunnelConfig extends SurfaceConfig {
  radius?: number          // Outer sphere radius (default: 8)
  tunnelRadius?: number    // Radius of the tunnel (default: 2)
  tunnelAxis?: 'x' | 'y' | 'z'  // Kept for backward compat, always uses 'y'
  bevelRadius?: number     // Radius of smooth bevel at tunnel-sphere junction (default: 0.8)
  gridSegmentsU?: number
  gridSegmentsV?: number
}

/**
 * Sphere with a traversable tunnel through its center.
 *
 * Topologically a torus: the outer sphere has two circular holes (near the
 * poles) connected by an inner cylindrical tunnel through the center.
 * Players can walk on the outside of the sphere and enter the tunnel at
 * either pole to traverse through the center.
 *
 * UV mapping (torus topology, both periodic):
 *   u: [0, 1) azimuthal angle around the Y axis
 *   v: [0, 1) position around the cross-section profile:
 *     v=0:          bottom hole edge (sphere meets tunnel, y < 0)
 *     v~0.29:       equator (widest point, r = radius)
 *     v~0.58:       top hole edge (sphere meets tunnel, y > 0)
 *     v~0.79:       tunnel midpoint (y = 0, inside)
 *     v→1.0:        wraps back to v=0
 *
 * Profile cross-section (closed loop):
 *   1. Outer sphere arc: bottom hole → equator → top hole
 *   2. Inner tunnel:     top hole → center → bottom hole
 */
export class SphereWithTunnelSurface extends Surface {
  private readonly radius: number
  private readonly tunnelRadius: number
  private readonly bevelRadius: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  // Derived geometry
  private readonly holeAngle: number        // asin(tunnelRadius / radius)
  private readonly tunnelHalfLen: number     // radius * cos(holeAngle)

  // Bevel geometry (computed from bevelRadius)
  private readonly phiEnd: number            // sphere cutback angle
  private readonly bevelCenterR: number      // bevel circle center r-coordinate
  private readonly bevelCenterYTop: number   // bevel circle center y-coordinate (top)
  private readonly bevelAngle: number        // angular sweep of each bevel arc

  // Profile arc lengths
  private readonly sphereArcLen: number      // Arc of outer sphere between holes
  private readonly bevelArcLen: number       // Arc length of each bevel
  private readonly tunnelLength: number      // Full tunnel length
  private readonly totalPerimeter: number    // Sum of all segments

  constructor(config?: SphereWithTunnelConfig) {
    const radius = config?.radius ?? 8
    const tunnelRadius = config?.tunnelRadius ?? 2
    const bevelRadius = config?.bevelRadius ?? 0.8
    const gridSegmentsU = config?.gridSegmentsU ?? 32
    const gridSegmentsV = config?.gridSegmentsV ?? 32

    ;(SphereWithTunnelSurface as any).__initData = {
      radius,
      tunnelRadius,
      bevelRadius,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.radius = radius
    this.tunnelRadius = Math.min(tunnelRadius, radius * 0.5)
    this.bevelRadius = bevelRadius
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    this.holeAngle = Math.asin(this.tunnelRadius / this.radius)
    this.tunnelHalfLen = this.radius * Math.cos(this.holeAngle)

    const R = this.radius
    const tr = this.tunnelRadius
    const bR = this.bevelRadius

    if (bR > 0.001) {
      // Bevel: circular arc transition at each sphere-tunnel junction
      // The bevel circle center is positioned so the arc connects sphere to tunnel
      // with C1-continuous normals at both junction points.
      const sinPhiEnd = Math.min((tr + bR) / (R - bR), 0.99)
      this.phiEnd = Math.asin(sinPhiEnd)
      const cosPhiEnd = Math.cos(this.phiEnd)

      this.bevelCenterR = tr + bR
      this.bevelCenterYTop = cosPhiEnd * (R - bR)
      this.bevelAngle = Math.PI / 2 + this.phiEnd

      this.sphereArcLen = (Math.PI - 2 * this.phiEnd) * R
      this.bevelArcLen = bR * this.bevelAngle
      this.tunnelLength = 2 * this.bevelCenterYTop
      this.totalPerimeter = this.sphereArcLen + 2 * this.bevelArcLen + this.tunnelLength
    } else {
      // No bevel - original 2-segment profile
      this.phiEnd = this.holeAngle
      this.bevelCenterR = 0
      this.bevelCenterYTop = 0
      this.bevelAngle = 0
      this.bevelArcLen = 0

      this.sphereArcLen = (Math.PI - 2 * this.holeAngle) * R
      this.tunnelLength = 2 * this.tunnelHalfLen
      this.totalPerimeter = this.sphereArcLen + this.tunnelLength
    }

    this.surfaceRadius = radius
    this.playerLocalPosition = new THREE.Vector3(radius, 0, 0)
  }

  private static getInitData() {
    return (
      (SphereWithTunnelSurface as any).__initData ?? {
        radius: 8,
        tunnelRadius: 2,
        bevelRadius: 0.8,
        gridSegmentsU: 32,
        gridSegmentsV: 32,
      }
    )
  }

  /**
   * Cross-section profile at parameter t in [0, 1).
   * Returns (r, y) position and (nr, ny) outward normal direction.
   *
   * With bevel (4 segments):
   *   1. Outer sphere arc (shortened by bevel on each side)
   *   2. Top bevel arc (sphere → tunnel, circular arc)
   *   3. Inner tunnel (shortened by bevel on each end)
   *   4. Bottom bevel arc (tunnel → sphere, circular arc)
   *
   * Without bevel (2 segments):
   *   1. Outer sphere: bottom hole → equator → top hole
   *   2. Inner tunnel: top hole → center → bottom hole
   */
  /**
   * Compute bevel geometry from basic parameters.
   * Used both by profileAt() and during construction.
   */
  private static computeBevelGeometry(R: number, tr: number, bR: number) {
    if (bR < 0.001) {
      const ha = Math.asin(tr / R)
      const hLen = R * Math.cos(ha)
      return {
        pe: ha, Cr: 0, CyTop: 0, bAngle: 0,
        sArc: (Math.PI - 2 * ha) * R,
        bArc: 0,
        tLen: 2 * hLen,
        totalP: (Math.PI - 2 * ha) * R + 2 * hLen,
      }
    }
    const sinPhiEnd = Math.min((tr + bR) / (R - bR), 0.99)
    const pe = Math.asin(sinPhiEnd)
    const cosPhiEnd = Math.cos(pe)
    const Cr = tr + bR
    const CyTop = cosPhiEnd * (R - bR)
    const bAngle = Math.PI / 2 + pe
    const sArc = (Math.PI - 2 * pe) * R
    const bArc = bR * bAngle
    const tLen = 2 * CyTop
    return { pe, Cr, CyTop, bAngle, sArc, bArc, tLen, totalP: sArc + 2 * bArc + tLen }
  }

  private profileAt(t: number): { r: number; y: number; nr: number; ny: number } {
    const initData = SphereWithTunnelSurface.getInitData()
    const R = this.radius ?? initData.radius
    const tr = this.tunnelRadius ?? Math.min(initData.tunnelRadius, R * 0.5)
    const bR = this.bevelRadius ?? initData.bevelRadius ?? 0

    const { pe, Cr, CyTop, bAngle, sArc, bArc, tLen, totalP } =
      SphereWithTunnelSurface.computeBevelGeometry(R, tr, bR)

    const pos = ((t % 1) + 1) % 1 * totalP
    let acc = 0

    // Segment 1: Outer sphere arc
    acc += sArc
    if (pos < acc) {
      const localT = pos / sArc
      const phi = (Math.PI - pe) - localT * (Math.PI - 2 * pe)
      return {
        r: R * Math.sin(phi),
        y: R * Math.cos(phi),
        nr: Math.sin(phi),
        ny: Math.cos(phi),
      }
    }

    // No bevel: fall through to tunnel
    if (bR < 0.001) {
      const hLen = R * Math.cos(pe)
      const localT = (pos - acc) / tLen
      return { r: tr, y: hLen * (1 - 2 * localT), nr: -1, ny: 0 }
    }

    // Segment 2: Top bevel (sphere → tunnel)
    acc += bArc
    if (pos < acc) {
      const localT = (pos - (acc - bArc)) / bArc
      const a = (Math.PI / 2 - pe) + localT * bAngle
      return {
        r: Cr + bR * Math.cos(a),
        y: CyTop + bR * Math.sin(a),
        nr: Math.cos(a),
        ny: Math.sin(a),
      }
    }

    // Segment 3: Tunnel (shortened)
    acc += tLen
    if (pos < acc) {
      const localT = (pos - (acc - tLen)) / tLen
      return { r: tr, y: CyTop * (1 - 2 * localT), nr: -1, ny: 0 }
    }

    // Segment 4: Bottom bevel (tunnel → sphere)
    const localT = (pos - acc) / bArc
    const a = Math.PI + localT * bAngle
    return {
      r: Cr + bR * Math.cos(a),
      y: -CyTop + bR * Math.sin(a),
      nr: Math.cos(a),
      ny: Math.sin(a),
    }
  }

  getPoint(u: number, v: number): SurfacePoint {
    const phi = u * Math.PI * 2
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)

    const { r, y, nr, ny } = this.profileAt(v)

    const position = new THREE.Vector3(r * cosPhi, y, r * sinPhi)

    const normal = new THREE.Vector3(nr * cosPhi, ny, nr * sinPhi).normalize()

    // Tangent in u direction (around the ring)
    const tangentU = new THREE.Vector3(-sinPhi, 0, cosPhi).normalize()

    // Tangent in v direction (along profile) - finite difference
    const dv = 0.001
    const p1 = this.profileAt(v + dv)
    const p0 = this.profileAt(v - dv)
    const dr = p1.r - p0.r
    const dy = p1.y - p0.y
    const tangentV = new THREE.Vector3(dr * cosPhi, dy, dr * sinPhi).normalize()

    return { position, normal, tangentU, tangentV }
  }

  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number,
  ): { u: number; v: number } {
    const { r } = this.profileAt(v)

    // Scale du for varying circumference at different cross-section positions
    const scaleFactor = r > 0.001 ? this.radius / r : 1

    let newU = u + du * scaleFactor
    let newV = v + dv

    // Both u and v are periodic (torus topology)
    newU = ((newU % 1) + 1) % 1
    newV = ((newV % 1) + 1) % 1

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    // Find azimuthal angle (u)
    let phi = Math.atan2(worldPos.z, worldPos.x)
    if (phi < 0) phi += Math.PI * 2
    const u = phi / (Math.PI * 2)

    // Find closest v by projecting to (r, y) cross-section and sampling profile
    const rDist = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z)
    const yDist = worldPos.y

    let bestV = 0
    let bestDist = Infinity
    const samples = 64
    for (let i = 0; i < samples; i++) {
      const tv = i / samples
      const p = this.profileAt(tv)
      const d = (rDist - p.r) * (rDist - p.r) + (yDist - p.y) * (yDist - p.y)
      if (d < bestDist) {
        bestDist = d
        bestV = tv
      }
    }

    return { u, v: bestV }
  }

  /**
   * Check if a world position is inside the tunnel.
   */
  isInsideTunnel(worldPos: THREE.Vector3): boolean {
    const rDist = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z)
    return Math.abs(worldPos.y) <= this.tunnelHalfLen && rDist <= this.tunnelRadius * 1.2
  }

  /**
   * Get the tunnel parameters for external use.
   */
  getTunnelParams(): {
    radius: number
    length: number
    axis: 'x' | 'y' | 'z'
    holeAngle: number
  } {
    return {
      radius: this.tunnelRadius,
      length: this.tunnelLength,
      axis: 'y',
      holeAngle: this.holeAngle,
    }
  }

  createMesh(): THREE.Mesh {
    const initData = SphereWithTunnelSurface.getInitData()
    const R = initData.radius
    const tr = Math.min(initData.tunnelRadius, R * 0.5)
    const bR = initData.bevelRadius ?? 0
    const { totalP } = SphereWithTunnelSurface.computeBevelGeometry(R, tr, bR)

    // Compute segment counts for balanced triangle aspect ratios
    const radialSegs = Math.max(initData.gridSegmentsV, 32)
    const targetStep = totalP / radialSegs
    const ringCircumference = 2 * Math.PI * R
    const tubularSegs = Math.max(Math.round(ringCircumference / targetStep), 48)

    const positions: number[] = []
    const indices: number[] = []

    // j = radial (around cross-section), i = tubular (around Y axis)
    for (let j = 0; j <= radialSegs; j++) {
      const v = j / radialSegs
      const { r: pr, y: py } = this.profileAt(v)

      for (let i = 0; i <= tubularSegs; i++) {
        const theta = (i / tubularSegs) * Math.PI * 2
        positions.push(pr * Math.cos(theta), py, pr * Math.sin(theta))
      }
    }

    // Standard quad indices
    for (let j = 0; j < radialSegs; j++) {
      for (let i = 0; i < tubularSegs; i++) {
        const a = j * (tubularSegs + 1) + i
        const b = a + 1
        const c = (j + 1) * (tubularSegs + 1) + i
        const d = c + 1

        indices.push(a, c, b)
        indices.push(b, c, d)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()

    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const initData = SphereWithTunnelSurface.getInitData()
    const gridU = initData.gridSegmentsU
    const gridV = initData.gridSegmentsV

    const vertices: number[] = []
    const lineDetail = 48

    // Lines around the ring (constant v, varying u/theta)
    const vSteps = gridV * 2
    for (let j = 0; j < vSteps; j++) {
      const { r, y } = this.profileAt(j / vSteps)

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          r * Math.cos(theta0), y, r * Math.sin(theta0),
          r * Math.cos(theta1), y, r * Math.sin(theta1),
        )
      }
    }

    // Lines around the cross-section (constant u, varying v)
    for (let i = 0; i < gridU; i++) {
      const theta = (i / gridU) * Math.PI * 2
      const cosTheta = Math.cos(theta)
      const sinTheta = Math.sin(theta)

      const profileDetail = gridV * 4
      for (let j = 0; j < profileDetail; j++) {
        const p0 = this.profileAt(j / profileDetail)
        const p1 = this.profileAt((j + 1) / profileDetail)

        vertices.push(
          p0.r * cosTheta, p0.y, p0.r * sinTheta,
          p1.r * cosTheta, p1.y, p1.r * sinTheta,
        )
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))

    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
