import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { buildPrismFrame } from '../../utils/GeometryBuilder';

/**
 * Phaser - Star-shaped enemy that phases in and out of visibility.
 *
 * Cycles between visible (2s) and invisible (1s). Can only be damaged
 * when visible. When visible, charges directly at the player. When
 * invisible, repositions to a flanking angle. Creates unpredictable
 * attack vectors.
 *
 * Visual: 6-pointed star tube-frame, white-blue color, fades in/out.
 */

// Pre-allocated temps for zero GC
const _phaserDelta = { u: 0, v: 0 };

const enum PhaserPhase {
  Visible,
  FadingOut,
  Invisible,
  FadingIn,
}

export class Phaser extends BaseEnemy {
  private phase: PhaserPhase = PhaserPhase.FadingIn;
  private phaseTimer: number = 0;

  // Phase timing
  private readonly visibleDuration: number = 2.0;
  private readonly invisibleDuration: number = 1.0;
  private readonly fadeDuration: number = 0.3;

  // Movement
  private readonly chargeSpeed: number = 0.09;
  private readonly repositionSpeed: number = 0.06;

  // Flanking target (set when entering invisible phase)
  private flankTargetU: number = 0;
  private flankTargetV: number = 0;

  // Invulnerability flag
  private _invulnerable: boolean = true;

  constructor(surfaceU: number, surfaceV: number) {
    // health=3, score=35, geoms=3, speed=0.09, radius=0.25
    super(surfaceU, surfaceV, 3, 35, 3, 0.09, 0.25);
    this.baseTypeName = 'phaser';

    this.createMesh();
  }

  private createMesh(): void {
    // 6-pointed star tube-frame - white-blue
    const edges = this.buildStarEdges(0.25, 0.12, 6, 0.04);
    this.mesh = buildPrismFrame(edges, 0x88bbff, 0.02);
  }

  /**
   * Build edges for an N-pointed star prism with depth.
   * Alternates between outer and inner radius vertices.
   */
  private buildStarEdges(
    outerR: number,
    innerR: number,
    points: number,
    halfDepth: number
  ): Array<[THREE.Vector3, THREE.Vector3]> {
    const edges: Array<[THREE.Vector3, THREE.Vector3]> = [];
    const totalVerts = points * 2;

    const frontVerts: THREE.Vector3[] = [];
    const backVerts: THREE.Vector3[] = [];

    for (let i = 0; i < totalVerts; i++) {
      const angle = (i * Math.PI * 2) / totalVerts - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;

      frontVerts.push(new THREE.Vector3(x, y, halfDepth));
      backVerts.push(new THREE.Vector3(x, y, -halfDepth));
    }

    // Connect vertices to form star outline (front, back, and depth)
    for (let i = 0; i < totalVerts; i++) {
      const next = (i + 1) % totalVerts;
      edges.push([frontVerts[i], frontVerts[next]]);
      edges.push([backVerts[i], backVerts[next]]);
      // Depth connectors at outer points only
      if (i % 2 === 0) {
        edges.push([frontVerts[i], backVerts[i]]);
      }
    }

    return edges;
  }

  /** Override takeDamage to block damage when invisible/invulnerable. */
  takeDamage(amount: number, attackerId: number = -1): void {
    if (this._invulnerable) return;
    super.takeDamage(amount, attackerId);
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    this.phaseTimer += dt;

    switch (this.phase) {
      case PhaserPhase.FadingIn: {
        // Fade in over fadeDuration
        const progress = Math.min(1, this.phaseTimer / this.fadeDuration);
        this.setVisibility(progress);

        if (progress >= 1) {
          this.phase = PhaserPhase.Visible;
          this.phaseTimer = 0;
          this._invulnerable = false;
        }
        break;
      }

      case PhaserPhase.Visible: {
        // Charge at player
        this._invulnerable = false;
        this.setVisibility(1.0);
        this.chargeToward(playerU, playerV, this.chargeSpeed, dt);

        if (this.phaseTimer >= this.visibleDuration) {
          this.phase = PhaserPhase.FadingOut;
          this.phaseTimer = 0;
          this._invulnerable = true;

          // Pick a flanking position: offset from player at a random angle
          const flankAngle = Math.random() * Math.PI * 2;
          const flankDist = 0.15 + Math.random() * 0.15;
          this.flankTargetU = Math.max(0, Math.min(1,
            playerU + Math.cos(flankAngle) * flankDist
          ));
          this.flankTargetV = Math.max(0, Math.min(1,
            playerV + Math.sin(flankAngle) * flankDist
          ));
        }
        break;
      }

      case PhaserPhase.FadingOut: {
        // Fade out
        const progress = Math.min(1, this.phaseTimer / this.fadeDuration);
        this.setVisibility(1 - progress);
        this._invulnerable = true;

        if (progress >= 1) {
          this.phase = PhaserPhase.Invisible;
          this.phaseTimer = 0;
        }
        break;
      }

      case PhaserPhase.Invisible: {
        // Invisible - reposition to flank
        this._invulnerable = true;
        this.setVisibility(0);
        this.chargeToward(this.flankTargetU, this.flankTargetV, this.repositionSpeed, dt);

        if (this.phaseTimer >= this.invisibleDuration) {
          this.phase = PhaserPhase.FadingIn;
          this.phaseTimer = 0;
        }
        break;
      }
    }

    // Gentle spin
    if (this.mesh) {
      this.mesh.rotation.z += 1.5 * dt;
    }
  }

