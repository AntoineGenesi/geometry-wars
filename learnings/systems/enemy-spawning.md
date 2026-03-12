# Enemy Spawning System

## Purpose
Enemies are spawned at valid positions on the current map surface. The spawner must: (1) select a UV position on the surface, (2) convert to a world position, (3) initialize the enemy's surface-relative orientation (normal, tangent, bitangent), (4) ensure enemies don't spawn at invalid positions (inside geometry, at UV poles, at the same position as the player).

## Architecture

### SP Spawning
- `EnemySpawner.ts` — manages SP enemy spawn timing and positioning
- Spawn position selected from valid UV range for surface type
- `surface.getPoint(UV)` converts UV to world position
- Enemy normal initialized from `surface.getNormal(UV)` or computed analytically
- `mapSizeScaleFactor` applied to scale entity behavior to current map size

### MP Spawning
- `server/rooms/GameRoom.ts` — server-authoritative enemy spawning
- Server selects spawn UV, broadcasts to clients
- Clients use `SurfaceGeometryBuilder` to reconstruct surface geometry
- **CRITICAL:** Server uses `SurfaceGeometryBuilder` which MUST have same dimensions as client's `createStandardSurfaceConfig()`

### Enemy Types and Spawning Behavior
- Basic enemies: single spawn point, patrol UV path
- Snake enemies (linked body segments): each segment spawned at UV offset from previous
- Guardian enemies: fixed positions near territory zones
- Ghost enemies: can spawn anywhere (including behind player)

## Critical Bugs and Root Causes

### Bug 1: Enemies Inside Surface Geometry (Server-Client Geometry Mismatch)
**Root cause:** The server's `SurfaceGeometryBuilder` used different dimensions from the client's `createStandardSurfaceConfig()`. When `mapSizeScaleFactor` was applied on the client but not the server, the server spawned enemies at UV positions corresponding to the UNSCALED surface. On the client, the surface was rendered at scaled dimensions, so the server's UV positions mapped to positions INSIDE the larger surface rather than on it.

**Effect:** Enemies appeared to orbit "a ghost of where the planet used to be" — they were on the unscaled surface that existed only on the server.

**Fix:** Apply `mapSizeScaleFactor` consistently in BOTH `SurfaceGeometryBuilder` (server) and `createStandardSurfaceConfig()` (client). Parity test: `SurfaceGeometryBuilder.server-client-parity.test.ts`.

