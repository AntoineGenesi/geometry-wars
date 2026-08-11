import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBlackHoleConfig, getBlackHoleState } from '../shared/BlackHoleModel';
import { BlackHoleVisual } from './BlackHoleVisual';

describe('BlackHoleVisual', () => {
  it('renders a larger portal state with bounded target trails', () => {
    const config = createBlackHoleConfig();
    const visual = new BlackHoleVisual(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    const state = getBlackHoleState(1, config);
    const affectedPositions = Array.from({ length: 24 }, (_, i) => new THREE.Vector3(i + 1, 0, 0));

    visual.update(state, 0, affectedPositions);

    expect(visual.core.scale.x).toBeCloseTo(0.88, 3);
    expect(visual.accretionInner.scale.x).toBeCloseTo(config.maxRadius * 0.48, 3);
    expect(visual.accretionOuter.scale.x).toBeCloseTo(config.maxRadius * 0.82, 3);
    expect(visual.boundary.scale.x).toBeCloseTo(config.maxRadius, 3);
    expect(visual.trails.geometry.drawRange.count).toBe(20 * 2);

    const trailPositions = visual.trails.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(trailPositions.getX(1)).toBeCloseTo(0.14, 3);

    visual.dispose();
    expect(visual.root.children).toHaveLength(0);
  });
});
