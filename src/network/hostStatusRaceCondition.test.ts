/**
 * Regression tests for the MP lobby host-status race condition.
 *
 * Bug (s44r22-07): Host creates a room and connects. The server sets
 * `state.hostId` in onJoin. However, the first onStateChange can arrive
 * with `state.hostId === ''` (empty) if the host assignment hasn't
 * propagated to the client-side state decode yet. The previous code:
 *
 *   const nowIsHost = state.hostId !== '' && state.hostId === localPlayerId;
 *   if (nowIsHost !== isHost) { isHost = nowIsHost; ... }
 *
 * would flip isHost from true → false when state.hostId was empty, causing:
 *   - The host to briefly see "Waiting for host to start..." instead of the
 *     START GAME button and mode selector.
 *   - The host UI (settings, start button) to flicker and disappear.
 *
 * Fix: Only update isHost when state.hostId is non-empty. An empty hostId
 * means the server state isn't ready yet — don't revert to non-host.
 *
 * See: tasks/s44r22-07-mp-host-ui-shows-waiting-for-host.md
 */

import { describe, it, expect } from 'vitest';

// -----------------------------------------------------------------------
// Standalone state machine replicating the isHost sync logic from
// network-main.ts onStateChange (lines ~3389-3405)
// -----------------------------------------------------------------------

interface HostSyncState {
  isHost: boolean;
  startBtnVisible: boolean;
  modeSelectorVisible: boolean;
  nonHostSettingsVisible: boolean;
  updateLog: string[];
}

/**
 * Replicates the BUG: isHost flips to false when state.hostId is ''.
 */
function syncHostStatusBuggy(
  state: HostSyncState,
  localPlayerId: string,
  serverHostId: string,
): void {
  if (!localPlayerId) return;
  // BUG: nowIsHost is false when serverHostId === '' — flips isHost to false
  const nowIsHost = serverHostId !== '' && serverHostId === localPlayerId;
  if (nowIsHost !== state.isHost) {
    state.isHost = nowIsHost;
    state.updateLog.push(`isHost → ${nowIsHost}`);
  }
}

/**
 * Replicates the FIX: only update isHost when state.hostId is non-empty.
 */
function syncHostStatusFixed(
  state: HostSyncState,
  localPlayerId: string,
  serverHostId: string,
): void {
  if (!localPlayerId || serverHostId === '') return; // FIX: skip empty hostId
  const nowIsHost = serverHostId === localPlayerId;
  if (nowIsHost !== state.isHost) {
    state.isHost = nowIsHost;
    state.updateLog.push(`isHost → ${nowIsHost}`);
  }
}

/**
 * Replicates the lobby UI update in onStateChange (lines ~5200-5214).
 * Host sees START GAME + mode selector; non-host sees "waiting for host".
 */
function updateLobbyUI(state: HostSyncState): void {
  if (state.isHost) {
    state.startBtnVisible = true;
    state.modeSelectorVisible = true;
    state.nonHostSettingsVisible = false;
  } else {
    state.startBtnVisible = false;
    state.modeSelectorVisible = false;
    state.nonHostSettingsVisible = true;
  }
}

