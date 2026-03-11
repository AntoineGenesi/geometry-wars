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

  // Verbose logging: show exactly what renderer will be selected and why.
  // This is the key diagnostic for "why isn't WebGPU activating?" questions.
  const urlRendererParam = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('renderer')
    : null;
  console.log(
    '[RendererFactory] Renderer selection:',
    'preference=' + preference,
    '| URL ?renderer=' + (urlRendererParam ?? '(none)'),
    '| WebGPU capable:', capabilities.webgpu,
  );

  // When ?testMode=true is in the URL, enable preserveDrawingBuffer
  // so automated tests can read canvas pixels via getImageData/toDataURL.
  const isTestMode = typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('testMode') === 'true';

  // ---- Attempt WebGPU if requested ----
  if (preference === 'webgpu') {
    console.log('[RendererFactory] Attempting WebGPU renderer initialization...');
    try {
      const result = await createWebGPURenderer(container, capabilities, isTestMode);
      if (result) {
        console.log('[RendererFactory] ✓ WebGPU renderer ACTIVE (backend:', result.backend, ')');
        return result;
      }
      console.error('[RendererFactory] createWebGPURenderer returned null — silent fallback to WebGL2');
      console.error('[RendererFactory] Check the logs above for the specific failure reason.');
    } catch (err) {
      console.error('[RendererFactory] WebGPU initialization threw, falling back to WebGL2:', err);
    }
  } else {
    console.log('[RendererFactory] WebGPU not selected (preference=' + preference + '). Using WebGL2.');
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
      console.error('[RendererFactory] three/webgpu module found but WebGPURenderer not exported');
      return null;
    }

    const renderer = new WebGPURenderer({
      antialias: capabilities.tier !== 'low',
      // Request discrete GPU on dual-GPU systems (e.g. laptop with Intel + NVIDIA).
      // The integrated GPU often lacks WebGPU support.
      powerPreference: 'high-performance',
    });

    renderer.setPixelRatio(getPixelRatio(capabilities.tier));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;

    container.appendChild(renderer.domElement);

    // Wait for the renderer to initialize (needed for WebGPU adapter request)
    await renderer.init();

    // CRITICAL: Detect if WebGPURenderer silently fell back to WebGL2.
    // Three.js WebGPURenderer.init() catches WebGPUBackend failures and swaps
    // this.backend to WebGLBackend without throwing. The isWebGPURenderer flag
    // stays true regardless. We must check the actual backend class.
    const actualBackend = (renderer as any).backend;
    const backendName = actualBackend?.constructor?.name ?? 'unknown';
    const actuallyUsingWebGPU = backendName === 'WebGPUBackend';

    if (!actuallyUsingWebGPU) {
      console.error(
        `[RendererFactory] WebGPURenderer created but fell back to ${backendName} internally.`
      );
      console.error(
        '[RendererFactory] This means WebGPU device creation failed at the GPU driver level.'
      );
      console.error(
        '[RendererFactory] Discarding WebGPU renderer and using clean WebGL2 instead.'
      );
      console.error(
        '[RendererFactory] To diagnose: open chrome://gpu and check "WebGPU" line.'
      );
      console.error(
        '[RendererFactory] Common fixes: update GPU driver, update Chrome, enable chrome://flags/#enable-unsafe-webgpu'
      );

      // Discard the silently-degraded renderer. Our own WebGL2 path has proper
      // EffectComposer + UnrealBloomPass which the WebGPU-turned-WebGL2 path lacks.
      try {
        container.removeChild(renderer.domElement);
        renderer.dispose();
      } catch { /* best effort cleanup */ }
      return null;
    }

    console.log(`[RendererFactory] Created WebGPU renderer (backend: ${backendName})`);
    return {
      renderer: renderer as unknown as THREE.WebGLRenderer,
      isWebGPU: true,
      backend: 'webgpu',
    };
  } catch (err) {
    console.error('[RendererFactory] WebGPU initialization failed:', err);
    console.error('[RendererFactory] Falling back to WebGL2. To diagnose WebGPU issues:');
    console.error('[RendererFactory]   1. Open chrome://gpu → check "WebGPU" status');
    console.error('[RendererFactory]   2. Run __webgpuDiagnostic() in the browser console');
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
 * Expose a browser-console diagnostic function for debugging WebGPU issues.
 * User can open DevTools console and type: __webgpuDiagnostic()
 */
export function installWebGPUDiagnostic(): void {
  if (typeof window === 'undefined') return;
  (window as any).__webgpuDiagnostic = async () => {
    console.log('%c=== WebGPU Diagnostic ===', 'font-size:14px;font-weight:bold;color:#4488ff');

    // Step 1: Check navigator.gpu
    const gpu = (navigator as any).gpu;
    if (!gpu) {
      console.log('%c FAIL: navigator.gpu not available', 'color:red;font-weight:bold');
      console.log('Your browser does not expose the WebGPU API.');
      console.log('Fixes:');
      console.log('  1. Update Chrome to version 113 or later');
      console.log('  2. Enable: chrome://flags/#enable-unsafe-webgpu');
      console.log('  3. Restart the browser');
      return;
    }
    console.log('%c PASS: navigator.gpu exists', 'color:green;font-weight:bold');

    // Step 2: Try high-performance adapter (discrete GPU)
    let adapter = null;
    try {
      adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    } catch (e) {
      console.log('%c FAIL: requestAdapter() threw an error:', 'color:red;font-weight:bold', e);
      return;
    }

    if (!adapter) {
      console.log('%c FAIL: requestAdapter({ powerPreference: "high-performance" }) returned null', 'color:red;font-weight:bold');
      console.log('Your high-performance GPU does not support WebGPU.');

      // Try default adapter as fallback diagnostic
      const defaultAdapter = await gpu.requestAdapter();
      if (defaultAdapter) {
        const info = defaultAdapter.info;
        console.log('%c INFO: Default adapter (no preference) succeeded:', 'color:orange;font-weight:bold');
        console.log('  Vendor:', info?.vendor);
        console.log('  Architecture:', info?.architecture);
        console.log('  Device:', info?.device);
        console.log('  Description:', info?.description);
        console.log('This means your integrated GPU supports WebGPU but your discrete GPU does not.');
        console.log('We can use the default adapter instead.');
      } else {
        console.log('Default adapter also returned null. No WebGPU support on any GPU.');
        console.log('Fixes:');
        console.log('  1. Update your GPU driver from the manufacturer website');
        console.log('  2. Check chrome://gpu for "WebGPU" status');
        console.log('  3. Your GPU may be on Chrome\'s blocklist');
      }
      return;
    }

    // Log adapter info
    const info = adapter.info;
    console.log('%c PASS: Adapter obtained', 'color:green;font-weight:bold');
    console.log('  Vendor:', info?.vendor);
    console.log('  Architecture:', info?.architecture);
    console.log('  Device:', info?.device);
    console.log('  Description:', info?.description);
    console.log('  Features:', [...adapter.features].join(', '));

    // Step 3: Try creating a device
    try {
      const device = await adapter.requestDevice();
      console.log('%c PASS: Device created successfully', 'color:green;font-weight:bold');
      console.log('WebGPU SHOULD work for this game.');
      console.log('If the game is still using WebGL2, try adding ?renderer=webgpu to the URL.');
      device.destroy();
    } catch (e) {
      console.log('%c FAIL: requestDevice() failed:', 'color:red;font-weight:bold', e);
      console.log('Adapter exists but device creation failed. This usually means:');
      console.log('  - GPU driver is too old for WebGPU device features');
      console.log('  - Chrome has blocklisted this specific driver version');
      console.log('  Fix: Update your GPU driver to the latest version');
    }
  };
}

/**
 * Log the capability report to console for developer visibility.
 */
function logCapabilities(cap: GPUCapabilityReport): void {
  const webgpuStatus = cap.webgpu
    ? `available (adapter: ${cap.webgpuAdapter || 'unknown'})`
    : 'NOT AVAILABLE — run __webgpuDiagnostic() in console for details';

  const lines = [
    `[GPUCapabilities] Tier: ${cap.tier.toUpperCase()}`,
    `  WebGPU: ${webgpuStatus}`,
    `  WebGL2: ${cap.webgl2 ? 'available' : 'unavailable'}`,
    `  GPU: ${cap.renderer}`,
    `  Max texture: ${cap.maxTextureSize}`,
    `  Max instances: ${cap.maxInstanceCount}`,
    `  CPU cores: ${cap.hardwareConcurrency}`,
    `  SharedArrayBuffer: ${cap.sharedArrayBuffer ? 'yes' : 'no'}`,
  ];

  if (!cap.webgpu) {
    lines.push('');
    lines.push('  [!] WebGPU not available. Possible causes:');
    lines.push('      - GPU driver does not support WebGPU (update driver)');
    lines.push('      - Chrome version < 113 (update Chrome)');
    lines.push('      - WebGPU disabled: check chrome://flags/#enable-unsafe-webgpu');
    lines.push('      - GPU on Chrome blocklist: check chrome://gpu');
    lines.push('  [!] Run __webgpuDiagnostic() in console for step-by-step diagnosis');
  }

  // Use a single grouped log to keep the console tidy
  try {
    if (cap.webgpu) {
      console.groupCollapsed('[GPUCapabilities] Detection Report');
    } else {
      // Expand the group when WebGPU is unavailable so the user sees it immediately
      console.group('[GPUCapabilities] Detection Report');
    }
    for (const line of lines) {
      console.log(line);
    }
    console.groupEnd();
  } catch {
    for (const line of lines) {
      console.log(line);
    }
  }
}
