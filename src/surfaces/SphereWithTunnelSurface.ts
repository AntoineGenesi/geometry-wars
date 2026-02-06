import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface SphereWithTunnelConfig extends SurfaceConfig {
  radius?: number          // Outer sphere radius (default: 8)
  tunnelRadius?: number    // Radius of the tunnel (default: 2)
  tunnelAxis?: 'x' | 'y' | 'z'  // Which axis tunnel goes through (default: 'y')
  gridSegmentsU?: number
  gridSegmentsV?: number
}

/**
 * Sphere with a traversable tunnel through its center.
 *
 * The surface consists of three connected regions:
 * 1. First hemisphere with a circular hole (v: 0 to ~0.3)
 * 2. Inner cylindrical tunnel (v: ~0.3 to ~0.7)
 * 3. Second hemisphere with a circular hole (v: ~0.7 to 1)
 *
 * Parameterization:
 * - u in [0, 1): azimuthal angle (wraps around)
 * - v in [0, 1]: position along the path from one hemisphere through the tunnel
 *
 * Key design: The hole angle (where sphere meets tunnel) is calculated so the
 * tunnel smoothly connects to the sphere surface. The transition zones ensure
 * entities don't get stuck at the boundary.
 */
export class SphereWithTunnelSurface extends Surface {
  private readonly radius: number
  private readonly tunnelRadius: number
  private readonly tunnelAxis: 'x' | 'y' | 'z'
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  // Derived values
  private readonly holeAngle: number  // Angle at which tunnel meets sphere (in radians from axis)
  private readonly tunnelLength: number  // Length of the tunnel inside the sphere

  // Region boundaries (in v space)
  private readonly hemisphere1End: number
  private readonly tunnelEnd: number

