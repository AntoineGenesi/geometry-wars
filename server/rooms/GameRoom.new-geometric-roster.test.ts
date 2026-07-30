import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ENEMY_HEALTH, ENEMY_SCORES, ENEMY_SPEEDS } from '../../src/shared/GameBalanceConstants';
import { EnemyState, GameState, PlayerState } from '../schema/GameState';
import { GameRoom } from './GameRoom';

function makeEnemy(id: string, type: string, health: number, u: number, v: number): EnemyState {
  const enemy = new EnemyState();
  enemy.id = id;
  enemy.type = type;
  enemy.health = health;
  enemy.maxHealth = health;
  enemy.surfaceU = u;
  enemy.surfaceV = v;
  enemy.alive = true;
  return enemy;
}

function makePlayer(): PlayerState {
  const player = new PlayerState();
  player.id = 'p1';
  player.alive = true;
  player.surfaceU = 0.8;
  player.surfaceV = 0.5;
  return player;
}

describe('GameRoom new geometric enemy roster parity', () => {
  it('shared MP constants define health, score, and speed for all new types', () => {
    expect(ENEMY_HEALTH.prism_lancer).toBe(3);
    expect(ENEMY_HEALTH.sentinel_orb).toBe(4);
    expect(ENEMY_HEALTH.shatter_bloom).toBe(9);
    expect(ENEMY_SCORES.prism_lancer).toBe(90);
    expect(ENEMY_SCORES.sentinel_orb).toBe(110);
    expect(ENEMY_SCORES.shatter_bloom).toBe(160);
    expect(ENEMY_SPEEDS.prism_lancer).toBeGreaterThan(ENEMY_SPEEDS.shatter_bloom);
  });

  it('network-main maps server names to matching client enemy bodies', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/network-main.ts'), 'utf8');

    expect(source).toContain("prism_lancer: 'prism_lancer'");
    expect(source).toContain("sentinel_orb: 'sentinel_orb'");
    expect(source).toContain("shatter_bloom: 'shatter_bloom'");
  });

  it('removeKilledEnemyAt bursts shatter_bloom into three normal server enemies', () => {
    const room = new GameRoom() as any;
    room.state = new GameState();
    room.enemyAI = new Map();

    const bloom = makeEnemy('bloom-1', 'shatter_bloom', 9, 0.5, 0.5);
    room.state.enemies.push(bloom);
    room.enemyAI.set(bloom.id, room.createEnemyAI('shatter_bloom'));

    const released = room.removeKilledEnemyAt(0);

    expect(released).toBe(3);
    expect(room.state.enemies).toHaveLength(3);
    expect(room.state.enemies.every((enemy: EnemyState) => enemy.type === 'grunt')).toBe(true);
    expect(room.state.enemies.every((enemy: EnemyState) => enemy.alive && !enemy.queued)).toBe(true);
    expect(room.state.enemies.every((enemy: EnemyState) => room.enemyAI.has(enemy.id))).toBe(true);
    expect(room.enemyAI.has(bloom.id)).toBe(false);
  });

  it('server AI moves prism_lancer and sentinel_orb with non-default behavior', () => {
    const room = new GameRoom() as any;
    room.state = new GameState();
    room.state.surfaceType = 'sphere';
    room.enemyAI = new Map();
    const player = makePlayer();
    room.state.players.set(player.id, player);

    const prism = makeEnemy('prism-1', 'prism_lancer', 3, 0.4, 0.5);
    const sentinel = makeEnemy('sentinel-1', 'sentinel_orb', 4, 0.55, 0.5);
    room.state.enemies.push(prism, sentinel);
    room.enemyAI.set(prism.id, room.createEnemyAI(prism.type));
    room.enemyAI.set(sentinel.id, room.createEnemyAI(sentinel.type));

    const prismStart = { u: prism.surfaceU, v: prism.surfaceV };
    const sentinelStart = { u: sentinel.surfaceU, v: sentinel.surfaceV };

    room.updateEnemies(0.5);

    expect(Math.abs(prism.surfaceU - prismStart.u) + Math.abs(prism.surfaceV - prismStart.v)).toBeGreaterThan(0);
    expect(Math.abs(sentinel.surfaceU - sentinelStart.u) + Math.abs(sentinel.surfaceV - sentinelStart.v)).toBeGreaterThan(0);
  });
});

