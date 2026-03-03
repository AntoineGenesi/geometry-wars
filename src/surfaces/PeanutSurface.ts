import * as THREE from 'three'
import { Surface, SurfaceConfig, SurfacePoint } from './Surface'

export interface PeanutConfig extends SurfaceConfig {
  baseRadius?: number
  waistDepth?: number
  gridSegmentsU?: number
  gridSegmentsV?: number
}

/**
 * Peanut/Dumbbell surface: a surface of revolution with profile
 * r(v) = R * (1 - waistDepth * cos(2*phi))
 * where phi = v * PI, creating two bulges connected by a narrow waist.
 */
export class PeanutSurface extends Surface {
  private readonly baseRadius: number
  private readonly waistDepth: number
  private readonly gridSegmentsU: number
  private readonly gridSegmentsV: number

  /** Cached average metric scale for speed correction (lazy-initialized). */
  private _avgMetricScale: number | null = null

  constructor(config?: PeanutConfig) {
    const baseRadius = config?.baseRadius ?? 6
    const waistDepth = config?.waistDepth ?? 0.4
    // Higher resolution than other surfaces: the narrow neck region requires more
    // faces for smooth geodesic face-walking transitions. Low resolution at the neck
    // causes coarse face exits that can stall movement across the waist area.
    const gridSegmentsU = config?.gridSegmentsU ?? 32
    const gridSegmentsV = config?.gridSegmentsV ?? 28

    ;(PeanutSurface as any).__initData = {
      baseRadius,
      waistDepth,
      gridSegmentsU,
      gridSegmentsV,
    }
    super(config)

    this.baseRadius = baseRadius
    this.waistDepth = waistDepth
    this.gridSegmentsU = gridSegmentsU
    this.gridSegmentsV = gridSegmentsV

    // Player spawns on the upper bulge of the peanut
    const bulgeRadius = baseRadius * (1 + waistDepth)
    this.surfaceRadius = bulgeRadius
    this.playerLocalPosition = new THREE.Vector3(0, bulgeRadius * 0.7, bulgeRadius * 0.7).normalize().multiplyScalar(bulgeRadius)
  }

  private static getInitData() {
    return (
      (PeanutSurface as any).__initData ?? {
        baseRadius: 6,
        waistDepth: 0.4,
        gridSegmentsU: 32,
        gridSegmentsV: 28,
      }
    )
  }

  /**
   * Profile radius as a function of phi (polar angle).
   * r(phi) = R * (1 - waistDepth * cos(2 * phi))
   * At phi=0 and phi=PI (poles): r = R * (1 - waistDepth) -- smaller
   * At phi=PI/2 (equator): r = R * (1 + waistDepth) -- bulges
   * Wait, actually for a peanut, the bulges should be at the poles and the
   * waist at the equator. So we use:
   * r(phi) = R * (1 - waistDepth * cos(2 * phi))
   * At phi=0: cos(0)=1, r = R*(1 - waistDepth) -- narrow at pole
   * At phi=PI/4: cos(PI/2)=0, r = R -- medium
   * At phi=PI/2: cos(PI)=-1, r = R*(1 + waistDepth) -- widest
   *
   * Actually for a peanut shape we want bulges at top and bottom halves
   * and a pinch at the equator. So:
   * r(phi) = R * (1 + waistDepth * cos(2 * phi))
   * At phi=0: r = R*(1 + waistDepth) -- wide at top
   * At phi=PI/2: r = R*(1 - waistDepth) -- narrow at equator
   * At phi=PI: r = R*(1 + waistDepth) -- wide at bottom
   */
  private profileRadius(phi: number): number {
    return this.baseRadius * (1 + this.waistDepth * Math.cos(2 * phi))
  }

  private profileRadiusDerivative(phi: number): number {
    return this.baseRadius * (-2 * this.waistDepth * Math.sin(2 * phi))
  }

  /**
   * Compute the local UV metric scale at a given v (phi) position.
   * Metric = sqrt(uScale * vScale), normalized by baseRadius (scale-invariant).
   *
   * uScale = rNorm * sinPhi  (circumferential arc per UV unit in U direction)
   * vScale = sqrt(rNorm² + drNorm²)  (meridional arc per UV unit in V direction)
   * where rNorm = r/baseRadius, drNorm = dr/dphi / baseRadius / π (chain rule of v→phi).
   *
   * Note: the actual world-space scales include a factor of baseRadius and 2π/π,
   * but those cancel in the correction ratio (localMetric / avgMetric), so we
   * work in normalized coordinates for simplicity.
   */
  private _localMetricAt(v: number): number {
    const phi = v * Math.PI
    const sinPhi = Math.max(Math.abs(Math.sin(phi)), 0.001)
    const rNorm = 1 + this.waistDepth * Math.cos(2 * phi)
    const drNorm = -2 * this.waistDepth * Math.sin(2 * phi)
    const uScale = rNorm * sinPhi
    const vScale = Math.sqrt(rNorm * rNorm + drNorm * drNorm)
    return Math.sqrt(uScale * vScale)
  }

