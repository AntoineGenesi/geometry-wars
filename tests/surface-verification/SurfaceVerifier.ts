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
// Types — Hit Detection
// ---------------------------------------------------------------------------

/** Status of a hit detection sample point. */
export type HitDetectionStatus = 'pass' | 'fail-no-damage' | 'fail-ghost-kill';

/** Single sample point result for hit detection test. */
export interface HitDetectionPoint {
  u: number;
  v: number;
  playerWorldPos: THREE.Vector3;
  enemyWorldPos: THREE.Vector3 | null;
  damageReceived: boolean;
  status: HitDetectionStatus;
}

/** Full result for a hit detection test run. */
export interface HitDetectionResult {
  surface: SurfaceType;
  samplePoints: HitDetectionPoint[];
  passCount: number;
  failNoDamageCount: number;
  failGhostKillCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Types — Pickup UV Roundtrip
// ---------------------------------------------------------------------------

/** Status of a pickup UV roundtrip test point. */
export type PickupUVStatus = 'pass' | 'fail' | 'skip';

/** Single sample point for pickup UV roundtrip test. */
export interface PickupUVPoint {
  u: number;
  v: number;
  recoveredU: number;
  recoveredV: number;
  /** World-space distance between original and recovered position. */
  positionError: number;
  status: PickupUVStatus;
}

/** Full result for a pickup UV roundtrip test. */
export interface PickupUVResult {
  surface: SurfaceType;
  samplePoints: PickupUVPoint[];
  passCount: number;
  failCount: number;
  /** Max position error across all points. */
  maxPositionError: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Types — Seam Traversal
// ---------------------------------------------------------------------------

/** Status of a seam traversal test. */
export type SeamTraversalStatus = 'pass' | 'warn' | 'fail';

/** Full result for a seam traversal test. */
export interface SeamTraversalResult {
  surface: SurfaceType;
  direction: string;
  crossingDetected: boolean;
  stuckBeforeSeam: boolean;
  framesUsed: number;
  status: SeamTraversalStatus;
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

