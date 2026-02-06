import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { GameClock } from './GameClock';
import { EntityManager } from './EntityManager';
import { CollisionGroup } from './Entity';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** High-level game states. */
export enum GameState {
  Playing = 'playing',
  Paused = 'paused',
  GameOver = 'gameOver',
}

/** Configuration for the bloom post-processing effect. */
export interface BloomConfig {
  strength: number;
  radius: number;
  threshold: number;
}

/** Configuration passed to the Game constructor. */
export interface GameConfig {
  /** DOM element to attach the renderer to (defaults to document.body). */
  container?: HTMLElement;
  /** Camera field of view in degrees. */
  fov?: number;
  /** Bloom effect parameters. */
  bloom?: Partial<BloomConfig>;
  /** Distance the camera keeps from the player. */
  cameraDistance?: number;
  /** How smoothly the camera follows the player (0 = instant, 1 = no follow). */
  cameraSmoothing?: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FOV = 60;
const DEFAULT_BLOOM: BloomConfig = {
  strength: 1.5,
  radius: 0.4,
  threshold: 0.1,
};
const DEFAULT_CAMERA_DISTANCE = 25;
const DEFAULT_CAMERA_SMOOTHING = 0.92;

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

/**
 * Top-level game orchestrator.
 *
 * Responsibilities:
 *  - Owns the Three.js Scene, Camera, Renderer, and post-processing stack.
 *  - Drives the fixed-timestep game loop via GameClock.
 *  - Manages high-level state transitions (playing / paused / game over).
 *  - Exposes the EntityManager for adding and querying entities.
 *  - Provides a camera that orbits the 3-D surface, tracking the player.
 */
export class Game {
  // ---- Three.js core --------------------------------------------------

  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  // ---- Post-processing ------------------------------------------------

  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;

  // ---- Game systems ---------------------------------------------------

  readonly clock: GameClock;
  readonly entityManager: EntityManager;

  // ---- State ----------------------------------------------------------

  private _state: GameState = GameState.Playing;

  /** Current game state (read-only from outside). */
  get state(): GameState {
    return this._state;
  }

  // ---- Camera tracking ------------------------------------------------

  /** The entity the camera should follow.  Set this to the player entity
   *  mesh after spawning it. */
  cameraTarget: THREE.Object3D | null = null;

  /** When true, the built-in camera update is skipped, allowing external
   *  code to control camera position (e.g., for surface-following cameras). */
  disableBuiltInCameraUpdate: boolean = false;

  private readonly cameraDistance: number;
  private readonly cameraSmoothing: number;

  /** Smoothed camera position (lerped each frame). */
  private readonly smoothedCameraPos: THREE.Vector3 = new THREE.Vector3();
  /** Smoothed camera up vector (prevents disorienting flips). */
  private readonly smoothedCameraUp: THREE.Vector3 = new THREE.Vector3(0, 1, 0);

  // ---- Camera orbit state ---------------------------------------------

  /** Camera orbit angles (spherical coordinates) */
  private cameraTheta: number = 0; // Horizontal angle (around Y axis)
  private cameraPhi: number = Math.PI / 4; // Vertical angle from top (45 degrees default)
  private readonly defaultCameraTheta: number = 0;
  private readonly defaultCameraPhi: number = Math.PI / 4;

  /** Middle mouse button state for camera orbit */
  private isMiddleMouseDown: boolean = false;
  private lastMiddleMouseX: number = 0;
  private lastMiddleMouseY: number = 0;
  private lastMiddleClickTime: number = 0;
  private readonly doubleClickThreshold: number = 300; // ms

  // ---- Loop bookkeeping -----------------------------------------------

  private rafId: number = 0;
  private running: boolean = false;

  // ---- Constructor ----------------------------------------------------

  constructor(config: GameConfig = {}) {
    const container = config.container ?? document.body;

    // -- Scene --
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // -- Camera --
    const fov = config.fov ?? DEFAULT_FOV;
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000);
    this.camera.position.set(0, 15, 25);
    this.camera.lookAt(0, 0, 0);

    this.cameraDistance = config.cameraDistance ?? DEFAULT_CAMERA_DISTANCE;
    this.cameraSmoothing = config.cameraSmoothing ?? DEFAULT_CAMERA_SMOOTHING;
    this.smoothedCameraPos.copy(this.camera.position);

    // -- Renderer --
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    // -- Post-processing --
    const bloomCfg: BloomConfig = { ...DEFAULT_BLOOM, ...config.bloom };

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      bloomCfg.strength,
      bloomCfg.radius,
      bloomCfg.threshold,
    );
    // Only add bloom if strength > 0
    if (bloomCfg.strength > 0) {
      this.composer.addPass(this.bloomPass);
    }
    this.composer.addPass(new OutputPass());

    // -- Systems --
    this.clock = new GameClock(this);
    this.entityManager = new EntityManager();

    // -- Default collision rules --
    this.setupDefaultCollisionRules();

    // -- Window events --
    window.addEventListener('resize', this.onResize);
    window.addEventListener('visibilitychange', this.onVisibilityChange);

    // -- Middle mouse camera orbit --
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
    this.renderer.domElement.addEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.addEventListener('mouseup', this.onMouseUp);
    this.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---- Collision rules ------------------------------------------------

