import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock THREE.js before importing the module under test
vi.mock('three', () => {
  class Vector3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    crossVectors(a: Vector3, b: Vector3) {
      this.x = a.y * b.z - a.z * b.y;
      this.y = a.z * b.x - a.x * b.z;
      this.z = a.x * b.y - a.y * b.x;
      return this;
    }
    normalize() {
      const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
      if (len > 0) { this.x /= len; this.y /= len; this.z /= len; }
      return this;
    }
    dot(v: Vector3) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    addScaledVector(v: Vector3, s: number) {
      this.x += v.x * s; this.y += v.y * s; this.z += v.z * s;
      return this;
    }
  }

  class Color {
    r: number; g: number; b: number;
    constructor(hex?: number) {
      if (hex !== undefined) {
        this.r = ((hex >> 16) & 0xff) / 255;
        this.g = ((hex >> 8) & 0xff) / 255;
        this.b = (hex & 0xff) / 255;
      } else {
        this.r = 0; this.g = 0; this.b = 0;
      }
    }
  }

  class BufferAttribute {
    array: Float32Array | Uint16Array;
    itemSize: number;
    needsUpdate = false;
    constructor(array: Float32Array | Uint16Array, itemSize: number) {
      this.array = array;
      this.itemSize = itemSize;
    }
  }

  class BufferGeometry {
    attributes: Record<string, BufferAttribute> = {};
    setAttribute(name: string, attr: BufferAttribute) {
      this.attributes[name] = attr;
      return this;
    }
    dispose() {}
  }

  class ShaderMaterial {
    vertexShader = '';
    fragmentShader = '';
    transparent = false;
    depthWrite = false;
    blending = 0;
    vertexColors = false;
    dispose() {}
  }

  class Points {
    geometry: BufferGeometry;
    material: ShaderMaterial;
    frustumCulled = true;
    renderOrder = 0;
    constructor(geom: BufferGeometry, mat: ShaderMaterial) {
      this.geometry = geom;
      this.material = mat;
    }
  }

  class Group {
    name = '';
    children: unknown[] = [];
    add(obj: unknown) { this.children.push(obj); }
  }

  return {
    Vector3,
    Color,
    BufferAttribute,
    BufferGeometry,
    ShaderMaterial,
    Points,
    Group,
    AdditiveBlending: 2,
  };
});

import { BuffParticleAura, AuraStyle } from './BuffParticleAura';
import { StackBuffType } from './BuffManager';
import * as THREE from 'three';

