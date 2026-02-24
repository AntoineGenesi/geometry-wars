/**
 * WalkingDemo — Procedural low-poly characters with sinusoidal walk cycles.
 *
 * Creates 3 distinct low-poly humanoid models that orbit the centre of a flat
 * arena, animating their limbs each frame. Used by OBJDebugPanel to showcase
 * animated model support without requiring external GLB files.
 *
 * Debug-only — not in the main game code path.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class WalkingDemo {
  private readonly scene: THREE.Scene;
  private readonly characters: WalkingCharacter[];
  private readonly ground: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.ground = buildGround();
    this.scene.add(this.ground);

    this.characters = [
      new WalkingCharacter(scene, buildRobot,   { radius: 1.2, speed: 0.50, phase: 0.0 }),
      new WalkingCharacter(scene, buildAlien,   { radius: 0.7, speed: 0.80, phase: 2.1 }),
      new WalkingCharacter(scene, buildWarrior, { radius: 1.8, speed: 0.35, phase: 4.2 }),
    ];
  }

  /** Call each frame with total elapsed time in seconds. */
  update(elapsed: number): void {
    for (const c of this.characters) c.update(elapsed);
  }

  dispose(): void {
    this.scene.remove(this.ground);
    disposeMeshTree(this.ground);
    for (const c of this.characters) c.dispose();
  }
}

// ---------------------------------------------------------------------------
// Walking character
// ---------------------------------------------------------------------------

interface OrbitParams {
  radius: number;  // orbit radius (world units)
  speed: number;   // radians / second
  phase: number;   // starting angle offset
}

interface CharacterParts {
  root: THREE.Group;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
}

type CharacterBuilder = () => CharacterParts;

class WalkingCharacter {
  private readonly scene: THREE.Scene;
  private readonly root: THREE.Group;
  private readonly leftArm: THREE.Object3D;
  private readonly rightArm: THREE.Object3D;
  private readonly leftLeg: THREE.Object3D;
  private readonly rightLeg: THREE.Object3D;
  private readonly orbit: OrbitParams;

  constructor(scene: THREE.Scene, builder: CharacterBuilder, orbit: OrbitParams) {
    this.scene = scene;
    this.orbit = orbit;
    const parts = builder();
    this.root     = parts.root;
    this.leftArm  = parts.leftArm;
    this.rightArm = parts.rightArm;
    this.leftLeg  = parts.leftLeg;
    this.rightLeg = parts.rightLeg;
    scene.add(this.root);
  }

  update(elapsed: number): void {
    // Orbital position
    const angle = elapsed * this.orbit.speed + this.orbit.phase;
    this.root.position.x = Math.cos(angle) * this.orbit.radius;
    this.root.position.z = Math.sin(angle) * this.orbit.radius;
    // Face direction of travel (tangent to circle)
    this.root.rotation.y = -(angle + Math.PI / 2);

    // Walk cycle — sinusoidal limb swing
    const walkPhase = elapsed * 4.0; // ~2 steps/second
    const swing = Math.sin(walkPhase) * 0.45; // ±26 degrees
    this.leftArm.rotation.x  =  swing;
    this.rightArm.rotation.x = -swing;
    this.leftLeg.rotation.x  = -swing;
    this.rightLeg.rotation.x =  swing;

    // Subtle vertical bob (up on each step)
    this.root.position.y = Math.abs(Math.sin(walkPhase * 2)) * 0.025;
  }

  dispose(): void {
    this.scene.remove(this.root);
    disposeMeshTree(this.root);
  }
}

// ---------------------------------------------------------------------------
// Character builders
// ---------------------------------------------------------------------------

/** Translate a BufferGeometry's vertices along Y so its local origin is at the pivot. */
function pivotGeo(geo: THREE.BufferGeometry, dy: number): THREE.BufferGeometry {
  geo.translate(0, dy, 0);
  return geo;
}

/** Create a positioned Mesh and return it (caller must add to scene/group). */
function positionedMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number, y: number, z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** Create a pivot Object3D containing one Mesh, add it to parent, return the pivot. */
function addPivot(
  parent: THREE.Group,
  px: number, py: number,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
): THREE.Object3D {
  const pivot = new THREE.Object3D();
  pivot.position.set(px, py, 0);
  pivot.add(new THREE.Mesh(geo, mat));
  parent.add(pivot);
  return pivot;
}

