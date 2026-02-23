import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface IcosahedronConfig extends SurfaceConfig {
  radius?: number
  subdivisions?: number  // More subdivisions = smoother (2-3 is good for beveled look)
  gridSegments?: number
}

/**
 * Icosahedron surface with beveled edges (achieved via subdivision).
 *
 * An icosphere is created by subdividing an icosahedron - this creates smooth
 * transitions between the original 20 faces while maintaining the geometric feel.
 *
 * UV mapping uses spherical coordinates (like SphereSurface) since the subdivided
 * icosahedron approximates a sphere closely. This makes movement seamless.
 */
export class IcosahedronSurface extends Surface {
  private readonly radius: number
  private readonly subdivisions: number
  private readonly gridSegments: number

  // Cache the icosahedron geometry for grid generation
  private icoGeometry: THREE.IcosahedronGeometry | null = null

  constructor(config?: IcosahedronConfig) {
    const radius = config?.radius ?? 10
    const subdivisions = config?.subdivisions ?? 2  // 2-3 gives nice beveled look
    const gridSegments = config?.gridSegments ?? 20

    // Store in temp object since we can't assign before super()
    const self = { radius, subdivisions, gridSegments }
    ;(IcosahedronSurface as any).__initData = self
    super(config)

    this.radius = radius
    this.subdivisions = subdivisions
    this.gridSegments = gridSegments

    // Set base class properties for generic rotation system
    this.surfaceRadius = radius
    this.playerLocalPosition = new THREE.Vector3(0, radius, 0) // Top of icosphere
  }

  private static getInitData(): {
    radius: number
    subdivisions: number
    gridSegments: number
  } {
    return (
      (IcosahedronSurface as any).__initData ?? {
        radius: 10,
        subdivisions: 2,
        gridSegments: 20,
      }
    )
  }

  /**
   * Get point on icosphere in LOCAL coordinates (before world rotation).
   * Uses spherical coordinates - same as SphereSurface since an icosphere
   * closely approximates a sphere.
   *
   * u: [0, 1) -> theta [0, 2*PI) (longitude / azimuth)
   * v: [0, 1] -> phi [0, PI] (latitude / inclination from north pole)
   */
  private getPointLocal(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2
    const phi = v * Math.PI
    const r = this.radius

    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    const sinTheta = Math.sin(theta)
    const cosTheta = Math.cos(theta)

    // Spherical to Cartesian
    const position = new THREE.Vector3(
      r * sinPhi * cosTheta,
      r * cosPhi,
      r * sinPhi * sinTheta
    )

    // For an icosphere, project the position onto the actual geometry
    // to get the "beveled" effect at low subdivisions
    const projectedPos = this.projectToIcosphere(position)

    // Normal is radial direction (normalized position)
    const normal = projectedPos.clone().normalize()

    // Tangent in u direction (d/dtheta) - follows longitude lines
    const tangentU = new THREE.Vector3(
      -sinPhi * sinTheta,
      0,
      sinPhi * cosTheta
    ).normalize()

    // Tangent in v direction (d/dphi) - follows latitude lines
    const tangentV = new THREE.Vector3(
      cosPhi * cosTheta,
      -sinPhi,
      cosPhi * sinTheta
    ).normalize()

    return { position: projectedPos, normal, tangentU, tangentV }
  }

  /**
   * Project a spherical position onto the icosphere surface.
   * This creates the beveled edge effect by snapping to the actual geometry.
   */
  private projectToIcosphere(spherePos: THREE.Vector3): THREE.Vector3 {
    if (!this.icoGeometry) {
      return spherePos.clone()
    }

    // Normalize direction
    const dir = spherePos.clone().normalize()

    // For an icosphere, points are already on the sphere surface
    // The "beveled" look comes from the flat shading on faces
    // But the actual vertex positions form a sphere
    // So we just return the position at the correct radius
    return dir.multiplyScalar(this.radius)
  }

  /**
   * Get point on icosphere in WORLD coordinates (after applying world rotation).
   */
  getPoint(u: number, v: number): SurfacePoint {
    const local = this.getPointLocal(u, v)
    return this.applyWorldRotation(local)
  }

  /**
   * Move on surface - uses spherical movement like SphereSurface.
   * The beveled edges don't affect movement since the icosphere is topologically
   * equivalent to a sphere.
   */
  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    // Scale du by 1/sin(phi) to correct for longitude convergence at poles
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

