/**
 * Renderer factory -- creates the appropriate Three.js renderer based
 * on detected GPU capabilities and URL parameters.
 *
 * Supports two rendering backends:
 *   - WebGPU (default when available): Uses WebGPURenderer + TSL PostProcessing
 *   - WebGL2 (fallback): Uses THREE.WebGLRenderer + EffectComposer + UnrealBloomPass
 *
 * URL parameters:
 *   ?renderer=webgpu  - Force WebGPU renderer
 *   ?renderer=webgl   - Force WebGL2 renderer
 *   ?testMode=true    - Enable preserveDrawingBuffer for automated testing
 *
 * The factory also logs the capability report so developers can see
 * what was detected at startup.
 */

import * as THREE from 'three';
import { GPUCapabilityReport } from './GPUCapabilities';

/** Which rendering backend is active. */
export type RendererBackend = 'webgpu' | 'webgl2';

export interface RendererResult {
  /** The Three.js renderer instance (WebGLRenderer or WebGPURenderer). */
  renderer: THREE.WebGLRenderer;
  /** Whether this is backed by WebGPU. */
  isWebGPU: boolean;
  /** Descriptive string for the active backend. */
  backend: RendererBackend;
}

/**
 * Determine which renderer the user wants based on URL params and capabilities.
 *
 * Exported for testing -- the actual renderer creation uses this internally.
 */
export function resolveRendererPreference(
  capabilities: GPUCapabilityReport,
): RendererBackend {
  if (typeof window === 'undefined') return 'webgl2';

  const params = new URLSearchParams(window.location.search);
  const pref = params.get('renderer');

  // Explicit URL override
  if (pref === 'webgl') return 'webgl2';
  if (pref === 'webgpu' && capabilities.webgpu) return 'webgpu';

  // Auto-select: prefer WebGPU when available
  if (capabilities.webgpu) {
    return 'webgpu';
  }

  return 'webgl2';
}

/**
 * Create a Three.js renderer using the detected capabilities.
 *
 * @param container - DOM element to attach the canvas to.
 * @param capabilities - Previously detected GPU capability report.
 * @returns The renderer, backend info, and isWebGPU flag.
 */
export async function createRenderer(
  container: HTMLElement,
  capabilities: GPUCapabilityReport,
): Promise<RendererResult> {
  logCapabilities(capabilities);

  const preference = resolveRendererPreference(capabilities);

  // When ?testMode=true is in the URL, enable preserveDrawingBuffer
  // so automated tests can read canvas pixels via getImageData/toDataURL.
  const isTestMode = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('testMode') === 'true';

  // ---- Attempt WebGPU if requested ----
  if (preference === 'webgpu') {
    try {
      const result = await createWebGPURenderer(container, capabilities, isTestMode);
      if (result) return result;
    } catch (err) {
      console.warn('[RendererFactory] WebGPU initialization failed, falling back to WebGL2:', err);
    }
  }

  // ---- Default: WebGL2 ----
  return createWebGLRenderer(container, capabilities, isTestMode);
}

/**
 * Create a standard WebGL2 renderer. This is the default, battle-tested path.
 */
function createWebGLRenderer(
  container: HTMLElement,
  capabilities: GPUCapabilityReport,
  isTestMode: boolean,
): RendererResult {
  const renderer = new THREE.WebGLRenderer({
    antialias: capabilities.tier !== 'low',
    powerPreference: 'high-performance',
    ...(isTestMode ? { preserveDrawingBuffer: true } : {}),
  });

  renderer.setPixelRatio(getPixelRatio(capabilities.tier));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;

  container.appendChild(renderer.domElement);

  console.log('[RendererFactory] Created WebGL2 renderer');
  return { renderer, isWebGPU: false, backend: 'webgl2' };
}

/**
 * Attempt to create a WebGPU renderer using Three.js WebGPURenderer.
 *
 * WebGPURenderer uses a completely different class hierarchy from WebGLRenderer:
 *   - Extends Renderer (common base), NOT WebGLRenderer
 *   - Uses node-based PostProcessing instead of EffectComposer
 *   - Has built-in WebGL2 fallback via getFallback parameter
 *
 * We return the WebGPURenderer cast to WebGLRenderer for type compatibility
 * with the rest of the codebase. The APIs used by Game.ts (setSize, setPixelRatio,
 * render, domElement, toneMapping, toneMappingExposure, dispose, info) are all
 * available on both renderer types.
 *
 * Returns null if WebGPU module cannot be loaded.
 */
async function createWebGPURenderer(
  container: HTMLElement,
  capabilities: GPUCapabilityReport,
  _isTestMode: boolean,
): Promise<RendererResult | null> {
  try {
    // Dynamic import of the WebGPU module -- this is a separate bundle
    const WebGPUModule = await import('three/webgpu');
    const WebGPURenderer = WebGPUModule.WebGPURenderer;

    if (!WebGPURenderer) {
      console.warn('[RendererFactory] three/webgpu module found but WebGPURenderer not exported');
      return null;
    }

    const renderer = new WebGPURenderer({
      antialias: capabilities.tier !== 'low',
      // WebGPURenderer automatically falls back to WebGL2 backend if WebGPU
      // is not available at the browser/driver level
    });

    renderer.setPixelRatio(getPixelRatio(capabilities.tier));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;

    container.appendChild(renderer.domElement);

    // Wait for the renderer to initialize (needed for WebGPU adapter request)
    await renderer.init();

    console.log('[RendererFactory] Created WebGPU renderer');
    // Cast to WebGLRenderer for type compatibility -- the API surface we use
    // (setSize, setPixelRatio, render, domElement, dispose, info) is identical
    return {
      renderer: renderer as unknown as THREE.WebGLRenderer,
      isWebGPU: true,
      backend: 'webgpu',
    };
  } catch (err) {
    console.warn('[RendererFactory] Failed to load three/webgpu module:', err);
    return null;
  }
}

/**
 * Choose pixel ratio based on tier to avoid GPU overload on low-end devices.
 */
function getPixelRatio(tier: 'high' | 'medium' | 'low'): number {
  const deviceRatio = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  switch (tier) {
    case 'high': return Math.min(deviceRatio, 2);
    case 'medium': return Math.min(deviceRatio, 1.5);
    case 'low': return 1;
  }
}

/**
 * Log the capability report to console for developer visibility.
 */
function logCapabilities(cap: GPUCapabilityReport): void {
  const lines = [
    `[GPUCapabilities] Tier: ${cap.tier.toUpperCase()}`,
    `  WebGPU: ${cap.webgpu ? 'available' : 'unavailable'}`,
    `  WebGL2: ${cap.webgl2 ? 'available' : 'unavailable'}`,
    `  WebGL1: ${cap.webgl1 ? 'available' : 'unavailable'}`,
    `  GPU: ${cap.renderer}`,
    `  Max texture: ${cap.maxTextureSize}`,
    `  Max instances: ${cap.maxInstanceCount}`,
    `  CPU cores: ${cap.hardwareConcurrency}`,
    `  SharedArrayBuffer: ${cap.sharedArrayBuffer ? 'yes' : 'no'}`,
  ];

  // Use a single grouped log to keep the console tidy
  try {
    console.groupCollapsed('[GPUCapabilities] Detection Report');
    for (const line of lines) {
      console.log(line);
    }
    console.groupEnd();
  } catch {
    // Fallback for environments without console.group
    for (const line of lines) {
      console.log(line);
    }
  }
}
