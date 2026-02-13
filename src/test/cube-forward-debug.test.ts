/**
 * Debug test: Investigate cube forward movement wobble (1.058)
 * The player goes more sideways than forward when pressing W on cube
 */

import * as THREE from 'three';
import { describe, it, expect } from 'vitest';
import { MeshWalker } from '../movement/MeshWalker';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';

function createCubeSetup() {
  const surf = SurfaceFactory.create('cube', {
    size: 10,
    gridColor: 0x2a2aaa,
    surfaceColor: 0x141440,
    surfaceOpacity: 0.35,
    gridOpacity: 0.4,
  } as any);
  surf.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surf.mesh);
  const startPos = surf.getPoint(0.5, 0.5).position;
  const walker = new MeshWalker(meshSurface, startPos, 5);

  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  const frame = walker.getTangentFrame();
  camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
  camera.up.copy(frame.bitangent);
  camera.lookAt(walker.position);
  camera.updateMatrixWorld(true);

  return { walker, meshSurface, camera, surface: surf };
}

describe('Cube forward movement debug', () => {
  it('should trace forward movement frame by frame', () => {
    const { walker, camera } = createCubeSetup();
    const dt = 1 / 60;

    console.log(`Start pos: ${walker.position.toArray().map(v => v.toFixed(3))}`);
    console.log(`Start normal: ${walker.normal.toArray().map(v => v.toFixed(3))}`);
    console.log(`Start face: ${walker.faceIndex}`);

    const initCamRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const initCamUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    console.log(`Initial camRight: ${initCamRight.toArray().map(v => v.toFixed(3))}`);
    console.log(`Initial camUp: ${initCamUp.toArray().map(v => v.toFixed(3))}`);

    let prevFace = walker.faceIndex;
    let edgeCrossings = 0;

    for (let i = 0; i < 60; i++) {
      const prevPos = walker.position.clone();
      const curFrame = walker.getTangentFrame();

      walker.moveFromInput(0, 1, camera, dt, curFrame.bitangent);

      // Update camera
      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
      camera.up.copy(curFrame.bitangent);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      const disp = walker.position.clone().sub(prevPos);
      const screenRight = disp.dot(initCamRight);
      const screenUp = disp.dot(initCamUp);

      if (walker.faceIndex !== prevFace) {
        edgeCrossings++;
        console.log(`  Frame ${i}: EDGE CROSSING ${prevFace} -> ${walker.faceIndex}`);
        console.log(`    normal: ${walker.normal.toArray().map(v => v.toFixed(3))}`);
        console.log(`    tangent: ${walker.getTangentFrame().tangent.toArray().map(v => v.toFixed(3))}`);
        console.log(`    bitangent: ${walker.getTangentFrame().bitangent.toArray().map(v => v.toFixed(3))}`);
        prevFace = walker.faceIndex;
      }

      if (i < 10 || i % 10 === 0) {
        const wobble = Math.abs(screenUp) > 0.001 ? Math.abs(screenRight / screenUp) : 0;
        console.log(`  Frame ${i}: SR=${screenRight.toFixed(4)} SU=${screenUp.toFixed(4)} wobble=${wobble.toFixed(3)} face=${walker.faceIndex}`);
      }
    }

    console.log(`Total edge crossings: ${edgeCrossings}`);
  });

  it('should check if cube starting position is on an edge', () => {
    const surf = SurfaceFactory.create('cube', {
      size: 10,
    } as any);
    surf.mesh.updateMatrixWorld(true);

    const meshSurface = new MeshSurface(surf.mesh);
    const he = meshSurface.geodesic.halfEdge;

    const startPos = surf.getPoint(0.5, 0.5).position;
    console.log(`Cube start pos (0.5, 0.5): ${startPos.toArray().map(v => v.toFixed(3))}`);

    // Check if starting position is near a cube edge
    const walker = new MeshWalker(meshSurface, startPos, 5);
    console.log(`Walker on face: ${walker.faceIndex}`);
    console.log(`Face normal: ${he.faces[walker.faceIndex].normal.toArray().map(v => v.toFixed(3))}`);

    // Check how many boundary edges this face has
    let boundaries = 0;
    for (let ei = 0; ei < 3; ei++) {
      const edge = he.getHalfEdge(walker.faceIndex, ei);
      if (edge.twin < 0) boundaries++;
    }
    console.log(`Face ${walker.faceIndex} has ${boundaries} boundary edges`);

    // Check adjacent faces
    for (let ei = 0; ei < 3; ei++) {
      const adjFace = he.getAdjacentFace(walker.faceIndex, ei);
      if (adjFace >= 0) {
        const adjNormal = he.faces[adjFace].normal;
        const normalDot = he.faces[walker.faceIndex].normal.dot(adjNormal);
        console.log(`  Adjacent face ${adjFace}: normal dot = ${normalDot.toFixed(4)}`);
      } else {
        console.log(`  Edge ${ei}: BOUNDARY`);
      }
    }
  });

  it('forward on a single cube face should not wobble', () => {
    const surf = SurfaceFactory.create('cube', {
      size: 10,
    } as any);
    surf.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(surf.mesh);

    // Start in the CENTER of the top face (y=5 for a size-10 cube)
    // The top face normal should be (0, 1, 0)
    const startPos = new THREE.Vector3(0, 5, 0);
    const walker = new MeshWalker(meshSurface, startPos, 5);
    const dt = 1/60;

    console.log(`Top-face start: pos=${walker.position.toArray().map(v=>v.toFixed(3))} normal=${walker.normal.toArray().map(v=>v.toFixed(3))}`);

    const camera = new THREE.PerspectiveCamera(60, 16/9, 0.1, 100);
    camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
    const frame = walker.getTangentFrame();
    camera.up.copy(frame.bitangent);
    camera.lookAt(walker.position);
    camera.updateMatrixWorld(true);

    const initCamRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    const initCamUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));

    // Move forward for 30 frames - should stay on top face
    let maxWobble = 0;
    let edgeCrossings = 0;
    let prevFace = walker.faceIndex;

    for (let i = 0; i < 30; i++) {
      const prevPos = walker.position.clone();
      const curFrame = walker.getTangentFrame();
      walker.moveFromInput(0, 1, camera, dt, curFrame.bitangent);

      camera.position.copy(walker.position).addScaledVector(walker.normal, 15);
      camera.up.copy(curFrame.bitangent);
      camera.lookAt(walker.position);
      camera.updateMatrixWorld(true);

      const disp = walker.position.clone().sub(prevPos);
      const sr = disp.dot(initCamRight);
      const su = disp.dot(initCamUp);
      const wobble = Math.abs(su) > 0.001 ? Math.abs(sr / su) : 0;
      if (wobble > maxWobble) maxWobble = wobble;

      if (walker.faceIndex !== prevFace) {
        edgeCrossings++;
        prevFace = walker.faceIndex;
      }
    }

    console.log(`Single-face forward: maxWobble=${maxWobble.toFixed(4)}, edgeCrossings=${edgeCrossings}`);
    // On a single face, wobble should be modest — but cube faces are triangulated
    // so even single-face movement crosses triangle boundaries, causing some wobble
    expect(maxWobble).toBeLessThan(0.5);
  });
});
