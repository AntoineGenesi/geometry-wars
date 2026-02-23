import * as THREE from 'three'
import { OcclusionSurfaceMaterial } from '../rendering/OcclusionSurfaceMaterial'

export interface SurfacePoint {
  position: THREE.Vector3
  normal: THREE.Vector3
  tangentU: THREE.Vector3
  tangentV: THREE.Vector3
}

export interface SpringVertex {
  restPosition: THREE.Vector3
  offset: THREE.Vector3
  velocity: THREE.Vector3
  damping: number
  stiffness: number
}

export interface SurfaceConfig {
  gridColor?: number
  surfaceColor?: number
  surfaceOpacity?: number
  gridOpacity?: number
  damping?: number
  stiffness?: number
}

const DEFAULT_CONFIG: Required<SurfaceConfig> = {
  gridColor: 0x2a2aaa,
  surfaceColor: 0x141440,
  surfaceOpacity: 0.92,
  gridOpacity: 0.4,
  damping: 0.95,
  stiffness: 0.2,
}

export abstract class Surface {
  readonly mesh: THREE.Mesh
  readonly gridMesh: THREE.LineSegments
  readonly gridVertexSprings: SpringVertex[]
  readonly group: THREE.Group
  protected readonly config: Required<SurfaceConfig>

  // Mesh deformation springs (lazy-initialized on first applyMeshForce call)
  private meshVertexSprings: SpringVertex[] = []
  private meshSpringsInitialized = false
  private readonly _meshSpringTempDir = new THREE.Vector3()
  private readonly _meshSpringTempPos = new THREE.Vector3()

  /**
   * World rotation of the surface. This implements "player-centric" view:
   * - Player stays at fixed screen position (always visible)
   * - Surface rotates to simulate player movement
   * - All entities on surface rotate with it
   *
   * This is SHAPE-AGNOSTIC - works for sphere, cube, torus, irregular meshes, etc.
   */
  readonly worldRotation: THREE.Quaternion = new THREE.Quaternion()

  /**
   * The "player front" position in local coordinates (before rotation).
   * Player is at front of surface (facing camera), not top.
   * Position gives equal view around the player. Subclasses can override.
   */
  protected playerLocalPosition: THREE.Vector3 = new THREE.Vector3(0, 0.7, 0.7).normalize()

  /**
   * Surface radius (approximate) for calculating player offset from surface.
   * Subclasses should override this.
   */
  protected surfaceRadius: number = 10

  /**
   * Speed normalization factor for UV-based movement.
   *
   * All enemies move in UV space (du/dv per second). But the same UV delta
   * maps to vastly different world-space distances on different surfaces:
   * - Sphere (radius 10): du=1 covers ~63 world units at equator
   * - CubeWithTunnel (size 80): du=1 covers ~300 world units
   *
   * This factor normalizes speeds so du=1 always covers roughly the same
   * world distance regardless of surface geometry. Computed automatically
   * from the surface's UV-to-world mapping relative to a reference sphere.
   *
   * Usage: enemies multiply their base UV speed by this factor.
   * A value < 1 means the surface is larger than reference and speeds
   * should be reduced. A value > 1 means it's smaller.
   */
  private _speedScale: number | null = null

  get speedScale(): number {
    if (this._speedScale === null) {
      this._speedScale = this.computeSpeedScale()
    }
    return this._speedScale
  }

  constructor(config?: SurfaceConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.gridVertexSprings = []
    this.mesh = this.createMesh()
    this.gridMesh = this.createGrid()
    this.initSprings()

    // Render order: surface first (0), grid on top (1) to eliminate z-fighting flicker
    this.mesh.renderOrder = 0
    this.gridMesh.renderOrder = 1

    this.group = new THREE.Group()
    this.group.add(this.mesh)
    this.group.add(this.gridMesh)
  }

  // ---------------------------------------------------------------------------
  // GENERIC ROTATION-BASED MOVEMENT (works for ANY shape)
  // ---------------------------------------------------------------------------

