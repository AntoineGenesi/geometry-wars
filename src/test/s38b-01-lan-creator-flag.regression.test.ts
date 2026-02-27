/**
 * Regression test for s38b-01: LAN laptop connection broken after S38a.
 *
 * Root cause: ALL StartMenu LAN connections were setting creator=1 in URL params,
 * causing laptops joining via LAN lobby to set requestHost=true in Colyseus join,
 * which could interfere with the actual host's session.
 *
 * Fix: Only the HOST player (clicking HOST GAME → ENTER GAME) should be creator.
 * LAN lobby joiners, QR code scanners, and manual IP connectors are NOT creators.
 *
 * These tests verify the MenuSelection.isCreator semantics are correct.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for the creator flag logic extracted from main.ts
// The logic: only set creator='1' when selection.isCreator is true
// ---------------------------------------------------------------------------

type NetworkSelection = {
  gameMode: 'network';
  surfaceType: string;
  serverUrl?: string;
  playerName?: string;
  isCreator?: boolean;
};

/** Mirrors the logic in src/main.ts that builds URL params for network mode */
function buildNetworkParams(selection: NetworkSelection): Record<string, string> {
  const params: Record<string, string> = { mode: 'network', surface: selection.surfaceType };
  if (selection.isCreator) params.creator = '1';
  if (selection.serverUrl) params.server = selection.serverUrl;
  if (selection.playerName) params.name = selection.playerName;
  return params;
}

describe('s38b-01 regression: LAN creator flag', () => {
  describe('HOST player (clicks HOST GAME → ENTER GAME)', () => {
    it('sets creator=1 when isCreator is true', () => {
      const params = buildNetworkParams({
        gameMode: 'network',
        surfaceType: 'sphere',
        isCreator: true,
      });
      expect(params.creator).toBe('1');
    });
  });

  describe('LAN lobby joiner (laptop scanning from lobby)', () => {
    it('does NOT set creator=1 when isCreator is false', () => {
      const params = buildNetworkParams({
        gameMode: 'network',
        surfaceType: 'sphere',
        isCreator: false,
      });
      expect(params.creator).toBeUndefined();
    });

    it('does NOT set creator=1 when isCreator is undefined (default)', () => {
      const params = buildNetworkParams({
        gameMode: 'network',
        surfaceType: 'sphere',
        // isCreator not set — simulates QR code or lobby joiner path
      });
      expect(params.creator).toBeUndefined();
    });
  });

  describe('Manual IP connect (entering server URL manually)', () => {
    it('does NOT set creator=1 when isCreator is not set', () => {
      const params = buildNetworkParams({
        gameMode: 'network',
        surfaceType: 'cube',
        serverUrl: 'http://192.168.1.42:3000',
        playerName: 'Alice',
        // isCreator not set — manual IP connect defaults to false
      });
      expect(params.creator).toBeUndefined();
      expect(params.server).toBe('http://192.168.1.42:3000');
      expect(params.name).toBe('Alice');
    });
  });

  describe('Param integrity', () => {
    it('always includes mode and surface', () => {
      const params = buildNetworkParams({
        gameMode: 'network',
        surfaceType: 'torus',
        isCreator: false,
      });
      expect(params.mode).toBe('network');
      expect(params.surface).toBe('torus');
    });

    it('creator=1 is the only value that triggers requestHost on server', () => {
      // Verify the exact string value — network-main.ts checks params.get('creator') === '1'
      const params = buildNetworkParams({
        gameMode: 'network',
        surfaceType: 'sphere',
        isCreator: true,
      });
      expect(params.creator).toBe('1');
      expect(params.creator).not.toBe('true');
      expect(params.creator).not.toBe('yes');
    });
  });
});
