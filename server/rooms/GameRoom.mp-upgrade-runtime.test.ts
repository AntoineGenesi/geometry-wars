import { describe, expect, it, vi } from 'vitest';
import { GameRoom } from './GameRoom';
import { WeaponType } from '../../src/weapons/WeaponTypes';
import { validateMpUpgradeActivation } from './mpUpgradeActivation';

function makeRoom() {
  const room = Object.create(GameRoom.prototype) as any;
  room.state = {
    gameTime: 0,
    surfaceType: 'sphere',
    bullets: [],
    players: new Map(),
  };
  room.playerActiveUpgradeNodes = new Map();
  room.playerUpgradeKillCounts = new Map();
  return room;
}

function makePlayer(weaponType: string = WeaponType.Standard) {
  return {
    id: 'p1',
    weaponType,
    weaponAmmo: weaponType === WeaponType.Standard ? -1 : 30,
    aimAngle: 0,
    surfaceU: 0.5,
    surfaceV: 0.5,
  };
}

describe('GameRoom MP weapon upgrade runtime parity', () => {
  it('emits upgraded Standard projectile patterns from server-authoritative nodes', () => {
    const room = makeRoom();
    const player = makePlayer();
    room.state.players.set('p1', player);
    room.playerActiveUpgradeNodes.set('p1', new Map([
      [WeaponType.Standard, new Set(['standard_a_4', 'standard_b_3'])],
    ]));

    room.tryShoot(player);

    const standardBullets = room.state.bullets.filter((b: any) => b.weaponType === WeaponType.Standard);
    expect(standardBullets).toHaveLength(9);
    expect(new Set(standardBullets.map((b: any) => b.dirY)).size).toBeGreaterThan(2);
  });

  it('emits upgraded Spread pellet count and applies server damage multiplier', () => {
    const room = makeRoom(WeaponType.Spread);
    const player = makePlayer(WeaponType.Spread);
    room.state.players.set('p1', player);
    room.playerActiveUpgradeNodes.set('p1', new Map([
      [WeaponType.Spread, new Set(['spread_a_1', 'spread_al_5'])],
    ]));

    room.tryShoot(player);

    const spreadBullets = room.state.bullets.filter((b: any) => b.weaponType === WeaponType.Spread);
    expect(spreadBullets).toHaveLength(11);
    expect(room.getUpgradeDamageMult('p1', WeaponType.Spread)).toBeCloseTo(1.15);
  });

  it('publishes accepted nodes through PlayerState when room state is present', () => {
    const room = makeRoom();
    const activeUpgradeNodes = new Map<string, number>();
    room.state.players.set('p1', { activeUpgradeNodes });
    room.playerUpgradeKillCounts.set('p1', new Map([[WeaponType.Standard, 10]]));
    room.logger = { log: vi.fn() };

    const result = room.handleUpgradeActivationRequest('p1', {
      nodeId: 'standard_a_1',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_a_1'],
    });

    expect(result.accepted).toBe(true);
    expect(activeUpgradeNodes.get('standard:standard_a_1')).toBe(1);
  });

  it('clears private and schema upgrade state together at round reset', () => {
    const room = makeRoom();
    const activeUpgradeNodes = new Map<string, number>([['standard:standard_a_1', 1]]);
    room.state.players.set('p1', { activeUpgradeNodes });
    room.playerUpgradeKillCounts.set('p1', new Map([[WeaponType.Standard, 25]]));
    room.playerActiveUpgradeNodes.set('p1', new Map([
      [WeaponType.Standard, new Set(['standard_a_1'])],
    ]));

    room.clearActiveUpgradeState();

    expect(room.playerUpgradeKillCounts.size).toBe(0);
    expect(room.playerActiveUpgradeNodes.size).toBe(0);
    expect(activeUpgradeNodes.size).toBe(0);
  });

  it('rejects accepted-tree nodes whose MP runtime effect is not implemented', () => {
    expect(validateMpUpgradeActivation({
      nodeId: 'standard_bl_5',
      weaponType: WeaponType.Standard,
      unlockedNodeIds: ['standard_bl_5'],
    }, {
      activeNodeIds: new Set(['standard_b_4']),
      killCount: 120,
    })).toMatchObject({ accepted: false, reason: 'unsupported_runtime_effect' });
  });
});
