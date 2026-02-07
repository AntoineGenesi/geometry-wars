import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface DentedSphereConfig extends SurfaceConfig {
  radius?: number
  dentAmplitude?: number
  dentFrequencyU?: number
  dentFrequencyV?: number
  gridSegmentsU?: number
  gridSegmentsV?: number
}

export class DentedSphereSurface extends Surface {
  private readonly radius: number
  private readonly dentAmplitude: number
  private readonly dentFrequencyU: number
  private readonly dentFrequencyV: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  constructor(config?: DentedSphereConfig) {
    const radius = config?.radius ?? 8
    const dentAmplitude = config?.dentAmplitude ?? 0.5
    const dentFrequencyU = config?.dentFrequencyU ?? 6
    const dentFrequencyV = config?.dentFrequencyV ?? 4
    const gridSegmentsU = config?.gridSegmentsU ?? 24
    const gridSegmentsV = config?.gridSegmentsV ?? 24

    // Store in a temp object since we can't assign before super()
    const self = {
      radius,
      dentAmplitude,
      dentFrequencyU,
      dentFrequencyV,
      gridSegmentsU,
      gridSegmentsV,
    }
    ;(DentedSphereSurface as any).__initData = self
    super(config)

    this.radius = radius
    this.dentAmplitude = dentAmplitude
    this.dentFrequencyU = dentFrequencyU
    this.dentFrequencyV = dentFrequencyV
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Set base class properties for generic rotation system
    this.surfaceRadius = radius
    this.playerLocalPosition = new THREE.Vector3(0, this.getRadius(0, 0.5), 0)
  }

  private static getInitData(): {
    radius: number
    dentAmplitude: number
    dentFrequencyU: number
    dentFrequencyV: number
    gridSegmentsU: number
    gridSegmentsV: number
  } {
    return (
      (DentedSphereSurface as any).__initData ?? {
        radius: 8,
        dentAmplitude: 0.5,
        dentFrequencyU: 6,
        dentFrequencyV: 4,
        gridSegmentsU: 24,
        gridSegmentsV: 24,
      }
    )
  }

  /**
   * Calculate the displaced radius at a given UV position.
   * r = radius + amplitude * sin(freqU * u * 2pi) * sin(freqV * v * pi)
   */
  private getRadius(u: number, v: number): number {
    const displacement =
      this.dentAmplitude *
      Math.sin(this.dentFrequencyU * u * Math.PI * 2) *
      Math.sin(this.dentFrequencyV * v * Math.PI)
    return this.radius + displacement
  }

  /**
   * Calculate partial derivative of radius with respect to u.
   * dr/du = amplitude * freqU * 2pi * cos(freqU * u * 2pi) * sin(freqV * v * pi)
   */
  private getRadiusDerivativeU(u: number, v: number): number {
    return (
      this.dentAmplitude *
      this.dentFrequencyU *
      Math.PI *
      2 *
      Math.cos(this.dentFrequencyU * u * Math.PI * 2) *
      Math.sin(this.dentFrequencyV * v * Math.PI)
    )
  }

  /**
   * Calculate partial derivative of radius with respect to v.
   * dr/dv = amplitude * freqV * pi * sin(freqU * u * 2pi) * cos(freqV * v * pi)
   */
  private getRadiusDerivativeV(u: number, v: number): number {
    return (
      this.dentAmplitude *
      this.dentFrequencyV *
      Math.PI *
      Math.sin(this.dentFrequencyU * u * Math.PI * 2) *
      Math.cos(this.dentFrequencyV * v * Math.PI)
    )
  }

