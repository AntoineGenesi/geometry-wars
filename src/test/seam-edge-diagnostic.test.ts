/**
 * Diagnostic test: Check if _linkSeamEdges incorrectly links edges on
 * sphere and icosahedron meshes, causing the walker to get stuck.
 *
 * The seam fix (iteration 9) added proximity-based edge matching for
 * unmatched boundary edges. On a sphere, the UV seam at theta=0/2PI
 * has exact duplicate vertices that should already be linked by the
 * canonical vertex system. If _linkSeamEdges matches edges that
 * shouldn't be twins, it could break the mesh topology.
 */

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { HalfEdgeMesh } from '../surfaces/geodesic/HalfEdgeMesh';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';

function createSphereHalfEdge(): { he: HalfEdgeMesh; geometry: THREE.SphereGeometry } {
  const geometry = new THREE.SphereGeometry(10, 40, 40);
  const he = new HalfEdgeMesh(geometry);
  return { he, geometry };
}

function createIcoHalfEdge(): { he: HalfEdgeMesh; geometry: THREE.IcosahedronGeometry } {
  const geometry = new THREE.IcosahedronGeometry(10, 2);
  // IcosahedronGeometry is NOT indexed — create a trivial index like GeodesicSurface does
  if (!geometry.index) {
    const posAttr = geometry.getAttribute('position');
    const indices = new Uint32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) indices[i] = i;
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  const he = new HalfEdgeMesh(geometry);
  return { he, geometry };
}

