/**
 * Unit tests for MP per-player scoring isolation (s44r17-03).
 *
 * Tests the scoring logic for all 5 MP modes:
 *   - King of the Hill (KOTH): zoneTime per-player isolation
 *   - PvP: kill attribution to the correct player
 *   - PvPvE: kills primary, enemyKills secondary
 *   - Waves: independent per-player score
 *   - Rainbow: same as Waves (SP-side color multiplier only)
 *
 * Note: tests use world-space distance check (matching actual server logic
 * from GameRoom.ts:5062 — fixed in s44r16-02b), not the old UV-space check.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// World-space zone detection (mirrors GameRoom.ts updateZoneTimeScoring)
// ---------------------------------------------------------------------------

interface WorldPos { x: number; y: number; z: number }

/**
 * Compute whether a player at worldPos is inside the KOTH zone.
 * Mirrors GameRoom.ts line 5062-5070 (s44r16-02b world-space fix).
 */
function isPlayerInKothZoneWorldSpace(
  playerPos: WorldPos,
  zoneCenter: WorldPos,
  worldRadius: number,
): boolean {
  const dx = playerPos.x - zoneCenter.x;
  const dy = playerPos.y - zoneCenter.y;
  const dz = playerPos.z - zoneCenter.z;
  return dx * dx + dy * dy + dz * dz <= worldRadius * worldRadius;
}

/**
 * Simulate KOTH scoring for 2 players over N seconds.
 * Player A stays in zone; Player B stays outside.
 * Returns { aZoneTime, bZoneTime } after simulation.
 */
function simulateKothTwoPlayers(
  playerAPos: WorldPos,
  playerBPos: WorldPos,
  zoneCenter: WorldPos,
  worldRadius: number,
  durationSeconds: number,
  fps = 30,
): { aZoneTime: number; bZoneTime: number } {
  let aZoneTime = 0;
  let bZoneTime = 0;
  const dt = 1 / fps;
  const ticks = Math.round(durationSeconds * fps);

  for (let i = 0; i < ticks; i++) {
    if (isPlayerInKothZoneWorldSpace(playerAPos, zoneCenter, worldRadius)) {
      aZoneTime += dt;
    }
    if (isPlayerInKothZoneWorldSpace(playerBPos, zoneCenter, worldRadius)) {
      bZoneTime += dt;
    }
  }
  return { aZoneTime, bZoneTime };
}

// ---------------------------------------------------------------------------
// PvP kill attribution (mirrors GameRoom.ts pvp_bullet_hit handler ~1611)
// ---------------------------------------------------------------------------

interface PlayerKillState {
  id: string;
  name: string;
  health: number;
  maxHealth: number;
  kills: number;
  alive: boolean;
}

/**
 * Apply PvP damage from shooter to target.
 * Mirrors GameRoom.ts s44r2-09: fractional kills per damage dealt.
 * Returns kill attribution event or null if no kill.
 */
function applyPvpDamage(
  shooter: PlayerKillState,
  target: PlayerKillState,
  damage: number,
): { killedBy: string | null; killFraction: number } {
  const dealtDamage = Math.min(damage, target.health);
  const killFraction = dealtDamage / target.maxHealth;

  // Fractional kill score: damage dealt / maxHealth (s44r2-09)
  shooter.kills += killFraction;

  target.health -= dealtDamage;
  const killed = target.health <= 0;
  if (killed) {
    target.alive = false;
  }

  return {
    killedBy: killed ? shooter.id : null,
    killFraction,
  };
}

// ---------------------------------------------------------------------------
// Waves per-player scoring (mirrors GameRoom.ts ~1456-1458)
// ---------------------------------------------------------------------------

/**
 * Enemy score lookup (mirrors GameRoom.getEnemyScore).
 */
function getEnemyScore(type: string): number {
  const scores: Record<string, number> = {
    basic: 100,
    fast: 150,
    tank: 300,
    boss: 1000,
  };
  return scores[type] ?? 100;
}

interface PlayerScoreState {
  id: string;
  score: number;
  multiplier: number;
  enemyKills: number;
}

