import * as THREE from 'three';

import { Game } from './core/Game';
import { Surface, SurfacePoint } from './surfaces/Surface';
import { SurfaceFactory, SurfaceType } from './surfaces/SurfaceFactory';
import { InputManager } from './input/InputManager';
import { Player, BOOST_SPEED_MULTIPLIER } from './entities/Player';
import { BulletPool } from './entities/Bullet';
import { EnemySpawner, EnemyType } from './entities/enemies/EnemySpawner';
import { BaseEnemy } from './entities/enemies/BaseEnemy';
import { ParticleSystem } from './effects/ParticleSystem';
import { ScreenShake } from './effects/ScreenShake';
import { SurfaceShockwave } from './effects/SurfaceShockwave';
import { PlasmaExplosionEffect } from './effects/PlasmaExplosionEffect';
import { GlowTrail } from './effects/GlowTrail';
import { EntityGlow, EntityGlowManager, GlowPresets } from './effects/EntityGlow';
import { ScoreManager } from './core/ScoreManager';
import { GameMode, GameModeType, ModePhase, MODE_DEFAULTS } from './core/GameMode';
import { createGameMode, type QuickGameModeType } from './core/modes';
import type { WaveDefinition, LevelDefinition } from './core/LevelData';
import { ADVENTURE_LEVELS } from './core/LevelData';
import { SuperStateManager, SuperStateType } from './weapons/SuperState';
import { SuperStatePickup } from './weapons/SuperStatePickup';
import { WeaponManager } from './weapons/WeaponManager';
import { WeaponType, WEAPON_CONFIGS } from './weapons/WeaponTypes';
import { WeaponPickup, getRandomWeaponType } from './weapons/WeaponPickup';
import { BuffPickup, getRandomBuffType } from './weapons/BuffPickup';
import { Spawner } from './entities/enemies/Spawner';
import { TitanGrunt } from './entities/enemies/TitanGrunt';
import { TitanSpinner } from './entities/enemies/TitanSpinner';
import { TitanWeaver } from './entities/enemies/TitanWeaver';
import { GiantWanderer } from './entities/enemies/GiantWanderer';
import { GiantRocket } from './entities/enemies/GiantRocket';
import { GiantSnake } from './entities/enemies/GiantSnake';
import { GiantNeutron } from './entities/enemies/GiantNeutron';
import { Boss } from './entities/enemies/Boss';
import { Gate } from './entities/enemies/Gate';
import { Virus } from './entities/enemies/Virus';
import { Painter } from './entities/enemies/Painter';
import { Splitter } from './entities/enemies/Splitter';
import { ScorePopupManager } from './effects/ScorePopup';
import { StartMenu, MenuSelection, type LanGameMode } from './ui/StartMenu';
import { PauseMenu } from './ui/PauseMenu';
import { EffectsPanel } from './ui/EffectsPanel';
import { GameOverScreen } from './ui/GameOverScreen';
import { AnalyticsPanel } from './ui/AnalyticsPanel';
import { MasteryProgressScreen } from './ui/MasteryProgressScreen';
import { WeaponMasteryScreen } from './ui/WeaponMasteryScreen';
import { MasteryStore, XP_THRESHOLDS } from './systems/MasteryStore';
import { MasteryPointStore } from './systems/MasteryPointStore';
import { MatchUpgradeTracker } from './systems/MatchUpgradeTracker';
import { LevelCompleteScreen } from './ui/LevelCompleteScreen';
import { Minimap } from './ui/Minimap';
import { KillLog } from './ui/KillLog';
import { TotalKillCounter } from './ui/TotalKillCounter';
import { WeaponHUD } from './ui/WeaponHUD';
import { UpgradeNotification } from './ui/UpgradeNotification';
import { MeshSurface } from './surfaces/MeshSurface';
import { MeshWalker } from './movement/MeshWalker';
import { PlayerLevel, LevelUpNotification } from './core/PlayerLevel';
import { getSoundEngine } from './audio/SoundEngine';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { SpatialHash } from './core/SpatialHash';
import { CompanionManager, CompanionPickup, CompanionHUD, CompanionType, getRandomCompanionType } from './entities/Companion';
import { BuffManager, StackBuffType, BUFF_DEFINITIONS } from './buffs/BuffManager';
import { WeaponMasteryManager, WEAPON_MASTERY_BUFF_MAP } from './buffs/WeaponMasteryManager';
import { BuffHUD } from './buffs/BuffHUD';
import { BuffPickupNew } from './buffs/BuffPickupNew';
import { ShockArcRenderer } from './buffs/ShockArcRenderer';
import { BuffAuraRenderer, AuraQuality } from './buffs/BuffAuraRenderer';
import { BuffParticleAura } from './buffs/BuffParticleAura';
import { EnemyInstanceManager } from './rendering/EnemyInstanceManager';
import { BulletInstanceManager, BulletVisualType } from './rendering/BulletInstanceManager';
import { LODManager, LODLevel, DEFAULT_LOD_CONFIG } from './rendering/LODManager';
import { AdaptiveQuality, QualityLevel } from './rendering/AdaptiveQuality';
import { DepthOcclusionSystem } from './rendering/DepthOpacity';
import { SpatialHashVisibility } from './rendering/SpatialHashVisibility';
import { PerformanceTracker } from './core/PerformanceTracker';
import { DebugOverlay } from './ui/DebugOverlay';
import { ProfilingOverlay } from './ui/ProfilingOverlay';
import { ProfilingPersistence } from './core/ProfilingPersistence';
import { SettingsMenu, loadDebugSettings } from './ui/SettingsMenu';
import {
  computeDifficultyLevel,
  generateScaledEndlessWave,
  ScoreExplosionDetector,
  type DifficultyInput,
} from './core/DifficultyScaling';
import { isMobile } from './core/MobileDetector';
import { MapSize, getDefaultMapSizeForSurface, getMaxActiveEnemies, getDynamicMaxEnemies, getMapSizeScaleFactor } from './core/MapSize';
import { TouchInput } from './input/TouchInput';
import { DDAPerformanceTracker } from './difficulty/DDAPerformanceTracker';
import { DDADecisionEngine } from './difficulty/DDADecisionEngine';
import { DDASpawnModifier } from './difficulty/DDASpawnModifier';
import { loadDDASettings } from './difficulty/DDASettings';
import { waveComposer } from './entities/enemies/WaveComposer';
import { DDALogger } from './difficulty/DDALogger';
import { EntityAudit } from './core/EntityAudit';
import { PerformanceLogger } from './core/PerformanceLogger';
import { loadVisualStyle, loadVisualMode, saveVisualMode } from './ui/VisualStyleSettings';
import { UIHelpers } from './ui/UIHelpers';
import { CollisionSystem } from './core/CollisionSystem';
import { PickupSpawner } from './core/PickupSpawner';
import { CameraController } from './core/CameraController';
import { EnemyDeathCallbacks } from './entities/enemies/EnemyDeathCallbacks';
import { GameContext } from './core/GameContext';
import { GameLoop } from './core/GameLoop';
import { RenderLoop } from './core/RenderLoop';
import { profiler } from './core/PerformanceProfiler';
import {
  createStandardSurfaceConfig,
  setupStandardLighting,
  setupShockwaveEffect,
  makeSurfaceTransformFn as sharedMakeSurfaceTransformFn,
} from './rendering/SharedGameSetup';
import { initI18n } from './i18n';
import { showGameLoading, hideGameLoading } from './ui/GameLoadingOverlay';
// Portal import removed — portals are PvP-only and belong in network-main.ts

// ---------------------------------------------------------------------------
// URL Parameters
// Usage: ?surface=torus, ?mode=network
// ---------------------------------------------------------------------------

function getSurfaceTypeFromURL(): SurfaceType {
  const params = new URLSearchParams(window.location.search);
  const surfaceParam = params.get('surface');
  const validTypes = SurfaceFactory.getAvailableTypes();
  if (surfaceParam && validTypes.includes(surfaceParam as SurfaceType)) {
    return surfaceParam as SurfaceType;
  }
  return 'sphere'; // Default
}

function isNetworkMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'network';
}

// ---------------------------------------------------------------------------
// UI helpers (now in UIHelpers module)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enemy colors (now in CollisionSystem module)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Weapon type -> bullet visual type mapping (for BulletInstanceManager)
// ---------------------------------------------------------------------------

function weaponToBulletVisual(weapon: WeaponType): BulletVisualType {
  switch (weapon) {
    case WeaponType.Spread:
      return BulletVisualType.Spread;
    case WeaponType.Piercing:
      return BulletVisualType.Piercing;
    // Homing: missiles are rendered as 3D meshes by WeaponManager (not via BulletPool).
    // Blaster bullets (always fired alongside) should remain Standard-looking.
    default:
      return BulletVisualType.Standard;
  }
}

// Pre-allocated temp vector for bullet instance sync (zero per-frame allocation)
const _bulletSyncDir = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Bloom helpers for pixelated mode
// ---------------------------------------------------------------------------

/**
 * Adjust bloom strength based on visual mode.
 * Pixelated mode (half-res bloom) needs reduced strength to prevent oversaturation.
 * Modern mode uses full-res bloom and benefits from normal strength values.
 */
function getAdjustedBloomStrength(baseStrength: number, visualMode: 'pixelated' | 'modern'): number {
  if (visualMode === 'pixelated') {
    // Recommended pixelated bloom strength: ~0.4
    // Scale base strength down proportionally: multiply by 0.4 / 1.0 = 0.4x
    return Math.max(0, baseStrength * 0.4);
  }
  return baseStrength; // Modern mode uses full strength
}

// ---------------------------------------------------------------------------
// Surface transform helper — now using shared module (SharedGameSetup.ts)
// ---------------------------------------------------------------------------

const makeSurfaceTransformFn = sharedMakeSurfaceTransformFn;

// ---------------------------------------------------------------------------
// Player movement speed (for sphere rotation)
// ---------------------------------------------------------------------------

// Player movement speed in world units per second (mesh-based movement)
// Constant everywhere on any shape - no pole distortion
const PLAYER_MOVE_SPEED = 3.0;

// ---------------------------------------------------------------------------
// Wave scheduler
// ---------------------------------------------------------------------------

class WaveScheduler {
  private waves: WaveDefinition[];
  private waveTimers: number[];
  private waveSpawned: boolean[];
  private elapsed = 0;
  private endless: boolean;
  private endlessWave = 0;
  private endlessNextSpawn = 6; // first endless wave at 6 seconds
  private endlessInterval = 7; // seconds between endless waves (faster base)

  /** Current difficulty level (computed from player state + surge bonus). */
  currentDifficultyLevel = 0;

  /**
   * Number of active players (1-4). Default 1 (single-player).
   * Set before the first wave spawns. Scales enemy counts per-wave:
   *   1p=1.0x, 2p=1.5x, 3p=2.0x, 4p=2.5x
   */
  playerCount = 1;

  /** External provider for player state (set by main after construction). */
  getDifficultyInput: (() => DifficultyInput) | null = null;

  /** Detects rapid score growth and applies a temporary difficulty surge. */
  private readonly scoreExplosion = new ScoreExplosionDetector();

  constructor(waves: WaveDefinition[], endless = false) {
    this.waves = waves;
    this.waveTimers = waves.map(w => w.delay);
    this.waveSpawned = waves.map(() => false);
    this.endless = endless;
  }

