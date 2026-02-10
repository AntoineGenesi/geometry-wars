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
  /** GPU vendor string from WebGL or WebGPU (e.g. "Google Inc. (NVIDIA)"). */
  vendor: string;
  /** WebGPU adapter description if available (e.g. "NVIDIA GeForce RTX 3080"). */
  webgpuAdapter: string;
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
    vendor: 'unknown',
    webgpuAdapter: '',
    tier: 'low',
  };

  // -- SharedArrayBuffer --
  report.sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

  // -- Hardware concurrency --
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
    report.hardwareConcurrency = navigator.hardwareConcurrency;
  }

  // -- WebGPU detection (also extracts adapter info) --
  const webgpuInfo = await probeWebGPU();
  report.webgpu = webgpuInfo.available;
  report.webgpuAdapter = webgpuInfo.description;

  // -- WebGL detection (needs a canvas) --
  const glInfo = probeWebGL();
  report.webgl2 = glInfo.webgl2;
  report.webgl1 = glInfo.webgl1;
  report.maxTextureSize = glInfo.maxTextureSize;
  report.renderer = glInfo.renderer;
  report.vendor = glInfo.vendor;

  // If WebGL renderer came back masked/generic but WebGPU gave us real info, use it
  if (isGenericRenderer(report.renderer) && report.webgpuAdapter) {
    report.renderer = report.webgpuAdapter;
  }

  // -- Derive tier --
  report.tier = deriveTier(report);

  // -- Estimate instance capacity from tier --
  report.maxInstanceCount = estimateInstanceCount(report.tier);

  return report;
}

interface WebGPUProbeResult {
  available: boolean;
  /** Human-readable description from adapter info (e.g. "NVIDIA GeForce RTX 3080"). */
  description: string;
}

/**
 * Attempt to get a WebGPU adapter and extract hardware info.
 *
 * WebGPU's `requestAdapterInfo()` provides vendor/architecture/device/description
 * that is NOT subject to the same privacy restrictions as WebGL's
 * WEBGL_debug_renderer_info extension. Chrome 113+ exposes this reliably.
 */
async function probeWebGPU(): Promise<WebGPUProbeResult> {
  const result: WebGPUProbeResult = { available: false, description: '' };
  try {
    if (typeof navigator === 'undefined') return result;
    const gpu = (navigator as any).gpu;
    if (!gpu) return result;
    const adapter = await gpu.requestAdapter();
    if (!adapter) return result;
    result.available = true;

    // Extract adapter info -- available in Chrome 113+, Firefox Nightly, etc.
    // The API has evolved: older versions used requestAdapterInfo(), newer use .info
    try {
      let info: any = null;
      if (adapter.info) {
        // Modern API: adapter.info is a synchronous property (Chrome 121+)
        info = adapter.info;
      } else if (typeof adapter.requestAdapterInfo === 'function') {
        // Older API: requestAdapterInfo() returns a promise
        info = await adapter.requestAdapterInfo();
      }
      if (info) {
        // GPUAdapterInfo has: vendor, architecture, device, description
        const parts: string[] = [];
        if (info.vendor) parts.push(info.vendor);
        if (info.architecture) parts.push(info.architecture);
        if (info.device) parts.push(info.device);
        if (info.description) parts.push(info.description);
        result.description = parts.filter(Boolean).join(' - ') || '';
      }
    } catch {
      // Adapter info not available -- adapter itself still works
    }
  } catch {
    // WebGPU not available
  }
  return result;
}

/**
 * Probe WebGL2/1 support using an offscreen canvas.
 * Returns renderer string, vendor string, and max texture size.
 */
function probeWebGL(): {
  webgl2: boolean;
  webgl1: boolean;
  maxTextureSize: number;
  renderer: string;
  vendor: string;
} {
  const result = {
    webgl2: false,
    webgl1: false,
    maxTextureSize: 4096,
    renderer: 'unknown',
    vendor: 'unknown',
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
      const info = extractRendererAndVendor(gl2);
      result.renderer = info.renderer;
      result.vendor = info.vendor;
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
      const info = extractRendererAndVendor(gl1);
      result.renderer = info.renderer;
      result.vendor = info.vendor;
      return result;
    }
  } catch {
    // WebGL1 not available
  }

  return result;
}

/**
 * Extract the unmasked GPU renderer and vendor strings via WEBGL_debug_renderer_info.
 * Falls back to the standard RENDERER/VENDOR parameters.
 *
 * Note: Chrome 110+ deprecated WEBGL_debug_renderer_info for privacy.
 * The extension may return masked/generic strings like "WebKit WebGL" or
 * "Google Inc. (Google)". When this happens, the WebGPU adapter info
 * (queried separately) often provides the real hardware identity.
 */
function extractRendererAndVendor(gl: WebGLRenderingContext | WebGL2RenderingContext): {
  renderer: string;
  vendor: string;
} {
  let renderer = 'unknown';
  let vendor = 'unknown';

  // Try unmasked first (works on older Chrome, Firefox, and some configs)
  try {
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const unmaskedRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (typeof unmaskedRenderer === 'string' && unmaskedRenderer.length > 0) {
        renderer = unmaskedRenderer;
      }
      const unmaskedVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
      if (typeof unmaskedVendor === 'string' && unmaskedVendor.length > 0) {
        vendor = unmaskedVendor;
      }
    }
  } catch {
    // Extension not available (Chrome 110+ privacy restriction)
  }

  // Fall back to standard (masked) parameters
  if (renderer === 'unknown') {
    try {
      const r = gl.getParameter(gl.RENDERER);
      if (typeof r === 'string') renderer = r;
    } catch { /* ignore */ }
  }
  if (vendor === 'unknown') {
    try {
      const v = gl.getParameter(gl.VENDOR);
      if (typeof v === 'string') vendor = v;
    } catch { /* ignore */ }
  }

  return { renderer, vendor };
}

/**
 * Check if a renderer string is generic/masked (privacy-restricted).
 * Chrome 110+ returns strings like "WebKit WebGL", "Google Inc. (Google)",
 * or "ANGLE (Unknown)". These are not useful for identifying real hardware.
 */
function isGenericRenderer(renderer: string): boolean {
  if (!renderer || renderer === 'unknown') return true;
  const lower = renderer.toLowerCase();
  return (
    lower === 'webkit webgl' ||
    lower === 'webkit' ||
    lower.includes('(unknown)') ||
    lower === 'google inc.' ||
    lower === 'google inc. (google)' ||
    // Generic ANGLE without actual GPU name
    (lower === 'angle' || lower === 'angle (google)')
  );
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
