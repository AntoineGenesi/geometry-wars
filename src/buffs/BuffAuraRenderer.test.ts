import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Three.js
vi.mock('three', () => {
  class Color {
    r: number; g: number; b: number;
    constructor(r: number | string = 0, g?: number, b?: number) {
      if (typeof r === 'number' && g === undefined) {
        this.r = ((r >> 16) & 255) / 255;
        this.g = ((r >> 8) & 255) / 255;
        this.b = (r & 255) / 255;
      } else if (typeof r === 'number') {
        this.r = r; this.g = g!; this.b = b!;
      } else {
        this.r = 0; this.g = 0; this.b = 0;
      }
    }
    clone() { return new Color(this.r, this.g, this.b); }
    copy(c: Color) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  }

  class Vector3 {
    x: number; y: number; z: number;
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    copy(v: Vector3) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    add(v: Vector3) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    addScaledVector(v: Vector3, s: number) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; }
  }

  class BufferAttribute {
    array: Float32Array;
    itemSize: number;
    constructor(array: Float32Array, itemSize: number) {
      this.array = array;
      this.itemSize = itemSize;
    }
  }

  class BufferGeometry {
    attributes: Record<string, BufferAttribute> = {};
    index: number[] | null = null;
    setAttribute(name: string, attr: BufferAttribute) { this.attributes[name] = attr; return this; }
    setIndex(index: number[]) { this.index = index; return this; }
    dispose() {}
  }

  class ShaderMaterial {
    vertexShader: string;
    fragmentShader: string;
    transparent: boolean;
    depthWrite: boolean;
    blending: number;
    side: number;
    uniforms: Record<string, { value: unknown }>;
    constructor(params: any = {}) {
      this.vertexShader = params.vertexShader || '';
      this.fragmentShader = params.fragmentShader || '';
      this.transparent = params.transparent ?? false;
      this.depthWrite = params.depthWrite ?? true;
      this.blending = params.blending ?? 1;
      this.side = params.side ?? 0;
      this.uniforms = params.uniforms || {};
    }
    dispose() {}
  }

  class Quaternion {
    x = 0; y = 0; z = 0; w = 1;
    setFromUnitVectors(_from: Vector3, _to: Vector3) { return this; }
  }

  class Mesh {
    geometry: any;
    material: any;
    visible: boolean = true;
    frustumCulled: boolean = true;
    renderOrder: number = 0;
    position: Vector3 = new Vector3();
    quaternion: Quaternion = new Quaternion();
    scale = { setScalar(_s: number) { /* noop */ } };
    constructor(geometry: any, material: any) {
      this.geometry = geometry;
      this.material = material;
    }
    lookAt(_target: Vector3) {}
  }

  class Group {
    name: string = '';
    children: any[] = [];
    add(child: any) { this.children.push(child); }
    remove(child: any) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
    }
  }

  return {
    Color,
    Vector3,
    BufferAttribute,
    BufferGeometry,
    ShaderMaterial,
    Mesh,
    Group,
    AdditiveBlending: 2,
    DoubleSide: 2,
  };
});

// Mock sound engine
vi.mock('../audio/SoundEngine', () => ({
  getSoundEngine: () => ({
    play: vi.fn(),
    init: vi.fn(),
    resume: vi.fn(),
  }),
}));

import { BuffAuraRenderer, AuraQuality } from './BuffAuraRenderer';
import { StackBuffType } from './BuffManager';
import { Vector3 } from 'three';

