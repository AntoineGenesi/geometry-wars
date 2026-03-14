import * as THREE from 'three';
import type { GameContext } from './GameContext';
import { OcclusionSurfaceMaterial } from '../rendering/OcclusionSurfaceMaterial';
import { LODLevel } from '../rendering/LODManager';
import { EnemyType } from '../entities/enemies/EnemySpawner';
import { Boss } from '../entities/enemies/Boss';
import { UIHelpers } from '../ui/UIHelpers';
import { profiler } from './PerformanceProfiler';

/**
 * Proximity visibility override using world-space (Euclidean 3D) distance.
 * Enemies within PROXIMITY_NEAR_WORLD units of the player are forced to full
 * visibility, overriding depth-occlusion and surface-dimming.
 *
 * World distance is used instead of UV distance because UV space is severely
 * warped near poles (sphere, peanut, capsule): two enemies at the same pole
 * with different longitudes have large UV distance but near-zero world distance.
 * UV-based proximity incorrectly dimmed these enemies even though they were
 * physically adjacent and about to hit the player.
 *
 * The cube-tunnel opposite-wall guard (areOnOppositeWallSides) still prevents
 * the inner-wall false-positive that was the original motivation for UV distance.
 */
const PROXIMITY_NEAR_WORLD    = 2.0;   // fully visible within 2 world units
const PROXIMITY_NEAR_WORLD_SQ = PROXIMITY_NEAR_WORLD * PROXIMITY_NEAR_WORLD;
const PROXIMITY_FADE_WORLD    = 5.0;   // fade to surface dimming by 5 world units
const PROXIMITY_FADE_WORLD_SQ = PROXIMITY_FADE_WORLD * PROXIMITY_FADE_WORLD;

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
 *
 * HYSTERESIS (anti-flicker): entities near the near-threshold oscillate between
 * fully-bright and partially-dimmed states when their UV distance hovers around 0.15.
 * Two separate thresholds prevent this: dimming starts only when crossing ENTER (0.17)
 * and stops only when crossing EXIT (0.13). This eliminates flickering on compact
 * surfaces like the small torus where enemies frequently orbit the threshold.
 */
