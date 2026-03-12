# Teleportation System

## Purpose
Portal/teleporter pickups allow the player to teleport to another location on the surface. The system must: (1) detect when the player enters the portal zone, (2) compute a valid destination position on the surface, (3) teleport the player to that position while preserving surface-relative orientation, (4) grant brief invincibility to prevent instant death after teleport.

## Architecture

### Teleporter Placement
Portals are placed on the surface geometry as entities with a UV position and a world position. They have a trigger radius — when the player's world position is within this radius, teleportation activates.

### Teleport Sequence
1. Player enters portal trigger radius
2. Flash/visual effect plays
3. Player position is set to destination UV/world position
4. Player normal is updated to match destination surface normal
5. Camera position is initialized to new player position (skip lerp to avoid passing through geometry)
6. Invincibility timer starts (prevents instant death at exit)

### Destination Computation
For a "paired portal" system: portal A teleports to portal B's position and vice versa. For random/unpaired portals: destination is computed as a random UV point on the surface, converted to world position via `surface.getPoint(UV)`.

## Critical Bugs and Root Causes

### Bug 1: Random Teleportation at UV Poles (Sphere)
**Root cause:** Sphere UV has singularities at the poles (u,v) = (0,0) and (0,1). When the player is near the pole, their UV position is numerically unstable. The portal trigger zone detection may accidentally fire because the UV distance computation wraps around the pole discontinuity, making a distant portal appear close. Or: a portal placed near the pole has a UV position that "teleports" to an arbitrary world location due to the pole singularity.

**Fix direction:** Avoid placing portals near UV poles. Add a pole exclusion zone (e.g., |v - 0| < 0.05 or |v - 1| < 0.05) for portal placement. For trigger detection, use world distance not UV distance.

**Status:** STILL OPEN as of March 2026. Listed in MEMORY.md as stress test finding.

### Bug 2: Teleportation Jumps on Sphere, Cube, Cube-Ring, Peanut, Mobius-Bevel
**Root cause:** After teleportation, the player position is set in world space, but the camera lerp starts from the old position and interpolates to the new position. On certain surfaces, this lerp path passes through the surface geometry (since the surface is curved), causing a visible "jump" where the player appears to pass through the surface during the lerp transition.

**Fix direction:** On teleport, set camera position to destination immediately (reset lerp, skip interpolation for one frame). This is the same fix needed for spawn/respawn camera positioning.

**Status:** STILL OPEN as of March 2026 (stress test finding in MEMORY.md).

### Bug 3: No Invincibility After Teleport
**Observed (Feb/Mar 2026 indirectly):** Players dying immediately after teleporting because enemies were at the destination. Portal should grant brief invincibility (1-2 seconds) after arrival to allow the player to orient and escape.

**Fix direction:** Start `player.invincibilityTimer` on teleport arrival, same as respawn invincibility.

**Status:** Referenced in `verify-code-is-called.md` as a known gap — "Portal teleport grants no invincibility — dies instantly at exit."

### Bug 4: Portals Not Working (2026-03-10)
**Observed:** Portals completely non-functional. Player walks through portal zone with no effect. Root cause not definitively identified in voice dump context. Suspected: portal trigger detection was broken by a refactor of the world-position-based collision system (same root cause as pickup collection — UV-based proximity check was broken, and portals also used UV-based detection).

**Fix direction:** Use world position (mesh.position) for portal trigger detection, not UV distance. Same fix as pickup collection (`surface.worldToSurface(mesh.position)`).

**Status:** Marked as fixed in approximately s44r10 area.

### Bug 5: Teleporter in PvP/PvPvE
**Not separately documented but implied:** In PvP mode, teleporting should move only the local player, not the opponent. Server-authoritative MP teleportation must send teleport event to server which then broadcasts only to the teleporting player's client.

## What Worked
- World-position-based trigger detection (not UV distance) for portal activation
- Camera position reset on teleport (skip lerp)
- Invincibility timer after teleport arrival

## What DIDN'T Work
- UV-distance-based portal trigger detection (fails at poles and on non-spherical maps)
- Camera lerp through teleport (passes through geometry on curved surfaces)
- Portals placed near UV poles (singularity causes unpredictable behavior)

## Regression Guards
- Portal trigger detection MUST use world position, not UV — same rule as pickup collection
- Camera MUST NOT lerp on the first frame after teleport — use position reset
- Portal placement MUST avoid UV poles (|v| < 0.05 or |v| > 0.95 for sphere)
- Invincibility timer MUST be set on teleport arrival (same as respawn)

## Key Files
- `src/entities/Portal.ts` (or similar) — portal entity + trigger detection
- `src/entities/Player.ts` — player teleport handling + invincibility timer
- `src/core/GameLoop.ts` — SP teleport update loop
- `src/network-main.ts` — MP teleport event handling

## Historical Timeline
- Feb 2026: Random teleportation at poles first reported (UV singularity)
- Feb 26: Random teleportation continues (not fixed)
- Mar 10: Portals not working at all (trigger detection broken by refactor)
- Mar 10: "Teleportation jumps on sphere, cube, cube-ring, peanut, mobius-bevel" — stress test finding (MEMORY.md)
- Approximately s44r9-10: Portal trigger detection fixed via world position approach
