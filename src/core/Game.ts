import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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
  strength: 0.7,
  radius: 0.4,
  threshold: 0.6,
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

  readonly composer: EffectComposer;
  readonly bloomPass: UnrealBloomPass;

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

  // ---- Loop bookkeeping -----------------------------------------------

  private rafId: number = 0;
  private running: boolean = false;

  // ---- Constructor ----------------------------------------------------

  constructor(config: GameConfig = {}) {
    const container = config.container ?? document.body;

    // -- Scene --
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);

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

    // Vignette pass - subtle screen-edge darkening (GW3D authentic)
    const vignettePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        offset: { value: 1.0 },
        darkness: { value: 0.8 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float offset;
        uniform float darkness;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(tDiffuse, vUv);
          vec2 uv = (vUv - vec2(0.5)) * vec2(offset);
          float vignette = 1.0 - dot(uv, uv);
          texel.rgb *= mix(1.0 - darkness, 1.0, vignette);
          gl_FragColor = texel;
        }
      `,
    });
    this.composer.addPass(vignettePass);

    this.composer.addPass(new OutputPass());

    // -- Systems --
    this.clock = new GameClock(this);
    this.entityManager = new EntityManager();

    // -- Default collision rules --
    this.setupDefaultCollisionRules();

    // -- Window events --
    window.addEventListener('resize', this.onResize);
    window.addEventListener('visibilitychange', this.onVisibilityChange);
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
      this.clock.resync(); // avoid large dt spike without resetting totalTime
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
    if (this.renderOverride) {
      this.renderOverride();
    } else {
      this.composer.render();
    }
  };

  /** User-provided callback invoked each fixed timestep before entity update. */
  onFixedUpdate: ((dt: number) => void) | null = null;

  /** User-provided callback invoked each frame before rendering. */
  onRender: ((alpha: number) => void) | null = null;

  /** When set, replaces the default composer.render() call.
   *  Used by split-screen to render multiple viewports. */
  renderOverride: (() => void) | null = null;

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
   * Camera update. Skipped when disableBuiltInCameraUpdate is true,
   * allowing external code to control camera position.
   */
  private updateCamera(_alpha: number): void {
    // Skip built-in camera update if disabled (external code controls camera)
    if (this.disableBuiltInCameraUpdate) return;
  }

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

    this.entityManager.clear();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
