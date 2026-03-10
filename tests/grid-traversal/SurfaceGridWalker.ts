/**
 * SurfaceGridWalker — Grid Traversal Test Utility
 *
 * Places a player at each UV grid point on a surface and tests whether
 * movement is possible in any of the 4 cardinal directions (W/A/S/D).
 *
 * Stuck detection threshold: < 0.05 world units moved in framesPerPoint frames.
 *
 * Performance note:
 *   density=10  → 100 points × 4 dirs × 60 frames =  24,000 ticks (fast)
 *   density=15  → 225 points × 4 dirs × 60 frames =  54,000 ticks (acceptable)
 *
 * One harness is created per surface type — not per grid point.
 */

import * as THREE from 'three';
import { RealGameTestHarness } from '../../src/test/RealGameTestHarness';
import type { SurfaceType } from '../../src/surfaces/SurfaceFactory';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GridPoint {
  u: number;
  v: number;
  worldPos: THREE.Vector3;
  stuck: boolean;
  stuckReason: string;
  distanceMoved: number;
}

export interface SurfaceGridResult {
  surface: SurfaceType;
  gridDensity: number;
  points: GridPoint[];
  stuckCount: number;
  passCount: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Surfaces with pole singularities — skip v near 0 and 1. */
const POLE_SURFACES = new Set<SurfaceType>(['sphere', 'pill', 'peanut', 'capsule']);

/** Non-orientable surfaces — restrict u to avoid seam artifacts. */
const MOBIUS_SURFACES = new Set<SurfaceType>(['mobius', 'mobius-bevel']);

/** Movement threshold: must move at least this far to be considered "not stuck". */
const STUCK_THRESHOLD = 0.05;

/** Pole avoidance margin (fraction of v range). */
const POLE_MARGIN = 0.04;

/** WASD direction key mapping. */
const DIRECTIONS = ['w', 'a', 's', 'd'] as const;

// ---------------------------------------------------------------------------
// SurfaceGridWalker
// ---------------------------------------------------------------------------

export class SurfaceGridWalker {
  /**
   * Run a grid traversal test on a single surface.
   *
   * @param surface     - Surface type to test
   * @param density     - Grid density (density × density = total points)
   * @param framesPerPoint - Frames to drive input per direction per point (default 60)
   * @returns Structured result with all grid points and stuck/pass counts
   */
  static runGrid(
    surface: SurfaceType,
    density: number = 15,
    framesPerPoint: number = 60,
  ): SurfaceGridResult {
    const startMs = Date.now();

    // One harness for the whole surface — cheaper than creating one per point
    const harness = new RealGameTestHarness({ surface, width: 400, height: 300, enemyCount: 0 });
    harness.tick(10); // settle initial physics

    // Access internal refs via RealGameTestHarness (exposes playerWalker, meshSurface, surface)
    // RealGameTestHarness.buildScenario uses this.playerWalker but that only works
    // if accessed via the instance. We go through the harness directly.
    const pg = (harness as any);
    const instance = pg.instance as any;
    const walker = instance._walker;
    const meshSurface = instance._meshSurface;
    const internalSurface = instance._surface;

    // Generate UV grid
    const uvPoints = SurfaceGridWalker._generateGrid(surface, density);

    const points: GridPoint[] = [];

    for (const { u, v } of uvPoints) {
      const gridPoint = SurfaceGridWalker._testPoint(
        harness,
        walker,
        meshSurface,
        internalSurface,
        pg,
        u,
        v,
        framesPerPoint,
      );
      points.push(gridPoint);
    }

    const stuckCount = points.filter(p => p.stuck).length;
    const passCount = points.length - stuckCount;
    const durationMs = Date.now() - startMs;

    return {
      surface,
      gridDensity: density,
      points,
      stuckCount,
      passCount,
      durationMs,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate UV grid points for a surface, applying per-surface constraints.
   * Returns new objects — immutable grid point list.
   */
  private static _generateGrid(surface: SurfaceType, density: number): { u: number; v: number }[] {
    const points: { u: number; v: number }[] = [];
    const isPole = POLE_SURFACES.has(surface);
    const isMobius = MOBIUS_SURFACES.has(surface);

    for (let i = 0; i < density; i++) {
      for (let j = 0; j < density; j++) {
        const u = i / density;
        // Restrict mobius u to [0, 0.9] to avoid seam artifacts
        const uFinal = isMobius ? u * 0.9 : u;

        const v = (j + 0.5) / density; // offset by 0.5 to avoid exact 0/1

        // Skip poles
        if (isPole && (v < POLE_MARGIN || v > 1 - POLE_MARGIN)) {
          continue;
        }

        points.push({ u: uFinal, v });
      }
    }

    return points;
  }

  /**
   * Test a single UV point: teleport player there, try 4 directions.
   * Point is "not stuck" if ANY direction produces movement >= STUCK_THRESHOLD.
   * Returns a new GridPoint object — no shared mutable state.
   */
  private static _testPoint(
    harness: RealGameTestHarness,
    walker: any,
    meshSurface: any,
    internalSurface: any,
    pg: any,
    u: number,
    v: number,
    framesPerPoint: number,
  ): GridPoint {
    // Get world position from surface UV
    let worldPos = new THREE.Vector3();
    let teleportOk = false;

    try {
      const point = internalSurface.getPoint(u, v);
      worldPos = point.position.clone();

      // Teleport using meshSurface.closestPointOnSurface (same pattern as lines 1022-1027)
      if (meshSurface) {
        const projected = meshSurface.closestPointOnSurface(point.position);
        if (projected) {
          walker.teleportTo(projected.point, projected.faceIndex, projected.normal);
          worldPos = projected.point.clone();
          teleportOk = true;
        } else {
          walker.teleportTo(point.position, 0, point.normal);
          teleportOk = true;
        }
      } else {
        walker.position.copy(point.position);
        walker.normal.copy(point.normal);
        teleportOk = true;
      }

      // Sync mesh to walker position
      if (pg.player && pg.player.mesh) {
        pg.player.mesh.position.copy(walker.position);
      }

      // Also call respawn for UV sync
      pg.player.respawn(u, v);
    } catch {
      // getPoint or teleport failed — mark as stuck with error reason
      return {
        u,
        v,
        worldPos,
        stuck: true,
        stuckReason: 'teleport-failed',
        distanceMoved: 0,
      };
    }

    if (!teleportOk) {
      return {
        u,
        v,
        worldPos,
        stuck: true,
        stuckReason: 'teleport-rejected',
        distanceMoved: 0,
      };
    }

    // Settle after teleport
    harness.tick(5);

    // Try each direction — point passes if ANY direction moves > threshold
    let maxDistanceMoved = 0;

    for (const dir of DIRECTIONS) {
      // Re-teleport to the same point for each direction test
      try {
        const point = internalSurface.getPoint(u, v);
        if (meshSurface) {
          const projected = meshSurface.closestPointOnSurface(point.position);
          if (projected) {
            walker.teleportTo(projected.point, projected.faceIndex, projected.normal);
          }
        }
        if (pg.player && pg.player.mesh) {
          pg.player.mesh.position.copy(walker.position);
        }
        harness.tick(3); // brief settle before direction test
      } catch {
        continue;
      }

      const startPos = harness.getPlayerWorldPos();

      harness.pressKey(dir);
      harness.tick(framesPerPoint);
      harness.releaseKey(dir);

      const endPos = harness.getPlayerWorldPos();
      const dist = startPos.distanceTo(endPos);

      if (dist > maxDistanceMoved) {
        maxDistanceMoved = dist;
      }

      // Early exit if we've confirmed movement
      if (maxDistanceMoved >= STUCK_THRESHOLD) {
        break;
      }
    }

    const stuck = maxDistanceMoved < STUCK_THRESHOLD;
    const stuckReason = stuck
      ? `moved only ${maxDistanceMoved.toFixed(4)} units (threshold: ${STUCK_THRESHOLD})`
      : '';

    return {
      u,
      v,
      worldPos,
      stuck,
      stuckReason,
      distanceMoved: maxDistanceMoved,
    };
  }
}
