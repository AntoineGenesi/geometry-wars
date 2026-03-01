/**
 * Regression test: s44-epic-08 — MP Movement Glitch (client fighting server positions)
 *
 * Root cause: network-main.ts applied TWO competing position sources for the local player:
 *   1. UV→surface.getPoint(surfaceU, surfaceV) in onFixedUpdate (client-side prediction)
 *   2. Server world-space positions (wx, wy, wz) from ServerMeshWalker on hard snaps only
 *
 * The server's ServerMeshWalker walks on actual mesh faces (geodesic), while
 * surface.getPoint(u, v) uses analytic UV parameterization. These give DIFFERENT
 * world positions, especially at poles and on complex surfaces (torus, peanut).
 * When both ran each frame, the mesh oscillated → "two versions of him" glitch.
 *
 * Fix (s44-epic-08):
 *   - Store server wx/wy/wz in _localPlayerWorldTarget EVERY frame (not just hard snaps).
 *   - In onFixedUpdate visual update: lerp toward server world position when valid.
 *   - Fallback to surface.getPoint() only until first server world frame arrives.
 *   - Also use server tangent frame for aim angle + companions (avoids unstable getPoint() at poles).
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Pure implementation of the _localPlayerWorldTarget update logic
// (extracted from network-main.ts onStateChange local player block).
// ---------------------------------------------------------------------------

interface WorldTarget {
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  tx: number; ty: number; tz: number;
  valid: boolean;
}

interface NetPlayerData {
  wx?: number; wy?: number; wz?: number;
  nx?: number; ny?: number; nz?: number;
  tx?: number; ty?: number; tz?: number;
}

/**
 * Mirror of network-main.ts s44-epic-08 block: update local player world target.
 */
function updateLocalPlayerWorldTarget(target: WorldTarget, netPlayer: NetPlayerData): void {
  const hasWorldPos = netPlayer.wx !== undefined
    && (netPlayer.wx !== 0 || netPlayer.wy !== 0 || netPlayer.wz !== 0);
  if (hasWorldPos) {
    target.x  = netPlayer.wx!;
    target.y  = netPlayer.wy!;
    target.z  = netPlayer.wz!;
    target.nx = netPlayer.nx ?? 0;
    target.ny = netPlayer.ny ?? 1;
    target.nz = netPlayer.nz ?? 0;
    target.tx = netPlayer.tx ?? 1;
    target.ty = netPlayer.ty ?? 0;
    target.tz = netPlayer.tz ?? 0;
    target.valid = true;
  }
}

/**
 * Mirror of network-main.ts onFixedUpdate visual update:
 * lerp mesh position toward server world target when valid.
 */