  /**
   * Get point on dented sphere in LOCAL coordinates (before world rotation).
   */
  private getPointLocal(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2
    const phi = v * Math.PI
    const r = this.getRadius(u, v)
    const drdu = this.getRadiusDerivativeU(u, v)
    const drdv = this.getRadiusDerivativeV(u, v)

    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    const sinTheta = Math.sin(theta)
    const cosTheta = Math.cos(theta)

    // Position: standard spherical with displaced radius
    const position = new THREE.Vector3(
      r * sinPhi * cosTheta,
      r * cosPhi,
      r * sinPhi * sinTheta
    )

    // Partial derivative with respect to theta (u direction)
    // d/dtheta = (dr/dtheta) * [sinPhi*cos, cosPhi, sinPhi*sin]
    //          + r * [-sinPhi*sin, 0, sinPhi*cos]
    // where dr/dtheta = dr/du * du/dtheta = drdu * (1 / 2pi)
    // But since theta = u * 2pi, dtheta = du * 2pi, so d/du = d/dtheta * 2pi
    const dPdu = new THREE.Vector3(
      drdu * sinPhi * cosTheta - r * sinPhi * sinTheta * Math.PI * 2,
      drdu * cosPhi,
      drdu * sinPhi * sinTheta + r * sinPhi * cosTheta * Math.PI * 2
    )

    // Partial derivative with respect to phi (v direction)
    // d/dphi = (dr/dphi) * [sinPhi*cos, cosPhi, sinPhi*sin]
    //        + r * [cosPhi*cos, -sinPhi, cosPhi*sin]
    // where dr/dphi = dr/dv * dv/dphi = drdv * (1 / pi)
    // But since phi = v * pi, dphi = dv * pi, so d/dv = d/dphi * pi
    const dPdv = new THREE.Vector3(
      drdv * sinPhi * cosTheta + r * cosPhi * cosTheta * Math.PI,
      drdv * cosPhi - r * sinPhi * Math.PI,
      drdv * sinPhi * sinTheta + r * cosPhi * sinTheta * Math.PI
    )

    // Normal is cross product of tangents (normalized)
    // Use dPdu x dPdv for outward-facing normal
    const normal = new THREE.Vector3()
      .crossVectors(dPdu, dPdv)
      .normalize()

    // If normal points inward (negative dot with position), flip it
    if (normal.dot(position) < 0) {
      normal.negate()
    }

    // Normalize tangents
    const tangentU = dPdu.normalize()
    const tangentV = dPdv.normalize()

    return { position, normal, tangentU, tangentV }
  }