  update(dt: number, spawner: EnemySpawner): void {
    this.elapsed += dt;

    // Recompute difficulty level from player state + score explosion surge
    if (this.getDifficultyInput) {
      const input = this.getDifficultyInput();
      const baseLevel = computeDifficultyLevel({
        ...input,
        elapsedTime: this.elapsed,
      });
      // Score explosion: adds +2 difficulty levels when player scores 5x in 60s
      const surgeBonus = this.scoreExplosion.update(input.score, this.elapsed);
      this.currentDifficultyLevel = baseLevel + surgeBonus;
    }

    // Scripted waves
    for (let i = 0; i < this.waves.length; i++) {
      if (this.waveSpawned[i]) continue;
      if (this.elapsed >= this.waveTimers[i]) {
        this.waveSpawned[i] = true;
        const wave = this.waves[i];
        spawner.spawnWave(
          wave.enemies.map(e => ({
            type: e.type as any,
            count: e.count,
            tier: 0, // scripted waves always tier 0 (early game)
          })),
        );
      }
    }

    // Endless scaling waves (now with difficulty-based tiers)
    if (this.endless && this.elapsed >= this.endlessNextSpawn) {
      const activeCount = spawner.getActiveCount();
      // s44r9-02: Skip wave if at 90% of max enemy cap — prevents silently
      // dropping spawns via dummy inactive enemies. The wave timer doesn't
      // advance, so the wave fires as soon as enemies die and count drops.
      const maxEnemies = spawner.getMaxActiveEnemies();
      if (activeCount >= maxEnemies * 0.9) {
        return; // Don't advance wave timer — retry next frame
      }
      this.endlessWave++;
      // Spawn interval decreases with wave number AND difficulty level
      // At high difficulty (4+), waves come every 2s — relentless pressure
      const difficultySpeedBonus = Math.min(3.0, this.currentDifficultyLevel * 0.4);
      // Entity count delay bonus: slow down new waves when screen is already crowded.
      // No effect at <=200 entities. +1s per 50 extra entities (capped at +5s).
      // At difficulty 4+, the bonus is reduced so waves stay relentless even when crowded.
      // At difficulty 9+, the bonus is eliminated entirely — endgame never pauses.
      const entityDelayBonusMultiplier = Math.max(0, 1.0 - (this.currentDifficultyLevel - 4) * 0.2);
      const entityDelayBonus = activeCount > 200
        ? Math.min(5.0, (activeCount - 200) / 50) * entityDelayBonusMultiplier
        : 0;
      this.endlessNextSpawn += Math.max(
        2.0,
        this.endlessInterval - this.endlessWave * 0.2 - difficultySpeedBonus,
      ) + entityDelayBonus;
      // Every 15 waves: spawn a breathing-room rest wave (WaveComposer "Rest" archetype).
      // Only 4 enemies — player recovers resources. Otherwise use the standard scaled system.
      if (this.endlessWave % 15 === 0) {
        spawner.spawnComposedWave(this.endlessWave, this.playerCount);
      } else {
        const scaledWave = generateScaledEndlessWave(
          this.endlessWave,
          this.currentDifficultyLevel,
          activeCount,
          this.playerCount,
        );
        // ScaledWaveEntry is structurally compatible with WaveEnemy (same required fields,
        // maxSegments now included). The cast is needed because type field is `string` vs `EnemyType`.
        spawner.spawnWave(scaledWave as any);
      }
    }
  }

  get allSpawned(): boolean {
    if (this.endless) return false; // endless never finishes
    return this.waveSpawned.every(s => s);
  }

  getElapsed(): number {
    return this.elapsed;
  }
}

// ---------------------------------------------------------------------------
// Module-level pre-allocated objects for zero-GC frustum visibility checks
// ---------------------------------------------------------------------------

const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _tempBox = new THREE.Box3();
const _tempSphere = new THREE.Sphere();

// ---------------------------------------------------------------------------
// Collision detection (now in CollisionSystem module)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

/**
 * Wait until the device is in landscape orientation before starting the game.
 *
 * - If already landscape: resolves immediately (no prompt shown).
 * - First 3 games of the session: shows the #rotate-overlay as a friendly prompt
 *   and resolves once the user actually rotates.
 * - 4th game onward: attempts programmatic lock (works on Android), then proceeds
 *   regardless (user knows to rotate by now; don't nag them).
 *
 * @param sessionGameCount  Number of games played so far this session (0-based count
 *                          incremented before this call, so first game = 1).
 */
