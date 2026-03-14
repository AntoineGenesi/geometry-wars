import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildDiamond3D } from '../../utils/GeometryBuilder';

// Pre-allocated temp for zero GC
const _approachDelta = { u: 0, v: 0 };

/**
 * ApproachGlow - Suicide chaser that gets brighter as it nears the player.
 *
 * Dim/subtle at distance, progressively brighter as it closes in. At close
 * range: very bright with full bloom. Acts as a visual "warning system" --
 * brightness = urgency. Easier variant that spawns in mid-game waves.
 *
 * Brightness is a smooth function of UV distance to the player:
 *   - Far (>0.4 UV): dim (emissive 0.1)
 *   - Close (<0.05 UV): blazing (emissive 2.0)
 *   - Smooth cubic interpolation between
 *
 * Color: warm amber (0xffaa22)
 */

/** UV distance thresholds for brightness ramp */
const FAR_DIST = 0.4;
const CLOSE_DIST = 0.05;
/** Emissive intensity at far/close range */
const DIM_EMISSIVE = 0.1;
const BRIGHT_EMISSIVE = 2.0;

export class ApproachGlow extends BaseEnemy {
  private currentSpeed: number;
  private readonly maxSpeed: number = 0.055;
  private readonly speedIncreaseRate: number = 0.002;

  constructor(surfaceU: number, surfaceV: number) {
    // health=3, score=25, geoms=2, speed=0.2, radius=0.28
    super(surfaceU, surfaceV, 3, 25, 2, 0.2, 0.28);
    this.currentSpeed = 0.02;
    this.baseTypeName = 'approach_glow';

    this.createMesh();
  }

  private createMesh(): void {
    // Diamond shape, warm amber color -- starts dim
    const size = 0.25;
    this.mesh = buildDiamond3D(size, 0xffaa22, size * 0.7, 0.022);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Accelerate toward player
    this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.speedIncreaseRate * dt);

    // Direction to player
    _approachDelta.u = playerU - this.surfacePosition.u;
    _approachDelta.v = playerV - this.surfacePosition.v;
    const dist = Math.sqrt(
      _approachDelta.u * _approachDelta.u +
      _approachDelta.v * _approachDelta.v
    );

    if (dist > 0.001) {
      const dirU = _approachDelta.u / dist;
      const dirV = _approachDelta.v / dist;

      this.surfacePosition.u += dirU * this.currentSpeed * dt;
      this.surfacePosition.v += dirV * this.currentSpeed * dt;

      this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
      this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));
    }

    // Update brightness based on distance to player
    this.updateBrightness(dist);
  }

  /** Smoothly interpolate emissive intensity: dim far away, bright up close. */
  private updateBrightness(distToPlayer: number): void {
    if (!this.cachedMaterials) return;

    // Normalize distance to 0..1 range (0 = close, 1 = far)
    const t = Math.max(0, Math.min(1, (distToPlayer - CLOSE_DIST) / (FAR_DIST - CLOSE_DIST)));

    // Smooth cubic easing (smoothstep) for natural falloff
    const smooth = t * t * (3 - 2 * t);

    // Invert: 0 at far, 1 at close
    const brightness = 1 - smooth;

    const intensity = DIM_EMISSIVE + brightness * (BRIGHT_EMISSIVE - DIM_EMISSIVE);

    for (let i = 0; i < this.cachedMaterials.length; i++) {
      this.cachedMaterials[i].emissiveIntensity = intensity;
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    // Accelerate toward player
    this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.speedIncreaseRate * dt);

    // Direction to player in world space
    _approachDelta.u = playerWorldPos.x - this.walker!.position.x;
    _approachDelta.v = playerWorldPos.y - this.walker!.position.y;
    const distX = playerWorldPos.x - this.walker!.position.x;
    const distY = playerWorldPos.y - this.walker!.position.y;
    const distZ = playerWorldPos.z - this.walker!.position.z;
    const dist = Math.sqrt(distX * distX + distY * distY + distZ * distZ);

    if (dist > 0.03) { // ~0.001 UV * 30 = 0.03 world units
      // Update brightness based on distance
      this.updateBrightness(dist / this.walkerSpeedScale); // Convert to UV-equivalent distance

      // Compute direction and scale by world speed
      const dir = new THREE.Vector3(distX, distY, distZ);
      dir.normalize().multiplyScalar(this.currentSpeed * this.walkerSpeedScale);
      return dir;
    }

    return null;
  }
}