  /**
   * Hit detection accuracy test.
   *
   * At a 5x5 sample grid, teleports player to each UV, waits 130 ticks for
   * invincibility to expire, spawns a wanderer enemy at the same UV, then
   * waits 10 ticks for the collision system to register. Flags points where
   * an enemy at the same position does NOT deal damage as 'fail-no-damage'.
   *
   * Also runs a false-positive check: spawns an enemy far away and expects
   * NO damage ('fail-ghost-kill' if damage occurs unexpectedly).
   *
   * @param surface   Surface type to test
   * @param density   Grid density per axis (default 5 → 25 sample points)
   */
  static runHitDetectionTest(
    surface: SurfaceType,
    density: number = 5,
  ): HitDetectionResult {
    const startMs = Date.now();

    const harness = new PlaygroundTestHarness({ surface, width: 400, height: 300, enemyCount: 0 });
    harness.tick(10); // settle

    const pg = (harness as any).pg;
    const instance = pg.instance as any;
    const walker = instance._walker;
    const meshSurface = instance._meshSurface;
    const internalSurface = instance._surface;

    // Enable infinite lives so test runs through all points even after death
    pg.player.infiniteLives = true;

    const uvPoints = SurfaceVerifier._generateGrid(surface, density);
    const samplePoints: HitDetectionPoint[] = [];

    for (const { u, v } of uvPoints) {
      // Clear any leftover enemies
      pg.enemySpawner.clear();

      // Teleport player (uses respawn which resets invincibility timer)
      const teleportResult = SurfaceVerifier._teleportPlayer(
        harness, walker, meshSurface, internalSurface, pg, u, v,
      );

      if (!teleportResult.ok) {
        samplePoints.push({
          u, v,
          playerWorldPos: teleportResult.worldPos,
          enemyWorldPos: null,
          damageReceived: false,
          status: 'pass', // skip invalid teleport points
        });
        continue;
      }

      // Wait for invincibility to expire (120 ticks = 2 seconds at 60fps) + margin
      harness.tick(130);

      const livesBeforeEnemy = pg.player.lives;

      // Now spawn enemy at the SAME UV position
      const enemy = pg.enemySpawner.spawn('wanderer' as any, u, v);
      const enemyWorldPos = enemy?.mesh?.position?.clone() ?? null;

      // Wait for enemy to materialize and collision to register
      harness.tick(10);

      const livesAfter = pg.player.lives;
      const damageReceived = livesAfter < livesBeforeEnemy || !pg.player.alive;

      let status: HitDetectionStatus;
      if (damageReceived) {
        status = 'pass';
      } else {
        status = 'fail-no-damage';
      }

      samplePoints.push({
        u, v,
        playerWorldPos: teleportResult.worldPos,
        enemyWorldPos,
        damageReceived,
        status,
      });

      // If player died, respawn for next iteration
      if (!pg.player.alive) {
        pg.player.respawn(u, v);
        harness.tick(5);
      }
    }

    // --- False-positive check: enemy far away should NOT damage player ---
    // Only run if surface has enough UV range for a distant enemy
    pg.enemySpawner.clear();
    const fpTeleport = SurfaceVerifier._teleportPlayer(
      harness, walker, meshSurface, internalSurface, pg, 0.1, 0.5,
    );

    if (fpTeleport.ok) {
      // Wait for invincibility to expire
      harness.tick(130);
      const livesBeforeFP = pg.player.lives;

      // Spawn enemy on opposite side of surface
      const farEnemy = pg.enemySpawner.spawn('wanderer' as any, 0.9, 0.5);
      const farEnemyPos = farEnemy?.mesh?.position?.clone() ?? null;

      harness.tick(20);

      const livesAfterFP = pg.player.lives;
      const ghostKill = livesAfterFP < livesBeforeFP || !pg.player.alive;

      if (ghostKill) {
        samplePoints.push({
          u: 0.9, v: 0.5,
          playerWorldPos: fpTeleport.worldPos,
          enemyWorldPos: farEnemyPos,
          damageReceived: true,
          status: 'fail-ghost-kill',
        });
      }
    }

    const passCount = samplePoints.filter(p => p.status === 'pass').length;
    const failNoDamageCount = samplePoints.filter(p => p.status === 'fail-no-damage').length;
    const failGhostKillCount = samplePoints.filter(p => p.status === 'fail-ghost-kill').length;

    return {
      surface,
      samplePoints,
      passCount,
      failNoDamageCount,
      failGhostKillCount,
      durationMs: Date.now() - startMs,
    };
  }

