import { describe, it, expect } from 'vitest';
import {
  MapSize,
  MAP_SIZE_MAX_ENEMIES,
  MAP_SIZE_SCALE_FACTORS,
  SURFACE_DEFAULT_MAP_SIZES,
  getDefaultMapSizeForSurface,
  getMaxActiveEnemies,
  getMapSizeScaleFactor,
} from './MapSize';

describe('MapSize', () => {
  describe('MAP_SIZE_MAX_ENEMIES', () => {
    // Spec: SMALL=50%, MEDIUM=100% (baseline=60), LARGE=150%, EPIC=200%
    it('SMALL has 30 max active enemies (50% of 60)', () => {
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.SMALL]).toBe(30);
    });

    it('MEDIUM has 60 max active enemies (100% baseline)', () => {
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.MEDIUM]).toBe(60);
    });

    it('LARGE has 90 max active enemies (150% of 60)', () => {
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.LARGE]).toBe(90);
    });

    it('EPIC has 120 max active enemies (200% of 60)', () => {
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.EPIC]).toBe(120);
    });

    it('enemy counts scale up with size tier', () => {
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.SMALL])
        .toBeLessThan(MAP_SIZE_MAX_ENEMIES[MapSize.MEDIUM]);
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.MEDIUM])
        .toBeLessThan(MAP_SIZE_MAX_ENEMIES[MapSize.LARGE]);
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.LARGE])
        .toBeLessThan(MAP_SIZE_MAX_ENEMIES[MapSize.EPIC]);
    });

    it('SMALL is ~50% of MEDIUM', () => {
      const ratio = MAP_SIZE_MAX_ENEMIES[MapSize.SMALL] / MAP_SIZE_MAX_ENEMIES[MapSize.MEDIUM];
      expect(ratio).toBeCloseTo(0.5, 1);
    });

    it('LARGE is ~150% of MEDIUM', () => {
      const ratio = MAP_SIZE_MAX_ENEMIES[MapSize.LARGE] / MAP_SIZE_MAX_ENEMIES[MapSize.MEDIUM];
      expect(ratio).toBeCloseTo(1.5, 1);
    });

    it('EPIC is ~200% of MEDIUM', () => {
      const ratio = MAP_SIZE_MAX_ENEMIES[MapSize.EPIC] / MAP_SIZE_MAX_ENEMIES[MapSize.MEDIUM];
      expect(ratio).toBeCloseTo(2.0, 1);
    });
  });

  describe('MAP_SIZE_SCALE_FACTORS', () => {
    it('SMALL has 0.75 scale factor', () => {
      expect(MAP_SIZE_SCALE_FACTORS[MapSize.SMALL]).toBe(0.75);
    });

    it('MEDIUM has 1.0 scale factor (no change)', () => {
      expect(MAP_SIZE_SCALE_FACTORS[MapSize.MEDIUM]).toBe(1.0);
    });

    it('LARGE has 1.5 scale factor', () => {
      expect(MAP_SIZE_SCALE_FACTORS[MapSize.LARGE]).toBe(1.5);
    });

    it('EPIC has 2.0 scale factor', () => {
      expect(MAP_SIZE_SCALE_FACTORS[MapSize.EPIC]).toBe(2.0);
    });

    it('scale factors increase with size tier', () => {
      expect(MAP_SIZE_SCALE_FACTORS[MapSize.SMALL])
        .toBeLessThan(MAP_SIZE_SCALE_FACTORS[MapSize.MEDIUM]);
      expect(MAP_SIZE_SCALE_FACTORS[MapSize.MEDIUM])
        .toBeLessThan(MAP_SIZE_SCALE_FACTORS[MapSize.LARGE]);
      expect(MAP_SIZE_SCALE_FACTORS[MapSize.LARGE])
        .toBeLessThan(MAP_SIZE_SCALE_FACTORS[MapSize.EPIC]);
    });
  });

  describe('SURFACE_DEFAULT_MAP_SIZES — size assignments', () => {
    it('cube is SMALL', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES.cube).toBe(MapSize.SMALL);
    });

    it('sphere is MEDIUM', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES.sphere).toBe(MapSize.MEDIUM);
    });

    it('pill is MEDIUM', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES.pill).toBe(MapSize.MEDIUM);
    });

    it('torus is MEDIUM', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES.torus).toBe(MapSize.MEDIUM);
    });

    it('icosahedron is MEDIUM', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES.icosahedron).toBe(MapSize.MEDIUM);
    });

    it('pipe (tunnel) is LARGE', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES.pipe).toBe(MapSize.LARGE);
    });

    it('capsule (cylinder) is LARGE', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES.capsule).toBe(MapSize.LARGE);
    });

    it('sphere-tunnel is LARGE', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES['sphere-tunnel']).toBe(MapSize.LARGE);
    });

    it('cube-ring is LARGE', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES['cube-ring']).toBe(MapSize.LARGE);
    });

    it('cube-tunnel is MEDIUM', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES['cube-tunnel']).toBe(MapSize.MEDIUM);
    });

    it('mobius is EPIC', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES.mobius).toBe(MapSize.EPIC);
    });

    it('mobius-bevel (Klein) is EPIC', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES['mobius-bevel']).toBe(MapSize.EPIC);
    });

    it('peanut is EPIC', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES.peanut).toBe(MapSize.EPIC);
    });

    it('custom defaults to MEDIUM', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES.custom).toBe(MapSize.MEDIUM);
    });

    it('all surface types have a size assigned', () => {
      const definedSurfaces = [
        'sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut',
        'capsule', 'icosahedron', 'mobius', 'sphere-tunnel',
        'cube-ring', 'cube-tunnel', 'mobius-bevel', 'custom',
      ] as const;

      for (const surface of definedSurfaces) {
        expect(
          SURFACE_DEFAULT_MAP_SIZES[surface],
          `Surface '${surface}' should have a size assigned`,
        ).toBeDefined();
      }
    });
  });

  describe('getDefaultMapSizeForSurface', () => {
    it('returns correct size for known surfaces', () => {
      expect(getDefaultMapSizeForSurface('cube')).toBe(MapSize.SMALL);
      expect(getDefaultMapSizeForSurface('sphere')).toBe(MapSize.MEDIUM);
      expect(getDefaultMapSizeForSurface('pipe')).toBe(MapSize.LARGE);
      expect(getDefaultMapSizeForSurface('cube-tunnel')).toBe(MapSize.MEDIUM);
    });

    it('falls back to MEDIUM for unknown surface', () => {
      // Type cast to test the fallback behaviour
      expect(getDefaultMapSizeForSurface('unknown-surface' as any)).toBe(MapSize.MEDIUM);
    });
  });

  describe('getMaxActiveEnemies', () => {
    it('returns 30 for SMALL (50% of baseline)', () => {
      expect(getMaxActiveEnemies(MapSize.SMALL)).toBe(30);
    });

    it('returns 60 for MEDIUM (100% baseline)', () => {
      expect(getMaxActiveEnemies(MapSize.MEDIUM)).toBe(60);
    });

    it('returns 90 for LARGE (150% of baseline)', () => {
      expect(getMaxActiveEnemies(MapSize.LARGE)).toBe(90);
    });

    it('returns 120 for EPIC (200% of baseline)', () => {
      expect(getMaxActiveEnemies(MapSize.EPIC)).toBe(120);
    });
  });

  describe('getMapSizeScaleFactor', () => {
    it('returns 0.75 for SMALL', () => {
      expect(getMapSizeScaleFactor(MapSize.SMALL)).toBe(0.75);
    });

    it('returns 1.0 for MEDIUM (no scale change)', () => {
      expect(getMapSizeScaleFactor(MapSize.MEDIUM)).toBe(1.0);
    });

    it('returns 1.5 for LARGE', () => {
      expect(getMapSizeScaleFactor(MapSize.LARGE)).toBe(1.5);
    });

    it('returns 2.0 for EPIC', () => {
      expect(getMapSizeScaleFactor(MapSize.EPIC)).toBe(2.0);
    });
  });
});
