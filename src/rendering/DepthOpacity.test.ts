import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import {
  computeDepthVisibility,
  DEFAULT_DEPTH_CURVE,
  DEPTH_OPACITY_PRESETS,
  DepthOcclusionSystem,
  type OccludableEntity,
  DEFAULT_OCCLUSION_CONFIG,
} from './DepthOpacity';

// ---------------------------------------------------------------------------
// computeDepthVisibility (legacy dot-product system)
// ---------------------------------------------------------------------------

describe('computeDepthVisibility', () => {
  const cameraPos = new THREE.Vector3(0, 0, 10);

  it('returns nearSideMax when entity faces camera directly', () => {
    const entityPos = new THREE.Vector3(0, 0, 5);
    const entityNormal = new THREE.Vector3(0, 0, 1); // facing camera
    const result = computeDepthVisibility(entityPos, entityNormal, cameraPos);
    expect(result).toBeCloseTo(DEFAULT_DEPTH_CURVE.nearSideMax, 2);
  });

  it('returns farSideMin when entity faces away from camera', () => {
    const entityPos = new THREE.Vector3(0, 0, 5);
    const entityNormal = new THREE.Vector3(0, 0, -1); // facing away
    const result = computeDepthVisibility(entityPos, entityNormal, cameraPos);
    expect(result).toBeCloseTo(DEFAULT_DEPTH_CURVE.farSideMin, 2);
  });

  it('returns 1.0 for all entities with none preset', () => {
    const entityPos = new THREE.Vector3(0, 0, 5);
    const entityNormal = new THREE.Vector3(0, 0, -1);
    const result = computeDepthVisibility(entityPos, entityNormal, cameraPos, DEPTH_OPACITY_PRESETS.none);
    expect(result).toBeCloseTo(1.0, 2);
  });

  it('returns value between farSideMin and nearSideMax for perpendicular normal', () => {
    const entityPos = new THREE.Vector3(0, 0, 5);
    const entityNormal = new THREE.Vector3(1, 0, 0); // perpendicular to camera direction
    const result = computeDepthVisibility(entityPos, entityNormal, cameraPos);
    expect(result).toBeGreaterThanOrEqual(DEFAULT_DEPTH_CURVE.farSideMin);
    expect(result).toBeLessThanOrEqual(DEFAULT_DEPTH_CURVE.nearSideMax);
  });
});

// ---------------------------------------------------------------------------
// DepthOcclusionSystem (raycast-based)
// ---------------------------------------------------------------------------

/** Create a simple entity for testing. */
function makeEntity(pos: THREE.Vector3, alive = true): OccludableEntity {
  return { position: pos, alive };
}

/**
 * Create a box mesh with BVH for testing. The box is centered at the origin
 * with side length `size`. An entity at (0, 0, 5) is inside the box when
 * size > 10, and outside when size < 10.
 */
function makeBoxMesh(size: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(size, size, size);
  // Build BVH before returning
  geo.boundsTree = new MeshBVH(geo);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld(true);
  return mesh;
}

/**
 * Create a sphere mesh with BVH, optionally placed inside a scaled group.
 * This simulates a large-map surface where surface.group.scale.setScalar(scaleFactor)
 * has been applied (as in main.ts for LARGE=1.5 or EPIC=2.0 maps).
 */
function makeScaledSphereMesh(localRadius: number, scaleFactor: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(localRadius, 32, 32);
  geo.boundsTree = new MeshBVH(geo);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial());
  // Simulate the parent group scale that the game applies for large maps
  const group = new THREE.Group();
  group.scale.setScalar(scaleFactor);
  group.add(mesh);
  group.updateMatrixWorld(true);
  return mesh;
}

