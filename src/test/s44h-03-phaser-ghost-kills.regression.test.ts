/**
 * Regression test for s44h-03 — Phaser ghost kills
 *
 * Root cause: Phaser enemy cycles between visible and invisible states.
 * When invisible (PhaserPhase.Invisible), it repositions near the player
 * but was still participating in player-enemy collision detection.
 * Player died from invisible enemies — "ghost kills".
 *
 * Fix: Added `isGhostForPlayer: boolean = false` to BaseEnemy.
 * Phaser sets it `true` during FadingIn, FadingOut, and Invisible phases.
 * CollisionSystem and GameInstance both skip enemies where isGhostForPlayer=true.
 *
 * These tests verify:
 * 1. Phaser starts with isGhostForPlayer=true (FadingIn phase on spawn)
 * 2. After becoming fully visible, isGhostForPlayer=false
 * 3. After starting FadeOut, isGhostForPlayer=true again
 * 4. CollisionSystem skips ghost enemies when checking player-enemy collision
 */

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Phaser } from '../entities/enemies/Phaser';
import { CollisionSystem } from '../core/CollisionSystem';
import { Player } from '../entities/Player';
import { ParticleSystem } from '../effects/ParticleSystem';
import { ScreenShake } from '../effects/ScreenShake';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';

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

vi.mock('../entities/Player', () => ({
  Player: vi.fn().mockImplementation(() => ({
    mesh: {
      position: new THREE.Vector3(0, 0, 0),
      scale: new THREE.Vector3(1, 1, 1),
    },
    canTakeDamage: true,
    alive: true,
    die: vi.fn(),
  })),
}));

