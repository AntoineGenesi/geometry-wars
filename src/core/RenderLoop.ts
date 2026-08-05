import * as THREE from 'three';
import type { GameContext } from './GameContext';
import { OcclusionSurfaceMaterial } from '../rendering/OcclusionSurfaceMaterial';
import {
  SurfaceVisibilityResolver,
} from '../rendering/SurfaceVisibilityResolver';
import { applyNonInstancedEnemyVisibility } from '../rendering/EnemyMaterialVisibility';
import { resolveAndApplyPickupVisibility } from '../pickups/PickupSurfaceVisual';
import type { MeshSurface } from '../surfaces/MeshSurface';
import { EnemyType } from '../entities/enemies/EnemySpawner';
import { Boss } from '../entities/enemies/Boss';
import { UIHelpers } from '../ui/UIHelpers';
import { areOpaqueSurfacesEnabled, loadGraphicsSettings } from '../ui/SettingsMenu';
import { profiler } from './PerformanceProfiler';

/**
 * RenderLoop contains the render callback logic, extracted from main.ts onRender.
 * All state is accessed through the GameContext parameter.
 */
export class RenderLoop {
  // Pre-allocated temp vectors for render loop (avoids ~5 clone() per enemy per frame)
  private _renderTempToPlayer = new THREE.Vector3();
  private _renderTempToPlayerDir = new THREE.Vector3();

  // Module-level pre-allocated objects for zero-GC frustum visibility checks
  private _frustum = new THREE.Frustum();
  private _projScreenMatrix = new THREE.Matrix4();
  private _tempBox = new THREE.Box3();
  private _tempSphere = new THREE.Sphere();

  // Throttle HUD updates to ~10fps to reduce DOM overhead (S32 fix)
  private _lastHudUpdateTime = 0;
  private static readonly HUD_UPDATE_INTERVAL_MS = 100;

  // Pre-allocated minimap enemy array — reused each frame to avoid per-frame heap churn
  private _minimapEnemies: Array<{ u: number; v: number; alive: boolean }> = [];

  private _opaqueSurfaces = false;
  private _graphicsSettingsFrameCounter = 60;
  private _surfaceVisibilityResolver: SurfaceVisibilityResolver | null = null;
  private _surfaceVisibilityMesh: MeshSurface | null = null;

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
    // The old THREE.Raycaster path collected every triangle hit. On concave tunnel
    // views this consumed ~12ms per rendered frame. MeshSurface already owns a BVH,
    // so stop at the first hit inside the camera-to-player segment.
    const isTunnelSurface = ctx.surfaceType === 'sphere-tunnel' || ctx.surfaceType === 'cube-tunnel';
    ctx.state.isCurrentlyBlocked = isTunnelSurface && ctx.meshSurface.intersectsSegment(
      camPos,
      this._renderTempToPlayerDir,
      distToPlayer,
    );
    const targetGridOpacity = ctx.state.isCurrentlyBlocked ? ctx.state.baseGridOpacity * 0.08 : ctx.state.baseGridOpacity;
    // Use actual frame delta for smooth opacity transitions on all refresh rates
    const now = performance.now();
    const rawFrameDt = (now - ctx.state.lastRenderTime) / 1000;
    const frameDt = Math.min(rawFrameDt, 0.1); // cap at 100ms for opacity transitions only
    ctx.state.lastRenderTime = now;

    // Update shockwave/chromatic/flash post-processing effects
    ctx.shockwaveEffect.update(frameDt, ctx.game.clock.totalTime);

    ctx.state.currentGridOpacity += (targetGridOpacity - ctx.state.currentGridOpacity) * Math.min(1, ctx.state.fadeSpeed * frameDt);
    // Surface uses depth-fade shader only when the surface is actually between
    // camera and player. Leaving this enabled on visible opaque faces creates a
    // dark corridor patch around the player.
    const occlusionMat = ctx.surface.mesh.material as OcclusionSurfaceMaterial;
    ctx.surface.setSurfaceOpaqueDepthMode(this._opaqueSurfaces, ctx.state.isCurrentlyBlocked);
    occlusionMat.setOcclusionParams(camPos, playerPos, ctx.state.isCurrentlyBlocked);
    const gridMat = ctx.surface.gridMesh.material as THREE.LineBasicMaterial;
    gridMat.opacity = ctx.state.currentGridOpacity;

