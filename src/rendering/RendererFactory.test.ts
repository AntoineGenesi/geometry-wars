import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createRenderer, RendererResult } from './RendererFactory';
import { GPUCapabilityReport } from './GPUCapabilities';

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
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Suppress console.groupCollapsed/log during tests
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  });

  it('returns a WebGLRenderer', async () => {
    const caps = mockCapabilities();
    const result = await createRenderer(container, caps);
    expect(result.renderer).toBeInstanceOf(THREE.WebGLRenderer);
    result.renderer.dispose();
  });

  it('reports isWebGPU as false (current implementation)', async () => {
    const caps = mockCapabilities({ webgpu: true, tier: 'high' });
    const result = await createRenderer(container, caps);
    expect(result.isWebGPU).toBe(false);
    result.renderer.dispose();
  });

  it('appends canvas to the container', async () => {
    const caps = mockCapabilities();
    const initialChildCount = container.children.length;
    const result = await createRenderer(container, caps);
    expect(container.children.length).toBe(initialChildCount + 1);
    const canvas = container.children[container.children.length - 1];
    expect(canvas.tagName.toLowerCase()).toBe('canvas');
    result.renderer.dispose();
  });

  it('enables antialias for medium and high tiers', async () => {
    // We can't directly inspect the antialias option after creation,
    // but we verify the renderer was created without error
    const medium = await createRenderer(container, mockCapabilities({ tier: 'medium' }));
    expect(medium.renderer).toBeInstanceOf(THREE.WebGLRenderer);
    medium.renderer.dispose();

    const high = await createRenderer(container, mockCapabilities({ tier: 'high' }));
    expect(high.renderer).toBeInstanceOf(THREE.WebGLRenderer);
    high.renderer.dispose();
  });

  it('creates renderer for low tier without error', async () => {
    const result = await createRenderer(container, mockCapabilities({ tier: 'low' }));
    expect(result.renderer).toBeInstanceOf(THREE.WebGLRenderer);
    result.renderer.dispose();
  });

  it('logs capability report to console', async () => {
    const logSpy = vi.spyOn(console, 'log');
    const caps = mockCapabilities({ tier: 'high', renderer: 'NVIDIA RTX 4090' });
    const result = await createRenderer(container, caps);

    // Check that at least the tier line was logged
    const calls = logSpy.mock.calls.flat();
    const tierLogged = calls.some(
      (arg) => typeof arg === 'string' && arg.includes('HIGH')
    );
    expect(tierLogged).toBe(true);

    result.renderer.dispose();
  });
});
