import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BulletPool } from '../entities/Bullet';
import { CubeSurface } from '../surfaces/CubeSurface';
import { MeshSurface } from '../surfaces/MeshSurface';
import { SphereSurface } from '../surfaces/SphereSurface';
import type { Surface } from '../surfaces/Surface';
import { BULLET_SPEED_WORLD } from '../shared/GameBalanceConstants';
import { advanceProjectileOnMesh } from '../surfaces/geodesic/ProjectileGeodesic';

interface TrajectoryMetrics {
  requestedDistance: number;
  traveledDistance: number;
  reversals: number;
  maxTurnDegrees: number;
  maxStep: number;
  minStep: number;
}

function traceBullet(
  surface: Surface,
  u: number,
  v: number,
  direction: THREE.Vector3,
  frames = 60,
  sharedMeshSurface?: MeshSurface,
): TrajectoryMetrics {
  surface.mesh.updateMatrixWorld(true);
  const meshSurface = sharedMeshSurface ?? new MeshSurface(surface.mesh);
  const pool = new BulletPool();
  pool.setMeshSurface(meshSurface);

  const origin = surface.getPoint(u, v).position;
  pool.spawn(origin, direction.clone().normalize(), u, v, 0);

  const dt = 1 / 60;
  let previousPosition = origin.clone();
  let previousDisplacement: THREE.Vector3 | null = null;
  let traveledDistance = 0;
  let reversals = 0;
  let maxTurnDegrees = 0;
  let maxStep = 0;
  let minStep = Infinity;

  for (let frame = 0; frame < frames; frame++) {
    pool.update(dt);
    const activePositions: THREE.Vector3[] = [];
    pool.forEachActive((_index, activePosition) => {
      activePositions.push(activePosition.clone());
    });
    const position = activePositions[0];
    expect(position, `bullet died at frame ${frame}`).not.toBeNull();
    if (!position) break;

    const displacement = position.clone().sub(previousPosition);
    const step = displacement.length();
    traveledDistance += step;
    maxStep = Math.max(maxStep, step);
    minStep = Math.min(minStep, step);

    if (previousDisplacement && previousDisplacement.lengthSq() > 1e-8 && step > 1e-4) {
      const dot = THREE.MathUtils.clamp(
        previousDisplacement.clone().normalize().dot(displacement.clone().normalize()),
        -1,
        1,
      );
      const turnDegrees = THREE.MathUtils.radToDeg(Math.acos(dot));
      maxTurnDegrees = Math.max(maxTurnDegrees, turnDegrees);
      if (dot < -0.25) reversals++;
    }

    previousPosition.copy(position);
    previousDisplacement = displacement;
  }

  if (!sharedMeshSurface) meshSurface.dispose();
  return {
    requestedDistance: frames * BULLET_SPEED_WORLD * dt,
    traveledDistance,
    reversals,
    maxTurnDegrees,
    maxStep,
    minStep,
  };
}

