import * as THREE from 'three';
import type { Surface } from '../surfaces/Surface';

// Pre-allocated temp vectors — zero GC per frame
const _tempInverseRot = new THREE.Quaternion();
const _tempLocalPos = new THREE.Vector3();
const _tempDir = new THREE.Vector3();

/** Maximum number of simultaneous shockwaves. */
const MAX_WAVES = 4;

interface WaveSlot {
  /** Impact position in surface-local space (inverse of worldRotation applied). */
  localImpact: THREE.Vector3;
  /** Ring inner radius at the start of this frame. */
  prevRadius: number;
  /** Ring outer radius at the end of this frame. */
  currentRadius: number;
  /** Maximum radius before the wave stops. */
  maxRadius: number;
  /** Expand speed in world units per second. */
  speed: number;
  /** Force magnitude applied to vertices in the ring band. */
  force: number;
  /** Whether this slot is currently active. */
  active: boolean;
}

/**
 * SurfaceShockwave — propagating deformation ring over surface grid vertices.
 *
 * Unlike `Surface.applyForce()` which instantly kicks all vertices in a radius,
 * the shockwave expands outward at a fixed speed and only applies force to
 * vertices that the ring front is currently crossing.
 *
 * Usage:
 *   const sw = new SurfaceShockwave(surface);
 *   sw.spawn(explosionWorldPos, 15, 20, 8);
 *   // each frame:
 *   sw.update(dt);
 */
export class SurfaceShockwave {
  private readonly surface: Surface;
  private readonly waves: WaveSlot[];

  constructor(surface: Surface) {
    this.surface = surface;
    this.waves = [];
    for (let i = 0; i < MAX_WAVES; i++) {
      this.waves.push({
        localImpact: new THREE.Vector3(),
        prevRadius: 0,
        currentRadius: 0,
        maxRadius: 0,
        speed: 0,
        force: 0,
        active: false,
      });
    }
  }

  /**
   * Spawn a new propagating shockwave from a world-space position.
   *
   * @param worldPos   - Explosion centre in world space
   * @param maxRadius  - Stop applying force beyond this world-space distance
   * @param speed      - Ring expansion speed in world units / second
   * @param force      - Peak impulse applied to vertices in the ring band
   */
  spawn(worldPos: THREE.Vector3, maxRadius: number, speed: number, force: number): void {
    // Find an inactive slot
    let slot: WaveSlot | null = null;
    for (const wave of this.waves) {
      if (!wave.active) {
        slot = wave;
        break;
      }
    }
    if (!slot) return; // Pool exhausted — drop new wave (rare)

    // Convert worldPos to surface-local space.
    // restPosition on each SpringVertex is stored in local (pre-rotation) space,
    // so we must un-rotate the impact point before comparing distances.
    _tempInverseRot.copy(this.surface.worldRotation).invert();
    _tempLocalPos.copy(worldPos).applyQuaternion(_tempInverseRot);

    slot.localImpact.copy(_tempLocalPos);
    slot.prevRadius = 0;
    slot.currentRadius = 0;
    slot.maxRadius = maxRadius;
    slot.speed = speed;
    slot.force = force;
    slot.active = true;
  }

  /**
   * Advance all active waves by `dt` seconds.
   * Vertices whose rest-position distance from the impact point falls within
   * the ring band [prevRadius, currentRadius) receive an outward impulse.
   */
  update(dt: number): void {
    for (const wave of this.waves) {
      if (!wave.active) continue;

      // Advance ring front
      wave.prevRadius = wave.currentRadius;
      wave.currentRadius += wave.speed * dt;

      // Wave has fully passed the mesh — deactivate
      if (wave.prevRadius >= wave.maxRadius) {
        wave.active = false;
        continue;
      }

      const prevR = wave.prevRadius;
      const currR = Math.min(wave.currentRadius, wave.maxRadius);

      for (const spring of this.surface.gridVertexSprings) {
        const dist = spring.restPosition.distanceTo(wave.localImpact);
        // Only kick vertices the ring front is currently crossing
        if (dist >= prevR && dist < currR && dist > 0.0001) {
          // Falloff: full force at ring inner edge, zero at maxRadius
          const falloff = 1.0 - dist / wave.maxRadius;
          _tempDir.copy(spring.restPosition).sub(wave.localImpact).normalize();
          spring.velocity.addScaledVector(_tempDir, wave.force * falloff);
        }
      }
    }
  }

  /** Number of currently active waves (useful for tests and debug). */
  getActiveWaveCount(): number {
    let count = 0;
    for (const wave of this.waves) {
      if (wave.active) count++;
    }
    return count;
  }
}
