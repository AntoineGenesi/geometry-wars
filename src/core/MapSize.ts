import type { SurfaceType } from '../surfaces/SurfaceFactory';

/**
 * Map size tiers that affect enemy count cap.
 * Smaller maps have less space for enemies; larger maps escalate pressure.
 */
export enum MapSize {
  SMALL = 'small',
  MEDIUM = 'medium',
  LARGE = 'large',
  EPIC = 'epic',
}

/** Maximum simultaneous active enemies per map size tier. */
export const MAP_SIZE_MAX_ENEMIES: Record<MapSize, number> = {
  [MapSize.SMALL]: 50,
  [MapSize.MEDIUM]: 62,
  [MapSize.LARGE]: 75,
  [MapSize.EPIC]: 100,
};

/** Display labels for the UI. */
export const MAP_SIZE_LABELS: Record<MapSize, string> = {
  [MapSize.SMALL]: 'SMALL',
  [MapSize.MEDIUM]: 'MEDIUM',
  [MapSize.LARGE]: 'LARGE',
  [MapSize.EPIC]: 'EPIC',
};

/**
 * Default size for each surface type.
 * Assignments based on surface area + shape complexity:
 * - SMALL: compact, fully enclosed
 * - MEDIUM: balanced surface area
 * - LARGE: elongated or larger but not topologically complex
 * - EPIC: very large area or complex topology
 */
export const SURFACE_DEFAULT_MAP_SIZES: Record<SurfaceType, MapSize> = {
  // SMALL — compact, enclosed
  cube: MapSize.SMALL,

  // MEDIUM — balanced area
  sphere: MapSize.MEDIUM,
  pill: MapSize.MEDIUM,
  torus: MapSize.MEDIUM,
  icosahedron: MapSize.MEDIUM,

  // LARGE — elongated/extended
  pipe: MapSize.LARGE,         // tunnel
  capsule: MapSize.LARGE,      // cylinder
  'sphere-tunnel': MapSize.LARGE,
  'cube-ring': MapSize.LARGE,

  // EPIC — very large or topologically complex
  'cube-tunnel': MapSize.EPIC,
  mobius: MapSize.EPIC,
  'mobius-bevel': MapSize.EPIC,  // Klein bottle variant
  peanut: MapSize.EPIC,

  // Custom mesh — neutral default
  custom: MapSize.MEDIUM,
};

/**
 * Get the default map size for a given surface type.
 * Falls back to MEDIUM if the surface is not in the map.
 */
export function getDefaultMapSizeForSurface(surfaceType: SurfaceType): MapSize {
  return SURFACE_DEFAULT_MAP_SIZES[surfaceType] ?? MapSize.MEDIUM;
}

/**
 * Get the max simultaneous active enemies for a map size.
 */
export function getMaxActiveEnemies(size: MapSize): number {
  return MAP_SIZE_MAX_ENEMIES[size];
}
