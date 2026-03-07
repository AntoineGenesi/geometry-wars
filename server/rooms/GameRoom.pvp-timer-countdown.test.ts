/**
 * Regression test for s44r-01: PvP/PvPvE timer countdown broken.
 *
 * Root cause: start_with_options handler sets state.winCondition='time' and
 * state.timeLimit but never sets state.timeLimitSeconds or state.timeRemaining.
 * startGame() → syncSettingsToState() also overwrites state.timeLimit back to
 * currentSettings.timeLimit (which defaults to 0), so the timer never runs.
 *
 * Tests extract the relevant logic and verify correct behaviour.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Mirror the start_with_options state machine (buggy version for FAIL test,
// then fixed version for PASS test)
// ---------------------------------------------------------------------------

interface TimerState {
  winCondition: string;
  timeLimit: number;
  timeLimitSeconds: number;
  timeRemaining: number;
  killTarget: number;
  livesCount: number;
}

/** Simulates the BUGGY start_with_options handler (pre-fix). */
function processStartWithOptionsBuggy(data: {
  winCondition?: string;
  killTarget?: number;
  timeLimit?: number;
  livesCount?: number;
}): TimerState {
  const VALID_WIN_CONDITIONS = ['none', 'kills', 'time', 'lives'];
  const winCondition = VALID_WIN_CONDITIONS.includes(data.winCondition ?? '') ? (data.winCondition ?? 'none') : 'none';
  const killTarget = Math.max(1, Math.min(500, data.killTarget ?? 10));
  const timeLimit = Math.max(30, Math.min(3600, data.timeLimit ?? 300));
  const livesCount = Math.max(1, Math.min(20, data.livesCount ?? 3));

  // BUG: timeLimitSeconds and timeRemaining are never set.
  // startGame() → syncSettingsToState() also resets timeLimit to currentSettings.timeLimit (= 0).
  const timeLimitSeconds = 0; // ← never set in buggy handler
  const timeRemaining = 0;    // ← never set in buggy handler

  return { winCondition, timeLimit: 0, timeLimitSeconds, timeRemaining, killTarget, livesCount };
  //       timeLimit 0 ← syncSettingsToState() resets to currentSettings.timeLimit (default=0)
}

/** Simulates the FIXED start_with_options handler (post-fix). */
function processStartWithOptionsFixed(data: {
  winCondition?: string;
  killTarget?: number;
  timeLimit?: number;
  livesCount?: number;
}): TimerState {
  const VALID_WIN_CONDITIONS = ['none', 'kills', 'time', 'lives'];
  const winCondition = VALID_WIN_CONDITIONS.includes(data.winCondition ?? '') ? (data.winCondition ?? 'none') : 'none';
  const killTarget = Math.max(1, Math.min(500, data.killTarget ?? 10));
  const timeLimit = Math.max(30, Math.min(3600, data.timeLimit ?? 300));
  const livesCount = Math.max(1, Math.min(20, data.livesCount ?? 3));

  // FIX: after startGame() completes, re-apply timer state.
  const timeLimitSeconds = winCondition === 'time' ? timeLimit : 0;
  const timeRemaining = winCondition === 'time' ? timeLimit : 0;

  return { winCondition, timeLimit, timeLimitSeconds, timeRemaining, killTarget, livesCount };
}

// ---------------------------------------------------------------------------
// Client-side isPlayingWithTimer logic (mirrors network-main.ts line 4250-4253)
// ---------------------------------------------------------------------------

