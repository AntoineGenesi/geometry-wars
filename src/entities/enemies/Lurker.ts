import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildChevron3D } from '../../utils/GeometryBuilder';

// Pre-allocated temp vectors for zero GC
const _lurkerDelta = { u: 0, v: 0 };

/**
 * Lurker - Ambush predator enemy.
 *
 * Sits perfectly still until the player enters detection range, then
 * DASHES at extreme speed directly at the player. After each dash it
 * pauses to recover before dashing again. Glows brighter just before
 * and during a dash.
 *
 * Visual: flat chevron/arrow shape, dark red at rest, bright red on dash.
 */

const enum LurkerState {
  Idle,
  Charging,  // wind-up glow before dash
  Dashing,
  Cooldown,
}

export class Lurker extends BaseEnemy {
  private state: LurkerState = LurkerState.Idle;
  private stateTimer: number = 0;

  // Detection / dash parameters
  private readonly detectionRange: number = 0.3;
  private readonly chargeUpTime: number = 0.4;  // seconds of glow before dash
  private readonly dashSpeed: number = 0.35;     // very fast
  private readonly dashDuration: number = 0.25;  // seconds of dash
  private readonly cooldownTime: number = 1.2;   // seconds before next dash

  // Dash direction (locked when dash starts)
  private dashDirU: number = 0;
  private dashDirV: number = 0;

  // Base emissive intensity for glow effects
  private readonly baseEmissive: number = 0.15;
  private readonly dashEmissive: number = 1.0;

  constructor(surfaceU: number, surfaceV: number) {
    // health=3, score=30, geoms=3, speed=0 (stationary until dash), radius=0.25
    super(surfaceU, surfaceV, 3, 30, 3, 0, 0.25);
    this.baseTypeName = 'lurker';
    this.createMesh();
  }

  private createMesh(): void {
    // Flat chevron/arrow shape - stingray-like ambush predator
    this.mesh = buildChevron3D(0.35, 0.2, 0x880000, 0.03, 0.02);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.stateTimer += dt;

    // Calculate distance to player
    _lurkerDelta.u = playerU - this.surfacePosition.u;
    _lurkerDelta.v = playerV - this.surfacePosition.v;
    const distSq = _lurkerDelta.u * _lurkerDelta.u + _lurkerDelta.v * _lurkerDelta.v;
    const dist = Math.sqrt(distSq);

    switch (this.state) {
      case LurkerState.Idle:
        // Wait for player to enter detection range
        if (dist < this.detectionRange && dist > 0.01) {
          this.state = LurkerState.Charging;
          this.stateTimer = 0;
          // Lock dash direction toward current player position
          this.dashDirU = _lurkerDelta.u / dist;
          this.dashDirV = _lurkerDelta.v / dist;
        }
        break;

      case LurkerState.Charging:
        // Wind-up glow - update dash direction to track player
        if (dist > 0.01) {
          this.dashDirU = _lurkerDelta.u / dist;
          this.dashDirV = _lurkerDelta.v / dist;
        }

        // Animate glow intensity ramp
        this.setEmissiveIntensity(
          this.baseEmissive + (this.dashEmissive - this.baseEmissive) * (this.stateTimer / this.chargeUpTime)
        );

        if (this.stateTimer >= this.chargeUpTime) {
          this.state = LurkerState.Dashing;
          this.stateTimer = 0;
        }
        break;

      case LurkerState.Dashing:
        // Move at extreme speed in locked direction
        this.surfacePosition.u += this.dashDirU * this.dashSpeed * dt;
        this.surfacePosition.v += this.dashDirV * this.dashSpeed * dt;

        // Clamp to surface
        this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
        this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));

        // Full glow during dash
        this.setEmissiveIntensity(this.dashEmissive);

        // Tint to bright red during dash
        this.setColor(0xff2200);

        if (this.stateTimer >= this.dashDuration) {
          this.state = LurkerState.Cooldown;
          this.stateTimer = 0;
          // Revert to dark red
          this.setColor(0x880000);
          this.setEmissiveIntensity(this.baseEmissive);
        }
        break;

      case LurkerState.Cooldown:
        // Sit still, recharging
        // Gentle pulse to show it's alive
        const pulse = 0.5 + 0.5 * Math.sin(this.stateTimer * 4);
        this.setEmissiveIntensity(this.baseEmissive + pulse * 0.1);

        if (this.stateTimer >= this.cooldownTime) {
          this.state = LurkerState.Idle;
          this.stateTimer = 0;
        }
        break;
    }
  }

  /** Set emissive intensity on all cached materials. */
  private setEmissiveIntensity(intensity: number): void {
    if (!this.cachedMaterials) return;
    for (let i = 0; i < this.cachedMaterials.length; i++) {
      this.cachedMaterials[i].emissiveIntensity = intensity;
    }
  }

  /** Set color on all cached materials. */
  private setColor(hex: number): void {
    if (!this.cachedMaterials) return;
    for (let i = 0; i < this.cachedMaterials.length; i++) {
      this.cachedMaterials[i].color.setHex(hex);
      this.cachedMaterials[i].emissive.setHex(hex);
    }
  }
}
