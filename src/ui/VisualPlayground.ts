/**
 * Visual Styles Playground
 *
 * Displays a scrollable grid of 30 visual style presets. Each preset shows a live-rendered
 * mini-surface with different combinations of:
 * - Grid density (wireframe vertex separation)
 * - Surface opacity and color
 * - Wireframe vs solid vs mixed rendering
 * - Glow/bloom intensity
 * - Depth opacity curve (steep, moderate, gentle, none)
 *
 * Single shared WebGL renderer with scissor/viewport-based rendering for
 * efficiency (no 16 separate canvases).
 *
 * Accessible from the start menu via a "VISUAL STYLES" button.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SurfaceFactory, SurfaceType } from '../surfaces/SurfaceFactory';
import { Surface, SurfacePoint } from '../surfaces/Surface';
import {
  DEPTH_OPACITY_PRESETS,
  computeDepthVisibility,
} from '../rendering/DepthOpacity';
import { VisualPlaygroundDemo } from './VisualPlaygroundDemo';
import { saveVisualStyle, getActiveStyleIndex } from './VisualStyleSettings';
import { VisualStyleEditor, loadCustomStyles, deleteCustomStyle } from './VisualStyleEditor';
import {
  createSektoriGridMaterial,
  updateSektoriUniforms,
  SektoriTrailManager,
  SEKTORI_PRESET,
  SEKTORI_EXTREME_PRESET,
  SEKTORI_FIRE_PRESET,
  SEKTORI_ICE_PRESET,
  SEKTORI_EMBER_PRESET,
  SEKTORI_VOID_PRESET,
  SEKTORI_AURORA_PRESET,
  SEKTORI_HOLOGRAM_PRESET,
  SEKTORI_BLOODLINE_PRESET,
  SEKTORI_SUNSPOT_PRESET,
  SEKTORI_ULTRAVIOLET_PRESET,
  SEKTORI_SPOTLIGHT_PRESET,
  type SektoriGridConfig,
} from '../rendering/SektoriGridMaterial';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRID_COLS = 4;
const GRID_ROWS = 10;
const CELL_SIZE = 180;
const CELL_PADDING = 8;
const CANVAS_WIDTH = GRID_COLS * (CELL_SIZE + CELL_PADDING) + CELL_PADDING;
const CANVAS_HEIGHT = GRID_ROWS * (CELL_SIZE + CELL_PADDING) + CELL_PADDING;
const CAMERA_DISTANCE = 10;
const ROTATION_SPEED = 0.3;
const DEFAULT_SURFACE: SurfaceType = 'torus';

// Demo enemy positions (UV coords)
const DEMO_ENEMY_UVS = [
  { u: 0.2, v: 0.3 },
  { u: 0.6, v: 0.7 },
  { u: 0.8, v: 0.2 },
  { u: 0.4, v: 0.8 },
];

const DEMO_ENEMY_COLORS = [0x4444ff, 0xaa44ff, 0xff44aa, 0x00ff44];

// Pre-allocated temp vectors (module-level)
const _tempNormal = new THREE.Vector3();
const _tempCenter = new THREE.Vector3();
const _tempPlayerPos = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Preset definition
// ---------------------------------------------------------------------------

export interface VisualPreset {
  name: string;
  gridColor: number;
  surfaceColor: number;
  surfaceOpacity: number;
  gridOpacity: number;
  wireframeOnly: boolean;
  bloomStrength: number;
  /** Bloom radius (gaussian blur spread). Higher = smoother glow. Default: 0.4 */
  bloomRadius?: number;
  /** Bloom luminosity threshold. Higher = fewer pixels trigger bloom. Default: 0.85 */
  bloomThreshold?: number;
  gridSegmentsU: number;
  gridSegmentsV: number;
  depthCurve: string; // key into DEPTH_OPACITY_PRESETS
  description: string;
  /** When set, the grid uses the Sektori proximity glow shader instead of LineBasicMaterial. */
  sektoriConfig?: SektoriGridConfig;
}

