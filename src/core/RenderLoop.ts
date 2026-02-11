import * as THREE from 'three';
import type { GameContext } from './GameContext';
import { LODLevel } from '../rendering/LODManager';
import { EnemyType } from '../entities/enemies/EnemySpawner';
import { UIHelpers } from '../ui/UIHelpers';

/**
 * RenderLoop contains the render callback logic, extracted from main.ts onRender.
 * All state is accessed through the GameContext parameter.
 */
export class RenderLoop {
  // Pre-allocated temp vectors for render loop (avoids ~5 clone() per enemy per frame)
  private _renderTempToPlayer = new THREE.Vector3();
  private _renderTempToPlayerDir = new THREE.Vector3();
  private _renderTempToEnemy = new THREE.Vector3();

  // Module-level pre-allocated objects for zero-GC frustum visibility checks
  private _frustum = new THREE.Frustum();
  private _projScreenMatrix = new THREE.Matrix4();
  private _tempBox = new THREE.Box3();
  private _tempSphere = new THREE.Sphere();

  render(ctx: GameContext, alpha: number): void {
    // Project bullets and geoms onto surface
    ctx.bulletPool.applySurfaceProjection(ctx.getTransform);
    ctx.geomPool.applySurfaceProjection(ctx.getTransform);

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
    const targetSurfaceOpacity = ctx.state.isCurrentlyBlocked ? ctx.state.baseSurfaceOpacity * 0.05 : ctx.state.baseSurfaceOpacity;
    const targetGridOpacity = ctx.state.isCurrentlyBlocked ? ctx.state.baseGridOpacity * 0.08 : ctx.state.baseGridOpacity;
    // Use actual frame delta for smooth opacity transitions on all refresh rates
    const now = performance.now();
    const rawFrameDt = (now - ctx.state.lastRenderTime) / 1000;
    const frameDt = Math.min(rawFrameDt, 0.1); // cap at 100ms for opacity transitions only
    ctx.state.lastRenderTime = now;

    // Update shockwave/chromatic/flash post-processing effects
    ctx.shockwaveEffect.update(frameDt, ctx.game.clock.totalTime);

    ctx.state.currentSurfaceOpacity += (targetSurfaceOpacity - ctx.state.currentSurfaceOpacity) * Math.min(1, ctx.state.fadeSpeed * frameDt);
    ctx.state.currentGridOpacity += (targetGridOpacity - ctx.state.currentGridOpacity) * Math.min(1, ctx.state.fadeSpeed * frameDt);
    const surfMat = ctx.surface.mesh.material as THREE.MeshBasicMaterial;
    surfMat.opacity = ctx.state.currentSurfaceOpacity;
    const gridMat = ctx.surface.gridMesh.material as THREE.LineBasicMaterial;
    gridMat.opacity = ctx.state.currentGridOpacity;

    // Depth-based occlusion + tunnel-blocking opacity + LOD-based fading for enemies
    // Raycast-based: counts surface intersections between camera and each enemy.
    // Batched across frames for performance (100 raycasts/frame).
    const allEnemies = ctx.enemySpawner.getEnemies();
    ctx.depthOcclusion.update(allEnemies, camPos, frameDt);

    const meshCenter = ctx.meshSurface.getCenter();
    const qualitySettings = ctx.adaptiveQuality.getSettings();
    const maxVisible = qualitySettings.maxVisibleEnemies;
    let visibleEnemyCount = 0;

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

    // Apply depth-based opacity to geoms (far-side geoms nearly invisible)
    ctx.geomPool.applyDepthOpacity(camPos, meshCenter);

    // Apply screen shake to camera (skip when paused to prevent drift)
    if (!ctx.state.isPaused && ctx.screenShake.offset.lengthSq() > 0.0001) {
      ctx.game.camera.position.add(ctx.screenShake.offset);
    }

    // Update HUD
    UIHelpers.updateUI(ctx.player, ctx.weaponManager);

    // Update weapon inventory HUD
    ctx.weaponHUD.update(ctx.weaponManager.getInventory(), ctx.weaponManager.getCurrentWeapon());

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
    const minimapGeoms: Array<{ u: number; v: number }> = [];
    ctx.geomPool.forEachActive((_i: number, u: number, v: number) => { minimapGeoms.push({ u, v }); });
    ctx.minimap.update(ctx.player.surfaceU, ctx.player.surfaceV, minimapEnemies, minimapGeoms);

    // Feed renderer stats to adaptive quality monitor
    ctx.adaptiveQuality.monitor.setRendererInfo(ctx.game.renderer.info as any);
    ctx.adaptiveQuality.monitor.setEntityCount(ctx.enemySpawner.getActiveCount());

    // Update debug performance overlay
    ctx.perfTracker.setEntityCount(ctx.enemySpawner.getActiveCount());
    ctx.perfTracker.setBulletCount(ctx.bulletPool.activeCount);
    ctx.perfTracker.recordFrame(rawFrameDt);
    ctx.debugOverlay.update();

    // Feed performance telemetry logger with all data sources
    ctx.perfLogger.setFrameData(ctx.perfTracker.fps, ctx.enemySpawner.getActiveCount(), ctx.bulletPool.activeCount);
    const monitorSnap = ctx.adaptiveQuality.monitor.getSnapshot();
    ctx.perfLogger.setRendererStats(monitorSnap.drawCalls, monitorSnap.triangles, monitorSnap.memoryMB);
    const lodStats = ctx.lodManager.getStats();
    ctx.perfLogger.setLODStats(lodStats.high, lodStats.medium, lodStats.low);
    ctx.perfLogger.setDDALevel(ctx.ddaEngine.getDDALevelSmooth(0));
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
  }
}
