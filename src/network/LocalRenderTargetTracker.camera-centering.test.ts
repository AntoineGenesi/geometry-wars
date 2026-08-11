import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../core/CameraController';
import { getDefaultMapSizeForSurface, getMapSizeScaleFactor, type MapSize } from '../core/MapSize';
import { MeshWalker } from '../movement/MeshWalker';
import { createStandardSurfaceConfig } from '../rendering/SharedGameSetup';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SurfaceFactory, type SurfaceType } from '../surfaces/SurfaceFactory';
import { buildSurfaceGeometry, type SupportedSurface } from '../../server/movement/SurfaceGeometryBuilder';
import { ServerMeshWalker } from '../../server/movement/ServerMeshWalker';
import { LocalRenderTargetTracker } from './LocalRenderTargetTracker';

const _noopEvent = (_e: string, _h: any, _opts?: any) => {};

if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  };
}

type ReplaySurface = 'peanut' | 'capsule';
type ZoomLabel = 'close' | 'zoomedOut';

interface ReplayStats {
  surface: ReplaySurface;
  zoom: ZoomLabel;
  renderNdcMax: number;
  authoritativeNdcMax: number;
  mpLeadMax: number;
  mpLeadAvg: number;
  mpCameraStepMax: number;
  spCameraStepMax: number;
}

const PLAYER_MOVE_SPEED = 3.0;
const PLAYER_SURFACE_CLEARANCE = 0.44;
const DT = 1 / 60;
const SERVER_SAMPLE_FRAMES = 2;
const REPLAY_FRAMES = 180;
const CAMERA_ASPECT = 16 / 9;

function createCamera(distance: number): {
  camera: THREE.PerspectiveCamera;
  controller: CameraController;
} {
  const camera = new THREE.PerspectiveCamera(75, CAMERA_ASPECT, 0.1, 1000);
  camera.position.set(0, 15, 25);
  camera.up.set(0, 1, 0);
  camera.updateMatrixWorld(true);

  const controller = new CameraController(camera);
  controller.setCameraDistance(distance);
  return { camera, controller };
}

function getScaledSurfaceSetup(surfaceType: ReplaySurface): {
  meshSurface: MeshSurface;
  startPoint: THREE.Vector3;
  scaleFactor: number;
} {
  const mapSize = getDefaultMapSizeForSurface(surfaceType as SurfaceType);
  const scaleFactor = getMapSizeScaleFactor(mapSize as MapSize);
  const surfaceConfig = createStandardSurfaceConfig(surfaceType as SurfaceType, 10, null);
  const surface = SurfaceFactory.create(surfaceType as SurfaceType, surfaceConfig as any);
  surface.group.scale.setScalar(scaleFactor);
  surface.group.updateMatrixWorld(true);
  surface.mesh.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surface.walkableMesh);
  const unscaledStart = surface.getPoint(0.5, surfaceType === 'peanut' ? 0.44 : 0.5).position;
  const scaledStart = unscaledStart.multiplyScalar(scaleFactor);
  const closest = meshSurface.closestPointOnSurface(scaledStart);
  return {
    meshSurface,
    startPoint: closest?.point.clone() ?? scaledStart,
    scaleFactor,
  };
}

function createServerWalker(surfaceType: ReplaySurface, scaleFactor: number, startPoint: THREE.Vector3): ServerMeshWalker {
  const serverMesh = buildSurfaceGeometry(surfaceType as SupportedSurface, scaleFactor);
  const serverSurface = new MeshSurface(serverMesh);
  return new ServerMeshWalker(serverSurface, startPoint, PLAYER_MOVE_SPEED * scaleFactor);
}

function stateVectors(state: ReturnType<ServerMeshWalker['getState']>): {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
  renderPosition: THREE.Vector3;
} {
  const position = new THREE.Vector3(state.wx, state.wy, state.wz);
  const normal = new THREE.Vector3(state.nx, state.ny, state.nz).normalize();
  const tangent = new THREE.Vector3(state.tangentX, state.tangentY, state.tangentZ).normalize();
  const bitangent = new THREE.Vector3(state.bitangentX, state.bitangentY, state.bitangentZ).normalize();
  const renderPosition = position.clone().addScaledVector(normal, PLAYER_SURFACE_CLEARANCE);
  return { position, normal, tangent, bitangent, renderPosition };
}

function ndcMagnitude(camera: THREE.PerspectiveCamera, point: THREE.Vector3): number {
  const ndc = point.clone().project(camera);
  return Math.hypot(ndc.x, ndc.y);
}

function pushStat(stats: number[], value: number): void {
  if (Number.isFinite(value)) stats.push(value);
}

function max(list: number[]): number {
  return list.length > 0 ? Math.max(...list) : 0;
}