describe('s44h-03: Phaser ghost kill regression', () => {
  describe('Phaser.isGhostForPlayer state machine', () => {
    it('starts as ghost (FadingIn phase = invisible)', () => {
      const phaser = new Phaser(0.5, 0.5);
      // Initial state: FadingIn, invulnerable=true, should be ghost for player
      expect(phaser.isGhostForPlayer).toBe(true);
    });

    it('becomes non-ghost when fully visible (after FadingIn completes)', () => {
      const phaser = new Phaser(0.5, 0.5);
      phaser.isMaterializing = false;

      // Simulate enough time to complete FadingIn (0.3s) and enter Visible phase
      const dt = 0.016;
      let elapsed = 0;
      while (elapsed < 0.35) {
        phaser.updateBehavior(dt, 0.5, 0.5);
        elapsed += dt;
      }

      // Should now be in Visible phase — no longer a ghost
      expect(phaser.isGhostForPlayer).toBe(false);
    });

    it('becomes ghost again after visible phase ends (FadingOut + Invisible)', () => {
      const phaser = new Phaser(0.5, 0.5);
      phaser.isMaterializing = false;

      // Advance through FadingIn (0.3s) + Visible (2.0s) → enters FadingOut
      const dt = 0.016;
      let elapsed = 0;
      while (elapsed < 2.4) {
        phaser.updateBehavior(dt, 0.5, 0.5);
        elapsed += dt;
      }

      // Should be in FadingOut or Invisible — must be ghost again
      expect(phaser.isGhostForPlayer).toBe(true);
    });

    it('cycles: ghost → visible → ghost', () => {
      const phaser = new Phaser(0.5, 0.5);
      phaser.isMaterializing = false;

      const dt = 0.016;
      const phases: Array<{ time: number; isGhost: boolean }> = [];

      let elapsed = 0;
      while (elapsed < 4.5) { // Full cycle: 0.3 fadeIn + 2.0 visible + 0.3 fadeOut + 1.0 invisible
        phaser.updateBehavior(dt, 0.5, 0.5);
        phases.push({ time: elapsed, isGhost: phaser.isGhostForPlayer });
        elapsed += dt;
      }

      // At t=0, ghost (FadingIn)
      expect(phases[0].isGhost).toBe(true);

      // Around t=0.35 (after FadingIn), not ghost
      const visibleSample = phases.find(p => p.time > 0.35 && p.time < 2.0);
      expect(visibleSample?.isGhost).toBe(false);

      // After visible phase ends (~2.3s), ghost again
      const ghostAfterVisible = phases.find(p => p.time > 2.4);
      expect(ghostAfterVisible?.isGhost).toBe(true);
    });
  });

  describe('CollisionSystem skips ghost enemies', () => {
    it('ghost enemy does NOT kill player even when in contact', () => {
      const surface = SurfaceFactory.create('sphere');
      const getTransform = (u: number, v: number) => {
        const pt = surface.getPoint(u, v);
        return { position: pt.position, normal: pt.normal, tangent: pt.tangentU, bitangent: pt.tangentV };
      };

      const collisionSystem = new CollisionSystem();

      // Create a Phaser enemy at player position
      const phaser = new Phaser(0.5, 0.5);
      phaser.isMaterializing = false;
      // Manually set phaser to invisible (ghost) state
      phaser.isGhostForPlayer = true;
      // Place it directly at origin where player will be
      phaser.position.set(0, 0, 0);

      const mockPlayer = {
        mesh: { position: new THREE.Vector3(0, 0, 0), scale: new THREE.Vector3(1, 1, 1) },
        canTakeDamage: true,
        alive: true,
        die: vi.fn(),
      } as unknown as Player;

      const mockParticles = { playerDeath: vi.fn(), bulletImpact: vi.fn() } as unknown as ParticleSystem;
      const mockScreenShake = { shake: vi.fn() } as unknown as ScreenShake;

      collisionSystem.checkPlayerEnemyCollisions(
        mockPlayer,
        [phaser],
        mockParticles,
        mockScreenShake,
        false,
      );

      // Player should NOT die — ghost enemy cannot kill
      expect(mockPlayer.die).not.toHaveBeenCalled();
    });

    it('non-ghost enemy DOES kill player when in contact', () => {
      const collisionSystem = new CollisionSystem();

      // Create a Phaser enemy at player position, make it visible (not ghost)
      const phaser = new Phaser(0.5, 0.5);
      phaser.isMaterializing = false;
      phaser.isGhostForPlayer = false; // Explicitly not a ghost
      phaser.position.set(0, 0, 0);

      const dieFn = vi.fn();
      const mockPlayer = {
        mesh: { position: new THREE.Vector3(0, 0, 0), scale: new THREE.Vector3(1, 1, 1) },
        canTakeDamage: true,
        alive: true,
        die: dieFn,
      } as unknown as Player;

      const mockParticles = { playerDeath: vi.fn(), bulletImpact: vi.fn() } as unknown as ParticleSystem;
      const mockScreenShake = { shake: vi.fn() } as unknown as ScreenShake;

      collisionSystem.checkPlayerEnemyCollisions(
        mockPlayer,
        [phaser],
        mockParticles,
        mockScreenShake,
        false,
      );

      // Player SHOULD die — visible enemy makes contact
      expect(dieFn).toHaveBeenCalled();
    });

    it('BaseEnemy defaults to isGhostForPlayer=false (other enemy types never ghost)', () => {
      // Verify that the new property defaults to false for all standard enemies
      // Test with a few concrete enemy types to catch any accidental override
      const { Wanderer } = require('../entities/enemies/Wanderer');
      const { Grunt } = require('../entities/enemies/Grunt');
      const { Lurker } = require('../entities/enemies/Lurker');

      const wanderer = new Wanderer(0.5, 0.5);
      const grunt = new Grunt(0.5, 0.5);
      const lurker = new Lurker(0.5, 0.5);

      expect(wanderer.isGhostForPlayer).toBe(false);
      expect(grunt.isGhostForPlayer).toBe(false);
      expect(lurker.isGhostForPlayer).toBe(false);
    });
  });
});