describe('production projectile geodesic continuity', () => {
  it('does not trap cube bullets at flat/bevel transition regions', () => {
    const cube = new CubeSurface({ size: 18 });
    const shots = [
      { label: 'side-flat to vertical bevel', u: 0.18, v: 0.5, axis: 'u' },
      { label: 'vertical bevel to side-flat', u: 0.195, v: 0.5, axis: '-u' },
      { label: 'side-flat to top bevel', u: 0.125, v: 0.68, axis: 'v' },
      { label: 'top bevel to top-flat', u: 0.125, v: 0.805, axis: 'v' },
      { label: 'diagonal flat/bevel junction', u: 0.18, v: 0.68, axis: 'diag' },
      { label: 'near top cap transition vertex', u: 0.195, v: 0.805, axis: 'diag' },
    ] as const;

    for (const shot of shots) {
      const point = cube.getPoint(shot.u, shot.v);
      const direction = shot.axis === 'u'
        ? point.tangentU
        : shot.axis === '-u'
          ? point.tangentU.clone().negate()
          : shot.axis === 'v'
            ? point.tangentV
            : point.tangentU.clone().add(point.tangentV).normalize();
      const metrics = traceBullet(cube, shot.u, shot.v, direction);

      expect(metrics.reversals, `${shot.label}: ${JSON.stringify(metrics)}`).toBe(0);
      expect(metrics.maxTurnDegrees, `${shot.label}: ${JSON.stringify(metrics)}`).toBeLessThan(70);
      expect(metrics.traveledDistance, `${shot.label}: ${JSON.stringify(metrics)}`)
        .toBeGreaterThan(metrics.requestedDistance * 0.75);
      expect(metrics.maxStep, `${shot.label}: ${JSON.stringify(metrics)}`).toBeLessThan(0.8);
      expect(metrics.minStep, `${shot.label}: ${JSON.stringify(metrics)}`).toBeGreaterThan(0.05);
    }
  });

  it('does not reverse or stall at production cube transition vertices', () => {
    const cube = new CubeSurface({ size: 18 });
    cube.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(cube.mesh);
    const transitionU = [0, 0.1875, 0.25, 0.4375, 0.5, 0.6875, 0.75, 0.9375];
    const transitionV = [0.1875, 0.3125, 0.5, 0.6875, 0.8125];
    const offsets = [-0.001, 0, 0.001];
    const failures: string[] = [];

    for (const baseU of transitionU) {
      for (const baseV of transitionV) {
        for (const offset of offsets) {
          const u = (baseU + offset + 1) % 1;
          const v = THREE.MathUtils.clamp(baseV - offset, 0.001, 0.999);
          const point = cube.getPoint(u, v);
          for (let directionIndex = 0; directionIndex < 8; directionIndex++) {
            const angle = directionIndex * Math.PI / 4;
            const direction = point.tangentU.clone().multiplyScalar(Math.cos(angle))
              .addScaledVector(point.tangentV, Math.sin(angle))
              .normalize();
            const metrics = traceBullet(cube, u, v, direction, 180, meshSurface);
            if (metrics.reversals > 0 ||
                metrics.maxTurnDegrees >= 90 ||
                metrics.traveledDistance <= metrics.requestedDistance * 0.75 ||
                metrics.minStep <= 0.02) {
              failures.push(
                `u=${u.toFixed(4)} v=${v.toFixed(4)} angle=${THREE.MathUtils.radToDeg(angle)} ` +
                JSON.stringify(metrics),
              );
            }
          }
        }
      }
    }

    meshSurface.dispose();
    expect(failures.slice(0, 20)).toEqual([]);
  }, 15_000);

  it('recovers the deterministic MP-style edge trap through the shared helper', () => {
    const cube = new CubeSurface({ size: 18 });
    cube.mesh.updateMatrixWorld(true);
    const meshSurface = new MeshSurface(cube.mesh);
    const u = 0;
    const v = 0.1875;
    const point = cube.getPoint(u, v);
    const direction = point.tangentU.clone().multiplyScalar(Math.cos(5 * Math.PI / 4))
      .addScaledVector(point.tangentV, Math.sin(5 * Math.PI / 4))
      .normalize();
    const closest = meshSurface.closestPointOnSurface(point.position);
    expect(closest).not.toBeNull();
    if (!closest) return;

    let facePosition = meshSurface.initGeodesicPosition(closest.point, closest.faceIndex);
    const position = point.position.clone();
    const currentDirection = direction.clone();
    let fallbackCount = 0;
    let reversals = 0;
    let traveledDistance = 0;
    let previousDisplacement: THREE.Vector3 | null = null;

    for (let frame = 0; frame < 180; frame++) {
      const previousPosition = position.clone();
      const result = advanceProjectileOnMesh(
        meshSurface,
        facePosition,
        position,
        currentDirection,
        BULLET_SPEED_WORLD / 60,
      );
      expect(result, `shared projectile step failed at frame ${frame}`).not.toBeNull();
      if (!result) break;

      facePosition = result.facePosition;
      position.copy(result.position);
      currentDirection.copy(result.direction);
      if (result.usedSurfaceFallback) fallbackCount++;

      const displacement = position.clone().sub(previousPosition);
      traveledDistance += displacement.length();
      if (previousDisplacement && previousDisplacement.dot(displacement) < 0) reversals++;
      previousDisplacement = displacement;
    }

    meshSurface.dispose();
    expect(fallbackCount).toBeGreaterThan(0);
    expect(reversals).toBe(0);
    expect(traveledDistance).toBeGreaterThan(11.5);
  });

  it('keeps sphere bullet travel continuous as an adjacent control', () => {
    const sphere = new SphereSurface({ radius: 10 });
    const point = sphere.getPoint(0.2, 0.5);
    const metrics = traceBullet(sphere, 0.2, 0.5, point.tangentV);

    expect(metrics.reversals).toBe(0);
    expect(metrics.traveledDistance).toBeGreaterThan(metrics.requestedDistance * 0.9);
    expect(metrics.maxStep).toBeLessThan(0.8);
    expect(metrics.minStep).toBeGreaterThan(0.05);
  });
});
