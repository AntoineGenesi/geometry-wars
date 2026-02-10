import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildChevron3D } from '../../utils/GeometryBuilder';

// Pre-allocated temp for zero GC
const _stealthDelta = { u: 0, v: 0 };

/**
 * StealthStalker - Suicide chaser that gets DIMMER as it nears the player.
 *
 * Bright at distance so the player can see it coming, but as it closes in
 * it fades to near-invisibility. Very hard to spot at close range. The
 * dangerous one -- you see it approaching but lose track of it up close.
 *
 * Spawns only at higher difficulty tiers (Hard+, wave 8+) since this is
 * a genuinely challenging enemy to deal with.
 *
 * Brightness is a smooth function of UV distance to the player:
 *   - Far (>0.35 UV): bright (emissive 1.8)
 *   - Close (<0.08 UV): very dim but not invisible (emissive 0.05)
 *   - Smooth cubic interpolation between
 *
 * Color: cold violet-blue (0x6633cc)
 */

/** UV distance thresholds for brightness ramp */
const FAR_DIST = 0.35;
const CLOSE_DIST = 0.08;
/** Emissive intensity at far/close range */
const BRIGHT_EMISSIVE = 1.8;
const DIM_EMISSIVE = 0.05;

export class StealthStalker extends BaseEnemy {
  private currentSpeed: number;
  private readonly maxSpeed: number = 0.06;
  private readonly speedIncreaseRate: number = 0.0015;

  constructor(surfaceU: number, surfaceV: number) {
    // health=3, score=40, geoms=3, speed=0.2, radius=0.26
    super(surfaceU, surfaceV, 3, 40, 3, 0.2, 0.26);
    this.currentSpeed = 0.025;
    this.baseTypeName = 'stealth_stalker';

    this.createMesh();
  }

  private createMesh(): void {
    // Chevron/arrow shape -- stealthy predator, cold violet-blue
    this.mesh = buildChevron3D(0.3, 0.18, 0x6633cc, 0.03, 0.02);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Accelerate toward player
    this.currentSpeed = Math.min(this.maxSpeed, this.currentSpeed + this.speedIncreaseRate * dt);

    // Direction to player
    _stealthDelta.u = playerU - this.surfacePosition.u;
    _stealthDelta.v = playerV - this.surfacePosition.v;
    const dist = Math.sqrt(
      _stealthDelta.u * _stealthDelta.u +
      _stealthDelta.v * _stealthDelta.v
    );

    if (dist > 0.001) {
      const dirU = _stealthDelta.u / dist;
      const dirV = _stealthDelta.v / dist;

      this.surfacePosition.u += dirU * this.currentSpeed * dt;
      this.surfacePosition.v += dirV * this.currentSpeed * dt;

      this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
      this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));
    }

    // Update brightness based on distance to player
    this.updateBrightness(dist);
  }

  /** Smoothly interpolate emissive intensity: bright far away, dim up close. */
  private updateBrightness(distToPlayer: number): void {
    if (!this.cachedMaterials) return;

    // Normalize distance to 0..1 range (0 = close, 1 = far)
    const t = Math.max(0, Math.min(1, (distToPlayer - CLOSE_DIST) / (FAR_DIST - CLOSE_DIST)));

    // Smooth cubic easing (smoothstep) for natural falloff
    const smooth = t * t * (3 - 2 * t);

    // Direct mapping: 0 = close (dim), 1 = far (bright)
    const intensity = DIM_EMISSIVE + smooth * (BRIGHT_EMISSIVE - DIM_EMISSIVE);

    for (let i = 0; i < this.cachedMaterials.length; i++) {
      this.cachedMaterials[i].emissiveIntensity = intensity;
    }
  }
}