  /** Move toward a UV target at given speed. */
  private chargeToward(targetU: number, targetV: number, speed: number, dt: number): void {
    _phaserDelta.u = targetU - this.surfacePosition.u;
    _phaserDelta.v = targetV - this.surfacePosition.v;
    const dist = Math.sqrt(_phaserDelta.u * _phaserDelta.u + _phaserDelta.v * _phaserDelta.v);

    if (dist > 0.005) {
      const dirU = _phaserDelta.u / dist;
      const dirV = _phaserDelta.v / dist;
      this.surfacePosition.u += dirU * speed * dt;
      this.surfacePosition.v += dirV * speed * dt;

      this.surfacePosition.u = Math.max(0, Math.min(1, this.surfacePosition.u));
      this.surfacePosition.v = Math.max(0, Math.min(1, this.surfacePosition.v));
    }
  }

  /** Set visual opacity via emissive intensity and material opacity. */
  private setVisibility(v: number): void {
    if (!this.cachedMaterials) return;
    for (let i = 0; i < this.cachedMaterials.length; i++) {
      const mat = this.cachedMaterials[i];
      mat.opacity = v;
      mat.transparent = true;
      mat.emissiveIntensity = 0.4 * v;
    }
  }

  computeMovementDirection(dt: number, playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    this.phaseTimer += dt;

    // Gentle spin (same as updateBehavior)
    if (this.mesh) {
      this.mesh.rotation.z += 1.5 * dt;
    }

    let targetWorldPos: THREE.Vector3;

    switch (this.phase) {
      case PhaserPhase.FadingIn: {
        const progress = Math.min(1, this.phaseTimer / this.fadeDuration);
        this.setVisibility(progress);

        if (progress >= 1) {
          this.phase = PhaserPhase.Visible;
          this.phaseTimer = 0;
          this._invulnerable = false;
        }
        return null; // No movement while fading in
      }

      case PhaserPhase.Visible: {
        this._invulnerable = false;
        this.setVisibility(1.0);

        if (this.phaseTimer >= this.visibleDuration) {
          this.phase = PhaserPhase.FadingOut;
          this.phaseTimer = 0;
          this._invulnerable = true;

          // Pick flanking position - offset from player at random angle
          const frame = this.walker!.getTangentFrame();
          const flankAngle = Math.random() * Math.PI * 2;
          const flankDist = 4.5 + Math.random() * 4.5; // ~0.15 UV * 30 = 4.5 world units
          this.flankTargetU = Math.cos(flankAngle) * flankDist;
          this.flankTargetV = Math.sin(flankAngle) * flankDist;
        }

        // Charge at player
        targetWorldPos = playerWorldPos;
        break;
      }

      case PhaserPhase.FadingOut: {
        const progress = Math.min(1, this.phaseTimer / this.fadeDuration);
        this.setVisibility(1 - progress);
        this._invulnerable = true;

        if (progress >= 1) {
          this.phase = PhaserPhase.Invisible;
          this.phaseTimer = 0;
        }
        return null; // No movement while fading out
      }

      case PhaserPhase.Invisible: {
        this._invulnerable = true;
        this.setVisibility(0);

        if (this.phaseTimer >= this.invisibleDuration) {
          this.phase = PhaserPhase.FadingIn;
          this.phaseTimer = 0;
        }

        // Reposition to flank
        const frame = this.walker!.getTangentFrame();
        targetWorldPos = playerWorldPos.clone()
          .addScaledVector(frame.tangent, this.flankTargetU)
          .addScaledVector(frame.bitangent, this.flankTargetV);
        break;
      }
    }

    // Move toward target
    if (targetWorldPos) {
      const dir = targetWorldPos.clone().sub(this.walker!.position);
      const dist = dir.length();

      if (dist > 0.15) { // ~0.005 UV * 30 = 0.15 world units
        const speed = this.phase === PhaserPhase.Invisible ? this.repositionSpeed : this.chargeSpeed;
        dir.normalize().multiplyScalar(speed * this.walkerSpeedScale);
        return dir;
      }
    }

    return null;
  }
}
