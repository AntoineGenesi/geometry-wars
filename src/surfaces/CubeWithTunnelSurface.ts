import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface CubeWithTunnelConfig extends SurfaceConfig {
  size?: number           // Outer cube dimension (default: 20)
  wallThickness?: number  // Wall thickness (default: 2.0)
  bevelRadius?: number    // Vertical edge bevel radius on spine (default: size * 0.12)
  gridSegments?: number   // Grid detail per face (default: 16)
}

/**
 * Cube Tunnel Surface: a hollow square tube (cube with top/bottom open).
 *
 * Cross-section through the wall forms a rounded rectangle:
 *   outer wall → top lip (semicircle) → inner wall → bottom lip (semicircle)
 *
 * The tube is extruded along a square path with beveled vertical edges.
 * Topologically a torus: both U and V are periodic.
 *
 * U [0,1): wraps around the square perimeter (4 faces + 4 corner bevels)
 * V [0,1): wraps around the wall cross-section
 *   - [0, owf):           outer wall (bottom to top)
 *   - [owf, owf+lf):      top lip semicircle
 *   - [owf+lf, 2*owf+lf): inner wall (top to bottom)
 *   - [2*owf+lf, 1):      bottom lip semicircle
 */
export class CubeWithTunnelSurface extends Surface {
  private readonly size: number
  private readonly wallThickness: number
  private readonly bevelRadius: number
  private readonly gridSegments: number

  private readonly halfSize: number
  private readonly lipRadius: number
  private readonly wallHeight: number
  private readonly spineHalfSize: number
  private readonly spineFlatHalfSize: number

  // V region fractions
  private readonly outerWallFrac: number
  private readonly lipFrac: number

