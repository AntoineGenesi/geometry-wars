/**
 * SlowArrowBehavior — fires a slow purple projectile with an arc trajectory.
 *
 * On hit: low damage + slow effect callback (visual indicator handled by demo).
 * The projectile has a gentle downward arc (lob trajectory).
 *
 * Debug-only — not part of the main game code path.
 */

import * as THREE from 'three';
import type { AttackBehavior, AttackType } from './AttackBehavior';
import type { GLBCharacterEnemy } from '../GLBCharacterEnemy';
import { Projectile } from './Projectile';

const SLOW_ARROW_DAMAGE = 1;
const SLOW_ARROW_SPEED = 3.0; // world units / second
const SLOW_ARROW_LIFETIME = 8.0; // seconds before auto-expiry
const SLOW_ARROW_HIT_RADIUS = 0.6; // world units (reduced from 1.2 — was too generous)
const FIRE_DELAY_MS = 500; // animation wind-up

export class SlowArrowBehavior implements AttackBehavior {
  readonly name = 'slow-arrow';
  readonly range = 0.35; // UV units
  readonly cooldown = 2.5; // seconds

  private cooldownTimer = 0;
  private activeProjectiles: Projectile[] = [];
  private scene: THREE.Scene | null = null;

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
    this.scene = scene;
    character.char.playOneShot('attack');

    const originPos = character.worldPosition.clone();

    setTimeout(() => {
      if (!character.alive) return;
      const proj = new Projectile({
        origin: originPos,
        target: playerPos.clone(),
        speed: SLOW_ARROW_SPEED,
        mesh: this._buildMesh(),
        hitRadius: SLOW_ARROW_HIT_RADIUS,
        lifetime: SLOW_ARROW_LIFETIME,
        scene,
        arc: true, // lob trajectory
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
        onPlayerHit(SLOW_ARROW_DAMAGE, 'slow-arrow');
        proj.hit();
        this.activeProjectiles.splice(i, 1);
      } else if (expired) {
        this.activeProjectiles.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const proj of this.activeProjectiles) {
      proj.hit(); // removes from scene
    }
    this.activeProjectiles = [];
  }

  getActiveProjectiles(): ReadonlyArray<Projectile> {
    return this.activeProjectiles;
  }

  private _buildMesh(): THREE.Mesh {
    // Glowing purple sphere
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.25, 8, 8),
      new THREE.MeshStandardMaterial({
        color: 0x8800ff,
        emissive: new THREE.Color(0x5500aa),
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.9,
      }),
    );
    return mesh;
  }
}
