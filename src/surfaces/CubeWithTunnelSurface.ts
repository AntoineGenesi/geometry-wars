import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface CubeWithTunnelConfig extends SurfaceConfig {
  outerRadius?: number     // Radius of outer cylindrical wall (default: 5)
  tunnelRadius?: number    // Radius of inner tunnel (default: 2)
  halfHeight?: number      // Half the height of the shape (default: 3)
  bevelRadius?: number     // Radius of rounded corners (default: 0.5)
  gridSegmentsU?: number
  gridSegmentsV?: number
}

/**
 * Cube-with-tunnel surface: a thick washer/drum shape with a tunnel through the center.
 *
 * Cross-section profile (revolved around Y axis):
 *   1. Bottom lip (horizontal outward face)
 *   2. Bottom-outer bevel
 *   3. Outer wall (vertical face)
 *   4. Top-outer bevel
 *   5. Top lip (horizontal outward face)
 *   6. Top-tunnel bevel
 *   7. Inner tunnel wall (vertical inward face)
 *   8. Bottom-tunnel bevel
 *
 * Topologically a torus. Both u and v are periodic [0, 1).
 *   u: azimuthal angle around Y axis
 *   v: position around the cross-section profile
 */
export class CubeWithTunnelSurface extends Surface {
  private readonly outerRadius: number
  private readonly tunnelRadius: number
  private readonly halfHeight: number
  private readonly bevelRadius: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  private readonly lipLen: number
  private readonly wallLen: number
  private readonly cornerLen: number
  private readonly totalPerimeter: number

  constructor(config?: CubeWithTunnelConfig) {
    const outerRadius = config?.outerRadius ?? 5
    const tunnelRadius = config?.tunnelRadius ?? 2
    const halfHeight = config?.halfHeight ?? 3
    const bevelRadius = Math.min(
      config?.bevelRadius ?? 0.5,
      (outerRadius - tunnelRadius) / 2 - 0.01,
      halfHeight - 0.01,
    )
    const gridSegmentsU = config?.gridSegmentsU ?? 32
    const gridSegmentsV = config?.gridSegmentsV ?? 32

    ;(CubeWithTunnelSurface as any).__initData = {
      outerRadius, tunnelRadius, halfHeight, bevelRadius, gridSegmentsU, gridSegmentsV,
    }
    super(config)

    this.outerRadius = outerRadius
    this.tunnelRadius = tunnelRadius
    this.halfHeight = halfHeight
    this.bevelRadius = bevelRadius
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    const bR = bevelRadius
    this.lipLen = outerRadius - tunnelRadius - 2 * bR
    this.wallLen = 2 * halfHeight - 2 * bR
    this.cornerLen = (Math.PI / 2) * bR
    this.totalPerimeter = 2 * this.lipLen + 2 * this.wallLen + 4 * this.cornerLen

    this.surfaceRadius = outerRadius
    this.playerLocalPosition = new THREE.Vector3(outerRadius, 0, 0)
  }

  private static getInitData() {
    return (
      (CubeWithTunnelSurface as any).__initData ?? {
        outerRadius: 5, tunnelRadius: 2, halfHeight: 3, bevelRadius: 0.5,
        gridSegmentsU: 32, gridSegmentsV: 32,
      }
    )
  }

  private static computePerimeter(oR: number, tR: number, hH: number, bR: number) {
    const lipLen = oR - tR - 2 * bR
    const wallLen = 2 * hH - 2 * bR
    const cornerLen = (Math.PI / 2) * bR
    return 2 * lipLen + 2 * wallLen + 4 * cornerLen
  }

  /**
   * Cross-section profile at parameter t in [0, 1).
   * 8 segments forming a closed loop around the rectangular-with-hole cross-section.
   */
  private profileAt(t: number): { r: number; y: number; nr: number; ny: number } {
    const initData = CubeWithTunnelSurface.getInitData()
    const oR = this.outerRadius ?? initData.outerRadius
    const tR = this.tunnelRadius ?? initData.tunnelRadius
    const hH = this.halfHeight ?? initData.halfHeight
    const bR = this.bevelRadius ?? initData.bevelRadius

    const lipLen = oR - tR - 2 * bR
    const wallLen = 2 * hH - 2 * bR
    const cLen = (Math.PI / 2) * bR
    const totalP = 2 * lipLen + 2 * wallLen + 4 * cLen

    let pos = ((t % 1) + 1) % 1 * totalP
    let acc = 0

    // 1. Bottom lip: r from tR+bR to oR-bR, y = -hH, normal (0, -1)
    acc += lipLen
    if (pos < acc) {
      const lt = (pos - (acc - lipLen)) / lipLen
      return { r: (tR + bR) + lt * lipLen, y: -hH, nr: 0, ny: -1 }
    }

    // 2. Bottom-outer bevel: center (oR-bR, -hH+bR), angle -π/2 to 0
    acc += cLen
    if (pos < acc) {
      const a = -Math.PI / 2 + ((pos - (acc - cLen)) / cLen) * (Math.PI / 2)
      return {
        r: (oR - bR) + bR * Math.cos(a),
        y: (-hH + bR) + bR * Math.sin(a),
        nr: Math.cos(a), ny: Math.sin(a),
      }
    }

    // 3. Outer wall: r = oR, y from -hH+bR to hH-bR, normal (1, 0)
    acc += wallLen
    if (pos < acc) {
      const lt = (pos - (acc - wallLen)) / wallLen
      return { r: oR, y: (-hH + bR) + lt * wallLen, nr: 1, ny: 0 }
    }

    // 4. Top-outer bevel: center (oR-bR, hH-bR), angle 0 to π/2
    acc += cLen
    if (pos < acc) {
      const a = ((pos - (acc - cLen)) / cLen) * (Math.PI / 2)
      return {
        r: (oR - bR) + bR * Math.cos(a),
        y: (hH - bR) + bR * Math.sin(a),
        nr: Math.cos(a), ny: Math.sin(a),
      }
    }

    // 5. Top lip: r from oR-bR to tR+bR, y = hH, normal (0, 1)
    acc += lipLen
    if (pos < acc) {
      const lt = (pos - (acc - lipLen)) / lipLen
      return { r: (oR - bR) - lt * lipLen, y: hH, nr: 0, ny: 1 }
    }

    // 6. Top-tunnel bevel: center (tR+bR, hH-bR), angle π/2 to π
    acc += cLen
    if (pos < acc) {
      const a = Math.PI / 2 + ((pos - (acc - cLen)) / cLen) * (Math.PI / 2)
      return {
        r: (tR + bR) + bR * Math.cos(a),
        y: (hH - bR) + bR * Math.sin(a),
        nr: Math.cos(a), ny: Math.sin(a),
      }
    }

    // 7. Inner tunnel: r = tR, y from hH-bR to -hH+bR, normal (-1, 0)
    acc += wallLen
    if (pos < acc) {
      const lt = (pos - (acc - wallLen)) / wallLen
      return { r: tR, y: (hH - bR) - lt * wallLen, nr: -1, ny: 0 }
    }

    // 8. Bottom-tunnel bevel: center (tR+bR, -hH+bR), angle π to 3π/2
    const a = Math.PI + ((pos - acc) / cLen) * (Math.PI / 2)
    return {
      r: (tR + bR) + bR * Math.cos(a),
      y: (-hH + bR) + bR * Math.sin(a),
      nr: Math.cos(a), ny: Math.sin(a),
    }
  }