const SURFACE_NEAR_UV = 0.15;        // midpoint of hysteresis band (kept for reference)
const SURFACE_NEAR_UV_ENTER = 0.17;  // start dimming when uvDist exceeds this (from bright)
const SURFACE_NEAR_UV_EXIT  = 0.13;  // stop dimming when uvDist drops below this (from dimmed)
const SURFACE_FAR_UV  = 0.45;    // fully dim beyond 45% of surface
const SURFACE_DIM_OPACITY = 0.40; // minimum opacity for far-away enemies (s44r16-07: raised from 0.15; at 0.15 double-dimming = 2.25% invisible on dark bg)

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

  // Hysteresis state for far-side entity culling.
  // Prevents flickering when enemy count oscillates around the activation threshold.
  private _farSideCullingActive = false;

  // Per-entity dimmed state for UV-distance hysteresis.
  // Tracks whether each entity was dimmed last frame so we can apply two separate
  // thresholds for entering vs exiting the dimmed state. WeakMap ensures automatic
  // cleanup when enemies are garbage-collected (no manual disposal needed).
  private _entityDimmedState: WeakMap<object, boolean> = new WeakMap();

  // Pre-allocated minimap enemy array — reused each frame to avoid per-frame heap churn
  private _minimapEnemies: Array<{ u: number; v: number; alive: boolean }> = [];

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

    // Far-side enemy culling: at high entity counts, hide regular enemies on the back of the surface.
    // Bosses are exempt — they keep their depth-occlusion opacity (dim but visible as a threat cue).
    // Uses dot product between camera direction from center and enemy direction from center.
    // Smooth fade zone near horizon (dot=0) so enemies don't pop in/out.
    //
    // Hysteresis: turn ON at 150 entities, turn OFF below 120. This prevents flickering when
    // enemy count oscillates around 150 (enemies dying/spawning), which would otherwise cause
    // far-side entities to abruptly jump between their dimmed state and fully hidden.
    const FAR_SIDE_ENTITY_THRESHOLD_ON  = 150;
    const FAR_SIDE_ENTITY_THRESHOLD_OFF = 120;
    const FAR_SIDE_NEAR_DOT = 0.15;   // dot > this → fully visible (near side)
    const FAR_SIDE_FAR_DOT = -0.10;   // dot < this → hidden (far side)
    const farSideRange = FAR_SIDE_NEAR_DOT - FAR_SIDE_FAR_DOT; // 0.25

    if (!this._farSideCullingActive && allEnemies.length >= FAR_SIDE_ENTITY_THRESHOLD_ON) {
      this._farSideCullingActive = true;
    } else if (this._farSideCullingActive && allEnemies.length < FAR_SIDE_ENTITY_THRESHOLD_OFF) {
      this._farSideCullingActive = false;
    }
    const doFarSideCulling = this._farSideCullingActive;
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

      // Surface UV-distance visibility + world-space proximity override.
      // UV distance is computed for:
      //   (a) surface dimming — dims enemies far from the player along the surface
      // World-space (Euclidean 3D) distance is used for:
      //   (b) proximity override — keeps very-close enemies visible despite occlusion
      //
      // UV distance for (a) correctly handles torus/ring topology: enemies visible through
      // the hole have large UV distance and stay dim.
      // World distance for (b) correctly handles pole distortion: near poles, enemies with
      // the same latitude but different longitude have large UV distance but tiny world
      // distance — they should be visible, not dimmed.
      {
        const euRaw = Math.abs(enemy.surfacePosition.u - playerU);
        const evRaw = Math.abs(enemy.surfacePosition.v - playerV);
        // Both U and V treated as wrapping — correct for torus; harmless for others
        const eu = Math.min(euRaw, 1.0 - euRaw);
        const ev = wrapsV ? Math.min(evRaw, 1.0 - evRaw) : evRaw;
        const uvDist = Math.sqrt(eu * eu + ev * ev);

        // (a) Surface dimming: min-clamp visibility based on UV distance.
        // Hysteresis prevents flickering when uvDist hovers near the near threshold:
        //   - If entity was NOT dimmed last frame: only start dimming past ENTER (0.17)
        //   - If entity WAS dimmed last frame:   only stop dimming below EXIT  (0.13)
        // This ±0.02 deadband eliminates the bright↔dim oscillation on small torus.
        let surfaceVis: number;
        const wasDimmed = this._entityDimmedState.get(enemy) ?? false;
        const nearThreshold = wasDimmed ? SURFACE_NEAR_UV_EXIT : SURFACE_NEAR_UV_ENTER;
        if (uvDist <= nearThreshold) {
          surfaceVis = 1.0;
          this._entityDimmedState.set(enemy, false);
        } else if (uvDist >= SURFACE_FAR_UV) {
          surfaceVis = SURFACE_DIM_OPACITY;
          this._entityDimmedState.set(enemy, true);
        } else {
          const uvT = (uvDist - SURFACE_NEAR_UV) / (SURFACE_FAR_UV - SURFACE_NEAR_UV);
          const uvSt = uvT * uvT * (3.0 - 2.0 * uvT);
          surfaceVis = 1.0 - uvSt * (1.0 - SURFACE_DIM_OPACITY);
          this._entityDimmedState.set(enemy, true);
        }
        visibility = Math.min(visibility, surfaceVis);

        // (b) Proximity override: enemies very close in world space are always visible,
        // overriding depth-occlusion. Applied after min-clamp so it can only raise visibility.
        // Uses world-space (Euclidean 3D) distance rather than UV distance to correctly
        // handle pole-distorted UV coordinates — near poles, enemies with large UV distance
        // may be physically adjacent (tiny world distance) and should stay visible.
        // EXCEPTION: suppress the override when player and enemy are on opposite wall sides
        // (e.g., outer vs inner tunnel wall on cube-tunnel). These entities are physically
        // separated by the wall regardless of world distance.
        const oppositeWalls = ctx.surface.areOnOppositeWallSides(playerV, enemy.surfacePosition.v);
        if (!oppositeWalls) {
          const worldDistSq = enemy.position.distanceToSquared(playerPos);
          if (worldDistSq <= PROXIMITY_NEAR_WORLD_SQ) {
            visibility = Math.max(visibility, 1.0);
          } else if (worldDistSq <= PROXIMITY_FADE_WORLD_SQ) {
            const worldDist = Math.sqrt(worldDistSq);
            const t = (worldDist - PROXIMITY_NEAR_WORLD) / (PROXIMITY_FADE_WORLD - PROXIMITY_NEAR_WORLD);
            visibility = Math.max(visibility, 1.0 - t);
          }
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

    profiler.begin('pickup_dimming');
    // Surface UV-distance dimming for pickups.
    // Same UV metric as entity dimming — pickups on the far side of the surface are dimmed.
    // More generous minimum (0.35) than entities (0.08): pickups stay visible as navigation targets.
    // The spawn-indicator arrow is NOT dimmed so players always see where pickups are.
    {
      const PICKUP_NEAR_UV = 0.20;   // fully bright within 20% surface distance
      const PICKUP_FAR_UV  = 0.45;   // fully dim beyond 45%
      const PICKUP_MIN_SCALE = 0.35; // minimum opacity scale for opposite-surface pickups

      const computePickupDimFactor = (pu: number, pv: number): number => {
        const euRaw = Math.abs(pu - playerU);
        const evRaw = Math.abs(pv - playerV);
        const eu = Math.min(euRaw, 1.0 - euRaw);
        const ev = wrapsV ? Math.min(evRaw, 1.0 - evRaw) : evRaw;
        const uvDist = Math.sqrt(eu * eu + ev * ev);
        if (uvDist <= PICKUP_NEAR_UV) return 1.0;
        if (uvDist >= PICKUP_FAR_UV) return PICKUP_MIN_SCALE;
        const t = (uvDist - PICKUP_NEAR_UV) / (PICKUP_FAR_UV - PICKUP_NEAR_UV);
        const smooth = t * t * (3.0 - 2.0 * t);
        return 1.0 - smooth * (1.0 - PICKUP_MIN_SCALE);
      };

      const dimPickupMesh = (mesh: THREE.Group, pickupU: number, pickupV: number): void => {
        const dimFactor = computePickupDimFactor(pickupU, pickupV);
        const ageFactor = (mesh.userData.ageFactor as number) ?? 1.0;

        mesh.traverse((child) => {
          // Spawn indicator keeps full brightness — it's the "where is this pickup" signal
          if (child.name === 'spawn-indicator') return;

          if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
            const mat = child.material as THREE.MeshBasicMaterial;
            if ('opacity' in mat) {
              // Lazily capture base opacity on first visit (before any aging or dimming)
              if (mat.userData.baseOpacity === undefined) {
                mat.userData.baseOpacity = mat.opacity;
              }
              mat.opacity = (mat.userData.baseOpacity as number) * ageFactor * dimFactor;
            }
          } else if (child instanceof THREE.Sprite) {
            if (child.material.userData.baseOpacity !== undefined) {
              child.material.opacity = (child.material.userData.baseOpacity as number) * ageFactor * dimFactor;
            }
          }
        });
      };

      const ps = ctx.pickupSpawner;
      for (const p of ps.superPickups)    { if (p.active) dimPickupMesh(p.mesh, p.surfaceU, p.surfaceV); }
      for (const p of ps.weaponPickups)   { if (p.active) dimPickupMesh(p.mesh, p.surfaceU, p.surfaceV); }
      for (const p of ps.buffPickups)     { if (p.active) dimPickupMesh(p.mesh, p.surfaceU, p.surfaceV); }
      for (const p of ps.newBuffPickups)  { if (p.active) dimPickupMesh(p.mesh, p.surfaceU, p.surfaceV); }
      for (const p of ps.companionPickups){ if (p.active) dimPickupMesh(p.mesh, p.surfaceU, p.surfaceV); }
    }
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