    // Enemy visibility is topology-based below. The camera ray above only fades
    // the surface corridor so the player remains readable.
    const allEnemies = ctx.enemySpawner.getEnemies();
    if (this._graphicsSettingsFrameCounter++ >= 60) {
      this._graphicsSettingsFrameCounter = 0;
      const graphicsSettings = loadGraphicsSettings();
      this._opaqueSurfaces = areOpaqueSurfacesEnabled(graphicsSettings);
    }
    profiler.end('transparency_and_occlusion');

    profiler.begin('enemy_visibility');
    if (this._surfaceVisibilityMesh !== ctx.meshSurface) {
      this._surfaceVisibilityMesh = ctx.meshSurface;
      this._surfaceVisibilityResolver = new SurfaceVisibilityResolver(ctx.meshSurface);
    }
    const visibilityResolver = this._surfaceVisibilityResolver!;

    for (const enemy of allEnemies) {
      if (!enemy.alive || !enemy.mesh) continue;

      const surfaceVisibility = visibilityResolver.resolve({
        playerWorldPosition: ctx.playerWalker.position,
        playerFaceIndex: ctx.playerWalker.faceIndex,
        entityWorldPosition: enemy.mesh.position,
        entityFaceIndex: enemy.walker?.faceIndex,
        opaqueSurfaces: this._opaqueSurfaces,
        enemyRadius: enemy.radius,
        important: enemy instanceof Boss,
      });
      (enemy as any).__surfaceVisibility = surfaceVisibility;
      let visibility = surfaceVisibility.visibility;
      let minColorBrightness = surfaceVisibility.minColorBrightness;

      // Debug: ?noDim=true disables ALL enemy dimming (forces full brightness)
      if ((globalThis as any).__NO_DIM) {
        visibility = 1.0;
        minColorBrightness = 1.0;
      }

      // Instanced enemies: set visibility on the correct batch (type-specific or LOD shared)
      if (enemy.isInstanced) {
        if (ctx.enemyInstanceManager.isInLODBatch(enemy)) {
          // Enemy is in a shared LOD batch (simplified geometry)
          ctx.enemyInstanceManager.setLODInstanceVisibility(enemy, visibility, minColorBrightness);
        } else {
          // Enemy is in its type-specific HIGH-detail batch
          ctx.enemyInstanceManager.setInstanceVisibility(enemy, visibility, minColorBrightness);
        }
        continue;
      }

      applyNonInstancedEnemyVisibility(enemy, visibility);
    }
    (globalThis as any).__surfaceVisibilityStats = visibilityResolver.getStats();
    // s44r29-02: Universal safety net — catch any enemy that slipped through
    // the per-enemy visibility loop with ICB below minimum (LOD transitions,
    // race conditions, skipped enemies, etc.).
    ctx.enemyInstanceManager.ensureMinimumVisibility();
    // Flush all instanced color/opacity changes for this frame
    ctx.enemyInstanceManager.flushColors();

    profiler.end('enemy_visibility');

    profiler.begin('pickup_dimming');
    const applyPickupVisibility = (pickup: { active: boolean; mesh: THREE.Group }): void => {
      if (!pickup.active) return;
      resolveAndApplyPickupVisibility({
        resolver: visibilityResolver,
        playerWorldPosition: ctx.playerWalker.position,
        playerFaceIndex: ctx.playerWalker.faceIndex,
        pickupWorldPosition: pickup.mesh.position,
        pickupMesh: pickup.mesh,
        opaqueSurfaces: this._opaqueSurfaces,
      });
    };
    const ps = ctx.pickupSpawner;
    for (const pickup of ps.superPickups) applyPickupVisibility(pickup);
    for (const pickup of ps.weaponPickups) applyPickupVisibility(pickup);
    for (const pickup of ps.buffPickups) applyPickupVisibility(pickup);
    for (const pickup of ps.newBuffPickups) applyPickupVisibility(pickup);
    for (const pickup of ps.companionPickups) applyPickupVisibility(pickup);
    for (const pickup of ps.healPickups) applyPickupVisibility(pickup);
    for (const pickup of ps.shieldPickups) applyPickupVisibility(pickup);
    profiler.end('pickup_dimming');

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
      UIHelpers.updateWaveDisplay(ctx.waveScheduler.getCurrentWave());

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

