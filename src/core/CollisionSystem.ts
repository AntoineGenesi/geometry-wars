import * as THREE from 'three';
import { Player } from '../entities/Player';
import { BulletPool } from '../entities/Bullet';
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

    // Rebuild spatial hash each frame.
    // s44r3-09: Use enemy.mesh.position (visual position, elevated above surface by
    // normal * radius) instead of enemy.position (on-surface). This aligns collision
    // with where the player SEES the enemy, fixing the "one body away" offset on
    // curved surfaces like Mobius, torus, and peanut.
    this.enemySpatialHash.clear();
    for (const enemy of enemies) {
      if (!enemy.active || !enemy.alive) continue;
      if (enemy.isMaterializing) continue;
      const visualPos = enemy.mesh ? enemy.mesh.position : enemy.position;
      this.enemySpatialHash.insert(visualPos.x, visualPos.y, visualPos.z, enemy);
    }
    if (debugFreeze) console.log('[CollisionSystem] Spatial hash rebuilt');



    bulletPool.forEachActive((bulletIdx, bulletPos, bulletData) => {
      // Get mutable bullet data so we can update remainingDamage (forEachActive passes Readonly)
      const mutableBullet = bulletPool.getBulletData(bulletIdx);

      // Lazy-init damage budget on first hit: set to the effective bullet damage at impact time.
      // This is frame-level damage (includes all multipliers) — slightly imprecise for long-lived
      // bullets but indistinguishable in practice since bullets die quickly.
      if (mutableBullet.remainingDamage < 0) {
        mutableBullet.remainingDamage = bulletDamage;
      }

      // Use spatial hash for broad-phase: only check nearby enemies
      const nearby = this.enemySpatialHash.getNearby(bulletPos.x, bulletPos.y, bulletPos.z);
      if (debugFreeze && nearby.length > 0) console.log(`[CollisionSystem] Checking ${nearby.length} nearby enemies`);

      for (let n = 0; n < nearby.length; n++) {
        const enemy = nearby[n];
        if (!enemy.active || !enemy.alive) continue;

        // s44r3-09: Compare bullet (ON surface) to enemy visual position (ABOVE surface).
        // The perpendicular offset is enemy.radius, so inflate hit radius:
        // hitRadiusSq = radius² (surface) + radius² (normal offset) = 2 * radius².
        // This preserves the same effective surface hit zone as the old code.
        const hitRadiusSq = 2 * enemy.radius * enemy.radius;
        const visualPos = enemy.mesh ? enemy.mesh.position : enemy.position;
        const distSq = bulletPos.distanceToSquared(visualPos);
        if (distSq < hitRadiusSq) {
          // --- Damage persistence (s44r2-13) ---
          // Cap damage by remaining budget; budget consumed = HP actually destroyed.
          // This enables piercing for high-damage weapons (Piercing, high-level player).
          const actualDamage = Math.min(mutableBullet.remainingDamage, enemy.health);
          enemy.takeDamage(actualDamage);
          mutableBullet.remainingDamage -= actualDamage;

          // Trigger on-hit procs (incendiary rounds, etc.)
          if (enemy.alive) {
            onBulletHit?.(enemy);
          }

          // Damage number popup
          // Show damage numbers for:
          // - Non-lethal hits (score popup covers kill on lethal hits)
          // - Companion bullets even on killing blows (provides distinct visual feedback)
          const shouldShowDamage = showDamageNumbers && scorePopups && (enemy.alive || bulletData.isCompanion);
          if (shouldShowDamage) {
            scorePopups.spawnDamage(enemy.position, actualDamage);
          }

          // Bullet impact particles (skip for companion bullets — rapid fire creates too much noise)
          if (!bulletData.isCompanion) {
            particles.bulletImpact(bulletPos);
          }

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
            // Use lightweight effect for companion kills on normal enemies to avoid frame drops
            // when many drones are killing rapidly. Boss kills always get the full effect.
            if (bulletData.isCompanion && !(enemy instanceof Boss)) {
              particles.aoeDeath(enemy.position, color);
            } else {
              particles.enemyDeath(enemy.position, color);
            }
            if (debugFreeze) console.log('[CollisionSystem] Particles spawned');
            scoreManager.awardKill(enemy.scoreValue, enemyType);
            scorePopups?.spawnScore(enemy.position.clone(), enemy.scoreValue);
            // Scale screen shake intensity based on enemy size: small enemies minimal jitter, large enemies pronounced
            const jitterIntensity = Math.max(0.05, Math.min(0.35, enemy.radius * 0.5));
            const jitterDuration = 0.15;
            screenShake.shake(jitterIntensity, jitterDuration);
            getSoundEngine().play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });
            onKillLog?.(enemyType, color.getHex());

            // Trigger bloom pulse for boss deaths only
            if (enemy instanceof Boss && bloomEffectManager) {
              bloomEffectManager.triggerBossPulse();
            }

            // Grid deformation at death position
            surface.applyForce(enemy.position, 0.2, 1.0);

            // Award score multiplier directly on kill (geoms removed — no pickup needed)
            for (let g = 0; g < enemy.geomCount; g++) {
              scoreManager.collectGeom();
            }

            // Trigger on-death procs (volatile explosions, etc.)
            if (debugFreeze) console.log('[CollisionSystem] Calling onEnemyDied callback');
            onEnemyDied?.(enemy, enemies);

            if (debugFreeze) console.log('[CollisionSystem] Calling onEnemyKilled callback');
            // Use enemy's tracked UV directly — avoids worldToSurface() which ignores
            // surface.worldRotation, causing pickups to spawn at the wrong position.
            onEnemyKilled?.(enemy.surfacePosition.u, enemy.surfacePosition.v);
            if (debugFreeze) console.log('[CollisionSystem] Enemy death complete');
          }

          // Kill bullet if damage budget exhausted; otherwise let it continue (penetration).
          if (mutableBullet.remainingDamage <= 0) {
            bulletPool.kill(bulletIdx);
            break; // Bullet is dead — stop checking more enemies this frame
          }
          // Bullet still has damage remaining: continue the loop to hit the next nearby enemy
        }
      }
    });

    if (debugFreeze) console.log('[CollisionSystem] checkBulletEnemyCollisions END');
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
      // Skip phased/invisible enemies (e.g. Phaser cycling through invisible state)
      if (enemy.isGhostForPlayer) continue;

      // s44r4-02: Compare on-surface positions directly.
      // player.mesh.position = playerWalker.position (on surface, GameLoop.ts:250)
      // enemy.position = walker.position (on surface, applySurfaceTransform)
      // hitRadius = playerRadius + enemyRadius — the exact physical formula.
      //
      // s44r3-09 used enemy.mesh.position (elevated by normal*radius) which on curved
      // surfaces like the pill body causes the 3D distance to differ from the surface
      // distance in ways the inflation formula can't fully compensate — leading to
      // misses when enemy approaches from the side (angular offset case).
      const playerRadius = player.mesh.scale.x * 0.1;
      const hitRadiusSq = (playerRadius + enemy.radius) * (playerRadius + enemy.radius);
      const distSq = player.mesh.position.distanceToSquared(enemy.position);
      if (distSq < hitRadiusSq) {
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
