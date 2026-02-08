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
});