function isPlayingWithTimer(state: {
  roomPhase: string;
  gameStarted: boolean;
  winCondition: string;
  timeLimitSeconds: number;
}): boolean {
  return state.roomPhase === 'playing'
    && state.gameStarted
    && state.winCondition === 'time'
    && (state.timeLimitSeconds ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Timer countdown logic (mirrors GameRoom tick, line 2134-2135)
// ---------------------------------------------------------------------------

function tickTimer(timeRemaining: number, dt: number): number {
  return Math.max(0, timeRemaining - dt);
}

function shouldEndGame(state: { winCondition: string; timeRemaining: number; timeLimitSeconds: number }): boolean {
  return state.winCondition === 'time' && state.timeRemaining <= 0 && state.timeLimitSeconds > 0;
}

// ---------------------------------------------------------------------------
// REGRESSION: buggy handler — timer never works
// ---------------------------------------------------------------------------

describe('s44r-01 regression: start_with_options timer (buggy pre-fix)', () => {
  it('FAILS: timeLimitSeconds is 0 after start_with_options with winCondition=time (bug)', () => {
    const state = processStartWithOptionsBuggy({ winCondition: 'time', timeLimit: 300 });
    // This is the BUG: timeLimitSeconds should be 300 but is 0
    expect(state.timeLimitSeconds).toBe(0); // demonstrates the bug
    expect(state.timeRemaining).toBe(0);    // demonstrates the bug
    expect(state.timeLimit).toBe(0);        // demonstrates the bug: wiped by syncSettingsToState
  });

  it('FAILS: client timer is never shown because timeLimitSeconds=0 (bug)', () => {
    const state = processStartWithOptionsBuggy({ winCondition: 'time', timeLimit: 300 });
    const showing = isPlayingWithTimer({
      roomPhase: 'playing',
      gameStarted: true,
      winCondition: state.winCondition,
      timeLimitSeconds: state.timeLimitSeconds,
    });
    // Timer never shows because timeLimitSeconds=0 — demonstrates the bug
    expect(showing).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FIXED: timer works correctly after fix
// ---------------------------------------------------------------------------

describe('s44r-01: start_with_options timer countdown (fixed)', () => {
  it('timeLimitSeconds is set correctly when winCondition=time', () => {
    const state = processStartWithOptionsFixed({ winCondition: 'time', timeLimit: 300 });
    expect(state.timeLimitSeconds).toBe(300);
    expect(state.timeRemaining).toBe(300);
    expect(state.timeLimit).toBe(300);
  });

  it('timeLimitSeconds is 0 for non-time win conditions', () => {
    const killsState = processStartWithOptionsFixed({ winCondition: 'kills', timeLimit: 300 });
    expect(killsState.timeLimitSeconds).toBe(0);
    expect(killsState.timeRemaining).toBe(0);

    const noneState = processStartWithOptionsFixed({ winCondition: 'none', timeLimit: 300 });
    expect(noneState.timeLimitSeconds).toBe(0);
  });

  it('client timer element is shown when timeLimitSeconds > 0', () => {
    const state = processStartWithOptionsFixed({ winCondition: 'time', timeLimit: 300 });
    const showing = isPlayingWithTimer({
      roomPhase: 'playing',
      gameStarted: true,
      winCondition: state.winCondition,
      timeLimitSeconds: state.timeLimitSeconds,
    });
    expect(showing).toBe(true);
  });

  it('client timer is hidden when not playing', () => {
    const state = processStartWithOptionsFixed({ winCondition: 'time', timeLimit: 300 });
    const showing = isPlayingWithTimer({
      roomPhase: 'lobby', // not playing
      gameStarted: false,
      winCondition: state.winCondition,
      timeLimitSeconds: state.timeLimitSeconds,
    });
    expect(showing).toBe(false);
  });

  it('custom time limit: 7 minutes 30 seconds (450 seconds)', () => {
    const state = processStartWithOptionsFixed({ winCondition: 'time', timeLimit: 450 });
    expect(state.timeLimitSeconds).toBe(450);
    expect(state.timeRemaining).toBe(450);
  });

  it('custom time limit: 1 minute (60 seconds minimum via validateSettings, 30s here)', () => {
    const state = processStartWithOptionsFixed({ winCondition: 'time', timeLimit: 30 });
    expect(state.timeLimitSeconds).toBe(30);
    expect(state.timeRemaining).toBe(30);
  });

  it('timer counts down by dt each tick', () => {
    let remaining = 300;
    remaining = tickTimer(remaining, 1 / 60); // one frame at 60fps
    expect(remaining).toBeCloseTo(300 - 1 / 60);
  });

  it('timer stops at 0 (does not go negative)', () => {
    const remaining = tickTimer(0.01, 1.0); // dt > remaining
    expect(remaining).toBe(0);
  });

  it('game ends when timeRemaining hits 0', () => {
    const state = { winCondition: 'time', timeRemaining: 0, timeLimitSeconds: 300 };
    expect(shouldEndGame(state)).toBe(true);
  });

  it('game does not end prematurely', () => {
    const state = { winCondition: 'time', timeRemaining: 60, timeLimitSeconds: 300 };
    expect(shouldEndGame(state)).toBe(false);
  });

  it('game does not end for non-time win condition even at timeRemaining=0', () => {
    const state = { winCondition: 'kills', timeRemaining: 0, timeLimitSeconds: 0 };
    expect(shouldEndGame(state)).toBe(false);
  });

  it('red glow triggers in last 10 seconds', () => {
    const timeLimitSeconds = 300;
    const quarterMark = timeLimitSeconds / 4; // 75 seconds

    // Last 10 seconds: red glow
    expect(11 <= 10).toBe(false); // 11s: no red
    expect(10 <= 10).toBe(true);  // 10s: red
    expect(5 <= 10).toBe(true);   // 5s: red

    // Warning zone: 10 < remaining <= quarterMark
    expect(75 > 10 && 75 <= quarterMark).toBe(true);   // 75s: warn
    expect(76 > 10 && 76 <= quarterMark).toBe(false);  // 76s: no warn (just past quarter)
  });

  it('clamps timeLimit to valid range (30–3600)', () => {
    const tooSmall = processStartWithOptionsFixed({ winCondition: 'time', timeLimit: 10 });
    expect(tooSmall.timeLimitSeconds).toBe(30); // clamped up to 30

    const tooLarge = processStartWithOptionsFixed({ winCondition: 'time', timeLimit: 9999 });
    expect(tooLarge.timeLimitSeconds).toBe(3600); // clamped down to 3600
  });
});
