import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface SphereConfig extends SurfaceConfig {
  radius?: number
  gridSegmentsU?: number
  gridSegmentsV?: number
}

export class SphereSurface extends Surface {
  private readonly radius: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  constructor(config?: SphereConfig) {
    const radius = config?.radius ?? 10
    const gridSegmentsU = config?.gridSegmentsU ?? 20
    const gridSegmentsV = config?.gridSegmentsV ?? 20

    // Store in a temp object since we can't assign before super()
    const self = { radius, gridSegmentsU, gridSegmentsV }
    ;(SphereSurface as any).__initData = self
    super(config)

    this.radius = radius
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Set base class properties for generic rotation system
    this.surfaceRadius = radius
    this.playerLocalPosition = new THREE.Vector3(0, radius, 0) // Top of sphere
  }

  private static getInitData(): {
    radius: number
    gridSegmentsU: number
    gridSegmentsV: number
  } {
    return (
      (SphereSurface as any).__initData ?? {
        radius: 10,
        gridSegmentsU: 20,
        gridSegmentsV: 20,
      }
    )
  }

  /**
   * Get point on sphere in LOCAL coordinates (before world rotation).
   * Used internally for calculations.
   */
  private getPointLocal(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2
    const phi = v * Math.PI
    const r = this.radius

    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    const sinTheta = Math.sin(theta)
    const cosTheta = Math.cos(theta)

    const position = new THREE.Vector3(
      r * sinPhi * cosTheta,
      r * cosPhi,
      r * sinPhi * sinTheta
    )

    const normal = position.clone().normalize()

    // Tangent in u direction (d/dtheta)
    const tangentU = new THREE.Vector3(
      -sinPhi * sinTheta,
      0,
      sinPhi * cosTheta
    ).normalize()

    // Tangent in v direction (d/dphi)
    const tangentV = new THREE.Vector3(
      cosPhi * cosTheta,
      -sinPhi,
      cosPhi * sinTheta
    ).normalize()

    return { position, normal, tangentU, tangentV }
  }

