/**
 * SharedGameSetup — Shared rendering setup used by BOTH single-player (main.ts)
 * and LAN multiplayer (network-main.ts).
 *
 * This ensures visual consistency between SP and MP by using identical:
 * - Surface creation config
 * - Lighting setup
 * - Post-processing pipeline (shockwave effect)
 *
 * CREATED as part of S27c MP rendering rearchitecture to address the user's
 * core insight: "Why is the multiplayer using different code? It should be
 * the SAME code. The SAME renderer."
 */

import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Surface, SurfacePoint } from '../surfaces/Surface';
import type { SurfaceType } from '../surfaces/SurfaceFactory';
import { ShockwaveEffect } from '../effects/ShockwaveEffect';
import { isMobile } from '../core/MobileDetector';
import {
  loadMobileGridBrightness,
  MOBILE_GRID_SEGMENTS_MULTIPLIER,
  MOBILE_GRID_MAX_SEGMENTS_U,
  MOBILE_GRID_MAX_SEGMENTS_V,
} from '../core/MobileGridConfig';

// ---------------------------------------------------------------------------
// Visual style type (loaded from user settings)
// ---------------------------------------------------------------------------

export interface SavedVisualStyle {
  gridColor?: number;
  surfaceColor?: number;
  surfaceOpacity?: number;
  gridOpacity?: number;
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  gridSegmentsU?: number;
  gridSegmentsV?: number;
  wireframeOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Surface config generation — SINGLE source of truth for both SP and MP
// ---------------------------------------------------------------------------

/**
 * Generate a surface config object that SurfaceFactory.create() accepts.
 * Uses the same defaults and surface-type-specific overrides for both
 * single-player and LAN multiplayer.
 *
 * @param surfaceType - The surface type being created
 * @param scale - Surface scale factor (SP uses level.surfaceScale; MP uses 10)
 * @param savedStyle - User's saved visual style, or null for defaults
 */
export function createStandardSurfaceConfig(
  surfaceType: SurfaceType,
  scale: number,
  savedStyle: SavedVisualStyle | null,
): Record<string, unknown> {
  const mobile = isMobile();
  const baseSegmentsU = savedStyle?.gridSegmentsU ?? 24;
  const baseSegmentsV = savedStyle?.gridSegmentsV ?? 18;
  const baseOpacity = savedStyle?.gridOpacity ?? 0.10;

  // Mobile: 4× grid line density for visibility on small screens.
  // Capped so that high-density presets don't create excessive geometry.
  const gridSegmentsU = mobile
    ? Math.min(baseSegmentsU * MOBILE_GRID_SEGMENTS_MULTIPLIER, MOBILE_GRID_MAX_SEGMENTS_U)
    : baseSegmentsU;
  const gridSegmentsV = mobile
    ? Math.min(baseSegmentsV * MOBILE_GRID_SEGMENTS_MULTIPLIER, MOBILE_GRID_MAX_SEGMENTS_V)
    : baseSegmentsV;

  // Mobile: raise brightness floor so lines are visible in varied lighting.
  // Uses the user-configurable mobile brightness (default 35% vs desktop 10%).
  const gridOpacity = mobile
    ? Math.max(baseOpacity, loadMobileGridBrightness())
    : baseOpacity;

  const config: Record<string, unknown> = {
    // Visual appearance
    gridColor: savedStyle?.gridColor ?? 0x2a2aaa,
    surfaceColor: savedStyle?.surfaceColor ?? 0x141440,
    surfaceOpacity: savedStyle?.surfaceOpacity ?? 0.05,
    gridOpacity,
    wireframeOnly: savedStyle?.wireframeOnly ?? false,
    gridSegmentsU,
    gridSegmentsV,

    // Type-specific geometric configs (all derived from scale)
    radius: scale,
    size: scale,
    height: scale * 2,
    bevelRadius: 0.6,
    majorRadius: scale * 0.8,
    minorRadius: scale * 0.3,
    cylinderRadius: scale * 0.4,
    sphereRadius: scale * 0.6,
    subdivisions: 2,
    width: scale,
    numDents: 8,
    dentDepth: scale * 0.15,
    tunnelRadius: scale * 0.3,
  };

  // Cube tunnel: size proportional to scale (like all other surfaces).
  // At scale=10: size=20, wallThickness=2.0, bevelRadius=2.4 — matches CubeWithTunnelSurface defaults.
  // MapSize group-scale is then applied on top (SMALL=0.75x, MEDIUM=1.0x, LARGE=1.5x, EPIC=2.0x).
  // S38: removed hardcoded size=67 — it ignored scale and produced a 134-unit tunnel at EPIC default.
  if (surfaceType === 'cube-tunnel') {
    config.size = scale * 2;           // 20 at scale=10
    config.wallThickness = scale * 0.2; // 2.0 at scale=10
    config.bevelRadius = scale * 0.24;  // 2.4 at scale=10 (= size * 0.12)
    config.gridSegments = 20;
  }

  // Cube-ring: reduce to compact feel
  if (surfaceType === 'cube-ring') {
    config.majorRadius = 4;
    config.crossSection = 2;
  }

  return config;
}

// ---------------------------------------------------------------------------
// Lighting setup — identical for SP and MP
// ---------------------------------------------------------------------------

/**
 * Add the standard game lighting to a scene.
 * Returns the lights for potential later adjustment.
 */
export function setupStandardLighting(scene: THREE.Scene): {
  ambient: THREE.AmbientLight;
  directional: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
} {
  const ambient = new THREE.AmbientLight(0x404080, 0.6);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(5, 10, 5);
  scene.add(directional);

  const fill = new THREE.DirectionalLight(0x4488ff, 0.4);
  fill.position.set(-5, -5, -5);
  scene.add(fill);

  return { ambient, directional, fill };
}

// ---------------------------------------------------------------------------
// Post-processing setup — shockwave effect replaces vignette pass
// ---------------------------------------------------------------------------

/**
 * Set up the shockwave post-processing effect, replacing the vignette pass
 * in the EffectComposer. Used by both SP and MP for enemy death distortion,
 * chromatic aberration, and flash effects.
 */
export function setupShockwaveEffect(
  game: Game,
  camera: THREE.Camera,
): ShockwaveEffect {
  const shockwaveEffect = new ShockwaveEffect();
  shockwaveEffect.setCamera(camera as THREE.PerspectiveCamera);

  if (game.composer) {
    const passes = game.composer.passes;
    // The vignette pass is a ShaderPass with 'offset' and 'darkness' uniforms.
    // Chain: RenderPass -> BloomPass -> VignettePass -> OutputPass
    // Replace VignettePass with ShockwavePass (which also includes vignette).
    for (let i = passes.length - 1; i >= 0; i--) {
      const pass = passes[i];
      if (
        (pass as any).uniforms?.offset &&
        (pass as any).uniforms?.darkness &&
        !(pass as any).uniforms?.uShockCount
      ) {
        passes.splice(i, 1, shockwaveEffect.shaderPass);
        break;
      }
    }
  }

  return shockwaveEffect;
}

// ---------------------------------------------------------------------------
// Surface transform helper — shared between SP and MP
// ---------------------------------------------------------------------------

export type SurfaceTransformFn = (u: number, v: number) => {
  position: THREE.Vector3;
  normal: THREE.Vector3;
  tangent: THREE.Vector3;
  bitangent: THREE.Vector3;
};

/**
 * Create a surface transform function that converts UV coordinates to
 * world-space position + frame. Applies map size scale factor.
 */
export function makeSurfaceTransformFn(
  surface: Surface,
  scaleFactor: number = 1.0,
): SurfaceTransformFn {
  return (u: number, v: number) => {
    const pt: SurfacePoint = surface.getPoint(u, v);
    if (scaleFactor !== 1.0) {
      pt.position.multiplyScalar(scaleFactor);
    }
    return {
      position: pt.position,
      normal: pt.normal,
      tangent: pt.tangentU,
      bitangent: pt.tangentV,
    };
  };
}

// ---------------------------------------------------------------------------
// Player orientation on surface — shared between SP and MP
// ---------------------------------------------------------------------------

/**
 * Orient a player mesh on the surface using the surface normal and aim angle.
 * Used by MP for remote player rendering and client-side prediction.
 */
export function orientPlayerOnSurface(
  mesh: THREE.Object3D,
  surfaceNormal: THREE.Vector3,
  aimAngle: number,
  tangentU: THREE.Vector3,
): void {
  const normal = surfaceNormal.clone().normalize();
  const forward = tangentU.clone().normalize();
  const right = new THREE.Vector3().crossVectors(normal, forward).normalize();
  const correctedForward = new THREE.Vector3().crossVectors(right, normal).normalize();
  const rotMatrix = new THREE.Matrix4().makeBasis(right, normal, correctedForward);
  mesh.quaternion.setFromRotationMatrix(rotMatrix);
  mesh.rotateOnAxis(new THREE.Vector3(0, 1, 0), aimAngle);
}

// ---------------------------------------------------------------------------
// Default surface scale — used by MP where no level.surfaceScale exists
// ---------------------------------------------------------------------------

export const DEFAULT_SURFACE_SCALE = 10;
