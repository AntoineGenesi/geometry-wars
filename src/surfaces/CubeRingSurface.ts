import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface CubeRingConfig extends SurfaceConfig {
  majorRadius?: number // Distance from center to cross-section center (default 6)
  crossSection?: number // Side length of the square cross-section (default 3)
  bevelRadius?: number // Radius of rounded corners (default 0.4)
  gridSegmentsU?: number
  gridSegmentsV?: number
}

/**
 * Cube Ring Surface: a cube bent into a torus (ring) shape.
 *
 * Topologically a torus with square cross-section and beveled corners.
 * Playable on all 4 faces (outer, top, inner, bottom) with smooth
 * transitions at the rounded corners.
 *
 * UV mapping:
 *   u: [0, 1) around the ring (major circle, azimuthal)
 *   v: [0, 1) around the square cross-section (minor loop)
 *     v=0:    middle of outer face (farthest from center)
 *     v=0.25: middle of top face
 *     v=0.5:  middle of inner face (closest to center)
 *     v=0.75: middle of bottom face
 */
export class CubeRingSurface extends Surface {
  private readonly majorRadius: number
  private readonly halfSide: number
  private readonly bevelRadius: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  // Pre-computed profile lengths for uniform v-parametrization
  private readonly flatLen: number
  private readonly cornerLen: number
  private readonly totalPerimeter: number

  constructor(config?: CubeRingConfig) {
    const majorRadius = config?.majorRadius ?? 6
    const crossSection = config?.crossSection ?? 3
    const bevelRadius = config?.bevelRadius ?? 0.4
    const gridSegmentsU = config?.gridSegmentsU ?? 24
    const gridSegmentsV = config?.gridSegmentsV ?? 24

    const halfSide = crossSection / 2
    const clampedBevel = Math.min(bevelRadius, halfSide * 0.95)

    ;(CubeRingSurface as any).__initData = {
      majorRadius,
      halfSide,
      bevelRadius: clampedBevel,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.majorRadius = majorRadius
    this.halfSide = halfSide
    this.bevelRadius = clampedBevel
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    const flat = halfSide - clampedBevel
    this.flatLen = 2 * flat
    this.cornerLen = (Math.PI / 2) * clampedBevel
    this.totalPerimeter = 4 * this.flatLen + 4 * this.cornerLen

    this.surfaceRadius = majorRadius + halfSide
    this.playerLocalPosition = new THREE.Vector3(majorRadius + halfSide, 0, 0)
  }

  private static getInitData() {
    return (
      (CubeRingSurface as any).__initData ?? {
        majorRadius: 6,
        halfSide: 1.5,
        bevelRadius: 0.4,
        gridSegmentsU: 24,
        gridSegmentsV: 24,
      }
    )
  }

  /**
   * Compute cross-section profile at parameter t in [0, 1).
   * Returns radial offset (r) and height (y) from the ring center line,
   * plus the normal direction (nr, ny).
   */
  private profileAt(t: number): { r: number; y: number; nr: number; ny: number } {
    const initData = CubeRingSurface.getInitData()
    const H = this.halfSide ?? initData.halfSide
    const B = this.bevelRadius ?? initData.bevelRadius
    const flat = H - B

    // Convert t to position along perimeter
    const totalPerimeter = this.totalPerimeter ?? (4 * 2 * flat + 4 * (Math.PI / 2) * B)
    let pos = ((t % 1) + 1) % 1 * totalPerimeter
    let acc = 0

    // Segment 1: Outer flat (r=H, y from -flat to +flat)
    acc += 2 * flat
    if (pos < acc) {
      const lt = (pos - (acc - 2 * flat)) / (2 * flat)
      return { r: H, y: -flat + lt * 2 * flat, nr: 1, ny: 0 }
    }

    // Segment 2: Top-right corner (center at (flat, flat))
    const cLen = (Math.PI / 2) * B
    acc += cLen
    if (pos < acc) {
      const a = ((pos - (acc - cLen)) / cLen) * (Math.PI / 2)
      return { r: flat + B * Math.cos(a), y: flat + B * Math.sin(a), nr: Math.cos(a), ny: Math.sin(a) }
    }

    // Segment 3: Top flat (y=H, r from +flat to -flat)
    acc += 2 * flat
    if (pos < acc) {
      const lt = (pos - (acc - 2 * flat)) / (2 * flat)
      return { r: flat - lt * 2 * flat, y: H, nr: 0, ny: 1 }
    }

    // Segment 4: Top-left corner (center at (-flat, flat))
    acc += cLen
    if (pos < acc) {
      const a = Math.PI / 2 + ((pos - (acc - cLen)) / cLen) * (Math.PI / 2)
      return { r: -flat + B * Math.cos(a), y: flat + B * Math.sin(a), nr: Math.cos(a), ny: Math.sin(a) }
    }

    // Segment 5: Inner flat (r=-H, y from +flat to -flat)
    acc += 2 * flat
    if (pos < acc) {
      const lt = (pos - (acc - 2 * flat)) / (2 * flat)
      return { r: -H, y: flat - lt * 2 * flat, nr: -1, ny: 0 }
    }

    // Segment 6: Bottom-left corner (center at (-flat, -flat))
    acc += cLen
    if (pos < acc) {
      const a = Math.PI + ((pos - (acc - cLen)) / cLen) * (Math.PI / 2)
      return { r: -flat + B * Math.cos(a), y: -flat + B * Math.sin(a), nr: Math.cos(a), ny: Math.sin(a) }
    }

    // Segment 7: Bottom flat (y=-H, r from -flat to +flat)
    acc += 2 * flat
    if (pos < acc) {
      const lt = (pos - (acc - 2 * flat)) / (2 * flat)
      return { r: -flat + lt * 2 * flat, y: -H, nr: 0, ny: -1 }
    }

    // Segment 8: Bottom-right corner (center at (flat, -flat))
    const a = (3 * Math.PI) / 2 + ((pos - acc) / cLen) * (Math.PI / 2)
    return { r: flat + B * Math.cos(a), y: -flat + B * Math.sin(a), nr: Math.cos(a), ny: Math.sin(a) }
  }

  getPoint(u: number, v: number): SurfacePoint {
    const phi = u * Math.PI * 2 // Around ring
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)

    const { r, y, nr, ny } = this.profileAt(v)
    const R = this.majorRadius

    const position = new THREE.Vector3(
      (R + r) * cosPhi,
      y,
      (R + r) * sinPhi
    )

    const normal = new THREE.Vector3(
      nr * cosPhi,
      ny,
      nr * sinPhi
    ).normalize()

    // Tangent in u direction (around the ring)
    const tangentU = new THREE.Vector3(-sinPhi, 0, cosPhi).normalize()

    // Tangent in v direction (around cross-section) - finite difference
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
    dv: number
  ): { u: number; v: number } {
    const { r } = this.profileAt(v)
    const R = this.majorRadius

    // Scale du for varying circumference at different cross-section positions
    const localRadius = R + r
    const scaleFactor = localRadius > 0.001 ? R / localRadius : 1

    let newU = u + du * scaleFactor
    let newV = v + dv

    newU = ((newU % 1) + 1) % 1
    newV = ((newV % 1) + 1) % 1

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const R = this.majorRadius

    // Find phi (u) - angle around the ring
    let phi = Math.atan2(worldPos.z, worldPos.x)
    if (phi < 0) phi += Math.PI * 2

    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)

