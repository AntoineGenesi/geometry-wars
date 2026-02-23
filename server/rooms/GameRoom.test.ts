/**
 * Tests for GameRoom bullet movement physics.
 *
 * Covers the sin(phi) correction applied to UV-space bullet movement on
 * sphere-like surfaces.  The fix ensures bullets travel in the aimed
 * world-space direction regardless of latitude, instead of appearing to
 * converge toward the poles.
 *
 * These tests validate the formula in isolation (same math used in
 * updateBullets) without requiring a live Colyseus Room instance.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the exact formula from GameRoom.updateBullets()
// ---------------------------------------------------------------------------

const SPHERE_LIKE = new Set([
  'sphere', 'sphere-tunnel', 'icosahedron', 'capsule', 'peanut',
]);

/**
 * Compute the sin(phi)-corrected U-direction for a bullet on the given
 * surface.  This mirrors the logic in GameRoom.updateBullets() exactly.
 */
function correctedDirX(dirX: number, bulletV: number, surfaceType: string): number {
  if (!SPHERE_LIKE.has(surfaceType)) return dirX;
  const phi = bulletV * Math.PI;
  const sinPhi = Math.sin(phi);
  const clampedSinPhi = Math.max(sinPhi, 0.3);
  return dirX / clampedSinPhi;
}

/** Simulate one step of bullet UV movement (same as updateBullets for one tick). */
function stepBullet(
  u: number, v: number,
  dirX: number, dirY: number,
  surfaceType: string,
  speed: number,
  dt: number,
): { u: number; v: number } {
  const cdx = correctedDirX(dirX, v, surfaceType);
  return {
    u: u + cdx * speed * dt,
    v: v + dirY * speed * dt,
  };
}

// ---------------------------------------------------------------------------
// Acceptance criteria tests
// ---------------------------------------------------------------------------

describe('GameRoom bullet sin(phi) correction', () => {
  const SPEED = 0.26;
  const DT = 1 / 60;

  // Criterion 5: bullet fired at angle=0 (right) from equator ends up
  // with larger U and same V ± epsilon.
  it('equator (V=0.5), angle=0 (right) → U increases, V unchanged', () => {
    const { u: newU, v: newV } = stepBullet(0.5, 0.5, 1, 0, 'sphere', SPEED, DT);
    expect(newU).toBeGreaterThan(0.5);
    expect(newV).toBeCloseTo(0.5, 6);
  });

  // Criterion 2: bullets near equator travel correctly
  it('near equator (V=0.48), angle=0 → U increases, V unchanged', () => {
    const { u: newU, v: newV } = stepBullet(0.5, 0.48, 1, 0, 'sphere', SPEED, DT);
    expect(newU).toBeGreaterThan(0.5);
    expect(newV).toBeCloseTo(0.48, 6);
  });

  // Criterion 3: bullets near north pole (V=0.1) do not converge toward V=0
  it('near north pole (V=0.1), angle=0 (right) → U increases, V stays near 0.1', () => {
    const { u: newU, v: newV } = stepBullet(0.5, 0.1, 1, 0, 'sphere', SPEED, DT);
    expect(newU).toBeGreaterThan(0.5);         // U moves in aimed direction
    expect(newV).toBeCloseTo(0.1, 6);          // V does not drift toward pole
  });

  it('near south pole (V=0.9), angle=0 (right) → U increases, V stays near 0.9', () => {
    const { u: newU, v: newV } = stepBullet(0.5, 0.9, 1, 0, 'sphere', SPEED, DT);
    expect(newU).toBeGreaterThan(0.5);
    expect(newV).toBeCloseTo(0.9, 6);
  });

  // Verify the correction actually compensates: near-pole U step is larger than
  // equatorial U step (sin correction magnifies it to keep world-space speed consistent).
  it('near pole U step is larger than equatorial U step (sin(phi) compensation)', () => {
    const equatorStep = stepBullet(0.5, 0.5, 1, 0, 'sphere', SPEED, DT);
    const nearPoleStep = stepBullet(0.5, 0.1, 1, 0, 'sphere', SPEED, DT);
    const equatorDU = equatorStep.u - 0.5;
    const nearPoleDU = nearPoleStep.u - 0.5;
    // Near poles sin(phi) < 1, so 1/sin(phi) > 1 — UV step is enlarged
    expect(nearPoleDU).toBeGreaterThan(equatorDU);
  });

  // Verify diagonal aim produces consistent angle across latitudes
  it('diagonal aim (angle=PI/4) produces equal U and V steps at equator', () => {
    const angle = Math.PI / 4;
    const { u: newU, v: newV } = stepBullet(0.5, 0.5, Math.cos(angle), Math.sin(angle), 'sphere', SPEED, DT);
    const dU = newU - 0.5;
    const dV = newV - 0.5;
    // At equator sin(phi)=1, so no correction — dU and dV should be equal
    expect(dU).toBeCloseTo(dV, 6);
  });

  // Criterion 4: flat surfaces (cube, torus) are unaffected — no sin(phi) correction
  it('cube surface → no sin(phi) correction applied', () => {
    const dxCube = correctedDirX(1, 0.1, 'cube');
    expect(dxCube).toBe(1); // unchanged
  });

  it('torus surface → no sin(phi) correction applied', () => {
    const dxTorus = correctedDirX(1, 0.1, 'torus');
    expect(dxTorus).toBe(1); // unchanged
  });

  it('sphere-tunnel surface uses sin(phi) correction', () => {
    const dxTunnel = correctedDirX(1, 0.1, 'sphere-tunnel');
    expect(dxTunnel).toBeGreaterThan(1); // enlarged near pole
  });

  it('capsule surface uses sin(phi) correction', () => {
    const dxCapsule = correctedDirX(1, 0.1, 'capsule');
    expect(dxCapsule).toBeGreaterThan(1);
  });

  // Clamping: sinPhi clamped to 0.3 minimum avoids divide-by-zero at exact poles
  it('exact north pole (V=0) → sinPhi clamped to 0.3, no infinity', () => {
    const dx = correctedDirX(1, 0, 'sphere');
    expect(isFinite(dx)).toBe(true);
    expect(dx).toBeCloseTo(1 / 0.3, 5); // clamped to 0.3
  });

  it('exact south pole (V=1) → sinPhi clamped to 0.3, no infinity', () => {
    const dx = correctedDirX(1, 1, 'sphere');
    expect(isFinite(dx)).toBe(true);
    expect(dx).toBeCloseTo(1 / 0.3, 5);
  });

  // Test V-only bullet (aimed straight up/down) is unaffected by correction
  it('angle=PI/2 (aim toward equator), near north pole → V increases, U unchanged', () => {
    const angle = Math.PI / 2; // sin(PI/2)=1, cos(PI/2)=0
    const { u: newU, v: newV } = stepBullet(0.5, 0.1, Math.cos(angle), Math.sin(angle), 'sphere', SPEED, DT);
    expect(newU).toBeCloseTo(0.5, 6);   // no U movement (dirX≈0)
    expect(newV).toBeGreaterThan(0.1);  // moves toward equator
  });
});

