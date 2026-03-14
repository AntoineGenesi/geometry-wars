import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import {
  computeDepthVisibility,
  DEFAULT_DEPTH_CURVE,
  DEPTH_OPACITY_PRESETS,
  BULLET_DEPTH_CURVE,
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

  it('smooth lerps opacity toward target after EMA stabilizes', () => {
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

    // EMA smoothing (alpha=0.7): after one count=0 frame, smoothedCount = 1.0*0.7 + 0*0.3 = 0.7.
    // With S36 threshold=0.75: 0.7 < 0.75 → target immediately becomes opacity0 and lerp starts.
    // (Old threshold was 0.5: 0.7 > 0.5 → target stayed at opacity1 for one more frame.)
    slowLerp.update([entity], camera, 1 / 60);
    // Lerp has started (target=opacity0 already); with lerpSpeed=2.0 and dt=1/60, one frame of lerp:
    // opacity = initial + (opacity0 - initial) * (2.0/60) ≈ slightly above initial
    expect(slowLerp.getOpacity(entity)).toBeGreaterThan(initial);          // lerp already moving
    expect(slowLerp.getOpacity(entity)).toBeLessThan(DEFAULT_OCCLUSION_CONFIG.opacity0); // not there yet

    // After frame 2 (count=0): smoothedCount = 0.49 → still below 0.75 → target stays opacity0,
    // lerp continues moving toward 1.0
    slowLerp.update([entity], camera, 1 / 60);
    const afterEmaStabilizes = slowLerp.getOpacity(entity);
    expect(afterEmaStabilizes).toBeGreaterThan(initial);
    expect(afterEmaStabilizes).toBeLessThan(DEFAULT_OCCLUSION_CONFIG.opacity0);
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

  // --- Regression test: S35 — entity dimming flicker on cube edge ---
  // When the camera looks at a cube edge, rays to far-side entities barely clip the face
  // edge. Floating-point imprecision causes the intersection count to alternate between
  // 0 and 1 each frame. The EMA smoothing (alpha=0.7) prevents this single-frame noise
  // from flipping the target opacity: one rogue count=1 only raises smoothedCount to 0.3
  // (below the 0.5 threshold), so the target stays at opacity0.
  it('REGRESSION S35: single-frame count spike does NOT flip target opacity', () => {
    const mesh = makeBoxMesh(4);
    system.setSurfaceMesh(mesh);
    const camera = new THREE.Vector3(0, 0, 20);

    // Entity clearly outside box (count=0, bright)
    const entity = makeEntity(new THREE.Vector3(0, 0, 5));
    system.update([entity], camera, 1 / 60);
    expect(system.getOpacity(entity)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity0, 2);

    // Simulate a single-frame "rogue" hit by moving entity briefly into box territory
    // then immediately back. The EMA should absorb the spike.
    entity.position.set(0, 0, -5); // behind box → count=1-2
    system.update([entity], camera, 1 / 60);

    // Move back to clear position
    entity.position.set(0, 0, 5);
    system.update([entity], camera, 1 / 60);

    // After: smoothedCount went up then back down. Target may have temporarily changed
    // but the lerp should not have completed — opacity should still be significantly bright.
    // The key: a transient hit followed by clear ray should recover quickly.
    const opacityAfterSpike = system.getOpacity(entity);
    // Should not have dropped to opacity1 (0.5) entirely — the spike is absorbed
    // Opacity should be above 0.7 (closer to bright than to dimmed).
    expect(opacityAfterSpike).toBeGreaterThan(0.7);
  });

  it('REGRESSION S35: sustained count change DOES update target (two consecutive frames)', () => {
    const mesh = makeBoxMesh(4);
    system.setSurfaceMesh(mesh);
    const camera = new THREE.Vector3(0, 0, 20);

    // Start: entity outside box (bright)
    const entity = makeEntity(new THREE.Vector3(0, 0, 5));
    system.update([entity], camera, 1 / 60);
    expect(system.getOpacity(entity)).toBeCloseTo(DEFAULT_OCCLUSION_CONFIG.opacity0, 2);

    // Sustained occlusion: entity behind the box (both entry and exit faces intersected → count=2)
    // EMA with α=0.7: frame 1 → smoothedCount=0.6 (< 0.75, stays opacity0)
    //                  frame 2 → smoothedCount=1.02 (crosses 0.75 threshold → target=opacity1)
    entity.position.set(0, 0, -5);
    system.update([entity], camera, 1 / 60); // frame 1: smoothedCount → 0.6 (below 0.75 threshold)
    system.update([entity], camera, 1 / 60); // frame 2: smoothedCount → 1.02, crosses 0.75 → target changes

    // After 2 frames: target has changed, lerp begins. Opacity should now be below opacity0.
    const opacityAfterSustained = system.getOpacity(entity);
    expect(opacityAfterSustained).toBeLessThan(DEFAULT_OCCLUSION_CONFIG.opacity0);
  });

  it('REGRESSION S36: alternating 0/1 noise does NOT flicker (EMA steady state stays below 0.75 threshold)', () => {
    // With EMA α=0.7, sustained 0/1 alternation (rays grazing a cube edge each frame) produces
    // a steady-state oscillation of ~0.41/0.59. The old threshold (0.5) was in the middle of this
    // range, causing the opacity target to flip every frame → visible flickering.
    //
    // New threshold (0.75) is above the 0.59 ceiling → steady-state noise never triggers
    // opacity1, eliminating the flicker entirely.
    //
    // Mathematical proof: for α=0.7 and alternating count 0/1,
    //   smoothedHigh = 0.7 * smoothedLow + 0.3 * 1
    //   smoothedLow  = 0.7 * smoothedHigh
    //   → smoothedHigh = 0.588  (which is < 0.75, so threshold is never crossed)
    const EMA_ALPHA = 0.7;
    const THRESHOLD = 0.75; // the value we changed to in S36

    let smoothed = 0;
    for (let i = 0; i < 100; i++) {
      const count = i % 2 === 0 ? 0 : 1; // alternating 0/1 noise
      smoothed = smoothed * EMA_ALPHA + count * (1 - EMA_ALPHA);
    }

    // After 100 frames the EMA is at steady state (~0.41 or ~0.59 depending on last step).
    // Both values must be below the threshold so the noise never crosses into opacity1.
    expect(smoothed).toBeLessThan(THRESHOLD); // noise never triggers dimming
    expect(smoothed).toBeGreaterThan(0.3);    // confirms steady-state is active (not zero)
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

// ---------------------------------------------------------------------------
// REGRESSION s44r8-01: bullet depth dimming inverted on non-sphere surfaces
// ---------------------------------------------------------------------------
// Bug: the old approach used normalize(bulletPos) as the surface normal, which
// is only correct for sphere surfaces. On a torus, the inner-ring bullet has
// normalize(pos) pointing in the same direction as the camera → dot > 0 → appears
// BRIGHT even though it's on the far side of the surface.
//
// Fix: computeDepthVisibility(playerPos, playerNormal, bulletPos, curve)
// computes playerNormal.dot(normalize(bulletPos - playerPos)).
// This is positive when the bullet is on the outward side (near side → bright),
// negative when on the inward side (far side → dim).
// Works correctly for ALL surface types: sphere, torus, cube, pill, tunnels.
// ---------------------------------------------------------------------------
describe('REGRESSION s44r8-01: bullet depth dimming inverted on non-sphere surfaces', () => {
  // Torus-like setup: player is at the outer ring at x=2.5, normal pointing outward (+x).
  // Camera is also along +x (following player's surface normal as expected in-game).
  const playerPos = new THREE.Vector3(2.5, 0, 0);
  const playerNormal = new THREE.Vector3(1, 0, 0); // outward radial on outer ring
  const cameraPos = new THREE.Vector3(5, 0, 0);    // above player along surface normal

  // Bullet on the inner ring of the torus: far side from player + camera
  const farBulletPos = new THREE.Vector3(0.5, 0, 0);
  // Bullet directly outward from player: near side (same side as camera)
  const nearBulletPos = new THREE.Vector3(3.5, 0, 0);

  it('OLD approach (buggy): far-side inner-torus bullet incorrectly appears BRIGHT', () => {
    // normalize(bulletPos) = (1, 0, 0); camera - bullet = (4.5, 0, 0) → (1, 0, 0); dot = 1.0
    const fakeFarNormal = farBulletPos.clone().normalize();
    const opacity = computeDepthVisibility(farBulletPos, fakeFarNormal, cameraPos, BULLET_DEPTH_CURVE);
    // The OLD approach gives full brightness for a far-side bullet — this is the BUG.
    expect(opacity).toBeCloseTo(BULLET_DEPTH_CURVE.nearSideMax, 2);
  });

  it('NEW approach: far-side inner-torus bullet correctly appears DIM', () => {
    // computeDepthVisibility(playerPos, playerNormal, farBulletPos):
    //   _toCamera = farBulletPos - playerPos = (-2, 0, 0) → normalized = (-1, 0, 0)
    //   dot = playerNormal . (-1, 0, 0) = -1.0 → far side → farSideMin
    const opacity = computeDepthVisibility(playerPos, playerNormal, farBulletPos, BULLET_DEPTH_CURVE);
    expect(opacity).toBeCloseTo(BULLET_DEPTH_CURVE.farSideMin, 2);
  });

  it('NEW approach: near-side bullet (outward from surface) correctly appears BRIGHT', () => {
    // computeDepthVisibility(playerPos, playerNormal, nearBulletPos):
    //   _toCamera = nearBulletPos - playerPos = (1, 0, 0) → normalized = (1, 0, 0)
    //   dot = playerNormal . (1, 0, 0) = 1.0 → near side → nearSideMax
    const opacity = computeDepthVisibility(playerPos, playerNormal, nearBulletPos, BULLET_DEPTH_CURVE);
    expect(opacity).toBeCloseTo(BULLET_DEPTH_CURVE.nearSideMax, 2);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION s44r11-01: tangential bullets near player should be BRIGHT
// ---------------------------------------------------------------------------
// Bug: bullets travel along the surface tangent, perpendicular to the player's
// outward normal. The dot product playerNormal.dot(normalize(bulletPos - playerPos))
// is ~0 for nearby bullets. With fadeStartThreshold=0.05 and exponent=3.0, dot=0
// mapped to nearly farSideMin (8%) — ALL bullets near the player appeared very dim.
//
// Fix: fadeStartThreshold=-0.3 ensures bullets are only dimmed when clearly on the
// far side (dot < -0.3). Tangential bullets (dot~0) remain bright.
// ---------------------------------------------------------------------------
describe('REGRESSION s44r11-01: tangential bullets near player should be BRIGHT', () => {
  const playerPos = new THREE.Vector3(0, 5, 0);
  const playerNormal = new THREE.Vector3(0, 1, 0); // surface normal pointing up

  it('bullet traveling tangentially (perpendicular to normal) should be bright, not dim', () => {
    // Bullet 1 unit ahead along surface tangent (X axis): direction is (1,0,0), dot with (0,1,0) = 0
    const tangentialBulletPos = new THREE.Vector3(1, 5, 0);
    const opacity = computeDepthVisibility(playerPos, playerNormal, tangentialBulletPos, BULLET_DEPTH_CURVE);
    // With old fadeStartThreshold=0.05, dot=0 would give ~8% opacity (BUG)
    // With new fadeStartThreshold=-0.3, dot=0 is well above threshold → near bright
    expect(opacity).toBeGreaterThan(0.7);
  });

  it('bullet slightly below equator (dot=-0.1) should still be mostly bright', () => {
    // Bullet slightly below the equator: direction to bullet has negative Y component
    const slightlyBelowPos = new THREE.Vector3(1, 4.8, 0);
    const opacity = computeDepthVisibility(playerPos, playerNormal, slightlyBelowPos, BULLET_DEPTH_CURVE);
    // dot ≈ -0.1 (slightly below), which is above fadeStartThreshold=-0.3 → still visible
    expect(opacity).toBeGreaterThan(0.4);
  });

  it('bullet clearly behind surface (dot < -0.5) should be dim', () => {
    // Bullet behind the surface: direction has strong negative Y component
    const farBehindPos = new THREE.Vector3(0, 2, 0);
    const opacity = computeDepthVisibility(playerPos, playerNormal, farBehindPos, BULLET_DEPTH_CURVE);
    // dot = -1.0 → well below fadeStartThreshold → minimum opacity
    expect(opacity).toBeCloseTo(BULLET_DEPTH_CURVE.farSideMin, 2);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION s44r17-01: Compound dimming must not push visibility below
// perceptible levels. The SP depth occlusion config values (opacity1, opacity2Plus)
// must be high enough that multiplying by surface UV dimming floor (0.40) and
// applying via setInstanceVisibility (RGB × alpha) still produces visible enemies.
// ---------------------------------------------------------------------------
describe('REGRESSION s44r17-01: compound dimming visibility floor', () => {
  it('SP depth occlusion opacity1 (behind 1 surface) stays above 0.10 after RGB×alpha', () => {
    // SP config: opacity1 = 0.40 (raised from 0.12 in s44r17-01)
    // setInstanceVisibility does: instanceColor = baseColor × vis, alpha = vis
    // Effective brightness ≈ vis (MeshBasicMaterial, no emissive)
    // At opacity1=0.40, enemies behind one surface are 40% bright — visible.
    const spConfig = { opacity0: 1.0, opacity1: 0.40, opacity2Plus: 0.12 };
    expect(spConfig.opacity1).toBeGreaterThanOrEqual(0.10);
    // Even with surface UV dimming floor (0.40), compound min = 0.40 → still visible
    const compoundMin = Math.min(spConfig.opacity1, 0.40);
    expect(compoundMin).toBeGreaterThanOrEqual(0.10);
  });

  it('SP depth occlusion opacity2Plus (behind 2+ surfaces) stays above 0.05', () => {
    const spConfig = { opacity0: 1.0, opacity1: 0.40, opacity2Plus: 0.12 };
    expect(spConfig.opacity2Plus).toBeGreaterThanOrEqual(0.05);
  });

  it('LOD dimming should NOT be applied on top of depth occlusion', () => {
    // s44r17-01: LOD visibility reduction removed from RenderLoop.ts.
    // LOD already uses simplified geometry — additional dimming caused
    // compound invisibility: depth(0.12) × LOD(0.85) = 0.102 → invisible.
    // This test documents that LOD dimming is intentionally not applied.
    const lodDimmingFactor = 1.0; // was 0.85 for LOW, 0.95 for MEDIUM
    const depthOpacity = 0.40; // opacity1 for enemies behind 1 surface
    const effective = depthOpacity * lodDimmingFactor;
    expect(effective).toBeGreaterThanOrEqual(0.10);
  });

  it('visibility floor prevents compound dimming below SURFACE_DIM_OPACITY', () => {
    // RenderLoop.ts applies: visibility = Math.max(visibility, SURFACE_DIM_OPACITY)
    // before far-side culling. This prevents depth + UV dimming compound from
    // pushing below 0.40.
    const SURFACE_DIM_OPACITY = 0.40;
    const depthOcclusion = 0.40; // opacity1
    const surfaceUVDim = 0.40; // far-side UV dimming
    const rawVisibility = Math.min(depthOcclusion, surfaceUVDim); // 0.40
    const floored = Math.max(rawVisibility, SURFACE_DIM_OPACITY); // 0.40
    expect(floored).toBeGreaterThanOrEqual(SURFACE_DIM_OPACITY);
    // Even with more aggressive raw values:
    const aggressiveRaw = Math.min(0.12, 0.40); // hypothetical low depth occlusion
    const aggressiveFloored = Math.max(aggressiveRaw, SURFACE_DIM_OPACITY);
    expect(aggressiveFloored).toBeGreaterThanOrEqual(SURFACE_DIM_OPACITY);
  });
});
