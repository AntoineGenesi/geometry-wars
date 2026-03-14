import * as THREE from 'three';
import { BaseEnemy } from './BaseEnemy';
import { Entity } from '../../core/Entity';
import { buildCircle3D } from '../../utils/GeometryBuilder';

export type WellType = 'blue' | 'red';

export class GravityWell extends BaseEnemy {
  private gravityActive = false;
  private consumedCount = 0;
  private readonly maxConsumed = 10;
  private readonly pullRadius = 2.0;
  private readonly pullStrength = 5;
  private readonly lethalRadius = 0.5; // Red wells kill within this radius
  private pulsePhase = 0;
  private readonly wellType: WellType;
  private radiusRing: THREE.Mesh | null = null;
  private dangerRing: THREE.Mesh | null = null;

  public static onDetonate: ((position: THREE.Vector3, score: number) => void) | null = null;
  public static onApplyGridForce: ((u: number, v: number, strength: number) => void) | null = null;
  public static onPullPlayer: ((deltaU: number, deltaV: number) => void) | null = null;
  public static onWellActivated: (() => void) | null = null;

  constructor(surfaceU: number = 0.5, surfaceV: number = 0.5, wellType: WellType = 'blue') {
    super(surfaceU, surfaceV, 15, 500, 2, 0.00625, 0.4);

    this.wellType = wellType;
    this.createMesh();
  }

