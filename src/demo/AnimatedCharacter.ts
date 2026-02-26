/**
 * AnimatedCharacter — GLB character that walks on a Surface using UV coordinates.
 *
 * Loads a Kenney mini character GLB and positions it on any Surface using
 * UV-based movement (same system as game enemies). Uses THREE.AnimationMixer
 * for skeletal animation playback with crossfade state transitions.
 *
 * Debug-only — used by AnimatedCharacterDemo and OBJDebugPanel sphere mode.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Surface } from '../surfaces/Surface';

// Pre-allocated temporaries — avoid allocations in hot update() path
const _lookDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _back = new THREE.Vector3();
const _up = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AnimatedCharacterConfig {
  /** Path to the GLB file, e.g. '/characters/knight.glb' */
  glbPath: string;
  /** Surface to walk on */
  surface: Surface;
  /** Initial UV coordinates [0, 1] */
  startU: number;
  startV: number;
  /** Walk speed in UV units / second */
  walkSpeed: number;
  /** Visual scale (Kenney chars are ~2 units tall, use 0.2–0.4 for a radius-2 sphere) */
  scale: number;
  /** Rate of heading wander (radians / second squared) */
  headingWanderRate?: number;
  /** Three.js scene to add the root to */
  scene: THREE.Scene;
}

// ---------------------------------------------------------------------------
// AnimatedCharacter
// ---------------------------------------------------------------------------

export class AnimatedCharacter {
  /** Root group added to the scene — position/quaternion updated each frame */
  readonly root: THREE.Group;

  // UV state
  u: number;
  v: number;
  private heading: number;
  private wanderVelocity = 0;

  // Surface reference
  private readonly surface: Surface;
  private readonly walkSpeed: number;
  private readonly headingWanderRate: number;

  // Animation state
  private mixer: THREE.AnimationMixer | null = null;
  private clips = new Map<string, THREE.AnimationClip>();
  private currentAction: THREE.AnimationAction | null = null;
  private state: 'idle' | 'walk' = 'idle';
  private loaded = false;

  constructor(config: AnimatedCharacterConfig) {
    this.u = config.startU;
    this.v = config.startV;
    this.heading = Math.random() * Math.PI * 2;
    this.surface = config.surface;
    this.walkSpeed = config.walkSpeed;
    this.headingWanderRate = config.headingWanderRate ?? 0.8;

    this.root = new THREE.Group();
    this.root.scale.setScalar(config.scale);
    config.scene.add(this.root);

    this.loadGLB(config.glbPath);
  }

  private loadGLB(path: string): void {
    const loader = new GLTFLoader();
    loader.load(
      path,
      (gltf) => {
        this.root.add(gltf.scene);

        // Index clips by lowercase name for robust lookup
        for (const clip of gltf.animations) {
          this.clips.set(clip.name, clip);
          this.clips.set(clip.name.toLowerCase(), clip);
        }

        this.mixer = new THREE.AnimationMixer(gltf.scene);
        this.loaded = true;

        // Start walking immediately
        this.playClip('walk');
        this.state = 'walk';
      },
      undefined,
      (err) => {
        console.warn(`AnimatedCharacter: failed to load ${path}`, err);
      },
    );
  }

  /**
   * Play a named animation clip. Tries the exact name, then lowercase.
   * Crossfades from the current action if one is playing.
   */
  private playClip(name: string): void {
    if (!this.mixer) return;
    const clip = this.clips.get(name) ?? this.clips.get(name.toLowerCase());
    if (!clip) return;

    const action = this.mixer.clipAction(clip);
    action.reset();

    if (this.currentAction && this.currentAction !== action) {
      action.crossFadeFrom(this.currentAction, 0.2, true);
    }

    action.play();
    this.currentAction = action;
  }

  /**
   * Transition to a new animation state with crossfade.
   */
  setState(newState: 'idle' | 'walk'): void {
    if (newState === this.state) return;
    this.state = newState;
    if (!this.loaded) return;
    this.playClip(newState);
  }

  /**
   * Play a named animation once (death, hit reactions, attacks).
   * Does not update this.state — use for one-shot non-looping clips.
   */
  playOneShot(name: string): void {
    if (!this.mixer) return;
    const clip = this.clips.get(name) ?? this.clips.get(name.toLowerCase());
    if (!clip) return;
    const action = this.mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset();
    if (this.currentAction && this.currentAction !== action) {
      action.crossFadeFrom(this.currentAction, 0.15, true);
    }
    action.play();
    this.currentAction = action;
  }

  /**
   * Advance the animation mixer and apply the surface transform without
   * changing UV position. Used by GLBCharacterEnemy which controls movement
   * externally.
   */
  tickExternal(dt: number): void {
    this.mixer?.update(dt);
    if (this.loaded) this.applySurfaceTransform();
  }

  /** Set the heading angle (radians in UV tangent space). Used for directional facing. */
  set headingAngle(val: number) {
    this.heading = val;
  }

  /** Whether the GLB has finished loading. */
  get isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Update animation mixer, advance UV position, and apply surface transform.
   * Call once per frame with the frame delta time in seconds.
   */
  update(dt: number): void {
    // Update skeletal animation
    this.mixer?.update(dt);

    if (!this.loaded) return;

    // Wander heading gradually (noisy walk path, not straight-line)
    this.wanderVelocity += (Math.random() - 0.5) * this.headingWanderRate * dt;
    this.wanderVelocity *= Math.pow(0.8, dt * 60); // dampen
    this.heading += this.wanderVelocity * dt;

    // Move on surface via UV
    const du = Math.cos(this.heading) * this.walkSpeed * dt;
    const dv = Math.sin(this.heading) * this.walkSpeed * dt;
    const moved = this.surface.moveOnSurface(this.u, this.v, du, dv);
    this.u = moved.u;
    this.v = moved.v;

    // Apply position + orientation from surface frame
    this.applySurfaceTransform();
  }

  private applySurfaceTransform(): void {
    const pt = this.surface.getPoint(this.u, this.v);

    // Surface normal = character "up"
    _up.copy(pt.normal).normalize();

    // Look direction = heading-rotated tangentU (forward on surface)
    _lookDir
      .copy(pt.tangentU)
      .multiplyScalar(Math.cos(this.heading))
      .addScaledVector(pt.tangentV, Math.sin(this.heading))
      .normalize();

    // Build orthonormal frame:
    //   right = lookDir × up   (crossVectors(a, b) = a × b)
    //   back  = right × up     (ensures orthogonality)
    _right.crossVectors(_lookDir, _up).normalize();
    _back.crossVectors(_right, _up).normalize();

    // makeBasis(right, up, back):
    //   char +X → right, char +Y → surface normal, char +Z → back (-Z = look dir)
    _matrix.makeBasis(_right, _up, _back);
    this.root.quaternion.setFromRotationMatrix(_matrix);

    // Position feet on surface (tiny epsilon lifts root off surface to avoid z-fighting)
    this.root.position.copy(pt.position).addScaledVector(_up, 0.01);
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) (m as THREE.Material).dispose();
    });
    // Caller is responsible for removing root from scene
  }
}
