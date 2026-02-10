import * as THREE from 'three';
import { computeDepthVisibility, DEFAULT_DEPTH_CURVE } from '../rendering/DepthOpacity';

// Pre-allocated temp vector for depth opacity normal calculation
const _geomDepthNormal = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEOM_SIZE = 0.15; // half-extent of the diamond (increased for visibility)
const GEOM_COLOR = new THREE.Color(0x00ff44); // bright green (GW3D authentic)
const GEOM_GLOW_COLOR = new THREE.Color(0x44ff44);
const GEOM_ATTRACT_COLOR = new THREE.Color(0x88ffff); // cyan tint when being attracted

/** Base magnetism radius (intentionally small so buff feels impactful). */
const BASE_MAGNET_RANGE = 2.5;
/** Maximum pull speed in UV units/sec when geom is very close to player. */
const MAGNET_MAX_SPEED = 12;
/** Acceleration factor for smooth ramp-up (UV units/sec^2). */
const MAGNET_ACCEL = 18;
/** Minimum age (seconds) before attraction kicks in (let burst settle). */
const MAGNET_SETTLE_TIME = 0.3;

const FADE_DURATION = 10; // seconds before despawn
const FADE_START = 7; // seconds before starting to fade
const SPIN_SPEED = 3; // radians / sec
const POOL_SIZE = 300;

/** Momentum from kill shot: base UV speed biased toward bullet direction. */
const KILL_SHOT_MOMENTUM = 0.12; // UV units/sec in bullet direction
/** Random scatter added on top of kill-shot momentum. */
const SCATTER_SPEED_MIN = 0.03;
const SCATTER_SPEED_MAX = 0.08;
/** Friction multiplier per-frame (applied to velocity each tick). */
const DRIFT_FRICTION = 0.92;

// Pre-allocated temp objects for surface projection (avoids ~900 allocations/frame)
const _geomTempMatrix = new THREE.Matrix4();
const _geomTempBaseQuat = new THREE.Quaternion();
const _geomTempSpinQuat = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Single geom data
// ---------------------------------------------------------------------------

interface GeomData {
  alive: boolean;
  age: number;
  surfaceU: number;
  surfaceV: number;
  /** UV velocity (from burst + kill-shot momentum). */
  velU: number;
  velV: number;
  /** Current magnetic pull speed (ramps up smoothly). */
  magnetSpeed: number;
  /** Whether this geom is currently being attracted (for visual feedback). */
  attracted: boolean;
  /** Random spin offset so they do not all rotate in sync. */
  spinOffset: number;
}

// ---------------------------------------------------------------------------
// GeomPool
// ---------------------------------------------------------------------------

export class GeomPool {
  readonly root: THREE.Group;

  private readonly geoms: GeomData[] = [];
  private readonly meshes: THREE.Group[] = [];

  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'GeomPool';