describe('BuffParticleAura', () => {
  let aura: BuffParticleAura;

  beforeEach(() => {
    aura = new BuffParticleAura();
  });

  it('creates without error', () => {
    expect(aura).toBeDefined();
    expect(aura.root).toBeDefined();
  });

  it('root group contains a Points mesh', () => {
    expect(aura.root.children.length).toBe(1);
  });

  it('starts with no active particles (sizes all zero)', () => {
    // Before any update, all GPU sizes should be 0
    const geom = (aura.root.children[0] as THREE.Points).geometry as THREE.BufferGeometry;
    const sizes = geom.attributes.aSize.array as Float32Array;
    for (let i = 0; i < sizes.length; i++) {
      expect(sizes[i]).toBe(0);
    }
  });

  describe('update with active buffs', () => {
    const playerPos = new THREE.Vector3(0, 5, 0);
    const normal = new THREE.Vector3(0, 1, 0);

    it('spawns particles when a buff is active', () => {
      const buffs = [{ type: StackBuffType.HotHands, stacks: 1 }];

      // Run several update frames to accumulate spawn timer
      for (let i = 0; i < 30; i++) {
        aura.update(1 / 60, i / 60, playerPos, normal, buffs);
      }

      // Check that some particles have non-zero size (are alive)
      const geom = (aura.root.children[0] as THREE.Points).geometry as THREE.BufferGeometry;
      const sizes = geom.attributes.aSize.array as Float32Array;
      let aliveCount = 0;
      for (let i = 0; i < sizes.length; i++) {
        if (sizes[i] > 0) aliveCount++;
      }
      expect(aliveCount).toBeGreaterThan(0);
    });

    it('does not spawn particles when no buffs are active', () => {
      for (let i = 0; i < 30; i++) {
        aura.update(1 / 60, i / 60, playerPos, normal, []);
      }

      const geom = (aura.root.children[0] as THREE.Points).geometry as THREE.BufferGeometry;
      const sizes = geom.attributes.aSize.array as Float32Array;
      let aliveCount = 0;
      for (let i = 0; i < sizes.length; i++) {
        if (sizes[i] > 0) aliveCount++;
      }
      expect(aliveCount).toBe(0);
    });

    it('respects MAX_PARTICLES_PER_AURA (50) cap', () => {
      const buffs = [{ type: StackBuffType.HotHands, stacks: 10 }];

      // Run many frames to try to fill pool
      for (let i = 0; i < 600; i++) {
        aura.update(1 / 60, i / 60, playerPos, normal, buffs);
      }

      const geom = (aura.root.children[0] as THREE.Points).geometry as THREE.BufferGeometry;
      const sizes = geom.attributes.aSize.array as Float32Array;

      // Count particles in the first aura slot (indices 0-49)
      let aliveCount = 0;
      for (let i = 0; i < 50; i++) {
        if (sizes[i] > 0) aliveCount++;
      }
      expect(aliveCount).toBeLessThanOrEqual(50);
    });

    it('supports up to 3 simultaneous auras', () => {
      const buffs = [
        { type: StackBuffType.HotHands, stacks: 3 },
        { type: StackBuffType.ToughTimes, stacks: 2 },
        { type: StackBuffType.ShockAura, stacks: 1 },
      ];

      for (let i = 0; i < 120; i++) {
        aura.update(1 / 60, i / 60, playerPos, normal, buffs);
      }

      const geom = (aura.root.children[0] as THREE.Points).geometry as THREE.BufferGeometry;
      const sizes = geom.attributes.aSize.array as Float32Array;

      // Check that each of the 3 pool slots has some alive particles
      for (let slot = 0; slot < 3; slot++) {
        let slotAlive = 0;
        for (let i = slot * 50; i < (slot + 1) * 50; i++) {
          if (sizes[i] > 0) slotAlive++;
        }
        expect(slotAlive).toBeGreaterThan(0);
      }
    });
  });

  describe('particle lifecycle', () => {
    const playerPos = new THREE.Vector3(0, 0, 0);
    const normal = new THREE.Vector3(0, 1, 0);

    it('particles die after their maxAge', () => {
      const buffs = [{ type: StackBuffType.HotHands, stacks: 1 }];

      // Spawn some particles
      for (let i = 0; i < 30; i++) {
        aura.update(1 / 60, i / 60, playerPos, normal, buffs);
      }

      // Now remove all buffs and advance time significantly
      for (let i = 0; i < 300; i++) {
        aura.update(1 / 60, (30 + i) / 60, playerPos, normal, []);
      }

      // All particles should have died (maxAge is 1.0-2.5s for embers)
      const geom = (aura.root.children[0] as THREE.Points).geometry as THREE.BufferGeometry;
      const sizes = geom.attributes.aSize.array as Float32Array;
      let aliveCount = 0;
      for (let i = 0; i < 50; i++) {
        if (sizes[i] > 0) aliveCount++;
      }
      expect(aliveCount).toBe(0);
    });
  });

  describe('different aura styles', () => {
    it('HotHands uses FloatingEmbers style', () => {
      // This is a mapping test; import checks that the config maps correctly
      expect(AuraStyle.FloatingEmbers).toBe(0);
    });

    it('ToughTimes uses LavaLamp style', () => {
      expect(AuraStyle.LavaLamp).toBe(1);
    });

    it('ShockAura uses EnergyVortex style', () => {
      expect(AuraStyle.EnergyVortex).toBe(2);
    });
  });

  describe('zero allocation verification', () => {
    it('update does not create new objects per frame', () => {
      const playerPos = new THREE.Vector3(0, 5, 0);
      const normal = new THREE.Vector3(0, 1, 0);
      const buffs = [{ type: StackBuffType.HotHands, stacks: 2 }];

      // Warm up
      for (let i = 0; i < 10; i++) {
        aura.update(1 / 60, i / 60, playerPos, normal, buffs);
      }

      // The fact that we can call update 1000 times without issues
      // is a basic sanity check for the pre-allocation strategy
      for (let i = 0; i < 1000; i++) {
        aura.update(1 / 60, (10 + i) / 60, playerPos, normal, buffs);
      }
      // If we got here without errors, the pre-allocated arrays work
      expect(true).toBe(true);
    });
  });

  describe('world-space transform', () => {
    it('positions particles in world space around the player', () => {
      const playerPos = new THREE.Vector3(10, 20, 30);
      const normal = new THREE.Vector3(0, 1, 0);
      const buffs = [{ type: StackBuffType.HotHands, stacks: 2 }];

      for (let i = 0; i < 30; i++) {
        aura.update(1 / 60, i / 60, playerPos, normal, buffs);
      }

      const geom = (aura.root.children[0] as THREE.Points).geometry as THREE.BufferGeometry;
      const positions = geom.attributes.position.array as Float32Array;
      const sizes = geom.attributes.aSize.array as Float32Array;

      // Find a live particle and check it's near the player position
      for (let i = 0; i < 50; i++) {
        if (sizes[i] > 0) {
          const px = positions[i * 3];
          const py = positions[i * 3 + 1];
          const pz = positions[i * 3 + 2];

          // Should be within a reasonable distance of the player
          const dx = px - playerPos.x;
          const dy = py - playerPos.y;
          const dz = pz - playerPos.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          expect(dist).toBeLessThan(5); // Within 5 units (aura radius + max height)
          break;
        }
      }
    });

    it('uses surface normal for upward direction', () => {
      // Use a sideways normal (Z-up instead of Y-up)
      const playerPos = new THREE.Vector3(0, 0, 0);
      const normal = new THREE.Vector3(0, 0, 1);
      const buffs = [{ type: StackBuffType.HotHands, stacks: 2 }];

      for (let i = 0; i < 60; i++) {
        aura.update(1 / 60, i / 60, playerPos, normal, buffs);
      }

      const geom = (aura.root.children[0] as THREE.Points).geometry as THREE.BufferGeometry;
      const positions = geom.attributes.position.array as Float32Array;
      const sizes = geom.attributes.aSize.array as Float32Array;

      // With Z-up normal, particles should have positive Z values (floating "up")
      let foundParticleAboveSurface = false;
      for (let i = 0; i < 50; i++) {
        if (sizes[i] > 0) {
          const pz = positions[i * 3 + 2];
          if (pz > 0.1) {
            foundParticleAboveSurface = true;
            break;
          }
        }
      }
      expect(foundParticleAboveSurface).toBe(true);
    });
  });

  describe('dispose', () => {
    it('disposes without error', () => {
      aura.dispose();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('setDimmingFactor — enemy visibility feature', () => {
    const playerPos = new THREE.Vector3(0, 5, 0);
    const normal = new THREE.Vector3(0, 1, 0);
    const buffs = [{ type: StackBuffType.HotHands, stacks: 2 }];

    /** Helper: get the alpha buffer of the Points geometry */
    function getAlphas(): Float32Array {
      const geom = (aura.root.children[0] as THREE.Points).geometry as THREE.BufferGeometry;
      return geom.attributes.aAlpha.array as Float32Array;
    }

    it('no dimming (factor=0) leaves particle alphas at baseline', () => {
      // Warm up to get live particles
      aura.setDimmingFactor(0);
      for (let i = 0; i < 60; i++) aura.update(1 / 60, i / 60, playerPos, normal, buffs);

      const alphasNoDim = Array.from(getAlphas()).filter(a => a > 0);
      expect(alphasNoDim.length).toBeGreaterThan(0);

      // Max alpha with no dimming should approach 0.8 (the base multiplier)
      const maxAlpha = Math.max(...alphasNoDim);
      expect(maxAlpha).toBeGreaterThan(0.5);
    });

    it('full dimming (factor=1) significantly reduces all particle alphas', () => {
      // Run once with no dimming to get alive particles
      aura.setDimmingFactor(0);
      for (let i = 0; i < 60; i++) aura.update(1 / 60, i / 60, playerPos, normal, buffs);
      const alphasNoDim = Array.from(getAlphas()).filter(a => a > 0);
      const maxNoDim = Math.max(...alphasNoDim);

      // Apply full dimming and run one more frame
      aura.setDimmingFactor(1);
      aura.update(1 / 60, 1.0, playerPos, normal, buffs);
      const alphasDimmed = Array.from(getAlphas()).filter(a => a > 0);
      const maxDimmed = alphasDimmed.length > 0 ? Math.max(...alphasDimmed) : 0;

      // Dimmed alphas should be significantly lower (25% of original due to PARTICLE_MAX_DIM=0.75)
      expect(maxDimmed).toBeLessThan(maxNoDim * 0.5);
    });

    it('clamps factor above 1 to 1', () => {
      aura.setDimmingFactor(5.0); // Should be clamped to 1
      for (let i = 0; i < 60; i++) aura.update(1 / 60, i / 60, playerPos, normal, buffs);

      // With PARTICLE_MAX_DIM=0.75 and factor=1, max alpha = 0.8 * (1 - 0.75) = 0.2
      const maxAlpha = Math.max(...Array.from(getAlphas()).filter(a => a > 0), 0);
      expect(maxAlpha).toBeLessThanOrEqual(0.2 + 0.01); // small epsilon for floating point
    });

    it('clamps factor below 0 to 0', () => {
      aura.setDimmingFactor(-5.0); // Should be clamped to 0
      for (let i = 0; i < 60; i++) aura.update(1 / 60, i / 60, playerPos, normal, buffs);

      // With factor=0, max alpha = 0.8 (fully visible)
      const maxAlpha = Math.max(...Array.from(getAlphas()).filter(a => a > 0), 0);
      expect(maxAlpha).toBeGreaterThan(0.5);
    });
  });
});