describe('Seam edge diagnostic', () => {
  it('should report boundary edge counts on sphere', () => {
    const { he } = createSphereHalfEdge();

    let boundaryEdges = 0;
    let totalEdges = he.halfEdges.length;
    for (let i = 0; i < he.halfEdges.length; i++) {
      if (he.halfEdges[i].twin < 0) {
        boundaryEdges++;
      }
    }

    console.log(`Sphere: ${totalEdges} half-edges, ${boundaryEdges} boundary edges, ${he.faceCount} faces`);
    // A proper sphere should have very few or zero boundary edges
    // (possibly at the UV seam if positions don't match exactly)
    // But _linkSeamEdges should NOT incorrectly link non-boundary edges
  });

  it('should check face normal consistency on sphere', () => {
    const geometry = new THREE.SphereGeometry(10, 40, 40);
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;
    const normalAttr = geometry.getAttribute('normal') as THREE.BufferAttribute;
    const index = geometry.index!;

    let flippedNormals = 0;
    let totalFaces = index.count / 3;

    for (let fi = 0; fi < totalFaces; fi++) {
      const a = index.getX(fi * 3);
      const b = index.getX(fi * 3 + 1);
      const c = index.getX(fi * 3 + 2);

      const pA = new THREE.Vector3().fromBufferAttribute(posAttr, a);
      const pB = new THREE.Vector3().fromBufferAttribute(posAttr, b);
      const pC = new THREE.Vector3().fromBufferAttribute(posAttr, c);

      const ab = new THREE.Vector3().subVectors(pB, pA);
      const ac = new THREE.Vector3().subVectors(pC, pA);
      const crossNormal = new THREE.Vector3().crossVectors(ab, ac);
      const crossLen = crossNormal.length();
      if (crossLen > 1e-10) crossNormal.multiplyScalar(1 / crossLen);

      // Check vertex normal agreement
      const vn = new THREE.Vector3(
        normalAttr.getX(a) + normalAttr.getX(b) + normalAttr.getX(c),
        normalAttr.getY(a) + normalAttr.getY(b) + normalAttr.getY(c),
        normalAttr.getZ(a) + normalAttr.getZ(b) + normalAttr.getZ(c),
      );

      if (vn.dot(crossNormal) < 0) {
        flippedNormals++;
        if (flippedNormals <= 5) {
          console.log(`  Sphere face ${fi}: cross normal ${crossNormal.toArray().map(v=>v.toFixed(3))} vs vertex normal avg ${vn.clone().normalize().toArray().map(v=>v.toFixed(3))}, dot=${vn.dot(crossNormal).toFixed(6)}`);
        }
      }
    }

    console.log(`Sphere: ${flippedNormals}/${totalFaces} faces had normals flipped by consistency check`);
    // If normals are being flipped on sphere, this could affect the geodesic walker
  });

  it('should report boundary edge counts on icosahedron', () => {
    const { he } = createIcoHalfEdge();

    let boundaryEdges = 0;
    let totalEdges = he.halfEdges.length;
    for (let i = 0; i < he.halfEdges.length; i++) {
      if (he.halfEdges[i].twin < 0) {
        boundaryEdges++;
      }
    }

    console.log(`Icosahedron: ${totalEdges} half-edges, ${boundaryEdges} boundary edges, ${he.faceCount} faces`);
  });

  it('should verify twin consistency on sphere', () => {
    const { he } = createSphereHalfEdge();

    let inconsistentTwins = 0;
    let crossFaceTwins = 0;
    let twinFaceNormalFlips = 0;

    for (let i = 0; i < he.halfEdges.length; i++) {
      const edge = he.halfEdges[i];
      if (edge.twin < 0) continue;

      const twin = he.halfEdges[edge.twin];

      // Check twin symmetry
      if (twin.twin !== i) {
        inconsistentTwins++;
      }

      // Check if the twin is on a different face
      if (edge.faceIndex === twin.faceIndex) {
        crossFaceTwins++;
        console.log(`  Self-twin: edge ${i} face ${edge.faceIndex}, twin ${edge.twin} face ${twin.faceIndex}`);
      }

      // Check if twin faces have compatible normals (for sphere, they should all point outward)
      const n1 = he.faces[edge.faceIndex].normal;
      const n2 = he.faces[twin.faceIndex].normal;
      if (n1.dot(n2) < -0.5) {
        twinFaceNormalFlips++;
      }
    }

    console.log(`Sphere twin consistency: ${inconsistentTwins} asymmetric, ${crossFaceTwins} same-face, ${twinFaceNormalFlips} normal flips`);
    expect(inconsistentTwins).toBe(0);
    expect(crossFaceTwins).toBe(0);
  });

  it('should check for incorrectly linked edges on sphere (seam tolerance matching non-adjacent triangles)', () => {
    const { he, geometry } = createSphereHalfEdge();
    const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute;

    // Check edges that were linked by seam matching (not by canonical vertex)
    // These are edges where from/to don't have matching canonical positions
    // but were linked by proximity
    let seamLinkedEdges = 0;
    let suspiciousLinks = 0;

    for (let i = 0; i < he.halfEdges.length; i++) {
      const edge = he.halfEdges[i];
      if (edge.twin < 0) continue;

      const twin = he.halfEdges[edge.twin];

      // Get world positions of both edges
      const f1 = he.faces[edge.faceIndex];
      const f2 = he.faces[twin.faceIndex];
      const v1 = [f1.pA, f1.pB, f1.pC];
      const v2 = [f2.pA, f2.pB, f2.pC];

      const e1from = v1[edge.edgeLocal];
      const e1to = v1[(edge.edgeLocal + 1) % 3];
      const e2from = v2[twin.edgeLocal];
      const e2to = v2[(twin.edgeLocal + 1) % 3];

      // Check if the twin edges have endpoints that are NOT exact matches
      // (i.e., they were linked by proximity, not by canonical vertex)
      const fromDist = e1from.distanceTo(e2to); // Twin goes opposite direction
      const toDist = e1to.distanceTo(e2from);

      if (fromDist > 0.001 || toDist > 0.001) {
        seamLinkedEdges++;

        // Check if the matched edges are actually adjacent (faces share an edge)
        // by checking the edge midpoints
        const mid1 = new THREE.Vector3().addVectors(e1from, e1to).multiplyScalar(0.5);
        const mid2 = new THREE.Vector3().addVectors(e2from, e2to).multiplyScalar(0.5);
        const midDist = mid1.distanceTo(mid2);

        if (midDist > 0.1) {
          suspiciousLinks++;
          console.log(`  SUSPICIOUS seam link: edge ${i} (face ${edge.faceIndex}) -> twin ${edge.twin} (face ${twin.faceIndex})`);
          console.log(`    e1: ${e1from.toArray().map(v=>v.toFixed(3))} -> ${e1to.toArray().map(v=>v.toFixed(3))}`);
          console.log(`    e2: ${e2from.toArray().map(v=>v.toFixed(3))} -> ${e2to.toArray().map(v=>v.toFixed(3))}`);
          console.log(`    midpoint distance: ${midDist.toFixed(4)}`);
        }
      }
    }

    console.log(`Sphere: ${seamLinkedEdges} seam-linked edges, ${suspiciousLinks} suspicious links`);
    // If there are suspicious links, the seam fix is incorrectly matching edges on sphere
    expect(suspiciousLinks).toBe(0);
  });

  it('should check for incorrectly linked edges on icosahedron', () => {
    const { he, geometry } = createIcoHalfEdge();

    let seamLinkedEdges = 0;
    let suspiciousLinks = 0;

    for (let i = 0; i < he.halfEdges.length; i++) {
      const edge = he.halfEdges[i];
      if (edge.twin < 0) continue;

      const twin = he.halfEdges[edge.twin];

      const f1 = he.faces[edge.faceIndex];
      const f2 = he.faces[twin.faceIndex];
      const v1 = [f1.pA, f1.pB, f1.pC];
      const v2 = [f2.pA, f2.pB, f2.pC];

      const e1from = v1[edge.edgeLocal];
      const e1to = v1[(edge.edgeLocal + 1) % 3];
      const e2from = v2[twin.edgeLocal];
      const e2to = v2[(twin.edgeLocal + 1) % 3];

      const fromDist = e1from.distanceTo(e2to);
      const toDist = e1to.distanceTo(e2from);

      if (fromDist > 0.001 || toDist > 0.001) {
        seamLinkedEdges++;
        const mid1 = new THREE.Vector3().addVectors(e1from, e1to).multiplyScalar(0.5);
        const mid2 = new THREE.Vector3().addVectors(e2from, e2to).multiplyScalar(0.5);
        const midDist = mid1.distanceTo(mid2);

        if (midDist > 0.1) {
          suspiciousLinks++;
          console.log(`  SUSPICIOUS seam link: edge ${i} (face ${edge.faceIndex}) -> twin ${edge.twin} (face ${twin.faceIndex})`);
          console.log(`    e1: ${e1from.toArray().map(v=>v.toFixed(3))} -> ${e1to.toArray().map(v=>v.toFixed(3))}`);
          console.log(`    e2: ${e2from.toArray().map(v=>v.toFixed(3))} -> ${e2to.toArray().map(v=>v.toFixed(3))}`);
          console.log(`    midpoint distance: ${midDist.toFixed(4)}`);
        }
      }
    }

    console.log(`Icosahedron: ${seamLinkedEdges} seam-linked edges, ${suspiciousLinks} suspicious links`);
    expect(suspiciousLinks).toBe(0);
  });

  it('sphere walker should actually move', () => {
    const geometry = new THREE.SphereGeometry(10, 40, 40);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(mesh);

    const startPos = new THREE.Vector3(0, 10, 0);
    const walker = new MeshWalker(meshSurface, startPos, 5);

    console.log(`Sphere walker initial position: ${walker.position.toArray().map(v=>v.toFixed(3))}`);
    console.log(`Sphere walker initial normal: ${walker.normal.toArray().map(v=>v.toFixed(3))}`);
    console.log(`Sphere walker initial face: ${walker.faceIndex}`);

    const dir = new THREE.Vector3(1, 0, 0).normalize();
    let totalDisplacement = 0;

    for (let i = 0; i < 30; i++) {
      const prevPos = walker.position.clone();
      const result = walker.move(dir, 1/60);
      const disp = walker.position.distanceTo(prevPos);
      totalDisplacement += disp;

      if (i < 5) {
        console.log(`  Frame ${i}: disp=${disp.toFixed(6)}, pos=${walker.position.toArray().map(v=>v.toFixed(3))}, result=${result ? 'ok' : 'null'}`);
      }
    }

    console.log(`Sphere total displacement over 30 frames: ${totalDisplacement.toFixed(4)}`);
    expect(totalDisplacement).toBeGreaterThan(0.5);
  });

  it('icosahedron walker should actually move', () => {
    const geometry = new THREE.IcosahedronGeometry(10, 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(mesh);

    const startPos = new THREE.Vector3(0, 10, 0);
    const walker = new MeshWalker(meshSurface, startPos, 5);

    console.log(`Ico walker initial position: ${walker.position.toArray().map(v=>v.toFixed(3))}`);
    console.log(`Ico walker initial normal: ${walker.normal.toArray().map(v=>v.toFixed(3))}`);
    console.log(`Ico walker initial face: ${walker.faceIndex}`);

    const dir = new THREE.Vector3(1, 0, 0).normalize();
    let totalDisplacement = 0;

    for (let i = 0; i < 30; i++) {
      const prevPos = walker.position.clone();
      const result = walker.move(dir, 1/60);
      const disp = walker.position.distanceTo(prevPos);
      totalDisplacement += disp;

      if (i < 5) {
        console.log(`  Frame ${i}: disp=${disp.toFixed(6)}, pos=${walker.position.toArray().map(v=>v.toFixed(3))}, result=${result ? 'ok' : 'null'}`);
      }
    }

    console.log(`Ico total displacement over 30 frames: ${totalDisplacement.toFixed(4)}`);
    expect(totalDisplacement).toBeGreaterThan(0.5);
  });
});