  /**
   * Seam traversal test.
   *
   * Walks the player continuously in direction 'w' and detects whether the
   * UV coordinate crosses the 0↔1 boundary. Returns 'pass' if crossing is
   * detected, 'fail' if the player gets stuck, 'warn' if neither crossing
   * nor stuck was detected within maxFrames.
   *
   * For Mobius: explicitly starts at U=0.8 to approach the seam at U=1.
   * The known invisible wall means it should report 'fail'.
   *
   * @param surface       Surface type to test
   * @param direction     Movement key (default 'w')
   * @param maxFrames     Max frames to simulate (default 3000)
   */
  static runSeamTraversalTest(
    surface: SurfaceType,
    direction: string = 'w',
    maxFrames: number = 3000,
  ): SeamTraversalResult {
    const startMs = Date.now();

    const harness = new PlaygroundTestHarness({ surface, width: 400, height: 300, enemyCount: 0 });
    harness.tick(10); // settle

    const pg = (harness as any).pg;
    const instance = pg.instance as any;
    const walker = instance._walker;
    const meshSurface = instance._meshSurface;
    const internalSurface = instance._surface;

    // For Mobius, start near the seam to explicitly test it
    const isMobius = (surface === 'mobius' || surface === 'mobius-bevel');
    if (isMobius) {
      SurfaceVerifier._teleportPlayer(
        harness, walker, meshSurface, internalSurface, pg, 0.8, 0.5,
      );
      harness.tick(10); // settle at U=0.8
    }

    // Attempt to find seam crossing
    const seamResult = harness.findSeamCrossing(direction, maxFrames, 'u');
    const framesUsed = seamResult.crossedAtFrame ?? maxFrames;

    if (seamResult.crossed) {
      return {
        surface,
        direction,
        crossingDetected: true,
        stuckBeforeSeam: false,
        framesUsed,
        status: 'pass',
      };
    }

    // No crossing found — check if player got stuck
    // Reset and try walkUntilStuck as a secondary check
    const harness2 = new PlaygroundTestHarness({ surface, width: 400, height: 300, enemyCount: 0 });
    harness2.tick(10);

    const pg2 = (harness2 as any).pg;
    const instance2 = pg2.instance as any;
    const walker2 = instance2._walker;
    const meshSurface2 = instance2._meshSurface;
    const internalSurface2 = instance2._surface;

    if (isMobius) {
      SurfaceVerifier._teleportPlayer(
        harness2, walker2, meshSurface2, internalSurface2, pg2, 0.8, 0.5,
      );
      harness2.tick(10);
    }

    const stuckResult = harness2.walkUntilStuck(direction, Math.min(maxFrames, 1000));

    const gotStuck = stuckResult.stuckAtFrame !== null;

    let status: SeamTraversalStatus;
    if (gotStuck) {
      // Player got stuck — that's a seam wall bug
      status = 'fail';
    } else {
      // Player moved but didn't cross seam within maxFrames — warn
      status = 'warn';
    }

    return {
      surface,
      direction,
      crossingDetected: false,
      stuckBeforeSeam: gotStuck,
      framesUsed: stuckResult.totalFrames,
      status,
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

  /**
   * Pickup UV roundtrip test.
   *
   * Tests the critical mechanism that pickup collection relies on:
   * pickups spawn at UV from `worldToSurface(enemyPos)`, and player
   * is detected by UV proximity. If worldToSurface is inaccurate,
   * pickups won't register.
   *
   * At each UV grid point: get world pos via getPoint(u,v), recover UV via
   * worldToSurface(worldPos), verify recovered world position matches original.
   * Position error > 0.5 = FAIL. Tests that pickups spawned at a UV will be
   * collectable when player stands at that position.
   *
   * @param surface   Surface type to test
   * @param density   Grid density (default 5 → 25 sample points)
   */
  static runPickupUVRoundtripTest(
    surface: SurfaceType,
    density: number = 5,
  ): PickupUVResult {
    const startMs = Date.now();

    const harness = new PlaygroundTestHarness({ surface, width: 400, height: 300, enemyCount: 0 });
    harness.tick(5); // settle

    const pg = (harness as any).pg;
    const internalSurface = pg.instance._surface;

    const uvPoints = SurfaceVerifier._generateGrid(surface, density);
    const samplePoints: PickupUVPoint[] = [];

    for (const { u, v } of uvPoints) {
      try {
        const pt = internalSurface.getPoint(u, v);
        const originalWorldPos = pt.position.clone();

        // Recover UV from world position (as pickup system does)
        const recovered = internalSurface.worldToSurface(originalWorldPos);
        const recoveredPt = internalSurface.getPoint(recovered.u, recovered.v);
        const recoveredWorldPos = recoveredPt.position.clone();

        const positionError = originalWorldPos.distanceTo(recoveredWorldPos);

        samplePoints.push({
          u, v,
          recoveredU: recovered.u,
          recoveredV: recovered.v,
          positionError,
          status: positionError > 0.5 ? 'fail' : 'pass',
        });
      } catch {
        samplePoints.push({
          u, v,
          recoveredU: 0, recoveredV: 0,
          positionError: Infinity,
          status: 'skip',
        });
      }
    }

    const passCount = samplePoints.filter(p => p.status === 'pass').length;
    const failCount = samplePoints.filter(p => p.status === 'fail').length;
    const validErrors = samplePoints.filter(p => p.status !== 'skip').map(p => p.positionError);
    const maxPositionError = validErrors.length > 0 ? Math.max(...validErrors) : 0;

    return {
      surface,
      samplePoints,
      passCount,
      failCount,
      maxPositionError,
      durationMs: Date.now() - startMs,
    };
  }

  /** Map bullet offset distance to status. */
  private static _bulletStatus(offset: number): BulletStatus {
    if (offset > BULLET_ERROR_DIST) return 'error';
    if (offset > BULLET_WARNING_DIST) return 'warning';
    return 'pass';
  }
}
