/**
 * AnimatedCharacterDemo — Sphere-mode demo scene for OBJDebugPanel.
 *
 * Creates a small sphere (radius 2) and spawns 3 animated GLB characters
 * that walk on its surface using UV-based movement. Used as the "Sphere Demo"
 * mode in OBJDebugPanel (toggled from the flat WalkingDemo).
 *
 * Debug-only — not in the main game code path.
 */

import * as THREE from 'three';
import { SphereSurface } from '../surfaces/SphereSurface';
import { AnimatedCharacter } from './AnimatedCharacter';

// ---------------------------------------------------------------------------
// Demo configuration
// ---------------------------------------------------------------------------

/** Radius of the demo sphere (preview canvas is ~420×380, camera at radius 6) */
const SPHERE_RADIUS = 2;

/** Scale of each character (Kenney mini chars are ~1.8 units unscaled) */
const CHAR_SCALE = 0.45;

/** UV walk speed — covers ~1/4 of the sphere per second */
const WALK_SPEED = 0.08;

/** Starting UV positions: spread evenly around the equator */
const SPAWN_POINTS: Array<{ u: number; v: number }> = [
  { u: 0.1, v: 0.45 },
  { u: 0.4, v: 0.55 },
  { u: 0.7, v: 0.50 },
];

/** Character GLB paths */
const CHAR_PATHS = [
  '/characters/knight.glb',
  '/characters/mage.glb',
  '/characters/warrior.glb',
];

// ---------------------------------------------------------------------------
// AnimatedCharacterDemo
// ---------------------------------------------------------------------------

export class AnimatedCharacterDemo {
  private readonly scene: THREE.Scene;
  private readonly surface: SphereSurface;
  private readonly characters: AnimatedCharacter[] = [];
  private disposed = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Create a small sphere surface for the preview
    this.surface = new SphereSurface({
      radius: SPHERE_RADIUS,
      gridSegmentsU: 12,
      gridSegmentsV: 12,
      surfaceOpacity: 0.85,
    });

    // Reduce grid opacity so characters are more visible
    const gridMat = this.surface.gridMesh.material as THREE.LineBasicMaterial;
    gridMat.opacity = 0.25;

    scene.add(this.surface.group);

    // Spawn characters (async GLB loading — they appear once loaded)
    for (let i = 0; i < SPAWN_POINTS.length; i++) {
      const char = new AnimatedCharacter({
        glbPath: CHAR_PATHS[i % CHAR_PATHS.length],
        surface: this.surface,
        startU: SPAWN_POINTS[i].u,
        startV: SPAWN_POINTS[i].v,
        walkSpeed: WALK_SPEED * (0.8 + i * 0.15),  // slight speed variation
        scale: CHAR_SCALE,
        headingWanderRate: 0.6,
        scene,
      });
      this.characters.push(char);
    }
  }

  /**
   * Call each frame with delta time in seconds.
   * Moves characters and updates their skeletal animations.
   */
  update(dt: number): void {
    if (this.disposed) return;
    // Clamp dt to avoid large steps on tab resume
    const clampedDt = Math.min(dt, 0.05);
    for (const char of this.characters) {
      char.update(clampedDt);
    }
  }

  /**
   * Clean up all Three.js resources.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const char of this.characters) {
      this.scene.remove(char.root);
      char.dispose();
    }
    this.characters.length = 0;

    this.scene.remove(this.surface.group);
    this.surface.dispose();
  }
}
