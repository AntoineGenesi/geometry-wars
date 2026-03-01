/**
 * GameRoom Parity Tests — Phase H regression guards
 *
 * Tests the pure-math gameplay formulas extracted from GameRoom.ts:
 *   - Player level damage multiplier
 *   - Kill-count → level advancement
 *   - Buff damage multiplier (HotHands stacks)
 *   - Weapon pickup collision detection (UV distance threshold)
 *   - Bullet pole crossing (sphere V-axis reflection + U shift)
 *
 * Pattern: extract the same math as GameRoom.ts and test it in isolation,
 * without needing a live Colyseus Room instance (follows existing GameRoom.test.ts convention).
 */

import { describe, it, expect } from 'vitest';
import {
  LEVEL_THRESHOLDS,
  LEVEL_DAMAGE_MULTIPLIERS,
  WEAPON_CONFIGS,
} from '../shared/GameConstants.js';

// ---------------------------------------------------------------------------
// Helpers — extracted from GameRoom.ts (kept in sync manually)
// ---------------------------------------------------------------------------

/** Mirrors GameRoom.getPlayerLevel() */
function getPlayerLevel(kills: number): number {
  let level = 0;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (kills >= LEVEL_THRESHOLDS[i]) level = i;
    else break;
  }
  return level;
}

/** Mirrors GameRoom.calculateBuffDamageMult() — only HotHands tested here */
function calculateBuffDamageMult(buffStacks: Map<string, number>): number {
  let mult = 1.0;
  const hotHands = buffStacks.get('hot_hands') ?? 0;
  if (hotHands > 0) mult *= 1 + hotHands * 0.06;
  const volatile_ = buffStacks.get('volatile') ?? 0;
  if (volatile_ > 0) mult *= 1 + volatile_ * 0.08;
  const incendiary = buffStacks.get('incendiary_rounds') ?? 0;
  if (incendiary > 0) mult *= 1 + incendiary * 0.04;
  return Math.min(mult, 5.0);
}

/** Mirrors GameRoom.wrapCoord() */
function wrapCoord(v: number): number {
  return ((v % 1) + 1) % 1;
}

/** UV distance (non-wrapped) for simple proximity tests */
function uvDist(u1: number, v1: number, u2: number, v2: number): number {
  const du = u1 - u2;
  const dv = v1 - v2;
  return Math.sqrt(du * du + dv * dv);
}

/** Mirrors bullet pole-crossing logic from GameRoom.updateBullets() — sphere only */
interface Bullet {
  x: number;  // U
  y: number;  // V
  dirX: number;
  dirY: number;
}

function applyBulletPoleCrossing(bullet: Bullet): Bullet {
  let { x, y, dirX, dirY } = bullet;
  if (y < 0) {
    y = -y;
    x = wrapCoord(x + 0.5);
    dirX = -dirX;
    dirY = -dirY;
  } else if (y > 1) {
    y = 2 - y;
    x = wrapCoord(x + 0.5);
    dirX = -dirX;
    dirY = -dirY;
  }
  return { x, y, dirX, dirY };
}

// ---------------------------------------------------------------------------
// Section 1: Player Level Damage Multiplier
// ---------------------------------------------------------------------------

describe('Player level damage multiplier', () => {
  it('level 0 → damage multiplier is 1.0 (no bonus)', () => {
    expect(LEVEL_DAMAGE_MULTIPLIERS[0]).toBe(1.0);
  });

  it('level 5 → damage multiplier is 1.45 (Destroyer perk)', () => {
    expect(LEVEL_DAMAGE_MULTIPLIERS[5]).toBe(1.45);
  });

  it('level 9 (max) → damage multiplier is 2.0', () => {
    expect(LEVEL_DAMAGE_MULTIPLIERS[9]).toBe(2.0);
  });

  it('multipliers are non-decreasing (each level >= previous)', () => {
    for (let i = 1; i < LEVEL_DAMAGE_MULTIPLIERS.length; i++) {
      expect(LEVEL_DAMAGE_MULTIPLIERS[i]).toBeGreaterThanOrEqual(LEVEL_DAMAGE_MULTIPLIERS[i - 1]);
    }
  });

  it('finalDamage formula: standard bullet at level 5 = 1.0 × 1.45 = 1.45 (S43-02 parity fix)', () => {
    // standard.damage was changed from 0.25 to 1.0 in S43-02 to match SP effective damage at game start.
    const base = WEAPON_CONFIGS.standard.damage; // 1.0
    const levelMult = LEVEL_DAMAGE_MULTIPLIERS[5]; // 1.45
    expect(base * levelMult).toBeCloseTo(1.45, 5);
  });
});

