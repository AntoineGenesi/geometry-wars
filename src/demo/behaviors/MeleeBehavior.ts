/**
 * MeleeBehavior — short-range melee attack.
 *
 * Plays the 'attack-melee' animation, then checks if the player is still
 * within range and deals damage. Creates a brief red sphere flash at impact.
 *
 * Debug-only — not part of the main game code path.
 */

import * as THREE from 'three';
import type { AttackBehavior, AttackType } from './AttackBehavior';
import type { GLBCharacterEnemy } from '../GLBCharacterEnemy';

const MELEE_DAMAGE = 2;
const SWING_DELAY_MS = 400;
const FLASH_LIFETIME = 0.3; // seconds

interface FlashEffect {
  mesh: THREE.Mesh;
  life: number;
  scene: THREE.Scene;
}

export class MeleeBehavior implements AttackBehavior {
  readonly name = 'melee';
  readonly range = 0.06; // UV units
  readonly cooldown = 1.5; // seconds

  private cooldownTimer = 0;
  private flashes: FlashEffect[] = [];

  isReady(): boolean {
    return this.cooldownTimer <= 0;
  }

  execute(
    character: GLBCharacterEnemy,
    playerPos: THREE.Vector3,
    scene: THREE.Scene,
    onPlayerHit: (damage: number, type: AttackType) => void,
  ): void {
    this.cooldownTimer = this.cooldown;
    character.char.playOneShot('attack-melee');

    setTimeout(() => {
      if (!character.alive) return;
      // Re-check distance at impact time
      const dist = character.worldPosition.distanceTo(playerPos);
      if (dist < 2.5) { // world-space threshold ≈ touching
        onPlayerHit(MELEE_DAMAGE, 'melee');
        // Red impact flash at midpoint between character and player
        const flashPos = new THREE.Vector3()
          .addVectors(character.worldPosition, playerPos)
          .multiplyScalar(0.5);
        this._spawnFlash(flashPos, scene);
      }
    }, SWING_DELAY_MS);
  }

  update(dt: number): void {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
    }

    // Animate + clean up flash effects
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i];
      flash.life -= dt;
      const t = 1 - flash.life / FLASH_LIFETIME;
      const opacity = 1 - t;
      const mat = flash.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = opacity;
      flash.mesh.scale.setScalar(1 + t * 2); // expand outward
      if (flash.life <= 0) {
        flash.scene.remove(flash.mesh);
        flash.mesh.geometry.dispose();
        mat.dispose();
        this.flashes.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const flash of this.flashes) {
      flash.scene.remove(flash.mesh);
      flash.mesh.geometry.dispose();
      (flash.mesh.material as THREE.Material).dispose();
    }
    this.flashes = [];
  }

  private _spawnFlash(pos: THREE.Vector3, scene: THREE.Scene): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xff2200,
        transparent: true,
        opacity: 1.0,
      }),
    );
    mesh.position.copy(pos);
    scene.add(mesh);
    this.flashes.push({ mesh, life: FLASH_LIFETIME, scene });
  }
}
