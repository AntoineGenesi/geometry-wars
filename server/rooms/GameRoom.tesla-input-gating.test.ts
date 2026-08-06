import { describe, expect, it } from 'vitest';
import type { ServerSurfaceManager } from '../movement/ServerSurfaceManager';
import { EnemyState, GameState, PlayerState } from '../schema/GameState';
import { GameRoom } from './GameRoom';

interface TeslaRoomInternals {
  surfaceManager: ServerSurfaceManager;
  playerInputs: Map<string, {
    moveX: number;
    moveY: number;
    aimAngle: number;
    shooting: boolean;
    bomb: boolean;
    boost?: boolean;
    weaponSwap?: boolean;
    camRightX?: number;
    camRightY?: number;
    camRightZ?: number;
    camUpX?: number;
    camUpY?: number;
    camUpZ?: number;
  }>;
  applyPlayerMovement(dt: number): void;
  applyWalkerStateToPlayer(player: PlayerState, location: unknown): void;
}

function makeInput(shooting: boolean) {
  return {
    moveX: 0,
    moveY: 0,
    aimAngle: 0,
    shooting,
    bomb: false,
    boost: false,
    weaponSwap: false,
    camRightX: 1,
    camRightY: 0,
    camRightZ: 0,
    camUpX: 0,
    camUpY: 1,
    camUpZ: 0,
  };
}

function makeTeslaScenario() {
  const room = new GameRoom();
  (room as any).setState(new GameState());
  room.state.surfaceType = 'sphere';
  room.state.mapSize = 'medium';
  room.state.roomPhase = 'playing';
  room.state.isPaused = false;

  const internals = room as unknown as TeslaRoomInternals;
  internals.surfaceManager.initSurface('sphere');

  const player = new PlayerState();
  player.id = 'p1';
  player.alive = true;
  player.weaponType = 'tesla_coil';
  player.weaponAmmo = 30;
  player.multiplier = 1;
  player.playerLevel = 0;
  room.state.players.set(player.id, player);

  const walker = internals.surfaceManager.createWalker(player.id, 0.5, 0.5);
  expect(walker).toBeTruthy();
  internals.applyWalkerStateToPlayer(player, walker!.getLocation());

  const enemy = new EnemyState();
  enemy.id = 'e1';
  enemy.type = 'grunt';
  enemy.health = 10;
  enemy.maxHealth = 10;
  enemy.alive = true;
  enemy.wx = player.wx + player.nx;
  enemy.wy = player.wy + player.ny;
  enemy.wz = player.wz + player.nz;
  enemy.surfaceU = player.surfaceU;
  enemy.surfaceV = player.surfaceV;
  room.state.enemies.push(enemy);

  return { internals, player, enemy };
}

describe('GameRoom Tesla Coil input gating', () => {
  it('does not drain ammo or damage enemies while shooting input is false', () => {
    const { internals, player, enemy } = makeTeslaScenario();
    const initialAmmo = player.weaponAmmo;
    const initialHealth = enemy.health;

    internals.playerInputs.set(player.id, makeInput(false));
    internals.applyPlayerMovement(1 / 60);

    expect(player.weaponAmmo).toBe(initialAmmo);
    expect(enemy.health).toBe(initialHealth);
  });

  it('drains ammo and damages enemies while shooting input is true', () => {
    const { internals, player, enemy } = makeTeslaScenario();
    const initialAmmo = player.weaponAmmo;
    const initialHealth = enemy.health;

    internals.playerInputs.set(player.id, makeInput(true));
    internals.applyPlayerMovement(1 / 60);

    expect(player.weaponAmmo).toBeLessThan(initialAmmo);
    expect(enemy.health).toBeLessThan(initialHealth);
  });

  it('stops draining after shooting input is released', () => {
    const { internals, player, enemy } = makeTeslaScenario();

    internals.playerInputs.set(player.id, makeInput(true));
    internals.applyPlayerMovement(1 / 60);
    const ammoAfterHeld = player.weaponAmmo;
    const healthAfterHeld = enemy.health;

    internals.playerInputs.set(player.id, makeInput(false));
    internals.applyPlayerMovement(1 / 60);

    expect(player.weaponAmmo).toBe(ammoAfterHeld);
    expect(enemy.health).toBe(healthAfterHeld);
  });
});