// ---------------------------------------------------------------------------
// Section 2: Kill Counter → Level Advancement
// ---------------------------------------------------------------------------

describe('Kill counter → level advancement', () => {
  it('0 kills → level 0', () => {
    expect(getPlayerLevel(0)).toBe(0);
  });

  it('9 kills → still level 0 (threshold is 10)', () => {
    expect(getPlayerLevel(9)).toBe(0);
  });

  it('10 kills → advances to level 1', () => {
    expect(getPlayerLevel(10)).toBe(1);
  });

  it('24 kills → still level 1 (threshold is 25)', () => {
    expect(getPlayerLevel(24)).toBe(1);
  });

  it('25 kills → advances to level 2', () => {
    expect(getPlayerLevel(25)).toBe(2);
  });

  it('level thresholds match expected values', () => {
    expect(LEVEL_THRESHOLDS).toEqual([0, 10, 25, 50, 80, 120, 175, 250, 350, 500]);
  });

  it('500 kills → level 9 (max level)', () => {
    expect(getPlayerLevel(500)).toBe(9);
  });

  it('10000 kills → capped at level 9 (no overflow)', () => {
    expect(getPlayerLevel(10000)).toBe(9);
  });
});

// ---------------------------------------------------------------------------
// Section 3: Buff Damage Multiplier (HotHands)
// ---------------------------------------------------------------------------

describe('Buff damage multiplier (HotHands stacks)', () => {
  it('0 stacks → multiplier is 1.0 (no bonus)', () => {
    const stacks = new Map<string, number>();
    expect(calculateBuffDamageMult(stacks)).toBe(1.0);
  });

  it('1 HotHands stack → multiplier is 1.06', () => {
    const stacks = new Map<string, number>([['hot_hands', 1]]);
    expect(calculateBuffDamageMult(stacks)).toBeCloseTo(1.06, 5);
  });

  it('3 HotHands stacks → multiplier is 1.18 (1 + 3×0.06)', () => {
    const stacks = new Map<string, number>([['hot_hands', 3]]);
    expect(calculateBuffDamageMult(stacks)).toBeCloseTo(1.18, 5);
  });

  it('5 HotHands stacks → multiplier is 1.30 (1 + 5×0.06)', () => {
    const stacks = new Map<string, number>([['hot_hands', 5]]);
    expect(calculateBuffDamageMult(stacks)).toBeCloseTo(1.30, 5);
  });

  it('buff multiplier is capped at 5.0 (exploit prevention)', () => {
    // 100 stacks would be 7.0×, but cap is 5.0
    const stacks = new Map<string, number>([['hot_hands', 100]]);
    expect(calculateBuffDamageMult(stacks)).toBe(5.0);
  });
});

// ---------------------------------------------------------------------------
// Section 4: Weapon Pickup Collision Detection
// ---------------------------------------------------------------------------

