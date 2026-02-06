import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface TorusConfig extends SurfaceConfig {
  majorRadius?: number // Distance from center to tube center (default 6)
  minorRadius?: number // Radius of the tube itself (default 2)
  gridSegmentsU?: number
  gridSegmentsV?: number
}

export class TorusSurface extends Surface {
  private readonly majorRadius: number
  private readonly minorRadius: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  constructor(config?: TorusConfig) {
    const majorRadius = config?.majorRadius ?? 6
    const minorRadius = config?.minorRadius ?? 2
    const gridSegmentsU = config?.gridSegmentsU ?? 24
    const gridSegmentsV = config?.gridSegmentsV ?? 12

    // Store in a temp object since we can't assign before super()
    const self = { majorRadius, minorRadius, gridSegmentsU, gridSegmentsV }
    ;(TorusSurface as any).__initData = self
    super(config)

    this.majorRadius = majorRadius
    this.minorRadius = minorRadius
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Set base class properties for generic rotation system
    // Surface radius is the outer extent (majorRadius + minorRadius)
    this.surfaceRadius = majorRadius + minorRadius
    // Player starts at the outer edge of the torus (top of the tube cross-section)
    // u=0 is outer edge, v=0 is at x-axis
    this.playerLocalPosition = new THREE.Vector3(majorRadius + minorRadius, 0, 0)
  }

  private static getInitData(): {
    majorRadius: number
    minorRadius: number
    gridSegmentsU: number
    gridSegmentsV: number
  } {
    return (
      (TorusSurface as any).__initData ?? {
        majorRadius: 6,
        minorRadius: 2,
        gridSegmentsU: 24,
        gridSegmentsV: 12,
      }
    )
  }

  /**
   * Get point on torus in LOCAL coordinates (before world rotation).
   *
   * UV mapping for torus:
   * - u: 0-1 wraps around the "tube" (minor circle, going through the hole)
   *      u=0: outer edge (farthest from center)
   *      u=0.5: inner edge (closest to center, inside the hole)
   * - v: 0-1 wraps around the "ring" (major circle, around the donut)
   *
   * Parametric equations:
   * x = (R + r*cos(theta)) * cos(phi)
   * y = r * sin(theta)
   * z = (R + r*cos(theta)) * sin(phi)
   *
   * where theta = u * 2pi (tube/minor angle), phi = v * 2pi (ring/major angle)
   * R = majorRadius, r = minorRadius
   */
  private getPointLocal(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2 // Angle around tube (minor circle)
    const phi = v * Math.PI * 2 // Angle around ring (major circle)
    const R = this.majorRadius
    const r = this.minorRadius

    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)

    // Position on torus
    const ringRadius = R + r * cosTheta
    const position = new THREE.Vector3(
      ringRadius * cosPhi,
      r * sinTheta,
      ringRadius * sinPhi
    )

    // Normal vector (points outward from the tube surface)
    // Direction from tube center to surface point
    const normal = new THREE.Vector3(
      cosTheta * cosPhi,
      sinTheta,
      cosTheta * sinPhi
    ).normalize()

    // Tangent in u direction (d/dtheta - around the tube, through the hole)
    const tangentU = new THREE.Vector3(
      -sinTheta * cosPhi,
      cosTheta,
      -sinTheta * sinPhi
    ).normalize()

    // Tangent in v direction (d/dphi - around the ring, around the donut)
    const tangentV = new THREE.Vector3(-sinPhi, 0, cosPhi).normalize()

