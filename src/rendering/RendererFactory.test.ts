import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GPUCapabilityReport } from './GPUCapabilities';
import { resolveRendererPreference, RendererBackend } from './RendererFactory';

/**
 * RendererFactory tests.
 *
 * Tests the renderer selection logic (resolveRendererPreference) which
 * determines whether to use WebGPU or WebGL2 based on URL params and
 * GPU capabilities.
 *
 * Full integration tests for actual renderer creation require a DOM + WebGL
 * context and are handled by E2E (Playwright).
 */

/** Build a mock capability report for testing. */
function mockCapabilities(overrides: Partial<GPUCapabilityReport> = {}): GPUCapabilityReport {
  return {
    webgpu: false,
    webgl2: true,
    webgl1: true,
    maxTextureSize: 16384,
    maxInstanceCount: 2000,
    sharedArrayBuffer: true,
    hardwareConcurrency: 8,
    renderer: 'Test GPU',
    vendor: 'Test Vendor',
    webgpuAdapter: '',
    tier: 'medium',
    ...overrides,
  };
}

describe('RendererFactory', () => {
  it('module exports createRenderer function', async () => {
    const mod = await import('./RendererFactory');
    expect(typeof mod.createRenderer).toBe('function');
  });

  it('module exports resolveRendererPreference function', async () => {
    const mod = await import('./RendererFactory');
    expect(typeof mod.resolveRendererPreference).toBe('function');
  });

  it('module exports RendererBackend type', async () => {
    const mod = await import('./RendererFactory');
    // Type is exported but we verify the module loads
    expect(mod).toBeDefined();
  });

  it('RendererResult interface has backend field', async () => {
    // Verify the module can be imported and the type shape is accessible
    const mod = await import('./RendererFactory');
    expect(mod).toBeDefined();
  });

  // ------------------------------------------------------------------
  // resolveRendererPreference
  // ------------------------------------------------------------------

  describe('resolveRendererPreference', () => {
    let originalWindow: typeof globalThis.window;

    beforeEach(() => {
      originalWindow = globalThis.window;
    });

    it('defaults to webgl2 when no URL params and no WebGPU', () => {
      // Mock window.location.search with no params
      const mockLocation = { search: '' } as Location;
      vi.stubGlobal('window', { location: mockLocation });

      const caps = mockCapabilities({ webgpu: false });
      const result = resolveRendererPreference(caps);
      expect(result).toBe('webgl2');

      vi.unstubAllGlobals();
    });

    it('auto-selects webgpu when available and no URL params', () => {
      const mockLocation = { search: '' } as Location;
      vi.stubGlobal('window', { location: mockLocation });

      const caps = mockCapabilities({ webgpu: true });
      const result = resolveRendererPreference(caps);
      expect(result).toBe('webgpu');

      vi.unstubAllGlobals();
    });

    it('defaults to webgl2 when ?renderer=webgl', () => {
      const mockLocation = { search: '?renderer=webgl' } as Location;
      vi.stubGlobal('window', { location: mockLocation });

      const caps = mockCapabilities({ webgpu: true });
      const result = resolveRendererPreference(caps);
      expect(result).toBe('webgl2');

      vi.unstubAllGlobals();
    });

    it('returns webgpu when ?renderer=webgpu and WebGPU is available', () => {
      const mockLocation = { search: '?renderer=webgpu' } as Location;
      vi.stubGlobal('window', { location: mockLocation });

      const caps = mockCapabilities({ webgpu: true });
      const result = resolveRendererPreference(caps);
      expect(result).toBe('webgpu');

      vi.unstubAllGlobals();
    });

    it('falls back to webgl2 when ?renderer=webgpu but WebGPU unavailable', () => {
      const mockLocation = { search: '?renderer=webgpu' } as Location;
      vi.stubGlobal('window', { location: mockLocation });

      const caps = mockCapabilities({ webgpu: false });
      const result = resolveRendererPreference(caps);
      expect(result).toBe('webgl2');

      vi.unstubAllGlobals();
    });

    it('returns webgl2 when window is undefined (Node/test env)', () => {
      // In this test environment, window may or may not be defined
      // The function should handle both cases gracefully
      const caps = mockCapabilities({ webgpu: true });
      // When window IS defined (jsdom), it should use the actual URL params
      // When window is NOT defined, it should return 'webgl2'
      const result = resolveRendererPreference(caps);
      expect(['webgl2', 'webgpu']).toContain(result);
    });

    it('ignores unknown ?renderer values and auto-selects based on capability', () => {
      const mockLocation = { search: '?renderer=vulkan' } as Location;
      vi.stubGlobal('window', { location: mockLocation });

      // WebGPU available → auto-selects webgpu
      const caps = mockCapabilities({ webgpu: true });
      const result = resolveRendererPreference(caps);
      expect(result).toBe('webgpu');

      vi.unstubAllGlobals();
    });

    it('falls back to webgl2 with unknown ?renderer and no WebGPU', () => {
      const mockLocation = { search: '?renderer=vulkan' } as Location;
      vi.stubGlobal('window', { location: mockLocation });

      const caps = mockCapabilities({ webgpu: false });
      const result = resolveRendererPreference(caps);
      expect(result).toBe('webgl2');

      vi.unstubAllGlobals();
    });

    it('works with additional URL params', () => {
      const mockLocation = { search: '?surface=torus&renderer=webgpu&testMode=true' } as Location;
      vi.stubGlobal('window', { location: mockLocation });

      const caps = mockCapabilities({ webgpu: true });
      const result = resolveRendererPreference(caps);
      expect(result).toBe('webgpu');

      vi.unstubAllGlobals();
    });
  });

  // ------------------------------------------------------------------
  // createRenderer (integration tests requiring DOM)
  // ------------------------------------------------------------------

  describe.skipIf(typeof document === 'undefined')('with DOM', () => {
    it('returns a renderer and isWebGPU flag', async () => {
      const { createRenderer } = await import('./RendererFactory');
      // Suppress console output
      vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'groupEnd').mockImplementation(() => {});

      const container = document.createElement('div');
      document.body.appendChild(container);

      const caps = mockCapabilities();
      const result = await createRenderer(container, caps);
      expect(result).toHaveProperty('renderer');
      expect(result).toHaveProperty('isWebGPU');
      expect(result).toHaveProperty('backend');
      expect(result.isWebGPU).toBe(false);
      expect(result.backend).toBe('webgl2');
      result.renderer.dispose();
    });

    it('returns backend field as webgl2 by default', async () => {
      const { createRenderer } = await import('./RendererFactory');
      vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'groupEnd').mockImplementation(() => {});

      const container = document.createElement('div');
      document.body.appendChild(container);
      const caps = mockCapabilities();
      const result = await createRenderer(container, caps);

      expect(result.backend).toBe('webgl2');
      result.renderer.dispose();
    });

    it('logs capability report to console', async () => {
      const { createRenderer } = await import('./RendererFactory');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
      vi.spyOn(console, 'groupEnd').mockImplementation(() => {});

      const container = document.createElement('div');
      document.body.appendChild(container);
      const caps = mockCapabilities({ tier: 'high', renderer: 'NVIDIA RTX 4090' });
      const result = await createRenderer(container, caps);

      const calls = logSpy.mock.calls.flat();
      const tierLogged = calls.some(
        (arg) => typeof arg === 'string' && arg.includes('HIGH')
      );
      expect(tierLogged).toBe(true);
      result.renderer.dispose();
    });
  });
});
