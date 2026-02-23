import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface MobiusBevelConfig extends SurfaceConfig {
  majorRadius?: number   // Distance from center to tube center (default 8)
  tubeRadius?: number    // Radius of the tube cross-section (default 2)
  gridSegmentsU?: number // Segments around the Mobius loop (default 64)
  gridSegmentsV?: number // Segments around the tube cross-section (default 16)
}

/**
 * Mobius Bevel Surface: a tube (pipe cross-section) bent into a Mobius loop.
 *
 * Think of it as a torus with a half-twist: instead of the tube cross-section
 * maintaining its orientation as you go around the loop (like a torus), it
 * rotates 180 degrees over one full loop. This means:
 *
 * - Walking around the loop (U direction) brings you back with the tube
 *   rotated half a turn -- you're on the "other side" of the tube.
 * - Walking around the tube circumference (V direction) wraps you around
 *   like a pipe, no edges to fall off.
 * - Walking around the loop TWICE returns you to the exact starting position.
 *
 * Parametric equations:
 *   Given:
 *     t = u * 2*PI       (angle around the Mobius loop)
 *     phi = v * 2*PI     (angle around the tube cross-section)
 *     R = majorRadius    (distance from center to tube center)
 *     r = tubeRadius     (radius of tube cross-section)
 *
 *   The tube center traces a circle of radius R in the XY plane:
 *     centerX = R * cos(t)
 *     centerY = R * sin(t)
 *     centerZ = 0
 *
 *   At each point along the loop, the tube cross-section is a circle in a
 *   frame that rotates by t/2 (the half-twist). The frame vectors are:
 *     radial direction:  cos(t/2) * outward + sin(t/2) * up
 *     vertical direction: -sin(t/2) * outward + cos(t/2) * up
 *
 *   Where "outward" = (cos(t), sin(t), 0) and "up" = (0, 0, 1).
 *
 *   The surface point is:
 *     P = center + r * cos(phi) * radialDir + r * sin(phi) * verticalDir
 *
 * UV mapping:
 *   u: [0, 1) around the Mobius loop (wraps with half-twist)
 *   v: [0, 1) around the tube cross-section (wraps continuously)
 *
 * Topology: when u wraps from 1 back to 0, the tube frame has rotated 180
 * degrees, so v effectively shifts by 0.5. This means the surface is a single
 * continuous band -- a Klein-bottle-like topology in the tube direction.
 */
