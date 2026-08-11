import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EnemySpawner } from './EnemySpawner';
import { MeshSurface } from '../../surfaces/MeshSurface';
import { SurfaceFactory, type SurfaceType } from '../../surfaces/SurfaceFactory';
import type { Surface } from '../../surfaces/Surface';

type TestedSurfaceType = Extract<SurfaceType, 'sphere' | 'peanut'>;

interface Fixture {
  surface: Surface;
  meshSurface: MeshSurface;
  spawner: EnemySpawner;
}

interface SeparationMetrics {
  initialMinDistance: number;
  finalMinDistance: number;
  nearCoincidentFrames: number;
  initialDistanceToPlayer: number;
  finalDistanceToPlayer: number;
  allEnemiesRenderable: boolean;
}

function createFixture(type: TestedSurfaceType): Fixture {
  const surface = type === 'sphere'
    ? SurfaceFactory.create('sphere', { radius: 10, gridSegmentsU: 32, gridSegmentsV: 24 })
    : SurfaceFactory.create('peanut', { baseRadius: 6, waistDepth: 0.45, gridSegmentsU: 40, gridSegmentsV: 32 });
  surface.mesh.updateMatrixWorld(true);

  const meshSurface = new MeshSurface(surface.walkableMesh);
  const spawner = new EnemySpawner(new THREE.Scene(), (u, v) => {
    const point = surface.getPoint(u, v);
    return {
      position: point.position,
      normal: point.normal,
      tangent: point.tangentU,
      bitangent: point.tangentV,
    };
  });
  spawner.setSurface(surface);
  spawner.setMeshSurface(meshSurface);

  return { surface, meshSurface, spawner };
}

function distanceBetweenSpawnedEnemies(spawner: EnemySpawner): number {
  const enemies = spawner.getEnemies();
  expect(enemies).toHaveLength(2);
  return enemies[0].position.distanceTo(enemies[1].position);
}

function averageDistanceToPlayer(spawner: EnemySpawner, playerPosition: THREE.Vector3): number {
  const enemies = spawner.getEnemies();
  return enemies.reduce((sum, enemy) => sum + enemy.position.distanceTo(playerPosition), 0) / enemies.length;
}

function runStackingScenario(type: TestedSurfaceType): SeparationMetrics {
  const { surface, meshSurface, spawner } = createFixture(type);
  try {
    const enemyU = 0.18;
    const enemyV = type === 'peanut' ? 0.42 : 0.54;
    const playerU = 0.72;
    const playerV = enemyV;
    const playerPosition = surface.getPoint(playerU, playerV).position;

    spawner.setPlayerWorldPosition(playerPosition);
    spawner.spawn('grunt', enemyU, enemyV, 0, true);
    spawner.spawn('grunt', enemyU, enemyV, 0, true);

    const initialMinDistance = distanceBetweenSpawnedEnemies(spawner);
    const initialDistanceToPlayer = averageDistanceToPlayer(spawner, playerPosition);
    let nearCoincidentFrames = 0;
    let finalMinDistance = initialMinDistance;

    for (let frame = 0; frame < 90; frame++) {
      spawner.setPlayerWorldPosition(playerPosition);
      spawner.update(1 / 60, playerU, playerV);
      finalMinDistance = distanceBetweenSpawnedEnemies(spawner);
      if (finalMinDistance < 0.1) nearCoincidentFrames++;
    }

    const enemies = spawner.getEnemies();
    return {
      initialMinDistance,
      finalMinDistance,
      nearCoincidentFrames,
      initialDistanceToPlayer,
      finalDistanceToPlayer: averageDistanceToPlayer(spawner, playerPosition),
      allEnemiesRenderable: enemies.every((enemy) =>
        enemy.active &&
        !enemy.isMaterializing &&
        !!enemy.mesh &&
        (enemy.isInstanced || enemy.mesh.visible) &&
        enemy.mesh.scale.x > 0.99 &&
        enemy.position.lengthSq() > 0,
      ),
    };
  } finally {
    spawner.clear();
    meshSurface.dispose();
  }
}

describe('EnemySpawner walker separation readability', () => {
  it.each([
    ['normal sphere surface', 'sphere'],
    ['complex peanut surface', 'peanut'],
  ] as const)('unstacks exact-overlap SP chasers on %s without stopping chase pressure', (_label, type) => {
    const metrics = runStackingScenario(type);

    expect(metrics.initialMinDistance).toBeLessThan(0.001);
    expect(metrics.finalMinDistance).toBeGreaterThan(0.35);
    expect(metrics.nearCoincidentFrames).toBeLessThan(30);
    expect(metrics.finalDistanceToPlayer).toBeLessThan(metrics.initialDistanceToPlayer - 0.05);
    expect(metrics.allEnemiesRenderable).toBe(true);
  });
});