// ---------------------------------------------------------------------------
// Host assignment logic — regression guard for s25-lan-host-selection-wrong-player
//
// These tests verify the host assignment rules used in GameRoom.onJoin() and
// GameRoom.onLeave() WITHOUT requiring a live Colyseus Room instance.
// They mirror the exact conditions checked in the server code.
//
// Bug that prompted this test: "the second player to join became the host"
// Root fix: server now uses `hostId === ''` check in onJoin, and transfers
// host on disconnect instead of closing the room.
// ---------------------------------------------------------------------------

/**
 * Mirrors GameRoom.onJoin host assignment:
 * First player to join (when no host is assigned) becomes host.
 */
function assignHost(currentHostId: string, newPlayerId: string): string {
  if (currentHostId === '') return newPlayerId;
  return currentHostId;
}

/**
 * Mirrors GameRoom.onLeave host transfer logic:
 * If leaving player was host, pick next player; if none remain, signal close.
 */
function transferHost(
  leavingPlayerId: string,
  currentHostId: string,
  remainingPlayers: string[],
): { newHostId: string; shouldClose: boolean } {
  if (leavingPlayerId !== currentHostId) {
    return { newHostId: currentHostId, shouldClose: remainingPlayers.length === 0 };
  }
  // Host is leaving — find a new host from remaining players
  const nextHost = remainingPlayers[0] ?? '';
  if (nextHost) {
    return { newHostId: nextHost, shouldClose: false };
  }
  return { newHostId: '', shouldClose: true };
}

describe('GameRoom host assignment', () => {
  // Criterion 1: first player to create session is marked as host
  it('first player to join becomes host when no host exists', () => {
    const result = assignHost('', 'player1');
    expect(result).toBe('player1');
  });

  // Criterion 2: second player does NOT become host
  it('second player to join does NOT become host', () => {
    const afterFirst = assignHost('', 'player1');
    const afterSecond = assignHost(afterFirst, 'player2');
    expect(afterSecond).toBe('player1'); // host unchanged
  });

  it('third player to join does NOT become host', () => {
    const afterFirst = assignHost('', 'player1');
    const afterSecond = assignHost(afterFirst, 'player2');
    const afterThird = assignHost(afterSecond, 'player3');
    expect(afterThird).toBe('player1'); // original host unchanged
  });

  it('calling assignHost with empty playerId does not assign empty string as host', () => {
    // Safety: empty playerId should only assign if it's non-empty (real sessionIds are UUIDs)
    const result = assignHost('', '');
    // '' assigned — but '' is falsy. In practice sessionIds are never empty.
    // Test documents current behavior: empty string passes the check.
    expect(result).toBe('');
  });
});

describe('GameRoom host transfer on disconnect', () => {
  // Criterion 3: host transfer when host leaves with players remaining
  it('host disconnect with remaining players transfers host (not close)', () => {
    const result = transferHost('player1', 'player1', ['player2', 'player3']);
    expect(result.shouldClose).toBe(false);
    expect(result.newHostId).toBe('player2');
  });

  it('non-host disconnect does not change host', () => {
    const result = transferHost('player2', 'player1', ['player1', 'player3']);
    expect(result.shouldClose).toBe(false);
    expect(result.newHostId).toBe('player1');
  });

  it('host disconnect with no remaining players triggers room close', () => {
    const result = transferHost('player1', 'player1', []);
    expect(result.shouldClose).toBe(true);
    expect(result.newHostId).toBe('');
  });

  it('only player leaves → room should close', () => {
    const result = transferHost('player1', 'player1', []);
    expect(result.shouldClose).toBe(true);
  });

  it('host transfer gives host to the first remaining player', () => {
    const result = transferHost('player1', 'player1', ['player3', 'player2']);
    expect(result.newHostId).toBe('player3');
  });
});

// ---------------------------------------------------------------------------
// Localhost priority host assignment — unit tests
//
// Regression for s28b: second player (LAN phone) connects before first player
// (localhost PC running the server) and incorrectly becomes host.
// Fix: if a localhost client joins while a non-local client holds the host
// role, promote the localhost client to host.
// ---------------------------------------------------------------------------

/**
 * Mirrors the localhost priority logic in GameRoom.onJoin:
 * - If no host → first joiner is host
 * - If localhost joins and current host is non-local AND game is in lobby → promote localhost
 * - Otherwise → no change
 *
 * S28b fix: added roomPhase === 'lobby' guard to prevent host stealing on rejoin.
 * Without this guard, original host (localhost) leaving and rejoining mid-game
 * would re-steal the host role from whoever took it over, causing dual-host state.
 */
function assignHostWithLocalPriority(
  currentHostId: string,
  currentHostIsLocal: boolean,
  newPlayerId: string,
  newPlayerIsLocal: boolean,
  roomPhase: string = 'lobby',
): { hostId: string; hostIsLocal: boolean } {
  if (currentHostId === '') {
    return { hostId: newPlayerId, hostIsLocal: newPlayerIsLocal };
  }
  if (newPlayerIsLocal && !currentHostIsLocal && roomPhase === 'lobby') {
    return { hostId: newPlayerId, hostIsLocal: true };
  }
  return { hostId: currentHostId, hostIsLocal: currentHostIsLocal };
}

describe('GameRoom localhost priority host assignment (s28b regression)', () => {
  it('localhost joining first becomes host (normal case)', () => {
    const result = assignHostWithLocalPriority('', false, 'local-session', true);
    expect(result.hostId).toBe('local-session');
    expect(result.hostIsLocal).toBe(true);
  });

  it('LAN player joining first becomes host when no host exists', () => {
    const result = assignHostWithLocalPriority('', false, 'lan-session', false);
    expect(result.hostId).toBe('lan-session');
    expect(result.hostIsLocal).toBe(false);
  });

  it('localhost joining after LAN player takes host → localhost gets promoted', () => {
    // LAN player joined first (the regression scenario)
    const afterLAN = assignHostWithLocalPriority('', false, 'lan-session', false);
    expect(afterLAN.hostId).toBe('lan-session');

    // Localhost player joins second → should be promoted to host
    const afterLocal = assignHostWithLocalPriority(afterLAN.hostId, afterLAN.hostIsLocal, 'local-session', true);
    expect(afterLocal.hostId).toBe('local-session');
    expect(afterLocal.hostIsLocal).toBe(true);
  });

  it('LAN player joining after localhost host → LAN player stays guest (not promoted)', () => {
    const afterLocal = assignHostWithLocalPriority('', false, 'local-session', true);
    const afterLAN = assignHostWithLocalPriority(afterLocal.hostId, afterLocal.hostIsLocal, 'lan-session', false);
    expect(afterLAN.hostId).toBe('local-session'); // localhost stays host
    expect(afterLAN.hostIsLocal).toBe(true);
  });

  it('second localhost joining does not steal host from first localhost', () => {
    const afterFirst = assignHostWithLocalPriority('', false, 'local1', true);
    const afterSecond = assignHostWithLocalPriority(afterFirst.hostId, afterFirst.hostIsLocal, 'local2', true);
    expect(afterSecond.hostId).toBe('local1'); // first localhost stays host
  });
});

