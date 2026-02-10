import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Three.js
vi.mock('three', () => {
  class Color {
    r: number; g: number; b: number;
    constructor(r = 0, g = 0, b = 0) {
      if (typeof r === 'number' && g === undefined) {
        // Hex constructor
        this.r = ((r >> 16) & 255) / 255;
        this.g = ((r >> 8) & 255) / 255;
        this.b = (r & 255) / 255;
      } else {
        this.r = r as number; this.g = g as number; this.b = b as number;
      }
    }
    copy(c: Color) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
    setRGB(r: number, g: number, b: number) { this.r = r; this.g = g; this.b = b; return this; }
  }

  class Vector3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    project(_camera: any) {
      // Simple mock: project to NDC (0,0,0)
      this.x = 0; this.y = 0; this.z = 0.5;
      return this;
    }
  }

  class Vector2 {
    x: number; y: number;
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
  }

  return {
    Color,
    Vector3,
    Vector2,
    ShaderMaterial: vi.fn(),
  };
});

// Mock ShaderPass as a class (must use 'new')
vi.mock('three/addons/postprocessing/ShaderPass.js', () => {
  class MockShaderPass {
    uniforms: any;
    material: any;
    render: any;
    constructor(shaderDef: any) {
      this.uniforms = { ...shaderDef.uniforms };
      this.material = {};
      this.render = vi.fn();
    }
  }
  return { ShaderPass: MockShaderPass };
});

import { ShockwaveEffect } from './ShockwaveEffect';
import { Vector3, Color } from 'three';

describe('ShockwaveEffect', () => {
  let effect: ShockwaveEffect;

  beforeEach(() => {
    effect = new ShockwaveEffect();
    // Set camera (mock)
    const mockCamera = { position: new Vector3(0, 10, 10) } as any;
    effect.setCamera(mockCamera);
  });

  describe('construction', () => {
    it('creates a ShaderPass', () => {
      expect(effect.shaderPass).toBeDefined();
      expect(effect.shaderPass.uniforms).toBeDefined();
    });

    it('has zero active shockwaves initially', () => {
      expect(effect.getActiveShockwaveCount()).toBe(0);
    });

    it('has all required uniforms', () => {
      const u = effect.shaderPass.uniforms;
      expect(u.tDiffuse).toBeDefined();
      expect(u.uTime).toBeDefined();
      expect(u.uShockwaves).toBeDefined();
      expect(u.uShockStrengths).toBeDefined();
      expect(u.uShockWidths).toBeDefined();
      expect(u.uShockCount).toBeDefined();
      expect(u.uChromaticStrength).toBeDefined();
      expect(u.uFlashColor).toBeDefined();
      expect(u.uFlashIntensity).toBeDefined();
      expect(u.uVignetteOffset).toBeDefined();
      expect(u.uVignetteDarkness).toBeDefined();
    });
  });

  describe('spawnShockwave', () => {
    it('increases active shockwave count', () => {
      effect.spawnShockwave(new Vector3(0, 0, 0));
      effect.update(0.016, 0.5);
      expect(effect.getActiveShockwaveCount()).toBe(1);
    });

    it('handles multiple concurrent shockwaves', () => {
      for (let i = 0; i < 5; i++) {
        effect.spawnShockwave(new Vector3(i, 0, 0));
      }
      effect.update(0.016, 0.5);
      expect(effect.getActiveShockwaveCount()).toBe(5);
    });

    it('respects max shockwave limit (8)', () => {
      for (let i = 0; i < 12; i++) {
        effect.spawnShockwave(new Vector3(i, 0, 0));
      }
      effect.update(0.016, 0.5);
      expect(effect.getActiveShockwaveCount()).toBeLessThanOrEqual(8);
    });

    it('shockwaves decay over time', () => {
      effect.spawnShockwave(new Vector3(0, 0, 0), 0.04, 0.8, 0.3);
      effect.update(0.016, 0.1);
      expect(effect.getActiveShockwaveCount()).toBe(1);

      // Advance past lifetime
      effect.update(0.35, 0.45);
      expect(effect.getActiveShockwaveCount()).toBe(0);
    });

    it('does nothing without camera set', () => {
      const noCamera = new ShockwaveEffect();
      noCamera.spawnShockwave(new Vector3(0, 0, 0));
      noCamera.update(0.016, 0.5);
      expect(noCamera.getActiveShockwaveCount()).toBe(0);
    });
  });

  describe('triggerChromatic', () => {
    it('sets chromatic strength uniform', () => {
      effect.triggerChromatic(0.02);
      effect.update(0.001, 0.5);
      expect(effect.shaderPass.uniforms.uChromaticStrength.value).toBeGreaterThan(0);
    });

    it('decays over time', () => {
      effect.triggerChromatic(0.02);
      effect.update(0.001, 0.5);
      const initial = effect.shaderPass.uniforms.uChromaticStrength.value;

      effect.update(0.5, 1.0);
      const after = effect.shaderPass.uniforms.uChromaticStrength.value;
      expect(after).toBeLessThan(initial);
    });

    it('stacks with max()', () => {
      effect.triggerChromatic(0.01);
      effect.triggerChromatic(0.02);
      effect.update(0.001, 0.5);
      expect(effect.shaderPass.uniforms.uChromaticStrength.value).toBeGreaterThanOrEqual(0.019);
    });
  });

  describe('triggerFlash', () => {
    it('sets flash intensity uniform', () => {
      effect.triggerWhiteFlash(0.5);
      effect.update(0.001, 0.5);
      expect(effect.shaderPass.uniforms.uFlashIntensity.value).toBeGreaterThan(0);
    });

    it('decays over time', () => {
      effect.triggerWhiteFlash(0.5);
      effect.update(0.001, 0.5);
      const initial = effect.shaderPass.uniforms.uFlashIntensity.value;

      effect.update(0.2, 0.7);
      const after = effect.shaderPass.uniforms.uFlashIntensity.value;
      expect(after).toBeLessThan(initial);
    });

    it('triggerFlash with custom color', () => {
      const red = new Color(1, 0, 0);
      effect.triggerFlash(red, 0.4);
      effect.update(0.001, 0.5);
      expect(effect.shaderPass.uniforms.uFlashIntensity.value).toBeGreaterThan(0);
    });
  });

  describe('vignette', () => {
    it('can set vignette parameters', () => {
      effect.setVignette(1.5, 0.6);
      expect(effect.shaderPass.uniforms.uVignetteOffset.value).toBe(1.5);
      expect(effect.shaderPass.uniforms.uVignetteDarkness.value).toBe(0.6);
    });
  });

  describe('update', () => {
    it('updates time uniform', () => {
      effect.update(0.016, 1.5);
      expect(effect.shaderPass.uniforms.uTime.value).toBe(1.5);
    });

    it('updates shock count uniform', () => {
      effect.spawnShockwave(new Vector3(0, 0, 0));
      effect.update(0.016, 0.5);
      expect(effect.shaderPass.uniforms.uShockCount.value).toBe(1);
    });
  });

  describe('dispose', () => {
    it('clears all active effects', () => {
      effect.spawnShockwave(new Vector3(0, 0, 0));
      effect.update(0.016, 0.5);
      expect(effect.getActiveShockwaveCount()).toBe(1);

      effect.dispose();
      expect(effect.getActiveShockwaveCount()).toBe(0);
    });
  });
});
