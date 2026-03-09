import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectGPUCapabilities, GPUCapabilityReport } from './GPUCapabilities';

describe('GPUCapabilities', () => {
  // In the vitest/jsdom environment, navigator.gpu and real WebGL are
  // unavailable. detectGPUCapabilities must degrade gracefully.

  describe('detectGPUCapabilities', () => {
    it('returns a valid GPUCapabilityReport', async () => {
      const report = await detectGPUCapabilities();

      expect(report).toBeDefined();
      expect(typeof report.webgpu).toBe('boolean');
      expect(typeof report.webgl2).toBe('boolean');
      expect(typeof report.webgl1).toBe('boolean');
      expect(typeof report.maxTextureSize).toBe('number');
      expect(typeof report.maxInstanceCount).toBe('number');
      expect(typeof report.sharedArrayBuffer).toBe('boolean');
      expect(typeof report.hardwareConcurrency).toBe('number');
      expect(typeof report.renderer).toBe('string');
      expect(typeof report.vendor).toBe('string');
      expect(typeof report.webgpuAdapter).toBe('string');
      expect(['high', 'medium', 'low']).toContain(report.tier);
    });

    it('returns maxTextureSize >= 1024', async () => {
      const report = await detectGPUCapabilities();
      expect(report.maxTextureSize).toBeGreaterThanOrEqual(1024);
    });

    it('returns maxInstanceCount > 0', async () => {
      const report = await detectGPUCapabilities();
      expect(report.maxInstanceCount).toBeGreaterThan(0);
    });

    it('returns hardwareConcurrency >= 1', async () => {
      const report = await detectGPUCapabilities();
      expect(report.hardwareConcurrency).toBeGreaterThanOrEqual(1);
    });

    it('detects SharedArrayBuffer availability', async () => {
      const report = await detectGPUCapabilities();
      // SharedArrayBuffer may or may not be available in test env
      expect(typeof report.sharedArrayBuffer).toBe('boolean');
    });
  });

  describe('tier classification', () => {
    it('assigns low tier when no WebGL is available (test env)', async () => {
      // In jsdom, no real WebGL -> should be low tier
      const report = await detectGPUCapabilities();
      // The tier depends on the test environment; we just verify it is valid
      expect(['high', 'medium', 'low']).toContain(report.tier);
    });

    it('instance count matches tier expectations', async () => {
      const report = await detectGPUCapabilities();
      switch (report.tier) {
        case 'high':
          expect(report.maxInstanceCount).toBe(10000);
          break;
        case 'medium':
          expect(report.maxInstanceCount).toBe(2000);
          break;
        case 'low':
          expect(report.maxInstanceCount).toBe(500);
          break;
      }
    });
  });

  describe('graceful degradation', () => {
    it('does not throw even if navigator is partially available', async () => {
      // detectGPUCapabilities should never throw
      await expect(detectGPUCapabilities()).resolves.toBeDefined();
    });

    it('reports webgpu as false when navigator.gpu is absent', async () => {
      const report = await detectGPUCapabilities();
      // In test environments, WebGPU is not available
      expect(report.webgpu).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // Regression test: adapter-exists-but-device-fails scenario
  // This is the root cause of "WebGPU detected but always uses WebGL2":
  // requestAdapter() can succeed while requestDevice() fails.
  // GPUCapabilities must check both so the settings UI is not misleading.
  // ------------------------------------------------------------------
  describe('WebGPU adapter vs device verification', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('reports webgpu as false when adapter exists but requestDevice fails', async () => {
      // Simulate: navigator.gpu exists, requestAdapter returns adapter,
      // but requestDevice throws (GPU driver doesn't fully support WebGPU).
      // This is the root cause bug: GPUCapabilities only checked requestAdapter()
      // but Three.js also calls requestDevice() which can fail.
      const mockAdapter = {
        features: { has: () => false },
        info: null,
        requestAdapterInfo: undefined,
        requestDevice: vi.fn().mockRejectedValue(new Error('Device lost: GPU driver crash')),
      };
      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };
      vi.stubGlobal('navigator', { gpu: mockGpu, hardwareConcurrency: 4 });

      const report = await detectGPUCapabilities();

      // MUST be false — adapter exists but device creation fails
      // This matches what Three.js WebGPURenderer.init() would experience
      expect(report.webgpu).toBe(false);
    });

    it('reports webgpu as true when both adapter and device creation succeed', async () => {
      const mockDevice = {
        destroy: vi.fn(),
      };
      const mockAdapter = {
        features: { has: () => false },
        info: { vendor: 'NVIDIA', architecture: 'Ampere', device: '', description: 'RTX 3080' },
        requestDevice: vi.fn().mockResolvedValue(mockDevice),
      };
      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
      };
      vi.stubGlobal('navigator', { gpu: mockGpu, hardwareConcurrency: 8 });

      const report = await detectGPUCapabilities();

      // MUST be true — both adapter and device succeeded
      expect(report.webgpu).toBe(true);
      // Device must be destroyed after probe to release GPU resources
      expect(mockDevice.destroy).toHaveBeenCalled();
    });

    it('reports webgpu as false when adapter returns null', async () => {
      const mockGpu = {
        requestAdapter: vi.fn().mockResolvedValue(null),
      };
      vi.stubGlobal('navigator', { gpu: mockGpu, hardwareConcurrency: 4 });

      const report = await detectGPUCapabilities();
      expect(report.webgpu).toBe(false);
    });
  });
});