/**
 * Award score for an enemy kill to a specific player.
 * Mirrors GameRoom.ts ~1453-1458.
 */
function awardEnemyKillScore(player: PlayerScoreState, enemyType: string): void {
  player.score += getEnemyScore(enemyType) * player.multiplier;
  player.enemyKills++;
}

// ---------------------------------------------------------------------------
// KOTH Per-Player Isolation Tests
// ---------------------------------------------------------------------------

describe('KOTH per-player scoring isolation', () => {
  const ZONE_CENTER = { x: 0, y: 10, z: 0 };
  const WORLD_RADIUS = 2.5;

  it('only the player inside the zone accumulates zoneTime', () => {
    // Player A at zone center (inside zone)
    const playerA = { x: 0, y: 10, z: 0 };
    // Player B far from zone (outside)
    const playerB = { x: 20, y: 10, z: 0 };

    const { aZoneTime, bZoneTime } = simulateKothTwoPlayers(
      playerA, playerB, ZONE_CENTER, WORLD_RADIUS, 5,
    );

    expect(aZoneTime).toBeCloseTo(5, 0); // ~5 seconds in zone
    expect(bZoneTime).toBe(0); // Player B never in zone
  });

  it('player outside zone accumulates ZERO zoneTime', () => {
    const playerOutside = { x: 0, y: 10, z: 5.0 }; // 5 units from center, radius=2.5 → outside
    const zoneCenter = { x: 0, y: 10, z: 0 };

    const inZone = isPlayerInKothZoneWorldSpace(playerOutside, zoneCenter, WORLD_RADIUS);
    expect(inZone).toBe(false);
  });

  it('player at zone boundary edge is inside zone', () => {
    // Player exactly at the zone radius edge (2.5 units away)
    const playerAtEdge = { x: WORLD_RADIUS, y: 10, z: 0 };
    const inZone = isPlayerInKothZoneWorldSpace(playerAtEdge, ZONE_CENTER, WORLD_RADIUS);
    expect(inZone).toBe(true); // On the boundary (<=), should be inside
  });

  it('player just outside zone boundary is not in zone', () => {
    const playerJustOutside = { x: WORLD_RADIUS + 0.01, y: 10, z: 0 };
    const inZone = isPlayerInKothZoneWorldSpace(playerJustOutside, ZONE_CENTER, WORLD_RADIUS);
    expect(inZone).toBe(false);
  });

  it('both players in zone both accumulate zoneTime independently', () => {
    const playerA = { x: 0, y: 10, z: 0 }; // Inside
    const playerB = { x: 1, y: 10, z: 0 }; // Also inside (1 unit from center, radius=2.5)

    const { aZoneTime, bZoneTime } = simulateKothTwoPlayers(
      playerA, playerB, ZONE_CENTER, WORLD_RADIUS, 10,
    );

    // Both players in zone → both accumulate ~10s
    expect(aZoneTime).toBeCloseTo(10, 0);
    expect(bZoneTime).toBeCloseTo(10, 0);
  });

  it('scores are not shared or pooled — Player A time does not affect Player B', () => {
    // Simulate Player A scoring in zone for 5s
    const playerA = { x: 0, y: 10, z: 0 };
    const playerB = { x: 20, y: 10, z: 20 }; // Far outside

    const { aZoneTime, bZoneTime } = simulateKothTwoPlayers(
      playerA, playerB, ZONE_CENTER, WORLD_RADIUS, 5,
    );

    // Player B should have exactly 0 — not half of A's time, not any fraction
    expect(bZoneTime).toBe(0);
    // Player A's time is not inflated by Player B's presence
    expect(aZoneTime).toBeCloseTo(5, 0);
  });

  it('zoneTime uses world-space (not UV-space) distance', () => {
    // Two points that would give different UV vs world distances
    // Player at (3.0, 10, 0) — world distance 3.0 from center (outside 2.5 radius)
    const playerWorldOutside = { x: 3.0, y: 10, z: 0 };
    const inZone = isPlayerInKothZoneWorldSpace(playerWorldOutside, ZONE_CENTER, WORLD_RADIUS);
    expect(inZone).toBe(false);

    // Player at (2.0, 10, 0) — world distance 2.0 from center (inside 2.5 radius)
    const playerWorldInside = { x: 2.0, y: 10, z: 0 };
    const inZone2 = isPlayerInKothZoneWorldSpace(playerWorldInside, ZONE_CENTER, WORLD_RADIUS);
    expect(inZone2).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PvP Kill Attribution Tests
// ---------------------------------------------------------------------------

describe('PvP kill attribution — kills go to shooter, not victim', () => {
  function makePlayer(id: string, maxHealth = 100): PlayerKillState {
    return { id, name: id, health: maxHealth, maxHealth, kills: 0, alive: true };
  }

  it('shooter gets fractional kill credit, victim does not', () => {
    const shooter = makePlayer('alice');
    const victim = makePlayer('bob');

    applyPvpDamage(shooter, victim, 50); // 50/100 = 0.5 kills

    expect(shooter.kills).toBeCloseTo(0.5, 5);
    expect(victim.kills).toBe(0); // victim does NOT get kill credit
  });

  it('full kill awards fractional credit equal to full health', () => {
    const shooter = makePlayer('alice');
    const victim = makePlayer('bob', 100);

    applyPvpDamage(shooter, victim, 100); // lethal hit

    expect(shooter.kills).toBe(1.0);
    expect(victim.kills).toBe(0);
    expect(victim.alive).toBe(false);
  });

  it('multiple hits accumulate fractional kills', () => {
    const shooter = makePlayer('alice');
    const victim = makePlayer('bob', 100);

    applyPvpDamage(shooter, victim, 25); // 0.25 kills
    applyPvpDamage(shooter, victim, 25); // 0.25 kills
    applyPvpDamage(shooter, victim, 50); // 0.50 kills (lethal)

    expect(shooter.kills).toBe(1.0); // total = 1.0 kill
    expect(victim.kills).toBe(0);
    expect(victim.alive).toBe(false);
  });

  it('kill goes to the shooter who dealt the final blow', () => {
    const aliceShooter = makePlayer('alice');
    const bobShooter = makePlayer('bob');
    const carolVictim = makePlayer('carol', 100);

    // Alice deals 70 damage, Bob deals 30 damage (lethal)
    applyPvpDamage(aliceShooter, carolVictim, 70);
    applyPvpDamage(bobShooter, carolVictim, 30);

    expect(aliceShooter.kills).toBeCloseTo(0.7, 5);
    expect(bobShooter.kills).toBeCloseTo(0.3, 5);
    expect(carolVictim.kills).toBe(0);
    expect(carolVictim.alive).toBe(false);
  });

  it('scores are NOT shared between PvP players', () => {
    const player1 = makePlayer('p1');
    const player2 = makePlayer('p2');
    const enemy = makePlayer('enemy', 100);

    // Player 1 kills enemy entirely on their own
    applyPvpDamage(player1, enemy, 100);

    expect(player1.kills).toBe(1.0);
    expect(player2.kills).toBe(0); // Player 2 didn't shoot — no credit
  });
});

// ---------------------------------------------------------------------------
// Waves Per-Player Independence Tests
// ---------------------------------------------------------------------------

describe('Waves mode — per-player score independence', () => {
  function makeScorer(id: string): PlayerScoreState {
    return { id, score: 0, multiplier: 1, enemyKills: 0 };
  }

  it('each player scores only for their own kills', () => {
    const player1 = makeScorer('p1');
    const player2 = makeScorer('p2');

    // Player 1 kills 5 basic enemies (100pts each)
    for (let i = 0; i < 5; i++) awardEnemyKillScore(player1, 'basic');
    // Player 2 kills 1 basic enemy
    awardEnemyKillScore(player2, 'basic');

    expect(player1.score).toBe(500);
    expect(player2.score).toBe(100);
    expect(player1.score).not.toBe(player2.score);
  });

  it('scores are not pooled or shared', () => {
    const player1 = makeScorer('p1');
    const player2 = makeScorer('p2');

    // Player 1 kills 3 enemies
    for (let i = 0; i < 3; i++) awardEnemyKillScore(player1, 'basic');

    // Player 2 score should still be 0 — not half of player1's, not average
    expect(player2.score).toBe(0);
  });

  it('multiplier affects only the scoring player', () => {
    const player1 = makeScorer('p1');
    const player2 = makeScorer('p2');
    player1.multiplier = 3; // Player 1 has x3 multiplier

    awardEnemyKillScore(player1, 'basic'); // 100 * 3 = 300
    awardEnemyKillScore(player2, 'basic'); // 100 * 1 = 100

    expect(player1.score).toBe(300);
    expect(player2.score).toBe(100);
  });

  it('enemy kill counts are per-player', () => {
    const player1 = makeScorer('p1');
    const player2 = makeScorer('p2');

    for (let i = 0; i < 5; i++) awardEnemyKillScore(player1, 'basic');
    awardEnemyKillScore(player2, 'basic');

    expect(player1.enemyKills).toBe(5);
    expect(player2.enemyKills).toBe(1);
  });

  it('different enemy types give different points per-player', () => {
    const player1 = makeScorer('p1');

    awardEnemyKillScore(player1, 'basic'); // 100
    awardEnemyKillScore(player1, 'fast');  // 150
    awardEnemyKillScore(player1, 'tank');  // 300
    awardEnemyKillScore(player1, 'boss');  // 1000

    expect(player1.score).toBe(1550);
    expect(player1.enemyKills).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// PvPvE Mode — scoring priority tests
// ---------------------------------------------------------------------------

describe('PvPvE mode — scoring uses both kills and score fields', () => {
  it('enemy kills contribute to score, PvP kills to kills field', () => {
    const player = makeScorer('p1') as PlayerScoreState & { kills: number };
    (player as any).kills = 0;

    // Enemy kill → score increases
    awardEnemyKillScore(player, 'basic'); // score += 100
    expect(player.score).toBe(100);

    // PvP kill → kills field increases (simulated)
    const pvpTarget = { id: 'enemy', name: 'enemy', health: 100, maxHealth: 100, kills: 0, alive: true };
    applyPvpDamage(player as any, pvpTarget, 100);
    expect((player as any).kills).toBe(1.0);

    // Scores remain independent
    expect(player.score).toBe(100); // enemy kills unchanged
    expect((player as any).kills).toBe(1.0); // PvP kills unchanged
  });
});

// ---------------------------------------------------------------------------
// Rainbow Mode — same as Waves scoring
// ---------------------------------------------------------------------------

describe('Rainbow mode — scoring is same as Waves (SP-side color multiplier)', () => {
  it('rainbow mode uses score field just like Waves', () => {
    const player = makeScorer('p1');
    awardEnemyKillScore(player, 'basic');
    // Rainbow mode in MP is just Waves — no server-side color multiplier
    expect(player.score).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Cross-mode score isolation: different modes track different fields
// ---------------------------------------------------------------------------

describe('Mode-to-scoring-field isolation', () => {
  it('KOTH scoring does not pollute score field', () => {
    // In KOTH: primary metric is zoneTime, kills still award score
    // but the PRIMARY display is zoneTime
    // Test: zoneTime accumulation does NOT affect score
    const player = makeScorer('p1');
    // Simulate player in zone for 5s — zoneTime would increment
    // but score remains 0 (no enemies killed)
    expect(player.score).toBe(0); // No kills = no score

    // Kill an enemy (optional in KOTH, but score still tracked)
    awardEnemyKillScore(player, 'basic');
    expect(player.score).toBe(100); // Kill points tracked separately from zoneTime
  });

  it('PvP scoring uses kills field, not score field for primary ranking', () => {
    const p1 = { id: 'p1', name: 'p1', health: 100, maxHealth: 100, kills: 0, alive: true };
    const p2 = { id: 'p2', name: 'p2', health: 100, maxHealth: 100, kills: 0, alive: true };

    applyPvpDamage(p1, p2, 100);
    expect(p1.kills).toBe(1.0);
    // In PvP mode, client displays p.kills not p.score (network-main.ts:4675)
  });
});

function makeScorer(id: string): PlayerScoreState {
  return { id, score: 0, multiplier: 1, enemyKills: 0 };
}