/** All 38 presets (16 standard + 14 Sektori-inspired with proximity tile glow + 8 experimental) */
export const VISUAL_PRESETS: VisualPreset[] = [
  {
    name: 'Classic Neon',
    gridColor: 0x2a2aaa,
    surfaceColor: 0x0a0020,
    surfaceOpacity: 0.35,
    gridOpacity: 0.5,
    wireframeOnly: false,
    bloomStrength: 0.8,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
    depthCurve: 'steep',
    description: 'Default game style. Deep purple with neon grid.',
  },
  {
    name: 'Ghost Wire',
    gridColor: 0x00ffff,
    surfaceColor: 0x000000,
    surfaceOpacity: 0.0,
    gridOpacity: 0.7,
    wireframeOnly: true,
    bloomStrength: 0.9,
    bloomRadius: 0.8,
    bloomThreshold: 0.92,
    gridSegmentsU: 20,
    gridSegmentsV: 15,
    depthCurve: 'steep',
    description: 'Wireframe only with bright cyan glow.',
  },
  {
    name: 'Dense Grid',
    gridColor: 0x006666,
    surfaceColor: 0x050520,
    surfaceOpacity: 0.4,
    gridOpacity: 0.6,
    wireframeOnly: false,
    bloomStrength: 0.6,
    gridSegmentsU: 48,
    gridSegmentsV: 36,
    depthCurve: 'steep',
    description: 'Twice the grid lines. Fine mesh detail.',
  },
  {
    name: 'Sparse Grid',
    gridColor: 0x4488ff,
    surfaceColor: 0x0a0030,
    surfaceOpacity: 0.3,
    gridOpacity: 0.4,
    wireframeOnly: false,
    bloomStrength: 0.7,
    gridSegmentsU: 10,
    gridSegmentsV: 8,
    depthCurve: 'moderate',
    description: 'Minimal grid lines. Clean open feel.',
  },
  {
    name: 'Hot Plasma',
    gridColor: 0xff4400,
    surfaceColor: 0x200800,
    surfaceOpacity: 0.25,
    gridOpacity: 0.6,
    wireframeOnly: false,
    bloomStrength: 1.2,
    bloomRadius: 0.6,
    bloomThreshold: 0.88,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
    depthCurve: 'moderate',
    description: 'Orange-red plasma with intense bloom.',
  },
  {
    name: 'Ice Crystal',
    gridColor: 0x88ddff,
    surfaceColor: 0x001020,
    surfaceOpacity: 0.5,
    gridOpacity: 0.35,
    wireframeOnly: false,
    bloomStrength: 0.5,
    gridSegmentsU: 30,
    gridSegmentsV: 22,
    depthCurve: 'steep',
    description: 'Cold blue with subtle frosted grid.',
  },
  {
    name: 'Toxic Green',
    gridColor: 0x00ff44,
    surfaceColor: 0x001a00,
    surfaceOpacity: 0.2,
    gridOpacity: 0.8,
    wireframeOnly: false,
    bloomStrength: 0.8,
    bloomRadius: 0.7,
    bloomThreshold: 0.9,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
    depthCurve: 'extreme',
    description: 'Bright green with extreme depth fade.',
  },
  {
    name: 'Solid Onyx',
    gridColor: 0x333333,
    surfaceColor: 0x111111,
    surfaceOpacity: 0.9,
    gridOpacity: 0.15,
    wireframeOnly: false,
    bloomStrength: 0.3,
    gridSegmentsU: 16,
    gridSegmentsV: 12,
    depthCurve: 'gentle',
    description: 'Nearly opaque dark surface. Subtle grid.',
  },
  {
    name: 'Synthwave',
    gridColor: 0xff00ff,
    surfaceColor: 0x1a0028,
    surfaceOpacity: 0.3,
    gridOpacity: 0.65,
    wireframeOnly: false,
    bloomStrength: 1.0,
    bloomRadius: 0.6,
    bloomThreshold: 0.88,
    gridSegmentsU: 20,
    gridSegmentsV: 15,
    depthCurve: 'steep',
    description: 'Pink-magenta retro synthwave aesthetic.',
  },
  {
    name: 'Blueprint',
    gridColor: 0x4466cc,
    surfaceColor: 0x0a1530,
    surfaceOpacity: 0.6,
    gridOpacity: 0.4,
    wireframeOnly: false,
    bloomStrength: 0.4,
    gridSegmentsU: 36,
    gridSegmentsV: 28,
    depthCurve: 'moderate',
    description: 'Technical blueprint look. Dense, clean.',
  },
  {
    name: 'Pure Wire',
    gridColor: 0xffffff,
    surfaceColor: 0x000000,
    surfaceOpacity: 0.0,
    gridOpacity: 0.5,
    wireframeOnly: true,
    bloomStrength: 0.6,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
    depthCurve: 'steep',
    description: 'White wireframe on void. Minimal and clean.',
  },
  {
    name: 'Gold Luxury',
    gridColor: 0xffaa00,
    surfaceColor: 0x1a1000,
    surfaceOpacity: 0.35,
    gridOpacity: 0.55,
    wireframeOnly: false,
    bloomStrength: 0.9,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
    depthCurve: 'moderate',
    description: 'Warm gold tones with moderate glow.',
  },
  {
    name: 'Glass Surface',
    gridColor: 0x4488ff,
    surfaceColor: 0x0a1530,
    surfaceOpacity: 0.12,
    gridOpacity: 0.3,
    wireframeOnly: false,
    bloomStrength: 0.7,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
    depthCurve: 'none',
    description: 'Nearly transparent. All entities visible.',
  },
  {
    name: 'Nebula',
    gridColor: 0xaa44ff,
    surfaceColor: 0x0f0028,
    surfaceOpacity: 0.45,
    gridOpacity: 0.35,
    wireframeOnly: false,
    bloomStrength: 1.4,
    bloomRadius: 0.7,
    bloomThreshold: 0.85,
    gridSegmentsU: 18,
    gridSegmentsV: 14,
    depthCurve: 'moderate',
    description: 'Purple nebula with maximum bloom.',
  },
  {
    name: 'Grid Only Dense',
    gridColor: 0x00ff88,
    surfaceColor: 0x000000,
    surfaceOpacity: 0.0,
    gridOpacity: 0.9,
    wireframeOnly: true,
    bloomStrength: 0.5,
    gridSegmentsU: 48,
    gridSegmentsV: 36,
    depthCurve: 'extreme',
    description: 'Dense wireframe only. Extreme far-fade.',
  },
  {
    name: 'Stealth',
    gridColor: 0x224444,
    surfaceColor: 0x020208,
    surfaceOpacity: 0.7,
    gridOpacity: 0.2,
    wireframeOnly: false,
    bloomStrength: 0.2,
    gridSegmentsU: 16,
    gridSegmentsV: 12,
    depthCurve: 'steep',
    description: 'Dark and subtle. Minimal visual noise.',
  },
  // -- Sektori-inspired presets (row 5) ---
  {
    name: 'Sektori Cyan',
    gridColor: 0x00ffee,
    surfaceColor: 0x020810,
    surfaceOpacity: 0.15,
    gridOpacity: 0.95,
    wireframeOnly: false,
    bloomStrength: 1.1,
    bloomRadius: 0.7,
    bloomThreshold: 0.9,
    gridSegmentsU: 32,
    gridSegmentsV: 24,
    depthCurve: 'moderate',
    description: 'Sektori-style tile glow. Grid lights up near the player.',
    sektoriConfig: SEKTORI_PRESET,
  },
  {
    name: 'Sektori Extreme',
    gridColor: 0xff00ff,
    surfaceColor: 0x050018,
    surfaceOpacity: 0.1,
    gridOpacity: 1.0,
    wireframeOnly: false,
    bloomStrength: 1.3,
    bloomRadius: 0.7,
    bloomThreshold: 0.88,
    gridSegmentsU: 36,
    gridSegmentsV: 28,
    depthCurve: 'moderate',
    description: 'Intense magenta proximity glow with wide trail effect.',
    sektoriConfig: SEKTORI_EXTREME_PRESET,
  },
  {
    name: 'Sektori Fire',
    gridColor: 0xff6600,
    surfaceColor: 0x0a0400,
    surfaceOpacity: 0.12,
    gridOpacity: 0.95,
    wireframeOnly: false,
    bloomStrength: 1.2,
    bloomRadius: 0.65,
    bloomThreshold: 0.88,
    gridSegmentsU: 30,
    gridSegmentsV: 22,
    depthCurve: 'moderate',
    description: 'Warm orange-red proximity glow with sharp falloff.',
    sektoriConfig: SEKTORI_FIRE_PRESET,
  },
  {
    name: 'Sektori Ghost',
    gridColor: 0x00ff88,
    surfaceColor: 0x000000,
    surfaceOpacity: 0.0,
    gridOpacity: 1.0,
    wireframeOnly: true,
    bloomStrength: 1.2,
    bloomRadius: 0.75,
    bloomThreshold: 0.9,
    gridSegmentsU: 28,
    gridSegmentsV: 20,
    depthCurve: 'steep',
    description: 'Wireframe only with green proximity glow. Ethereal.',
    sektoriConfig: {
      baseColor: new THREE.Color(0x001a08),
      glowColor: new THREE.Color(0x00ff88),
      glowColor2: new THREE.Color(0x00aa44),
      glowRadius: 4.5,
      falloffExponent: 2.0,
      baseOpacity: 0.06,
      glowOpacity: 0.95,
      pulseAmplitude: 0.1,
      pulseSpeed: 1.0,
      trailCount: 8,
      trailFalloff: 0.7,
      trailRadiusFalloff: 0.85,
    },
  },
  // -- Sektori-inspired presets (rows 6-8) -- NEW variety pack ---
  {
    name: 'Sektori Ice',
    gridColor: 0xaaddff,
    surfaceColor: 0x020610,
    surfaceOpacity: 0.18,
    gridOpacity: 0.9,
    wireframeOnly: false,
    bloomStrength: 1.0,
    bloomRadius: 0.5,
    bloomThreshold: 0.9,
    gridSegmentsU: 32,
    gridSegmentsV: 24,
    depthCurve: 'steep',
    description: 'Cold blue-white steady glow. No pulse — pure frozen light.',
    sektoriConfig: SEKTORI_ICE_PRESET,
  },
  {
    name: 'Sektori Ember',
    gridColor: 0xffaa44,
    surfaceColor: 0x0a0200,
    surfaceOpacity: 0.10,
    gridOpacity: 0.95,
    wireframeOnly: false,
    bloomStrength: 1.2,
    bloomRadius: 0.55,
    bloomThreshold: 0.88,
    gridSegmentsU: 28,
    gridSegmentsV: 20,
    depthCurve: 'moderate',
    description: 'Tight amber glow like dying coals. Steady, no animation.',
    sektoriConfig: SEKTORI_EMBER_PRESET,
  },
  {
    name: 'Sektori Void',
    gridColor: 0xffffff,
    surfaceColor: 0x000000,
    surfaceOpacity: 0.0,
    gridOpacity: 0.85,
    wireframeOnly: true,
    bloomStrength: 0.8,
    bloomRadius: 0.4,
    bloomThreshold: 0.92,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
    depthCurve: 'moderate',
    description: 'Monochrome white on black. Wide soft glow, no pulse. Minimal.',
    sektoriConfig: SEKTORI_VOID_PRESET,
  },
  {
    name: 'Sektori Aurora',
    gridColor: 0x44ffaa,
    surfaceColor: 0x010810,
    surfaceOpacity: 0.12,
    gridOpacity: 0.9,
    wireframeOnly: false,
    bloomStrength: 1.4,
    bloomRadius: 0.7,
    bloomThreshold: 0.88,
    gridSegmentsU: 36,
    gridSegmentsV: 28,
    depthCurve: 'moderate',
    description: 'Green-to-blue color gradient. Gentle slow pulse like northern lights.',
    sektoriConfig: SEKTORI_AURORA_PRESET,
  },
  {
    name: 'Sektori Hologram',
    gridColor: 0x00ffcc,
    surfaceColor: 0x041818,
    surfaceOpacity: 0.08,
    gridOpacity: 0.8,
    wireframeOnly: false,
    bloomStrength: 0.9,
    bloomRadius: 0.5,
    bloomThreshold: 0.9,
    gridSegmentsU: 40,
    gridSegmentsV: 30,
    depthCurve: 'gentle',
    description: 'High base visibility with teal glow. Grid always partly visible.',
    sektoriConfig: SEKTORI_HOLOGRAM_PRESET,
  },
  {
    name: 'Sektori Bloodline',
    gridColor: 0xff1122,
    surfaceColor: 0x060002,
    surfaceOpacity: 0.10,
    gridOpacity: 1.0,
    wireframeOnly: false,
    bloomStrength: 1.3,
    bloomRadius: 0.55,
    bloomThreshold: 0.88,
    gridSegmentsU: 30,
    gridSegmentsV: 22,
    depthCurve: 'steep',
    description: 'Deep crimson with razor-sharp falloff. Steady, menacing.',
    sektoriConfig: SEKTORI_BLOODLINE_PRESET,
  },
  {
    name: 'Sektori Sunspot',
    gridColor: 0xffffaa,
    surfaceColor: 0x080600,
    surfaceOpacity: 0.10,
    gridOpacity: 0.95,
    wireframeOnly: false,
    bloomStrength: 1.6,
    bloomRadius: 0.7,
    bloomThreshold: 0.85,
    gridSegmentsU: 28,
    gridSegmentsV: 20,
    depthCurve: 'moderate',
    description: 'Bright yellow-white core with orange halo. Slow, warm pulse.',
    sektoriConfig: SEKTORI_SUNSPOT_PRESET,
  },
  {
    name: 'Sektori Ultraviolet',
    gridColor: 0xcc66ff,
    surfaceColor: 0x040008,
    surfaceOpacity: 0.14,
    gridOpacity: 0.9,
    wireframeOnly: false,
    bloomStrength: 1.5,
    bloomRadius: 0.65,
    bloomThreshold: 0.88,
    gridSegmentsU: 32,
    gridSegmentsV: 24,
    depthCurve: 'moderate',
    description: 'Deep purple wide glow. No pulse — smooth and expansive.',
    sektoriConfig: SEKTORI_ULTRAVIOLET_PRESET,
  },
  {
    name: 'Sektori Spotlight',
    gridColor: 0xffffff,
    surfaceColor: 0x010101,
    surfaceOpacity: 0.05,
    gridOpacity: 1.0,
    wireframeOnly: false,
    bloomStrength: 1.1,
    bloomRadius: 0.45,
    bloomThreshold: 0.9,
    gridSegmentsU: 36,
    gridSegmentsV: 28,
    depthCurve: 'extreme',
    description: 'Tiny bright white cone. Ultra-sharp edge. Like a flashlight on the grid.',
    sektoriConfig: SEKTORI_SPOTLIGHT_PRESET,
  },
  {
    name: 'Sektori Edge',
    gridColor: 0x22ffff,
    surfaceColor: 0x000000,
    surfaceOpacity: 0.0,
    gridOpacity: 1.0,
    wireframeOnly: true,
    bloomStrength: 1.8,
    bloomRadius: 0.8,
    bloomThreshold: 0.85,
    gridSegmentsU: 48,
    gridSegmentsV: 36,
    depthCurve: 'steep',
    description: 'Dense wireframe only. Intense bloom on edge glow. No surface, pure lines.',
    sektoriConfig: {
      baseColor: new THREE.Color(0x001010),
      glowColor: new THREE.Color(0x22ffff),
      glowColor2: new THREE.Color(0x0066aa),
      glowRadius: 3.5,
      falloffExponent: 2.8,
      baseOpacity: 0.05,
      glowOpacity: 1.0,
      pulseAmplitude: 0.0,
      pulseSpeed: 0.0,
      trailCount: 8,
      trailFalloff: 0.7,
      trailRadiusFalloff: 0.85,
    },
  },
  // -- Experimental visual styles (rows 9-10) ---
  {
    name: 'Matrix',
    gridColor: 0x00ff41,
    surfaceColor: 0x000000,
    surfaceOpacity: 0.0,
    gridOpacity: 0.95,
    wireframeOnly: true,
    bloomStrength: 2.2,
    bloomRadius: 0.9,
    bloomThreshold: 0.8,
    gridSegmentsU: 48,
    gridSegmentsV: 36,
    depthCurve: 'extreme',
    description: 'Hacker terminal. Dense green wireframe, extreme bloom, extreme depth fade.',
  },
  {
    name: 'Blood Moon',
    gridColor: 0xcc1100,
    surfaceColor: 0x080000,
    surfaceOpacity: 0.25,
    gridOpacity: 0.85,
    wireframeOnly: false,
    bloomStrength: 1.4,
    bloomRadius: 0.65,
    bloomThreshold: 0.85,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
    depthCurve: 'moderate',
    description: 'Deep crimson grid with red/orange proximity glow. Ominous.',
    sektoriConfig: {
      baseColor: new THREE.Color(0x1a0000),
      glowColor: new THREE.Color(0xff2200),
      glowColor2: new THREE.Color(0xff6600),
      glowRadius: 4.0,
      falloffExponent: 2.2,
      baseOpacity: 0.08,
      glowOpacity: 0.95,
      pulseAmplitude: 0.08,
      pulseSpeed: 0.8,
      trailCount: 6,
      trailFalloff: 0.75,
      trailRadiusFalloff: 0.9,
    },
  },
  {
    name: 'Tron Legacy',
    gridColor: 0xff8833,
    surfaceColor: 0x000818,
    surfaceOpacity: 0.15,
    gridOpacity: 0.7,
    wireframeOnly: false,
    bloomStrength: 1.6,
    bloomRadius: 0.9,
    bloomThreshold: 0.82,
    gridSegmentsU: 12,
    gridSegmentsV: 10,
    depthCurve: 'extreme',
    description: 'Orange-white grid on deep blue. Sparse lines, wide bloom. The Grid.',
  },
  {
    name: 'Vaporwave Sunset',
    gridColor: 0xff44aa,
    surfaceColor: 0x1a0030,
    surfaceOpacity: 0.4,
    gridOpacity: 0.75,
    wireframeOnly: false,
    bloomStrength: 1.3,
    bloomRadius: 0.7,
    bloomThreshold: 0.85,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
    depthCurve: 'moderate',
    description: 'Pink-magenta on deep purple. Retro vaporwave aesthetic.',
  },
  {
    name: 'Void Minimal',
    gridColor: 0xffffff,
    surfaceColor: 0x020204,
    surfaceOpacity: 0.02,
    gridOpacity: 0.1,
    wireframeOnly: false,
    bloomStrength: 0.15,
    bloomRadius: 0.2,
    bloomThreshold: 0.95,
    gridSegmentsU: 10,
    gridSegmentsV: 8,
    depthCurve: 'extreme',
    description: 'Almost invisible. Faint grid, near-zero surface. Hardcore mode.',
  },
  {
    name: 'Supernova',
    gridColor: 0xffffff,
    surfaceColor: 0x0a0a14,
    surfaceOpacity: 0.2,
    gridOpacity: 0.9,
    wireframeOnly: false,
    bloomStrength: 2.5,
    bloomRadius: 1.0,
    bloomThreshold: 0.7,
    gridSegmentsU: 24,
    gridSegmentsV: 18,
    depthCurve: 'moderate',
    description: 'Maximum bloom. Blinding white glow radiating from every grid line.',
  },
  {
    name: 'Deep Ocean',
    gridColor: 0x005566,
    surfaceColor: 0x001a22,
    surfaceOpacity: 0.7,
    gridOpacity: 0.3,
    wireframeOnly: false,
    bloomStrength: 0.3,
    bloomRadius: 0.3,
    bloomThreshold: 0.92,
    gridSegmentsU: 36,
    gridSegmentsV: 28,
    depthCurve: 'gentle',
    description: 'Dark teal, high-opacity surface, dim grid. Underwater pressure.',
  },
  {
    name: 'Electric Storm',
    gridColor: 0xffffaa,
    surfaceColor: 0x050508,
    surfaceOpacity: 0.1,
    gridOpacity: 0.95,
    wireframeOnly: false,
    bloomStrength: 1.8,
    bloomRadius: 0.75,
    bloomThreshold: 0.82,
    gridSegmentsU: 28,
    gridSegmentsV: 20,
    depthCurve: 'steep',
    description: 'Yellow-white lightning with wide fast-pulsing proximity glow.',
    sektoriConfig: {
      baseColor: new THREE.Color(0x080804),
      glowColor: new THREE.Color(0xffffcc),
      glowColor2: new THREE.Color(0xffaa00),
      glowRadius: 6.5,
      falloffExponent: 1.5,
      baseOpacity: 0.04,
      glowOpacity: 1.0,
      pulseAmplitude: 0.2,
      pulseSpeed: 3.5,
      trailCount: 10,
      trailFalloff: 0.6,
      trailRadiusFalloff: 0.8,
    },
  },
];

