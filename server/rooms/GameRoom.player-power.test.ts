import { describe, expect, it, vi } from 'vitest';
import { GameRoom } from './GameRoom';

function makePlayer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    alive: true,
    score: 0,
    playerLevel: 0,
    weaponType: 'standard',
    guardianCount: 0,
    hunterCount: 0,
    protectorCount: 0,
    ddaLevel: 0,
    buffStacks: new Map<string, number>(),
    ...overrides,
  };
}

function makeRoom(player: ReturnType<typeof makePlayer>) {
  const room = Object.create(GameRoom.prototype) as any;
  room.state = {
    gameTime: 600,
    gameMode: 'waves',
    players: new Map([[player.id, player]]),
    enemies: [],
  };
  room.waveNumber = 50;
  room.currentSettings = {
    difficultyMultiplier: 1,
    enemyCountCap: 200,
    enemyDifficultyPerPlayer: 'medium',
  };
  room.playerActiveUpgradeNodes = new Map();
  room.playerPowerStreaks = new Map([[player.id, 0]]);
  room.playerPowerLastDeathAt = new Map([[player.id, 600]]);
  return room;
}

describe('GameRoom authoritative player-power integration', () => {
  it('collects accepted upgrades and bounded companion power on the server', () => {
    const player = makePlayer({
      score: 1_000_000,
      playerLevel: 9,
      guardianCount: 127,
      hunterCount: 127,
      protectorCount: 127,
    });
    const room = makeRoom(player);
    room.playerPowerStreaks.set(player.id, 250);
    room.playerPowerLastDeathAt.set(player.id, 0);
    room.playerActiveUpgradeNodes.set(player.id, new Map([
      ['standard', new Set(['standard_a_1', 'standard_a_2', 'standard_a_3', 'standard_b_3'])],
    ]));

    const snapshot = room.collectPlayerPower(player);
    const dominance = room.getRoomDominance();
    expect(snapshot.streak).toBe(250);
    expect(snapshot.survivalSeconds).toBe(600);
    expect(snapshot.companions?.guardianDamage).toBe(1);
    expect(snapshot.companions?.hunterDamage).toBe(1);
    expect(snapshot.companions?.guardianShotsPerSecond).toBe(3);
    expect(snapshot.companions?.hunterShotsPerSecond).toBe(1.5);
    expect(dominance.guardianDps).toBe(12);
    expect(dominance.hunterDps).toBe(6);
    expect(dominance.protectorValue).toBeCloseTo(0.6);
    expect(dominance.difficultyBonus).toBeGreaterThanOrEqual(3);
    expect(dominance.difficultyBonus).toBeLessThanOrEqual(5);
  });

  it('raises final difficulty, aggregate health, and wave count beyond HP-only pressure', () => {
    const baselinePlayer = makePlayer();
    const baselineRoom = makeRoom(baselinePlayer);
    const baselineDifficulty = baselineRoom.computeDifficultyLevel();
    const baselineWave = baselineRoom.generateServerWave();
    const baselineCount = baselineWave.reduce((sum: number, entry: { count: number }) => sum + entry.count, 0);
    const baselineHealth = baselineRoom.getEnemyHealth('grunt') * baselineCount;

    const highPlayer = makePlayer({
      score: 1_000_000,
      playerLevel: 9,
      guardianCount: 2,
      hunterCount: 2,
    });
    const highRoom = makeRoom(highPlayer);
    highRoom.playerPowerStreaks.set(highPlayer.id, 250);
    highRoom.playerPowerLastDeathAt.set(highPlayer.id, 0);
    highRoom.playerActiveUpgradeNodes.set(highPlayer.id, new Map([
      ['standard', new Set(['standard_a_1', 'standard_a_2', 'standard_a_3', 'standard_b_3'])],
    ]));
    const highDifficulty = highRoom.computeDifficultyLevel();
    const highWave = highRoom.generateServerWave();
    const highCount = highWave.reduce((sum: number, entry: { count: number }) => sum + entry.count, 0);
    const highHealth = highRoom.getEnemyHealth('grunt') * highCount;

    expect(highDifficulty).toBeGreaterThan(baselineDifficulty + 2);
    expect(highHealth).toBeGreaterThan(baselineHealth);
    expect(highCount).toBeGreaterThan(baselineCount);
  });

  it('resets continuous PvE streak and survival on authoritative death events', () => {
    const player = makePlayer({ ddaLevel: 2 });
    const room = makeRoom(player);
    room.playerPerfWindows = new Map([[player.id, { kills: 0, deaths: 0, windowStart: 0 }]]);
    room.playerPowerStreaks.set(player.id, 20);
    room.state.gameTime = 321;

    room.trackDDADeath(player.id);
    const snapshot = room.collectPlayerPower(player);
    expect(snapshot.streak).toBe(0);
    expect(snapshot.survivalSeconds).toBe(0);
    expect(room.playerPerfWindows.get(player.id).deaths).toBe(1);
    expect(player.ddaLevel).toBe(2);
    expect(room.getRoomDominance().difficultyBonus).toBeLessThan(0.05);
  });

  it('preserves the struggling-player safe-spawn exclusion distance', () => {
    const player = makePlayer({ ddaLevel: 2, surfaceU: 0.5, surfaceV: 0.5 });
    const room = makeRoom(player);
    room.state.surfaceType = 'sphere';
    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1);

    const spawn = room.getSpawnPosition();
    random.mockRestore();
    const du = Math.min(Math.abs(spawn.u - player.surfaceU), 1 - Math.abs(spawn.u - player.surfaceU));
    const dv = Math.abs(spawn.v - player.surfaceV);
    expect(Math.hypot(du, dv)).toBeGreaterThanOrEqual(0.35);
  });
});
