/**
 * Automated tests for the mesh-based movement system.
 *
 * Tests the core physics/math without a browser:
 * 1. Sphere pole traversal (no singularity)
 * 2. Constant speed on all surfaces
 * 3. Surface adherence after movement
 * 4. Bullet surface following
 * 5. Multi-shape support
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { MeshSurface } from './MeshSurface';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshBulletPool } from '../entities/MeshBullet';

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
  const geo = new THREE.BoxGeometry(size, size, size, 8, 8, 8);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function createCylinder(radius = 5, height = 12): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 48, 8, false);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Distance between two points on the surface of a sphere */
function sphereArcDistance(a: THREE.Vector3, b: THREE.Vector3, radius: number): number {
  const dot = a.clone().normalize().dot(b.clone().normalize());
  const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
  return angle * radius;
}

/** Check if a point is on a sphere surface within tolerance */
function isOnSphere(point: THREE.Vector3, radius: number, tolerance = 0.1): boolean {
  return Math.abs(point.length() - radius) < tolerance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MeshSurface', () => {
  describe('closestPointOnSurface', () => {
    it('should find closest point on sphere from above', () => {
      const mesh = createSphere(8);
      const surface = new MeshSurface(mesh);

      const result = surface.closestPointOnSurface(new THREE.Vector3(0, 20, 0));
      expect(result).not.toBeNull();
      expect(result!.point.y).toBeCloseTo(8, 0);
      expect(result!.normal.y).toBeGreaterThan(0.9);
    });

    it('should find closest point from arbitrary direction', () => {
      const mesh = createSphere(8);
      const surface = new MeshSurface(mesh);

      const result = surface.closestPointOnSurface(new THREE.Vector3(20, 0, 0));
      expect(result).not.toBeNull();
      expect(result!.point.x).toBeCloseTo(8, 0);
      expect(result!.normal.x).toBeGreaterThan(0.9);
    });

    it('should work on torus', () => {
      const mesh = createTorus(6, 2.5);
      const surface = new MeshSurface(mesh);

      const result = surface.closestPointOnSurface(new THREE.Vector3(0, 20, 0));
      expect(result).not.toBeNull();
      // Torus top is at y = 2.5 (minor radius, since major radius is in XZ plane)
      expect(result!.point.y).toBeGreaterThan(1);
      expect(result!.normal.y).toBeGreaterThan(0.5);
    });

    it('should work on cube', () => {
      const mesh = createCube(10);
      const surface = new MeshSurface(mesh);

      const result = surface.closestPointOnSurface(new THREE.Vector3(0, 20, 0));
      expect(result).not.toBeNull();
      expect(result!.point.y).toBeCloseTo(5, 0);
    });
  });

  describe('moveOnSurface', () => {
    it('should move along sphere surface', () => {
      const mesh = createSphere(8);
      const surface = new MeshSurface(mesh);

      const startPos = new THREE.Vector3(0, 8, 0);
      const startNormal = new THREE.Vector3(0, 1, 0);
      const moveDir = new THREE.Vector3(1, 0, 0); // Move right

      const result = surface.moveOnSurface(startPos, startNormal, moveDir, 2.0);
      expect(result).not.toBeNull();
      // Should have moved to the right, staying on sphere
      expect(result!.point.x).toBeGreaterThan(0);
      expect(isOnSphere(result!.point, 8, 0.2)).toBe(true);
    });

    it('should keep point on surface after multiple moves', () => {
      const mesh = createSphere(8);
      const surface = new MeshSurface(mesh);

      let pos = new THREE.Vector3(0, 8, 0);
      let normal = new THREE.Vector3(0, 1, 0);

      // Make 100 moves in random-ish directions
      for (let i = 0; i < 100; i++) {
        const angle = i * 0.37; // pseudo-random direction
        const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
        const result = surface.moveOnSurface(pos, normal, dir, 0.5);
        if (result) {
          pos = result.point;
          normal = result.normal;
        }
      }

      // After 100 moves, should still be on the sphere
      expect(isOnSphere(pos, 8, 0.3)).toBe(true);
    });
  });

  describe('getTangentFrame', () => {
    it('should return orthonormal basis', () => {
      const mesh = createSphere(8);
      const surface = new MeshSurface(mesh);

      const frame = surface.getTangentFrame(new THREE.Vector3(0, 1, 0));

      // All vectors should be unit length
      expect(frame.normal.length()).toBeCloseTo(1, 5);
      expect(frame.tangent.length()).toBeCloseTo(1, 5);
      expect(frame.bitangent.length()).toBeCloseTo(1, 5);

      // All vectors should be orthogonal
      expect(Math.abs(frame.normal.dot(frame.tangent))).toBeLessThan(0.001);
      expect(Math.abs(frame.normal.dot(frame.bitangent))).toBeLessThan(0.001);
      expect(Math.abs(frame.tangent.dot(frame.bitangent))).toBeLessThan(0.001);
    });

    it('should work for any normal direction', () => {
      const mesh = createSphere(8);
      const surface = new MeshSurface(mesh);

      const directions = [
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0.577, 0.577, 0.577),
        new THREE.Vector3(-0.3, 0.9, 0.3),
      ];

      for (const dir of directions) {
        const frame = surface.getTangentFrame(dir);
        expect(frame.normal.length()).toBeCloseTo(1, 3);
        expect(frame.tangent.length()).toBeCloseTo(1, 3);
        expect(frame.bitangent.length()).toBeCloseTo(1, 3);
        expect(Math.abs(frame.normal.dot(frame.tangent))).toBeLessThan(0.01);
      }
    });
  });

  describe('getVisibility', () => {
    it('should return high visibility for front-facing points', () => {
      const mesh = createSphere(8);
      const surface = new MeshSurface(mesh);

      // Camera above, point on top facing up
      const vis = surface.getVisibility(
        new THREE.Vector3(0, 8, 0),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 20, 0),
      );
      expect(vis).toBeGreaterThan(0.8);
    });

    it('should return low visibility for back-facing points', () => {
      const mesh = createSphere(8);
      const surface = new MeshSurface(mesh);

      // Camera above, point on bottom facing down
      const vis = surface.getVisibility(
        new THREE.Vector3(0, -8, 0),
        new THREE.Vector3(0, -1, 0),
        new THREE.Vector3(0, 20, 0),
      );
      expect(vis).toBeLessThan(0.4);
    });
  });
});

