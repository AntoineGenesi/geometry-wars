import * as THREE from 'three';
import { Player } from '../entities/Player';
import { BulletPool } from '../entities/Bullet';
import { GeomPool } from '../entities/Geom';
import { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { Boss } from '../entities/enemies/Boss';
import { ParticleSystem } from '../effects/ParticleSystem';
import { ScreenShake } from '../effects/ScreenShake';
import { ScoreManager } from './ScoreManager';
import { Surface } from '../surfaces/Surface';
import { getSoundEngine } from '../audio/SoundEngine';
import { ScorePopupManager } from '../effects/ScorePopup';
import { EnemyInstanceManager } from '../rendering/EnemyInstanceManager';
import { SpatialHash } from './SpatialHash';
import type { BloomEffectManager } from '../effects/BloomEffectManager';

/**
 * CollisionSystem
 *
 * Handles all collision detection and response:
 * - Bullet vs Enemy
 * - Player vs Enemy
 * - Player vs Geom pickups
 *
 * Previously ~300 lines scattered across main.ts
 */
export class CollisionSystem {
  private enemySpatialHash = new SpatialHash<BaseEnemy>(2.5);

  // Enemy color map (for particle death effects)
  private static readonly ENEMY_COLORS: Record<string, THREE.Color> = {
    wanderer: new THREE.Color(0xaa44ff),
    grunt: new THREE.Color(0x4444ff),
    duck: new THREE.Color(0xff44aa),
    mayfly: new THREE.Color(0xaaff00),
    rocket: new THREE.Color(0xff8800),
    neutron: new THREE.Color(0x44dddd),
    weaver: new THREE.Color(0x00ff44),
    spinner: new THREE.Color(0xff44ff),
    spinnerspawn: new THREE.Color(0xff88cc),
    snake: new THREE.Color(0x4488ff),
    repulsor: new THREE.Color(0xff4400),
    gravitywell: new THREE.Color(0x4488ff),
    spawner: new THREE.Color(0xff2222),
    virus: new THREE.Color(0x00cc00),
    gate: new THREE.Color(0xff8800),
    painter: new THREE.Color(0xff44aa),
    titangrunt: new THREE.Color(0x2244cc),
    titanspinner: new THREE.Color(0xff22ff),
    titanweaver: new THREE.Color(0x22ff44),
    boss: new THREE.Color(0x4488ff),
  };

  private static readonly ENEMY_COLOR_FALLBACK = new THREE.Color(0xffffff);

  /**
   * Check bullet-enemy collisions
   */
  checkBulletEnemyCollisions(
    bulletPool: BulletPool,
    enemies: BaseEnemy[],
    particles: ParticleSystem,
    scoreManager: ScoreManager,
    geomPool: GeomPool,
    surface: Surface,
    screenShake: ScreenShake,
    onEnemyKilled?: (u: number, v: number) => void,
    scorePopups?: ScorePopupManager,
    bulletDamage: number = 1,
    onKillLog?: (type: string, color: number) => void,
    showDamageNumbers = true,
    onBulletHit?: (enemy: BaseEnemy) => void,
    onEnemyDied?: (enemy: BaseEnemy, allEnemies: BaseEnemy[]) => void,
    instanceManager?: EnemyInstanceManager | null,
    bloomEffectManager?: BloomEffectManager | null,
  ): void {
    // DIAGNOSTIC: Entry guard (remove after freeze investigation)
    const debugFreeze = (window as any).__debugFreeze ?? false;
    if (debugFreeze) console.log('[CollisionSystem] checkBulletEnemyCollisions START');

    // Rebuild spatial hash each frame
    this.enemySpatialHash.clear();
    for (const enemy of enemies) {
      if (!enemy.active || !enemy.alive) continue;
      if (enemy.isMaterializing) continue;
      this.enemySpatialHash.insert(enemy.position.x, enemy.position.y, enemy.position.z, enemy);
    }
    if (debugFreeze) console.log('[CollisionSystem] Spatial hash rebuilt');



    bulletPool.forEachActive((bulletIdx, bulletPos, bulletData) => {
      // Use spatial hash for broad-phase: only check nearby enemies
      const nearby = this.enemySpatialHash.getNearby(bulletPos.x, bulletPos.y, bulletPos.z);
      if (debugFreeze && nearby.length > 0) console.log(`[CollisionSystem] Checking ${nearby.length} nearby enemies`);

      for (let n = 0; n < nearby.length; n++) {
        const enemy = nearby[n];
        if (!enemy.active || !enemy.alive) continue;

        // Use distanceToSquared to avoid sqrt
        // +0.05 is a small tolerance for bullet-point imprecision; larger values cause
        // visually-missed shots to register hits (S27g hitbox fix).
        const hitRadiusSq = (enemy.radius + 0.05) * (enemy.radius + 0.05);
        const distSq = bulletPos.distanceToSquared(enemy.position);
        if (distSq < hitRadiusSq) {
          // Capture bullet angle BEFORE kill (data persists but capture for clarity)
          const bulletAngle = bulletData.angle;

          // Hit!
          bulletPool.kill(bulletIdx);
          enemy.takeDamage(bulletDamage);

          // Trigger on-hit procs (incendiary rounds, etc.)
          if (enemy.alive) {
            onBulletHit?.(enemy);
          }

          // Damage number popup (skip on killing blow - score popup covers it)
          if (showDamageNumbers && scorePopups && enemy.alive) {
            scorePopups.spawnDamage(enemy.position, bulletDamage);
          }

          // Bullet impact particles
          particles.bulletImpact(bulletPos);

          // Grid deformation at impact point
          surface.applyForce(bulletPos, 0.08, 0.3);

          // Hit flash: instanced enemies use instanceColor, others use cached materials
          if (enemy.alive) {
            if (enemy.isInstanced && instanceManager) {
              instanceManager.hitFlash(enemy, 80);
            } else if (enemy.cachedMaterials) {
              for (const mat of enemy.cachedMaterials) {
                const origEmissive = mat.emissive.getHex();
                mat.emissive.setHex(0xffffff);
                mat.emissiveIntensity = 1.0;
                setTimeout(() => {
                  mat.emissive.setHex(origEmissive);
                  mat.emissiveIntensity = 0.4;
                }, 80);
              }
            }
          }

          if (!enemy.alive) {
            // Enemy died
            if (debugFreeze) console.log('[CollisionSystem] Enemy died, starting death callback');
            const enemyType = enemy.constructor.name.toLowerCase();
            const color = CollisionSystem.ENEMY_COLORS[enemyType] ?? CollisionSystem.ENEMY_COLOR_FALLBACK;
            particles.enemyDeath(enemy.position, color);
            if (debugFreeze) console.log('[CollisionSystem] Particles spawned');
            scoreManager.awardKill(enemy.scoreValue, enemyType);
            scorePopups?.spawnScore(enemy.position.clone(), enemy.scoreValue);
            screenShake.shake(0.15, 0.15);
            getSoundEngine().play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });
            onKillLog?.(enemyType, color.getHex());

            // Trigger bloom pulse for boss deaths only
            if (enemy instanceof Boss && bloomEffectManager) {
              bloomEffectManager.triggerBossPulse();
            }

            // Grid deformation at death position
            surface.applyForce(enemy.position, 0.2, 1.0);

            // Spawn geoms at death position with kill-shot momentum
            if (debugFreeze) console.log('[CollisionSystem] Converting world to UV');
            const { u, v } = surface.worldToSurface(enemy.position);
            if (debugFreeze) console.log('[CollisionSystem] UV conversion complete, spawning geoms');
            for (let g = 0; g < enemy.geomCount; g++) {
              geomPool.spawn(u, v, bulletAngle);
            }

            // Trigger on-death procs (volatile explosions, etc.)
            if (debugFreeze) console.log('[CollisionSystem] Calling onEnemyDied callback');
            onEnemyDied?.(enemy, enemies);

            if (debugFreeze) console.log('[CollisionSystem] Calling onEnemyKilled callback');
            onEnemyKilled?.(u, v);
            if (debugFreeze) console.log('[CollisionSystem] Enemy death complete');
          }

          break; // Each bullet hits one enemy
        }
      }
    });

    if (debugFreeze) console.log('[CollisionSystem] checkBulletEnemyCollisions END');
  }

  /**
   * Check player-geom pickup collisions
   */
  checkGeomPickups(
    player: Player,
    geomPool: GeomPool,
    scoreManager: ScoreManager,
    particles: ParticleSystem,
    bonusRadius = 0,
  ): void {
    const baseRadius = 0.5 + bonusRadius;
    const pickupRadiusSq = baseRadius * baseRadius; // Squared radius avoids sqrt
    geomPool.forEachActive((index, surfaceU, surfaceV, position) => {
      const distSq = player.mesh.position.distanceToSquared(position);
      if (distSq < pickupRadiusSq) {
        geomPool.kill(index);
        scoreManager.collectGeom();
        // Green sparkle effect on collection
        particles.geomCollect(position);
        getSoundEngine().play('geomPickup', { pitch: 0.9 + Math.random() * 0.2 });
      }
    });
  }

  /**
   * Check player-enemy collisions
   */
  checkPlayerEnemyCollisions(
    player: Player,
    enemies: BaseEnemy[],
    particles: ParticleSystem,
    screenShake: ScreenShake,
    isShielded: boolean,
    onPlayerHit?: () => boolean,
  ): void {
    if (!player.canTakeDamage) return;

    for (const enemy of enemies) {
      if (!enemy.active) continue;
      // Skip enemies still spawning
      if (enemy.isMaterializing) continue;

      // Use distanceToSquared to avoid sqrt
      const hitRadius = player.mesh.scale.x * 0.3 + enemy.radius;
      const distSq = player.mesh.position.distanceToSquared(enemy.position);
      if (distSq < hitRadius * hitRadius) {
        if (isShielded) {
          // Shield absorbs the hit and kills the enemy
          enemy.takeDamage(999);
          particles.bulletImpact(enemy.position);
          screenShake.shake(0.2, 0.15);
          getSoundEngine().play('shieldHit');
        } else {
          // Try companion shield (protector) before dying
          const saved = onPlayerHit?.() ?? false;
          if (saved) {
            // Companion protector activated - kill the enemy, player survives
            enemy.takeDamage(999);
            particles.bulletImpact(enemy.position);
            screenShake.shake(0.3, 0.2);
            // Screen flash handled by caller
            break;
          }
          player.die();
          particles.playerDeath(player.mesh.position);
          screenShake.shake(0.5, 0.4);
          getSoundEngine().play('playerDeath');
          // Screen flash handled by caller
          break;
        }
      }
    }
  }
}
