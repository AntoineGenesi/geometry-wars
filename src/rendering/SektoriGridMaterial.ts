/**
 * Sektori-style Grid Material
 *
 * A custom ShaderMaterial for LineSegments that creates a proximity-based glow
 * effect around the player position. Grid lines near the player light up with
 * a configurable color and falloff, creating the signature "tile glow" effect
 * inspired by the game Sektori.
 *
 * Features:
 * - Distance-based glow from player position (exponential falloff)
 * - Configurable base color, glow color, and glow radius
 * - Trail effect via secondary trail positions with independent falloff
 * - Time-based pulse animation on the glow
 * - Zero per-frame allocations (only uniform updates)
 *
 * Usage:
 *   const material = createSektoriGridMaterial({ ... });
 *   // Each frame:
 *   updateSektoriUniforms(material, playerWorldPos, time);
 *   // The grid LineSegments uses this material instead of LineBasicMaterial.
 */

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SektoriGridConfig {
  /** Base grid line color (dim, far from player). Default: dark blue-purple */
  baseColor?: THREE.Color;
  /** Glow color near the player. Default: bright cyan */
  glowColor?: THREE.Color;
  /** Secondary glow color for the outer halo. Default: blue-white */
  glowColor2?: THREE.Color;
  /** World-space radius of the glow effect. Default: 4.0 */
  glowRadius?: number;
  /** Falloff exponent (higher = sharper edge). Default: 2.0 */
  falloffExponent?: number;
  /** Base opacity of grid lines far from player. Default: 0.15 */
  baseOpacity?: number;
  /** Maximum opacity at the glow center. Default: 1.0 */
  glowOpacity?: number;
  /** Pulse amplitude (0 = no pulse). Default: 0.15 */
  pulseAmplitude?: number;
  /** Pulse speed (Hz). Default: 1.5 */
  pulseSpeed?: number;
  /** Number of trail positions to track. Default: 8 */
  trailCount?: number;
  /** Trail falloff multiplier (each older position is dimmer). Default: 0.7 */
  trailFalloff?: number;
  /** Trail glow radius multiplier (each older position has smaller radius). Default: 0.85 */
  trailRadiusFalloff?: number;
}

const DEFAULT_CONFIG: Required<SektoriGridConfig> = {
  baseColor: new THREE.Color(0x0a0a2a),
  glowColor: new THREE.Color(0x00ffff),
  glowColor2: new THREE.Color(0x4488ff),
  glowRadius: 4.0,
  falloffExponent: 2.0,
  baseOpacity: 0.15,
  glowOpacity: 1.0,
  pulseAmplitude: 0.15,
  pulseSpeed: 1.5,
  trailCount: 8,
  trailFalloff: 0.7,
  trailRadiusFalloff: 0.85,
};

// ---------------------------------------------------------------------------
// Shader code
// ---------------------------------------------------------------------------

// MAX_TRAIL must match the array size in the shader
const MAX_TRAIL = 8;

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uBaseColor;
  uniform vec3 uGlowColor;
  uniform vec3 uGlowColor2;
  uniform float uBaseOpacity;
  uniform float uGlowOpacity;
  uniform float uGlowRadius;
  uniform float uFalloffExponent;
  uniform float uPulseAmplitude;
  uniform float uPulseSpeed;
  uniform float uTime;

  // Player position and trail positions
  uniform vec3 uPlayerPos;
  uniform vec3 uTrailPositions[${MAX_TRAIL}];
  uniform float uTrailWeights[${MAX_TRAIL}];
  uniform float uTrailRadii[${MAX_TRAIL}];
  uniform int uActiveTrailCount;

  varying vec3 vWorldPosition;

  float computeGlow(vec3 center, float radius, float weight) {
    float dist = distance(vWorldPosition, center);
    float t = clamp(dist / radius, 0.0, 1.0);
    float glow = pow(1.0 - t, uFalloffExponent) * weight;
    return glow;
  }

  void main() {
    // Pulse effect
    float pulse = 1.0 + uPulseAmplitude * sin(uTime * uPulseSpeed * 6.28318);

    // Primary glow from current player position
    float totalGlow = computeGlow(uPlayerPos, uGlowRadius * pulse, 1.0);

    // Trail glow contributions
    for (int i = 0; i < ${MAX_TRAIL}; i++) {
      if (i >= uActiveTrailCount) break;
      totalGlow = max(totalGlow, computeGlow(uTrailPositions[i], uTrailRadii[i] * pulse, uTrailWeights[i]));
    }

    totalGlow = clamp(totalGlow, 0.0, 1.0);

    // Color mixing: base -> glowColor2 (outer halo) -> glowColor (core)
    vec3 color;
    if (totalGlow < 0.5) {
      // Outer region: base -> glowColor2
      float t = totalGlow * 2.0;
      color = mix(uBaseColor, uGlowColor2, t);
    } else {
      // Inner region: glowColor2 -> glowColor
      float t = (totalGlow - 0.5) * 2.0;
      color = mix(uGlowColor2, uGlowColor, t);
    }

    // Opacity: base opacity far away, glow opacity near
    float opacity = mix(uBaseOpacity, uGlowOpacity, totalGlow);

    gl_FragColor = vec4(color, opacity);
  }