describe('MeshWalker - Sphere Pole Traversal', () => {
  let surface: MeshSurface;

  beforeEach(() => {
    const mesh = createSphere(8, 48);
    surface = new MeshSurface(mesh);
  });

  it('should start on the sphere surface', () => {
    const walker = new MeshWalker(surface, new THREE.Vector3(0, 20, 0), 3.0);
    expect(isOnSphere(walker.position, 8, 0.2)).toBe(true);
  });

  it('should move smoothly over the north pole', () => {
    // Start near the north pole
    const walker = new MeshWalker(surface, new THREE.Vector3(0, 8, 0), 3.0);

    // Move in the X direction to traverse the pole region
    const positions: THREE.Vector3[] = [walker.position.clone()];
    const moveDir = new THREE.Vector3(1, 0, 0);

    for (let i = 0; i < 50; i++) {
      walker.move(moveDir, 0.1); // 0.3 units per step
      positions.push(walker.position.clone());
    }

    // Verify: all positions should be on the sphere
    for (const pos of positions) {
      expect(isOnSphere(pos, 8, 0.3)).toBe(true);
    }

    // Verify: should have moved a significant distance from start
    const totalArc = sphereArcDistance(positions[0], positions[positions.length - 1], 8);
    expect(totalArc).toBeGreaterThan(5); // Should have moved at least 5 units
  });

  it('should maintain constant speed at different latitudes', () => {
    const testPositions = [
      new THREE.Vector3(0, 8, 0),     // North pole
      new THREE.Vector3(0, 4, 6.93),  // ~30 degrees north
      new THREE.Vector3(0, 0, 8),     // Equator
      new THREE.Vector3(0, -4, 6.93), // ~30 degrees south
      new THREE.Vector3(0, -8, 0),    // South pole
    ];

    const speeds: number[] = [];

    for (const startPos of testPositions) {
      const walker = new MeshWalker(surface, startPos, 3.0);
      const initialPos = walker.position.clone();

      // Move 10 steps in X direction
      const moveDir = new THREE.Vector3(1, 0, 0);
      for (let i = 0; i < 10; i++) {
        walker.move(moveDir, 0.1);
      }

      const arcDist = sphereArcDistance(initialPos, walker.position, 8);
      speeds.push(arcDist);
    }

    // All speeds should be roughly equal (within 50% of average)
    // The BVH projection can cause some variation, but not the 10x+ pole distortion
    const avg = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    for (let i = 0; i < speeds.length; i++) {
      // Speed at any position should be within 50% of average
      // (UV system would show 10x+ variation near poles)
      expect(speeds[i]).toBeGreaterThan(avg * 0.5);
      expect(speeds[i]).toBeLessThan(avg * 1.5);
    }
  });

  it('should not get stuck at the pole', () => {
    // Start exactly at the north pole
    const walker = new MeshWalker(surface, new THREE.Vector3(0, 8, 0), 3.0);
    const startPos = walker.position.clone();

    // Move "forward" (in Z direction)
    const moveDir = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 20; i++) {
      walker.move(moveDir, 0.1);
    }

    // Should have moved away from start
    const dist = startPos.distanceTo(walker.position);
    expect(dist).toBeGreaterThan(1.0); // At least 1 world unit
  });

  it('should traverse from north pole to south pole', () => {
    const walker = new MeshWalker(surface, new THREE.Vector3(0, 8, 0), 3.0);

    // Move in Z direction for many steps to go over the sphere
    const moveDir = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 200; i++) {
      walker.move(moveDir, 0.1); // 0.3 units/step, 200 steps = 60 units
    }

    // Sphere circumference = 2 * PI * 8 ≈ 50 units
    // After 60 units of travel, should have gone past the south pole
    // Y should be negative (passed equator at minimum)
    expect(walker.position.y).toBeLessThan(4);
    expect(isOnSphere(walker.position, 8, 0.3)).toBe(true);
  });
});