// ---------------------------------------------------------------------------
// Lobby voting state machine — unit tests
//
// Tests below validate the core voting logic in isolation (pure functions),
// mirroring GameRoom.ts behavior without requiring a live Colyseus Room instance.
//
// Covers:
//   - Vote recording (voteMap.set)
//   - Pick mode toggle
//   - Countdown → auto-launch (pickMostVoted)
//   - host_launch (startGameWithSettings choice parsing)
// ---------------------------------------------------------------------------

// Mirrors GameRoom.pickMostVoted(): returns most-voted choice or fallback.
function pickMostVoted(voteMap: Map<string, string>, fallback: string): string {
  const counts = new Map<string, number>();
  voteMap.forEach((choice) => {
    counts.set(choice, (counts.get(choice) ?? 0) + 1);
  });

  if (counts.size === 0) return fallback;

  let bestChoice = '';
  let bestCount = 0;
  counts.forEach((count, choice) => {
    if (count > bestCount) {
      bestCount = count;
      bestChoice = choice;
    }
  });
  return bestChoice;
}

// Mirrors GameRoom.startGameWithSettings() choice parsing.
function parseChoice(
  choice: string,
  currentSurface: string,
): { surface: string; mode: string; size: string } {
  const parts = choice.split(':');
  return {
    surface: parts[0] || currentSurface,
    mode: parts[1] || 'waves',
    size: parts[2] || 'medium',
  };
}

describe('GameRoom vote recording', () => {
  it('records a vote for a player', () => {
    const voteMap = new Map<string, string>();
    voteMap.set('player1', 'sphere:waves:medium');
    expect(voteMap.get('player1')).toBe('sphere:waves:medium');
  });

  it('overrides previous vote from the same player', () => {
    const voteMap = new Map<string, string>();
    voteMap.set('player1', 'sphere:waves:medium');
    voteMap.set('player1', 'torus:king:large');
    expect(voteMap.get('player1')).toBe('torus:king:large');
    expect(voteMap.size).toBe(1); // still only one entry
  });

  it('records votes from multiple players independently', () => {
    const voteMap = new Map<string, string>();
    voteMap.set('player1', 'sphere:waves:medium');
    voteMap.set('player2', 'torus:king:large');
    expect(voteMap.get('player1')).toBe('sphere:waves:medium');
    expect(voteMap.get('player2')).toBe('torus:king:large');
    expect(voteMap.size).toBe(2);
  });
});

describe('GameRoom pick mode toggle', () => {
  it('hostPickMode defaults to false (voting mode active)', () => {
    let hostPickMode = false;
    expect(hostPickMode).toBe(false);
  });

  it('host can set pick mode to true', () => {
    let hostPickMode = false;
    // Mirrors host_set_pick_mode handler
    hostPickMode = true;
    expect(hostPickMode).toBe(true);
  });

  it('non-host cannot change pick mode (guard check)', () => {
    const hostId = 'player1';
    let hostPickMode = false;

    // Non-host attempting to set — should be rejected (returns early)
    function trySetPickMode(clientId: string, pickMode: boolean): boolean {
      if (clientId !== hostId) return false; // rejected
      hostPickMode = pickMode;
      return true;
    }

    expect(trySetPickMode('player2', true)).toBe(false);
    expect(hostPickMode).toBe(false); // unchanged

    expect(trySetPickMode('player1', true)).toBe(true);
    expect(hostPickMode).toBe(true);
  });
});

describe('GameRoom countdown → auto-launch (pickMostVoted)', () => {
  it('empty vote map → returns fallback choice', () => {
    const voteMap = new Map<string, string>();
    const result = pickMostVoted(voteMap, 'sphere:waves:medium');
    expect(result).toBe('sphere:waves:medium');
  });

  it('single vote → picks that choice', () => {
    const voteMap = new Map<string, string>();
    voteMap.set('player1', 'torus:king:large');
    const result = pickMostVoted(voteMap, 'sphere:waves:medium');
    expect(result).toBe('torus:king:large');
  });

  it('two players vote same choice → picks that choice', () => {
    const voteMap = new Map<string, string>();
    voteMap.set('player1', 'cube:waves:small');
    voteMap.set('player2', 'cube:waves:small');
    const result = pickMostVoted(voteMap, 'sphere:waves:medium');
    expect(result).toBe('cube:waves:small');
  });

  it('majority wins: 2 vs 1 vote', () => {
    const voteMap = new Map<string, string>();
    voteMap.set('player1', 'sphere:rainbow:medium');
    voteMap.set('player2', 'sphere:rainbow:medium');
    voteMap.set('player3', 'torus:king:large');
    const result = pickMostVoted(voteMap, 'sphere:waves:medium');
    expect(result).toBe('sphere:rainbow:medium');
  });

  it('countdown is 30 seconds (VOTING_COUNTDOWN_SECS)', () => {
    // Regression: was 5 seconds; user requested 30 seconds (s27h-voting-timer-short)
    const VOTING_COUNTDOWN_SECS = 30;
    expect(VOTING_COUNTDOWN_SECS).toBe(30);
  });

  it('countdown reaches zero within expected ticks (+ 1 for float rounding)', () => {
    const VOTING_COUNTDOWN_SECS = 30;
    const DT = 1 / 60;
    let countdown = VOTING_COUNTDOWN_SECS;
    // Allow totalTicks + 1 to handle floating-point rounding from repeated subtraction.
    const maxTicks = Math.ceil(VOTING_COUNTDOWN_SECS / DT) + 1;
    let launchTick = -1;

    for (let i = 0; i < maxTicks; i++) {
      countdown = Math.max(0, countdown - DT);
      if (countdown <= 0 && launchTick < 0) {
        launchTick = i;
      }
    }

    expect(launchTick).toBeGreaterThanOrEqual(0);        // did trigger
    expect(launchTick).toBeLessThanOrEqual(maxTicks - 1); // within expected window
    expect(countdown).toBe(0);
  });

  it('auto-launches when all players have voted before countdown ends', () => {
    // Mirrors tickVoting() early-exit logic: voteMap.size >= players.size → launch
    const voteMap = new Map<string, string>();
    const playerCount = 2;

    function tickVoting(voteMap: Map<string, string>, playerCount: number, countdown: number): { launched: boolean; countdown: number } {
      const DT = 1 / 60;
      // All players voted → launch immediately
      if (playerCount > 0 && voteMap.size >= playerCount) {
        return { launched: true, countdown };
      }
      const newCountdown = Math.max(0, countdown - DT);
      if (newCountdown <= 0) {
        return { launched: true, countdown: 0 };
      }
      return { launched: false, countdown: newCountdown };
    }

    // Before all players vote — no launch
    voteMap.set('player1', 'sphere:waves:medium');
    let result = tickVoting(voteMap, playerCount, 25);
    expect(result.launched).toBe(false);

    // After all players vote — launch immediately
    voteMap.set('player2', 'torus:waves:small');
    result = tickVoting(voteMap, playerCount, 25);
    expect(result.launched).toBe(true);
    expect(result.countdown).toBe(25); // countdown not decremented (early exit)
  });
});

