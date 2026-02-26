/**
 * FastArrowBehavior — fires a fast yellow projectile with straight trajectory.
 *
 * Higher damage, no arc, 6× faster than SlowArrow. Hard to dodge.
 * Visual: elongated yellow/orange capsule with Z-axis scale for motion blur.
 *
 * Debug-only — not part of the main game code path.
 */

import * as THREE from 'three';
import type { AttackBehavior, AttackType } from './AttackBehavior';
import type { GLBCharacterEnemy } from '../GLBCharacterEnemy';
import { Projectile } from './Projectile';

const FAST_ARROW_DAMAGE = 3;
const FAST_ARROW_SPEED = 18.0; // world units / second (6× slow arrow)
const FAST_ARROW_LIFETIME = 3.0; // seconds before auto-expiry
const FAST_ARROW_HIT_RADIUS = 1.0; // world units
const FIRE_DELAY_MS = 250; // quick release

export class FastArrowBehavior implements AttackBehavior {
  readonly name = 'fast-arrow';
  readonly range = 0.55; // UV units — fires from very long range
  readonly cooldown = 2.0; // seconds

  private cooldownTimer = 0;
  private activeProjectiles: Projectile[] = [];

  isReady(): boolean {
    return this.cooldownTimer <= 0;
  }

  execute(
    character: GLBCharacterEnemy,
    playerPos: THREE.Vector3,
    scene: THREE.Scene,
    _onPlayerHit: (damage: number, type: AttackType) => void,
  ): void {
    this.cooldownTimer = this.cooldown;
    character.char.playOneShot('attack');

    const originPos = character.worldPosition.clone();

    setTimeout(() => {
      if (!character.alive) return;
      const proj = new Projectile({
        origin: originPos,
        target: playerPos.clone(),
        speed: FAST_ARROW_SPEED,
        mesh: this._buildMesh(originPos, playerPos),
        hitRadius: FAST_ARROW_HIT_RADIUS,
        lifetime: FAST_ARROW_LIFETIME,
        scene,
        arc: false, // straight trajectory
      });
      this.activeProjectiles.push(proj);
    }, FIRE_DELAY_MS);
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
    onPlayerHit: (damage: number, type: AttackType) => void,
  ): void {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
    }

    for (let i = this.activeProjectiles.length - 1; i >= 0; i--) {
      const proj = this.activeProjectiles[i];
      const expired = proj.update(dt);

      if (!expired && proj.isHitting(playerPos)) {
        onPlayerHit(FAST_ARROW_DAMAGE, 'fast-arrow');
        proj.hit();
        this.activeProjectiles.splice(i, 1);
      } else if (expired) {
        this.activeProjectiles.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const proj of this.activeProjectiles) {
      proj.hit();
    }
    this.activeProjectiles = [];
  }

  private _buildMesh(origin: THREE.Vector3, target: THREE.Vector3): THREE.Mesh {
    // Elongated capsule oriented toward target (motion-blur look)
    const dir = new THREE.Vector3().subVectors(target, origin).normalize();

    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.12, 0.8, 4, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffaa00,
        emissive: new THREE.Color(0xff6600),
        emissiveIntensity: 2.0,
      }),
    );

    // Orient capsule along travel direction (capsule default axis is +Y)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    return mesh;
  }
}