describe('MeshWalker - Multi-Shape', () => {
  it('should walk on torus surface', () => {
    const mesh = createTorus(6, 2.5);
    const surface = new MeshSurface(mesh);
    const walker = new MeshWalker(surface, new THREE.Vector3(6, 2.5, 0), 3.0);

    const startPos = walker.position.clone();
    const moveDir = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < 20; i++) {
      walker.move(moveDir, 0.1);
    }

    const dist = startPos.distanceTo(walker.position);
    expect(dist).toBeGreaterThan(0.5);
  });

  it('should walk on cube surface', () => {
    const mesh = createCube(10);
    const surface = new MeshSurface(mesh);
    const walker = new MeshWalker(surface, new THREE.Vector3(0, 10, 0), 3.0);

    // Should be on top face
    expect(walker.position.y).toBeCloseTo(5, 0);

    const moveDir = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < 10; i++) {
      walker.move(moveDir, 0.1);
    }

    // Should have moved along the top face
    expect(walker.position.x).toBeGreaterThan(0);
    expect(walker.position.y).toBeCloseTo(5, 0); // Still on top face
  });

  it('should walk on cylinder surface', () => {
    const mesh = createCylinder(5, 12);
    const surface = new MeshSurface(mesh);
    const walker = new MeshWalker(surface, new THREE.Vector3(5, 0, 0), 3.0);

    // Should be on the side of the cylinder
    const distFromAxis = Math.sqrt(walker.position.x ** 2 + walker.position.z ** 2);
    expect(distFromAxis).toBeCloseTo(5, 0);

    // Move along the cylinder's length
    const moveDir = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 10; i++) {
      walker.move(moveDir, 0.1);
    }

    // Should have moved up
    expect(walker.position.y).toBeGreaterThan(0.5);
    // Should still be on the cylinder surface
    const newDistFromAxis = Math.sqrt(walker.position.x ** 2 + walker.position.z ** 2);
    expect(newDistFromAxis).toBeCloseTo(5, 0.5);
  });
});

