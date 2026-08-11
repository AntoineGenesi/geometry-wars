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
    expect(getBlackHoleState(1, config)).toMatchObject({ phase: 'sustain', radius: 8.5 });
    expect(getBlackHoleState(4, config).phase).toBe('collapse');
    expect(getBlackHoleState(4.5, config).phase).toBe('expired');
  });

  it('uses distance falloff and a delta-time-independent damage cadence', () => {
    expect(getBlackHolePullSpeed(1, 8.5, 6)).toBeGreaterThan(getBlackHolePullSpeed(8, 8.5, 6));
    expect(getBlackHolePullSpeed(8, 8.5, 6)).toBeGreaterThan(1.5);
    expect(getBlackHolePullSpeed(10, 8.5, 6)).toBe(0);
    const config = createBlackHoleConfig();
    expect(getBlackHoleDamageTickCount(0, 0.49, config)).toBe(0);
    expect(getBlackHoleDamageTickCount(0.49, 1.01, config)).toBe(3);
  });

  it('preserves duration/radius nodes and raises Mass Capture from ten to sixteen', () => {
    const base = createBlackHoleConfig();
    expect(base.captureLimit).toBe(BLACK_HOLE_BASE_CAPTURE_LIMIT);

    const upgraded = createBlackHoleConfig({
      activeNodes: new Set(['black_hole_a_1', 'black_hole_b_1', 'black_hole_bl_4']),
    });
    expect(upgraded.duration).toBeCloseTo(5.85);
    expect(upgraded.maxRadius).toBeCloseTo(11.05);
    expect(upgraded.captureLimit).toBe(BLACK_HOLE_MASS_CAPTURE_LIMIT);
  });

  it('keeps multiple-hole nodes out of per-hole timing while modeling giant and eternal voids', () => {
    const twin = createBlackHoleConfig({ activeNodes: new Set(['black_hole_al_4']) });
    expect(twin.duration).toBe(4.5);
    const giant = createBlackHoleConfig({ activeNodes: new Set(['black_hole_ar_4']) });
    expect(giant.duration).toBe(13.5);
    expect(giant.maxRadius).toBeCloseTo(11.9);
    const eternal = createBlackHoleConfig({ activeNodes: new Set(['black_hole_ar_5']) });
    expect(eternal.duration).toBe(999);
    expect(eternal.isEternalCollapse).toBe(true);
  });
});
