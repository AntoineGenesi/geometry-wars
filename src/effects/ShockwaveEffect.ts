/**
 * ShockwaveEffect — Screen-space distortion post-processing
 *
 * Provides a ShaderPass for the EffectComposer that renders:
 *   1. Shockwave distortion rings (expanding ripples from explosions/deaths)
 *   2. Chromatic aberration (RGB channel separation on damage)
 *   3. Screen flash (brief full-screen color overlay on kills/events)
 *
 * All three effects are merged into a SINGLE ShaderPass (zero extra draw calls).
 * The manager class handles spawning, updating, and decaying active shockwaves.
 *
 * Performance: ~0.2ms total (1 full-screen pass, 3 texture samples for chromatic).
 * Zero per-frame heap allocations after construction.
 */

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum simultaneous shockwave rings. */
const MAX_SHOCKWAVES = 8;

/** Default shockwave expand speed (screen-space units per second). */
const DEFAULT_EXPAND_SPEED = 0.8;

/** Default shockwave lifetime in seconds. */
const DEFAULT_LIFETIME = 0.6;

/** Default distortion strength. */
const DEFAULT_STRENGTH = 0.04;

/** Default ring thickness (screen-space). */
const DEFAULT_RING_WIDTH = 0.06;

/** Screen flash decay speed (intensity units per second). */
const FLASH_DECAY_SPEED = 8.0;

/** Chromatic aberration decay speed. */
const CHROMATIC_DECAY_SPEED = 4.0;

// ---------------------------------------------------------------------------
// Shockwave data (pre-allocated, reused)
// ---------------------------------------------------------------------------

interface ShockwaveSlot {
  /** Screen-space position X (0-1). */
  x: number;
  /** Screen-space position Y (0-1). */
  y: number;
  /** Current radius (screen-space, 0-1+). */
  radius: number;
  /** Current strength (decays over lifetime). */
  strength: number;
  /** Expand speed (screen-space units/sec). */
  speed: number;
  /** Remaining lifetime. */
  life: number;
  /** Maximum lifetime (for strength decay calculation). */
  maxLife: number;
  /** Whether this slot is active. */
  active: boolean;
}

// ---------------------------------------------------------------------------
// Shader
// ---------------------------------------------------------------------------

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uTime;

  // Shockwave uniforms (packed arrays for efficiency)
  uniform vec3 uShockwaves[${MAX_SHOCKWAVES}];    // xy = screen pos, z = radius
  uniform float uShockStrengths[${MAX_SHOCKWAVES}];
  uniform float uShockWidths[${MAX_SHOCKWAVES}];
  uniform int uShockCount;

  // Chromatic aberration
  uniform float uChromaticStrength;  // 0 = off, 0.005 = subtle, 0.02 = heavy

  // Screen flash
  uniform vec3 uFlashColor;
  uniform float uFlashIntensity;     // 0 = off, 1 = full flash

  // Vignette (merged from existing vignette pass)
  uniform float uVignetteOffset;
  uniform float uVignetteDarkness;

  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    // --- Shockwave distortion ---
    for (int i = 0; i < ${MAX_SHOCKWAVES}; i++) {
      if (i >= uShockCount) break;

      vec2 center = uShockwaves[i].xy;
      float radius = uShockwaves[i].z;
      float strength = uShockStrengths[i];
      float ringWidth = uShockWidths[i];

      vec2 diff = uv - center;
      float dist = length(diff);

      // Ring-shaped distortion at current radius
      float ring = 1.0 - abs(dist - radius) / ringWidth;
      ring = clamp(ring, 0.0, 1.0);
      ring = ring * ring; // Smooth falloff

      // Displace UV outward from center
      if (dist > 0.001) {
        vec2 displacement = normalize(diff) * ring * strength;
        uv += displacement;
      }
    }

    // --- Chromatic aberration ---
    vec4 texel;
    if (uChromaticStrength > 0.0001) {
      vec2 dir = uv - vec2(0.5);
      float distFromCenter = length(dir);
      vec2 chromaticOffset = normalize(dir + vec2(0.0001)) * uChromaticStrength * distFromCenter;

      float r = texture2D(tDiffuse, uv + chromaticOffset).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - chromaticOffset).b;
      texel = vec4(r, g, b, 1.0);
    } else {
      texel = texture2D(tDiffuse, uv);
    }

    // --- Screen flash ---
    texel.rgb += uFlashColor * uFlashIntensity;

    // --- Vignette ---
    vec2 vuv = (vUv - vec2(0.5)) * vec2(uVignetteOffset);
    float vignette = 1.0 - dot(vuv, vuv);
    texel.rgb *= mix(1.0 - uVignetteDarkness, 1.0, vignette);

    gl_FragColor = texel;
  }