// ---------------------------------------------------------------------------
// Per-cell scene data
// ---------------------------------------------------------------------------

interface CellData {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  surface: Surface;
  enemyMeshes: THREE.Mesh[];
  composer: EffectComposer;
  rotationAngle: number;
  preset: VisualPreset;
  /** Sektori grid material (null if preset does not use Sektori effect) */
  sektoriMaterial: THREE.ShaderMaterial | null;
  /** Sektori trail manager (null if preset does not use Sektori effect) */
  sektoriTrail: SektoriTrailManager | null;
  /** Simulated player mesh for Sektori demos (null otherwise) */
  playerDot: THREE.Mesh | null;
  /** Scale factor used to position entities on the surface */
  scaleFactor: number;
}

// ---------------------------------------------------------------------------
// VisualPlayground class
// ---------------------------------------------------------------------------

export class VisualPlayground {
  private overlay: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private cells: CellData[] = [];
  private rafId = 0;
  private running = false;
  private styleElement: HTMLStyleElement;
  private surfaceType: SurfaceType = DEFAULT_SURFACE;
  private closeCallback: (() => void) | null = null;
  private expandedIndex = -1;
  private demoInstance: VisualPlaygroundDemo | null = null;
  private editorInstance: VisualStyleEditor | null = null;
  /** Combined list of built-in presets + custom styles. Rebuilt on open/save. */
  private allPresets: VisualPreset[] = [];