    // Update minimap — reuse pre-allocated array to avoid per-frame heap churn
    const allEnemiesForMinimap = ctx.enemySpawner.getEnemies();
    let minimapCount = 0;
    for (let i = 0; i < allEnemiesForMinimap.length; i++) {
      const e = allEnemiesForMinimap[i];
      if (!e.mesh || e.isMaterializing) continue;
      if (minimapCount < this._minimapEnemies.length) {
        const entry = this._minimapEnemies[minimapCount];
        entry.u = e.surfacePosition.u;
        entry.v = e.surfacePosition.v;
        entry.alive = e.alive;
      } else {
        this._minimapEnemies.push({ u: e.surfacePosition.u, v: e.surfacePosition.v, alive: e.alive });
      }
      minimapCount++;
    }
    this._minimapEnemies.length = minimapCount;
    ctx.minimap.update(ctx.player.surfaceU, ctx.player.surfaceV, this._minimapEnemies, []);
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
    const dominance = ctx.playerPowerRuntime?.breakdown;
    const dominanceBonus = dominance?.difficultyBonus ?? 0;
    const finalDifficulty = Number(ctx.waveScheduler?.currentDifficultyLevel ?? 0);
    ctx.perfLogger.setAdaptiveDifficultyData(
      {
        level: ctx.ddaEngine.getDDALevel(0),
        smoothLevel: ctx.ddaEngine.getDDALevelSmooth(0),
        speedAid: ctx.ddaEngine.getSpeedMultiplier(0),
        struggleComposite: ctx.ddaEngine.getCompositeScore(0),
      },
      dominance,
      {
        baseDifficulty: Math.max(0, finalDifficulty - dominanceBonus),
        dominanceBonus,
        finalDifficulty,
        enemyCap: ctx.enemySpawner.getMaxActiveEnemies(),
        spawnInterval: Math.max(0, Number(ctx.waveScheduler?.endlessNextSpawn ?? 0)
          - Number(ctx.waveScheduler?.getElapsed?.() ?? 0)),
      },
    );
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
    // Use getActiveCount() — avoids allocating a filtered array just to count
    const activeEnemyCount = ctx.enemySpawner.getActiveCount();
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

    // Quick game mode render hook (KotH HUD overlay, etc.)
    if (ctx.quickGameMode) {
      const modeCtx = {
        player: ctx.player,
        enemySpawner: ctx.enemySpawner,
        surface: ctx.surface,
        weaponManager: ctx.weaponManager,
        buffManager: ctx.buffManager,
        game: ctx.game,
        scene: ctx.game.scene,
        camera: ctx.game.camera,
      };
      ctx.quickGameMode.onRender(alpha, modeCtx);
      // Show mode-specific HUD overlay
      const hudData = ctx.quickGameMode.getHUDOverlay(modeCtx);
      // If mode has a primary metric (e.g. KotH zone time), promote it to the main
      // score display (top-center, 36px) so it's the visually dominant number.
      // Kill points / secondary info goes to the smaller mode HUD overlay below.
      if (hudData?.primary) {
        UIHelpers.getDOMElements().scoreEl.textContent = hudData.primary;
      }
      // Pass only secondary/warning to the mode HUD overlay (primary is now in scoreEl)
      RenderLoop.updateModeHUD(hudData ? {
        secondary: hudData.secondary,
        warning: hudData.warning,
        warningColor: hudData.warningColor,
      } : null);
    } else {
      RenderLoop.updateModeHUD(null);
    }
  }

  /** Show/hide a mode-specific HUD element (KotH zone bonus, Sniper ammo, etc.) */
  private static modeHudEl: HTMLElement | null = null;

  private static updateModeHUD(data: { primary?: string; primaryColor?: string; secondary?: string; warning?: string; warningColor?: string } | null): void {
    if (!data) {
      if (RenderLoop.modeHudEl) RenderLoop.modeHudEl.style.display = 'none';
      return;
    }
    if (!RenderLoop.modeHudEl) {
      const el = document.createElement('div');
      el.id = 'mode-hud';
      el.style.cssText = [
        'position:fixed', 'top:80px', 'left:50%', 'transform:translateX(-50%)',
        'text-align:center', 'pointer-events:none', 'z-index:100',
        'font-family:monospace', 'font-size:18px', 'font-weight:bold',
        'text-shadow:0 0 8px currentColor',
        'padding:4px 12px',
      ].join(';');
      document.body.appendChild(el);
      RenderLoop.modeHudEl = el;
    }
    RenderLoop.modeHudEl.style.display = 'block';
    let html = '';
    if (data.primary) {
      html += `<div style="color:${data.primaryColor ?? '#00ffff'}">${data.primary}</div>`;
    }
    if (data.secondary) {
      html += `<div style="color:#888;font-size:14px">${data.secondary}</div>`;
    }
    if (data.warning) {
      html += `<div style="color:${data.warningColor ?? '#ff4444'}">${data.warning}</div>`;
    }
    RenderLoop.modeHudEl.innerHTML = html;
  }
}
