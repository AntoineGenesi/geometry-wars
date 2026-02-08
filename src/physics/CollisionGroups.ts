/**
 * Collision group definitions for Rapier physics.
 *
 * Rapier uses two 16-bit halves packed into a single u32:
 *   - High 16 bits: membership groups (which groups this body belongs to)
 *   - Low 16 bits: filter groups (which groups this body collides with)
 *
 * This module maps our game's CollisionGroup enum to Rapier-compatible
 * interaction group bitmasks.
 */

/**
 * Bit positions for each collision category.
 * Each must be a unique power of 2 within the 16-bit range.
 */
export const COLLISION_CATEGORY = {
  PLAYER: 1 << 0,   // 0x0001
  ENEMY:  1 << 1,   // 0x0002
  BULLET: 1 << 2,   // 0x0004
  GEOM:   1 << 3,   // 0x0008
  PICKUP: 1 << 4,   // 0x0010
} as const;

/**
 * Pre-computed filter masks: which categories each category collides with.
 *
 * Collision rules:
 *   PLAYER <-> ENEMY, GEOM, PICKUP
 *   BULLET <-> ENEMY
 *   ENEMY  <-> PLAYER, BULLET
 *   GEOM   <-> PLAYER
 *   PICKUP <-> PLAYER
 */
export const COLLISION_FILTER = {
  PLAYER: COLLISION_CATEGORY.ENEMY | COLLISION_CATEGORY.GEOM | COLLISION_CATEGORY.PICKUP,
  ENEMY:  COLLISION_CATEGORY.PLAYER | COLLISION_CATEGORY.BULLET,
  BULLET: COLLISION_CATEGORY.ENEMY,
  GEOM:   COLLISION_CATEGORY.PLAYER,
  PICKUP: COLLISION_CATEGORY.PLAYER,
} as const;

/**
 * Build a Rapier interaction group u32 from membership + filter masks.
 *
 * Rapier format: (membership << 16) | filter
 * Both membership and filter are 16-bit bitmasks.
 */
export function makeInteractionGroups(membership: number, filter: number): number {
  return ((membership & 0xFFFF) << 16) | (filter & 0xFFFF);
}

/** Pre-computed interaction groups for each entity type. */
export const INTERACTION_GROUPS = {
  PLAYER: makeInteractionGroups(COLLISION_CATEGORY.PLAYER, COLLISION_FILTER.PLAYER),
  ENEMY:  makeInteractionGroups(COLLISION_CATEGORY.ENEMY,  COLLISION_FILTER.ENEMY),
  BULLET: makeInteractionGroups(COLLISION_CATEGORY.BULLET, COLLISION_FILTER.BULLET),
  GEOM:   makeInteractionGroups(COLLISION_CATEGORY.GEOM,   COLLISION_FILTER.GEOM),
  PICKUP: makeInteractionGroups(COLLISION_CATEGORY.PICKUP, COLLISION_FILTER.PICKUP),
} as const;

/**
 * Map from game CollisionGroup enum values to Rapier interaction groups.
 * Import CollisionGroup from Entity.ts and use this to look up the
 * appropriate Rapier interaction group.
 */
export function getInteractionGroupForCategory(category: string): number {
  switch (category) {
    case 'player': return INTERACTION_GROUPS.PLAYER;
    case 'enemy':  return INTERACTION_GROUPS.ENEMY;
    case 'bullet': return INTERACTION_GROUPS.BULLET;
    case 'geom':   return INTERACTION_GROUPS.GEOM;
    case 'pickup': return INTERACTION_GROUPS.PICKUP;
    default:       return makeInteractionGroups(0, 0);
  }
}