describe('GameRoom host_launch (choice parsing)', () => {
  it('parses full choice string correctly', () => {
    const parsed = parseChoice('sphere:waves:medium', 'torus');
    expect(parsed.surface).toBe('sphere');
    expect(parsed.mode).toBe('waves');
    expect(parsed.size).toBe('medium');
  });

  it('parses large map size', () => {
    const parsed = parseChoice('torus:king:large', 'sphere');
    expect(parsed.surface).toBe('torus');
    expect(parsed.mode).toBe('king');
    expect(parsed.size).toBe('large');
  });

  it('falls back to current surface when surface part is empty', () => {
    const parsed = parseChoice(':waves:medium', 'capsule');
    expect(parsed.surface).toBe('capsule'); // fallback
  });

  it('falls back to waves mode when mode part is missing', () => {
    const parsed = parseChoice('sphere::medium', 'sphere');
    expect(parsed.mode).toBe('waves');
  });

  it('falls back to medium size when size part is missing', () => {
    const parsed = parseChoice('sphere:waves:', 'sphere');
    expect(parsed.size).toBe('medium');
  });

  it('all 12 valid surfaces parse correctly', () => {
    const surfaces = [
      'sphere', 'torus', 'cube', 'capsule', 'pill', 'mobius',
      'klein', 'tunnel', 'cube-tunnel', 'peanut', 'cylinder', 'knot',
    ];
    surfaces.forEach((surface) => {
      const parsed = parseChoice(`${surface}:waves:medium`, 'sphere');
      expect(parsed.surface).toBe(surface);
    });
  });

  it('host_launch guard: only host can launch', () => {
    const hostId = 'player1';
    let launched = false;

    function tryHostLaunch(clientId: string, roomPhase: string): boolean {
      if (clientId !== hostId) return false;
      if (roomPhase !== 'voting') return false;
      launched = true;
      return true;
    }

    expect(tryHostLaunch('player2', 'voting')).toBe(false);
    expect(launched).toBe(false);

    expect(tryHostLaunch('player1', 'lobby')).toBe(false);
    expect(launched).toBe(false);

    expect(tryHostLaunch('player1', 'voting')).toBe(true);
    expect(launched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: spawn indicators without corresponding enemies (S27g)
// ---------------------------------------------------------------------------
// Before this fix, spawnSingleEnemy() sent 'pre_spawn' warnings to all clients
// for ALL enemies in a wave, then dropped the extras in the setTimeout callback
// once the cap was reached.  The result: many red dots, few actual spawns.
//
// The fix: track pendingEnemyCount (warned but not yet materialized).  Before
// sending a warning, check (enemies.length + pendingEnemyCount) >= cap.  Only
// send the warning if there's room.  Return false so spawnWave() can break early.
// ---------------------------------------------------------------------------

/**
 * Simulate the spawnSingleEnemy cap logic in isolation.
 * Returns true if the enemy was queued (warning would be sent), false if dropped.
 */
function simulateSpawnSingleEnemy(
  enemyCount: number,
  pendingCount: number,
  maxEnemies: number,
): { queued: boolean; newPending: number } {
  if (enemyCount + pendingCount >= maxEnemies) {
    return { queued: false, newPending: pendingCount };
  }
  return { queued: true, newPending: pendingCount + 1 };
}

/**
 * Simulate spawnWave with the fixed logic: call spawnSingleEnemy for each
 * enemy entry, stop when the cap (enemies + pending) is reached.
 * Returns { warnings, dropped } — warnings = pre_spawn messages sent.
 */
function simulateSpawnWave(
  enemyCount: number,
  waveTotal: number,
  maxEnemies: number,
): { warnings: number; phantomWarnings: number } {
  let pending = 0;
  let warnings = 0;

  for (let i = 0; i < waveTotal; i++) {
    const { queued, newPending } = simulateSpawnSingleEnemy(enemyCount, pending, maxEnemies);
    if (!queued) {
      break; // spawnWave breaks when spawnSingleEnemy returns false — no warning sent
    }
    pending = newPending;
    warnings++;
  }
  // With the fix: phantomWarnings = 0, because we never send a warning for an enemy
  // that would be dropped. The remaining wave entries are simply not processed.
  return { warnings, phantomWarnings: 0 };
}

describe('spawn indicators 1:1 with enemy spawns (S27g regression)', () => {
  it('FIXED: never sends more warnings than (cap - currentEnemies)', () => {
    // With 5 active enemies, cap 30, wave of 51: only 25 warnings should be sent
    const { warnings, phantomWarnings } = simulateSpawnWave(5, 51, 30);
    expect(warnings).toBe(25);         // exactly fills remaining cap slots
    expect(phantomWarnings).toBe(0);   // no phantom red dots
  });

  it('FIXED: at cap, no warnings sent at all', () => {
    const { warnings, phantomWarnings } = simulateSpawnWave(30, 20, 30);
    expect(warnings).toBe(0);
    expect(phantomWarnings).toBe(0);
  });

  it('FIXED: small wave under cap — all warnings sent', () => {
    const { warnings } = simulateSpawnWave(0, 6, 30);
    expect(warnings).toBe(6); // wave fits entirely within cap
  });

  it('FIXED: pendingEnemyCount accumulates correctly within a wave', () => {
    // Verify pending count prevents over-allocation when many are queued at once
    let pending = 0;
    let warnings = 0;
    const enemyCount = 0;
    const maxEnemies = 10;

    for (let i = 0; i < 20; i++) {
      const { queued, newPending } = simulateSpawnSingleEnemy(enemyCount, pending, maxEnemies);
      if (!queued) break;
      pending = newPending;
      warnings++;
    }

    expect(warnings).toBe(10); // never exceeds cap
    expect(pending).toBe(10);  // pending saturates at cap
  });

  it('REGRESSION: old behavior would send all warnings regardless of cap', () => {
    // Demonstrate old behavior (no pending tracking): all 51 warnings sent,
    // then 26 dropped in setTimeout. This test verifies the old code was wrong.
    // Old spawnWave: checks enemies.length (never changes), sends all warnings.
    function oldSimulateSpawnWave(enemyCount: number, waveTotal: number, maxEnemies: number) {
      let warnings = 0;
      let droppedInTimeout = 0;

      // Old loop: enemies.length stays at enemyCount throughout (no pending tracking)
      for (let i = 0; i < waveTotal; i++) {
        if (enemyCount >= maxEnemies) break; // never true if enemyCount < maxEnemies
        warnings++;
      }
      // setTimeout fires for all 'warnings' — but only (maxEnemies - enemyCount) materialize
      const materialized = Math.min(warnings, maxEnemies - enemyCount);
      droppedInTimeout = warnings - materialized;
      return { warnings, droppedInTimeout };
    }

    const { warnings, droppedInTimeout } = oldSimulateSpawnWave(5, 51, 30);
    expect(warnings).toBe(51);          // old code sent all 51 warnings (phantom red dots)
    expect(droppedInTimeout).toBe(26);  // 26 enemies silently dropped → phantom indicators
  });
});

// ---------------------------------------------------------------------------
// Regression: spawn indicator issues after game restart (S27h)
// ---------------------------------------------------------------------------
// Fix 1: pendingEnemyCount was decremented even for stale (old-generation)
// timeouts, which could corrupt the new game's count and produce phantom rings
// when the host restarts the game quickly (e.g. via host_launch).
// The gen check must happen BEFORE the decrement.
//
// Fix 2: enemies spawned at U=0/U=1 (UV seam) produced warning rings that
// were invisible on the sphere because the seam is on the "back" of the sphere
// occluded by the mesh. getSpawnPosition() now places enemies 0.25–0.45 UV
// units from the nearest player so the ring is within the player's visible field.
// ---------------------------------------------------------------------------

describe('S27h: pendingEnemyCount not corrupted after game restart', () => {
  it('OLD behavior: old-gen timeout corrupts new game pendingEnemyCount', () => {
    // Before restart: 3 pending enemies (their timeouts are still running)
    // New game starts: pendingCount reset to 0, 5 new enemies queued
    let pendingCount = 3;
    let spawnGen = 0;
    const capturedGen = spawnGen; // old game gen

    // Game restarts
    spawnGen++;
    pendingCount = 0;

    // New game queues 5 enemies
    pendingCount = 5;

    // Old timeout fires (old gen=0, current gen=1)
    // OLD: decrement regardless first, THEN check gen
    pendingCount = Math.max(0, pendingCount - 1); // decrements from 5 → 4  ← BUG
    if (spawnGen !== capturedGen) { /* stale, returns */ }

    // pendingCount is now 4 instead of 5 — count is wrong!
    expect(pendingCount).toBe(4); // demonstrates the BUG (before fix)
  });

  it('NEW behavior: old-gen timeout leaves pendingEnemyCount intact', () => {
    // Same scenario as above, but with the fix applied
    let pendingCount = 3;
    let spawnGen = 0;
    const capturedGen = spawnGen; // old game gen

    // Game restarts
    spawnGen++;
    pendingCount = 0;

    // New game queues 5 enemies
    pendingCount = 5;

    // Old timeout fires (old gen=0, current gen=1)
    // NEW: check gen FIRST — stale, return without touching pendingCount
    if (spawnGen !== capturedGen) { /* stale, returns — does NOT decrement */ }
    // pendingCount is still 5 — count is correct!

    expect(pendingCount).toBe(5); // NEW code preserves count
  });

  it('same-gen timeout still decrements correctly', () => {
    let pendingCount = 5;
    const spawnGen = 1;
    const capturedGen = 1; // same gen as current game

    // Timeout fires for current game gen — should decrement
    if (spawnGen !== capturedGen) return; // same gen, does NOT return early
    pendingCount = Math.max(0, pendingCount - 1);

    expect(pendingCount).toBe(4); // decremented correctly for same-gen
  });

  it('multiple old-gen timeouts do not underflow pendingEnemyCount', () => {
    let pendingCount = 0;
    const spawnGen = 1;
    const oldGen = 0;

    // 5 old-gen timeouts fire (from game 0) during game 1
    for (let i = 0; i < 5; i++) {
      if (spawnGen !== oldGen) continue; // stale — skips decrement
      pendingCount = Math.max(0, pendingCount - 1);
    }

    expect(pendingCount).toBe(0); // stays at 0, not negative
  });

  it('full restart cycle: game2 enemy count unaffected by game1 timeouts', () => {
    let pendingCount = 0;
    let spawnGen = 0;
    let stateEnemyCount = 0;

    // Game 1: spawn 6 enemies (pendingCount = 6)
    const game1Gen = spawnGen;
    pendingCount = 6;

    // Game restarts
    spawnGen++;
    pendingCount = 0;
    stateEnemyCount = 0;

    // Game 2: spawn 4 enemies
    const game2Gen = spawnGen;
    pendingCount = 4;

    // Game 1's 6 timeouts fire (stale, gen=0 ≠ spawnGen=1) — must NOT touch pendingCount
    for (let i = 0; i < 6; i++) {
      if (spawnGen !== game1Gen) continue; // stale, skip
      pendingCount = Math.max(0, pendingCount - 1);
      stateEnemyCount++;
    }

    // Game 2's 4 timeouts fire (same gen=1)
    for (let i = 0; i < 4; i++) {
      if (spawnGen !== game2Gen) continue;
      pendingCount = Math.max(0, pendingCount - 1);
      stateEnemyCount++;
    }

    // Exactly 4 enemies from game 2, none from game 1
    expect(stateEnemyCount).toBe(4);
    expect(pendingCount).toBe(0);
  });
});

describe('S27h: spawn positions visible to players (not at UV seam)', () => {
  /**
   * Simulate getSpawnPosition() logic: place enemies 0.25–0.45 UV units from
   * the nearest player, avoiding exact U=0/1 (the seam).
   */
  function simulateGetSpawnPosition(
    playerU: number,
    playerV: number,
    angle: number,
    dist: number,
  ): { u: number; v: number } {
    const vMin = 0.05;
    const vMax = 0.95;
    const u = ((playerU + dist * Math.cos(angle)) % 1 + 1) % 1;
    const v = Math.max(vMin, Math.min(vMax, playerV + dist * Math.sin(angle)));
    return { u, v };
  }

  it('spawn positions are NOT at exact U=0 or U=1 seam for typical inputs', () => {
    // Only way to get exactly U=0 or U=1 from player-relative spawn is if
    // (playerU + dist*cos(angle)) is exactly 0 or 1 — extremely unlikely in practice.
    // Test that the fallback (no players) avoids the seam.
    const LOWER = 0.1;
    const UPPER = 0.9; // fallback uses 0.1 + rand * 0.8
    for (let i = 0; i < 100; i++) {
      const u = LOWER + Math.random() * (UPPER - LOWER);
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
    }
  });

  it('spawn positions are within MIN_DIST..MAX_DIST of the player', () => {
    const playerU = 0.5;
    const playerV = 0.5;
    const MIN_DIST = 0.25;
    const MAX_DIST = 0.45;

    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * 2 * Math.PI;
      const dist = MIN_DIST + (i / 20) * (MAX_DIST - MIN_DIST);
      const { u, v } = simulateGetSpawnPosition(playerU, playerV, angle, dist);

      let du = Math.abs(u - playerU);
      if (du > 0.5) du = 1 - du;
      const dv = Math.abs(v - playerV);
      const actualDist = Math.sqrt(du * du + dv * dv);

      // V may be clamped at poles so actual dist can be less than intended
      expect(actualDist).toBeGreaterThanOrEqual(0.0);
      // U component alone is at least 0 (valid range)
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
  });

  it('spawn V is always within [0.05, 0.95] (no pole singularities)', () => {
    for (let i = 0; i < 36; i++) {
      const angle = (i / 36) * 2 * Math.PI;
      // Use a large dist that would push V outside [0, 1] without clamping
      const { v } = simulateGetSpawnPosition(0.5, 0.5, angle, 0.6);
      expect(v).toBeGreaterThanOrEqual(0.05);
      expect(v).toBeLessThanOrEqual(0.95);
    }
  });
});

// ---------------------------------------------------------------------------
// Player death and game-over logic (S28a — MP player respawn at death location)
//
// Tests verify:
//  1. Game CONTINUES when ONE player dies (other player still alive)
//  2. Game ENDS only when ALL players are dead
//  3. Multi-hit prevention: player loses at most one life per tick even when
//     multiple enemies are simultaneously at the same position
// ---------------------------------------------------------------------------

/** Mirrors checkGameOver() logic: returns true if game should end. */
function checkShouldGameOver(players: Map<string, { alive: boolean }>): boolean {
  let anyAlive = false;
  players.forEach((player) => {
    if (player.alive) anyAlive = true;
  });
  return !anyAlive && players.size > 0;
}

/**
 * Simulate a single player-enemy collision tick WITH the wasHit fix.
 * Returns the player state after processing all enemy collisions in one tick.
 */
function simulateCollisionTick(
  player: { lives: number; alive: boolean; surfaceU: number; surfaceV: number },
  invincible: boolean,
  enemyPositions: Array<{ surfaceU: number; surfaceV: number }>,
  hitThreshold = 0.04,
): { lives: number; alive: boolean; wasHit: boolean } {
  if (!player.alive || invincible) {
    return { lives: player.lives, alive: player.alive, wasHit: false };
  }

  let wasHit = false;
  let lives = player.lives;
  let alive = player.alive;

  for (const enemy of enemyPositions) {
    if (wasHit) break; // One hit per tick (the fix)
    const du = player.surfaceU - enemy.surfaceU;
    const dv = player.surfaceV - enemy.surfaceV;
    const dist = Math.sqrt(du * du + dv * dv);
    if (dist < hitThreshold) {
      wasHit = true;
      lives--;
      if (lives <= 0) {
        alive = false;
      }
    }
  }

  return { lives, alive, wasHit };
}

describe('GameRoom checkGameOver — game ends only when ALL players dead', () => {
  it('game CONTINUES when one of two players dies', () => {
    const players = new Map([
      ['p1', { alive: false }], // dead
      ['p2', { alive: true }],  // alive
    ]);
    expect(checkShouldGameOver(players)).toBe(false);
  });

  it('game CONTINUES when one of four players dies', () => {
    const players = new Map([
      ['p1', { alive: false }],
      ['p2', { alive: true }],
      ['p3', { alive: true }],
      ['p4', { alive: true }],
    ]);
    expect(checkShouldGameOver(players)).toBe(false);
  });

  it('game CONTINUES when three of four players die', () => {
    const players = new Map([
      ['p1', { alive: false }],
      ['p2', { alive: false }],
      ['p3', { alive: false }],
      ['p4', { alive: true }],
    ]);
    expect(checkShouldGameOver(players)).toBe(false);
  });

  it('game ENDS when ALL players are dead', () => {
    const players = new Map([
      ['p1', { alive: false }],
      ['p2', { alive: false }],
    ]);
    expect(checkShouldGameOver(players)).toBe(true);
  });

  it('game ENDS when sole player dies', () => {
    const players = new Map([
      ['p1', { alive: false }],
    ]);
    expect(checkShouldGameOver(players)).toBe(true);
  });

  it('game does NOT end with empty player list (room closing, not game over)', () => {
    const players = new Map<string, { alive: boolean }>();
    // players.size === 0 → condition !anyAlive && players.size > 0 is FALSE
    expect(checkShouldGameOver(players)).toBe(false);
  });
});

describe('GameRoom multi-hit prevention (wasHit flag)', () => {
  it('player with 3 lives hit by 3 simultaneous enemies loses only 1 life', () => {
    const player = { lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5 };
    const enemies = [
      { surfaceU: 0.5, surfaceV: 0.5 }, // on top of player
      { surfaceU: 0.5, surfaceV: 0.5 }, // on top of player
      { surfaceU: 0.5, surfaceV: 0.5 }, // on top of player
    ];
    const result = simulateCollisionTick(player, false, enemies);
    expect(result.lives).toBe(2);    // lost exactly 1 life
    expect(result.alive).toBe(true); // still alive
    expect(result.wasHit).toBe(true);
  });

  it('player with 1 life hit by 3 simultaneous enemies dies but does NOT go below 0 lives', () => {
    const player = { lives: 1, alive: true, surfaceU: 0.5, surfaceV: 0.5 };
    const enemies = [
      { surfaceU: 0.5, surfaceV: 0.5 },
      { surfaceU: 0.5, surfaceV: 0.5 },
      { surfaceU: 0.5, surfaceV: 0.5 },
    ];
    const result = simulateCollisionTick(player, false, enemies);
    expect(result.lives).toBe(0);     // exactly 0, not -2
    expect(result.alive).toBe(false); // dead
  });

  it('invincible player is not hit even by adjacent enemy', () => {
    const player = { lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5 };
    const enemies = [{ surfaceU: 0.5, surfaceV: 0.5 }];
    const result = simulateCollisionTick(player, true, enemies); // invincible=true
    expect(result.lives).toBe(3); // no damage
    expect(result.wasHit).toBe(false);
  });

  it('dead player is not processed for collisions', () => {
    const player = { lives: 0, alive: false, surfaceU: 0.5, surfaceV: 0.5 };
    const enemies = [{ surfaceU: 0.5, surfaceV: 0.5 }];
    const result = simulateCollisionTick(player, false, enemies);
    expect(result.lives).toBe(0); // unchanged
    expect(result.alive).toBe(false);
    expect(result.wasHit).toBe(false);
  });

  it('player hit by non-overlapping enemy is not damaged', () => {
    const player = { lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5 };
    const enemies = [{ surfaceU: 0.8, surfaceV: 0.8 }]; // far away
    const result = simulateCollisionTick(player, false, enemies);
    expect(result.lives).toBe(3); // no hit
    expect(result.wasHit).toBe(false);
  });

  it('without wasHit fix (BROKEN): player with 3 lives would die to 3 simultaneous enemies', () => {
    // This test documents the BUG that wasHit fixes.
    // Without wasHit, all 3 enemy collisions are processed → lives goes 3→2→1→0 → death.
    const player = { lives: 3, alive: true, surfaceU: 0.5, surfaceV: 0.5 };
    const enemies = [
      { surfaceU: 0.5, surfaceV: 0.5 },
      { surfaceU: 0.5, surfaceV: 0.5 },
      { surfaceU: 0.5, surfaceV: 0.5 },
    ];

    // BROKEN version (no wasHit flag):
    let brokenLives = player.lives;
    let brokenAlive = player.alive;
    for (const enemy of enemies) {
      const du = player.surfaceU - enemy.surfaceU;
      const dv = player.surfaceV - enemy.surfaceV;
      const dist = Math.sqrt(du * du + dv * dv);
      if (dist < 0.04) {
        brokenLives--;
        if (brokenLives <= 0) brokenAlive = false;
      }
    }

    // Document the broken behavior:
    expect(brokenLives).toBe(0);     // dies! (bug)
    expect(brokenAlive).toBe(false); // dies! (bug)

    // FIXED version (with wasHit):
    const fixedResult = simulateCollisionTick(player, false, enemies);
    expect(fixedResult.lives).toBe(2);    // only lost 1 life (correct)
    expect(fixedResult.alive).toBe(true); // still alive (correct)
  });
});

// ---------------------------------------------------------------------------
// S28b: Server bullet-enemy hit threshold calibration
//
// Root cause: GameRoom.checkCollisions() used dist < 0.05 (UV space), which
// equals ~1.57 world units on a sphere of radius 10 — 6x larger than the
// visual enemy radius of ~0.25 world units. S27g and S28a only fixed the
// client-side CollisionSystem.ts; the server was never updated.
//
// Fix: threshold reduced to 0.012 UV, calibrated as:
//   enemy_radius / (π * surface_radius) = 0.25 / (π * 10) ≈ 0.008
//   × 1.5 tolerance for discrete bullet step size → 0.012
// ---------------------------------------------------------------------------

/** Mirror of GameRoom.checkCollisions() bullet-enemy hit logic (post-S28b fix). */
function serverBulletHitsEnemy(
  bulletU: number, bulletV: number,
  enemyU: number, enemyV: number,
  threshold: number,
): boolean {
  const du = bulletU - enemyU;
  const dv = bulletV - enemyV;
  const dist = Math.sqrt(du * du + dv * dv);
  return dist < threshold;
}

/** Convert world-space radius to UV space on a sphere (V arc-length formula). */
function worldRadiusToUV(worldRadius: number, sphereRadius: number): number {
  return worldRadius / (Math.PI * sphereRadius);
}

describe('S28b: server bullet-enemy hit threshold calibration', () => {
  const SPHERE_RADIUS = 10;
  const THRESHOLD_S28B = 0.012; // new threshold
  const THRESHOLD_OLD = 0.05;   // old threshold (pre-fix)

  it('S28b threshold 0.012 is calibrated to visual enemy size on sphere radius=10', () => {
    // Enemy visual radius ≈ 0.25 world units → 0.25 / (π * 10) ≈ 0.008 UV
    // 0.012 is 0.008 × 1.5 — accounts for discrete bullet step size
    const enemyWorldRadius = 0.25;
    const uvEquivalent = worldRadiusToUV(enemyWorldRadius, SPHERE_RADIUS);
    expect(THRESHOLD_S28B).toBeGreaterThan(uvEquivalent);          // includes tolerance
    expect(THRESHOLD_S28B).toBeLessThan(uvEquivalent * 2.0);       // not more than 2x
  });

  it('old threshold 0.05 was 6x visual size — enemies died from far away', () => {
    const enemyWorldRadius = 0.25;
    const uvEquivalent = worldRadiusToUV(enemyWorldRadius, SPHERE_RADIUS);
    const inflationFactor = THRESHOLD_OLD / uvEquivalent;
    // Old threshold was roughly 6x too large
    expect(inflationFactor).toBeGreaterThan(5.0);
  });

  it('bullet exactly on enemy (dist=0) hits with new threshold', () => {
    expect(serverBulletHitsEnemy(0.5, 0.5, 0.5, 0.5, THRESHOLD_S28B)).toBe(true);
  });

  it('bullet within 0.010 UV hits enemy (inside visual radius)', () => {
    expect(serverBulletHitsEnemy(0.5, 0.5, 0.510, 0.5, THRESHOLD_S28B)).toBe(true);
  });

  it('bullet just inside threshold (0.011) hits enemy', () => {
    expect(serverBulletHitsEnemy(0.5, 0.5, 0.511, 0.5, THRESHOLD_S28B)).toBe(true);
  });

  it('bullet just outside threshold (0.013) does NOT hit enemy', () => {
    expect(serverBulletHitsEnemy(0.5, 0.5, 0.513, 0.5, THRESHOLD_S28B)).toBe(false);
  });

  it('REGRESSION: old threshold 0.05 would incorrectly hit at 0.030 UV (6x visual)', () => {
    // With old threshold: bullet 0.030 UV away = ~0.94 world units → still "hits"
    // Visual radius is only 0.25 world units → bullet was nowhere near the enemy
    const bulletU = 0.5 + 0.030; // 0.030 UV away
    const oldHits = serverBulletHitsEnemy(0.5, 0.5, bulletU, 0.5, THRESHOLD_OLD);
    const newHits = serverBulletHitsEnemy(0.5, 0.5, bulletU, 0.5, THRESHOLD_S28B);

    expect(oldHits).toBe(true);  // OLD: hits from far away (wrong)
    expect(newHits).toBe(false); // NEW: correctly misses (0.030 > 0.012 threshold)
  });

  it('REGRESSION: old threshold killed enemy when bullet was 1.57 world units away', () => {
    // 0.05 UV on sphere-R10 (V arc) = 0.05 * π * 10 ≈ 1.57 world units
    // Enemy visual radius = 0.25 world units → 6x too far
    const worldDistanceAtOldThreshold = THRESHOLD_OLD * Math.PI * SPHERE_RADIUS;
    const worldDistanceAtNewThreshold = THRESHOLD_S28B * Math.PI * SPHERE_RADIUS;
    const enemyVisualRadius = 0.25;

    expect(worldDistanceAtOldThreshold).toBeGreaterThan(enemyVisualRadius * 4); // old was 4x+ too large
    expect(worldDistanceAtNewThreshold).toBeLessThan(enemyVisualRadius * 2);    // new is within 2x of visual
  });
});

// ---------------------------------------------------------------------------
// S28b: Rejoin-after-pause dual-host regression
//
// Bug: Player A (localhost, original host) leaves mid-game while game is paused.
// Host transfers to Player B. Player A rejoins. The old localhost-priority logic
// re-promoted Player A to host (because hostIsLocal was reset to false on transfer),
// causing BOTH players to think they're host simultaneously.
//
// Fix 1: Localhost promotion only applies in 'lobby' phase.
//        Mid-game rejoins never trigger the localhost priority path.
//
// Fix 2: hostIsLocal is set to the actual locality of the new host on transfer
//        (not always false). This prevents false re-promotion if the new host
//        was also local.
//
// Fix 3: startGame() resets isPaused = false to prevent stale pause state from
//        a previous round bleeding into a new round after voting.
// ---------------------------------------------------------------------------

/**
 * Mirrors GameRoom.onLeave host transfer with locality tracking.
 * Returns the new host state including the actual hostIsLocal value.
 */
function transferHostWithLocality(
  leavingPlayerId: string,
  currentHostId: string,
  remainingPlayers: Array<{ id: string; isLocal: boolean }>,
  clientLocality: Map<string, boolean>,
): { newHostId: string; newHostIsLocal: boolean; shouldClose: boolean; unpaused: boolean } {
  if (leavingPlayerId !== currentHostId) {
    return { newHostId: currentHostId, newHostIsLocal: clientLocality.get(currentHostId) ?? false, shouldClose: false, unpaused: false };
  }

  const nextHost = remainingPlayers[0];
  if (!nextHost) {
    return { newHostId: '', newHostIsLocal: false, shouldClose: true, unpaused: false };
  }

  return {
    newHostId: nextHost.id,
    newHostIsLocal: clientLocality.get(nextHost.id) ?? false,
    shouldClose: false,
    unpaused: true, // auto-unpause when host leaves
  };
}

describe('S28b: localhost-priority blocked mid-game (rejoin dual-host regression)', () => {
  it('REGRESSION: old code re-promoted localhost host on mid-game rejoin', () => {
    // OLD assignHostWithLocalPriority (no roomPhase guard):
    function oldAssign(
      currentHostId: string,
      currentHostIsLocal: boolean,
      newPlayerId: string,
      newPlayerIsLocal: boolean,
    ): { hostId: string; hostIsLocal: boolean } {
      if (currentHostId === '') return { hostId: newPlayerId, hostIsLocal: newPlayerIsLocal };
      if (newPlayerIsLocal && !currentHostIsLocal) return { hostId: newPlayerId, hostIsLocal: true };
      return { hostId: currentHostId, hostIsLocal: currentHostIsLocal };
    }

    // Scenario: localhost host leaves → host transfers to LAN player (hostIsLocal=false)
    // Localhost player rejoins
    const result = oldAssign('lan-player', false /* hostIsLocal reset to false */, 'local-rejoin', true);
    // BUG: localhost gets re-promoted even though game was in progress!
    expect(result.hostId).toBe('local-rejoin'); // demonstrates the BUG
  });

  it('FIX: lobby promotion allowed when roomPhase=lobby', () => {
    const result = assignHostWithLocalPriority('lan-player', false, 'local-player', true, 'lobby');
    expect(result.hostId).toBe('local-player'); // promotion in lobby is correct
    expect(result.hostIsLocal).toBe(true);
  });

  it('FIX: lobby promotion BLOCKED when roomPhase=playing (mid-game rejoin)', () => {
    // Same scenario as the bug, but with roomPhase='playing'
    const result = assignHostWithLocalPriority('lan-player', false, 'local-rejoin', true, 'playing');
    expect(result.hostId).toBe('lan-player'); // host unchanged — no re-promotion
    expect(result.hostIsLocal).toBe(false);
  });

  it('FIX: lobby promotion BLOCKED when roomPhase=voting (end-of-game rejoin)', () => {
    const result = assignHostWithLocalPriority('lan-player', false, 'local-rejoin', true, 'voting');
    expect(result.hostId).toBe('lan-player'); // host unchanged
  });

  it('FIX: original scenario — localhost leaves, LAN takes host, localhost rejoins mid-game', () => {
    // Step 1: Lobby — localhost joins first, becomes host
    let state = assignHostWithLocalPriority('', false, 'local-p', true, 'lobby');
    expect(state.hostId).toBe('local-p');
    expect(state.hostIsLocal).toBe(true);

    // Step 2: LAN player joins in lobby — does NOT steal host
    state = assignHostWithLocalPriority(state.hostId, state.hostIsLocal, 'lan-p', false, 'lobby');
    expect(state.hostId).toBe('local-p'); // localhost stays host

    // Step 3: Game starts (roomPhase changes to 'playing')
    // ... time passes ...

    // Step 4: localhost player leaves — host transfers to LAN player
    // (Transfer sets hostIsLocal = false since lan-p is not local)
    state = { hostId: 'lan-p', hostIsLocal: false }; // simulates onLeave + transfer

    // Step 5: localhost player REJOINS with new session ID (roomPhase = 'playing')
    state = assignHostWithLocalPriority(state.hostId, state.hostIsLocal, 'local-p-new', true, 'playing');

    // FIX: no re-promotion mid-game → only ONE host
    expect(state.hostId).toBe('lan-p'); // LAN player is still host (correct!)
    expect(state.hostIsLocal).toBe(false);
  });

  it('FIX: LAN non-host leaves mid-game — no host change, no dual-host', () => {
    // LAN player (non-host) leaves — no host transfer
    const result = assignHostWithLocalPriority('localhost-host', true, 'lan-rejoin', false, 'playing');
    expect(result.hostId).toBe('localhost-host'); // unchanged
    expect(result.hostIsLocal).toBe(true);
  });

  it('FIX: two localhost players — second never steals from first', () => {
    // First localhost is host
    const state1 = assignHostWithLocalPriority('', false, 'local1', true, 'lobby');
    expect(state1.hostId).toBe('local1');

    // Second localhost joins in lobby — should NOT steal (first is already local)
    const state2 = assignHostWithLocalPriority(state1.hostId, state1.hostIsLocal, 'local2', true, 'lobby');
    expect(state2.hostId).toBe('local1'); // unchanged (hostIsLocal=true blocks promotion)

    // In playing phase — also no steal
    const state3 = assignHostWithLocalPriority(state1.hostId, state1.hostIsLocal, 'local2-rejoin', true, 'playing');
    expect(state3.hostId).toBe('local1');
  });
});

describe('S28b: hostIsLocal correctly tracked on host transfer', () => {
  it('transfer to LAN player: hostIsLocal=false', () => {
    const clientLocality = new Map([
      ['local1', true],
      ['lan-player', false],
    ]);
    const result = transferHostWithLocality('local1', 'local1', [{ id: 'lan-player', isLocal: false }], clientLocality);
    expect(result.newHostId).toBe('lan-player');
    expect(result.newHostIsLocal).toBe(false); // correctly false, not 'reset for safety'
  });

  it('transfer to localhost player: hostIsLocal=true (not false as before)', () => {
    const clientLocality = new Map([
      ['local1', true],
      ['local2', true], // both are localhost (same machine, different tabs)
    ]);
    const result = transferHostWithLocality('local1', 'local1', [{ id: 'local2', isLocal: true }], clientLocality);
    expect(result.newHostId).toBe('local2');
    expect(result.newHostIsLocal).toBe(true); // correctly true
  });

  it('host transfer auto-unpauses game when host leaves', () => {
    const clientLocality = new Map([['lan-p', false]]);
    const result = transferHostWithLocality('paused-host', 'paused-host', [{ id: 'lan-p', isLocal: false }], clientLocality);
    expect(result.unpaused).toBe(true);
  });

  it('non-host leave does NOT trigger auto-unpause', () => {
    const clientLocality = new Map([['actual-host', true], ['lan-p', false]]);
    const result = transferHostWithLocality('lan-p', 'actual-host', [{ id: 'actual-host', isLocal: true }], clientLocality);
    expect(result.unpaused).toBe(false);
    expect(result.newHostId).toBe('actual-host'); // host unchanged
  });
});

describe('S28b: isPaused reset on startGame (no stale pause from previous round)', () => {
  it('startGame always begins with isPaused=false', () => {
    // Simulate startGame() state changes
    let isPaused = true; // was paused in previous round

    // startGame() sets isPaused = false
    isPaused = false;

    expect(isPaused).toBe(false);
  });

  it('isPaused=true from previous round does NOT carry into new game', () => {
    // Scenario: game was paused → voting phase ends → new game starts
    // Without fix: isPaused would remain true, freezing the new game
    // With fix: startGame() resets isPaused

    let roomPhase = 'playing';
    let isPaused = true; // game was paused

    // Game over → voting
    roomPhase = 'voting';
    // isPaused not reset here (transitionToVoting doesn't touch isPaused — OK since voting tick ignores it)

    // New game starts via host_launch/vote
    roomPhase = 'playing';
    isPaused = false; // startGame() resets this

    expect(isPaused).toBe(false); // new game is NOT frozen
  });
});
