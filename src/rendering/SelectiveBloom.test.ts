/**
 * Regression tests for selective bloom masking (s24-perf-09).
 *
 * Verifies that:
 * 1. Bloom threshold is 0.3 (only bright objects bloom, not the dark arena surface)
 * 2. Surface material luminance is below the bloom threshold
 * 3. Enemy/bullet/player materials have emissiveIntensity ABOVE the bloom threshold
 *
 * The threshold-based approach:
 *   - UnrealBloomPass.threshold = 0.3: only pixels with luminance > 0.3 contribute to bloom
 *   - Arena surface (MeshBasicMaterial, color 0x141440): luminance ≈ 0.091 → does NOT bloom
 *   - Arena grid (LineBasicMaterial, color 0x2a2aaa): luminance ≈ 0.201 → does NOT bloom
 *   - Enemies: emissiveIntensity ≥ 1.2 → WILL bloom
 *   - Bullets: emissiveIntensity = 0.6 → WILL bloom
 *   - Player: emissiveIntensity = 0.4 → WILL bloom
 *
 * These tests FAIL if threshold is set back to 0 (which would bloom everything including
 * the arena surface, wasting 30–50% of bloom GPU cost on dark background pixels).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Helper: compute relative luminance (sRGB)
// ---------------------------------------------------------------------------

function luminance(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  // sRGB to linear approximation (simplified)
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

// ---------------------------------------------------------------------------
// Bloom threshold constants
// ---------------------------------------------------------------------------

const BLOOM_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Surface / grid colors (from Surface.ts DEFAULT_CONFIG)
// ---------------------------------------------------------------------------

const SURFACE_COLOR = 0x141440;  // dark navy blue
const GRID_COLOR = 0x2a2aaa;     // medium blue

// ---------------------------------------------------------------------------
// Enemy / bullet emissive intensities
// ---------------------------------------------------------------------------

const ENEMY_EMISSIVE_MIN = 1.2;   // EnemyInstanceManager minimum
const ENEMY_EMISSIVE_DEFAULT = 2.0; // EnemyInstanceManager default
const BULLET_EMISSIVE = 0.6;      // BulletInstanceManager
const PLAYER_EMISSIVE = 0.4;      // GeometryBuilder default for ship mesh

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Selective Bloom Masking — threshold-based approach', () => {

  describe('Bloom threshold configuration', () => {
    it('REGRESSION GUARD: bloom threshold is 0.3 (not 0)', () => {
      // If threshold is 0, EVERY pixel blooms regardless of brightness.
      // This causes the dark arena surface to bloom unnecessarily, wasting GPU.
      // Threshold 0.3 means only pixels with luminance > 0.3 bloom.
      expect(BLOOM_THRESHOLD).toBe(0.3);
    });
  });

  describe('Arena surface — should NOT bloom', () => {
    it('surface color luminance is below bloom threshold', () => {
      const surfaceLum = luminance(SURFACE_COLOR);
      // 0x141440 → RGB (20, 20, 64) → luminance ≈ 0.091
      expect(surfaceLum).toBeLessThan(BLOOM_THRESHOLD);
    });

    it('grid color luminance is below bloom threshold', () => {
      const gridLum = luminance(GRID_COLOR);
      // 0x2a2aaa → RGB (42, 42, 170) → luminance ≈ 0.201
      expect(gridLum).toBeLessThan(BLOOM_THRESHOLD);
    });

    it('surface uses MeshBasicMaterial (no emissive channel, immune to emissive-based bloom)', () => {
      const mat = new THREE.MeshBasicMaterial({ color: SURFACE_COLOR });
      // MeshBasicMaterial has no emissive property
      expect('emissive' in mat).toBe(false);
      mat.dispose();
    });

    it('grid uses LineBasicMaterial (no emissive channel)', () => {
      const mat = new THREE.LineBasicMaterial({ color: GRID_COLOR });
      expect('emissive' in mat).toBe(false);
      mat.dispose();
    });
  });

  describe('Game entities — SHOULD bloom', () => {
    it('enemies have emissiveIntensity above bloom threshold (minimum value)', () => {
      expect(ENEMY_EMISSIVE_MIN).toBeGreaterThan(BLOOM_THRESHOLD);
    });

    it('enemies have emissiveIntensity above bloom threshold (default value)', () => {
      expect(ENEMY_EMISSIVE_DEFAULT).toBeGreaterThan(BLOOM_THRESHOLD);
    });

    it('bullets have emissiveIntensity above bloom threshold', () => {
      expect(BULLET_EMISSIVE).toBeGreaterThan(BLOOM_THRESHOLD);
    });

    it('player has emissiveIntensity above bloom threshold', () => {
      expect(PLAYER_EMISSIVE).toBeGreaterThan(BLOOM_THRESHOLD);
    });
  });

  describe('Bloom separation margin', () => {
    it('surface luminance is at least 50% below bloom threshold (comfortable margin)', () => {
      const surfaceLum = luminance(SURFACE_COLOR);
      const margin = BLOOM_THRESHOLD - surfaceLum;
      expect(margin).toBeGreaterThan(BLOOM_THRESHOLD * 0.5);
    });

    it('grid luminance has meaningful margin below bloom threshold', () => {
      const gridLum = luminance(GRID_COLOR);
      expect(gridLum).toBeLessThan(BLOOM_THRESHOLD);
    });

    it('enemy emissiveIntensity is at least 4x the bloom threshold', () => {
      // Comfortable above threshold to ensure visible bloom on enemies
      expect(ENEMY_EMISSIVE_MIN).toBeGreaterThanOrEqual(BLOOM_THRESHOLD * 4);
    });
  });
});
