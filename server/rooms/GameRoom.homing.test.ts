import { describe, expect, it, vi } from 'vitest';
import { BulletState, EnemyState, GameState } from '../schema/GameState';
import { BULLET_LIFETIME, MP_HOMING_BULLET_LIFETIME } from '../shared/GameConstants';
import { surfaceUVToWorld3D } from './GameRoom';
import { GameRoom } from './GameRoom';

interface HomingRoomInternals {
  updateBullets(dt: number): void;
  bulletWorldDistanceToEnemy(bullet: BulletState, enemy: EnemyState): number;
}

function makeRoom(): GameRoom & HomingRoomInternals {
  const room = new GameRoom() as GameRoom & HomingRoomInternals;
  (room as any).setState(new GameState());
  (room as any).broadcast = vi.fn();
  (room as any).logger = { log: vi.fn() };
  room.state.surfaceType = 'sphere';
  room.state.mapSize = 'medium';
  return room;
}

function makeBullet(overrides: Partial<BulletState> = {}): BulletState {
  const bullet = new BulletState();
  bullet.id = overrides.id ?? 'homing-bullet';
  bullet.ownerId = overrides.ownerId ?? 'owner';
  bullet.weaponType = overrides.weaponType ?? 'homing';
  bullet.x = overrides.x ?? 0.5;
  bullet.y = overrides.y ?? 0.5;
  bullet.dirX = overrides.dirX ?? 1;
  bullet.dirY = overrides.dirY ?? 0;
  bullet.dirZ = overrides.dirZ ?? 0;
  bullet.age = overrides.age ?? 0;
  return bullet;
}

function makeEnemy(id: string, u: number, v: number, overrides: Partial<EnemyState> = {}): EnemyState {
  const enemy = new EnemyState();
  enemy.id = id;
  enemy.type = 'grunt';
  enemy.surfaceU = u;
  enemy.surfaceV = v;
  const [wx, wy, wz] = surfaceUVToWorld3D('sphere', u, v, 1, 10);
  enemy.wx = wx;
  enemy.wy = wy;
  enemy.wz = wz;
  enemy.health = overrides.health ?? 10;
  enemy.maxHealth = overrides.maxHealth ?? enemy.health;
  enemy.alive = overrides.alive ?? true;
  enemy.queued = overrides.queued ?? false;
  return enemy;
}

describe('MP homing bullets', () => {
  it('steer toward the nearest live enemy and reduce distance on the server path', () => {
    const room = makeRoom();
    const bullet = makeBullet({ dirX: 1, dirY: 0 });
    const target = makeEnemy('target', 0.5, 0.42);
    room.state.bullets.push(bullet);
    room.state.enemies.push(target);

    const beforeDistance = room.bulletWorldDistanceToEnemy(bullet, target);
    for (let i = 0; i < 20; i++) {
      room.updateBullets(1 / 60);
    }
    const afterDistance = room.bulletWorldDistanceToEnemy(bullet, target);

    expect(bullet.dirY).toBeLessThan(-0.15);
    expect(afterDistance).toBeLessThan(beforeDistance);
  });

  it('retargets to alive non-queued enemies instead of queued or dead nearer enemies', () => {
    const room = makeRoom();
    const bullet = makeBullet({ dirX: 0, dirY: -1 });
    room.state.bullets.push(bullet);
    room.state.enemies.push(
      makeEnemy('queued-near', 0.5, 0.45, { queued: true }),
      makeEnemy('dead-near', 0.5, 0.46, { alive: false }),
      makeEnemy('live-right', 0.56, 0.5),
    );

    room.updateBullets(1 / 60);

    expect(bullet.dirX).toBeGreaterThan(0.15);
  });

  it('uses homing missile lifetime instead of generic bullet lifetime', () => {
    const room = makeRoom();
    const homing = makeBullet({ id: 'homing', weaponType: 'homing', age: BULLET_LIFETIME + 0.25 });
    const standard = makeBullet({ id: 'standard', weaponType: 'standard', age: BULLET_LIFETIME + 0.25 });
    room.state.bullets.push(homing, standard);

    room.updateBullets(1 / 60);

    expect(room.state.bullets.find((bullet) => bullet.id === 'homing')).toBeTruthy();
    expect(room.state.bullets.find((bullet) => bullet.id === 'standard')).toBeFalsy();
    expect(MP_HOMING_BULLET_LIFETIME).toBeGreaterThan(BULLET_LIFETIME);
  });
});
