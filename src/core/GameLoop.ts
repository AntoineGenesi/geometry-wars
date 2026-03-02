import * as THREE from 'three';
import type { GameContext } from './GameContext';
import { ModePhase, GameModeType } from './GameMode';
import { SuperStateType } from '../weapons/SuperState';
import { WEAPON_CONFIGS, WeaponType } from '../weapons/WeaponTypes';
import { Gate } from '../entities/enemies/Gate';
import { Painter } from '../entities/enemies/Painter';
import { FractalSnake } from '../entities/enemies/FractalSnake';
import { getSoundEngine } from '../audio/SoundEngine';
import { UIHelpers } from '../ui/UIHelpers';
import { BUFF_DEFINITIONS } from '../buffs/BuffManager';
import { GlowTrail } from '../effects/GlowTrail';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';
import { exportLogsToServer } from '../utils/PerformanceExporter';
import { LoadedMeshSurface } from '../surfaces/LoadedMeshSurface';
import { profiler } from './PerformanceProfiler';

/**
 * GameLoop — Fixed-timestep game update logic for the main game path.
 *
 * Called by main.ts (the user's entry point). State flows through GameContext.
 * ⚠ NOT called by GameInstance (used by tests/demos via PlaygroundGame).
 *   If you fix something here, the main game is affected. Tests may not see your fix.
 *   If you fix something in GameInstance.ts, the main game is NOT affected.
 * Contains multiple // REGRESSION GUARD: sections — read before editing.
 */
export class GameLoop {
  // Local variables that need to be shared across multiple local scopes
  private enemyGlowTrails: Map<BaseEnemy, any> = new Map();
  // Last valid aim direction — used to hold aim when mouse input drops below threshold
  private lastAimDirection: THREE.Vector3 | null = null;
  // Pre-allocated to avoid per-frame heap churn (used in bullet sync loop)
  private readonly _bulletSyncDir = new THREE.Vector3();
  private readonly _bulletSeenIds = new Set<string>();
  private FAST_ENEMY_TYPES = ['Mayfly', 'Rocket', 'Duck'];
  private ENEMY_TRAIL_COLORS: Record<string, number> = {
    Mayfly: 0xddddff,
    Rocket: 0xff8800,
    Duck: 0xff44aa,
  };
  private playerGlowTrail: any = null;
  private glowManager: any = null;
  private playerGlow: any = null;
  private bgMusic: any = null;
  private sound: any = null;
  private applyStatMultipliers: (() => void) | null = null;
  // DDA close call detection: tracks whether player was already "in" a close call episode
  // (avoids recording multiple close calls for one continuous proximity event)
  private _ddaInClosecall = false;
  // Boost visual state tracking (only call setColor on state transition)
  private _prevBoostActive = false;
  // Camera aspect re-sync on countdown → playing transition (iOS URL bar may change
  // window.innerHeight during the 3-second countdown without firing a resize event).
  // Reset to false each countdown so the sync fires once per game start.
  private _cameraAspectSyncedForSession = false;

  /**
   * Wire in dependencies that are created in main.ts and can't be passed via GameContext
   * (because they're not part of the standard manager set)
   */
  setDependencies(deps: {
    playerGlowTrail: any;
    glowManager: any;
    playerGlow: any;
    bgMusic: any;
    sound: any;
    applyStatMultipliers: () => void;
  }): void {
    this.playerGlowTrail = deps.playerGlowTrail;
    this.glowManager = deps.glowManager;
    this.playerGlow = deps.playerGlow;
    this.bgMusic = deps.bgMusic;
    this.sound = deps.sound;
    this.applyStatMultipliers = deps.applyStatMultipliers;
  }

