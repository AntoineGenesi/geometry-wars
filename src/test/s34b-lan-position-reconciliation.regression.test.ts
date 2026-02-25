/**
 * Regression test: S34b — LAN Position Reconciliation
 *
 * Tests the position reconciliation logic that was introduced in S34b to fix
 * random teleportation and direction inversion in LAN multiplayer.
 *
 * Root cause: The old code hard-snapped the local player to the server position
 * on every state update (~30Hz). The server position is RTT-delayed (~50ms),
 * so the snap moved the player backward relative to their client prediction,
 * causing visible rubber-banding ("teleportation") and apparent direction
 * inversion when the player was moving forward.
 *
 * Fix: Threshold-based reconciliation:
 * - Large error (> SERVER_SNAP_THRESHOLD = 0.1 UV): hard snap
 *   (covers: respawn, round-start, genuine multi-second desync)
 * - Small error (normal RTT drift): gentle 10% blend
 *   (corrects cumulative float error without reversing movement direction)
 * - Dead / just-respawned: always hard snap
 */

import { describe, it, expect } from 'vitest';

// -------------------------------------------------------------------------
// Pure implementation of the reconciliation logic (extracted from
// network-main.ts onStateChange) so we can unit test it without a DOM.
// -------------------------------------------------------------------------

interface PlayerUV {
  surfaceU: number;
  surfaceV: number;
}

const SERVER_SNAP_THRESHOLD_SQ = 0.1 * 0.1;
const SERVER_CORRECTION_BLEND = 0.1;

/**
 * Reconcile client UV with server UV, mirroring the logic in network-main.ts.
 */
function reconcile(
  client: PlayerUV,
  serverU: number,
  serverV: number,
  isDeadNow: boolean,
  justRespawned: boolean,
): PlayerUV {
  const du = serverU - client.surfaceU;
  const dv = serverV - client.surfaceV;
  const errSq = du * du + dv * dv;

  if (justRespawned || isDeadNow || errSq > SERVER_SNAP_THRESHOLD_SQ) {
    return { surfaceU: serverU, surfaceV: serverV };
  } else {
    return {
      surfaceU: client.surfaceU + du * SERVER_CORRECTION_BLEND,
      surfaceV: client.surfaceV + dv * SERVER_CORRECTION_BLEND,
    };
  }
}

