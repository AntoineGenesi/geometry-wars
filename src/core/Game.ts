/**
 * Game — Core Three.js engine layer (renderer, scene, camera, bloom, entity management).
 *
 * Manages the WebGPU/WebGL2 renderer, EffectComposer post-processing, EntityManager,
 * and game clock. Does NOT contain movement, input, or game-mode logic — that lives
 * in GameInstance (demos/tests) or GameLoop (main.ts). Called by both GameInstance
 * and directly from main.ts via GameContext.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

import { GameClock } from './GameClock';
import { EntityManager } from './EntityManager';
import { CollisionGroup } from './Entity';
import { GPUCapabilityReport, detectGPUCapabilities } from '../rendering/GPUCapabilities';
import { createRenderer, RendererBackend, installWebGPUDiagnostic } from '../rendering/RendererFactory';
import { EntityLimits, getEntityLimits } from '../rendering/EntityLimits';
import { BloomEffectManager } from '../effects/BloomEffectManager';

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
  /** Pre-built renderer (used by Game.create() factory). When provided,
   *  the constructor skips creating its own WebGLRenderer. */
  _renderer?: THREE.WebGLRenderer;
  /** Pre-detected GPU capabilities (used by Game.create() factory). */
  _capabilities?: GPUCapabilityReport;
  /** Whether the renderer is WebGPU (used by Game.create() factory). */
  _isWebGPU?: boolean;
  /** Active rendering backend name (used by Game.create() factory). */
  _backend?: RendererBackend;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_FOV = 60;
/**
 * Compute vertical FOV that maintains a consistent horizontal perspective.
 *
 * Three.js PerspectiveCamera uses vertical FOV. On ultra-wide screens (e.g.
 * iPhone 13 landscape at 2.16:1), a fixed 60° vertical FOV produces ~102°
 * horizontal FOV, creating cylindrical/stretched distortion on curved surfaces.
 *
 * Fix: lock horizontal FOV to the value it would have at 16:9 (the design
 * baseline) and back-compute the vertical FOV for wider aspect ratios.
 * Narrower-than-16:9 screens are unaffected (normal hor+ behaviour).
 *
 * @param aspect  Viewport aspect ratio (width / height)
 * @param baseFov Base vertical FOV in degrees, designed for 16:9 (default 60)
 */
function computeVerticalFOV(aspect: number, baseFov: number = DEFAULT_FOV): number {
  const BASE_ASPECT = 16 / 9; // ~1.778 — the design reference aspect ratio
  if (aspect <= BASE_ASPECT) {
    return baseFov; // portrait / 4:3 / 16:9 — keep vertical FOV unchanged
  }
  // Lock horizontal FOV to what baseFov produces at 16:9, then solve for vFOV
  const hFovRad = 2 * Math.atan(Math.tan((baseFov * Math.PI / 180) / 2) * BASE_ASPECT);
  return (2 * Math.atan(Math.tan(hFovRad / 2) / aspect)) * (180 / Math.PI);
}

