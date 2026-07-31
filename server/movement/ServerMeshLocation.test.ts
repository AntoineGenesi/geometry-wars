import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MeshSurface } from '../../src/surfaces/MeshSurface';
import { ServerSurfaceManager } from './ServerSurfaceManager';
import {
  createServerMeshLocation,
  isWithinConnectedSurfacePatch,
} from './ServerMeshLocation';

function makeFoldedTestSurface(): MeshSurface {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,  1, 0, 0,  0, 1, 0,  1, 1, 0,
    0, 0, 0.1,  1, 0, 0.1,  0, 1, 0.1,
  ], 3));
  geometry.setIndex([
    0, 1, 2,
    2, 1, 3,
    4, 5, 6,
  ]);
  geometry.computeVertexNormals();
  return new MeshSurface(new THREE.Mesh(geometry));
}

function locationAtFaceCenter(surface: MeshSurface, faceIndex: number) {
  return createServerMeshLocation(surface, {
    faceIndex,
    bary: { u: 1 / 3, v: 1 / 3, w: 1 / 3 },
  });
}

describe('canonical server mesh location', () => {
  it('accepts adjacent faces inside the visible disk', () => {
    const surface = makeFoldedTestSurface();
    const halfEdge = surface.geodesic.halfEdge;
    const originFace = halfEdge.faces.findIndex((face) => face.pA.z < 0.05);
    const adjacentFace = halfEdge.faceHalfEdges[originFace]
      .map((edgeIndex) => halfEdge.halfEdges[edgeIndex].twin)
      .filter((twinIndex) => twinIndex >= 0)
      .map((twinIndex) => halfEdge.halfEdges[twinIndex].faceIndex)
      .find((faceIndex) => halfEdge.faces[faceIndex].pA.z < 0.05)!;
    const portal = locationAtFaceCenter(surface, originFace);
    const player = locationAtFaceCenter(surface, adjacentFace);

    expect(isWithinConnectedSurfacePatch(surface, portal, player, 0.8)).toBe(true);
    surface.dispose();
  });

  it('rejects a physically near but disconnected parallel wall', () => {
    const surface = makeFoldedTestSurface();
    const halfEdge = surface.geodesic.halfEdge;
    const parallelFace = halfEdge.faces.findIndex((face) => face.pA.z > 0.05);
    const player = locationAtFaceCenter(surface, parallelFace);
    const originFace = halfEdge.faces
      .map((_, faceIndex) => locationAtFaceCenter(surface, faceIndex))
      .filter((location) => location.faceIndex !== parallelFace && location.wz < 0.05)
      .sort((a, b) => Math.hypot(a.wx - player.wx, a.wy - player.wy)
        - Math.hypot(b.wx - player.wx, b.wy - player.wy))[0].faceIndex;
    const portal = locationAtFaceCenter(surface, originFace);

    const euclidean = Math.hypot(
      player.wx - portal.wx,
      player.wy - portal.wy,
      player.wz - portal.wz,
    );
    expect(euclidean).toBeCloseTo(0.1, 5);
    expect(euclidean).toBeLessThan(0.8);
    expect(isWithinConnectedSurfacePatch(surface, portal, player, 0.8)).toBe(false);
    surface.dispose();
  });

  it.each(['cube-tunnel', 'cube-ring', 'cube', 'sphere'] as const)(
    'round-trips an exact portal location through a %s walker without snap-back',
    (surfaceType) => {
      const manager = new ServerSurfaceManager();
      manager.initSurface(surfaceType);
      const walker = manager.createWalker('player', 0.5, 0.5)!;
      const portal = manager.createRandomLocation(() => 0.37)!;

      expect(manager.teleportWalkerToLocation('player', portal)).toBe(true);
      const teleported = walker.getLocation();
      expect(teleported.faceIndex).toBe(portal.faceIndex);
      expect(teleported.baryU).toBeCloseTo(portal.baryU, 4);
      expect(teleported.baryV).toBeCloseTo(portal.baryV, 4);
      expect(teleported.baryW).toBeCloseTo(portal.baryW, 4);
      expect(Math.hypot(
        teleported.wx - portal.wx,
        teleported.wy - portal.wy,
        teleported.wz - portal.wz,
      )).toBeLessThan(1e-4);

      walker.moveWithCameraAxes(
        1, 0,
        teleported.tangentX, teleported.tangentY, teleported.tangentZ,
        teleported.bitangentX, teleported.bitangentY, teleported.bitangentZ,
        1 / 60,
      );
      expect(walker.getWorldPosition().distanceTo(
        new THREE.Vector3(portal.wx, portal.wy, portal.wz),
      )).toBeLessThan(0.2);
      manager.dispose();
    },
  );
});