export class MobiusBevelSurface extends Surface {
  private readonly majorRadius: number
  private readonly tubeRadius: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  constructor(config?: MobiusBevelConfig) {
    const majorRadius = config?.majorRadius ?? 8
    const tubeRadius = config?.tubeRadius ?? 2
    const gridSegmentsU = config?.gridSegmentsU ?? 64
    const gridSegmentsV = config?.gridSegmentsV ?? 16

    ;(MobiusBevelSurface as any).__initData = {
      majorRadius,
      tubeRadius,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.majorRadius = majorRadius
    this.tubeRadius = tubeRadius
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Surface radius is the outer extent
    this.surfaceRadius = majorRadius + tubeRadius
    // Player starts at the outermost point of the tube
    this.playerLocalPosition = new THREE.Vector3(majorRadius + tubeRadius, 0, 0)
  }

  private static getInitData(): {
    majorRadius: number
    tubeRadius: number
    gridSegmentsU: number
    gridSegmentsV: number
  } {
    return (
      (MobiusBevelSurface as any).__initData ?? {
        majorRadius: 8,
        tubeRadius: 2,
        gridSegmentsU: 64,
        gridSegmentsV: 16,
      }
    )
  }

  /**
   * Compute the tube frame at a given position along the Mobius loop.
   * Returns the center point and the two frame vectors (radial + vertical)
   * that define the tube cross-section plane, incorporating the half-twist.
   */
  private getFrame(t: number): {
    center: THREE.Vector3
    radialDir: THREE.Vector3
    verticalDir: THREE.Vector3
  } {
    const R = this.majorRadius

    const cosT = Math.cos(t)
    const sinT = Math.sin(t)
    const halfT = t / 2
    const cosHalfT = Math.cos(halfT)
    const sinHalfT = Math.sin(halfT)

    // Center of the tube follows a circle in the XY plane
    const center = new THREE.Vector3(R * cosT, R * sinT, 0)

    // Outward direction (from center of loop to tube center)
    // Up direction is Z axis
    // The half-twist rotates the cross-section frame by t/2
    const radialDir = new THREE.Vector3(
      cosHalfT * cosT,
      cosHalfT * sinT,
      sinHalfT
    )

    const verticalDir = new THREE.Vector3(
      -sinHalfT * cosT,
      -sinHalfT * sinT,
      cosHalfT
    )

    return { center, radialDir, verticalDir }
  }

  /**
   * Get point on the Mobius bevel surface in LOCAL coordinates.
   *
   * @param u - Position around the Mobius loop [0, 1)
   * @param v - Position around the tube cross-section [0, 1)
   */
  private getPointLocal(u: number, v: number): SurfacePoint {
    const r = this.tubeRadius

    const t = u * Math.PI * 2    // Angle around the Mobius loop
    const phi = v * Math.PI * 2  // Angle around the tube cross-section

    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)

    const { center, radialDir, verticalDir } = this.getFrame(t)

    // Surface point = center + r * cos(phi) * radialDir + r * sin(phi) * verticalDir
    const position = new THREE.Vector3(
      center.x + r * cosPhi * radialDir.x + r * sinPhi * verticalDir.x,
      center.y + r * cosPhi * radialDir.y + r * sinPhi * verticalDir.y,
      center.z + r * cosPhi * radialDir.z + r * sinPhi * verticalDir.z
    )

    // Normal = outward from tube surface = cos(phi) * radialDir + sin(phi) * verticalDir
    const normal = new THREE.Vector3(
      cosPhi * radialDir.x + sinPhi * verticalDir.x,
      cosPhi * radialDir.y + sinPhi * verticalDir.y,
      cosPhi * radialDir.z + sinPhi * verticalDir.z
    ).normalize()

    // Tangent in U direction: derivative of position with respect to t (then normalized)
    // This requires the derivative of center, radialDir, and verticalDir w.r.t. t
    const cosT = Math.cos(t)
    const sinT = Math.sin(t)
    const halfT = t / 2
    const cosHalfT = Math.cos(halfT)
    const sinHalfT = Math.sin(halfT)

    // d(center)/dt = R * (-sinT, cosT, 0)
    const R = this.majorRadius
    const dCenterX = -R * sinT
    const dCenterY = R * cosT
    const dCenterZ = 0

    // d(radialDir)/dt:
    // radialDir = (cosHalfT * cosT, cosHalfT * sinT, sinHalfT)
    // d/dt = (-0.5*sinHalfT*cosT - cosHalfT*sinT, -0.5*sinHalfT*sinT + cosHalfT*cosT, 0.5*cosHalfT)
    const dRadialX = -0.5 * sinHalfT * cosT - cosHalfT * sinT
    const dRadialY = -0.5 * sinHalfT * sinT + cosHalfT * cosT
    const dRadialZ = 0.5 * cosHalfT

    // d(verticalDir)/dt:
    // verticalDir = (-sinHalfT * cosT, -sinHalfT * sinT, cosHalfT)
    // d/dt = (-0.5*cosHalfT*cosT + sinHalfT*sinT, -0.5*cosHalfT*sinT - sinHalfT*cosT, -0.5*sinHalfT)
    const dVerticalX = -0.5 * cosHalfT * cosT + sinHalfT * sinT
    const dVerticalY = -0.5 * cosHalfT * sinT - sinHalfT * cosT
    const dVerticalZ = -0.5 * sinHalfT

    // d(position)/dt = d(center)/dt + r*cos(phi)*d(radialDir)/dt + r*sin(phi)*d(verticalDir)/dt
    const tangentU = new THREE.Vector3(
      dCenterX + r * cosPhi * dRadialX + r * sinPhi * dVerticalX,
      dCenterY + r * cosPhi * dRadialY + r * sinPhi * dVerticalY,
      dCenterZ + r * cosPhi * dRadialZ + r * sinPhi * dVerticalZ
    ).normalize()

    // Tangent in V direction: derivative of position with respect to phi
    // d(position)/dphi = r * (-sin(phi) * radialDir + cos(phi) * verticalDir)
    const tangentV = new THREE.Vector3(
      r * (-sinPhi * radialDir.x + cosPhi * verticalDir.x),
      r * (-sinPhi * radialDir.y + cosPhi * verticalDir.y),
      r * (-sinPhi * radialDir.z + cosPhi * verticalDir.z)
    ).normalize()

    return { position, normal, tangentU, tangentV }
  }

