/**
 * WalkingDemo — Procedural low-poly characters with sinusoidal walk cycles.
 *
 * Creates 3 distinct low-poly humanoid models that orbit the centre of a
 * game-style arena, animating their limbs each frame. Used by OBJDebugPanel
 * to showcase animated models without requiring external GLB files.
 *
 * Debug-only — not in the main game code path.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CharacterIndex = 0 | 1 | 2;

export class WalkingDemo {
  private readonly scene: THREE.Scene;
  private readonly characters: WalkingCharacter[];
  private readonly ground: THREE.Mesh;
  private readonly gridHelper: THREE.GridHelper;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.ground = buildGround();
    this.scene.add(this.ground);

    this.gridHelper = new THREE.GridHelper(6, 16, 0x00ff88, 0x004422);
    this.gridHelper.position.y = 0.001;
    this.scene.add(this.gridHelper);

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

  /** Show only one character (0=Robot, 1=Alien, 2=Warrior). */
  showOnly(index: CharacterIndex): void {
    this.characters.forEach((c, i) => c.setVisible(i === index));
  }

  /** Show all characters. */
  showAll(): void {
    this.characters.forEach((c) => c.setVisible(true));
  }

  dispose(): void {
    this.scene.remove(this.ground);
    this.scene.remove(this.gridHelper);
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
    if (!this.root.visible) return;

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

  setVisible(visible: boolean): void {
    this.root.visible = visible;
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

// Robot — angular, blue/metallic with glowing visor
function buildRobot(): CharacterParts {
  const root    = new THREE.Group();
  const mat     = new THREE.MeshStandardMaterial({ color: 0x2266cc, metalness: 0.8, roughness: 0.2 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x112244, metalness: 0.5, roughness: 0.4 });
  const eyeMat  = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff2200, emissiveIntensity: 0.8 });

  // Torso (box)
  root.add(positionedMesh(new THREE.BoxGeometry(0.40, 0.50, 0.24), mat, 0, 0.52, 0));
  // Chest panel detail
  root.add(positionedMesh(new THREE.BoxGeometry(0.22, 0.20, 0.02), darkMat, 0, 0.52, 0.13));
  // Head (box)
  root.add(positionedMesh(new THREE.BoxGeometry(0.32, 0.28, 0.28), mat, 0, 0.86, 0));
  // Visor (glowing eye strip)
  root.add(positionedMesh(new THREE.BoxGeometry(0.24, 0.08, 0.02), eyeMat, 0, 0.87, 0.15));
  // Antenna
  root.add(positionedMesh(new THREE.BoxGeometry(0.03, 0.12, 0.03), darkMat, 0.06, 1.08, 0));

  // Arms — pivot at shoulder (y=0.72), geometry offset down
  const leftArm  = addPivot(root, -0.28, 0.72, pivotGeo(new THREE.BoxGeometry(0.13, 0.38, 0.13), -0.19), mat);
  const rightArm = addPivot(root,  0.28, 0.72, pivotGeo(new THREE.BoxGeometry(0.13, 0.38, 0.13), -0.19), mat);

  // Legs — pivot at hip (y=0.28), geometry offset down
  const leftLeg  = addPivot(root, -0.11, 0.28, pivotGeo(new THREE.BoxGeometry(0.16, 0.42, 0.16), -0.21), mat);
  const rightLeg = addPivot(root,  0.11, 0.28, pivotGeo(new THREE.BoxGeometry(0.16, 0.42, 0.16), -0.21), mat);

  return { root, leftArm, rightArm, leftLeg, rightLeg };
}

