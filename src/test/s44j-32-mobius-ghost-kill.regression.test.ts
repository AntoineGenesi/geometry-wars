/**
 * Regression test for s44j-32 — Mobius strip ghost kill investigation
 *
 * Root cause (from s44h-03): Phaser enemy cycles between visible/invisible states.
 * When invisible, isGhostForPlayer was not set, allowing it to kill the player.
 *
 * Fix (s44h-03): isGhostForPlayer flag added to BaseEnemy. Phaser sets it true
 * during FadingIn, FadingOut, and Invisible phases. CollisionSystem skips them.
 *
 * This test verifies:
 * 1. The s44h-03 fix works specifically on Mobius surface geometry
 * 2. Enemy positions on Mobius are correctly computed (no coordinate mismatch)
 * 3. The Mobius seam wrapping does NOT cause enemies to teleport to the player
 * 4. Ghost enemy (isGhostForPlayer=true) does NOT kill player on Mobius
 * 5. Non-ghost enemy DOES kill player when in contact on Mobius
 * 6. Mobius position continuity at seam (no spurious collision from UV discontinuity)
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Phaser } from '../entities/enemies/Phaser';
import { Wanderer } from '../entities/enemies/Wanderer';
import { CollisionSystem } from '../core/CollisionSystem';
import { Player } from '../entities/Player';
import { ParticleSystem } from '../effects/ParticleSystem';
import { ScreenShake } from '../effects/ScreenShake';
import { MobiusSurface } from '../surfaces/MobiusSurface';

vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(),
    init: vi.fn(),
    resume: vi.fn(),
    muted: false,
  }),
}));

vi.mock('../effects/ParticleSystem', () => ({
  ParticleSystem: vi.fn().mockImplementation(() => ({
    playerDeath: vi.fn(),
    bulletImpact: vi.fn(),
    enemyDeath: vi.fn(),
  })),
}));

vi.mock('../effects/ScreenShake', () => ({
  ScreenShake: vi.fn().mockImplementation(() => ({
    shake: vi.fn(),
  })),
}));

// Helper: create a mock player at a given world position
function mockPlayerAt(pos: THREE.Vector3) {
  return {
    mesh: {
      position: pos.clone(),
      scale: new THREE.Vector3(1, 1, 1),
    },
    canTakeDamage: true,
    alive: true,
    die: vi.fn(),
  } as unknown as Player;
}

// Helper: compute getTransform for Mobius at a given scale
function makeMobiusTransform(surface: MobiusSurface, scaleFactor: number = 1.0) {
  return (u: number, v: number) => {
    const pt = surface.getPoint(u, v);
    if (scaleFactor !== 1.0) {
      pt.position.multiplyScalar(scaleFactor);
    }
    return { position: pt.position, normal: pt.normal, tangent: pt.tangentU, bitangent: pt.tangentV };
  };
}

describe('s44j-32: Mobius strip ghost kill regression', () => {

  describe('Phaser ghost kill fix applies to Mobius surface', () => {
    it('ghost Phaser does NOT kill player even when overlapping on Mobius', () => {
      const surface = new MobiusSurface();
      const getTransform = makeMobiusTransform(surface);

      // Place player at center of Mobius strip
      const playerUV = { u: 0.25, v: 0.5 };
      const playerTransform = getTransform(playerUV.u, playerUV.v);

      const collisionSystem = new CollisionSystem();

      // Create Phaser at exact same 3D position as player
      const phaser = new Phaser(playerUV.u, playerUV.v);
      phaser.isMaterializing = false;
      phaser.isGhostForPlayer = true; // Invisible phase
      // Position at same world location as player (should NOT trigger collision)
      phaser.position.copy(playerTransform.position);

      const mockPlayer = mockPlayerAt(playerTransform.position);
      const mockParticles = { playerDeath: vi.fn(), bulletImpact: vi.fn() } as unknown as ParticleSystem;
      const mockScreenShake = { shake: vi.fn() } as unknown as ScreenShake;

      collisionSystem.checkPlayerEnemyCollisions(
        mockPlayer, [phaser], mockParticles, mockScreenShake, false,
      );

      expect(mockPlayer.die).not.toHaveBeenCalled();
    });

    it('visible Phaser DOES kill player when overlapping on Mobius', () => {
      const surface = new MobiusSurface();
      const getTransform = makeMobiusTransform(surface);

      const playerUV = { u: 0.25, v: 0.5 };
      const playerTransform = getTransform(playerUV.u, playerUV.v);

      const collisionSystem = new CollisionSystem();

      const phaser = new Phaser(playerUV.u, playerUV.v);
      phaser.isMaterializing = false;
      phaser.isGhostForPlayer = false; // Visible
      phaser.position.copy(playerTransform.position);

      const dieFn = vi.fn();
      const mockPlayer = {
        mesh: { position: playerTransform.position.clone(), scale: new THREE.Vector3(1, 1, 1) },
        canTakeDamage: true,
        alive: true,
        die: dieFn,
      } as unknown as Player;

      const mockParticles = { playerDeath: vi.fn(), bulletImpact: vi.fn() } as unknown as ParticleSystem;
      const mockScreenShake = { shake: vi.fn() } as unknown as ScreenShake;

      collisionSystem.checkPlayerEnemyCollisions(
        mockPlayer, [phaser], mockParticles, mockScreenShake, false,
      );

      expect(dieFn).toHaveBeenCalled();
    });

    it('Phaser transitions through correct ghost phases (UV mode path)', () => {
      const phaser = new Phaser(0.5, 0.5);
      phaser.isMaterializing = false;

      // FadingIn: should be ghost
      expect(phaser.isGhostForPlayer).toBe(true);

      // Advance through FadingIn (0.3s) into Visible
      const dt = 0.016;
      let elapsed = 0;
      while (elapsed < 0.35) {
        phaser.updateBehavior(dt, 0.5, 0.5);
        elapsed += dt;
      }
      // Visible: should NOT be ghost
      expect(phaser.isGhostForPlayer).toBe(false);

      // Advance through Visible (2.0s) into FadingOut
      elapsed = 0;
      while (elapsed < 2.1) {
        phaser.updateBehavior(dt, 0.5, 0.5);
        elapsed += dt;
      }
      // FadingOut/Invisible: should be ghost again
      expect(phaser.isGhostForPlayer).toBe(true);
    });
  });

  describe('Mobius surface enemy position correctness', () => {
    it('enemy position on Mobius surface is never NaN or extreme', () => {
      const surface = new MobiusSurface();
      const getTransform = makeMobiusTransform(surface);

      // Test at many positions including seam and edges
      const testPoints = [
        { u: 0.0, v: 0.5 },    // seam at center
        { u: 0.001, v: 0.5 },  // just after seam
        { u: 0.999, v: 0.5 },  // just before seam
        { u: 0.5, v: 0.5 },    // center of strip, halfway around
        { u: 0.25, v: 0.1 },   // near edge
        { u: 0.25, v: 0.9 },   // near other edge
        { u: 0.75, v: 0.3 },   // arbitrary
        { u: 0.5, v: 0.02 },   // epsilon from edge
        { u: 0.5, v: 0.98 },   // epsilon from other edge
      ];

      for (const { u, v } of testPoints) {
        const transform = getTransform(u, v);
        const pos = transform.position;

        // Position must be finite (no NaN/Inf)
        expect(isFinite(pos.x)).toBe(true);
        expect(isFinite(pos.y)).toBe(true);
        expect(isFinite(pos.z)).toBe(true);

        // Position must be within reasonable bounds for Mobius (R=8, w=3 → max radius ~11)
        const distFromOrigin = pos.length();
        expect(distFromOrigin).toBeGreaterThan(3);   // must not collapse to origin
        expect(distFromOrigin).toBeLessThan(15);     // must not explode
      }
    });

    it('enemy at seam has continuous position (no teleport from UV wrapping)', () => {
      const surface = new MobiusSurface();
      const getTransform = makeMobiusTransform(surface);

      // Enemy just before and after the seam at center of strip (v=0.5)
      const beforeSeam = getTransform(0.999, 0.5);
      const afterSeam = getTransform(0.001, 0.5);

      // The Mobius seam is continuous in 3D space — positions should be very close
      const dist = beforeSeam.position.distanceTo(afterSeam.position);
      expect(dist).toBeLessThan(0.5); // Should be nearly the same point in 3D

      // After wrapping (u=0.999 → u=0.001, v=0.5 → 1-0.5=0.5), positions should match
      const wrappedV = 1 - 0.5; // = 0.5 (v-flip at seam)
      const afterSeamWrapped = getTransform(0.001, wrappedV);
      const distWrapped = beforeSeam.position.distanceTo(afterSeamWrapped.position);
      expect(distWrapped).toBeLessThan(0.5);
    });

    it('enemy on opposite side of Mobius strip is far from player — no ghost collision', () => {
      const surface = new MobiusSurface();
      const getTransform = makeMobiusTransform(surface);

      // Player at u=0.1, v=0.5 (center of strip, 10% around)
      const playerPos = getTransform(0.1, 0.5).position;

      // Enemy at u=0.6, v=0.5 — halfway around the other side
      const enemyPos = getTransform(0.6, 0.5).position;

      // These are on opposite sides of the strip — should be far apart
      const dist = playerPos.distanceTo(enemyPos);

      // On the Mobius strip (R=8), half-way around means ~π*8 ≈ 25 world units distance
      // At minimum they should be more than a few units apart (well beyond any hit radius)
      expect(dist).toBeGreaterThan(5);
    });

    it('UV seam wrap does NOT place enemy at player position unexpectedly', () => {
      const surface = new MobiusSurface();
      const getTransform = makeMobiusTransform(surface);

      // Player at u=0.02, v=0.5 (just past the seam)
      const playerPos = getTransform(0.02, 0.5).position;

      // Enemy at u=0.98, v=0.5 (just before the seam on the "other wrap" — same side in 3D due to Mobius topology)
      const enemyPos = getTransform(0.98, 0.5).position;

      // These ARE close in 3D (Mobius seam is continuous) — this is expected.
      // But the important thing is: if this enemy is a GHOST (isGhostForPlayer=true),
      // the collision system must skip it regardless.
      const collisionSystem = new CollisionSystem();

      // Create a ghost enemy at the enemy position
      const wanderer = new Wanderer(0.98, 0.5);
      wanderer.isMaterializing = false;
      wanderer.isGhostForPlayer = true; // Forced ghost
      wanderer.position.copy(enemyPos);

      const dieFn = vi.fn();
      const mockPlayer = {
        mesh: { position: playerPos.clone(), scale: new THREE.Vector3(1, 1, 1) },
        canTakeDamage: true,
        alive: true,
        die: dieFn,
      } as unknown as Player;

      const mockParticles = { playerDeath: vi.fn(), bulletImpact: vi.fn() } as unknown as ParticleSystem;
      const mockScreenShake = { shake: vi.fn() } as unknown as ScreenShake;

      collisionSystem.checkPlayerEnemyCollisions(
        mockPlayer, [wanderer], mockParticles, mockScreenShake, false,
      );

      // Ghost enemy must not kill player even if 3D-close at the seam
      expect(dieFn).not.toHaveBeenCalled();
    });
  });

  describe('Mobius applySurfaceTransform position integrity', () => {
    it('applySurfaceTransform places enemy.position at surface point (no offset)', () => {
      const surface = new MobiusSurface();
      const getTransform = makeMobiusTransform(surface);

      const wanderer = new Wanderer(0.3, 0.4);
      wanderer.applySurfaceTransform(getTransform);

      // enemy.position should equal the surface point (NOT offset by radius)
      const expected = getTransform(0.3, 0.4).position;
      expect(wanderer.position.distanceTo(expected)).toBeLessThan(0.001);

      // enemy.mesh.position should be offset by radius in normal direction
      const transform = getTransform(0.3, 0.4);
      const expectedMeshPos = transform.position.clone().addScaledVector(transform.normal, wanderer.radius);
      expect(wanderer.mesh?.position.distanceTo(expectedMeshPos) ?? 999).toBeLessThan(0.001);
    });

    it('collision check uses enemy.position (surface point) not mesh.position (offset)', () => {
      // This verifies the collision check is at the surface level, not the raised mesh level
      // If it used mesh.position, radius correction would be double-counted and the hitbox would be wrong

      const surface = new MobiusSurface();
      const getTransform = makeMobiusTransform(surface);

      const phaser = new Phaser(0.5, 0.5);
      phaser.isMaterializing = false;
      phaser.isGhostForPlayer = false;
      phaser.applySurfaceTransform(getTransform);

      // Player exactly at same surface point (enemy.position) — should collide
      const dieFn = vi.fn();
      const mockPlayer = {
        mesh: { position: phaser.position.clone(), scale: new THREE.Vector3(1, 1, 1) },
        canTakeDamage: true,
        alive: true,
        die: dieFn,
      } as unknown as Player;

      const mockParticles = { playerDeath: vi.fn(), bulletImpact: vi.fn() } as unknown as ParticleSystem;
      const mockScreenShake = { shake: vi.fn() } as unknown as ScreenShake;
      const collisionSystem = new CollisionSystem();

      collisionSystem.checkPlayerEnemyCollisions(
        mockPlayer, [phaser], mockParticles, mockScreenShake, false,
      );

      expect(dieFn).toHaveBeenCalled(); // Overlap at surface point = collision
    });
  });
});