  /**
   * Compute the surface-average metric scale (numerical integration over v).
   * Cached after first call. Uses area-weighted sampling (sin(phi) weighting).
   */
  private _computeAvgMetricScale(): number {
    const STEPS = 40
    let totalWeight = 0
    let totalMetric = 0
    for (let i = 1; i < STEPS; i++) {
      const v = i / STEPS
      const phi = v * Math.PI
      const weight = Math.sin(phi)  // area element on surface of revolution
      totalMetric += this._localMetricAt(v) * weight
      totalWeight += weight
    }
    return totalWeight > 0 ? totalMetric / totalWeight : 1.0
  }

  /**
   * Returns a speed multiplier for the player at UV position (u, v).
   *
   * On the peanut's larger (wider) areas, the multiplier is > 1 so the player
   * moves faster in world space, covering the same UV fraction per second
   * everywhere. This eliminates the perceived "sluggishness" on the bulge areas
   * where constant world-space speed traverses a smaller fraction of the surface.
   *
   * Clamped to [0.4, 2.5] to avoid extreme changes very near the poles.
   */
  override getPlayerSpeedCorrectionAt(_u: number, v: number): number {
    if (this._avgMetricScale === null) {
      this._avgMetricScale = this._computeAvgMetricScale()
    }
    const localMetric = this._localMetricAt(v)
    const raw = localMetric / this._avgMetricScale
    return Math.max(0.4, Math.min(2.5, raw))
  }

  getPoint(u: number, v: number): SurfacePoint {
    const theta = u * Math.PI * 2  // azimuthal angle
    const phi = v * Math.PI         // polar angle [0, PI]

    const r = this.profileRadius(phi)
    const drDphi = this.profileRadiusDerivative(phi)

    const sinPhi = Math.sin(phi)
    const cosPhi = Math.cos(phi)
    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)

    const position = new THREE.Vector3(
      r * sinPhi * cosTheta,
      r * cosPhi,
      r * sinPhi * sinTheta
    )

    // For surface of revolution, the tangent in theta direction:
    const tangentU = new THREE.Vector3(
      -sinPhi * sinTheta,
      0,
      sinPhi * cosTheta
    ).normalize()

    // Tangent in phi direction: d/dphi of position
    // dx/dphi = drDphi * sinPhi * cosTheta + r * cosPhi * cosTheta
    // dy/dphi = drDphi * cosPhi - r * sinPhi
    // dz/dphi = drDphi * sinPhi * sinTheta + r * cosPhi * sinTheta
    const tangentV = new THREE.Vector3(
      drDphi * sinPhi * cosTheta + r * cosPhi * cosTheta,
      drDphi * cosPhi - r * sinPhi,
      drDphi * sinPhi * sinTheta + r * cosPhi * sinTheta
    ).normalize()

    const normal = tangentU.clone().cross(tangentV).normalize()

