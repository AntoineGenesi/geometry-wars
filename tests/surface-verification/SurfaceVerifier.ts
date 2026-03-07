/**
 * SurfaceVerifier — Speed Consistency + Bullet Origin Test Suites
 *
 * Two test suites for surface quality verification:
 *
 * 1. SPEED CONSISTENCY: At each UV grid point, teleport player, drive movement
 *    for N ticks, measure world-space distance per tick. Compute speedRatio vs
 *    average. Flag points < 30% average as 'slow'. Catches peanut/pill pole
 *    slowdown and torus metric distortion.
 *
 * 2. BULLET ORIGIN: At each UV grid point, fire one bullet via mouseDown + tick,
 *    measure distance from player world position to bullet world position at
 *    spawn. Distance > 0.5 units = WARNING, > 1.0 = ERROR. Catches torus
 *    outer-surface bullet offset.
 *
 * Usage:
 *   const result = SurfaceVerifier.runSpeedTest('sphere', 8, 30);
 *   const bulletResult = SurfaceVerifier.runBulletOriginTest('torus', 6);
 *
 * Design notes:
 *   - Uses PlaygroundTestHarness (headless, no browser required)
 *   - Measures in WORLD SPACE (THREE.Vector3 distances)
 *   - Walker path: (this.pg as any).instance._walker (same as SurfaceGridWalker)
 *   - One harness per surface type (not per grid point — cheaper)
 */

import * as THREE from 'three';
import { PlaygroundTestHarness } from '../../src/test/PlaygroundTestHarness';
import type { SurfaceType } from '../../src/surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status of a speed test point. */
export type SpeedStatus = 'pass' | 'slow' | 'fast' | 'teleport-failed';

/** Status of a bullet origin test point. */
export type BulletStatus = 'pass' | 'warning' | 'error' | 'no-bullet' | 'teleport-failed';

/** Single grid point result for speed test. */
export interface SpeedTestPoint {
  u: number;
  v: number;
  worldPos: THREE.Vector3;
  /** World-space distance traveled in moveTicks ticks. */
  distanceMoved: number;
  /** distanceMoved / averageDistanceMoved across all valid points. */
  speedRatio: number;
  status: SpeedStatus;
}

/** Single grid point result for bullet origin test. */
export interface BulletTestPoint {
  u: number;
  v: number;
  playerWorldPos: THREE.Vector3;
  bulletWorldPos: THREE.Vector3 | null;
  /** Distance between player and bullet spawn. Null if no bullet spawned. */
  offsetDistance: number | null;
  status: BulletStatus;
}

/** Full result for a speed consistency test run. */
export interface SpeedVerificationResult {
  surface: SurfaceType;
  gridDensity: number;
  moveTicks: number;
  points: SpeedTestPoint[];
  averageDistance: number;
  slowCount: number;
  fastCount: number;
  passCount: number;
  durationMs: number;
}