  /**
   * Get point on dented sphere in WORLD coordinates (after applying world rotation).
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
    // First get approximate spherical coordinates
    const normalized = worldPos.clone().normalize()

    // phi = acos(y / r), theta = atan2(z, x)
    const phi = Math.acos(Math.max(-1, Math.min(1, normalized.y)))
    let theta = Math.atan2(normalized.z, normalized.x)
    if (theta < 0) theta += Math.PI * 2

    const u = theta / (Math.PI * 2)
    const v = phi / Math.PI

    return { u, v }
  }

  createMesh(): THREE.Mesh {
    const { radius, dentAmplitude, dentFrequencyU, dentFrequencyV, gridSegmentsU, gridSegmentsV } =
      DentedSphereSurface.getInitData()

    // Create custom geometry with displacement
    const geometry = new THREE.BufferGeometry()
    const vertices: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const indices: number[] = []

    const segmentsU = gridSegmentsU * 2
    const segmentsV = gridSegmentsV * 2

    // Minimum sinPhi to prevent degenerate pole vertices that confuse BVH projection
    const MIN_SIN_PHI = 0.05

    // Generate vertices
    for (let j = 0; j <= segmentsV; j++) {
      const v = j / segmentsV
      const phi = v * Math.PI

      for (let i = 0; i <= segmentsU; i++) {
        const u = i / segmentsU
        const theta = u * Math.PI * 2

        // Calculate displaced radius
        const displacement =
          dentAmplitude *
          Math.sin(dentFrequencyU * u * Math.PI * 2) *
          Math.sin(dentFrequencyV * v * Math.PI)
        const r = radius + displacement

        const rawSinPhi = Math.sin(phi)
        const cosPhi = Math.cos(phi)
        const sinTheta = Math.sin(theta)
        const cosTheta = Math.cos(theta)

        // Clamp sinPhi away from zero so poles have a small circle instead of a point
        const sinPhi = Math.abs(rawSinPhi) < MIN_SIN_PHI
          ? MIN_SIN_PHI * (rawSinPhi >= 0 ? 1 : -1)
          : rawSinPhi

        // Position
        const x = r * sinPhi * cosTheta
        const y = r * cosPhi
        const z = r * sinPhi * sinTheta
        vertices.push(x, y, z)

        // Calculate normal using partial derivatives
        const drdu =
          dentAmplitude *
          dentFrequencyU *
          Math.PI *
          2 *
          Math.cos(dentFrequencyU * u * Math.PI * 2) *
          Math.sin(dentFrequencyV * v * Math.PI)
        const drdv =
          dentAmplitude *
          dentFrequencyV *
          Math.PI *
          Math.sin(dentFrequencyU * u * Math.PI * 2) *
          Math.cos(dentFrequencyV * v * Math.PI)

        const dPdu = new THREE.Vector3(
          drdu * sinPhi * cosTheta - r * sinPhi * sinTheta * Math.PI * 2,
          drdu * cosPhi,
          drdu * sinPhi * sinTheta + r * sinPhi * cosTheta * Math.PI * 2
        )

        const dPdv = new THREE.Vector3(
          drdv * sinPhi * cosTheta + r * cosPhi * cosTheta * Math.PI,
          drdv * cosPhi - r * sinPhi * Math.PI,
          drdv * sinPhi * sinTheta + r * cosPhi * sinTheta * Math.PI
        )

        const normal = new THREE.Vector3().crossVectors(dPdu, dPdv).normalize()
        // Ensure outward-facing
        if (normal.dot(new THREE.Vector3(x, y, z)) < 0) {
          normal.negate()
        }
        normals.push(normal.x, normal.y, normal.z)

        // UVs
        uvs.push(u, v)
      }
    }

    // Generate indices
    for (let j = 0; j < segmentsV; j++) {
      for (let i = 0; i < segmentsU; i++) {
        const a = j * (segmentsU + 1) + i
        const b = a + 1
        const c = a + segmentsU + 1
        const d = c + 1

        // Two triangles per quad
        indices.push(a, b, c)
        indices.push(b, d, c)
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)

    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { radius, dentAmplitude, dentFrequencyU, dentFrequencyV, gridSegmentsU, gridSegmentsV } =
      DentedSphereSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 32

    // Helper to get displaced position
    const getPos = (u: number, v: number): THREE.Vector3 => {
      const theta = u * Math.PI * 2
      const phi = v * Math.PI
      const displacement =
        dentAmplitude *
        Math.sin(dentFrequencyU * u * Math.PI * 2) *
        Math.sin(dentFrequencyV * v * Math.PI)
      const r = radius + displacement

      return new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      )
    }

    // Longitude lines (constant u/theta)
    for (let i = 0; i < gridSegmentsU; i++) {
      const u = i / gridSegmentsU
      for (let j = 0; j < lineDetail; j++) {
        const v0 = j / lineDetail
        const v1 = (j + 1) / lineDetail

        const p0 = getPos(u, v0)
        const p1 = getPos(u, v1)

        vertices.push(p0.x, p0.y, p0.z)
        vertices.push(p1.x, p1.y, p1.z)
      }
    }

    // Latitude lines (constant v/phi)
    for (let j = 1; j < gridSegmentsV; j++) {
      const v = j / gridSegmentsV
      for (let i = 0; i < lineDetail; i++) {
        const u0 = i / lineDetail
        const u1 = (i + 1) / lineDetail

        const p0 = getPos(u0, v)
        const p1 = getPos(u1, v)

        vertices.push(p0.x, p0.y, p0.z)
        vertices.push(p1.x, p1.y, p1.z)
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