`;

// ---------------------------------------------------------------------------
// Material creation
// ---------------------------------------------------------------------------

/**
 * Create a Sektori-style grid ShaderMaterial.
 * Returns a THREE.ShaderMaterial configured for LineSegments rendering.
 */
export function createSektoriGridMaterial(config?: SektoriGridConfig): THREE.ShaderMaterial {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Build initial trail arrays
  const trailPositions: THREE.Vector3[] = [];
  const trailWeights: number[] = [];
  const trailRadii: number[] = [];
  for (let i = 0; i < MAX_TRAIL; i++) {
    trailPositions.push(new THREE.Vector3(0, 0, 0));
    trailWeights.push(0);
    trailRadii.push(cfg.glowRadius);
  }

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    precision: 'mediump', // Mobile: 10-20% GPU perf gain; desktop: no change
    uniforms: {
      uBaseColor: { value: cfg.baseColor.clone() },
      uGlowColor: { value: cfg.glowColor.clone() },
      uGlowColor2: { value: cfg.glowColor2.clone() },
      uBaseOpacity: { value: cfg.baseOpacity },
      uGlowOpacity: { value: cfg.glowOpacity },
      uGlowRadius: { value: cfg.glowRadius },
      uFalloffExponent: { value: cfg.falloffExponent },
      uPulseAmplitude: { value: cfg.pulseAmplitude },
      uPulseSpeed: { value: cfg.pulseSpeed },
      uTime: { value: 0 },
      uPlayerPos: { value: new THREE.Vector3(0, 0, 0) },
      uTrailPositions: { value: trailPositions },
      uTrailWeights: { value: trailWeights },
      uTrailRadii: { value: trailRadii },
      uActiveTrailCount: { value: 0 },
    },
  });

  return material;
}

// ---------------------------------------------------------------------------
// Uniform update (zero allocation)
// ---------------------------------------------------------------------------

/**
 * Update the Sektori grid material uniforms each frame.
 * This function performs zero allocations -- it only sets values on existing uniform objects.
 *
 * @param material - The ShaderMaterial created by createSektoriGridMaterial()
 * @param playerWorldPos - Current player world position
 * @param time - Current elapsed time in seconds
 */
export function updateSektoriUniforms(
  material: THREE.ShaderMaterial,
  playerWorldPos: THREE.Vector3,
  time: number,
): void {
  material.uniforms.uPlayerPos.value.copy(playerWorldPos);
  material.uniforms.uTime.value = time;
}

// ---------------------------------------------------------------------------
// Trail manager (handles the trail history for the glow effect)
// ---------------------------------------------------------------------------

/**
 * Manages the trail position history for the Sektori grid glow effect.
 * Keeps a ring buffer of recent player positions and updates the material
 * uniforms accordingly.
 *
 * Zero allocation after construction.
 */
export class SektoriTrailManager {
  private readonly positions: THREE.Vector3[] = [];
  private readonly maxCount: number;
  private readonly baseFalloff: number;
  private readonly baseRadiusFalloff: number;
  private readonly baseRadius: number;
  private head = 0;
  private count = 0;
  private readonly minDistanceSq: number;
  private readonly lastPos = new THREE.Vector3();

  constructor(config?: SektoriGridConfig) {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    this.maxCount = Math.min(cfg.trailCount, MAX_TRAIL);
    this.baseFalloff = cfg.trailFalloff;
    this.baseRadiusFalloff = cfg.trailRadiusFalloff;
    this.baseRadius = cfg.glowRadius;
    // Minimum distance squared before recording a new trail point
    // (prevents flooding trail with same-position entries)
    this.minDistanceSq = (cfg.glowRadius * 0.1) ** 2;

    for (let i = 0; i < this.maxCount; i++) {
      this.positions.push(new THREE.Vector3());
    }
  }

  /**
   * Record a new player position. Only adds to the trail if the player
   * has moved a minimum distance from the last recorded position.
   */
  recordPosition(pos: THREE.Vector3): void {
    if (this.count > 0 && pos.distanceToSquared(this.lastPos) < this.minDistanceSq) {
      return;
    }

    this.positions[this.head].copy(pos);
    this.head = (this.head + 1) % this.maxCount;
    if (this.count < this.maxCount) {
      this.count++;
    }
    this.lastPos.copy(pos);
  }

  /**
   * Update the material uniforms with the current trail state.
   * Zero allocations -- modifies uniform values in place.
   */
  updateMaterial(material: THREE.ShaderMaterial): void {
    const trailPositions: THREE.Vector3[] = material.uniforms.uTrailPositions.value;
    const trailWeights: number[] = material.uniforms.uTrailWeights.value;
    const trailRadii: number[] = material.uniforms.uTrailRadii.value;

    let weight = this.baseFalloff;
    let radius = this.baseRadius * this.baseRadiusFalloff;

    // Write trail positions from newest to oldest
    for (let i = 0; i < this.maxCount; i++) {
      if (i < this.count) {
        // Index into ring buffer: go backwards from head
        const idx = ((this.head - 1 - i) % this.maxCount + this.maxCount) % this.maxCount;
        trailPositions[i].copy(this.positions[idx]);
        trailWeights[i] = weight;
        trailRadii[i] = radius;
        weight *= this.baseFalloff;
        radius *= this.baseRadiusFalloff;
      } else {
        trailWeights[i] = 0;
        trailRadii[i] = 0;
      }
    }

    material.uniforms.uActiveTrailCount.value = this.count;
  }

  /** Reset all trail data (e.g., on player respawn or teleport). */
  reset(): void {
    this.head = 0;
    this.count = 0;
    this.lastPos.set(0, 0, 0);
  }
}

// ---------------------------------------------------------------------------
// Preset configurations (for Visual Playground)
// ---------------------------------------------------------------------------

/** Sektori preset: cyan glow on dark grid, moderate radius */
export const SEKTORI_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x080820),
  glowColor: new THREE.Color(0x00ffee),
  glowColor2: new THREE.Color(0x2266cc),
  glowRadius: 3.5,
  falloffExponent: 2.2,
  baseOpacity: 0.12,
  glowOpacity: 0.95,
  pulseAmplitude: 0.12,
  pulseSpeed: 1.2,
  trailCount: 8,
  trailFalloff: 0.65,
  trailRadiusFalloff: 0.85,
};

/** Sektori Extreme preset: wider glow, more saturated, intense bloom  */
export const SEKTORI_EXTREME_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x050018),
  glowColor: new THREE.Color(0xff00ff),
  glowColor2: new THREE.Color(0x8800ff),
  glowRadius: 5.0,
  falloffExponent: 1.8,
  baseOpacity: 0.08,
  glowOpacity: 1.0,
  pulseAmplitude: 0.2,
  pulseSpeed: 2.0,
  trailCount: 8,
  trailFalloff: 0.75,
  trailRadiusFalloff: 0.9,
};

/** Sektori Fire preset: warm orange-red glow */
export const SEKTORI_FIRE_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x1a0800),
  glowColor: new THREE.Color(0xff6600),
  glowColor2: new THREE.Color(0xcc2200),
  glowRadius: 4.0,
  falloffExponent: 2.5,
  baseOpacity: 0.10,
  glowOpacity: 0.95,
  pulseAmplitude: 0.18,
  pulseSpeed: 1.8,
  trailCount: 8,
  trailFalloff: 0.7,
  trailRadiusFalloff: 0.88,
};

/** Sektori Ice: cold blue-white, steady glow (no pulse) */
export const SEKTORI_ICE_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x040810),
  glowColor: new THREE.Color(0xaaddff),
  glowColor2: new THREE.Color(0x3366aa),
  glowRadius: 3.8,
  falloffExponent: 3.0,
  baseOpacity: 0.18,
  glowOpacity: 0.9,
  pulseAmplitude: 0.0,
  pulseSpeed: 0.0,
  trailCount: 6,
  trailFalloff: 0.6,
  trailRadiusFalloff: 0.8,
};

/** Sektori Ember: deep warm amber, tight radius, steady */
export const SEKTORI_EMBER_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x120400),
  glowColor: new THREE.Color(0xffaa44),
  glowColor2: new THREE.Color(0x883300),
  glowRadius: 2.8,
  falloffExponent: 3.5,
  baseOpacity: 0.08,
  glowOpacity: 1.0,
  pulseAmplitude: 0.0,
  pulseSpeed: 0.0,
  trailCount: 4,
  trailFalloff: 0.5,
  trailRadiusFalloff: 0.75,
};

/** Sektori Void: minimal white on black, wide soft glow */
export const SEKTORI_VOID_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x060606),
  glowColor: new THREE.Color(0xffffff),
  glowColor2: new THREE.Color(0x666666),
  glowRadius: 5.5,
  falloffExponent: 1.5,
  baseOpacity: 0.04,
  glowOpacity: 0.85,
  pulseAmplitude: 0.0,
  pulseSpeed: 0.0,
  trailCount: 8,
  trailFalloff: 0.8,
  trailRadiusFalloff: 0.9,
};

/** Sektori Aurora: green-to-blue gradient feel, gentle pulse */
export const SEKTORI_AURORA_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x020a10),
  glowColor: new THREE.Color(0x44ffaa),
  glowColor2: new THREE.Color(0x2244cc),
  glowRadius: 4.5,
  falloffExponent: 1.8,
  baseOpacity: 0.10,
  glowOpacity: 0.95,
  pulseAmplitude: 0.06,
  pulseSpeed: 0.6,
  trailCount: 8,
  trailFalloff: 0.75,
  trailRadiusFalloff: 0.9,
};

/** Sektori Hologram: teal with high base visibility, transparent feel */
export const SEKTORI_HOLOGRAM_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x082828),
  glowColor: new THREE.Color(0x00ffcc),
  glowColor2: new THREE.Color(0x008888),
  glowRadius: 3.0,
  falloffExponent: 2.5,
  baseOpacity: 0.25,
  glowOpacity: 0.8,
  pulseAmplitude: 0.0,
  pulseSpeed: 0.0,
  trailCount: 4,
  trailFalloff: 0.5,
  trailRadiusFalloff: 0.7,
};

/** Sektori Bloodline: deep red, sharp edge, menacing */
export const SEKTORI_BLOODLINE_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x0a0004),
  glowColor: new THREE.Color(0xff1122),
  glowColor2: new THREE.Color(0x660022),
  glowRadius: 3.2,
  falloffExponent: 4.0,
  baseOpacity: 0.06,
  glowOpacity: 1.0,
  pulseAmplitude: 0.0,
  pulseSpeed: 0.0,
  trailCount: 6,
  trailFalloff: 0.55,
  trailRadiusFalloff: 0.78,
};

/** Sektori Sunspot: bright yellow-white core, orange halo, slow pulse */
export const SEKTORI_SUNSPOT_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x0a0800),
  glowColor: new THREE.Color(0xffffaa),
  glowColor2: new THREE.Color(0xff8800),
  glowRadius: 3.5,
  falloffExponent: 2.2,
  baseOpacity: 0.07,
  glowOpacity: 1.0,
  pulseAmplitude: 0.08,
  pulseSpeed: 0.4,
  trailCount: 8,
  trailFalloff: 0.7,
  trailRadiusFalloff: 0.85,
};

/** Sektori Ultraviolet: deep purple, wide radius, no pulse */
export const SEKTORI_ULTRAVIOLET_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x080010),
  glowColor: new THREE.Color(0xcc66ff),
  glowColor2: new THREE.Color(0x4400aa),
  glowRadius: 5.0,
  falloffExponent: 1.6,
  baseOpacity: 0.10,
  glowOpacity: 0.9,
  pulseAmplitude: 0.0,
  pulseSpeed: 0.0,
  trailCount: 8,
  trailFalloff: 0.78,
  trailRadiusFalloff: 0.92,
};

/** Sektori Spotlight: tight bright white cone, very sharp falloff */
export const SEKTORI_SPOTLIGHT_PRESET: SektoriGridConfig = {
  baseColor: new THREE.Color(0x020202),
  glowColor: new THREE.Color(0xffffff),
  glowColor2: new THREE.Color(0x444488),
  glowRadius: 2.2,
  falloffExponent: 5.0,
  baseOpacity: 0.03,
  glowOpacity: 1.0,
  pulseAmplitude: 0.0,
  pulseSpeed: 0.0,
  trailCount: 8,
  trailFalloff: 0.65,
  trailRadiusFalloff: 0.8,
};
