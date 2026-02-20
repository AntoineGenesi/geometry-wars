/**
 * Regression tests for VotingScreen SURFACES and MODES arrays.
 * These tests catch invalid surface types / unimplemented game modes being
 * accidentally added back to the voting options.
 *
 * Regression: S27 — cylinder/knot were in SURFACES but not in SurfaceFactory;
 * king/rainbow were in MODES but had no server implementation.
 */

import { describe, it, expect } from 'vitest';
import { SurfaceFactory } from '../surfaces/SurfaceFactory';
import { SURFACES, MODES } from './VotingScreen';

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
  const IMPLEMENTED_MODES = ['waves'];

  it('every mode ID has a server implementation', () => {
    const unimplementedModes = MODES.filter(m => !IMPLEMENTED_MODES.includes(m.id));
    expect(unimplementedModes).toEqual([]);
  });

  it('does not include king (no server implementation)', () => {
    const ids = MODES.map(m => m.id);
    expect(ids).not.toContain('king');
  });

  it('does not include rainbow (no server implementation)', () => {
    const ids = MODES.map(m => m.id);
    expect(ids).not.toContain('rainbow');
  });

  it('includes waves mode', () => {
    const ids = MODES.map(m => m.id);
    expect(ids).toContain('waves');
  });
});
