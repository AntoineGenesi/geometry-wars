/**
 * RadiusSlamBehavior — AoE explosion: slam animation + expanding ring effect.
 *
 * Telegraphed (0.8s wind-up before ring appears), so the player can dodge.
 * The expanding ring is a torus that grows outward and fades over 0.5s.
 *
 * Debug-only — not part of the main game code path.
 */

import * as THREE from 'three';
import type { AttackBehavior, AttackType } from './AttackBehavior';
import type { GLBCharacterEnemy } from '../GLBCharacterEnemy';

const SLAM_DAMAGE = 1;
const SLAM_RADIUS_UV = 0.2; // UV units — radius of AoE damage zone
const SLAM_RADIUS_WORLD = 2.0; // world units (reduced from 3.5 — was too generous)
const SLAM_DELAY_MS = 800; // wind-up before impact
const RING_LIFETIME = 0.6; // seconds the ring animation lasts
const RING_MAX_SCALE = 4.0; // maximum torus scale expansion

interface SlamRing {
  mesh: THREE.Mesh;
  life: number;
  scene: THREE.Scene;
}

export class RadiusSlamBehavior implements AttackBehavior {
  readonly name = 'slam';
  readonly range = 0.2; // UV units
  readonly cooldown = 3.0; // seconds (telegraphed, longer cooldown)

  private cooldownTimer = 0;
  private activeRings: SlamRing[] = [];

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
    character.char.playOneShot('attack');

    const characterPos = character.worldPosition.clone();

    setTimeout(() => {
      if (!character.alive) return;
      // AoE damage check in world space
      const dist = characterPos.distanceTo(playerPos);
      if (dist < SLAM_RADIUS_WORLD) {
        onPlayerHit(SLAM_DAMAGE, 'slam');
      }
      this._spawnRing(characterPos, character.worldPosition, scene);
    }, SLAM_DELAY_MS);
  }

  update(dt: number): void {
    if (this.cooldownTimer > 0) {
      this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
    }

    // Animate expanding ring
    for (let i = this.activeRings.length - 1; i >= 0; i--) {
      const ring = this.activeRings[i];
      ring.life -= dt;
      const t = 1 - ring.life / RING_LIFETIME;
      const scale = 1 + t * (RING_MAX_SCALE - 1);
      const opacity = 1 - t;
      ring.mesh.scale.setScalar(scale);
      (ring.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      if (ring.life <= 0) {
        ring.scene.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        (ring.mesh.material as THREE.Material).dispose();
        this.activeRings.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const ring of this.activeRings) {
      ring.scene.remove(ring.mesh);
      ring.mesh.geometry.dispose();
      (ring.mesh.material as THREE.Material).dispose();
    }
    this.activeRings = [];
  }

  private _spawnRing(
    impactPos: THREE.Vector3,
    currentCharPos: THREE.Vector3,
    scene: THREE.Scene,
  ): void {
    // Torus lies flat oriented toward sphere center (surface normal direction)
    const mesh = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.12, 8, 32),
      new THREE.MeshBasicMaterial({
        color: 0xff6600,
        transparent: true,
        opacity: 1.0,
        side: THREE.DoubleSide,
      }),
    );

    mesh.position.copy(impactPos);

    // Orient the torus so its "hole" faces outward along the sphere surface normal
    // (i.e., the ring lies flat on the surface). The normal at any sphere point
    // is just normalize(position).
    const normal = impactPos.clone().normalize();
    // Default torus normal is +Z. We want torus normal = sphere surface normal.
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    scene.add(mesh);
    this.activeRings.push({ mesh, life: RING_LIFETIME, scene });
  }
}

// Export the UV radius constant so CharacterBehaviorSystem can use it
export { SLAM_RADIUS_UV };
