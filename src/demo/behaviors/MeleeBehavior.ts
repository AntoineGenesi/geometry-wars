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
const SHOCKWAVE_LIFETIME = 0.35; // seconds
const SHOCKWAVE_MAX_SCALE = 2.5; // torus expansion factor

interface ShockwaveEffect {
  mesh: THREE.Mesh;
  life: number;
  scene: THREE.Scene;
}

export class MeleeBehavior implements AttackBehavior {
  readonly name = 'melee';
  readonly range = 0.06; // UV units
  readonly cooldown = 1.5; // seconds

  private cooldownTimer = 0;
  private shockwaves: ShockwaveEffect[] = [];

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
      if (dist < 1.5) { // world-space threshold ≈ touching (reduced from 2.5)
        onPlayerHit(MELEE_DAMAGE, 'melee');
        // Surface shockwave ring at impact point (character's position on surface)
        this._spawnShockwave(character.worldPosition, scene);
      }
    }, SWING_DELAY_MS);
  }

  update(dt: number): void {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
    }

    // Animate + clean up shockwave rings
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt;
      const t = 1 - sw.life / SHOCKWAVE_LIFETIME;
      const scale = 1 + t * (SHOCKWAVE_MAX_SCALE - 1);
      const opacity = 1 - t;
      sw.mesh.scale.setScalar(scale);
      (sw.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      if (sw.life <= 0) {
        sw.scene.remove(sw.mesh);
        sw.mesh.geometry.dispose();
        (sw.mesh.material as THREE.Material).dispose();
        this.shockwaves.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const sw of this.shockwaves) {
      sw.scene.remove(sw.mesh);
      sw.mesh.geometry.dispose();
      (sw.mesh.material as THREE.Material).dispose();
    }
    this.shockwaves = [];
  }

  private _spawnShockwave(impactPos: THREE.Vector3, scene: THREE.Scene): void {
    // Flat torus ring lying on the sphere surface at impact point
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.08, 8, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff2200,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.copy(impactPos);
    // Orient so the ring faces outward along the sphere surface normal
    const normal = impactPos.clone().normalize();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    scene.add(mesh);
    this.shockwaves.push({ mesh, life: SHOCKWAVE_LIFETIME, scene });
  }
}
