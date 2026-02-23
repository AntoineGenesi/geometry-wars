import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface MobiusConfig extends SurfaceConfig {
  majorRadius?: number
  stripWidth?: number
  gridSegmentsU?: number
  gridSegmentsV?: number
}

/**
 * Mobius strip surface - a one-sided non-orientable surface.
 *
 * The key topological property: traveling once around the strip (u: 0 -> 1)
 * brings you to the "other side" (v gets inverted). You must go around twice
 * to return to your starting point with the same orientation.
 *
 * Standard Mobius parametric equations:
 *   x = (R + s * cos(t/2)) * cos(t)
 *   y = (R + s * cos(t/2)) * sin(t)
 *   z = s * sin(t/2)
 *
 * where:
 *   R = major radius (center of strip)
 *   s = position across strip width [-w, w]
 *   t = angle around strip [0, 2*PI]
 *
 * UV mapping:
 *   u = t / (2*PI)  -> [0, 1] along the strip length (wraps with twist!)
 *   v = (s + w) / (2*w)  -> [0, 1] across the strip width
 */
export class MobiusSurface extends Surface {
  private readonly majorRadius: number
  private readonly stripWidth: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  constructor(config?: MobiusConfig) {
    const majorRadius = config?.majorRadius ?? 8
    const stripWidth = config?.stripWidth ?? 3
    const gridSegmentsU = config?.gridSegmentsU ?? 32
    const gridSegmentsV = config?.gridSegmentsV ?? 8

    ;(MobiusSurface as any).__initData = {
      majorRadius,
      stripWidth,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.majorRadius = majorRadius
    this.stripWidth = stripWidth
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Set base class properties for generic rotation system
    this.surfaceRadius = majorRadius + stripWidth
    // Spawn on outer part of strip (away from center seam at t=0 where
    // non-orientable winding causes geodesic walker direction reversal)
    this.playerLocalPosition = new THREE.Vector3(majorRadius + stripWidth * 0.5, 0, 0)
  }

  private static getInitData() {
    return (
      (MobiusSurface as any).__initData ?? {
        majorRadius: 8,
        stripWidth: 3,
        gridSegmentsU: 32,
        gridSegmentsV: 8,
      }
    )
  }

  /**
   * Get point on Mobius strip in LOCAL coordinates.
   *
   * @param u - Position along strip length [0, 1], wraps with twist
   * @param v - Position across strip width [0, 1]
   */
  private getPointLocal(u: number, v: number): SurfacePoint {
    const R = this.majorRadius
    const w = this.stripWidth

    // Convert UV to parametric coordinates
    const t = u * Math.PI * 2  // Angle around strip
    const s = (v - 0.5) * 2 * w  // Position across width [-w, w]

    // Half-angle for the twist
    const halfT = t / 2

    const cosT = Math.cos(t)
    const sinT = Math.sin(t)
    const cosHalfT = Math.cos(halfT)
    const sinHalfT = Math.sin(halfT)

    // Standard Mobius strip parametric equations
    const position = new THREE.Vector3(
      (R + s * cosHalfT) * cosT,
      (R + s * cosHalfT) * sinT,
      s * sinHalfT
    )

    // Compute partial derivatives for tangents
    // d/dt (position)
    const dtX = -s * 0.5 * sinHalfT * cosT - (R + s * cosHalfT) * sinT
    const dtY = -s * 0.5 * sinHalfT * sinT + (R + s * cosHalfT) * cosT
    const dtZ = s * 0.5 * cosHalfT

    // d/ds (position)
    const dsX = cosHalfT * cosT
    const dsY = cosHalfT * sinT
    const dsZ = sinHalfT

    const tangentU = new THREE.Vector3(dtX, dtY, dtZ).normalize()
    const tangentV = new THREE.Vector3(dsX, dsY, dsZ).normalize()

    // Normal is cross product of tangents (may flip due to non-orientability)
    const normal = new THREE.Vector3()
      .crossVectors(tangentU, tangentV)
      .normalize()

    return { position, normal, tangentU, tangentV }
  }

  /**
   * Get point on Mobius strip in WORLD coordinates (after applying world rotation).
   */
  getPoint(u: number, v: number): SurfacePoint {
    const local = this.getPointLocal(u, v)
    return this.applyWorldRotation(local)
  }

  /**
   * Move on the Mobius strip surface.
   *
   * The key topological behavior: when u wraps from 1 to 0 (or 0 to 1),
   * v must be inverted (1 - v) to account for the twist.
   */
  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    let newU = u + du
    let newV = v + dv

    // Track how many times we wrap around
    let wraps = 0

    // Handle u wrapping with the Mobius twist
    while (newU >= 1) {
      newU -= 1
      wraps++
    }
    while (newU < 0) {
      newU += 1
      wraps++
    }

    // Each wrap inverts v due to the half-twist
    if (wraps % 2 === 1) {
      newV = 1 - newV
    }

    // Clamp v to stay on the strip with small margin
    const epsilon = 0.02
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  /**
   * Convert world position to UV coordinates on the Mobius strip.
   *
   * This is an approximation since the Mobius strip is non-orientable
   * and a point can map to multiple UV coordinates.
   */
  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const R = this.majorRadius
    const w = this.stripWidth

    // Undo map-size scale: positions coming in (player via MeshWalker, enemies via
    // applySurfaceTransform) are in scaled world space (group.scale * local coords).
    // The Mobius parametric equations use local (1x) coordinates, so we must un-scale
    // before computing u/v. SphereSurface avoids this by using normalize() (scale-invariant),
    // but the Mobius toPoint projection depends on absolute distances.
    const scale = this.group.scale.x
    const pos = (scale !== 1.0 && scale > 0)
      ? new THREE.Vector3(worldPos.x / scale, worldPos.y / scale, worldPos.z / scale)
      : worldPos

    // Find the angle t from the XY projection
    let t = Math.atan2(pos.y, pos.x)
    if (t < 0) t += Math.PI * 2

    // At angle t, the center of the strip is at:
    const centerX = R * Math.cos(t)
    const centerY = R * Math.sin(t)

    // Vector from center line to the point (in strip plane)
    const toPoint = new THREE.Vector3(
      pos.x - centerX,
      pos.y - centerY,
      pos.z
    )

    // The strip direction at angle t
    const halfT = t / 2
    const stripDir = new THREE.Vector3(
      Math.cos(halfT) * Math.cos(t),
      Math.cos(halfT) * Math.sin(t),
      Math.sin(halfT)
    ).normalize()

    // Project onto strip direction to get s
    const s = toPoint.dot(stripDir)

    // Convert back to UV
    const u = t / (Math.PI * 2)
    const v = (s / w + 1) / 2  // Map [-w, w] to [0, 1]

    return {
      u: Math.max(0, Math.min(1, u)),
      v: Math.max(0, Math.min(1, v)),
    }
  }

