/**
 * Tests for cube edge crossing with geodesic paths.
 *
 * This test reproduces the bug where bullets fired toward a cube edge
 * don't follow the expected straight path across to the adjacent face.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HalfEdgeMesh } from '../surfaces/geodesic/HalfEdgeMesh';
import { FaceWalker, FacePosition } from '../surfaces/geodesic/FaceWalker';
import { GeodesicSurface } from '../surfaces/geodesic/GeodesicSurface';

function createCube(size = 10): THREE.BufferGeometry {
  // Use subdivided BoxGeometry to have triangular faces
  const geo = new THREE.BoxGeometry(size, size, size, 4, 4, 4);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Test that a bullet fired orthogonal to a cube edge continues in a straight
 * geodesic path across to the adjacent face.
 */
describe('Cube Edge Geodesic Crossing', () => {
  it('should cross from +Z face to +X face along a straight geodesic', () => {
    const geo = createCube(10);
    const geoSurf = new GeodesicSurface(geo);

    // Start on the +Z face (center at z=5), near the edge that borders the +X face
    // The shared edge is at x=5, running along Y axis
    // Start position: (4, 0, 5) - slightly inward from the edge
    const startPos = new THREE.Vector3(4, 0, 5);

    // Fire direction: perpendicular to the edge, toward +X
    // This should cross the edge and continue onto the +X face
    const direction = new THREE.Vector3(1, 0, 0).normalize();

    // Initialize geodesic position
    const facePos = geoSurf.initializePosition(startPos, 0);

    console.log('Initial face index:', facePos.faceIndex);
    console.log('Initial bary:', facePos.bary);

    // Try smaller steps to see where it gets stuck
    let currentPos = facePos;
    let currentDir = direction.clone();
    let totalDist = 0;

    for (let step = 0; step < 5; step++) {
      const stepResult = geoSurf.moveGeodesic(currentPos, currentDir, 0.5);
      totalDist += stepResult.distanceTraveled;

      console.log(`Step ${step}:`, {
        position: stepResult.position,
        normal: stepResult.normal,
        direction: stepResult.direction,
        distanceTraveled: stepResult.distanceTraveled,
        faceIndex: stepResult.facePosition.faceIndex,
      });

      currentPos = stepResult.facePosition;
      currentDir = stepResult.direction;

      if (stepResult.distanceTraveled < 0.1) {
        console.log('Movement stopped at step', step);
        break;
      }
    }

    // Walk 3 units - should cross the edge and land on the +X face
    const result = geoSurf.moveGeodesic(facePos, direction, 3.0);

    // After crossing, we should be on the +X face (x=5, z < 5)
    // The geodesic path should be straight in 3D space
    console.log('Start:', startPos);
    console.log('End:', result.position);
    console.log('Distance traveled:', result.distanceTraveled);
    console.log('Normal:', result.normal);

    // The bullet should have crossed the edge
    expect(result.distanceTraveled).toBeGreaterThan(1.0);

    // On a cube, firing from (4,0,5) in direction (1,0,0) should:
    // 1. Cross the edge at (5,0,5)
    // 2. Continue onto the +X face
    // 3. The direction on the +X face should be (0,0,-1) after 90° rotation

    // The final position should be on the +X face (x ≈ 5, z < 5)
    expect(Math.abs(result.position.x - 5)).toBeLessThan(0.5);
    expect(result.position.z).toBeLessThan(5);
  });

  it('should cross from +Y face to +Z face along a straight geodesic', () => {
    const geo = createCube(10);
    const geoSurf = new GeodesicSurface(geo);

    // Start on the +Y face (y=5), near the edge with +Z face
    const startPos = new THREE.Vector3(0, 5, 4);

    // Fire toward +Z (perpendicular to the edge at z=5)
    const direction = new THREE.Vector3(0, 0, 1).normalize();

    const facePos = geoSurf.initializePosition(startPos, 0);
    const result = geoSurf.moveGeodesic(facePos, direction, 3.0);

    console.log('Y->Z Start:', startPos);
    console.log('Y->Z End:', result.position);
    console.log('Y->Z Direction:', result.direction);

    expect(result.distanceTraveled).toBeGreaterThan(1.0);

    // Should land on +Z face (z ≈ 5, y < 5)
    expect(Math.abs(result.position.z - 5)).toBeLessThan(0.5);
    expect(result.position.y).toBeLessThan(5);
  });

  it('should maintain direction through 90° edge crossing', () => {
    const geo = createCube(10);
    const hem = new HalfEdgeMesh(geo);
    const walker = new FaceWalker(hem);

    // Find a face on the +Z side (normal ≈ (0,0,1))
    let zFaceIndex = -1;
    for (let i = 0; i < hem.faceCount; i++) {
      const normal = hem.faces[i].normal;
      if (normal.z > 0.9) {
        zFaceIndex = i;
        break;
      }
    }

    if (zFaceIndex < 0) {
      console.warn('Could not find +Z face');
      return;
    }

    // Start near the center of this face
    const zFaceVertices = hem.getFaceVertices(zFaceIndex);
    const centroid = new THREE.Vector3()
      .add(zFaceVertices[0])
      .add(zFaceVertices[1])
      .add(zFaceVertices[2])
      .multiplyScalar(1/3);

    console.log('Z face centroid:', centroid);
    console.log('Z face normal:', hem.faces[zFaceIndex].normal);

    // Locate on mesh
    const facePos = walker.locateOnMesh(centroid, zFaceIndex);

    // Walk toward +X (should cross to +X face)
    const direction = new THREE.Vector3(1, 0, 0);
    const result = walker.walk(facePos.faceIndex, facePos.bary, direction, 5.0);

    console.log('Walk result position:', result.position);
    console.log('Walk result normal:', result.normal);
    console.log('Walk result direction:', result.direction);
    console.log('Distance traveled:', result.distanceTraveled);

    // Should have moved a reasonable distance
    expect(result.distanceTraveled).toBeGreaterThan(2.0);

    // The transported direction should be perpendicular to the new normal
    expect(Math.abs(result.direction.dot(result.normal))).toBeLessThan(0.1);
  });
});