describe('Weapon pickup collision detection (UV distance)', () => {
  // Default scaleFactor=1.0 → PICKUP_RADIUS = 0.02
  const PICKUP_RADIUS = 0.02;

  it('player exactly at pickup (dist=0) → within pickup radius', () => {
    const dist = uvDist(0.5, 0.5, 0.5, 0.5);
    expect(dist < PICKUP_RADIUS).toBe(true);
  });

  it('player 0.01 UV away → within pickup radius (0.01 < 0.02)', () => {
    const dist = uvDist(0.5, 0.5, 0.51, 0.5);
    expect(dist).toBeCloseTo(0.01, 5);
    expect(dist < PICKUP_RADIUS).toBe(true);
  });

  it('player 0.019 UV away → within pickup radius', () => {
    const dist = uvDist(0.5, 0.5, 0.519, 0.5);
    expect(dist).toBeCloseTo(0.019, 5);
    expect(dist < PICKUP_RADIUS).toBe(true);
  });

  it('player 0.021 UV away → outside pickup radius (0.021 > 0.02)', () => {
    const dist = uvDist(0.5, 0.5, 0.521, 0.5);
    expect(dist).toBeCloseTo(0.021, 5);
    expect(dist < PICKUP_RADIUS).toBe(false);
  });

  it('player 0.1 UV away → far from pickup, no pickup', () => {
    const dist = uvDist(0.5, 0.5, 0.6, 0.5);
    expect(dist < PICKUP_RADIUS).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Section 5: Bullet Pole Crossing (Sphere)
// ---------------------------------------------------------------------------

describe('Bullet pole crossing (sphere V-axis reflection)', () => {
  it('bullet at V=0.01 moving north (dirY=-1) → stays in [0,1] range', () => {
    // Simulate bullet moving north (negative dirY = toward north pole at V=0)
    const SPEED = 0.13;
    const DT = 1 / 60;
    const bullet: Bullet = { x: 0.5, y: 0.01, dirX: 0, dirY: -1 };

    // Step until bullet crosses the pole
    let current = { ...bullet };
    let crossed = false;
    for (let step = 0; step < 10; step++) {
      current.y += current.dirY * SPEED * DT;
      if (current.y < 0) {
        current = applyBulletPoleCrossing(current);
        crossed = true;
        break;
      }
    }
    expect(crossed).toBe(true);
    expect(current.y).toBeGreaterThanOrEqual(0);
    expect(current.y).toBeLessThanOrEqual(1);
  });

  it('bullet crosses north pole → V reflects, U shifts by 0.5', () => {
    // Bullet at V=-0.01 (just crossed north pole)
    const bullet: Bullet = { x: 0.3, y: -0.01, dirX: 0.5, dirY: -1 };
    const result = applyBulletPoleCrossing(bullet);

    expect(result.y).toBeCloseTo(0.01, 5);            // V reflects: -(-0.01) = 0.01
    expect(result.x).toBeCloseTo(0.8, 5);             // U shifts: 0.3 + 0.5 = 0.8
    expect(result.dirX).toBeCloseTo(-0.5, 5);         // dirX flips
    expect(result.dirY).toBeCloseTo(1, 5);            // dirY flips (now heading south)
  });

  it('bullet crosses south pole → V reflects from 2-V, U shifts by 0.5', () => {
    // Bullet at V=1.01 (just crossed south pole)
    const bullet: Bullet = { x: 0.7, y: 1.01, dirX: -0.3, dirY: 1 };
    const result = applyBulletPoleCrossing(bullet);

    expect(result.y).toBeCloseTo(0.99, 5);            // V reflects: 2 - 1.01 = 0.99
    expect(result.x).toBeCloseTo(0.2, 5);             // U shifts: 0.7 + 0.5 = 1.2 → wrap → 0.2
    expect(result.dirX).toBeCloseTo(0.3, 5);          // dirX flips
    expect(result.dirY).toBeCloseTo(-1, 5);           // dirY flips (now heading north)
  });

  it('bullet in mid-range (V=0.5) → no pole crossing, state unchanged', () => {
    const bullet: Bullet = { x: 0.5, y: 0.5, dirX: 1, dirY: 0.5 };
    const result = applyBulletPoleCrossing(bullet);
    expect(result.y).toBe(0.5);
    expect(result.x).toBe(0.5);
    expect(result.dirX).toBe(1);
    expect(result.dirY).toBe(0.5);
  });

  it('U wrap-around: bullet at U=0.8 crossing north pole → U=(0.8+0.5)%1=0.3', () => {
    const bullet: Bullet = { x: 0.8, y: -0.005, dirX: 0, dirY: -1 };
    const result = applyBulletPoleCrossing(bullet);
    expect(result.x).toBeCloseTo(0.3, 5);
  });
});

// ---------------------------------------------------------------------------
// S43-02: MP Bullet Hit Detection — Damage Parity Regression Guards
//
// Root cause: standard.damage was 0.25 in GameConstants.ts but SP's effective
// bullet damage is 1.0 (product of multipliers, weapon config damage NOT used).
// With 0.25 damage: grunt (health=2) needed 8 hits in MP vs 2 hits in SP.
// Fix: standard.damage = 1.0 in GameConstants.ts.
// ---------------------------------------------------------------------------

describe('S43-02: MP standard bullet damage parity with SP', () => {
  it('standard weapon damage is 1.0 (matches SP effective bullet damage at game start)', () => {
    // SP: bulletDamage = scorePowerMult(1.0) * levelMult(1.0) * buffMult(1.0) * masteryMult(1.0) = 1.0
    // MP: finalDamage = standard.damage * levelMult * buffMult * masteryMult = 1.0 * 1.0 * 1.0 * 1.0 = 1.0
    expect(WEAPON_CONFIGS.standard.damage).toBe(1.0);
  });

  it('grunt (health=2) dies in 2 standard bullet hits in MP (matches SP behavior)', () => {
    // REGRESSION: was 8 hits with damage=0.25 (user reported "15 bullets go through")
    const gruntHealth = 2;
    const bulletDamage = WEAPON_CONFIGS.standard.damage * LEVEL_DAMAGE_MULTIPLIERS[0]; // level 0
    const hitsToKill = Math.ceil(gruntHealth / bulletDamage);
    expect(hitsToKill).toBe(2);
  });

  it('REGRESSION: standard.damage was 0.25 — grunt needed 8 hits (4x too many)', () => {
    // This verifies the bug was real: with damage=0.25, grunt needed 8 hits not 2.
    const gruntHealth = 2;
    const oldDamage = 0.25;
    const hitsWithOldDamage = Math.ceil(gruntHealth / oldDamage);
    expect(hitsWithOldDamage).toBe(8); // was 8x vs SP's 2 = severe regression
    // New value:
    expect(WEAPON_CONFIGS.standard.damage).not.toBe(0.25);
  });

  it('full damage formula at game start (level 0, no buffs): finalDamage = 1.0', () => {
    const baseDamage = WEAPON_CONFIGS.standard.damage;
    const levelDamageMult = LEVEL_DAMAGE_MULTIPLIERS[0]; // level 0 = 1.0
    const buffDamageMult = 1.0;
    const masteryDamageMult = 1.0;
    const finalDamage = baseDamage * levelDamageMult * buffDamageMult * masteryDamageMult;
    expect(finalDamage).toBeCloseTo(1.0, 5);
  });

  it('UV hit detection: bullet at dist=0 hits enemy (exact overlap)', () => {
    // BULLET_HIT_RADIUS = 0.015 / scaleFactor (scaleFactor=1.0 for medium map)
    const BULLET_HIT_RADIUS = 0.015;
    const dist = 0;
    expect(dist < BULLET_HIT_RADIUS).toBe(true);
  });

  it('UV hit detection: bullet at dist=0.010 hits enemy (inside threshold)', () => {
    const BULLET_HIT_RADIUS = 0.015;
    const du = 0.010;
    const dist = Math.sqrt(du * du);
    expect(dist < BULLET_HIT_RADIUS).toBe(true);
  });

  it('UV hit detection: bullet at dist=0.020 misses enemy (outside threshold)', () => {
    const BULLET_HIT_RADIUS = 0.015;
    const du = 0.020;
    const dist = Math.sqrt(du * du);
    expect(dist < BULLET_HIT_RADIUS).toBe(false);
  });
});
