import { describe, expect, it, vi } from 'vitest';
import {
  computeDifficultyLevel as computeSpDifficultyLevel,
  generateScaledEndlessWave,
  getDifficultyTier,
} from '../../src/core/DifficultyScaling';
import { computePlayerPower } from '../../src/shared/PlayerPowerModel';
import { STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS } from '../../src/systems/UpgradeTreeData';
import { GameRoom } from './GameRoom';

function makePlayer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Test Player',
    alive: true,
    score: 0,
    multiplier: 1,
    playerLevel: 0,
    playerKills: 0,
    enemyKills: 0,
    weaponType: 'standard',
    guardianCount: 0,
    hunterCount: 0,
    protectorCount: 0,
    ddaLevel: 0,
    buffStacks: new Map<string, number>(),
    activeUpgradeNodes: new Map<string, number>(),
    ...overrides,
  };
}

function makeRoom(playerOrPlayers: ReturnType<typeof makePlayer> | Array<ReturnType<typeof makePlayer>>) {
  const players = Array.isArray(playerOrPlayers) ? playerOrPlayers : [playerOrPlayers];
  const playerMap = new Map(players.map(player => [player.id, player]));
  const room = Object.create(GameRoom.prototype) as any;
  room.state = {
    gameTime: 600,
    gameMode: 'waves',
    players: playerMap,
    enemies: [],
  };
  room.waveNumber = 50;
  room.currentSettings = {
    difficultyMultiplier: 1,
    enemyCountCap: 200,
    enemyDifficultyPerPlayer: 'medium',
  };
  room.playerActiveUpgradeNodes = new Map();
  room.playerUpgradeKillCounts = new Map();
  room.playerPowerStreaks = new Map(players.map(player => [player.id, 0]));
  room.playerPowerLastDeathAt = new Map(players.map(player => [player.id, 600]));
  room.playerPowerRawScores = new Map(players.map(player => [player.id, 0]));
  room.broadcast = vi.fn();
  return room;
}

function totalWaveCount(room: any): number {
  return room.generateServerWave()
    .reduce((sum: number, entry: { count: number }) => sum + entry.count, 0);
}

function useEarlyMidWave(room: any): void {
  room.state.gameTime = 240;
  room.waveNumber = 8;
}