  /**
   * Get point on the Mobius bevel surface in WORLD coordinates.
   */
  getPoint(u: number, v: number): SurfacePoint {
    const local = this.getPointLocal(u, v)
    return this.applyWorldRotation(local)
  }

  /**
   * Move on the Mobius bevel surface.
   *
   * Both U and V wrap, but with a twist: when U wraps from 1 back to 0,
   * V shifts by 0.5 because the tube frame has rotated 180 degrees.
   * This is the Mobius topology -- going around the loop once puts you
   * on the opposite side of the tube.
   */
  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    const R = this.majorRadius
    const r = this.tubeRadius

    // Correct dv for varying tube position relative to the loop center
    // At the outer edge of the tube (v=0, cos(phi)=1), the effective loop
    // radius is R+r, making the circumference larger. At inner edge (v=0.5),
    // it's R-r. Scale du to maintain consistent apparent speed.
    const phi = v * Math.PI * 2
    const cosPhi = Math.cos(phi)
    const localRadius = R + r * cosPhi
    const scaleFactor = localRadius > 0.001 ? R / localRadius : 1

    let newU = u + du * scaleFactor
    let newV = v + dv

    // Track how many times we wrap around in U
    let wraps = 0
    while (newU >= 1) {
      newU -= 1
      wraps++
    }
    while (newU < 0) {
      newU += 1
      wraps++
    }

    // Each U wrap shifts V by 0.5 (half-twist: tube rotated 180 degrees)
    if (wraps % 2 === 1) {
      newV += 0.5
    }

    // V wraps around the tube (no edges, like a pipe)
    newV = ((newV % 1) + 1) % 1

