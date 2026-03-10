/**
 * Surface Hit Detection Verification Tests
 *
 * Tests collision detection on ALL surfaces using the REAL game code path
 * (GameLoop.ts + CollisionSystem). Uses GameTelemetry facade for telemetry.
 *
 * Each surface is tested for:
 * - Close enemies trigger player death
 * - Far enemies do NOT trigger player death
 * - Bullets hit close enemies
 * - Bullets don't hit far enemies
 * - Player survives teleport (no false collision on spawn)
 * - Enemy positions are valid (no NaN)
 *
 * Run from main project dir (vitest can't run in worktrees):
 *   cd "/home/antoine/claude code experiments/Geometry Wars"
 *   npx vitest run src/testing/surface-hit-detection.test.ts
 */

import { describe, it, expect, afterEach } from 'vitest';
import { GameTelemetry, journey } from './GameTelemetry';
import type { SurfaceType } from '../surfaces/SurfaceFactory';

// All playable surfaces
const ALL_SURFACES: SurfaceType[] = [
  'sphere', 'cube', 'pill', 'pipe', 'torus', 'peanut',
  'capsule', 'icosahedron', 'mobius', 'sphere-tunnel',
  'cube-ring', 'cube-tunnel', 'mobius-bevel',
];

let telemetry: GameTelemetry | null = null;

afterEach(() => {
  if (telemetry) {
    telemetry.dispose();
    telemetry = null;
  }
});

describe.each(ALL_SURFACES)('Surface: %s', (surface) => {
  it('close enemy kills player', () => {
    telemetry = GameTelemetry.create({ surface, seed: 42 });

    telemetry.teleportPlayerTo(0.5, 0.5);
    telemetry.spawnEnemyAt('grunt', 0.5, 0.52);
    telemetry.waitForMaterialization(120);
    telemetry.clearCollisionLog();

    // Tick for enemy to reach player (enemies move toward player)
    telemetry.tick(120);

    const collisions = telemetry.getCollisionsByType('player-enemy');
    expect(collisions.length).toBeGreaterThan(0);
  });

  it('far enemy does NOT kill player within 30 frames', () => {
    telemetry = GameTelemetry.create({ surface, seed: 42 });

    telemetry.teleportPlayerTo(0.5, 0.5);
    telemetry.spawnEnemyAt('grunt', 0.1, 0.1);
    telemetry.waitForMaterialization(120);
    telemetry.clearCollisionLog();

    // Only 30 frames — far enemy shouldn't reach player
    telemetry.tick(30);

    const collisions = telemetry.getCollisionsByType('player-enemy');
    expect(collisions.length).toBe(0);
  });

  it('bullets hit close enemy', () => {
    telemetry = GameTelemetry.create({ surface, seed: 42 });

    telemetry.teleportPlayerTo(0.5, 0.5);
    telemetry.spawnEnemyAt('grunt', 0.5, 0.55);
    telemetry.waitForMaterialization(120);
    telemetry.clearCollisionLog();

    // Fire toward enemy
    telemetry.aimAt(400, 200);
    telemetry.startFiring();
    telemetry.tick(60);
    telemetry.stopFiring();

    const collisions = telemetry.getCollisionsByType('bullet-enemy');
    expect(collisions.length).toBeGreaterThan(0);
  });

  it('bullets dont hit far enemy in 15 frames', () => {
    telemetry = GameTelemetry.create({ surface, seed: 42 });

    telemetry.teleportPlayerTo(0.5, 0.5);
    telemetry.spawnEnemyAt('grunt', 0.1, 0.1);
    telemetry.waitForMaterialization(120);
    telemetry.clearCollisionLog();

    // Fire away from enemy, very briefly
    telemetry.aimAt(400, 500);
    telemetry.startFiring();
    telemetry.tick(15);
    telemetry.stopFiring();

    const collisions = telemetry.getCollisionsByType('bullet-enemy');
    expect(collisions.length).toBe(0);
  });

  it('player survives teleport', () => {
    telemetry = GameTelemetry.create({ surface, seed: 42 });
    telemetry.teleportPlayerTo(0.5, 0.5);
    telemetry.tick(10);
    expect(telemetry.harness.player.alive).toBe(true);
  });

  it('enemy positions are valid (no NaN)', () => {
    telemetry = GameTelemetry.create({ surface, seed: 42 });
    telemetry.teleportPlayerTo(0.5, 0.5);
    telemetry.spawnEnemyAt('grunt', 0.3, 0.3);
    telemetry.spawnEnemyAt('wanderer', 0.7, 0.7);
    telemetry.waitForMaterialization(120);
    telemetry.tick(30);

    const enemies = telemetry.getEnemyPositions();
    const alive = enemies.filter(e => e.alive);
    expect(alive.length).toBeGreaterThanOrEqual(2);

    for (const e of alive) {
      expect(isNaN(e.worldPos.x)).toBe(false);
      expect(isNaN(e.worldPos.y)).toBe(false);
      expect(isNaN(e.worldPos.z)).toBe(false);
    }
  });
});

// Telemetry API tests
describe('GameTelemetry API', () => {
  it('collision log captures events with distance data', () => {
    telemetry = GameTelemetry.create({ surface: 'sphere', seed: 42 });

    telemetry.teleportPlayerTo(0.5, 0.5);
    telemetry.spawnEnemyAt('grunt', 0.5, 0.52);
    telemetry.waitForMaterialization(120);
    telemetry.clearCollisionLog();

    telemetry.tick(120);

    const events = telemetry.getCollisionLog();
    if (events.length > 0) {
      const event = events[0];
      // Verify telemetry data structure
      expect(event.type).toBeDefined();
      expect(event.frame).toBeGreaterThanOrEqual(0);
      expect(event.distanceSq).toBeGreaterThanOrEqual(0);
      expect(event.thresholdSq).toBeGreaterThan(0);
      expect(event.entityAPos).toBeDefined();
      expect(event.entityBPos).toBeDefined();
      expect(event.surfaceType).toBe('sphere');
    }
  });

  it('frame snapshot contains all entity data', () => {
    telemetry = GameTelemetry.create({ surface: 'sphere', seed: 42 });

    telemetry.teleportPlayerTo(0.5, 0.5);
    telemetry.spawnEnemyAt('grunt', 0.3, 0.3);
    telemetry.tick(10);

    const snapshot = telemetry.getFrameSnapshot();
    expect(snapshot.frame).toBe(10);
    expect(snapshot.player.surfaceUV).toBeDefined();
    expect(snapshot.player.worldPos).toBeDefined();
    expect(snapshot.player.alive).toBe(true);
    expect(snapshot.enemies.length).toBeGreaterThan(0);
  });

  it('journey runner executes steps and collects results', () => {
    telemetry = GameTelemetry.create({ surface: 'sphere', seed: 42 });

    const steps = journey()
      .playerAt(0.5, 0.5)
      .spawnEnemy('grunt', 0.5, 0.52)
      .waitMaterialization()
      .tick(120)
      .expectCollision('player-enemy')
      .build();

    const result = telemetry.runJourney(steps);
    expect(result.surface).toBe('sphere');
    expect(result.steps.length).toBe(5);
    // The collision assertion should pass (close enemy)
    expect(result.passed).toBe(true);
  });
});