function applyLocalPlayerWorldPos(
  target: WorldTarget,
  meshPos: THREE.Vector3,
  scaleFactor: number,
  lerpFactor: number,
): boolean {
  if (!target.valid) return false;

  const targetX = target.x * scaleFactor + target.nx * 0.15;
  const targetY = target.y * scaleFactor + target.ny * 0.15;
  const targetZ = target.z * scaleFactor + target.nz * 0.15;
  meshPos.lerp(new THREE.Vector3(targetX, targetY, targetZ), lerpFactor);
  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('s44-epic-08 regression: local player world position from server', () => {

  describe('_localPlayerWorldTarget update logic', () => {
    it('sets valid=true and stores position when server sends non-zero wx/wy/wz', () => {
      const target: WorldTarget = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, tx: 1, ty: 0, tz: 0, valid: false };
      updateLocalPlayerWorldTarget(target, { wx: 3.5, wy: 7.2, wz: -1.0, nx: 0, ny: 1, nz: 0 });

      expect(target.valid).toBe(true);
      expect(target.x).toBe(3.5);
      expect(target.y).toBe(7.2);
      expect(target.z).toBe(-1.0);
    });

    it('keeps valid=false when server sends wx=wy=wz=0 (uninitialized)', () => {
      // All-zero means the walker hasn't been placed yet — don't snap to origin.
      const target: WorldTarget = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, tx: 1, ty: 0, tz: 0, valid: false };
      updateLocalPlayerWorldTarget(target, { wx: 0, wy: 0, wz: 0 });

      expect(target.valid).toBe(false);
    });

    it('keeps valid=false when wx is undefined (server not sending world pos)', () => {
      const target: WorldTarget = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, tx: 1, ty: 0, tz: 0, valid: false };
      updateLocalPlayerWorldTarget(target, { nx: 0, ny: 1, nz: 0 }); // no wx/wy/wz

      expect(target.valid).toBe(false);
    });

    it('updates target every call (not just on hard snaps)', () => {
      const target: WorldTarget = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, tx: 1, ty: 0, tz: 0, valid: false };
      // First server frame
      updateLocalPlayerWorldTarget(target, { wx: 1.0, wy: 0.0, wz: 0.0 });
      expect(target.x).toBe(1.0);

      // Second server frame (player moved) — should update target (not stay at old value)
      updateLocalPlayerWorldTarget(target, { wx: 2.0, wy: 0.0, wz: 0.0 });
      expect(target.x).toBe(2.0);
      expect(target.valid).toBe(true);
    });

    it('stores tangent frame from server alongside world position', () => {
      const target: WorldTarget = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, tx: 1, ty: 0, tz: 0, valid: false };
      updateLocalPlayerWorldTarget(target, {
        wx: 5.0, wy: 3.0, wz: 2.0,
        nx: 0, ny: 1, nz: 0,
        tx: 1, ty: 0, tz: 0,
      });

      expect(target.nx).toBe(0);
      expect(target.ny).toBe(1);
      expect(target.nz).toBe(0);
      expect(target.tx).toBe(1);
      expect(target.ty).toBe(0);
      expect(target.tz).toBe(0);
    });

    it('defaults ny=1 when server sends nx/ny/nz all undefined', () => {
      // Guard against server sending wx/wy/wz but not the normal (shouldn't happen but be safe)
      const target: WorldTarget = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, tx: 0, ty: 0, tz: 0, valid: false };
      updateLocalPlayerWorldTarget(target, { wx: 1.0, wy: 0.0, wz: 0.0 });

      // Default: ny=1 (upward normal)
      expect(target.ny).toBe(1);
    });
  });

  describe('mesh position update: server world pos wins over UV->getPoint()', () => {
    it('returns true and lerps mesh toward server world position when valid', () => {
      const target: WorldTarget = {
        x: 5.0, y: 0.0, z: 0.0,
        nx: 0, ny: 1, nz: 0,
        tx: 1, ty: 0, tz: 0,
        valid: true,
      };
      const meshPos = new THREE.Vector3(0, 0, 0);
      const result = applyLocalPlayerWorldPos(target, meshPos, 1.0, 0.5);

      expect(result).toBe(true);
      // Lerp 0.5: should move halfway toward target (5.0 * 1.0 + 0 * 0.15 = 5.0)
      // From 0 to 5: lerp(0.5) = 2.5
      expect(meshPos.x).toBeCloseTo(2.5, 5);
    });

    it('returns false when target is invalid (no server frame yet)', () => {
      const target: WorldTarget = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, tx: 1, ty: 0, tz: 0, valid: false };
      const meshPos = new THREE.Vector3(1, 2, 3);
      const result = applyLocalPlayerWorldPos(target, meshPos, 1.0, 0.5);

      expect(result).toBe(false);
      // Mesh position unchanged when invalid
      expect(meshPos.x).toBe(1);
      expect(meshPos.y).toBe(2);
      expect(meshPos.z).toBe(3);
    });

    it('applies map scale factor to world position', () => {
      // scaleFactor=1.5 → world pos is 1.5x larger in scene
      const target: WorldTarget = {
        x: 4.0, y: 0.0, z: 0.0,
        nx: 0, ny: 1, nz: 0,
        tx: 1, ty: 0, tz: 0,
        valid: true,
      };
      const meshPos = new THREE.Vector3(0, 0, 0);
      // With lerpFactor=1.0, meshPos should snap to target immediately
      applyLocalPlayerWorldPos(target, meshPos, 1.5, 1.0);

      // Expected: x = 4.0 * 1.5 + 0 * 0.15 = 6.0
      expect(meshPos.x).toBeCloseTo(6.0, 5);
    });

    it('adds normal offset to lift player above surface', () => {
      // Normal is (0, 1, 0) = up, offset is +0.15 in Y
      const target: WorldTarget = {
        x: 0.0, y: 5.0, z: 0.0,
        nx: 0, ny: 1, nz: 0,
        tx: 1, ty: 0, tz: 0,
        valid: true,
      };
      const meshPos = new THREE.Vector3(0, 0, 0);
      applyLocalPlayerWorldPos(target, meshPos, 1.0, 1.0);

      // Expected: y = 5.0 * 1.0 + 1 * 0.15 = 5.15
      expect(meshPos.y).toBeCloseTo(5.15, 5);
    });

    it('converges to server position over multiple frames (lerp 0.5)', () => {
      const target: WorldTarget = {
        x: 10.0, y: 0.0, z: 0.0,
        nx: 0, ny: 1, nz: 0,
        tx: 1, ty: 0, tz: 0,
        valid: true,
      };
      const meshPos = new THREE.Vector3(0, 0, 0);
      const targetX = 10.15; // 10 * 1.0 + 0 * 0.15

      // After 10 frames at lerp=0.5: should be > 99.9% of the way there
      for (let i = 0; i < 10; i++) {
        applyLocalPlayerWorldPos(target, meshPos, 1.0, 0.5);
      }
      expect(meshPos.x).toBeCloseTo(targetX, 1);
    });
  });

  describe('root cause: old behavior (UV->getPoint) vs new behavior (server world pos)', () => {
    it('demonstrates how UV-to-world and server-world-space can disagree (the core bug)', () => {
      // Simulate a sphere: UV (0.0, 0.0) = north pole. surface.getPoint() would return
      // world position near (0, 10, 0). But the server's geodesic walker may place
      // the player at (0.5, 9.8, 0.3) due to face-accurate positioning.
      //
      // Old code: mesh.position = surface.getPoint(0.0, 0.0).position = (0, 10, 0)
      // New code: mesh.position = server wx/wy/wz = (0.5, 9.8, 0.3)
      //
      // The difference is what caused the "glitch between two versions" bug.

      const uvDerivedPos = new THREE.Vector3(0, 10, 0);      // UV→getPoint at north pole
      const serverWorldPos = new THREE.Vector3(0.5, 9.8, 0.3); // Server MeshWalker output

      // The two positions disagree!
      expect(uvDerivedPos.distanceTo(serverWorldPos)).toBeGreaterThan(0.1);

      // With new fix: mesh lerps toward server world pos
      const target: WorldTarget = {
        x: serverWorldPos.x, y: serverWorldPos.y, z: serverWorldPos.z,
        nx: 0, ny: 1, nz: 0, tx: 1, ty: 0, tz: 0,
        valid: true,
      };
      const meshPos = uvDerivedPos.clone();
      applyLocalPlayerWorldPos(target, meshPos, 1.0, 0.5);

      // After lerp: meshPos moved toward server pos (not UV-derived pos)
      const distToServer = meshPos.distanceTo(serverWorldPos);
      const distToUV = meshPos.distanceTo(uvDerivedPos);
      expect(distToServer).toBeLessThan(distToUV); // closer to server than to UV-derived
    });

    it('demonstrates how all-zero guard prevents snapping to origin on uninitialized server state', () => {
      // Bug scenario: server sends wx=wy=wz=0 before walker is initialized.
      // Without guard: player snaps to world origin (0,0,0) = visible teleport.
      // With guard: valid stays false, we use surface.getPoint() fallback instead.

      const target: WorldTarget = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, tx: 1, ty: 0, tz: 0, valid: false };

      // Server sends all-zero (uninitialized)
      updateLocalPlayerWorldTarget(target, { wx: 0, wy: 0, wz: 0 });
      expect(target.valid).toBe(false); // still invalid → use fallback

      // Server sends valid position
      updateLocalPlayerWorldTarget(target, { wx: 5.0, wy: 3.0, wz: 0.0 });
      expect(target.valid).toBe(true); // now valid → use server world pos
    });
  });
});