  createMesh(): THREE.Mesh {
    const { majorRadius, stripWidth, gridSegmentsU, gridSegmentsV } =
      MobiusSurface.getInitData()

    // Create custom geometry for the Mobius strip
    const geometry = new THREE.BufferGeometry()
    const vertices: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    const R = majorRadius
    const w = stripWidth
    const segU = gridSegmentsU * 2  // Higher resolution for smooth rendering
    const segV = gridSegmentsV * 2

    // Generate vertices for rows 0..segU-1 only (NOT segU).
    // Row segU would duplicate row 0's positions due to the Mobius twist
    // (t=2*PI maps to same positions as t=0 with v flipped).
    // Using duplicate vertices creates degenerate zero-length edges that the
    // HalfEdgeMesh treats as boundaries, making the seam impassable.
    for (let i = 0; i < segU; i++) {
      const t = (i / segU) * Math.PI * 2
      const halfT = t / 2
      const cosT = Math.cos(t)
      const sinT = Math.sin(t)
      const cosHalfT = Math.cos(halfT)
      const sinHalfT = Math.sin(halfT)

      for (let j = 0; j <= segV; j++) {
        const s = (j / segV - 0.5) * 2 * w

        // Position
        const x = (R + s * cosHalfT) * cosT
        const y = (R + s * cosHalfT) * sinT
        const z = s * sinHalfT

        vertices.push(x, y, z)

        // Compute tangents for normal
        const dtX = -s * 0.5 * sinHalfT * cosT - (R + s * cosHalfT) * sinT
        const dtY = -s * 0.5 * sinHalfT * sinT + (R + s * cosHalfT) * cosT
        const dtZ = s * 0.5 * cosHalfT

        const dsX = cosHalfT * cosT
        const dsY = cosHalfT * sinT
        const dsZ = sinHalfT

        const tangentU = new THREE.Vector3(dtX, dtY, dtZ)
        const tangentV = new THREE.Vector3(dsX, dsY, dsZ)
        const normal = new THREE.Vector3().crossVectors(tangentU, tangentV).normalize()

        normals.push(normal.x, normal.y, normal.z)

        // UV coordinates
        uvs.push(i / segU, j / segV)
      }
    }

    // Generate indices for triangles (main body: rows 0 through segU-2)
    for (let i = 0; i < segU - 1; i++) {
      for (let j = 0; j < segV; j++) {
        const a = i * (segV + 1) + j
        const b = a + segV + 1
        const c = a + 1
        const d = b + 1

        indices.push(a, b, c)
        indices.push(b, d, c)
      }
    }

    // Mobius twist: connect the last body row (segU-1) back to the first row (0)
    // with v-flipped indices. At t approaching 2*PI, the strip has undergone
    // a half-twist, so v=j maps to v=segV-j on the first row.
    //
    // This directly reuses first-row vertex indices (with v-flip) instead of
    // creating a duplicate last row. This ensures the HalfEdgeMesh sees shared
    // vertex indices across the seam, producing proper twin edges instead of
    // degenerate self-edges.
    const lastBodyRow = (segU - 1) * (segV + 1)
    for (let j = 0; j < segV; j++) {
      const a = lastBodyRow + j               // last body row, v=j
      const b = 0 + (segV - j)               // first row, v=segV-j (twisted)
      const c = lastBodyRow + j + 1           // last body row, v=j+1
      const d = 0 + (segV - j - 1)           // first row, v=segV-j-1 (twisted)

      indices.push(a, b, c)
      indices.push(b, d, c)
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)

    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { majorRadius, stripWidth, gridSegmentsU, gridSegmentsV } =
      MobiusSurface.getInitData()

    const vertices: number[] = []
    const R = majorRadius
    const w = stripWidth
    const lineDetail = 64  // Smooth curves

    // Lines along the strip length (constant v, varying u)
    for (let j = 0; j <= gridSegmentsV; j++) {
      const s = (j / gridSegmentsV - 0.5) * 2 * w

      for (let i = 0; i < lineDetail; i++) {
        const t0 = (i / lineDetail) * Math.PI * 2
        const t1 = ((i + 1) / lineDetail) * Math.PI * 2

        const halfT0 = t0 / 2
        const halfT1 = t1 / 2

        const x0 = (R + s * Math.cos(halfT0)) * Math.cos(t0)
        const y0 = (R + s * Math.cos(halfT0)) * Math.sin(t0)
        const z0 = s * Math.sin(halfT0)

        const x1 = (R + s * Math.cos(halfT1)) * Math.cos(t1)
        const y1 = (R + s * Math.cos(halfT1)) * Math.sin(t1)
        const z1 = s * Math.sin(halfT1)

        vertices.push(x0, y0, z0, x1, y1, z1)
      }
    }

    // Lines across the strip width (constant u, varying v)
    for (let i = 0; i < gridSegmentsU; i++) {
      const t = (i / gridSegmentsU) * Math.PI * 2
      const halfT = t / 2
      const cosT = Math.cos(t)
      const sinT = Math.sin(t)
      const cosHalfT = Math.cos(halfT)
      const sinHalfT = Math.sin(halfT)

      for (let j = 0; j < gridSegmentsV; j++) {
        const s0 = (j / gridSegmentsV - 0.5) * 2 * w
        const s1 = ((j + 1) / gridSegmentsV - 0.5) * 2 * w

        const x0 = (R + s0 * cosHalfT) * cosT
        const y0 = (R + s0 * cosHalfT) * sinT
        const z0 = s0 * sinHalfT

        const x1 = (R + s1 * cosHalfT) * cosT
        const y1 = (R + s1 * cosHalfT) * sinT
        const z1 = s1 * sinHalfT

        vertices.push(x0, y0, z0, x1, y1, z1)
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