/** Full result for a bullet origin test run. */
export interface BulletVerificationResult {
  surface: SurfaceType;
  gridDensity: number;
  points: BulletTestPoint[];
  errorCount: number;
  warningCount: number;
  passCount: number;
  noBulletCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Surfaces with pole singularities — skip v near 0 and 1. */
const POLE_SURFACES = new Set<SurfaceType>(['sphere', 'pill', 'peanut', 'capsule']);

/** Non-orientable surfaces — restrict u to avoid seam artifacts. */
const MOBIUS_SURFACES = new Set<SurfaceType>(['mobius', 'mobius-bevel']);

/** Pole avoidance margin (fraction of v range). */
const POLE_MARGIN = 0.04;

/** Speed ratio below this = 'slow'. */
const SLOW_THRESHOLD = 0.30;

/** Speed ratio above this = 'fast'. */
const FAST_THRESHOLD = 3.0;

/** Bullet offset > this = 'warning'. */
const BULLET_WARNING_DIST = 0.5;

/** Bullet offset > this = 'error'. */
const BULLET_ERROR_DIST = 1.0;

// ---------------------------------------------------------------------------
// SurfaceVerifier
// ---------------------------------------------------------------------------

export class SurfaceVerifier {
  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Speed consistency test.
   *
   * At each UV grid point, teleport player, hold 'w' for moveTicks, measure
   * world-space distance. Points below SLOW_THRESHOLD * average are flagged.
   *
   * @param surface      Surface type to test
   * @param density      Grid density (density^2 = total candidate points)
   * @param moveTicks    Ticks to drive forward per point (default 30)
   */
  static runSpeedTest(
    surface: SurfaceType,
    density: number = 8,
    moveTicks: number = 30,
  ): SpeedVerificationResult {
    const startMs = Date.now();

    const harness = new PlaygroundTestHarness({ surface, width: 400, height: 300, enemyCount: 0 });
    harness.tick(10); // settle

    const pg = (harness as any).pg;
    const instance = pg.instance as any;
    const walker = instance._walker;
    const meshSurface = instance._meshSurface;
    const internalSurface = instance._surface;

    const uvPoints = SurfaceVerifier._generateGrid(surface, density);
    const rawPoints: Array<{ u: number; v: number; worldPos: THREE.Vector3; dist: number; ok: boolean }> = [];

    for (const { u, v } of uvPoints) {
      const teleportResult = SurfaceVerifier._teleportPlayer(
        harness, walker, meshSurface, internalSurface, pg, u, v,
      );

      if (!teleportResult.ok) {
        rawPoints.push({ u, v, worldPos: teleportResult.worldPos, dist: 0, ok: false });
        continue;
      }

      // Settle after teleport
      harness.tick(5);

      // Measure movement with 'w' held
      const startPos = harness.getPlayerWorldPos();
      harness.pressKey('w');
      harness.tick(moveTicks);
      harness.releaseKey('w');
      const endPos = harness.getPlayerWorldPos();

      rawPoints.push({
        u, v,
        worldPos: teleportResult.worldPos,
        dist: startPos.distanceTo(endPos),
        ok: true,
      });
    }

    // Compute average from valid points only
    const validDists = rawPoints.filter(p => p.ok).map(p => p.dist);
    const avgDist = validDists.length > 0
      ? validDists.reduce((a, b) => a + b, 0) / validDists.length
      : 1;

    // Build typed results with speed ratios
    const points: SpeedTestPoint[] = rawPoints.map(p => {
      if (!p.ok) {
        return {
          u: p.u, v: p.v, worldPos: p.worldPos,
          distanceMoved: 0, speedRatio: 0,
          status: 'teleport-failed' as SpeedStatus,
        };
      }

      const speedRatio = avgDist > 0 ? p.dist / avgDist : 0;
      let status: SpeedStatus = 'pass';
      if (speedRatio < SLOW_THRESHOLD) status = 'slow';
      else if (speedRatio > FAST_THRESHOLD) status = 'fast';

      return {
        u: p.u, v: p.v, worldPos: p.worldPos,
        distanceMoved: p.dist, speedRatio,
        status,
      };
    });

    const slowCount = points.filter(p => p.status === 'slow').length;
    const fastCount = points.filter(p => p.status === 'fast').length;
    const passCount = points.filter(p => p.status === 'pass').length;

    return {
      surface, gridDensity: density, moveTicks,
      points, averageDistance: avgDist,
      slowCount, fastCount, passCount,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Bullet origin accuracy test.
   *
   * At each UV grid point, teleport player, fire one bullet (mouseDown + tick),
   * measure distance between player world position and bullet spawn world
   * position. Large distances indicate bullet spawning from wrong surface point.
   *
   * @param surface   Surface type to test
   * @param density   Grid density (default 6)
   */
  static runBulletOriginTest(
    surface: SurfaceType,
    density: number = 6,
  ): BulletVerificationResult {
    const startMs = Date.now();

    // Aim mouse to the right so bullets fire in a consistent direction
    const harness = new PlaygroundTestHarness({ surface, width: 400, height: 300, enemyCount: 0 });
    harness.setMousePosition(600, 300); // aim right
    harness.tick(10); // settle

    const pg = (harness as any).pg;
    const instance = pg.instance as any;
    const walker = instance._walker;
    const meshSurface = instance._meshSurface;
    const internalSurface = instance._surface;

    const uvPoints = SurfaceVerifier._generateGrid(surface, density);
    const points: BulletTestPoint[] = [];

    for (const { u, v } of uvPoints) {
      const teleportResult = SurfaceVerifier._teleportPlayer(
        harness, walker, meshSurface, internalSurface, pg, u, v,
      );

      if (!teleportResult.ok) {
        points.push({
          u, v,
          playerWorldPos: teleportResult.worldPos,
          bulletWorldPos: null,
          offsetDistance: null,
          status: 'teleport-failed',
        });
        continue;
      }

      // Settle
      harness.tick(5);

      // Record player position before firing
      const playerPos = harness.getPlayerWorldPos().clone();

      // Fire bullet: mouseDown for 1 tick (fires on button down event), then release
      harness.setMouseDown(true);
      harness.tick(1);
      harness.setMouseDown(false);

      // Get bullet positions immediately after firing
      const bulletPositions = harness.getBulletWorldPositions();

      if (bulletPositions.length === 0) {
        // No bullet spawned (may be on cooldown or fire failed)
        // Try pressing space as alternate fire
        harness.pressKey(' ');
        harness.tick(1);
        harness.releaseKey(' ');
        const bulletPositions2 = harness.getBulletWorldPositions();

        if (bulletPositions2.length === 0) {
          points.push({
            u, v, playerWorldPos: playerPos,
            bulletWorldPos: null, offsetDistance: null,
            status: 'no-bullet',
          });
          continue;
        }

        const bulletPos = bulletPositions2[0].clone();
        const offset = playerPos.distanceTo(bulletPos);
        points.push({
          u, v, playerWorldPos: playerPos,
          bulletWorldPos: bulletPos,
          offsetDistance: offset,
          status: SurfaceVerifier._bulletStatus(offset),
        });
      } else {
        // Pick the closest bullet to player (most recently fired)
        const bulletPos = bulletPositions
          .reduce((closest, pos) =>
            playerPos.distanceTo(pos) < playerPos.distanceTo(closest) ? pos : closest,
          ).clone();

        const offset = playerPos.distanceTo(bulletPos);
        points.push({
          u, v, playerWorldPos: playerPos,
          bulletWorldPos: bulletPos,
          offsetDistance: offset,
          status: SurfaceVerifier._bulletStatus(offset),
        });
      }
    }

    const errorCount = points.filter(p => p.status === 'error').length;
    const warningCount = points.filter(p => p.status === 'warning').length;
    const passCount = points.filter(p => p.status === 'pass').length;
    const noBulletCount = points.filter(p => p.status === 'no-bullet').length;

    return {
      surface, gridDensity: density,
      points, errorCount, warningCount, passCount, noBulletCount,
      durationMs: Date.now() - startMs,
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /** Generate UV grid points applying per-surface constraints. */
  private static _generateGrid(surface: SurfaceType, density: number): { u: number; v: number }[] {
    const points: { u: number; v: number }[] = [];
    const isPole = POLE_SURFACES.has(surface);
    const isMobius = MOBIUS_SURFACES.has(surface);

    for (let i = 0; i < density; i++) {
      for (let j = 0; j < density; j++) {
        const u = i / density;
        const uFinal = isMobius ? u * 0.9 : u;
        const v = (j + 0.5) / density;

        if (isPole && (v < POLE_MARGIN || v > 1 - POLE_MARGIN)) {
          continue;
        }

        points.push({ u: uFinal, v });
      }
    }

    return points;
  }

  /** Teleport player to a UV point. Returns ok=false if teleport fails. */
  private static _teleportPlayer(
    harness: PlaygroundTestHarness,
    walker: any,
    meshSurface: any,
    internalSurface: any,
    pg: any,
    u: number,
    v: number,
  ): { ok: boolean; worldPos: THREE.Vector3 } {
    let worldPos = new THREE.Vector3();

    try {
      const point = internalSurface.getPoint(u, v);
      worldPos = point.position.clone();

      if (meshSurface) {
        const projected = meshSurface.closestPointOnSurface(point.position);
        if (projected) {
          walker.teleportTo(projected.point, projected.faceIndex, projected.normal);
          worldPos = projected.point.clone();
        } else {
          walker.teleportTo(point.position, 0, point.normal);
        }
      } else {
        walker.position.copy(point.position);
        walker.normal.copy(point.normal);
      }

      if (pg.player && pg.player.mesh) {
        pg.player.mesh.position.copy(walker.position);
      }

      // Sync UV via respawn
      pg.player.respawn(u, v);
      return { ok: true, worldPos };
    } catch {
      return { ok: false, worldPos };
    }
  }

  /** Map bullet offset distance to status. */
  private static _bulletStatus(offset: number): BulletStatus {
    if (offset > BULLET_ERROR_DIST) return 'error';
    if (offset > BULLET_WARNING_DIST) return 'warning';
    return 'pass';
  }
}
