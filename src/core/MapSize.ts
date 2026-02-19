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

/**
 * Maximum simultaneous active enemies per map size tier.
 * Scales at 50% / 100% / 150% / 200% relative to MEDIUM baseline (60).
 */
export const MAP_SIZE_MAX_ENEMIES: Record<MapSize, number> = {
  [MapSize.SMALL]: 30,  // 50% of 60
  [MapSize.MEDIUM]: 60, // 100% baseline
  [MapSize.LARGE]: 90,  // 150% of 60
  [MapSize.EPIC]: 120,  // 200% of 60
};

/**
 * Surface geometry scale factor per map size tier.
 * Applied to surface.group.scale so the physical surface is larger/smaller.
 * Player UV speed stays constant — traversal time scales proportionally.
 */
export const MAP_SIZE_SCALE_FACTORS: Record<MapSize, number> = {
  [MapSize.SMALL]: 0.75,
  [MapSize.MEDIUM]: 1.0,
  [MapSize.LARGE]: 1.5,
  [MapSize.EPIC]: 2.0,
};

/**
 * Get the Three.js group scale factor for a map size tier.
 */
export function getMapSizeScaleFactor(size: MapSize): number {
  return MAP_SIZE_SCALE_FACTORS[size];
}

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
