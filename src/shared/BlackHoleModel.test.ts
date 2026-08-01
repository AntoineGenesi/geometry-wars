import { describe, expect, it } from 'vitest';
import {
  BLACK_HOLE_BASE_CAPTURE_LIMIT,
  BLACK_HOLE_MASS_CAPTURE_LIMIT,
  createBlackHoleConfig,
  getBlackHoleDamageTickCount,
  getBlackHolePullSpeed,
  getBlackHoleState,
} from './BlackHoleModel';

describe('BlackHoleModel', () => {
  it('defines readable formation, sustain, collapse, and expiry phases', () => {
    const config = createBlackHoleConfig();
    expect(getBlackHoleState(0.1, config).phase).toBe('formation');
    expect(getBlackHoleState(1, config)).toMatchObject({ phase: 'sustain', radius: 5 });
    expect(getBlackHoleState(2.75, config).phase).toBe('collapse');
    expect(getBlackHoleState(3, config).phase).toBe('expired');
  });

  it('uses distance falloff and a delta-time-independent damage cadence', () => {
    expect(getBlackHolePullSpeed(1, 5, 3.5)).toBeGreaterThan(getBlackHolePullSpeed(4, 5, 3.5));
    expect(getBlackHolePullSpeed(5, 5, 3.5)).toBe(0);
    const config = createBlackHoleConfig();
    expect(getBlackHoleDamageTickCount(0, 0.49, config)).toBe(0);
    expect(getBlackHoleDamageTickCount(0.49, 1.01, config)).toBe(3);
  });

  it('preserves duration/radius nodes and raises Mass Capture from eight to twelve', () => {
    const base = createBlackHoleConfig();
    expect(base.captureLimit).toBe(BLACK_HOLE_BASE_CAPTURE_LIMIT);

    const upgraded = createBlackHoleConfig({
      activeNodes: new Set(['black_hole_a_1', 'black_hole_b_1', 'black_hole_bl_4']),
    });
    expect(upgraded.duration).toBeCloseTo(3.9);
    expect(upgraded.maxRadius).toBeCloseTo(6.5);
    expect(upgraded.captureLimit).toBe(BLACK_HOLE_MASS_CAPTURE_LIMIT);
  });

  it('keeps multiple-hole nodes out of per-hole timing while modeling giant and eternal voids', () => {
    const twin = createBlackHoleConfig({ activeNodes: new Set(['black_hole_al_4']) });
    expect(twin.duration).toBe(3);
    const giant = createBlackHoleConfig({ activeNodes: new Set(['black_hole_ar_4']) });
    expect(giant.duration).toBe(9);
    expect(giant.maxRadius).toBe(7);
    const eternal = createBlackHoleConfig({ activeNodes: new Set(['black_hole_ar_5']) });
    expect(eternal.duration).toBe(999);
    expect(eternal.isEternalCollapse).toBe(true);
  });
});

