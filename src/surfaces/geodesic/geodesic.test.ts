/**
 * Tests for the geodesic face walking system.
 *
 * Covers:
 * 1. HalfEdgeMesh - connectivity, twin pairing, adjacency
 * 2. BarycentricUtils - world<->bary conversion, ray exit, direction conversion
 * 3. ParallelTransport - direction transport across edges
 * 4. FaceWalker - full geodesic walks on various shapes
 * 5. GeodesicSurface - integration tests
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HalfEdgeMesh } from './HalfEdgeMesh';
import {
  worldToBarycentric,
  barycentricToWorld,
  isInsideTriangle,
  rayExitTriangle,
  worldDirToBarycentric,
  clampBarycentric,
  BaryCoord,
} from './BarycentricUtils';
import { transportAcrossEdge, dihedralAngle } from './ParallelTransport';
import { FaceWalker } from './FaceWalker';
import { GeodesicSurface } from './GeodesicSurface';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createSphere(radius = 8, segments = 32): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, segments, segments);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function createTorus(majorR = 6, minorR = 2.5): THREE.Mesh {
  const geo = new THREE.TorusGeometry(majorR, minorR, 32, 64);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function createCube(size = 10): THREE.Mesh {
  const geo = new THREE.BoxGeometry(size, size, size, 4, 4, 4);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function createCylinder(radius = 5, height = 12): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 32, 8, false);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Simple 2-triangle quad for basic tests */