  private static readonly FACE_NORMALS = [
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
  ]
  private static readonly FACE_RIGHTS = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 0, 1),
  ]

  constructor(config?: CubeWithTunnelConfig) {
    const size = config?.size ?? 20
    const wallThickness = config?.wallThickness ?? 2.0
    const minBevel = wallThickness / 2 + 0.1
    const bevelRadius = Math.max(config?.bevelRadius ?? size * 0.12, minBevel)
    const gridSegments = config?.gridSegments ?? 16

    ;(CubeWithTunnelSurface as any).__initData = { size, wallThickness, bevelRadius, gridSegments }
    super(config)

    this.size = size
    this.wallThickness = wallThickness
    this.bevelRadius = bevelRadius
    this.gridSegments = gridSegments
    this.halfSize = size / 2
    this.lipRadius = wallThickness / 2
    this.wallHeight = this.halfSize - this.lipRadius
    this.spineHalfSize = this.halfSize - this.lipRadius
    this.spineFlatHalfSize = this.spineHalfSize - this.bevelRadius

    const outerWallLen = 2 * this.wallHeight
    const lipLen = Math.PI * this.lipRadius
    const totalV = 2 * outerWallLen + 2 * lipLen
    this.outerWallFrac = outerWallLen / totalV
    this.lipFrac = lipLen / totalV

    this.surfaceRadius = this.halfSize + this.bevelRadius * 0.5
    const spawnPoint = this.getPointLocal(0.125, this.outerWallFrac * 0.5)
    this.playerLocalPosition = spawnPoint.position
  }

  private static getInitData() {
    return (CubeWithTunnelSurface as any).__initData ?? {
      size: 20, wallThickness: 2.0, bevelRadius: 2.4, gridSegments: 16,
    }
  }

  /** Compute all derived values from initData or instance fields. Safe during construction. */
  private getDerivedValues() {
    if (this.size !== undefined) {
      return {
        halfSize: this.halfSize,
        lipRadius: this.lipRadius,
        wallHeight: this.wallHeight,
        spineHalfSize: this.spineHalfSize,
        spineFlatHalfSize: this.spineFlatHalfSize,
        bevelRadius: this.bevelRadius,
        outerWallFrac: this.outerWallFrac,
        lipFrac: this.lipFrac,
      }
    }
    const { size, wallThickness, bevelRadius } = CubeWithTunnelSurface.getInitData()
    const halfSize = size / 2
    const lipRadius = wallThickness / 2
    const wallHeight = halfSize - lipRadius
    const spineHalfSize = halfSize - lipRadius
    const spineFlatHalfSize = spineHalfSize - bevelRadius
    const outerWallLen = 2 * wallHeight
    const lipLen = Math.PI * lipRadius
    const totalV = 2 * outerWallLen + 2 * lipLen
    return {
      halfSize, lipRadius, wallHeight, spineHalfSize, spineFlatHalfSize,
      bevelRadius, outerWallFrac: outerWallLen / totalV, lipFrac: lipLen / totalV,
    }
  }

  private getVRegion(v: number, derived?: ReturnType<typeof this.getDerivedValues>): {
    type: 'outerWall' | 'topLip' | 'innerWall' | 'bottomLip'; localT: number
  } {
    const vw = ((v % 1) + 1) % 1
    const { outerWallFrac: owf, lipFrac: lf } = derived ?? this.getDerivedValues()

    if (vw < owf) {
      return { type: 'outerWall', localT: owf > 0 ? vw / owf : 0.5 }
    } else if (vw < owf + lf) {
      return { type: 'topLip', localT: lf > 0 ? (vw - owf) / lf : 0 }
    } else if (vw < 2 * owf + lf) {
      return { type: 'innerWall', localT: owf > 0 ? (vw - owf - lf) / owf : 0.5 }
    } else {
      return { type: 'bottomLip', localT: lf > 0 ? (vw - 2 * owf - lf) / lf : 0 }
    }
  }

  private getURegion(u: number, derived?: ReturnType<typeof this.getDerivedValues>): { faceIndex: number; type: 'face' | 'bevel'; localS: number } {
    const d = derived ?? this.getDerivedValues()
    const faceWidth = 2 * d.spineFlatHalfSize
    const bevelWidth = (Math.PI / 2) * d.bevelRadius
    const segmentWidth = faceWidth + bevelWidth
    const totalWidth = 4 * segmentWidth

    const scaledU = ((u % 1) + 1) % 1
    const posInTotal = scaledU * totalWidth
    const segmentIndex = Math.floor(posInTotal / segmentWidth)
    const posInSegment = posInTotal - segmentIndex * segmentWidth

    if (posInSegment < faceWidth) {
      return { faceIndex: segmentIndex % 4, type: 'face', localS: faceWidth > 0 ? posInSegment / faceWidth : 0.5 }
    } else {
      return { faceIndex: segmentIndex % 4, type: 'bevel', localS: bevelWidth > 0 ? (posInSegment - faceWidth) / bevelWidth : 0 }
    }
  }

  /**
   * Cross-section profile: maps V to (nOffset, yOffset) relative to spine,
   * plus normal direction in the spine-outward / Y plane.
   */
  private getProfile(v: number, derived?: ReturnType<typeof this.getDerivedValues>): {
    nOffset: number; yOffset: number; normalN: number; normalY: number
  } {
    const d = derived ?? this.getDerivedValues()
    const vRegion = this.getVRegion(v, d)
    const lR = d.lipRadius
    const wH = d.wallHeight

    switch (vRegion.type) {
      case 'outerWall':
        return { nOffset: lR, yOffset: (2 * vRegion.localT - 1) * wH, normalN: 1, normalY: 0 }
      case 'topLip': {
        const a = vRegion.localT * Math.PI
        return { nOffset: lR * Math.cos(a), yOffset: wH + lR * Math.sin(a), normalN: Math.cos(a), normalY: Math.sin(a) }
      }
      case 'innerWall':
        return { nOffset: -lR, yOffset: (1 - 2 * vRegion.localT) * wH, normalN: -1, normalY: 0 }
      case 'bottomLip': {
        const a = Math.PI + vRegion.localT * Math.PI
        return { nOffset: lR * Math.cos(a), yOffset: -wH + lR * Math.sin(a), normalN: Math.cos(a), normalY: Math.sin(a) }
      }
    }
  }

  /** Point on the square spine at U. Returns position, outward normal, tangent. */
  private getSpinePoint(u: number, derived?: ReturnType<typeof this.getDerivedValues>): {
    position: THREE.Vector3; outward: THREE.Vector3; tangent: THREE.Vector3
  } {
    const d = derived ?? this.getDerivedValues()
    const uRegion = this.getURegion(u, d)
    const fn = CubeWithTunnelSurface.FACE_NORMALS[uRegion.faceIndex]
    const fr = CubeWithTunnelSurface.FACE_RIGHTS[uRegion.faceIndex]

    if (uRegion.type === 'face') {
      const x = (uRegion.localS - 0.5) * 2 * d.spineFlatHalfSize
      return {
        position: fn.clone().multiplyScalar(d.spineHalfSize).add(fr.clone().multiplyScalar(x)),
        outward: fn.clone(),
        tangent: fr.clone(),
      }
    } else {
      const a = uRegion.localS * (Math.PI / 2)
      const nextFn = CubeWithTunnelSurface.FACE_NORMALS[(uRegion.faceIndex + 1) % 4]
      const cornerCenter = fn.clone().multiplyScalar(d.spineFlatHalfSize)
        .add(nextFn.clone().multiplyScalar(d.spineFlatHalfSize))
      const blended = fn.clone().multiplyScalar(Math.cos(a))
        .add(nextFn.clone().multiplyScalar(Math.sin(a)))
      return {
        position: cornerCenter.clone().add(blended.clone().multiplyScalar(d.bevelRadius)),
        outward: blended.clone(),
        tangent: fn.clone().multiplyScalar(-Math.sin(a)).add(nextFn.clone().multiplyScalar(Math.cos(a))),
      }
    }
  }

  private getPointLocal(u: number, v: number): SurfacePoint {
    const derived = this.getDerivedValues()
    const spine = this.getSpinePoint(u, derived)
    const profile = this.getProfile(v, derived)

    const position = spine.position.clone()
      .add(spine.outward.clone().multiplyScalar(profile.nOffset))
      .add(new THREE.Vector3(0, profile.yOffset, 0))

    const normal = spine.outward.clone().multiplyScalar(profile.normalN)
      .add(new THREE.Vector3(0, profile.normalY, 0))
      .normalize()

    const tangentU = spine.tangent.clone()

    const vRegion = this.getVRegion(v, derived)
    let tangentV: THREE.Vector3
    if (vRegion.type === 'outerWall') {
      tangentV = new THREE.Vector3(0, 1, 0)
    } else if (vRegion.type === 'innerWall') {
      tangentV = new THREE.Vector3(0, -1, 0)
    } else {
      const isTop = vRegion.type === 'topLip'
      const a = isTop ? vRegion.localT * Math.PI : Math.PI + vRegion.localT * Math.PI
      tangentV = spine.outward.clone().multiplyScalar(-Math.sin(a))
        .add(new THREE.Vector3(0, Math.cos(a), 0))
        .normalize()
    }

    return { position, normal, tangentU, tangentV }
  }

  getPoint(u: number, v: number): SurfacePoint {
    return this.applyWorldRotation(this.getPointLocal(u, v))
  }

  moveOnSurface(u: number, v: number, du: number, dv: number): { u: number; v: number } {
    const uRegion = this.getURegion(u)
    const profile = this.getProfile(v)

    let correctedDu = du
    if (uRegion.type === 'bevel') {
      const effectiveRadius = this.bevelRadius + profile.nOffset
      if (effectiveRadius > 0.01) {
        correctedDu = du * this.bevelRadius / effectiveRadius
      }
    }

    let newU = u + correctedDu
    let newV = v + dv

    newU = ((newU % 1) + 1) % 1
    newV = ((newV % 1) + 1) % 1

    return { u: newU, v: newV }
  }

  /** CubeWithTunnel wraps in both U and V (torus-like topology). */
  get wrapsV(): boolean { return true }

  /**
   * Returns true if playerV and enemyV are on geometrically opposite walls
   * (one on the outer wall, the other on the inner wall).
   * This prevents the proximity UV override from brightening enemies that are
   * UV-close but physically separated by the tunnel lip/wall boundary.
   */
  areOnOppositeWallSides(playerV: number, enemyV: number): boolean {
    const owf = this.outerWallFrac
    const lf = this.lipFrac
    const pNorm = ((playerV % 1) + 1) % 1
    const eNorm = ((enemyV % 1) + 1) % 1
    const isOuterWall = (v: number) => v < owf
    const isInnerWall = (v: number) => v >= owf + lf && v < 2 * owf + lf
    return (isOuterWall(pNorm) && isInnerWall(eNorm)) ||
           (isInnerWall(pNorm) && isOuterWall(eNorm))
  }

  wrapUV(u: number, v: number): { u: number; v: number } {
    return {
      u: ((u % 1) + 1) % 1,
      v: ((v % 1) + 1) % 1,
    }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const x = worldPos.x
    const y = worldPos.y
    const z = worldPos.z
    const absX = Math.abs(x)
    const absZ = Math.abs(z)

    const sfhs = this.spineFlatHalfSize
    const faceWidth = 2 * sfhs
    const bevelWidth = (Math.PI / 2) * this.bevelRadius
    const segmentWidth = faceWidth + bevelWidth
    const totalWidth = 4 * segmentWidth

    // Determine U from XZ position (which face of the square)
    let u: number

    if (absZ >= absX) {
      if (z >= 0) {
        if (absX <= sfhs) {
          u = ((x / sfhs + 1) / 2 * faceWidth) / totalWidth
        } else if (x > 0) {
          const angle = Math.atan2(x - sfhs, z - sfhs)
          u = (faceWidth + Math.max(0, Math.min(1, angle / (Math.PI / 2))) * bevelWidth) / totalWidth
        } else {
          const angle = Math.atan2(-x - sfhs, z - sfhs)
          const localS = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
          u = localS <= 0
            ? (3 * segmentWidth + faceWidth + bevelWidth) / totalWidth
            : (localS * faceWidth) / totalWidth
        }
      } else {
        const base = 2 * segmentWidth
        if (absX <= sfhs) {
          u = (base + ((-x / sfhs + 1) / 2 * faceWidth)) / totalWidth
        } else if (x < 0) {
          const angle = Math.atan2(-x - sfhs, -z - sfhs)
          u = (base + faceWidth + Math.max(0, Math.min(1, angle / (Math.PI / 2))) * bevelWidth) / totalWidth
        } else {
          const angle = Math.atan2(x - sfhs, -z - sfhs)
          u = (base + (1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))) * faceWidth) / totalWidth
        }
      }
    } else {
      if (x >= 0) {
        const base = segmentWidth
        if (absZ <= sfhs) {
          u = (base + ((-z / sfhs + 1) / 2 * faceWidth)) / totalWidth
        } else if (z < 0) {
          const angle = Math.atan2(-z - sfhs, x - sfhs)
          u = (base + faceWidth + Math.max(0, Math.min(1, angle / (Math.PI / 2))) * bevelWidth) / totalWidth
        } else {
          const angle = Math.atan2(z - sfhs, x - sfhs)
          u = (base + (1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))) * faceWidth) / totalWidth
        }
      } else {
        const base = 3 * segmentWidth
        if (absZ <= sfhs) {
          u = (base + ((z / sfhs + 1) / 2 * faceWidth)) / totalWidth
        } else if (z > 0) {
          const angle = Math.atan2(z - sfhs, -x - sfhs)
          u = (base + faceWidth + Math.max(0, Math.min(1, angle / (Math.PI / 2))) * bevelWidth) / totalWidth
        } else {
          const angle = Math.atan2(-z - sfhs, -x - sfhs)
          u = (base + (1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))) * faceWidth) / totalWidth
        }
      }
    }

    u = ((u % 1) + 1) % 1

    // Determine V from offset relative to spine
    const spine = this.getSpinePoint(u)
    const toPos = new THREE.Vector3(x - spine.position.x, 0, z - spine.position.z)
    const nOffset = toPos.dot(spine.outward)
    const owf = this.outerWallFrac
    const lf = this.lipFrac
    const wH = this.wallHeight
    let v: number

    if (y > wH) {
      // Top lip region
      const angle = Math.atan2(y - wH, nOffset)
      v = owf + Math.max(0, Math.min(1, angle / Math.PI)) * lf
    } else if (y < -wH) {
      // Bottom lip region
      const angle = Math.atan2(-(y + wH), -nOffset)
      v = 2 * owf + lf + Math.max(0, Math.min(1, angle / Math.PI)) * lf
    } else if (nOffset >= 0) {
      // Outer wall
      v = Math.max(0.001, Math.min(owf - 0.001, ((y + wH) / (2 * wH)) * owf))
    } else {
      // Inner wall
      v = owf + lf + Math.max(0.001, Math.min(owf - 0.001, ((wH - y) / (2 * wH)) * owf))
    }

    return { u, v: ((v % 1) + 1) % 1 }
  }

  isInsideTunnel(worldPos: THREE.Vector3): boolean {
    const innerHS = this.halfSize - this.wallThickness
    return Math.abs(worldPos.y) <= this.halfSize
      && Math.abs(worldPos.x) <= innerHS
      && Math.abs(worldPos.z) <= innerHS
  }

  createMesh(): THREE.Mesh {
    const initData = CubeWithTunnelSurface.getInitData()
    const segments = initData.gridSegments * 4
    const uSegs = segments
    const vSegs = segments
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    for (let j = 0; j <= vSegs; j++) {
      for (let i = 0; i <= uSegs; i++) {
        const u = i / uSegs
        const v = j / vSegs
        const point = this.getPointLocal(u, v)
        positions.push(point.position.x, point.position.y, point.position.z)
        normals.push(point.normal.x, point.normal.y, point.normal.z)
        uvs.push(u, v)
      }
    }

    for (let j = 0; j < vSegs; j++) {
      for (let i = 0; i < uSegs; i++) {
        const a = j * (uSegs + 1) + i
        const b = a + 1
        const c = a + uSegs + 1
        const d = c + 1
        indices.push(a, b, c)
        indices.push(b, d, c)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)

    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const lineDetail = 32
    const vertices: number[] = []
    const derived = this.getDerivedValues()
    const owf = derived.outerWallFrac
    const lf = derived.lipFrac

    // Horizontal lines (constant V)
    const vLines = [
      0,                     // outer wall bottom
      owf * 0.5,             // outer wall mid
      owf,                   // top lip start
      owf + lf * 0.5,        // top lip mid
      owf + lf,              // inner wall top
      owf + lf + owf * 0.5,  // inner wall mid
      2 * owf + lf,          // bottom lip start
      2 * owf + lf + lf * 0.5, // bottom lip mid
    ]
    for (const v of vLines) {
      for (let i = 0; i < lineDetail * 4; i++) {
        const u0 = i / (lineDetail * 4)
        const u1 = (i + 1) / (lineDetail * 4)
        const p0 = this.getPointLocal(u0, v)
        const p1 = this.getPointLocal(u1, v)
        vertices.push(p0.position.x, p0.position.y, p0.position.z)
        vertices.push(p1.position.x, p1.position.y, p1.position.z)
      }
    }

    // Vertical lines (constant U): along each face + bevel edges
    const faceWidth = 2 * derived.spineFlatHalfSize
    const bevelWidth = (Math.PI / 2) * derived.bevelRadius
    const segmentWidth = faceWidth + bevelWidth
    const totalWidth = 4 * segmentWidth
    const initData = CubeWithTunnelSurface.getInitData()
    const linesPerFace = Math.max(2, Math.floor(initData.gridSegments / 2))

    for (let face = 0; face < 4; face++) {
      // Face lines
      for (let i = 0; i <= linesPerFace; i++) {
        const localS = i / linesPerFace
        const u = (face * segmentWidth + localS * faceWidth) / totalWidth
        for (let j = 0; j < lineDetail * 2; j++) {
          const v0 = j / (lineDetail * 2)
          const v1 = (j + 1) / (lineDetail * 2)
          const p0 = this.getPointLocal(u, v0)
          const p1 = this.getPointLocal(u, v1)
          vertices.push(p0.position.x, p0.position.y, p0.position.z)
          vertices.push(p1.position.x, p1.position.y, p1.position.z)
        }
      }
      // Bevel center line
      const bevelU = (face * segmentWidth + faceWidth + 0.5 * bevelWidth) / totalWidth
      for (let j = 0; j < lineDetail * 2; j++) {
        const v0 = j / (lineDetail * 2)
        const v1 = (j + 1) / (lineDetail * 2)
        const p0 = this.getPointLocal(bevelU, v0)
        const p1 = this.getPointLocal(bevelU, v1)
        vertices.push(p0.position.x, p0.position.y, p0.position.z)
        vertices.push(p1.position.x, p1.position.y, p1.position.z)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
