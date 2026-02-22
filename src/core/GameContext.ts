import * as THREE from 'three';
import type { Game } from './Game';
import type { Player } from '../entities/Player';
import type { BulletPool } from '../entities/Bullet';
import type { EnemySpawner, EnemyType } from '../entities/enemies/EnemySpawner';
import type { BaseEnemy } from '../entities/enemies/BaseEnemy';
import type { ParticleSystem } from '../effects/ParticleSystem';
import type { ScreenShake } from '../effects/ScreenShake';
import type { GlowTrail } from '../effects/GlowTrail';
import type { ScoreManager } from './ScoreManager';
import type { Surface } from '../surfaces/Surface';
import type { SurfaceType } from '../surfaces/SurfaceFactory';
import type { MeshWalker } from '../movement/MeshWalker';
import type { MeshSurface } from '../surfaces/MeshSurface';
import type { WeaponManager } from '../weapons/WeaponManager';
import type { SuperStateManager } from '../weapons/SuperState';
import type { InputManager } from '../input/InputManager';
import type { BuffManager } from '../buffs/BuffManager';
import type { CompanionManager } from '../entities/Companion';
import type { CollisionSystem } from './CollisionSystem';
import type { PickupSpawner } from './PickupSpawner';
import type { CameraController } from './CameraController';
import type { EnemyInstanceManager } from '../rendering/EnemyInstanceManager';
import type { BulletInstanceManager, BulletVisualType } from '../rendering/BulletInstanceManager';
import type { LODManager, LODLevel } from '../rendering/LODManager';
import type { AdaptiveQuality } from '../rendering/AdaptiveQuality';
import type { DepthOcclusionSystem } from '../rendering/DepthOpacity';
import type { PerformanceTracker } from './PerformanceTracker';
import type { DebugOverlay } from '../ui/DebugOverlay';
import type { ProfilingOverlay } from '../ui/ProfilingOverlay';
import type { SettingsMenu } from '../ui/SettingsMenu';
import type { GameMode } from './GameMode';
import type { LevelDefinition } from './LevelData';
import type { PlayerLevel } from './PlayerLevel';
import type { DDAPerformanceTracker } from '../difficulty/DDAPerformanceTracker';
import type { DDADecisionEngine } from '../difficulty/DDADecisionEngine';
import type { DDASpawnModifier } from '../difficulty/DDASpawnModifier';
import type { DDALogger } from '../difficulty/DDALogger';
import type { EntityAudit } from './EntityAudit';
import type { PerformanceLogger } from './PerformanceLogger';
import type { ProfilingPersistence } from './ProfilingPersistence';
import type { ShockwaveEffect } from '../effects/ShockwaveEffect';
import type { Minimap } from '../ui/Minimap';
import type { KillLog } from '../ui/KillLog';
import type { TotalKillCounter } from '../ui/TotalKillCounter';
import type { WeaponHUD } from '../ui/WeaponHUD';
import type { CompanionHUD } from '../entities/Companion';
import type { BuffHUD } from '../buffs/BuffHUD';
import type { ShockArcRenderer } from '../buffs/ShockArcRenderer';
import type { BuffAuraRenderer } from '../buffs/BuffAuraRenderer';
import type { ScorePopupManager } from '../effects/ScorePopup';
import type { GameOverScreen } from '../ui/GameOverScreen';
import type { LevelCompleteScreen } from '../ui/LevelCompleteScreen';
import type { PauseMenu } from '../ui/PauseMenu';

/**
 * GameContext bundles all the shared state needed by GameLoop and RenderLoop.
 * This replaces the closure-captured variables in main.ts's onFixedUpdate/onRender callbacks.
 */
export interface GameContext {
  // Core game engine
  game: Game;
  player: Player;
  surface: Surface;
  surfaceType: SurfaceType;
  meshSurface: MeshSurface;
  playerWalker: MeshWalker;
  input: InputManager;
  level: LevelDefinition;
  isEndless: boolean;

  // Entity pools
  bulletPool: BulletPool;
  enemySpawner: EnemySpawner;

  // GPU instanced rendering
  bulletInstanceManager: BulletInstanceManager;
  bulletInstanceIds: Set<string>;
  enemyInstanceManager: EnemyInstanceManager;

  // Effects
  particles: ParticleSystem;
  screenShake: ScreenShake;
  glowTrail: GlowTrail;
  shockwaveEffect: ShockwaveEffect;
  scorePopups: ScorePopupManager;

  // Score and progression
  scoreManager: ScoreManager;
  playerLevel: PlayerLevel;

  // Combat systems
  weaponManager: WeaponManager;
  superManager: SuperStateManager;
  buffManager: BuffManager;
  companionManager: CompanionManager;

  // Collision and pickups
  collisionSystem: CollisionSystem;
  pickupSpawner: PickupSpawner;

  // Camera
  cameraController: CameraController;

  // Performance and quality
  lodManager: LODManager;
  adaptiveQuality: AdaptiveQuality;
  depthOcclusion: DepthOcclusionSystem;
  perfTracker: PerformanceTracker;
  debugOverlay: DebugOverlay;
  profilingOverlay: ProfilingOverlay;
  profilingPersistence: ProfilingPersistence;
  perfLogger: PerformanceLogger;
  entityAudit: EntityAudit;

  // DDA (Dynamic Difficulty Adjustment)
  ddaTracker: DDAPerformanceTracker;
  ddaEngine: DDADecisionEngine;
  ddaSpawnModifier: DDASpawnModifier;
  ddaLogger: DDALogger;
  ddaPlayers: Array<{ index: number; u: number; v: number }>;

  // Game mode
  gameMode: GameMode;
  waveScheduler: any; // WaveScheduler class defined in main.ts

  // UI
  minimap: Minimap;
  killLog: KillLog;
  totalKillCounter: TotalKillCounter;
  weaponHUD: WeaponHUD;
  companionHUD: CompanionHUD;
  buffHUD: BuffHUD;
  shockArcRenderer: ShockArcRenderer;
  buffAuraRenderer: BuffAuraRenderer;
  pauseMenu: PauseMenu;
  gameOverScreen: GameOverScreen;
  levelCompleteScreen: LevelCompleteScreen;

  // Helpers
  getTransform: (u: number, v: number) => {
    position: THREE.Vector3;
    normal: THREE.Vector3;
    tangent: THREE.Vector3;
    bitangent: THREE.Vector3;
  };
  weaponToBulletVisual: (weapon: any) => BulletVisualType;
  PLAYER_MOVE_SPEED: number;
  ENEMY_COLORS: Record<string, THREE.Color>;
  ENEMY_COLOR_FALLBACK: THREE.Color;

  // Mutable state (read/written by loops)
  state: {
    isPaused: boolean;
    isGameOver: boolean;
    isLevelComplete: boolean;
    respawnTimer: number;
    RESPAWN_DELAY: number;
    prevPlayerU: number;
    prevPlayerV: number;
    painterDamageCooldown: number;
    lastEnemyCount: number;
    hadEnemies: boolean;
    lodAssignments: Map<BaseEnemy, LODLevel>;

    // Render loop state
    tunnelRaycaster: THREE.Raycaster;
    currentSurfaceOpacity: number;
    currentGridOpacity: number;
    baseSurfaceOpacity: number;
    baseGridOpacity: number;
    fadeSpeed: number;
    isCurrentlyBlocked: boolean;
    lastRenderTime: number;
    auditFrameCounter: number;

    // Performance telemetry state
    perfEnemyTypeMap: Map<EnemyType, number>;
    perfEnemyTypeCounter: number;
    perfBuffString: string;
    perfBuffStringCounter: number;
  };
}