**Regression guard (failure mode #20):** Whenever any surface geometry changes, BOTH server and client geometry builders must be updated together. The parity test MUST pass before merge.

### Bug 2: Cube-Ring + Mobius Enemies Frozen at Topology Discontinuity
**Root cause:** Enemy movement system (MeshWalker) freezes when the enemy tries to navigate across topology discontinuities:
- Cube-ring: the ring edge joining point where UV wraps creates a discontinuity that confuses the movement system
- Mobius: the seam with half-twist causes the movement system to freeze when the enemy reaches the seam

**Effect:** ALL enemies on cube-ring and Mobius maps are completely stationary — they spawn correctly but never move.

**Status:** STILL OPEN as of March 2026. Listed in MEMORY.md as "STRESS: cube-ring + mobius — ALL enemies frozen."

**Fix direction:** The MeshWalker's edge-crossing logic must handle topology discontinuities for cube-ring and Mobius the same way it handles the Mobius seam for PLAYER movement (which IS fixed). Extract the seam-crossing logic from player MeshWalker and apply to enemy MeshWalker.

### Bug 3: EnemySpawner Fallback Position Bug (Wrapping Surfaces)
**Root cause:** When `EnemySpawner.ts` needed a fallback spawn position (e.g., when the primary position was invalid), it used UV=(0,0) as the default. On wrapping surfaces (torus, Mobius, cube-ring), UV=(0,0) is a valid position but happens to be at a seam/edge — which is exactly the position that causes movement freezing. So fallback-spawned enemies were immediately frozen.

**Fix (s44r10-02, commit `4f2e41eb`):** Changed fallback position to UV=(0.5, 0.5) — the center of the UV space, which is always a valid non-edge position on all surfaces.

### Bug 4: Snake Enemies Spawning Inside Pill Surface
**Observed (2026-03-09):** "Snake enemies with the fins that spawn have their body parts spawned inside the pill, almost like on a surface that's half as big as the pill." Root cause: Snake body segment positions are computed as UV offsets from the head position. On the pill surface, the UV offsets for a long snake crossed the pole region (narrow waist) where UV distortion is high — body segments were placed at UV positions that correspond to inside-surface world positions.

**Fix direction:** Compute snake body segment positions using world-space geodesic offsets, not UV offsets. Each segment should be placed at a surface-geodesic distance from the previous segment along the segment chain direction.

**Status:** STILL OPEN for pill surface as of March 2026.

### Bug 5: Enemies Not Moving in MP (Desync Between Players)
**Observed (Feb 2026):** "Entities in the LAN aren't moving in the way that they are for different players — they're in different positions." Server spawns enemies but client-side movement desync causes different clients to see enemies at different positions.

**Root cause:** Server-side enemy movement logic wasn't synchronized correctly — each client was running its own local movement simulation from the server spawn point, diverging over time.

**Fix:** Enemy positions broadcast from server to clients on each tick (server-authoritative movement). Clients show interpolated position, not locally simulated position.

### Bug 6: Enemies Spawning Far From Sphere on EPIC Size Maps
**Observed (2026-03-03):** "Players spawning far from sphere on EPIC." The EPIC map size applies a very large `mapSizeScaleFactor`. Enemy spawn positions were computed before the scale factor was applied, so enemies appeared at the unscaled surface radius while the player was on the much larger EPIC-scaled surface.

**Fix:** Apply `mapSizeScaleFactor` to spawn position before broadcasting to clients.

## What Worked
- `mapSizeScaleFactor` applied consistently on both server and client geometry builders
- UV=(0.5, 0.5) fallback spawn position (avoids seams on all surfaces)
- Server-authoritative enemy position broadcast each tick (prevents client desync)
- Analytical normals for cube-ring enemy spawning (avoids `computeVertexNormals()` 90° rotation bug)

## What DIDN'T Work
- UV=(0,0) fallback position — lands at seam on wrapping surfaces
- UV-offset snake body segment positioning — high distortion near surface poles/waist
- Applying `mapSizeScaleFactor` only on client — server uses wrong dimensions
- Client-local enemy movement simulation — diverges from other clients

## Regression Guards
- **Server-client geometry parity:** Any surface geometry change must update BOTH `SurfaceGeometryBuilder` and `createStandardSurfaceConfig()`. Parity test MUST pass.
- **Fallback spawn position:** Must remain UV=(0.5, 0.5), not UV=(0,0)
- **Cube-ring normals:** Use analytical normals, not `computeVertexNormals()` — wrong normals cause 90° movement rotation
- **mapSizeScaleFactor:** Must be in both SP `EnemySpawner.ts` AND server `GameRoom.ts`

## Key Files
- `src/entities/EnemySpawner.ts` — SP enemy spawn logic, fallback position, mapSizeScaleFactor
- `server/rooms/GameRoom.ts` — MP server spawn, position broadcast, server-client parity
- `src/geometry/SurfaceGeometryBuilder.ts` — server surface geometry (must match client)
- `src/surfaces/createStandardSurfaceConfig.ts` — client surface config (must match server)
- `tests/SurfaceGeometryBuilder.server-client-parity.test.ts` — parity regression test

## Historical Timeline
- Feb 20, 2026: Enemies in wrong positions in MP (server-client geometry mismatch first seen)
- Feb 21: Ghost spawns visible but not interacting
- Mar 3: Players spawning far from EPIC sphere
- Mar 7: Snake enemies glitching
- Mar 9: Pill enemies spawned inside surface (snake body segments)
- Mar 12: Server-client parity root cause identified, parity test added
- s44r10-02 (commit `4f2e41ef`): EnemySpawner fallback position UV=(0.5,0.5)
- STILL OPEN: cube-ring + mobius enemies frozen; pill snake body segments inside surface
