import { describe, expect, it } from 'vitest';
import { GameRoom } from './GameRoom';
import { EnemyState, GameState } from '../schema/GameState';

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

function makeQueuedSegment(parentId: string, queueIndex: number, health: number): EnemyState {
  const segment = makeEnemy(`${parentId}:q${queueIndex}`, 'grunt', health, 0.45 - queueIndex * 0.02, 0.5);
  segment.queued = true;
  segment.parentId = parentId;
  segment.queueIndex = queueIndex;
  return segment;
}

describe('GameRoom snake live queues', () => {
  it('EnemyState exposes queued segment schema fields with defaults', () => {
    const enemy = new EnemyState();

    expect(enemy.maxHealth).toBe(1);
    expect(enemy.queued).toBe(false);
    expect(enemy.parentId).toBe('');
    expect(enemy.queueIndex).toBe(-1);
  });

  it('removeKilledEnemyAt releases every queued snake segment as normal AI enemies at half current health', () => {
    const room = new GameRoom() as any;
    room.state = new GameState();
    room.enemyAI = new Map();

    const head = makeEnemy('snake-head', 'snake', 6, 0.5, 0.5);
    const seg0 = makeQueuedSegment(head.id, 0, 5);
    const seg1 = makeQueuedSegment(head.id, 1, 2);
    room.state.enemies.push(head, seg0, seg1);
    room.enemyAI.set(head.id, { currentSpeed: 0.02 });

    const released = room.removeKilledEnemyAt(0);

    expect(released).toBe(2);
    expect(room.state.enemies.map((e: EnemyState) => e.id)).toEqual([seg0.id, seg1.id]);
    for (const segment of room.state.enemies as EnemyState[]) {
      expect(segment.queued).toBe(false);
      expect(segment.parentId).toBe('');
      expect(segment.queueIndex).toBe(-1);
      expect(segment.alive).toBe(true);
      expect(room.enemyAI.has(segment.id)).toBe(true);
    }
    expect(room.state.enemies[0].health).toBe(3);
    expect(room.state.enemies[1].health).toBe(1);
    expect(room.enemyAI.has(head.id)).toBe(false);
  });
});