function createState(initialIsHost: boolean): HostSyncState {
  return {
    isHost: initialIsHost,
    startBtnVisible: initialIsHost,
    modeSelectorVisible: initialIsHost,
    nonHostSettingsVisible: !initialIsHost,
    updateLog: [],
  };
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('Host status race condition (s44r22-07)', () => {
  const LOCAL_PLAYER_ID = 'abc123';
  const OTHER_PLAYER_ID = 'xyz789';

  // --- BUG: demonstrates the pre-fix behavior ---

  it('BUGGY: host briefly sees non-host UI when first state has empty hostId', () => {
    // Scenario: host connects, isHost=true (detected at connect time)
    const state = createState(true); // isHost=true, startBtn visible

    // First onStateChange arrives with state.hostId='' (server not ready yet)
    syncHostStatusBuggy(state, LOCAL_PLAYER_ID, '');
    updateLobbyUI(state);

    // BUG: isHost flipped to false — host sees non-host UI
    expect(state.isHost).toBe(false);
    expect(state.startBtnVisible).toBe(false);   // START GAME hidden (wrong!)
    expect(state.nonHostSettingsVisible).toBe(true); // "waiting for host" shown (wrong!)
    expect(state.updateLog).toEqual(['isHost → false']);
  });

  it('BUGGY: host recovers on second state update (with correct hostId)', () => {
    const state = createState(true);

    // First update: empty hostId → isHost flips to false
    syncHostStatusBuggy(state, LOCAL_PLAYER_ID, '');
    // Second update: correct hostId → isHost restored
    syncHostStatusBuggy(state, LOCAL_PLAYER_ID, LOCAL_PLAYER_ID);
    updateLobbyUI(state);

    // Shows the flicker: went false then back to true
    expect(state.isHost).toBe(true);
    expect(state.updateLog).toEqual(['isHost → false', 'isHost → true']);
  });

  // --- FIX: demonstrates the corrected behavior ---

  it('FIX: host keeps host UI when first state has empty hostId', () => {
    // Scenario: host connects, isHost=true (detected at connect time)
    const state = createState(true); // isHost=true, startBtn visible

    // First onStateChange arrives with state.hostId='' (server not ready yet)
    syncHostStatusFixed(state, LOCAL_PLAYER_ID, '');
    updateLobbyUI(state);

    // FIX: isHost stays true — host continues to see host UI
    expect(state.isHost).toBe(true);
    expect(state.startBtnVisible).toBe(true);        // START GAME visible (correct!)
    expect(state.modeSelectorVisible).toBe(true);    // mode selector visible (correct!)
    expect(state.nonHostSettingsVisible).toBe(false); // "waiting for host" NOT shown (correct!)
    expect(state.updateLog).toHaveLength(0); // no spurious update
  });

  it('FIX: host UI remains stable on second state update (with correct hostId)', () => {
    const state = createState(true);

    // First update: empty hostId → ignored
    syncHostStatusFixed(state, LOCAL_PLAYER_ID, '');
    updateLobbyUI(state);
    expect(state.isHost).toBe(true);
    expect(state.startBtnVisible).toBe(true);

    // Second update: correct hostId → still host, no change
    syncHostStatusFixed(state, LOCAL_PLAYER_ID, LOCAL_PLAYER_ID);
    updateLobbyUI(state);
    expect(state.isHost).toBe(true);
    expect(state.startBtnVisible).toBe(true);
    expect(state.updateLog).toHaveLength(0); // no spurious updates
  });

  it('FIX: non-host sees correct UI from the start', () => {
    // Non-host player joins: isHost=false from connect time
    const state = createState(false);

    // First state update with correct hostId (someone else is host)
    syncHostStatusFixed(state, LOCAL_PLAYER_ID, OTHER_PLAYER_ID);
    updateLobbyUI(state);

    expect(state.isHost).toBe(false);
    expect(state.startBtnVisible).toBe(false);
    expect(state.nonHostSettingsVisible).toBe(true);
    expect(state.updateLog).toHaveLength(0); // no change needed (already false)
  });

  it('FIX: host transfer works correctly — new host gets host UI', () => {
    // Player B is non-host initially
    const state = createState(false);

    // First updates with other player as host
    syncHostStatusFixed(state, LOCAL_PLAYER_ID, OTHER_PLAYER_ID);
    updateLobbyUI(state);
    expect(state.isHost).toBe(false);

    // Host transfer: now this player is the host
    syncHostStatusFixed(state, LOCAL_PLAYER_ID, LOCAL_PLAYER_ID);
    updateLobbyUI(state);

    expect(state.isHost).toBe(true);
    expect(state.startBtnVisible).toBe(true);
    expect(state.nonHostSettingsVisible).toBe(false);
    expect(state.updateLog).toEqual(['isHost → true']);
  });

  it('FIX: host demotion works correctly — host loses host status', () => {
    // Player A is host
    const state = createState(true);

    // Server assigns host to someone else (e.g., host transfer or reconnection)
    syncHostStatusFixed(state, LOCAL_PLAYER_ID, OTHER_PLAYER_ID);
    updateLobbyUI(state);

    expect(state.isHost).toBe(false);
    expect(state.startBtnVisible).toBe(false);
    expect(state.nonHostSettingsVisible).toBe(true);
    expect(state.updateLog).toEqual(['isHost → false']);
  });

  it('FIX: empty localPlayerId skips the host check (not yet connected)', () => {
    const state = createState(false);

    // localPlayerId not set yet (before connect resolves)
    syncHostStatusFixed(state, '', OTHER_PLAYER_ID);

    expect(state.isHost).toBe(false);
    expect(state.updateLog).toHaveLength(0);
  });

  it('FIX: isHost stays stable across multiple state updates with same hostId', () => {
    const state = createState(true);

    // Multiple state updates with correct hostId (normal server tick)
    syncHostStatusFixed(state, LOCAL_PLAYER_ID, LOCAL_PLAYER_ID);
    syncHostStatusFixed(state, LOCAL_PLAYER_ID, LOCAL_PLAYER_ID);
    syncHostStatusFixed(state, LOCAL_PLAYER_ID, LOCAL_PLAYER_ID);
    updateLobbyUI(state);

    expect(state.isHost).toBe(true);
    expect(state.updateLog).toHaveLength(0); // no changes, idempotent
  });

  // --- Edge: initial isHost=false + first state has empty hostId ---

  it('FIX: non-host with empty first state stays non-host', () => {
    const state = createState(false);

    syncHostStatusFixed(state, LOCAL_PLAYER_ID, '');
    updateLobbyUI(state);

    expect(state.isHost).toBe(false);
    expect(state.startBtnVisible).toBe(false);
    expect(state.nonHostSettingsVisible).toBe(true);
    expect(state.updateLog).toHaveLength(0);
  });
});
