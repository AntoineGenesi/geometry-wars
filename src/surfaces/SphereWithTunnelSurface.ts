import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface SphereWithTunnelConfig extends SurfaceConfig {
  radius?: number          // Outer sphere radius (default: 8)
  tunnelRadius?: number    // Radius of the tunnel (default: 2)
  tunnelAxis?: 'x' | 'y' | 'z'  // Kept for backward compat, always uses 'y'
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
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  // Derived geometry
  private readonly holeAngle: number        // asin(tunnelRadius / radius)
  private readonly tunnelHalfLen: number     // radius * cos(holeAngle)

  // Profile arc lengths
  private readonly sphereArcLen: number      // Arc of outer sphere between holes
  private readonly tunnelLength: number      // Full tunnel length (2 * tunnelHalfLen)
  private readonly totalPerimeter: number    // Sum of all segments

  constructor(config?: SphereWithTunnelConfig) {
    const radius = config?.radius ?? 8
    const tunnelRadius = config?.tunnelRadius ?? 2
    const gridSegmentsU = config?.gridSegmentsU ?? 32
    const gridSegmentsV = config?.gridSegmentsV ?? 32

    ;(SphereWithTunnelSurface as any).__initData = {
      radius,
      tunnelRadius,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.radius = radius
    this.tunnelRadius = Math.min(tunnelRadius, radius * 0.5)
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    this.holeAngle = Math.asin(this.tunnelRadius / this.radius)
    this.tunnelHalfLen = this.radius * Math.cos(this.holeAngle)

    this.sphereArcLen = (Math.PI - 2 * this.holeAngle) * this.radius
    this.tunnelLength = 2 * this.tunnelHalfLen
    this.totalPerimeter = this.sphereArcLen + this.tunnelLength

    this.surfaceRadius = radius
    // Player spawns on equator (outer sphere, widest point)
    this.playerLocalPosition = new THREE.Vector3(radius, 0, 0)
  }

  private static getInitData() {
    return (
      (SphereWithTunnelSurface as any).__initData ?? {
        radius: 8,
        tunnelRadius: 2,
        gridSegmentsU: 32,
        gridSegmentsV: 32,
      }
    )
  }

  /**
   * Cross-section profile at parameter t in [0, 1).
   * Returns (r, y) position and (nr, ny) outward normal direction.
   *
   * The profile traces a closed loop:
   *   Segment 1 (outer sphere): bottom hole → equator → top hole
   *   Segment 2 (inner tunnel): top hole → center → bottom hole
   */
  private profileAt(t: number): { r: number; y: number; nr: number; ny: number } {
    const initData = SphereWithTunnelSurface.getInitData()
    const R = this.radius ?? initData.radius
    const tr = this.tunnelRadius ?? Math.min(initData.tunnelRadius, R * 0.5)
    const ha = this.holeAngle ?? Math.asin(tr / R)
    const hLen = this.tunnelHalfLen ?? R * Math.cos(ha)

    const sArc = this.sphereArcLen ?? (Math.PI - 2 * ha) * R
    const tLen = this.tunnelLength ?? 2 * hLen
    const totalP = this.totalPerimeter ?? sArc + tLen

    const pos = ((t % 1) + 1) % 1 * totalP

    // Segment 1: Outer sphere arc
    // phi goes from (PI - ha) at bottom hole to ha at top hole
    if (pos < sArc) {
      const localT = pos / sArc
      const phi = (Math.PI - ha) - localT * (Math.PI - 2 * ha)
      return {
        r: R * Math.sin(phi),
        y: R * Math.cos(phi),
        nr: Math.sin(phi),
        ny: Math.cos(phi),
      }
    }

    // Segment 2: Tunnel (from top hole down to bottom hole)
    // y goes from +hLen to -hLen, r = tunnelRadius, normal points inward
    const localT = (pos - sArc) / tLen
    return {
      r: tr,
      y: hLen * (1 - 2 * localT),
      nr: -1,
      ny: 0,
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
    const ha = Math.asin(tr / R)
    const hLen = R * Math.cos(ha)

    const sArc = (Math.PI - 2 * ha) * R
    const tLen = 2 * hLen
    const totalP = sArc + tLen

    // Compute segment counts for balanced triangle aspect ratios
    const radialSegs = Math.max(initData.gridSegmentsV, 32)
    const targetStep = totalP / radialSegs
    const ringCircumference = 2 * Math.PI * R
    const tubularSegs = Math.max(Math.round(ringCircumference / targetStep), 48)

    const positions: number[] = []
    const indices: number[] = []

    // j = radial (around cross-section), i = tubular (around Y axis)
    // Both go 0..N inclusive, creating duplicate vertices at seams
    for (let j = 0; j <= radialSegs; j++) {
      const v = j / radialSegs

      // Inline profileAt to avoid issues during super() construction
      const posV = v * totalP
      let pr: number, py: number

      if (posV < sArc) {
        const localT = posV / sArc
        const phi = (Math.PI - ha) - localT * (Math.PI - 2 * ha)
        pr = R * Math.sin(phi)
        py = R * Math.cos(phi)
      } else {
        const localT = (posV - sArc) / tLen
        py = hLen * (1 - 2 * localT)
        pr = tr
      }

      for (let i = 0; i <= tubularSegs; i++) {
        const theta = (i / tubularSegs) * Math.PI * 2
        positions.push(pr * Math.cos(theta), py, pr * Math.sin(theta))
      }
    }

    // Standard quad indices (no modulo wrapping)
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
    const R = initData.radius
    const tr = Math.min(initData.tunnelRadius, R * 0.5)
    const ha = Math.asin(tr / R)
    const hLen = R * Math.cos(ha)

    const sArc = (Math.PI - 2 * ha) * R
    const tLen = 2 * hLen
    const totalP = sArc + tLen
    const gridU = initData.gridSegmentsU
    const gridV = initData.gridSegmentsV

    const vertices: number[] = []
    const lineDetail = 48

    // Helper: compute (r, y) from v parameter
    const getProfile = (v: number): { r: number; y: number } => {
      const posV = ((v % 1) + 1) % 1 * totalP
      if (posV < sArc) {
        const localT = posV / sArc
        const phi = (Math.PI - ha) - localT * (Math.PI - 2 * ha)
        return { r: R * Math.sin(phi), y: R * Math.cos(phi) }
      }
      const localT = (posV - sArc) / tLen
      return { r: tr, y: hLen * (1 - 2 * localT) }
    }

    // Lines around the ring (constant v, varying u/theta)
    const vSteps = gridV * 2
    for (let j = 0; j < vSteps; j++) {
      const { r, y } = getProfile(j / vSteps)

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
        const p0 = getProfile(j / profileDetail)
        const p1 = getProfile((j + 1) / profileDetail)

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