  private createMesh(): void {
    const group = new THREE.Group();

    // Determine color based on well type
    const coreColor = this.wellType === 'blue' ? 0x4488ff : 0xff4444;

    // Create concentric 3D circles/rings with depth
    const rings = [0.4, 0.3, 0.2, 0.1];
    for (const radius of rings) {
      const ring = buildCircle3D(radius, 24, coreColor, radius * 0.25, 0.012);
      group.add(ring);
    }

    // Add pull radius indicator ring (translucent, additive)
    const radiusGeometry = new THREE.RingGeometry(this.pullRadius * 0.95, this.pullRadius, 48);
    const radiusMaterial = new THREE.MeshBasicMaterial({
      color: coreColor,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.radiusRing = new THREE.Mesh(radiusGeometry, radiusMaterial);
    this.radiusRing.visible = false; // Hidden until activated
    group.add(this.radiusRing);

    // Red wells get a danger zone inner ring
    if (this.wellType === 'red') {
      const dangerGeometry = new THREE.RingGeometry(this.lethalRadius * 0.9, this.lethalRadius, 32);
      const dangerMaterial = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      this.dangerRing = new THREE.Mesh(dangerGeometry, dangerMaterial);
      this.dangerRing.visible = false; // Hidden until activated
      group.add(this.dangerRing);
    }

    this.mesh = group;
  }

  updateBehavior(dt: number, playerU: number, playerV: number): void {
    // Slow drift
    if (!this.gravityActive) {
      const driftAngle = Date.now() * 0.0001;
      this.surfacePosition.u += Math.cos(driftAngle) * this.speed * dt;
      this.surfacePosition.v += Math.sin(driftAngle) * this.speed * dt;
    }

    // Pulsating scale effect
    this.pulsePhase += dt * 2;
    const scale = 1 + Math.sin(this.pulsePhase) * 0.2;
    if (this.mesh) {
      this.mesh.scale.setScalar(scale);
    }

    // Pulse radius rings when active
    if (this.gravityActive && this.radiusRing) {
      const ringPulse = 0.15 + Math.sin(this.pulsePhase * 1.5) * 0.1;
      (this.radiusRing.material as THREE.MeshBasicMaterial).opacity = ringPulse;

      if (this.dangerRing) {
        const dangerPulse = 0.3 + Math.sin(this.pulsePhase * 2) * 0.15;
        (this.dangerRing.material as THREE.MeshBasicMaterial).opacity = dangerPulse;
      }
    }

    // Apply grid distortion when active
    if (this.gravityActive && GravityWell.onApplyGridForce) {
      GravityWell.onApplyGridForce(this.surfacePosition.u, this.surfacePosition.v, this.pullStrength);
    }

    // Apply pull force on player when active
    if (this.gravityActive && GravityWell.onPullPlayer) {
      const deltaU = this.surfacePosition.u - playerU;
      const deltaV = this.surfacePosition.v - playerV;
      const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

      if (distance < this.pullRadius && distance > 0.01) {
        // Smooth force falloff: strength * (1 - distance/pullRadius)^2
        const falloff = 1 - distance / this.pullRadius;
        const strength = this.pullStrength * falloff * falloff * dt;

        // Calculate pull direction (toward well)
        const dirU = deltaU / distance;
        const dirV = deltaV / distance;

        // Apply force via callback
        GravityWell.onPullPlayer(dirU * strength, dirV * strength);
      }
    }

    // Check for detonation
    if (this.consumedCount >= this.maxConsumed) {
      this.detonate();
    }
  }

  computeMovementDirection(dt: number, _playerWorldPos: THREE.Vector3): THREE.Vector3 | null {
    // Update timers and state (important: updateBehavior isn't called when walker is active)
    this.pulsePhase += dt * 2;
    const scale = 1 + Math.sin(this.pulsePhase) * 0.2;
    if (this.mesh) {
      this.mesh.scale.setScalar(scale);
    }

    // Pulse radius rings when active
    if (this.gravityActive && this.radiusRing) {
      const ringPulse = 0.15 + Math.sin(this.pulsePhase * 1.5) * 0.1;
      (this.radiusRing.material as THREE.MeshBasicMaterial).opacity = ringPulse;

      if (this.dangerRing) {
        const dangerPulse = 0.3 + Math.sin(this.pulsePhase * 2) * 0.15;
        (this.dangerRing.material as THREE.MeshBasicMaterial).opacity = dangerPulse;
      }
    }

    // Check for detonation
    if (this.consumedCount >= this.maxConsumed) {
      this.detonate();
    }

    // Movement: slow drift when inactive, stationary when active
    if (!this.gravityActive) {
      const driftAngle = Date.now() * 0.0001;
      const direction = new THREE.Vector3(
        Math.cos(driftAngle),
        0,
        Math.sin(driftAngle)
      ).normalize();

      // Use tangent frame from walker to convert to surface-aligned direction
      if (this.walker) {
        const frame = this.walker.getTangentFrame();
        const tangentDir = frame.tangent.clone().multiplyScalar(direction.x);
        const bitangentDir = frame.bitangent.clone().multiplyScalar(direction.z);
        return tangentDir.add(bitangentDir).normalize().multiplyScalar(this.speed * this.walkerSpeedScale);
      }
    }

    return null; // Stationary when gravity is active
  }

  takeDamage(amount: number): void {
    super.takeDamage(amount);

    // Activate on first hit
    if (!this.gravityActive) {
      this.gravityActive = true;

      // Show radius rings
      if (this.radiusRing) {
        this.radiusRing.visible = true;
      }
      if (this.dangerRing) {
        this.dangerRing.visible = true;
      }

      // Change color to indicate activation (brighter/magenta)
      if (this.mesh) {
        this.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            if (mat.color && mat.emissive) {
              mat.color.setHex(0xff00ff);
              mat.emissive.setHex(0xff00ff);
            }
          }
        });
      }

      // Audio callback
      if (GravityWell.onWellActivated) {
        GravityWell.onWellActivated();
      }
    }
  }

  // Pull nearby entities
  public pullEntity(entity: Entity): void {
    if (!this.gravityActive) return;

    const deltaU = this.surfacePosition.u - entity.surfacePosition.u;
    const deltaV = this.surfacePosition.v - entity.surfacePosition.v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    if (distance < this.pullRadius && distance > 0.01) {
      // Apply force toward gravity well
      const strength = this.pullStrength * (1 - distance / this.pullRadius);
      const dirU = deltaU / distance;
      const dirV = deltaV / distance;

      // Modify entity's surface position (game would need to handle this)
      entity.surfacePosition.u += dirU * strength * 0.016;
      entity.surfacePosition.v += dirV * strength * 0.016;
    }
  }

  // Called when an enemy is consumed
  public consumeEnemy(scoreValue: number): void {
    this.consumedCount++;
    this.scoreValue += scoreValue;
    this.geomCount += 1;

    // Visual feedback
    this.pulsePhase = 0;
    const flash = 1.5;
    if (this.mesh) {
      this.mesh.scale.setScalar(flash);
    }
  }

  private detonate(): void {
    if (!this.alive) return;

    // Calculate final score based on consumed enemies
    const finalScore = this.scoreValue + this.consumedCount * 50;

    if (GravityWell.onDetonate) {
      GravityWell.onDetonate(this.position.clone(), finalScore);
    }

    this.die();
  }

  public isGravityActive(): boolean {
    return this.gravityActive;
  }

  public getPullRadius(): number {
    return this.pullRadius;
  }

  public getWellType(): WellType {
    return this.wellType;
  }

  public getLethalRadius(): number {
    return this.lethalRadius;
  }

  /**
   * Check if the given position (in UV space) is within lethal range for red wells.
   * Returns true only for red wells when distance < lethalRadius.
   */
  public isInLethalZone(u: number, v: number): boolean {
    if (this.wellType !== 'red' || !this.gravityActive) {
      return false;
    }

    const deltaU = this.surfacePosition.u - u;
    const deltaV = this.surfacePosition.v - v;
    const distance = Math.sqrt(deltaU * deltaU + deltaV * deltaV);

    return distance < this.lethalRadius;
  }
}