describe('DepthOcclusionSystem', () => {
  let system: DepthOcclusionSystem;

  beforeEach(() => {
    system = new DepthOcclusionSystem({ batchSize: 1000 }); // large batch = process all every frame
  });

  it('returns 1.0 opacity for entities before any update', () => {
    const entity = makeEntity(new THREE.Vector3(0, 0, 5));
    expect(system.getOpacity(entity)).toBe(1.0);
  });

  it('returns full opacity when no surface mesh is set', () => {
    const entity = makeEntity(new THREE.Vector3(0, 0, 5));
    system.update([entity], new THREE.Vector3(0, 0, 20), 1 / 60);
    // No surface mesh set, so no raycasts happen, default opacity
    expect(system.getOpacity(entity)).toBe(1.0);
  });

  it('returns full opacity for entity outside box (no intersections)', () => {
    // Box: 4x4x4, centered at origin. Camera at (0,0,20), entity at (0,0,5).
    // Ray from (0,0,20) to (0,0,5): doesn't pass through the box (box extends from -2 to 2).
    const mesh = makeBoxMesh(4);
    system.setSurfaceMesh(mesh);

    const entity = makeEntity(new THREE.Vector3(0, 0, 5));
    system.update([entity], new THREE.Vector3(0, 0, 20), 1 / 60);

    expect(system.getOpacity(entity)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity0, 2);
  });

  it('returns dimmed opacity for entity behind one box wall', () => {
    // Box: 20x20x20, centered at origin. Camera at (0,0,20), entity at (0,0,-5).
    // Ray from (0,0,20) to (0,0,-5): enters box at z=10, exits at... well it passes
    // through the near face. Actually for a box centered at origin with size 20:
    // z-faces are at z=10 and z=-10.
    // Camera at (0,0,20), entity at (0,0,-5).
    // Ray enters at z=10, and entity is at z=-5 which is inside the box.
    // So it crosses 1 face before reaching the entity.
    // With the 8% distance filter: dist = 25, minHitDist = 25*0.92 = 23
    // Hit at z=10 is at distance 10, which is < 23. So count = 1.
    const mesh = makeBoxMesh(20);
    system.setSurfaceMesh(mesh);

    const entity = makeEntity(new THREE.Vector3(0, 0, -5));
    system.update([entity], new THREE.Vector3(0, 0, 20), 1 / 60);

    // 1 intersection = opacity1
    expect(system.getOpacity(entity)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity1, 2);
  });

  it('returns dimmed opacity for entity behind full box (two walls)', () => {
    // Box: 4x4x4 centered at origin. Camera at (0,0,20), entity at (0,0,-5).
    // Ray from camera to entity passes through 2 faces of the box (enters at z=2, exits at z=-2).
    // After deduplication, count = 2 unique face crossings.
    // 1-2 hits = behind one surface layer = opacity1
    const mesh = makeBoxMesh(4);
    system.setSurfaceMesh(mesh);

    const entity = makeEntity(new THREE.Vector3(0, 0, -5));
    system.update([entity], new THREE.Vector3(0, 0, 20), 1 / 60);

    // 2 unique intersections (enter+exit through box) = behind one layer = opacity1
    expect(system.getOpacity(entity)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity1, 2);
  });

  it('handles multiple entities with different occlusion states', () => {
    const mesh = makeBoxMesh(4); // box from -2 to 2
    system.setSurfaceMesh(mesh);

    const camera = new THREE.Vector3(0, 0, 20);
    const entityVisible = makeEntity(new THREE.Vector3(0, 0, 5)); // outside box, clear LOS
    const entityOccluded = makeEntity(new THREE.Vector3(0, 0, -5)); // behind box

    system.update([entityVisible, entityOccluded], camera, 1 / 60);

    // Visible: no intersections -> full opacity
    expect(system.getOpacity(entityVisible)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity0, 2);
    // Occluded: behind box -> dimmed (1-2 unique face crossings)
    expect(system.getOpacity(entityOccluded)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity1, 2);
  });

  it('respects batch size limit', () => {
    const mesh = makeBoxMesh(4);
    const smallBatchSystem = new DepthOcclusionSystem({ batchSize: 1 });
    smallBatchSystem.setSurfaceMesh(mesh);

    const camera = new THREE.Vector3(0, 0, 20);
    const entity1 = makeEntity(new THREE.Vector3(0, 0, 5));
    const entity2 = makeEntity(new THREE.Vector3(0, 0, -5));

    // Only 1 entity processed per frame
    smallBatchSystem.update([entity1, entity2], camera, 1 / 60);

    // entity1 was processed (first in array), entity2 was not yet
    expect(smallBatchSystem.getOpacity(entity1)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity0, 2);
    expect(smallBatchSystem.getOpacity(entity2)).toBe(1.0); // not yet raycasted

    // Second frame: entity2 gets processed (behind box = dimmed)
    smallBatchSystem.update([entity1, entity2], camera, 1 / 60);
    // entity2 is behind box, so it should be dimmed (opacity1)
    expect(smallBatchSystem.getOpacity(entity2)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity1, 2);
  });

  it('smooth lerps opacity toward target', () => {
    // Use a large box so entity at (0,0,-5) is inside it (behind one wall from camera)
    const mesh = makeBoxMesh(20);
    const slowLerp = new DepthOcclusionSystem({ batchSize: 1000, lerpSpeed: 2.0 });
    slowLerp.setSurfaceMesh(mesh);

    const camera = new THREE.Vector3(0, 0, 20);
    const entity = makeEntity(new THREE.Vector3(0, 0, -5)); // behind one wall of 20x20x20 box

    // First update: sets initial opacity immediately (no lerp on first appearance)
    slowLerp.update([entity], camera, 1 / 60);
    const initial = slowLerp.getOpacity(entity);
    // Entity behind one wall = opacity1
    expect(initial).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity1, 2);

    // Now move entity outside the box (clear LOS)
    entity.position.set(0, 0, 15);

    // Update: target changes to opacity0 (1.0), but current should lerp gradually
    slowLerp.update([entity], camera, 1 / 60);
    const afterOneLerp = slowLerp.getOpacity(entity);
    // Should be moving toward 1.0 but not there yet (at lerpSpeed=2.0, dt=1/60)
    expect(afterOneLerp).toBeGreaterThan(initial);
    expect(afterOneLerp).toBeLessThan(DEFAULT_OCCLUSION_CONFIG.opacity0);
  });

  it('skips dead entities during raycast', () => {
    const mesh = makeBoxMesh(4);
    system.setSurfaceMesh(mesh);

    const dead = makeEntity(new THREE.Vector3(0, 0, -5), false);
    system.update([dead], new THREE.Vector3(0, 0, 20), 1 / 60);

    // Dead entity was skipped, so no entry -> returns default 1.0
    expect(system.getOpacity(dead)).toBe(1.0);
  });

  it('getIntersectionCount returns -1 for unknown entities', () => {
    const entity = makeEntity(new THREE.Vector3(0, 0, 5));
    expect(system.getIntersectionCount(entity)).toBe(-1);
  });

  it('getIntersectionCount returns count after raycast', () => {
    const mesh = makeBoxMesh(4);
    system.setSurfaceMesh(mesh);

    const entity = makeEntity(new THREE.Vector3(0, 0, -5));
    system.update([entity], new THREE.Vector3(0, 0, 20), 1 / 60);

    // Should have 2 unique intersections (enter + exit through box, deduplicated)
    const count = system.getIntersectionCount(entity);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(2);
  });

  it('clear resets state without errors', () => {
    const mesh = makeBoxMesh(4);
    system.setSurfaceMesh(mesh);

    const entity = makeEntity(new THREE.Vector3(0, 0, -5));
    system.update([entity], new THREE.Vector3(0, 0, 20), 1 / 60);

    system.clear();
    // After clear, entity should return default opacity
    expect(system.getOpacity(entity)).toBe(1.0);
  });

  it('dispose clears surface mesh reference', () => {
    const mesh = makeBoxMesh(4);
    system.setSurfaceMesh(mesh);
    system.dispose();

    // After dispose, update should be a no-op (no surface mesh)
    const entity = makeEntity(new THREE.Vector3(0, 0, -5));
    system.update([entity], new THREE.Vector3(0, 0, 20), 1 / 60);
    expect(system.getOpacity(entity)).toBe(1.0);
  });

  it('handles entity at camera position gracefully (distance ~0)', () => {
    const mesh = makeBoxMesh(4);
    system.setSurfaceMesh(mesh);

    const camera = new THREE.Vector3(0, 0, 20);
    const entity = makeEntity(camera.clone()); // Same position as camera
    system.update([entity], camera, 1 / 60);

    // Should not crash, returns default
    expect(system.getOpacity(entity)).toBe(1.0);
  });

  // --- Regression test: S27g — entity dimming broken on large/epic maps ---
  // When surface.group.scale is non-unit (1.5 for LARGE, 2.0 for EPIC), world-space
  // distances differ from local-space distances. Using world dist as localDist caused
  // minHitDist to be too large, so the enemy's own face got counted as an intersection
  // → ALL entities appeared dimmed even on the near side of the surface.
  it('REGRESSION S27g: near-side entity stays bright on scaled mesh (LARGE map, scale=1.5)', () => {
    // Sphere: local radius=1 inside a group scaled to 1.5. World radius=1.5.
    const mesh = makeScaledSphereMesh(1, 1.5);
    system.setSurfaceMesh(mesh);

    // Camera outside the sphere at world (0, 0, 5). Entity on near side at world (0, 0, 1.5).
    const camera = new THREE.Vector3(0, 0, 5);
    const nearEntity = makeEntity(new THREE.Vector3(0, 0, 1.5));

    system.update([nearEntity], camera, 1 / 60);

    // Near-side entity: 0 intersections → should be fully bright (opacity0 = 1.0)
    // Before fix: localDist was world-space → minHitDist too large → sphere face counted → dimmed
    expect(system.getOpacity(nearEntity)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity0, 2);
  });

  it('REGRESSION S27g: far-side entity is still dimmed on scaled mesh (LARGE map, scale=1.5)', () => {
    const mesh = makeScaledSphereMesh(1, 1.5);
    system.setSurfaceMesh(mesh);

    // Camera at (0, 0, 5), entity on far side at (0, 0, -1.5).
    const camera = new THREE.Vector3(0, 0, 5);
    const farEntity = makeEntity(new THREE.Vector3(0, 0, -1.5));

    system.update([farEntity], camera, 1 / 60);

    // Far-side entity: ray passes through near sphere face → 1 intersection → dimmed
    expect(system.getOpacity(farEntity)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity1, 2);
  });

  it('REGRESSION S27g: near-side entity stays bright on EPIC-scale mesh (scale=2.0)', () => {
    const mesh = makeScaledSphereMesh(1, 2.0);
    system.setSurfaceMesh(mesh);

    const camera = new THREE.Vector3(0, 0, 6);
    const nearEntity = makeEntity(new THREE.Vector3(0, 0, 2.0)); // on near surface (world radius=2)

    system.update([nearEntity], camera, 1 / 60);

    expect(system.getOpacity(nearEntity)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity0, 2);
  });

  it('uses custom config values', () => {
    const customSystem = new DepthOcclusionSystem({
      batchSize: 1000,
      opacity0: 0.9,
      opacity1: 0.5,
      opacity2Plus: 0.1,
    });
    const mesh = makeBoxMesh(4); // box from -2 to 2
    customSystem.setSurfaceMesh(mesh);

    const camera = new THREE.Vector3(0, 0, 20);
    const entityVisible = makeEntity(new THREE.Vector3(0, 0, 5)); // outside box
    const entityOccluded = makeEntity(new THREE.Vector3(0, 0, -5)); // behind box

    customSystem.update([entityVisible, entityOccluded], camera, 1 / 60);

    // Visible entity: no intersections -> opacity0 = 0.9
    expect(customSystem.getOpacity(entityVisible)).toBeCloseTo(0.9, 2);
    // Occluded entity: behind box (1-2 face crossings) -> opacity1 = 0.5
    expect(customSystem.getOpacity(entityOccluded)).toBeCloseTo(0.5, 2);
  });
});
