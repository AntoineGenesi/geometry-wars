// @vitest-environment jsdom
/**
 * Regression test: Settings GPU tab should show "Enable WebGPU" button
 * when WebGPU is detected but the active renderer is WebGL2.
 *
 * Bug (s44r6b-05): only a hint text "(add ?renderer=webgpu to URL)" was shown.
 * Fix: replace hint with a clickable button that reloads with ?renderer=webgpu.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock heavy dependencies before SettingsMenu is imported
// ---------------------------------------------------------------------------

vi.mock('../i18n', () => ({
  t: (key: string, _params?: Record<string, unknown>) => key,
}));

vi.mock('../rendering/GPUCapabilities', () => ({
  detectGPUCapabilities: vi.fn().mockResolvedValue({
    webgpu: true, webgl2: true, webgl1: true,
    maxTextureSize: 4096, maxInstanceCount: 2000,
    sharedArrayBuffer: false, hardwareConcurrency: 8,
    renderer: 'RTX 3080', vendor: 'NVIDIA',
    webgpuAdapter: 'NVIDIA GeForce RTX 3080', tier: 'high',
  }),
}));

vi.mock('../difficulty/DDASettings', () => ({
  loadDDASettings: vi.fn().mockReturnValue({ enabled: true }),
  saveDDASettings: vi.fn(),
}));

vi.mock('./VisualStyleSettings', () => ({
  getActiveStyleName: vi.fn().mockReturnValue('Default'),
  getActiveStyleIndex: vi.fn().mockReturnValue(0),
  clearVisualStyle: vi.fn(),
  saveVisualStyle: vi.fn(),
}));

vi.mock('./VisualPlayground', () => ({
  VISUAL_PRESETS: [{ name: 'Default', description: '', bloom: {}, particles: {} }],
}));

vi.mock('./VisualStyleEditor', () => ({
  loadCustomStyles: vi.fn().mockReturnValue([]),
}));

vi.mock('../core/MobileDetector', () => ({
  isMobile: vi.fn().mockReturnValue(false),
}));

vi.mock('./GPUBenchmark', () => ({}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { SettingsMenu } from './SettingsMenu';
import type { GPUCapabilityReport } from '../rendering/GPUCapabilities';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const webgpuAvailableReport: GPUCapabilityReport = {
  webgpu: true, webgl2: true, webgl1: true,
  maxTextureSize: 4096, maxInstanceCount: 10000,
  sharedArrayBuffer: false, hardwareConcurrency: 8,
  renderer: 'NVIDIA GeForce RTX 3080', vendor: 'NVIDIA',
  webgpuAdapter: 'NVIDIA GeForce RTX 3080', tier: 'high',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsMenu GPU tab — WebGPU toggle button (s44r6b-05)', () => {
  let menu: SettingsMenu;

  beforeEach(() => {
    menu = new SettingsMenu();
  });

  afterEach(() => {
    menu.dispose();
    vi.clearAllMocks();
  });

  it('shows enable-webgpu button when WebGPU detected but renderer is WebGL2', () => {
    menu.setGPUReport(webgpuAvailableReport);
    menu.setRendererInfo('webgl2', false);
    menu.show();

    // BUG (before fix): no button exists — only hint text in a <span>
    // FIX: button with id="enable-webgpu" must exist
    const btn = document.getElementById('enable-webgpu');
    expect(btn).not.toBeNull();
    expect(btn?.tagName.toLowerCase()).toBe('button');
  });

  it('does NOT show enable-webgpu button when WebGPU is already active', () => {
    const reportWithSAB: GPUCapabilityReport = { ...webgpuAvailableReport, sharedArrayBuffer: true };
    menu.setGPUReport(reportWithSAB);
    menu.setRendererInfo('webgpu', true);
    menu.show();

    const btn = document.getElementById('enable-webgpu');
    expect(btn).toBeNull();
  });

  it('does NOT show enable-webgpu button when WebGPU is not available', () => {
    const noWebGPUReport: GPUCapabilityReport = {
      ...webgpuAvailableReport,
      webgpu: false,
    };
    menu.setGPUReport(noWebGPUReport);
    menu.setRendererInfo('webgl2', false);
    menu.show();

    const btn = document.getElementById('enable-webgpu');
    expect(btn).toBeNull();
  });

  it('shows switch-to-webgl button when already using WebGPU', () => {
    const reportWithSAB: GPUCapabilityReport = { ...webgpuAvailableReport, sharedArrayBuffer: true };
    menu.setGPUReport(reportWithSAB);
    menu.setRendererInfo('webgpu', true);
    menu.show();

    const btn = document.getElementById('switch-to-webgl');
    expect(btn).not.toBeNull();
  });
});