  update(ctx: GameContext, dt: number): void {
    // Skip update if paused or game over
    if (ctx.state.isPaused || ctx.state.isGameOver || ctx.state.isLevelComplete) return;

    profiler.begin('game_mode');
    // Update game mode (handles countdown timer, time limits)
    ctx.gameMode.update(dt, ctx.player.score, ctx.player.lives);
    // Update interactive game mode (KotH zone, Sniper ammo, etc.)
    if (ctx.quickGameMode) {
      ctx.quickGameMode.onFixedUpdate(dt, {
        player: ctx.player,
        enemySpawner: ctx.enemySpawner,
        surface: ctx.surface,
        weaponManager: ctx.weaponManager,
        buffManager: ctx.buffManager,
        game: ctx.game,
        scene: ctx.game.scene,
        camera: ctx.game.camera,
      });
    }
    profiler.end('game_mode');

    // Show countdown overlay
    if (ctx.gameMode.phase === ModePhase.Countdown) {
      this._cameraAspectSyncedForSession = false; // reset so sync fires on next transition
      UIHelpers.updateCountdownOverlay(ctx.gameMode.countdownTimer, true);
      // During countdown: update grid springs but skip gameplay
      ctx.surface.updateGrid(dt);
      ctx.surface.updateMeshDeformation(dt);
      ctx.surfaceShockwave.update(dt);
      ctx.input.endFrame();
      return;
    }
    // Hide countdown once playing starts (one-time)
    UIHelpers.updateCountdownOverlay(0, false);

    // Re-sync camera aspect/FOV on the first frame of gameplay.
    // iOS Safari hides the URL bar during the countdown (changing window.innerHeight)
    // without firing a resize event, leaving the camera with a stale aspect ratio.
    if (!this._cameraAspectSyncedForSession) {
      this._cameraAspectSyncedForSession = true;
      ctx.game.ensureCameraAspectRatio();
    }

    // Update timer display for timed modes / elapsed time for endless
    if (ctx.level.timeLimit > 0) {
      UIHelpers.updateTimerDisplay(ctx.gameMode.timeRemaining, true);
    } else if (ctx.isEndless) {
      UIHelpers.updateTimerDisplay(ctx.waveScheduler.getElapsed(), false);
    }

    const inputState = ctx.input.getState();

    // Handle respawn or game over
    if (!ctx.player.alive) {
      if (ctx.player.lives > 0) {
        ctx.state.respawnTimer += dt;
        if (ctx.state.respawnTimer >= ctx.state.RESPAWN_DELAY) {
          ctx.state.respawnTimer = 0;
          // Respawn at safe location (opposite side of surface from death location)
          const safePos = ctx.player.getSafeRespawnPosition();
          ctx.player.respawn(safePos.u, safePos.v);
          this.lastAimDirection = null; // Reset stale aim: new surface location, old direction invalid
          const respawnPoint = ctx.surface.getPoint(safePos.u, safePos.v);
          // Reset walker to respawn position.
          // MUST use teleportTo() to reinit _facePos — direct assignment leaves stale
          // geodesic state that causes snap-back to death location on first movement input.
          const projected = ctx.meshSurface.closestPointOnSurface(respawnPoint.position);
          if (projected) {
            ctx.playerWalker.teleportTo(projected.point, projected.faceIndex, projected.normal);
          }
          ctx.player.mesh.position.copy(ctx.playerWalker.position);
        }
      } else if (!ctx.state.isGameOver) {
        // Game over - no lives left
        ctx.state.isGameOver = true;
        ctx.perfTracker.saveSession();
        ctx.perfLogger.saveSession();
        ctx.ddaLogger.finalize(); // Persist DDA session log to localStorage

        // Stop profiling persistence and export to disk
        ctx.profilingPersistence.stop();
        ctx.profilingPersistence.flush().catch((err) => {
          console.error('[GameLoop] Failed to flush profiling data:', err);
        });

        // Export logs to disk with git version tagging
        this.exportLogsToDisk();

        // Short delay before showing game over screen
        setTimeout(() => {
          // KotH (and other modes with custom scoring): use mode's getScore().
          // Falls back to player.score for standard modes.
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
          const finalScore = ctx.quickGameMode
            ? ctx.quickGameMode.getScore(modeCtx)
            : ctx.player.score;
          const scoreLabel = ctx.quickGameMode?.getScoreLabel?.();
          ctx.gameOverScreen.show(finalScore, ctx.surfaceType, 'solo', scoreLabel);
        }, 1000);
      }
    }

    profiler.begin('player_update');
    // Update player movement and shooting
    if (ctx.player.alive) {
      // Weapon swap (E key)
      if (inputState.weaponSwap) {
        ctx.weaponManager.cycleWeapon();
        this.sound.play('weaponPickup', { volume: 0.4, pitch: 1.2 });
      }

      // Store previous UV for gate pass-through detection
      ctx.state.prevPlayerU = ctx.player.surfaceU;
      ctx.state.prevPlayerV = ctx.player.surfaceV;

      // MESH-BASED SURFACE MOVEMENT (BVH)
      // Player moves on mesh surface using world-space tangent projection.
      // No UV coordinates, no pole singularity, constant speed everywhere.

      // Move player on surface via MeshWalker.
      // No upHint: MeshWalker uses camera.getWorldQuaternion() which is already
      // smoothed by the camera lerp. Passing targetUp created a feedback loop.
      // Restored from bffc333 (last user-confirmed working version).
      if (Math.abs(inputState.moveX) > 0.01 || Math.abs(inputState.moveY) > 0.01) {
        ctx.playerWalker.moveFromInput(inputState.moveX, -inputState.moveY, ctx.game.camera, dt);
      }

      // Sync player mesh position from walker
      ctx.player.mesh.position.copy(ctx.playerWalker.position);

      // Bridge: convert world position to UV for enemies/geoms that still use UV
      // CRITICAL: worldToSurface expects local coordinates, so apply inverse rotation first
      const inverseRot = ctx.surface.worldRotation.clone().invert();
      const localPos = ctx.playerWalker.position.clone().applyQuaternion(inverseRot);
      const playerUV = ctx.surface.worldToSurface(localPos);
      ctx.player.surfaceU = playerUV.u;
      ctx.player.surfaceV = playerUV.v;

      // Camera update (now handled by CameraController)
      ctx.cameraController.update(ctx.playerWalker, dt);

      const playerNormal = ctx.playerWalker.normal;

      // Get tangent frame for player orientation (still needed for orient math below)
      const frame = ctx.playerWalker.getTangentFrame();
      const aimX = inputState.aimX;
      const aimY = inputState.aimY;
      const aimLen = Math.sqrt(aimX * aimX + aimY * aimY);

      // Aim axes: use camera's actual world-space axes projected onto the surface plane.
      // The camera position/up both lerp (factor 0.12) so its right/up vectors lag the
      // surface tangent frame. Using frame.tangent/bitangent directly creates a visible
      // offset between mouse cursor and bullet travel direction (worse after respawn, where
      // the camera is still at the old location while the surface frame is at the new one).
      // Projecting camera matrixWorld columns onto the surface plane gives axes that exactly
      // match what the player sees on screen.
      // Note: Three.js lookAt() sets camera.quaternion but doesn't update matrixWorld immediately.
      // We call updateMatrixWorld() to ensure the matrix reflects the current orientation.
      ctx.game.camera.updateMatrixWorld();
      const camRight = new THREE.Vector3().setFromMatrixColumn(ctx.game.camera.matrixWorld, 0);
      const camUp = new THREE.Vector3().setFromMatrixColumn(ctx.game.camera.matrixWorld, 1);
      // Remove normal component so the axes lie on the surface plane
      camRight.addScaledVector(playerNormal, -camRight.dot(playerNormal));
      camUp.addScaledVector(playerNormal, -camUp.dot(playerNormal));
      const useCameraAxes = camRight.lengthSq() > 0.01 && camUp.lengthSq() > 0.01;
      if (useCameraAxes) {
        camRight.normalize();
        camUp.normalize();
      }
      // Fallback to surface tangent frame if camera axes degenerate (e.g. camera parallel to surface)
      const aimAxisX = useCameraAxes ? camRight : frame.tangent;
      const aimAxisY = useCameraAxes ? camUp : frame.bitangent;

      let aimDirection: THREE.Vector3;
      if (aimLen > 0.01) {
        aimDirection = new THREE.Vector3()
          .addScaledVector(aimAxisX, aimX)
          .addScaledVector(aimAxisY, -aimY)
          .normalize();
        this.lastAimDirection = aimDirection.clone();
      } else if (this.lastAimDirection !== null) {
        // Mouse near center or briefly dropped — hold last known aim direction
        aimDirection = this.lastAimDirection.clone();
      } else {
        // No prior aim — default to forward (camera up on surface)
        aimDirection = aimAxisY.clone();
      }

      // Orient player mesh
      const playerRight = new THREE.Vector3().crossVectors(playerNormal, aimDirection).normalize();
      const playerForward = new THREE.Vector3().crossVectors(playerRight, playerNormal).normalize();
      const orientMat = new THREE.Matrix4().makeBasis(playerRight, playerNormal, playerForward);
      ctx.player.mesh.quaternion.setFromRotationMatrix(orientMat);

      // Store aim angle for bullets
      ctx.player.aimAngle = Math.atan2(aimX, -aimY);

      // Update matrix for bullet spawning
      ctx.player.mesh.updateMatrixWorld(true);

      // Player update (shooting, bombs, etc.)
      // Pacifism mode: no shooting allowed
      const effectiveInput = !ctx.gameMode.config.canShoot
        ? { ...inputState, shooting: false }
        : inputState;
      ctx.player.update(dt, effectiveInput);
    }
    profiler.end('player_update');

    profiler.begin('enemy_spawning');
    // Spawn enemy waves
    ctx.waveScheduler.update(dt, ctx.enemySpawner);
    profiler.end('enemy_spawning');

    profiler.begin('enemy_update');
    // Check wave-based level completion (all waves spawned + all enemies cleared)
    // Only for non-endless adventure mode levels (endless never completes via waves)
    if (
      !ctx.isEndless &&
      ctx.waveScheduler.allSpawned &&
      ctx.enemySpawner.getEnemies().length === 0 &&
      ctx.gameMode.phase === ModePhase.Playing &&
      !ctx.state.isLevelComplete
    ) {
      ctx.gameMode.completeLevel(ctx.player.score);
    }

    // Update enemies - use player's actual UV position + world position for mesh walkers
    profiler.begin('enemy_spawner_update');
    ctx.enemySpawner.setPlayerWorldPosition(ctx.playerWalker.position);
    if (ctx.player.canBeTracked) {
      ctx.enemySpawner.update(dt, ctx.player.surfaceU, ctx.player.surfaceV);
    } else {
      // Player is invincible/blinking - give enemies a fake position so they don't track
      const fakeU = 0.5 + Math.sin(ctx.game.clock.totalTime * 0.5) * 0.3;
      const fakeV = 0.5 + Math.cos(ctx.game.clock.totalTime * 0.7) * 0.3;
      ctx.enemySpawner.update(dt, fakeU, fakeV);
    }
    profiler.end('enemy_spawner_update');

    // Update LOD assignments BEFORE instance update so geometry swap uses current frame's data
    profiler.begin('enemy_lod_update');
    ctx.state.lodAssignments = ctx.lodManager.update(ctx.game.camera, ctx.enemySpawner.getEnemies());
    profiler.end('enemy_lod_update');

    // Update GPU-instanced enemy rendering with LOD-aware geometry swapping.
    // Enemies at MEDIUM/LOW LOD are rendered with simplified geometry (20/2 tris)
    // instead of full-detail meshes (~200 tris), giving real triangle reduction.
    profiler.begin('enemy_instance_update');
    ctx.enemyInstanceManager.updateInstancesWithLOD(
      ctx.enemySpawner.getEnemies(),
      ctx.state.lodAssignments,
      ctx.game.camera,
    );
    profiler.end('enemy_instance_update');
    profiler.end('enemy_update');

    profiler.begin('bullet_update');
    // Update bullets
    ctx.bulletPool.update(dt);

    // Sync bullet positions to GPU-instanced rendering
    // Register new bullets and update positions; unregister killed bullets
    const currentVisualType = ctx.weaponToBulletVisual(ctx.weaponManager.getCurrentWeapon());
    // Use pre-allocated class members to avoid creating new Set/Vector3 every frame
    this._bulletSeenIds.clear();
    ctx.bulletPool.forEachActive((index: number, position: THREE.Vector3, data: any) => {
      const id = `b${index}`;
      this._bulletSeenIds.add(id);
      this._bulletSyncDir.set(data.dirX, data.dirY, data.dirZ);
      if (!ctx.bulletInstanceIds.has(id)) {
        // New bullet: register with instance manager
        ctx.bulletInstanceManager.addBullet(id, currentVisualType, position, this._bulletSyncDir);
        ctx.bulletInstanceIds.add(id);
      } else {
        // Existing bullet: update position/direction
        ctx.bulletInstanceManager.updateBullet(id, position, this._bulletSyncDir);
      }
    });
    // Remove bullets that were killed this frame
    for (const id of ctx.bulletInstanceIds) {
      if (!this._bulletSeenIds.has(id)) {
        ctx.bulletInstanceManager.removeBullet(id);
        ctx.bulletInstanceIds.delete(id);
      }
    }
    // Flush instance transforms to GPU
    ctx.bulletInstanceManager.update();
    profiler.end('bullet_update');

    profiler.begin('particles_and_pickups');
    // Update adaptive quality system (monitors FPS, adjusts quality level)
    ctx.adaptiveQuality.update(dt);

    // Update particles and score popups
    ctx.particles.update(dt);
    ctx.scorePopups.update(dt);
    ctx.scoreManager.updateCombo(dt);
    ctx.killLog.update(dt);
    profiler.end('particles_and_pickups');

    profiler.begin('effects_and_buffs');
    // Update player glow trail (add point at player position, offset slightly backward)
    if (ctx.player.alive && this.playerGlowTrail) {
      const trailPos = ctx.player.mesh.position.clone();
      // Offset trail points slightly behind the player in their local space
      // This improves visual appearance on curved surfaces like torus
      const aimDir = ctx.player.getAimDirection();
      const TRAIL_OFFSET = 0.15; // Keep trails close to player
      trailPos.addScaledVector(aimDir, -TRAIL_OFFSET);
      this.playerGlowTrail.addPoint(trailPos);
    }
    if (this.playerGlowTrail) {
      this.playerGlowTrail.update(dt);
    }

    // Boost visual feedback: flash player white when boost starts, restore on end
    if (ctx.player.boostActive !== this._prevBoostActive) {
      if (ctx.player.boostActive) {
        ctx.player.setColor(0xffffff); // White flash during boost
        if (this.sound) this.sound.play('weaponPickup', { volume: 0.5, pitch: 1.6 });
        UIHelpers.screenFlash('rgba(0, 220, 255, 0.18)', 200);
      } else {
        ctx.player.setColor(0x00ffff); // Restore default cyan
      }
      this._prevBoostActive = ctx.player.boostActive;
    }

    // Update entity glows
    if (this.glowManager) {
      this.glowManager.update(dt);
    }
    if (this.playerGlow) {
      this.playerGlow.update(dt);
    }

    // Update player level aura ring
    if (ctx.player.alive) {
      ctx.playerLevel.update(dt, ctx.playerWalker.position, ctx.playerWalker.normal);
    }

    // Update buff system (shock aura, burning DOT, stat refresh)
    if (ctx.player.alive) {
      const auraKills = ctx.buffManager.update(dt, ctx.playerWalker.position, ctx.enemySpawner.getEnemies(), ctx.scorePopups);

      ctx.shockArcRenderer.update(ctx.buffManager.shockArcs);
      // Update buff aura ring visuals (per-buff shader effects around player)
      const activeBuffsForAura = ctx.buffManager.getActiveBuffs().map(b => ({
        type: b.type,
        stacks: b.stacks,
      }));
      ctx.buffAuraRenderer.update(
        dt, ctx.game.clock.totalTime,
        ctx.playerWalker.position, ctx.playerWalker.normal,
        activeBuffsForAura,
      );
      // Refresh stat multipliers each frame (buffs can change any time)
      if (this.applyStatMultipliers) {
        this.applyStatMultipliers();
      }
    }
    profiler.end('effects_and_buffs');

    // Use playerWalker.position directly for pickup collision checks.
    // Both playerWalker.position and pickup._surfaceWorldPos are in the same world space
    // (both include worldRotation and scaleFactor). The previous UV round-trip approach
    // (playerWalker → worldToSurface → UV → getTransform → analytical pos) introduced
    // errors on peanut (approximate 100-step phi scan) and cube (complex UV parameterization),
    // causing inconsistent pickup detection across maps.
    // REGRESSION GUARD: This fixes peanut/cube pickup detection. The UV round-trip was
    // previously added to fix torus (s34b) but that fix was in getPointLocal y-flip, not here.
    const playerPickupPos = ctx.player.alive ? ctx.playerWalker.position : null;

    // Update new buff pickups
    for (let i = ctx.pickupSpawner.newBuffPickups.length - 1; i >= 0; i--) {
      const nbp = ctx.pickupSpawner.newBuffPickups[i];
      if (!nbp.active) {
        ctx.game.scene.remove(nbp.mesh);
        nbp.dispose();
        ctx.pickupSpawner.newBuffPickups.splice(i, 1);
        continue;
      }
      nbp.update(dt, ctx.game.clock.totalTime, ctx.game.camera.up);
      nbp.applySurfaceTransform(ctx.getTransform);

      // Check player collision with new buff pickup
      if (ctx.player.alive && nbp.checkPlayerCollision(ctx.player.surfaceU, ctx.player.surfaceV, playerPickupPos ?? ctx.playerWalker.position)) {
        ctx.buffManager.addBuff(nbp.buffType);
        ctx.scorePopups.spawn(
          ctx.player.mesh.position.clone(),
          `+${BUFF_DEFINITIONS[nbp.buffType].name}`,
          '#' + BUFF_DEFINITIONS[nbp.buffType].iconColor.toString(16).padStart(6, '0'),
          1.5,
        );
        nbp.active = false;
      }
    }

    // Update enemy glow trails (for fast-moving enemies)
    const currentEnemies = ctx.enemySpawner.getEnemies();
    const activeEnemySet = new Set(currentEnemies);

    // Remove trails for dead/removed enemies
    this.enemyGlowTrails.forEach((trail, enemy) => {
      if (!activeEnemySet.has(enemy) || !enemy.alive) {
        trail.dispose();
        ctx.game.scene.remove(trail.root);
        this.enemyGlowTrails.delete(enemy);
      }
    });

    // Update existing trails and add new ones for fast enemies
    for (const enemy of currentEnemies) {
      if (!enemy.alive) continue;

      const enemyTypeName = enemy.constructor.name;

      // Check if this is a fast enemy type
      if (this.FAST_ENEMY_TYPES.includes(enemyTypeName)) {
        let trail = this.enemyGlowTrails.get(enemy);

        // Create trail if doesn't exist
        if (!trail) {
          const color = this.ENEMY_TRAIL_COLORS[enemyTypeName] || 0xff0000;
          trail = new GlowTrail(new THREE.Color(color), 40, 0.3);
          ctx.game.scene.add(trail.root);
          this.enemyGlowTrails.set(enemy, trail);
        }

        // Add point at enemy position
        if (enemy.mesh) {
          trail.addPoint(enemy.mesh.position.clone());
        }
        trail.update(dt);
      }
    }

    profiler.begin('companions_and_trails');
    // Update screen shake
    ctx.screenShake.update(dt);

    // Get current enemy list for companions and collision checks
    const enemies = ctx.enemySpawner.getEnemies();

    // Update companions
    if (ctx.player.alive) {
      const aimDir = ctx.player.getAimDirection();
      ctx.companionManager.update(
        dt,
        ctx.player.surfaceU,
        ctx.player.surfaceV,
        ctx.playerWalker.position,
        aimDir,
        ctx.enemySpawner.getEnemies().filter(e => e.alive),
        ctx.bulletPool,
        0, // ownerId = P1
        ctx.playerWalker.normal,
        ctx.getTransform,
      );
    }

    // Update companion pickups
    for (let i = ctx.pickupSpawner.companionPickups.length - 1; i >= 0; i--) {
      const cp = ctx.pickupSpawner.companionPickups[i];
      if (!cp.active) {
        ctx.game.scene.remove(cp.mesh);
        cp.dispose();
        ctx.pickupSpawner.companionPickups.splice(i, 1);
        continue;
      }
      cp.update(dt, ctx.game.clock.totalTime, ctx.game.camera.up);
      cp.applySurfaceTransform(ctx.getTransform);

      // Check player collision with companion pickup
      if (ctx.player.alive && cp.checkPlayerCollision(ctx.player.surfaceU, ctx.player.surfaceV, playerPickupPos ?? ctx.playerWalker.position)) {
        ctx.companionManager.addCompanion(cp.companionType);
        this.sound.play('weaponPickup', { volume: 0.5, pitch: 1.8 });
        cp.active = false;
      }
    }

    // Update super state manager
    ctx.superManager.update(dt);

    // Update super state pickups
    for (let i = ctx.pickupSpawner.superPickups.length - 1; i >= 0; i--) {
      const pickup = ctx.pickupSpawner.superPickups[i];
      if (!pickup.active) {
        ctx.game.scene.remove(pickup.mesh);
        pickup.dispose();
        ctx.pickupSpawner.superPickups.splice(i, 1);
        continue;
      }
      pickup.update(dt, ctx.game.camera.up);
      pickup.applySurfaceTransform(ctx.getTransform);

      // Check player collision with pickup
      if (ctx.player.alive && pickup.checkPlayerCollision(ctx.player.surfaceU, ctx.player.surfaceV, playerPickupPos ?? ctx.playerWalker.position)) {
        const allDotsGone = pickup.removeClosestDot(ctx.player.surfaceU, ctx.player.surfaceV);
        if (allDotsGone) {
          ctx.superManager.activate(pickup.type);
          pickup.active = false;
        }
      }
    }
    profiler.end('companions_and_trails');

    profiler.begin('collision_detection');
    // -- Collision checks --

    // Bullets vs enemies
    const SUPER_STATE_TYPES = [
      SuperStateType.QuadFire, SuperStateType.SplitFire,
      SuperStateType.ReverseFire, SuperStateType.Missile,
      SuperStateType.Magnet, SuperStateType.TrailBomb,
      SuperStateType.Shield,
    ];

    ctx.collisionSystem.checkBulletEnemyCollisions(
      ctx.bulletPool,
      enemies,
      ctx.particles,
      ctx.scoreManager,
      ctx.surface,
      ctx.screenShake,
      (u: number, v: number) => {
        ctx.pickupSpawner.spawnPickupsOnEnemyDeath(u, v);
      },
      ctx.scorePopups,
      ctx.scoreManager.getScorePowerMultiplier() * ctx.playerLevel.damageMultiplier * ctx.buffManager.getDamageMultiplier() * ctx.buffManager.getMasteryMultiplier(WeaponType.Standard).damageMultiplier * ctx.weaponManager.getUpgradeDamageMult(WeaponType.Standard),
      (type: string, color: number) => {
        ctx.killLog.addKill(type, color);
        ctx.playerLevel.addKill();
        ctx.weaponMastery.recordKill(WeaponType.Standard); // blaster bullets are always Standard
        ctx.weaponManager.recordKillForUpgrades(WeaponType.Standard); // upgrade tracker
        ctx.ddaTracker.recordKill(1); // DDA: track kill event
        ctx.ddaLogger.recordKill(0, type); // DDA logger: log kill with enemy type
        ctx.perfLogger.recordWeaponKill(ctx.weaponManager.getCurrentWeapon(), ctx.state.perfBuffString); // weapon analytics
      },
      true, // showDamageNumbers
      (enemy: BaseEnemy) => { ctx.buffManager.onBulletHit(enemy); },
      (enemy: BaseEnemy, allEnemies: BaseEnemy[]) => {
        ctx.buffManager.onEnemyDeath(enemy, allEnemies);
        // Shockwave distortion: only on boss-tier enemies (not regular enemy deaths)
        if (enemy.baseTypeName.startsWith('boss_')) {
          ctx.shockwaveEffect.spawnShockwave(
            enemy.position,
            0.04,  // boss death strength
            0.7,   // speed
            0.6,   // lifetime
          );
        }
      },
      ctx.enemyInstanceManager,
      ctx.game.bloomEffectManager, // Pass bloom effect manager for boss death bloom pulses
    );

    // Player vs enemies (immune if shielded OR tesla coil active OR companion shield active)
    const fireModifiers = ctx.superManager.getFireModifiers();
    const isImmune = fireModifiers.isShielded || ctx.weaponManager.isTeslaActive() || ctx.companionManager.isShieldActive();
    ctx.collisionSystem.checkPlayerEnemyCollisions(
      ctx.player, enemies, ctx.particles, ctx.screenShake, isImmune,
      () => {
        // Try Tough Times block first
        if (ctx.buffManager.onPlayerHit()) {
          UIHelpers.screenFlash('rgba(68, 136, 255, 0.3)', 100);
          ctx.buffAuraRenderer.triggerBlockFlash(ctx.game.clock.totalTime);
          ctx.shockwaveEffect.triggerChromatic(0.006); // subtle chromatic on block
          return true; // Blocked by Tough Times
        }
        // Then try companion protector
        const saved = ctx.companionManager.onPlayerHit();
        if (!saved) {
          // Player is about to die — strong chromatic + flash + shockwave
          ctx.shockwaveEffect.triggerChromatic(0.025);
          ctx.shockwaveEffect.spawnShockwave(ctx.player.mesh.position, 0.06, 1.0, 0.7, 0.08);
          ctx.shockwaveEffect.triggerFlash(new THREE.Color(1, 0.2, 0.2), 0.4);
          // Player death indicator: red floating text at player position
          ctx.scorePopups.spawn(ctx.player.mesh.position.clone(), '-LIFE', '#ff4444', 2.0, 1.2);
        }
        return saved;
      },
    );

    // Gate pass-through detection (Pacifism mode mechanic)
    if (ctx.player.alive && ctx.player.canTakeDamage) {
      for (const enemy of enemies) {
        if (enemy instanceof Gate && enemy.active) {
          enemy.checkPlayerPassThrough(
            ctx.player.surfaceU, ctx.player.surfaceV,
            ctx.state.prevPlayerU, ctx.state.prevPlayerV
          );
        }
      }
    }

    // Painter trail damage (hazard zones)
    if (ctx.state.painterDamageCooldown > 0) ctx.state.painterDamageCooldown -= dt;
    if (ctx.player.alive && ctx.player.canTakeDamage && ctx.state.painterDamageCooldown <= 0) {
      for (const enemy of enemies) {
        if (enemy instanceof Painter && enemy.active) {
          if (enemy.isOnTrail(ctx.player.surfaceU, ctx.player.surfaceV)) {
            if (!fireModifiers.isShielded && !ctx.companionManager.isShieldActive()) {
              // Try companion protector shield before dying
              const saved = ctx.companionManager.onPlayerHit();
              if (!saved) {
                ctx.player.die();
                ctx.particles.playerDeath(ctx.player.mesh.position);
                ctx.screenShake.shake(0.5, 0.4);
                getSoundEngine().play('playerDeath');
                UIHelpers.screenFlash('rgba(255, 60, 60, 0.4)', 200);
              } else {
                UIHelpers.screenFlash('rgba(68, 255, 68, 0.3)', 150);
              }
            }
            ctx.state.painterDamageCooldown = 0.5; // brief cooldown
            break;
          }
        }
      }
    }
    // FractalSnake follower hit detection — runs AFTER the main bullet-enemy collision loop.
    // New block (not modifying any existing loop) — per REGRESSION GUARD protocol.
    const fractalSnakes = ctx.enemySpawner.getFractalSnakes();
    if (fractalSnakes.length > 0) {
      const bulletDmg = ctx.scoreManager.getScorePowerMultiplier()
        * ctx.playerLevel.damageMultiplier
        * ctx.buffManager.getDamageMultiplier();
      ctx.bulletPool.forEachActive((bulletIdx: number, _bulletPos: THREE.Vector3, bulletData: any) => {
        const bu = bulletData.surfaceU;
        const bv = bulletData.surfaceV;
        for (const fs of fractalSnakes) {
          if (!fs.alive) continue;
          const followerIdx = fs.hitTestFollower(bu, bv, 0.08);
          if (followerIdx !== null) {
            ctx.bulletPool.kill(bulletIdx);
            fs.damageFollower(followerIdx, bulletDmg);
            break;
          }
        }
      });

      // Update shock effects for all active fractal snakes
      for (const fs of fractalSnakes) {
        fs.updateShockEffect(dt);
      }
    }
    profiler.end('collision_detection');

    profiler.begin('dda_system');
    // -- DDA system update (after all kills/deaths processed this frame) --
    {
      let nearestEnemyDist = 1.0;
      for (const enemy of enemies) {
        if (!enemy.active || enemy.isMaterializing) continue;
        const du = ctx.player.surfaceU - enemy.surfacePosition.u;
        const dv = ctx.player.surfaceV - enemy.surfacePosition.v;
        const dist = Math.sqrt(du * du + dv * dv);
        if (dist < nearestEnemyDist) nearestEnemyDist = dist;
      }
      // Close call detection: enemy within danger zone but player survived
      // Threshold: 0.05 UV units (~5% of surface). Triggers once per proximity episode.
      const CLOSE_CALL_THRESHOLD = 0.05;
      if (ctx.player.alive && nearestEnemyDist < CLOSE_CALL_THRESHOLD) {
        if (!this._ddaInClosecall) {
          this._ddaInClosecall = true;
          ctx.ddaTracker.recordCloseCall();
        }
      } else {
        this._ddaInClosecall = false;
      }

      ctx.ddaTracker.update(dt, nearestEnemyDist, ctx.player.lives / 3);
      ctx.ddaEngine.update(dt, [ctx.ddaTracker]);
      ctx.ddaLogger.update(dt);
      ctx.ddaPlayers[0].u = ctx.player.surfaceU;
      ctx.ddaPlayers[0].v = ctx.player.surfaceV;
    }
    profiler.end('dda_system');

    profiler.begin('weapons_and_pickups');
    // Update weapon manager (projectiles, effects)
    ctx.weaponManager.update(dt);

    // Update weapon pickups
    for (let i = ctx.pickupSpawner.weaponPickups.length - 1; i >= 0; i--) {
      const wp = ctx.pickupSpawner.weaponPickups[i];
      if (!wp.active) {
        ctx.game.scene.remove(wp.mesh);
        wp.dispose();
        ctx.pickupSpawner.weaponPickups.splice(i, 1);
        continue;
      }
      wp.update(dt, ctx.game.clock.totalTime, ctx.game.camera.up);
      wp.applySurfaceTransform(ctx.getTransform);

      // Check player collision with weapon pickup
      if (ctx.player.alive && wp.checkPlayerCollision(ctx.player.surfaceU, ctx.player.surfaceV, playerPickupPos ?? ctx.playerWalker.position)) {
        const switched = ctx.weaponManager.equipWeapon(wp.type);
        this.sound.play('weaponPickup', switched ? undefined : { volume: 0.5, pitch: 0.9 });
        if (!switched) {
          // Weapon was added to inventory without switching — notify player
          ctx.weaponHUD.showPickupNotification(`${WEAPON_CONFIGS[wp.type].name} added to inventory  \u2022  [E] to cycle`);
        }
        wp.active = false;
      }
    }

    // Update buff pickups
    for (let i = ctx.pickupSpawner.buffPickups.length - 1; i >= 0; i--) {
      const bp = ctx.pickupSpawner.buffPickups[i];
      if (!bp.active) {
        ctx.game.scene.remove(bp.mesh);
        bp.dispose();
        ctx.pickupSpawner.buffPickups.splice(i, 1);
        continue;
      }
      bp.update(dt, ctx.game.clock.totalTime, ctx.game.camera.up);
      bp.applySurfaceTransform(ctx.getTransform);

      // Check player collision with buff pickup
      if (ctx.player.alive && bp.checkPlayerCollision(ctx.player.surfaceU, ctx.player.surfaceV, playerPickupPos ?? ctx.playerWalker.position)) {
        ctx.weaponManager.applyBuff(bp.buffType);
        this.sound.play('weaponPickup', { volume: 0.3, pitch: 1.5 });
        bp.active = false;
      }
    }
    profiler.end('weapons_and_pickups');

    profiler.begin('misc_updates');
    // Update grid deformation springs and propagating shockwaves
    ctx.surface.updateGrid(dt);
    ctx.surface.updateMeshDeformation(dt);
    ctx.surfaceShockwave.update(dt);

    // Scale music intensity with enemy count
    const enemyCount = ctx.enemySpawner.getActiveCount();
    if (this.bgMusic) {
      this.bgMusic.setIntensity(Math.min(enemyCount / 30, 1.0));
    }

    // Checkpoint mode: detect wave clears (enemies went from >0 to 0)
    const modeType = ctx.level.mode as GameModeType;
    if (modeType === GameModeType.Checkpoint && ctx.gameMode.phase === ModePhase.Playing) {
      if (ctx.state.hadEnemies && enemyCount === 0 && ctx.state.lastEnemyCount > 0) {
        ctx.gameMode.waveClear();
      }
      if (enemyCount > 0) ctx.state.hadEnemies = true;
    }
    ctx.state.lastEnemyCount = enemyCount;

    // Check level completion: all waves spawned + no enemies alive (works for timed and non-timed)
    if (!ctx.state.isLevelComplete && !ctx.state.isGameOver
        && ctx.waveScheduler.allSpawned
        && enemyCount === 0
        && ctx.gameMode.phase === ModePhase.Playing) {
      ctx.gameMode.completeLevel(ctx.player.score);
    }

    // Update surface animations (if LoadedMeshSurface with animations)
    if (ctx.surface instanceof LoadedMeshSurface) {
      ctx.surface.updateAnimations(dt);
    }

    // Clear per-frame input flags
    ctx.input.endFrame();
    profiler.end('misc_updates');
  }

  /**
   * Export performance and DDA logs to disk via server endpoint.
   * Called automatically on game over and level complete.
   * Runs asynchronously - does not block game logic.
   */
  private exportLogsToDisk(): void {
    // Determine server URL (default to localhost:2567 for dev mode)
    const serverUrl = process.env.NODE_ENV === 'production'
      ? window.location.origin  // Same origin in production
      : 'http://localhost:2567'; // Dev server

    // Export asynchronously - don't block game flow
    exportLogsToServer(serverUrl, true, true)
      .then((result) => {
        if (result.success) {
          console.log('[GameLoop] Performance logs exported:', result.results);
        } else {
          console.warn('[GameLoop] Failed to export logs:', result.error);
        }
      })
      .catch((err) => {
        console.error('[GameLoop] Export error:', err);
      });
  }
}
