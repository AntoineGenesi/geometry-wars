import * as THREE from 'three';
import type { BaseEnemy } from '../../entities/enemies/BaseEnemy';
import type { IGameMode, GameModeContext, ModeHUDData } from './IGameMode';

/**
 * Sniper mode.
 * Limited ammo pool, no auto-regeneration.
 * Each kill drops ammo pickups.
 * Headshots (direct center hits) give bonus score.
 */
export class SniperMode implements IGameMode {
  readonly name = 'Sniper';
  readonly description = 'Limited ammo. Precision kills drop ammo. No bombs allowed.';
  readonly icon = '🎯';

  // Ammo system
  private ammo: number = 30; // Starting ammo
  private readonly maxAmmo = 100;

  // Ammo pickups spawned on kill
  private ammoPickups: Array<{
    position: THREE.Vector3;
    u: number;
    v: number;
    mesh: THREE.Mesh;
    value: number;
  }> = [];

  // Pre-allocated temp vectors
  private static readonly _tempVec3 = new THREE.Vector3();

  onStart(context: GameModeContext): void {
    // Disable bombs in sniper mode
    context.player.bombs = 0;

    // Override weapon manager ammo (if needed)
    // WeaponManager already tracks ammo, but we need custom behavior
    console.log('[SniperMode] Started with', this.ammo, 'ammo');
  }

  onFixedUpdate(dt: number, context: GameModeContext): void {
    // Check for ammo pickup collection
    const playerPos = context.player.mesh.position;
    const collectRadius = 0.5; // world space

    for (let i = this.ammoPickups.length - 1; i >= 0; i--) {
      const pickup = this.ammoPickups[i];
      const dist = playerPos.distanceTo(pickup.position);
      if (dist < collectRadius) {
        // Collect ammo
        this.ammo = Math.min(this.maxAmmo, this.ammo + pickup.value);
        context.scene.remove(pickup.mesh);
        pickup.mesh.geometry.dispose();
        (pickup.mesh.material as THREE.Material).dispose();
        this.ammoPickups.splice(i, 1);
      }
    }

    // Animate pickups (bobbing + rotation)
    const time = Date.now() * 0.001;
    for (const pickup of this.ammoPickups) {
      const point = context.surface.getPoint(pickup.u, pickup.v);
      pickup.position.copy(point.position);
      pickup.position.addScaledVector(point.normal, 0.3 + 0.1 * Math.sin(time * 3));
      pickup.mesh.position.copy(pickup.position);
      pickup.mesh.rotation.y = time * 2;
    }
  }

  onRender(_dt: number, _context: GameModeContext): void {
    // Visual updates already done in onFixedUpdate
  }

  onEnemyKilled(enemy: BaseEnemy, context: GameModeContext): number {
    // Spawn ammo pickups (1-3 per kill)
    const dropCount = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < dropCount; i++) {
      this.spawnAmmoPickup(enemy, context);
    }

    // Headshot detection (simplified: just 1.0x for now, could add collision radius check)
    // For now, all kills are 1.0x. Could enhance with hit location detection.
    return 1.0;
  }

  getScore(context: GameModeContext): number {
    return context.player.score;
  }

  isGameOver(context: GameModeContext): boolean {
    // Game over if out of lives OR out of ammo with no pickups available
    if (context.player.lives <= 0) return true;
    if (this.ammo <= 0 && this.ammoPickups.length === 0) return true;
    return false;
  }

  getHUDOverlay(_context: GameModeContext): ModeHUDData | null {
    const ammoColor = this.ammo <= 5 ? '#ff0000' : this.ammo <= 15 ? '#ffaa00' : '#00ff00';
    const warning = this.ammo === 0 ? 'OUT OF AMMO!' : undefined;

    return {
      primary: `AMMO: ${this.ammo}`,
      primaryColor: ammoColor,
      warning,
      warningColor: '#ff0000',
    };
  }

  dispose(context: GameModeContext): void {
    // Clean up all ammo pickups
    for (const pickup of this.ammoPickups) {
      context.scene.remove(pickup.mesh);
      pickup.mesh.geometry.dispose();
      (pickup.mesh.material as THREE.Material).dispose();
    }
    this.ammoPickups = [];
  }

  /**
   * Get current ammo count (for weapon system integration).
   */
  getAmmo(): number {
    return this.ammo;
  }

  /**
   * Consume ammo when firing (called externally by weapon system).
   */
  consumeAmmo(amount: number): boolean {
    if (this.ammo >= amount) {
      this.ammo -= amount;
      return true;
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private spawnAmmoPickup(enemy: BaseEnemy, context: GameModeContext): void {
    const u = enemy.surfacePosition.u;
    const v = enemy.surfacePosition.v;
    const point = context.surface.getPoint(u, v);

    // Create pickup mesh
    const geometry = new THREE.OctahedronGeometry(0.2, 0);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.8,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(point.position);
    context.scene.add(mesh);

    // Random ammo value (1-3)
    const value = Math.floor(Math.random() * 3) + 1;

    this.ammoPickups.push({
      position: point.position.clone(),
      u,
      v,
      mesh,
      value,
    });
  }
}
