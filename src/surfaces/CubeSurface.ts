import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface CubeConfig extends SurfaceConfig {
  size?: number
  bevelRadius?: number
  gridSegments?: number
}

/**
 * Beveled Cube Surface - A cube with rounded/beveled edges for smooth traversal.
 *
 * The cube is parameterized as:
 * - u in [0, 1): wraps around the cube horizontally (4 side faces + 4 vertical bevels)
 * - v in [0, 1]: goes from bottom to top
 *
 * V regions (from bottom to top):
 * - [0, bevelFraction]: bottom face corner bevels + bottom face
 * - [bevelFraction, 1-bevelFraction]: middle belt (4 side faces + 4 vertical bevels)
 * - [1-bevelFraction, 1]: top face + top face corner bevels
 *
 * U regions (around the horizontal belt):
 * Each of the 4 sides is split into:
 * - flat face region
 * - vertical bevel region (cylindrical arc connecting to next face)
 */
export class CubeSurface extends Surface {
  private readonly size: number
  private readonly bevelRadius: number
  private readonly gridSegments: number
  private readonly halfSize: number
  private readonly flatHalfSize: number // half size of flat face region
  private readonly bevelFraction: number // fraction of v used by top/bottom bevels

  constructor(config?: CubeConfig) {
    const size = config?.size ?? 10
    const bevelRadius = config?.bevelRadius ?? size * 0.15
    const gridSegments = config?.gridSegments ?? 12

    ;(CubeSurface as any).__initData = { size, bevelRadius, gridSegments }
    super(config)

    this.size = size
    this.bevelRadius = Math.min(bevelRadius, size * 0.4) // clamp to prevent overlap
    this.gridSegments = gridSegments
    this.halfSize = size / 2
    this.flatHalfSize = this.halfSize - this.bevelRadius

    // The bevel arc length is PI/2 * bevelRadius
    // Total height = flatHalfSize * 2 (top + bottom flat) + 2 * halfSize (middle) + 2 * bevelRadius * PI/2 (top + bottom arcs)
    // We'll use a simpler approximation: bevel region takes proportional space
    const totalHeight = size + Math.PI * this.bevelRadius
    this.bevelFraction = (this.bevelRadius * Math.PI / 2) / totalHeight

    // Set base class properties for generic rotation system
    this.surfaceRadius = this.halfSize + this.bevelRadius * 0.5
    // Player spawns on the +Z face of the cube (front face, middle height)
    // At u=0.125 (center of +Z face), v=0.5 (middle of middle belt)
    const spawnPoint = this.getPointLocal(0.125, 0.5)
    this.playerLocalPosition = spawnPoint.position
  }

  private static getInitData(): { size: number; bevelRadius: number; gridSegments: number } {
    return (CubeSurface as any).__initData ?? { size: 10, bevelRadius: 1.5, gridSegments: 12 }
  }

  /**
   * Get derived values - used by getPointLocal during construction when instance vars aren't set yet.
   */
  private getDerivedValues(): {
    size: number
    bevelRadius: number
    halfSize: number
    flatHalfSize: number
    bevelFraction: number
  } {
    // Use instance values if available, otherwise fall back to static init data
    if (this.size !== undefined) {
      return {
        size: this.size,
        bevelRadius: this.bevelRadius,
        halfSize: this.halfSize,
        flatHalfSize: this.flatHalfSize,
        bevelFraction: this.bevelFraction,
      }
    }
    // Fall back to static data during construction
    const { size, bevelRadius } = CubeSurface.getInitData()
    const clampedBevel = Math.min(bevelRadius, size * 0.4)
    const halfSize = size / 2
    const flatHalfSize = halfSize - clampedBevel
    const totalHeight = size + Math.PI * clampedBevel
    const bevelFraction = (clampedBevel * Math.PI / 2) / totalHeight
    return { size, bevelRadius: clampedBevel, halfSize, flatHalfSize, bevelFraction }
  }

  /**
   * Get the region type and local parameter for a given v coordinate.
   */
  private getVRegion(v: number, derived?: ReturnType<typeof this.getDerivedValues>): {
    type: 'bottom' | 'middle' | 'top'
    localT: number
  } {
    const { bevelFraction } = derived ?? this.getDerivedValues()
    if (v <= bevelFraction) {
      return { type: 'bottom', localT: v / bevelFraction }
    } else if (v >= 1 - bevelFraction) {
      return { type: 'top', localT: (v - (1 - bevelFraction)) / bevelFraction }
    } else {
      return {
        type: 'middle',
        localT: (v - bevelFraction) / (1 - 2 * bevelFraction),
      }
    }
  }