// Alien — organic, low-poly icosahedra/octahedra, green with large eyes
function buildAlien(): CharacterParts {
  const root    = new THREE.Group();
  const mat     = new THREE.MeshStandardMaterial({ color: 0x44ff88, roughness: 0.5, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x002211, roughness: 0.9 });
  const eyeMat  = new THREE.MeshStandardMaterial({ color: 0xffdd00, emissive: 0xffaa00, emissiveIntensity: 0.6 });

  // Torso (octahedron, y-stretched)
  const torso = new THREE.Mesh(new THREE.OctahedronGeometry(0.30, 0), mat);
  torso.scale.y = 1.5;
  torso.position.set(0, 0.50, 0);
  root.add(torso);

  // Neck
  root.add(positionedMesh(new THREE.CylinderGeometry(0.08, 0.12, 0.12, 5), mat, 0, 0.81, 0));

  // Head (icosahedron = very low-poly sphere, squashed)
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), mat);
  head.scale.y = 1.2;
  head.position.set(0, 0.97, 0);
  root.add(head);

  // Big alien eyes (yellow glowing)
  root.add(positionedMesh(new THREE.SphereGeometry(0.08, 6, 4), eyeMat, -0.10, 1.00, 0.18));
  root.add(positionedMesh(new THREE.SphereGeometry(0.08, 6, 4), eyeMat,  0.10, 1.00, 0.18));
  // Eye pupils
  root.add(positionedMesh(new THREE.SphereGeometry(0.04, 5, 3), darkMat, -0.10, 1.00, 0.25));
  root.add(positionedMesh(new THREE.SphereGeometry(0.04, 5, 3), darkMat,  0.10, 1.00, 0.25));

  // Arms — tapered 4-sided cylinders
  const leftArm  = addPivot(root, -0.30, 0.68, pivotGeo(new THREE.CylinderGeometry(0.05, 0.10, 0.38, 4), -0.19), mat);
  const rightArm = addPivot(root,  0.30, 0.68, pivotGeo(new THREE.CylinderGeometry(0.05, 0.10, 0.38, 4), -0.19), mat);

  // Legs — 4-sided cylinders
  const leftLeg  = addPivot(root, -0.11, 0.30, pivotGeo(new THREE.CylinderGeometry(0.10, 0.05, 0.44, 4), -0.22), mat);
  const rightLeg = addPivot(root,  0.11, 0.30, pivotGeo(new THREE.CylinderGeometry(0.10, 0.05, 0.44, 4), -0.22), mat);

  return { root, leftArm, rightArm, leftLeg, rightLeg };
}

// Warrior — hexagonal armour, orange/gold with battle visor
function buildWarrior(): CharacterParts {
  const root      = new THREE.Group();
  const mat       = new THREE.MeshStandardMaterial({ color: 0xff8822, roughness: 0.3, metalness: 0.7 });
  const darkMat   = new THREE.MeshStandardMaterial({ color: 0x331100, roughness: 0.8 });
  const visorMat  = new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xff8800, emissiveIntensity: 0.5 });
  const beltMat   = new THREE.MeshStandardMaterial({ color: 0x553311, roughness: 0.6, metalness: 0.3 });

  // Torso (hexagonal prism)
  root.add(positionedMesh(new THREE.CylinderGeometry(0.18, 0.24, 0.52, 6), mat, 0, 0.50, 0));
  // Belt
  root.add(positionedMesh(new THREE.CylinderGeometry(0.22, 0.20, 0.08, 6), beltMat, 0, 0.27, 0));
  // Shoulder pads
  root.add(positionedMesh(new THREE.CylinderGeometry(0.14, 0.10, 0.10, 6), mat, -0.28, 0.72, 0));
  root.add(positionedMesh(new THREE.CylinderGeometry(0.14, 0.10, 0.10, 6), mat,  0.28, 0.72, 0));
  // Head (octahedron with flat top)
  root.add(positionedMesh(new THREE.OctahedronGeometry(0.22, 0), mat, 0, 0.89, 0));
  // Helmet ridge
  root.add(positionedMesh(new THREE.CylinderGeometry(0.04, 0.04, 0.20, 5), mat, 0, 1.06, 0));
  // Visor strip (glowing gold)
  root.add(positionedMesh(new THREE.BoxGeometry(0.32, 0.08, 0.05), visorMat, 0, 0.89, 0.16));
  // Dark face plate under visor
  root.add(positionedMesh(new THREE.BoxGeometry(0.24, 0.12, 0.04), darkMat, 0, 0.82, 0.17));

  // Arms — 6-sided cylinders
  const leftArm  = addPivot(root, -0.26, 0.72, pivotGeo(new THREE.CylinderGeometry(0.08, 0.08, 0.34, 6), -0.17), mat);
  const rightArm = addPivot(root,  0.26, 0.72, pivotGeo(new THREE.CylinderGeometry(0.08, 0.08, 0.34, 6), -0.17), mat);

  // Legs — 6-sided cylinders with boots
  const leftLeg  = addPivot(root, -0.11, 0.27, pivotGeo(new THREE.CylinderGeometry(0.11, 0.09, 0.42, 6), -0.21), mat);
  const rightLeg = addPivot(root,  0.11, 0.27, pivotGeo(new THREE.CylinderGeometry(0.11, 0.09, 0.42, 6), -0.21), mat);

  return { root, leftArm, rightArm, leftLeg, rightLeg };
}

// ---------------------------------------------------------------------------
// Scene helpers
// ---------------------------------------------------------------------------

function buildGround(): THREE.Mesh {
  const geo = new THREE.CircleGeometry(3.5, 32);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x001a0d,
    roughness: 0.95,
    metalness: 0.0,
  });
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