  /**
   * Get point on sphere in WORLD coordinates (after applying world rotation).
   * Uses the base class applyWorldRotation for consistency.
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
    // Scale du by 1/sin(phi) to correct for latitude convergence at poles
    const phi = v * Math.PI
    const sinPhi = Math.sin(phi)
    const correctedDu = sinPhi > 0.001 ? du / sinPhi : 0

    let newU = u + correctedDu
    let newV = v + dv

    // Wrap u around [0, 1)
    newU = ((newU % 1) + 1) % 1

    // Clamp v to [epsilon, 1-epsilon] to avoid pole singularities
    const epsilon = 0.01
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const normalized = worldPos.clone().normalize()

    // phi = acos(y / r), theta = atan2(z, x)
    const phi = Math.acos(
      Math.max(-1, Math.min(1, normalized.y))
    )
    let theta = Math.atan2(normalized.z, normalized.x)
    if (theta < 0) theta += Math.PI * 2

    const u = theta / (Math.PI * 2)
    const v = phi / Math.PI

    return { u, v }
  }

  createMesh(): THREE.Mesh {
    const { radius, gridSegmentsU, gridSegmentsV } =
      SphereSurface.getInitData()
    const geometry = this._buildSphereGeometry(
      radius,
      gridSegmentsU * 2,
      gridSegmentsV * 2,
    )
    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  /**
   * Build a sphere geometry with small pole cap triangles.
   *
   * THREE.SphereGeometry creates cap triangles ~0.785 world units wide (on a
   * radius-10, 40-segment sphere). These large cap triangles cause the geodesic
   * face-walker to get stuck and circle at poles, producing the "pole skip".
   *
   * Fix: use MIN_SIN_PHI = 0.01 so the first ring is placed only ~0.1 world
   * units from the apex — small enough for the geodesic walker to cross in one
   * step. This mirrors exactly what PeanutSurface does for its apex regions.
   *
   * Structure:
   *   vertex 0           = top apex (0, radius, 0)
   *   vertices 1 .. N    = regular rings j=0..rings (segments+1 verts each)
   *   vertex N+1         = bottom apex (0, -radius, 0)
   *   Fan triangles cap the top and bottom with the apex vertices.
   */
  private _buildSphereGeometry(
    radius: number,
    segments: number,
    rings: number,
  ): THREE.BufferGeometry {
    // Minimum sin(phi) at the pole rings — limits cap-triangle size to ~0.1 world
    // units (radius * MIN_SIN_PHI) instead of the ~0.785 units from SphereGeometry.
    const MIN_SIN_PHI = 0.01

    const geometry = new THREE.BufferGeometry()
    const vertices: number[] = []
    const indices: number[] = []
    const normals: number[] = []

    // --- Vertex 0: top apex ---
    vertices.push(0, radius, 0)
    normals.push(0, 1, 0)

    // --- Rings j=0..rings with clamped sin(phi) near poles ---
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * Math.PI
      const rawSinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      // Clamp sin(phi) so the pole rings are slightly offset from the apex.
      // This gives small cap triangles (height ≈ radius * MIN_SIN_PHI = 0.1)
      // rather than the large ones THREE.SphereGeometry produces.
      const effectiveSinPhi =
        Math.abs(rawSinPhi) < MIN_SIN_PHI
          ? MIN_SIN_PHI * (rawSinPhi >= 0 ? 1 : -1)
          : rawSinPhi

      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2
        const cosTheta = Math.cos(theta)
        const sinTheta = Math.sin(theta)

        vertices.push(
          radius * effectiveSinPhi * cosTheta,
          radius * cosPhi,
          radius * effectiveSinPhi * sinTheta,
        )

        // Outward normal (exact sphere normal, not affected by effectiveSinPhi clamping)
        const nx = effectiveSinPhi * cosTheta
        const ny = cosPhi
        const nz = effectiveSinPhi * sinTheta
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz)
        normals.push(nx / nLen, ny / nLen, nz / nLen)
      }
    }

    // --- Last vertex: bottom apex ---
    vertices.push(0, -radius, 0)
    normals.push(0, -1, 0)

    const topApex = 0
    const ringStart = (j: number) => 1 + j * (segments + 1)
    const bottomApex = 1 + (rings + 1) * (segments + 1)

    // --- Fan: top apex → first ring (j=0) ---
    for (let i = 0; i < segments; i++) {
      const a = ringStart(0) + i
      const b = ringStart(0) + i + 1
      indices.push(topApex, b, a)
    }

    // --- Quad strips between adjacent rings ---
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segments; i++) {
        const a = ringStart(j) + i
        const b = a + 1
        const c = ringStart(j + 1) + i
        const d = c + 1
        indices.push(a, b, c, b, d, c)
      }
    }

    // --- Fan: last ring (j=rings) → bottom apex ---
    for (let i = 0; i < segments; i++) {
      const a = ringStart(rings) + i
      const b = ringStart(rings) + i + 1
      indices.push(a, b, bottomApex)
    }

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3),
    )
    geometry.setAttribute(
      'normal',
      new THREE.Float32BufferAttribute(normals, 3),
    )
    geometry.setIndex(indices)

    return geometry
  }

  createGrid(): THREE.LineSegments {
    const { radius, gridSegmentsU, gridSegmentsV } =
      SphereSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 32

    // Longitude lines (constant theta)
    for (let i = 0; i < gridSegmentsU; i++) {
      const theta = (i / gridSegmentsU) * Math.PI * 2
      for (let j = 0; j < lineDetail; j++) {
        const phi0 = (j / lineDetail) * Math.PI
        const phi1 = ((j + 1) / lineDetail) * Math.PI

        vertices.push(
          radius * Math.sin(phi0) * Math.cos(theta),
          radius * Math.cos(phi0),
          radius * Math.sin(phi0) * Math.sin(theta)
        )
        vertices.push(
          radius * Math.sin(phi1) * Math.cos(theta),
          radius * Math.cos(phi1),
          radius * Math.sin(phi1) * Math.sin(theta)
        )
      }
    }

    // Latitude lines (constant phi)
    for (let j = 1; j < gridSegmentsV; j++) {
      const phi = (j / gridSegmentsV) * Math.PI
      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          radius * Math.sin(phi) * Math.cos(theta0),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta0)
        )
        vertices.push(
          radius * Math.sin(phi) * Math.cos(theta1),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta1)
        )
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
