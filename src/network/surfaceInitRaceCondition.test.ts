/**
 * Regression tests for the LAN surface type race condition.
 *
 * Bug: When a client connects within ~5ms of the host creating a room,
 * `network.getServerSurfaceType()` could return 'sphere' (the default) before
 * the server finishes writing the selected surface type to state. The client
 * would then initialize the wrong surface. Even if the URL had the correct type,
 * if the URL type happened to be wrong (e.g., client chose sphere, host chose cube),
 * enemies rendered on sphere UV would appear at different 3D positions than the
 * server expected.
 *
 * Fix: guard the render loop with `surfaceConfirmedFromServer`. Entities are not
 * rendered until the first `onStateChange` arrives with the authoritative surface
 * type from the server. If the type differs from the initial guess, the surface
 * is torn down and rebuilt before rendering starts.
 *
 * These tests replicate the state machine from network-main.ts `initSurface()`
 * without browser dependencies so the logic can be verified in isolation.
 *
 * See: tasks/s25-lan-sync-p2-surface-race-fix.md
 * See: decisions/lan-deep-audit-2026-02-11.md issue #2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// -----------------------------------------------------------------------
// Standalone state machine replicating initSurface() from network-main.ts
// -----------------------------------------------------------------------

const VALID_TYPES = new Set(['sphere', 'cube', 'torus', 'capsule', 'cylinder', 'tunnel', 'knot', 'peanut', 'pill', 'mobius', 'klein', 'cube-tunnel']);

interface SurfaceInitState {
  surfaceReady: boolean;
  lastCreatedSurfaceType: string;
  surfaceConfirmedFromServer: boolean;
  warnLog: string[];
}

function createState(): SurfaceInitState {
  return {
    surfaceReady: false,
    lastCreatedSurfaceType: '',
    surfaceConfirmedFromServer: false,
    warnLog: [],
  };
}

function cleanupSurface(state: SurfaceInitState): void {
  state.surfaceReady = false;
  state.lastCreatedSurfaceType = '';
  // surfaceConfirmedFromServer stays as-is (cleanupSurface just tears down meshes)
}

function initSurface(
  state: SurfaceInitState,
  serverSurfaceType: string,
  confirmedFromServer: boolean = false,
): void {
  if (state.surfaceReady) {
    const currentType = VALID_TYPES.has(serverSurfaceType) ? serverSurfaceType : null;
    if (!currentType) return;

    if (state.lastCreatedSurfaceType === currentType && state.surfaceConfirmedFromServer) return;

    if (state.lastCreatedSurfaceType === currentType && confirmedFromServer) {
      state.surfaceConfirmedFromServer = true;
      return;
    }

    if (state.lastCreatedSurfaceType !== currentType) {
      state.warnLog.push(`Surface type mismatch corrected: ${state.lastCreatedSurfaceType} → ${currentType}`);
      cleanupSurface(state);
      // falls through to creation code below
    } else {
      return; // Same type, not a confirmed upgrade, skip
    }
  }

  if (!VALID_TYPES.has(serverSurfaceType)) return;

  if (confirmedFromServer) {
    state.surfaceConfirmedFromServer = true;
  }

  // Simulate surface creation
  state.surfaceReady = true;
  state.lastCreatedSurfaceType = serverSurfaceType;
}

/** The key guard: render loop must not process entities until confirmed */
function canRenderEntities(state: SurfaceInitState): boolean {
  return state.surfaceReady && state.surfaceConfirmedFromServer;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe('Surface type race condition fix', () => {
  let state: SurfaceInitState;

  beforeEach(() => {
    state = createState();
  });

  // --- Core race condition scenario ---

  it('does NOT render entities after URL-based init (before server confirmation)', () => {
    // Client connects with URL ?surface=sphere, host chose sphere
    initSurface(state, 'sphere', false);

    expect(state.surfaceReady).toBe(true);
    expect(state.surfaceConfirmedFromServer).toBe(false);
    // The render guard must block rendering until server confirms
    expect(canRenderEntities(state)).toBe(false);
  });

  it('renders entities after onStateChange confirms matching surface type', () => {
    // Client connects with URL ?surface=sphere
    initSurface(state, 'sphere', false);
    // Server confirms sphere
    initSurface(state, 'sphere', true);

    expect(state.surfaceReady).toBe(true);
    expect(state.surfaceConfirmedFromServer).toBe(true);
    expect(state.lastCreatedSurfaceType).toBe('sphere');
    expect(canRenderEntities(state)).toBe(true);
  });

  it('corrects wrong surface type when server confirms different type', () => {
    // Client URL was sphere (wrong guess), host chose cube
    initSurface(state, 'sphere', false);
    expect(state.lastCreatedSurfaceType).toBe('sphere');
    expect(canRenderEntities(state)).toBe(false); // Not yet confirmed

    // Server sends onStateChange with cube
    initSurface(state, 'cube', true);

    expect(state.surfaceReady).toBe(true);
    expect(state.lastCreatedSurfaceType).toBe('cube');
    expect(state.surfaceConfirmedFromServer).toBe(true);
    expect(canRenderEntities(state)).toBe(true);
  });

  it('logs the correction warning when surface type is mismatched', () => {
    initSurface(state, 'sphere', false);
    initSurface(state, 'cube', true);

    expect(state.warnLog).toHaveLength(1);
    expect(state.warnLog[0]).toBe('Surface type mismatch corrected: sphere → cube');
  });

  it('does NOT log a warning when surface type matches (no mismatch)', () => {
    initSurface(state, 'cube', false);
    initSurface(state, 'cube', true);

    expect(state.warnLog).toHaveLength(0);
  });

  // --- Ensures correct surface type is used after correction ---

  it('uses the server-confirmed type, not the URL guess, after correction', () => {
    // URL had torus (wrong), server has cube
    initSurface(state, 'torus', false);
    initSurface(state, 'cube', true);

    expect(state.lastCreatedSurfaceType).toBe('cube');
  });

  it('entities cannot render during the correction window (between init and confirm)', () => {
    // Simulate the race: URL init happens, then first render frame fires BEFORE
    // onStateChange arrives. Render guard should block this.
    initSurface(state, 'sphere', false);

    // Render frame check (simulates game.onRender guard)
    const renderAllowed = canRenderEntities(state);
    expect(renderAllowed).toBe(false);

    // Now server confirms (onStateChange fires)
    initSurface(state, 'cube', true);

    // Render frame check after confirmation
    expect(canRenderEntities(state)).toBe(true);
  });

  // --- Idempotency: repeated onStateChange calls don't break things ---

  it('handles multiple onStateChange calls with same type gracefully', () => {
    initSurface(state, 'sphere', false);
    initSurface(state, 'sphere', true);
    initSurface(state, 'sphere', true); // second state update, same type

    expect(state.surfaceReady).toBe(true);
    expect(state.lastCreatedSurfaceType).toBe('sphere');
    expect(state.surfaceConfirmedFromServer).toBe(true);
    expect(state.warnLog).toHaveLength(0);
  });

  it('stays confirmed after repeated confirmed calls', () => {
    initSurface(state, 'cube', false);
    initSurface(state, 'cube', true);
    initSurface(state, 'cube', true); // repeated

    expect(canRenderEntities(state)).toBe(true);
  });

  // --- Edge cases ---

  it('ignores invalid surface types', () => {
    initSurface(state, 'invalid-type', false);
    expect(state.surfaceReady).toBe(false);
  });

  it('ignores confirmed call with invalid type', () => {
    initSurface(state, 'sphere', false);
    initSurface(state, 'not-a-surface', true);

    // Should still have sphere, not confirmed (invalid type was rejected)
    expect(state.lastCreatedSurfaceType).toBe('sphere');
    expect(state.surfaceConfirmedFromServer).toBe(false);
  });

  it('handles fast-connection scenario: client connects before server writes state', () => {
    // Fastest race: client connects and init fires with URL type before server is ready
    // Step 1: URL-based init (simulate connect-time init)
    initSurface(state, 'sphere', false); // URL had sphere, host chose cube

    // Step 2: First render frame fires — MUST NOT render with wrong surface
    expect(canRenderEntities(state)).toBe(false);

    // Step 3: Server finishes writing state, first onStateChange fires
    initSurface(state, 'cube', true);

    // Step 4: Now render is allowed with correct surface
    expect(state.lastCreatedSurfaceType).toBe('cube');
    expect(canRenderEntities(state)).toBe(true);
    expect(state.warnLog[0]).toBe('Surface type mismatch corrected: sphere → cube');
  });

  it('same-PC scenario: host and client both have cube surface via URL, server confirms', () => {
    // Best case: no mismatch at all
    initSurface(state, 'cube', false); // connect-time init from URL
    initSurface(state, 'cube', true);  // server confirms same type

    expect(state.surfaceReady).toBe(true);
    expect(state.lastCreatedSurfaceType).toBe('cube');
    expect(state.surfaceConfirmedFromServer).toBe(true);
    expect(state.warnLog).toHaveLength(0);
    expect(canRenderEntities(state)).toBe(true);
  });
});
