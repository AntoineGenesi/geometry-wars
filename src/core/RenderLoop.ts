import * as THREE from 'three';
import type { GameContext } from './GameContext';
import { OcclusionSurfaceMaterial } from '../rendering/OcclusionSurfaceMaterial';
import { LODLevel } from '../rendering/LODManager';
import { EnemyType } from '../entities/enemies/EnemySpawner';
import { Boss } from '../entities/enemies/Boss';
import { UIHelpers } from '../ui/UIHelpers';
import { profiler } from './PerformanceProfiler';

/**
 * Proximity visibility override constants.
 * Enemies within PROXIMITY_BRIGHT_RADIUS of the player are forced to full visibility,
 * overriding depth-occlusion dimming. This prevents tunnel-map surfaces from hiding
 * close-proximity enemies that are about to hit the player.
 */
const PROXIMITY_BRIGHT_RADIUS = 8.0;
const PROXIMITY_BRIGHT_RADIUS_SQ = PROXIMITY_BRIGHT_RADIUS * PROXIMITY_BRIGHT_RADIUS;
/** Outer edge of smooth fade-out zone. Beyond this distance, occlusion is unaffected. */
const PROXIMITY_FADE_RADIUS = 12.0;
const PROXIMITY_FADE_RADIUS_SQ = PROXIMITY_FADE_RADIUS * PROXIMITY_FADE_RADIUS;

/**
 * RenderLoop contains the render callback logic, extracted from main.ts onRender.
 * All state is accessed through the GameContext parameter.
 */
export class RenderLoop {
  // Pre-allocated temp vectors for render loop (avoids ~5 clone() per enemy per frame)
  private _renderTempToPlayer = new THREE.Vector3();
  private _renderTempToPlayerDir = new THREE.Vector3();
  private _renderTempToEnemy = new THREE.Vector3();

  // Pre-allocated vectors for far-side enemy culling (zero per-frame allocation)
  private _farSideCamDir = new THREE.Vector3();
  private _farSideTempDir = new THREE.Vector3();

  // Module-level pre-allocated objects for zero-GC frustum visibility checks
  private _frustum = new THREE.Frustum();
  private _projScreenMatrix = new THREE.Matrix4();
  private _tempBox = new THREE.Box3();
  private _tempSphere = new THREE.Sphere();

