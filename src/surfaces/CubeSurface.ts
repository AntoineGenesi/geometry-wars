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
 * All 6 faces are traversable. The cube is parameterized as:
 * - u in [0, 1): wraps around horizontally (4 side faces + 4 vertical bevels)
 * - v in [0, 1]: goes from bottom flat face to top flat face
 *
 * V regions (from bottom to top):
 * - [0, flatFrac]:                          bottom flat face (-Y)
 * - [flatFrac, flatFrac+bevelFrac]:         bottom bevel (curve from -Y to sides)
 * - [flatFrac+bevelFrac, 1-flatFrac-bevelFrac]: middle belt (4 side faces + 4 vertical bevels)
 * - [1-flatFrac-bevelFrac, 1-flatFrac]:     top bevel (curve from sides to +Y)
 * - [1-flatFrac, 1]:                        top flat face (+Y)
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
  private readonly flatHalfSize: number
  private readonly bevelFraction: number
  private readonly flatFraction: number

  constructor(config?: CubeConfig) {
    const size = config?.size ?? 18
    const bevelRadius = config?.bevelRadius ?? size * 0.15
    const gridSegments = config?.gridSegments ?? 12

    ;(CubeSurface as any).__initData = { size, bevelRadius, gridSegments }
    super(config)

    this.size = size
    this.bevelRadius = Math.min(bevelRadius, size * 0.4)
    this.gridSegments = gridSegments
    this.halfSize = size / 2
    this.flatHalfSize = this.halfSize - this.bevelRadius

    // Total path length from bottom face center to top face center:
    // flatHalfSize (bottom face radius) + PI/2 * bevelRadius (bottom bevel arc)
    // + 2*flatHalfSize (side height) + PI/2 * bevelRadius (top bevel arc)
    // + flatHalfSize (top face radius)
    const bevelArc = (Math.PI / 2) * this.bevelRadius
    const totalHeight = 2 * this.flatHalfSize + 2 * this.flatHalfSize + 2 * bevelArc
    this.flatFraction = this.flatHalfSize / totalHeight
    this.bevelFraction = bevelArc / totalHeight

    this.surfaceRadius = this.halfSize + this.bevelRadius * 0.5
    const spawnPoint = this.getPointLocal(0.125, 0.5)
    this.playerLocalPosition = spawnPoint.position
  }

  private static getInitData(): { size: number; bevelRadius: number; gridSegments: number } {
    return (CubeSurface as any).__initData ?? { size: 18, bevelRadius: 2.7, gridSegments: 12 }
  }

  private getDerivedValues() {
    if (this.size !== undefined) {
      return {
        size: this.size,
        bevelRadius: this.bevelRadius,
        halfSize: this.halfSize,
        flatHalfSize: this.flatHalfSize,
        bevelFraction: this.bevelFraction,
        flatFraction: this.flatFraction,
      }
    }
    const { size, bevelRadius } = CubeSurface.getInitData()
    const clampedBevel = Math.min(bevelRadius, size * 0.4)
    const halfSize = size / 2
    const flatHalfSize = halfSize - clampedBevel
    const bevelArc = (Math.PI / 2) * clampedBevel
    const totalHeight = 2 * flatHalfSize + 2 * flatHalfSize + 2 * bevelArc
    const flatFraction = flatHalfSize / totalHeight
    const bevelFraction = bevelArc / totalHeight
    return { size, bevelRadius: clampedBevel, halfSize, flatHalfSize, bevelFraction, flatFraction }
  }

  /**
   * V regions: bottomFlat | bottomBevel | middle | topBevel | topFlat
   */
  private getVRegion(v: number, derived?: ReturnType<typeof this.getDerivedValues>): {
    type: 'bottomFlat' | 'bottomBevel' | 'middle' | 'topBevel' | 'topFlat'
    localT: number
  } {
    const { bevelFraction, flatFraction } = derived ?? this.getDerivedValues()
    const bf = flatFraction
    const bb = flatFraction + bevelFraction
    const tb = 1 - flatFraction - bevelFraction
    const tf = 1 - flatFraction

    if (v <= bf) {
      return { type: 'bottomFlat', localT: bf > 0 ? v / bf : 0 }
    } else if (v <= bb) {
      return { type: 'bottomBevel', localT: bb > bf ? (v - bf) / (bb - bf) : 0 }
    } else if (v <= tb) {
      return { type: 'middle', localT: tb > bb ? (v - bb) / (tb - bb) : 0.5 }
    } else if (v <= tf) {
      return { type: 'topBevel', localT: tf > tb ? (v - tb) / (tf - tb) : 0 }
    } else {
      return { type: 'topFlat', localT: tf < 1 ? (v - tf) / (1 - tf) : 0 }
    }
  }

  /**
   * U regions: 4 flat faces + 4 corner bevels around the horizontal belt.
   */
  private getURegion(u: number, derived?: ReturnType<typeof this.getDerivedValues>): {
    faceIndex: number
    type: 'face' | 'bevel'
    localS: number
  } {
    const { flatHalfSize, bevelRadius } = derived ?? this.getDerivedValues()
    const faceWidth = 2 * flatHalfSize
    const bevelWidth = (Math.PI / 2) * bevelRadius
    const segmentWidth = faceWidth + bevelWidth
    const totalWidth = 4 * segmentWidth

    const scaledU = ((u % 1) + 1) % 1
    const posInTotal = scaledU * totalWidth
    const segmentIndex = Math.floor(posInTotal / segmentWidth)
    const posInSegment = posInTotal - segmentIndex * segmentWidth

    if (posInSegment < faceWidth) {
      return { faceIndex: segmentIndex % 4, type: 'face', localS: posInSegment / faceWidth }
    } else {
      return { faceIndex: segmentIndex % 4, type: 'bevel', localS: (posInSegment - faceWidth) / bevelWidth }
    }
  }

  private getPointLocal(u: number, v: number): SurfacePoint {
    const derived = this.getDerivedValues()
    const { halfSize, flatHalfSize, bevelRadius } = derived
    const vRegion = this.getVRegion(v, derived)
    const uRegion = this.getURegion(u, derived)

    let position: THREE.Vector3
    let normal: THREE.Vector3
    let tangentU: THREE.Vector3
    let tangentV: THREE.Vector3

    // Face normals and right directions for the 4 side faces
    // faceIndex: 0 = +Z, 1 = +X, 2 = -Z, 3 = -X
    const faceNormals = [
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(-1, 0, 0),
    ]
    const faceRights = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, -1),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 0, 1),
    ]

    const faceNorm = faceNormals[uRegion.faceIndex]
    const faceRight = faceRights[uRegion.faceIndex]
    const nextFaceNorm = faceNormals[(uRegion.faceIndex + 1) % 4]

    if (vRegion.type === 'bottomFlat') {
      // Flat bottom face (-Y) with CARTESIAN grid parameterization.
      // localT goes from 0 (at v=0, center) to 1 (at v=flatFraction, edge with bevel).
      // Cartesian fix (Session 13): Map UV to a grid on the square face, not radial coordinates.
      const y = -halfSize

      if (uRegion.type === 'face') {
        // Cartesian grid mapping on face region
        // tangentPos: position along the edge (-flatHalfSize to +flatHalfSize)
        // normalPos: distance from center outward (0 at center, flatHalfSize at edge)
        const tangentPos = (uRegion.localS - 0.5) * 2 * flatHalfSize
        const normalPos = flatHalfSize * vRegion.localT  // Fixed: was (1 - vRegion.localT)

        // Build position using face directions
        const x = faceRight.x * tangentPos + faceNorm.x * normalPos
        const z = faceRight.z * tangentPos + faceNorm.z * normalPos

        position = new THREE.Vector3(x, y, z)
      } else {
        // Corner region - cartesian approach
        const hAngle = uRegion.localS * (Math.PI / 2)
        const blendedDir = faceNorm.clone().multiplyScalar(Math.cos(hAngle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.sin(hAngle)))
        const normalPos = flatHalfSize * vRegion.localT  // Fixed: was (1 - vRegion.localT)

        position = blendedDir.clone().multiplyScalar(normalPos)
          .add(new THREE.Vector3(0, y, 0))
      }

      normal = new THREE.Vector3(0, -1, 0)
      tangentU = faceRight.clone()
      tangentV = faceNorm.clone()
    } else if (vRegion.type === 'topFlat') {
      // Flat top face (+Y) with CARTESIAN grid parameterization.
      // localT goes from 0 (at edge with bevel, v=1-flatFraction) to 1 (at center, v=1).
      // Cartesian fix (Session 13): Map UV to a grid on the square face, not radial coordinates.
      const y = halfSize

      if (uRegion.type === 'face') {
        // Cartesian grid mapping on face region
        // tangentPos: position along the edge (-flatHalfSize to +flatHalfSize)
        // normalPos: distance from center outward (flatHalfSize at edge, 0 at center)
        // For topFlat: localT=0 is at edge, localT=1 is at center
        const tangentPos = (uRegion.localS - 0.5) * 2 * flatHalfSize
        const normalPos = flatHalfSize * (1 - vRegion.localT)  // Correct: edge to center

        // Build position using face directions
        const x = faceRight.x * tangentPos + faceNorm.x * normalPos
        const z = faceRight.z * tangentPos + faceNorm.z * normalPos

        position = new THREE.Vector3(x, y, z)
      } else {
        // Corner region - cartesian approach
        const hAngle = uRegion.localS * (Math.PI / 2)
        const blendedDir = faceNorm.clone().multiplyScalar(Math.cos(hAngle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.sin(hAngle)))
        const normalPos = flatHalfSize * (1 - vRegion.localT)  // Correct: edge to center

        position = blendedDir.clone().multiplyScalar(normalPos)
          .add(new THREE.Vector3(0, y, 0))
      }

      normal = new THREE.Vector3(0, 1, 0)
      tangentU = faceRight.clone()
      tangentV = faceNorm.clone().negate()
    } else if (vRegion.type === 'middle') {
      // Middle belt: side faces and vertical bevels
      const y = (vRegion.localT - 0.5) * 2 * flatHalfSize

      if (uRegion.type === 'face') {
        const x = (uRegion.localS - 0.5) * 2 * flatHalfSize
        position = faceNorm.clone().multiplyScalar(halfSize)
          .add(faceRight.clone().multiplyScalar(x))
          .add(new THREE.Vector3(0, y, 0))
        normal = faceNorm.clone()
        tangentU = faceRight.clone()
        tangentV = new THREE.Vector3(0, 1, 0)
      } else {
        const angle = uRegion.localS * (Math.PI / 2)
        const blendedNormal = faceNorm.clone().multiplyScalar(Math.cos(angle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.sin(angle)))
        const edgeCenter = faceNorm.clone().multiplyScalar(flatHalfSize)
          .add(nextFaceNorm.clone().multiplyScalar(flatHalfSize))

        position = edgeCenter.clone()
          .add(blendedNormal.clone().multiplyScalar(bevelRadius))
          .add(new THREE.Vector3(0, y, 0))
        normal = blendedNormal.clone().normalize()
        tangentU = faceNorm.clone().multiplyScalar(-Math.sin(angle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.cos(angle)))
          .normalize()
        tangentV = new THREE.Vector3(0, 1, 0)
      }
    } else if (vRegion.type === 'bottomBevel') {
      // Bottom bevel: arc from bottom face edge down to side faces
      const bevelAngle = (1 - vRegion.localT) * (Math.PI / 2)
      const cosAngle = Math.cos(bevelAngle)
      const sinAngle = Math.sin(bevelAngle)
      const y = -flatHalfSize - bevelRadius * sinAngle

      if (uRegion.type === 'face') {
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
        const hAngle = uRegion.localS * (Math.PI / 2)
        const blendedHoriz = faceNorm.clone().multiplyScalar(Math.cos(hAngle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.sin(hAngle)))
          .normalize()
        const cornerCenter = faceNorm.clone().multiplyScalar(flatHalfSize)
          .add(nextFaceNorm.clone().multiplyScalar(flatHalfSize))
          .add(new THREE.Vector3(0, -flatHalfSize, 0))

        normal = blendedHoriz.clone().multiplyScalar(cosAngle)
          .add(new THREE.Vector3(0, -sinAngle, 0))
          .normalize()
        position = cornerCenter.clone()
          .add(normal.clone().multiplyScalar(bevelRadius))
        tangentU = faceNorm.clone().multiplyScalar(-Math.sin(hAngle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.cos(hAngle)))
          .normalize()
        tangentV = blendedHoriz.clone().multiplyScalar(sinAngle)
          .add(new THREE.Vector3(0, cosAngle, 0))
          .normalize()
      }
    } else {
      // Top bevel: arc from side faces up to top face edge
      const bevelAngle = vRegion.localT * (Math.PI / 2)
      const cosAngle = Math.cos(bevelAngle)
      const sinAngle = Math.sin(bevelAngle)
      const y = flatHalfSize + bevelRadius * sinAngle

      if (uRegion.type === 'face') {
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
        const hAngle = uRegion.localS * (Math.PI / 2)
        const blendedHoriz = faceNorm.clone().multiplyScalar(Math.cos(hAngle))
          .add(nextFaceNorm.clone().multiplyScalar(Math.sin(hAngle)))
          .normalize()
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

  getPoint(u: number, v: number): SurfacePoint {
    const local = this.getPointLocal(u, v)
    return this.applyWorldRotation(local)
  }

  moveOnSurface(u: number, v: number, du: number, dv: number): { u: number; v: number } {
    const vRegion = this.getVRegion(v)
    const uRegion = this.getURegion(u)

    let correctedDu = du
    let correctedDv = dv

    // Scale du for bevel regions and spherical corners
    if (uRegion.type === 'bevel' && (vRegion.type === 'bottomBevel' || vRegion.type === 'topBevel')) {
      const bevelAngle = vRegion.type === 'bottomBevel'
        ? (1 - vRegion.localT) * (Math.PI / 2)
        : vRegion.localT * (Math.PI / 2)
      const cosAngle = Math.cos(bevelAngle)
      if (cosAngle > 0.01) {
        correctedDu = du / cosAngle
      }
    }

    // Slow down near top/bottom face centers (pole-like convergence)
    if (vRegion.type === 'bottomFlat' && vRegion.localT < 0.15) {
      correctedDv = dv * 0.5
    } else if (vRegion.type === 'topFlat' && vRegion.localT > 0.85) {
      correctedDv = dv * 0.5
    }

    let newU = u + correctedDu
    let newV = v + correctedDv

    newU = ((newU % 1) + 1) % 1
    const epsilon = 0.003
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const x = worldPos.x
    const y = worldPos.y
    const z = worldPos.z

    // Determine v based on y position
    let v: number
    const derived = this.getDerivedValues()
    const { halfSize, flatHalfSize, bevelRadius, flatFraction, bevelFraction } = derived

    if (y <= -(halfSize - 0.01)) {
      // On or below bottom face - CARTESIAN inversion
      // The cartesian mapping uses: x = faceRight.x * tangentPos + faceNorm.x * normalPos
      //                             z = faceRight.z * tangentPos + faceNorm.z * normalPos
      // where normalPos = flatHalfSize * localT (distance from center)

      const absX = Math.abs(x)
      const absZ = Math.abs(z)

      // Determine which face and compute normalPos based on face directions
      let normalPos: number
      if (absZ >= absX) {
        // Closer to +Z or -Z face
        // For face 0 (+Z): faceNorm = (0,0,1), so normalPos projects onto z
        // For face 2 (-Z): faceNorm = (0,0,-1), so normalPos projects onto -z
        normalPos = absZ
      } else {
        // Closer to +X or -X face
        // For face 1 (+X): faceNorm = (1,0,0), so normalPos projects onto x
        // For face 3 (-X): faceNorm = (-1,0,0), so normalPos projects onto -x
        normalPos = absX
      }

      // Invert: normalPos = flatHalfSize * localT
      // So: localT = normalPos / flatHalfSize
      const localT = Math.max(0, Math.min(1, normalPos / flatHalfSize))
      v = localT * flatFraction
    } else if (y <= -flatHalfSize) {
      // Bottom bevel region
      const horizDist = Math.max(0, Math.sqrt(x * x + z * z) - flatHalfSize)
      const vertDist = Math.abs(y + flatHalfSize)
      const angle = Math.atan2(vertDist, horizDist)
      const localT = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
      v = flatFraction + localT * bevelFraction
    } else if (y >= (halfSize - 0.01)) {
      // On or above top face - CARTESIAN inversion
      // Determine which face region this point belongs to by finding dominant axis
      const absX = Math.abs(x)
      const absZ = Math.abs(z)

      // Find the closest face edge
      let normalPos: number
      if (absZ >= absX) {
        // Closer to +Z or -Z face
        normalPos = Math.abs(z)
      } else {
        // Closer to +X or -X face
        normalPos = Math.abs(x)
      }

      // For topFlat: localT goes from 0 (edge) to 1 (center)
      // normalPos = flatHalfSize * (1 - localT)
      // So: localT = 1 - (normalPos / flatHalfSize)
      const localT = Math.max(0, Math.min(1, 1 - normalPos / flatHalfSize))
      v = 1 - flatFraction + localT * flatFraction
    } else if (y >= flatHalfSize) {
      // Top bevel region
      const horizDist = Math.max(0, Math.sqrt(x * x + z * z) - flatHalfSize)
      const vertDist = Math.abs(y - flatHalfSize)
      const angle = Math.atan2(vertDist, horizDist)
      const localT = Math.max(0, Math.min(1, angle / (Math.PI / 2)))
      v = 1 - flatFraction - bevelFraction + localT * bevelFraction
    } else {
      // Middle region
      const middleStart = flatFraction + bevelFraction
      const middleEnd = 1 - flatFraction - bevelFraction
      const localT = (y + flatHalfSize) / (2 * flatHalfSize)
      v = middleStart + localT * (middleEnd - middleStart)
    }

    // Determine u based on x/z position (same as before)
    const absX = Math.abs(x)
    const absZ = Math.abs(z)
    const faceWidth = 2 * flatHalfSize
    const bevelWidth = (Math.PI / 2) * bevelRadius
    const segmentWidth = faceWidth + bevelWidth
    const totalWidth = 4 * segmentWidth

    let u: number

    if (absZ >= absX) {
      if (z >= 0) {
        if (absX <= flatHalfSize) {
          const localS = (x / flatHalfSize + 1) / 2
          u = localS * faceWidth / totalWidth
        } else {
          if (x > 0) {
            const angle = Math.atan2(x - flatHalfSize, z - flatHalfSize)
            const localS = Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (faceWidth + localS * bevelWidth) / totalWidth
          } else {
            const angle = Math.atan2(-x - flatHalfSize, z - flatHalfSize)
            const localS = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = localS * faceWidth / totalWidth
            if (localS <= 0) {
              u = (3 * segmentWidth + faceWidth + (1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))) * bevelWidth) / totalWidth
            }
          }
        }
      } else {
        const baseU = 2 * segmentWidth
        if (absX <= flatHalfSize) {
          const localS = (-x / flatHalfSize + 1) / 2
          u = (baseU + localS * faceWidth) / totalWidth
        } else {
          if (x < 0) {
            const angle = Math.atan2(-x - flatHalfSize, -z - flatHalfSize)
            const localS = Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + faceWidth + localS * bevelWidth) / totalWidth
          } else {
            const angle = Math.atan2(x - flatHalfSize, -z - flatHalfSize)
            const localS = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + localS * faceWidth) / totalWidth
          }
        }
      }
    } else {
      if (x >= 0) {
        const baseU = segmentWidth
        if (absZ <= flatHalfSize) {
          const localS = (-z / flatHalfSize + 1) / 2
          u = (baseU + localS * faceWidth) / totalWidth
        } else {
          if (z < 0) {
            const angle = Math.atan2(-z - flatHalfSize, x - flatHalfSize)
            const localS = Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + faceWidth + localS * bevelWidth) / totalWidth
          } else {
            const angle = Math.atan2(z - flatHalfSize, x - flatHalfSize)
            const localS = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + localS * faceWidth) / totalWidth
          }
        }
      } else {
        const baseU = 3 * segmentWidth
        if (absZ <= flatHalfSize) {
          const localS = (z / flatHalfSize + 1) / 2
          u = (baseU + localS * faceWidth) / totalWidth
        } else {
          if (z > 0) {
            const angle = Math.atan2(z - flatHalfSize, -x - flatHalfSize)
            const localS = Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + faceWidth + localS * bevelWidth) / totalWidth
          } else {
            const angle = Math.atan2(-z - flatHalfSize, -x - flatHalfSize)
            const localS = 1 - Math.max(0, Math.min(1, angle / (Math.PI / 2)))
            u = (baseU + localS * faceWidth) / totalWidth
          }
        }
      }
    }

    u = ((u % 1) + 1) % 1
    return { u, v }
  }

  createMesh(): THREE.Mesh {
    const { size, bevelRadius, gridSegments } = CubeSurface.getInitData()
    const segments = gridSegments * 4
    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    const uSegments = segments
    const vSegments = segments

    for (let j = 0; j <= vSegments; j++) {
      for (let i = 0; i <= uSegments; i++) {
        const u = i / uSegments
        const v = j / vSegments

        const tempData = (CubeSurface as any).__initData
        ;(CubeSurface as any).__initData = { size, bevelRadius, gridSegments }
        const point = this.getPointLocal(u, v)
        ;(CubeSurface as any).__initData = tempData

        positions.push(point.position.x, point.position.y, point.position.z)
        normals.push(point.normal.x, point.normal.y, point.normal.z)
        uvs.push(u, v)
      }
    }

    for (let j = 0; j < vSegments; j++) {
      for (let i = 0; i < uSegments; i++) {
        const a = j * (uSegments + 1) + i
        const b = a + 1
        const c = a + uSegments + 1
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
    const { gridSegments } = CubeSurface.getInitData()
    const derived = this.getDerivedValues()
    const { flatHalfSize, bevelRadius } = derived
    const vertices: number[] = []
    const lineDetail = 32

    // Horizontal grid lines (constant v)
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

    // Vertical grid lines (constant u)
    const faceWidth = 2 * flatHalfSize
    const bevelWidth = (Math.PI / 2) * bevelRadius
    const segmentWidth = faceWidth + bevelWidth
    const totalWidth = 4 * segmentWidth

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

      // Bevel edge center line
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
