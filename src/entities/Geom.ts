import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEOM_SIZE = 0.15; // half-extent of the diamond (increased for visibility)
const GEOM_COLOR = new THREE.Color(0x00ff44); // bright green (GW3D authentic)
const GEOM_GLOW_COLOR = new THREE.Color(0x44ff44);
const MAGNET_RANGE = 2; // units -- start pulling toward player
const MAGNET_SPEED = 8; // units/sec when being pulled
const FADE_DURATION = 10; // seconds before despawn
const FADE_START = 7; // seconds before starting to fade
const SPIN_SPEED = 3; // radians / sec
const POOL_SIZE = 300;

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
  /** UV velocity for burst scatter animation. */
  velU: number;
  velV: number;
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
   */
  spawn(surfaceU: number, surfaceV: number): void {
    const idx = this.findInactive();
    if (idx < 0) return;

    const g = this.geoms[idx];
    g.alive = true;
    g.age = 0;
    g.surfaceU = surfaceU;
    g.surfaceV = surfaceV;
    g.spinOffset = Math.random() * Math.PI * 2;

    // Random burst direction (radial outward from kill position)
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.05 + Math.random() * 0.1; // UV units/sec
    g.velU = Math.cos(angle) * speed;
    g.velV = Math.sin(angle) * speed;

    const mesh = this.meshes[idx];
    mesh.visible = true;
    setGeomOpacity(mesh, 1);
  }

  /**
   * Update all active geoms.  Handles aging, fading, magnetic pull toward
   * the player, and despawn.
   *
   * @param dt          Fixed timestep delta (seconds).
   * @param playerU     Player surface-U coordinate.
   * @param playerV     Player surface-V coordinate.
   * @param totalTime   Total game time for animation.
   */
  update(
    dt: number,
    playerU: number,
    playerV: number,
    totalTime: number,
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

      // Apply burst velocity (decelerates over time)
      if (Math.abs(g.velU) > 0.001 || Math.abs(g.velV) > 0.001) {
        g.surfaceU += g.velU * dt;
        g.surfaceV += g.velV * dt;
        // Friction deceleration
        g.velU *= 0.92;
        g.velV *= 0.92;
      }

      // Magnetic pull toward player (only after initial burst settles, ~0.3s)
      if (g.age > 0.3) {
        const du = playerU - g.surfaceU;
        const dv = playerV - g.surfaceV;
        const dist = Math.sqrt(du * du + dv * dv);

        if (dist < MAGNET_RANGE && dist > 0.01) {
          const strength = 1 - dist / MAGNET_RANGE;
          const pull = MAGNET_SPEED * strength * dt;
          g.surfaceU += (du / dist) * pull;
          g.surfaceV += (dv / dist) * pull;
        }
      }

      // Spin animation (around surface normal / local Y).
      const mesh = this.meshes[i];
      mesh.rotation.y = (totalTime * SPIN_SPEED) + g.spinOffset;

      // Sparkle/pulse effect (subtle brightness oscillation)
      const sparkle = 0.85 + 0.15 * Math.sin(totalTime * 6 + g.spinOffset * 3);
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
