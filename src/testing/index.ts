/**
 * Testing framework — public API.
 *
 * This is the entry point for the verification testing framework.
 * Other tasks can import from here to use the telemetry and journey test APIs.
 *
 * Usage:
 *   import { GameTelemetry, journey } from '../testing';
 *
 *   const telemetry = GameTelemetry.create({ surface: 'sphere' });
 *   const steps = journey()
 *     .playerAt(0.5, 0.5)
 *     .spawnEnemy('grunt', 0.5, 0.52)
 *     .waitMaterialization()
 *     .tick(60)
 *     .expectCollision('player-enemy')
 *     .build();
 *   const result = telemetry.runJourney(steps);
 *   telemetry.dispose();
 */

export { GameTelemetry, JourneyBuilder, journey } from './GameTelemetry';
export type {
  TelemetryConfig,
  EntityPosition,
  BulletPosition,
  PlayerState,
  FrameSnapshot,
  JourneyStep,
  JourneyResult,
} from './GameTelemetry';

export { runSurfaceTests, runAllSurfaceTests, ALL_SURFACES } from './SurfaceHitDetectionTests';
export type { SurfaceTestResult, TestCaseResult } from './SurfaceHitDetectionTests';

export { generateHitDetectionReport } from './HitDetectionReport';

export type { CollisionEvent } from '../core/CollisionSystem';
