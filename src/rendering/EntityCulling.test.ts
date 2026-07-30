import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  ENEMY_OCCLUSION_FAR_DIM_VISIBILITY,
  ENEMY_OCCLUSION_LARGE_FAR_DIM_VISIBILITY,
  ENEMY_OCCLUSION_NEAR_DIM_VISIBILITY,
  EntityVisibilityState,
  computeEnemyOcclusionVisibility,
  getEntityCubeFace,
  getEntityVisibilityState,
} from './EntityCulling';

describe('getEntityVisibilityState', () => {
  const playerPos = new THREE.Vector3(0, 10, 0); // Player on top of a sphere
  const playerNormal = new THREE.Vector3(0, 1, 0); // Normal points up (outward from sphere)

  it('returns VISIBLE when entity is directly above player (same side)', () => {
    const entityPos = new THREE.Vector3(0, 12, 0); // Above player, same hemisphere
    expect(getEntityVisibilityState(playerPos, playerNormal, entityPos)).toBe(EntityVisibilityState.VISIBLE);
  });

  it('returns VISIBLE when entity is beside player on the same hemisphere', () => {
    const entityPos = new THREE.Vector3(2, 10, 0); // Same height, to the side
    expect(getEntityVisibilityState(playerPos, playerNormal, entityPos)).toBe(EntityVisibilityState.VISIBLE);
  });

  it('returns HIDDEN when entity is on the opposite side of the sphere', () => {
    const entityPos = new THREE.Vector3(0, -10, 0); // Bottom of sphere
    expect(getEntityVisibilityState(playerPos, playerNormal, entityPos)).toBe(EntityVisibilityState.HIDDEN);
  });

  it('returns HIDDEN when entity is clearly below the surface', () => {
    const entityPos = new THREE.Vector3(0, -5, 0); // Below player
    expect(getEntityVisibilityState(playerPos, playerNormal, entityPos)).toBe(EntityVisibilityState.HIDDEN);
  });

  it('returns VISIBLE when entity is at exactly 90° (on the equator)', () => {
    // Entity is directly to the side — dot product is 0, which is >= 0 → VISIBLE
    const entityPos = new THREE.Vector3(100, 10, 0); // Same y as player, far to the side
    expect(getEntityVisibilityState(playerPos, playerNormal, entityPos)).toBe(EntityVisibilityState.VISIBLE);
  });

  it('returns VISIBLE when entity is co-located with player', () => {
    expect(getEntityVisibilityState(playerPos, playerNormal, playerPos)).toBe(EntityVisibilityState.VISIBLE);
  });

  describe('cube surface scenario', () => {
    // Player on top face of cube: position (0, 5, 0), normal (0, 1, 0)
    const cubePlayerPos = new THREE.Vector3(0, 5, 0);
    const cubePlayerNormal = new THREE.Vector3(0, 1, 0);

    it('returns VISIBLE for enemy on same face', () => {
      const entity = new THREE.Vector3(2, 5, 1); // Same face, top
      expect(getEntityVisibilityState(cubePlayerPos, cubePlayerNormal, entity)).toBe(EntityVisibilityState.VISIBLE);
    });

    it('returns HIDDEN for enemy on bottom face', () => {
      const entity = new THREE.Vector3(0, -5, 0); // Bottom face
      expect(getEntityVisibilityState(cubePlayerPos, cubePlayerNormal, entity)).toBe(EntityVisibilityState.HIDDEN);
    });

    it('returns VISIBLE for enemy on adjacent front face', () => {
      // Entity on front face at (0, 0, 5) — direction from player: (0, -5, 5)
      // dot with (0,1,0) = -5 → HIDDEN
      // Actually this is hidden because the front face entity is below the plane
      const entity = new THREE.Vector3(0, 0, 5); // Front face center
      // Direction: (0, -5, 5), dot with up = -5 → HIDDEN
      expect(getEntityVisibilityState(cubePlayerPos, cubePlayerNormal, entity)).toBe(EntityVisibilityState.HIDDEN);
    });

    it('returns VISIBLE for enemy near the top edge of adjacent face', () => {
      // Entity on right face at (5, 4, 0) — near the top edge
      // Direction from (0,5,0): (5, -1, 0), dot with (0,1,0) = -1 → HIDDEN
      const entity = new THREE.Vector3(5, 6, 0); // Slightly above player on right side → visible
      // Direction: (5, 1, 0), dot with (0,1,0) = 1 → VISIBLE
      expect(getEntityVisibilityState(cubePlayerPos, cubePlayerNormal, entity)).toBe(EntityVisibilityState.VISIBLE);
    });
  });

  describe('different player normals', () => {
    it('works when player normal points in -Z direction', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const normal = new THREE.Vector3(0, 0, -1);

      const visible = new THREE.Vector3(0, 0, -5); // In front of normal direction
      expect(getEntityVisibilityState(pos, normal, visible)).toBe(EntityVisibilityState.VISIBLE);

      const hidden = new THREE.Vector3(0, 0, 5); // Behind normal direction
      expect(getEntityVisibilityState(pos, normal, hidden)).toBe(EntityVisibilityState.HIDDEN);
    });

    it('works when player normal is diagonal', () => {
      const pos = new THREE.Vector3(0, 0, 0);
      const normal = new THREE.Vector3(1, 1, 0).normalize();

      // Entity along normal direction → visible
      const visible = new THREE.Vector3(3, 3, 0);
      expect(getEntityVisibilityState(pos, normal, visible)).toBe(EntityVisibilityState.VISIBLE);

      // Entity opposite to normal → hidden
      const hidden = new THREE.Vector3(-3, -3, 0);
      expect(getEntityVisibilityState(pos, normal, hidden)).toBe(EntityVisibilityState.HIDDEN);
    });
  });
});