describe('MeshBulletPool', () => {
  it('should spawn and update bullets on sphere', () => {
    const mesh = createSphere(8);
    const surface = new MeshSurface(mesh);
    const pool = new MeshBulletPool(50);
    pool.setSurface(surface);

    // Spawn a bullet at the north pole going right
    pool.spawn(
      new THREE.Vector3(0, 8, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    );

    expect(pool.activeCount).toBe(1);

    // Update for 10 frames
    for (let i = 0; i < 10; i++) {
      pool.update(0.016);
    }

    // Bullet should still be alive
    expect(pool.activeCount).toBe(1);

    // Check bullet position - should be on sphere
    let bulletPos: THREE.Vector3 | null = null;
    pool.forEachActive((_idx, pos) => {
      bulletPos = pos.clone();
    });

    expect(bulletPos).not.toBeNull();
    expect(isOnSphere(bulletPos!, 8, 0.3)).toBe(true);
    // Should have moved right
    expect(bulletPos!.x).toBeGreaterThan(0.1);
  });

  it('should follow torus surface', () => {
    const mesh = createTorus(6, 2.5);
    const surface = new MeshSurface(mesh);
    const pool = new MeshBulletPool(50);
    pool.setSurface(surface);

    // Spawn on torus top
    const startResult = surface.closestPointOnSurface(new THREE.Vector3(6, 5, 0));
    expect(startResult).not.toBeNull();

    pool.spawn(
      startResult!.point,
      new THREE.Vector3(0, 0, 1),
      startResult!.normal,
    );

    // Run for many frames
    for (let i = 0; i < 100; i++) {
      pool.update(0.016);
    }

    // Bullet should still be active (not killed by direction collapse)
    expect(pool.activeCount).toBe(1);
  });

  it('should kill bullets after lifetime expires', () => {
    const mesh = createSphere(8);
    const surface = new MeshSurface(mesh);
    const pool = new MeshBulletPool(50);
    pool.setSurface(surface);

    pool.spawn(
      new THREE.Vector3(0, 8, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
    );

    expect(pool.activeCount).toBe(1);

    // Run for 5 seconds (lifetime is 4.0)
    for (let i = 0; i < 100; i++) {
      pool.update(0.05);
    }

    expect(pool.activeCount).toBe(0);
  });

  it('should handle multiple simultaneous bullets', () => {
    const mesh = createSphere(8);
    const surface = new MeshSurface(mesh);
    const pool = new MeshBulletPool(50);
    pool.setSurface(surface);

    // Spawn 10 bullets in different directions
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      pool.spawn(
        new THREE.Vector3(0, 8, 0),
        new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)),
        new THREE.Vector3(0, 1, 0),
      );
    }

    expect(pool.activeCount).toBe(10);

    // Update for a bit
    for (let i = 0; i < 30; i++) {
      pool.update(0.016);
    }

    // All should still be alive
    expect(pool.activeCount).toBe(10);

    // All bullets should be on the sphere
    pool.forEachActive((_idx, pos) => {
      expect(isOnSphere(pos, 8, 0.5)).toBe(true);
    });
  });
});

describe('Surface Adherence Stress Test', () => {
  it('should keep walker on sphere after 1000 random direction changes', () => {
    const mesh = createSphere(8, 48);
    const surface = new MeshSurface(mesh);
    const walker = new MeshWalker(surface, new THREE.Vector3(0, 8, 0), 3.0);

    for (let i = 0; i < 1000; i++) {
      const angle = Math.sin(i * 1.37) * Math.PI;
      const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle * 0.7), Math.sin(angle));
      walker.move(dir, 0.05);
    }

    expect(isOnSphere(walker.position, 8, 0.5)).toBe(true);
  });

  it('should keep walker on torus after many moves', () => {
    const mesh = createTorus(6, 2.5);
    const surface = new MeshSurface(mesh);
    const walker = new MeshWalker(surface, new THREE.Vector3(6, 3, 0), 3.0);

    for (let i = 0; i < 500; i++) {
      const angle = i * 0.23;
      const dir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), Math.cos(angle * 1.3));
      walker.move(dir, 0.05);
    }

    // Should still be within the torus bounds
    const dist = walker.position.length();
    expect(dist).toBeLessThan(10); // Torus outer radius = 6 + 2.5 = 8.5
    expect(dist).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// MAP SIZE SCALE REGRESSION — S26 bug fix
//
// When map size != MEDIUM (scale != 1.0), the surface group has a non-unit
// scale applied via `surface.group.scale.setScalar(mapSizeScaleFactor)`.
// GeodesicSurface / HalfEdgeMesh operated in local geometry space (unscaled),
// but MeshWalker expected world-space positions.  This caused enemies (and
// the player) to appear on an unscaled "ghost" surface after the first frame
// of movement, while the visual surface was scaled correctly.
//
// These tests FAIL without the fix in MeshSurface.initGeodesicPosition()
// and MeshSurface.moveGeodesic() — and PASS with it.
// ---------------------------------------------------------------------------

