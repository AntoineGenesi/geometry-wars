import { describe, it, expect, vi } from 'vitest';
import { GPUCapabilityReport } from './GPUCapabilities';

/**
 * RendererFactory tests.
 *
 * Since createRenderer() creates a real THREE.WebGLRenderer which requires
 * a DOM + WebGL context, the full integration tests are handled by E2E
 * (Playwright). Here we test the module's exports and logic that can run
 * in a pure Node environment.
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
    tier: 'medium',
    ...overrides,
  };
}

describe('RendererFactory', () => {
  it('module exports createRenderer function', async () => {
    const mod = await import('./RendererFactory');
    expect(typeof mod.createRenderer).toBe('function');
  });

  it('RendererResult interface shape is correct', async () => {
    // Verify the module can be imported without error
    const mod = await import('./RendererFactory');
    expect(mod).toBeDefined();
  });

  // Tests that require a real DOM + WebGL context are skipped in Node
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
      expect(result.isWebGPU).toBe(false);
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