  constructor() {
    // -- Build combined preset list --
    this.rebuildAllPresets();

    // -- Style --
    this.styleElement = document.createElement('style');
    this.styleElement.textContent = this.getStyles();
    document.head.appendChild(this.styleElement);

    // -- Overlay --
    this.overlay = document.createElement('div');
    this.overlay.className = 'vp-overlay';
    this.overlay.innerHTML = this.buildHTML();
    document.body.appendChild(this.overlay);

    // -- Canvas --
    this.canvas = this.overlay.querySelector('.vp-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(CANVAS_WIDTH, this.getCanvasHeight());
    this.renderer.autoClear = false;

    // -- Build cells --
    this.buildCells();

    // -- Attach events --
    this.attachEvents();
  }

  /** Rebuild the combined presets list: built-in presets + custom styles from localStorage. */
  private rebuildAllPresets(): void {
    const customs = loadCustomStyles();
    this.allPresets = [...VISUAL_PRESETS, ...customs.map((c) => c.preset)];
  }

  /** Compute canvas height based on the number of presets. */
  private getCanvasHeight(): number {
    const rows = Math.ceil(this.allPresets.length / GRID_COLS);
    return rows * (CELL_SIZE + CELL_PADDING) + CELL_PADDING;
  }

  // -----------------------------------------------------------------------
  // HTML
  // -----------------------------------------------------------------------

  private buildHTML(): string {
    const surfaceOptions = SurfaceFactory.getAvailableTypes()
      .map((t) => `<option value="${t}" ${t === this.surfaceType ? 'selected' : ''}>${t}</option>`)
      .join('');

    const activeIdx = getActiveStyleIndex();
    const isCustom = (index: number) => index >= VISUAL_PRESETS.length;
    const presetLabels = this.allPresets.map((p, i) => {
      const isActive = i === activeIdx;
      const editBtn = isActive
        ? `<button class="vp-edit-btn" data-index="${i}">EDIT</button>`
        : '';
      const deleteBtn = isCustom(i)
        ? `<button class="vp-delete-btn" data-index="${i}" title="Delete custom style">X</button>`
        : '';
      return `<div class="vp-label${isActive ? ' vp-label-active' : ''}${isCustom(i) ? ' vp-label-custom' : ''}" data-index="${i}">
        <span class="vp-label-name">${p.name}</span>
        <div class="vp-label-actions">
          ${editBtn}
          <button class="vp-apply-btn" data-index="${i}">${isActive ? 'ACTIVE' : 'APPLY'}</button>
          ${deleteBtn}
        </div>
      </div>`;
    }).join('');

    // Compute actual grid dimensions based on total preset count
    const totalPresets = this.allPresets.length;
    const rows = Math.ceil(totalPresets / GRID_COLS);
    const canvasH = rows * (CELL_SIZE + CELL_PADDING) + CELL_PADDING;

    return `
      <div class="vp-container">
        <div class="vp-header">
          <h2 class="vp-title">VISUAL STYLES</h2>
          <div class="vp-controls">
            <label class="vp-surface-label">Surface:
              <select class="vp-surface-select">${surfaceOptions}</select>
            </label>
            <button class="vp-close-btn">CLOSE</button>
          </div>
        </div>
        <div class="vp-grid-wrapper" style="height:${canvasH}px">
          <canvas class="vp-canvas" width="${CANVAS_WIDTH}" height="${canvasH}"></canvas>
          <div class="vp-labels-grid" style="grid-template-rows:repeat(${rows}, 1fr)">${presetLabels}</div>
        </div>
        <div class="vp-hint">Click name to preview. Click APPLY to set as game style. EDIT customizes the active style.</div>
      </div>
    `;
  }

  // -----------------------------------------------------------------------
  // Styles
  // -----------------------------------------------------------------------

  private getStyles(): string {
    return `
      .vp-overlay {
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(5, 2, 15, 0.95);
        z-index: 2000;
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: 'Segoe UI', monospace;
      }
      .vp-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        max-height: 95vh;
        overflow-y: auto;
      }
      .vp-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: ${CANVAS_WIDTH}px;
      }
      .vp-title {
        color: #00ffff;
        font-size: 22px;
        letter-spacing: 5px;
        margin: 0;
        text-shadow: 0 0 10px #00ffff;
      }
      .vp-controls {
        display: flex;
        gap: 16px;
        align-items: center;
      }
      .vp-surface-label {
        color: #88cccc;
        font-size: 13px;
        letter-spacing: 1px;
      }
      .vp-surface-select {
        background: rgba(0, 40, 40, 0.8);
        border: 1px solid #006666;
        color: #00ffff;
        padding: 5px 10px;
        font: 13px monospace;
        margin-left: 6px;
        cursor: pointer;
        outline: none;
      }
      .vp-surface-select:hover { border-color: #00ffff; }
      .vp-close-btn {
        background: rgba(80, 30, 0, 0.5);
        border: 1px solid #884400;
        color: #ff8800;
        padding: 8px 20px;
        font: bold 13px monospace;
        letter-spacing: 2px;
        cursor: pointer;
        transition: all 0.2s;
      }
      .vp-close-btn:hover {
        background: rgba(120, 50, 0, 0.6);
        box-shadow: 0 0 12px #ff8800;
      }
      .vp-grid-wrapper {
        position: relative;
        width: ${CANVAS_WIDTH}px;
        height: ${CANVAS_HEIGHT}px;
      }
      .vp-canvas {
        display: block;
        border: 1px solid rgba(0, 255, 255, 0.1);
        cursor: pointer;
      }
      .vp-labels-grid {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        display: grid;
        grid-template-columns: repeat(${GRID_COLS}, 1fr);
        grid-template-rows: repeat(${GRID_ROWS}, 1fr);
        gap: ${CELL_PADDING}px;
        padding: ${CELL_PADDING}px;
        pointer-events: none;
      }
      .vp-label {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        padding: 0 4px 4px 4px;
        color: rgba(200, 255, 255, 0.8);
        font: bold 10px monospace;
        letter-spacing: 1px;
        text-shadow: 0 0 6px rgba(0, 255, 255, 0.5), 0 1px 2px rgba(0, 0, 0, 0.8);
        pointer-events: auto;
        cursor: pointer;
      }
      .vp-label:hover {
        color: #ffffff;
        text-shadow: 0 0 12px #00ffff;
      }
      .vp-label-active {
        border: 1px solid rgba(0, 255, 160, 0.6);
        border-radius: 2px;
        background: rgba(0, 255, 160, 0.05);
      }
      .vp-label-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vp-apply-btn {
        background: rgba(0, 80, 40, 0.7);
        border: 1px solid #00aa66;
        color: #00ff88;
        padding: 2px 6px;
        font: bold 8px monospace;
        letter-spacing: 1px;
        cursor: pointer;
        transition: all 0.2s;
        flex-shrink: 0;
        pointer-events: auto;
      }
      .vp-apply-btn:hover {
        background: rgba(0, 120, 60, 0.8);
        box-shadow: 0 0 8px #00ff88;
      }
      .vp-label-active .vp-apply-btn {
        background: rgba(0, 100, 60, 0.8);
        border-color: #00ff88;
        color: #ffffff;
      }
      .vp-label-actions {
        display: flex;
        gap: 3px;
        align-items: center;
        flex-shrink: 0;
      }
      .vp-edit-btn {
        background: rgba(0, 60, 80, 0.7);
        border: 1px solid #0088aa;
        color: #00ccff;
        padding: 2px 5px;
        font: bold 7px monospace;
        letter-spacing: 1px;
        cursor: pointer;
        transition: all 0.2s;
        pointer-events: auto;
      }
      .vp-edit-btn:hover {
        background: rgba(0, 100, 120, 0.8);
        box-shadow: 0 0 8px #00ccff;
      }
      .vp-delete-btn {
        background: rgba(80, 20, 20, 0.7);
        border: 1px solid #884444;
        color: #ff6666;
        padding: 2px 4px;
        font: bold 7px monospace;
        cursor: pointer;
        transition: all 0.2s;
        pointer-events: auto;
      }
      .vp-delete-btn:hover {
        background: rgba(120, 30, 30, 0.8);
        box-shadow: 0 0 8px #ff6666;
      }
      .vp-label-custom {
        border: 1px solid rgba(0, 180, 255, 0.3);
        border-radius: 2px;
      }
      .vp-label-custom .vp-label-name {
        color: #88ddff;
      }
      .vp-hint {
        color: #557777;
        font: 12px monospace;
        letter-spacing: 1px;
      }
      /* Playable demo overlay styles are inline in VisualPlaygroundDemo */
    `;
  }

  // -----------------------------------------------------------------------
  // Cell setup
  // -----------------------------------------------------------------------

  private buildCells(): void {
    this.disposeCells();

    for (let i = 0; i < this.allPresets.length; i++) {
      const preset = this.allPresets[i];
      const cell = this.createCell(preset, CELL_SIZE, CELL_SIZE);
      this.cells.push(cell);
    }
  }

  private createCell(
    preset: VisualPreset,
    width: number,
    height: number,
  ): CellData {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050510);

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 0, CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0x404080, 0.5);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.7);
    directional.position.set(5, 10, 5);
    scene.add(directional);

    // Surface
    const surface = SurfaceFactory.create(this.surfaceType, {
      gridColor: preset.gridColor,
      surfaceColor: preset.surfaceColor,
      surfaceOpacity: preset.wireframeOnly ? 0.0 : preset.surfaceOpacity,
      gridOpacity: preset.gridOpacity,
      gridSegmentsU: preset.gridSegmentsU,
      gridSegmentsV: preset.gridSegmentsV,
    } as any);

    // Scale surface to fit
    surface.mesh.geometry.computeBoundingSphere();
    const bs = surface.mesh.geometry.boundingSphere;
    const radius = bs ? bs.radius : 5;
    const scaleFactor = 3.0 / radius;
    surface.group.scale.setScalar(scaleFactor);
    scene.add(surface.group);

    // Apply wireframe-only
    if (preset.wireframeOnly) {
      surface.mesh.visible = false;
    }

    // Sektori glow: replace grid material with custom shader
    let sektoriMaterial: THREE.ShaderMaterial | null = null;
    let sektoriTrail: SektoriTrailManager | null = null;
    let playerDot: THREE.Mesh | null = null;

    if (preset.sektoriConfig) {
      sektoriMaterial = createSektoriGridMaterial(preset.sektoriConfig);
      sektoriTrail = new SektoriTrailManager(preset.sektoriConfig);

      // Replace the grid's LineBasicMaterial with the Sektori shader
      if (surface.gridMesh.material instanceof THREE.Material) {
        surface.gridMesh.material.dispose();
      }
      surface.gridMesh.material = sektoriMaterial;

      // Add a small glowing "player" dot that orbits the surface
      const dotGeo = new THREE.SphereGeometry(0.08, 8, 8);
      const glowColor = preset.sektoriConfig.glowColor ?? new THREE.Color(0x00ffff);
      const dotMat = new THREE.MeshBasicMaterial({
        color: glowColor,
        transparent: true,
        opacity: 0.9,
      });
      playerDot = new THREE.Mesh(dotGeo, dotMat);
      scene.add(playerDot);
    }

    // Demo enemies
    const enemyMeshes: THREE.Mesh[] = [];
    for (let e = 0; e < DEMO_ENEMY_UVS.length; e++) {
      const uv = DEMO_ENEMY_UVS[e];
      const color = DEMO_ENEMY_COLORS[e % DEMO_ENEMY_COLORS.length];
      const geo = new THREE.OctahedronGeometry(0.15, 0);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1.0 });
      const mesh = new THREE.Mesh(geo, mat);

      // Position on surface
      const sp: SurfacePoint = surface.getPoint(uv.u, uv.v);
      mesh.position.copy(sp.position).multiplyScalar(scaleFactor);
      mesh.position.addScaledVector(sp.normal, 0.1 * scaleFactor);

      scene.add(mesh);
      enemyMeshes.push(mesh);
    }

    // Composer for bloom
    const composer = new EffectComposer(this.renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (preset.bloomStrength > 0) {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        preset.bloomStrength,
        preset.bloomRadius ?? 0.4,
        preset.bloomThreshold ?? 0.85,
      );
      composer.addPass(bloom);
    }
    composer.addPass(new OutputPass());

    return {
      scene,
      camera,
      surface,
      enemyMeshes,
      composer,
      rotationAngle: Math.random() * Math.PI * 2,
      preset,
      sektoriMaterial,
      sektoriTrail,
      playerDot,
      scaleFactor,
    };
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  private attachEvents(): void {
    // Close button
    const closeBtn = this.overlay.querySelector('.vp-close-btn');
    closeBtn?.addEventListener('click', () => this.close());

    // Escape key (demo and editor handle their own Escape via stopPropagation)
    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // If demo or editor is open, let them handle it
        if (this.demoInstance) return;
        if (this.editorInstance) return;
        if (this.expandedIndex >= 0) {
          this.closeExpand();
        } else {
          this.close();
        }
      }
    };
    window.addEventListener('keydown', this.onKeyDown);

    // Surface selector
    const select = this.overlay.querySelector('.vp-surface-select') as HTMLSelectElement;
    select?.addEventListener('change', () => {
      this.surfaceType = select.value as SurfaceType;
      this.buildCells();
    });

    // Canvas click -> expand
    this.canvas.addEventListener('click', (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const canvasH = this.getCanvasHeight();
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = canvasH / rect.height;
      const px = x * scaleX;
      const py = y * scaleY;

      const cellTotalW = CELL_SIZE + CELL_PADDING;
      const cellTotalH = CELL_SIZE + CELL_PADDING;
      const col = Math.floor((px - CELL_PADDING) / cellTotalW);
      const row = Math.floor((py - CELL_PADDING) / cellTotalH);
      const rows = Math.ceil(this.allPresets.length / GRID_COLS);

      if (col >= 0 && col < GRID_COLS && row >= 0 && row < rows) {
        const idx = row * GRID_COLS + col;
        if (idx < this.allPresets.length) {
          this.openExpand(idx);
        }
      }
    });

    // Label name clicks (open demo)
    const labels = this.overlay.querySelectorAll('.vp-label-name');
    labels.forEach((label) => {
      label.addEventListener('click', (e) => {
        e.stopPropagation();
        const parent = (label as HTMLElement).closest('.vp-label') as HTMLElement;
        const idx = parseInt(parent?.dataset.index ?? '0', 10);
        this.openExpand(idx);
      });
    });

    // Apply button clicks (save as game setting)
    const applyBtns = this.overlay.querySelectorAll('.vp-apply-btn');
    applyBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.index ?? '0', 10);
        saveVisualStyle(idx);
        this.refreshActiveState();
      });
    });

    // Edit button clicks (open editor for the active style)
    const editBtns = this.overlay.querySelectorAll('.vp-edit-btn');
    editBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.index ?? '0', 10);
        this.openEditor(idx);
      });
    });

    // Delete button clicks (remove custom style)
    const deleteBtns = this.overlay.querySelectorAll('.vp-delete-btn');
    deleteBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.index ?? '0', 10);
        const preset = this.allPresets[idx];
        if (preset) {
          deleteCustomStyle(preset.name);
          this.rebuildPlayground();
        }
      });
    });
  }

  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  /** Update all label/button styles to reflect the currently active preset. */
  private refreshActiveState(): void {
    const activeIdx = getActiveStyleIndex();
    const labels = this.overlay.querySelectorAll('.vp-label');
    labels.forEach((label) => {
      const el = label as HTMLElement;
      const idx = parseInt(el.dataset.index ?? '-1', 10);
      const btn = el.querySelector('.vp-apply-btn') as HTMLElement;
      const actionsDiv = el.querySelector('.vp-label-actions') as HTMLElement;
      if (idx === activeIdx) {
        el.classList.add('vp-label-active');
        if (btn) btn.textContent = 'ACTIVE';
        // Add EDIT button if not already present
        if (actionsDiv && !actionsDiv.querySelector('.vp-edit-btn')) {
          const editBtn = document.createElement('button');
          editBtn.className = 'vp-edit-btn';
          editBtn.dataset.index = String(idx);
          editBtn.textContent = 'EDIT';
          editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openEditor(idx);
          });
          actionsDiv.insertBefore(editBtn, actionsDiv.firstChild);
        }
      } else {
        el.classList.remove('vp-label-active');
        if (btn) btn.textContent = 'APPLY';
        // Remove EDIT button if present
        const existingEdit = actionsDiv?.querySelector('.vp-edit-btn');
        if (existingEdit) existingEdit.remove();
      }
    });
  }

  // -----------------------------------------------------------------------
  // Expand view
  // -----------------------------------------------------------------------

  private openExpand(index: number): void {
    this.closeExpand();
    this.expandedIndex = index;
    const preset = this.allPresets[index];
    if (!preset) return;

    // Launch playable demo with this visual style
    this.closeDemoInstance();
    this.demoInstance = new VisualPlaygroundDemo(preset, this.surfaceType);
    this.demoInstance.onClose(() => {
      this.demoInstance = null;
      this.expandedIndex = -1;
    });
  }

  private closeDemoInstance(): void {
    if (this.demoInstance) {
      this.demoInstance.dispose();
      this.demoInstance = null;
    }
  }

  private closeExpand(): void {
    this.expandedIndex = -1;
    this.closeDemoInstance();
  }

  // -----------------------------------------------------------------------
  // Editor
  // -----------------------------------------------------------------------

  /** Open the style editor for the preset at the given index. */
  private openEditor(index: number): void {
    const preset = this.allPresets[index];
    if (!preset) return;

    this.closeEditorInstance();
    this.editorInstance = new VisualStyleEditor(preset);

    // Real-time preview: open a demo with the edited preset
    this.closeDemoInstance();
    this.demoInstance = new VisualPlaygroundDemo(preset, this.surfaceType);
    this.demoInstance.onClose(() => {
      // If the demo is closed directly, close the editor too
      this.demoInstance = null;
      this.closeEditorInstance();
    });

    this.editorInstance.onChange((updated) => {
      // Rebuild demo with updated preset for real-time preview
      this.closeDemoInstance();
      this.demoInstance = new VisualPlaygroundDemo(updated, this.surfaceType);
      this.demoInstance.onClose(() => {
        this.demoInstance = null;
        this.closeEditorInstance();
      });
    });

    this.editorInstance.onSave(() => {
      // After saving a custom style, rebuild the playground to show it
      this.rebuildPlayground();
    });

    this.editorInstance.onClose(() => {
      this.editorInstance = null;
      this.closeDemoInstance();
      this.expandedIndex = -1;
    });
  }

  private closeEditorInstance(): void {
    if (this.editorInstance) {
      this.editorInstance.dispose();
      this.editorInstance = null;
    }
  }

  /** Rebuild the entire playground UI (after adding/removing custom styles). */
  private rebuildPlayground(): void {
    this.rebuildAllPresets();
    this.disposeCells();

    // Rebuild HTML
    this.overlay.innerHTML = this.buildHTML();

    // Re-acquire canvas
    this.canvas = this.overlay.querySelector('.vp-canvas') as HTMLCanvasElement;
    this.renderer.dispose();
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: true,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(CANVAS_WIDTH, this.getCanvasHeight());
    this.renderer.autoClear = false;

    this.buildCells();
    this.attachEvents();
  }

  // -----------------------------------------------------------------------
  // Depth opacity update for enemies in a cell
  // -----------------------------------------------------------------------

  /**
   * Update a Sektori-enabled cell: simulate a player orbiting the surface
   * and update the shader uniforms + trail. Zero allocations.
   */
  private updateSektoriCell(cell: CellData, time: number): void {
    // Simulate a player moving across the surface in a Lissajous pattern
    const u = (Math.sin(time * 0.4) * 0.5 + 0.5) * 0.8 + 0.1;
    const v = (Math.cos(time * 0.3) * 0.5 + 0.5) * 0.8 + 0.1;

    const sp = cell.surface.getPoint(u, v);

    // Compute world position of simulated player (accounting for group transform)
    _tempPlayerPos.copy(sp.position).multiplyScalar(cell.scaleFactor);
    // Apply the group rotation to get world position
    _tempPlayerPos.applyEuler(cell.surface.group.rotation);

    // Offset slightly above surface
    _tempNormal.copy(sp.normal).multiplyScalar(cell.scaleFactor * 0.05);
    _tempNormal.applyEuler(cell.surface.group.rotation);
    _tempPlayerPos.add(_tempNormal);

    // Update the player dot visual
    if (cell.playerDot) {
      cell.playerDot.position.copy(_tempPlayerPos);
    }

    // Update shader uniforms
    updateSektoriUniforms(cell.sektoriMaterial!, _tempPlayerPos, time);

    // Record trail and update material
    cell.sektoriTrail!.recordPosition(_tempPlayerPos);
    cell.sektoriTrail!.updateMaterial(cell.sektoriMaterial!);
  }

  private updateEnemyDepth(cell: CellData): void {
    const curve = DEPTH_OPACITY_PRESETS[cell.preset.depthCurve] ?? DEPTH_OPACITY_PRESETS.steep;
    const camPos = cell.camera.position;

    // Approximate center of the surface (at origin after scaling)
    _tempCenter.set(0, 0, 0);

    for (const mesh of cell.enemyMeshes) {
      // Approximate outward normal: entity pos minus center
      _tempNormal.copy(mesh.position).sub(_tempCenter).normalize();

      const visibility = computeDepthVisibility(mesh.position, _tempNormal, camPos, curve);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = visibility;
      mesh.visible = visibility > 0.03;
    }
  }

  // -----------------------------------------------------------------------
  // Render loop
  // -----------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.animate();
  }

  /** Elapsed time for Sektori shader animation (seconds). */
  private elapsedTime = 0;
  private lastTimestamp = 0;

  private animate = (): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.animate);

    // Track elapsed time
    const now = performance.now() * 0.001;
    if (this.lastTimestamp === 0) this.lastTimestamp = now;
    this.elapsedTime += now - this.lastTimestamp;
    this.lastTimestamp = now;

    this.renderer.setScissorTest(true);

    for (let i = 0; i < this.cells.length; i++) {
      const cell = this.cells[i];
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);

      // Rotate surface
      cell.rotationAngle += 0.004;
      cell.surface.group.rotation.y = cell.rotationAngle;
      cell.surface.group.rotation.x = Math.sin(cell.rotationAngle * 0.7) * 0.15;

      // Update Sektori glow effect (simulated player orbiting surface)
      if (cell.sektoriMaterial && cell.sektoriTrail) {
        this.updateSektoriCell(cell, this.elapsedTime);
      }

      // Update depth opacity
      this.updateEnemyDepth(cell);

      // Compute viewport in canvas coordinates (bottom-left origin for GL)
      const x = CELL_PADDING + col * (CELL_SIZE + CELL_PADDING);
      const yFromTop = CELL_PADDING + row * (CELL_SIZE + CELL_PADDING);
      const canvasH = this.getCanvasHeight();
      const yGL = canvasH - yFromTop - CELL_SIZE;

      this.renderer.setViewport(x, yGL, CELL_SIZE, CELL_SIZE);
      this.renderer.setScissor(x, yGL, CELL_SIZE, CELL_SIZE);

      // Render with composer for bloom
      // EffectComposer uses the renderer's viewport internally
      cell.composer.setSize(CELL_SIZE, CELL_SIZE);
      cell.composer.render();
    }

    this.renderer.setScissorTest(false);
  };

  stop(): void {
    this.running = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  show(): void {
    // Rebuild in case custom styles changed since last open
    this.rebuildPlayground();
    this.overlay.style.display = 'flex';
    this.start();
  }

  close(): void {
    this.closeEditorInstance();
    this.closeDemoInstance();
    this.closeExpand();
    this.stop();
    this.overlay.style.display = 'none';
    this.closeCallback?.();
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  dispose(): void {
    this.closeEditorInstance();
    this.closeDemoInstance();
    this.closeExpand();
    this.stop();
    this.disposeCells();
    this.renderer.dispose();
    this.overlay.remove();
    this.styleElement.remove();
    if (this.onKeyDown) {
      window.removeEventListener('keydown', this.onKeyDown);
    }
  }

  private disposeCells(): void {
    for (const cell of this.cells) {
      cell.surface.dispose();
      cell.composer.dispose();
      if (cell.sektoriMaterial) {
        cell.sektoriMaterial.dispose();
      }
      if (cell.playerDot) {
        cell.playerDot.geometry.dispose();
        (cell.playerDot.material as THREE.Material).dispose();
      }
      for (const mesh of cell.enemyMeshes) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    }
    this.cells = [];
  }
}
