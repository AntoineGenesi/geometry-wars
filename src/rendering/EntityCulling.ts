import * as THREE from 'three';

/**
 * Visibility state for an entity relative to the player's view hemisphere.
 *
 * VISIBLE  — Entity is within the player's 90° viewing hemisphere. Render normally.
 * HIDDEN   — Entity is >90° away (opposite side of the surface). Cull from rendering.
 * DIMMED   — Entity is partially visible (e.g. adjacent cube face). Phase 2: render at
 *            reduced opacity. Currently reserved — not yet emitted by getEntityVisibilityState.
 */
export const enum EntityVisibilityState {
  VISIBLE = 0,
  HIDDEN = 1,
  DIMMED = 2, // Phase 2 — reserved for face-dimming
}

/** Pre-allocated direction vector to avoid per-frame GC pressure. */
const _tempDir = new THREE.Vector3();

/**
 * Determine the visibility state of an entity relative to the player's position.
 *
 * Performs a hemisphere culling test using the player's outward surface normal:
 *   dot(playerNormal, entityPos − playerPos) < 0  →  HIDDEN
 *
 * This correctly culls entities on the far side of any convex surface
 * (sphere, cube, torus, capsule, etc.) by testing whether the entity
 * lies in the hemisphere "behind" the player's outward surface normal.
 *
 * @param playerPos    Player world-space position (from MeshWalker.position).
 * @param playerNormal Player outward surface normal (from MeshWalker.normal).
 * @param entityPos    Entity world-space position (from enemy.mesh.position).
 * @returns EntityVisibilityState
 *
 * @note Phase 2 hook: DIMMED state is reserved for face-dimming logic.
 *       When implemented, entities on adjacent cube faces near the 90° boundary
 *       will return DIMMED instead of VISIBLE, enabling a visual threat indicator.
 *
 * @note Not re-entrant — uses a module-level temp vector. Safe in single-threaded JS.
 */
export function getEntityVisibilityState(
  playerPos: THREE.Vector3,
  playerNormal: THREE.Vector3,
  entityPos: THREE.Vector3,
): EntityVisibilityState {
  _tempDir.subVectors(entityPos, playerPos);
  const distSq = _tempDir.lengthSq();
  if (distSq < 1e-6) return EntityVisibilityState.VISIBLE; // Co-located: always visible

  // dot > 0: entity is in front hemisphere (same side as normal) → visible
  // dot < 0: entity is in back hemisphere → hidden
  // Sign is unaffected by normalization, so we skip the sqrt for performance.
  const dot = _tempDir.dot(playerNormal);
  if (dot < 0) return EntityVisibilityState.HIDDEN;

  // Phase 2: return DIMMED for entities near the 90° boundary on adjacent faces.
  // For now, everything at dot >= 0 is VISIBLE.
  return EntityVisibilityState.VISIBLE;
}

/**
 * Identify which major cube face an entity occupies based on its world position.
 * Used to determine face relationships for Phase 2 face-dimming logic.
 *
 * Returns the dominant axis of the entity's position as a unit face normal:
 *   ±X, ±Y, or ±Z — whichever component has the greatest magnitude.
 *
 * @param entityPos Entity world-space position.
 * @returns A new Vector3 representing the face normal (one of ±X, ±Y, ±Z).
 *
 * @note Phase 2 hook: compare this against the player's face normal to determine
 *       whether the entity is on the same face, an adjacent face, or the opposite face.
 *       Adjacent faces → DIMMED. Opposite face → HIDDEN.
 */
export function getEntityCubeFace(entityPos: THREE.Vector3): THREE.Vector3 {
  const ax = Math.abs(entityPos.x);
  const ay = Math.abs(entityPos.y);
  const az = Math.abs(entityPos.z);
  if (ax >= ay && ax >= az) {
    return new THREE.Vector3(Math.sign(entityPos.x), 0, 0);
  } else if (ay >= ax && ay >= az) {
    return new THREE.Vector3(0, Math.sign(entityPos.y), 0);
  } else {
    return new THREE.Vector3(0, 0, Math.sign(entityPos.z));
  }
}
