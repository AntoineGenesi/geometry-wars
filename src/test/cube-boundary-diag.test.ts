/**
 * Diagnostic: find boundary edges on CubeSurface mesh that block movement.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CubeSurface } from '../surfaces/CubeSurface';
import { HalfEdgeMesh } from '../surfaces/geodesic/HalfEdgeMesh';
import { FaceWalker } from '../surfaces/geodesic/FaceWalker';

describe('CubeSurface boundary edge diagnostic', () => {
  it('should report boundary edges on CubeSurface mesh', () => {
    const surface = new CubeSurface({ size: 18, bevelRadius: 2.7, gridSegments: 12 });
    const mesh = surface.createMesh();
    const geometry = mesh.geometry;
    const hem = new HalfEdgeMesh(geometry);

    // Count boundary edges
    let boundaryCount = 0;
    const boundaryPositions: { from: THREE.Vector3; to: THREE.Vector3; face: number; edge: number }[] = [];

    for (let i = 0; i < hem.halfEdges.length; i++) {
      const he = hem.halfEdges[i];
      if (he.twin < 0) {
        boundaryCount++;
        const f = hem.faces[he.faceIndex];
        const verts = [f.pA, f.pB, f.pC];
        boundaryPositions.push({
          from: verts[he.edgeLocal],
          to: verts[(he.edgeLocal + 1) % 3],
          face: he.faceIndex,
          edge: he.edgeLocal,
        });
      }
    }

    console.log(`Total faces: ${hem.faceCount}`);
    console.log(`Total half-edges: ${hem.halfEdges.length}`);
    console.log(`Boundary edges: ${boundaryCount}`);

    // Group boundary edges by Y position (to see top/bottom/side distribution)
    const yGroups: Record<string, number> = {};
    for (const bp of boundaryPositions) {
      const midY = (bp.from.y + bp.to.y) / 2;
      const key = midY.toFixed(1);
      yGroups[key] = (yGroups[key] || 0) + 1;
    }
    console.log('\nBoundary edges by midpoint Y:');
    for (const [y, count] of Object.entries(yGroups).sort((a, b) => Number(a[0]) - Number(b[0]))) {
      console.log(`  Y=${y}: ${count} edges`);
    }

    // Show first 20 boundary edges with positions
    console.log('\nFirst 20 boundary edges:');
    for (let i = 0; i < Math.min(20, boundaryPositions.length); i++) {
      const bp = boundaryPositions[i];
      console.log(`  Face ${bp.face} edge ${bp.edge}: (${bp.from.x.toFixed(2)}, ${bp.from.y.toFixed(2)}, ${bp.from.z.toFixed(2)}) -> (${bp.to.x.toFixed(2)}, ${bp.to.y.toFixed(2)}, ${bp.to.z.toFixed(2)})`);
    }

    // Check: does the walker get stuck at boundary edges?
    const walker = new FaceWalker(hem);

    // Find a face on the bottom flat face
    let bottomFace = -1;
    for (let i = 0; i < hem.faceCount; i++) {
      const n = hem.faces[i].normal;
      if (n.y < -0.9) { // Normal pointing down = bottom face
        bottomFace = i;
        break;
      }
    }

    if (bottomFace >= 0) {
      console.log(`\nBottom face found: ${bottomFace}`);
      const centroid = new THREE.Vector3()
        .add(hem.faces[bottomFace].pA)
        .add(hem.faces[bottomFace].pB)
        .add(hem.faces[bottomFace].pC)
        .multiplyScalar(1/3);
      console.log(`  Centroid: (${centroid.x.toFixed(2)}, ${centroid.y.toFixed(2)}, ${centroid.z.toFixed(2)})`);

      // Try walking in multiple directions
      const facePos = walker.locateOnMesh(centroid, bottomFace);
      const directions = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(1, 0, 1).normalize(),
        new THREE.Vector3(-1, 0, 1).normalize(),
      ];

      for (const dir of directions) {
        const result = walker.walk(facePos.faceIndex, facePos.bary, dir, 15.0);
        const stuck = result.distanceTraveled < 14.0;
        console.log(`  Walk dir (${dir.x.toFixed(1)}, ${dir.y.toFixed(1)}, ${dir.z.toFixed(1)}): traveled ${result.distanceTraveled.toFixed(2)} / 15.0 ${stuck ? '*** STUCK ***' : 'OK'}`);
      }
    }

    // Also test walking on side faces
    let sideFace = -1;
    for (let i = 0; i < hem.faceCount; i++) {
      const n = hem.faces[i].normal;
      if (Math.abs(n.z) > 0.9 && Math.abs(n.y) < 0.1) {
        sideFace = i;
        break;
      }
    }

    if (sideFace >= 0) {
      console.log(`\nSide face (+Z) found: ${sideFace}`);
      const centroid = new THREE.Vector3()
        .add(hem.faces[sideFace].pA)
        .add(hem.faces[sideFace].pB)
        .add(hem.faces[sideFace].pC)
        .multiplyScalar(1/3);
      console.log(`  Centroid: (${centroid.x.toFixed(2)}, ${centroid.y.toFixed(2)}, ${centroid.z.toFixed(2)})`);

      const facePos = walker.locateOnMesh(centroid, sideFace);
      const directions = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, -1, 0),
      ];

      for (const dir of directions) {
        const result = walker.walk(facePos.faceIndex, facePos.bary, dir, 15.0);
        const stuck = result.distanceTraveled < 14.0;
        console.log(`  Walk dir (${dir.x.toFixed(1)}, ${dir.y.toFixed(1)}, ${dir.z.toFixed(1)}): traveled ${result.distanceTraveled.toFixed(2)} / 15.0 ${stuck ? '*** STUCK ***' : 'OK'}`);
      }
    }
  });
});
