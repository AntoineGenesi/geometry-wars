import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GlowTrail } from './GlowTrail';

describe('GlowTrail', () => {
  it('renders in the entity surface pass so the grid overlay can cover far-side trails', () => {
    const trail = new GlowTrail(new THREE.Color(0xff0000), 8, 0.3);
    const lines: THREE.Line[] = [];
    trail.root.traverse((child) => {
      if (child instanceof THREE.Line) lines.push(child);
    });

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const material = line.material as THREE.LineBasicMaterial;
      expect(material.depthTest).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(line.renderOrder).toBeLessThan(1);
    }
  });
});
