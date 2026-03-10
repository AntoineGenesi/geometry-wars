/**
 * SurfaceHitDetectionTests — Journey tests for collision verification on all surfaces.
 *
 * Tests the REAL game code path (GameLoop.ts + CollisionSystem) through GameTelemetry.
 * Each surface is tested for:
 * 1. Close enemy kills player (enemy near player → player-enemy collision fires)
 * 2. Far enemy does NOT kill player (enemy far away → no collision)
 * 3. Bullets hit close enemies (fire at nearby enemy → bullet-enemy collision)
 * 4. Bullets don't hit far enemies (fire in opposite direction → no collision)
 *
 * This produces structured results suitable for HTML report generation.
 */

import type { SurfaceType } from '../surfaces/SurfaceFactory';
import { GameTelemetry, journey, type JourneyResult } from './GameTelemetry';

// ---------------------------------------------------------------------------
// All playable surfaces
// ---------------------------------------------------------------------------

export const ALL_SURFACES: SurfaceType[] = [
  'sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut',
  'capsule', 'icosahedron', 'mobius', 'sphere-tunnel',
  'cube-ring', 'cube-tunnel', 'mobius-bevel',
];

// ---------------------------------------------------------------------------
// Test definitions
// ---------------------------------------------------------------------------

export interface SurfaceTestResult {
  surface: SurfaceType;
  tests: TestCaseResult[];
  passed: number;
  failed: number;
  overall: 'PASS' | 'FAIL';
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  message: string;
  collisionCount: number;
  details: {
    playerPos?: { u: number; v: number };
    enemyPos?: { u: number; v: number };
    distance?: number;
    threshold?: number;
  };
}

// ---------------------------------------------------------------------------
// Individual test cases
// ---------------------------------------------------------------------------

/**
 * Test 1: Close enemy kills player.
 * Spawn enemy very close to player (small UV delta). After ticking,
 * player-enemy collision should fire.
 */
function testCloseEnemyKillsPlayer(surface: SurfaceType): TestCaseResult {
  const telemetry = GameTelemetry.create({ surface, seed: 42 });
  try {
    const playerU = 0.5, playerV = 0.5;
    // Very close: only 0.02 UV away
    const enemyU = 0.5, enemyV = 0.52;

    telemetry.teleportPlayerTo(playerU, playerV);
    telemetry.spawnEnemyAt('grunt', enemyU, enemyV);
    telemetry.waitForMaterialization(120);
    telemetry.clearCollisionLog();

    // Tick enough frames for collision to occur
    telemetry.tick(120);

    const collisions = telemetry.getCollisionsByType('player-enemy');
    const passed = collisions.length > 0;

    return {
      name: 'close-enemy-kills-player',
      passed,
      message: passed
        ? `Player-enemy collision fired (${collisions.length} events)`
        : 'No player-enemy collision — close enemy did NOT trigger kill',
      collisionCount: collisions.length,
      details: {
        playerPos: { u: playerU, v: playerV },
        enemyPos: { u: enemyU, v: enemyV },
        distance: collisions.length > 0 ? Math.sqrt(collisions[0].distanceSq) : undefined,
        threshold: collisions.length > 0 ? Math.sqrt(collisions[0].thresholdSq) : undefined,
      },
    };
  } finally {
    telemetry.dispose();
  }
}

/**
 * Test 2: Far enemy does NOT kill player.
 * Spawn enemy on opposite side of surface. After ticking (without player movement),
 * no player-enemy collision should occur.
 */
function testFarEnemyDoesNotKill(surface: SurfaceType): TestCaseResult {
  const telemetry = GameTelemetry.create({ surface, seed: 42 });
  try {
    const playerU = 0.5, playerV = 0.5;
    // Far away: 0.4 UV away (opposite region of surface)
    const enemyU = 0.1, enemyV = 0.1;

    telemetry.teleportPlayerTo(playerU, playerV);
    telemetry.spawnEnemyAt('grunt', enemyU, enemyV);
    telemetry.waitForMaterialization(120);
    telemetry.clearCollisionLog();

    // Tick without moving player — enemy should wander but start far
    telemetry.tick(30);

    const collisions = telemetry.getCollisionsByType('player-enemy');
    // Within 30 frames, a far enemy shouldn't reach the player
    const passed = collisions.length === 0;

    return {
      name: 'far-enemy-does-not-kill',
      passed,
      message: passed
        ? 'No collision from far enemy as expected'
        : `Unexpected collision from far enemy (${collisions.length} events, dist=${collisions[0] ? Math.sqrt(collisions[0].distanceSq).toFixed(3) : '?'})`,
      collisionCount: collisions.length,
      details: {
        playerPos: { u: playerU, v: playerV },
        enemyPos: { u: enemyU, v: enemyV },
      },
    };
  } finally {
    telemetry.dispose();
  }
}

/**
 * Test 3: Bullets hit close enemy.
 * Spawn enemy near player, fire toward it, verify bullet-enemy collision fires.
 */
function testBulletsHitCloseEnemy(surface: SurfaceType): TestCaseResult {
  const telemetry = GameTelemetry.create({ surface, seed: 42 });
  try {
    const playerU = 0.5, playerV = 0.5;
    const enemyU = 0.5, enemyV = 0.55;

    telemetry.teleportPlayerTo(playerU, playerV);
    telemetry.spawnEnemyAt('grunt', enemyU, enemyV);
    telemetry.waitForMaterialization(120);
    telemetry.clearCollisionLog();

    // Aim toward the enemy (screen center-ish) and fire
    telemetry.aimAt(400, 200); // aim upward
    telemetry.startFiring();
    telemetry.tick(60);
    telemetry.stopFiring();

    const collisions = telemetry.getCollisionsByType('bullet-enemy');
    const passed = collisions.length > 0;

    return {
      name: 'bullets-hit-close-enemy',
      passed,
      message: passed
        ? `Bullet-enemy collision fired (${collisions.length} hits)`
        : 'No bullet-enemy collision — bullets missed close enemy',
      collisionCount: collisions.length,
      details: {
        playerPos: { u: playerU, v: playerV },
        enemyPos: { u: enemyU, v: enemyV },
        distance: collisions.length > 0 ? Math.sqrt(collisions[0].distanceSq) : undefined,
        threshold: collisions.length > 0 ? Math.sqrt(collisions[0].thresholdSq) : undefined,
      },
    };
  } finally {
    telemetry.dispose();
  }
}

