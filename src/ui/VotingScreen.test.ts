// @vitest-environment jsdom
/**
 * Regression tests for VotingScreen SURFACES and MODES arrays.
 * These tests catch invalid surface types / unimplemented game modes being
 * accidentally added back to the voting options.
 *
 * Regression: S27 — cylinder/knot were in SURFACES but not in SurfaceFactory;
 * king/rainbow were in MODES but had no server implementation.
 *
 * Regression: S28a — show() must NOT auto-vote on display. Auto-voting caused
 * all clients to immediately submit default votes, making the server see
 * voteMap.size >= playerCount and instantly relaunch the game before users
 * could see or interact with the voting screen.
 */

import { describe, it, expect } from 'vitest';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';
import { SURFACES, MODES, VotingScreen } from './VotingScreen';
import type { NetworkGameState } from '../network/NetworkClient';

describe('VotingScreen — SURFACES array', () => {
  const validTypes = new Set(SurfaceFactory.getAvailableTypes());

  it('every surface ID is in SurfaceFactory.getAvailableTypes()', () => {
    const invalidSurfaces = SURFACES.filter(s => !validTypes.has(s.id as never));
    expect(invalidSurfaces).toEqual([]);
  });

  it('does not include cylinder (not implemented)', () => {
    const ids = SURFACES.map(s => s.id);
    expect(ids).not.toContain('cylinder');
  });

  it('does not include knot (not implemented)', () => {
    const ids = SURFACES.map(s => s.id);
    expect(ids).not.toContain('knot');
  });

  it('has at least 6 valid surface options', () => {
    expect(SURFACES.length).toBeGreaterThanOrEqual(6);
  });
});