describe('GameRoom authoritative player-power integration', () => {
  it('keeps fresh default-unlocked Blaster Focus nodes inactive and DDA-neutral', () => {
    const player = makePlayer();
    const room = makeRoom(player);

    const snapshot = room.collectPlayerPower(player);
    const activeStandardNodes = room.playerActiveUpgradeNodes.get(player.id).get('standard');

    expect([...activeStandardNodes]).toEqual([]);
    expect([...player.activeUpgradeNodes.keys()]).toEqual([]);
    expect(snapshot.blaster?.shotsPerSecond).toBe(6);
    expect(snapshot.blaster?.projectilesPerShot).toBe(1);
    expect(room.getRoomDominance().difficultyBonus).toBeLessThan(0.05);
  });

  it('counts earned default-unlocked Blaster Focus upgrades toward DDA dominance after activation', () => {
    const baselinePlayer = makePlayer();
    const baselineRoom = makeRoom(baselinePlayer);
    const baselineDominance = baselineRoom.getRoomDominance().difficultyBonus;

    const earnedPlayer = makePlayer();
    const earnedRoom = makeRoom(earnedPlayer);
    earnedRoom.playerActiveUpgradeNodes.set(earnedPlayer.id, new Map([
      ['standard', new Set(STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS)],
    ]));

    const snapshot = earnedRoom.collectPlayerPower(earnedPlayer);
    const activeStandardNodes = earnedRoom.playerActiveUpgradeNodes.get(earnedPlayer.id).get('standard');

    expect([...activeStandardNodes].sort()).toEqual([
      ...STANDARD_BLASTER_EARLY_AUTO_UNLOCK_NODE_IDS,
    ].sort());
    expect(snapshot.blaster?.shotsPerSecond).toBeCloseTo(10.8);
    expect(snapshot.blaster?.projectilesPerShot).toBe(4);
    expect(earnedRoom.getRoomDominance().difficultyBonus).toBeGreaterThan(baselineDominance + 1);
  });

  it('counts earned non-baseline Standard upgrades beyond fresh DDA dominance', () => {
    const baselinePlayer = makePlayer();
    const baselineRoom = makeRoom(baselinePlayer);
    const baselineDominance = baselineRoom.getRoomDominance().difficultyBonus;

    const earnedPlayer = makePlayer();
    const earnedRoom = makeRoom(earnedPlayer);
    earnedRoom.playerActiveUpgradeNodes.set(earnedPlayer.id, new Map([
      ['standard', new Set(['standard_a_1'])],
    ]));

    const snapshot = earnedRoom.collectPlayerPower(earnedPlayer);

    expect(snapshot.blaster?.projectilesPerShot).toBe(2);
    expect(earnedRoom.getRoomDominance().difficultyBonus).toBeGreaterThan(baselineDominance + 1);
  });

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

  it('feeds MP raw score, multiplied score, and total kills into player power', () => {
    const player = makePlayer({ multiplier: 4 });
    const room = makeRoom(player);

    room.creditPlayerEnemyKill(player, 25, 'standard', 3);
    const snapshot = room.collectPlayerPower(player);
    const dominance = room.getRoomDominance();

    expect(player.score).toBe(300);
    expect(snapshot.rawScore).toBe(75);
    expect(snapshot.multipliedScore).toBe(300);
    expect(snapshot.totalKills).toBe(3);
    expect(dominance.rawScore).toBe(75);
    expect(dominance.multipliedScore).toBe(300);
    expect(dominance.killPressure).toBeGreaterThan(0);
  });

  it('adds visible wave pressure for a drone-heavy single survivor after the host dies without inflating HP', () => {
    const hostAlive = makePlayer({ id: 'host', name: 'Host', alive: true });
    const hostDead = makePlayer({ id: 'host', name: 'Host', alive: false });
    const droneSurvivor = makePlayer({
      id: 'phone',
      name: 'Phone',
      guardianCount: 4,
      hunterCount: 2,
      protectorCount: 2,
    });

    const bothAliveRoom = makeRoom([hostAlive, droneSurvivor]);
    const singleSurvivorRoom = makeRoom([hostDead, droneSurvivor]);
    useEarlyMidWave(bothAliveRoom);
    useEarlyMidWave(singleSurvivorRoom);

    const bothAliveCount = totalWaveCount(bothAliveRoom);
    const singleSurvivorCount = totalWaveCount(singleSurvivorRoom);

    expect(singleSurvivorRoom.getRoomDominance().companionDps).toBe(15);
    expect(singleSurvivorRoom.computeDifficultyLevel()).toBe(bothAliveRoom.computeDifficultyLevel());
    expect(singleSurvivorRoom.getEnemyHealth('grunt')).toBe(bothAliveRoom.getEnemyHealth('grunt'));
    expect(singleSurvivorRoom.getEnemyHealth('grunt')).toBe(2);
    expect(singleSurvivorRoom.computePlayerCountDifficultyMultiplier()).toBeGreaterThan(1);
    expect(singleSurvivorCount).toBeGreaterThan(bothAliveCount);
  });

  it('does not add drone-survivor pressure for multiple alive players, low elimination pressure, or struggling survivors', () => {
    const hostAlive = makePlayer({ id: 'host', name: 'Host', alive: true });
    const hostDead = makePlayer({ id: 'host', name: 'Host', alive: false });
    const droneSurvivor = makePlayer({
      id: 'phone',
      name: 'Phone',
      guardianCount: 4,
      hunterCount: 2,
      protectorCount: 2,
    });

    const bothAliveRoom = makeRoom([hostAlive, droneSurvivor]);
    const lowPressureRoom = makeRoom([hostDead, droneSurvivor]);
    lowPressureRoom.currentSettings.enemyDifficultyPerPlayer = 'low';

    const strugglingRoom = makeRoom([
      hostDead,
      makePlayer({
        ...droneSurvivor,
        ddaLevel: 2,
      }),
    ]);
    useEarlyMidWave(bothAliveRoom);
    useEarlyMidWave(lowPressureRoom);
    useEarlyMidWave(strugglingRoom);

    expect(bothAliveRoom.computePlayerCountDifficultyMultiplier()).toBe(1);
    expect(totalWaveCount(lowPressureRoom)).toBe(totalWaveCount(bothAliveRoom));
    expect(totalWaveCount(strugglingRoom)).toBeLessThan(totalWaveCount(bothAliveRoom));
    expect(strugglingRoom.computePlayerCountDifficultyMultiplier()).toBe(1);
  });

  it('keeps SP early-mid ramp tier pressure closer to MP flat-health waves', () => {
    const player = makePlayer({
      score: 300_000,
      enemyKills: 220,
    });
    const room = makeRoom(player);
    room.state.gameTime = 240;
    room.waveNumber = 8;
    room.playerPowerStreaks.set(player.id, 120);
    room.playerPowerLastDeathAt.set(player.id, 0);
    room.playerPowerRawScores.set(player.id, 300_000);

    const spPower = computePlayerPower({
      score: 300_000,
      rawScore: 300_000,
      multipliedScore: 300_000,
      totalKills: 220,
      survivalSeconds: 240,
      streak: 120,
      blaster: { damage: 1, shotsPerSecond: 6, projectilesPerShot: 1 },
    });
    const spDifficulty = computeSpDifficultyLevel({
      score: 300_000,
      rawScore: 300_000,
      multipliedScore: 300_000,
      elapsedTime: 240,
      combo: 120,
      totalKills: 220,
      playerLevel: 0,
      playerPower: spPower,
    });
    const spWave = generateScaledEndlessWave(8, spDifficulty, 0, 1);
    const spMaxTier = Math.max(...spWave.map(entry => entry.tier));
    const spTierTwoPlusCount = spWave
      .filter(entry => entry.tier >= 2)
      .reduce((sum, entry) => sum + entry.count, 0);
    const spNonBasicCount = spWave
      .filter(entry => !['grunt', 'wanderer', 'duck'].includes(entry.type))
      .reduce((sum, entry) => sum + entry.count, 0);

    const mpDifficulty = room.computeDifficultyLevel();
    const mpBaselineRoom = makeRoom(makePlayer());
    mpBaselineRoom.state.gameTime = 240;
    mpBaselineRoom.waveNumber = 8;
    const mpBaseHealth = mpBaselineRoom.getEnemyHealth('grunt');
    const mpEarlyMidHealth = room.getEnemyHealth('grunt');

    expect(spDifficulty).toBeGreaterThan(2);
    expect(mpDifficulty).toBeGreaterThan(spDifficulty);
    expect(mpDifficulty).toBeLessThan(8);
    expect(mpEarlyMidHealth).toBe(mpBaseHealth);
    expect(spNonBasicCount).toBeGreaterThan(20);
    expect(spMaxTier).toBeLessThanOrEqual(1);
    expect(spTierTwoPlusCount).toBe(0);
    expect(getDifficultyTier(spMaxTier).healthMultiplier).toBeLessThanOrEqual(3);
  });
});
