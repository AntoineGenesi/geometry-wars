/**
 * Aura Surface Projection Tests
 *
 * Verifies that the aura ring follows the surface contour instead of floating
 * as a flat disc. Tests across multiple surface types (sphere, cube, torus, etc.)
 * to ensure the projected ring vertices lie on or very near the surface.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { MeshSurface } from '../surfaces/MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';
import { AuraManager } from '../multiplayer/AuraSystem';
import { KillTracker } from '../multiplayer/KillTracker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAYER_MOVE_SPEED = 3.0;

/** Max allowed distance from an aura vertex to the surface (world units).
 *  The offset is 0.05, so projected points should be ~0.05 above the surface. */
const SURFACE_TOLERANCE = 0.15;

// ---------------------------------------------------------------------------
// Surface configs
// ---------------------------------------------------------------------------

interface TestSurfaceConfig {
  name: string;
  type: SurfaceType;
  startAbove: THREE.Vector3;
}

const TEST_SURFACES: TestSurfaceConfig[] = [
  { name: 'Sphere', type: 'sphere', startAbove: new THREE.Vector3(0, 20, 0) },
  { name: 'Cube', type: 'cube', startAbove: new THREE.Vector3(0, 15, 0) },
  { name: 'Torus', type: 'torus', startAbove: new THREE.Vector3(8.5, 5, 0) },
  { name: 'Pill', type: 'pill', startAbove: new THREE.Vector3(8, 0, 0) },
  { name: 'Peanut', type: 'peanut', startAbove: new THREE.Vector3(0, 15, 0) },
  { name: 'Capsule', type: 'capsule', startAbove: new THREE.Vector3(8, 0, 0) },
  { name: 'Icosahedron', type: 'icosahedron', startAbove: new THREE.Vector3(0, 20, 0) },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestSetup(surfaceType: SurfaceType, startAbove: THREE.Vector3) {
  const surface = SurfaceFactory.create(surfaceType);
  const mesh = surface.mesh;
  if (!mesh.geometry.getAttribute('normal')) {
    mesh.geometry.computeVertexNormals();
  }
  mesh.updateMatrixWorld(true);

  const meshSurface = new MeshSurface(mesh);
  const walker = new MeshWalker(meshSurface, startAbove, PLAYER_MOVE_SPEED);

  return { surface, meshSurface, walker };
}

/** Create a KillTracker with a player pre-loaded to a specific kill count */
function createKillTrackerWithKills(playerId: number, killCount: number): KillTracker {
  const tracker = new KillTracker();
  // Pre-populate stats by getting the stats object and mutating it
  const stats = tracker.getPlayerStats(playerId);
  stats.kills = killCount;
  stats.totalKillAssists = killCount;
  return tracker;
}

/** Extract all vertex positions from a mesh's geometry */
function getVertexPositions(mesh: THREE.Mesh): THREE.Vector3[] {
  const geo = mesh.geometry;
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  if (!posAttr) return [];

  const positions: THREE.Vector3[] = [];
  for (let i = 0; i < posAttr.count; i++) {
    positions.push(new THREE.Vector3(
      posAttr.getX(i),
      posAttr.getY(i),
      posAttr.getZ(i),
    ));
  }
  return positions;
}

/** Compute distance from a point to the nearest surface point */
function distanceToSurface(meshSurface: MeshSurface, point: THREE.Vector3): number {
  const result = meshSurface.closestPointOnSurface(point);
  if (!result) return Infinity;
  return result.point.distanceTo(point);
}

// ==========================================================================
// TESTS
// ==========================================================================

describe('Aura Surface Projection', () => {
  // -----------------------------------------------------------------------
  // Basic functionality
  // -----------------------------------------------------------------------

  describe('AuraManager API', () => {
    it('accepts a MeshSurface via setMeshSurface()', () => {
      const { meshSurface } = createTestSetup('sphere', new THREE.Vector3(0, 20, 0));
      const auraManager = new AuraManager();
      // Should not throw
      auraManager.setMeshSurface(meshSurface);
      auraManager.dispose();
    });

    it('creates projected ring meshes when tier changes', () => {
      const { meshSurface, walker } = createTestSetup('sphere', new THREE.Vector3(0, 20, 0));
      const auraManager = new AuraManager();
      auraManager.setMeshSurface(meshSurface);
      auraManager.registerPlayer(0);

      // Force tier to 1 (10 kills)
      const killTracker = createKillTrackerWithKills(0, 10);
      const walkers = new Map<number, MeshWalker>([[0, walker]]);
      const lives = new Map<number, number>([[0, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);

      // The root group should have children (the projected ring mesh)
      expect(auraManager.root.children.length).toBeGreaterThan(0);

      auraManager.dispose();
    });

    it('creates two rings at tier 3+ (inner + outer)', () => {
      const { meshSurface, walker } = createTestSetup('sphere', new THREE.Vector3(0, 20, 0));
      const auraManager = new AuraManager();
      auraManager.setMeshSurface(meshSurface);
      auraManager.registerPlayer(0);

      // Force tier to 3 (50 kills)
      const killTracker = createKillTrackerWithKills(0, 50);
      const walkers = new Map<number, MeshWalker>([[0, walker]]);
      const lives = new Map<number, number>([[0, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);

      // Should have 2 rings: outer + inner
      expect(auraManager.root.children.length).toBe(2);

      auraManager.dispose();
    });

    it('has no ring children at tier 0', () => {
      const { meshSurface, walker } = createTestSetup('sphere', new THREE.Vector3(0, 20, 0));
      const auraManager = new AuraManager();
      auraManager.setMeshSurface(meshSurface);
      auraManager.registerPlayer(0);

      const killTracker = createKillTrackerWithKills(0, 0);
      const walkers = new Map<number, MeshWalker>([[0, walker]]);
      const lives = new Map<number, number>([[0, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);

      expect(auraManager.root.children.length).toBe(0);

      auraManager.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Surface projection: vertices lie on the surface
  // -----------------------------------------------------------------------

  describe('Ring vertices follow surface contour', () => {
    for (const config of TEST_SURFACES) {
      it(`${config.name}: all aura vertices are near the surface`, () => {
        const { meshSurface, walker } = createTestSetup(config.type, config.startAbove);
        const auraManager = new AuraManager();
        auraManager.setMeshSurface(meshSurface);
        auraManager.registerPlayer(0);

        // Force tier 1 (outer ring only)
        const killTracker = createKillTrackerWithKills(0, 10);
        const walkers = new Map<number, MeshWalker>([[0, walker]]);
        const lives = new Map<number, number>([[0, 3]]);

        auraManager.update(0.016, walkers, killTracker, lives);

        // Get the ring mesh from the root group
        expect(auraManager.root.children.length).toBeGreaterThan(0);
        const ringMesh = auraManager.root.children[0] as THREE.Mesh;
        const vertices = getVertexPositions(ringMesh);

        expect(vertices.length).toBeGreaterThan(0);

        // Every vertex should be close to the surface
        let maxDist = 0;
        for (const v of vertices) {
          const dist = distanceToSurface(meshSurface, v);
          maxDist = Math.max(maxDist, dist);
        }

        expect(maxDist).toBeLessThan(SURFACE_TOLERANCE);
      });
    }
  });

  // -----------------------------------------------------------------------
  // Curvature: ring is NOT flat (follows curvature of sphere/torus)
  // -----------------------------------------------------------------------

  describe('Ring follows curvature (not flat)', () => {
    it('Sphere: ring vertices are at different distances from center than a flat ring would be', () => {
      const { meshSurface, walker } = createTestSetup('sphere', new THREE.Vector3(0, 20, 0));
      const auraManager = new AuraManager();
      auraManager.setMeshSurface(meshSurface);
      auraManager.registerPlayer(0);

      const killTracker = createKillTrackerWithKills(0, 25); // tier 2, radius=4
      const walkers = new Map<number, MeshWalker>([[0, walker]]);
      const lives = new Map<number, number>([[0, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);

      const ringMesh = auraManager.root.children[0] as THREE.Mesh;
      const vertices = getVertexPositions(ringMesh);

      // On a sphere, projected ring vertices should be closer to the sphere center
      // than if they were flat. A flat ring at radius 4 from the player position
      // would have distance from origin = sqrt(R^2 + 4^2) if R is the sphere radius.
      // A surface-projected ring should have all vertices at approximately sphere radius.
      const center = meshSurface.getCenter();
      const playerDistFromCenter = walker.position.distanceTo(center);

      // Get surface radius estimate from player position
      const surfaceRadius = playerDistFromCenter;

      // All ring outer vertices should be at approximately the surface radius from center
      // (because they are projected onto the sphere)
      const outerVertices = vertices.filter((_v, i) => i % 2 === 1); // odd indices = outer
      for (const v of outerVertices) {
        const distFromCenter = v.distanceTo(center);
        // Should be within surface offset tolerance of the surface radius
        expect(Math.abs(distFromCenter - surfaceRadius)).toBeLessThan(SURFACE_TOLERANCE);
      }

      auraManager.dispose();
    });

    it('Torus: ring vertices follow the tube curvature', () => {
      const { meshSurface, walker } = createTestSetup('torus', new THREE.Vector3(8.5, 5, 0));
      const auraManager = new AuraManager();
      auraManager.setMeshSurface(meshSurface);
      auraManager.registerPlayer(0);

      const killTracker = createKillTrackerWithKills(0, 10); // tier 1, radius=3
      const walkers = new Map<number, MeshWalker>([[0, walker]]);
      const lives = new Map<number, number>([[0, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);

      const ringMesh = auraManager.root.children[0] as THREE.Mesh;
      const vertices = getVertexPositions(ringMesh);

      // All vertices should be on the surface
      for (const v of vertices) {
        const dist = distanceToSurface(meshSurface, v);
        expect(dist).toBeLessThan(SURFACE_TOLERANCE);
      }

      // Ring vertices should NOT all be coplanar (they follow the torus tube).
      // Check by fitting a plane to all vertices and measuring max deviation.
      // On a torus tube, the ring should wrap around the tube surface, producing
      // significant deviation from any flat plane.
      const center = walker.position;
      const normal = walker.normal;
      let maxPlaneDeviation = 0;
      for (const v of vertices) {
        const offset = v.clone().sub(center);
        const deviation = Math.abs(offset.dot(normal));
        maxPlaneDeviation = Math.max(maxPlaneDeviation, deviation);
      }

      // On a torus with tube radius ~3 and aura radius 3, the ring should wrap
      // significantly around the tube, giving > 0.1 deviation from the tangent plane
      expect(maxPlaneDeviation).toBeGreaterThan(0.05);

      auraManager.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Cube edge behavior: aura bends around edges
  // -----------------------------------------------------------------------

  describe('Cube edge behavior', () => {
    it('Cube: ring vertices near an edge project onto adjacent face (not into air)', () => {
      const { meshSurface, walker } = createTestSetup('cube', new THREE.Vector3(0, 15, 0));
      const auraManager = new AuraManager();
      auraManager.setMeshSurface(meshSurface);
      auraManager.registerPlayer(0);

      // Use a large radius to ensure some ring segments cross the cube edge
      const killTracker = createKillTrackerWithKills(0, 120); // tier 5, radius=7
      const walkers = new Map<number, MeshWalker>([[0, walker]]);
      const lives = new Map<number, number>([[0, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);

      const ringMesh = auraManager.root.children[0] as THREE.Mesh;
      const vertices = getVertexPositions(ringMesh);

      // Every vertex should still be on the surface, even if the ring crosses an edge
      for (const v of vertices) {
        const dist = distanceToSurface(meshSurface, v);
        expect(dist).toBeLessThan(SURFACE_TOLERANCE);
      }

      auraManager.dispose();
    });

    it('Cube: ring normals span a wider angular range than a single-face flat ring', () => {
      const { meshSurface, walker } = createTestSetup('cube', new THREE.Vector3(0, 15, 0));
      const auraManager = new AuraManager();
      auraManager.setMeshSurface(meshSurface);
      auraManager.registerPlayer(0);

      // Large radius to cross beveled edges
      const killTracker = createKillTrackerWithKills(0, 120); // tier 5, radius=7
      const walkers = new Map<number, MeshWalker>([[0, walker]]);
      const lives = new Map<number, number>([[0, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);

      const ringMesh = auraManager.root.children[0] as THREE.Mesh;
      const geo = ringMesh.geometry;
      const normAttr = geo.getAttribute('normal') as THREE.BufferAttribute;

      // Compute the angular spread of normals: find the max angle between
      // any normal and the player's surface normal (top face, roughly +Y).
      // On a flat ring all normals would be identical; on a cube with beveled
      // edges, ring vertices that cross the bevel have tilted normals.
      const playerNormal = walker.normal.clone().normalize();
      let maxAngle = 0;
      const tempNorm = new THREE.Vector3();
      for (let i = 0; i < normAttr.count; i++) {
        tempNorm.set(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i)).normalize();
        const dot = Math.min(1, Math.max(-1, tempNorm.dot(playerNormal)));
        const angle = Math.acos(dot);
        maxAngle = Math.max(maxAngle, angle);
      }

      // With radius=7 on a cube of halfSize=9 with bevel=2.7, ring segments
      // should reach the beveled edge, producing normals tilted away from +Y.
      // The bevel has smooth vertex-interpolated normals, so the tilt is gradual.
      // A flat ring would have maxAngle exactly 0. Any positive angle proves
      // the ring crosses onto the bevel and picks up surface curvature.
      const maxAngleDeg = (maxAngle * 180) / Math.PI;
      expect(maxAngleDeg).toBeGreaterThan(0.1);

      auraManager.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Fallback: works without MeshSurface (flat ring behavior)
  // -----------------------------------------------------------------------

  describe('Fallback without MeshSurface', () => {
    it('ring is created even without setMeshSurface() (flat fallback)', () => {
      const { walker } = createTestSetup('sphere', new THREE.Vector3(0, 20, 0));
      const auraManager = new AuraManager();
      // Deliberately NOT calling setMeshSurface
      auraManager.registerPlayer(0);

      const killTracker = createKillTrackerWithKills(0, 10);
      const walkers = new Map<number, MeshWalker>([[0, walker]]);
      const lives = new Map<number, number>([[0, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);

      // Should still create a ring (flat fallback)
      expect(auraManager.root.children.length).toBeGreaterThan(0);

      auraManager.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Dispose
  // -----------------------------------------------------------------------

  describe('Cleanup', () => {
    it('dispose() removes all ring meshes from root', () => {
      const { meshSurface, walker } = createTestSetup('sphere', new THREE.Vector3(0, 20, 0));
      const auraManager = new AuraManager();
      auraManager.setMeshSurface(meshSurface);
      auraManager.registerPlayer(0);
      auraManager.registerPlayer(1);

      const walker2 = new MeshWalker(meshSurface, new THREE.Vector3(5, 20, 0), PLAYER_MOVE_SPEED);

      const killTracker = createKillTrackerWithKills(0, 50);
      killTracker.getPlayerStats(1).kills = 50;
      killTracker.getPlayerStats(1).totalKillAssists = 50;

      const walkers = new Map<number, MeshWalker>([[0, walker], [1, walker2]]);
      const lives = new Map<number, number>([[0, 3], [1, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);
      expect(auraManager.root.children.length).toBeGreaterThan(0);

      auraManager.dispose();
      expect(auraManager.root.children.length).toBe(0);
    });

    it('registerPlayer() cleans up old rings before creating new state', () => {
      const { meshSurface, walker } = createTestSetup('sphere', new THREE.Vector3(0, 20, 0));
      const auraManager = new AuraManager();
      auraManager.setMeshSurface(meshSurface);
      auraManager.registerPlayer(0);

      const killTracker = createKillTrackerWithKills(0, 10);
      const walkers = new Map<number, MeshWalker>([[0, walker]]);
      const lives = new Map<number, number>([[0, 3]]);

      // Create rings
      auraManager.update(0.016, walkers, killTracker, lives);
      const childCount = auraManager.root.children.length;
      expect(childCount).toBeGreaterThan(0);

      // Re-register same player
      auraManager.registerPlayer(0);

      // Old rings should be removed, new state has no rings (tier 0)
      // After re-register, tier resets to 0 so update should create ring again
      auraManager.update(0.016, walkers, killTracker, lives);
      expect(auraManager.root.children.length).toBe(childCount);

      auraManager.dispose();
    });
  });

  // -----------------------------------------------------------------------
  // Buff logic preserved
  // -----------------------------------------------------------------------

  describe('Buff logic still works', () => {
    it('buff computation is unchanged (inner/outer radius check)', () => {
      const { meshSurface } = createTestSetup('sphere', new THREE.Vector3(0, 20, 0));
      const auraManager = new AuraManager();
      auraManager.setMeshSurface(meshSurface);

      // Two players
      auraManager.registerPlayer(0);
      auraManager.registerPlayer(1);

      // Player 0 at tier 3 (50 kills, outer=5, inner=2.5)
      const killTracker = new KillTracker();
      killTracker.getPlayerStats(0).kills = 50;
      killTracker.getPlayerStats(0).totalKillAssists = 50;

      // Create walkers close together (dist=2.0, inside inner ring of 2.5)
      const walker0 = new MeshWalker(meshSurface, new THREE.Vector3(0, 20, 0), PLAYER_MOVE_SPEED);
      const walker1 = new MeshWalker(meshSurface, new THREE.Vector3(1, 20, 1), PLAYER_MOVE_SPEED);

      const walkers = new Map<number, MeshWalker>([[0, walker0], [1, walker1]]);
      const lives = new Map<number, number>([[0, 3], [1, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);

      // Player 1 should receive inner buff from player 0
      const buff = auraManager.getBuffForPlayer(1);
      expect(buff.damageMultiplier).toBeGreaterThan(1.0);

      auraManager.dispose();
    });

    it('getTier() returns correct tier', () => {
      const auraManager = new AuraManager();
      auraManager.registerPlayer(0);

      const killTracker = createKillTrackerWithKills(0, 25);
      const { walker } = createTestSetup('sphere', new THREE.Vector3(0, 20, 0));
      const walkers = new Map<number, MeshWalker>([[0, walker]]);
      const lives = new Map<number, number>([[0, 3]]);

      auraManager.update(0.016, walkers, killTracker, lives);

      expect(auraManager.getTier(0)).toBe(2);

      auraManager.dispose();
    });
  });
});