    return { position, normal, tangentU, tangentV }
  }

  moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number } {
    const phi = v * Math.PI
    const sinPhi = Math.sin(phi)

    // Full peanut metric corrections to maintain constant world-space speed.
    // The peanut is a surface of revolution: r(phi) = R*(1 + waistDepth*cos(2*phi))
    // U (azimuthal) arc length scale: r * sinPhi  → divide du by (rNorm * sinPhi)
    // V (meridional) arc length scale: sqrt(r'^2 + r^2) → divide dv by sqrt(drNorm^2 + rNorm^2)
    const rNorm = 1 + this.waistDepth * Math.cos(2 * phi)
    const drNorm = -2 * this.waistDepth * Math.sin(2 * phi)
    const uScale = rNorm * sinPhi
    const vScale = Math.sqrt(rNorm * rNorm + drNorm * drNorm)

    const correctedDu = uScale > 0.001 ? du / uScale : 0
    const correctedDv = vScale > 0.001 ? dv / vScale : 0

    let newU = u + correctedDu
    let newV = v + correctedDv

    // Wrap u
    newU = ((newU % 1) + 1) % 1

    // Clamp v near poles
    const epsilon = 0.01
    newV = Math.max(epsilon, Math.min(1 - epsilon, newV))

    return { u: newU, v: newV }
  }

  worldToSurface(worldPos: THREE.Vector3): { u: number; v: number } {
    // s44h-01 FIX: Scale-independent phi scan using angular comparison.
    //
    // Previous approaches (s44f-08) tried to estimate a global scale factor,
    // but that's a chicken-and-egg problem: you need the right phi to estimate
    // scale, but you need the right scale to find phi.
    //
    // New approach: Compare the ANGLE of the query point (atan2(xzDist, y)) against
    // the angle of each profile ring point. The angle from origin is scale-invariant
    // (scaling preserves direction), so this works regardless of whether the input
    // is scaled or unscaled. We also compare the radial ratio to break ties.
    const xzDist = Math.sqrt(worldPos.x * worldPos.x + worldPos.z * worldPos.z)
    const queryAngle = Math.atan2(xzDist, worldPos.y)  // angle from +Y axis

    let bestPhi = 0
    let bestScore = Infinity
    const steps = 200  // higher resolution for better accuracy

    for (let i = 0; i <= steps; i++) {
      const phi = (i / steps) * Math.PI
      const r = this.profileRadius(phi)
      const ringXZ = r * Math.sin(phi)
      const ringY = r * Math.cos(phi)
      const ringAngle = Math.atan2(ringXZ, ringY)

      // Primary: angular distance (scale-invariant)
      const angleDiff = Math.abs(queryAngle - ringAngle)

      if (angleDiff < bestScore) {
        bestScore = angleDiff
        bestPhi = phi
      }
    }

    let theta = Math.atan2(worldPos.z, worldPos.x)
    if (theta < 0) theta += Math.PI * 2

    return {
      u: theta / (Math.PI * 2),
      v: bestPhi / Math.PI,
    }
  }

  createMesh(): THREE.Mesh {
    const { baseRadius, waistDepth, gridSegmentsU, gridSegmentsV } =
      PeanutSurface.getInitData()
    const segments = gridSegmentsU * 2
    const rings = gridSegmentsV * 2

    const geometry = new THREE.BufferGeometry()
    const vertices: number[] = []
    const indices: number[] = []
    const normals: number[] = []

    // Build all rings including poles (j=0..rings), then cap poles with apex
    // vertices + fan triangles to close the mesh and eliminate boundary edges
    // that blocked geodesic face walking.
    // Use a small MIN_SIN_PHI to keep pole ring vertices near-but-not-at the apex.
    const MIN_SIN_PHI = 0.01

    // --- Vertex 0: top apex ---
    const rTop = baseRadius * (1 + waistDepth * Math.cos(0))
    vertices.push(0, rTop, 0)
    normals.push(0, 1, 0)

    // --- Rings j=0..rings (standard grid with small pole rings) ---
    for (let j = 0; j <= rings; j++) {
      const phi = (j / rings) * Math.PI
      const r = baseRadius * (1 + waistDepth * Math.cos(2 * phi))
      const rawSinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      const effectiveSinPhi = Math.abs(rawSinPhi) < MIN_SIN_PHI
        ? MIN_SIN_PHI * (rawSinPhi >= 0 ? 1 : -1)
        : rawSinPhi

      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2
        const cosTheta = Math.cos(theta)
        const sinTheta = Math.sin(theta)

        vertices.push(
          r * effectiveSinPhi * cosTheta,
          r * cosPhi,
          r * effectiveSinPhi * sinTheta
        )

        const n = new THREE.Vector3(
          effectiveSinPhi * cosTheta,
          cosPhi,
          effectiveSinPhi * sinTheta
        ).normalize()
        normals.push(n.x, n.y, n.z)
      }
    }

    // --- Vertex last: bottom apex ---
    const rBot = baseRadius * (1 + waistDepth * Math.cos(2 * Math.PI))
    vertices.push(0, -rBot, 0)
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

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setIndex(indices)

    return new THREE.Mesh(geometry, this.createSurfaceMaterial())
  }

  createGrid(): THREE.LineSegments {
    const { baseRadius, waistDepth, gridSegmentsU, gridSegmentsV } =
      PeanutSurface.getInitData()
    const vertices: number[] = []
    const lineDetail = 48

    // Longitude lines (constant theta)
    for (let i = 0; i < gridSegmentsU; i++) {
      const theta = (i / gridSegmentsU) * Math.PI * 2
      const cosTheta = Math.cos(theta)
      const sinTheta = Math.sin(theta)

      for (let j = 0; j < lineDetail; j++) {
        const phi0 = (j / lineDetail) * Math.PI
        const phi1 = ((j + 1) / lineDetail) * Math.PI

        const r0 = baseRadius * (1 + waistDepth * Math.cos(2 * phi0))
        const r1 = baseRadius * (1 + waistDepth * Math.cos(2 * phi1))

        vertices.push(
          r0 * Math.sin(phi0) * cosTheta,
          r0 * Math.cos(phi0),
          r0 * Math.sin(phi0) * sinTheta
        )
        vertices.push(
          r1 * Math.sin(phi1) * cosTheta,
          r1 * Math.cos(phi1),
          r1 * Math.sin(phi1) * sinTheta
        )
      }
    }

    // Latitude lines (constant phi)
    for (let j = 1; j < gridSegmentsV; j++) {
      const phi = (j / gridSegmentsV) * Math.PI
      const r = baseRadius * (1 + waistDepth * Math.cos(2 * phi))
      const sinPhi = Math.sin(phi)
      const cosPhi = Math.cos(phi)

      for (let i = 0; i < lineDetail; i++) {
        const theta0 = (i / lineDetail) * Math.PI * 2
        const theta1 = ((i + 1) / lineDetail) * Math.PI * 2

        vertices.push(
          r * sinPhi * Math.cos(theta0),
          r * cosPhi,
          r * sinPhi * Math.sin(theta0)
        )
        vertices.push(
          r * sinPhi * Math.cos(theta1),
          r * cosPhi,
          r * sinPhi * Math.sin(theta1)
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