function avg(list: number[]): number {
  return list.length > 0 ? list.reduce((sum, value) => sum + value, 0) / list.length : 0;
}

function runReplay(surfaceType: ReplaySurface, zoom: ZoomLabel, cameraDistance: number): ReplayStats {
  const { meshSurface, startPoint, scaleFactor } = getScaledSurfaceSetup(surfaceType);

  const spWalker = new MeshWalker(meshSurface, startPoint.clone(), PLAYER_MOVE_SPEED * scaleFactor);
  const mpWalker = createServerWalker(surfaceType, scaleFactor, startPoint.clone());
  const spCamera = createCamera(cameraDistance);
  const mpCamera = createCamera(cameraDistance);
  const tracker = new LocalRenderTargetTracker();
  const renderTarget = new THREE.Vector3();
  const latestAuthoritativeRenderPos = new THREE.Vector3();

  const spFrame = spWalker.getTangentFrame();
  spCamera.controller.snapToFrame(
    spWalker.position,
    spWalker.normal,
    { tangent: spFrame.tangent, bitangent: spFrame.bitangent },
  );
  let mpState = stateVectors(mpWalker.getState());
  mpCamera.controller.snapToFrame(
    mpState.renderPosition,
    mpState.normal,
    { tangent: mpState.tangent, bitangent: mpState.bitangent },
  );
  tracker.sample(mpState.renderPosition, 0, mpState.normal);
  latestAuthoritativeRenderPos.copy(mpState.renderPosition);

  let prevMpCameraPos = mpCamera.camera.position.clone();
  let prevSpCameraPos = spCamera.camera.position.clone();
  const renderNdc: number[] = [];
  const authoritativeNdc: number[] = [];
  const mpLead: number[] = [];
  const mpCameraStep: number[] = [];
  const spCameraStep: number[] = [];

  for (let frame = 1; frame <= REPLAY_FRAMES; frame++) {
    const spDirection = spWalker.getTangentFrame().bitangent;
    spWalker.move(spDirection, DT);
    spCamera.controller.update(spWalker, DT);
    spCamera.camera.updateMatrixWorld(true);
    pushStat(spCameraStep, spCamera.camera.position.distanceTo(prevSpCameraPos));
    prevSpCameraPos = spCamera.camera.position.clone();

    const mpDirection = mpState.bitangent;
    mpWalker.moveInWorldDirection(mpDirection.x, mpDirection.y, mpDirection.z, DT);
    if (frame % SERVER_SAMPLE_FRAMES === 0) {
      mpState = stateVectors(mpWalker.getState());
      latestAuthoritativeRenderPos.copy(mpState.renderPosition);
      tracker.sample(mpState.renderPosition, frame * DT * 1000, mpState.normal);
    }

    expect(tracker.getTarget(frame * DT * 1000, renderTarget)).toBe(true);
    mpCamera.controller.updateFromFrame(
      renderTarget,
      mpState.normal,
      { tangent: mpState.tangent, bitangent: mpState.bitangent },
      DT,
    );
    mpCamera.camera.updateMatrixWorld(true);

    pushStat(renderNdc, ndcMagnitude(mpCamera.camera, renderTarget));
    pushStat(authoritativeNdc, ndcMagnitude(mpCamera.camera, latestAuthoritativeRenderPos));
    pushStat(mpLead, renderTarget.distanceTo(latestAuthoritativeRenderPos));
    pushStat(mpCameraStep, mpCamera.camera.position.distanceTo(prevMpCameraPos));
    prevMpCameraPos = mpCamera.camera.position.clone();
  }

  return {
    surface: surfaceType,
    zoom,
    renderNdcMax: max(renderNdc),
    authoritativeNdcMax: max(authoritativeNdc),
    mpLeadMax: max(mpLead),
    mpLeadAvg: avg(mpLead),
    mpCameraStepMax: max(mpCameraStep),
    spCameraStepMax: max(spCameraStep),
  };
}

describe('LocalRenderTargetTracker odd-surface camera centering replay', () => {
  it.each([
    ['peanut', 'close', 6],
    ['peanut', 'zoomedOut', 15],
    ['capsule', 'close', 6],
    ['capsule', 'zoomedOut', 15],
  ] as const)('keeps MP %s %s zoom visually centered without excessive target lead', (surface, zoom, distance) => {
    const stats = runReplay(surface, zoom, distance);

    expect(stats.renderNdcMax).toBeLessThan(0.000001);
    expect(stats.authoritativeNdcMax).toBeLessThan(0.035);
    expect(stats.mpLeadMax).toBeLessThan(distance === 6 ? 0.045 : 0.09);
    expect(stats.mpLeadAvg).toBeLessThan(distance === 6 ? 0.025 : 0.05);
    expect(stats.mpCameraStepMax).toBeLessThan(stats.spCameraStepMax * 1.75);
  });
});
