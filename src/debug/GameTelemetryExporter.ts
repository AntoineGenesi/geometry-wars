/**
 * GameTelemetryExporter — Exposes window.__GAME_TELEMETRY with deep game state
 * for Puppeteer-based test harness checks.
 *
 * Activated when ?debug=true. Updated every fixed-update frame.
 * Zero overhead when not active (lazy-loaded via dynamic import).
 *
 * Usage (Puppeteer):
 *   const t = await page.evaluate(() => window.__GAME_TELEMETRY);
 *   console.log(t.player.u, t.enemies.length, t.collisions.nearestEnemyDist);
 */

import type { GameContext } from '../core/GameContext';

export class GameTelemetryExporter {
  private frameCount = 0;
  private ctx: GameContext;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  /** Call once per fixed-update tick (from game.onFixedUpdate in main.ts) */
  update(): void {
    const { ctx } = this;
    const { player, enemySpawner, bulletPool, surface, surfaceType, playerWalker, game, state } = ctx;

    const pPos = player.mesh.position;
    const playerRadius = player.mesh.scale.x * 0.1;

    // Build enemy array (only active enemies)
    const enemies = enemySpawner.getEnemies();
    let nearestEnemyWorldDist = Infinity;
    let nearestEnemySurfaceDist = Infinity;
    let enemiesInPlayerRadius = 0;

    const enemyData: Array<{
      type: string;
      u: number;
      v: number;
      worldPos: { x: number; y: number; z: number };
      surfaceDistToPlayer: number;
      worldDistToPlayer: number;
      collisionRadius: number;
      isAlive: boolean;
      opacity: number;
    }> = [];

    for (const enemy of enemies) {
      if (!enemy.active) continue;

      const ePos = enemy.mesh ? enemy.mesh.position : enemy.position;
      const worldDist = pPos.distanceTo(ePos);

      // Surface distance (UV-based, same as DDA system)
      const du = player.surfaceU - enemy.surfacePosition.u;
      const dv = player.surfaceV - enemy.surfacePosition.v;
      const surfaceDist = Math.sqrt(du * du + dv * dv);

      if (worldDist < nearestEnemyWorldDist) nearestEnemyWorldDist = worldDist;
      if (surfaceDist < nearestEnemySurfaceDist) nearestEnemySurfaceDist = surfaceDist;

      // Check if within collision radius (same formula as CollisionSystem)
      const contactRadius = playerRadius + enemy.radius;
      const hitRadiusSq = contactRadius * contactRadius + enemy.radius * enemy.radius;
      if (pPos.distanceToSquared(ePos) < hitRadiusSq) {
        enemiesInPlayerRadius++;
      }

      enemyData.push({
        type: enemy.baseTypeName || enemy.constructor.name,
        u: enemy.surfacePosition.u,
        v: enemy.surfacePosition.v,
        worldPos: { x: ePos.x, y: ePos.y, z: ePos.z },
        surfaceDistToPlayer: surfaceDist,
        worldDistToPlayer: worldDist,
        collisionRadius: enemy.radius,
        isAlive: enemy.alive,
        opacity: 1.0, // actual opacity tracked by EnemyInstanceManager, not directly accessible here
      });
    }

    // Build bullet array (capped at 50 to avoid huge snapshots)
    const bulletData: Array<{
      u: number;
      v: number;
      worldPos: { x: number; y: number; z: number };
    }> = [];
    let bulletCount = 0;
    bulletPool.forEachActive((_idx, pos, data) => {
      if (bulletCount >= 50) return;
      bulletData.push({
        u: data.surfaceU,
        v: data.surfaceV,
        worldPos: { x: pos.x, y: pos.y, z: pos.z },
      });
      bulletCount++;
    });

    // Build pickup arrays
    const pickupData: Array<{
      type: string;
      u: number;
      v: number;
      worldPos: { x: number; y: number; z: number };
      distToPlayer: number;
    }> = [];
    for (const wp of ctx.pickupSpawner.weaponPickups) {
      if (!wp.active) continue;
      const wpPos = wp.mesh.position;
      pickupData.push({
        type: 'weapon',
        u: wp.surfaceU ?? 0,
        v: wp.surfaceV ?? 0,
        worldPos: { x: wpPos.x, y: wpPos.y, z: wpPos.z },
        distToPlayer: pPos.distanceTo(wpPos),
      });
    }
    for (const bp of ctx.pickupSpawner.buffPickups) {
      if (!bp.active) continue;
      const bpPos = bp.mesh.position;
      pickupData.push({
        type: 'buff',
        u: bp.surfaceU ?? 0,
        v: bp.surfaceV ?? 0,
        worldPos: { x: bpPos.x, y: bpPos.y, z: bpPos.z },
        distToPlayer: pPos.distanceTo(bpPos),
      });
    }

    // Count bullet-enemy overlaps
    let bulletsHittingEnemies = 0;
    bulletPool.forEachActive((_idx, bPos, _data) => {
      for (const enemy of enemies) {
        if (!enemy.active || !enemy.mesh) continue;
        const dist = bPos.distanceTo(enemy.mesh.position);
        if (dist < enemy.radius + 0.3) {
          bulletsHittingEnemies++;
          break; // one bullet can only hit one enemy
        }
      }
    });

    this.frameCount++;

    (window as any).__GAME_TELEMETRY = {
      player: {
        u: player.surfaceU,
        v: player.surfaceV,
        worldPos: { x: pPos.x, y: pPos.y, z: pPos.z },
        lives: player.lives,
        score: player.score,
        alive: player.alive,
        collisionRadius: playerRadius,
      },
      enemies: enemyData,
      bullets: bulletData,
      pickups: pickupData,
      surface: {
        type: String(surfaceType),
      },
      collisions: {
        enemiesInPlayerRadius,
        bulletsHittingEnemies,
        nearestEnemyDist: nearestEnemyWorldDist === Infinity ? -1 : nearestEnemyWorldDist,
        nearestEnemySurfaceDist: nearestEnemySurfaceDist === Infinity ? -1 : nearestEnemySurfaceDist,
      },
      frame: this.frameCount,
      time: game.clock.totalTime,
      fps: 1 / game.clock.fixedDeltaTime,
      isPaused: state.isPaused,
      isGameOver: state.isGameOver,
    };
  }
}
