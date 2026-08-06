import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EnemySpawner } from '../../entities/enemies/EnemySpawner';
import { MeshWalker } from '../../movement/MeshWalker';
import { applyPickupSurfacePose } from '../../pickups/PickupSurfaceVisual';
import { SurfaceVisibilityResolver } from '../../rendering/SurfaceVisibilityResolver';
import { loadMeshFromFile } from '../../loaders/MeshLoader';
import { advanceProjectileOnMesh } from '../../surfaces/geodesic/ProjectileGeodesic';
import { LoadedMeshSurface } from '../../surfaces/LoadedMeshSurface';
import { MeshSurface } from '../../surfaces/MeshSurface';
import type { Surface, SurfacePoint } from '../../surfaces/Surface';
import { SurfaceFactory, type SurfaceType } from '../../surfaces/SurfaceFactory';

export type GenericMeshContractSurface =
  | { kind: 'built-in'; type: SurfaceType; label?: string }
  | { kind: 'obj'; path: string; label: string; targetRadius?: number };

interface Fixture {
  label: string;
  surface: Surface;
  meshSurface: MeshSurface;
  ownsMeshSurface: boolean;
}

interface ContractSample {
  u: number;
  v: number;
  nearbyU: number;
  nearbyV: number;
}

const fixtures: Fixture[] = [];

const DEFAULT_SAMPLE: ContractSample = {
  u: 0.125,
  v: 0.5,
  nearbyU: 0.18,
  nearbyV: 0.56,
};

export function describeGenericMeshGameplayContract(surfaces: GenericMeshContractSurface[]): void {
  afterEach(() => {
    for (const fixture of fixtures.splice(0)) {
      if (fixture.ownsMeshSurface) {
        fixture.meshSurface.dispose();
      }
      fixture.surface.dispose();
    }
  });

  describe('generic mesh gameplay contract conformance', () => {
    for (const config of surfaces) {
      const label = config.label ?? (config.kind === 'built-in' ? config.type : config.path);

      it(`${label} supports shared gameplay surface contracts`, async () => {
        const fixture = await createFixture(config);
        const sample = DEFAULT_SAMPLE;

        const origin = getSurfaceFrame(fixture.surface, sample.u, sample.v);
        const nearby = findNearbyMeshPoint(fixture.meshSurface, origin);

        assertSurfacePointFinite(`${fixture.label} origin`, origin);
        assertSurfacePointFinite(`${fixture.label} nearby`, nearby);
        assertUvBridge(fixture.surface, origin.position);
        assertCameraTangentFrame(fixture.meshSurface, origin.normal);
        assertPlayerWalker(fixture.meshSurface, origin);
        assertProjectileTraversal(fixture.meshSurface, origin);
        assertEnemySpawnAndMovement(fixture, origin, nearby, sample);
        assertPickupPlacement(origin);
        assertVisibilityQuery(fixture.meshSurface, origin, nearby);
      });
    }
  });
}

async function createFixture(config: GenericMeshContractSurface): Promise<Fixture> {
  if (config.kind === 'obj') {
    const objText = readFileSync(resolve(process.cwd(), config.path), 'utf8');
    const file = new File([objText], config.path.split('/').pop() ?? 'imported.obj', {
      type: 'text/plain',
    });
    const loadedMesh = await loadMeshFromFile(file, config.targetRadius ?? 8);
    loadedMesh.mesh.updateMatrixWorld(true);
    const surface = new LoadedMeshSurface(loadedMesh, {
      gridSegmentsU: 8,
      gridSegmentsV: 6,
    });
    surface.group.updateMatrixWorld(true);
    loadedMesh.mesh.updateMatrixWorld(true);
    const fixture = {
      label: config.label,
      surface,
      meshSurface: new MeshSurface(surface.walkableMesh),
      ownsMeshSurface: true,
    };
    fixtures.push(fixture);
    return fixture;
  }

  const surface = SurfaceFactory.create(config.type);
  surface.group.updateMatrixWorld(true);
  surface.walkableMesh.updateMatrixWorld(true);
  const fixture = {
    label: config.label ?? config.type,
    surface,
    meshSurface: new MeshSurface(surface.walkableMesh),
    ownsMeshSurface: true,
  };
  fixtures.push(fixture);
  return fixture;
}

function getSurfaceFrame(surface: Surface, u: number, v: number): SurfacePoint {
  const point = surface.getPoint(u, v);
  return {
    position: point.position.clone(),
    normal: point.normal.clone().normalize(),
    tangentU: point.tangentU.clone().normalize(),
    tangentV: point.tangentV.clone().normalize(),
  };
}

