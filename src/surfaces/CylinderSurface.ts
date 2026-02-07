import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface CylinderConfig extends SurfaceConfig {
  radius?: number // Major radius - distance from center axis to tube center (default 5)
  height?: number // Tube cross-section diameter (default 4). Capped at 80% of radius.
  gridSegmentsU?: number
  gridSegmentsV?: number
}

/**
 * Cylinder/Ring Surface: topologically a torus, visually a wide ring/band.
 *
 * A ring playable on both outside and inside with smooth transitions everywhere.
 * Internally uses torus parametric equations with proportions that give a
 * ring-like appearance (large major radius, smaller tube cross-section).
 *
 * UV mapping:
 *   u: [0, 1) azimuthal angle around the ring (major circle)
 *   v: [0, 1) position around the tube cross-section (minor circle)
 *     v=0:   outer edge (farthest from center)
 *     v=0.5: inner edge (closest to center, inside the hole)
 *
 * Parametric torus equations:
 *   x = (R + r*cos(theta)) * cos(phi)
 *   y = r * sin(theta)
 *   z = (R + r*cos(theta)) * sin(phi)
 *
 * where phi = u * 2pi (ring), theta = v * 2pi (tube)
 */
export class CylinderSurface extends Surface {
  private readonly majorRadius: number
  private readonly minorRadius: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  constructor(config?: CylinderConfig) {
    const radius = config?.radius ?? 5
    const height = config?.height ?? 4
    const gridSegmentsU = config?.gridSegmentsU ?? 24
    const gridSegmentsV = config?.gridSegmentsV ?? 16

    // Compute torus radii: cap minorRadius at 40% of majorRadius to keep ring shape
    const majorRadius = radius
    const minorRadius = Math.min(height / 2, radius * 0.4)

    ;(CylinderSurface as any).__initData = {
      majorRadius,
      minorRadius,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.majorRadius = majorRadius
    this.minorRadius = minorRadius
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    this.surfaceRadius = majorRadius + minorRadius
    this.playerLocalPosition = new THREE.Vector3(majorRadius + minorRadius, 0, 0)
  }

  private static getInitData(): {
    majorRadius: number
    minorRadius: number
    gridSegmentsU: number
    gridSegmentsV: number
  } {
    return (
      (CylinderSurface as any).__initData ?? {
        majorRadius: 5,
        minorRadius: 2,
        gridSegmentsU: 24,
        gridSegmentsV: 16,
      }
    )
  }

  getPoint(u: number, v: number): SurfacePoint {
    const phi = u * Math.PI * 2 // Around ring (major circle)
    const theta = v * Math.PI * 2 // Around tube (minor circle)
    const R = this.majorRadius
    const r = this.minorRadius

    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)

    const ringRadius = R + r * cosTheta
    const position = new THREE.Vector3(
      ringRadius * cosPhi,
      r * sinTheta,
      ringRadius * sinPhi
    )

    // Normal points outward from tube surface
    const normal = new THREE.Vector3(
      cosTheta * cosPhi,
      sinTheta,
      cosTheta * sinPhi
    ).normalize()

    // Tangent in u direction (d/dphi - around the ring)
    const tangentU = new THREE.Vector3(-sinPhi, 0, cosPhi).normalize()

    // Tangent in v direction (d/dtheta - around the tube cross-section)
    const tangentV = new THREE.Vector3(
      -sinTheta * cosPhi,
      cosTheta,
      -sinTheta * sinPhi
    ).normalize()

    return { position, normal, tangentU, tangentV }
  }

  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    const theta = v * Math.PI * 2
    const cosTheta = Math.cos(theta)
    const R = this.majorRadius
    const r = this.minorRadius

    // Scale du for varying circumference at different tube positions
    const localRadius = R + r * cosTheta
    const scaleFactor = localRadius > 0.001 ? R / localRadius : 1

    let newU = u + du * scaleFactor
    let newV = v + dv

    // Both u and v wrap around [0, 1) - doubly periodic torus
    newU = ((newU % 1) + 1) % 1
    newV = ((newV % 1) + 1) % 1

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const R = this.majorRadius

    // Find phi (u) - angle around the ring
    let phi = Math.atan2(worldPos.z, worldPos.x)
    if (phi < 0) phi += Math.PI * 2

    // Find tube center at this phi
    const cosPhi = Math.cos(phi)
    const sinPhi = Math.sin(phi)
    const tubeCenterX = R * cosPhi
    const tubeCenterZ = R * sinPhi

    // Vector from tube center to point
    const toPointX = worldPos.x - tubeCenterX
    const toPointY = worldPos.y
    const toPointZ = worldPos.z - tubeCenterZ

    // Project onto tube cross-section plane
    const outward = toPointX * cosPhi + toPointZ * sinPhi

    // theta (v) is the angle in the tube cross-section
    let theta = Math.atan2(toPointY, outward)
    if (theta < 0) theta += Math.PI * 2

    const u = phi / (Math.PI * 2)
    const v = theta / (Math.PI * 2)

    return { u, v }
  }

  createMesh(): THREE.Mesh {
    const { majorRadius, minorRadius, gridSegmentsU, gridSegmentsV } =
      CylinderSurface.getInitData()

    // Three.js TorusGeometry(radius, tube, radialSegments, tubularSegments)
    const geometry = new THREE.TorusGeometry(
      majorRadius,
      minorRadius,
      gridSegmentsV * 2, // segments around tube (radial)
      gridSegmentsU * 2 // segments around ring (tubular)
    )
    // Rotate so hole is along Y axis
    geometry.rotateX(Math.PI / 2)
    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { majorRadius, minorRadius, gridSegmentsU, gridSegmentsV } =
      CylinderSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 48

    const R = majorRadius
    const r = minorRadius

    // Lines around the ring (constant v/theta, varying u/phi)
    for (let j = 0; j < gridSegmentsV; j++) {
      const theta = (j / gridSegmentsV) * Math.PI * 2
      const cosTheta = Math.cos(theta)
      const sinTheta = Math.sin(theta)
      const ringRadius = R + r * cosTheta

      for (let i = 0; i < lineDetail; i++) {
        const phi0 = (i / lineDetail) * Math.PI * 2
        const phi1 = ((i + 1) / lineDetail) * Math.PI * 2

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

    // Lines around the tube (constant u/phi, varying v/theta)
    for (let i = 0; i < gridSegmentsU; i++) {
      const phi = (i / gridSegmentsU) * Math.PI * 2
      const cosPhi = Math.cos(phi)
      const sinPhi = Math.sin(phi)

      for (let j = 0; j < lineDetail; j++) {
        const theta0 = (j / lineDetail) * Math.PI * 2
        const theta1 = ((j + 1) / lineDetail) * Math.PI * 2

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

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(vertices, 3)
    )

    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }
}