  constructor(config?: SphereWithTunnelConfig) {
    const radius = config?.radius ?? 8
    const tunnelRadius = config?.tunnelRadius ?? 2
    const tunnelAxis = config?.tunnelAxis ?? 'y'
    const gridSegmentsU = config?.gridSegmentsU ?? 24
    const gridSegmentsV = config?.gridSegmentsV ?? 20

    // Store init data for createMesh/createGrid (called before constructor finishes)
    ;(SphereWithTunnelSurface as any).__initData = {
      radius,
      tunnelRadius,
      tunnelAxis,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.radius = radius
    this.tunnelRadius = Math.min(tunnelRadius, radius * 0.9) // Ensure tunnel fits
    this.tunnelAxis = tunnelAxis
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Calculate the angle where the tunnel meets the sphere
    // sin(holeAngle) = tunnelRadius / radius
    this.holeAngle = Math.asin(this.tunnelRadius / this.radius)

    // Tunnel length = 2 * radius * cos(holeAngle)
    this.tunnelLength = 2 * this.radius * Math.cos(this.holeAngle)

    // Calculate v-space region boundaries based on arc lengths
    // Hemisphere arc from pole to hole edge: (PI/2 - holeAngle) radians
    // Tunnel is a cylinder of length tunnelLength
    const sphereArc = (Math.PI / 2 - this.holeAngle) * this.radius
    const tunnelArc = this.tunnelLength
    const totalArc = 2 * sphereArc + tunnelArc

    this.hemisphere1End = sphereArc / totalArc
    this.tunnelEnd = (sphereArc + tunnelArc) / totalArc

    // Set base class properties
    this.surfaceRadius = radius
    this.playerLocalPosition = this.getAxisVector(radius)
  }

  private static getInitData() {
    return (
      (SphereWithTunnelSurface as any).__initData ?? {
        radius: 8,
        tunnelRadius: 2,
        tunnelAxis: 'y' as const,
        gridSegmentsU: 24,
        gridSegmentsV: 20,
      }
    )
  }

  /**
   * Get a unit vector along the tunnel axis
   */
  private getAxisVector(scale: number = 1): THREE.Vector3 {
    switch (this.tunnelAxis) {
      case 'x': return new THREE.Vector3(scale, 0, 0)
      case 'y': return new THREE.Vector3(0, scale, 0)
      case 'z': return new THREE.Vector3(0, 0, scale)
    }
  }

  /**
   * Get the two perpendicular axes for a given tunnel axis
   */
  private getPerpendicularAxes(): { axis1: THREE.Vector3; axis2: THREE.Vector3 } {
    switch (this.tunnelAxis) {
      case 'x':
        return { axis1: new THREE.Vector3(0, 1, 0), axis2: new THREE.Vector3(0, 0, 1) }
      case 'y':
        return { axis1: new THREE.Vector3(1, 0, 0), axis2: new THREE.Vector3(0, 0, 1) }
      case 'z':
        return { axis1: new THREE.Vector3(1, 0, 0), axis2: new THREE.Vector3(0, 1, 0) }
    }
  }

  /**
   * Determine which region a v coordinate is in
   */
  private getRegion(v: number): {
    type: 'hemisphere1' | 'tunnel' | 'hemisphere2'
    localT: number  // 0-1 within this region
  } {
    if (v <= this.hemisphere1End) {
      return { type: 'hemisphere1', localT: v / this.hemisphere1End }
    } else if (v <= this.tunnelEnd) {
      return { type: 'tunnel', localT: (v - this.hemisphere1End) / (this.tunnelEnd - this.hemisphere1End) }
    } else {
      return { type: 'hemisphere2', localT: (v - this.tunnelEnd) / (1 - this.tunnelEnd) }
    }
  }

  /**
   * Get point on surface in LOCAL coordinates (before world rotation)
   */
  private getPointLocal(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2  // Azimuthal angle
    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)

    const { axis1, axis2 } = this.getPerpendicularAxes()
    const mainAxis = this.getAxisVector()

    const region = this.getRegion(v)

    let position: THREE.Vector3
    let normal: THREE.Vector3
    let tangentU: THREE.Vector3
    let tangentV: THREE.Vector3

    switch (region.type) {
      case 'hemisphere1': {
        // First hemisphere: from pole (top) to hole edge
        // phi goes from 0 (pole) to (PI/2 - holeAngle) (edge of hole)
        const phi = region.localT * (Math.PI / 2 - this.holeAngle)
        const sinPhi = Math.sin(phi)
        const cosPhi = Math.cos(phi)

        // Position on sphere
        // Point = radius * (cosPhi * mainAxis + sinPhi * (cosTheta * axis1 + sinTheta * axis2))
        position = mainAxis.clone().multiplyScalar(this.radius * cosPhi)
          .add(axis1.clone().multiplyScalar(this.radius * sinPhi * cosTheta))
          .add(axis2.clone().multiplyScalar(this.radius * sinPhi * sinTheta))

        // Normal points outward from sphere center
        normal = position.clone().normalize()

        // Tangent in u direction (around azimuth)
        tangentU = axis1.clone().multiplyScalar(-sinTheta)
          .add(axis2.clone().multiplyScalar(cosTheta))
          .normalize()

        // Tangent in v direction (along meridian, toward hole)
        tangentV = mainAxis.clone().multiplyScalar(-sinPhi)
          .add(axis1.clone().multiplyScalar(cosPhi * cosTheta))
          .add(axis2.clone().multiplyScalar(cosPhi * sinTheta))
          .normalize()
        break
      }

      case 'tunnel': {
        // Cylindrical tunnel connecting the two holes
        // Position along tunnel: from +halfLength to -halfLength (along axis)
        const halfLength = this.tunnelLength / 2
        const axisPos = halfLength * (1 - 2 * region.localT)  // Goes from +halfLength to -halfLength

        // Position on cylinder surface (inside facing inward)
        position = mainAxis.clone().multiplyScalar(axisPos)
          .add(axis1.clone().multiplyScalar(this.tunnelRadius * cosTheta))
          .add(axis2.clone().multiplyScalar(this.tunnelRadius * sinTheta))

        // Normal points INWARD (toward center axis) since we're inside the tunnel
        normal = axis1.clone().multiplyScalar(-cosTheta)
          .add(axis2.clone().multiplyScalar(-sinTheta))
          .normalize()

        // Tangent in u direction (around circumference)
        tangentU = axis1.clone().multiplyScalar(-sinTheta)
          .add(axis2.clone().multiplyScalar(cosTheta))
          .normalize()

        // Tangent in v direction (along tunnel axis, negative direction)
        tangentV = mainAxis.clone().multiplyScalar(-1).normalize()
        break
      }

      case 'hemisphere2': {
        // Second hemisphere: from hole edge to opposite pole
        // phi goes from (PI/2 - holeAngle) to 0 (opposite pole)
        // But measured from the OPPOSITE pole, so it's actually mirrored
        const phi = (1 - region.localT) * (Math.PI / 2 - this.holeAngle)
        const sinPhi = Math.sin(phi)
        const cosPhi = Math.cos(phi)

        // Position on sphere (on opposite side, so negate mainAxis component)
        position = mainAxis.clone().multiplyScalar(-this.radius * cosPhi)
          .add(axis1.clone().multiplyScalar(this.radius * sinPhi * cosTheta))
          .add(axis2.clone().multiplyScalar(this.radius * sinPhi * sinTheta))

        // Normal points outward
        normal = position.clone().normalize()

        // Tangent in u direction
        tangentU = axis1.clone().multiplyScalar(-sinTheta)
          .add(axis2.clone().multiplyScalar(cosTheta))
          .normalize()

        // Tangent in v direction (toward opposite pole)
        tangentV = mainAxis.clone().multiplyScalar(sinPhi)
          .add(axis1.clone().multiplyScalar(-cosPhi * cosTheta))
          .add(axis2.clone().multiplyScalar(-cosPhi * sinTheta))
          .normalize()
        break
      }
    }

    return { position: position!, normal: normal!, tangentU: tangentU!, tangentV: tangentV! }
  }

