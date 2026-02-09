/**
 * Renderer factory -- creates the appropriate Three.js renderer based
 * on detected GPU capabilities.
 *
 * Currently always returns a WebGLRenderer because Three.js WebGPU
 * renderer is still experimental. The factory pattern means we can swap
 * in WebGPURenderer later without touching Game.ts.
 *
 * The factory also logs the capability report so developers can see
 * what was detected at startup.
 */

import * as THREE from 'three';
import { GPUCapabilityReport } from './GPUCapabilities';

export interface RendererResult {
  /** The Three.js renderer instance. */
  renderer: THREE.WebGLRenderer;
  /** Whether this is backed by WebGPU (false for now). */
  isWebGPU: boolean;
}

/**
 * Create a Three.js renderer using the detected capabilities.
 *
 * @param container - DOM element to attach the canvas to.
 * @param capabilities - Previously detected GPU capability report.
 * @returns The renderer and a flag indicating the backend.
 */
export async function createRenderer(
  container: HTMLElement,
  capabilities: GPUCapabilityReport,
): Promise<RendererResult> {
  logCapabilities(capabilities);

  // Future: when Three.js WebGPURenderer is stable and capabilities.webgpu
  // is true, create a WebGPURenderer here instead.

  // When ?testMode=true is in the URL, enable preserveDrawingBuffer
  // so automated tests can read canvas pixels via getImageData/toDataURL.
  const isTestMode = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('testMode') === 'true';

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

  return { renderer, isWebGPU: false };
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