    for (let i = 0; i < POOL_SIZE; i++) {
      const group = createGeomMesh();
      group.visible = false;
      this.root.add(group);
      this.meshes.push(group);

      this.geoms.push({
        alive: false,
        age: 0,
        surfaceU: 0,
        surfaceV: 0,
        velU: 0,
        velV: 0,
        magnetSpeed: 0,
        attracted: false,
        spinOffset: Math.random() * Math.PI * 2,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Spawn a geom at the given surface coordinates with burst velocity.
   * Spawns exactly at the kill position and flies outward smoothly.
   *
   * @param surfaceU  Kill position U coordinate.
   * @param surfaceV  Kill position V coordinate.
   * @param bulletAngle  Optional angle (radians) of the killing bullet's
   *                     travel direction on the surface. When provided, the
   *                     geom receives momentum biased in that direction.
   */
  spawn(surfaceU: number, surfaceV: number, bulletAngle?: number): void {
    const idx = this.findInactive();
    if (idx < 0) return;

    const g = this.geoms[idx];
    g.alive = true;
    g.age = 0;
    g.surfaceU = surfaceU;
    g.surfaceV = surfaceV;
    g.spinOffset = Math.random() * Math.PI * 2;
    g.magnetSpeed = 0;
    g.attracted = false;

    // Random scatter component
    const scatterAngle = Math.random() * Math.PI * 2;
    const scatterSpeed = SCATTER_SPEED_MIN + Math.random() * (SCATTER_SPEED_MAX - SCATTER_SPEED_MIN);

    if (bulletAngle !== undefined) {
      // Kill-shot momentum: bias velocity toward bullet's travel direction
      // plus a random scatter for natural spread
      g.velU = Math.cos(bulletAngle) * KILL_SHOT_MOMENTUM + Math.cos(scatterAngle) * scatterSpeed;
      g.velV = Math.sin(bulletAngle) * KILL_SHOT_MOMENTUM + Math.sin(scatterAngle) * scatterSpeed;
    } else {
      // No bullet info -- pure random burst (legacy path)
      g.velU = Math.cos(scatterAngle) * scatterSpeed;
      g.velV = Math.sin(scatterAngle) * scatterSpeed;
    }

    const mesh = this.meshes[idx];
    mesh.visible = true;
    setGeomOpacity(mesh, 1);
    // Reset color to default (in case it was tinted from previous attraction)
    setGeomColor(mesh, GEOM_COLOR, GEOM_GLOW_COLOR);
  }

  /**
   * Update all active geoms.  Handles aging, fading, magnetic pull toward
   * the player, and despawn.
   *
   * @param dt            Fixed timestep delta (seconds).
   * @param playerU       Player surface-U coordinate.
   * @param playerV       Player surface-V coordinate.
   * @param totalTime     Total game time for animation.
   * @param magnetRadius  Total magnetism radius (base + buff bonus).
   *                      Defaults to BASE_MAGNET_RANGE if not provided.
   */
  update(
    dt: number,
    playerU: number,
    playerV: number,
    totalTime: number,
    magnetRadius: number = BASE_MAGNET_RANGE,
  ): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      const g = this.geoms[i];
      if (!g.alive) continue;

      g.age += dt;

      // Despawn after FADE_DURATION.
      if (g.age >= FADE_DURATION) {
        this.kill(i);
        continue;
      }

      // Fade out during the last few seconds.
      if (g.age > FADE_START) {
        const t = (g.age - FADE_START) / (FADE_DURATION - FADE_START);
        setGeomOpacity(this.meshes[i], 1 - t);
      }

      // Apply drift velocity (decelerates via friction)
      if (Math.abs(g.velU) > 0.001 || Math.abs(g.velV) > 0.001) {
        g.surfaceU += g.velU * dt;
        g.surfaceV += g.velV * dt;
        // Friction deceleration
        g.velU *= DRIFT_FRICTION;
        g.velV *= DRIFT_FRICTION;
      }

      // Magnetic attraction toward player (only after initial burst settles)
      const wasAttracted = g.attracted;
      g.attracted = false;

      if (g.age > MAGNET_SETTLE_TIME) {
        const du = playerU - g.surfaceU;
        const dv = playerV - g.surfaceV;
        const dist = Math.sqrt(du * du + dv * dv);

        if (dist < magnetRadius && dist > 0.005) {
          g.attracted = true;

          // Inverse-distance force curve: stronger as geom gets closer.
          // strength goes from ~0 at edge to ~1 near player.
          // Using (1 - dist/range)^2 for a smooth, accelerating feel.
          const t = 1 - dist / magnetRadius;
          const strength = t * t; // quadratic curve = smooth acceleration

          // Smoothly ramp up magnetic speed (acceleration-based, not instant)
          const targetSpeed = MAGNET_MAX_SPEED * strength;
          g.magnetSpeed += (targetSpeed - g.magnetSpeed) * Math.min(MAGNET_ACCEL * dt, 1);

          // Apply pull in UV space (direction toward player)
          const invDist = 1 / dist;
          const pull = g.magnetSpeed * dt;
          g.surfaceU += du * invDist * pull;
          g.surfaceV += dv * invDist * pull;

          // Override drift velocity -- attracted geoms stop drifting randomly
          g.velU *= 0.8;
          g.velV *= 0.8;
        } else {
          // Outside range: decay magnetic speed back to zero
          g.magnetSpeed *= 0.9;
        }
      }

      // Visual feedback: tint cyan when being attracted
      if (g.attracted !== wasAttracted) {
        const mesh = this.meshes[i];
        if (g.attracted) {
          setGeomColor(mesh, GEOM_ATTRACT_COLOR, GEOM_ATTRACT_COLOR);
        } else {
          setGeomColor(mesh, GEOM_COLOR, GEOM_GLOW_COLOR);
        }
      }

      // Spin animation (around surface normal / local Y).
      // Spin faster when attracted for extra juice.
      const mesh = this.meshes[i];
      const spinMultiplier = g.attracted ? 2.5 : 1;
      mesh.rotation.y = (totalTime * SPIN_SPEED * spinMultiplier) + g.spinOffset;

      // Sparkle/pulse effect (subtle brightness oscillation)
      // Pulse faster and bigger when attracted
      const pulseFreq = g.attracted ? 12 : 6;
      const pulseAmp = g.attracted ? 0.25 : 0.15;
      const sparkle = (1 - pulseAmp) + pulseAmp * Math.sin(totalTime * pulseFreq + g.spinOffset * 3);
      mesh.scale.setScalar(sparkle);
    }
  }

  /**
   * Apply surface projection -- same pattern as BulletPool.
   */
  applySurfaceProjection(
    getTransform: (
      u: number,
      v: number,
    ) => {
      position: THREE.Vector3;
      normal: THREE.Vector3;
      tangent: THREE.Vector3;
      bitangent: THREE.Vector3;
    },
  ): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      const g = this.geoms[i];
      if (!g.alive) continue;

      const { position, normal, tangent, bitangent } = getTransform(
        g.surfaceU,
        g.surfaceV,
      );

      const mesh = this.meshes[i];
      mesh.position.copy(position);

      // Keep the spin rotation but align up to surface normal.
      // Uses pre-allocated objects instead of new Matrix4/Quaternion per geom
      _geomTempMatrix.makeBasis(tangent, normal, bitangent);
      _geomTempBaseQuat.setFromRotationMatrix(_geomTempMatrix);
      _geomTempSpinQuat.setFromAxisAngle(normal, mesh.rotation.y);
      _geomTempSpinQuat.multiply(_geomTempBaseQuat);
      mesh.quaternion.copy(_geomTempSpinQuat);
    }
  }

  /**
   * Apply depth-based opacity to all active geoms.
   * Far-side geoms (facing away from camera) become nearly transparent;
   * near-side geoms remain fully opaque. Uses the steep preset by default.
   *
   * Must be called AFTER applySurfaceProjection (needs mesh positions set).
   *
   * @param cameraPos  World-space camera position.
   * @param meshCenter Approximate center of the surface mesh (for normal estimation).
   */
  applyDepthOpacity(cameraPos: THREE.Vector3, meshCenter: THREE.Vector3): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      const g = this.geoms[i];
      if (!g.alive) continue;

      const mesh = this.meshes[i];
      // Approximate outward normal: direction from mesh center to geom position
      _geomDepthNormal.copy(mesh.position).sub(meshCenter).normalize();

      const visibility = computeDepthVisibility(
        mesh.position,
        _geomDepthNormal,
        cameraPos,
        DEFAULT_DEPTH_CURVE,
      );

      // Multiply depth visibility into the existing age-based opacity
      // (age-based opacity is already applied by update() via setGeomOpacity)
      mesh.traverse((child) => {
        if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
          const mat = child.material as THREE.LineBasicMaterial;
          // Scale current opacity by depth visibility
          mat.opacity = mat.opacity * visibility;
        }
      });
    }
  }

  /**
   * Deactivate geom at index.
   */
  kill(i: number): void {
    this.geoms[i].alive = false;
    this.meshes[i].visible = false;
  }

  /**
   * Iterate active geoms for collision / pickup checks.
   */
  forEachActive(
    fn: (
      index: number,
      surfaceU: number,
      surfaceV: number,
      position: THREE.Vector3,
    ) => void,
  ): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      const g = this.geoms[i];
      if (!g.alive) continue;
      fn(i, g.surfaceU, g.surfaceV, this.meshes[i].position);
    }
  }

  /** Deactivate everything. */
  clear(): void {
    for (let i = 0; i < POOL_SIZE; i++) {
      this.kill(i);
    }
  }

  // -----------------------------------------------------------------------
  // Direct slot access (used by network-main.ts for server-authoritative
  // geom sync where spawn() cannot be used due to index mismatch).
  // See C3 entity leak fix in decisions/.
  // -----------------------------------------------------------------------

  /** Find and return the index of an inactive pool slot, or -1 if full. */
  findInactiveSlot(): number {
    return this.findInactive();
  }

  /** Get the geom data at a specific index for direct modification. */
  getGeomData(index: number): GeomData {
    return this.geoms[index];
  }

  /** Get the mesh visual at a specific index for direct visibility control. */
  getMesh(index: number): THREE.Group {
    return this.meshes[index];
  }

  /** Total pool capacity. */
  get poolSize(): number {
    return POOL_SIZE;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private findInactive(): number {
    for (let i = 0; i < POOL_SIZE; i++) {
      if (!this.geoms[i].alive) return i;
    }
    return -1;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a diamond/rhombus shape from line geometry with a glow layer.
 */
function createGeomMesh(): THREE.Group {
  const s = GEOM_SIZE;

  // Diamond vertices in XZ plane (outer diamond + cross diagonals for visibility).
  const outerVertices = new Float32Array([
    0, 0, s,   // top
    s, 0, 0,   // right
    0, 0, -s,  // bottom
    -s, 0, 0,  // left
    0, 0, s,   // close the loop
  ]);

  // Cross-diagonals to fill the diamond shape so it reads clearly at distance
  const crossVertices = new Float32Array([
    0, 0, s,   // top
    0, 0, -s,  // bottom
    s, 0, 0,   // right (break)
    -s, 0, 0,  // left
  ]);

  const outerGeometry = new THREE.BufferGeometry();
  outerGeometry.setAttribute('position', new THREE.BufferAttribute(outerVertices, 3));

  const crossGeometry = new THREE.BufferGeometry();
  crossGeometry.setAttribute('position', new THREE.BufferAttribute(crossVertices, 3));

  const mainMaterial = new THREE.LineBasicMaterial({
    color: GEOM_COLOR,
    linewidth: 2,
    transparent: true,
    opacity: 1,
  });

  const crossMaterial = new THREE.LineBasicMaterial({
    color: GEOM_COLOR,
    linewidth: 2,
    transparent: true,
    opacity: 0.9,
  });

  const glowMaterial = new THREE.LineBasicMaterial({
    color: GEOM_GLOW_COLOR,
    linewidth: 4,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const mainLine = new THREE.Line(outerGeometry, mainMaterial);
  const crossLine = new THREE.LineSegments(crossGeometry, crossMaterial);
  const glowLine = new THREE.Line(outerGeometry.clone(), glowMaterial);
  glowLine.scale.setScalar(1.3);

  const group = new THREE.Group();
  group.add(glowLine);   // children[0] - glow layer
  group.add(mainLine);   // children[1] - main outline
  group.add(crossLine);  // children[2] - cross diagonals
  return group;
}

/**
 * Set opacity on all line materials within a geom group.
 * children[0] = glow layer, children[1] = main outline, children[2] = cross diagonals
 */
function setGeomOpacity(group: THREE.Group, opacity: number): void {
  group.traverse((child) => {
    if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
      const mat = child.material as THREE.LineBasicMaterial;
      if (child === group.children[0]) {
        // Glow layer - scaled but more visible than before
        mat.opacity = opacity * 0.7;
      } else {
        // Main outline and cross diagonals - stay bright until late fade
        // Clamp to at least 0.9 while opacity > 0 (sharp visibility until final despawn)
        mat.opacity = opacity > 0 ? Math.max(opacity, 0.9) : 0;
      }
    }
  });
}

/**
 * Set color on all line materials within a geom group.
 * Used for visual feedback when geom is being magnetically attracted.
 */
function setGeomColor(group: THREE.Group, mainColor: THREE.Color, glowColor: THREE.Color): void {
  group.traverse((child) => {
    if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
      const mat = child.material as THREE.LineBasicMaterial;
      if (child === group.children[0]) {
        mat.color.copy(glowColor);
      } else {
        mat.color.copy(mainColor);
      }
    }
  });
}