describe('getEntityCubeFace', () => {
  it('returns +Y for entity above origin (top face)', () => {
    const pos = new THREE.Vector3(0, 5, 0);
    const face = getEntityCubeFace(pos);
    expect(face.x).toBe(0);
    expect(face.y).toBe(1);
    expect(face.z).toBe(0);
  });

  it('returns -Y for entity below origin (bottom face)', () => {
    const pos = new THREE.Vector3(0, -5, 0);
    const face = getEntityCubeFace(pos);
    expect(face.y).toBe(-1);
  });

  it('returns +X for entity on right face', () => {
    const pos = new THREE.Vector3(5, 0, 0);
    const face = getEntityCubeFace(pos);
    expect(face.x).toBe(1);
  });

  it('returns -Z for entity on back face', () => {
    const pos = new THREE.Vector3(0, 0, -5);
    const face = getEntityCubeFace(pos);
    expect(face.z).toBe(-1);
  });

  it('returns dominant axis when position is not axis-aligned', () => {
    // X is dominant (5 > 3 > 1)
    const pos = new THREE.Vector3(5, 3, 1);
    const face = getEntityCubeFace(pos);
    expect(face.x).toBe(1);
    expect(face.y).toBe(0);
    expect(face.z).toBe(0);
  });
});

describe('computeEnemyOcclusionVisibility', () => {
  const playerPos = new THREE.Vector3(0, 10, 0);
  const playerNormal = new THREE.Vector3(0, 1, 0);

  it('keeps direct enemies fully visible', () => {
    const result = computeEnemyOcclusionVisibility(
      playerPos,
      playerNormal,
      new THREE.Vector3(0, 14, 0),
    );
    expect(result.className).toBe('direct');
    expect(result.visibility).toBe(1.0);
    expect(result.occluded).toBe(false);
  });

  it('keeps nearby occluded enemies readable in default mode', () => {
    const result = computeEnemyOcclusionVisibility(
      playerPos,
      playerNormal,
      new THREE.Vector3(0, 6, 0),
    );
    expect(result.className).toBe('near-occluded');
    expect(result.visibility).toBeCloseTo(ENEMY_OCCLUSION_NEAR_DIM_VISIBILITY, 5);
    expect(result.minColorBrightness).toBeCloseTo(result.visibility, 5);
  });

  it('makes far occluded regular enemies super dim but not hidden', () => {
    const result = computeEnemyOcclusionVisibility(
      playerPos,
      playerNormal,
      new THREE.Vector3(0, -12, 0),
    );
    expect(result.className).toBe('far-occluded');
    expect(result.visibility).toBeCloseTo(ENEMY_OCCLUSION_FAR_DIM_VISIBILITY, 5);
    expect(result.visibility).toBeGreaterThan(0);
  });

  it('preserves stronger far-side presence for large enemies', () => {
    const result = computeEnemyOcclusionVisibility(
      playerPos,
      playerNormal,
      new THREE.Vector3(0, -12, 0),
      { enemyRadius: 1.5 },
    );
    expect(result.className).toBe('far-occluded');
    expect(result.visibility).toBeCloseTo(ENEMY_OCCLUSION_LARGE_FAR_DIM_VISIBILITY, 5);
  });

  it('intentionally hides occluded enemies in opaque-surface mode', () => {
    const result = computeEnemyOcclusionVisibility(
      playerPos,
      playerNormal,
      new THREE.Vector3(0, -12, 0),
      { opaqueSurfaces: true },
    );
    expect(result.className).toBe('opaque-hidden');
    expect(result.visibility).toBe(0);
    expect(result.minColorBrightness).toBe(0);
  });

  it('treats clear line of sight as direct even when the hemisphere test is behind', () => {
    const result = computeEnemyOcclusionVisibility(
      playerPos,
      playerNormal,
      new THREE.Vector3(0, -12, 0),
      { lineOfSightClear: true },
    );
    expect(result.className).toBe('direct');
    expect(result.visibility).toBe(1.0);
  });
});
