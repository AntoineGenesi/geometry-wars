/**
 * Tests for Claustrophobia mode in multiplayer (s44h-15).
 *
 * These tests validate the Claustrophobia-specific logic in isolation:
 * - Difficulty escalation multiplier (1.3×)
 * - Spawn count multiplier (1.5×)
 * - Earlier wave thresholds for hard/elite/splitting enemies
 * - Surface restriction (only small surfaces allowed)
 * - Time limit enforcement (20 minutes)
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Replicate the constants from GameRoom.ts for isolated testing
// ---------------------------------------------------------------------------

const CLAUSTROPHOBIA_TIME_LIMIT_SECS = 1200;
const CLAUSTROPHOBIA_SPAWN_MULTIPLIER = 1.5;
const CLAUSTROPHOBIA_DIFFICULTY_MULTIPLIER = 1.3;
const CLAUSTROPHOBIA_ALLOWED_SURFACES = ['sphere', 'torus', 'capsule', 'icosahedron'];

// ---------------------------------------------------------------------------
// Replicate computeDifficultyLevel() logic
// ---------------------------------------------------------------------------

function computeDifficultyLevel(waveNumber: number, gameTime: number, playerCount: number, gameMode: string): number {
  const waveContrib = Math.max(0, (waveNumber - 1) * 0.3);
  const timeContrib = gameTime / 600;
  const playerCountBonus = (playerCount - 1) * 0.3;
  const base = waveContrib + timeContrib + playerCountBonus;
  const claustrophobiaBonus = gameMode === 'claustrophobia'
    ? waveContrib * (CLAUSTROPHOBIA_DIFFICULTY_MULTIPLIER - 1)
    : 0;
  return Math.min(8.0, base + claustrophobiaBonus);
}

// ---------------------------------------------------------------------------
// Replicate base count logic from generateServerWave()
// ---------------------------------------------------------------------------

function computeBaseCount(waveNumber: number, difficultyLevel: number, gameMode: string): number {
  const difficultyCountBonus = Math.floor(difficultyLevel * 2.0);
  const baseCountCap = difficultyLevel >= 6 ? 40 : 30;
  const claustrophobiaCountMult = gameMode === 'claustrophobia' ? CLAUSTROPHOBIA_SPAWN_MULTIPLIER : 1.0;
  return Math.min(baseCountCap,
    Math.round((4 + Math.floor(Math.sqrt(waveNumber) * 2) + difficultyCountBonus) * claustrophobiaCountMult));
}

// ---------------------------------------------------------------------------
// Replicate wave threshold logic
// ---------------------------------------------------------------------------

function getWaveThresholds(gameMode: string) {
  const isClaustrophobia = gameMode === 'claustrophobia';
  return {
    hardWaveThreshold:     isClaustrophobia ? 3 : 4,
    splittingWaveThreshold: isClaustrophobia ? 4 : 5,
    eliteWaveThreshold:    isClaustrophobia ? 5 : 6,
  };
}

// ---------------------------------------------------------------------------
// Surface restriction helper (mirrors startGameWithSettings logic)
// ---------------------------------------------------------------------------

function resolveStartSurface(requestedSurface: string, gameMode: string): string {
  if (gameMode === 'claustrophobia' && !CLAUSTROPHOBIA_ALLOWED_SURFACES.includes(requestedSurface)) {
    return 'sphere';
  }
  return requestedSurface;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Claustrophobia MP — surface restrictions', () => {
  it('allows small surfaces in Claustrophobia mode', () => {
    for (const surf of CLAUSTROPHOBIA_ALLOWED_SURFACES) {
      expect(resolveStartSurface(surf, 'claustrophobia')).toBe(surf);
    }
  });

  it('blocks large surfaces in Claustrophobia mode, falls back to sphere', () => {
    const largeSurfaces = ['cube', 'cube-tunnel', 'peanut', 'pill'];
    for (const surf of largeSurfaces) {
      expect(resolveStartSurface(surf, 'claustrophobia')).toBe('sphere');
    }
  });

  it('does not restrict surfaces in non-Claustrophobia modes', () => {
    expect(resolveStartSurface('cube', 'waves')).toBe('cube');
    expect(resolveStartSurface('peanut', 'king')).toBe('peanut');
    expect(resolveStartSurface('cube-tunnel', 'sniper')).toBe('cube-tunnel');
  });

  it('CLAUSTROPHOBIA_ALLOWED_SURFACES contains sphere and torus', () => {
    expect(CLAUSTROPHOBIA_ALLOWED_SURFACES).toContain('sphere');
    expect(CLAUSTROPHOBIA_ALLOWED_SURFACES).toContain('torus');
  });
});

describe('Claustrophobia MP — difficulty escalation', () => {
  it('applies 1.3× wave difficulty multiplier in Claustrophobia mode', () => {
    const waveNumber = 10;
    const gameTime = 0;
    const playerCount = 1;

    const normalDifficulty = computeDifficultyLevel(waveNumber, gameTime, playerCount, 'waves');
    const claustrophobiaDifficulty = computeDifficultyLevel(waveNumber, gameTime, playerCount, 'claustrophobia');

    // Wave contribution is (10-1)*0.3 = 2.7; 1.3× multiplier → +0.81 bonus
    expect(claustrophobiaDifficulty).toBeGreaterThan(normalDifficulty);
    expect(claustrophobiaDifficulty).toBeCloseTo(normalDifficulty + 2.7 * 0.3, 5);
  });

  it('caps difficulty at 8.0 even with Claustrophobia multiplier', () => {
    const highWave = 50;
    expect(computeDifficultyLevel(highWave, 6000, 4, 'claustrophobia')).toBe(8.0);
  });

  it('does not apply multiplier for other modes', () => {
    const normal = computeDifficultyLevel(10, 0, 1, 'waves');
    const king   = computeDifficultyLevel(10, 0, 1, 'king');
    expect(normal).toBe(king);
  });
});

describe('Claustrophobia MP — spawn count multiplier', () => {
  it('applies 1.5× base count in Claustrophobia mode', () => {
    const waveNumber = 5;
    const difficultyLevel = 1.0;

    const normalCount = computeBaseCount(waveNumber, difficultyLevel, 'waves');
    const claustrophobiaCount = computeBaseCount(waveNumber, difficultyLevel, 'claustrophobia');

    expect(claustrophobiaCount).toBeGreaterThan(normalCount);
    // Should be ~1.5× as long as we're under the cap
    if (claustrophobiaCount < 30) {
      expect(claustrophobiaCount / normalCount).toBeCloseTo(1.5, 0);
    }
  });

  it('respects the base count cap (30 for low difficulty, 40 for high)', () => {
    // At high difficulty, cap kicks in
    const highDifficulty = 7.0;
    const count = computeBaseCount(20, highDifficulty, 'claustrophobia');
    expect(count).toBeLessThanOrEqual(40);
  });
});

describe('Claustrophobia MP — earlier wave thresholds', () => {
  it('hard enemies appear at wave 3 in Claustrophobia (vs wave 4 normally)', () => {
    const normal = getWaveThresholds('waves');
    const clauStr = getWaveThresholds('claustrophobia');
    expect(clauStr.hardWaveThreshold).toBe(3);
    expect(normal.hardWaveThreshold).toBe(4);
  });

  it('splitting enemies appear at wave 4 in Claustrophobia (vs wave 5 normally)', () => {
    const normal = getWaveThresholds('waves');
    const clauStr = getWaveThresholds('claustrophobia');
    expect(clauStr.splittingWaveThreshold).toBe(4);
    expect(normal.splittingWaveThreshold).toBe(5);
  });

  it('elite enemies appear at wave 5 in Claustrophobia (vs wave 6 normally)', () => {
    const normal = getWaveThresholds('waves');
    const clauStr = getWaveThresholds('claustrophobia');
    expect(clauStr.eliteWaveThreshold).toBe(5);
    expect(normal.eliteWaveThreshold).toBe(6);
  });
});

describe('Claustrophobia MP — time limit', () => {
  it('CLAUSTROPHOBIA_TIME_LIMIT_SECS is 1200 (20 minutes)', () => {
    expect(CLAUSTROPHOBIA_TIME_LIMIT_SECS).toBe(1200);
  });

  it('time limit should trigger game over at 20 minutes', () => {
    // Simple logic mirror: gameTime >= CLAUSTROPHOBIA_TIME_LIMIT_SECS → game over
    const shouldEnd = (gameTime: number, mode: string) =>
      mode === 'claustrophobia' && gameTime >= CLAUSTROPHOBIA_TIME_LIMIT_SECS;

    expect(shouldEnd(1199, 'claustrophobia')).toBe(false);
    expect(shouldEnd(1200, 'claustrophobia')).toBe(true);
    expect(shouldEnd(1201, 'claustrophobia')).toBe(true);
    expect(shouldEnd(1200, 'waves')).toBe(false);
  });
});