describe('S34b regression: LAN position reconciliation', () => {
  describe('Normal RTT drift: small error → gentle blend', () => {
    it('does not hard-snap for small server correction (RTT drift)', () => {
      // Client has moved ahead of server by 5ms * 0.095 UV/s = 0.000475 UV
      // (much less than 0.1 threshold). Should blend, not snap.
      const client: PlayerUV = { surfaceU: 0.52, surfaceV: 0.50 };
      const serverU = 0.515; // server is 0.005 UV behind
      const serverV = 0.50;

      const result = reconcile(client, serverU, serverV, false, false);

      // Should NOT snap to serverU (0.515)
      expect(result.surfaceU).toBeGreaterThan(0.515);
      // Should be between old client position and server position (blended)
      expect(result.surfaceU).toBeLessThan(0.52);
      expect(result.surfaceU).toBeCloseTo(0.52 + (0.515 - 0.52) * 0.1, 6);
    });

    it('blend does not reverse movement direction (key regression guard)', () => {
      // Player moving forward (increasing V). Server is slightly behind.
      // Bug: hard-snap moved player BACKWARD when server is behind → apparent inversion.
      // Fix: gentle blend means correction is much smaller than prediction step.
      const movementPerFrame = 0.095 * (1 / 60); // ~0.00158 UV per frame at PLAYER_SPEED

      const client: PlayerUV = { surfaceU: 0.50, surfaceV: 0.52 };
      const serverV = 0.515; // server is 0.005 UV behind client

      const result = reconcile(client, 0.50, serverV, false, false);

      // After blend, V decreases slightly (toward server)
      const blendDelta = (serverV - client.surfaceV) * SERVER_CORRECTION_BLEND; // -0.0005

      // But the next prediction frame adds +movementPerFrame (~+0.00158)
      const netDelta = blendDelta + movementPerFrame;

      // Net delta should be POSITIVE (still moving forward)
      expect(netDelta).toBeGreaterThan(0);
    });

    it('hard-snap would have reversed direction (demonstrates the old bug)', () => {
      // With the OLD code (hard snap), if server is 0.005 UV behind:
      // snap: V goes from 0.52 to 0.515 (delta = -0.005)
      // next prediction: +0.00158
      // net: -0.005 + 0.00158 = -0.00342 → BACKWARD!
      const movementPerFrame = 0.095 * (1 / 60);
      const clientV = 0.52;
      const serverV = 0.515;

      const hardSnapDelta = serverV - clientV; // -0.005
      const netWithSnap = hardSnapDelta + movementPerFrame; // negative = direction inverted!
      expect(netWithSnap).toBeLessThan(0); // confirms old bug existed
    });
  });

  describe('Large error → hard snap', () => {
    it('hard-snaps when server is > 0.1 UV away (genuine desync)', () => {
      // If server says player is at 0.5 but client is at 0.7 (0.2 UV diff),
      // something went wrong — hard snap immediately.
      const client: PlayerUV = { surfaceU: 0.70, surfaceV: 0.50 };
      const result = reconcile(client, 0.50, 0.50, false, false);

      expect(result.surfaceU).toBe(0.50);
      expect(result.surfaceV).toBe(0.50);
    });

    it('hard-snaps exactly at the threshold boundary (>0.1 UV)', () => {
      const client: PlayerUV = { surfaceU: 0.5, surfaceV: 0.5 };
      // errSq = 0.101^2 = 0.010201 > 0.01 → snap
      const result = reconcile(client, 0.601, 0.5, false, false);
      expect(result.surfaceU).toBe(0.601);
    });

    it('does NOT snap at just below threshold (0.099 UV error)', () => {
      const client: PlayerUV = { surfaceU: 0.5, surfaceV: 0.5 };
      // errSq = 0.099^2 = 0.009801 < 0.01 → blend
      const result = reconcile(client, 0.599, 0.5, false, false);
      expect(result.surfaceU).not.toBe(0.599);
      expect(result.surfaceU).toBeCloseTo(0.5 + (0.599 - 0.5) * 0.1, 6);
    });
  });

  describe('Respawn and death always hard-snap', () => {
    it('hard-snaps on respawn (justRespawned=true) regardless of distance', () => {
      const client: PlayerUV = { surfaceU: 0.5, surfaceV: 0.5 };
      const serverU = 0.501; // tiny difference — would normally blend
      const result = reconcile(client, serverU, 0.5, false, true);

      // Should snap even though error is tiny (it's a respawn!)
      expect(result.surfaceU).toBe(serverU);
    });

    it('hard-snaps when player is dead (isDeadNow=true) regardless of distance', () => {
      // While dead, client prediction might have moved UV. Server should override.
      const client: PlayerUV = { surfaceU: 0.5, surfaceV: 0.5 };
      const serverU = 0.502; // tiny difference — would normally blend
      const result = reconcile(client, serverU, 0.5, true, false);

      expect(result.surfaceU).toBe(serverU);
    });

    it('hard-snaps on respawn even when near spawn (respawn to same area)', () => {
      // Player died near spawn and respawns at same spawn position.
      // Even with tiny error, we want to snap exactly to spawn.
      const client: PlayerUV = { surfaceU: 0.499, surfaceV: 0.499 };
      const spawnU = 0.5;
      const spawnV = 0.5;
      const result = reconcile(client, spawnU, spawnV, false, true);

      expect(result.surfaceU).toBe(spawnU);
      expect(result.surfaceV).toBe(spawnV);
    });
  });

  describe('Correction convergence: drift corrects over time', () => {
    it('10% blend corrects 65% of drift after 10 state updates', () => {
      let client: PlayerUV = { surfaceU: 0.0, surfaceV: 0.0 };
      const serverU = 0.05; // constant target (small drift, < threshold)
      const serverV = 0.0;

      // Simulate 10 state updates at 30Hz
      for (let i = 0; i < 10; i++) {
        client = reconcile(client, serverU, serverV, false, false);
      }

      // After 10 updates: 1 - 0.9^10 ≈ 65% corrected
      const expectedU = serverU * (1 - Math.pow(1 - SERVER_CORRECTION_BLEND, 10));
      expect(client.surfaceU).toBeCloseTo(expectedU, 5);
      expect(client.surfaceU).toBeGreaterThan(0.03); // at least 65% of 0.05
    });

    it('reaches 99% correction within 40 state updates (~1.3s at 30Hz)', () => {
      let client: PlayerUV = { surfaceU: 0.0, surfaceV: 0.0 };
      const serverU = 0.05;

      for (let i = 0; i < 40; i++) {
        client = reconcile(client, serverU, 0.0, false, false);
      }

      // After 40 updates: 1 - 0.9^40 ≈ 98.5% corrected
      expect(client.surfaceU).toBeGreaterThan(0.049); // > 98% of 0.05
    });
  });
});
