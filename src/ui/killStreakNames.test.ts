import { describe, it, expect } from 'vitest';
import {
  STREAK_NAMES,
  STREAK_MILESTONES,
  STREAK_TIERS,
  getStreakName,
  getStreakTier,
} from './killStreakNames';

describe('STREAK_NAMES', () => {
  it('has exactly 200 entries (keys 1–200)', () => {
    const keys = Object.keys(STREAK_NAMES).map(Number);
    expect(keys.length).toBe(200);
    for (let i = 1; i <= 200; i++) {
      expect(STREAK_NAMES[i]).toBeDefined();
    }
  });

  it('all 200 names are unique (no duplicates)', () => {
    const names = Object.values(STREAK_NAMES);
    const unique = new Set(names);
    expect(unique.size).toBe(200);
  });

  it('no name is empty or whitespace-only', () => {
    for (const name of Object.values(STREAK_NAMES)) {
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('STREAK_MILESTONES', () => {
  it('has at least 30 milestones', () => {
    expect(STREAK_MILESTONES.length).toBeGreaterThanOrEqual(30);
  });

  it('all milestones are positive integers', () => {
    for (const m of STREAK_MILESTONES) {
      expect(Number.isInteger(m)).toBe(true);
      expect(m).toBeGreaterThan(0);
    }
  });

  it('milestones are sorted ascending', () => {
    for (let i = 1; i < STREAK_MILESTONES.length; i++) {
      expect(STREAK_MILESTONES[i]).toBeGreaterThan(STREAK_MILESTONES[i - 1]);
    }
  });

  it('includes 1, 5, 10, 50, 100, 200 as representative milestones', () => {
    expect(STREAK_MILESTONES).toContain(1);
    expect(STREAK_MILESTONES).toContain(5);
    expect(STREAK_MILESTONES).toContain(10);
    expect(STREAK_MILESTONES).toContain(50);
    expect(STREAK_MILESTONES).toContain(100);
    expect(STREAK_MILESTONES).toContain(200);
  });
});

describe('STREAK_TIERS', () => {
  it('has at least 10 tiers', () => {
    expect(STREAK_TIERS.length).toBeGreaterThanOrEqual(10);
  });

  it('each tier has unique color', () => {
    const colors = STREAK_TIERS.map(t => t.color);
    const unique = new Set(colors);
    expect(unique.size).toBe(STREAK_TIERS.length);
  });

  it('each tier has unique glowColor', () => {
    const glows = STREAK_TIERS.map(t => t.glowColor);
    const unique = new Set(glows);
    expect(unique.size).toBe(STREAK_TIERS.length);
  });

  it('first tier starts at minStreak 1 (covers all counts)', () => {
    const sorted = [...STREAK_TIERS].sort((a, b) => a.minStreak - b.minStreak);
    expect(sorted[0].minStreak).toBe(1);
  });

  it('pitch values are all positive', () => {
    for (const tier of STREAK_TIERS) {
      expect(tier.pitch).toBeGreaterThan(0);
    }
  });
});

describe('getStreakName', () => {
  it('returns name for 1', () => {
    expect(getStreakName(1)).toBe('Nice Shot');
  });

  it('returns name for 200', () => {
    expect(getStreakName(200)).toBe('The Incomprehensible');
  });

  it('wraps 201 to name for 1', () => {
    expect(getStreakName(201)).toBe(getStreakName(1));
  });

  it('wraps 400 to name for 200', () => {
    expect(getStreakName(400)).toBe(getStreakName(200));
  });

  it('does not crash for 2001', () => {
    expect(() => getStreakName(2001)).not.toThrow();
    expect(typeof getStreakName(2001)).toBe('string');
  });

  it('wraps consistently: getStreakName(n) === getStreakName(n + 200)', () => {
    for (let i = 1; i <= 200; i++) {
      expect(getStreakName(i)).toBe(getStreakName(i + 200));
    }
  });
});

describe('getStreakTier', () => {
  it('returns tier with minStreak 1 for count 1', () => {
    const tier = getStreakTier(1);
    expect(tier.minStreak).toBe(1);
  });

  it('returns higher tier for count 100 than count 10', () => {
    const t100 = getStreakTier(100);
    const t10 = getStreakTier(10);
    expect(t100.minStreak).toBeGreaterThan(t10.minStreak);
  });

  it('returns last tier for very large counts (>200)', () => {
    const t201 = getStreakTier(201);
    const t1000 = getStreakTier(1000);
    // Both should be the highest tier (minStreak 151)
    expect(t201.minStreak).toBe(151);
    expect(t1000.minStreak).toBe(151);
  });

  it('does not crash for 0 or negative', () => {
    expect(() => getStreakTier(0)).not.toThrow();
    expect(() => getStreakTier(-5)).not.toThrow();
  });
});