  /**
   * Rotate the surface based on player input.
   * This is SHAPE-AGNOSTIC - works for any 3D object.
   *
   * Movement input causes the surface to rotate in the opposite direction,
   * creating the illusion that the player is moving on the surface.
   *
   * @param dx - Movement along screen X axis (left/right, -1 to 1)
   * @param dy - Movement along screen Y axis (up/down = forward/backward, -1 to 1)
   * @param speed - Movement speed (radians per unit input)
   */
  rotateByInput(dx: number, dy: number, speed: number): void {
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return

    // Rotation axes (in world space):
    // - Moving "forward" (W, dy < 0) = rotate surface around X axis (pitch)
    // - Moving "right" (D, dx > 0) = rotate surface around Z axis (roll)
    // The rotation is OPPOSITE to movement direction (surface moves "under" player)

    // FIXED: Negate rotations so player appears to move in the direction pressed
    // W (dy=-1) should make player go UP/forward on screen, so world rotates DOWN (positive X rotation)
    // D (dx=+1) should make player go RIGHT, so world rotates LEFT (positive Z rotation)
    const rotX = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -dy * speed  // Negated: W (dy=-1) gives positive rotation
    )
    const rotZ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      dx * speed   // Negated: D (dx=+1) gives positive rotation
    )

    // Apply rotations: first X (forward/back), then Z (left/right)
    this.worldRotation.premultiply(rotX)
    this.worldRotation.premultiply(rotZ)
    this.worldRotation.normalize()

    // Apply to visual group
    this.group.quaternion.copy(this.worldRotation)
  }

  /**
   * Get the player's fixed world position (always at "front" of rotated surface).
   * This is SHAPE-AGNOSTIC.
   */
  getPlayerWorldPosition(): THREE.Vector3 {
    return this.playerLocalPosition.clone().applyQuaternion(this.worldRotation)
  }

  /**
   * Get the surface normal at player's position (for orientation).
   * This is SHAPE-AGNOSTIC.
   */
  getPlayerNormal(): THREE.Vector3 {
    return this.playerLocalPosition.clone().normalize().applyQuaternion(this.worldRotation)
  }

  /**
   * Get tangent vectors at player position for aiming/shooting.
   */
  getPlayerTangents(): { tangentU: THREE.Vector3; tangentV: THREE.Vector3 } {
    // Default tangents for a point at "top" of surface
    const tangentU = new THREE.Vector3(1, 0, 0).applyQuaternion(this.worldRotation)
    const tangentV = new THREE.Vector3(0, 0, 1).applyQuaternion(this.worldRotation)
    return { tangentU, tangentV }
  }

  /**
   * Convert world rotation to virtual UV coordinates (for compatibility with UV-based systems).
   * This allows enemies to "track" the player using UV distance.
   */
  getPlayerVirtualUV(): { u: number; v: number } {
    // Inverse rotation applied to player local position gives "virtual" position
    const inverseRot = this.worldRotation.clone().invert()
    const virtualPos = this.playerLocalPosition.clone().applyQuaternion(inverseRot)
    return this.worldToSurface(virtualPos)
  }

  /** Update the surface material opacity. */
  setSurfaceOpacity(opacity: number): void {
    if (this.mesh.material && typeof (this.mesh.material as any).opacity === 'number') {
      (this.mesh.material as any).opacity = opacity
    }
  }

  /**
   * Apply world rotation to a local surface point.
   * Used by getPoint() implementations to transform local coords to world coords.
   */
  protected applyWorldRotation(point: SurfacePoint): SurfacePoint {
    return {
      position: point.position.applyQuaternion(this.worldRotation),
      normal: point.normal.applyQuaternion(this.worldRotation),
      tangentU: point.tangentU.applyQuaternion(this.worldRotation),
      tangentV: point.tangentV.applyQuaternion(this.worldRotation),
    }
  }

  abstract getPoint(u: number, v: number): SurfacePoint

  abstract moveOnSurface(
    u: number,
    v: number,
    du: number,
    dv: number
  ): { u: number; v: number }

  abstract worldToSurface(worldPos: THREE.Vector3): { u: number; v: number }

  /**
   * Get the local UV-to-world-space scale factors at a given UV position.
   *
   * Returns how many world units one UV unit covers in each direction.
   * Used to correct enemy movement speed so that entities move at consistent
   * world-space speed regardless of UV distortion (e.g. sphere poles,
   * cube top/bottom faces, capsule caps).
   *
   * The returned values are the magnitudes of the Jacobian columns:
   *   scaleU = |d(worldPos)/du|  (world units per UV unit in u direction)
   *   scaleV = |d(worldPos)/dv|  (world units per UV unit in v direction)
   *
   * Default implementation uses finite differences on getPoint().
   * Subclasses may override for analytical precision or performance.
   */
  getUVScaleAt(u: number, v: number): { scaleU: number; scaleV: number } {
    const epsilon = 0.0005

    // Save and reset rotation so we measure local geometry
    const savedRotation = this.worldRotation.clone()
    this.worldRotation.identity()

    const p0 = this.getPoint(u, v)

    // Measure U direction (handle wrapping)
    const uPlus = ((u + epsilon) % 1 + 1) % 1
    const pU = this.getPoint(uPlus, v)
    const scaleU = p0.position.distanceTo(pU.position) / epsilon

    // Measure V direction (clamp to valid range)
    const vPlus = Math.min(v + epsilon, 1 - 0.001)
    const actualEpsV = vPlus - v
    const pV = this.getPoint(u, vPlus)
    const scaleV = actualEpsV > 0.0001
      ? p0.position.distanceTo(pV.position) / actualEpsV
      : p0.position.distanceTo(pV.position) / epsilon

    // Restore rotation
    this.worldRotation.copy(savedRotation)

    return {
      scaleU: Math.max(scaleU, 0.001),
      scaleV: Math.max(scaleV, 0.001),
    }
  }

  /**
   * Wrap/clamp UV coordinates according to this surface's topology.
   *
   * Different surfaces have different boundary behaviors:
   * - Sphere: u wraps, v clamps (poles)
   * - Torus: both u and v wrap (doubly periodic)
   * - Cube: u wraps, v clamps (top/bottom faces)
   * - Capsule/Pill: u wraps, v clamps (poles)
   *
   * Default: u wraps [0,1), v clamps to [epsilon, 1-epsilon].
   * Subclasses override for surface-specific topology.
   */
  wrapUV(u: number, v: number): { u: number; v: number } {
    const epsilon = 0.005
    return {
      u: ((u % 1) + 1) % 1,
      v: Math.max(epsilon, Math.min(1 - epsilon, v)),
    }
  }

  /**
   * Whether the U axis wraps around (periodic).
   * Used by separation forces and distance calculations to handle
   * wrap-around correctly. Default: true (most surfaces wrap in U).
   */
  get wrapsU(): boolean { return true }

  /**
   * Whether the V axis wraps around (periodic).
   * Default: false (most surfaces clamp V at poles/caps).
   * Toroidal surfaces override to return true.
   */
  get wrapsV(): boolean { return false }

  abstract createMesh(): THREE.Mesh

  abstract createGrid(): THREE.LineSegments

  protected createSurfaceMaterial(): OcclusionSurfaceMaterial {
    return new OcclusionSurfaceMaterial({
      color: this.config.surfaceColor,
      transparent: true,
      opacity: this.config.surfaceOpacity,
      side: THREE.FrontSide, // Only render front faces to avoid double-vision on torus/complex shapes
      depthWrite: false, // Transparent surface should not write depth (causes grid z-fighting flicker)
      polygonOffset: true, // Push surface back in depth to avoid z-fighting with grid overlay
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })
  }

  protected createGridMaterial(): THREE.LineBasicMaterial {
    return new THREE.LineBasicMaterial({
      color: this.config.gridColor,
      transparent: true,
      opacity: this.config.gridOpacity,
      depthWrite: false, // Grid lines should not write depth (prevents flicker with surface)
    })
  }

  private initSprings(): void {
    const geometry = this.gridMesh.geometry
    const posAttr = geometry.getAttribute('position')
    if (!posAttr) return

    for (let i = 0; i < posAttr.count; i++) {
      const rest = new THREE.Vector3(
        posAttr.getX(i),
        posAttr.getY(i),
        posAttr.getZ(i)
      )
      this.gridVertexSprings.push({
        restPosition: rest.clone(),
        offset: new THREE.Vector3(0, 0, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        damping: this.config.damping,
        stiffness: this.config.stiffness,
      })
    }
  }

  // Pre-allocated temp vectors for spring calculations (avoids ~5000 allocations/frame)
  private readonly _springTempDir = new THREE.Vector3()
  private readonly _springTempForce = new THREE.Vector3()
  private readonly _springTempPos = new THREE.Vector3()

  applyForce(worldPos: THREE.Vector3, force: number, radius: number): void {
    const radiusSq = radius * radius
    for (const spring of this.gridVertexSprings) {
      // Use distanceToSquared to avoid sqrt, then only sqrt when within radius
      const distSq = spring.restPosition.distanceToSquared(worldPos)
      if (distSq < radiusSq && distSq > 0.0001) {
        const dist = Math.sqrt(distSq)
        const falloff = 1.0 - dist / radius
        // Reuse temp vector instead of clone()
        this._springTempDir.copy(spring.restPosition).sub(worldPos).normalize()
        spring.velocity.addScaledVector(this._springTempDir, force * falloff * falloff)
      }
    }
  }

  updateGrid(dt: number): void {
    const posAttr = this.gridMesh.geometry.getAttribute('position')
    if (!posAttr) return

    const clampedDt = Math.min(dt, 1 / 30)
    const steps = Math.ceil(clampedDt / (1 / 120))
    const subDt = clampedDt / steps

    for (let step = 0; step < steps; step++) {
      for (const spring of this.gridVertexSprings) {
        // Compute spring force in-place: F = -stiffness * offset
        // Instead of clone().multiplyScalar(), use addScaledVector
        const stiffnessTimesDt = -spring.stiffness * subDt * 60
        spring.velocity.addScaledVector(spring.offset, stiffnessTimesDt)
        spring.velocity.multiplyScalar(Math.pow(spring.damping, subDt * 60))
        // Instead of clone().multiplyScalar(subDt), use addScaledVector
        spring.offset.addScaledVector(spring.velocity, subDt)
      }
    }

    for (let i = 0; i < this.gridVertexSprings.length; i++) {
      const spring = this.gridVertexSprings[i]
      // Use temp vector instead of clone()
      this._springTempPos.copy(spring.restPosition).add(spring.offset)
      posAttr.setXYZ(i, this._springTempPos.x, this._springTempPos.y, this._springTempPos.z)
    }

    posAttr.needsUpdate = true
  }

  // ---------------------------------------------------------------------------
  // MESH DEFORMATION (for black hole / gravity gun effects)
  // ---------------------------------------------------------------------------

  /**
   * Lazily initialize springs for the surface mesh vertices.
   * Called on first applyMeshForce() to avoid overhead on surfaces that never deform.
   */
  private initMeshSprings(): void {
    if (this.meshSpringsInitialized) return
    const posAttr = this.mesh.geometry.getAttribute('position')
    if (!posAttr) return

    // Mesh springs are stiffer than grid springs for a snappier "black hole" snap-back effect
    const MESH_STIFFNESS = 0.4

    for (let i = 0; i < posAttr.count; i++) {
      const rest = new THREE.Vector3(
        posAttr.getX(i),
        posAttr.getY(i),
        posAttr.getZ(i)
      )
      this.meshVertexSprings.push({
        restPosition: rest.clone(),
        offset: new THREE.Vector3(0, 0, 0),
        velocity: new THREE.Vector3(0, 0, 0),
        damping: this.config.damping,
        stiffness: MESH_STIFFNESS,
      })
    }
    this.meshSpringsInitialized = true
  }

  /**
   * Apply a force to surface mesh vertices within a radius of worldPos.
   * Negative force = pull inward (toward worldPos) — used for black hole effect.
   * Positive force = push outward.
   *
   * @param worldPos - Impact point (local space, same convention as applyForce)
   * @param force    - Force magnitude. Negative = inward pull.
   * @param radius   - Affected radius in local-space units
   */
  applyMeshForce(worldPos: THREE.Vector3, force: number, radius: number): void {
    this.initMeshSprings()
    const radiusSq = radius * radius
    for (const spring of this.meshVertexSprings) {
      const distSq = spring.restPosition.distanceToSquared(worldPos)
      if (distSq < radiusSq && distSq > 0.0001) {
        const dist = Math.sqrt(distSq)
        const falloff = 1.0 - dist / radius
        // For inward pull (negative force): direction is toward worldPos
        // this._meshSpringTempDir points FROM spring TO worldPos (inward)
        this._meshSpringTempDir.copy(worldPos).sub(spring.restPosition).normalize()
        // force < 0 means pull inward; we flip sign so negative force → inward impulse
        spring.velocity.addScaledVector(this._meshSpringTempDir, -force * falloff * falloff)
      }
    }
  }

  /**
   * Integrate mesh spring physics and write deformed positions to the mesh geometry.
   * Must be called each frame for the deformation animation to play out.
   *
   * Uses a dirty-region skip: vertices with negligible offset AND velocity are skipped
   * to avoid iterating thousands of resting vertices every frame.
   *
   * @param dt - Time step in seconds
   */
  updateMeshDeformation(dt: number): void {
    if (!this.meshSpringsInitialized) return

    const posAttr = this.mesh.geometry.getAttribute('position')
    if (!posAttr) return

    const clampedDt = Math.min(dt, 1 / 30)
    const steps = Math.ceil(clampedDt / (1 / 120))
    const subDt = clampedDt / steps

    const IDLE_THRESHOLD_SQ = 0.00001

    for (let step = 0; step < steps; step++) {
      for (const spring of this.meshVertexSprings) {
        // Skip vertices that are at rest (dirty-region optimization)
        if (
          spring.offset.lengthSq() < IDLE_THRESHOLD_SQ &&
          spring.velocity.lengthSq() < IDLE_THRESHOLD_SQ
        ) continue

        const stiffnessTimesDt = -spring.stiffness * subDt * 60
        spring.velocity.addScaledVector(spring.offset, stiffnessTimesDt)
        spring.velocity.multiplyScalar(Math.pow(spring.damping, subDt * 60))
        spring.offset.addScaledVector(spring.velocity, subDt)
      }
    }

    let anyActive = false
    for (let i = 0; i < this.meshVertexSprings.length; i++) {
      const spring = this.meshVertexSprings[i]
      if (
        spring.offset.lengthSq() < IDLE_THRESHOLD_SQ &&
        spring.velocity.lengthSq() < IDLE_THRESHOLD_SQ
      ) continue

      anyActive = true
      this._meshSpringTempPos.copy(spring.restPosition).add(spring.offset)
      posAttr.setXYZ(i, this._meshSpringTempPos.x, this._meshSpringTempPos.y, this._meshSpringTempPos.z)
    }

    if (anyActive) {
      posAttr.needsUpdate = true
    }
  }

  /**
   * Compute UV-to-world speed normalization factor by sampling the surface.
   *
   * Measures world-space distance per UV unit at multiple sample points,
   * averages them, then divides by the reference distance (sphere radius=10
   * at equator: ~62.8 world units per UV unit in U, ~31.4 in V).
   *
   * Reference: sphere radius=10, average world distance per UV unit ≈ 47.
   *
   * Subclasses can override this if they want to provide an explicit value
   * instead of sampling (e.g. for performance or precision).
   */
  protected computeSpeedScale(): number {
    // Reference: sphere radius=10.
    // U circumference at equator (v=0.5): 2*pi*10 = 62.83
    // V half-circumference (pole to pole): pi*10 = 31.42
    // Geometric mean of U and V: sqrt(62.83 * 31.42) ≈ 44.4
    const REFERENCE_WORLD_PER_UV = 44.4

    const epsilon = 0.001
    const samplePoints = [
      { u: 0.25, v: 0.25 },
      { u: 0.25, v: 0.75 },
      { u: 0.75, v: 0.25 },
      { u: 0.75, v: 0.75 },
      { u: 0.5, v: 0.5 },
    ]

    let totalWorldPerUV = 0
    let validSamples = 0

    // Save current rotation and temporarily reset to identity
    // so getPoint returns local coordinates
    const savedRotation = this.worldRotation.clone()
    this.worldRotation.identity()

    for (const sp of samplePoints) {
      const p0 = this.getPoint(sp.u, sp.v)

      // Measure U direction
      const pU = this.getPoint(sp.u + epsilon, sp.v)
      const distU = p0.position.distanceTo(pU.position) / epsilon

      // Measure V direction
      const pV = this.getPoint(sp.u, sp.v + epsilon)
      const distV = p0.position.distanceTo(pV.position) / epsilon

      if (distU > 0.001 && distV > 0.001) {
        // Geometric mean of U and V scale
        totalWorldPerUV += Math.sqrt(distU * distV)
        validSamples++
      }
    }

    // Restore rotation
    this.worldRotation.copy(savedRotation)

    if (validSamples === 0) return 1.0

    const avgWorldPerUV = totalWorldPerUV / validSamples
    return REFERENCE_WORLD_PER_UV / avgWorldPerUV
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    if (this.mesh.material instanceof THREE.Material) {
      this.mesh.material.dispose()
    }
    this.gridMesh.geometry.dispose()
    if (this.gridMesh.material instanceof THREE.Material) {
      this.gridMesh.material.dispose()
    }
  }
}
