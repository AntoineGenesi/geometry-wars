import { describe, it, expect } from 'vitest';
import {
  MapSize,
  MAP_SIZE_MAX_ENEMIES,
  SURFACE_DEFAULT_MAP_SIZES,
  getDefaultMapSizeForSurface,
  getMaxActiveEnemies,
} from './MapSize';

describe('MapSize', () => {
  describe('MAP_SIZE_MAX_ENEMIES', () => {
    it('SMALL has 50 max active enemies', () => {
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.SMALL]).toBe(50);
    });

    it('MEDIUM has 62 max active enemies (base + 25%)', () => {
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.MEDIUM]).toBe(62);
    });

    it('LARGE has 75 max active enemies (base + 50%)', () => {
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.LARGE]).toBe(75);
    });

    it('EPIC has 100 max active enemies (base + 100%)', () => {
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.EPIC]).toBe(100);
    });

    it('enemy counts scale up with size tier', () => {
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.SMALL])
        .toBeLessThan(MAP_SIZE_MAX_ENEMIES[MapSize.MEDIUM]);
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.MEDIUM])
        .toBeLessThan(MAP_SIZE_MAX_ENEMIES[MapSize.LARGE]);
      expect(MAP_SIZE_MAX_ENEMIES[MapSize.LARGE])
        .toBeLessThan(MAP_SIZE_MAX_ENEMIES[MapSize.EPIC]);
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

    it('cube-tunnel is EPIC', () => {
      expect(SURFACE_DEFAULT_MAP_SIZES['cube-tunnel']).toBe(MapSize.EPIC);
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
      expect(getDefaultMapSizeForSurface('cube-tunnel')).toBe(MapSize.EPIC);
    });

    it('falls back to MEDIUM for unknown surface', () => {
      // Type cast to test the fallback behaviour
      expect(getDefaultMapSizeForSurface('unknown-surface' as any)).toBe(MapSize.MEDIUM);
    });
  });

  describe('getMaxActiveEnemies', () => {
    it('returns 50 for SMALL', () => {
      expect(getMaxActiveEnemies(MapSize.SMALL)).toBe(50);
    });

    it('returns 62 for MEDIUM', () => {
      expect(getMaxActiveEnemies(MapSize.MEDIUM)).toBe(62);
    });

    it('returns 75 for LARGE', () => {
      expect(getMaxActiveEnemies(MapSize.LARGE)).toBe(75);
    });

    it('returns 100 for EPIC', () => {
      expect(getMaxActiveEnemies(MapSize.EPIC)).toBe(100);
    });
  });
});
