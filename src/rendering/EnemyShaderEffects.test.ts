import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  getEnemyShaderStyle,
  enhanceMaterialWithShaderEffect,
  updateShaderTime,
  flushShaderUniforms,
  clearShaderTracking,
} from './EnemyShaderEffects';

describe('EnemyShaderEffects', () => {
  beforeEach(() => {
    clearShaderTracking();
  });

  describe('getEnemyShaderStyle', () => {
    it('returns lava for Wanderer', () => {
      expect(getEnemyShaderStyle('Wanderer')).toBe('lava');
    });

    it('returns lava for Helix', () => {
      expect(getEnemyShaderStyle('Helix')).toBe('lava');
    });

    it('returns lava for Lurker', () => {
      expect(getEnemyShaderStyle('Lurker')).toBe('lava');
    });

    it('returns crystal for Grunt', () => {
      expect(getEnemyShaderStyle('Grunt')).toBe('crystal');
    });

    it('returns crystal for Weaver', () => {
      expect(getEnemyShaderStyle('Weaver')).toBe('crystal');
    });

    it('returns crystal for Duck', () => {
      expect(getEnemyShaderStyle('Duck')).toBe('crystal');
    });

    it('returns pulse for Spinner', () => {
      expect(getEnemyShaderStyle('Spinner')).toBe('pulse');
    });

    it('returns pulse for Rocket', () => {
      expect(getEnemyShaderStyle('Rocket')).toBe('pulse');
    });

    it('returns pulse for Neutron', () => {
      expect(getEnemyShaderStyle('Neutron')).toBe('pulse');
    });

    it('returns nebula for Virus', () => {
      expect(getEnemyShaderStyle('Virus')).toBe('nebula');
    });

    it('returns nebula for Orbiter', () => {
      expect(getEnemyShaderStyle('Orbiter')).toBe('nebula');
    });

    it('returns nebula for Splitter', () => {
      expect(getEnemyShaderStyle('Splitter')).toBe('nebula');
    });

    it('returns none for unmapped types', () => {
      expect(getEnemyShaderStyle('UnknownEnemy')).toBe('none');
    });

    it('returns none for Boss (bosses use artpiece directly)', () => {
      expect(getEnemyShaderStyle('Boss')).toBe('none');
    });
  });

  describe('enhanceMaterialWithShaderEffect', () => {
    it('does not modify material for none style', () => {
      const mat = new THREE.MeshStandardMaterial();
      const originalCompile = mat.onBeforeCompile;
      enhanceMaterialWithShaderEffect(mat, 'none', new THREE.Color(0xff0000));
      // Should not change onBeforeCompile
      expect(mat.onBeforeCompile).toBe(originalCompile);
    });

    it('replaces onBeforeCompile for lava style', () => {
      const mat = new THREE.MeshStandardMaterial();
      const originalCompile = mat.onBeforeCompile;
      enhanceMaterialWithShaderEffect(mat, 'lava', new THREE.Color(0xff0000));
      // onBeforeCompile should be replaced with our enhanced version
      expect(mat.onBeforeCompile).not.toBe(originalCompile);
    });

    it('replaces onBeforeCompile for crystal style', () => {
      const mat = new THREE.MeshStandardMaterial();
      const originalCompile = mat.onBeforeCompile;
      enhanceMaterialWithShaderEffect(mat, 'crystal', new THREE.Color(0x0000ff));
      expect(mat.onBeforeCompile).not.toBe(originalCompile);
    });

    it('replaces onBeforeCompile for pulse style', () => {
      const mat = new THREE.MeshStandardMaterial();
      const originalCompile = mat.onBeforeCompile;
      enhanceMaterialWithShaderEffect(mat, 'pulse', new THREE.Color(0xff00ff));
      expect(mat.onBeforeCompile).not.toBe(originalCompile);
    });

    it('replaces onBeforeCompile for nebula style', () => {
      const mat = new THREE.MeshStandardMaterial();
      const originalCompile = mat.onBeforeCompile;
      enhanceMaterialWithShaderEffect(mat, 'nebula', new THREE.Color(0x00ff00));
      expect(mat.onBeforeCompile).not.toBe(originalCompile);
    });

    it('replaces onBeforeCompile for artpiece style', () => {
      const mat = new THREE.MeshStandardMaterial();
      const originalCompile = mat.onBeforeCompile;
      enhanceMaterialWithShaderEffect(mat, 'artpiece', new THREE.Color(0xffffff));
      expect(mat.onBeforeCompile).not.toBe(originalCompile);
    });

    it('does not double-enhance the same material', () => {
      const mat = new THREE.MeshStandardMaterial();
      enhanceMaterialWithShaderEffect(mat, 'lava', new THREE.Color(0xff0000));
      const firstCompile = mat.onBeforeCompile;
      enhanceMaterialWithShaderEffect(mat, 'crystal', new THREE.Color(0x0000ff));
      // Should still have the first compile, not be replaced
      expect(mat.onBeforeCompile).toBe(firstCompile);
    });
  });

  describe('updateShaderTime and flushShaderUniforms', () => {
    it('does not throw when no shaders are tracked', () => {
      expect(() => {
        updateShaderTime(1.5);
        flushShaderUniforms();
      }).not.toThrow();
    });
  });

  describe('clearShaderTracking', () => {
    it('does not throw', () => {
      expect(() => clearShaderTracking()).not.toThrow();
    });
  });
});
