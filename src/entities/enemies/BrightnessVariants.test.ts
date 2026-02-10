/**
 * Tests for the brightness variant enemies: ApproachGlow and StealthStalker.
 *
 * Verifies:
 * - Construction and mesh creation
 * - Chase behavior (move toward player)
 * - Distance-based brightness ramp (emissive intensity)
 * - ApproachGlow: dim far, bright close
 * - StealthStalker: bright far, dim close
 * - Smooth transitions (no step jumps)
 * - Integration with DifficultyScaling type pools
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ApproachGlow } from './ApproachGlow';
import { StealthStalker } from './StealthStalker';
import { generateScaledEndlessWave } from '../../core/DifficultyScaling';

// Helper: run applySurfaceTransform to populate cachedMaterials
function initMaterials(enemy: ApproachGlow | StealthStalker): void {
  // applySurfaceTransform populates cachedMaterials on first call
  const mockTransform = (u: number, v: number) => ({
    position: { x: u, y: 0, z: v, clone: () => ({ x: u, y: 0, z: v }), copy: function(p: any) { this.x = p.x; this.y = p.y; this.z = p.z; return this; }, addScaledVector: function(n: any, s: number) { this.x += n.x * s; this.y += n.y * s; this.z += n.z * s; return this; } } as any,
    normal: { x: 0, y: 1, z: 0 } as any,
    tangent: { x: 1, y: 0, z: 0 } as any,
    bitangent: { x: 0, y: 0, z: 1 } as any,
  });
  enemy.applySurfaceTransform(mockTransform);
}

// Helper: get current emissive intensity from cached materials
function getEmissiveIntensity(enemy: ApproachGlow | StealthStalker): number {
  if (!enemy.cachedMaterials || enemy.cachedMaterials.length === 0) {
    throw new Error('No cached materials - call initMaterials first');
  }
  return enemy.cachedMaterials[0].emissiveIntensity;
}

// ============================================================================
// ApproachGlow Tests
// ============================================================================

describe('ApproachGlow', () => {
  let enemy: ApproachGlow;

  beforeEach(() => {
    enemy = new ApproachGlow(0.5, 0.5);
  });

  it('should create with mesh and correct base properties', () => {
    expect(enemy.mesh).toBeTruthy();
    expect(enemy.alive).toBe(true);
    expect(enemy.baseTypeName).toBe('approach_glow');
    expect(enemy.health).toBe(3);
    expect(enemy.scoreValue).toBe(25);
  });

  it('should chase toward the player', () => {
    const startU = enemy.surfacePosition.u;
    const startV = enemy.surfacePosition.v;

    // Player is at (0.8, 0.8), enemy at (0.5, 0.5)
    enemy.updateBehavior(1.0, 0.8, 0.8);

    // Should have moved closer to player
    expect(enemy.surfacePosition.u).toBeGreaterThan(startU);
    expect(enemy.surfacePosition.v).toBeGreaterThan(startV);
  });

  it('should be dim when far from player', () => {
    initMaterials(enemy);

    // Enemy at (0.5, 0.5), player at (0.0, 0.0) -- distance ~0.707 UV (very far)
    enemy.updateBehavior(0.01, 0.0, 0.0);

    const intensity = getEmissiveIntensity(enemy);
    // Should be near the dim value (0.1)
    expect(intensity).toBeLessThan(0.3);
  });

  it('should be bright when close to player', () => {
    initMaterials(enemy);

    // Place enemy very near player
    enemy.surfacePosition.u = 0.5;
    enemy.surfacePosition.v = 0.5;
    enemy.updateBehavior(0.01, 0.52, 0.52);

    const intensity = getEmissiveIntensity(enemy);
    // Should be near the bright value (2.0)
    expect(intensity).toBeGreaterThan(1.0);
  });

  it('should have smooth brightness transition (no hard steps)', () => {
    initMaterials(enemy);

    // Sample at multiple distances and verify monotonic increase as distance decreases
    const playerU = 0.5;
    const playerV = 0.5;
    const intensities: number[] = [];

    // Distances from far to close
    const offsets = [0.5, 0.35, 0.25, 0.15, 0.08, 0.03, 0.01];
    for (const offset of offsets) {
      enemy.surfacePosition.u = playerU + offset;
      enemy.surfacePosition.v = playerV;
      enemy.updateBehavior(0.001, playerU, playerV);
      intensities.push(getEmissiveIntensity(enemy));
    }

    // Verify monotonically increasing brightness as distance decreases
    for (let i = 1; i < intensities.length; i++) {
      expect(intensities[i]).toBeGreaterThanOrEqual(intensities[i - 1]);
    }

    // Verify significant range (not all the same value)
    const range = intensities[intensities.length - 1] - intensities[0];
    expect(range).toBeGreaterThan(0.5);
  });

  it('should clamp to surface boundaries', () => {
    // Enemy near edge, player past boundary direction
    enemy.surfacePosition.u = 0.99;
    enemy.surfacePosition.v = 0.99;
    enemy.updateBehavior(10.0, 1.5, 1.5); // extreme dt to push past boundary

    expect(enemy.surfacePosition.u).toBeLessThanOrEqual(1.0);
    expect(enemy.surfacePosition.v).toBeLessThanOrEqual(1.0);
  });
});

// ============================================================================
// StealthStalker Tests
// ============================================================================

describe('StealthStalker', () => {
  let enemy: StealthStalker;

  beforeEach(() => {
    enemy = new StealthStalker(0.5, 0.5);
  });

  it('should create with mesh and correct base properties', () => {
    expect(enemy.mesh).toBeTruthy();
    expect(enemy.alive).toBe(true);
    expect(enemy.baseTypeName).toBe('stealth_stalker');
    expect(enemy.health).toBe(3);
    expect(enemy.scoreValue).toBe(40);
  });

  it('should chase toward the player', () => {
    const startU = enemy.surfacePosition.u;
    const startV = enemy.surfacePosition.v;

    // Player is at (0.8, 0.8), enemy at (0.5, 0.5)
    enemy.updateBehavior(1.0, 0.8, 0.8);

    expect(enemy.surfacePosition.u).toBeGreaterThan(startU);
    expect(enemy.surfacePosition.v).toBeGreaterThan(startV);
  });

  it('should be BRIGHT when far from player', () => {
    initMaterials(enemy);

    // Enemy at (0.5, 0.5), player at (0.0, 0.0) -- very far
    enemy.updateBehavior(0.01, 0.0, 0.0);

    const intensity = getEmissiveIntensity(enemy);
    // Should be near the bright value (1.8)
    expect(intensity).toBeGreaterThan(1.0);
  });

  it('should be DIM when close to player', () => {
    initMaterials(enemy);

    // Place enemy very near player
    enemy.surfacePosition.u = 0.5;
    enemy.surfacePosition.v = 0.5;
    enemy.updateBehavior(0.01, 0.52, 0.52);

    const intensity = getEmissiveIntensity(enemy);
    // Should be near the dim value (0.05)
    expect(intensity).toBeLessThan(0.3);
  });

  it('should have smooth brightness transition (no hard steps)', () => {
    initMaterials(enemy);

    const playerU = 0.5;
    const playerV = 0.5;
    const intensities: number[] = [];

    // Distances from far to close
    const offsets = [0.5, 0.35, 0.25, 0.15, 0.08, 0.03, 0.01];
    for (const offset of offsets) {
      enemy.surfacePosition.u = playerU + offset;
      enemy.surfacePosition.v = playerV;
      enemy.updateBehavior(0.001, playerU, playerV);
      intensities.push(getEmissiveIntensity(enemy));
    }

    // Verify monotonically DECREASING brightness as distance decreases (opposite of ApproachGlow)
    for (let i = 1; i < intensities.length; i++) {
      expect(intensities[i]).toBeLessThanOrEqual(intensities[i - 1]);
    }

    // Verify significant range
    const range = intensities[0] - intensities[intensities.length - 1];
    expect(range).toBeGreaterThan(0.5);
  });

  it('should clamp to surface boundaries', () => {
    enemy.surfacePosition.u = 0.01;
    enemy.surfacePosition.v = 0.01;
    enemy.updateBehavior(10.0, -0.5, -0.5);

    expect(enemy.surfacePosition.u).toBeGreaterThanOrEqual(0);
    expect(enemy.surfacePosition.v).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================================
// Brightness comparison: opposite behaviors
// ============================================================================

describe('Brightness variant comparison', () => {
  it('ApproachGlow and StealthStalker have opposite brightness at same distance', () => {
    const approach = new ApproachGlow(0.3, 0.3);
    const stealth = new StealthStalker(0.3, 0.3);
    initMaterials(approach);
    initMaterials(stealth);

    // Both at medium distance from player
    const playerU = 0.5;
    const playerV = 0.5;
    approach.updateBehavior(0.001, playerU, playerV);
    stealth.updateBehavior(0.001, playerU, playerV);

    const approachIntensity = getEmissiveIntensity(approach);
    const stealthIntensity = getEmissiveIntensity(stealth);

    // At medium distance (~0.28 UV), StealthStalker should be brighter than ApproachGlow
    expect(stealthIntensity).toBeGreaterThan(approachIntensity);
  });
});

// ============================================================================
// Spawner integration: types are in DifficultyScaling pools
// ============================================================================

describe('DifficultyScaling integration', () => {
  it('approach_glow appears in mid-game waves', () => {
    // Mid-types start spawning at wave 4+; cycle through enough waves to hit approach_glow
    let found = false;
    for (let wave = 4; wave < 40; wave++) {
      const entries = generateScaledEndlessWave(wave, 1.5);
      if (entries.some(e => e.type === 'approach_glow')) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('stealth_stalker appears in hard-game waves', () => {
    // Hard types start spawning at wave 8+
    let found = false;
    for (let wave = 8; wave < 50; wave++) {
      const entries = generateScaledEndlessWave(wave, 2.5);
      if (entries.some(e => e.type === 'stealth_stalker')) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('stealth_stalker does NOT appear in early waves', () => {
    // Waves 1-7 should not have hard types
    for (let wave = 1; wave <= 7; wave++) {
      const entries = generateScaledEndlessWave(wave, 0.5);
      const hasStealth = entries.some(e => e.type === 'stealth_stalker');
      expect(hasStealth).toBe(false);
    }
  });
});