function assertSurfacePointFinite(label: string, point: SurfacePoint): void {
  expectFiniteVector(`${label} position`, point.position);
  expectFiniteUnitVector(`${label} normal`, point.normal);
  expectFiniteUnitVector(`${label} tangentU`, point.tangentU);
  expectFiniteUnitVector(`${label} tangentV`, point.tangentV);
  expect(Math.abs(point.normal.dot(point.tangentU))).toBeLessThan(0.03);
  expect(Math.abs(point.normal.dot(point.tangentV))).toBeLessThan(0.03);
}

function assertUvBridge(surface: Surface, position: THREE.Vector3): void {
  const uv = surface.worldToSurface(position);
  expect(uv.u).toBeGreaterThanOrEqual(0);
  expect(uv.u).toBeLessThanOrEqual(1);
  expect(uv.v).toBeGreaterThanOrEqual(0);
  expect(uv.v).toBeLessThanOrEqual(1);
  expect(Number.isFinite(uv.u)).toBe(true);
  expect(Number.isFinite(uv.v)).toBe(true);

  const moved = surface.moveOnSurface(uv.u, uv.v, 0.0025, -0.0015);
  expect(Number.isFinite(moved.u)).toBe(true);
  expect(Number.isFinite(moved.v)).toBe(true);
  expect(moved.u).toBeGreaterThanOrEqual(0);
  expect(moved.u).toBeLessThanOrEqual(1);
  expect(moved.v).toBeGreaterThanOrEqual(0);
  expect(moved.v).toBeLessThanOrEqual(1);
}

function assertCameraTangentFrame(meshSurface: MeshSurface, normal: THREE.Vector3): void {
  const frame = meshSurface.getTangentFrame(normal);
  expectFiniteUnitVector('camera normal', frame.normal);
  expectFiniteUnitVector('camera tangent', frame.tangent);
  expectFiniteUnitVector('camera bitangent', frame.bitangent);
  expect(Math.abs(frame.normal.dot(frame.tangent))).toBeLessThan(0.01);
  expect(Math.abs(frame.normal.dot(frame.bitangent))).toBeLessThan(0.01);
  expect(Math.abs(frame.tangent.dot(frame.bitangent))).toBeLessThan(0.01);
  expect(Number.isFinite(new THREE.Matrix4().makeBasis(frame.tangent, frame.normal, frame.bitangent).determinant())).toBe(true);
}

function assertPlayerWalker(meshSurface: MeshSurface, origin: SurfacePoint): void {
  const closest = requireClosest(meshSurface, origin.position);
  const directions = [
    origin.tangentU,
    origin.tangentV,
    meshSurface.getTangentFrame(closest.normal).tangent,
    meshSurface.getTangentFrame(closest.normal).bitangent,
  ];
  let movedWalker: MeshWalker | null = null;

  for (const direction of directions) {
    const walker = new MeshWalker(meshSurface, closest.point, 3);
    walker.move(direction, 0.12);
    if (walker.position.distanceTo(closest.point) > 0.05) {
      movedWalker = walker;
      break;
    }
  }

  expect(movedWalker).not.toBeNull();
  expectFiniteVector('walker position', movedWalker!.position);
  expectFiniteUnitVector('walker normal', movedWalker!.normal);
  expectFiniteUnitVector('walker tangent', movedWalker!.tangent);
  expectFiniteUnitVector('walker bitangent', movedWalker!.bitangent);
  assertBoundedSurfaceDrift(meshSurface, movedWalker!.position, 0.3);
}

function findNearbyMeshPoint(meshSurface: MeshSurface, origin: SurfacePoint): SurfacePoint {
  const directions = [origin.tangentU, origin.tangentV, origin.tangentU.clone().negate(), origin.tangentV.clone().negate()];
  for (const direction of directions) {
    const result = meshSurface.moveOnSurface(origin.position, origin.normal, direction, 1.2);
    if (result && result.point.distanceTo(origin.position) > 0.2) {
      const frame = meshSurface.getTangentFrame(result.normal);
      return {
        position: result.point.clone(),
        normal: result.normal.clone().normalize(),
        tangentU: frame.tangent.clone().normalize(),
        tangentV: frame.bitangent.clone().normalize(),
      };
    }
  }

  throw new Error('Could not find a nearby mesh-surface point for the conformance probe.');
}