  /**
   * Get the horizontal region type and local parameter for a given u coordinate.
   * The belt is divided into 8 regions: 4 flat faces and 4 corner bevels.
   */
  private getURegion(u: number, derived?: ReturnType<typeof this.getDerivedValues>): {
    faceIndex: number // 0-3 for the 4 side faces (+Z, +X, -Z, -X)
    type: 'face' | 'bevel'
    localS: number // 0-1 within this region
  } {
    const { flatHalfSize, bevelRadius } = derived ?? this.getDerivedValues()
    // Calculate the fraction of u taken by each face vs bevel
    // Face width (flat) = 2 * flatHalfSize, Bevel arc = PI/2 * bevelRadius
    const faceWidth = 2 * flatHalfSize
    const bevelWidth = (Math.PI / 2) * bevelRadius
    const segmentWidth = faceWidth + bevelWidth
    const totalWidth = 4 * segmentWidth

    const scaledU = ((u % 1) + 1) % 1 // ensure in [0,1)
    const posInTotal = scaledU * totalWidth

    const segmentIndex = Math.floor(posInTotal / segmentWidth)
    const posInSegment = posInTotal - segmentIndex * segmentWidth

    if (posInSegment < faceWidth) {
      return {
        faceIndex: segmentIndex % 4,
        type: 'face',
        localS: posInSegment / faceWidth,
      }
    } else {
      return {
        faceIndex: segmentIndex % 4,
        type: 'bevel',
        localS: (posInSegment - faceWidth) / bevelWidth,
      }
    }
  }

  /**
   * Get 3D position on the surface in local coordinates.
   */
  private getPointLocal(u: number, v: number): SurfacePoint {
    const derived = this.getDerivedValues()
    const { halfSize, flatHalfSize, bevelRadius } = derived
    const vRegion = this.getVRegion(v, derived)
    const uRegion = this.getURegion(u, derived)

    let position: THREE.Vector3
    let normal: THREE.Vector3
    let tangentU: THREE.Vector3
    let tangentV: THREE.Vector3

    // Face normals and directions for the 4 side faces
    // faceIndex: 0 = +Z, 1 = +X, 2 = -Z, 3 = -X
    const faceNormals = [
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(-1, 0, 0),
    ]

    // Right direction along the face (positive u direction)
    const faceRights = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
    ]

    const faceNorm = faceNormals[uRegion.faceIndex]
    const faceRight = faceRights[uRegion.faceIndex]
    const nextFaceNorm = faceNormals[(uRegion.faceIndex + 1) % 4]

