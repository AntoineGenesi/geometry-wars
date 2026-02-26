/**
 * Tests for GameRoom host determination logic.
 *
 * Covers the requestHost mechanic: when a game creator navigates from
 * the start menu, they pass requestHost=true in join options, and the server
 * prioritizes them as host even if another player joined first.
 *
 * Key invariant (S35 fix): game creator can promote over a non-creator host
 * at ANY room phase — not just 'lobby'. This handles the case where mobile
 * joins first, starts the game, and then the creator connects mid-game.
 *
 * These tests validate the promotion logic in isolation without requiring a
 * live Colyseus Room instance.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the host determination logic from GameRoom.onJoin()
// ---------------------------------------------------------------------------

interface JoinOptions {
  name?: string;
  requestHost?: boolean;
}

interface MockClient {
  sessionId: string;
  remoteAddress: string;
}

interface HostState {
  hostId: string;
  hostIsLocal: boolean;
  hostRequestedHost: boolean;
  roomPhase: string;
}

/**
 * Simulate the host determination logic from GameRoom.onJoin().
 * Returns updated HostState and whether host_changed was broadcast.
 */
function simulateJoin(
  client: MockClient,
  options: JoinOptions,
  state: HostState,
  clientLocality: Map<string, boolean>,
  clientRequestedHost: Map<string, boolean>,
): { state: HostState; broadcastHostChanged: boolean } {
  const isLocalClient =
    client.remoteAddress === '127.0.0.1' ||
    client.remoteAddress === '::1' ||
    client.remoteAddress === '::ffff:127.0.0.1';
  const didRequestHost = options.requestHost === true;

  clientLocality.set(client.sessionId, isLocalClient);
  clientRequestedHost.set(client.sessionId, didRequestHost);

  let broadcastHostChanged = false;
  const newState = { ...state };

  if (state.hostId === '') {
    // First joiner — becomes host
    newState.hostId = client.sessionId;
    newState.hostIsLocal = isLocalClient;
    newState.hostRequestedHost = didRequestHost;
  } else {
    // Two promotion paths (S35 fix splits the original single condition):
    // (A) Creator (requestHost=true) promotes over non-creator, non-localhost host at ANY phase.
    //     This fixes the case where mobile starts the game before the creator connects.
    // (B) Localhost promotes over plain LAN first-joiner, but ONLY in lobby phase.
    const creatorCanPromote = didRequestHost && !state.hostIsLocal && !state.hostRequestedHost;
    const localhostCanPromote = isLocalClient && !state.hostIsLocal && !state.hostRequestedHost && state.roomPhase === 'lobby';
    if (creatorCanPromote || localhostCanPromote) {
      newState.hostId = client.sessionId;
      newState.hostIsLocal = isLocalClient;
      newState.hostRequestedHost = didRequestHost;
      broadcastHostChanged = true;
    }
  }

  return { state: newState, broadcastHostChanged };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeState(overrides: Partial<HostState> = {}): HostState {
  return {
    hostId: '',
    hostIsLocal: false,
    hostRequestedHost: false,
    roomPhase: 'lobby',
    ...overrides,
  };
}

function makeClient(sessionId: string, remoteAddress: string): MockClient {
  return { sessionId, remoteAddress };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GameRoom host determination', () => {
  describe('first joiner becomes host', () => {
    it('first player to join gets host role regardless of requestHost', () => {
      const state = makeState();
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const client = makeClient('player1', '192.168.1.5'); // LAN IP

      const result = simulateJoin(client, {}, state, locality, reqHost);

      expect(result.state.hostId).toBe('player1');
      expect(result.broadcastHostChanged).toBe(false);
    });

    it('first player with requestHost=true gets host', () => {
      const state = makeState();
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const client = makeClient('creator1', '192.168.1.1');

      const result = simulateJoin(client, { requestHost: true }, state, locality, reqHost);

      expect(result.state.hostId).toBe('creator1');
      expect(result.state.hostRequestedHost).toBe(true);
      expect(result.broadcastHostChanged).toBe(false);
    });
  });

  describe('creator (requestHost) promotion over plain LAN joiner', () => {
    it('creator joining second promotes over a non-creator first joiner', () => {
      // First joiner: plain LAN player (no requestHost, non-localhost)
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const phone = makeClient('phone', '192.168.1.10');
      const creator = makeClient('creator', '192.168.1.1');

      let state = makeState();
      // Phone joins first
      ({ state } = simulateJoin(phone, {}, state, locality, reqHost));
      expect(state.hostId).toBe('phone');
      expect(state.hostRequestedHost).toBe(false);

      // Creator joins second with requestHost=true
      const result = simulateJoin(creator, { requestHost: true }, state, locality, reqHost);
      expect(result.state.hostId).toBe('creator');
      expect(result.state.hostRequestedHost).toBe(true);
      expect(result.broadcastHostChanged).toBe(true); // Must notify clients
    });

    it('non-creator second joiner does NOT steal host from a plain first joiner', () => {
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const first = makeClient('first', '192.168.1.10');
      const second = makeClient('second', '192.168.1.11');

      let state = makeState();
      ({ state } = simulateJoin(first, {}, state, locality, reqHost));
      const result = simulateJoin(second, {}, state, locality, reqHost);

      expect(result.state.hostId).toBe('first'); // unchanged
      expect(result.broadcastHostChanged).toBe(false);
    });

    it('creator does NOT steal host from an existing creator', () => {
      // Two players both claim creator — first one keeps host
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const creator1 = makeClient('creator1', '192.168.1.1');
      const creator2 = makeClient('creator2', '192.168.1.2');

      let state = makeState();
      ({ state } = simulateJoin(creator1, { requestHost: true }, state, locality, reqHost));
      expect(state.hostId).toBe('creator1');

      const result = simulateJoin(creator2, { requestHost: true }, state, locality, reqHost);
      expect(result.state.hostId).toBe('creator1'); // first creator keeps host
      expect(result.broadcastHostChanged).toBe(false);
    });
  });

  describe('localhost priority (existing behavior preserved)', () => {
    it('localhost client joining second promotes over a plain LAN first joiner', () => {
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const lanClient = makeClient('lan', '192.168.1.10');
      const localClient = makeClient('local', '127.0.0.1');

      let state = makeState();
      ({ state } = simulateJoin(lanClient, {}, state, locality, reqHost));
      const result = simulateJoin(localClient, {}, state, locality, reqHost);

      expect(result.state.hostId).toBe('local');
      expect(result.state.hostIsLocal).toBe(true);
      expect(result.broadcastHostChanged).toBe(true);
    });

    it('localhost client does NOT steal host from an existing localhost host', () => {
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const local1 = makeClient('local1', '127.0.0.1');
      const local2 = makeClient('local2', '::1');

      let state = makeState();
      ({ state } = simulateJoin(local1, {}, state, locality, reqHost));
      const result = simulateJoin(local2, {}, state, locality, reqHost);

      expect(result.state.hostId).toBe('local1'); // unchanged
      expect(result.broadcastHostChanged).toBe(false);
    });

    it('localhost does NOT steal host from a creator (requestHost) host', () => {
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const creator = makeClient('creator', '192.168.1.1');
      const local = makeClient('local', '127.0.0.1');

      let state = makeState();
      ({ state } = simulateJoin(creator, { requestHost: true }, state, locality, reqHost));
      expect(state.hostId).toBe('creator');

      const result = simulateJoin(local, {}, state, locality, reqHost);
      // Local client should NOT steal from an explicit creator
      expect(result.state.hostId).toBe('creator');
      expect(result.broadcastHostChanged).toBe(false);
    });
  });

  describe('game in progress: creator can reclaim host (S35 fix)', () => {
    it('creator joining during playing phase DOES promote over non-creator host', () => {
      // The key S35 scenario: mobile joined first, mobile started the game,
      // creator connects after game started. Without the fix, creator stays non-host.
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const phone = makeClient('phone', '192.168.1.10');
      const creator = makeClient('creator', '192.168.1.1');

      let state = makeState();
      ({ state } = simulateJoin(phone, {}, state, locality, reqHost));
      state.roomPhase = 'playing'; // mobile started the game as (incorrect) host

      const result = simulateJoin(creator, { requestHost: true }, state, locality, reqHost);

      expect(result.state.hostId).toBe('creator'); // creator reclaims host
      expect(result.state.hostRequestedHost).toBe(true);
      expect(result.broadcastHostChanged).toBe(true);
    });

    it('creator joining during voting phase DOES promote over non-creator host', () => {
      // Game ended (voting phase) — creator connects, should get host
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const phone = makeClient('phone', '192.168.1.10');
      const creator = makeClient('creator', '192.168.1.1');

      let state = makeState();
      ({ state } = simulateJoin(phone, {}, state, locality, reqHost));
      state.roomPhase = 'voting';

      const result = simulateJoin(creator, { requestHost: true }, state, locality, reqHost);

      expect(result.state.hostId).toBe('creator');
      expect(result.broadcastHostChanged).toBe(true);
    });

    it('localhost joining during playing phase does NOT steal host', () => {
      // Localhost promotion is still lobby-only (existing behavior preserved)
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const first = makeClient('first', '192.168.1.10');
      const local = makeClient('local', '127.0.0.1');

      let state = makeState();
      ({ state } = simulateJoin(first, {}, state, locality, reqHost));
      state.roomPhase = 'playing';

      const result = simulateJoin(local, {}, state, locality, reqHost);

      expect(result.state.hostId).toBe('first'); // localhost does NOT promote mid-game
      expect(result.broadcastHostChanged).toBe(false);
    });
  });

  describe('second player joining gets no host', () => {
    it('second LAN joiner (no requestHost) stays non-host', () => {
      const locality = new Map<string, boolean>();
      const reqHost = new Map<string, boolean>();
      const first = makeClient('first', '192.168.1.1');
      const second = makeClient('second', '192.168.1.2');

      let state = makeState();
      // First player is the creator
      ({ state } = simulateJoin(first, { requestHost: true }, state, locality, reqHost));
      const result = simulateJoin(second, {}, state, locality, reqHost);

      expect(result.state.hostId).toBe('first');
      expect(result.broadcastHostChanged).toBe(false);
    });
  });
});
