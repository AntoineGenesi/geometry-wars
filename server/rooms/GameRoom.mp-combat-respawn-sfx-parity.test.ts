import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ServerMeshWalker } from '../movement/ServerMeshWalker';
import type { ServerMeshLocation } from '../movement/ServerMeshLocation';
import type { ServerSurfaceManager } from '../movement/ServerSurfaceManager';
import { BlackHoleFieldState, EnemyState, GameState, PlayerState } from '../schema/GameState';
import { GameRoom } from './GameRoom';

interface CombatRoomInternals {
  surfaceManager: ServerSurfaceManager;
  enemyWalkers: Map<string, ServerMeshWalker>;
  enemyAI: Map<string, Record<string, unknown>>;
  pendingRespawns: Map<string, number>;
  playerInvincibility: Map<string, number>;
  applyWalkerStateToPlayer(player: PlayerState, location: ServerMeshLocation): void;
  applyWalkerStateToEnemy(enemy: EnemyState, location: ServerMeshLocation): void;
  spawnBlackHoleFieldFromLocation(ownerId: string, location: ServerMeshLocation): BlackHoleFieldState;
  updateBlackHoleFields(dt: number): void;
  drainRespawnTimers(): void;
}

function makeRoom(mode: string): { room: GameRoom; internals: CombatRoomInternals; player: PlayerState } {
  const room = new GameRoom();
  (room as any).setState(new GameState());
  (room as any).setMetadata = vi.fn();
  (room as any).broadcast = vi.fn();
  (room as any).logger = { log: vi.fn() };
  room.state.surfaceType = 'cube';
  room.state.mapSize = 'medium';
  room.state.roomPhase = 'playing';
  room.state.gameStarted = true;
  room.state.gameTime = 1;
  room.state.gameMode = mode;
  room.state.pvpMode = mode === 'pvpve' ? 'pvpve' : '';
  room.state.pvpEnabled = mode === 'pvpve';

  const internals = room as unknown as CombatRoomInternals;
  internals.surfaceManager.initSurface('cube', 1);

  const player = new PlayerState();
  player.id = 'p1';
  player.name = 'Player 1';
  player.alive = true;
  player.health = 100;
  player.maxHealth = 100;
  player.weaponType = 'black_hole';
  player.weaponAmmo = 5;
  player.aimAngle = 0;
  room.state.players.set(player.id, player);

  const walker = internals.surfaceManager.createWalker(player.id, 0.44, 0.47)!;
  internals.applyWalkerStateToPlayer(player, walker.getLocation());

  return { room, internals, player };
}

function addEnemyNearField(
  room: GameRoom,
  internals: CombatRoomInternals,
  field: BlackHoleFieldState,
  distance: number,
  health: number,
): EnemyState {
  const surface = internals.surfaceManager.getMeshSurface()!;
  const location: ServerMeshLocation = {
    faceIndex: field.walkerFaceIndex,
    baryU: field.walkerBaryU,
    baryV: field.walkerBaryV,
    baryW: field.walkerBaryW,
    wx: field.wx, wy: field.wy, wz: field.wz,
    nx: field.nx, ny: field.ny, nz: field.nz,
    tangentX: field.tx, tangentY: field.ty, tangentZ: field.tz,
    bitangentX: field.bx, bitangentY: field.by, bitangentZ: field.bz,
  };
  const walker = new ServerMeshWalker(surface, new THREE.Vector3(location.wx, location.wy, location.wz), 1);
  walker.teleportToLocation(location);
  walker.speed = 1;
  walker.moveInWorldDirection(location.bitangentX, location.bitangentY, location.bitangentZ, distance);

  const enemy = new EnemyState();
  enemy.id = `enemy-${room.state.enemies.length}`;
  enemy.type = 'grunt';
  enemy.health = health;
  enemy.maxHealth = health;
  internals.enemyWalkers.set(enemy.id, walker);
  internals.applyWalkerStateToEnemy(enemy, walker.getLocation());
  internals.enemyAI.set(enemy.id, {});
  room.state.enemies.push(enemy);
  return enemy;
}

describe('MP combat respawn and SFX parity authority', () => {
  it.each(['waves', 'pvpve', 'king'])('applies authoritative Black Hole AoE damage in %s mode', (mode) => {
    const { room, internals, player } = makeRoom(mode);
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const fieldLocation = internals.surfaceManager.createLocationNearWalker(player.id, 4, player.aimAngle)!;
    const field = internals.spawnBlackHoleFieldFromLocation(player.id, fieldLocation);
    const enemy = addEnemyNearField(room, internals, field, 1.5, 100);

    for (let i = 0; i < 60; i++) internals.updateBlackHoleFields(1 / 60);

    expect(enemy.health).toBeLessThan(100);
    expect(player.enemyKills).toBe(0);
    internals.surfaceManager.dispose();
  });

  it('restores full health on repeated PvPvE respawns', () => {
    const { room, internals, player } = makeRoom('pvpve');
    player.maxHealth = 100;

    for (const degradedHealth of [1, 25, 40]) {
      player.health = degradedHealth;
      player.alive = false;
      internals.pendingRespawns.set(player.id, room.state.gameTime);

      internals.drainRespawnTimers();

      expect(player.alive).toBe(true);
      expect(player.health).toBe(player.maxHealth);
      expect(internals.playerInvincibility.get(player.id)).toBeGreaterThan(0);
    }

    internals.surfaceManager.dispose();
  });
});