    return { position, normal, tangentU, tangentV }
  }

  /**
   * Get point on torus in WORLD coordinates (after applying world rotation).
   */
  getPoint(u: number, v: number): SurfacePoint {
    const local = this.getPointLocal(u, v)
    return this.applyWorldRotation(local)
  }

  /**
   * Move on the torus surface. Both u and v wrap around [0, 1).
   * The torus is doubly periodic - you can travel endlessly in any direction
   * and will wrap around, including going THROUGH the hole (by changing u).
   *
   * Movement in v (around the ring) is corrected for varying circumference:
   * - At u=0 (outer edge): circumference is (R+r)*2pi (larger)
   * - At u=0.5 (inner edge): circumference is (R-r)*2pi (smaller)
   */
  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    const theta = u * Math.PI * 2
    const cosTheta = Math.cos(theta)
    const R = this.majorRadius
    const r = this.minorRadius

    // The local radius at this point on the tube (distance from main axis)
    const localRadius = R + r * cosTheta

    // Scale dv to account for varying circumference
    // At outer edge (u=0, cosTheta=1): localRadius = R+r, we move slower in v
    // At inner edge (u=0.5, cosTheta=-1): localRadius = R-r, we move faster in v
    // Normalize to the major radius R for consistent apparent speed
    const scaleFactor = localRadius > 0.001 ? R / localRadius : 1

    let newU = u + du
    let newV = v + dv * scaleFactor

    // Both u and v wrap around [0, 1) - this is what makes the torus doubly periodic
    // Traveling in u takes you THROUGH the hole!
    newU = ((newU % 1) + 1) % 1
    newV = ((newV % 1) + 1) % 1

    return { u: newU, v: newV }
  }

  /**
   * Convert world position to surface UV coordinates.
   * Finds the closest point on the torus and returns its UV.
   */
  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const R = this.majorRadius

    // Find phi (v) - the angle around the main ring
    // Project onto XZ plane to find the angle
    let phi = Math.atan2(worldPos.z, worldPos.x)
    if (phi < 0) phi += Math.PI * 2

    // Find the center of the tube cross-section at this phi
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)
    const tubeCenterX = R * cosPhi
    const tubeCenterZ = R * sinPhi

    // Vector from tube center to the point
    const toPointX = worldPos.x - tubeCenterX
    const toPointY = worldPos.y
    const toPointZ = worldPos.z - tubeCenterZ

    // Project onto the tube cross-section plane
    // The outward direction in this plane is (cosPhi, 0, sinPhi)
    const outward = toPointX * cosPhi + toPointZ * sinPhi

    // theta (u) is the angle in the tube cross-section
    // outward component gives radial direction, y gives vertical
    let theta = Math.atan2(toPointY, outward)
    if (theta < 0) theta += Math.PI * 2

    const u = theta / (Math.PI * 2)
    const v = phi / (Math.PI * 2)

    return { u, v }
  }

  createMesh(): THREE.Mesh {
    const { majorRadius, minorRadius, gridSegmentsU, gridSegmentsV } =
      TorusSurface.getInitData()
    // Three.js TorusGeometry(radius, tube, radialSegments, tubularSegments)
    // radialSegments = segments around the tube (our u direction)
    // tubularSegments = segments around the ring (our v direction)
    const geometry = new THREE.TorusGeometry(
      majorRadius,
      minorRadius,
      gridSegmentsU * 2,
      gridSegmentsV * 2
    )
    // Three.js creates torus in XY plane (hole along Z axis)
    // Rotate so hole is along Y axis (our convention)
    geometry.rotateX(Math.PI / 2)
    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { majorRadius, minorRadius, gridSegmentsU, gridSegmentsV } =
      TorusSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 48 // Smooth curves

    const R = majorRadius
    const r = minorRadius

    // Lines around the tube (constant v/phi, varying u/theta)
    // These are circles around the tube cross-section
    for (let j = 0; j < gridSegmentsV; j++) {
      const phi = (j / gridSegmentsV) * Math.PI * 2
      const cosPhi = Math.cos(phi)
      const sinPhi = Math.sin(phi)

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        const cosTheta0 = Math.cos(theta0)
        const sinTheta0 = Math.sin(theta0)
        const cosTheta1 = Math.cos(theta1)
        const sinTheta1 = Math.sin(theta1)

        const ringRadius0 = R + r * cosTheta0
        const ringRadius1 = R + r * cosTheta1

        vertices.push(
          ringRadius0 * cosPhi,
          r * sinTheta0,
          ringRadius0 * sinPhi
        )
        vertices.push(
          ringRadius1 * cosPhi,
          r * sinTheta1,
          ringRadius1 * sinPhi
        )
      }
    }

    // Lines around the ring (constant u/theta, varying v/phi)
    // These are circles going around the donut
    for (let i = 0; i < gridSegmentsU; i++) {
      const theta = (i / gridSegmentsU) * Math.PI * 2
      const cosTheta = Math.cos(theta)
      const sinTheta = Math.sin(theta)
      const ringRadius = R + r * cosTheta

      for (let j = 0; j < lineDetail; j++) {
        const phi0 = (j / lineDetail) * Math.PI * 2
        const phi1 = ((j + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          ringRadius * Math.cos(phi0),
          r * sinTheta,
          ringRadius * Math.sin(phi0)
        )
        vertices.push(
          ringRadius * Math.cos(phi1),
          r * sinTheta,
          ringRadius * Math.sin(phi1)
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