function assertProjectileTraversal(meshSurface: MeshSurface, origin: SurfacePoint): void {
  const closest = requireClosest(meshSurface, origin.position);
  const facePosition = meshSurface.initGeodesicPosition(closest.point, closest.faceIndex);
  const direction = origin.tangentU.clone()
    .addScaledVector(origin.normal, -origin.tangentU.dot(origin.normal))
    .normalize();
  const result = advanceProjectileOnMesh(meshSurface, facePosition, closest.point, direction, 0.35);

  expect(result).not.toBeNull();
  expectFiniteVector('projectile position', result!.position);
  expectFiniteUnitVector('projectile normal', result!.normal);
  expectFiniteUnitVector('projectile direction', result!.direction);
  expect(result!.distanceTraveled).toBeGreaterThan(0.02);
  assertBoundedSurfaceDrift(meshSurface, result!.position, 0.35);
}

function assertEnemySpawnAndMovement(
  fixture: Fixture,
  origin: SurfacePoint,
  nearby: SurfacePoint,
  sample: ContractSample,
): void {
  const scene = new THREE.Scene();
  const spawner = new EnemySpawner(scene, (u: number, v: number) => {
    const point = fixture.surface.getPoint(u, v);
    return {
      position: point.position.clone(),
      normal: point.normal.clone().normalize(),
      tangent: point.tangentU.clone().normalize(),
      bitangent: point.tangentV.clone().normalize(),
    };
  });

  spawner.setSurface(fixture.surface);
  spawner.setMeshSurface(fixture.meshSurface);
  const enemy = spawner.spawn('grunt', sample.u, sample.v, 0, true);
  expect(enemy.active).toBe(true);
  expect(enemy.walker).not.toBeNull();
  expect(enemy.lastMovementMode).toBe('uv');
  expectFiniteVector('enemy spawn position', enemy.position);
  assertBoundedSurfaceDrift(fixture.meshSurface, enemy.position, 0.35);

  spawner.setPlayerWorldPosition(nearby.position);
  spawner.update(0.1, sample.nearbyU, sample.nearbyV);

  expect(enemy.lastMovementMode).toBe('walker');
  expectFiniteVector('enemy moved position', enemy.position);
  expectFiniteVector('enemy target position', nearby.position);
  expect(enemy.position.distanceTo(origin.position)).toBeGreaterThan(0.01);
  assertBoundedSurfaceDrift(fixture.meshSurface, enemy.position, 0.45);
  spawner.clear();
}

function assertPickupPlacement(origin: SurfacePoint): void {
  const pickup = new THREE.Group();
  const applied = applyPickupSurfacePose(
    pickup,
    {
      position: origin.position,
      normal: origin.normal,
      tangent: origin.tangentU,
      bitangent: origin.tangentV,
    },
    { normalOffset: 0.25, spinAngle: 0.3 },
  );

  expect(applied).toBe(true);
  expect(pickup.matrix.elements.every(Number.isFinite)).toBe(true);
  expect(pickup.quaternion.toArray().every(Number.isFinite)).toBe(true);
  expect(pickup.matrix.determinant()).toBeCloseTo(1, 5);
  expect(pickup.position.distanceTo(origin.position)).toBeCloseTo(0.25, 4);
}

function assertVisibilityQuery(
  meshSurface: MeshSurface,
  origin: SurfacePoint,
  nearby: SurfacePoint,
): void {
  const resolver = new SurfaceVisibilityResolver(meshSurface);
  const playerClosest = requireClosest(meshSurface, origin.position);
  const result = resolver.resolve({
    playerWorldPosition: origin.position,
    playerFaceIndex: playerClosest.faceIndex,
    entityWorldPosition: nearby.position,
  });

  expect(result.visibility).toBeGreaterThanOrEqual(0);
  expect(result.visibility).toBeLessThanOrEqual(1);
  expect(Number.isFinite(result.topologyDistance)).toBe(true);
  expect(Number.isFinite(result.topologyDistanceRatio)).toBe(true);
  expect(['direct', 'edge-blocked', 'long-path', 'important-occluded', 'opaque-hidden']).toContain(result.className);
}

function requireClosest(meshSurface: MeshSurface, position: THREE.Vector3) {
  const closest = meshSurface.closestPointOnSurface(position);
  expect(closest).not.toBeNull();
  return closest!;
}

function assertBoundedSurfaceDrift(meshSurface: MeshSurface, position: THREE.Vector3, maxDrift: number): void {
  const closest = requireClosest(meshSurface, position);
  expect(position.distanceTo(closest.point)).toBeLessThan(maxDrift);
}

function expectFiniteVector(label: string, vector: THREE.Vector3): void {
  expect(vector.toArray().every(Number.isFinite), label).toBe(true);
}

function expectFiniteUnitVector(label: string, vector: THREE.Vector3): void {
  expectFiniteVector(label, vector);
  expect(vector.length(), label).toBeGreaterThan(0.5);
  expect(vector.length(), label).toBeLessThan(1.5);
}