describe('VotingScreen — MODES array', () => {
  // All 7 modes are now server-implemented:
  // - waves: always been implemented
  // - king/sniper/rainbow: added in host game mode selection (0e2e693)
  // - claustrophobia: added in 8f90c2d
  // - pvp: added in s44j-pvp-13* (s44k-06 fix: was missing from voting screen)
  // - pvpve: added in s44j-pvpve-14*
  const IMPLEMENTED_MODES = ['waves', 'king', 'sniper', 'rainbow', 'claustrophobia', 'pvp', 'pvpve'];

  it('every mode ID has a server implementation', () => {
    const unimplementedModes = MODES.filter(m => !IMPLEMENTED_MODES.includes(m.id));
    expect(unimplementedModes).toEqual([]);
  });

  it('includes all 7 game modes', () => {
    const ids = MODES.map(m => m.id);
    expect(ids).toContain('waves');
    expect(ids).toContain('king');
    expect(ids).toContain('sniper');
    expect(ids).toContain('rainbow');
    expect(ids).toContain('claustrophobia');
    expect(ids).toContain('pvp');
    expect(ids).toContain('pvpve');
  });

  it('has exactly 7 modes', () => {
    expect(MODES).toHaveLength(7);
  });

  it('each mode has an icon', () => {
    const modesWithoutIcon = MODES.filter(m => !m.icon);
    expect(modesWithoutIcon).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S28a regression: show() must NOT auto-vote on display
// ---------------------------------------------------------------------------

describe('VotingScreen — show() auto-vote regression (S28a)', () => {
  /** Minimal fake NetworkGameState for testing */
  function makeFakeState(overrides: Partial<NetworkGameState> = {}): NetworkGameState {
    return {
      players: new Map(),
      bullets: { forEach() {} } as never,
      enemies: { forEach() {} } as never,
      geoms: { forEach() {} } as never,
      weaponPickups: { forEach() {} } as never,
      superPickups: { forEach() {} } as never,
      buffPickups: { forEach() {} } as never,
      healthPickups: { forEach() {} } as never,
      surfaceType: 'sphere',
      waveNumber: 0,
      gameTime: 0,
      gameStarted: false,
      gameOver: true,
      hostId: 'player1',
      isPaused: false,
      roomPhase: 'voting',
      voteMap: new Map(),
      votingCountdown: 30,
      hostPickMode: false,
      gameMode: 'waves',
      mapSize: 'medium',
      readyMap: new Map(),
      countdownPaused: false,
      ...overrides,
    };
  }

  it('does NOT call onVote immediately when show() is called', () => {
    const screen = new VotingScreen();
    const votedChoices: string[] = [];
    screen.setCallbacks({ onVote: (choice) => votedChoices.push(choice) });

    screen.show(makeFakeState(), false, 'player1');

    // Bug: before the fix, show() called sendVote() immediately.
    // With multiple clients doing this, the server saw voteMap.size >= playerCount
    // and instantly relaunched the game — bypassing the 30s voting window entirely.
    expect(votedChoices).toHaveLength(0);

    screen.dispose();
  });

  it('sends vote ONLY when user explicitly clicks a surface card', () => {
    const screen = new VotingScreen();
    const votedChoices: string[] = [];
    screen.setCallbacks({ onVote: (choice) => votedChoices.push(choice) });

    screen.show(makeFakeState(), false, 'player1');
    expect(votedChoices).toHaveLength(0); // No vote yet

    // Simulate clicking the 'torus' card
    const torusCard = document.querySelector('[data-surface="torus"]') as HTMLElement;
    torusCard?.click();

    expect(votedChoices).toHaveLength(1);
    expect(votedChoices[0]).toMatch(/^torus:/);

    screen.dispose();
  });

  it('vote is NOT sent after clicking Ready Up (vote locked)', () => {
    // s44j-13: once player clicks Ready Up, their vote is locked.
    // Clicking surface/mode/size after that must NOT call onVote.
    const screen = new VotingScreen();
    const votedChoices: string[] = [];
    screen.setCallbacks({ onVote: (choice) => votedChoices.push(choice) });

    screen.show(makeFakeState(), false, 'player1');

    // Click a surface to cast initial vote
    const torusCard = document.querySelector('[data-surface="torus"]') as HTMLElement;
    torusCard?.click();
    expect(votedChoices).toHaveLength(1);

    // Click Ready Up
    const readyBtn = document.querySelector('.vs-ready-btn') as HTMLElement;
    readyBtn?.click();

    // Now try to change vote — should NOT trigger onVote
    const sphereCard = document.querySelector('[data-surface="sphere"]') as HTMLElement;
    sphereCard?.click();

    expect(votedChoices).toHaveLength(1); // still only the original vote

    screen.dispose();
  });

  it('Ready Up button calls onReadyUp callback', () => {
    const screen = new VotingScreen();
    let readyUpCalled = false;
    screen.setCallbacks({ onReadyUp: () => { readyUpCalled = true; } });

    screen.show(makeFakeState(), false, 'player1');

    const readyBtn = document.querySelector('.vs-ready-btn') as HTMLElement;
    readyBtn?.click();

    expect(readyUpCalled).toBe(true);

    screen.dispose();
  });

  it('Ready Up button does not call onReadyUp twice if clicked again', () => {
    const screen = new VotingScreen();
    let callCount = 0;
    screen.setCallbacks({ onReadyUp: () => { callCount++; } });

    screen.show(makeFakeState(), false, 'player1');

    const readyBtn = document.querySelector('.vs-ready-btn') as HTMLElement;
    readyBtn?.click();
    readyBtn?.click(); // second click should be ignored

    expect(callCount).toBe(1);

    screen.dispose();
  });
});

// ---------------------------------------------------------------------------
// S34b regression: mastery-screen desync — frozen timer on voting screen
// ---------------------------------------------------------------------------

describe('VotingScreen — mastery desync regression (S34b)', () => {
  /** Minimal fake NetworkGameState for testing */
  function makeState(countdown: number, overrides: Partial<NetworkGameState> = {}): NetworkGameState {
    return {
      players: new Map(),
      bullets: { forEach() {} } as never,
      enemies: { forEach() {} } as never,
      geoms: { forEach() {} } as never,
      weaponPickups: { forEach() {} } as never,
      superPickups: { forEach() {} } as never,
      buffPickups: { forEach() {} } as never,
      healthPickups: { forEach() {} } as never,
      surfaceType: 'sphere',
      waveNumber: 0,
      gameTime: 0,
      gameStarted: false,
      gameOver: true,
      hostId: 'player1',
      isPaused: false,
      roomPhase: 'voting',
      voteMap: new Map(),
      votingCountdown: countdown,
      hostPickMode: false,
      gameMode: 'waves',
      mapSize: 'medium',
      readyMap: new Map(),
      countdownPaused: false,
      ...overrides,
    };
  }

  it('update() after show() with fresh state reflects the live countdown', () => {
    // Simulates: mastery callback calls show() with stale state (countdown=30),
    // then next onStateChange fires update() with current state (countdown=15).
    const screen = new VotingScreen();

    // show() with stale countdown (as if captured in mastery screen closure)
    screen.show(makeState(30), false, 'player1');

    // update() with current countdown (as the fix ensures)
    screen.update(makeState(15), false, 'player1');

    const cdEl = document.querySelector('.vs-countdown') as HTMLElement;
    expect(cdEl).not.toBeNull();
    // Timer must reflect the LIVE value, not the stale show() value
    expect(cdEl.textContent).toBe('15');

    screen.dispose();
  });

  it('update() before show() is a safe no-op (does not throw)', () => {
    // Simulates: onStateChange fires update() while mastery screen is showing
    // (votingScreen.isBuilt is false, show() not yet called).
    // This must not throw — VotingScreen guards with isBuilt.
    const screen = new VotingScreen();
    expect(() => {
      screen.update(makeState(25), false, 'player1');
    }).not.toThrow();
    screen.dispose();
  });

  it('show() with fresh latestVotingState reflects live countdown immediately', () => {
    // Simulates the fix: mastery callback uses latestVotingState (countdown=12)
    // instead of stale closure state (countdown=30).
    const screen = new VotingScreen();

    // The FIX: show() called with fresh state
    screen.show(makeState(12), false, 'player1');

    const cdEl = document.querySelector('.vs-countdown') as HTMLElement;
    expect(cdEl).not.toBeNull();
    expect(cdEl.textContent).toBe('12');

    screen.dispose();
  });
});
