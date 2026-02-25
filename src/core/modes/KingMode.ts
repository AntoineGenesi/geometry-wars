import * as THREE from 'three';
import type { BaseEnemy } from '../../entities/enemies/BaseEnemy';
import type { IGameMode, GameModeContext, ModeHUDData } from './IGameMode';

/**
 * King of the Hill mode.
 * Safe zones appear on the surface. Player earns bonus score while inside.
 * Zone moves periodically.
 */
export class KingMode implements IGameMode {
  readonly name = 'King';
  readonly description = 'Dominate the safe zone for bonus points. Zone moves every 15s.';
  readonly icon = '👑';

  // Zone state
  private zoneU: number = 0.5;
  private zoneV: number = 0.5;
  private zoneRadiusUV: number = 0.12; // UV-space radius for gameplay detection
  private zoneRadiusWorld: number = 2.5; // World-space ring radius for visibility
  private zoneTimer: number = 15; // seconds until zone moves
  private readonly zoneDuration = 15;

  // Visual
  private zoneMesh: THREE.Mesh | null = null;
  private zoneColor = new THREE.Color(0x00ffff);

  // Scoring
  private inZone = false;
  private readonly zoneScoreMultiplier = 2.5;

  // Pre-allocated temp vectors
  private static readonly _tempVec3 = new THREE.Vector3();

  onStart(context: GameModeContext): void {
    // Spawn initial zone at random location
    this.moveZone(context);
    this.createZoneVisual(context);
  }

  onFixedUpdate(dt: number, context: GameModeContext): void {
    // Update zone timer
    this.zoneTimer -= dt;
    if (this.zoneTimer <= 0) {
      this.moveZone(context);
      this.zoneTimer = this.zoneDuration;
    }

    // Check if player is in zone
    const playerU = context.player.surfaceU;
    const playerV = context.player.surfaceV;
    const distU = this.wrappedDistance(playerU, this.zoneU, context.surface.wrapsU);
    const distV = this.wrappedDistance(playerV, this.zoneV, context.surface.wrapsV);
    const distSq = distU * distU + distV * distV;
    this.inZone = distSq <= this.zoneRadiusUV * this.zoneRadiusUV;

    // Update zone visual
    this.updateZoneVisual(context);
  }

  onRender(_dt: number, _context: GameModeContext): void {
    // Visual updates already done in onFixedUpdate
  }

  onEnemyKilled(_enemy: BaseEnemy, _context: GameModeContext): number {
    // Bonus multiplier if player is in the zone
    return this.inZone ? this.zoneScoreMultiplier : 1.0;
  }

  getScore(context: GameModeContext): number {
    return context.player.score;
  }

  isGameOver(context: GameModeContext): boolean {
    return context.player.lives <= 0;
  }

  getHUDOverlay(_context: GameModeContext): ModeHUDData | null {
    if (this.inZone) {
      return {
        primary: `ZONE BONUS: ${this.zoneScoreMultiplier}x`,
        primaryColor: '#00ffff',
      };
    } else {
      const timeLeft = Math.ceil(this.zoneTimer);
      return {
        secondary: `Zone moves in: ${timeLeft}s`,
      };
    }
  }

  dispose(context: GameModeContext): void {
    if (this.zoneMesh) {
      context.scene.remove(this.zoneMesh);
      this.zoneMesh.geometry.dispose();
      (this.zoneMesh.material as THREE.Material).dispose();
      this.zoneMesh = null;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private moveZone(context: GameModeContext): void {
    // Pick random location on surface
    this.zoneU = Math.random();
    this.zoneV = Math.random();

    // Wrap/clamp to surface bounds
    if (context.surface.wrapsU) {
      this.zoneU = this.zoneU % 1.0;
    } else {
      this.zoneU = Math.max(0.1, Math.min(0.9, this.zoneU));
    }
    if (context.surface.wrapsV) {
      this.zoneV = this.zoneV % 1.0;
    } else {
      this.zoneV = Math.max(0.1, Math.min(0.9, this.zoneV));
    }
  }

  private createZoneVisual(context: GameModeContext): void {
    // Adapt ring size to surface dimensions: use ~25% of surface radius for good visibility
    const geo = context.surface.mesh.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    if (geo.boundingSphere) {
      this.zoneRadiusWorld = Math.max(1.0, geo.boundingSphere.radius * 0.25);
    }
    // Create a glowing ring on the surface
    const geometry = new THREE.RingGeometry(this.zoneRadiusWorld * 0.75, this.zoneRadiusWorld, 48);
    const material = new THREE.MeshBasicMaterial({
      color: this.zoneColor,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false, // Always render on top — prevents z-fighting with surface
    });
    this.zoneMesh = new THREE.Mesh(geometry, material);
    this.zoneMesh.renderOrder = 10; // Render after surface
    context.scene.add(this.zoneMesh);
  }

  private updateZoneVisual(context: GameModeContext): void {
    if (!this.zoneMesh) return;

    // Get surface point at zone location
    const point = context.surface.getPoint(this.zoneU, this.zoneV);
    this.zoneMesh.position.copy(point.position);

    // Orient to surface
    const up = KingMode._tempVec3.copy(point.normal);
    this.zoneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);

    // Pulsing animation
    const pulse = 1.0 + 0.15 * Math.sin(Date.now() * 0.003);
    this.zoneMesh.scale.setScalar(pulse);

    // Color change when zone is about to move
    if (this.zoneTimer < 3) {
      const flash = Math.sin(Date.now() * 0.01) * 0.5 + 0.5;
      (this.zoneMesh.material as THREE.MeshBasicMaterial).color.lerpColors(
        this.zoneColor,
        new THREE.Color(0xff0000),
        flash
      );
    } else {
      (this.zoneMesh.material as THREE.MeshBasicMaterial).color.copy(this.zoneColor);
    }

    // Opacity based on player distance
    const opacity = this.inZone ? 0.6 : 0.4;
    (this.zoneMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  /**
   * Calculate wrapped distance in UV space accounting for surface topology.
   */
  private wrappedDistance(a: number, b: number, wraps: boolean): number {
    if (!wraps) return Math.abs(a - b);
    const d = Math.abs(a - b);
    return Math.min(d, 1.0 - d);
  }
}