    if (vRegion.type === 'middle') {
      // Middle belt: side faces and vertical bevels
      const y = (vRegion.localT - 0.5) * 2 * flatHalfSize

      if (uRegion.type === 'face') {
        // Flat face
        const x = (uRegion.localS - 0.5) * 2 * flatHalfSize
        position = faceNorm.clone().multiplyScalar(halfSize)
          .add(faceRight.clone().multiplyScalar(x))
          .add(new THREE.Vector3(0, y, 0))
        normal = faceNorm.clone()
        tangentU = faceRight.clone()
        tangentV = new THREE.Vector3(0, 1, 0)
      } else {
        // Vertical bevel (cylindrical section connecting two faces)
        const angle = uRegion.localS * (Math.PI / 2)
        const blendedNormal = faceNorm.clone().multiplyScalar(Math.cos(angle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.sin(angle)))

        // Center of the bevel cylinder edge
        const edgeCenter = faceNorm.clone().multiplyScalar(flatHalfSize)
          .add(nextFaceNorm.clone().multiplyScalar(flatHalfSize))

        position = edgeCenter.clone()
          .add(blendedNormal.clone().multiplyScalar(bevelRadius))
          .add(new THREE.Vector3(0, y, 0))

        normal = blendedNormal.clone().normalize()
        // Tangent along the bevel arc
        tangentU = faceNorm.clone().multiplyScalar(-Math.sin(angle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.cos(angle)))
          .normalize()
        tangentV = new THREE.Vector3(0, 1, 0)
      }
    } else if (vRegion.type === 'bottom') {
      // Bottom region: spherical corners and cylindrical edge bevels leading to bottom face
      const bevelAngle = (1 - vRegion.localT) * (Math.PI / 2) // from flat (0) to horizontal (PI/2)
      const cosAngle = Math.cos(bevelAngle)
      const sinAngle = Math.sin(bevelAngle)
      const y = -flatHalfSize - bevelRadius * sinAngle

      if (uRegion.type === 'face') {
        // Edge bevel from side face to bottom face
        const x = (uRegion.localS - 0.5) * 2 * flatHalfSize
        const distFromCenter = flatHalfSize + bevelRadius * cosAngle

        position = faceNorm.clone().multiplyScalar(distFromCenter)
          .add(faceRight.clone().multiplyScalar(x))
          .add(new THREE.Vector3(0, y, 0))

        normal = faceNorm.clone().multiplyScalar(cosAngle)
          .add(new THREE.Vector3(0, -sinAngle, 0))
          .normalize()

        tangentU = faceRight.clone()
        tangentV = faceNorm.clone().multiplyScalar(sinAngle)
          .add(new THREE.Vector3(0, cosAngle, 0))
          .normalize()
      } else {
        // Spherical corner
        const hAngle = uRegion.localS * (Math.PI / 2) // horizontal angle around corner

        const blendedHoriz = faceNorm.clone().multiplyScalar(Math.cos(hAngle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.sin(hAngle)))
          .normalize()

        // Corner center
        const cornerCenter = faceNorm.clone().multiplyScalar(flatHalfSize)
          .add(nextFaceNorm.clone().multiplyScalar(flatHalfSize))
          .add(new THREE.Vector3(0, -flatHalfSize, 0))

        normal = blendedHoriz.clone().multiplyScalar(cosAngle)
          .add(new THREE.Vector3(0, -sinAngle, 0))
          .normalize()

        position = cornerCenter.clone()
          .add(normal.clone().multiplyScalar(bevelRadius))

        // Tangent in u direction (around the corner horizontally)
        tangentU = faceNorm.clone().multiplyScalar(-Math.sin(hAngle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.cos(hAngle)))
          .normalize()

        // Tangent in v direction (along the bevel arc vertically)
        tangentV = blendedHoriz.clone().multiplyScalar(sinAngle)
          .add(new THREE.Vector3(0, cosAngle, 0))
          .normalize()
      }
    } else {
      // Top region: spherical corners and cylindrical edge bevels leading to top face
      const bevelAngle = vRegion.localT * (Math.PI / 2) // from flat (0) to horizontal (PI/2)
      const cosAngle = Math.cos(bevelAngle)
      const sinAngle = Math.sin(bevelAngle)
      const y = flatHalfSize + bevelRadius * sinAngle

      if (uRegion.type === 'face') {
        // Edge bevel from side face to top face
        const x = (uRegion.localS - 0.5) * 2 * flatHalfSize
        const distFromCenter = flatHalfSize + bevelRadius * cosAngle

        position = faceNorm.clone().multiplyScalar(distFromCenter)
          .add(faceRight.clone().multiplyScalar(x))
          .add(new THREE.Vector3(0, y, 0))

        normal = faceNorm.clone().multiplyScalar(cosAngle)
          .add(new THREE.Vector3(0, sinAngle, 0))
          .normalize()

        tangentU = faceRight.clone()
        tangentV = faceNorm.clone().multiplyScalar(-sinAngle)
          .add(new THREE.Vector3(0, cosAngle, 0))
          .normalize()
      } else {
        // Spherical corner
        const hAngle = uRegion.localS * (Math.PI / 2)

        const blendedHoriz = faceNorm.clone().multiplyScalar(Math.cos(hAngle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.sin(hAngle)))
          .normalize()

        // Corner center
        const cornerCenter = faceNorm.clone().multiplyScalar(flatHalfSize)
          .add(nextFaceNorm.clone().multiplyScalar(flatHalfSize))
          .add(new THREE.Vector3(0, flatHalfSize, 0))

        normal = blendedHoriz.clone().multiplyScalar(cosAngle)
          .add(new THREE.Vector3(0, sinAngle, 0))
          .normalize()

        position = cornerCenter.clone()
          .add(normal.clone().multiplyScalar(bevelRadius))

        tangentU = faceNorm.clone().multiplyScalar(-Math.sin(hAngle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.cos(hAngle)))
          .normalize()

        tangentV = blendedHoriz.clone().multiplyScalar(-sinAngle)
          .add(new THREE.Vector3(0, cosAngle, 0))
          .normalize()
      }
    }