async function waitForLandscape(sessionGameCount: number): Promise<void> {
  // Already landscape — proceed immediately
  if (window.matchMedia('(orientation: landscape)').matches) return;

  // After 3 games: user knows the drill. Try lock, ignore failure, proceed.
  if (sessionGameCount >= 3) {
    try {
      const lock = (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock;
      if (typeof lock === 'function') {
        await lock.call(screen.orientation, 'landscape');
      }
    } catch { /* ignore — proceed without prompt */ }
    return;
  }

  // First 3 games: show the rotate prompt, wait for actual landscape rotation.
  const overlay = document.getElementById('rotate-overlay');
  if (overlay) overlay.style.display = 'flex'; // force-show (overrides body.menu-open hide)

  return new Promise((resolve) => {
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => {
      if (mq.matches) {
        mq.removeEventListener('change', onChange);
        if (overlay) overlay.style.display = ''; // reset — let CSS take over
        resolve();
      }
    };
    mq.addEventListener('change', onChange);
  });
}

async function main(selectedSurface?: SurfaceType, startLevelIndex = 0, customMeshFile?: File, mapSize?: MapSize, quickGameModeType?: LanGameMode): Promise<void> {
  // Show loading overlay during game initialization (black screen phase after StartMenu)
  showGameLoading('STARTING GAME...');

  // Detect mobile mode early -- affects quality, input, and UI decisions
  const mobile = isMobile();

  // On mobile: track how many games the user has played this session, then wait
  // for landscape before initializing anything. Uses sessionStorage (resets each
  // browser session so the prompt isn't shown indefinitely).
  if (mobile) {
    const sessionGameCount = parseInt(sessionStorage.getItem('gw3d-session-games') ?? '0', 10) + 1;
    sessionStorage.setItem('gw3d-session-games', String(sessionGameCount));

    // Attempt programmatic lock first (works on Android Chrome).
    if (screen.orientation) {
      const lock = (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock;
      if (typeof lock === 'function') {
        lock.call(screen.orientation, 'landscape').catch(() => {
          // Silently ignore — blocked on iOS. waitForLandscape() handles iOS UX.
        });
      }
    }

    // Wait for actual landscape (shows friendly prompt on iOS for first few games).
    await waitForLandscape(sessionGameCount);
  }

  // Initialize sound engine (user already clicked start menu, so audio context is allowed)
  const sound = getSoundEngine();
  sound.init();
  sound.resume();

  const bgMusic = new BackgroundMusic();

  // Load level (-1 = endless Quick Game mode)
  const isEndless = startLevelIndex < 0;
  const levelIndex = isEndless ? -1 : Math.min(startLevelIndex, ADVENTURE_LEVELS.length - 1);
  const level: LevelDefinition = isEndless
    ? {
        id: -1,
        name: 'ENDLESS',
        section: 'quick',
        mode: 'survival' as GameModeType,
        surface: (selectedSurface || 'sphere') as any,
        surfaceScale: 10,
        timeLimit: 0,
        lives: 3,
        bombs: 3,
        supers: 0,
        starThresholds: [0, 0, 0] as [number, number, number],
        waves: [
          { delay: 2, enemies: [{ type: 'grunt', count: 4 }] },
          { delay: 6, enemies: [{ type: 'wanderer', count: 3 }] },
          { delay: 12, enemies: [{ type: 'duck', count: 3 }, { type: 'grunt', count: 4 }] },
        ],
      }
    : ADVENTURE_LEVELS[levelIndex];

  // -- Visual style (user-selected from Visual Styles playground) --
  const savedStyle = loadVisualStyle();

  // -- Game engine --
  // On mobile: reduce bloom, cap pixel ratio, apply mobile entity limits
  const defaultBloomStrength = mobile ? 0.4 : 0.7;
  const bloomStrength = savedStyle ? savedStyle.bloomStrength : defaultBloomStrength;
  // Use Game.create() (async factory) so GPU capability detection and renderer
  // selection run properly. The synchronous new Game() path skips detectGPUCapabilities()
  // and createRenderer(), meaning WebGPU is never tried and ?renderer=webgpu is ignored.
  const game = await Game.create({
    bloom: {
      strength: bloomStrength,
      radius: savedStyle?.bloomRadius ?? (mobile ? 0.3 : 0.5),
      threshold: savedStyle?.bloomThreshold ?? 0.6,
    },
    cameraDistance: 20,
    cameraSmoothing: 0.05,
  });

  // Apply mobile entity limits (cap enemies, particles, etc.)
  if (mobile) {
    game.entityLimits = {
      maxEnemies: 200,
      maxBullets: 500,
      maxParticles: 2000,
      maxGeoms: 300,
      bloomEnabled: true,
      shadowsEnabled: false,
    };
    // Cap pixel ratio to 1.5x on mobile — saves ~44% GPU fill vs 2.0x cap
    // (1.5² = 2.25 vs 2.0² = 4.0 pixels per CSS pixel on high-DPI displays)
    game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }

  // Disable built-in camera - we control camera to follow player
  game.disableBuiltInCameraUpdate = true;

  // Ensure camera aspect ratio matches current viewport dimensions
  // (fixes potential horizontal stretch on game start, especially on mobile)
  game.ensureCameraAspectRatio();

  // Resize handler: iOS Safari can change innerHeight when the URL bar shows/hides.
  // Without this, the canvas stays at the initial size and appears cropped/zoomed.
  if (mobile) {
    window.addEventListener('resize', () => {
      game.renderer.setSize(window.innerWidth, window.innerHeight);
      game.ensureCameraAspectRatio();
    }, { passive: true });
  }

  // -- Shockwave + Chromatic Aberration + Screen Flash post-processing --
  // This replaces the vignette pass with a combined pass that adds:
  //   1. Shockwave distortion rings (enemy deaths, explosions)
  //   2. Chromatic aberration (player damage)
  //   3. Screen flash (kills, bombs)
  //   4. Vignette (merged from old pass)
  // Shockwave effect (shared with MP via SharedGameSetup)
  const shockwaveEffect = setupShockwaveEffect(game, game.camera);

  // Set global renderer info so all SettingsMenu instances show it
  SettingsMenu.setGlobalRendererInfo(game.backend, game.isWebGPU);

  // Apply saved visual mode (pixelated = half-res bloom, modern = full-res bloom)
  const savedVisualMode = loadVisualMode();
  game.setVisualMode(savedVisualMode);

  // Apply visual style changes in real-time when user selects a style in Settings
  SettingsMenu.setGlobalVisualStyleChangeCallback((preset) => {
    const currentVisualMode = loadVisualMode();
    if (preset) {
      // Adjust bloom strength based on visual mode (pixelated vs modern)
      const adjustedStrength = getAdjustedBloomStrength(preset.bloomStrength, currentVisualMode);
      // Use setBloomSettings for strength/threshold (works for both WebGL2 and WebGPU)
      game.setBloomSettings(adjustedStrength, preset.bloomThreshold ?? 0.85);
      // Radius is WebGL2-only (no equivalent in WebGPU TSL bloom approximation)
      if (game.bloomPass && preset.bloomRadius !== undefined) {
        game.bloomPass.radius = preset.bloomRadius;
      }
    } else {
      // Reset to defaults, adjusted for visual mode
      const defaultStrength = mobile ? 0.4 : 0.7;
      const adjustedStrength = getAdjustedBloomStrength(defaultStrength, currentVisualMode);
      const defaultThreshold = 0.6;
      game.setBloomSettings(adjustedStrength, defaultThreshold);
      if (game.bloomPass) {
        game.bloomPass.radius = mobile ? 0.3 : 0.5;
      }
    }
  });

  // Effects demo panel (press G to toggle)
  new EffectsPanel(game);

  // -- Lighting (shared with MP via SharedGameSetup) --
  setupStandardLighting(game.scene);

  // -- Surface: use level's surface (adventure mode), or menu selection, or URL param --
  const surfaceType = selectedSurface || level.surface || getSurfaceTypeFromURL();
  // Surface config — shared with MP via SharedGameSetup (single source of truth)
  const surfaceConfig = createStandardSurfaceConfig(surfaceType, level.surfaceScale, savedStyle);

  // Create surface (async for custom meshes, sync for built-in)
  let surface: Surface;
  if (surfaceType === 'custom' && customMeshFile) {
    // Show loading indicator while mesh loads
    const loadingDiv = document.createElement('div');
    loadingDiv.textContent = 'Loading custom mesh...';
    loadingDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #00ffff; font-size: 24px; z-index: 10000; background: rgba(0,0,0,0.8); padding: 20px; border-radius: 10px;';
    document.body.appendChild(loadingDiv);

    try {
      // Use createStandardSurfaceConfig to get the same mobile-aware defaults
      // (4× segment density, brightness floor) as built-in surfaces.
      const customSurfaceConfig = createStandardSurfaceConfig('sphere', level.surfaceScale || 8, savedStyle);
      surface = await SurfaceFactory.createCustom({
        meshSource: customMeshFile,
        targetRadius: level.surfaceScale || 8,
        gridColor: (customSurfaceConfig.gridColor as number) ?? 0x2a2aaa,
        surfaceColor: (customSurfaceConfig.surfaceColor as number) ?? 0x141440,
        surfaceOpacity: (customSurfaceConfig.surfaceOpacity as number) ?? 0.05,
        gridOpacity: (customSurfaceConfig.gridOpacity as number) ?? 0.10,
        gridSegmentsU: (customSurfaceConfig.gridSegmentsU as number) ?? 24,
        gridSegmentsV: (customSurfaceConfig.gridSegmentsV as number) ?? 18,
      });
    } catch (err) {
      document.body.removeChild(loadingDiv);
      alert(`Failed to load custom mesh: ${(err as Error).message}`);
      // Fallback to sphere
      surface = SurfaceFactory.create('sphere', surfaceConfig as any);
    } finally {
      if (loadingDiv.parentElement) {
        document.body.removeChild(loadingDiv);
      }
    }
  } else {
    surface = SurfaceFactory.create(surfaceType, surfaceConfig as any);
  }

  // Apply map size scale to surface geometry.
  // This must happen BEFORE scene.add() and updateMatrixWorld() so MeshSurface
  // (BVH for collision/movement) is built against the correctly-scaled geometry.
  const resolvedMapSize = mapSize ?? getDefaultMapSizeForSurface(surfaceType);
  const mapSizeScaleFactor = getMapSizeScaleFactor(resolvedMapSize);
  if (mapSizeScaleFactor !== 1.0) {
    surface.group.scale.setScalar(mapSizeScaleFactor);
  }
  console.log(`[MapSize] ${surfaceType} → ${resolvedMapSize} (scale: ${mapSizeScaleFactor}x)`);

  game.scene.add(surface.group);

  // Log which surface/level is being used
  console.log(`[Geometry Wars] Level ${levelIndex + 1}: ${level.name} (${surfaceType})`);

  // -- Mesh-based movement system (BVH) --
  // Wraps the surface mesh for shape-agnostic movement queries.
  // Replaces UV-based movement for player; enemies/geoms still use UV as bridge.
  surface.group.updateMatrixWorld(true);
  const meshSurface = new MeshSurface(surface.walkableMesh);

  // -- Depth occlusion (raycast-based) --
  // Raycasts from camera to enemies, counting surface intersections to determine
  // opacity. Enemies behind walls are dimmed/hidden. Batched for performance.
  const depthOcclusion = new DepthOcclusionSystem({
    opacity0: 1.0,     // Clear line of sight: fully bright
    opacity1: 0.12,    // Behind one surface: dramatically darker
    opacity2Plus: 0.04, // Behind multiple surfaces: nearly invisible
    lerpSpeed: 10.0,   // Faster transitions for snappy feel
  });
  depthOcclusion.setSurfaceMesh(surface.mesh);

  // -- Spatial hash visibility (player-centric per-instance dimming) --
  // Dims enemies that are geographically far from the player regardless of
  // geometric occlusion. Complements depth-occlusion (which handles enemies
  // behind surfaces). Correct on all surfaces including torus and cube-tunnel.
  const spatialHashVisibility = new SpatialHashVisibility();

  // -- Input --
  // On mobile, use virtual joystick touch controls; otherwise keyboard+mouse.
  const input = mobile ? new TouchInput() : new InputManager();

  // Surface transform callback shared by subsystems still using UV (enemies, geoms).
  // Pass mapSizeScaleFactor so UV-based entities appear on the correctly-scaled surface.
  const getTransform = makeSurfaceTransformFn(surface, mapSizeScaleFactor);

  // -- Bullet pool --
  const bulletPool = new BulletPool();
  game.scene.add(bulletPool.root);

  // Set mesh surface for shape-agnostic bullet projection (replaces sphere-only projection)
  bulletPool.setMeshSurface(meshSurface);
  bulletPool.setSurfaceFunctions(
    getTransform,
    (u: number, v: number, du: number, dv: number) => surface.moveOnSurface(u, v, du, dv)
  );
  // Scale bullet range with map size: larger maps → bullets travel proportionally further.
  bulletPool.lifetimeMultiplier = mapSizeScaleFactor;

  // -- GPU instanced bullet rendering (reduces draw calls from 1-per-bullet to 1-per-type) --
  const bulletInstanceManager = new BulletInstanceManager(game.scene, 200);

  // Hide the original line-based bullet visuals since instanced rendering takes over
  bulletPool.root.visible = false;

  // Track which pool indices are registered with the instance manager
  const bulletInstanceIds = new Set<string>();

  // -- Player --
  const player = new Player(bulletPool);
  player.respawn(0.5, 0.5);
  player.lives = level.lives > 0 ? level.lives : 3; // Default to 3 lives, not 99
  player.bombs = level.bombs;
  game.scene.add(player.mesh);
  game.cameraTarget = player.mesh;

  // Create MeshWalker for player (mesh-based movement, no UV pole singularity).
  // Scale speed by mapSizeScaleFactor: larger maps (EPIC=2x) have bigger world-space geometry,
  // so the player needs 2x world-speed to traverse them at the same apparent rate as MEDIUM maps.
  const initialPoint = surface.getPoint(0.5, 0.5);
  const playerWalker = new MeshWalker(meshSurface, initialPoint.position, PLAYER_MOVE_SPEED * mapSizeScaleFactor);

  // Sync player position from walker
  player.mesh.position.copy(playerWalker.position);
  // Bridge: set initial UV from world position for enemies/geoms that still use UV
  const initialUV = surface.worldToSurface(playerWalker.position);
  player.surfaceU = initialUV.u;
  player.surfaceV = initialUV.v;

  // -- Player glow trail (follows player movement) --
  const playerGlowTrail = new GlowTrail(
    new THREE.Color(GlowPresets.player.color),
    60,
    0.4
  );
  game.scene.add(playerGlowTrail.root);

  // -- Entity glow manager (subtle glow halos) --
  const glowManager = new EntityGlowManager();

  // Add glow to player
  const playerGlow = new EntityGlow(
    GlowPresets.player.color,
    GlowPresets.player.size,
    GlowPresets.player.opacity,
    GlowPresets.player.pulseSpeed,
    GlowPresets.player.pulseAmount
  );
  playerGlow.attachTo(player.mesh);

  // -- Enemy spawner --
  const enemySpawner = new EnemySpawner(game.scene, getTransform);
  enemySpawner.setMeshSurface(meshSurface);
  enemySpawner.setSurface(surface); // FIX: enemies need surfaceRef for UV sync in walker mode

  // Normalize enemy UV speed so world-space speed stays consistent across all maps.
  // Without this, enemies on SMALL maps (0.75x scale) move at 75% world speed vs MEDIUM.
  // Formula: (surface.speedScale / mapSizeScaleFactor) normalizes to sphere-equivalent speed.
  // benchmark.ts also calls this; main.ts was missing it.
  enemySpawner.setSurfaceSpeedScale(surface.speedScale / mapSizeScaleFactor);

  // Apply map size cap: limits max simultaneous enemies based on surface area tier.
  // resolvedMapSize was already computed above when applying surface scale.
  enemySpawner.setMaxActiveEnemies(getMaxActiveEnemies(resolvedMapSize));

  // -- GPU instanced rendering for enemies (reduces draw calls from ~2000 to ~15) --
  const enemyInstanceManager = new EnemyInstanceManager(game.scene);
  enemySpawner.setInstanceManager(enemyInstanceManager);

  // -- Dynamic Difficulty Adjustment (DDA) system --
  const ddaSettings = loadDDASettings();
  const ddaTracker = new DDAPerformanceTracker(0);
  const ddaEngine = new DDADecisionEngine();
  ddaEngine.setEnabled(ddaSettings.enabled);
  const ddaSpawnModifier = new DDASpawnModifier(ddaEngine);
  enemySpawner.setDDAModifier(ddaSpawnModifier);
  // Single player: one player position for zone detection
  const ddaPlayers = [{ index: 0, u: 0.5, v: 0.5 }];
  enemySpawner.setDDAPlayers(ddaPlayers);

  // -- DDA passive data logger (samples state every 5s, persists to localStorage) --
  const ddaLogger = new DDALogger([ddaTracker], ddaEngine, surfaceType);

  // -- LOD manager (reduces triangle count for distant enemies) --
  // On mobile: switch to lower LOD sooner (half the distances) to reduce GPU vertex load.
  const lodManager = new LODManager(
    mobile
      ? { highDistance: 30, mediumDistance: 60, hysteresis: DEFAULT_LOD_CONFIG.hysteresis }
      : undefined,
  );

  // -- Adaptive quality (auto-adjusts visual fidelity to maintain 60fps) --
  const adaptiveQuality = new AdaptiveQuality({
    initialLevel: mobile ? QualityLevel.MEDIUM : QualityLevel.ULTRA,
  });

  // Apply quality changes when adaptive system transitions between levels
  adaptiveQuality.onQualityChange = (_oldLevel, newLevel) => {
    const settings = adaptiveQuality.getSettings();

    console.log(`[AdaptiveQuality] ${_oldLevel} → ${newLevel} (FPS: ${adaptiveQuality.getPerformanceSnapshot().fps.toFixed(1)})`);

    // Apply bloom settings (works for both WebGL2 and WebGPU)
    if (settings.bloomEnabled) {
      const strength = bloomStrength * settings.bloomResolutionScale;
      game.setBloomSettings(strength, 0.6);  // Keep threshold constant
      // Radius is WebGL2-only
      if (game.bloomPass) {
        game.bloomPass.radius = (mobile ? 0.3 : 0.5) * settings.bloomResolutionScale;
      }
    } else {
      game.setBloomSettings(0, 0.6);  // Disable bloom by setting strength to 0
    }

    // Update bloom render-target resolution (lower quality = smaller target = faster).
    // Minimum 0.25 even when bloom disabled to keep vignette pass functional.
    // Stored on `game` so window resize re-applies the correct scale.
    if (game.composer) {
      const scale = settings.bloomEnabled ? Math.max(0.25, settings.bloomResolutionScale) : 0.25;
      game.bloomResolutionScale = scale;
      game.composer.setSize(
        Math.floor(window.innerWidth * scale),
        Math.floor(window.innerHeight * scale),
      );
      if (game.bloomPass) {
        game.bloomPass.resolution.set(
          Math.floor(window.innerWidth * scale),
          Math.floor(window.innerHeight * scale),
        );
      }
    }

    // Scale particle emission budget with quality level.
    // At lower quality, fewer particles spawn per frame — keeps FPS stable
    // during heavy combat even when mortar chains and volatile explosions stack.
    // `particles` is defined later in this scope; closure captures the reference.
    if (typeof particles !== 'undefined') {
      const budgets: Record<string, [number, number]> = {
        ULTRA: [200, 40],
        HIGH: [120, 30],
        MEDIUM: [60, 20],
        LOW: [30, 10],
        MINIMAL: [15, 5],
      };
      const [maxP, maxF] = budgets[newLevel] ?? [200, 40];
      particles.setEmitBudget(maxP, maxF);
    }

    // LOD bias: tighter distance thresholds at lower quality levels so more enemies
    // switch to simplified/billboard geometry, reducing GPU vertex load.
    const lodDistances: Record<string, { highDistance: number; mediumDistance: number }> = {
      ULTRA:   { highDistance: 60,  mediumDistance: 120 },
      HIGH:    { highDistance: 45,  mediumDistance: 90  },
      MEDIUM:  { highDistance: 30,  mediumDistance: 60  },
      LOW:     { highDistance: 15,  mediumDistance: 30  },
      MINIMAL: { highDistance: 10,  mediumDistance: 20  },
    };
    const lodCfg = lodDistances[newLevel];
    if (lodCfg) {
      lodManager.setConfig(lodCfg);
    }

    // Mobile: reduce pixel ratio on lower quality levels to cut fill cost.
    if (mobile) {
      const pixelRatioForLevel: Record<string, number> = {
        ULTRA:   1.5,
        HIGH:    1.5,
        MEDIUM:  1.25,
        LOW:     1.0,
        MINIMAL: 1.0,
      };
      const targetPR = pixelRatioForLevel[newLevel] ?? 1.5;
      game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, targetPR));
      game.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  };

  // -- Debug performance overlay --
  const perfTracker = new PerformanceTracker(surfaceType);
  const debugOverlay = new DebugOverlay(perfTracker);
  const profilingOverlay = new ProfilingOverlay();
  const profilingPersistence = new ProfilingPersistence();
  const entityAudit = new EntityAudit();
  debugOverlay.setRendererBackend(game.backend);

  // Set global debug change callback (must be after debugOverlay is created)
  SettingsMenu.setGlobalDebugChangeCallback((debugSettings) => {
    if (debugSettings.showDebugStatistics) {
      debugOverlay.show();
    } else {
      debugOverlay.hide();
    }
  });

  // Apply debug settings (hide overlay if disabled)
  const debugSettings = loadDebugSettings();
  if (!debugSettings.showDebugStatistics) {
    debugOverlay.hide();
  }

  // -- Performance telemetry logger (persistent, never deleted) --
  const perfLogger = new PerformanceLogger(surfaceType);
  const perfEnemyTypeMap = new Map<EnemyType, number>(); // pre-allocated
  let perfEnemyTypeCounter = 0;
  // Gameplay telemetry: buff string rebuilt every 30th frame (same cadence as enemy types)
  let perfBuffString = '';
  let perfBuffStringCounter = 0;

  // -- Enemy glow trails (for fast-moving enemies) --
  // On mobile: skip glow trails entirely — they add GlowTrail BufferGeometry allocations
  // every frame and extra draw calls that hurt fill-rate-limited mobile GPUs.
  const enemyGlowTrails = new Map<BaseEnemy, GlowTrail>();

  // Fast enemy types that get glow trails (disabled on mobile)
  const FAST_ENEMY_TYPES = mobile ? [] : ['Mayfly', 'Rocket', 'Duck'];

  // Colors for different enemy types
  const ENEMY_TRAIL_COLORS: Record<string, number> = {
    Mayfly: 0xddddff,
    Rocket: 0xff8800,
    Duck: 0xff44aa,
  };

  // -- Particle system --
  const particles = new ParticleSystem(5000);
  game.scene.add(particles.root);

  // On mobile: apply reduced particle emission budget immediately (don't wait for first
  // quality-level change). Mobile starts at MEDIUM quality (60/20), matching MEDIUM budget.
  if (mobile) {
    particles.setEmitBudget(60, 20);
  }

  // In pixelated mode, half-res bloom enlarges bloom spots for each particle.
  // Reduce per-particle brightness so additive stacking doesn't create a white
  // patch that obscures the player (the savedVisualMode was read at game startup).
  particles.setPixelatedMode(savedVisualMode === 'pixelated');

  // -- Score popups --
  const scorePopups = new ScorePopupManager();
  game.scene.add(scorePopups.root);
  scorePopups.setCamera(game.camera);

  // -- Minimap --
  const minimap = new Minimap();
  if (mobile) {
    minimap.setVisible(false);
  }

  // -- Kill log (bottom-left) + total kill counter (bottom-right) --
  const killLog = new KillLog();
  const totalKillCounter = new TotalKillCounter();
  killLog.onKill = (type, color) => totalKillCounter.addKill(type, color);
  if (mobile) {
    totalKillCounter.hide();
  }

  // -- Player leveling system (kill-based progression) --
  const playerLevel = new PlayerLevel();
  game.scene.add(playerLevel.auraRing);
  const levelUpNotification = new LevelUpNotification();
  const upgradeNotification = new UpgradeNotification();

  // -- Buff system (stackable Risk-of-Rain-style buffs) --
  const buffManager = new BuffManager();

  // -- Cross-game passive mastery bonuses (loaded from localStorage, fixed for this session) --
  const masteryStore = MasteryStore.load();
  const passiveMasteryBonuses = masteryStore.getPassiveMultipliers();
  // Build level map for HUD display (0-5 per weapon)
  const persistentMasteryLevels = new Map<WeaponType, number>();
  for (const type of Object.values(WeaponType)) {
    persistentMasteryLevels.set(type, masteryStore.getLevel(type));
  }

  // -- Weapon mastery system (per-weapon kill tracking → tier-up buffs) --
  const weaponMastery = new WeaponMasteryManager();

  // -- Mastery point store (cross-session persistent; tracks earned/spent points & permanent unlocks) --
  const masteryPointStore = MasteryPointStore.load();

  // -- Per-match upgrade tracker (activates permanently-unlocked nodes via kill thresholds) --
  const matchUpgradeTracker = new MatchUpgradeTracker(masteryPointStore.getUnlockedNodes());

  const buffHUD = new BuffHUD();
  if (mobile) {
    buffHUD.setCompactMode(true);
  }
  const shockArcRenderer = new ShockArcRenderer();
  game.scene.add(shockArcRenderer.root);

  // -- Buff aura ring system (per-buff shader effects around the player) --
  const buffAuraRenderer = new BuffAuraRenderer(
    mobile ? AuraQuality.Reduced : AuraQuality.Full,
  );
  game.scene.add(buffAuraRenderer.root);

  const buffParticleAura = new BuffParticleAura();
  game.scene.add(buffParticleAura.root);

  // Wire buff callbacks
  buffManager.onBuffGained = (type, _newStacks) => {
    buffHUD.highlightBuff(type);
  };

  buffManager.onVolatileExplosion = (position, radius, _damage) => {
    particles.bombExplosion(position);
    surface.applyForce(position, 0.3, radius * 0.5);
    screenShake.shake(0.2, 0.15);
    // No screen-space shockwave/flash for volatile explosions — too distracting.
    // Shockwave distortion is reserved for mega boss deaths only.
  };

  /** Recompute combined multipliers from PlayerLevel + BuffManager + passive mastery */
  function applyStatMultipliers(): void {
    const perk = playerLevel.perk;
    const boostMult = player.boostActive ? BOOST_SPEED_MULTIPLIER : 1.0;
    playerWalker.speed = PLAYER_MOVE_SPEED * mapSizeScaleFactor * perk.moveSpeedMultiplier * buffManager.getMoveSpeedMultiplier() * boostMult;
    // Fire rate: combine PlayerLevel + BuffManager + passive mastery for current weapon
    const currentWeapon = weaponManager.getCurrentWeapon();
    const passiveBonus = passiveMasteryBonuses.get(currentWeapon);
    const persistentFireRateMult = passiveBonus?.fireRateMultiplier ?? 1.0;
    player.fireRateMultiplier = perk.fireRateMultiplier * buffManager.getFireRateMultiplier() * persistentFireRateMult;
    bulletPool.speedMultiplier = perk.bulletSpeedMultiplier;
  }

  playerLevel.onLevelUp = (level, perk) => {
    levelUpNotification.show(level, perk);
    getSoundEngine().play('multiplierUp', { pitch: 1.2 + level * 0.05 });
    if (perk.bonusBombs > 0) {
      player.bombs += perk.bonusBombs;
    }
    // Update stat multipliers immediately (combines PlayerLevel + BuffManager)
    applyStatMultipliers();
  };

  // Persist earned mastery points on every level-up, and notify the player.
  // Points are credited to the currently equipped weapon (per-weapon XP system).
  playerLevel.onMasteryPointEarned = () => {
    masteryPointStore.earnPoint(weaponManager.getCurrentWeapon());
    upgradeNotification.showMasteryPointEarned();
  };

  // Notify the player when a weapon upgrade node activates mid-match
  matchUpgradeTracker.onUpgradeActivated = (nodeId, weaponType) => {
    upgradeNotification.show(nodeId, weaponType);
  };

  // -- Screen shake --
  const screenShake = new ScreenShake();

  // -- Surface shockwave (propagating deformation ring) --
  const surfaceShockwave = new SurfaceShockwave(surface);

  // -- Plasma explosion effect (expanding visual ring + enemy damage sweep) --
  const plasmaExplosionEffect = new PlasmaExplosionEffect();
  game.scene.add(plasmaExplosionEffect.root);

  // -- Score manager --
  const scoreManager = new ScoreManager();
  scoreManager.setPlayer(player);

  // Combo display
  scoreManager.onComboChange = (combo: number) => {
    UIHelpers.updateComboDisplay(combo);
  };

  // -- Wave scheduler --
  const waveScheduler = new WaveScheduler(level.waves, isEndless);

  // Wire difficulty scaling into wave scheduler (reads player state each wave)
  waveScheduler.getDifficultyInput = () => ({
    score: player.score,
    elapsedTime: 0, // overridden inside WaveScheduler.update()
    combo: scoreManager.combo,
    totalKills: playerLevel.totalKills,
    playerLevel: playerLevel.level,
    buffPower: buffManager.getTotalBuffPower(),
    playerCount: waveScheduler.playerCount, // always 1 for main.ts (single-player)
    companionCount: companionManager.count,
  });

  // -- Game mode --
  const modeType = level.mode as GameModeType;
  const modeDefaults = MODE_DEFAULTS[modeType] || {};
  const gameMode = new GameMode({
    type: modeType,
    timeLimit: level.timeLimit,
    lives: level.lives,
    bombs: level.bombs,
    supers: level.supers,
    canShoot: modeDefaults.canShoot !== undefined ? modeDefaults.canShoot : true,
    starThresholds: level.starThresholds,
  });

  let isLevelComplete = false;

  gameMode.onComplete = (stars: number) => {
    if (isLevelComplete) return;
    isLevelComplete = true;
    perfTracker.saveSession();
    perfLogger.saveSession();
    ddaLogger.finalize();

    // Export logs to disk with git version tagging
    import('./utils/PerformanceExporter').then(({ exportLogsToServer }) => {
      const serverUrl = process.env.NODE_ENV === 'production'
        ? window.location.origin
        : 'http://localhost:2567';
      exportLogsToServer(serverUrl, true, true).catch((err) => {
        console.error('[Main] Export error:', err);
      });
    });

    bgMusic.stop();
    sound.play('multiplierUp');
    setTimeout(() => {
      levelCompleteScreen.show(
        levelIndex,
        level.name,
        player.score,
        stars,
        level.starThresholds,
        hasNextLevel,
      );
    }, 200);
  };

  gameMode.onFailed = () => {
    // Failed is handled by the game over flow (lives depleted)
  };

  gameMode.onTimeBonus = (seconds: number) => {
    // Show time bonus popup at player position
    scorePopups.spawn(player.mesh.position.clone(), `+${seconds}s`, '#00ffff', 2.0);
    sound.play('multiplierUp');
  };

  // -- Super state manager --
  const superStateManager = new SuperStateManager();

  // -- Collision system (handles all collision detection + enemy colors) --
  const collisionSystem = new CollisionSystem();
  // s44r6b-02: Set surface type for cube-specific hit detection tuning
  collisionSystem.surfaceType = surfaceType;

  // -- Pickup spawner (manages all pickup types) --
  // Pass mapSizeScaleFactor so pickups scale their UV collision radius inversely,
  // keeping world-space pickup radius constant across map sizes.
  const pickupSpawner = new PickupSpawner(game.scene, mapSizeScaleFactor);

  // -- Portals (teleportation rings) --
  // Portals are a PvP/PvPvE-only feature. Single-player mode does NOT spawn portals.
  // Portal creation is handled in network-main.ts for LAN multiplayer sessions.
  const portals: never[] = [];

  // -- Enemy colors for particle effects (also in CollisionSystem, duplicated here for non-collision deaths like bombs/weapons) --
  const ENEMY_COLORS: Record<string, THREE.Color> = {
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
  const ENEMY_COLOR_FALLBACK = new THREE.Color(0xffffff);

  // Damage number colors by weapon type — differentiates source type visually
  const WEAPON_DAMAGE_COLORS: Partial<Record<WeaponType, string>> = {
    [WeaponType.Standard]:       '#ff4444', // red — blaster bullets (handled by CollisionSystem)
    [WeaponType.Spread]:         '#ff4444', // red — spread shot bullets
    [WeaponType.Piercing]:       '#ffffff', // white — piercing beam
    [WeaponType.ChainLightning]: '#aaffff', // cyan — chain lightning
    [WeaponType.Homing]:         '#ff8844', // orange-red — homing missile
    [WeaponType.PlasmaMortar]:   '#44ff44', // green — plasma mortar
    [WeaponType.GravityGun]:     '#aa44ff', // purple — gravity gun
    [WeaponType.LaserBeam]:      '#ff2222', // bright red — laser
    [WeaponType.BlackHole]:      '#cc44ff', // purple — black hole
    [WeaponType.TeslaCoil]:      '#00aaff', // blue — tesla coil
  };

  // -- Weapon manager --
  const weaponManager = new WeaponManager();
  weaponManager.setMeshSurface(meshSurface);
  weaponManager.playerPositionRef = playerWalker.position;
  weaponManager.setUpgradeTracker(matchUpgradeTracker);
  game.scene.add(weaponManager.getVisualRoot());

  // Wire weapon callbacks
  weaponManager.setCallbacks({
    getEnemies: () => {
      return enemySpawner.getEnemies()
        .filter(e => e.alive && e.mesh)
        .map((e, i) => ({
          position: e.position.clone(),
          meshPosition: e.mesh ? e.mesh.position.clone() : undefined,
          index: i,
          alive: e.alive,
        }));
    },
    onEnemyDamage: (index: number, damage: number, weaponType: WeaponType) => {
      const enemies = enemySpawner.getEnemies().filter(e => e.alive && e.mesh);
      const enemy = enemies[index];
      if (!enemy) return;
      const scorePower = scoreManager.getScorePowerMultiplier() * playerLevel.damageMultiplier * buffManager.getDamageMultiplier();
      enemy.takeDamage(damage * scorePower);
      // Trigger on-hit procs (incendiary etc.) with reduced proc coefficient for weapon damage
      if (enemy.alive) {
        buffManager.onBulletHit(enemy, 0.3);
        // Color-code by weapon source type
        const dmgColor = WEAPON_DAMAGE_COLORS[weaponType] ?? '#ff4444';
        scorePopups.spawnDamage(enemy.position, damage * scorePower, dmgColor);
      }
      if (!enemy.alive) {
        const enemyType = enemy.constructor.name.toLowerCase();
        const color = ENEMY_COLORS[enemyType] ?? ENEMY_COLOR_FALLBACK;

        // Use lightweight death effect for AoE weapon kills to avoid screen-blocking
        if (weaponType === WeaponType.Homing || weaponType === WeaponType.PlasmaMortar) {
          particles.aoeDeath(enemy.position, color);
        } else {
          particles.enemyDeath(enemy.position, color);
        }

        scoreManager.awardKill(enemy.scoreValue, enemyType);
        // Show points value when enemy is killed by special weapon
        scorePopups.spawnScore(enemy.position.clone(), enemy.scoreValue);
        screenShake.shake(0.15, 0.15);
        getSoundEngine().play('enemyDeath', { pitch: 0.8 + Math.random() * 0.4 });
        killLog.addKill(enemyType, color.getHex());
        playerLevel.addKill();
        weaponMastery.recordKill(weaponType);
        matchUpgradeTracker.recordKill(weaponType);

        // Trigger on-death procs (volatile explosions)
        buffManager.onEnemyDeath(enemy, enemySpawner.getEnemies());

        // Award multiplier directly on kill (geoms removed)
        for (let g = 0; g < enemy.geomCount; g++) {
          scoreManager.collectGeom();
        }
      }
    },
    onEnemyPull: (index: number, strength: number, center: THREE.Vector3) => {
      const aliveEnemies = enemySpawner.getEnemies().filter(e => e.alive && e.mesh);
      const enemy = aliveEnemies[index];
      if (!enemy) return;
      const dx = center.x - enemy.position.x;
      const dz = center.z - enemy.position.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < 0.0001) return;
      const dist = Math.sqrt(distSq);
      const GRAVITY_PULL_FORCE = 0.8;
      enemy.applyKnockback(
        (dx / dist) * GRAVITY_PULL_FORCE * strength,
        (dz / dist) * GRAVITY_PULL_FORCE * strength,
      );
      // Visual: purple streaks from enemy toward pull center
      particles.gravityPullTrail(enemy.position, center);
    },
    spawnBullet: (origin: THREE.Vector3, direction: THREE.Vector3) => {
      const { u, v } = surface.worldToSurface(origin);
      const aimAngle = Math.atan2(direction.x, direction.z);
      bulletPool.spawn(origin, direction, u, v, aimAngle);
    },
    onProjectileExplosion: (position: THREE.Vector3, wType: WeaponType) => {
      if (wType === WeaponType.Homing) {
        particles.homingExplosion(position);
        surface.applyForce(position, 0.1, 0.4);
        screenShake.shake(0.1, 0.1);
      } else if (wType === WeaponType.PlasmaMortar) {
        particles.mortarExplosion(position);
        surfaceShockwave.spawn(position, 3.0, 8.0, 0.4);
        screenShake.shake(0.5, 0.35);
        shockwaveEffect.spawnShockwave(position, 0.08, 1.2, 0.8, 0.1);
        shockwaveEffect.triggerWhiteFlash(0.3);
        shockwaveEffect.triggerChromatic(0.012);
        // Spawn expanding shockwave ring (visual + secondary damage beyond blast radius)
        plasmaExplosionEffect.spawn(position);
        // Knock back enemies within blast radius
        const KNOCKBACK_RADIUS = 3.0;
        const KNOCKBACK_SPEED = 0.15;
        for (const enemy of enemySpawner.getEnemies()) {
          if (!enemy.alive) continue;
          const dx = enemy.position.x - position.x;
          const dz = enemy.position.z - position.z;
          const distSq = dx * dx + dz * dz;
          if (distSq < KNOCKBACK_RADIUS * KNOCKBACK_RADIUS && distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const strength = KNOCKBACK_SPEED * (1.0 - dist / KNOCKBACK_RADIUS);
            enemy.applyKnockback(dx / dist * strength, dz / dist * strength);
          }
        }
      } else if (wType === WeaponType.GravityGun) {
        // Black hole surface deformation: inward pull, dramatic snap-back
        surface.applyMeshForce(position, -2.5, 1.5);
        // Also deform grid (visible ripple on grid lines)
        surface.applyForce(position, -0.15, 1.5);
        // Gravity implosion particles (replaces generic bulletImpact)
        particles.gravityExplosion(position);
        screenShake.shake(0.08, 0.3);
      }
    },
    onGravityGunMove: (position: THREE.Vector3) => {
      // Continuous surface suction as the projectile travels
      surface.applyForce(position, -0.02, 0.6);
    },
  });

  // Wire mastery damage multiplier into WeaponManager (combines in-session tier + persistent cross-game bonus)
  weaponManager.setMasteryMultiplierFn((type) => {
    const inSessionMult = buffManager.getMasteryMultiplier(type).damageMultiplier;
    const passiveBonus = passiveMasteryBonuses.get(type);
    const persistentMult = passiveBonus?.damageMultiplier ?? 1.0;
    return inSessionMult * persistentMult;
  });

  // Wire mastery level function for Level 5 final form behavior gates
  weaponManager.setMasteryLevelFn((type) => masteryStore.getLevel(type));

  // -- Weapon HUD (inventory display) --
  const weaponHUD = new WeaponHUD();
  // Position weapon HUD at mid-left to avoid overlap with performance stats overlay.
  // Use 25% of viewport height for both desktop and mobile (responsive).
  // Minimum 100px on small screens to ensure reasonable spacing.
  const weaponHUDY = Math.max(100, Math.round(window.innerHeight * 0.25));
  weaponHUD.setPosition(10, weaponHUDY);

  // Wire session level-up: show compact level toast after each pickup beyond the first
  weaponManager.onWeaponLevelUp = (weaponType, level) => {
    if (level >= 2) {
      const mult = weaponManager.getSessionDamageMultiplier(weaponType);
      const bonusPct = Math.round((mult - 1) * 100);
      weaponHUD.showPickupNotification(`${WEAPON_CONFIGS[weaponType].name} Lv.${level} — +${bonusPct}% dmg`);
    }
  };

  // Wire mastery tier-up: award buff + show toast + play sound (must be after weaponHUD is created)
  weaponMastery.onMasteryTierUp = (weaponType, tier) => {
    const buffType = WEAPON_MASTERY_BUFF_MAP[weaponType];
    if (buffType) {
      buffManager.addBuff(buffType);
      const def = BUFF_DEFINITIONS[buffType];
      weaponHUD.showMasteryTierUp(WEAPON_CONFIGS[weaponType].name, tier, def.name);
      getSoundEngine().play('weaponPickup', { volume: 0.7, pitch: 1.6 });
    }
  };

  // -- Wire DDA logger extras (buff/weapon tracking) --
  ddaLogger.setExtrasProvider({
    getActiveBuffs: () =>
      buffManager.getActiveBuffs().map(b => `${b.def.shortName}:${b.stacks}`),
    getCurrentWeapon: () => weaponManager.getCurrentWeapon(),
  });

  // -- Companion system --
  const companionManager = new CompanionManager(mapSizeScaleFactor);
  companionManager.setMeshSurface(meshSurface);
  game.scene.add(companionManager.root);
  const companionHUD = new CompanionHUD();

  // -- Camera controller (handles positioning, orbit, zoom) --
  const cameraController = new CameraController(game.camera);
  // Start zoomed in closer on mobile for better visibility of the player (3x more zoomed than desktop)
  if (mobile) {
    cameraController.setCameraDistance(5);
  }

  // -- Wire up enemy death callbacks (now in EnemyDeathCallbacks module) --
  const bossBarEl = document.getElementById('boss-health-bar') as HTMLElement | null;
  const bossBarFill = document.getElementById('boss-health-fill') as HTMLElement | null;
  const bossPhaseEl = document.getElementById('boss-phase-text') as HTMLElement | null;

  const onBossHealthUpdate = (currentHP: number, maxHP: number, phase: number, totalPhases: number) => {
    if (bossBarEl && bossBarFill && bossPhaseEl) {
      if (maxHP <= 0) {
        bossBarEl.style.display = 'none';
        return;
      }
      bossBarEl.style.display = 'block';
      const pct = Math.max(0, Math.min(100, (currentHP / maxHP) * 100));
      bossBarFill.style.width = `${pct}%`;
      bossPhaseEl.textContent = `PHASE ${phase + 1}/${totalPhases}`;
    }
  };

  const onBossPhaseChange = (_phase: number) => {
    // Add time on phase change for timed levels
    if (level.timeLimit > 0) {
      gameMode.awardTimeBonus(10); // 10 seconds extra per phase
    }
    sound.play('bomb', { volume: 0.8, pitch: 0.5 });
  };

  EnemyDeathCallbacks.wire(enemySpawner);
  EnemyDeathCallbacks.wireBossCallbacks(enemySpawner, onBossHealthUpdate, onBossPhaseChange);
  EnemyDeathCallbacks.wireVirusCallback(enemySpawner);
  EnemyDeathCallbacks.wireFractalSnakeCallbacks(enemySpawner, game.scene);

  // -- Gate: detonation effect (kills nearby enemies, awards score) --
  Gate.onDetonate = (position: THREE.Vector3, score: number) => {
    // Kill all enemies within blast radius
    const blastRadius = 3.0;
    const gateColor = new THREE.Color(0xff8800);
    const allEnemies = enemySpawner.getEnemies();
    for (const enemy of allEnemies) {
      if (enemy.position.distanceTo(position) < blastRadius) {
        enemy.takeDamage(999);
        particles.enemyDeath(enemy.position, gateColor);
      }
    }
    scoreManager.awardKill(score, 'Gate');
    particles.enemyDeath(position, gateColor);
    screenShake.shake(0.4, 0.3);
    sound.play('bomb', { volume: 0.6, pitch: 1.2 });
    scorePopups.spawnScore(position, score, player.multiplier);
  };

  // -- Respawn timer --
  let respawnTimer = 0;
  const RESPAWN_DELAY = 1.5;

  // -- Player previous UV (for gate pass-through detection) --
  let prevPlayerU = player.surfaceU;
  let prevPlayerV = player.surfaceV;

  // -- Painter trail damage cooldown --
  let painterDamageCooldown = 0;

  // -- Checkpoint wave-clear tracking --
  let lastEnemyCount = 0;
  let hadEnemies = false;

  // -- Camera control (now in CameraController module) --

  // -- Game state --
  let isPaused = false;
  let isGameOver = false;

  // LOD assignments (shared between fixed update and render callback)
  let lodAssignments: Map<BaseEnemy, LODLevel> = new Map();

  // -- Pause menu --
  const pauseMenu = new PauseMenu();
  // Single-player is always the host — enables Resume to fully resume the game
  // (without this, isHost defaults to false → Resume enters look mode instead of resuming)
  pauseMenu.setIsHost(true);
  // But hide multiplayer-specific buttons since this is single-player mode
  pauseMenu.setIsMultiplayer(false);
  pauseMenu.setMusic(bgMusic);
  pauseMenu.setPerformanceLogger(perfLogger);
  pauseMenu.setMasteryPointStore(masteryPointStore);
  pauseMenu.onMasteryScreenClose(() => {
    // After player spends/refunds points mid-match, activate any newly-unlocked
    // nodes whose kill thresholds were already crossed in this match
    matchUpgradeTracker.refreshFromStore(masteryPointStore);
  });
  pauseMenu.onResume(() => {
    isPaused = false;
    ctx.state.isPaused = false; // mobile pause button sets this; reset it here too
    if (input instanceof TouchInput) input.setGamePaused(false);
    sound.resume(); // iOS: AudioContext may be suspended after backgrounding
    game.resume(); // resync clock to avoid massive dt after long pause
    // Force respawn if player died during pause
    if (!player.alive && player.lives > 0) {
      respawnTimer = RESPAWN_DELAY;
    }
  });
  pauseMenu.onExit(() => {
    // Clean up and reload page to go back to menu
    ddaLogger.finalize(); // Persist DDA session even on early exit
    game.stop();
    window.location.href = window.location.pathname;
  });

  // Sync pause menu with the saved visual mode
  pauseMenu.setVisualMode(savedVisualMode);

  // Toggle visual mode when user clicks the button in the pause menu
  pauseMenu.onVisualModeChange((mode) => {
    saveVisualMode(mode);
    game.setVisualMode(mode);
    // Re-apply bloom settings adjusted for new visual mode
    const adjustedStrength = getAdjustedBloomStrength(bloomStrength, mode);
    game.setBloomSettings(adjustedStrength, 0.6);
    // Reduce particle brightness in pixelated mode to prevent additive stacking
    // from creating a bright patch that hides the player
    particles.setPixelatedMode(mode === 'pixelated');
  });

  /** Build current game data snapshot for pause menu stats panel */
  function updatePauseMenuData(): void {
    const currentWeapon = weaponManager.getCurrentWeapon();
    const weaponConfig = WEAPON_CONFIGS[currentWeapon];
    const activeBuffs = buffManager.getActiveBuffs();

    const damageMultiplier = buffManager.getDamageMultiplier();
    const fireRateMultiplier = buffManager.getFireRateMultiplier();

    const perk = playerLevel.perk;
    const totalDamageBonus = Math.round((perk.damageMultiplier * damageMultiplier - 1) * 100);
    const totalFireRateBonus = Math.round((perk.fireRateMultiplier * fireRateMultiplier - 1) * 100);
    const totalSpeedBonus = Math.round((perk.moveSpeedMultiplier * buffManager.getMoveSpeedMultiplier() - 1) * 100);

    pauseMenu.setGameData({
      playerLevel: {
        level: playerLevel.level,
        name: perk.name,
        description: perk.description,
        color: '#' + perk.auraColor.toString(16).padStart(6, '0'),
      },
      companions: companionManager.getCompanionCounts(),
      cumulativeBonuses: {
        damageBonus: totalDamageBonus,
        fireRateBonus: totalFireRateBonus,
        speedBonus: totalSpeedBonus,
      },
      buffs: activeBuffs.map(b => ({
        name: b.def.name,
        stacks: b.stacks,
        description: b.def.description,
        currentValue: b.def.formatValue(b.stacks),
        color: '#' + b.def.iconColor.toString(16).padStart(6, '0'),
      })),
      totalKills: totalKillCounter.getTotalKills(),
      weapon: {
        name: weaponConfig.name,
        baseDamage: weaponConfig.damage,
        fireRate: weaponConfig.fireRate,
        effectiveDamage: damageMultiplier !== 1 ? weaponConfig.damage * damageMultiplier : undefined,
        effectiveFireRate: fireRateMultiplier !== 1 ? weaponConfig.fireRate * fireRateMultiplier : undefined,
      },
    });
    pauseMenu.setPerformanceHTML(debugOverlay.getSummaryHTML());
  }

  // -- Game over screen --
  const gameOverScreen = new GameOverScreen();
  const analyticsPanel = new AnalyticsPanel();
  gameOverScreen.onContinue(() => {
    // Show weapon analytics before navigating away
    analyticsPanel.show(perfLogger);
    analyticsPanel.onClose(() => {
      // Award XP to the cross-game mastery store based on this game's kills
      const killsByWeapon = weaponMastery.getKillsByWeapon();
      const xpResults = masteryStore.awardGameXP(killsByWeapon);
      masteryStore.save();

      // Show mastery progress screen if any XP was earned this game
      const anyXP = xpResults.some(r => r.xpAfter > r.xpBefore);
      const anyLevelUp = xpResults.some(r => r.leveledUp);

      const proceedAfterMastery = () => {
        // If any weapon leveled up, show the upgrade tree so the player can see/spend new nodes
        if (anyLevelUp) {
          const upgradeScreen = new WeaponMasteryScreen();
          upgradeScreen.setPointStore(masteryPointStore);
          upgradeScreen.show(masteryStore);
          upgradeScreen.onClose(() => {
            upgradeScreen.dispose();
            game.stop();
            window.location.href = window.location.pathname;
          });
        } else {
          game.stop();
          window.location.href = window.location.pathname;
        }
      };

      if (anyXP) {
        const masteryScreen = new MasteryProgressScreen();
        masteryScreen.show(
          {
            results: xpResults,
            allLevels: masteryStore.getAllLevels(),
            getBonusDescription: (w, lv) => masteryStore.getBonusDescription(w, lv),
          },
          () => {
            masteryScreen.dispose();
            proceedAfterMastery();
          },
        );
      } else {
        proceedAfterMastery();
      }
    });
  });

  // -- Level complete screen --
  const levelCompleteScreen = new LevelCompleteScreen();
  const hasNextLevel = !isEndless && levelIndex + 1 < ADVENTURE_LEVELS.length;

  levelCompleteScreen.onNext(() => {
    ddaLogger.finalize(); // Persist DDA session before level transition
    game.stop();
    bgMusic.stop();
    weaponManager.dispose();
    weaponHUD.dispose();
    companionManager.dispose();
    companionHUD.dispose();
    buffManager.dispose();
    buffHUD.dispose();
    shockArcRenderer.dispose();
    buffAuraRenderer.dispose();
    buffParticleAura.dispose();
    shockwaveEffect.dispose();
    bulletInstanceManager.dispose();
    lodManager.dispose();
    depthOcclusion.dispose();
    spatialHashVisibility.dispose();
    debugOverlay.dispose();
    profilingOverlay.dispose();
    levelCompleteScreen.dispose();
    gameOverScreen.dispose();
    analyticsPanel.dispose();
    // Clear entity pools before disposing game to ensure scene graph is clean (s44r5-05).
    enemySpawner.clear();
    bulletPool.clear();
    // Release GPU geometry/material buffers (s44r5-06).
    surface.dispose();
    // Dispose WebGL renderer, EffectComposer, canvas DOM element (s44r5-05 + s44r5-06).
    game.dispose();
    main(selectedSurface, levelIndex + 1);
  });
  levelCompleteScreen.onReplay(() => {
    ddaLogger.finalize(); // Persist DDA session before replay
    game.stop();
    bgMusic.stop();
    weaponManager.dispose();
    weaponHUD.dispose();
    companionManager.dispose();
    companionHUD.dispose();
    buffManager.dispose();
    buffHUD.dispose();
    shockArcRenderer.dispose();
    buffAuraRenderer.dispose();
    buffParticleAura.dispose();
    shockwaveEffect.dispose();
    bulletInstanceManager.dispose();
    lodManager.dispose();
    depthOcclusion.dispose();
    spatialHashVisibility.dispose();
    debugOverlay.dispose();
    profilingOverlay.dispose();
    levelCompleteScreen.dispose();
    gameOverScreen.dispose();
    analyticsPanel.dispose();
    // Clear entity pools and release GPU resources (same as onNext above).
    enemySpawner.clear();
    bulletPool.clear();
    surface.dispose();
    game.dispose();
    main(selectedSurface, levelIndex);
  });
  levelCompleteScreen.onMenu(() => {
    game.stop();
    window.location.href = window.location.pathname;
  });

  // -- Mobile: wire pause button and camera tilt in TouchInput --
  if (mobile && input instanceof TouchInput) {
    input.onPause = () => {
      if (isGameOver) return;
      if (isPaused) {
        isPaused = false;
        ctx.state.isPaused = false;
        input.setGamePaused(false);
        game.resume();
        pauseMenu.hide();
      } else {
        isPaused = true;
        ctx.state.isPaused = true;
        input.setGamePaused(true);
        game.pause();
        updatePauseMenuData();
        pauseMenu.show();
      }
    };

    // Reset camera pitch on pause (tilt resets to 0, yaw preserved)
    const origOnPause = input.onPause;
    input.onPause = () => {
      origOnPause?.();
      if (isPaused) {
        // Just became paused — reset vertical tilt
        const { yaw } = cameraController.getOrbitAngles();
        cameraController.setOrbitAngles(yaw, 0);
      }
    };
  }

  // -- Mobile: pinch-to-zoom hint (shown once per session) --
  if (mobile) {
    const hintShownKey = 'gw3d-pinch-hint-shown';
    if (!sessionStorage.getItem(hintShownKey)) {
      sessionStorage.setItem(hintShownKey, '1');
      const hint = document.createElement('div');
      hint.style.cssText = `
        position: fixed;
        bottom: 80px;
        left: 20px;
        background: rgba(0,0,0,0.80);
        color: #00dddd;
        font-family: 'Segoe UI', Arial, sans-serif;
        font-size: 13px;
        letter-spacing: 0.5px;
        padding: 10px 16px;
        border-radius: 6px;
        border: 1px solid rgba(0,200,200,0.5);
        text-shadow: 0 0 6px rgba(0,200,200,0.4);
        pointer-events: none;
        z-index: 3000;
        opacity: 1;
        transition: opacity 0.8s;
        display: flex;
        align-items: center;
        gap: 8px;
      `;

      const textSpan = document.createElement('span');
      textSpan.textContent = 'Pinch with THREE fingers to zoom';

      const iconSpan = document.createElement('span');
      iconSpan.style.cssText = 'font-size:18px;';
      iconSpan.textContent = '👆';

      hint.appendChild(iconSpan);
      hint.appendChild(textSpan);
      document.body.appendChild(hint);
      setTimeout(() => { hint.style.opacity = '0'; }, 3000);
      setTimeout(() => { hint.remove(); }, 3800);
    }
  }

  // -- Keyboard handlers (pause, mute) --
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !isGameOver) {
      if (isPaused) {
        isPaused = false;
        ctx.state.isPaused = false; // mobile pause button sets this; reset it here too
        if (input instanceof TouchInput) input.setGamePaused(false);
        sound.resume(); // iOS: AudioContext may be suspended after backgrounding
        game.resume(); // resync clock to avoid massive dt after long pause
        pauseMenu.hide();
      } else {
        isPaused = true;
        if (input instanceof TouchInput) input.setGamePaused(true);
        game.pause(); // stop clock ticking while paused
        updatePauseMenuData();
        pauseMenu.show();
      }
    }
    // M = toggle mute
    if (e.key === 'm' || e.key === 'M') {
      sound.muted = !sound.muted;
      if (sound.muted) {
        bgMusic.volume = 0;
      } else {
        bgMusic.volume = 0.3;
      }
    }
    // N = cycle music preset
    if (e.key === 'n' || e.key === 'N') {
      const preset = bgMusic.cyclePreset();
      const name = bgMusic.getPresetDisplayName(preset);
      // Brief on-screen notification
      let notify = document.getElementById('music-preset-notify');
      if (!notify) {
        notify = document.createElement('div');
        notify.id = 'music-preset-notify';
        notify.style.cssText =
          'position:fixed;top:80px;left:50%;transform:translateX(-50%);' +
          'color:#00ffff;font-family:"Segoe UI",Arial,sans-serif;font-size:18px;' +
          'letter-spacing:3px;text-shadow:0 0 8px #00ffff;z-index:3000;' +
          'pointer-events:none;transition:opacity 0.5s;';
        document.body.appendChild(notify);
      }
      notify.textContent = `MUSIC: ${name.toUpperCase()}`;
      notify.style.opacity = '1';
      setTimeout(() => { if (notify) notify.style.opacity = '0'; }, 1500);
    }
    // F3 = log profiler data to console
    if (e.key === 'F3') {
      const frameData = profiler.getFrameData();
      console.log('=== Performance Profiler Frame Data ===');
      console.table(frameData);
      console.log(`Total frame time: ${profiler.getTotalFrameTime().toFixed(3)}ms`);
      console.log(`Scope count: ${profiler.getScopeCount()}`);
    }
  });

  // -- Auto-pause when tab is hidden (sync with Game.onVisibilityChange) --
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !isPaused && !isGameOver) {
      isPaused = true;
      if (input instanceof TouchInput) input.setGamePaused(true);
      game.pause(); // stop clock ticking while tab is hidden
      updatePauseMenuData();
      pauseMenu.show();
    } else if (!document.hidden) {
      // Tab became visible — iOS suspends AudioContext and may freeze the rAF loop.
      sound.resume(); // wake AudioContext after backgrounding
      game.kickStart(); // restart rAF loop if it was frozen/stopped by the browser
    }
  });

  // Set level name in HUD
  UIHelpers.setLevelName(level.name);

  // -- Tunnel transparency state (used by render loop) --
  const tunnelRaycaster = new THREE.Raycaster();
  const baseSurfaceOpacity = (surfaceConfig.surfaceOpacity as number) ?? 0.05;
  const baseGridOpacity = (surfaceConfig.gridOpacity as number) ?? 0.10;

  // -- Game Context: bundles all shared state for GameLoop and RenderLoop --
  const ctx: GameContext = {
    game,
    player,
    surface,
    surfaceType,
    meshSurface,
    playerWalker,
    input: input as InputManager,
    level,
    isEndless,
    bulletPool,
    enemySpawner,
    bulletInstanceManager,
    bulletInstanceIds,
    enemyInstanceManager,
    particles,
    screenShake,
    surfaceShockwave,
    plasmaExplosionEffect,
    glowTrail: playerGlowTrail,
    shockwaveEffect,
    scorePopups,
    scoreManager,
    playerLevel,
    weaponManager,
    superManager: superStateManager,
    buffManager,
    weaponMastery,
    companionManager,
    collisionSystem,
    pickupSpawner,
    portals,
    cameraController,
    lodManager,
    adaptiveQuality,
    depthOcclusion,
    spatialHashVisibility,
    perfTracker,
    debugOverlay,
    profilingOverlay,
    profilingPersistence,
    perfLogger,
    entityAudit,
    ddaTracker,
    ddaEngine,
    ddaSpawnModifier,
    ddaLogger,
    ddaPlayers,
    mapSizeScaleFactor,
    persistentMasteryLevels,
    gameMode,
    waveScheduler,
    minimap,
    killLog,
    totalKillCounter,
    weaponHUD,
    companionHUD,
    buffHUD,
    shockArcRenderer,
    buffAuraRenderer,
    pauseMenu,
    gameOverScreen,
    levelCompleteScreen,
    getTransform,
    weaponToBulletVisual,
    PLAYER_MOVE_SPEED,
    ENEMY_COLORS,
    ENEMY_COLOR_FALLBACK,
    state: {
      isPaused,
      isGameOver,
      isLevelComplete,
      respawnTimer,
      RESPAWN_DELAY,
      prevPlayerU,
      prevPlayerV,
      painterDamageCooldown,
      lastEnemyCount,
      hadEnemies,
      lodAssignments: new Map(),
      tunnelRaycaster,
      currentSurfaceOpacity: baseSurfaceOpacity,
      currentGridOpacity: baseGridOpacity,
      baseSurfaceOpacity,
      baseGridOpacity,
      fadeSpeed: 8.0,
      isCurrentlyBlocked: false,
      lastRenderTime: performance.now(),
      auditFrameCounter: 0,
      perfEnemyTypeMap,
      perfEnemyTypeCounter,
      perfBuffString,
      perfBuffStringCounter,
    },
  };

  // -- Snap camera to initial player position (s44f-09 fix) --
  // Without this, the camera starts at default (0,0,0) with up (0,1,0) and lerps
  // slowly toward the player over ~20 frames. During that convergence, camera axes
  // extracted by moveFromInput are wrong, causing movement to be direction-locked
  // on elongated surfaces like pill (where the camera "up" and "right" project to
  // nearly parallel vectors on the surface tangent plane during convergence).
  // MP already had snapToFrame via s44b-01; this adds it for SP.
  {
    const frame = playerWalker.getTangentFrame();
    cameraController.snapToFrame(playerWalker.position, playerWalker.normal, frame);
  }

  // -- Game Loop and Render Loop --
  const gameLoop = new GameLoop();
  const renderLoop = new RenderLoop();

  // Wire in dependencies that GameLoop needs but aren't part of standard managers
  gameLoop.setDependencies({
    playerGlowTrail,
    glowManager,
    playerGlow,
    bgMusic,
    sound,
    applyStatMultipliers,
  });

  // -- Test mode: game state exporter for programmatic tests (?testMode=true) --
  // Declared before onFixedUpdate so the closure captures the reference.
  let _stateExporter: { update(): void } | null = null;
  // -- Deep telemetry exporter for visual test harness (?debug=true) --
  let _telemetryExporter: { update(): void } | null = null;
  // -- Test harness API: full game control for automated scenarios (?testMode=true) --
  let _testHarnessAPI: { update(): void } | null = null;

  // -- Fixed timestep game logic --
  game.onFixedUpdate = (dt: number) => {
    // Reset profiler at the start of each frame
    profiler.reset();

    gameLoop.update(ctx, dt);

    // Dynamic enemy cap: escalate max active enemies with difficulty level.
    // Called every frame (cheap — single number assignment, no allocation).
    enemySpawner.setMaxActiveEnemies(getDynamicMaxEnemies(resolvedMapSize, waveScheduler.currentDifficultyLevel));

    // Taper pickup drop rates with difficulty (cheap — difficulty only changes per wave).
    pickupSpawner.setDifficultyLevel(waveScheduler.currentDifficultyLevel);

    // Publish window._gameState for Puppeteer / automated tests
    if (_stateExporter) _stateExporter.update();
    // Publish window.__GAME_TELEMETRY for visual test harness
    if (_telemetryExporter) _telemetryExporter.update();
    // Update test harness API (enemy movement, event tracking)
    if (_testHarnessAPI) _testHarnessAPI.update();

    // Update aura renderer with current player state and active buffs
    const activeBuffs = buffManager.getActiveBuffs().map(b => ({
      type: b.type,
      stacks: b.stacks,
    }));

    // Enemy visibility: dim buff aura visuals when enemies enter the aura zone.
    // Threshold: 2 world units (≈ aura ring radius). Full dim: 0.5 units (very close).
    // This makes enemies clearly visible even with 6+ buff stacks active.
    if (player.alive && activeBuffs.length > 0) {
      const DIM_THRESHOLD = 2.0;  // world units: start dimming
      const DIM_FULL = 0.5;       // world units: maximum dimming
      const pPos = player.mesh.position;
      let nearestDistSq = DIM_THRESHOLD * DIM_THRESHOLD;
      for (const e of enemySpawner.getEnemies()) {
        if (!e.alive || !e.mesh) continue;
        const dSq = pPos.distanceToSquared(e.mesh.position);
        if (dSq < nearestDistSq) nearestDistSq = dSq;
      }
      // If no enemy within threshold, nearestDistSq stays at DIM_THRESHOLD² → factor = 0
      const nearestDist = Math.sqrt(nearestDistSq);
      const dimFactor = nearestDist <= DIM_FULL ? 1.0
        : 1.0 - (nearestDist - DIM_FULL) / (DIM_THRESHOLD - DIM_FULL);
      buffAuraRenderer.setDimmingFactor(dimFactor);
      buffParticleAura.setDimmingFactor(dimFactor);
    } else {
      buffAuraRenderer.setDimmingFactor(0);
      buffParticleAura.setDimmingFactor(0);
    }

    buffAuraRenderer.update(
      dt,
      game.clock.totalTime,
      player.mesh.position,
      playerWalker.normal,
      activeBuffs,
    );

    // Update particle aura system
    buffParticleAura.update(
      dt,
      game.clock.totalTime,
      player.mesh.position,
      playerWalker.normal,
      activeBuffs,
    );

    // Sync mutable state back from ctx.state to local variables
    isPaused = ctx.state.isPaused;
    isGameOver = ctx.state.isGameOver;
    isLevelComplete = ctx.state.isLevelComplete;
    respawnTimer = ctx.state.respawnTimer;
    prevPlayerU = ctx.state.prevPlayerU;
    prevPlayerV = ctx.state.prevPlayerV;
    painterDamageCooldown = ctx.state.painterDamageCooldown;
    lastEnemyCount = ctx.state.lastEnemyCount;
    hadEnemies = ctx.state.hadEnemies;
    lodAssignments = ctx.state.lodAssignments;
  };

  // Render state variables (synced back from ctx.state)
  let currentSurfaceOpacity = ctx.state.currentSurfaceOpacity;
  let currentGridOpacity = ctx.state.currentGridOpacity;
  let isCurrentlyBlocked = ctx.state.isCurrentlyBlocked;
  let lastRenderTime = ctx.state.lastRenderTime;
  let auditFrameCounter = ctx.state.auditFrameCounter;

  // -- Render callback --
  game.onRender = (alpha: number) => {
    renderLoop.render(ctx, alpha);
    // Sync render state back
    currentSurfaceOpacity = ctx.state.currentSurfaceOpacity;
    currentGridOpacity = ctx.state.currentGridOpacity;
    isCurrentlyBlocked = ctx.state.isCurrentlyBlocked;
    lastRenderTime = ctx.state.lastRenderTime;
    auditFrameCounter = ctx.state.auditFrameCounter;
  };

  // -- Weapon fire handler: delegates all firing to WeaponManager --
  player.weaponFireHandler = (origin: THREE.Vector3, direction: THREE.Vector3) => {
    const gameTime = game.clock.totalTime;
    const fired = weaponManager.fire(origin, direction, gameTime, playerWalker.normal);
    if (fired) {
      surface.applyForce(origin, 0.1, 0.3);
      sound.play('shoot', { pitch: 0.9 + Math.random() * 0.2 });
      if (weaponManager.getCurrentWeapon() !== WeaponType.Standard) {
        sound.play('weaponPickup', { volume: 0.3, pitch: 1.5 });
      }
    }
  };

  // -- Bomb: massive effects + clear screen --
  player.onBomb = () => {
    const pos = player.mesh.position;
    surface.applyForce(pos, 0.5, 3.0);
    particles.bombExplosion(pos);
    screenShake.shake(0.3, 0.3);
    sound.play('bomb');
    UIHelpers.screenFlash('rgba(255, 255, 255, 0.6)', 120);
    // Heavy shockwave distortion + flash for bomb
    shockwaveEffect.spawnShockwave(pos, 0.08, 1.2, 0.8, 0.1);
    shockwaveEffect.triggerWhiteFlash(0.5);
    shockwaveEffect.triggerChromatic(0.015);

    // Kill all enemies on screen (bombs award no points)
    const enemies = enemySpawner.getEnemies();
    for (const enemy of enemies) {
      if (enemy.active) {
        const enemyType = enemy.constructor.name.toLowerCase();
        const color = ENEMY_COLORS[enemyType] ?? ENEMY_COLOR_FALLBACK;
        particles.enemyDeath(enemy.position, color);
        killLog.addKill(enemyType, color.getHex());
        playerLevel.addKill();

        // Award multiplier directly on kill (geoms removed)
        for (let g = 0; g < enemy.geomCount; g++) {
          scoreManager.collectGeom();
        }

        enemy.die();
      }
    }
  };

  // -- Player death callback --
  player.onDeath = (position: THREE.Vector3) => {
    particles.playerDeath(position);
    screenShake.shake(0.5, 0.4);
    scoreManager.onPlayerDeath();
    ddaTracker.recordDeath(); // DDA: track death event
    ddaLogger.recordDeath(0); // DDA logger: log death event
  };

  // -- Start background music --
  const audioCtx = sound.getAudioContext();
  if (audioCtx) {
    bgMusic.start(audioCtx);
  }

  // -- Expose debug API for programmatic tests and console access --
  // Full programmatic API when ?debug=true, otherwise minimal API for compatibility
  const urlParams = new URLSearchParams(window.location.search);
  const debugMode = urlParams.get('debug') === 'true';

  if (debugMode) {
    // Import and initialize GameDebugAPI for full programmatic access
    import('./debug/GameDebugAPI').then(({ GameDebugAPI }) => {
      const debugAPI = new GameDebugAPI(
        game,
        player,
        enemySpawner,
        game.scene,
        game.camera,
        gameLoop,
        input as InputManager,
        playerWalker,
        surface,
      );
      (window as any).__gameDebug = debugAPI;
      console.log('[GameDebugAPI] Initialized. Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(debugAPI)).filter(n => n !== 'constructor'));
    });
  } else {
    // Minimal debug API for existing tests/scripts (no overhead)
    (window as any).__gameDebug = {
      entityAudit,
      perfTracker,
      enemySpawner,
      enemyInstanceManager,
      bulletPool,
      player,
      game,
      ctx,
      ddaLogger,
      perfLogger,
    };
  }

  // -- Game state exporter: live window._gameState + window._rendererState --
  // Activated when ?testMode=true. Zero overhead when not active.
  const testMode = urlParams.get('testMode') === 'true';
  if (testMode) {
    import('./debug/GameStateExporter').then(({ GameStateExporter }) => {
      _stateExporter = new GameStateExporter(ctx);
      console.log('[GameStateExporter] Active. window._gameState and window._rendererState are live.');
    });
  }

  // -- Test harness API: full game control for automated scenarios --
  // Activated when ?testMode=true. Exposes window.__TEST_API.
  if (testMode) {
    import('./debug/TestHarnessAPI').then(({ TestHarnessAPI }) => {
      const api = new TestHarnessAPI(ctx);
      _testHarnessAPI = api;
      (window as any).__TEST_API = api;
      console.log('[TestHarnessAPI] Active. window.__TEST_API is live.');
    });
  }

  // -- Deep telemetry exporter: live window.__GAME_TELEMETRY --
  // Activated when ?debug=true OR ?testMode=true (visual test harness). Zero overhead otherwise.
  if (debugMode || testMode) {
    import('./debug/GameTelemetryExporter').then(({ GameTelemetryExporter }) => {
      _telemetryExporter = new GameTelemetryExporter(ctx);
      console.log('[GameTelemetryExporter] Active. window.__GAME_TELEMETRY is live.');
    });
  }

  // -- Expose performance log API for data export (never deleted) --
  (window as any).__perfLog = {
    /** Get live data points from current session ring buffer. */
    getLiveData: () => perfLogger.getDataPoints(),
    /** Get all stored sessions from localStorage. */
    getSessions: () => perfLogger.loadAllSessions(),
    /** Get current session summary. */
    getSummary: () => perfLogger.getSessionSummary(),
    /** Get frame spike events from current session. */
    getSpikes: () => perfLogger.getSpikeEvents(),
    /** Export all sessions as JSON string. */
    exportJSON: () => PerformanceLogger.exportAllAsJSON(),
    /** Export all sessions as CSV string. */
    exportCSV: () => PerformanceLogger.exportAllAsCSV(),
    /** Download all sessions as a JSON file. */
    downloadJSON: () => {
      const data = PerformanceLogger.exportAllAsJSON();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gw-perf-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
    /** Download all sessions as a CSV file. */
    downloadCSV: () => {
      const data = PerformanceLogger.exportAllAsCSV();
      const blob = new Blob([data], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gw-perf-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    /** Get total number of stored sessions. */
    sessionCount: () => perfLogger.loadAllSessions().length,
    /** Get game counter (number of games played). */
    gameCounter: () => perfLogger.getGameCounter(),
  };

  // -- Dev console: instant mastery level setter for testing Level 5 final forms --
  // Usage: window.__setMasteryLevel('standard', 5)  or  window.__setMasteryLevel('spread', 5)
  // Weapon name strings: 'standard', 'spread', 'piercing', 'chain_lightning', 'homing',
  //                      'plasma_mortar', 'gravity_gun', 'laser_beam', 'black_hole', 'tesla_coil'
  if ((import.meta as any).env?.DEV === true) {
    (window as any).__setMasteryLevel = (weaponName: string, level: number) => {
      const type = weaponName as WeaponType;
      if (!Object.values(WeaponType).includes(type)) {
        console.warn(`[Mastery] Unknown weapon: "${weaponName}". Valid names: ${Object.values(WeaponType).join(', ')}`);
        return;
      }
      const clampedLevel = Math.max(0, Math.min(5, Math.round(level)));
      const xp = XP_THRESHOLDS[clampedLevel];
      masteryStore.devSetXP(type, xp);
      console.log(`[Mastery] ${weaponName} set to level ${clampedLevel} (${xp} XP). Reload or re-enter game to apply.`);
    };
    console.log('[Mastery] Dev tool loaded. Use: window.__setMasteryLevel("standard", 5)');
  }

  // -- Quick Game Mode (KotH, Sniper, Rainbow, etc.) --
  // Create and start the IGameMode. onStart() adds visual elements to the scene.
  // pvp/pvpve are MP-only modes — SP falls back to waves
  const spModeType = (quickGameModeType === 'pvp' || quickGameModeType === 'pvpve') ? undefined : quickGameModeType;
  const quickGameMode = (spModeType && spModeType !== 'waves')
    ? createGameMode(spModeType)
    : undefined;
  if (quickGameMode) {
    const gameModeContext = {
      player,
      enemySpawner,
      surface,
      weaponManager,
      buffManager,
      game,
      scene: game.scene,
      camera: game.camera,
    };
    quickGameMode.onStart(gameModeContext);
    ctx.quickGameMode = quickGameMode;
  }

  // -- Start --
  // Dismiss loading overlay — scene is fully initialized, first frame is about to render
  hideGameLoading();
  game.start();
  profilingPersistence.start();
}

// ---------------------------------------------------------------------------
// Start menu flow
// ---------------------------------------------------------------------------

// Check for direct URL mode params (skip menu)
function isBenchmarkMode(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'benchmark';
}

function isQuickStartMode(): { enabled: boolean; surface?: SurfaceType; seed?: number; gameMode?: LanGameMode } {
  const params = new URLSearchParams(window.location.search);
  const quickStart = params.get('quickStart') === 'true';
  if (!quickStart) return { enabled: false };

  const surface = params.get('surface') as SurfaceType || 'sphere';
  const seedParam = params.get('seed');
  const seed = seedParam ? parseInt(seedParam, 10) : undefined;
  const gameMode = (params.get('gameMode') ?? undefined) as LanGameMode | undefined;

  return { enabled: true, surface, seed, gameMode };
}

(async () => {
  await initI18n();

const quickStartConfig = isQuickStartMode();

if (quickStartConfig.enabled) {
  // Quick start mode: skip menu, start game immediately with seed
  console.log(`[Main] Quick start mode: ${quickStartConfig.surface}, mode=${quickStartConfig.gameMode ?? 'waves'}, seed=${quickStartConfig.seed ?? 'random'}`);
  if (quickStartConfig.seed !== undefined) {
    import('./core/SeededRandom').then(({ setGameSeed }) => {
      setGameSeed(quickStartConfig.seed!);
      main(quickStartConfig.surface, -1, undefined, undefined, quickStartConfig.gameMode); // -1 = endless mode
    });
  } else {
    main(quickStartConfig.surface, -1, undefined, undefined, quickStartConfig.gameMode);
  }
} else if (isBenchmarkMode()) {
  import('./benchmark').then(({ runBenchmark }) => {
    console.log('[Main] Running performance benchmark');
    runBenchmark();
  });
} else if (isNetworkMode()) {
  import('./network-main').then(() => {
    console.log('[Main] Loaded network multiplayer mode');
  });
} else {
  // Show start menu
  const startMenu = new StartMenu();

  startMenu.onStart((selection: MenuSelection) => {
    console.log(`[Main] Starting game: ${selection.gameMode} on ${selection.surfaceType}`);
    startMenu.dispose();

    // Preserve debug/test URL params through mode transitions
    const prevParams = new URLSearchParams(window.location.search);
    const preserveKeys = ['debug', 'testMode'];
    function buildUrl(params: Record<string, string>): string {
      const p = new URLSearchParams(params);
      for (const key of preserveKeys) {
        if (prevParams.has(key)) p.set(key, prevParams.get(key)!);
      }
      return `?${p.toString()}`;
    }

    // Handle game mode selection
    if (selection.gameMode === 'network') {
      // Online/LAN multiplayer - update URL and load network module
      // creator=1 signals that this player hosted the server and should claim host status.
      // Only set for the player who explicitly clicked HOST GAME → ENTER GAME.
      // LAN lobby joiners (laptops, phones joining via StartMenu), QR code scanners,
      // and direct URL users do NOT get creator=1 — they join as non-host.
      const params: Record<string, string> = { mode: 'network', surface: selection.surfaceType };
      if (selection.isCreator) params.creator = '1';
      if (selection.serverUrl) params.server = selection.serverUrl;
      if (selection.playerName) params.name = selection.playerName;
      if (selection.mapSize) params.mapSize = selection.mapSize;
      if (selection.quickGameMode && selection.quickGameMode !== 'waves') params.gameMode = selection.quickGameMode;
      if (selection.maxPlayers && selection.maxPlayers !== 10) params.maxPlayers = String(selection.maxPlayers);
      window.history.replaceState({}, '', buildUrl(params));
      import('./network-main').then(() => {
        console.log('[Main] Loaded network multiplayer mode');
      });
    } else {
      // Single player - Quick Game (endless) or Adventure level
      const levelIdx = selection.levelIndex ?? -1; // -1 = endless Quick Game
      window.history.replaceState({}, '', buildUrl({ surface: selection.surfaceType, level: String(levelIdx) }));
      main(selection.surfaceType, levelIdx, selection.customMeshFile, selection.mapSize, selection.quickGameMode);
    }
  });
}
})();
