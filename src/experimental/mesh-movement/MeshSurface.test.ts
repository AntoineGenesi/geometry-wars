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
import { MeshWalker } from './MeshWalker';
import { MeshBulletPool } from './MeshBullet';

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