    return { position: position!, normal: normal!, tangentU: tangentU!, tangentV: tangentV! }
  }

  /**
   * Get point on the beveled cube in world coordinates (after applying world rotation).
   */
  getPoint(u: number, v: number): SurfacePoint {
    const local = this.getPointLocal(u, v)
    return this.applyWorldRotation(local)
  }

  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    // Calculate u/v scaling based on current region to maintain consistent speed
    const vRegion = this.getVRegion(v)
    const uRegion = this.getURegion(u)

    let correctedDu = du
    let correctedDv = dv

    // Scale du based on whether we're on face or bevel (bevel has smaller circumference)
    // Also scale for spherical corners at top/bottom
    if (uRegion.type === 'bevel' && vRegion.type !== 'middle') {
      // Spherical corner - scale by cos of vertical angle
      const bevelAngle = vRegion.type === 'bottom'
        ? (1 - vRegion.localT) * (Math.PI / 2)
        : vRegion.localT * (Math.PI / 2)
      const cosAngle = Math.cos(bevelAngle)
      if (cosAngle > 0.01) {
        correctedDu = du / cosAngle
      }
    }

    // Scale dv at top/bottom poles (similar to sphere)
    if (vRegion.type === 'bottom' && vRegion.localT < 0.1) {
      correctedDv = dv * 0.5 // slow down near pole
    } else if (vRegion.type === 'top' && vRegion.localT > 0.9) {
      correctedDv = dv * 0.5
    }

    let newU = u + correctedDu
    let newV = v + correctedDv

    // Wrap u around [0, 1)
    newU = ((newU % 1) + 1) % 1

    // Clamp v to [epsilon, 1-epsilon] to avoid singularities
    const epsilon = 0.005
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    // Project the world position onto the beveled cube surface
    const x = worldPos.x
    const y = worldPos.y
    const z = worldPos.z

    // First, determine the vertical region (v coordinate)
    let v: number
    if (y <= -this.flatHalfSize) {
      // Bottom bevel region
      const angle = Math.atan2(-y - this.flatHalfSize, Math.sqrt(x * x + z * z) - this.flatHalfSize)
      const localT = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
      v = localT * this.bevelFraction
    } else if (y >= this.flatHalfSize) {
      // Top bevel region
      const angle = Math.atan2(y - this.flatHalfSize, Math.sqrt(x * x + z * z) - this.flatHalfSize)
      const localT = Math.max(0, Math.min(1, angle / (Math.PI / 2)))
      v = 1 - this.bevelFraction + localT * this.bevelFraction
    } else {
      // Middle region
      const localT = (y + this.flatHalfSize) / (2 * this.flatHalfSize)
      v = this.bevelFraction + localT * (1 - 2 * this.bevelFraction)
    }

    // Now determine the horizontal region (u coordinate)
    // Find which quadrant and whether on face or bevel
    const absX = Math.abs(x)
    const absZ = Math.abs(z)

    const faceWidth = 2 * this.flatHalfSize
    const bevelWidth = (Math.PI / 2) * this.bevelRadius
    const segmentWidth = faceWidth + bevelWidth
    const totalWidth = 4 * segmentWidth

    let u: number

    // Determine primary face based on which axis is dominant
    if (absZ >= absX) {
      if (z >= 0) {
        // +Z face (index 0)
        if (absX <= this.flatHalfSize) {
          // On face
          const localS = (x / this.flatHalfSize + 1) / 2
          u = localS * faceWidth / totalWidth
        } else {
          // On bevel to +X or -X
          if (x > 0) {
            const angle = Math.atan2(x - this.flatHalfSize, z - this.flatHalfSize)
            const localS = Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (faceWidth + localS * bevelWidth) / totalWidth
          } else {
            // Bevel to -X (going backwards)
            const angle = Math.atan2(-x - this.flatHalfSize, z - this.flatHalfSize)
            const localS = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = localS * faceWidth / totalWidth
            if (localS <= 0) {
              u = (3 * segmentWidth + faceWidth + (1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))) * bevelWidth) / totalWidth
            }
          }
        }
      } else {
        // -Z face (index 2)
        const baseU = 2 * segmentWidth
        if (absX <= this.flatHalfSize) {
          const localS = (-x / this.flatHalfSize + 1) / 2
          u = (baseU + localS * faceWidth) / totalWidth
        } else {
          if (x < 0) {
            const angle = Math.atan2(-x - this.flatHalfSize, -z - this.flatHalfSize)
            const localS = Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + faceWidth + localS * bevelWidth) / totalWidth
          } else {
            const angle = Math.atan2(x - this.flatHalfSize, -z - this.flatHalfSize)
            const localS = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + localS * faceWidth) / totalWidth
          }
        }
      }
    } else {
      if (x >= 0) {
        // +X face (index 1)
        const baseU = segmentWidth
        if (absZ <= this.flatHalfSize) {
          const localS = (-z / this.flatHalfSize + 1) / 2
          u = (baseU + localS * faceWidth) / totalWidth
        } else {
          if (z < 0) {
            const angle = Math.atan2(-z - this.flatHalfSize, x - this.flatHalfSize)
            const localS = Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + faceWidth + localS * bevelWidth) / totalWidth
          } else {
            const angle = Math.atan2(z - this.flatHalfSize, x - this.flatHalfSize)
            const localS = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + localS * faceWidth) / totalWidth
          }
        }
      } else {
        // -X face (index 3)
        const baseU = 3 * segmentWidth
        if (absZ <= this.flatHalfSize) {
          const localS = (z / this.flatHalfSize + 1) / 2
          u = (baseU + localS * faceWidth) / totalWidth
        } else {
          if (z > 0) {
            const angle = Math.atan2(z - this.flatHalfSize, -x - this.flatHalfSize)
            const localS = Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + faceWidth + localS * bevelWidth) / totalWidth
          } else {
            const angle = Math.atan2(-z - this.flatHalfSize, -x - this.flatHalfSize)
            const localS = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + localS * faceWidth) / totalWidth
          }
        }
      }
    }

    // Wrap u to [0, 1)
    u = ((u % 1) + 1) % 1

    return { u, v }
  }

  createMesh(): THREE.Mesh {
    const { size, bevelRadius, gridSegments } = CubeSurface.getInitData()

    // Create a rounded box geometry using BufferGeometry
    // We'll build it from the parametric surface
    const segments = gridSegments * 4
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    // Generate vertices using the parametric surface
    const uSegments = segments
    const vSegments = segments

    for (let j = 0; j <= vSegments; j++) {
      for (let i = 0; i <= uSegments; i++) {
        const u = i / uSegments
        const v = j / vSegments

        // Temporarily set initData for getPointLocal
        const tempData = (CubeSurface as any).__initData
        ;(CubeSurface as any).__initData = { size, bevelRadius, gridSegments }

        const point = this.getPointLocal(u, v)

        ;(CubeSurface as any).__initData = tempData

        positions.push(point.position.x, point.position.y, point.position.z)
        normals.push(point.normal.x, point.normal.y, point.normal.z)
        uvs.push(u, v)
      }
    }

    // Generate indices for triangles
    for (let j = 0; j < vSegments; j++) {
      for (let i = 0; i < uSegments; i++) {
        const a = j * (uSegments + 1) + i
        const b = a + 1
        const c = a + uSegments + 1
        const d = c + 1

        indices.push(a, c, b)
        indices.push(b, c, d)
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
    const { gridSegments } = CubeSurface.getInitData()
    const derived = this.getDerivedValues()
    const { flatHalfSize, bevelRadius } = derived
    const vertices: number[] = []
    const lineDetail = 32

    // Generate horizontal grid lines (constant v)
    const vLines = gridSegments + 2
    for (let j = 0; j <= vLines; j++) {
      const v = j / vLines

      for (let i = 0; i < lineDetail * 4; i++) {
        const u0 = i / (lineDetail * 4)
        const u1 = (i + 1) / (lineDetail * 4)

        const p0 = this.getPointLocal(u0, v)
        const p1 = this.getPointLocal(u1, v)

        vertices.push(p0.position.x, p0.position.y, p0.position.z)
        vertices.push(p1.position.x, p1.position.y, p1.position.z)
      }
    }

    // Generate vertical grid lines (constant u)
    // We want lines at face centers and at bevels
    const faceWidth = 2 * flatHalfSize
    const bevelWidth = (Math.PI / 2) * bevelRadius
    const segmentWidth = faceWidth + bevelWidth
    const totalWidth = 4 * segmentWidth

    // Lines on each face
    const linesPerFace = Math.max(2, Math.floor(gridSegments / 2))
    for (let face = 0; face < 4; face++) {
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

      // Lines on bevel edges (just the center of each bevel)
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
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    )

    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