  /**
   * Convert world position to UV coordinates.
   * Uses standard spherical conversion.
   */
  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const normalized = worldPos.clone().normalize()

    // phi = acos(y / r), theta = atan2(z, x)
    const phi = Math.acos(Math.max(-1, Math.min(1, normalized.y)))
    let theta = Math.atan2(normalized.z, normalized.x)
    if (theta < 0) theta += Math.PI * 2

    const u = theta / (Math.PI * 2)
    const v = phi / Math.PI

    return { u, v }
  }

  /**
   * Create the icosphere mesh with beveled edges.
   * Uses IcosahedronGeometry which automatically handles subdivision.
   */
  createMesh(): THREE.Mesh {
    const { radius, subdivisions } = IcosahedronSurface.getInitData()

    // IcosahedronGeometry(radius, detail) - detail = subdivision level
    // detail 0 = base icosahedron (20 faces)
    // detail 1 = 80 faces
    // detail 2 = 320 faces (good balance of smooth + geometric)
    // detail 3 = 1280 faces (very smooth)
    this.icoGeometry = new THREE.IcosahedronGeometry(radius, subdivisions)

    return new THREE.Mesh(this.icoGeometry, this.createSurfaceMaterial())
  }

  /**
   * Create grid lines on the icosphere faces.
   * We draw lines along the edges of the subdivided triangles.
   */
  createGrid(): THREE.LineSegments {
    const { radius, subdivisions, gridSegments } = IcosahedronSurface.getInitData()
    const vertices: number[] = []

    // Create a temporary geometry to extract edges
    const tempGeo = new THREE.IcosahedronGeometry(radius, subdivisions)
    const edges = new THREE.EdgesGeometry(tempGeo, 1) // threshold angle = 1 degree

    // Get the edge positions
    const edgePositions = edges.getAttribute('position')
    for (let i = 0; i < edgePositions.count; i++) {
      vertices.push(
        edgePositions.getX(i),
        edgePositions.getY(i),
        edgePositions.getZ(i)
      )
    }

    // Also add spherical grid lines for better visual reference
    // These follow latitude/longitude like on a sphere
    const lineDetail = 32

    // Longitude lines (meridians)
    const numMeridians = Math.floor(gridSegments / 2)
    for (let i = 0; i < numMeridians; i++) {
      const theta = (i / numMeridians) * Math.PI * 2
      for (let j = 0; j < lineDetail; j++) {
        const phi0 = (j / lineDetail) * Math.PI
        const phi1 = ((j + 1) / lineDetail) * Math.PI

        // Project points onto icosphere
        const p0 = this.sphericalToIcosphere(theta, phi0, radius, tempGeo)
        const p1 = this.sphericalToIcosphere(theta, phi1, radius, tempGeo)

        vertices.push(p0.x, p0.y, p0.z)
        vertices.push(p1.x, p1.y, p1.z)
      }
    }

    // Latitude lines (parallels)
    const numParallels = Math.floor(gridSegments / 2)
    for (let j = 1; j < numParallels; j++) {
      const phi = (j / numParallels) * Math.PI
      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        const p0 = this.sphericalToIcosphere(theta0, phi, radius, tempGeo)
        const p1 = this.sphericalToIcosphere(theta1, phi, radius, tempGeo)

        vertices.push(p0.x, p0.y, p0.z)
        vertices.push(p1.x, p1.y, p1.z)
      }
    }

    tempGeo.dispose()
    edges.dispose()

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    )

    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }

  /**
   * Convert spherical coordinates to a point on the icosphere surface.
   * For smooth shaded icosphere, this is essentially a sphere.
   */
  private sphericalToIcosphere(
    theta: number,
    phi: number,
    radius: number,
    _geometry: THREE.IcosahedronGeometry
  ): THREE.Vector3 {
    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    const sinTheta = Math.sin(theta)
    const cosTheta = Math.cos(theta)

    // For a subdivided icosahedron, vertices lie on a sphere
    // The beveled look comes from flat shading, not vertex positions
    return new THREE.Vector3(
      radius * sinPhi * cosTheta,
      radius * cosPhi,
      radius * sinPhi * sinTheta
    )
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    super.dispose()
    if (this.icoGeometry) {
      this.icoGeometry.dispose()
      this.icoGeometry = null
    }
  }
}
