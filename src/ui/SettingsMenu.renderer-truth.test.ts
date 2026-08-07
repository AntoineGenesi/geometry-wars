import { describe, expect, it } from 'vitest';

import { buildRendererDisplayState } from './SettingsMenu';

describe('buildRendererDisplayState', () => {
  it('shows requested WebGPU separately from WebGL2 fallback when WebGPU was available', () => {
    const state = buildRendererDisplayState({
      requestedRendererParam: 'webgpu',
      actualIsWebGPU: false,
      webgpuAvailable: true,
    });

    expect(state.requestedRendererLabel).toBe('WebGPU');
    expect(state.actualRendererLabel).toBe('WebGL2');
    expect(state.webgpuStatus).toBe('fallback');
    expect(state.webgpuStatusLabel).toBe('WebGPU requested, fallback active');
    expect(state.webgpuRequestDidNotActivate).toBe(true);
    expect(state.showWebGPURetry).toBe(true);
    expect(state.showWebGLSwitch).toBe(true);
  });

  it('marks a requested WebGPU fallback as unavailable when capability detection rejects WebGPU', () => {
    const state = buildRendererDisplayState({
      requestedRendererParam: 'webgpu',
      actualIsWebGPU: false,
      webgpuAvailable: false,
    });

    expect(state.requestedRendererLabel).toBe('WebGPU');
    expect(state.actualRendererLabel).toBe('WebGL2');
    expect(state.webgpuStatus).toBe('unavailable-requested');
    expect(state.webgpuStatusLabel).toBe('WebGPU requested, unavailable');
    expect(state.webgpuStatusDetail).toContain('not currently usable');
    expect(state.showWebGPURetry).toBe(false);
    expect(state.showWebGLSwitch).toBe(true);
  });

  it('keeps labels aligned when actual WebGPU is active', () => {
    const state = buildRendererDisplayState({
      requestedRendererParam: 'webgpu',
      actualIsWebGPU: true,
      webgpuAvailable: true,
    });

    expect(state.requestedRendererLabel).toBe('WebGPU');
    expect(state.actualRendererLabel).toBe('WebGPU');
    expect(state.webgpuStatus).toBe('active');
    expect(state.webgpuStatusLabel).toBe('WebGPU active');
    expect(state.webgpuRequestDidNotActivate).toBe(false);
    expect(state.showWebGPURetry).toBe(false);
    expect(state.showWebGLSwitch).toBe(true);
  });

  it('shows safe auto/WebGL2 state when no renderer was requested', () => {
    const state = buildRendererDisplayState({
      requestedRendererParam: null,
      actualIsWebGPU: false,
      webgpuAvailable: false,
    });

    expect(state.requestedRendererValue).toBe('auto');
    expect(state.requestedRendererLabel).toBe('Auto');
    expect(state.actualRendererLabel).toBe('WebGL2');
    expect(state.webgpuStatus).toBe('unavailable');
    expect(state.webgpuRequestDidNotActivate).toBe(false);
    expect(state.showWebGPURetry).toBe(false);
    expect(state.showWebGLSwitch).toBe(false);
  });
});