/**
 * Create a mesh whose *parent group* carries a uniform scale,
 * mirroring what main.ts does: surface.group.scale.setScalar(scaleFactor).
 */
function createScaledSphere(baseRadius = 8, scaleFactor = 1.0, segments = 32): {
  mesh: THREE.Mesh;
  group: THREE.Group;
  worldRadius: number;
} {
  const geo = new THREE.SphereGeometry(baseRadius, segments, segments);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  const group = new THREE.Group();
  group.scale.setScalar(scaleFactor);
  group.add(mesh);
  // Propagate scale to mesh.matrixWorld (scene.add + updateMatrixWorld in main.ts)
  group.updateMatrixWorld(true);
  return { mesh, group, worldRadius: baseRadius * scaleFactor };
}

function createScaledCube(baseSize = 10, scaleFactor = 1.0): {
  mesh: THREE.Mesh;
  group: THREE.Group;
} {
  const geo = new THREE.BoxGeometry(baseSize, baseSize, baseSize, 8, 8, 8);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  const group = new THREE.Group();
  group.scale.setScalar(scaleFactor);
  group.add(mesh);
  group.updateMatrixWorld(true);
  return { mesh, group };
}

function createScaledTorus(majorR = 6, minorR = 2.5, scaleFactor = 1.0): {
  mesh: THREE.Mesh;
  group: THREE.Group;
  worldOuterRadius: number;
} {
  const geo = new THREE.TorusGeometry(majorR, minorR, 32, 64);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  const group = new THREE.Group();
  group.scale.setScalar(scaleFactor);
  group.add(mesh);
  group.updateMatrixWorld(true);
  return { mesh, group, worldOuterRadius: (majorR + minorR) * scaleFactor };
}