/**
 * Test 4: Bullets don't hit far enemy (within short timeframe).
 * Spawn enemy far away, fire briefly in a different direction.
 * No bullet-enemy collision should occur in a few frames.
 */
function testBulletsDontHitFarEnemy(surface: SurfaceType): TestCaseResult {
  const telemetry = GameTelemetry.create({ surface, seed: 42 });
  try {
    const playerU = 0.5, playerV = 0.5;
    const enemyU = 0.1, enemyV = 0.1;

    telemetry.teleportPlayerTo(playerU, playerV);
    telemetry.spawnEnemyAt('grunt', enemyU, enemyV);
    telemetry.waitForMaterialization(120);
    telemetry.clearCollisionLog();

    // Aim away from enemy and fire briefly
    telemetry.aimAt(400, 500); // aim downward (away from enemy at 0.1,0.1)
    telemetry.startFiring();
    telemetry.tick(15);
    telemetry.stopFiring();

    const collisions = telemetry.getCollisionsByType('bullet-enemy');
    const passed = collisions.length === 0;

    return {
      name: 'bullets-dont-hit-far-enemy',
      passed,
      message: passed
        ? 'No bullet collision with far enemy as expected'
        : `Unexpected bullet collision with far enemy (${collisions.length} hits)`,
      collisionCount: collisions.length,
      details: {
        playerPos: { u: playerU, v: playerV },
        enemyPos: { u: enemyU, v: enemyV },
      },
    };
  } finally {
    telemetry.dispose();
  }
}

/**
 * Test 5: Player survives after teleport (no immediate death).
 * Teleport player to a position, verify they're alive after a few frames.
 * This catches bugs where player spawns inside collision range of nothing.
 */
function testPlayerSurvivesTeleport(surface: SurfaceType): TestCaseResult {
  const telemetry = GameTelemetry.create({ surface, seed: 42 });
  try {
    telemetry.teleportPlayerTo(0.5, 0.5);
    telemetry.tick(10);

    const alive = telemetry.harness.player.alive;
    return {
      name: 'player-survives-teleport',
      passed: alive,
      message: alive
        ? 'Player alive after teleport'
        : 'Player died immediately after teleport — possible spawn-inside-collision bug',
      collisionCount: 0,
      details: { playerPos: { u: 0.5, v: 0.5 } },
    };
  } finally {
    telemetry.dispose();
  }
}

/**
 * Test 6: Enemy positions are valid (on surface, not NaN).
 * Spawn enemies and verify their positions are on the surface.
 */
function testEnemyPositionsValid(surface: SurfaceType): TestCaseResult {
  const telemetry = GameTelemetry.create({ surface, seed: 42 });
  try {
    telemetry.teleportPlayerTo(0.5, 0.5);
    telemetry.spawnEnemyAt('grunt', 0.3, 0.3);
    telemetry.spawnEnemyAt('wanderer', 0.7, 0.7);
    telemetry.waitForMaterialization(120);
    telemetry.tick(30);

    const enemies = telemetry.getEnemyPositions();
    const aliveEnemies = enemies.filter(e => e.alive);
    const invalidPositions = aliveEnemies.filter(e =>
      isNaN(e.worldPos.x) || isNaN(e.worldPos.y) || isNaN(e.worldPos.z)
    );

    const passed = aliveEnemies.length >= 2 && invalidPositions.length === 0;
    return {
      name: 'enemy-positions-valid',
      passed,
      message: passed
        ? `${aliveEnemies.length} enemies with valid positions`
        : invalidPositions.length > 0
          ? `${invalidPositions.length} enemies have NaN positions`
          : `Only ${aliveEnemies.length} alive enemies (expected >= 2)`,
      collisionCount: 0,
      details: {},
    };
  } finally {
    telemetry.dispose();
  }
}

// ---------------------------------------------------------------------------
// Run all tests on a surface
// ---------------------------------------------------------------------------

export function runSurfaceTests(surface: SurfaceType): SurfaceTestResult {
  const tests = [
    testCloseEnemyKillsPlayer(surface),
    testFarEnemyDoesNotKill(surface),
    testBulletsHitCloseEnemy(surface),
    testBulletsDontHitFarEnemy(surface),
    testPlayerSurvivesTeleport(surface),
    testEnemyPositionsValid(surface),
  ];

  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;

  return {
    surface,
    tests,
    passed,
    failed,
    overall: failed === 0 ? 'PASS' : 'FAIL',
  };
}

// ---------------------------------------------------------------------------
// Run all surfaces
// ---------------------------------------------------------------------------

export function runAllSurfaceTests(surfaces: SurfaceType[] = ALL_SURFACES): SurfaceTestResult[] {
  return surfaces.map(surface => {
    try {
      return runSurfaceTests(surface);
    } catch (error: any) {
      return {
        surface,
        tests: [{
          name: 'surface-init',
          passed: false,
          message: `Failed to initialize surface: ${error.message}`,
          collisionCount: 0,
          details: {},
        }],
        passed: 0,
        failed: 1,
        overall: 'FAIL' as const,
      };
    }
  });
}
