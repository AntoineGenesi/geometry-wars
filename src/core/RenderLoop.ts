import * as THREE from 'three';
import type { GameContext } from './GameContext';
import { OcclusionSurfaceMaterial } from '../rendering/OcclusionSurfaceMaterial';
import { LODLevel } from '../rendering/LODManager';
import { EnemyType } from '../entities/enemies/EnemySpawner';
import { Boss } from '../entities/enemies/Boss';
import { UIHelpers } from '../ui/UIHelpers';
import { profiler } from './PerformanceProfiler';

/**
 * Proximity visibility override using UV surface distance.
 * Enemies within PROXIMITY_NEAR_UV of the player on the surface are forced to full
 * visibility, overriding depth-occlusion dimming. Uses the same UV metric as the
 * surface dimming system so torus/ring topology is handled correctly — enemies
 * visible through the torus hole have large UV distance and stay dim even when
 * close in 3D world space.
 */
const PROXIMITY_NEAR_UV = 0.08;   // fully visible within 8% of surface (same position)
const PROXIMITY_FADE_UV = 0.15;   // fade out to surface dimming by 15% (= SURFACE_NEAR_UV)

/**
 * Surface UV-distance visibility constants.
 * Dims enemies that are far from the player along the surface — using UV coordinates
 * (normalized surface parameterization) rather than Euclidean 3D distance.
 *
 * Why UV distance instead of 3D distance: on surfaces with holes (torus, cube-ring,
 * sphere-tunnel), raycasts can pass through the hole giving 0 intersections → full
 * brightness for enemies actually far away on the surface. UV distance is always
 * proportional to surface arc length regardless of the hole topology.
 *
 * UV space is [0,1]×[0,1] for all surfaces. Distance ~0 = same position, ~0.5 = far.
 * Both U and V are treated as wrapping (correct for torus; slight over-correction for
 * non-wrapping surfaces is negligible at UV distances below 0.5).
 */
const SURFACE_NEAR_UV = 0.15;    // fully bright within 15% of surface
const SURFACE_FAR_UV  = 0.45;    // fully dim beyond 45% of surface
const SURFACE_DIM_OPACITY = 0.08; // minimum opacity for far-away enemies

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

  // Throttle HUD updates to ~10fps to reduce DOM overhead (S32 fix)
  private _lastHudUpdateTime = 0;
  private static readonly HUD_UPDATE_INTERVAL_MS = 100;

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

    profiler.end('transparency_and_occlusion');

    profiler.begin('enemy_visibility');
    const meshCenter = ctx.meshSurface.getCenter();
    const qualitySettings = ctx.adaptiveQuality.getSettings();
    const maxVisible = qualitySettings.maxVisibleEnemies;
    let visibleEnemyCount = 0;

    // Cache player UV position for surface-distance calculations (once per frame)
    const playerU = ctx.player.surfaceU;
    const playerV = ctx.player.surfaceV;
    const wrapsV = ctx.surface.wrapsV;

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

      // Surface UV-distance visibility + proximity override.
      // UV distance is computed once and reused for both:
      //   (a) dimming enemies far from the player on the surface
      //   (b) proximity override to keep very-close enemies visible despite occlusion
      //
      // Using UV distance (not Euclidean 3D) correctly handles torus/ring/sphere-tunnel
      // topology: enemies visible through the hole have small 3D distance but large UV
      // distance, so they stay dim. The old 3D proximity override brightened those enemies.
      {
        const euRaw = Math.abs(enemy.surfacePosition.u - playerU);
        const evRaw = Math.abs(enemy.surfacePosition.v - playerV);
        // Both U and V treated as wrapping — correct for torus; harmless for others
        const eu = Math.min(euRaw, 1.0 - euRaw);
        const ev = wrapsV ? Math.min(evRaw, 1.0 - evRaw) : evRaw;
        const uvDist = Math.sqrt(eu * eu + ev * ev);

        // (a) Surface dimming: min-clamp visibility based on UV distance
        let surfaceVis: number;
        if (uvDist <= SURFACE_NEAR_UV) {
          surfaceVis = 1.0;
        } else if (uvDist >= SURFACE_FAR_UV) {
          surfaceVis = SURFACE_DIM_OPACITY;
        } else {
          const uvT = (uvDist - SURFACE_NEAR_UV) / (SURFACE_FAR_UV - SURFACE_NEAR_UV);
          const uvSt = uvT * uvT * (3.0 - 2.0 * uvT);
          surfaceVis = 1.0 - uvSt * (1.0 - SURFACE_DIM_OPACITY);
        }
        visibility = Math.min(visibility, surfaceVis);

        // (b) Proximity override: enemies very close on the surface are always visible,
        // overriding depth-occlusion. Applied after min-clamp so it can only raise visibility.
        if (uvDist <= PROXIMITY_NEAR_UV) {
          visibility = Math.max(visibility, 1.0);
        } else if (uvDist <= PROXIMITY_FADE_UV) {
          const t = (uvDist - PROXIMITY_NEAR_UV) / (PROXIMITY_FADE_UV - PROXIMITY_NEAR_UV);
          visibility = Math.max(visibility, 1.0 - t);
        }
      }

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

    // Update HUD — throttled to ~10fps to reduce DOM overhead (S32 perf fix)
    const hudNow = performance.now();
    if (hudNow - this._lastHudUpdateTime >= RenderLoop.HUD_UPDATE_INTERVAL_MS) {
      this._lastHudUpdateTime = hudNow;
      UIHelpers.updateUI(ctx.player, ctx.weaponManager);
      UIHelpers.updateBoostDisplay(ctx.player.boostActive, ctx.player.boostCooldown);

      // Update weapon inventory HUD
      ctx.weaponHUD.update(ctx.weaponManager.getInventory(), ctx.weaponManager.getCurrentWeapon(), ctx.weaponMastery.getAllProgress(), ctx.weaponManager.getSessionLevels(), ctx.persistentMasteryLevels);

      // Update companion HUD
      ctx.companionHUD.update(ctx.companionManager.getCompanionCounts());

      // Update buff HUD
      ctx.buffHUD.update(ctx.buffManager.getActiveBuffs());
    }

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
    ctx.debugOverlay.setSpeedRatio(ctx.game.clock.speedRatio);
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