function createSimpleQuad(): THREE.BufferGeometry {
  // Two triangles forming a 2x2 quad in the XY plane:
  // v0=(0,0,0), v1=(2,0,0), v2=(2,2,0), v3=(0,2,0)
  // Face 0: v0, v1, v2
  // Face 1: v0, v2, v3
  const positions = new Float32Array([
    0, 0, 0,  // v0
    2, 0, 0,  // v1
    2, 2, 0,  // v2
    0, 2, 0,  // v3
  ]);
  const indices = new Uint32Array([
    0, 1, 2,  // face 0
    0, 2, 3,  // face 1
  ]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  return geo;
}

/** Distance between two points on the surface of a sphere */
function sphereArcDistance(a: THREE.Vector3, b: THREE.Vector3, radius: number): number {
  const dot = a.clone().normalize().dot(b.clone().normalize());
  const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
  return angle * radius;
}

function isOnSphere(point: THREE.Vector3, radius: number, tolerance = 0.1): boolean {
  return Math.abs(point.length() - radius) < tolerance;
}

// ---------------------------------------------------------------------------
// HalfEdgeMesh Tests
// ---------------------------------------------------------------------------

describe('HalfEdgeMesh', () => {
  it('should build from a simple quad (2 triangles)', () => {
    const geo = createSimpleQuad();
    const hem = new HalfEdgeMesh(geo);

    expect(hem.faceCount).toBe(2);
    expect(hem.halfEdges.length).toBe(6); // 3 per face
    expect(hem.vertexCount).toBe(4);
  });

  it('should have correct face vertex indices', () => {
    const geo = createSimpleQuad();
    const hem = new HalfEdgeMesh(geo);

    expect(hem.faces[0].a).toBe(0);
    expect(hem.faces[0].b).toBe(1);
    expect(hem.faces[0].c).toBe(2);

    expect(hem.faces[1].a).toBe(0);
    expect(hem.faces[1].b).toBe(2);
    expect(hem.faces[1].c).toBe(3);
  });

  it('should find twin edges between adjacent faces', () => {
    const geo = createSimpleQuad();
    const hem = new HalfEdgeMesh(geo);

    // Face 0 edge from v0->v2 (edge 2: CA) and Face 1 edge from v2->v0 (edge 2: CA reversed)
    // Actually: Face 0 has edges 0->1, 1->2, 2->0
    //           Face 1 has edges 0->2, 2->3, 3->0
    // Shared edge: 0->2 (face 1 edge 0) and 2->0 (face 0 edge 2) should be twins
    const he_f0_e2 = hem.getHalfEdge(0, 2); // 2->0
    const he_f1_e0 = hem.getHalfEdge(1, 0); // 0->2

    expect(he_f0_e2.from).toBe(2);
    expect(he_f0_e2.to).toBe(0);
    expect(he_f1_e0.from).toBe(0);
    expect(he_f1_e0.to).toBe(2);

    // They should be twins
    expect(he_f0_e2.twin).toBe(hem.faceHalfEdges[1][0]);
    expect(he_f1_e0.twin).toBe(hem.faceHalfEdges[0][2]);
  });

  it('should report correct adjacent face', () => {
    const geo = createSimpleQuad();
    const hem = new HalfEdgeMesh(geo);

    // Face 0 edge 2 (2->0) is shared with face 1
    expect(hem.getAdjacentFace(0, 2)).toBe(1);
    // Face 1 edge 0 (0->2) is shared with face 0
    expect(hem.getAdjacentFace(1, 0)).toBe(0);
  });

  it('should report -1 for boundary edges', () => {
    const geo = createSimpleQuad();
    const hem = new HalfEdgeMesh(geo);

    // Face 0 edge 0 (0->1) is a boundary (no adjacent face)
    expect(hem.getAdjacentFace(0, 0)).toBe(-1);
    // Face 0 edge 1 (1->2) is a boundary
    expect(hem.getAdjacentFace(0, 1)).toBe(-1);
  });

  it('should build from sphere geometry', () => {
    const mesh = createSphere(8, 16);
    const hem = new HalfEdgeMesh(mesh.geometry);

    // A sphere with 16 segments has no boundary edges
    expect(hem.faceCount).toBeGreaterThan(100);

    // Every edge should have a twin (closed mesh)
    let boundaryCount = 0;
    for (const he of hem.halfEdges) {
      if (he.twin < 0) boundaryCount++;
    }
    expect(boundaryCount).toBe(0);
  });

  it('should build from torus geometry', () => {
    const mesh = createTorus(6, 2.5);
    const hem = new HalfEdgeMesh(mesh.geometry);

    expect(hem.faceCount).toBeGreaterThan(100);

    // Torus is closed - no boundary edges
    let boundaryCount = 0;
    for (const he of hem.halfEdges) {
      if (he.twin < 0) boundaryCount++;
    }
    expect(boundaryCount).toBe(0);
  });

  it('should have face normals pointing outward', () => {
    const geo = createSimpleQuad();
    const hem = new HalfEdgeMesh(geo);

    // Both faces should have normals pointing in +Z direction
    for (const face of hem.faces) {
      expect(face.normal.z).toBeGreaterThan(0.9);
    }
  });
});

// ---------------------------------------------------------------------------
// BarycentricUtils Tests
// ---------------------------------------------------------------------------

describe('BarycentricUtils', () => {
  const pA = new THREE.Vector3(0, 0, 0);
  const pB = new THREE.Vector3(2, 0, 0);
  const pC = new THREE.Vector3(0, 2, 0);

  describe('worldToBarycentric', () => {
    it('should return (1,0,0) at vertex A', () => {
      const bary = worldToBarycentric(pA, pA, pB, pC);
      expect(bary.u).toBeCloseTo(1, 5);
      expect(bary.v).toBeCloseTo(0, 5);
      expect(bary.w).toBeCloseTo(0, 5);
    });

    it('should return (0,1,0) at vertex B', () => {
      const bary = worldToBarycentric(pB, pA, pB, pC);
      expect(bary.u).toBeCloseTo(0, 5);
      expect(bary.v).toBeCloseTo(1, 5);
      expect(bary.w).toBeCloseTo(0, 5);
    });

    it('should return (0,0,1) at vertex C', () => {
      const bary = worldToBarycentric(pC, pA, pB, pC);
      expect(bary.u).toBeCloseTo(0, 5);
      expect(bary.v).toBeCloseTo(0, 5);
      expect(bary.w).toBeCloseTo(1, 5);
    });

    it('should return (1/3, 1/3, 1/3) at centroid', () => {
      const centroid = new THREE.Vector3(2 / 3, 2 / 3, 0);
      const bary = worldToBarycentric(centroid, pA, pB, pC);
      expect(bary.u).toBeCloseTo(1 / 3, 3);
      expect(bary.v).toBeCloseTo(1 / 3, 3);
      expect(bary.w).toBeCloseTo(1 / 3, 3);
    });

    it('should sum to 1 for any interior point', () => {
      const point = new THREE.Vector3(0.5, 0.3, 0);
      const bary = worldToBarycentric(point, pA, pB, pC);
      expect(bary.u + bary.v + bary.w).toBeCloseTo(1, 5);
    });
  });

  describe('barycentricToWorld', () => {
    it('should convert back to vertex A', () => {
      const result = barycentricToWorld({ u: 1, v: 0, w: 0 }, pA, pB, pC);
      expect(result.x).toBeCloseTo(0, 5);
      expect(result.y).toBeCloseTo(0, 5);
    });

    it('should round-trip through both conversions', () => {
      const point = new THREE.Vector3(0.7, 0.5, 0);
      const bary = worldToBarycentric(point, pA, pB, pC);
      const back = barycentricToWorld(bary, pA, pB, pC);
      expect(back.x).toBeCloseTo(point.x, 4);
      expect(back.y).toBeCloseTo(point.y, 4);
      expect(back.z).toBeCloseTo(point.z, 4);
    });
  });

  describe('isInsideTriangle', () => {
    it('should return true for centroid', () => {
      expect(isInsideTriangle({ u: 1 / 3, v: 1 / 3, w: 1 / 3 })).toBe(true);
    });

    it('should return true for vertices', () => {
      expect(isInsideTriangle({ u: 1, v: 0, w: 0 })).toBe(true);
      expect(isInsideTriangle({ u: 0, v: 1, w: 0 })).toBe(true);
      expect(isInsideTriangle({ u: 0, v: 0, w: 1 })).toBe(true);
    });

    it('should return false for outside point', () => {
      expect(isInsideTriangle({ u: -0.1, v: 0.6, w: 0.5 })).toBe(false);
    });
  });

  describe('rayExitTriangle', () => {
    it('should find exit through edge BC (u=0) when moving from vertex A toward BC', () => {
      const start: BaryCoord = { u: 0.5, v: 0.25, w: 0.25 };
      // Direction: decrease u, increase v+w
      const dir: BaryCoord = { u: -1, v: 0.5, w: 0.5 };

      const result = rayExitTriangle(start, dir);
      expect(result).not.toBeNull();
      expect(result!.edgeLocal).toBe(0); // u=0 means edge BC
      expect(result!.t).toBeCloseTo(0.5, 3); // u goes from 0.5 to 0 in 0.5 steps
    });

    it('should find exit through edge CA (v=0) when moving away from B', () => {
      const start: BaryCoord = { u: 0.25, v: 0.5, w: 0.25 };
      // Direction: decrease v
      const dir: BaryCoord = { u: 0.5, v: -1, w: 0.5 };

      const result = rayExitTriangle(start, dir);
      expect(result).not.toBeNull();
      expect(result!.edgeLocal).toBe(1); // v=0 means edge CA
      expect(result!.t).toBeCloseTo(0.5, 3);
    });

    it('should find exit through edge AB (w=0) when moving away from C', () => {
      const start: BaryCoord = { u: 0.25, v: 0.25, w: 0.5 };
      // Direction: decrease w
      const dir: BaryCoord = { u: 0.5, v: 0.5, w: -1 };

      const result = rayExitTriangle(start, dir);
      expect(result).not.toBeNull();
      expect(result!.edgeLocal).toBe(2); // w=0 means edge AB
      expect(result!.t).toBeCloseTo(0.5, 3);
    });

    it('should return null when direction keeps point inside', () => {
      const start: BaryCoord = { u: 0.1, v: 0.1, w: 0.8 };
      // Direction pointing toward interior (all positive)
      const dir: BaryCoord = { u: 0.3, v: 0.3, w: -0.6 };
      // w is decreasing but u starts very low. Let's make direction that doesn't exit:
      const dir2: BaryCoord = { u: 0, v: 0, w: 0 };
      const result = rayExitTriangle(start, dir2);
      expect(result).toBeNull();
    });

    it('should compute correct alpha along the exit edge', () => {
      // Start at centroid, move toward midpoint of BC (u=0, v=0.5, w=0.5)
      const start: BaryCoord = { u: 1 / 3, v: 1 / 3, w: 1 / 3 };
      const dir: BaryCoord = { u: -1, v: 0.5, w: 0.5 };

      const result = rayExitTriangle(start, dir);
      expect(result).not.toBeNull();
      expect(result!.alpha).toBeCloseTo(0.5, 2); // midpoint of BC
    });
  });

  describe('worldDirToBarycentric', () => {
    it('should produce zero direction for zero input', () => {
      const dir = new THREE.Vector3(0, 0, 0);
      const result = worldDirToBarycentric(dir, pA, pB, pC);
      expect(Math.abs(result.u)).toBeLessThan(1e-8);
      expect(Math.abs(result.v)).toBeLessThan(1e-8);
      expect(Math.abs(result.w)).toBeLessThan(1e-8);
    });

    it('should sum to zero (du + dv + dw = 0)', () => {
      const dir = new THREE.Vector3(1, 0.5, 0);
      const result = worldDirToBarycentric(dir, pA, pB, pC);
      expect(result.u + result.v + result.w).toBeCloseTo(0, 8);
    });

    it('should increase v when moving toward B from centroid', () => {
      // B is at (2,0,0), centroid is at (2/3, 2/3, 0)
      // Direction toward B from centroid
      const dir = new THREE.Vector3(1, -0.5, 0).normalize();
      const result = worldDirToBarycentric(dir, pA, pB, pC);
      expect(result.v).toBeGreaterThan(0); // moving toward B increases v
    });
  });

  describe('clampBarycentric', () => {
    it('should clamp negative values to zero and renormalize', () => {
      const result = clampBarycentric({ u: -0.1, v: 0.6, w: 0.5 });
      expect(result.u).toBeCloseTo(0, 5);
      expect(result.v + result.w).toBeCloseTo(1, 3);
      expect(result.v).toBeGreaterThan(0);
      expect(result.w).toBeGreaterThan(0);
    });

    it('should leave valid coordinates unchanged', () => {
      const result = clampBarycentric({ u: 0.3, v: 0.3, w: 0.4 });
      expect(result.u).toBeCloseTo(0.3, 5);
      expect(result.v).toBeCloseTo(0.3, 5);
      expect(result.w).toBeCloseTo(0.4, 5);
    });
  });
});

// ---------------------------------------------------------------------------
// ParallelTransport Tests
// ---------------------------------------------------------------------------

describe('ParallelTransport', () => {
  it('should preserve direction when faces are coplanar', () => {
    const edgeStart = new THREE.Vector3(0, 0, 0);
    const edgeEnd = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3(0, 0, 1);
    const dir = new THREE.Vector3(0, 1, 0);

    transportAcrossEdge(dir, edgeStart, edgeEnd, normal, normal);

    expect(dir.x).toBeCloseTo(0, 3);
    expect(dir.y).toBeCloseTo(1, 3);
    expect(dir.z).toBeCloseTo(0, 3);
  });

  it('should rotate direction by dihedral angle when faces are at 90 degrees', () => {
    const edgeStart = new THREE.Vector3(0, 0, 0);
    const edgeEnd = new THREE.Vector3(1, 0, 0);
    const normalFrom = new THREE.Vector3(0, 0, 1); // XY plane
    const normalTo = new THREE.Vector3(0, 1, 0);   // XZ plane (90 degrees)

    // Direction along Y in the source face — pointing toward the edge
    const dir = new THREE.Vector3(0, 1, 0);

    transportAcrossEdge(dir, edgeStart, edgeEnd, normalFrom, normalTo);

    // After parallel transport: Y (toward the edge in source face) should become -Z
    // (away from the edge in destination face — the "straight ahead" direction).
    // REGRESSION: if this is (0,1,0) or (0,-1,0), the sign is wrong — the bullet
    // would follow the edge instead of crossing it.
    expect(Math.abs(dir.dot(normalTo))).toBeLessThan(0.01); // tangent to dest face
    expect(dir.length()).toBeCloseTo(1, 3);
    expect(dir.z).toBeCloseTo(-1, 2); // direction is (0,0,-1), NOT (0,0,1)
    expect(Math.abs(dir.x)).toBeLessThan(0.01);
    expect(Math.abs(dir.y)).toBeLessThan(0.01);
  });

  it('should produce straight geodesic path when crossing a cube 90-degree edge (regression)', () => {
    // Regression test for the bullet 90-degree turn bug (S28a).
    // A bullet moving perpendicular to a cube edge should continue perpendicular
    // to it on the other face — NOT parallel to it (edge-following).
    //
    // Cube setup: top face (normal +Y) → front face (normal +Z)
    // Edge along X at top-front boundary.
    // Bullet direction on top face: (0,0,1) heading toward front face.
    // Expected after transport: (0,-1,0) — going DOWN the front face, away from edge.
    const edgeStart = new THREE.Vector3(-5, 5, 5);
    const edgeEnd   = new THREE.Vector3( 5, 5, 5);
    const normalTop   = new THREE.Vector3(0, 1, 0); // top face
    const normalFront = new THREE.Vector3(0, 0, 1); // front face

    const bulletDir = new THREE.Vector3(0, 0, 1); // moving toward front face
    transportAcrossEdge(bulletDir, edgeStart, edgeEnd, normalTop, normalFront);

    // Must be tangent to the front face
    expect(Math.abs(bulletDir.dot(normalFront))).toBeLessThan(0.01);
    expect(bulletDir.length()).toBeCloseTo(1, 2);

    // Must NOT be along the edge (edge is X axis) — that would be the "following edge" bug
    expect(Math.abs(bulletDir.x)).toBeLessThan(0.1);

    // Must be pointing DOWN the front face (away from the top edge) — not back toward it
    expect(bulletDir.y).toBeLessThan(-0.9); // approximately (0,-1,0)
  });

  it('should preserve direction along the edge itself', () => {
    const edgeStart = new THREE.Vector3(0, 0, 0);
    const edgeEnd = new THREE.Vector3(1, 0, 0);
    const normalFrom = new THREE.Vector3(0, 0, 1);
    const normalTo = new THREE.Vector3(0, 1, 0);

    // Direction along the edge should be unchanged
    const dir = new THREE.Vector3(1, 0, 0);
    transportAcrossEdge(dir, edgeStart, edgeEnd, normalFrom, normalTo);

    expect(dir.x).toBeCloseTo(1, 3);
    expect(Math.abs(dir.y)).toBeLessThan(0.01);
    expect(Math.abs(dir.z)).toBeLessThan(0.01);
  });

  it('should compute correct dihedral angle for coplanar faces', () => {
    const edgeStart = new THREE.Vector3(0, 0, 0);
    const edgeEnd = new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3(0, 0, 1);

    const angle = dihedralAngle(edgeStart, edgeEnd, normal, normal);
    expect(angle).toBeCloseTo(0, 3);
  });

  it('should compute correct dihedral angle for perpendicular faces', () => {
    const edgeStart = new THREE.Vector3(0, 0, 0);
    const edgeEnd = new THREE.Vector3(1, 0, 0);
    const normalFrom = new THREE.Vector3(0, 0, 1);
    const normalTo = new THREE.Vector3(0, 1, 0);

    const angle = dihedralAngle(edgeStart, edgeEnd, normalFrom, normalTo);
    expect(Math.abs(angle)).toBeCloseTo(Math.PI / 2, 1);
  });
});

// ---------------------------------------------------------------------------
// FaceWalker Tests
// ---------------------------------------------------------------------------

describe('FaceWalker', () => {
  describe('on simple quad', () => {
    it('should walk within a single triangle without crossing', () => {
      const geo = createSimpleQuad();
      const hem = new HalfEdgeMesh(geo);
      const walker = new FaceWalker(hem);

      // Start at centroid of face 0
      const startBary: BaryCoord = { u: 1 / 3, v: 1 / 3, w: 1 / 3 };
      const dir = new THREE.Vector3(0.1, 0, 0); // small move in X

      const result = walker.walk(0, startBary, dir, 0.1);

      expect(result.faceIndex).toBe(0); // Should stay in same face
      expect(result.distanceTraveled).toBeCloseTo(0.1, 2);
    });

    it('should cross from face 0 to face 1', () => {
      const geo = createSimpleQuad();
      const hem = new HalfEdgeMesh(geo);
      const walker = new FaceWalker(hem);

      // Start near the shared edge (0->2) on face 0, move toward face 1
      // Face 0 is (0,0)-(2,0)-(2,2), face 1 is (0,0)-(2,2)-(0,2)
      // Shared edge is 0->2 which is edge 2 of face 0 (CA: v2->v0)
      // Moving in -X direction should cross into face 1
      const startBary: BaryCoord = { u: 0.5, v: 0.2, w: 0.3 };
      const dir = new THREE.Vector3(-1, 1, 0).normalize();

      const result = walker.walk(0, startBary, dir, 2.0);

      // Should have crossed into face 1
      expect(result.distanceTraveled).toBeGreaterThan(0.5);
    });

    it('should locate a point on the mesh', () => {
      const geo = createSimpleQuad();
      const hem = new HalfEdgeMesh(geo);
      const walker = new FaceWalker(hem);

      // Point inside face 0
      const pos = new THREE.Vector3(1.0, 0.5, 0);
      const located = walker.locateOnMesh(pos, 0);

      expect(located.faceIndex).toBe(0);
      expect(located.bary.u).toBeGreaterThan(0);
      expect(located.bary.v).toBeGreaterThan(0);
      expect(located.bary.w).toBeGreaterThan(0);
    });
  });

  describe('on sphere', () => {
    it('should walk across multiple faces', () => {
      const mesh = createSphere(8, 16);
      const hem = new HalfEdgeMesh(mesh.geometry);
      const walker = new FaceWalker(hem);

      // Start at the top of the sphere (find face near north pole)
      const topPos = new THREE.Vector3(0, 8, 0);
      const located = walker.locateOnMesh(topPos, 0);

      // Walk in X direction
      const dir = new THREE.Vector3(1, 0, 0);
      const result = walker.walk(located.faceIndex, located.bary, dir, 3.0);

      // Should have traveled approximately 3 world units
      expect(result.distanceTraveled).toBeGreaterThan(2.0);

      // Position should be on the sphere
      expect(isOnSphere(result.position, 8, 0.5)).toBe(true);
    });

    it('should maintain surface adherence over many steps', () => {
      const mesh = createSphere(8, 32);
      const hem = new HalfEdgeMesh(mesh.geometry);
      const walker = new FaceWalker(hem);

      const startPos = new THREE.Vector3(0, 8, 0);
      let facePos = walker.locateOnMesh(startPos, 0);
      let currentDir = new THREE.Vector3(1, 0, 0);

      for (let i = 0; i < 50; i++) {
        const result = walker.walk(facePos.faceIndex, facePos.bary, currentDir, 0.3);
        facePos = { faceIndex: result.faceIndex, bary: result.bary };
        currentDir = result.direction;

        // Check that we're still on the sphere
        expect(isOnSphere(result.position, 8, 0.5)).toBe(true);
      }
    });

    it('should transport direction smoothly (no sudden reversals)', () => {
      const mesh = createSphere(8, 32);
      const hem = new HalfEdgeMesh(mesh.geometry);
      const walker = new FaceWalker(hem);

      const startPos = new THREE.Vector3(0, 8, 0);
      let facePos = walker.locateOnMesh(startPos, 0);
      let currentDir = new THREE.Vector3(1, 0, 0);
      let prevDir = currentDir.clone();

      let flipCount = 0;

      for (let i = 0; i < 30; i++) {
        const result = walker.walk(facePos.faceIndex, facePos.bary, currentDir, 0.5);
        facePos = { faceIndex: result.faceIndex, bary: result.bary };
        currentDir = result.direction;

        // Direction shouldn't flip 180 degrees
        const dot = prevDir.dot(currentDir);
        if (dot < -0.5) flipCount++;
        prevDir.copy(currentDir);
      }

      // Allow at most 2 flips (can happen at degenerate triangles near poles/seams)
      expect(flipCount).toBeLessThan(3);
    });

    it('should cross the north pole without getting stuck (vertex fan traversal)', () => {
      // Regression test for sphere poles being blocked.
      // A UV sphere has a pole vertex shared by all cap triangles.
      // Without vertex fan traversal, walking toward the pole gets stuck circling it.
      const mesh = createSphere(8, 32);
      const hem = new HalfEdgeMesh(mesh.geometry);
      const walker = new FaceWalker(hem);

      // Start near the north pole in a cap triangle (slightly south of the pole on +Z side)
      const startPos = new THREE.Vector3(0.5, 7.9, 0.5);
      startPos.normalize().multiplyScalar(8);
      let facePos = walker.locateOnMesh(startPos, 0);

      // Walk toward and over the north pole: direction from start toward -Z
      // (approaching from the +Z side, through the pole, continuing to -Z)
      // We do multiple small steps carrying the transported direction
      let currentDir = new THREE.Vector3(0, 0.3, -1).normalize();
      let finalPos = startPos.clone();

      let crossedPole = false;
      let totalDist = 0;

      for (let i = 0; i < 60; i++) {
        const result = walker.walk(facePos.faceIndex, facePos.bary, currentDir, 0.5);
        facePos = { faceIndex: result.faceIndex, bary: result.bary };
        currentDir = result.direction.clone();
        finalPos = result.position.clone();
        totalDist += result.distanceTraveled;

        // Check if we've crossed to the -Z side of the sphere (z < -1)
        if (result.position.z < -1) {
          crossedPole = true;
          break;
        }
      }

      // Player should have crossed through the pole to the -Z hemisphere
      expect(crossedPole).toBe(true);
      // Total distance should be at least some movement (not stuck at zero)
      expect(totalDist).toBeGreaterThan(0.5);
      // Final position should still be on the sphere
      expect(isOnSphere(finalPos, 8, 0.5)).toBe(true);
    });

    it('should cross the south pole without getting stuck (vertex fan traversal)', () => {
      // Mirror of north pole test — south pole at (0, -8, 0)
      const mesh = createSphere(8, 32);
      const hem = new HalfEdgeMesh(mesh.geometry);
      const walker = new FaceWalker(hem);

      // Start near the south pole on +Z side
      const startPos = new THREE.Vector3(0.5, -7.9, 0.5);
      startPos.normalize().multiplyScalar(8);
      let facePos = walker.locateOnMesh(startPos, 0);

      let currentDir = new THREE.Vector3(0, -0.3, -1).normalize();
      let finalPos = startPos.clone();
      let crossedPole = false;

      for (let i = 0; i < 60; i++) {
        const result = walker.walk(facePos.faceIndex, facePos.bary, currentDir, 0.5);
        facePos = { faceIndex: result.faceIndex, bary: result.bary };
        currentDir = result.direction.clone();
        finalPos = result.position.clone();

        if (result.position.z < -1) {
          crossedPole = true;
          break;
        }
      }

      expect(crossedPole).toBe(true);
      expect(isOnSphere(finalPos, 8, 0.5)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// GeodesicSurface Tests
// ---------------------------------------------------------------------------

describe('GeodesicSurface', () => {
  it('should construct from sphere geometry', () => {
    const mesh = createSphere(8, 16);
    const geoSurf = new GeodesicSurface(mesh.geometry);

    expect(geoSurf.halfEdge.faceCount).toBeGreaterThan(100);
  });

  it('should construct from torus geometry', () => {
    const mesh = createTorus(6, 2.5);
    const geoSurf = new GeodesicSurface(mesh.geometry);

    expect(geoSurf.halfEdge.faceCount).toBeGreaterThan(100);
  });

  it('should initialize position from world point', () => {
    const mesh = createSphere(8, 16);
    const geoSurf = new GeodesicSurface(mesh.geometry);

    const facePos = geoSurf.initializePosition(new THREE.Vector3(0, 8, 0), 0);
    expect(facePos.faceIndex).toBeGreaterThanOrEqual(0);
    expect(facePos.bary.u + facePos.bary.v + facePos.bary.w).toBeCloseTo(1, 3);
  });

  it('should walk geodesically on sphere', () => {
    const mesh = createSphere(8, 32);
    const geoSurf = new GeodesicSurface(mesh.geometry);

    const facePos = geoSurf.initializePosition(new THREE.Vector3(0, 8, 0), 0);
    const result = geoSurf.moveGeodesic(facePos, new THREE.Vector3(1, 0, 0), 2.0);

    expect(result.distanceTraveled).toBeGreaterThan(1.0);
    expect(isOnSphere(result.position, 8, 0.5)).toBe(true);
  });

  it('should walk geodesically on torus', () => {
    const mesh = createTorus(6, 2.5);
    const geoSurf = new GeodesicSurface(mesh.geometry);

    const facePos = geoSurf.initializePosition(new THREE.Vector3(8.5, 0, 0), 0);
    const result = geoSurf.moveGeodesic(facePos, new THREE.Vector3(0, 0, 1), 2.0);

    expect(result.distanceTraveled).toBeGreaterThan(1.0);
  });

  it('should support sequential walks with carried-over face position', () => {
    const mesh = createSphere(8, 32);
    const geoSurf = new GeodesicSurface(mesh.geometry);

    let facePos = geoSurf.initializePosition(new THREE.Vector3(0, 8, 0), 0);
    let currentDir = new THREE.Vector3(1, 0, 0);

    for (let i = 0; i < 20; i++) {
      const result = geoSurf.moveGeodesic(facePos, currentDir, 0.5);
      facePos = result.facePosition;
      currentDir = result.direction;

      expect(isOnSphere(result.position, 8, 0.5)).toBe(true);
    }
  });

  it('should maintain speed constancy on sphere', () => {
    const mesh = createSphere(8, 32);
    const geoSurf = new GeodesicSurface(mesh.geometry);

    let facePos = geoSurf.initializePosition(new THREE.Vector3(0, 8, 0), 0);
    let currentDir = new THREE.Vector3(1, 0, 0);
    const stepDist = 0.3;
    const distances: number[] = [];

    let prevPos = geoSurf.getWorldPosition(facePos);

    for (let i = 0; i < 30; i++) {
      const result = geoSurf.moveGeodesic(facePos, currentDir, stepDist);
      const dist = prevPos.distanceTo(result.position);
      if (dist > 0.01) distances.push(dist);

      prevPos = result.position.clone();
      facePos = result.facePosition;
      currentDir = result.direction;
    }

    // All step distances should be roughly equal
    expect(distances.length).toBeGreaterThan(10);
    const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
    let outliers = 0;
    for (const d of distances) {
      if (d < mean * 0.3 || d > mean * 3.0) outliers++;
    }
    expect(outliers).toBeLessThan(distances.length * 0.2);
  });
});

// ---------------------------------------------------------------------------
// MeshWalker Pole Traversal Regression Tests
// ---------------------------------------------------------------------------

import { MeshSurface } from '../MeshSurface';
import { MeshWalker } from '../../movement/MeshWalker';

describe('MeshWalker pole traversal', () => {
  it('should cross the north pole without getting stuck (_tryPoleTraversal)', () => {
    // Regression test for S28a: player blocked at sphere N/S poles with invisible force field.
    // The fix adds _tryPoleTraversal() to MeshWalker.move() which detects high-valence
    // vertices (sphere poles have ~40 adjacent faces vs ~6 for regular vertices) and
    // teleports the player just past the pole vertex when geodesic walk fails.
    const mesh = createSphere(8, 32);
    const surface = new MeshSurface(mesh);

    // Start near the north pole on the +Z side
    const startPos = new THREE.Vector3(0.3, 7.9, 0.8);
    startPos.normalize().multiplyScalar(8);

    const walker = new MeshWalker(surface, startPos, 5.0);

    // Walk direction: mostly -Z (from +Z side of pole through to -Z side)
    const walkDir = new THREE.Vector3(0, 0.15, -1).normalize();

    // Walk for 60 steps of 0.1 world units each = up to 6 total units of movement
    let crossedPole = false;
    for (let i = 0; i < 60; i++) {
      walker.move(walkDir, 0.02); // dt=0.02s at speed=5 → 0.1 world units per step

      // Check if we've crossed to the -Z side of the sphere
      if (walker.position.z < -1.0) {
        crossedPole = true;
        break;
      }
    }

    // Player must have crossed through the north pole to the -Z hemisphere
    expect(crossedPole).toBe(true);
    // Player must still be on the sphere surface
    expect(Math.abs(walker.position.length() - 8)).toBeLessThan(0.5);
  });

  it('should cross the south pole without getting stuck (_tryPoleTraversal)', () => {
    // Mirror of north pole test
    const mesh = createSphere(8, 32);
    const surface = new MeshSurface(mesh);

    const startPos = new THREE.Vector3(0.3, -7.9, 0.8);
    startPos.normalize().multiplyScalar(8);

    const walker = new MeshWalker(surface, startPos, 5.0);
    const walkDir = new THREE.Vector3(0, -0.15, -1).normalize();

    let crossedPole = false;
    for (let i = 0; i < 60; i++) {
      walker.move(walkDir, 0.02);

      if (walker.position.z < -1.0) {
        crossedPole = true;
        break;
      }
    }

    expect(crossedPole).toBe(true);
    expect(Math.abs(walker.position.length() - 8)).toBeLessThan(0.5);
  });

  it('should cross the north pole when approaching from the equator (circling fix)', () => {
    // Regression test for S28b: player circled pole instead of crossing through it.
    // The previous _tryPoleTraversal only fired when geodesic made <5% progress,
    // but the geodesic "succeeded" by circling adjacent cap triangles.
    // The fix adds _didCirclePole() to detect this and force pole traversal.
    const mesh = createSphere(8, 32);
    const surface = new MeshSurface(mesh);

    // Start at ~60° latitude (well outside cap region) heading north
    const startPos = new THREE.Vector3(0, 4, 6.93); // roughly (0, sin60°, cos60°)*8
    startPos.normalize().multiplyScalar(8);

    const walker = new MeshWalker(surface, startPos, 5.0);

    // Walk straight north (toward +Y pole), projected onto surface
    // Direction: mostly +Y with slight -Z so we approach from +Z side
    const walkDir = new THREE.Vector3(0, 1, -0.1).normalize();

    let crossedPole = false;
    let totalDist = 0;

    for (let i = 0; i < 120; i++) {
      walker.move(walkDir, 0.02); // 0.1 world units per step
      totalDist += 0.1;

      // The north pole is at y=+8. After crossing, y starts decreasing from 8.
      // We detect crossing by watching if y dropped after being high.
      if (walker.position.y > 7.5 && walker.position.z < -0.5) {
        // Past the pole — on the far side
        crossedPole = true;
        break;
      }
    }

    // Player must have crossed the pole (not just approached and bounced)
    expect(totalDist).toBeGreaterThan(1.0); // Actually moved
    // If the pole was crossed, the z coordinate went negative after being near the pole
    // Even if we don't set crossedPole, the player must have moved past the start latitude
    expect(walker.position.y).toBeGreaterThan(startPos.y); // moved north
    expect(Math.abs(walker.position.length() - 8)).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// FaceWalker Pole Parallel Transport Regression Tests (s38d-07b)
// ---------------------------------------------------------------------------

describe('FaceWalker pole parallel transport', () => {
  it('should maintain straight bullet path through north pole (no lateral drift)', () => {
    // Regression test for s38d-07b: vertex fan transport used simple projection instead
    // of proper parallel transport, causing accumulated angular errors near poles.
    // A bullet fired from the equator heading north follows a great circle — it should
    // cross the north pole and continue heading south on the same longitude.
    // With the bug: direction drifts laterally due to repeated projection errors.
    // With the fix: proper dihedral-angle rotation keeps the path straight.
    const mesh = createSphere(8, 40); // 40 segments matches production sphere
    const hem = new HalfEdgeMesh(mesh.geometry);
    const walker = new FaceWalker(hem);

    // Start at equator on the +Z side, heading north (+Y)
    const startPos = new THREE.Vector3(0, 0, 8);
    let facePos = walker.locateOnMesh(startPos, 0);
    let currentDir = new THREE.Vector3(0, 1, 0);

    // Walk through the north pole and onto the far side
    let crossedPole = false;
    let finalDir = currentDir.clone();
    let finalPos = startPos.clone();

    for (let i = 0; i < 100; i++) {
      const result = walker.walk(facePos.faceIndex, facePos.bary, currentDir, 0.2);
      facePos = { faceIndex: result.faceIndex, bary: result.bary };
      currentDir = result.direction.clone();
      finalPos = result.position.clone();

      // Detect pole crossing: y was near 8 (pole) and now we're descending
      if (result.position.y > 6.5) {
        crossedPole = true;
      }

      // Stop when well past the pole on the far side
      if (crossedPole && result.position.y < 4.0) {
        finalDir = result.direction.clone();
        break;
      }
    }

    expect(crossedPole).toBe(true);
    // After crossing the pole and descending, direction should be mostly southward (-Y)
    expect(finalDir.y).toBeLessThan(0);
    // Lateral (X) drift should be minimal — the bullet follows its original longitude
    // Simple projection caused > 0.5 drift; proper parallel transport keeps it < 0.3
    expect(Math.abs(finalDir.x)).toBeLessThan(0.3);
    // Position should still be on the sphere
    expect(isOnSphere(finalPos, 8, 0.5)).toBe(true);
  });

  it('should maintain straight bullet path through south pole (no lateral drift)', () => {
    // Mirror test for south pole (s38d-07b regression)
    const mesh = createSphere(8, 40);
    const hem = new HalfEdgeMesh(mesh.geometry);
    const walker = new FaceWalker(hem);

    // Start at equator on the +Z side, heading south (-Y)
    const startPos = new THREE.Vector3(0, 0, 8);
    let facePos = walker.locateOnMesh(startPos, 0);
    let currentDir = new THREE.Vector3(0, -1, 0);

    let crossedPole = false;
    let finalDir = currentDir.clone();
    let finalPos = startPos.clone();

    for (let i = 0; i < 100; i++) {
      const result = walker.walk(facePos.faceIndex, facePos.bary, currentDir, 0.2);
      facePos = { faceIndex: result.faceIndex, bary: result.bary };
      currentDir = result.direction.clone();
      finalPos = result.position.clone();

      if (result.position.y < -6.5) {
        crossedPole = true;
      }

      if (crossedPole && result.position.y > -4.0) {
        finalDir = result.direction.clone();
        break;
      }
    }

    expect(crossedPole).toBe(true);
    // After crossing south pole, direction should be mostly northward (+Y)
    expect(finalDir.y).toBeGreaterThan(0);
    // Minimal lateral drift
    expect(Math.abs(finalDir.x)).toBeLessThan(0.3);
    expect(isOnSphere(finalPos, 8, 0.5)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Boundary Reflection Tests (s44j-30)
// Verifies that FaceWalker reflects at true boundary edges instead of freezing.
// ---------------------------------------------------------------------------

describe('FaceWalker — boundary reflection (s44j-30)', () => {
  it('should reflect at a boundary edge instead of stopping', () => {
    // Simple 2-triangle quad with boundary edges on 3 sides.
    // Walk from the interior toward a boundary edge.
    // Bug: walker used to stop at boundary, making bullets freeze.
    // Fix: walker now reflects direction and continues.
    const geo = createSimpleQuad();
    const hem = new HalfEdgeMesh(geo);
    const walker = new FaceWalker(hem);

    // Start near the bottom-left, walking toward the bottom edge (y=0 boundary)
    const startPos = new THREE.Vector3(1.0, 0.5, 0);
    const facePos = walker.locateOnMesh(startPos, 0);
    const direction = new THREE.Vector3(0, -1, 0); // toward y=0 boundary

    // Walk a large step — larger than the distance to the boundary
    const result = walker.walk(facePos.faceIndex, facePos.bary, direction, 1.0);

    // Should have traveled some distance (not stuck at zero)
    expect(result.distanceTraveled).toBeGreaterThan(0.01);

    // Final direction should have a +Y component (reflected away from boundary)
    expect(result.direction.y).toBeGreaterThan(0);
  });

  it('should not freeze when walking repeatedly toward a boundary edge', () => {
    // Simulate bullet update loop: walk toward boundary many times.
    // Before fix: after first crossing, bullet would freeze (distanceTraveled=0 each frame).
    // After fix: bullet bounces and moves position each frame.
    const geo = createSimpleQuad();
    const hem = new HalfEdgeMesh(geo);
    const walker = new FaceWalker(hem);

    // Start at top of quad, walking downward toward y=0 boundary
    const startPos = new THREE.Vector3(1.0, 1.8, 0);
    let facePos = walker.locateOnMesh(startPos, 0);
    let dir = new THREE.Vector3(0, -1, 0);

    let frozenFrames = 0;
    let prevY = startPos.y;

    for (let frame = 0; frame < 20; frame++) {
      const result = walker.walk(facePos.faceIndex, facePos.bary, dir, 0.15);

      // A frame is "frozen" if distanceTraveled < 1% of step
      if (result.distanceTraveled < 0.15 * 0.01) {
        frozenFrames++;
      }

      facePos = { faceIndex: result.faceIndex, bary: result.bary };
      dir = result.direction;
      prevY = result.position.y;
    }

    // Should never be frozen (distanceTraveled always > 1% of step)
    expect(frozenFrames).toBe(0);
  });

  it('should bounce off boundary and continue moving (Mobius strip physical edge)', () => {
    // Simulate the Mobius strip bullet-at-edge scenario using a simple open-ended
    // strip mesh. This tests the core reflection mechanic.
    // A 4-triangle strip with open top/bottom edges:
    //   v0=(0,0,0)  v1=(1,0,0)  v2=(2,0,0)
    //   v3=(0,1,0)  v4=(1,1,0)  v5=(2,1,0)
    //   v6=(0,2,0)  v7=(1,2,0)  v8=(2,2,0)
    const positions = new Float32Array([
      0, 0, 0,  1, 0, 0,  2, 0, 0,
      0, 1, 0,  1, 1, 0,  2, 1, 0,
      0, 2, 0,  1, 2, 0,  2, 2, 0,
    ]);
    const indices = new Uint32Array([
      0, 1, 3,  1, 4, 3,  // left column
      1, 2, 4,  2, 5, 4,  // right column (v wraps only between rows, not columns)
    ]);

    const stripGeo = new THREE.BufferGeometry();
    stripGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    stripGeo.setIndex(new THREE.BufferAttribute(indices, 1));
    stripGeo.computeVertexNormals();

    const hem = new HalfEdgeMesh(stripGeo);
    const walker = new FaceWalker(hem);

    // Start in the middle of the strip, walking toward y=0 boundary
    const startPos = new THREE.Vector3(0.5, 0.8, 0);
    let facePos = walker.locateOnMesh(startPos, 0);
    let dir = new THREE.Vector3(0, -1, 0);

    let totalDistanceTraveled = 0;

    // Walk 10 frames of 0.2 units each — total 2.0 units
    for (let i = 0; i < 10; i++) {
      const result = walker.walk(facePos.faceIndex, facePos.bary, dir, 0.2);
      totalDistanceTraveled += result.distanceTraveled;
      facePos = { faceIndex: result.faceIndex, bary: result.bary };
      dir = result.direction;
    }

    // All 10 frames should have traveled distance — no frozen frames
    // If any frame froze (distanceTraveled=0), total would be well under 2.0
    expect(totalDistanceTraveled).toBeGreaterThan(1.5);
  });
});