    return { u: newU, v: newV }
  }

  /** MobiusBevel wraps in both U (with twist) and V (tube loop). */
  get wrapsV(): boolean { return true }

  wrapUV(u: number, v: number): { u: number; v: number } {
    return {
      u: ((u % 1) + 1) % 1,
      v: ((v % 1) + 1) % 1,
    }
  }

  /**
   * Convert world position to UV coordinates on the Mobius bevel surface.
   *
   * Strategy: find the angle t around the loop from the XY projection,
   * then find the angle phi around the tube cross-section at that t.
   */
  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const R = this.majorRadius

    // Undo map-size scale: same fix as MobiusSurface — absolute distance computations
    // require 1x local coordinates, but positions arrive at group.scale world space.
    const scale = this.group.scale.x
    const pos = (scale !== 1.0 && scale > 0)
      ? new THREE.Vector3(worldPos.x / scale, worldPos.y / scale, worldPos.z / scale)
      : worldPos

    // Find the angle t from the XY projection (loop is in XY plane)
    let t = Math.atan2(pos.y, pos.x)
    if (t < 0) t += Math.PI * 2

    // Get the tube frame at this angle
    const { center, radialDir, verticalDir } = this.getFrame(t)

    // Vector from tube center to the world point
    const toPoint = new THREE.Vector3(
      pos.x - center.x,
      pos.y - center.y,
      pos.z - center.z
    )

    // Project onto the cross-section frame to get phi
    const radialComponent = toPoint.dot(radialDir)
    const verticalComponent = toPoint.dot(verticalDir)

    let phi = Math.atan2(verticalComponent, radialComponent)
    if (phi < 0) phi += Math.PI * 2

    const u = t / (Math.PI * 2)
    const v = phi / (Math.PI * 2)

    return {
      u: Math.max(0, Math.min(0.9999, u)),
      v: Math.max(0, Math.min(0.9999, v)),
    }
  }

  createMesh(): THREE.Mesh {
    const { majorRadius, tubeRadius, gridSegmentsU, gridSegmentsV } =
      MobiusBevelSurface.getInitData()

    const geometry = new THREE.BufferGeometry()
    const vertices: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    const R = majorRadius
    const r = tubeRadius
    // Use double resolution for the loop since it needs to look smooth
    const segU = gridSegmentsU
    const segV = gridSegmentsV

    // Generate vertices: segU rows around the Mobius loop, segV columns around tube
    // We do NOT duplicate the last row at U=1 because the Mobius twist means
    // it connects back to row 0 with a V shift. We handle this in the index buffer.
    for (let i = 0; i < segU; i++) {
      const t = (i / segU) * Math.PI * 2
      const cosT = Math.cos(t)
      const sinT = Math.sin(t)
      const halfT = t / 2
      const cosHalfT = Math.cos(halfT)
      const sinHalfT = Math.sin(halfT)

      // Tube center
      const cx = R * cosT
      const cy = R * sinT

      // Frame vectors at this t (with half-twist)
      const radX = cosHalfT * cosT
      const radY = cosHalfT * sinT
      const radZ = sinHalfT

      const vertX = -sinHalfT * cosT
      const vertY = -sinHalfT * sinT
      const vertZ = cosHalfT

      for (let j = 0; j < segV; j++) {
        const phi = (j / segV) * Math.PI * 2
        const cosPhi = Math.cos(phi)
        const sinPhi = Math.sin(phi)

        // Position
        const px = cx + r * cosPhi * radX + r * sinPhi * vertX
        const py = cy + r * cosPhi * radY + r * sinPhi * vertY
        const pz = r * cosPhi * radZ + r * sinPhi * vertZ

        vertices.push(px, py, pz)

        // Normal (outward from tube center)
        const nx = cosPhi * radX + sinPhi * vertX
        const ny = cosPhi * radY + sinPhi * vertY
        const nz = cosPhi * radZ + sinPhi * vertZ
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz)
        normals.push(nx / nLen, ny / nLen, nz / nLen)

        // UV coordinates
        uvs.push(i / segU, j / segV)
      }
    }

    // Generate indices for the main body: rows 0 through segU-2
    for (let i = 0; i < segU - 1; i++) {
      for (let j = 0; j < segV; j++) {
        const a = i * segV + j
        const b = (i + 1) * segV + j
        const c = i * segV + ((j + 1) % segV)
        const d = (i + 1) * segV + ((j + 1) % segV)

        indices.push(a, b, c)
        indices.push(b, d, c)
      }
    }

    // Connect last row (segU-1) back to first row (0) with the Mobius twist.
    // At t = 2*PI, the frame has rotated 180 degrees compared to t = 0.
    // A vertex at tube angle phi in the last row maps to phi + PI in the first row,
    // i.e., j in last row connects to (j + segV/2) % segV in first row.
    const lastRow = (segU - 1) * segV
    const halfV = Math.floor(segV / 2)

    for (let j = 0; j < segV; j++) {
      const a = lastRow + j
      const b = (j + halfV) % segV  // First row, shifted by half
      const c = lastRow + ((j + 1) % segV)
      const d = ((j + 1 + halfV) % segV)  // First row, next vertex, shifted by half

      indices.push(a, b, c)
      indices.push(b, d, c)
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)

    const material = this.createSurfaceMaterial()
    material.side = THREE.DoubleSide  // Non-orientable surface needs double-side rendering

    return new THREE.Mesh(geometry, material)
  }

  createGrid(): THREE.LineSegments {
    const { majorRadius, tubeRadius, gridSegmentsU, gridSegmentsV } =
      MobiusBevelSurface.getInitData()

    const vertices: number[] = []
    const R = majorRadius
    const r = tubeRadius
    const lineDetail = 128  // High detail for smooth curves around the loop

    // Lines around the tube cross-section (constant u, varying v)
    // These are circles around the tube at regular intervals along the loop
    for (let i = 0; i < gridSegmentsU; i++) {
      const t = (i / gridSegmentsU) * Math.PI * 2
      const cosT = Math.cos(t)
      const sinT = Math.sin(t)
      const halfT = t / 2
      const cosHalfT = Math.cos(halfT)
      const sinHalfT = Math.sin(halfT)

      const cx = R * cosT
      const cy = R * sinT

      const radX = cosHalfT * cosT
      const radY = cosHalfT * sinT
      const radZ = sinHalfT

      const vertX = -sinHalfT * cosT
      const vertY = -sinHalfT * sinT
      const vertZ = cosHalfT

      for (let j = 0; j < gridSegmentsV; j++) {
        const phi0 = (j / gridSegmentsV) * Math.PI * 2
        const phi1 = ((j + 1) / gridSegmentsV) * Math.PI * 2

        const cosPhi0 = Math.cos(phi0)
        const sinPhi0 = Math.sin(phi0)
        const cosPhi1 = Math.cos(phi1)
        const sinPhi1 = Math.sin(phi1)

        const x0 = cx + r * cosPhi0 * radX + r * sinPhi0 * vertX
        const y0 = cy + r * cosPhi0 * radY + r * sinPhi0 * vertY
        const z0 = r * cosPhi0 * radZ + r * sinPhi0 * vertZ

        const x1 = cx + r * cosPhi1 * radX + r * sinPhi1 * vertX
        const y1 = cy + r * cosPhi1 * radY + r * sinPhi1 * vertY
        const z1 = r * cosPhi1 * radZ + r * sinPhi1 * vertZ

        vertices.push(x0, y0, z0, x1, y1, z1)
      }
    }

    // Lines along the Mobius loop (constant v, varying u)
    // These trace along the length of the tube
    for (let j = 0; j < gridSegmentsV; j++) {
      const phi = (j / gridSegmentsV) * Math.PI * 2
      const cosPhi = Math.cos(phi)
      const sinPhi = Math.sin(phi)

      for (let i = 0; i < lineDetail; i++) {
        const t0 = (i / lineDetail) * Math.PI * 2
        const t1 = ((i + 1) / lineDetail) * Math.PI * 2

        // Point at t0
        const cosT0 = Math.cos(t0)
        const sinT0 = Math.sin(t0)
        const cosHalfT0 = Math.cos(t0 / 2)
        const sinHalfT0 = Math.sin(t0 / 2)

        const cx0 = R * cosT0
        const cy0 = R * sinT0

        const x0 = cx0 + r * cosPhi * cosHalfT0 * cosT0 + r * sinPhi * (-sinHalfT0 * cosT0)
        const y0 = cy0 + r * cosPhi * cosHalfT0 * sinT0 + r * sinPhi * (-sinHalfT0 * sinT0)
        const z0 = r * cosPhi * sinHalfT0 + r * sinPhi * cosHalfT0

        // Point at t1
        const cosT1 = Math.cos(t1)
        const sinT1 = Math.sin(t1)
        const cosHalfT1 = Math.cos(t1 / 2)
        const sinHalfT1 = Math.sin(t1 / 2)

        const cx1 = R * cosT1
        const cy1 = R * sinT1

        const x1 = cx1 + r * cosPhi * cosHalfT1 * cosT1 + r * sinPhi * (-sinHalfT1 * cosT1)
        const y1 = cy1 + r * cosPhi * cosHalfT1 * sinT1 + r * sinPhi * (-sinHalfT1 * sinT1)
        const z1 = r * cosPhi * sinHalfT1 + r * sinPhi * cosHalfT1

        vertices.push(x0, y0, z0, x1, y1, z1)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))

    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