`;

// ---------------------------------------------------------------------------
// ShockwaveEffect class
// ---------------------------------------------------------------------------

export class ShockwaveEffect {
  /** The ShaderPass to insert into the EffectComposer chain.
   *  This REPLACES the old vignette pass (it includes vignette). */
  readonly shaderPass: ShaderPass;

  /** Pre-allocated shockwave slots. */
  private readonly slots: ShockwaveSlot[] = [];

  /** Number of currently active shockwaves. */
  private activeCount = 0;

  /** Current chromatic aberration strength (decays over time). */
  private chromaticStrength = 0;

  /** Target chromatic strength (set on trigger, then lerped). */
  private chromaticTarget = 0;

  /** Current screen flash intensity (decays over time). */
  private flashIntensity = 0;

  /** Pre-allocated flash color (mutated in place). */
  private readonly flashColor = new THREE.Color(1, 1, 1);

  /** Pre-allocated uniform arrays (avoid allocation on update). */
  private readonly shockwaveData: Float32Array;
  private readonly strengthData: Float32Array;
  private readonly widthData: Float32Array;

  /** Camera reference for world-to-screen projection. */
  private camera: THREE.PerspectiveCamera | null = null;

  /** Pre-allocated projection vector. */
  private readonly _projVec = new THREE.Vector3();

  constructor() {
    // Pre-allocate slots
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      this.slots.push({
        x: 0, y: 0, radius: 0, strength: 0,
        speed: DEFAULT_EXPAND_SPEED, life: 0, maxLife: DEFAULT_LIFETIME,
        active: false,
      });
    }

    // Pre-allocate typed arrays for uniforms
    this.shockwaveData = new Float32Array(MAX_SHOCKWAVES * 3);
    this.strengthData = new Float32Array(MAX_SHOCKWAVES);
    this.widthData = new Float32Array(MAX_SHOCKWAVES);

    // Build uniform vectors (Three.js expects Vector3 array for vec3[])
    const shockwaveVecs: THREE.Vector3[] = [];
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      shockwaveVecs.push(new THREE.Vector3(0, 0, 0));
    }

    const shaderDef = {
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uShockwaves: { value: shockwaveVecs },
        uShockStrengths: { value: new Float32Array(MAX_SHOCKWAVES) },
        uShockWidths: { value: new Float32Array(MAX_SHOCKWAVES) },
        uShockCount: { value: 0 },
        uChromaticStrength: { value: 0 },
        uFlashColor: { value: new THREE.Color(1, 1, 1) },
        uFlashIntensity: { value: 0 },
        uVignetteOffset: { value: 1.0 },
        uVignetteDarkness: { value: 0.8 },
      },
      vertexShader,
      fragmentShader,
    };

    this.shaderPass = new ShaderPass(shaderDef);
  }

  /**
   * Set the camera reference (needed for world-to-screen projection).
   * Call once after creating the Game.
   */
  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  // -----------------------------------------------------------------------
  // Trigger methods (called by game events)
  // -----------------------------------------------------------------------

  /**
   * Spawn a shockwave at a world position.
   * @param worldPos - 3D world position of the explosion/death
   * @param strength - Distortion strength (default 0.04)
   * @param speed - Expand speed in screen-space units/sec (default 0.8)
   * @param lifetime - Duration in seconds (default 0.6)
   * @param ringWidth - Thickness of the distortion ring (default 0.06)
   */
  spawnShockwave(
    worldPos: THREE.Vector3,
    strength: number = DEFAULT_STRENGTH,
    speed: number = DEFAULT_EXPAND_SPEED,
    lifetime: number = DEFAULT_LIFETIME,
    ringWidth: number = DEFAULT_RING_WIDTH,
  ): void {
    if (!this.camera) return;

    // Project world position to screen space (0-1)
    this._projVec.copy(worldPos);
    this._projVec.project(this.camera);

    // NDC (-1 to 1) -> UV (0 to 1)
    const screenX = (this._projVec.x + 1) * 0.5;
    const screenY = (this._projVec.y + 1) * 0.5;

    // Skip if behind camera
    if (this._projVec.z > 1) return;

    // Find an inactive slot
    let slot: ShockwaveSlot | null = null;
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      if (!this.slots[i].active) {
        slot = this.slots[i];
        break;
      }
    }

    // If all slots full, steal the oldest (lowest life remaining)
    if (!slot) {
      let minLife = Infinity;
      for (let i = 0; i < MAX_SHOCKWAVES; i++) {
        if (this.slots[i].life < minLife) {
          minLife = this.slots[i].life;
          slot = this.slots[i];
        }
      }
    }

    if (!slot) return;

    slot.x = screenX;
    slot.y = screenY;
    slot.radius = 0;
    slot.strength = strength;
    slot.speed = speed;
    slot.life = lifetime;
    slot.maxLife = lifetime;
    slot.active = true;
  }

  /**
   * Trigger chromatic aberration (e.g., on player damage).
   * @param strength - Peak aberration strength (0.005 = subtle, 0.02 = heavy)
   */
  triggerChromatic(strength: number = 0.012): void {
    this.chromaticTarget = Math.max(this.chromaticTarget, strength);
    this.chromaticStrength = Math.max(this.chromaticStrength, strength);
  }

  /**
   * Trigger a screen flash (e.g., on kill, bomb, super weapon).
   * @param color - Flash color
   * @param intensity - Flash intensity (0-1, default 0.3)
   */
  triggerFlash(color: THREE.Color, intensity: number = 0.3): void {
    this.flashColor.copy(color);
    this.flashIntensity = Math.max(this.flashIntensity, intensity);
  }

  /**
   * Convenience: white screen flash.
   */
  triggerWhiteFlash(intensity: number = 0.25): void {
    this.flashColor.setRGB(1, 1, 1);
    this.flashIntensity = Math.max(this.flashIntensity, intensity);
  }

  // -----------------------------------------------------------------------
  // Update (call once per frame)
  // -----------------------------------------------------------------------

  /**
   * Update all active effects. Call once per frame before rendering.
   * @param dt - Frame delta time in seconds
   * @param totalTime - Total elapsed time in seconds
   */
  update(dt: number, totalTime: number): void {
    const uniforms = this.shaderPass.uniforms;

    // --- Update shockwaves ---
    this.activeCount = 0;
    const shockVecs: THREE.Vector3[] = uniforms.uShockwaves.value;
    const strengths: Float32Array = uniforms.uShockStrengths.value;
    const widths: Float32Array = uniforms.uShockWidths.value;

    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      const slot = this.slots[i];
      if (!slot.active) continue;

      slot.life -= dt;
      if (slot.life <= 0) {
        slot.active = false;
        continue;
      }

      // Expand radius
      slot.radius += slot.speed * dt;

      // Decay strength based on remaining life fraction
      const lifeFraction = slot.life / slot.maxLife;
      const currentStrength = slot.strength * lifeFraction;

      // Pack into uniform arrays
      const idx = this.activeCount;
      shockVecs[idx].set(slot.x, slot.y, slot.radius);
      strengths[idx] = currentStrength;
      widths[idx] = DEFAULT_RING_WIDTH * (1 + (1 - lifeFraction) * 0.5); // ring widens as it fades
      this.activeCount++;
    }

    uniforms.uShockCount.value = this.activeCount;
    uniforms.uTime.value = totalTime;

    // --- Update chromatic aberration ---
    if (this.chromaticStrength > 0.0001) {
      this.chromaticStrength -= CHROMATIC_DECAY_SPEED * dt * this.chromaticStrength;
      if (this.chromaticStrength < 0.0001) {
        this.chromaticStrength = 0;
      }
    }
    this.chromaticTarget *= Math.max(0, 1 - CHROMATIC_DECAY_SPEED * dt);
    uniforms.uChromaticStrength.value = this.chromaticStrength;

    // --- Update screen flash ---
    if (this.flashIntensity > 0.001) {
      this.flashIntensity -= FLASH_DECAY_SPEED * dt;
      if (this.flashIntensity < 0.001) {
        this.flashIntensity = 0;
      }
    }
    uniforms.uFlashIntensity.value = this.flashIntensity;
    (uniforms.uFlashColor.value as THREE.Color).copy(this.flashColor);
  }

  // -----------------------------------------------------------------------
  // Vignette control (since we merged vignette into this pass)
  // -----------------------------------------------------------------------

  /** Set vignette parameters (replaces the old standalone vignette pass). */
  setVignette(offset: number, darkness: number): void {
    this.shaderPass.uniforms.uVignetteOffset.value = offset;
    this.shaderPass.uniforms.uVignetteDarkness.value = darkness;
  }

  // -----------------------------------------------------------------------
  // Debug
  // -----------------------------------------------------------------------

  /** Get the number of active shockwaves. */
  getActiveShockwaveCount(): number {
    return this.activeCount;
  }

  dispose(): void {
    // ShaderPass doesn't have a dispose method in Three.js, but we can
    // clean up our references
    this.activeCount = 0;
    for (const slot of this.slots) {
      slot.active = false;
    }
  }
}