  /**
   * Register the standard Geometry Wars collision pairs.
   * Additional rules can be added via `entityManager.addCollisionRule`.
   */
  private setupDefaultCollisionRules(): void {
    // Bullets destroy enemies.
    this.entityManager.addCollisionRule(
      CollisionGroup.Bullet,
      CollisionGroup.Enemy,
    );

    // Enemies kill the player.
    this.entityManager.addCollisionRule(
      CollisionGroup.Player,
      CollisionGroup.Enemy,
    );

    // Player picks up geoms (score multiplier gems).
    this.entityManager.addCollisionRule(
      CollisionGroup.Player,
      CollisionGroup.Geom,
    );
  }

  // ---- Game loop ------------------------------------------------------

  /** Start (or restart) the main loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this._state = GameState.Playing;
    this.clock.reset();
    this.loop(performance.now());
  }

  /** Stop the loop entirely. */
  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** Pause the game (physics stops, rendering continues). */
  pause(): void {
    this._state = GameState.Paused;
  }

  /** Resume from pause. */
  resume(): void {
    if (this._state === GameState.Paused) {
      this._state = GameState.Playing;
      this.clock.reset(); // avoid large dt spike
    }
  }

  /** Transition to game-over state. */
  setGameOver(): void {
    this._state = GameState.GameOver;
  }

  /**
   * The main requestAnimationFrame callback.
   * Delegates timing to GameClock which calls back into `fixedUpdate`.
   */
  private loop = (timestamp: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    // Advance physics (GameClock calls fixedUpdate N times).
    if (this._state === GameState.Playing) {
      this.clock.tick(timestamp);
    }

    // Pre-render callback (surface projection, etc.).
    this.onRender?.(this.clock.alpha);

    // Render with interpolation.
    this.updateCamera(this.clock.alpha);
    this.composer.render();
  };

  /** User-provided callback invoked each fixed timestep before entity update. */
  onFixedUpdate: ((dt: number) => void) | null = null;

  /** User-provided callback invoked each frame before rendering. */
  onRender: ((alpha: number) => void) | null = null;

  /**
   * Called by GameClock once per fixed timestep.
   * This is the single authority for physics / game-logic updates.
   */
  fixedUpdate(dt: number): void {
    this.onFixedUpdate?.(dt);
    this.entityManager.update(dt);
  }

  // ---- Camera ---------------------------------------------------------

  /**
   * Position camera using spherical coordinates.
   * Can be orbited around the scene using middle mouse button.
   * Skipped when disableBuiltInCameraUpdate is true.
   */
  private updateCamera(_alpha: number): void {
    // Skip built-in camera update if disabled (external code controls camera)
    if (this.disableBuiltInCameraUpdate) return;

    const dist = this.cameraDistance;

    // Convert spherical to Cartesian coordinates
    // phi is angle from vertical (0 = top, PI/2 = side)
    // theta is horizontal angle around Y axis
    const sinPhi = Math.sin(this.cameraPhi);
    const cosPhi = Math.cos(this.cameraPhi);
    const sinTheta = Math.sin(this.cameraTheta);
    const cosTheta = Math.cos(this.cameraTheta);

    this.camera.position.set(
      dist * sinPhi * sinTheta,  // X
      dist * cosPhi,              // Y (height)
      dist * sinPhi * cosTheta    // Z
    );

    // Always look at sphere center
    this.camera.lookAt(0, 0, 0);
    this.camera.up.set(0, 1, 0);
  }

  // ---- Mouse event handlers for camera orbit ----------------------------

  private onMouseDown = (e: MouseEvent): void => {
    // Middle mouse button (button 1)
    if (e.button === 1) {
      e.preventDefault();

      // Check for double-click
      const now = performance.now();
      if (now - this.lastMiddleClickTime < this.doubleClickThreshold) {
        // Double-click: reset camera to default
        this.cameraTheta = this.defaultCameraTheta;
        this.cameraPhi = this.defaultCameraPhi;
      }
      this.lastMiddleClickTime = now;

      this.isMiddleMouseDown = true;
      this.lastMiddleMouseX = e.clientX;
      this.lastMiddleMouseY = e.clientY;
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.isMiddleMouseDown) return;

    const deltaX = e.clientX - this.lastMiddleMouseX;
    const deltaY = e.clientY - this.lastMiddleMouseY;

    // Adjust camera angles based on mouse movement
    // Sensitivity: 0.005 radians per pixel
    const sensitivity = 0.005;
    this.cameraTheta -= deltaX * sensitivity;
    this.cameraPhi += deltaY * sensitivity;

    // Clamp phi to prevent flipping (keep between 0.1 and PI - 0.1)
    this.cameraPhi = Math.max(0.1, Math.min(Math.PI - 0.1, this.cameraPhi));

    this.lastMiddleMouseX = e.clientX;
    this.lastMiddleMouseY = e.clientY;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 1) {
      this.isMiddleMouseDown = false;
    }
  };

  // ---- Event handlers -------------------------------------------------

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(width, height);
  };

  private onVisibilityChange = (): void => {
    if (document.hidden && this._state === GameState.Playing) {
      this.pause();
    }
  };

  // ---- Cleanup --------------------------------------------------------

  /** Tear down the game, releasing all GPU and DOM resources. */
  dispose(): void {
    this.stop();

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('visibilitychange', this.onVisibilityChange);

    // Clean up mouse event listeners
    this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.removeEventListener('mouseup', this.onMouseUp);

    this.entityManager.clear();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  /** Reset camera to default position */
  resetCameraOrbit(): void {
    this.cameraTheta = this.defaultCameraTheta;
    this.cameraPhi = this.defaultCameraPhi;
  }
}