  getPoint(u: number, v: number): SurfacePoint {
    const phi = u * Math.PI * 2
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)

    const { r, y, nr, ny } = this.profileAt(v)

    const position = new THREE.Vector3(r * cosPhi, y, r * sinPhi)
    const normal = new THREE.Vector3(nr * cosPhi, ny, nr * sinPhi).normalize()
    const tangentU = new THREE.Vector3(-sinPhi, 0, cosPhi).normalize()

    // Tangent in v direction via finite difference
    const dv = 0.001
    const p1 = this.profileAt(v + dv)
    const p0 = this.profileAt(v - dv)
    const tangentV = new THREE.Vector3(
      (p1.r - p0.r) * cosPhi, p1.y - p0.y, (p1.r - p0.r) * sinPhi
    ).normalize()

    return { position, normal, tangentU, tangentV }
  }

  moveOnSurface(u: number, v: number, du: number, dv: number): { u: number; v: number } {
    const { r } = this.profileAt(v)
    const scaleFactor = r > 0.001 ? this.outerRadius / r : 1

    let newU = u + du * scaleFactor
    let newV = v + dv

    newU = ((newU % 1) + 1) % 1
    newV = ((newV % 1) + 1) % 1

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    let phi = Math.atan2(worldPos.z, worldPos.x)
    if (phi < 0) phi += Math.PI * 2
    const u = phi / (Math.PI * 2)

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

  isInsideTunnel(worldPos: THREE.Vector3): boolean {
    const rDist = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z)
    return Math.abs(worldPos.y) <= this.halfHeight && rDist <= this.tunnelRadius * 1.2
  }

  createMesh(): THREE.Mesh {
    const initData = CubeWithTunnelSurface.getInitData()
    const totalP = CubeWithTunnelSurface.computePerimeter(
      initData.outerRadius, initData.tunnelRadius, initData.halfHeight, initData.bevelRadius
    )

    const radialSegs = Math.max(initData.gridSegmentsV, 32)
    const targetStep = totalP / radialSegs
    const ringCircumference = 2 * Math.PI * initData.outerRadius
    const tubularSegs = Math.max(Math.round(ringCircumference / targetStep), 48)

    const positions: number[] = []
    const indices: number[] = []

    for (let j = 0; j <= radialSegs; j++) {
      const v = j / radialSegs
      const { r, y } = this.profileAt(v)

      for (let i = 0; i <= tubularSegs; i++) {
        const theta = (i / tubularSegs) * Math.PI * 2
        positions.push(r * Math.cos(theta), y, r * Math.sin(theta))
      }
    }

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
    const initData = CubeWithTunnelSurface.getInitData()
    const gridU = initData.gridSegmentsU
    const gridV = initData.gridSegmentsV

    const vertices: number[] = []
    const lineDetail = 48

    // Lines around the axis (constant v)
    const vSteps = gridV * 2
    for (let j = 0; j < vSteps; j++) {
      const { r, y } = this.profileAt(j / vSteps)
      for (let i = 0; i < lineDetail; i++) {
        const t0 = (i / lineDetail) * Math.PI * 2
        const t1 = ((i + 1) / lineDetail) * Math.PI * 2
        vertices.push(r * Math.cos(t0), y, r * Math.sin(t0))
        vertices.push(r * Math.cos(t1), y, r * Math.sin(t1))
      }
    }

    // Lines around cross-section (constant u)
    for (let i = 0; i < gridU; i++) {
      const theta = (i / gridU) * Math.PI * 2
      const ct = Math.cos(theta)
      const st = Math.sin(theta)
      const profileDetail = gridV * 4
      for (let j = 0; j < profileDetail; j++) {
        const p0 = this.profileAt(j / profileDetail)
        const p1 = this.profileAt((j + 1) / profileDetail)
        vertices.push(p0.r * ct, p0.y, p0.r * st)
        vertices.push(p1.r * ct, p1.y, p1.r * st)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
