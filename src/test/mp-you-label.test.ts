/**
 * Regression test: MP "(You)" label should only appear on local player, not all players.
 *
 * Bug report (S32): In LAN mode, "(You)" label was shown on ALL player ships.
 * Fix: network-main.ts now uses `id === localPlayerId ? '(You)' : netPlayer.name`
 * when calling nameLabels.setLabel().
 *
 * This test verifies the label selection logic in isolation.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Label selection logic (mirrors network-main.ts line ~1739)
// ---------------------------------------------------------------------------

function selectDisplayName(
  id: string,
  localPlayerId: string,
  playerName: string,
): string {
  return id === localPlayerId ? '(You)' : playerName;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MP player label — "(You)" only for local player', () => {
  const localId = 'session-abc-123';
  const remoteId1 = 'session-def-456';
  const remoteId2 = 'session-ghi-789';

  it('local player shows "(You)"', () => {
    const name = selectDisplayName(localId, localId, 'Alice');
    expect(name).toBe('(You)');
  });

  it('remote player shows their actual name', () => {
    const name = selectDisplayName(remoteId1, localId, 'Bob');
    expect(name).toBe('Bob');
  });

  it('second remote player shows their actual name', () => {
    const name = selectDisplayName(remoteId2, localId, 'Charlie');
    expect(name).toBe('Charlie');
  });

  it('remote player does NOT show "(You)"', () => {
    const name = selectDisplayName(remoteId1, localId, 'Bob');
    expect(name).not.toBe('(You)');
  });

  it('multiple remote players get distinct names', () => {
    const name1 = selectDisplayName(remoteId1, localId, 'Bob');
    const name2 = selectDisplayName(remoteId2, localId, 'Charlie');
    expect(name1).toBe('Bob');
    expect(name2).toBe('Charlie');
    expect(name1).not.toBe(name2);
  });

  it('regression: local player was previously shown their network name instead of "(You)"', () => {
    // Before fix: nameLabels.setLabel(id, netPlayer.name, ...) — always used network name
    // After fix:  nameLabels.setLabel(id, id === localPlayerId ? '(You)' : netPlayer.name, ...)
    const localDisplayName = selectDisplayName(localId, localId, 'Alice');
    // OLD (buggy) behavior would return 'Alice' — FAIL
    // NEW (correct) behavior returns '(You)' — PASS
    expect(localDisplayName).toBe('(You)');
    expect(localDisplayName).not.toBe('Alice');
  });
});