  render(ctx: GameContext, alpha: number): void {
    profiler.begin('surface_projection');
    // Project bullets onto surface
    ctx.bulletPool.applySurfaceProjection(ctx.getTransform);
    profiler.end('surface_projection');

    profiler.begin('transparency_and_occlusion');
    // Tunnel transparency: check if surface blocks camera-to-player view
    // Uses pre-allocated vectors instead of clone()
    const camPos = ctx.game.camera.position;
    const playerPos = ctx.player.mesh.position;
    this._renderTempToPlayer.copy(playerPos).sub(camPos);
    const distToPlayer = this._renderTempToPlayer.length();
    this._renderTempToPlayerDir.copy(this._renderTempToPlayer).normalize();
    ctx.state.tunnelRaycaster.set(camPos, this._renderTempToPlayerDir);
    ctx.state.tunnelRaycaster.far = distToPlayer;
    const hits = ctx.state.tunnelRaycaster.intersectObject(ctx.surface.mesh, false);
    // If there are intersections between camera and player, fade surface
    ctx.state.isCurrentlyBlocked = hits.length > 0;
    const targetGridOpacity = ctx.state.isCurrentlyBlocked ? ctx.state.baseGridOpacity * 0.08 : ctx.state.baseGridOpacity;
    // Use actual frame delta for smooth opacity transitions on all refresh rates
    const now = performance.now();
    const rawFrameDt = (now - ctx.state.lastRenderTime) / 1000;
    const frameDt = Math.min(rawFrameDt, 0.1); // cap at 100ms for opacity transitions only
    ctx.state.lastRenderTime = now;

    // Update shockwave/chromatic/flash post-processing effects
    ctx.shockwaveEffect.update(frameDt, ctx.game.clock.totalTime);

    ctx.state.currentGridOpacity += (targetGridOpacity - ctx.state.currentGridOpacity) * Math.min(1, ctx.state.fadeSpeed * frameDt);
    // Surface uses depth-fade shader — pass camera+player positions each frame (shader handles the fade)
    const occlusionMat = ctx.surface.mesh.material as OcclusionSurfaceMaterial;
    occlusionMat.setOcclusionParams(camPos, playerPos, true);
    const gridMat = ctx.surface.gridMesh.material as THREE.LineBasicMaterial;
    gridMat.opacity = ctx.state.currentGridOpacity;

    // Depth-based occlusion + tunnel-blocking opacity + LOD-based fading for enemies
    // Raycast-based: counts surface intersections between camera and each enemy.
    // Batched across frames for performance (100 raycasts/frame).
    const allEnemies = ctx.enemySpawner.getEnemies();
    ctx.depthOcclusion.update(allEnemies, camPos, frameDt);

    // Spatial hash visibility: dim enemies far from the player in 3D space.
    // Complements depth-occlusion (geometric) with player-proximity (geographic).
    // Works correctly on torus/cube-tunnel where raycasts miss far-side enemies.
    ctx.spatialHashVisibility.update(allEnemies, playerPos, frameDt);
    profiler.end('transparency_and_occlusion');

    profiler.begin('enemy_visibility');
    const meshCenter = ctx.meshSurface.getCenter();
    const qualitySettings = ctx.adaptiveQuality.getSettings();
    const maxVisible = qualitySettings.maxVisibleEnemies;
    let visibleEnemyCount = 0;

    // Far-side enemy culling: at 150+ entities, hide regular enemies on the back of the surface.
    // Bosses are exempt — they keep their depth-occlusion opacity (dim but visible as a threat cue).
    // Uses dot product between camera direction from center and enemy direction from center.
    // Smooth fade zone near horizon (dot=0) so enemies don't pop in/out.
    const FAR_SIDE_ENTITY_THRESHOLD = 150;
    const FAR_SIDE_NEAR_DOT = 0.15;   // dot > this → fully visible (near side)
    const FAR_SIDE_FAR_DOT = -0.10;   // dot < this → hidden (far side)
    const farSideRange = FAR_SIDE_NEAR_DOT - FAR_SIDE_FAR_DOT; // 0.25

    const doFarSideCulling = allEnemies.length >= FAR_SIDE_ENTITY_THRESHOLD;
    if (doFarSideCulling) {
      // Camera direction from mesh center — computed once per frame, used per-enemy below
      this._farSideCamDir.copy(camPos).sub(meshCenter).normalize();
    }

    // Spatial hash visibility is already computed above (ctx.spatialHashVisibility.update called).

    for (const enemy of allEnemies) {
      if (!enemy.alive || !enemy.mesh) continue;

      // Adaptive quality: cap visible enemies when quality is reduced
      if (maxVisible > 0 && visibleEnemyCount >= maxVisible) {
        // Hide excess enemies by zeroing visibility
        if (enemy.isInstanced) {
          ctx.enemyInstanceManager.setInstanceVisibility(enemy, 0);
        } else if (enemy.cachedMaterials) {
          for (const mat of enemy.cachedMaterials) {
            (mat as any).transparent = true;
            (mat as any).opacity = 0;
          }
        }
        continue;
      }

      // Raycast-based occlusion: opacity based on how many surface layers are
      // between camera and this enemy. 0 layers = full, 1 = dimmed, 2+ = nearly invisible.
      let visibility = ctx.depthOcclusion.getOpacity(enemy);

      // Spatial hash visibility: dim enemies far from the player in world space.
      // Uses min() so an enemy is dim if EITHER far-from-player OR behind a surface.
      // The proximity override below (PROXIMITY_BRIGHT_RADIUS) will re-brighten any
      // enemies that are very close to the player, overriding both systems.
      const spatialVis = ctx.spatialHashVisibility.getOpacity(enemy);
      visibility = Math.min(visibility, spatialVis);

      // When surface is blocking camera-to-player, also fade enemies between camera and player
      if (ctx.state.isCurrentlyBlocked) {
        this._renderTempToEnemy.copy(enemy.position).sub(camPos);
        const enemyDist = this._renderTempToEnemy.length();
        // Check if enemy is between camera and player (closer than player)
        if (enemyDist < distToPlayer) {
          // Check if enemy is roughly along the camera-to-player line
          this._renderTempToEnemy.normalize();
          const alignment = this._renderTempToPlayerDir.dot(this._renderTempToEnemy);
          // If enemy is within ~45 degrees of the camera-to-player line, fade it
          if (alignment > 0.7) {
            const fadeFactor = (alignment - 0.7) / 0.3;
            const tunnelEnemyOpacity = 0.12;
            const tunnelVisibility = 1.0 - fadeFactor * (1.0 - tunnelEnemyOpacity);
            visibility = Math.min(visibility, tunnelVisibility);
          }
        }
      }

      // LOD-based visibility reduction: subtle fade for distant enemies
      // Keep enemies visible enough to see (previous values of 0.6/0.85 were too aggressive)
      const lodLevel = ctx.state.lodAssignments.get(enemy);
      if (lodLevel === LODLevel.LOW) {
        visibility *= 0.85;
      } else if (lodLevel === LODLevel.MEDIUM) {
        visibility *= 0.95;
      }

      // Far-side culling at high entity counts (150+): hide regular enemies on the back half
      // of the surface to reduce visual clutter. Bosses are exempt (threat cue preserved).
      if (doFarSideCulling && !(enemy instanceof Boss)) {
        // Compute enemy direction from mesh center (normalized, zero-alloc)
        this._farSideTempDir.copy(enemy.position).sub(meshCenter);
        const enemyFromCenterLen = this._farSideTempDir.length();
        if (enemyFromCenterLen > 0.001) {
          this._farSideTempDir.multiplyScalar(1 / enemyFromCenterLen);
        }
        // dot > FAR_SIDE_NEAR_DOT: near side → farFactor=1 (fully visible)
        // dot < FAR_SIDE_FAR_DOT: far side → farFactor=0 (hidden)
        // in between: smooth linear fade at the horizon
        const farSideDot = this._farSideCamDir.dot(this._farSideTempDir);
        const farFactor = Math.max(0, Math.min(1, (farSideDot - FAR_SIDE_FAR_DOT) / farSideRange));
        visibility = Math.min(visibility, farFactor);
      }

      // Proximity override: enemies within ~8 world units of player are always fully visible.
      // Applied last so it overrides depth-occlusion, tunnel-blocking fade, LOD, and far-side culling.
      // Critical for tunnel maps where occluded surfaces can hide enemies approaching the player.
      {
        const dx = enemy.position.x - playerPos.x;
        const dy = enemy.position.y - playerPos.y;
        const dz = enemy.position.z - playerPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq < PROXIMITY_BRIGHT_RADIUS_SQ) {
          visibility = Math.max(visibility, 1.0);
        } else if (distSq < PROXIMITY_FADE_RADIUS_SQ) {
          const dist = Math.sqrt(distSq);
          const t = (dist - PROXIMITY_BRIGHT_RADIUS) / (PROXIMITY_FADE_RADIUS - PROXIMITY_BRIGHT_RADIUS);
          visibility = Math.max(visibility, 1.0 - t);
        }
      }

      visibleEnemyCount++;

      // Instanced enemies: set visibility on the correct batch (type-specific or LOD shared)
      if (enemy.isInstanced) {
        if (ctx.enemyInstanceManager.isInLODBatch(enemy)) {
          // Enemy is in a shared LOD batch (simplified geometry)
          ctx.enemyInstanceManager.setLODInstanceVisibility(enemy, visibility);
        } else {
          // Enemy is in its type-specific HIGH-detail batch
          ctx.enemyInstanceManager.setInstanceVisibility(enemy, visibility);
        }
        continue;
      }

      // Non-instanced: use cached materials instead of traverse()
      if (enemy.cachedMaterials) {
        for (const mat of enemy.cachedMaterials) {
          (mat as any).transparent = true;
          (mat as any).opacity = visibility;
        }
      } else {
        // Fallback for enemies without cached materials yet
        enemy.mesh.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mat = child.material as THREE.MeshBasicMaterial;
            if (mat.transparent !== undefined) {
              mat.transparent = true;
              mat.opacity = visibility;
            }
          }
        });
      }
    }
    // Flush all instanced color/opacity changes for this frame
    ctx.enemyInstanceManager.flushColors();

    profiler.end('enemy_visibility');

    profiler.begin('camera_and_ui');
    // Apply screen shake to camera (skip when paused to prevent drift)
    if (!ctx.state.isPaused && ctx.screenShake.offset.lengthSq() > 0.0001) {
      ctx.game.camera.position.add(ctx.screenShake.offset);
    }

    // Update HUD
    UIHelpers.updateUI(ctx.player, ctx.weaponManager);
    UIHelpers.updateBoostDisplay(ctx.player.boostActive, ctx.player.boostCooldown);

    // Update weapon inventory HUD
    ctx.weaponHUD.update(ctx.weaponManager.getInventory(), ctx.weaponManager.getCurrentWeapon(), ctx.weaponMastery.getAllProgress());

    // Update companion HUD
    ctx.companionHUD.update(ctx.companionManager.getCompanionCounts());

    // Update buff HUD
    ctx.buffHUD.update(ctx.buffManager.getActiveBuffs());

    // Update level display in HUD
    if (ctx.playerLevel.level > 0) {
      const perk = ctx.playerLevel.perk;
      UIHelpers.updatePlayerLevelDisplay(ctx.playerLevel.level, perk.name, perk.auraColor, 0);
    } else {
      const killsNeeded = ctx.playerLevel.killsToNextLevel;
      UIHelpers.updatePlayerLevelDisplay(0, '', 0, killsNeeded);
    }

    // Update minimap
    const minimapEnemies = ctx.enemySpawner.getEnemies()
      .filter(e => e.mesh && !e.isMaterializing)
      .map(e => ({ u: e.surfacePosition.u, v: e.surfacePosition.v, alive: e.alive }));
    ctx.minimap.update(ctx.player.surfaceU, ctx.player.surfaceV, minimapEnemies, []);
    profiler.end('camera_and_ui');

    profiler.begin('perf_tracking');
    // Feed renderer stats to adaptive quality monitor
    ctx.adaptiveQuality.monitor.setRendererInfo(ctx.game.renderer.info as any);
    ctx.adaptiveQuality.monitor.setEntityCount(ctx.enemySpawner.getActiveCount());

    // Update debug performance overlay
    ctx.perfTracker.setEntityCount(ctx.enemySpawner.getActiveCount());
    ctx.perfTracker.setBulletCount(ctx.bulletPool.activeCount);
    ctx.perfTracker.recordFrame(rawFrameDt);
    ctx.debugOverlay.setMemoryInfo(
      ctx.game.renderer.info.memory.geometries,
      ctx.game.renderer.info.memory.textures,
    );
    ctx.debugOverlay.update();
    ctx.profilingOverlay.update();
    ctx.profilingPersistence.update(rawFrameDt);

    // Feed performance telemetry logger with all data sources
    ctx.perfLogger.setFrameData(ctx.perfTracker.fps, ctx.enemySpawner.getActiveCount(), ctx.bulletPool.activeCount);
    const monitorSnap = ctx.adaptiveQuality.monitor.getSnapshot();
    ctx.perfLogger.setRendererStats(monitorSnap.drawCalls, monitorSnap.triangles, monitorSnap.memoryMB);
    const lodStats = ctx.lodManager.getStats();
    ctx.perfLogger.setLODStats(lodStats.high, lodStats.medium, lodStats.low);
    ctx.perfLogger.setDDALevel(ctx.ddaEngine.getDDALevelSmooth(0));
    ctx.perfLogger.setDifficultyTier(ctx.waveScheduler?.currentDifficultyLevel ?? 0);
    ctx.perfLogger.setPlayerPowerLevel(ctx.playerLevel.level);
    ctx.perfLogger.setQualityLevel(ctx.adaptiveQuality.getQualityLevel());

    // Enemy type breakdown + buff string (every 30th frame to avoid per-frame allocation)
    ctx.state.perfEnemyTypeCounter++;
    if (ctx.state.perfEnemyTypeCounter >= 30) {
      ctx.state.perfEnemyTypeCounter = 0;
      ctx.state.perfEnemyTypeMap.clear();
      const enemies = ctx.enemySpawner.getEnemies();
      for (let ei = 0; ei < enemies.length; ei++) {
        const tn = (enemies[ei].baseTypeName || 'unknown') as EnemyType;
        ctx.state.perfEnemyTypeMap.set(tn, (ctx.state.perfEnemyTypeMap.get(tn) || 0) + 1);
      }
      ctx.perfLogger.setEnemyTypes(ctx.state.perfEnemyTypeMap);
    }

    // Gameplay telemetry: buff string rebuilt on same cadence as enemy types
    ctx.state.perfBuffStringCounter++;
    if (ctx.state.perfBuffStringCounter >= 30) {
      ctx.state.perfBuffStringCounter = 0;
      const activeBuffsList = ctx.buffManager.getActiveBuffs();
      if (activeBuffsList.length === 0) {
        ctx.state.perfBuffString = '';
      } else {
        // Build compact "type:stacks" string — allocates only every 30th frame
        const parts: string[] = [];
        for (let bi = 0; bi < activeBuffsList.length; bi++) {
          parts.push(activeBuffsList[bi].type + ':' + activeBuffsList[bi].stacks);
        }
        ctx.state.perfBuffString = parts.join(',');
      }
    }

    // Feed gameplay data to telemetry logger
    ctx.perfLogger.setGameplayData(
      ctx.player.score,
      ctx.ddaTracker.totalKills,
      ctx.ddaTracker.totalDeaths,
      ctx.weaponManager.getCurrentWeapon(),
      ctx.state.perfBuffString,
      ctx.particles.activeEffectCount,
    );

    // Player surface position tracking for stuck detection
    ctx.perfLogger.setPlayerSurfacePosition(
      ctx.player.surfaceU,
      ctx.player.surfaceV,
      ctx.playerWalker.faceIndex,
      ctx.playerWalker.position.x,
      ctx.playerWalker.position.y,
      ctx.playerWalker.position.z,
    );

    // Count visible entities (frustum culling check)
    this._projScreenMatrix.multiplyMatrices(ctx.game.camera.projectionMatrix, ctx.game.camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

    let visibleEnemies = 0;
    const enemies = ctx.enemySpawner.getEnemies();
    for (let ei = 0; ei < enemies.length; ei++) {
      const enemy = enemies[ei];
      if (!enemy.active || !enemy.alive) continue;
      // Use entity position + radius for frustum check (zero per-frame allocations)
      this._tempSphere.set(enemy.position, enemy.radius);
      if (this._frustum.intersectsSphere(this._tempSphere)) {
        visibleEnemies++;
      }
    }

    let visibleBullets = 0;
    ctx.bulletPool.forEachActive((_bulletIdx: number, bulletPos: THREE.Vector3, _bulletData: any) => {
      // Bullets are small points — just check if position is in frustum
      if (this._frustum.containsPoint(bulletPos)) {
        visibleBullets++;
      }
    });

    // Active explosions = current particle effects count
    const activeExplosions = ctx.particles.activeEffectCount;

    ctx.perfLogger.setVisibilityData(visibleEnemies, visibleBullets, activeExplosions);
    ctx.perfLogger.recordFrame(rawFrameDt);

    // Dynamic particle budget scaling based on active entity count
    // Reduces particle emission when many entities are on screen to maintain FPS
    const activeEnemyCount = enemies.filter(e => e.active && e.alive).length;
    const totalEntityCount = activeEnemyCount + visibleBullets;

    // Scale factor calculation:
    //   < 100 entities: 100% budget (1.0x)
    //   100-300 entities: linear scale from 100% to 50% (1.0x to 0.5x)
    //   300-500 entities: linear scale from 50% to 30% (0.5x to 0.3x)
    //   > 500 entities: 30% minimum budget (0.3x)
    let entityScaleFactor = 1.0;
    if (totalEntityCount > 100) {
      entityScaleFactor = Math.max(0.3, 1.0 - ((totalEntityCount - 100) / 400));
    }
    ctx.particles.setEntityScaleFactor(entityScaleFactor);

    // Entity audit: capture snapshot for mismatch detection (every 4th frame)
    ctx.state.auditFrameCounter++;
    if (ctx.state.auditFrameCounter % 4 === 0) {
      ctx.entityAudit.capture({
        enemySpawner: ctx.enemySpawner,
        enemyInstanceManager: ctx.enemyInstanceManager,
        bulletPool: ctx.bulletPool,
        bulletInstanceManager: ctx.bulletInstanceManager,
        player: ctx.player,
        renderer: ctx.game.renderer,
      });
    }
    profiler.end('perf_tracking');
  }
}
