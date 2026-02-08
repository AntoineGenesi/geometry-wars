/**
 * GPU capability detection for adaptive rendering quality.
 *
 * Probes the browser for WebGPU, WebGL2/1 support, GPU hardware info,
 * and available concurrency. Returns a structured report used by
 * RendererFactory and EntityLimits to choose appropriate settings.
 *
 * Designed to degrade gracefully in test environments (Node/jsdom)
 * where canvas and GPU APIs are unavailable.
 */

export interface GPUCapabilityReport {
  /** Whether navigator.gpu exists and an adapter was obtained. */
  webgpu: boolean;
  /** Whether a WebGL2 rendering context is available. */
  webgl2: boolean;
  /** Whether a WebGL1 rendering context is available. */
  webgl1: boolean;
  /** Maximum texture dimension supported by the GPU. */
  maxTextureSize: number;
  /** Estimated max instance count the GPU can handle smoothly. */
  maxInstanceCount: number;
  /** Whether SharedArrayBuffer is available (requires COOP/COEP). */
  sharedArrayBuffer: boolean;
  /** Number of logical CPU cores available for workers. */
  hardwareConcurrency: number;
  /** GPU renderer string (e.g. "ANGLE (NVIDIA GeForce RTX 3080)"). */
  renderer: string;
  /** Overall capability tier derived from the above. */
  tier: 'high' | 'medium' | 'low';
}

/**
 * Detect GPU and browser capabilities.
 *
 * This is async because WebGPU adapter detection requires a promise.
 * Safe to call in any environment -- returns sensible defaults when
 * APIs are missing.
 */
export async function detectGPUCapabilities(): Promise<GPUCapabilityReport> {
  const report: GPUCapabilityReport = {
    webgpu: false,
    webgl2: false,
    webgl1: false,
    maxTextureSize: 4096,
    maxInstanceCount: 1000,
    sharedArrayBuffer: false,
    hardwareConcurrency: 1,
    renderer: 'unknown',
    tier: 'low',
  };

  // -- SharedArrayBuffer --
  report.sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

  // -- Hardware concurrency --
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
    report.hardwareConcurrency = navigator.hardwareConcurrency;
  }

  // -- WebGPU detection --
  report.webgpu = await probeWebGPU();

  // -- WebGL detection (needs a canvas) --
  const glInfo = probeWebGL();
  report.webgl2 = glInfo.webgl2;
  report.webgl1 = glInfo.webgl1;
  report.maxTextureSize = glInfo.maxTextureSize;
  report.renderer = glInfo.renderer;

  // -- Derive tier --
  report.tier = deriveTier(report);

  // -- Estimate instance capacity from tier --
  report.maxInstanceCount = estimateInstanceCount(report.tier);

  return report;
}

/**
 * Attempt to get a WebGPU adapter. Returns true if successful.
 */
async function probeWebGPU(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false;
    const gpu = (navigator as any).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return adapter !== null && adapter !== undefined;
  } catch {
    return false;
  }
}

/**
 * Probe WebGL2/1 support using an offscreen canvas.
 * Returns renderer string and max texture size.
 */
function probeWebGL(): {
  webgl2: boolean;
  webgl1: boolean;
  maxTextureSize: number;
  renderer: string;
} {
  const result = {
    webgl2: false,
    webgl1: false,
    maxTextureSize: 4096,
    renderer: 'unknown',
  };

  // Need canvas API
  if (typeof document === 'undefined') return result;

  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement('canvas');
  } catch {
    return result;
  }

  // Try WebGL2 first
  try {
    const gl2 = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (gl2) {
      result.webgl2 = true;
      result.webgl1 = true; // WebGL2 implies WebGL1 support
      result.maxTextureSize = gl2.getParameter(gl2.MAX_TEXTURE_SIZE) as number;
      result.renderer = extractRendererString(gl2);
      return result;
    }
  } catch {
    // WebGL2 not available
  }

  // Fall back to WebGL1
  try {
    const gl1 = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (gl1) {
      result.webgl1 = true;
      result.maxTextureSize = gl1.getParameter(gl1.MAX_TEXTURE_SIZE) as number;
      result.renderer = extractRendererString(gl1);
      return result;
    }
  } catch {
    // WebGL1 not available
  }

  return result;
}

/**
 * Extract the unmasked GPU renderer string via WEBGL_debug_renderer_info.
 * Falls back to the standard RENDERER parameter.
 */
function extractRendererString(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  try {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const unmasked = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (typeof unmasked === 'string' && unmasked.length > 0) {
        return unmasked;
      }
    }
  } catch {
    // Extension not available
  }

  try {
    const renderer = gl.getParameter(gl.RENDERER);
    if (typeof renderer === 'string') {
      return renderer;
    }
  } catch {
    // Fallback
  }

  return 'unknown';
}

/**
 * Derive an overall capability tier from the detection results.
 *
 * - high: WebGPU available + 4+ CPU cores
 * - medium: WebGL2 + 2+ cores OR any WebGL + high-end GPU string
 * - low: everything else
 */
function deriveTier(report: GPUCapabilityReport): 'high' | 'medium' | 'low' {
  if (report.webgpu && report.hardwareConcurrency >= 4) {
    return 'high';
  }

  if (report.webgl2 && report.hardwareConcurrency >= 2) {
    return 'medium';
  }

  if (report.webgl2 && report.maxTextureSize >= 8192) {
    return 'medium';
  }

  if (report.webgl1) {
    return 'low';
  }

  return 'low';
}

/**
 * Estimate how many instances the GPU can handle at 60fps.
 */
function estimateInstanceCount(tier: 'high' | 'medium' | 'low'): number {
  switch (tier) {
    case 'high': return 10000;
    case 'medium': return 2000;
    case 'low': return 500;
  }
}
