import { describe, expect, it } from 'vitest';
import { GameRoom } from './GameRoom';
import { GameState, PlayerState } from '../schema/GameState';
import type { ServerMeshLocation } from '../movement/ServerMeshLocation';
import type { ServerSurfaceManager } from '../movement/ServerSurfaceManager';

interface PortalRoomInternals {
  surfaceManager: ServerSurfaceManager;
  _portalLocations: { A: ServerMeshLocation | null; B: ServerMeshLocation | null };
  _portalCooldowns: Map<string, number>;
  playerInvincibility: Map<string, number>;
  applyWalkerStateToPlayer(player: PlayerState, location: ServerMeshLocation): void;
  updatePortalCollision(): void;
}

function createPortalRoom(): {
  room: GameRoom;
  internals: PortalRoomInternals;
  player: PlayerState;
  portalA: ServerMeshLocation;
  portalB: ServerMeshLocation;
} {
  const room = new GameRoom();
  (room as any).setState(new GameState());
  const internals = room as unknown as PortalRoomInternals;
  const manager = internals.surfaceManager;
  manager.initSurface('cube-tunnel');

  const player = new PlayerState();
  player.id = 'player-1';
  player.name = 'Portal Tester';
  player.alive = true;
  room.state.players.set(player.id, player);
  const walker = manager.createWalker(player.id, 0.5, 0.5)!;
  internals.applyWalkerStateToPlayer(player, walker.getLocation());

  const portalA = manager.createRandomLocation(() => 0.17)!;
  let portalB = manager.createRandomLocation(() => 0.83)!;
  for (let i = 0; i < 100; i++) {
    const distance = Math.hypot(
      portalB.wx - portalA.wx,
      portalB.wy - portalA.wy,
      portalB.wz - portalA.wz,
    );
    if (distance > 4) break;
    portalB = manager.createRandomLocation()!;
  }
  internals._portalLocations = { A: portalA, B: portalB };
  room.state.portalsActive = true;
  return { room, internals, player, portalA, portalB };
}

describe('GameRoom canonical portal trigger', () => {
  it('does not teleport when legacy UV says inside but the walker is far from the visible portal', () => {
    const { room, internals, player, portalA } = createPortalRoom();
    const before = internals.surfaceManager.getWalkerLocation(player.id)!;
    expect(Math.hypot(
      before.wx - portalA.wx,
      before.wy - portalA.wy,
      before.wz - portalA.wz,
    )).toBeGreaterThan(0.8);

    // This is the old failure condition: approximate player UV exactly matches portal UV.
    player.surfaceU = room.state.portalAU;
    player.surfaceV = room.state.portalAV;
    internals.updatePortalCollision();

    const after = internals.surfaceManager.getWalkerLocation(player.id)!;
    expect(after.faceIndex).toBe(before.faceIndex);
    expect(Math.hypot(after.wx - before.wx, after.wy - before.wy, after.wz - before.wz))
      .toBeLessThan(1e-6);
    expect(internals._portalCooldowns.has(player.id)).toBe(false);
  });

  it('crossing the visible disk teleports once and synchronizes full exit state in the same tick', () => {
    const { internals, player, portalA, portalB } = createPortalRoom();
    internals.surfaceManager.teleportWalkerToLocation(player.id, portalA);
    internals._portalCooldowns.clear();

    internals.updatePortalCollision();

    const exit = internals.surfaceManager.getWalkerLocation(player.id)!;
    expect(exit.faceIndex).toBe(portalB.faceIndex);
    expect(Math.hypot(exit.wx - portalB.wx, exit.wy - portalB.wy, exit.wz - portalB.wz))
      .toBeLessThan(1e-4);
    expect(player.walkerFaceIndex).toBe(exit.faceIndex);
    expect(player.walkerBaryU).toBeCloseTo(exit.baryU, 5);
    expect(player.walkerBaryV).toBeCloseTo(exit.baryV, 5);
    expect(player.walkerBaryW).toBeCloseTo(exit.baryW, 5);
    expect(player.wx).toBeCloseTo(exit.wx, 5);
    expect(player.nx).toBeCloseTo(exit.nx, 5);
    expect(player.tx).toBeCloseTo(exit.tangentX, 5);
    expect(player.bx).toBeCloseTo(exit.bitangentX, 5);
    expect(internals.playerInvincibility.get(player.id)).toBe(1);

    internals.updatePortalCollision();
    const afterCooldownGuard = internals.surfaceManager.getWalkerLocation(player.id)!;
    expect(afterCooldownGuard.faceIndex).toBe(exit.faceIndex);
    expect(Math.hypot(
      afterCooldownGuard.wx - exit.wx,
      afterCooldownGuard.wy - exit.wy,
      afterCooldownGuard.wz - exit.wz,
    )).toBeLessThan(1e-6);
  });
});
