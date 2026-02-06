import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEOM_SIZE = 0.08; // half-extent of the diamond
const GEOM_COLOR = new THREE.Color(0x00ff66); // bright green
const GEOM_GLOW_COLOR = new THREE.Color(0x88ffaa);
const MAGNET_RANGE = 2; // units -- start pulling toward player
const MAGNET_SPEED = 8; // units/sec when being pulled
const FADE_DURATION = 10; // seconds before despawn
const FADE_START = 7; // seconds before starting to fade
const SPIN_SPEED = 3; // radians / sec
const POOL_SIZE = 300;

// ---------------------------------------------------------------------------
// Single geom data
// ---------------------------------------------------------------------------

interface GeomData {
  alive: boolean;
  age: number;
  surfaceU: number;
  surfaceV: number;
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
        spinOffset: Math.random() * Math.PI * 2,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Spawn a geom at the given surface coordinates.
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

      // Magnetic pull toward player.
      const du = playerU - g.surfaceU;
      const dv = playerV - g.surfaceV;
      const dist = Math.sqrt(du * du + dv * dv);

      if (dist < MAGNET_RANGE && dist > 0.01) {
        // Strength increases as geom gets closer.
        const strength = 1 - dist / MAGNET_RANGE;
        const pull = MAGNET_SPEED * strength * dt;
        g.surfaceU += (du / dist) * pull;
        g.surfaceV += (dv / dist) * pull;
      }

      // Spin animation (around surface normal / local Y).
      const mesh = this.meshes[i];
      mesh.rotation.y = (totalTime * SPIN_SPEED) + g.spinOffset;
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
      const mat = new THREE.Matrix4().makeBasis(tangent, normal, bitangent);
      const baseQuat = new THREE.Quaternion().setFromRotationMatrix(mat);
      const spinQuat = new THREE.Quaternion().setFromAxisAngle(
        normal,
        mesh.rotation.y,
      );
      spinQuat.multiply(baseQuat);
      mesh.quaternion.copy(spinQuat);
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

  // Diamond vertices in XZ plane.
  const vertices = new Float32Array([
    0, 0, s,   // top
    s, 0, 0,   // right
    0, 0, -s,  // bottom
    -s, 0, 0,  // left
    0, 0, s,   // close the loop
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

  const mainMaterial = new THREE.LineBasicMaterial({
    color: GEOM_COLOR,
    linewidth: 2,
    transparent: true,
    opacity: 1,
  });

  const glowMaterial = new THREE.LineBasicMaterial({
    color: GEOM_GLOW_COLOR,
    linewidth: 4,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const mainLine = new THREE.Line(geometry, mainMaterial);
  const glowLine = new THREE.Line(geometry.clone(), glowMaterial);
  glowLine.scale.setScalar(1.3);

  const group = new THREE.Group();
  group.add(glowLine);
  group.add(mainLine);
  return group;
}

/**
 * Set opacity on all line materials within a geom group.
 */
function setGeomOpacity(group: THREE.Group, opacity: number): void {
  group.traverse((child) => {
    if (child instanceof THREE.Line) {
      const mat = child.material as THREE.LineBasicMaterial;
      mat.opacity = child === group.children[0]
        ? opacity * 0.3 // glow layer
        : opacity;
    }
  });
}