  /**
   * Get point on surface in WORLD coordinates
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
    const region = this.getRegion(v)
    let correctedDu = du

    // Correct du for convergence at poles (hemispheres) and constant radius in tunnel
    if (region.type === 'hemisphere1') {
      const phi = region.localT * (Math.PI / 2 - this.holeAngle)
      const sinPhi = Math.sin(phi)
      correctedDu = sinPhi > 0.001 ? du / sinPhi : 0
    } else if (region.type === 'hemisphere2') {
      const phi = (1 - region.localT) * (Math.PI / 2 - this.holeAngle)
      const sinPhi = Math.sin(phi)
      correctedDu = sinPhi > 0.001 ? du / sinPhi : 0
    }
    // In tunnel, no correction needed (constant circumference)

    let newU = u + correctedDu
    let newV = v + dv

    // Wrap u around [0, 1)
    newU = ((newU % 1) + 1) % 1

    // Clamp v to avoid pole singularities
    const epsilon = 0.005
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    const { axis1, axis2 } = this.getPerpendicularAxes()
    const mainAxis = this.getAxisVector()

    // Project position onto perpendicular plane to get azimuthal angle
    const perpComponent1 = worldPos.dot(axis1)
    const perpComponent2 = worldPos.dot(axis2)
    let theta = Math.atan2(perpComponent2, perpComponent1)
    if (theta < 0) theta += Math.PI * 2
    const u = theta / (Math.PI * 2)

    // Get position along main axis
    const axisComponent = worldPos.dot(mainAxis)
    const perpDist = Math.sqrt(perpComponent1 * perpComponent1 + perpComponent2 * perpComponent2)

    // Determine which region based on geometry
    const holeY = this.radius * Math.cos(this.holeAngle)  // Axis position of hole edge
    const isInTunnelRegion = Math.abs(axisComponent) < holeY && perpDist < this.tunnelRadius * 1.5

    let v: number

    if (isInTunnelRegion) {
      // Inside the tunnel
      const halfLength = this.tunnelLength / 2
      // axisComponent goes from +halfLength to -halfLength as v goes through tunnel
      const localT = (halfLength - axisComponent) / this.tunnelLength
      v = this.hemisphere1End + localT * (this.tunnelEnd - this.hemisphere1End)
    } else if (axisComponent > 0) {
      // First hemisphere (positive axis side)
      // Calculate phi angle from axis
      const dist = worldPos.length()
      const phi = Math.asin(Math.max(0, Math.min(1, perpDist / dist)))
      const maxPhi = Math.PI / 2 - this.holeAngle
      const localT = Math.min(1, phi / maxPhi)
      v = localT * this.hemisphere1End
    } else {
      // Second hemisphere (negative axis side)
      const dist = worldPos.length()
      const phi = Math.asin(Math.max(0, Math.min(1, perpDist / dist)))
      const maxPhi = Math.PI / 2 - this.holeAngle
      const localT = Math.min(1, phi / maxPhi)
      v = this.tunnelEnd + (1 - localT) * (1 - this.tunnelEnd)
    }

    return { u, v: Math.max(0, Math.min(1, v)) }
  }

  createMesh(): THREE.Mesh {
    const { radius, tunnelRadius, tunnelAxis, gridSegmentsU, gridSegmentsV } =
      SphereWithTunnelSurface.getInitData()

    // Create custom geometry by merging:
    // 1. Two sphere sections with holes cut out
    // 2. An inner cylinder

    const geometry = new THREE.BufferGeometry()
    const vertices: number[] = []
    const indices: number[] = []
    const normals: number[] = []
    const uvs: number[] = []

    // Recalculate derived values for mesh creation
    const effectiveTunnelRadius = Math.min(tunnelRadius, radius * 0.9)
    const holeAngle = Math.asin(effectiveTunnelRadius / radius)
    const tunnelLength = 2 * radius * Math.cos(holeAngle)

    // Helper to get axis vectors
    const getAxisVec = (scale: number = 1): THREE.Vector3 => {
      switch (tunnelAxis) {
        case 'x': return new THREE.Vector3(scale, 0, 0)
        case 'y': return new THREE.Vector3(0, scale, 0)
        case 'z': return new THREE.Vector3(0, 0, scale)
        default: return new THREE.Vector3(0, scale, 0)
      }
    }

    const getPerpAxes = (): { a1: THREE.Vector3; a2: THREE.Vector3 } => {
      switch (tunnelAxis) {
        case 'x':
          return { a1: new THREE.Vector3(0, 1, 0), a2: new THREE.Vector3(0, 0, 1) }
        case 'y':
          return { a1: new THREE.Vector3(1, 0, 0), a2: new THREE.Vector3(0, 0, 1) }
        case 'z':
          return { a1: new THREE.Vector3(1, 0, 0), a2: new THREE.Vector3(0, 1, 0) }
        default:
          return { a1: new THREE.Vector3(1, 0, 0), a2: new THREE.Vector3(0, 0, 1) }
      }
    }

    const mainAxis = getAxisVec()
    const { a1, a2 } = getPerpAxes()

    // Number of segments
    const uSegments = gridSegmentsU * 2
    const hemisphereVSegments = Math.ceil(gridSegmentsV * 0.4)
    const tunnelVSegments = Math.ceil(gridSegmentsV * 0.2)

    let vertexIndex = 0

    // Add vertex helper
    const addVertex = (pos: THREE.Vector3, norm: THREE.Vector3, uvU: number, uvV: number): number => {
      vertices.push(pos.x, pos.y, pos.z)
      normals.push(norm.x, norm.y, norm.z)
      uvs.push(uvU, uvV)
      return vertexIndex++
    }

    // ===== First hemisphere (positive axis side, with hole) =====
    const h1Vertices: number[][] = []

    for (let j = 0; j <= hemisphereVSegments; j++) {
      h1Vertices[j] = []
      // phi goes from 0 (pole) to (PI/2 - holeAngle)
      const phi = (j / hemisphereVSegments) * (Math.PI / 2 - holeAngle)
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let i = 0; i <= uSegments; i++) {
        const theta = (i / uSegments) * Math.PI * 2
        const cosTheta = Math.cos(theta)
        const sinTheta = Math.sin(theta)

        const pos = mainAxis.clone().multiplyScalar(radius * cosPhi)
          .add(a1.clone().multiplyScalar(radius * sinPhi * cosTheta))
          .add(a2.clone().multiplyScalar(radius * sinPhi * sinTheta))

        const norm = pos.clone().normalize()

        h1Vertices[j].push(addVertex(pos, norm, i / uSegments, j / hemisphereVSegments * 0.3))
      }
    }

    // Add faces for hemisphere 1
    for (let j = 0; j < hemisphereVSegments; j++) {
      for (let i = 0; i < uSegments; i++) {
        const a = h1Vertices[j][i]
        const b = h1Vertices[j][i + 1]
        const c = h1Vertices[j + 1][i + 1]
        const d = h1Vertices[j + 1][i]

        indices.push(a, b, d)
        indices.push(b, c, d)
      }
    }

    // ===== Tunnel (inner cylinder) =====
    const tunnelVertices: number[][] = []
    const halfLength = tunnelLength / 2

    for (let j = 0; j <= tunnelVSegments; j++) {
      tunnelVertices[j] = []
      const axisPos = halfLength * (1 - 2 * j / tunnelVSegments)

      for (let i = 0; i <= uSegments; i++) {
        const theta = (i / uSegments) * Math.PI * 2
        const cosTheta = Math.cos(theta)
        const sinTheta = Math.sin(theta)

        const pos = mainAxis.clone().multiplyScalar(axisPos)
          .add(a1.clone().multiplyScalar(effectiveTunnelRadius * cosTheta))
          .add(a2.clone().multiplyScalar(effectiveTunnelRadius * sinTheta))

        // Normal points inward (toward center of cylinder)
        const norm = a1.clone().multiplyScalar(-cosTheta)
          .add(a2.clone().multiplyScalar(-sinTheta))
          .normalize()

        tunnelVertices[j].push(addVertex(pos, norm, i / uSegments, 0.3 + j / tunnelVSegments * 0.4))
      }
    }

    // Add faces for tunnel
    for (let j = 0; j < tunnelVSegments; j++) {
      for (let i = 0; i < uSegments; i++) {
        const a = tunnelVertices[j][i]
        const b = tunnelVertices[j][i + 1]
        const c = tunnelVertices[j + 1][i + 1]
        const d = tunnelVertices[j + 1][i]

        indices.push(a, b, d)
        indices.push(b, c, d)
      }
    }

    // ===== Second hemisphere (negative axis side, with hole) =====
    const h2Vertices: number[][] = []

    for (let j = 0; j <= hemisphereVSegments; j++) {
      h2Vertices[j] = []
      // phi goes from (PI/2 - holeAngle) back to 0 (opposite pole)
      const phi = (1 - j / hemisphereVSegments) * (Math.PI / 2 - holeAngle)
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let i = 0; i <= uSegments; i++) {
        const theta = (i / uSegments) * Math.PI * 2
        const cosTheta = Math.cos(theta)
        const sinTheta = Math.sin(theta)

        // Negative axis side
        const pos = mainAxis.clone().multiplyScalar(-radius * cosPhi)
          .add(a1.clone().multiplyScalar(radius * sinPhi * cosTheta))
          .add(a2.clone().multiplyScalar(radius * sinPhi * sinTheta))

        const norm = pos.clone().normalize()

        h2Vertices[j].push(addVertex(pos, norm, i / uSegments, 0.7 + j / hemisphereVSegments * 0.3))
      }
    }

    // Add faces for hemisphere 2
    for (let j = 0; j < hemisphereVSegments; j++) {
      for (let i = 0; i < uSegments; i++) {
        const a = h2Vertices[j][i]
        const b = h2Vertices[j][i + 1]
        const c = h2Vertices[j + 1][i + 1]
        const d = h2Vertices[j + 1][i]

        indices.push(a, b, d)
        indices.push(b, c, d)
      }
    }

    // ===== Transition ring: hemisphere 1 to tunnel =====
    for (let i = 0; i < uSegments; i++) {
      const h1Edge = h1Vertices[hemisphereVSegments][i]
      const h1EdgeNext = h1Vertices[hemisphereVSegments][i + 1]
      const tStart = tunnelVertices[0][i]
      const tStartNext = tunnelVertices[0][i + 1]

      indices.push(h1Edge, h1EdgeNext, tStart)
      indices.push(h1EdgeNext, tStartNext, tStart)
    }

    // ===== Transition ring: tunnel to hemisphere 2 =====
    for (let i = 0; i < uSegments; i++) {
      const tEnd = tunnelVertices[tunnelVSegments][i]
      const tEndNext = tunnelVertices[tunnelVSegments][i + 1]
      const h2Edge = h2Vertices[0][i]
      const h2EdgeNext = h2Vertices[0][i + 1]

      indices.push(tEnd, tEndNext, h2Edge)
      indices.push(tEndNext, h2EdgeNext, h2Edge)
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setIndex(indices)

    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { radius, tunnelRadius, tunnelAxis, gridSegmentsU, gridSegmentsV } =
      SphereWithTunnelSurface.getInitData()

    const vertices: number[] = []
    const lineDetail = 48

    // Recalculate derived values
    const effectiveTunnelRadius = Math.min(tunnelRadius, radius * 0.9)
    const holeAngle = Math.asin(effectiveTunnelRadius / radius)
    const tunnelLength = 2 * radius * Math.cos(holeAngle)
    const halfLength = tunnelLength / 2

    // Helper functions
    const getAxisVec = (scale: number = 1): THREE.Vector3 => {
      switch (tunnelAxis) {
        case 'x': return new THREE.Vector3(scale, 0, 0)
        case 'y': return new THREE.Vector3(0, scale, 0)
        case 'z': return new THREE.Vector3(0, 0, scale)
        default: return new THREE.Vector3(0, scale, 0)
      }
    }

    const getPerpAxes = (): { a1: THREE.Vector3; a2: THREE.Vector3 } => {
      switch (tunnelAxis) {
        case 'x':
          return { a1: new THREE.Vector3(0, 1, 0), a2: new THREE.Vector3(0, 0, 1) }
        case 'y':
          return { a1: new THREE.Vector3(1, 0, 0), a2: new THREE.Vector3(0, 0, 1) }
        case 'z':
          return { a1: new THREE.Vector3(1, 0, 0), a2: new THREE.Vector3(0, 1, 0) }
        default:
          return { a1: new THREE.Vector3(1, 0, 0), a2: new THREE.Vector3(0, 0, 1) }
      }
    }

    const mainAxis = getAxisVec()
    const { a1, a2 } = getPerpAxes()

    // ===== Latitude lines on hemisphere 1 =====
    const hemisphereLatLines = Math.ceil(gridSegmentsV * 0.35)
    for (let j = 0; j < hemisphereLatLines; j++) {
      const phi = (j / hemisphereLatLines) * (Math.PI / 2 - holeAngle)
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        const p0 = mainAxis.clone().multiplyScalar(radius * cosPhi)
          .add(a1.clone().multiplyScalar(radius * sinPhi * Math.cos(theta0)))
          .add(a2.clone().multiplyScalar(radius * sinPhi * Math.sin(theta0)))

        const p1 = mainAxis.clone().multiplyScalar(radius * cosPhi)
          .add(a1.clone().multiplyScalar(radius * sinPhi * Math.cos(theta1)))
          .add(a2.clone().multiplyScalar(radius * sinPhi * Math.sin(theta1)))

        vertices.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      }
    }

    // ===== Latitude lines on hemisphere 2 =====
    for (let j = 0; j < hemisphereLatLines; j++) {
      const phi = (j / hemisphereLatLines) * (Math.PI / 2 - holeAngle)
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        const p0 = mainAxis.clone().multiplyScalar(-radius * cosPhi)
          .add(a1.clone().multiplyScalar(radius * sinPhi * Math.cos(theta0)))
          .add(a2.clone().multiplyScalar(radius * sinPhi * Math.sin(theta0)))

        const p1 = mainAxis.clone().multiplyScalar(-radius * cosPhi)
          .add(a1.clone().multiplyScalar(radius * sinPhi * Math.cos(theta1)))
          .add(a2.clone().multiplyScalar(radius * sinPhi * Math.sin(theta1)))

        vertices.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      }
    }

    // ===== Ring lines at hole edges (sphere-tunnel transition) =====
    const holeEdgeRadius = radius * Math.sin(Math.PI / 2 - holeAngle)
    for (let i = 0; i < lineDetail; i++) {
      const theta0 = (i / lineDetail) * Math.PI * 2
      const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

      // Positive side hole edge
      const posY = radius * Math.cos(Math.PI / 2 - holeAngle)
      const p0h1 = mainAxis.clone().multiplyScalar(posY)
        .add(a1.clone().multiplyScalar(holeEdgeRadius * Math.cos(theta0)))
        .add(a2.clone().multiplyScalar(holeEdgeRadius * Math.sin(theta0)))
      const p1h1 = mainAxis.clone().multiplyScalar(posY)
        .add(a1.clone().multiplyScalar(holeEdgeRadius * Math.cos(theta1)))
        .add(a2.clone().multiplyScalar(holeEdgeRadius * Math.sin(theta1)))
      vertices.push(p0h1.x, p0h1.y, p0h1.z, p1h1.x, p1h1.y, p1h1.z)

      // Negative side hole edge
      const p0h2 = mainAxis.clone().multiplyScalar(-posY)
        .add(a1.clone().multiplyScalar(holeEdgeRadius * Math.cos(theta0)))
        .add(a2.clone().multiplyScalar(holeEdgeRadius * Math.sin(theta0)))
      const p1h2 = mainAxis.clone().multiplyScalar(-posY)
        .add(a1.clone().multiplyScalar(holeEdgeRadius * Math.cos(theta1)))
        .add(a2.clone().multiplyScalar(holeEdgeRadius * Math.sin(theta1)))
      vertices.push(p0h2.x, p0h2.y, p0h2.z, p1h2.x, p1h2.y, p1h2.z)
    }

    // ===== Tunnel circumference rings =====
    const tunnelRings = Math.ceil(gridSegmentsV * 0.3)
    for (let j = 0; j <= tunnelRings; j++) {
      const axisPos = halfLength * (1 - 2 * j / tunnelRings)

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        const p0 = mainAxis.clone().multiplyScalar(axisPos)
          .add(a1.clone().multiplyScalar(effectiveTunnelRadius * Math.cos(theta0)))
          .add(a2.clone().multiplyScalar(effectiveTunnelRadius * Math.sin(theta0)))

        const p1 = mainAxis.clone().multiplyScalar(axisPos)
          .add(a1.clone().multiplyScalar(effectiveTunnelRadius * Math.cos(theta1)))
          .add(a2.clone().multiplyScalar(effectiveTunnelRadius * Math.sin(theta1)))

        vertices.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      }
    }

    // ===== Longitude/meridian lines =====
    for (let i = 0; i < gridSegmentsU; i++) {
      const theta = (i / gridSegmentsU) * Math.PI * 2
      const cosTheta = Math.cos(theta)
      const sinTheta = Math.sin(theta)

      // Hemisphere 1 meridian (pole to hole)
      const h1Segments = Math.ceil(lineDetail * 0.4)
      for (let j = 0; j < h1Segments; j++) {
        const phi0 = (j / h1Segments) * (Math.PI / 2 - holeAngle)
        const phi1 = ((j + 1) / h1Segments) * (Math.PI / 2 - holeAngle)

        const p0 = mainAxis.clone().multiplyScalar(radius * Math.cos(phi0))
          .add(a1.clone().multiplyScalar(radius * Math.sin(phi0) * cosTheta))
          .add(a2.clone().multiplyScalar(radius * Math.sin(phi0) * sinTheta))

        const p1 = mainAxis.clone().multiplyScalar(radius * Math.cos(phi1))
          .add(a1.clone().multiplyScalar(radius * Math.sin(phi1) * cosTheta))
          .add(a2.clone().multiplyScalar(radius * Math.sin(phi1) * sinTheta))

        vertices.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      }

      // Tunnel vertical lines
      const tunnelLineSegments = Math.ceil(lineDetail * 0.2)
      for (let j = 0; j < tunnelLineSegments; j++) {
        const axisPos0 = halfLength * (1 - 2 * j / tunnelLineSegments)
        const axisPos1 = halfLength * (1 - 2 * (j + 1) / tunnelLineSegments)

        const p0 = mainAxis.clone().multiplyScalar(axisPos0)
          .add(a1.clone().multiplyScalar(effectiveTunnelRadius * cosTheta))
          .add(a2.clone().multiplyScalar(effectiveTunnelRadius * sinTheta))

        const p1 = mainAxis.clone().multiplyScalar(axisPos1)
          .add(a1.clone().multiplyScalar(effectiveTunnelRadius * cosTheta))
          .add(a2.clone().multiplyScalar(effectiveTunnelRadius * sinTheta))

        vertices.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      }

      // Hemisphere 2 meridian (hole to opposite pole)
      for (let j = 0; j < h1Segments; j++) {
        const phi0 = (1 - j / h1Segments) * (Math.PI / 2 - holeAngle)
        const phi1 = (1 - (j + 1) / h1Segments) * (Math.PI / 2 - holeAngle)

        const p0 = mainAxis.clone().multiplyScalar(-radius * Math.cos(phi0))
          .add(a1.clone().multiplyScalar(radius * Math.sin(phi0) * cosTheta))
          .add(a2.clone().multiplyScalar(radius * Math.sin(phi0) * sinTheta))

        const p1 = mainAxis.clone().multiplyScalar(-radius * Math.cos(phi1))
          .add(a1.clone().multiplyScalar(radius * Math.sin(phi1) * cosTheta))
          .add(a2.clone().multiplyScalar(radius * Math.sin(phi1) * sinTheta))

        vertices.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      }
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))

    return new THREE.LineSegments(geometry, this.createGridMaterial())
  }

  /**
   * Check if a world position is inside the tunnel
   */
  isInsideTunnel(worldPos: THREE.Vector3): boolean {
    const { axis1, axis2 } = this.getPerpendicularAxes()
    const mainAxis = this.getAxisVector()

    const axisComponent = worldPos.dot(mainAxis)
    const perpComponent1 = worldPos.dot(axis1)
    const perpComponent2 = worldPos.dot(axis2)
    const perpDist = Math.sqrt(perpComponent1 * perpComponent1 + perpComponent2 * perpComponent2)

    const halfLength = this.tunnelLength / 2

    return Math.abs(axisComponent) <= halfLength && perpDist <= this.tunnelRadius * 1.2
  }

  /**
   * Get the tunnel parameters for external use
   */
  getTunnelParams(): {
    radius: number
    length: number
    axis: 'x' | 'y' | 'z'
    holeAngle: number
  } {
    return {
      radius: this.tunnelRadius,
      length: this.tunnelLength,
      axis: this.tunnelAxis,
      holeAngle: this.holeAngle,
    }
  }
}
