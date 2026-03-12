# MP Bullet Direction System

## Purpose
Bullets are fired in the player's aim direction and travel along geodesic (great-circle) paths on the surface. In SP, bullet direction is computed correctly from the player's tangent frame and mesh walker. In MP, bullet direction is computed server-side using UV-based coordinates, which produces different — and often wrong — results depending on the surface.

## Architecture

### SP Bullet System
- Bullet direction computed from `player.aimDirection` in world space
- Player's tangent frame (`normal`, `tangent`, `bitangent`) defines the local coordinate system
- Bullet travels along a geodesic path computed by the mesh walker
- `Bullet.ts` handles SP bullet movement and rendering

### MP Bullet System
- Server receives player input (analog stick direction) + player UV position
- Server computes bullet world direction from UV-based tangent vectors: `surface.getTangent(sphereUV)` and `surface.getBitangent(sphereUV)`
- Server broadcasts bullet origin + direction to all clients
- Client renders bullets traveling along the server-provided direction
- **Root problem:** Server uses `sphereUV` (sphere-approximation UV) for ALL surfaces — `getTangent(sphereUV)` gives the wrong tangent vector on non-spherical surfaces

### The Sphere-Approximation UV Problem
The MP server sends UV positions as sphere-approximation UVs for ALL surfaces, including non-spherical ones (torus, peanut, cube, Mobius). This is because the server-side UV system was originally designed for the sphere map and was never generalized.

On non-spherical surfaces, `surface.getTangent(sphereUV)` returns a tangent vector that corresponds to the SPHERE UV space, not the actual surface tangent at the player's visual position. The result: bullets travel in the direction that a sphere player would fire, not in the direction the actual surface player is facing.

## Critical Bugs and Root Causes

### Bug 1: MP Bullets Follow UV Lines Instead of Geodesics
**Root cause:** The UV parameterization of the sphere has `v` pointing toward the poles. When the server computes `bitangent = surface.getBitangent(sphereUV)`, this vector points toward the nearest pole (for a sphere). On non-spherical surfaces, using this sphere-derived bitangent as the "up" direction for bullet travel causes bullets to curve toward the UV pole — which visually means they curve toward the top of the screen regardless of the player's actual facing direction.

**Effect:** Bullets spiral toward the poles instead of traveling straight in the aimed direction. Visible on torus (strong curvature), peanut (waist distortion), pill (poles).

**Fix (s44r7-04 / atan2 fix):** Changed the bullet direction computation to use the player's actual world-space aim direction, not the UV-derived tangent/bitangent. Specifically, fixed the `atan2` orientation calculation that converts analog stick input to world-space direction. See commit `ccc3c231`.

**Status:** FIXED as of March 2026 for most surfaces in MP.

### Bug 2: MP Fires 1 Bullet, SP Fires 2 (Spread Shot)
**Root cause:** The spread shot weapon in SP fires 2 bullets with an angular offset. The MP version only fired 1 bullet because the server bullet-spawn logic didn't replicate the spread-shot fan. The server sent one bullet per shot event, not two.

**Fix:** MP server bullet-spawn handler checks weapon type and spawns the correct number of bullets (2 for spread shot, 1 for others).

**Status:** Fixed in approximately s44r8-s44r10.

### Bug 3: Bullets Lagging Behind Player (MP)
**Root cause:** In MP, bullet origin is computed at the server using the player's last-known position. Network latency means the player has moved forward by the time the bullet event is processed. Visually, bullets appear to originate from behind the player.

**Fix:** Client-side bullet origin prediction — the client renders the bullet starting from the current local player position, adjusting for the server delay. Alternatively, server extrapolates player position by `latency` milliseconds before computing bullet origin.

**Status:** Partially addressed. Still reported as "bullets lag behind player" in some MP sessions.

### Bug 4: Bullet Lagging / Origin Offset on Non-Spherical Maps
**Root cause:** Server computes bullet origin as `surface.getPoint(sphereUV)`. On non-spherical surfaces, this gives the wrong world position (sphere-approx error). The bullet appears to originate from a "shadow position" that's offset from the player's visual position. Most extreme on torus inner ring, peanut waist, sphere poles.

**Fix direction:** Use `mesh.position` (actual player world position) as bullet origin instead of `surface.getPoint(sphereUV)`. This is the same fix needed for bullet-origin-near-poles and pickup collection.

**Status:** STILL OPEN for torus inner ring, peanut waist, sphere poles as of March 2026 (see `bullet-origin-near-poles.md`).

### Bug 5: Aim Inverted After Spawn / Crossing Poles
**Root cause:** When the player spawns or crosses a UV pole, the player's tangent frame is computed from the pole UV (which is a singularity). The `atan2` rotation used to map analog stick → world direction references the tangent frame — at the pole, `tangent` and `bitangent` may be swapped or rotated 90°, causing the aim to feel inverted or rotated.

**Fix:** Detect pole proximity and use an alternative tangent frame computation (e.g., use world-up cross normal instead of UV-derived tangent). Same underlying issue as player movement oscillation at poles.

**Status:** Fixed for most surfaces. Reported as "gun off 130° on spawn, fixed after death" in March 2026 — the act of dying and respawning reset the tangent frame correctly.

### Bug 6: Spread Shot Invisible in MP
**Observed (2026-03-03):** Spread shot bullets fired but not rendered on other clients. Server spawned bullets correctly but client rendering path for spread-shot secondary bullets was missing from MP client code. Only the first bullet was rendered.

**Status:** Fixed in s44r10 area.

## What Worked
- World-space aim direction (not UV-derived tangent) for bullet direction
- `atan2` fix for sphere-UV → world-space direction conversion
- Checking weapon type at server for multi-bullet weapons (spread shot)
- Client-side bullet origin from `mesh.position` (actual visual position)

## What DIDN'T Work
- `surface.getTangent(sphereUV)` on non-spherical surfaces — gives sphere-space tangent, not surface tangent
- `surface.getPoint(sphereUV)` for bullet origin on non-spherical surfaces — gives wrong world position
- UV-based spread shot offset (offset in UV space != offset in world space on curved surfaces)

## Regression Guards
- MP bullet direction MUST use world-space aim, not UV-derived tangent/bitangent
- Bullet origin MUST use `mesh.position`, not `surface.getPoint(sphereUV)` — see bullet-origin-near-poles.md
- Spread shot MUST spawn correct number of bullets on server (check weapon type)
- `network-main.ts` has ALL MP bullet code — changes to SP `Bullet.ts` do NOT apply to MP

## Key Files
- `src/network-main.ts` — MP client bullet rendering and origin computation
- `server/rooms/GameRoom.ts` — MP server bullet spawning, direction computation
- `src/entities/Bullet.ts` — SP bullet movement (NOT used in MP)
- `src/entities/Player.ts` — SP player aim direction (source for SP bullets)

## Historical Timeline
- Feb 21, 2026: Bullets not geodesic in SP (peanut, cube) — first reports
- Feb 27: Torus bullets following UV not great circle
- Feb 28: MP bullets still not great circle; SP bullets geodesic, MP bullets UV-based
- Mar 1: Regression — bullets no longer great circle in SP after fix attempt
- Mar 1: SP bullets re-fixed (geodesic again)
- Mar 2: 1 bullet in MP (should be 2)
- Mar 3: Peanut bullets from wrong position; pill bullets offset
- Mar 7: Bullet lag/offset persists in some surfaces
- s44r7-04 (commit `ccc3c231`): atan2 fix for bullet direction in MP
- STILL OPEN: bullet origin offset on torus inner ring, peanut waist, sphere poles
