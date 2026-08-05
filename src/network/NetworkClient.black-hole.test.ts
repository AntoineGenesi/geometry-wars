import { describe, expect, it } from 'vitest';
import {
  NetworkClient,
  type NetworkBlackHoleBoltState,
  type NetworkBlackHoleFieldState,
} from './NetworkClient';

function makeState(
  blackHoleFields?: NetworkBlackHoleFieldState[],
  blackHoleBolts?: NetworkBlackHoleBoltState[],
) {
  return {
    players: new Map(),
    bullets: [],
    blackHoleBolts,
    blackHoleFields,
    enemies: [],
    geoms: [],
    weaponPickups: [],
    superPickups: [],
    buffPickups: [],
    healthPickups: [],
    surfaceType: 'cube',
    waveNumber: 1,
    gameTime: 1,
    gameStarted: true,
    gameOver: false,
    hostId: 'owner',
    isPaused: false,
    roomPhase: 'playing',
    voteMap: new Map(),
    votingCountdown: 0,
    voteDivergenceCountdown: 0,
    hostPickMode: false,
    gameMode: 'waves',
    mapSize: 'medium',
    readyMap: new Map(),
    countdownPaused: false,
    pvpMode: '',
    winCondition: 'none',
    killTarget: 10,
    livesCount: 3,
  };
}

describe('NetworkClient Black Hole field synchronization', () => {
  it('passes authoritative travelling bolt collections through without prediction or copying', () => {
    const bolts: NetworkBlackHoleBoltState[] = [{
      id: 'bhb1',
      ownerId: 'owner',
      wx: 1, wy: 2, wz: 3,
      nx: 0, ny: 1, nz: 0,
      tx: 1, ty: 0, tz: 0,
      bx: 0, by: 0, bz: 1,
      walkerFaceIndex: 7,
      walkerBaryU: 0.2,
      walkerBaryV: 0.3,
      walkerBaryW: 0.5,
      dirX: 0.8,
      dirY: 0.6,
      dirZ: 0,
      age: 0.25,
      maxAge: 1.2,
      pullRadius: 2,
    }];
    const client = new NetworkClient();

    const converted = (client as any).convertState(makeState(undefined, bolts));

    expect(converted.blackHoleBolts).toBe(bolts);
    expect(converted.blackHoleBolts[0]).toMatchObject({
      id: 'bhb1',
      ownerId: 'owner',
      walkerFaceIndex: 7,
      age: 0.25,
      maxAge: 1.2,
      pullRadius: 2,
    });
  });

  it('passes authoritative field collections through without prediction or copying', () => {
    const fields: NetworkBlackHoleFieldState[] = [{
      id: 'bh1',
      ownerId: 'owner',
      wx: 1, wy: 2, wz: 3,
      nx: 0, ny: 1, nz: 0,
      tx: 1, ty: 0, tz: 0,
      bx: 0, by: 0, bz: 1,
      walkerFaceIndex: 7,
      walkerBaryU: 0.2,
      walkerBaryV: 0.3,
      walkerBaryW: 0.5,
      age: 1.25,
      duration: 3,
      radius: 5,
      phase: 'sustain',
    }];
    const client = new NetworkClient();

    const converted = (client as any).convertState(makeState(fields));

    expect(converted.blackHoleFields).toBe(fields);
    expect(converted.blackHoleFields[0]).toMatchObject({
      id: 'bh1',
      ownerId: 'owner',
      walkerFaceIndex: 7,
      age: 1.25,
      radius: 5,
      phase: 'sustain',
    });
  });

  it('uses empty iterables before Black Hole schema fields are decoded or after legacy state input', () => {
    const client = new NetworkClient();
    const converted = (client as any).convertState(makeState());
    const bolts: NetworkBlackHoleBoltState[] = [];
    const fields: NetworkBlackHoleFieldState[] = [];

    converted.blackHoleBolts.forEach((bolt: NetworkBlackHoleBoltState) => bolts.push(bolt));
    converted.blackHoleFields.forEach((field: NetworkBlackHoleFieldState) => fields.push(field));

    expect(bolts).toEqual([]);
    expect(fields).toEqual([]);
  });
});