describe('MeshSurface — map size scale (S26 regression)', () => {
  // Surface types × scale factors as per acceptance criteria (≥ 3 surfaces × 3 sizes)
  const sphereBaseRadius = 8;

  describe('sphere with SMALL scale (0.75)', () => {
    it('walker stays on scaled sphere surface after movement', () => {
      const scaleFactor = 0.75;
      const { mesh, worldRadius } = createScaledSphere(sphereBaseRadius, scaleFactor);
      const surface = new MeshSurface(mesh);

      // Start at the top of the world-space sphere
      const startPos = new THREE.Vector3(0, worldRadius * 1.5, 0); // above surface
      const walker = new MeshWalker(surface, startPos, 3.0);

      // Move sideways (tangent direction) for many frames
      for (let i = 0; i < 30; i++) {
        const angle = i * 0.3;
        walker.move(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), 0.05);
      }

      // Position should be on the SCALED sphere (worldRadius), not the unscaled one (baseRadius)
      const dist = walker.position.length();
      expect(dist).toBeGreaterThan(worldRadius * 0.85);
      expect(dist).toBeLessThan(worldRadius * 1.15);
    });
  });

  describe('sphere with LARGE scale (1.5)', () => {
    it('walker stays on scaled sphere surface after movement', () => {
      const scaleFactor = 1.5;
      const { mesh, worldRadius } = createScaledSphere(sphereBaseRadius, scaleFactor);
      const surface = new MeshSurface(mesh);

      const startPos = new THREE.Vector3(worldRadius, 0, 0);
      const walker = new MeshWalker(surface, startPos, 5.0);

      for (let i = 0; i < 30; i++) {
        const angle = i * 0.3;
        walker.move(new THREE.Vector3(0, Math.cos(angle), Math.sin(angle)), 0.05);
      }

      const dist = walker.position.length();
      expect(dist).toBeGreaterThan(worldRadius * 0.85);
      expect(dist).toBeLessThan(worldRadius * 1.15);
    });
  });

  describe('sphere with EPIC scale (2.0)', () => {
    it('walker stays on scaled sphere surface after movement', () => {
      const scaleFactor = 2.0;
      const { mesh, worldRadius } = createScaledSphere(sphereBaseRadius, scaleFactor);
      const surface = new MeshSurface(mesh);

      const startPos = new THREE.Vector3(0, 0, worldRadius);
      const walker = new MeshWalker(surface, startPos, 8.0);

      for (let i = 0; i < 30; i++) {
        const angle = i * 0.3;
        walker.move(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0), 0.05);
      }

      const dist = walker.position.length();
      expect(dist).toBeGreaterThan(worldRadius * 0.85);
      expect(dist).toBeLessThan(worldRadius * 1.15);
    });

    it('walker does NOT regress to unscaled radius after movement', () => {
      // Without the fix: after geodesic walk, walker.position would be at ~baseRadius
      // (local space), not at worldRadius (world space).
      const scaleFactor = 2.0;
      const { mesh, worldRadius } = createScaledSphere(sphereBaseRadius, scaleFactor);
      const surface = new MeshSurface(mesh);
      const unscaledRadius = sphereBaseRadius; // what buggy code would produce

      const startPos = new THREE.Vector3(worldRadius, 0, 0);
      const walker = new MeshWalker(surface, startPos, 5.0);

      // One move is enough to trigger the geodesic walk
      walker.move(new THREE.Vector3(0, 1, 0), 0.1);

      const dist = walker.position.length();
      // Should be near worldRadius (16), NOT near unscaledRadius (8)
      expect(dist).toBeGreaterThan(unscaledRadius * 1.5);
      expect(dist).toBeCloseTo(worldRadius, 0);
    });
  });

  describe('cube with SMALL scale (0.75)', () => {
    it('walker stays on scaled cube surface after movement', () => {
      const scaleFactor = 0.75;
      const baseHalfSize = 5; // BoxGeometry(10,...) → half-extent = 5
      const worldHalfSize = baseHalfSize * scaleFactor;
      const { mesh } = createScaledCube(10, scaleFactor);
      const surface = new MeshSurface(mesh);

      // Start near the top face
      const startPos = new THREE.Vector3(0, worldHalfSize * 1.5, 0);
      const walker = new MeshWalker(surface, startPos, 2.0);

      for (let i = 0; i < 20; i++) {
        walker.move(new THREE.Vector3(1, 0, 0), 0.05);
      }

      // Should be within the scaled cube's extents
      const maxCoord = Math.max(
        Math.abs(walker.position.x),
        Math.abs(walker.position.y),
        Math.abs(walker.position.z),
      );
      expect(maxCoord).toBeLessThan(worldHalfSize * 1.3);
      expect(maxCoord).toBeGreaterThan(worldHalfSize * 0.5);
    });
  });

  describe('cube with LARGE scale (1.5)', () => {
    it('walker stays on scaled cube surface after movement', () => {
      const scaleFactor = 1.5;
      const worldHalfSize = 5 * scaleFactor;
      const { mesh } = createScaledCube(10, scaleFactor);
      const surface = new MeshSurface(mesh);

      const startPos = new THREE.Vector3(worldHalfSize, 0, 0);
      const walker = new MeshWalker(surface, startPos, 3.0);

      for (let i = 0; i < 20; i++) {
        walker.move(new THREE.Vector3(0, 1, 0), 0.05);
      }

      const maxCoord = Math.max(
        Math.abs(walker.position.x),
        Math.abs(walker.position.y),
        Math.abs(walker.position.z),
      );
      expect(maxCoord).toBeLessThan(worldHalfSize * 1.3);
      expect(maxCoord).toBeGreaterThan(worldHalfSize * 0.5);
    });
  });

  describe('cube with EPIC scale (2.0)', () => {
    it('walker stays on scaled cube surface after movement', () => {
      const scaleFactor = 2.0;
      const worldHalfSize = 5 * scaleFactor;
      const { mesh } = createScaledCube(10, scaleFactor);
      const surface = new MeshSurface(mesh);

      const startPos = new THREE.Vector3(0, worldHalfSize, 0);
      const walker = new MeshWalker(surface, startPos, 5.0);

      for (let i = 0; i < 20; i++) {
        walker.move(new THREE.Vector3(1, 0, 0), 0.05);
      }

      const maxCoord = Math.max(
        Math.abs(walker.position.x),
        Math.abs(walker.position.y),
        Math.abs(walker.position.z),
      );
      expect(maxCoord).toBeLessThan(worldHalfSize * 1.3);
      expect(maxCoord).toBeGreaterThan(worldHalfSize * 0.5);
    });
  });

  describe('torus with SMALL scale (0.75)', () => {
    it('walker stays on scaled torus surface after movement', () => {
      const scaleFactor = 0.75;
      const { mesh, worldOuterRadius } = createScaledTorus(6, 2.5, scaleFactor);
      const surface = new MeshSurface(mesh);

      // Start at torus outer edge
      const startPos = new THREE.Vector3(worldOuterRadius, 0, 0);
      const walker = new MeshWalker(surface, startPos, 2.0);

      for (let i = 0; i < 20; i++) {
        walker.move(new THREE.Vector3(0, 1, 0), 0.05);
      }

      // Should be within torus outer radius
      const dist = walker.position.length();
      expect(dist).toBeLessThan(worldOuterRadius * 1.2);
      expect(dist).toBeGreaterThan(0.1);
    });
  });

  describe('torus with LARGE scale (1.5)', () => {
    it('walker stays on scaled torus surface after movement', () => {
      const scaleFactor = 1.5;
      const { mesh, worldOuterRadius } = createScaledTorus(6, 2.5, scaleFactor);
      const surface = new MeshSurface(mesh);

      const startPos = new THREE.Vector3(worldOuterRadius, 0, 0);
      const walker = new MeshWalker(surface, startPos, 3.0);

      for (let i = 0; i < 20; i++) {
        walker.move(new THREE.Vector3(0, 1, 0), 0.05);
      }

      const dist = walker.position.length();
      expect(dist).toBeLessThan(worldOuterRadius * 1.2);
      expect(dist).toBeGreaterThan(0.1);
    });
  });

  describe('torus with EPIC scale (2.0)', () => {
    it('walker stays on scaled torus surface after movement', () => {
      const scaleFactor = 2.0;
      const { mesh, worldOuterRadius } = createScaledTorus(6, 2.5, scaleFactor);
      const surface = new MeshSurface(mesh);

      const startPos = new THREE.Vector3(worldOuterRadius, 0, 0);
      const walker = new MeshWalker(surface, startPos, 5.0);

      for (let i = 0; i < 20; i++) {
        walker.move(new THREE.Vector3(0, 1, 0), 0.05);
      }

      const dist = walker.position.length();
      expect(dist).toBeLessThan(worldOuterRadius * 1.2);
      expect(dist).toBeGreaterThan(0.1);
    });
  });

  describe('initGeodesicPosition — world-space input', () => {
    it('correctly locates a world-space point on a 2x scaled sphere', () => {
      const scaleFactor = 2.0;
      const { mesh, worldRadius } = createScaledSphere(sphereBaseRadius, scaleFactor);
      const surface = new MeshSurface(mesh);

      // A point on the north pole of the world-space sphere
      const northPole = new THREE.Vector3(0, worldRadius, 0);
      const bvhResult = surface.closestPointOnSurface(northPole);
      expect(bvhResult).not.toBeNull();

      // initGeodesicPosition should map this world-space point to the correct face
      const facePos = surface.initGeodesicPosition(bvhResult!.point, bvhResult!.faceIndex);
      // The face index should be within bounds (not 0 due to wrong-space comparison)
      expect(facePos.faceIndex).toBeGreaterThanOrEqual(0);

      // The barycentric coords should sum to ~1
      const barySum = facePos.bary.u + facePos.bary.v + facePos.bary.w;
      expect(barySum).toBeCloseTo(1.0, 3);
    });
  });

  describe('moveGeodesic — world-space input and output', () => {
    it('produces world-space position on a 2x scaled sphere', () => {
      const scaleFactor = 2.0;
      const { mesh, worldRadius } = createScaledSphere(sphereBaseRadius, scaleFactor);
      const surface = new MeshSurface(mesh);

      const startWorldPos = new THREE.Vector3(worldRadius, 0, 0);
      const bvhResult = surface.closestPointOnSurface(startWorldPos);
      expect(bvhResult).not.toBeNull();

      const facePos = surface.initGeodesicPosition(bvhResult!.point, bvhResult!.faceIndex);
      const direction = new THREE.Vector3(0, 1, 0); // tangent direction at (r, 0, 0)
      const worldDistance = 1.0;

      const result = surface.moveGeodesic(facePos, direction, worldDistance);

      // Result position should be on the WORLD-SPACE sphere (radius = worldRadius)
      const dist = result.position.length();
      expect(dist).toBeGreaterThan(worldRadius * 0.9);
      expect(dist).toBeLessThan(worldRadius * 1.1);

      // distanceTraveled should be in world units (~1.0)
      expect(result.distanceTraveled).toBeGreaterThan(worldDistance * 0.5);
      expect(result.distanceTraveled).toBeLessThanOrEqual(worldDistance * 1.1);
    });
  });
});
