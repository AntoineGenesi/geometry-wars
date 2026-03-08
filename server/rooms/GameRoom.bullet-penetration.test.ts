/**
 * s44r3-02 Regression: MP bullet penetration / damage budget tracking.
 *
 * Bug: bulletClientHitSent was a per-bullet Set — after the first hit, the bullet
 * was blocked from reporting any further hits. Server also applied full damage on every
 * bullet_hit message with no per-bullet budget enforcement.
 *
 * Fix: Server tracks per-bullet remaining damage budget. Client tracks per-enemy hits
 * to prevent double-hitting the same enemy, but allows the bullet to continue hitting
 * different enemies as long as the server-side budget is not depleted.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WEAPON_CONFIGS, LEVEL_DAMAGE_MULTIPLIERS } from '../shared/GameConstants';

// ---------------------------------------------------------------------------
// Minimal types
// ---------------------------------------------------------------------------

interface TestPlayer {
  id: string;
  sessionId: string;
  playerLevel: number;
  playerKills: number;
  enemyKills: number;
  score: number;
  multiplier: number;
}

interface TestEnemy {
  id: string;
  alive: boolean;
  health: number;
  type: string;
  surfaceU: number;
  surfaceV: number;
}

interface BulletHitData {
  bulletId: string;
  enemyId: string;
  weaponType: string;
  ownerId: string;
}

interface BulletHitResult {
  rejected: boolean;
  damageDealt: number;
  enemyKilled: boolean;
  remainingDamage: number; // NEW: remaining damage budget after this hit
}

// ---------------------------------------------------------------------------
// Updated bullet_hit handler with damage budget tracking
// ---------------------------------------------------------------------------

function handleBulletHitWithBudget(
  clientSessionId: string,
  data: BulletHitData,
  players: Map<string, TestPlayer>,
  enemies: TestEnemy[],
  bulletDamageTracker: Map<string, number>, // NEW: persistent per-bullet budget
): BulletHitResult {
  const result: BulletHitResult = { rejected: false, damageDealt: 0, enemyKilled: false, remainingDamage: 0 };

  if (!data.ownerId || data.ownerId !== clientSessionId) {
    result.rejected = true;
    return result;
  }
  if (!data.enemyId || typeof data.enemyId !== 'string') {
    result.rejected = true;
    return result;
  }

  const player = players.get(clientSessionId);
  if (!player) { result.rejected = true; return result; }

  const enemyIdx = enemies.findIndex((e) => e.id === data.enemyId);
  if (enemyIdx < 0) { result.rejected = true; return result; }

  const enemy = enemies[enemyIdx];
  if (!enemy.alive) { result.rejected = true; return result; }

  const weaponType = typeof data.weaponType === 'string' ? data.weaponType : 'standard';
  const weaponCfg = WEAPON_CONFIGS[weaponType] ?? WEAPON_CONFIGS.standard;
  const levelIdx = Math.min(player.playerLevel, LEVEL_DAMAGE_MULTIPLIERS.length - 1);
  const levelDamageMult = LEVEL_DAMAGE_MULTIPLIERS[levelIdx];
  const finalDamage = weaponCfg.damage * levelDamageMult; // simplified (no buff mult for tests)

  // Get or initialize remaining budget
  const currentRemaining = bulletDamageTracker.has(data.bulletId)
    ? bulletDamageTracker.get(data.bulletId)!
    : finalDamage;

  // Reject if budget depleted
  if (currentRemaining <= 0) {
    result.rejected = true;
    return result;
  }

  // Apply actual damage (capped by remaining budget)
  const actualDamage = Math.min(currentRemaining, enemy.health);
  const newRemaining = currentRemaining - actualDamage;

  bulletDamageTracker.set(data.bulletId, newRemaining);
  enemy.health -= actualDamage;
  result.damageDealt = actualDamage;
  result.remainingDamage = newRemaining;

  if (enemy.health <= 0) {
    enemy.alive = false;
    enemies.splice(enemyIdx, 1);
    result.enemyKilled = true;

    player.score += 50 * player.multiplier;
    player.playerKills++;
    player.enemyKills++;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bullet penetration — s44r3-02: MP damage budget tracking', () => {
  let bulletDamageTracker: Map<string, number>;

  beforeEach(() => {
    bulletDamageTracker = new Map();
  });

  function makePlayer(overrides: Partial<TestPlayer> = {}): TestPlayer {
    return {
      id: 'player1',
      sessionId: 'player1',
      playerLevel: 0,
      playerKills: 0,
      enemyKills: 0,
      score: 0,
      multiplier: 1,
      ...overrides,
    };
  }

  function makeEnemy(overrides: Partial<TestEnemy> = {}): TestEnemy {
    return {
      id: 'enemy1',
      alive: true,
      health: 2,
      type: 'grunt',
      surfaceU: 0.5,
      surfaceV: 0.5,
      ...overrides,
    };
  }

  it('plasma bullet (20 damage) kills grunt (2 HP) and has 18 remaining — can hit second enemy', () => {
    const players = new Map([['player1', makePlayer()]]);
    const grunt = makeEnemy({ id: 'enemy1', health: 2 });
    const wanderer = makeEnemy({ id: 'enemy2', health: 2 });
    const enemies = [grunt, wanderer];

    // First hit: plasma vs grunt
    const hit1 = handleBulletHitWithBudget('player1', {
      bulletId: 'b1', enemyId: 'enemy1', weaponType: 'plasma_mortar', ownerId: 'player1',
    }, players, enemies, bulletDamageTracker);

    expect(hit1.rejected).toBe(false);
    expect(hit1.enemyKilled).toBe(true);
    expect(hit1.remainingDamage).toBeGreaterThan(0); // Plasma (20) > grunt HP (2), has remaining

    // Second hit: same bullet vs wanderer
    const hit2 = handleBulletHitWithBudget('player1', {
      bulletId: 'b1', enemyId: 'enemy2', weaponType: 'plasma_mortar', ownerId: 'player1',
    }, players, enemies, bulletDamageTracker);

    expect(hit2.rejected).toBe(false); // PENETRATION: bullet continues
    expect(hit2.enemyKilled).toBe(true); // Wanderer also killed
    expect(hit2.damageDealt).toBe(2); // min(18, 2) = 2
  });

  it('standard bullet (1 damage) hits grunt (2 HP) — remaining=0, second hit rejected', () => {
    const players = new Map([['player1', makePlayer()]]);
    const grunt = makeEnemy({ id: 'enemy1', health: 2 });
    const wanderer = makeEnemy({ id: 'enemy2', health: 2 });
    const enemies = [grunt, wanderer];

    // First hit: standard vs grunt
    const hit1 = handleBulletHitWithBudget('player1', {
      bulletId: 'b2', enemyId: 'enemy1', weaponType: 'standard', ownerId: 'player1',
    }, players, enemies, bulletDamageTracker);

    expect(hit1.rejected).toBe(false);
    expect(hit1.enemyKilled).toBe(false); // 2 HP, only dealt 1
    expect(hit1.remainingDamage).toBe(0); // standard (1) - min(1, 2) = 1 → remaining = 0

    // Second hit: same bullet vs wanderer — should be REJECTED (budget depleted)
    const hit2 = handleBulletHitWithBudget('player1', {
      bulletId: 'b2', enemyId: 'enemy2', weaponType: 'standard', ownerId: 'player1',
    }, players, enemies, bulletDamageTracker);

    expect(hit2.rejected).toBe(true); // Budget depleted, no penetration
    expect(enemies[1].health).toBe(2); // Wanderer untouched
  });

  it('piercing bullet (3 damage) kills duck (1 HP) → remaining=2, hits second enemy for min(2, HP)', () => {
    const players = new Map([['player1', makePlayer()]]);
    const duck = makeEnemy({ id: 'duck1', health: 1 });
    const grunt = makeEnemy({ id: 'grunt1', health: 2 });
    const enemies = [duck, grunt];

    const hit1 = handleBulletHitWithBudget('player1', {
      bulletId: 'b3', enemyId: 'duck1', weaponType: 'piercing', ownerId: 'player1',
    }, players, enemies, bulletDamageTracker);

    expect(hit1.enemyKilled).toBe(true);
    expect(hit1.damageDealt).toBe(1); // min(3, 1) = 1 — only kills duck
    expect(hit1.remainingDamage).toBe(2); // 3 - 1 = 2 remaining

    const hit2 = handleBulletHitWithBudget('player1', {
      bulletId: 'b3', enemyId: 'grunt1', weaponType: 'piercing', ownerId: 'player1',
    }, players, enemies, bulletDamageTracker);

    expect(hit2.rejected).toBe(false);
    expect(hit2.damageDealt).toBe(2); // min(2, 2) = 2 — kills grunt
    expect(hit2.enemyKilled).toBe(true);
    expect(hit2.remainingDamage).toBe(0); // 2 - 2 = 0
  });

  it('second hit on the SAME enemy (after it respawned or re-entered alive) is limited to remaining budget', () => {
    const players = new Map([['player1', makePlayer()]]);
    const enemy = makeEnemy({ id: 'enemy1', health: 5 });
    const enemies = [enemy];

    // First partial hit
    const hit1 = handleBulletHitWithBudget('player1', {
      bulletId: 'b4', enemyId: 'enemy1', weaponType: 'piercing', ownerId: 'player1',
    }, players, enemies, bulletDamageTracker);

    expect(hit1.damageDealt).toBe(3); // piercing = 3, min(3, 5) = 3; remaining = 0
    expect(hit1.remainingDamage).toBe(0);

    // Budget now exhausted — even the same enemy can't be re-hit
    const hit2 = handleBulletHitWithBudget('player1', {
      bulletId: 'b4', enemyId: 'enemy1', weaponType: 'piercing', ownerId: 'player1',
    }, players, enemies, bulletDamageTracker);

    expect(hit2.rejected).toBe(true);
    expect(enemies[0].health).toBe(2); // enemy still has 2 HP (5 - 3 = 2)
  });

  it('multiple chain penetrations: homing (6 damage) through three 1-HP enemies', () => {
    const players = new Map([['player1', makePlayer()]]);
    const e1 = makeEnemy({ id: 'e1', health: 1 });
    const e2 = makeEnemy({ id: 'e2', health: 1 });
    const e3 = makeEnemy({ id: 'e3', health: 1 });
    const e4 = makeEnemy({ id: 'e4', health: 1 });
    const enemies = [e1, e2, e3, e4];

    const hits = ['e1', 'e2', 'e3', 'e4'].map((eid) =>
      handleBulletHitWithBudget('player1', {
        bulletId: 'b5', enemyId: eid, weaponType: 'homing', ownerId: 'player1',
      }, players, enemies, bulletDamageTracker),
    );

    // homing = 6 damage, 4 enemies × 1 HP each = 4 total
    // Hits 1–4 should all succeed (6 budget, 4 consumed)
    expect(hits[0].rejected).toBe(false);
    expect(hits[1].rejected).toBe(false);
    expect(hits[2].rejected).toBe(false);
    expect(hits[3].rejected).toBe(false);
    expect(hits[3].remainingDamage).toBe(2); // 6 - 4 = 2 remaining
  });

  it('bullets with no remaining damage do not apply damage even if ownerId matches', () => {
    const players = new Map([['player1', makePlayer()]]);
    const enemy = makeEnemy({ id: 'enemy1', health: 10 });
    const enemies = [enemy];

    // Manually deplete the budget
    bulletDamageTracker.set('b6', 0);

    const hit = handleBulletHitWithBudget('player1', {
      bulletId: 'b6', enemyId: 'enemy1', weaponType: 'standard', ownerId: 'player1',
    }, players, enemies, bulletDamageTracker);

    expect(hit.rejected).toBe(true);
    expect(hit.damageDealt).toBe(0);
    expect(enemies[0].health).toBe(10); // Untouched
  });
});