const DEFAULT_BLOOM: BloomConfig = {
  strength: 1.0,
  radius: 0.5,
  threshold: 0.3,
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

  // ---- Renderer backend info ------------------------------------------

  /** Whether the active renderer is WebGPU. */
  readonly isWebGPU: boolean;
  /** Active rendering backend name ('webgpu' or 'webgl2'). */
  readonly backend: RendererBackend;

  // ---- GPU capabilities -----------------------------------------------

  /** Detected GPU capabilities. Null when constructed synchronously
   *  without prior detection (use Game.create() for full detection). */
  capabilities: GPUCapabilityReport | null = null;

  /** Entity and quality limits derived from the GPU tier. Falls back
   *  to medium-tier defaults when capabilities are not detected. */
  entityLimits: EntityLimits;

  // ---- Post-processing ------------------------------------------------

  /** EffectComposer for WebGL2 post-processing (null when using WebGPU). */
  readonly composer: EffectComposer | null;
  /** UnrealBloomPass for WebGL2 bloom (null when using WebGPU). */
  readonly bloomPass: UnrealBloomPass | null;
  /** WebGPU PostProcessing instance (null when using WebGL2). */
  private webgpuPostProcessing: { render: () => void } | null = null;
  /** WebGPU TSL uniform nodes for dynamic bloom control (null when using WebGL2). */
  private webgpuBloomStrengthUniform: any = null;
  private webgpuBloomThresholdUniform: any = null;

  // ---- Game systems ---------------------------------------------------

  readonly clock: GameClock;
  readonly entityManager: EntityManager;
  readonly bloomEffectManager: BloomEffectManager;

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

  // ---- Adaptive quality -----------------------------------------------

  /**
   * Current bloom render-target scale (1.0 = full-res, 0.5 = half-res, etc.).
   * Updated by the adaptive quality system via onQualityChange.
   * Persisted here so window resize can re-apply the correct scale.
   */
  bloomResolutionScale: number = 0.5;

  /**
   * Original pixel ratio captured at renderer creation (WebGPU path only).
   * Used by setVisualMode to restore full-res mode after pixelated mode.
   */
  private _basePixelRatio: number = 1;

  /** Base (design-reference) vertical FOV in degrees, used to recompute the
   *  actual vertical FOV on resize via computeVerticalFOV(). */
  private readonly baseFov: number;

  // ---- Loop bookkeeping -----------------------------------------------

  private rafId: number = 0;
  private running: boolean = false;

  // ---- Constructor ----------------------------------------------------

  /**
   * Async factory that detects GPU capabilities before constructing.
   * Prefer this over `new Game()` when you want capability-aware rendering.
   *
   * Usage:
   *   const game = await Game.create({ bloom: { strength: 0.7 } });
   */
  static async create(config: GameConfig = {}): Promise<Game> {
    const container = config.container ?? document.body;
    // Install console diagnostic before detection so it's available immediately
    installWebGPUDiagnostic();
    const capabilities = await detectGPUCapabilities();
    const { renderer, isWebGPU, backend } = await createRenderer(container, capabilities);
    return new Game({
      ...config,
      _renderer: renderer,
      _capabilities: capabilities,
      _isWebGPU: isWebGPU,
      _backend: backend,
    });
  }

  constructor(config: GameConfig = {}) {
    const container = config.container ?? document.body;

    // -- Renderer backend info --
    this.isWebGPU = config._isWebGPU ?? false;
    this.backend = config._backend ?? 'webgl2';

    // -- GPU capabilities (set if provided by Game.create()) --
    if (config._capabilities) {
      this.capabilities = config._capabilities;
      this.entityLimits = getEntityLimits(config._capabilities.tier);
    } else {
      this.entityLimits = getEntityLimits('medium');
    }

    // -- Scene --
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);

    // -- Camera --
    this.baseFov = config.fov ?? DEFAULT_FOV;
    const aspect = window.innerWidth / window.innerHeight;
    const fov = computeVerticalFOV(aspect, this.baseFov);
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000);
    this.camera.position.set(0, 15, 25);
    this.camera.lookAt(0, 0, 0);

    this.cameraDistance = config.cameraDistance ?? DEFAULT_CAMERA_DISTANCE;
    this.cameraSmoothing = config.cameraSmoothing ?? DEFAULT_CAMERA_SMOOTHING;
    this.smoothedCameraPos.copy(this.camera.position);

    // -- Renderer --
    // When a pre-built renderer is provided (via Game.create()), use it directly.
    // Otherwise, create a standard WebGLRenderer (backward-compatible path).
    if (config._renderer) {
      this.renderer = config._renderer;
    } else {
      // When ?testMode=true is in the URL, enable preserveDrawingBuffer
      // so automated tests can read canvas pixels via getImageData/toDataURL.
      const isTestMode = typeof window !== 'undefined' &&
        new URLSearchParams(window.location.search).get('testMode') === 'true';

      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        ...(isTestMode ? { preserveDrawingBuffer: true } : {}),
      });
      // Mobile devices (high-DPI or UA detection) cap at 1.5 to save ~44% GPU fill.
      // Desktop devices (devicePixelRatio <= 2) are uncapped — no change.
      const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        typeof navigator !== 'undefined' ? navigator.userAgent : '',
      ) || window.devicePixelRatio > 2;
      const maxPixelRatio = isMobileDevice ? 1.5 : 2.0;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      container.appendChild(this.renderer.domElement);
    }

    // Store base pixel ratio for WebGPU visual mode toggling (pixelated = half-res).
    this._basePixelRatio = this.renderer.getPixelRatio();

    // -- Post-processing --
    if (this.isWebGPU) {
      // WebGPU path: EffectComposer is WebGL-specific and cannot work with
      // WebGPURenderer. Use direct renderer.render() for now.
      // TSL-based PostProcessing with bloom can be added in a future iteration.
      this.composer = null;
      this.bloomPass = null;
      this.initWebGPUPostProcessing(config.bloom);
    } else {
      // WebGL2 path: standard EffectComposer + UnrealBloomPass
      const bloomCfg: BloomConfig = { ...DEFAULT_BLOOM, ...config.bloom };

      this.composer = new EffectComposer(this.renderer);
      // Run bloom at 50% resolution: halves pixel fill cost by 4x (half W × half H).
      // Bloom is a blurry glow effect — upscaling from 50% is visually imperceptible.
      const halfW = Math.floor(window.innerWidth / 2);
      const halfH = Math.floor(window.innerHeight / 2);
      this.composer.setSize(halfW, halfH);
      this.composer.addPass(new RenderPass(this.scene, this.camera));

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(halfW, halfH),
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
    }

    // -- Systems --
    this.clock = new GameClock(this);
    this.entityManager = new EntityManager();

    // Initialize bloom effect manager with default settings
    const bloomCfg: BloomConfig = { ...DEFAULT_BLOOM, ...config.bloom };
    this.bloomEffectManager = new BloomEffectManager(this, bloomCfg.strength, bloomCfg.threshold);

    // -- Default collision rules --
    this.setupDefaultCollisionRules();

    // -- Window events --
    window.addEventListener('resize', this.onResize);
    window.addEventListener('visibilitychange', this.onVisibilityChange);

    // -- WebGL context loss (iOS Safari loses context when backgrounding) --
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  /**
   * Initialize WebGPU post-processing using TSL node-based PostProcessing.
   *
   * Three.js 0.170's WebGPU module uses a node-graph approach instead of
   * EffectComposer. We dynamically import three/webgpu and build a
   * pass(scene, camera) -> bloom-approximation pipeline.
   *
   * Since Three.js 0.170 does NOT have a built-in bloom() TSL function,
   * we use mip-based blur on the bright pass as an approximation.
   * The visual result is similar but not identical to UnrealBloomPass.
   */
  private initWebGPUPostProcessing(_bloomConfig?: Partial<BloomConfig>): void {
    // Async initialization -- we set up PostProcessing after dynamic import.
    // The TSL (Three Shading Language) types are not fully typed for chained
    // node operations, so we use 'any' casts for the node graph construction.
    import('three/webgpu').then((webgpuModule: any) => {
      try {
        const { PostProcessing, pass, float, max, add, screenUV, uniform } = webgpuModule;

        // Create the scene render pass
        const scenePass = pass(this.scene, this.camera);
        const sceneTexture = scenePass.getTextureNode();

        // Bloom approximation using mip-based blur:
        // 1. Extract bright areas (threshold)
        // 2. Apply mip-level blur to bright areas
        // 3. Composite with original
        const strength = _bloomConfig?.strength ?? DEFAULT_BLOOM.strength;
        const threshold = _bloomConfig?.threshold ?? DEFAULT_BLOOM.threshold;

        // Use TSL uniform nodes so we can update bloom settings dynamically
        const bloomStrength = uniform(strength);
        const bloomThreshold = uniform(threshold);

        // Store references for dynamic updates
        this.webgpuBloomStrengthUniform = bloomStrength;
        this.webgpuBloomThresholdUniform = bloomThreshold;

        // Extract bright pixels above threshold
        const brightness = max(
          sceneTexture.r,
          max(sceneTexture.g, sceneTexture.b),
        );
        const brightMask = max(brightness.sub(bloomThreshold), float(0.0));
        const brightColor = sceneTexture.mul(brightMask);

        // Mip-based blur gives a soft glow effect
        // .blur() is a TSL TextureNode method that uses mip levels for blur
        const blurredBright = (brightColor as any).blur(float(0.3));

        // Composite: original + bloom
        const finalColor = add(sceneTexture, blurredBright.mul(bloomStrength));

        // Vignette effect
        const uv = screenUV.sub(float(0.5));
        const vignette = float(1.0).sub(uv.dot(uv).mul(float(0.8)));
        const vignetted = finalColor.mul(vignette);

        const postProcessing = new PostProcessing(this.renderer as any, vignetted);
        this.webgpuPostProcessing = postProcessing;
      } catch (err) {
        console.warn('[Game] WebGPU PostProcessing setup failed, using direct render:', err);
        // Fallback: direct render without post-processing
        this.webgpuPostProcessing = null;
      }
    }).catch((err: unknown) => {
      console.warn('[Game] Failed to load three/webgpu for PostProcessing:', err);
    });
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
      // Kick-start the rAF loop if it was stopped (e.g., WebGL context loss/restore)
      if (this.running && !this.rafId) {
        this.rafId = requestAnimationFrame(this.loop);
      }
    }
  }

  /**
   * Ensure the animation loop is running.
   * Call when the tab becomes visible after backgrounding on mobile — iOS may
   * throttle or suspend requestAnimationFrame while the tab is hidden.
   */
  kickStart(): void {
    if (this.running && !this.rafId) {
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  /** Transition to game-over state. */
  setGameOver(): void {
    this._state = GameState.GameOver;
  }

  /**
   * Switch between Pixelated (half-res bloom) and Modern (full-res bloom).
   * Immediately resizes the EffectComposer and bloom pass render targets.
   */
  setVisualMode(mode: 'pixelated' | 'modern'): void {
    // s44r17-05 experiment: 0.40 (was 0.50) — chunkier pixel "bundles".
    // Revert: change 0.40 back to 0.50 if user prefers original.
    this.bloomResolutionScale = mode === 'modern' ? 1.0 : 0.40;

    if (this.isWebGPU) {
      // WebGPU path: simulate pixelated mode by reducing the pixel ratio so the
      // canvas renders at low resolution. The browser upscales this buffer to fill
      // the screen, producing the chunky/pixelated look.
      // Modern mode restores the original pixel ratio for full-res rendering.
      // s44r17-05 experiment: 0.30 (was 0.375) — larger pixel "bundles" per user request.
      // Revert: change 0.30 back to 0.375 if user prefers original.
      const targetRatio = mode === 'pixelated' ? 0.30 : this._basePixelRatio;
      this.renderer.setPixelRatio(targetRatio);
      // Reapply canvas buffer size with the new ratio; keep CSS dimensions unchanged
      // so the canvas still fills the screen (upscaled = pixelated, or 1:1 = modern).
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
      // Nearest-neighbor CSS scaling: prevents browser bilinear blur when upscaling
      // the low-res canvas to fill the screen. Without this, the browser smooths the
      // pixels, defeating the pixelated look entirely.
      this.renderer.domElement.style.imageRendering = mode === 'pixelated' ? 'pixelated' : '';
    } else if (this.composer || this.bloomPass) {
      // WebGL2 path: resize the EffectComposer and bloom pass render targets.
      // 40%-res (was 50%) = chunkier pixels upscaled with NearestFilter (pixelated).
      // Full-res bloom renders sharply at 100% (modern).
      const w = window.innerWidth;
      const h = window.innerHeight;
      const scale = this.bloomResolutionScale;
      const sw = Math.floor(w * scale);
      const sh = Math.floor(h * scale);
      if (this.composer) {
        this.composer.setSize(sw, sh);
        // NearestFilter = sharp pixel edges when EffectComposer upscales the 50%-res
        // render target to fill the screen. LinearFilter (default) blurs pixel boundaries.
        // Both read/write buffers need updating — EffectComposer swaps them between passes.
        const filter = mode === 'pixelated' ? THREE.NearestFilter : THREE.LinearFilter;
        this.composer.readBuffer.texture.magFilter = filter;
        this.composer.readBuffer.texture.needsUpdate = true;
        this.composer.writeBuffer.texture.magFilter = filter;
        this.composer.writeBuffer.texture.needsUpdate = true;
      }
      if (this.bloomPass) this.bloomPass.resolution.set(sw, sh);
    }
  }

  /**
   * Update bloom settings dynamically.
   * Works for both WebGL2 (via bloomPass) and WebGPU (via TSL uniforms).
   */
  setBloomSettings(strength: number, threshold: number): void {
    // WebGL2 path: update UnrealBloomPass directly
    if (this.bloomPass) {
      this.bloomPass.strength = strength;
      this.bloomPass.threshold = threshold;
    }

    // WebGPU path: update TSL uniform nodes
    if (this.webgpuBloomStrengthUniform && this.webgpuBloomThresholdUniform) {
      this.webgpuBloomStrengthUniform.value = strength;
      this.webgpuBloomThresholdUniform.value = threshold;
    }
  }

  /**
   * The main requestAnimationFrame callback.
   * Delegates timing to GameClock which calls back into `fixedUpdate`.
   */
  private loop = (timestamp: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.loop);

    // Advance physics (GameClock calls fixedUpdate N times).
    // Wrapped in try/catch so exceptions never block rendering — the game
    // must always render even if a physics step fails, otherwise the user
    // sees a permanent freeze (RAF continues but render is never reached).
    if (this._state === GameState.Playing) {
      try {
        this.clock.tick(timestamp);
      } catch (err) {
        console.error('[Game] Error in fixedUpdate:', err);
      }
    }

    // Pre-render callback (surface projection, etc.).
    this.onRender?.(this.clock.alpha);

    // Render with interpolation.
    this.updateCamera(this.clock.alpha);
    if (this.renderOverride) {
      this.renderOverride();
    } else if (this.webgpuPostProcessing) {
      this.webgpuPostProcessing.render();
    } else if (this.composer) {
      this.composer.render();
    } else {
      // Direct render fallback (WebGPU without PostProcessing)
      (this.renderer as any).render(this.scene, this.camera);
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
    this.bloomEffectManager.update(dt);
  }

  // ---- Camera ---------------------------------------------------------

  /**
   * Recalculate and update the camera's aspect ratio and projection matrix
   * based on current window dimensions. Call this after the Game is created
   * to ensure the camera matches the actual viewport, especially on mobile
   * where window dimensions may not be stable at construction time.
   */
  ensureCameraAspectRatio(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / height;

    (this.camera as THREE.PerspectiveCamera).aspect = aspect;
    (this.camera as THREE.PerspectiveCamera).fov = computeVerticalFOV(aspect, this.baseFov);
    (this.camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  }

  /**
   * Camera update. Skipped when disableBuiltInCameraUpdate is true,
   * allowing external code to control camera position.
   */
  private updateCamera(_alpha: number): void {
    // Skip built-in camera update if disabled (external code controls camera)
    if (this.disableBuiltInCameraUpdate) return;
  }

  // ---- Event handlers -------------------------------------------------

  /** When true, the built-in window resize handler is skipped.
   *  Playground embeds manage their own canvas size via GameInstance.resize(). */
  disableBuiltInResize: boolean = false;

  private onResize = (): void => {
    if (this.disableBuiltInResize) return;

    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.fov = computeVerticalFOV(this.camera.aspect, this.baseFov);
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    if (this.composer) {
      // Use the current bloom resolution scale (set by adaptive quality system).
      // Defaults to 0.5 (half-res). Lower quality levels reduce this further.
      const scale = this.bloomResolutionScale;
      this.composer.setSize(Math.floor(width * scale), Math.floor(height * scale));
    }
    if (this.bloomPass) {
      const scale = this.bloomResolutionScale;
      this.bloomPass.resolution.set(Math.floor(width * scale), Math.floor(height * scale));
    }
  };

  private onVisibilityChange = (): void => {
    if (document.hidden && this._state === GameState.Playing) {
      this.pause();
    } else if (!document.hidden) {
      // Tab became visible — restart the rAF loop if it was killed by the browser
      this.kickStart();
    }
  };

  /**
   * WebGL context was lost (iOS Safari does this when backgrounding).
   * Stop the rAF loop to avoid spinning with no output.
   */
  private onContextLost = (event: Event): void => {
    event.preventDefault(); // allow context restoration
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  };

  /**
   * WebGL context was restored after being lost.
   * Restart the rAF loop — Three.js automatically re-uploads GPU resources.
   */
  private onContextRestored = (): void => {
    if (this.running) {
      this.rafId = requestAnimationFrame(this.loop);
    }
  };

  // ---- Cleanup --------------------------------------------------------

  /** Tear down the game, releasing all GPU and DOM resources. */
  dispose(): void {
    this.stop();

    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);

    this.entityManager.clear();
    if (this.composer) {
      this.composer.dispose();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
