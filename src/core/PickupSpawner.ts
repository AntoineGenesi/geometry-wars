import * as THREE from 'three';
import { SuperStateType } from '../weapons/SuperState';
import { SuperStatePickup } from '../weapons/SuperStatePickup';
import { WeaponPickup, getRandomWeaponType } from '../weapons/WeaponPickup';
import { BuffPickup, getRandomBuffType } from '../weapons/BuffPickup';
import { BuffPickupNew } from '../buffs/BuffPickupNew';
import { BuffManager } from '../buffs/BuffManager';
import { CompanionPickup, getRandomCompanionType } from '../entities/Companion';

/**
 * PickupSpawner
 *
 * Manages spawning of all pickup types (weapons, buffs, companions, super states)
 * on enemy deaths. Previously embedded in main.ts collision callback.
 */
export class PickupSpawner {
  private static readonly SUPER_STATE_TYPES = [
    SuperStateType.QuadFire,
    SuperStateType.SplitFire,
    SuperStateType.ReverseFire,
    SuperStateType.Missile,
    SuperStateType.Magnet,
    SuperStateType.TrailBomb,
    SuperStateType.Shield,
  ];

  // Drop rates (configurable)
  superStateDropRate = 0.05; // 5% chance
  weaponDropRate = 0.08; // 8% chance
  oldBuffDropRate = 0.05; // 5% (legacy weapon-buff system)
  companionDropRate = 0.05; // 5% chance

  private scene: THREE.Scene;
  private readonly mapSizeScaleFactor: number;

  // Active pickup arrays
  superPickups: SuperStatePickup[] = [];
  weaponPickups: WeaponPickup[] = [];
  buffPickups: BuffPickup[] = [];
  newBuffPickups: BuffPickupNew[] = [];
  companionPickups: CompanionPickup[] = [];

  constructor(scene: THREE.Scene, mapSizeScaleFactor: number = 1.0) {
    this.scene = scene;
    this.mapSizeScaleFactor = mapSizeScaleFactor;
  }

  /**
   * Roll for pickups on enemy death. Called from collision handler.
   */
  spawnPickupsOnEnemyDeath(u: number, v: number): void {
    // Clamp v away from poles [0,1] to avoid world-space singularity near peanut/sphere poles.
    // Near v=0 or v=1 all positions converge to a point, causing false positive collision detections.
    v = Math.max(0.02, Math.min(0.98, v));
    // ~5% chance to spawn a super state pickup on enemy death
    if (Math.random() < this.superStateDropRate) {
      const type = PickupSpawner.SUPER_STATE_TYPES[
        Math.floor(Math.random() * PickupSpawner.SUPER_STATE_TYPES.length)
      ];
      const pickup = new SuperStatePickup(type, u, v, this.mapSizeScaleFactor);
      this.scene.add(pickup.mesh);
      this.superPickups.push(pickup);
    }

    // ~8% chance to spawn a weapon pickup on enemy death
    if (Math.random() < this.weaponDropRate) {
      const wpnType = getRandomWeaponType();
      const wpnPickup = new WeaponPickup(wpnType, u, v, this.mapSizeScaleFactor);
      this.scene.add(wpnPickup.mesh);
      this.weaponPickups.push(wpnPickup);
    }

    // ~5% chance to spawn a buff pickup on enemy death (old weapon-buff system)
    if (Math.random() < this.oldBuffDropRate) {
      const bType = getRandomBuffType();
      const bPickup = new BuffPickup(bType, u, v, this.mapSizeScaleFactor);
      this.scene.add(bPickup.mesh);
      this.buffPickups.push(bPickup);
    }

    // Roll for new stackable buff pickup drop
    const droppedBuff = BuffManager.rollBuffDrop();
    if (droppedBuff) {
      const nbPickup = new BuffPickupNew(droppedBuff, u, v, this.mapSizeScaleFactor);
      this.scene.add(nbPickup.mesh);
      this.newBuffPickups.push(nbPickup);
    }

    // ~5% chance to spawn a companion pickup on enemy death
    if (Math.random() < this.companionDropRate) {
      const cType = getRandomCompanionType();
      const cPickup = new CompanionPickup(cType, u, v, this.mapSizeScaleFactor);
      this.scene.add(cPickup.mesh);
      this.companionPickups.push(cPickup);
    }
  }

  /**
   * Get all active pickups for disposal/cleanup
   */
  getAllPickups() {
    return {
      super: this.superPickups,
      weapons: this.weaponPickups,
      buffs: this.buffPickups,
      newBuffs: this.newBuffPickups,
      companions: this.companionPickups,
    };
  }

  /**
   * Dispose all pickups (for level cleanup)
   */
  dispose(): void {
    const all = this.getAllPickups();

    for (const p of all.super) {
      if (p.mesh) this.scene.remove(p.mesh);
      p.dispose();
    }
    for (const p of all.weapons) {
      if (p.mesh) this.scene.remove(p.mesh);
      p.dispose();
    }
    for (const p of all.buffs) {
      if (p.mesh) this.scene.remove(p.mesh);
      p.dispose();
    }
    for (const p of all.newBuffs) {
      if (p.mesh) this.scene.remove(p.mesh);
      p.dispose();
    }
    for (const p of all.companions) {
      if (p.mesh) this.scene.remove(p.mesh);
      p.dispose();
    }

    this.superPickups = [];
    this.weaponPickups = [];
    this.buffPickups = [];
    this.newBuffPickups = [];
    this.companionPickups = [];
  }
}