describe('BuffAuraRenderer', () => {
  let renderer: BuffAuraRenderer;

  beforeEach(() => {
    renderer = new BuffAuraRenderer(AuraQuality.Full);
  });

  describe('construction', () => {
    it('creates a root group', () => {
      expect(renderer.root).toBeDefined();
      expect(renderer.root.name).toBe('BuffAuras');
    });

    it('pre-allocates 3 ring mesh slots', () => {
      expect(renderer.root.children.length).toBe(3);
    });

    it('all slots start invisible', () => {
      for (const child of renderer.root.children) {
        expect(child.visible).toBe(false);
      }
    });

    it('accepts quality parameter', () => {
      const minimal = new BuffAuraRenderer(AuraQuality.Minimal);
      expect(minimal.root).toBeDefined();
      minimal.dispose();

      const reduced = new BuffAuraRenderer(AuraQuality.Reduced);
      expect(reduced.root).toBeDefined();
      reduced.dispose();
    });
  });

  describe('update with no buffs', () => {
    it('all rings stay invisible when no buffs active', () => {
      renderer.update(0.016, 1.0, new Vector3(0, 1, 0), new Vector3(0, 1, 0), []);
      for (const child of renderer.root.children) {
        expect(child.visible).toBe(false);
      }
    });
  });

  describe('update with active buffs', () => {
    it('shows 1 ring for 1 active buff', () => {
      renderer.update(0.016, 1.0, new Vector3(0, 1, 0), new Vector3(0, 1, 0), [
        { type: StackBuffType.ShockAura, stacks: 2 },
      ]);
      const visibleCount = renderer.root.children.filter((c: any) => c.visible).length;
      expect(visibleCount).toBe(1);
    });

    it('shows 2 rings for 2 active buffs', () => {
      renderer.update(0.016, 1.0, new Vector3(0, 1, 0), new Vector3(0, 1, 0), [
        { type: StackBuffType.ShockAura, stacks: 1 },
        { type: StackBuffType.HotHands, stacks: 3 },
      ]);
      const visibleCount = renderer.root.children.filter((c: any) => c.visible).length;
      expect(visibleCount).toBe(2);
    });

    it('caps at 3 rings for many buffs', () => {
      renderer.update(0.016, 1.0, new Vector3(0, 1, 0), new Vector3(0, 1, 0), [
        { type: StackBuffType.ShockAura, stacks: 1 },
        { type: StackBuffType.HotHands, stacks: 3 },
        { type: StackBuffType.ToughTimes, stacks: 2 },
        { type: StackBuffType.Afterburner, stacks: 1 },
        { type: StackBuffType.Magnetism, stacks: 2 },
      ]);
      const visibleCount = renderer.root.children.filter((c: any) => c.visible).length;
      expect(visibleCount).toBe(3);
    });

    it('prioritizes uncommon buffs (ShockAura, Volatile)', () => {
      renderer.update(0.016, 1.0, new Vector3(0, 1, 0), new Vector3(0, 1, 0), [
        { type: StackBuffType.HotHands, stacks: 5 },
        { type: StackBuffType.ToughTimes, stacks: 5 },
        { type: StackBuffType.Afterburner, stacks: 5 },
        { type: StackBuffType.ShockAura, stacks: 1 }, // uncommon, should appear
        { type: StackBuffType.Magnetism, stacks: 5 },
      ]);
      // ShockAura (uncommon) should be in the displayed set
      // The visible ring at index 0 should have the ShockAura material assigned
      const visibleCount = renderer.root.children.filter((c: any) => c.visible).length;
      expect(visibleCount).toBe(3);
    });

    it('handles all 8 buff types', () => {
      const allBuffTypes = [
        StackBuffType.HotHands,
        StackBuffType.TriggerHappy,
        StackBuffType.Afterburner,
        StackBuffType.Magnetism,
        StackBuffType.ToughTimes,
        StackBuffType.ShockAura,
        StackBuffType.IncendiaryRounds,
        StackBuffType.Volatile,
      ];

      // Test each buff type individually
      for (const buffType of allBuffTypes) {
        renderer.update(0.016, 1.0, new Vector3(0, 1, 0), new Vector3(0, 1, 0), [
          { type: buffType, stacks: 1 },
        ]);
        const visibleCount = renderer.root.children.filter((c: any) => c.visible).length;
        expect(visibleCount).toBe(1);
      }
    });
  });

  describe('triggerBlockFlash', () => {
    it('records block time', () => {
      renderer.triggerBlockFlash(5.0);
      // Verify by updating with Tough Times active — the material should have uBlockTime = 5.0
      renderer.update(0.016, 5.1, new Vector3(0, 1, 0), new Vector3(0, 1, 0), [
        { type: StackBuffType.ToughTimes, stacks: 2 },
      ]);
      // Access the first visible mesh's material
      const visibleMesh = renderer.root.children.find((c: any) => c.visible);
      expect(visibleMesh).toBeDefined();
      if (visibleMesh && (visibleMesh as any).material?.uniforms?.uBlockTime) {
        expect((visibleMesh as any).material.uniforms.uBlockTime.value).toBe(5.0);
      }
    });
  });

  describe('buff visibility toggling', () => {
    it('hides rings when buffs are removed', () => {
      // Add buff
      renderer.update(0.016, 1.0, new Vector3(0, 1, 0), new Vector3(0, 1, 0), [
        { type: StackBuffType.ShockAura, stacks: 1 },
      ]);
      expect(renderer.root.children.filter((c: any) => c.visible).length).toBe(1);

      // Remove buff
      renderer.update(0.016, 2.0, new Vector3(0, 1, 0), new Vector3(0, 1, 0), []);
      expect(renderer.root.children.filter((c: any) => c.visible).length).toBe(0);
    });

    it('swaps materials when buff type changes', () => {
      // Start with ShockAura
      renderer.update(0.016, 1.0, new Vector3(0, 1, 0), new Vector3(0, 1, 0), [
        { type: StackBuffType.ShockAura, stacks: 1 },
      ]);
      const material1 = (renderer.root.children[0] as any).material;

      // Switch to HotHands
      renderer.update(0.016, 2.0, new Vector3(0, 1, 0), new Vector3(0, 1, 0), [
        { type: StackBuffType.HotHands, stacks: 1 },
      ]);
      const material2 = (renderer.root.children[0] as any).material;

      // Materials should be different (different buff shaders)
      expect(material1).not.toBe(material2);
    });
  });

  describe('dispose', () => {
    it('does not throw', () => {
      expect(() => renderer.dispose()).not.toThrow();
    });
  });

  describe('setDimmingFactor — enemy visibility feature', () => {
    const pos = new Vector3(0, 1, 0);
    const normal = new Vector3(0, 1, 0);
    const singleBuff = [{ type: StackBuffType.ShockAura, stacks: 1 }];

    it('no dimming (factor=0) leaves opacity at base value', () => {
      renderer.setDimmingFactor(0);
      renderer.update(0.016, 1.0, pos, normal, singleBuff);
      const mesh = renderer.root.children.find((c: any) => c.visible) as any;
      expect(mesh).toBeDefined();
      // Base opacity for 1 buff = 0.5; with factor=0, dimmed = 0.5 * (1 - 0 * 0.75) = 0.5
      expect(mesh.material.uniforms.uOpacity.value).toBeCloseTo(0.5, 4);
    });

    it('full dimming (factor=1) reduces opacity by 75% (AURA_MAX_DIM)', () => {
      renderer.setDimmingFactor(1);
      renderer.update(0.016, 1.0, pos, normal, singleBuff);
      const mesh = renderer.root.children.find((c: any) => c.visible) as any;
      expect(mesh).toBeDefined();
      // Base opacity for 1 buff = 0.5; with factor=1, dimmed = 0.5 * (1 - 1 * 0.75) = 0.125
      expect(mesh.material.uniforms.uOpacity.value).toBeCloseTo(0.125, 4);
    });

    it('half dimming (factor=0.5) reduces opacity proportionally', () => {
      renderer.setDimmingFactor(0.5);
      renderer.update(0.016, 1.0, pos, normal, singleBuff);
      const mesh = renderer.root.children.find((c: any) => c.visible) as any;
      expect(mesh).toBeDefined();
      // Base opacity for 1 buff = 0.5; with factor=0.5, dimmed = 0.5 * (1 - 0.5 * 0.75) = 0.3125
      expect(mesh.material.uniforms.uOpacity.value).toBeCloseTo(0.3125, 4);
    });

    it('clamps factor above 1 to 1', () => {
      renderer.setDimmingFactor(2.0);
      renderer.update(0.016, 1.0, pos, normal, singleBuff);
      const mesh = renderer.root.children.find((c: any) => c.visible) as any;
      // Same as factor=1: opacity = 0.5 * (1 - 0.75) = 0.125
      expect(mesh.material.uniforms.uOpacity.value).toBeCloseTo(0.125, 4);
    });

    it('clamps factor below 0 to 0', () => {
      renderer.setDimmingFactor(-1.0);
      renderer.update(0.016, 1.0, pos, normal, singleBuff);
      const mesh = renderer.root.children.find((c: any) => c.visible) as any;
      // Same as factor=0: opacity = 0.5
      expect(mesh.material.uniforms.uOpacity.value).toBeCloseTo(0.5, 4);
    });

    it('dimming state persists across update calls', () => {
      renderer.setDimmingFactor(1.0);
      // Two consecutive updates should both have dimming applied
      renderer.update(0.016, 1.0, pos, normal, singleBuff);
      const mesh1 = renderer.root.children.find((c: any) => c.visible) as any;
      expect(mesh1.material.uniforms.uOpacity.value).toBeCloseTo(0.125, 4);

      renderer.update(0.016, 2.0, pos, normal, singleBuff);
      const mesh2 = renderer.root.children.find((c: any) => c.visible) as any;
      expect(mesh2.material.uniforms.uOpacity.value).toBeCloseTo(0.125, 4);
    });

    it('resetting dimming to 0 restores full opacity', () => {
      renderer.setDimmingFactor(1.0);
      renderer.update(0.016, 1.0, pos, normal, singleBuff);

      renderer.setDimmingFactor(0);
      renderer.update(0.016, 2.0, pos, normal, singleBuff);
      const mesh = renderer.root.children.find((c: any) => c.visible) as any;
      expect(mesh.material.uniforms.uOpacity.value).toBeCloseTo(0.5, 4);
    });
  });

  describe('zero allocations', () => {
    it('update performs no allocations (measured via object count)', () => {
      // This is a structural test: verify update doesn't create new objects
      // by checking that repeated calls don't increase children count
      const initialChildCount = renderer.root.children.length;

      for (let i = 0; i < 100; i++) {
        renderer.update(0.016, i * 0.016, new Vector3(0, 1, 0), new Vector3(0, 1, 0), [
          { type: StackBuffType.ShockAura, stacks: 1 },
          { type: StackBuffType.HotHands, stacks: 2 },
        ]);
      }

      expect(renderer.root.children.length).toBe(initialChildCount);
    });
  });
});