// Robot — angular, blue/metallic
function buildRobot(): CharacterParts {
  const root = new THREE.Group();
  const mat    = new THREE.MeshStandardMaterial({ color: 0x4488ff, metalness: 0.7, roughness: 0.3 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0x881100 });

  // Torso (box)
  root.add(positionedMesh(new THREE.BoxGeometry(0.38, 0.48, 0.22), mat, 0, 0.52, 0));
  // Head (box)
  root.add(positionedMesh(new THREE.BoxGeometry(0.30, 0.26, 0.26), mat, 0, 0.86, 0));
  // Eye slots
  root.add(positionedMesh(new THREE.BoxGeometry(0.07, 0.04, 0.02), eyeMat, -0.08, 0.86, 0.14));
  root.add(positionedMesh(new THREE.BoxGeometry(0.07, 0.04, 0.02), eyeMat,  0.08, 0.86, 0.14));

  // Arms — pivot at shoulder (y=0.72), geometry offset down
  const leftArm  = addPivot(root, -0.26, 0.72, pivotGeo(new THREE.BoxGeometry(0.12, 0.36, 0.12), -0.18), mat);
  const rightArm = addPivot(root,  0.26, 0.72, pivotGeo(new THREE.BoxGeometry(0.12, 0.36, 0.12), -0.18), mat);

  // Legs — pivot at hip (y=0.28), geometry offset down
  const leftLeg  = addPivot(root, -0.10, 0.28, pivotGeo(new THREE.BoxGeometry(0.15, 0.40, 0.15), -0.20), mat);
  const rightLeg = addPivot(root,  0.10, 0.28, pivotGeo(new THREE.BoxGeometry(0.15, 0.40, 0.15), -0.20), mat);

  return { root, leftArm, rightArm, leftLeg, rightLeg };
}

// Alien — organic, low-poly icosahedra/octahedra, green
function buildAlien(): CharacterParts {
  const root = new THREE.Group();
  const mat    = new THREE.MeshStandardMaterial({ color: 0x44ff88, roughness: 0.6 });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x002200, roughness: 0.9 });

  // Torso (octahedron, y-stretched)
  const torso = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), mat);
  torso.scale.y = 1.4;
  torso.position.set(0, 0.50, 0);
  root.add(torso);

  // Head (icosahedron = very low-poly sphere)
  root.add(positionedMesh(new THREE.IcosahedronGeometry(0.21, 0), mat, 0, 0.93, 0));

  // Big alien eyes
  root.add(positionedMesh(new THREE.SphereGeometry(0.07, 6, 4), eyeMat, -0.08, 0.96, 0.16));
  root.add(positionedMesh(new THREE.SphereGeometry(0.07, 6, 4), eyeMat,  0.08, 0.96, 0.16));

  // Arms — tapered 4-sided cylinders
  const leftArm  = addPivot(root, -0.28, 0.68, pivotGeo(new THREE.CylinderGeometry(0.05, 0.09, 0.36, 4), -0.18), mat);
  const rightArm = addPivot(root,  0.28, 0.68, pivotGeo(new THREE.CylinderGeometry(0.05, 0.09, 0.36, 4), -0.18), mat);

  // Legs — 4-sided cylinders
  const leftLeg  = addPivot(root, -0.10, 0.30, pivotGeo(new THREE.CylinderGeometry(0.09, 0.05, 0.42, 4), -0.21), mat);
  const rightLeg = addPivot(root,  0.10, 0.30, pivotGeo(new THREE.CylinderGeometry(0.09, 0.05, 0.42, 4), -0.21), mat);

  return { root, leftArm, rightArm, leftLeg, rightLeg };
}

// Warrior — hexagonal armour, orange/metallic
function buildWarrior(): CharacterParts {
  const root = new THREE.Group();
  const mat      = new THREE.MeshStandardMaterial({ color: 0xff8844, roughness: 0.4, metalness: 0.5 });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x220000, roughness: 0.9 });

  // Torso (hexagonal prism)
  root.add(positionedMesh(new THREE.CylinderGeometry(0.15, 0.22, 0.50, 6), mat, 0, 0.50, 0));
  // Head (octahedron)
  root.add(positionedMesh(new THREE.OctahedronGeometry(0.20, 0), mat, 0, 0.88, 0));
  // Visor strip
  root.add(positionedMesh(new THREE.BoxGeometry(0.30, 0.07, 0.10), visorMat, 0, 0.88, 0.14));

  // Arms — 6-sided cylinders
  const leftArm  = addPivot(root, -0.24, 0.72, pivotGeo(new THREE.CylinderGeometry(0.07, 0.07, 0.32, 6), -0.16), mat);
  const rightArm = addPivot(root,  0.24, 0.72, pivotGeo(new THREE.CylinderGeometry(0.07, 0.07, 0.32, 6), -0.16), mat);

  // Legs — 6-sided cylinders
  const leftLeg  = addPivot(root, -0.10, 0.27, pivotGeo(new THREE.CylinderGeometry(0.10, 0.08, 0.40, 6), -0.20), mat);
  const rightLeg = addPivot(root,  0.10, 0.27, pivotGeo(new THREE.CylinderGeometry(0.10, 0.08, 0.40, 6), -0.20), mat);

  return { root, leftArm, rightArm, leftLeg, rightLeg };
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

function buildGround(): THREE.Mesh {
  const geo = new THREE.CircleGeometry(3.5, 32);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x002a1a, roughness: 0.95 });
  return new THREE.Mesh(geo, mat);
}

function disposeMeshTree(obj: THREE.Object3D): void {
  const disposedMaterials = new Set<THREE.Material>();
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material as THREE.Material];
      for (const m of mats) {
        if (!disposedMaterials.has(m)) {
          m.dispose();
          disposedMaterials.add(m);
        }
      }
    }
  });
}