    // Radial distance from ring center axis
    const rDist = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z) - R
    const yDist = worldPos.y

    // Find closest v by checking distance to profile
    // Simple approach: sample v at N points and find minimum distance
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

    const u = phi / (Math.PI * 2)
    return { u, v: bestV }
  }

  createMesh(): THREE.Mesh {
    const { majorRadius, halfSide, bevelRadius, gridSegmentsU, gridSegmentsV } =
      CubeRingSurface.getInitData()

    const R = majorRadius
    const H = halfSide
    const B = bevelRadius
    const flat = H - B

    // Compute segment counts for balanced triangle aspect ratios.
    const crossPerimeter = 4 * 2 * flat + 4 * (Math.PI / 2) * B
    const ringCircumference = 2 * Math.PI * R
    const radialSegs = Math.max(gridSegmentsV, 24)
    const targetStep = crossPerimeter / radialSegs
    const tubularSegs = Math.max(Math.round(ringCircumference / targetStep), 48)

    // Use same vertex layout as THREE.TorusGeometry: duplicate vertices at both
    // seams (u and v), no index-buffer modulo wrapping.
    // This is the topology pattern proven to work with the geodesic walker.
    const positions: number[] = []
    const indices: number[] = []

    // j = radial (around cross-section), i = tubular (around ring)
    // Both go 0..N inclusive, creating duplicate vertices at seams.
    for (let j = 0; j <= radialSegs; j++) {
      const v = j / radialSegs
      const profile = this.profileAt(v)

      for (let i = 0; i <= tubularSegs; i++) {
        const phi = (i / tubularSegs) * Math.PI * 2

        positions.push(
          (R + profile.r) * Math.cos(phi),
          profile.y,
          (R + profile.r) * Math.sin(phi)
        )
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
    const { majorRadius, halfSide, bevelRadius, gridSegmentsU, gridSegmentsV } =
      CubeRingSurface.getInitData()

    const R = majorRadius
    const vertices: number[] = []
    const lineDetail = 48

    // Lines around the ring (constant v, varying u/phi)
    const vSteps = gridSegmentsV * 2
    for (let j = 0; j < vSteps; j++) {
      const v = j / vSteps
      const profile = this.profileAt(v)
      const ringR = R + profile.r

      for (let i = 0; i < lineDetail; i++) {
        const phi0 = (i / lineDetail) * Math.PI * 2
        const phi1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(ringR * Math.cos(phi0), profile.y, ringR * Math.sin(phi0))
        vertices.push(ringR * Math.cos(phi1), profile.y, ringR * Math.sin(phi1))
      }
    }

    // Lines around the cross-section (constant u, varying v)
    for (let i = 0; i < gridSegmentsU; i++) {
      const phi = (i / gridSegmentsU) * Math.PI * 2
      const cosPhi = Math.cos(phi)
      const sinPhi = Math.sin(phi)

      const profileDetail = gridSegmentsV * 4
      for (let j = 0; j < profileDetail; j++) {
        const v0 = j / profileDetail
        const v1 = (j + 1) / profileDetail
        const p0 = this.profileAt(v0)
        const p1 = this.profileAt(v1)

        vertices.push((R + p0.r) * cosPhi, p0.y, (R + p0.r) * sinPhi)
        vertices.push((R + p1.r) * cosPhi, p1.y, (R + p1.r) * sinPhi)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))

    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
