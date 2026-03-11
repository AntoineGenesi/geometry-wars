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
 * s44r9-02: Raised all caps. At 60 (old MEDIUM), endless wave spawns hit the cap
 * by wave 3-4 and silently stopped producing visible enemies — EnemySpawner.spawn()
 * returned dummy inactive enemies that were cleaned up next frame. New baseline: 100.
 */
export const MAP_SIZE_MAX_ENEMIES: Record<MapSize, number> = {
  [MapSize.SMALL]: 50,   // was 30 — hit cap almost immediately in endless
  [MapSize.MEDIUM]: 100, // was 60 — root cause of s44r9-02 (enemies stop spawning)
  [MapSize.LARGE]: 150,  // was 90
  [MapSize.EPIC]: 200,   // was 120
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

  // LARGE — cube-tunnel at scale*2 is comparable to other surfaces; MEDIUM default
  'cube-tunnel': MapSize.MEDIUM,
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

/**
 * Caps for dynamic enemy count scaling at high difficulty.
 * Above these limits, adding more enemies would tank performance.
 */
const DYNAMIC_ENEMY_CAPS: Record<MapSize, number> = {
  [MapSize.SMALL]: 120,
  [MapSize.MEDIUM]: 200,
  [MapSize.LARGE]: 300,
  [MapSize.EPIC]: 400,
};

/**
 * Get the max simultaneous active enemies for a map size, scaled by difficulty.
 * Below difficulty 6: returns the static base cap (unchanged from early/mid game).
 * At difficulty 6+: adds +5 enemies per level above 6, capped per map size.
 */
export function getDynamicMaxEnemies(size: MapSize, difficultyLevel: number): number {
  const base = MAP_SIZE_MAX_ENEMIES[size];
  if (difficultyLevel <= 6) return base;
  const bonus = Math.floor((difficultyLevel - 6) * 5);
  return Math.min(base + bonus, DYNAMIC_ENEMY_CAPS[size]);
}
